import { z } from "zod";
import { QUOTE_STATUSES } from "../shared/types";

// Bounds keep every intermediate calculation well inside JavaScript's safe-integer range.
const MAX_CENTS = 1_000_000_000; // $10M — totals, fixed prices, overrides
const MAX_UNIT_CENTS = 10_000_000; // $100k — a single purchase/sell price
const cents = z.number().int().min(0).max(MAX_CENTS);
const unitCents = z.number().int().min(0).max(MAX_UNIT_CENTS);
const signedCents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);
const bp = z.number().int().min(0).max(50_000); // 0–500%
const centi = z.number().int().min(0).max(1_000_000); // up to 10,000 units
const hours = z.number().int().min(0).max(100_000); // up to 1,000 hours
const rate = z.number().int().min(0).max(1_000_000); // up to $10,000/hour
const str = (max: number) => z.string().trim().max(max);
const optionalEmail = z.union([z.literal(""), z.string().trim().max(200).email()]);

export const settingsSchema = z.object({
  businessName: str(120).min(1),
  abn: str(20).regex(/^[0-9 ]*$/, "ABN may contain digits and spaces only"),
  email: optionalEmail,
  phone: str(40),
  address: str(300),
  website: str(200),
  logoDataUrl: z.string().max(400_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "Logo must be a PNG or JPEG image").nullable(),
  labourRateCents: rate,
  defaultMarkupBp: bp,
  gstRegistered: z.boolean(),
  gstRateBp: bp,
  quoteValidityDays: z.number().int().min(1).max(365),
  overheadBp: bp,
  warrantyBp: bp,
  ownerLabourCostCents: rate,
  minGrossMarginBp: bp,
  minSurplusCents: signedCents,
  depositTerms: str(2000),
  paymentTerms: str(4000),
  warrantyText: str(4000),
  acceptanceText: str(2000),
  standardInclusions: str(4000),
  standardExclusions: str(4000),
});

export const customerSchema = z.object({
  kind: z.enum(["individual", "business"]),
  name: str(160).min(1, "Name is required"),
  contactPerson: str(160).default(""),
  email: optionalEmail.default(""),
  phone: str(40).default(""),
  notes: str(4000).default(""),
  archived: z.boolean().default(false),
});

export const siteSchema = z.object({
  address: str(200).min(1, "Address is required"),
  suburb: str(80).default(""),
  state: z.enum(["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"]).default("QLD"),
  postcode: z.union([z.literal(""), z.string().regex(/^\d{4}$/, "Postcode must be 4 digits")]).default(""),
  notes: str(2000).default(""),
});

export const customerWithSiteSchema = customerSchema.extend({ site: siteSchema.optional() });

export const equipmentSchema = z.object({
  manufacturer: str(80).default(""),
  name: str(160).min(1, "Product name is required"),
  supplier: str(80).default(""),
  sku: str(80).default(""),
  category: str(60).min(1),
  kind: z.enum(["equipment", "material"]),
  unit: str(16).min(1),
  packQuantity: z.number().int().min(1).max(100_000),
  costExGstCents: unitCents,
  costIncGstCents: unitCents,
  markupBp: bp.nullable(),
  sellPriceCents: unitCents.nullable(),
  customerDescription: str(500).default(""),
  notes: str(2000).default(""),
  isEstimate: z.boolean(),
  active: z.boolean(),
}).refine((e) => e.costIncGstCents >= e.costExGstCents, { message: "Price including GST cannot be less than price excluding GST", path: ["costIncGstCents"] });

const itemRole = z.enum(["priced", "included"]);

export const packageSchema = z.object({
  name: str(120).min(1),
  description: str(1000).default(""),
  pricingMode: z.enum(["fixed", "calculated"]),
  fixedPriceCents: cents.nullable(),
  labourHoursCenti: hours,
  labourRateCents: rate.nullable(),
  markupBp: bp.nullable(),
  complexityBp: z.number().int().min(5000).max(30000),
  travelChargeCents: cents,
  travelCostCents: cents,
  consumablesCostCents: cents,
  scope: str(6000).default(""),
  inclusions: str(4000).default(""),
  exclusions: str(4000).default(""),
  notes: str(2000).default(""),
  active: z.boolean(),
  items: z.array(z.object({
    role: itemRole,
    equipmentId: z.number().int().positive().nullable(),
    description: str(300).default(""),
    quantityCenti: centi,
    inPackage: z.boolean(),
  })).max(200),
});

export const newQuoteSchema = z.object({
  customerId: z.number().int().positive(),
  siteId: z.number().int().positive().nullable(),
  packageId: z.number().int().positive().nullable(),
});

export const pricingSchema = z.object({
  mode: z.enum(["fixed", "calculated"]),
  fixedPriceCents: cents.nullable(),
  packageLabourHoursCenti: hours,
  labourHoursCenti: hours,
  labourRateCents: rate,
  complexityBp: z.number().int().min(5000).max(30000),
  markupBp: bp,
  travelChargeCents: cents,
  travelCostCents: cents,
  consumablesCostCents: cents,
  overheadBp: bp,
  warrantyBp: bp,
  ownerLabourCostCents: rate,
  gstRegistered: z.boolean(),
  gstRateBp: bp,
  priceOverrideCents: cents.nullable(),
  minGrossMarginBp: bp,
  minSurplusCents: signedCents,
  packageName: str(160).default(""),
});

export const quoteItemSchema = z.object({
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  role: itemRole,
  kind: z.enum(["equipment", "material"]),
  equipmentId: z.number().int().positive().nullable(),
  name: str(200).default(""),
  description: str(500).default(""),
  sku: str(80).default(""),
  supplier: str(80).default(""),
  unit: str(16).default("each"),
  quantityCenti: centi,
  packQuantity: z.number().int().min(1).max(100_000),
  costExGstCents: unitCents,
  costIncGstCents: unitCents,
  markupBp: bp.nullable(),
  sellUnitCents: unitCents.nullable(),
  inPackage: z.boolean(),
  isEstimate: z.boolean().default(false),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const saveRevisionSchema = z.object({
  customerId: z.number().int().positive(),
  siteId: z.number().int().positive().nullable(),
  title: str(200).default(""),
  packageId: z.number().int().positive().nullable(),
  issueDate: isoDate.nullable(),
  expiryDate: isoDate.nullable(),
  pricing: pricingSchema,
  items: z.array(quoteItemSchema).max(300),
  scope: str(8000).default(""),
  inclusions: str(4000).default(""),
  exclusions: str(4000).default(""),
  depositTerms: str(2000).default(""),
  paymentTerms: str(4000).default(""),
  warrantyText: str(4000).default(""),
  acceptanceText: str(2000).default(""),
  customerNotes: str(4000).default(""),
  internalNotes: str(4000).default(""),
});

export const statusSchema = z.object({ status: z.enum(QUOTE_STATUSES as [string, ...string[]]) });

export const idParam = z.coerce.number().int().positive();
