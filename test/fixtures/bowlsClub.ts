/**
 * Visual-regression fixture modelled on ASTO-Q-0003 (bowls club CCTV quotation).
 * Customer details are FICTIONAL; individual line prices are illustrative and chosen so the
 * customer total is exactly $4,286.00, matching the real quotation's total.
 */
import type { QuoteItem } from "../../src/shared/types";

const item = (o: Partial<QuoteItem> & Pick<QuoteItem, "description" | "quantityCenti" | "sellUnitCents" | "costIncGstCents">): QuoteItem => ({
  sortOrder: 0, role: "priced", kind: "equipment", equipmentId: null, name: o.description, sku: "", supplier: "", unit: "each",
  packQuantity: 1, costExGstCents: Math.round(o.costIncGstCents / 1.1), markupBp: null, inPackage: false, isEstimate: false, showQuantity: true, ...o,
});

export const BOWLS_CLUB_ITEMS: QuoteItem[] = [
  item({ description: "Dahua 6MP Smart Dual Light turret camera", name: "Dahua 6MP Smart Dual Light turret", sku: "FIXTURE-CAM-6MP", supplier: "Tradezone", quantityCenti: 600, costIncGstCents: 18920, sellUnitCents: 25000 }),
  item({ description: "Dahua 16-channel network video recorder with 4TB storage", name: "Dahua 16ch NVR 4TB", sku: "FIXTURE-NVR16", supplier: "Tradezone", quantityCenti: 100, costIncGstCents: 52800, sellUnitCents: 70000 }),
  item({ description: "21.5-inch monitor", name: "21.5in monitor", sku: "FIXTURE-MON", supplier: "Tradezone", quantityCenti: 100, costIncGstCents: 15400, sellUnitCents: 20000 }),
  item({ description: "Cat6 installation cabling", name: "Cat6 cable 305 m box", kind: "material", sku: "FIXTURE-CAT6", supplier: "Tradezone", quantityCenti: 200, costIncGstCents: 19250, sellUnitCents: 18500, showQuantity: false }),
  item({ description: "Ducting, connectors and installation consumables", name: "Sundries", kind: "material", quantityCenti: 100, costIncGstCents: 6000, sellUnitCents: 9600, showQuantity: false }),
].map((i, idx) => ({ ...i, sortOrder: idx }));

/** 6×250 + 700 + 200 + 2×185 + 96 = 2,866; + labour 10 h × $130 = 1,300; + travel $120 → $4,286.00 */
export const BOWLS_CLUB_TOTAL_CENTS = 428600;
export const BOWLS_CLUB_LABOUR_HOURS_CENTI = 1000;
export const BOWLS_CLUB_TRAVEL_CENTS = 12000;

export const BOWLS_CLUB_SETTINGS_PATCH = {
  businessName: "ASTO SECURITY",
  abn: "00 000 000 000",
  email: "office@example.com",
  phone: "0491 570 156",
  address: "10 Example Street, Brisbane QLD 4000",
  depositTerms: "Deposit: No deposit is required.",
  paymentTerms: "Payment: The total is payable within 14 days of completion of the installation, by bank transfer to the account shown on the invoice. Please use the quotation number as the payment reference.",
  manufacturerWarrantyText: "Equipment is covered by the applicable manufacturer's warranty. Warranty details for each product are available on request.",
  claimExpensesPolicy: "business" as const,
  workmanshipWarrantyMonths: 12,
};
