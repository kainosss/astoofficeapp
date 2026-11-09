/** API data shapes shared by the Worker and the React client. Money = integer cents. */
import type { ItemKind, ItemRole, PricingInputs, PricingMode, PricingResult, PriceLine } from "./pricing";
import type { ClaimExpensesPolicy } from "./terms";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired";
export const QUOTE_STATUSES: QuoteStatus[] = ["draft", "sent", "accepted", "declined", "expired"];

export interface Settings {
  businessName: string;
  abn: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  logoDataUrl: string | null;
  labourRateCents: number;
  defaultMarkupBp: number;
  gstRegistered: boolean;
  gstRateBp: number;
  quoteValidityDays: number;
  overheadBp: number;
  warrantyBp: number;
  ownerLabourCostCents: number;
  minGrossMarginBp: number;
  minSurplusCents: number;
  depositTerms: string;
  paymentTerms: string;
  warrantyText: string;
  acceptanceText: string;
  standardInclusions: string;
  standardExclusions: string;
  scopeTemplateCctv: string;
  scopeTemplateAlarm: string;
  scopeTemplateMaintenance: string;
  workmanshipWarrantyMonths: number;
  manufacturerWarrantyText: string;
  claimExpensesPolicy: ClaimExpensesPolicy;
  updatedAt?: string;
}

export interface Customer {
  id: number;
  kind: "individual" | "business";
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Site {
  id: number;
  customerId: number;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  notes: string;
}

export interface CustomerListRow extends Customer { siteCount: number; quoteCount: number; primarySite: string }

export interface Equipment {
  id: number;
  manufacturer: string;
  name: string;
  supplier: string;
  sku: string;
  category: string;
  kind: ItemKind;
  unit: string;
  packQuantity: number;
  costExGstCents: number;
  costIncGstCents: number;
  markupBp: number | null;
  sellPriceCents: number | null;
  customerDescription: string;
  notes: string;
  isEstimate: boolean;
  active: boolean;
  updatedAt?: string;
}

export interface PackageItem {
  id?: number;
  sortOrder: number;
  role: ItemRole;
  equipmentId: number | null;
  description: string;
  quantityCenti: number;
  inPackage: boolean;
  equipment?: Equipment | null;
}

export interface Package {
  id: number;
  name: string;
  description: string;
  pricingMode: PricingMode;
  fixedPriceCents: number | null;
  labourHoursCenti: number;
  labourRateCents: number | null;
  markupBp: number | null;
  complexityBp: number;
  travelChargeCents: number;
  travelCostCents: number;
  consumablesCostCents: number;
  scope: string;
  inclusions: string;
  exclusions: string;
  notes: string;
  active: boolean;
  items: PackageItem[];
}

export interface QuoteItem {
  id?: number;
  sortOrder: number;
  role: ItemRole;
  kind: ItemKind;
  equipmentId: number | null;
  name: string;
  description: string;
  sku: string;
  supplier: string;
  unit: string;
  quantityCenti: number;
  packQuantity: number;
  costExGstCents: number;
  costIncGstCents: number;
  markupBp: number | null;
  sellUnitCents: number | null;
  inPackage: boolean;
  isEstimate: boolean;
  /** Show the quantity on the customer quotation; false shows "Included" (e.g. cabling, consumables). */
  showQuantity: boolean;
}

/** Stored pricing inputs for a revision (everything except line items). */
export type RevisionPricing = PricingInputs & { packageName: string };

export interface RevisionSummary {
  id: number;
  revision: number;
  status: QuoteStatus;
  locked: boolean;
  totalCents: number;
  issueDate: string | null;
  issuedAt: string | null;
  updatedAt: string;
}

export interface QuoteRevision {
  id: number;
  quoteId: number;
  revision: number;
  status: QuoteStatus;
  locked: boolean;
  title: string;
  packageId: number | null;
  packageName: string;
  issueDate: string | null;
  expiryDate: string | null;
  issuedAt: string | null;
  pricing: RevisionPricing;
  totals: PricingResult;
  scope: string;
  inclusions: string;
  exclusions: string;
  depositTerms: string;
  paymentTerms: string;
  warrantyText: string;
  acceptanceText: string;
  customerNotes: string;
  internalNotes: string;
  items: QuoteItem[];
  updatedAt: string;
}

export interface QuoteDetail {
  id: number;
  quoteNumber: string;
  customer: Customer;
  site: Site | null;
  revisions: RevisionSummary[];
  revision: QuoteRevision;
  isLatest: boolean;
}

export interface QuoteListRow {
  id: number;
  quoteNumber: string;
  customerId: number;
  customerName: string;
  siteLabel: string;
  title: string;
  revision: number;
  revisionCount: number;
  status: QuoteStatus;
  totalCents: number;
  issueDate: string | null;
  expiryDate: string | null;
  updatedAt: string;
}

export interface DashboardData {
  totalQuotes: number;
  byStatus: Record<QuoteStatus, number>;
  outstandingValueCents: number;
  outstandingCount: number;
  acceptedValueCents: number;
  expiringSoon: number;
  recent: QuoteListRow[];
  customerCount: number;
}

/**
 * Customer-facing quotation. This is the ONLY shape used for previews and PDFs.
 * It must never contain purchase costs, markup, overheads, warranty allowances or profitability.
 */
export interface CustomerQuote {
  business: { name: string; abn: string; email: string; phone: string; address: string; website: string; logoDataUrl: string | null };
  quoteNumber: string;
  revision: number;
  reference: string;
  title: string;
  issueDate: string;
  expiryDate: string;
  isDraft: boolean;
  status: QuoteStatus;
  /** 2 = short warranty summary + separate Warranty Statement; 1 = legacy issued quotes with the full warranty inline. */
  documentFormat: 1 | 2;
  customer: { name: string; contactPerson: string; email: string; phone: string };
  site: { address: string; suburb: string; state: string; postcode: string } | null;
  packageName: string;
  lines: { description: string; quantity: string; unit: string; included: boolean; extra: boolean; showQuantity: boolean }[];
  priceLines: PriceLine[];
  netCents: number;
  gstCents: number;
  totalCents: number;
  gstRegistered: boolean;
  gstStatement: string;
  scope: string;
  inclusions: string[];
  exclusions: string[];
  depositTerms: string;
  paymentTerms: string;
  warrantyText: string;
  acceptanceText: string;
  customerNotes: string;
}

export interface ApiError { error: string; details?: unknown }
