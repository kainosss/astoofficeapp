/**
 * ASTO Office pricing engine — pure, deterministic, integer-cent arithmetic.
 *
 * Purchase-cost basis
 * - Not GST-registered (current): GST paid to suppliers cannot be claimed back, so the
 *   GST-INCLUSIVE purchase price is the real cost. No GST is charged to the customer.
 * - GST-registered (future): GST paid on eligible purchases is assumed claimable as an input
 *   tax credit, so the GST-EXCLUSIVE purchase price is the cost basis, and GST is added to
 *   the customer price.
 *
 * Owner labour
 * - ASTO is a sole trader. Labour charged to the customer is revenue, not a cost.
 *   "Contribution" is what remains for the owner before their own labour and personal tax.
 *   A notional owner labour cost is then deducted to show a "surplus" — this is a
 *   management figure only and is NOT a deductible employee wage.
 *
 * Overheads and warranty allowances are internal allocations (a % of the net selling price)
 * used for profitability reporting. They are not shown to customers or added to the price.
 */
import { applyBp, ratioBp, roundDiv } from "./money";

export type ItemRole = "priced" | "included";
export type ItemKind = "equipment" | "material";
export type PricingMode = "fixed" | "calculated";

export interface PricingItem {
  role: ItemRole;
  kind: ItemKind;
  /** Quantity used, in hundredths of `unit` (e.g. 100 m = 10000). */
  quantityCenti: number;
  /** Units per purchased pack (305 for a 305 m box). */
  packQuantity: number;
  /** Purchase price per pack, excluding GST. */
  costExGstCents: number;
  /** Purchase price per pack, including GST. */
  costIncGstCents: number;
  /** Item markup override; null = quote default. */
  markupBp: number | null;
  /** Fixed selling price per unit (GST-exclusive); null = cost basis + markup. */
  sellUnitCents: number | null;
  /** In fixed-price mode, true when the item is covered by the package price. */
  inPackage: boolean;
}

export interface PricingInputs {
  mode: PricingMode;
  /** Package selling price (GST-exclusive) used in fixed mode. */
  fixedPriceCents: number | null;
  /** Labour hours (hundredths) covered by the fixed package price. */
  packageLabourHoursCenti: number;
  labourHoursCenti: number;
  labourRateCents: number;
  /** Installation complexity multiplier on labour hours, in bp (10000 = ×1.00). */
  complexityBp: number;
  markupBp: number;
  travelChargeCents: number;
  travelCostCents: number;
  consumablesCostCents: number;
  overheadBp: number;
  warrantyBp: number;
  /** Notional owner labour cost per hour (management figure, not a wage). */
  ownerLabourCostCents: number;
  gstRegistered: boolean;
  gstRateBp: number;
  /** Final customer price override (total payable, i.e. GST-inclusive when registered). */
  priceOverrideCents: number | null;
  minGrossMarginBp: number;
  minSurplusCents: number;
}

export interface ItemResult {
  costCents: number;
  sellCents: number;
  /** GST component contained in the purchase price of this line. */
  purchaseGstCents: number;
}

export interface PricingResult {
  items: ItemResult[];
  costBasis: "inc-gst" | "ex-gst";
  effectiveLabourHoursCenti: number;
  // Purchase costs
  equipmentCostCents: number;
  materialCostCents: number;
  consumablesCostCents: number;
  travelCostCents: number;
  directCostCents: number;
  purchaseGstCents: number;
  /** Input tax credits assumed claimable (registered only). */
  inputTaxCreditCents: number;
  // Selling prices (GST-exclusive)
  equipmentSellCents: number;
  materialSellCents: number;
  consumablesSellCents: number;
  labourSellCents: number;
  travelSellCents: number;
  packageSellCents: number;
  extrasSellCents: number;
  extraLabourSellCents: number;
  extraLabourHoursCenti: number;
  calculatedNetCents: number;
  /** Difference between the override and the calculated price (negative = discount). */
  adjustmentCents: number;
  netCents: number;
  gstCents: number;
  totalCents: number;
  // Internal profitability
  overheadAllowanceCents: number;
  warrantyAllowanceCents: number;
  grossProfitCents: number;
  contributionCents: number;
  ownerLabourNotionalCents: number;
  surplusCents: number;
  markupBp: number | null;
  grossMarginBp: number | null;
  contributionMarginBp: number | null;
  warnings: string[];
}

