import { and, asc, eq, sql } from "drizzle-orm";
import { customerPriceLines, gstStatement } from "../../shared/pricing";
import {
  addDays, calculateRevision, formatQuoteNumber, itemsFromPackage, pricingFrom, quoteReference, splitLines, todayBrisbane,
} from "../../shared/quoteBuilder";
import { centiToInput } from "../../shared/money";
import type {
  Customer, CustomerQuote, QuoteDetail, QuoteItem, QuoteListRow, QuoteRevision, QuoteStatus, RevisionPricing, Settings, Site,
} from "../../shared/types";
import { nowIso, schema, type Db } from "../db/client";
import { getEquipmentMap, getPackage } from "./catalog";
import { getSettings } from "./settings";

export class HttpError extends Error {
  constructor(public status: 400 | 404 | 409 | 422, message: string) { super(message); }
}

type RevisionRow = typeof schema.quoteRevisions.$inferSelect;
type ItemRow = typeof schema.quoteItems.$inferSelect;

export interface Snapshot {
  business: CustomerQuote["business"];
  customer: CustomerQuote["customer"];
  site: CustomerQuote["site"];
  validityDays: number;
}

function toItem(r: ItemRow): QuoteItem {
  return {
    id: r.id, sortOrder: r.sortOrder, role: r.role, kind: r.kind, equipmentId: r.equipmentId, name: r.name,
    description: r.description, sku: r.sku, supplier: r.supplier, unit: r.unit, quantityCenti: r.quantityCenti,
    packQuantity: r.packQuantity, costExGstCents: r.costExGstCents, costIncGstCents: r.costIncGstCents, markupBp: r.markupBp,
    sellUnitCents: r.sellUnitCents, inPackage: r.inPackage, isEstimate: r.isEstimate, showQuantity: r.showQuantity,
  };
}

function itemValues(revisionId: number, items: QuoteItem[]) {
  return items.map((i, idx) => ({
    revisionId, sortOrder: idx, role: i.role, kind: i.kind, equipmentId: i.equipmentId, name: i.name,
    description: i.description, sku: i.sku, supplier: i.supplier, unit: i.unit, quantityCenti: i.quantityCenti,
    packQuantity: i.packQuantity,
    costExGstCents: i.role === "included" ? 0 : i.costExGstCents,
    costIncGstCents: i.role === "included" ? 0 : i.costIncGstCents,
    markupBp: i.markupBp, sellUnitCents: i.sellUnitCents, inPackage: i.role === "included" ? true : i.inPackage, isEstimate: i.isEstimate,
    showQuantity: i.showQuantity ?? true,
  }));
}

async function insertItems(db: Db, revisionId: number, items: QuoteItem[]) {
  const values = itemValues(revisionId, items);
  // D1 allows at most 100 bound parameters per statement: keep rows × columns under that.
  const columns = Object.keys(values[0] ?? {}).length || 1;
  const chunk = Math.max(1, Math.floor(100 / columns));
  for (let i = 0; i < values.length; i += chunk) await db.insert(schema.quoteItems).values(values.slice(i, i + chunk));
}

async function nextQuoteNumber(db: Db): Promise<string> {
  await db.insert(schema.sequences).values({ name: "quote", value: 0 }).onConflictDoNothing();
  const row = await db.update(schema.sequences).set({ value: sql`${schema.sequences.value} + 1` })
    .where(eq(schema.sequences.name, "quote")).returning({ value: schema.sequences.value }).get();
  return formatQuoteNumber(row.value);
}

async function getCustomer(db: Db, id: number): Promise<Customer> {
  const c = await db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
  if (!c) throw new HttpError(404, "Customer not found.");
  return c;
}

async function getSite(db: Db, id: number | null, customerId: number): Promise<Site | null> {
  if (id === null) return null;
  const s = await db.select().from(schema.sites).where(eq(schema.sites.id, id)).get();
  if (!s || s.customerId !== customerId) throw new HttpError(422, "The installation address does not belong to this customer.");
  return { id: s.id, customerId: s.customerId, address: s.address, suburb: s.suburb, state: s.state, postcode: s.postcode, notes: s.notes };
}

