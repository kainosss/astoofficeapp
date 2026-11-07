export { calculateRevision, equipmentToQuoteItem, includedItem } from "../shared/quoteBuilder";
import type { QuoteItem, RevisionPricing } from "../shared/types";

/** Editable revision content as returned by /api/quotes/template and saved by the builder. */
export interface NewRevisionContentShape {
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
