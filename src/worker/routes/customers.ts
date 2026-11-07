import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { nowIso, schema } from "../db/client";
import { HttpError, listQuotes } from "../services/quotes";
import type { AppEnv } from "../types";
import { customerSchema, customerWithSiteSchema, siteSchema } from "../validation";
import { parseId, validate } from "./util";

export const customerRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const q = (c.req.query("q") || "").trim().replace(/[%_]/g, "");
    const includeArchived = c.req.query("archived") === "1";
    const like = `%${q}%`;
    const rows = await c.var.db.all<Record<string, unknown>>(sql`
      SELECT c.*,
        (SELECT COUNT(*) FROM sites s WHERE s.customer_id = c.id) AS site_count,
        (SELECT COUNT(*) FROM quotes q WHERE q.customer_id = c.id) AS quote_count,
        (SELECT s.address || ', ' || s.suburb FROM sites s WHERE s.customer_id = c.id ORDER BY s.id LIMIT 1) AS primary_site
      FROM customers c
      WHERE (${includeArchived ? 1 : 0} = 1 OR c.archived = 0)
        AND (${q} = '' OR c.name LIKE ${like} OR c.contact_person LIKE ${like} OR c.email LIKE ${like} OR c.phone LIKE ${like}
          OR EXISTS (SELECT 1 FROM sites s WHERE s.customer_id = c.id AND (s.address LIKE ${like} OR s.suburb LIKE ${like} OR s.postcode LIKE ${like})))
      ORDER BY c.name COLLATE NOCASE
      LIMIT 500`);
    return c.json(rows.map((r) => ({
      id: r.id, kind: r.kind, name: r.name, contactPerson: r.contact_person, email: r.email, phone: r.phone, notes: r.notes,
      archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at, siteCount: r.site_count, quoteCount: r.quote_count,
      primarySite: r.primary_site ?? "",
    })));
  })
  .post("/", validate("json", customerWithSiteSchema), async (c) => {
    const { site, ...customer } = c.req.valid("json");
    const row = await c.var.db.insert(schema.customers).values(customer).returning({ id: schema.customers.id }).get();
    let siteId: number | null = null;
    if (site) siteId = (await c.var.db.insert(schema.sites).values({ ...site, customerId: row.id }).returning({ id: schema.sites.id }).get()).id;
    return c.json({ id: row.id, siteId }, 201);
  })
  .get("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const customer = await c.var.db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
    if (!customer) throw new HttpError(404, "Customer not found.");
    const sites = await c.var.db.select().from(schema.sites).where(eq(schema.sites.customerId, id)).orderBy(asc(schema.sites.id)).all();
    const quotes = await listQuotes(c.var.db, { customerId: id });
    return c.json({ customer, sites, quotes });
  })
  .put("/:id", validate("json", customerSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const res = await c.var.db.update(schema.customers).set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(schema.customers.id, id)).returning({ id: schema.customers.id }).get();
    if (!res) throw new HttpError(404, "Customer not found.");
    return c.json({ id });
  })
  .post("/:id/sites", validate("json", siteSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const exists = await c.var.db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, id)).get();
    if (!exists) throw new HttpError(404, "Customer not found.");
    const row = await c.var.db.insert(schema.sites).values({ ...c.req.valid("json"), customerId: id }).returning({ id: schema.sites.id }).get();
    return c.json({ id: row.id }, 201);
  })
  .put("/:id/sites/:siteId", validate("json", siteSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const siteId = parseId(c.req.param("siteId"));
    const res = await c.var.db.update(schema.sites).set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(and(eq(schema.sites.id, siteId), eq(schema.sites.customerId, id))).returning({ id: schema.sites.id }).get();
    if (!res) throw new HttpError(404, "Site not found.");
    return c.json({ id: siteId });
  })
  .delete("/:id/sites/:siteId", async (c) => {
    const id = parseId(c.req.param("id"));
    const siteId = parseId(c.req.param("siteId"));
    const used = await c.var.db.select({ id: schema.quotes.id }).from(schema.quotes).where(eq(schema.quotes.siteId, siteId)).get();
    if (used) throw new HttpError(409, "This address is used by a quotation and cannot be deleted.");
    await c.var.db.delete(schema.sites).where(and(eq(schema.sites.id, siteId), eq(schema.sites.customerId, id)));
    return c.json({ ok: true });
  });
