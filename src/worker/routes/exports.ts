import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { listEquipment } from "../services/catalog";
import { listQuotes } from "../services/quotes";
import { audit } from "../services/settings";
import type { AppEnv } from "../types";

const TABLES = ["settings", "sequences", "customers", "sites", "equipment", "packages", "package_items", "quotes", "quote_revisions", "quote_items", "users", "audit_log"] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

function download(body: string, filename: string, type: string) {
  return new Response(body, {
    headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}

export const exportRoutes = new Hono<AppEnv>()
  /** Full backup of every table as JSON. Contains internal pricing — keep it private. */
  .get("/backup.json", async (c) => {
    const data: Record<string, unknown[]> = {};
    for (const t of TABLES) data[t] = await c.var.db.all(sql.raw(`SELECT * FROM ${t}`));
    await audit(c.var.db, c.var.user.email, "export.backup");
    const body = JSON.stringify({ app: "ASTO Office", format: 1, exportedAt: new Date().toISOString(), tables: data }, null, 2);
    return download(body, `asto-office-backup-${stamp()}.json`, "application/json");
  })
  .get("/customers.csv", async (c) => {
    const rows = await c.var.db.all<Record<string, unknown>>(sql`
      SELECT c.id, c.kind, c.name, c.contact_person, c.email, c.phone, s.address, s.suburb, s.state, s.postcode, c.notes
      FROM customers c LEFT JOIN sites s ON s.customer_id = c.id ORDER BY c.name, s.id`);
    await audit(c.var.db, c.var.user.email, "export.customers");
    return download(toCsv(["Customer ID", "Type", "Name", "Contact", "Email", "Phone", "Address", "Suburb", "State", "Postcode", "Notes"],
      rows.map((r) => [r.id, r.kind, r.name, r.contact_person, r.email, r.phone, r.address, r.suburb, r.state, r.postcode, r.notes])),
      `asto-customers-${stamp()}.csv`, "text/csv");
  })
  .get("/equipment.csv", async (c) => {
    const rows = await listEquipment(c.var.db);
    return download(toCsv(["ID", "Manufacturer", "Product", "Supplier", "SKU", "Category", "Unit", "Pack qty", "Cost ex GST", "Cost inc GST", "Markup %", "Sell price", "Estimate", "Active"],
      rows.map((e) => [e.id, e.manufacturer, e.name, e.supplier, e.sku, e.category, e.unit, e.packQuantity, dollars(e.costExGstCents), dollars(e.costIncGstCents),
        e.markupBp === null ? "" : e.markupBp / 100, dollars(e.sellPriceCents), e.isEstimate ? "yes" : "no", e.active ? "yes" : "no"])),
      `asto-equipment-${stamp()}.csv`, "text/csv");
  })
  .get("/quotes.csv", async (c) => {
    const rows = await listQuotes(c.var.db, { limit: 100000 });
    return download(toCsv(["Quote", "Revision", "Status", "Customer", "Site", "Title", "Issue date", "Expiry date", "Total"],
      rows.map((q) => [q.quoteNumber, q.revision, q.status, q.customerName, q.siteLabel, q.title, q.issueDate, q.expiryDate, dollars(q.totalCents)])),
      `asto-quotes-${stamp()}.csv`, "text/csv");
  });
