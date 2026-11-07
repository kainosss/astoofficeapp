/**
 * Development seed data. Customers are FICTIONAL (example.com emails, ACMA-reserved
 * fictional phone numbers 0491 570 xxx / 07 5550 xxxx). Equipment prices marked
 * `isEstimate` are placeholders that must be confirmed against supplier pricing.
 */
import { addDays, calculateRevision, DEFAULT_SETTINGS, formatQuoteNumber, itemsFromPackage, pricingFrom, todayBrisbane } from "../../shared/quoteBuilder";
import type { Equipment, Package, QuoteItem, Settings } from "../../shared/types";

type SeedEquipment = Omit<Equipment, "updatedAt">;

export const SEED_EQUIPMENT: SeedEquipment[] = [
  {
    id: 1, manufacturer: "Dahua", name: "6MP CCTV Kit", supplier: "Tradezone", sku: "NVR4108-4T-3667K", category: "CCTV kits",
    kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 109480, costIncGstCents: 120428, markupBp: null, sellPriceCents: null,
    customerDescription: "Dahua 6MP four-camera CCTV kit with eight-channel network video recorder and 4TB storage",
    notes: "Confirmed Tradezone pricing. Kit contents per ASTO package: 4 × 6MP cameras, 8-channel NVR, 4TB storage.", isEstimate: false, active: true,
  },
  {
    id: 2, manufacturer: "Dahua", name: "8MP CCTV Kit", supplier: "Tradezone", sku: "NVR4108-4T-3867KIT", category: "CCTV kits",
    kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 122000, costIncGstCents: 134200, markupBp: null, sellPriceCents: null,
    customerDescription: "Dahua 8MP (4K) four-camera CCTV kit with eight-channel network video recorder and 4TB storage",
    notes: "Confirmed Tradezone pricing. Kit contents per ASTO package: 4 × 8MP cameras, 8-channel NVR, 4TB storage.", isEstimate: false, active: true,
  },
  {
    id: 3, manufacturer: "", name: "Security cable — 305 m box", supplier: "", sku: "", category: "Cable",
    kind: "material", unit: "m", packQuantity: 305, costExGstCents: 17500, costIncGstCents: 19250, markupBp: null, sellPriceCents: null,
    customerDescription: "Security network cabling", notes: "Confirmed box price. Costed per metre consumed (box price ÷ 305 m). Supplier/SKU to be recorded.",
    isEstimate: false, active: true,
  },
  {
    id: 4, manufacturer: "", name: "Camera junction box", supplier: "Tradezone", sku: "", category: "Mounting",
    kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 1800, costIncGstCents: 1980, markupBp: null, sellPriceCents: null,
    customerDescription: "Weatherproof camera junction box", notes: "ESTIMATE — confirm model and price with supplier.", isEstimate: true, active: true,
  },
  {
    id: 5, manufacturer: "Dahua", name: "Additional 6MP turret camera", supplier: "Tradezone", sku: "", category: "Cameras",
    kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 16000, costIncGstCents: 17600, markupBp: null, sellPriceCents: null,
    customerDescription: "Additional Dahua 6MP turret camera", notes: "ESTIMATE — confirm model and price with supplier.", isEstimate: true, active: true,
  },
  {
    id: 6, manufacturer: "Dahua", name: "Additional 8MP (4K) turret camera", supplier: "Tradezone", sku: "", category: "Cameras",
    kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 20000, costIncGstCents: 22000, markupBp: null, sellPriceCents: null,
    customerDescription: "Additional Dahua 8MP (4K) turret camera", notes: "ESTIMATE — confirm model and price with supplier.", isEstimate: true, active: true,
  },
  {
    id: 7, manufacturer: "", name: "RJ45 connectors — pack of 100", supplier: "Tradezone", sku: "", category: "Connectors",
    kind: "material", unit: "each", packQuantity: 100, costExGstCents: 2500, costIncGstCents: 2750, markupBp: null, sellPriceCents: null,
    customerDescription: "RJ45 network connectors", notes: "ESTIMATE — confirm with supplier. Costed per connector.", isEstimate: true, active: true,
  },
  {
    id: 8, manufacturer: "", name: "Surveillance hard drive 4TB", supplier: "Tradezone", sku: "", category: "Storage",
    kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 16000, costIncGstCents: 17600, markupBp: null, sellPriceCents: null,
    customerDescription: "Additional 4TB surveillance-rated hard drive", notes: "ESTIMATE — confirm model and price with supplier.", isEstimate: true, active: true,
  },
  {
    id: 9, manufacturer: "", name: "8-port PoE network switch", supplier: "Tradezone", sku: "", category: "Networking",
    kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 12000, costIncGstCents: 13200, markupBp: null, sellPriceCents: null,
    customerDescription: "8-port PoE network switch", notes: "ESTIMATE — confirm model and price with supplier.", isEstimate: true, active: true,
  },
];