export function buildSnapshot(settings: Settings, customer: Customer, site: Site | null): Snapshot {
  return {
    business: {
      name: settings.businessName, abn: settings.abn, email: settings.email, phone: settings.phone,
      address: settings.address, website: settings.website, logoDataUrl: settings.logoDataUrl,
    },
    customer: { name: customer.name, contactPerson: customer.contactPerson, email: customer.email, phone: customer.phone },
    site: site ? { address: site.address, suburb: site.suburb, state: site.state, postcode: site.postcode } : null,
    validityDays: settings.quoteValidityDays,
  };
}

export interface NewRevisionContent {
  title: string;
  packageId: number | null;
  pricing: RevisionPricing;
  items: QuoteItem[];
  scope: string;
  inclusions: string;
  exclusions: string;
  depositTerms: string;
  paymentTerms: string;
  warrantyText: string;
  acceptanceText: string;
  customerNotes: string;
  internalNotes: string;
  issueDate?: string | null;
  expiryDate?: string | null;
}

async function insertRevision(db: Db, quoteId: number, revision: number, content: NewRevisionContent): Promise<number> {
  const totals = calculateRevision(content.items, content.pricing);
  const row = await db.insert(schema.quoteRevisions).values({
    quoteId, revision, status: "draft", locked: false, title: content.title, packageId: content.packageId,
    packageName: content.pricing.packageName, pricing: content.pricing, totals, scope: content.scope,
    inclusions: content.inclusions, exclusions: content.exclusions, depositTerms: content.depositTerms,
    paymentTerms: content.paymentTerms, warrantyText: content.warrantyText, acceptanceText: content.acceptanceText,
    customerNotes: content.customerNotes, internalNotes: content.internalNotes,
    issueDate: content.issueDate ?? null, expiryDate: content.expiryDate ?? null,
  }).returning({ id: schema.quoteRevisions.id }).get();
  await insertItems(db, row.id, content.items);
  await db.update(schema.quotes).set({ currentRevisionId: row.id, updatedAt: nowIso() }).where(eq(schema.quotes.id, quoteId));
  return row.id;
}

/** Initial content for a new quotation from current settings and an optional package. */
export async function initialContent(db: Db, packageId: number | null): Promise<NewRevisionContent> {
  const settings = await getSettings(db);
  const pkg = packageId ? await getPackage(db, packageId) : null;
  if (packageId && !pkg) throw new HttpError(404, "Package not found.");
  const items = pkg ? itemsFromPackage(pkg, await getEquipmentMap(db)) : [];
  return {
    title: pkg ? `${pkg.name} — supply and installation` : "Security system installation",
    packageId: pkg?.id ?? null,
    pricing: pricingFrom(settings, pkg),
    items,
    // Package wording first; otherwise the CCTV template for package-based quotes (editable per quote).
    scope: pkg?.scope?.trim() ? pkg.scope : pkg ? settings.scopeTemplateCctv : "",
    inclusions: pkg?.inclusions || settings.standardInclusions,
    exclusions: pkg?.exclusions || settings.standardExclusions,
    depositTerms: settings.depositTerms,
    paymentTerms: settings.paymentTerms,
    warrantyText: settings.warrantyText,
    acceptanceText: settings.acceptanceText,
    customerNotes: "",
    internalNotes: "",
  };
}

export async function createQuote(db: Db, input: { customerId: number; siteId: number | null; packageId: number | null }, content?: NewRevisionContent) {
  await getCustomer(db, input.customerId);
  await getSite(db, input.siteId, input.customerId);
  const body = content ?? await initialContent(db, input.packageId);
  const quoteNumber = await nextQuoteNumber(db);
  const quote = await db.insert(schema.quotes).values({ quoteNumber, customerId: input.customerId, siteId: input.siteId })
    .returning({ id: schema.quotes.id }).get();
  const revisionId = await insertRevision(db, quote.id, 1, body);
  return { id: quote.id, quoteNumber, revisionId };
}

