/** Helpers to initialise quotation revisions from business settings and CCTV packages. */
import { calculatePricing, type PricingItem } from "./pricing";
import { buildWarrantyText, DEFAULT_SCOPE_TEMPLATES, RECOMMENDED_CONDITIONS, type ScopeTemplateKey } from "./terms";
import type { Equipment, Package, QuoteItem, RevisionPricing, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  businessName: "ASTO SECURITY",
  abn: "",
  email: "",
  phone: "",
  address: "Brisbane, Queensland",
  website: "",
  logoDataUrl: null,
  labourRateCents: 13000,
  defaultMarkupBp: 2500,
  gstRegistered: false,
  gstRateBp: 1000,
  quoteValidityDays: 30,
  // Starting assumptions — review in Settings.
  overheadBp: 800,
  warrantyBp: 200,
  ownerLabourCostCents: 6000,
  minGrossMarginBp: 3500,
  minSurplusCents: 25000,
  depositTerms: "[Deposit terms to be confirmed — update in Settings.]",
  paymentTerms: "[Payment terms to be confirmed — update in Settings.]",
  warrantyText: buildWarrantyText({
    businessName: "ASTO SECURITY", email: "", phone: "", address: "Brisbane, Queensland",
    workmanshipWarrantyMonths: 12, manufacturerWarrantyText: "", claimExpensesPolicy: "",
  }),
  acceptanceText:
    "To accept this quotation, please sign below and return a copy, or confirm your acceptance in writing by email, before the expiry date.",
  standardInclusions: [
    "Supply of the equipment listed in this quotation",
    "Installation, configuration and testing of the listed equipment",
    "Remote viewing app set up on the customer's mobile device",
    "Basic operating walkthrough on completion",
    "Removal of installation packaging and offcuts",
  ].join("\n"),
  standardExclusions: [
    "Work not described in the scope of works",
    "Electrical work requiring a licensed electrician (e.g. new power points)",
    "Patching, painting or making good beyond minor touch-ups",
    "Internet connection, modem or customer network faults",
    "Concealed cabling where roof or wall access is not available",
    ...RECOMMENDED_CONDITIONS,
  ].join("\n"),
  scopeTemplateCctv: DEFAULT_SCOPE_TEMPLATES.cctv,
  scopeTemplateAlarm: DEFAULT_SCOPE_TEMPLATES.alarm,
  scopeTemplateMaintenance: DEFAULT_SCOPE_TEMPLATES.maintenance,
  workmanshipWarrantyMonths: 12,
  manufacturerWarrantyText: "",
  claimExpensesPolicy: "",
};

export function scopeTemplate(settings: Settings, key: ScopeTemplateKey): string {
  return key === "alarm" ? settings.scopeTemplateAlarm : key === "maintenance" ? settings.scopeTemplateMaintenance : settings.scopeTemplateCctv;
}

/** Customer-facing product description without a repeated manufacturer name ("Dahua Dahua …"). */
export function productLabel(manufacturer: string, name: string): string {
  const m = manufacturer.trim();
  const n = name.trim();
  if (!m) return n;
  return n.toLowerCase().startsWith(m.toLowerCase()) ? n : `${m} ${n}`;
}

export function equipmentToQuoteItem(e: Equipment, overrides: Partial<QuoteItem> = {}): QuoteItem {
  return {
    sortOrder: 0,
    role: "priced",
    kind: e.kind,
    equipmentId: e.id,
    name: productLabel(e.manufacturer, e.name),
    description: e.customerDescription || productLabel(e.manufacturer, e.name),
    sku: e.sku,
    supplier: e.supplier,
    unit: e.unit,
    quantityCenti: 100,
    packQuantity: e.packQuantity,
    costExGstCents: e.costExGstCents,
    costIncGstCents: e.costIncGstCents,
    markupBp: e.markupBp,
    sellUnitCents: e.sellPriceCents,
    inPackage: false,
    isEstimate: e.isEstimate,
    showQuantity: true,
    ...overrides,
  };
}