const eqMap = new Map<number, Equipment>(SEED_EQUIPMENT.map((e) => [e.id, e]));

const PACKAGE_SCOPE_6MP =
  "Supply and install a four-camera Dahua 6MP CCTV system with an eight-channel network video recorder (NVR) and 4TB of storage. " +
  "Mount cameras at the agreed locations, run cabling to the recorder location, configure continuous recording, " +
  "set up remote viewing on the customer's mobile device and provide a walkthrough of the system on completion.";
const PACKAGE_SCOPE_4K = PACKAGE_SCOPE_6MP.replace("6MP", "8MP (4K)");

function pkg(id: number, name: string, kitId: number, cameraDesc: string, priceCents: number, scope: string, description: string): Package {
  return {
    id, name, description, pricingMode: "fixed", fixedPriceCents: priceCents, labourHoursCenti: 600, labourRateCents: null,
    markupBp: null, complexityBp: 10000, travelChargeCents: 0, travelCostCents: 0, consumablesCostCents: 4000, scope,
    inclusions: "", exclusions: "", notes: "Cable length, junction boxes and consumables are starting estimates — adjust per site.", active: true,
    items: [
      { sortOrder: 0, role: "priced", equipmentId: kitId, description: "", quantityCenti: 100, inPackage: true },
      { sortOrder: 1, role: "included", equipmentId: null, description: cameraDesc, quantityCenti: 400, inPackage: true },
      { sortOrder: 2, role: "included", equipmentId: null, description: "Eight-channel network video recorder (NVR)", quantityCenti: 100, inPackage: true },
      { sortOrder: 3, role: "included", equipmentId: null, description: "4TB surveillance hard drive (installed in NVR)", quantityCenti: 100, inPackage: true },
      { sortOrder: 4, role: "priced", equipmentId: 3, description: "", quantityCenti: 10000, inPackage: true },
      { sortOrder: 5, role: "priced", equipmentId: 4, description: "", quantityCenti: 400, inPackage: true },
    ],
  };
}

export const SEED_PACKAGES: Package[] = [
  pkg(1, "ASTO Home CCTV 6MP", 1, "Dahua 6MP fixed turret camera", 279000, PACKAGE_SCOPE_6MP,
    "Four 6MP cameras, eight-channel NVR, 4TB storage. Six hours standard installation."),
  pkg(2, "ASTO Home CCTV 4K", 2, "Dahua 8MP (4K) fixed turret camera", 299000, PACKAGE_SCOPE_4K,
    "Four 8MP (4K) cameras, eight-channel NVR, 4TB storage. Six hours standard installation."),
];

export const SEED_CUSTOMERS = [
  { id: 1, kind: "individual", name: "Jordan and Priya Whitfield", contactPerson: "Jordan Whitfield", email: "jordan.whitfield@example.com", phone: "0491 570 156", notes: "Prefers contact after 4pm. Two dogs on site." },
  { id: 2, kind: "business", name: "Riverbend Physiotherapy Pty Ltd", contactPerson: "Mia Thornton", email: "practice.manager@example.com", phone: "07 5550 1234", notes: "Clinic open Mon–Sat. Install outside clinic hours." },
  { id: 3, kind: "individual", name: "Daniel Okafor", contactPerson: "", email: "d.okafor@example.com", phone: "0491 570 110", notes: "Owner-occupier plus one rental property." },
  { id: 4, kind: "business", name: "Harbourline Storage Co", contactPerson: "Sam Reyes", email: "ops@example.com", phone: "07 5550 9876", notes: "Site induction required before work." },
] as const;

export const SEED_SITES = [
  { id: 1, customerId: 1, address: "14 Banksia Crescent", suburb: "Carindale", state: "QLD", postcode: "4152", notes: "Two-storey. Roof access via garage manhole." },
  { id: 2, customerId: 2, address: "Shop 3, 220 Logan Road", suburb: "Stones Corner", state: "QLD", postcode: "4120", notes: "Ceiling space shared with neighbouring tenancy." },
  { id: 3, customerId: 3, address: "7 Ironbark Street", suburb: "The Gap", state: "QLD", postcode: "4061", notes: "" },
  { id: 4, customerId: 3, address: "22 Coral Place", suburb: "Wynnum", state: "QLD", postcode: "4178", notes: "Tenanted — arrange access through the property manager." },
  { id: 5, customerId: 4, address: "Unit 9, 41 Export Street", suburb: "Lytton", state: "QLD", postcode: "4178", notes: "Warehouse, 7 m ceiling. EWP may be required." },
] as const;

// ---------- SQL generation ----------
const q = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return q(JSON.stringify(v));
  return `'${String(v).replace(/'/g, "''")}'`;
};
const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const insert = (table: string, row: Record<string, unknown>) =>
  `INSERT INTO ${table} (${Object.keys(row).map(snake).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`;