function toRevision(r: RevisionRow, items: QuoteItem[]): QuoteRevision {
  return {
    id: r.id, quoteId: r.quoteId, revision: r.revision, status: r.status, locked: r.locked, title: r.title,
    packageId: r.packageId, packageName: r.packageName, issueDate: r.issueDate, expiryDate: r.expiryDate, issuedAt: r.issuedAt,
    pricing: r.pricing as RevisionPricing, totals: r.totals as QuoteRevision["totals"], scope: r.scope, inclusions: r.inclusions,
    exclusions: r.exclusions, depositTerms: r.depositTerms, paymentTerms: r.paymentTerms, warrantyText: r.warrantyText,
    acceptanceText: r.acceptanceText, customerNotes: r.customerNotes, internalNotes: r.internalNotes, items, updatedAt: r.updatedAt,
  };
}

async function loadQuote(db: Db, quoteId: number) {
  const quote = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId)).get();
  if (!quote) throw new HttpError(404, "Quotation not found.");
  const revisions = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.quoteId, quoteId))
    .orderBy(asc(schema.quoteRevisions.revision)).all();
  return { quote, revisions };
}

async function loadRevisionItems(db: Db, revisionId: number): Promise<QuoteItem[]> {
  const rows = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.revisionId, revisionId))
    .orderBy(asc(schema.quoteItems.sortOrder)).all();
  return rows.map(toItem);
}

export async function getQuoteDetail(db: Db, quoteId: number, revisionId?: number): Promise<QuoteDetail> {
  const { quote, revisions } = await loadQuote(db, quoteId);
  const latest = revisions[revisions.length - 1];
  const rev = revisionId ? revisions.find((r) => r.id === revisionId) : latest;
  if (!rev) throw new HttpError(404, "Revision not found.");
  const customer = await getCustomer(db, quote.customerId);
  const site = quote.siteId ? await getSite(db, quote.siteId, quote.customerId).catch(() => null) : null;
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    customer,
    site,
    revisions: revisions.map((r) => ({
      id: r.id, revision: r.revision, status: r.status, locked: r.locked, totalCents: (r.totals as { totalCents: number }).totalCents,
      issueDate: r.issueDate, issuedAt: r.issuedAt, updatedAt: r.updatedAt,
    })),
    revision: toRevision(rev, await loadRevisionItems(db, rev.id)),
    isLatest: rev.id === latest.id,
  };
}

export async function saveRevision(db: Db, quoteId: number, revisionId: number, body: NewRevisionContent & { customerId: number; siteId: number | null }) {
  const { revisions } = await loadQuote(db, quoteId);
  const rev = revisions.find((r) => r.id === revisionId);
  if (!rev) throw new HttpError(404, "Revision not found.");
  if (rev.locked || rev.status !== "draft")
    throw new HttpError(409, "This revision has been issued and cannot be changed. Create a new revision instead.");
  await getCustomer(db, body.customerId);
  await getSite(db, body.siteId, body.customerId);
  const totals = calculateRevision(body.items, body.pricing);
  await db.batch([
    db.update(schema.quotes).set({ customerId: body.customerId, siteId: body.siteId, updatedAt: nowIso() }).where(eq(schema.quotes.id, quoteId)),
    db.update(schema.quoteRevisions).set({
      title: body.title, packageId: body.packageId, packageName: body.pricing.packageName, pricing: body.pricing, totals,
      scope: body.scope, inclusions: body.inclusions, exclusions: body.exclusions, depositTerms: body.depositTerms,
      paymentTerms: body.paymentTerms, warrantyText: body.warrantyText, acceptanceText: body.acceptanceText,
      customerNotes: body.customerNotes, internalNotes: body.internalNotes, issueDate: body.issueDate ?? null,
      expiryDate: body.expiryDate ?? null, updatedAt: nowIso(),
    }).where(eq(schema.quoteRevisions.id, revisionId)),
    db.delete(schema.quoteItems).where(eq(schema.quoteItems.revisionId, revisionId)),
  ]);
  await insertItems(db, revisionId, body.items);
  return totals;
}

const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "declined", "expired"],
  accepted: ["sent", "declined", "expired"],
  declined: ["sent", "accepted", "expired"],
  expired: ["sent", "accepted", "declined"],
};

