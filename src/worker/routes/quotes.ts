import { Hono } from "hono";
import type { QuoteStatus } from "../../shared/types";
import { renderQuotePdf } from "../pdf/quotePdf";
import {
  createQuote, deleteQuote, duplicateQuote, getCustomerQuote, getQuoteDetail, initialContent, listQuotes, reviseQuote, saveRevision, setStatus,
} from "../services/quotes";
import { audit } from "../services/settings";
import type { AppEnv } from "../types";
import { newQuoteSchema, saveRevisionSchema, statusSchema } from "../validation";
import { parseId, validate } from "./util";

export const quoteRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listQuotes(c.var.db, { q: c.req.query("q")?.trim(), status: c.req.query("status") || undefined })))
  .post("/", validate("json", newQuoteSchema), async (c) => {
    const created = await createQuote(c.var.db, c.req.valid("json"));
    await audit(c.var.db, c.var.user.email, "quote.create", "quote", created.id, created.quoteNumber);
    return c.json(created, 201);
  })
  /** Template content (from settings + package) — used by the builder's "apply package" action. */
  .get("/template", async (c) => {
    const pkg = c.req.query("packageId");
    return c.json(await initialContent(c.var.db, pkg ? parseId(pkg) : null));
  })
  .get("/:id", async (c) => {
    const rev = c.req.query("revisionId");
    return c.json(await getQuoteDetail(c.var.db, parseId(c.req.param("id")), rev ? parseId(rev) : undefined));
  })
  .delete("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    await deleteQuote(c.var.db, id);
    await audit(c.var.db, c.var.user.email, "quote.delete", "quote", id);
    return c.json({ ok: true });
  })
  .put("/:id/revisions/:revisionId", validate("json", saveRevisionSchema), async (c) => {
    const totals = await saveRevision(c.var.db, parseId(c.req.param("id")), parseId(c.req.param("revisionId")), c.req.valid("json"));
    return c.json({ ok: true, totals });
  })
  .post("/:id/revisions/:revisionId/status", validate("json", statusSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const revisionId = parseId(c.req.param("revisionId"));
    const { status } = c.req.valid("json");
    await setStatus(c.var.db, id, revisionId, status as QuoteStatus);
    await audit(c.var.db, c.var.user.email, "quote.status", "quote_revision", revisionId, status);
    return c.json({ ok: true });
  })
  .post("/:id/revise", async (c) => {
    const id = parseId(c.req.param("id"));
    const revisionId = await reviseQuote(c.var.db, id);
    await audit(c.var.db, c.var.user.email, "quote.revise", "quote", id, String(revisionId));
    return c.json({ revisionId }, 201);
  })
  .post("/:id/duplicate", async (c) => {
    const id = parseId(c.req.param("id"));
    const rev = c.req.query("revisionId");
    const created = await duplicateQuote(c.var.db, id, rev ? parseId(rev) : undefined);
    await audit(c.var.db, c.var.user.email, "quote.duplicate", "quote", created.id, `from ${id}`);
    return c.json(created, 201);
  })
  /** Customer-facing view: whitelisted fields only (no costs, markup or profitability). */
  .get("/:id/revisions/:revisionId/customer", async (c) =>
    c.json(await getCustomerQuote(c.var.db, parseId(c.req.param("id")), parseId(c.req.param("revisionId")))))
  .get("/:id/revisions/:revisionId/pdf", async (c) => {
    const cq = await getCustomerQuote(c.var.db, parseId(c.req.param("id")), parseId(c.req.param("revisionId")));
    const bytes = await renderQuotePdf(cq);
    const filename = `${cq.reference.replace(/\s+/g, "-")}${cq.isDraft ? "-DRAFT" : ""}.pdf`;
    const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
    return new Response(bytes as unknown as BodyInit, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  });
