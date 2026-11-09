/**
 * ASTO Office database schema (Cloudflare D1 / SQLite).
 *
 * Conventions
 * - All money is stored as INTEGER cents (AUD). Never floats.
 * - Percentages are stored as INTEGER basis points (25% = 2500).
 * - Quantities and hours are stored as INTEGER hundredths (1.5 h = 150).
 * - Timestamps are ISO-8601 strings (UTC).
 *
 * Future modules (jobs, scheduling, invoicing, registers, staff accounts) are intended
 * to reference `customers`, `sites` and `quotes` by id; nothing here assumes a single user
 * other than `users`/`created_by` being optional.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { DEFAULT_SCOPE_ALARM, DEFAULT_SCOPE_CCTV, DEFAULT_SCOPE_MAINTENANCE } from "../../shared/terms";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
};

/** Single-row business settings (id is always 1). */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  businessName: text("business_name").notNull(),
  abn: text("abn").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  website: text("website").notNull().default(""),
  /** data: URL of a PNG or JPEG logo (kept small; validated server-side). */
  logoDataUrl: text("logo_data_url"),
  labourRateCents: integer("labour_rate_cents").notNull(),
  defaultMarkupBp: integer("default_markup_bp").notNull(),
  gstRegistered: integer("gst_registered", { mode: "boolean" }).notNull().default(false),
  gstRateBp: integer("gst_rate_bp").notNull().default(1000),
  quoteValidityDays: integer("quote_validity_days").notNull().default(30),
  overheadBp: integer("overhead_bp").notNull().default(0),
  warrantyBp: integer("warranty_bp").notNull().default(0),
  ownerLabourCostCents: integer("owner_labour_cost_cents").notNull().default(0),
  minGrossMarginBp: integer("min_gross_margin_bp").notNull().default(0),
  minSurplusCents: integer("min_surplus_cents").notNull().default(0),
  depositTerms: text("deposit_terms").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default(""),
  warrantyText: text("warranty_text").notNull().default(""),
  acceptanceText: text("acceptance_text").notNull().default(""),
  standardInclusions: text("standard_inclusions").notNull().default(""),
  standardExclusions: text("standard_exclusions").notNull().default(""),
  // Added in migration 0001 — reusable scope templates and structured warranty inputs.
  scopeTemplateCctv: text("scope_template_cctv").notNull().default(DEFAULT_SCOPE_CCTV),
  scopeTemplateAlarm: text("scope_template_alarm").notNull().default(DEFAULT_SCOPE_ALARM),
  scopeTemplateMaintenance: text("scope_template_maintenance").notNull().default(DEFAULT_SCOPE_MAINTENANCE),
  workmanshipWarrantyMonths: integer("workmanship_warranty_months").notNull().default(12),
  manufacturerWarrantyText: text("manufacturer_warranty_text").notNull().default(""),
  /** "" (not chosen), "business" or "customer". */
  claimExpensesPolicy: text("claim_expenses_policy", { enum: ["", "business", "customer"] }).notNull().default(""),
  updatedAt: timestamps.updatedAt,
});

/** Simple named counters (e.g. quotation numbers). */
export const sequences = sqliteTable("sequences", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
});

/** Reserved for multiple staff accounts later. Not used for authentication (Cloudflare Access does that). */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  role: text("role", { enum: ["admin", "staff"] }).notNull().default("admin"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["individual", "business"] }).notNull().default("individual"),
  name: text("name").notNull(),
  contactPerson: text("contact_person").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => [index("customers_name_idx").on(t.name)]);

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  address: text("address").notNull(),
  suburb: text("suburb").notNull().default(""),
  state: text("state").notNull().default("QLD"),
  postcode: text("postcode").notNull().default(""),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, (t) => [index("sites_customer_idx").on(t.customerId)]);