export async function setStatus(db: Db, quoteId: number, revisionId: number, status: QuoteStatus) {
  const { quote, revisions } = await loadQuote(db, quoteId);
  const latest = revisions[revisions.length - 1];
  const rev = revisions.find((r) => r.id === revisionId);
  if (!rev) throw new HttpError(404, "Revision not found.");
  if (rev.id !== latest.id) throw new HttpError(409, "Only the latest revision's status can be changed.");
  if (rev.status === status) return;
  if (!TRANSITIONS[rev.status].includes(status))
    throw new HttpError(409, `A ${rev.status} quotation cannot be changed to ${status}.`);

  if (rev.status === "draft" && status === "sent") {
    // Issue: freeze dates, business details, customer details and pricing.
    const settings = await getSettings(db);
    const customer = await getCustomer(db, quote.customerId);
    const site = await getSite(db, quote.siteId, quote.customerId);
    const items = await loadRevisionItems(db, rev.id);
    const issueDate = rev.issueDate ?? todayBrisbane();
    const expiryDate = rev.expiryDate ?? addDays(issueDate, settings.quoteValidityDays);
    const totals = calculateRevision(items, rev.pricing as RevisionPricing);
    await db.update(schema.quoteRevisions).set({
      status, locked: true, issueDate, expiryDate, issuedAt: nowIso(), totals,
      snapshot: buildSnapshot(settings, customer, site), updatedAt: nowIso(),
    }).where(eq(schema.quoteRevisions.id, rev.id));
  } else {
    await db.update(schema.quoteRevisions).set({ status, updatedAt: nowIso() }).where(eq(schema.quoteRevisions.id, rev.id));
  }
  await db.update(schema.quotes).set({ updatedAt: nowIso() }).where(eq(schema.quotes.id, quoteId));
}

function contentFrom(rev: QuoteRevision): NewRevisionContent {
  return {
    title: rev.title, packageId: rev.packageId, pricing: rev.pricing, items: rev.items.map(({ id: _id, ...i }) => i),
    scope: rev.scope, inclusions: rev.inclusions, exclusions: rev.exclusions, depositTerms: rev.depositTerms,
    paymentTerms: rev.paymentTerms, warrantyText: rev.warrantyText, acceptanceText: rev.acceptanceText,
    customerNotes: rev.customerNotes, internalNotes: rev.internalNotes,
  };
}

/** Start a new draft revision from the latest one. Issued revisions are never modified. */
export async function reviseQuote(db: Db, quoteId: number): Promise<number> {
  const detail = await getQuoteDetail(db, quoteId);
  if (detail.revision.status === "draft") return detail.revision.id;
  return insertRevision(db, quoteId, detail.revision.revision + 1, contentFrom(detail.revision));
}

export async function duplicateQuote(db: Db, quoteId: number, revisionId?: number) {
  const detail = await getQuoteDetail(db, quoteId, revisionId);
  const created = await createQuote(db, { customerId: detail.customer.id, siteId: detail.site?.id ?? null, packageId: null }, contentFrom(detail.revision));
  await db.update(schema.quotes).set({ duplicatedFromQuoteId: quoteId }).where(eq(schema.quotes.id, created.id));
  return created;
}

export async function deleteQuote(db: Db, quoteId: number) {
  const { revisions } = await loadQuote(db, quoteId);
  if (revisions.some((r) => r.locked)) throw new HttpError(409, "Issued quotations cannot be deleted. Mark them declined or expired instead.");
  const ids = revisions.map((r) => r.id);
  for (const id of ids) await db.delete(schema.quoteItems).where(eq(schema.quoteItems.revisionId, id));
  await db.batch([
    db.update(schema.quotes).set({ currentRevisionId: null }).where(eq(schema.quotes.id, quoteId)),
    db.delete(schema.quoteRevisions).where(eq(schema.quoteRevisions.quoteId, quoteId)),
    db.delete(schema.quotes).where(eq(schema.quotes.id, quoteId)),
  ]);
}