function lineCost(item: PricingItem, registered: boolean): { cost: number; gst: number } {
  if (item.role === "included") return { cost: 0, gst: 0 };
  const pack = Math.max(1, item.packQuantity);
  const inc = roundDiv(item.costIncGstCents * item.quantityCenti, 100 * pack);
  const ex = roundDiv(item.costExGstCents * item.quantityCenti, 100 * pack);
  return { cost: registered ? ex : inc, gst: inc - ex };
}

function lineSell(item: PricingItem, cost: number, defaultMarkupBp: number): number {
  if (item.role === "included") return 0;
  if (item.sellUnitCents !== null) return roundDiv(item.sellUnitCents * item.quantityCenti, 100);
  const markup = item.markupBp ?? defaultMarkupBp;
  return roundDiv(cost * (10000 + markup), 10000);
}

export function calculatePricing(items: PricingItem[], p: PricingInputs): PricingResult {
  const registered = p.gstRegistered;
  const itemResults: ItemResult[] = items.map((item) => {
    const { cost, gst } = lineCost(item, registered);
    return { costCents: cost, sellCents: lineSell(item, cost, p.markupBp), purchaseGstCents: gst };
  });

  let equipmentCost = 0, materialCost = 0, equipmentSell = 0, materialSell = 0, purchaseGst = 0, extrasSell = 0;
  items.forEach((item, i) => {
    const r = itemResults[i];
    purchaseGst += r.purchaseGstCents;
    if (item.kind === "material") { materialCost += r.costCents; materialSell += r.sellCents; }
    else { equipmentCost += r.costCents; equipmentSell += r.sellCents; }
    if (!item.inPackage) extrasSell += r.sellCents;
  });

  const effectiveHours = roundDiv(p.labourHoursCenti * p.complexityBp, 10000);
  const consumablesSell = applyBp(p.consumablesCostCents, 10000 + p.markupBp);
  const labourSell = roundDiv(effectiveHours * p.labourRateCents, 100);
  const travelSell = p.travelChargeCents;

  let packageSell = 0, extraLabourHours = 0, extraLabourSell = 0, calculatedNet: number;
  if (p.mode === "fixed") {
    packageSell = p.fixedPriceCents ?? 0;
    extraLabourHours = Math.max(0, effectiveHours - p.packageLabourHoursCenti);
    extraLabourSell = roundDiv(extraLabourHours * p.labourRateCents, 100);
    calculatedNet = packageSell + extrasSell + extraLabourSell + travelSell;
  } else {
    extrasSell = 0;
    calculatedNet = equipmentSell + materialSell + consumablesSell + labourSell + travelSell;
  }

  let net: number, gst: number, total: number;
  if (p.priceOverrideCents !== null) {
    total = p.priceOverrideCents;
    net = registered ? roundDiv(total * 10000, 10000 + p.gstRateBp) : total;
    gst = total - net;
  } else {
    net = calculatedNet;
    gst = registered ? applyBp(net, p.gstRateBp) : 0;
    total = net + gst;
  }

  const directCost = equipmentCost + materialCost + p.consumablesCostCents + p.travelCostCents;
  const overhead = applyBp(net, p.overheadBp);
  const warranty = applyBp(net, p.warrantyBp);
  const grossProfit = net - directCost;
  const contribution = grossProfit - overhead - warranty;
  const ownerLabour = roundDiv(effectiveHours * p.ownerLabourCostCents, 100);
  const surplus = contribution - ownerLabour;
  const grossMarginBp = ratioBp(grossProfit, net);

  const warnings: string[] = [];
  if (net <= 0) warnings.push("The selling price is zero or negative.");
  if (grossMarginBp !== null && grossMarginBp < p.minGrossMarginBp)
    warnings.push(`Gross margin is below the ${(p.minGrossMarginBp / 100).toFixed(2).replace(/\.00$/, "")}% threshold.`);
  if (surplus < p.minSurplusCents) warnings.push("Surplus after notional owner labour is below the minimum threshold.");
  if (surplus < 0) warnings.push("This quotation does not cover costs and notional owner labour.");
  if (p.mode === "fixed" && p.fixedPriceCents === null) warnings.push("Fixed pricing is selected but no package price is set.");

  return {
    items: itemResults,
    costBasis: registered ? "ex-gst" : "inc-gst",
    effectiveLabourHoursCenti: effectiveHours,
    equipmentCostCents: equipmentCost,
    materialCostCents: materialCost,
    consumablesCostCents: p.consumablesCostCents,
    travelCostCents: p.travelCostCents,
    directCostCents: directCost,
    purchaseGstCents: purchaseGst,
    inputTaxCreditCents: registered ? purchaseGst : 0,
    equipmentSellCents: equipmentSell,
    materialSellCents: materialSell,
    consumablesSellCents: p.mode === "calculated" ? consumablesSell : 0,
    labourSellCents: p.mode === "calculated" ? labourSell : 0,
    travelSellCents: travelSell,
    packageSellCents: packageSell,
    extrasSellCents: extrasSell,
    extraLabourSellCents: extraLabourSell,
    extraLabourHoursCenti: extraLabourHours,
    calculatedNetCents: calculatedNet,
    adjustmentCents: net - calculatedNet,
    netCents: net,
    gstCents: gst,
    totalCents: total,
    overheadAllowanceCents: overhead,
    warrantyAllowanceCents: warranty,
    grossProfitCents: grossProfit,
    contributionCents: contribution,
    ownerLabourNotionalCents: ownerLabour,
    surplusCents: surplus,
    markupBp: ratioBp(grossProfit, directCost),
    grossMarginBp,
    contributionMarginBp: ratioBp(contribution, net),
    warnings,
  };
}