export const equipment = sqliteTable("equipment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  manufacturer: text("manufacturer").notNull().default(""),
  name: text("name").notNull(),
  supplier: text("supplier").notNull().default(""),
  sku: text("sku").notNull().default(""),
  category: text("category").notNull().default("Other"),
  /** "equipment" (hardware) or "material" (cable, connectors, sundries). */
  kind: text("kind", { enum: ["equipment", "material"] }).notNull().default("equipment"),
  /** Unit the item is used/sold in, e.g. "each" or "m". */
  unit: text("unit").notNull().default("each"),
  /** Number of units in one purchased pack (e.g. 305 for a 305 m cable box). */
  packQuantity: integer("pack_quantity").notNull().default(1),
  /** Purchase price for one pack, excluding GST. */
  costExGstCents: integer("cost_ex_gst_cents").notNull(),
  /** Purchase price for one pack, including GST (as invoiced). */
  costIncGstCents: integer("cost_inc_gst_cents").notNull(),
  /** Item-specific markup; null uses the business default. */
  markupBp: integer("markup_bp"),
  /** Optional fixed selling price per unit (GST-exclusive). Null = cost basis + markup. */
  sellPriceCents: integer("sell_price_cents"),
  /** Description shown to customers on quotations. */
  customerDescription: text("customer_description").notNull().default(""),
  notes: text("notes").notNull().default(""),
  /** True when the pricing has not been confirmed against a supplier invoice/price list. */
  isEstimate: integer("is_estimate", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (t) => [index("equipment_name_idx").on(t.name), index("equipment_sku_idx").on(t.sku)]);

export const packages = sqliteTable("packages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  pricingMode: text("pricing_mode", { enum: ["fixed", "calculated"] }).notNull().default("fixed"),
  fixedPriceCents: integer("fixed_price_cents"),
  labourHoursCenti: integer("labour_hours_centi").notNull().default(0),
  labourRateCents: integer("labour_rate_cents"),
  markupBp: integer("markup_bp"),
  complexityBp: integer("complexity_bp").notNull().default(10000),
  travelChargeCents: integer("travel_charge_cents").notNull().default(0),
  travelCostCents: integer("travel_cost_cents").notNull().default(0),
  consumablesCostCents: integer("consumables_cost_cents").notNull().default(0),
  scope: text("scope").notNull().default(""),
  inclusions: text("inclusions").notNull().default(""),
  exclusions: text("exclusions").notNull().default(""),
  notes: text("notes").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

/**
 * Package line templates.
 * role "priced": costed item (kit, cable, junction boxes, extras).
 * role "included": a component already inside a priced kit (e.g. the 4 cameras in a kit).
 *   Shown to the customer as "included" but carries NO cost or price, so nothing is double-counted.
 */
export const packageItems = sqliteTable("package_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  packageId: integer("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  role: text("role", { enum: ["priced", "included"] }).notNull().default("priced"),
  equipmentId: integer("equipment_id").references(() => equipment.id),
  description: text("description").notNull().default(""),
  quantityCenti: integer("quantity_centi").notNull().default(100),
  /** Part of the fixed package price (true) or charged on top (false). */
  inPackage: integer("in_package", { mode: "boolean" }).notNull().default(true),
}, (t) => [index("package_items_pkg_idx").on(t.packageId)]);

/** A quotation. Its content lives in immutable-once-issued revisions. */
export const quotes = sqliteTable("quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteNumber: text("quote_number").notNull(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  siteId: integer("site_id").references(() => sites.id),
  currentRevisionId: integer("current_revision_id"),
  duplicatedFromQuoteId: integer("duplicated_from_quote_id"),
  ...timestamps,
}, (t) => [uniqueIndex("quotes_number_idx").on(t.quoteNumber), index("quotes_customer_idx").on(t.customerId)]);

export const quoteRevisions = sqliteTable("quote_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteId: integer("quote_id").notNull().references(() => quotes.id),
  revision: integer("revision").notNull(),
  status: text("status", { enum: ["draft", "sent", "accepted", "declined", "expired"] }).notNull().default("draft"),
  /** True once issued (sent). Locked revisions can never be edited, only superseded. */
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  title: text("title").notNull().default(""),
  packageId: integer("package_id"),
  packageName: text("package_name").notNull().default(""),
  issueDate: text("issue_date"),
  expiryDate: text("expiry_date"),
  issuedAt: text("issued_at"),
  /** Full pricing inputs (labour, markup, travel, overheads, GST treatment, overrides). JSON. */
  pricing: text("pricing", { mode: "json" }).notNull(),
  /** Calculated totals saved with the revision. JSON. */
  totals: text("totals", { mode: "json" }).notNull(),
  scope: text("scope").notNull().default(""),
  inclusions: text("inclusions").notNull().default(""),
  exclusions: text("exclusions").notNull().default(""),
  depositTerms: text("deposit_terms").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default(""),
  warrantyText: text("warranty_text").notNull().default(""),
  acceptanceText: text("acceptance_text").notNull().default(""),
  customerNotes: text("customer_notes").notNull().default(""),
  internalNotes: text("internal_notes").notNull().default(""),
  /** Snapshot of business details + customer/site details, frozen when issued. JSON. */
  snapshot: text("snapshot", { mode: "json" }),
  ...timestamps,
}, (t) => [uniqueIndex("quote_revisions_idx").on(t.quoteId, t.revision)]);

export const quoteItems = sqliteTable("quote_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  revisionId: integer("revision_id").notNull().references(() => quoteRevisions.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  role: text("role", { enum: ["priced", "included"] }).notNull().default("priced"),
  kind: text("kind", { enum: ["equipment", "material"] }).notNull().default("equipment"),
  equipmentId: integer("equipment_id"),
  /** Internal name (manufacturer + product). */
  name: text("name").notNull().default(""),
  /** Customer-facing description. */
  description: text("description").notNull().default(""),
  sku: text("sku").notNull().default(""),
  supplier: text("supplier").notNull().default(""),
  unit: text("unit").notNull().default("each"),
  quantityCenti: integer("quantity_centi").notNull().default(100),
  packQuantity: integer("pack_quantity").notNull().default(1),
  costExGstCents: integer("cost_ex_gst_cents").notNull().default(0),
  costIncGstCents: integer("cost_inc_gst_cents").notNull().default(0),
  markupBp: integer("markup_bp"),
  sellUnitCents: integer("sell_unit_cents"),
  inPackage: integer("in_package", { mode: "boolean" }).notNull().default(false),
  isEstimate: integer("is_estimate", { mode: "boolean" }).notNull().default(false),
  /** Show the quantity on the customer quotation (false = "Included", e.g. cabling and consumables). */
  showQuantity: integer("show_quantity", { mode: "boolean" }).notNull().default(true),
}, (t) => [index("quote_items_rev_idx").on(t.revisionId)]);

/** Lightweight audit trail of important actions (status changes, settings changes, exports). */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: text("at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull().default(""),
  entityId: text("entity_id").notNull().default(""),
  detail: text("detail").notNull().default(""),
});