interface SampleQuote {
  id: number; customerId: number; siteId: number; packageId: number | null; status: "draft" | "sent" | "accepted";
  daysAgo: number; extras?: { equipmentId: number; quantityCenti: number }[]; customize?: (items: QuoteItem[]) => void;
  labourHoursCenti?: number; travelChargeCents?: number; travelCostCents?: number;
}

const SAMPLE_QUOTES: SampleQuote[] = [
  { id: 1, customerId: 1, siteId: 1, packageId: 1, status: "sent", daysAgo: 5 },
  { id: 2, customerId: 2, siteId: 2, packageId: 2, status: "draft", daysAgo: 1, extras: [{ equipmentId: 6, quantityCenti: 200 }], labourHoursCenti: 800, travelChargeCents: 4500, travelCostCents: 1800 },
  { id: 3, customerId: 3, siteId: 3, packageId: 1, status: "accepted", daysAgo: 20 },
];

export function seedSql(settings: Settings = DEFAULT_SETTINGS, now = new Date()): string[] {
  const out: string[] = [];
  out.push(insert("settings", { id: 1, ...settings }));
  for (const e of SEED_EQUIPMENT) out.push(insert("equipment", { ...e }));
  for (const p of SEED_PACKAGES) {
    const { items, ...rest } = p;
    out.push(insert("packages", rest));
    items.forEach((i) => out.push(insert("package_items", { packageId: p.id, ...i })));
  }
  for (const c of SEED_CUSTOMERS) out.push(insert("customers", { ...c }));
  for (const s of SEED_SITES) out.push(insert("sites", { ...s }));

  const today = todayBrisbane(now);
  let itemId = 1;
  for (const sq of SAMPLE_QUOTES) {
    const p = SEED_PACKAGES.find((x) => x.id === sq.packageId) ?? null;
    const items = p ? itemsFromPackage(p, eqMap) : [];
    for (const ex of sq.extras ?? []) {
      const e = eqMap.get(ex.equipmentId)!;
      items.push({ ...itemsFromPackage({ ...SEED_PACKAGES[0], items: [{ sortOrder: 0, role: "priced", equipmentId: e.id, description: "", quantityCenti: ex.quantityCenti, inPackage: false }] }, eqMap)[0], inPackage: false, sortOrder: items.length });
    }
    const pricing = pricingFrom(settings, p);
    if (sq.labourHoursCenti) pricing.labourHoursCenti = sq.labourHoursCenti;
    if (sq.travelChargeCents) pricing.travelChargeCents = sq.travelChargeCents;
    if (sq.travelCostCents) pricing.travelCostCents = sq.travelCostCents;
    const totals = calculateRevision(items, pricing);
    const issued = sq.status !== "draft";
    const issueDate = issued ? addDays(today, -sq.daysAgo) : null;
    const customer = SEED_CUSTOMERS.find((c) => c.id === sq.customerId)!;
    const site = SEED_SITES.find((s) => s.id === sq.siteId)!;
    const snapshot = issued ? {
      business: { name: settings.businessName, abn: settings.abn, email: settings.email, phone: settings.phone, address: settings.address, website: settings.website, logoDataUrl: settings.logoDataUrl },
      customer: { name: customer.name, contactPerson: customer.contactPerson, email: customer.email, phone: customer.phone },
      site: { address: site.address, suburb: site.suburb, state: site.state, postcode: site.postcode },
      validityDays: settings.quoteValidityDays,
    } : null;
    out.push(insert("quotes", { id: sq.id, quoteNumber: formatQuoteNumber(sq.id), customerId: sq.customerId, siteId: sq.siteId, currentRevisionId: sq.id }));
    out.push(insert("quote_revisions", {
      id: sq.id, quoteId: sq.id, revision: 1, status: sq.status, locked: issued, title: p ? `${p.name} — supply and installation` : "Security system installation",
      packageId: p?.id ?? null, packageName: p?.name ?? "", issueDate, expiryDate: issueDate ? addDays(issueDate, settings.quoteValidityDays) : null,
      issuedAt: issued ? `${issueDate}T00:00:00.000Z` : null, pricing, totals, scope: p?.scope ?? "",
      inclusions: settings.standardInclusions, exclusions: settings.standardExclusions, depositTerms: settings.depositTerms,
      paymentTerms: settings.paymentTerms, warrantyText: settings.warrantyText, acceptanceText: settings.acceptanceText,
      customerNotes: "", internalNotes: "Sample quotation (fictional customer).", snapshot,
    }));
    items.forEach((i, idx) => {
      const { id: _id, ...rest } = i;
      out.push(insert("quote_items", { id: itemId++, revisionId: sq.id, ...rest, sortOrder: idx }));
    });
  }
  out.push(insert("sequences", { name: "quote", value: SAMPLE_QUOTES.length }));
  return out;
}
