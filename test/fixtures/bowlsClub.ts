/**
 * Visual-regression fixture modelled on ASTO-Q-0003 (bowls club CCTV quotation).
 * Customer details are FICTIONAL. Category totals (equipment, materials, labour) match the real
 * quotation; the split of each category across its lines is illustrative.
 */
import type { QuoteItem } from "../../src/shared/types";

const item = (o: Partial<QuoteItem> & Pick<QuoteItem, "description" | "quantityCenti" | "sellUnitCents" | "costIncGstCents">): QuoteItem => ({
  sortOrder: 0, role: "priced", kind: "equipment", equipmentId: null, name: o.description, sku: "", supplier: "", unit: "each",
  packQuantity: 1, costExGstCents: Math.round(o.costIncGstCents / 1.1), markupBp: null, inPackage: false, isEstimate: false, showQuantity: true, ...o,
});

export const BOWLS_CLUB_ITEMS: QuoteItem[] = [
  item({ description: "Dahua 6MP Smart Dual Light turret camera", name: "Dahua 6MP Smart Dual Light turret", sku: "FIXTURE-CAM-6MP", supplier: "Tradezone", quantityCenti: 600, costIncGstCents: 18920, sellUnitCents: 25900 }),
  item({ description: "Dahua 16-channel network video recorder with 4TB storage", name: "Dahua 16ch NVR 4TB", sku: "FIXTURE-NVR16", supplier: "Tradezone", quantityCenti: 100, costIncGstCents: 52800, sellUnitCents: 70000 }),
  item({ description: "21.5-inch monitor", name: "21.5in monitor", sku: "FIXTURE-MON", supplier: "Tradezone", quantityCenti: 100, costIncGstCents: 15400, sellUnitCents: 20000 }),
  item({ description: "Cat6 installation cabling", name: "Cat6 cable 305 m box", kind: "material", sku: "FIXTURE-CAT6", supplier: "Tradezone", quantityCenti: 200, costIncGstCents: 16500, sellUnitCents: 18500, showQuantity: false }),
  item({ description: "Ducting, connectors and installation consumables", name: "Sundries", kind: "material", quantityCenti: 100, costIncGstCents: 6000, sellUnitCents: 11000, showQuantity: false }),
].map((i, idx) => ({ ...i, sortOrder: idx }));

/**
 * Category breakdown of the real quotation:
 *   Equipment  6 × $259 + $700 + $200        = $2,454.00
 *   Materials  2 × $185 + $110               =   $480.00
 *   Labour     10.4 h × $130                 = $1,352.00
 *   Total (no travel, no GST)                = $4,286.00
 */
export const BOWLS_CLUB_TOTAL_CENTS = 428600;
export const BOWLS_CLUB_EQUIPMENT_CENTS = 245400;
export const BOWLS_CLUB_MATERIALS_CENTS = 48000;
export const BOWLS_CLUB_LABOUR_CENTS = 135200;
export const BOWLS_CLUB_LABOUR_HOURS_CENTI = 1040;
export const BOWLS_CLUB_TRAVEL_CENTS = 0;

export const BOWLS_CLUB_SETTINGS_PATCH = {
  businessName: "ASTO SECURITY",
  abn: "00 000 000 000",
  email: "office@example.com",
  phone: "0491 570 156",
  address: "10 Example Street, Brisbane QLD 4000",
  depositTerms: "Deposit: No deposit is required.",
  paymentTerms: "Payment: Payment is due within 14 calendar days of the invoice date.",
  manufacturerWarrantyText: "Equipment is covered by the applicable manufacturer's warranty. Warranty details for each product are available on request.",
  claimExpensesPolicy: "business" as const,
  workmanshipWarrantyMonths: 12,
};
