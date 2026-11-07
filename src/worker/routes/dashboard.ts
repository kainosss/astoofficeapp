import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { addDays, todayBrisbane } from "../../shared/quoteBuilder";
import type { DashboardData, QuoteStatus } from "../../shared/types";
import { listQuotes } from "../services/quotes";
import type { AppEnv } from "../types";

export const dashboardRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const db = c.var.db;
  const today = todayBrisbane();
  const soon = addDays(today, 7);
  const rows = await db.all<{ status: QuoteStatus; n: number; total: number | null; outstanding: number | null; outstanding_n: number; expiring: number }>(sql`
    SELECT r.status, COUNT(*) AS n, SUM(json_extract(r.totals, '$.totalCents')) AS total,
      SUM(CASE WHEN r.status = 'sent' AND (r.expiry_date IS NULL OR r.expiry_date >= ${today}) THEN json_extract(r.totals, '$.totalCents') ELSE 0 END) AS outstanding,
      SUM(CASE WHEN r.status = 'sent' AND (r.expiry_date IS NULL OR r.expiry_date >= ${today}) THEN 1 ELSE 0 END) AS outstanding_n,
      SUM(CASE WHEN r.status = 'sent' AND r.expiry_date >= ${today} AND r.expiry_date <= ${soon} THEN 1 ELSE 0 END) AS expiring
    FROM quotes q JOIN quote_revisions r ON r.id = q.current_revision_id
    GROUP BY r.status`);
  const byStatus: Record<QuoteStatus, number> = { draft: 0, sent: 0, accepted: 0, declined: 0, expired: 0 };
  let outstanding = 0, outstandingCount = 0, accepted = 0, expiringSoon = 0, total = 0;
  for (const r of rows) {
    byStatus[r.status] = r.n;
    total += r.n;
    outstanding += r.outstanding ?? 0;
    outstandingCount += r.outstanding_n ?? 0;
    expiringSoon += r.expiring ?? 0;
    if (r.status === "accepted") accepted = r.total ?? 0;
  }
  const customers = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM customers WHERE archived = 0`);
  const data: DashboardData = {
    totalQuotes: total, byStatus, outstandingValueCents: outstanding, outstandingCount, acceptedValueCents: accepted,
    expiringSoon, recent: await listQuotes(db, { limit: 8 }), customerCount: customers?.n ?? 0,
  };
  return c.json(data);
});