export async function listQuotes(db: Db, opts: { q?: string; status?: string; customerId?: number; limit?: number } = {}): Promise<QuoteListRow[]> {
  const conditions = [sql`1 = 1`];
  if (opts.status) conditions.push(sql`r.status = ${opts.status}`);
  if (opts.customerId) conditions.push(sql`q.customer_id = ${opts.customerId}`);
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_]/g, "")}%`;
    conditions.push(sql`(q.quote_number LIKE ${like} OR c.name LIKE ${like} OR r.title LIKE ${like} OR s.address LIKE ${like} OR s.suburb LIKE ${like})`);
  }
  const where = sql.join(conditions, sql` AND `);
  const rows = await db.all<{
    id: number; quote_number: string; customer_id: number; customer_name: string; address: string | null; suburb: string | null;
    title: string; revision: number; revision_count: number; status: QuoteStatus; total: number; issue_date: string | null;
    expiry_date: string | null; updated_at: string;
  }>(sql`
    SELECT q.id, q.quote_number, q.customer_id, c.name AS customer_name, s.address, s.suburb, r.title, r.revision,
      (SELECT COUNT(*) FROM quote_revisions rr WHERE rr.quote_id = q.id) AS revision_count,
      r.status, json_extract(r.totals, '$.totalCents') AS total, r.issue_date, r.expiry_date, q.updated_at
    FROM quotes q
    JOIN quote_revisions r ON r.id = q.current_revision_id
    JOIN customers c ON c.id = q.customer_id
    LEFT JOIN sites s ON s.id = q.site_id
    WHERE ${where}
    ORDER BY q.updated_at DESC
    LIMIT ${opts.limit ?? 500}`);
  return rows.map((r) => ({
    id: r.id, quoteNumber: r.quote_number, customerId: r.customer_id, customerName: r.customer_name,
    siteLabel: [r.address, r.suburb].filter(Boolean).join(", "), title: r.title, revision: r.revision,
    revisionCount: r.revision_count, status: r.status, totalCents: r.total ?? 0, issueDate: r.issue_date,
    expiryDate: r.expiry_date, updatedAt: r.updated_at,
  }));
}

/**
 * Build the customer-facing quotation. This is a strict whitelist: only fields meant for the
 * customer are copied. Costs, markups, overheads and profitability are never included.
 */
export async function getCustomerQuote(db: Db, quoteId: number, revisionId?: number): Promise<CustomerQuote> {
  const detail = await getQuoteDetail(db, quoteId, revisionId);
  const rev = detail.revision;
  const row = await db.select({ snapshot: schema.quoteRevisions.snapshot }).from(schema.quoteRevisions)
    .where(and(eq(schema.quoteRevisions.id, rev.id))).get();
  const snapshot = (rev.locked && row?.snapshot)
    ? row.snapshot as Snapshot
    : buildSnapshot(await getSettings(db), detail.customer, detail.site);
  const issueDate = rev.issueDate ?? todayBrisbane();
  const expiryDate = rev.expiryDate ?? addDays(issueDate, snapshot.validityDays);
  const totals = rev.totals;
  const mode = rev.pricing.mode;
  return {
    business: { ...snapshot.business },
    quoteNumber: detail.quoteNumber,
    revision: rev.revision,
    reference: quoteReference(detail.quoteNumber, rev.revision),
    title: rev.title,
    issueDate,
    expiryDate,
    isDraft: rev.status === "draft",
    status: rev.status,
    customer: { ...snapshot.customer },
    site: snapshot.site ? { ...snapshot.site } : null,
    packageName: rev.packageName,
    lines: rev.items.filter((i) => i.description.trim() || i.name.trim()).map((i) => ({
      description: i.description || i.name,
      quantity: centiToInput(i.quantityCenti),
      unit: i.unit,
      included: i.role === "included",
      extra: mode === "fixed" && i.role === "priced" && !i.inPackage,
      showQuantity: i.showQuantity,
    })),
    priceLines: customerPriceLines(totals, mode, rev.packageName),
    netCents: totals.netCents,
    gstCents: totals.gstCents,
    totalCents: totals.totalCents,
    gstRegistered: rev.pricing.gstRegistered,
    gstStatement: gstStatement(rev.pricing.gstRegistered, rev.pricing.gstRateBp, snapshot.business.name),
    scope: rev.scope,
    inclusions: splitLines(rev.inclusions),
    exclusions: splitLines(rev.exclusions),
    depositTerms: rev.depositTerms,
    paymentTerms: rev.paymentTerms,
    warrantyText: rev.warrantyText,
    acceptanceText: rev.acceptanceText,
    customerNotes: rev.customerNotes,
  };
}