/** Customer-facing price breakdown lines. Contains selling prices only — never costs. */
export interface PriceLine { label: string; amountCents: number }

export function customerPriceLines(r: PricingResult, mode: PricingMode, packageName: string): PriceLine[] {
  const lines: PriceLine[] = [];
  if (mode === "fixed") {
    lines.push({ label: `${packageName || "Package"} — supply and installation`, amountCents: r.packageSellCents });
    if (r.extrasSellCents) lines.push({ label: "Additional equipment and materials", amountCents: r.extrasSellCents });
    if (r.extraLabourSellCents) lines.push({ label: "Additional installation labour", amountCents: r.extraLabourSellCents });
  } else {
    if (r.equipmentSellCents) lines.push({ label: "Equipment", amountCents: r.equipmentSellCents });
    const materials = r.materialSellCents + r.consumablesSellCents;
    if (materials) lines.push({ label: "Cabling, materials and consumables", amountCents: materials });
    if (r.labourSellCents) lines.push({ label: "Installation and configuration labour", amountCents: r.labourSellCents });
  }
  if (r.travelSellCents) lines.push({ label: "Travel", amountCents: r.travelSellCents });
  if (r.adjustmentCents) lines.push({ label: r.adjustmentCents < 0 ? "Discount" : "Price adjustment", amountCents: r.adjustmentCents });
  return lines;
}

/** The single customer-facing GST statement for a quotation. */
export function gstStatement(registered: boolean, gstRateBp: number, businessName = "ASTO SECURITY"): string {
  if (!registered) return `${businessName} is not registered for GST. No GST has been charged on this quotation.`;
  return `The total payable includes GST at ${gstRateBp / 100}%. Line amounts are shown excluding GST.`;
}