export function includedItem(description: string, quantityCenti: number, sortOrder = 0): QuoteItem {
  return {
    sortOrder, role: "included", kind: "equipment", equipmentId: null, name: description, description,
    sku: "", supplier: "", unit: "each", quantityCenti, packQuantity: 1, costExGstCents: 0, costIncGstCents: 0,
    markupBp: null, sellUnitCents: null, inPackage: true, isEstimate: false, showQuantity: true,
  };
}

/** Line items for a new revision based on a package. Missing/inactive equipment is skipped. */
export function itemsFromPackage(pkg: Package, equipmentById: Map<number, Equipment>): QuoteItem[] {
  const out: QuoteItem[] = [];
  [...pkg.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((pi) => {
    if (pi.role === "included") {
      out.push(includedItem(pi.description, pi.quantityCenti));
      return;
    }
    const e = pi.equipmentId ? equipmentById.get(pi.equipmentId) : undefined;
    if (!e) return;
    out.push(equipmentToQuoteItem(e, {
      quantityCenti: pi.quantityCenti,
      inPackage: pkg.pricingMode === "fixed" ? pi.inPackage : false,
      ...(pi.description ? { description: pi.description } : {}),
    }));
  });
  return out.map((i, idx) => ({ ...i, sortOrder: idx }));
}

/** Pricing inputs for a new revision: settings defaults, overridden by the package. */
export function pricingFrom(settings: Settings, pkg: Package | null): RevisionPricing {
  return {
    mode: pkg?.pricingMode ?? "calculated",
    fixedPriceCents: pkg?.pricingMode === "fixed" ? pkg.fixedPriceCents : null,
    packageLabourHoursCenti: pkg?.pricingMode === "fixed" ? pkg.labourHoursCenti : 0,
    labourHoursCenti: pkg?.labourHoursCenti ?? 0,
    labourRateCents: pkg?.labourRateCents ?? settings.labourRateCents,
    complexityBp: pkg?.complexityBp ?? 10000,
    markupBp: pkg?.markupBp ?? settings.defaultMarkupBp,
    travelChargeCents: pkg?.travelChargeCents ?? 0,
    travelCostCents: pkg?.travelCostCents ?? 0,
    consumablesCostCents: pkg?.consumablesCostCents ?? 0,
    overheadBp: settings.overheadBp,
    warrantyBp: settings.warrantyBp,
    ownerLabourCostCents: settings.ownerLabourCostCents,
    gstRegistered: settings.gstRegistered,
    gstRateBp: settings.gstRateBp,
    priceOverrideCents: null,
    minGrossMarginBp: settings.minGrossMarginBp,
    minSurplusCents: settings.minSurplusCents,
    packageName: pkg?.name ?? "",
  };
}

export function toPricingItems(items: QuoteItem[]): PricingItem[] {
  return items.map((i) => ({
    role: i.role, kind: i.kind, quantityCenti: i.quantityCenti, packQuantity: i.packQuantity,
    costExGstCents: i.costExGstCents, costIncGstCents: i.costIncGstCents, markupBp: i.markupBp,
    sellUnitCents: i.sellUnitCents, inPackage: i.inPackage,
  }));
}

export function calculateRevision(items: QuoteItem[], pricing: RevisionPricing) {
  return calculatePricing(toPricingItems(items), pricing);
}

/** Format a quotation number from a sequence value: 1 -> ASTO-Q-0001. */
export function formatQuoteNumber(n: number): string {
  return `ASTO-Q-${String(n).padStart(4, "0")}`;
}

export function quoteReference(quoteNumber: string, revision: number): string {
  return revision > 1 ? `${quoteNumber} Rev ${revision}` : quoteNumber;
}

/** YYYY-MM-DD in Brisbane time (AEST, UTC+10, no daylight saving). */
export function todayBrisbane(now = new Date()): string {
  return new Date(now.getTime() + 10 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
}
