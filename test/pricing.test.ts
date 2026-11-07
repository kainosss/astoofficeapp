import { describe, expect, it } from "vitest";
import { applyBp, formatAud, ratioBp, roundDiv, toCents, centiToInput } from "../src/shared/money";
import { calculatePricing, customerPriceLines, gstStatement, type PricingInputs, type PricingItem } from "../src/shared/pricing";

const kit6mp: PricingItem = { role: "priced", kind: "equipment", quantityCenti: 100, packQuantity: 1, costExGstCents: 109480, costIncGstCents: 120428, markupBp: null, sellUnitCents: null, inPackage: true };
const cameras: PricingItem = { role: "included", kind: "equipment", quantityCenti: 400, packQuantity: 1, costExGstCents: 99999, costIncGstCents: 99999, markupBp: null, sellUnitCents: null, inPackage: true };
const cable100m: PricingItem = { role: "priced", kind: "material", quantityCenti: 10000, packQuantity: 305, costExGstCents: 17500, costIncGstCents: 19250, markupBp: null, sellUnitCents: null, inPackage: true };
const junctionBoxes: PricingItem = { role: "priced", kind: "equipment", quantityCenti: 400, packQuantity: 1, costExGstCents: 1800, costIncGstCents: 1980, markupBp: null, sellUnitCents: null, inPackage: true };

const base: PricingInputs = {
  mode: "fixed", fixedPriceCents: 279000, packageLabourHoursCenti: 600, labourHoursCenti: 600, labourRateCents: 13000,
  complexityBp: 10000, markupBp: 2500, travelChargeCents: 0, travelCostCents: 0, consumablesCostCents: 4000,
  overheadBp: 800, warrantyBp: 200, ownerLabourCostCents: 6000, gstRegistered: false, gstRateBp: 1000,
  priceOverrideCents: null, minGrossMarginBp: 3500, minSurplusCents: 25000,
};
const items = [kit6mp, cameras, cable100m, junctionBoxes];

describe("money helpers", () => {
  it("rounds half away from zero", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(5, 3)).toBe(2);
    expect(roundDiv(0, 7)).toBe(0);
    expect(roundDiv(-1, 3)).toBe(0);
    expect(Object.is(roundDiv(-1, 3), -0)).toBe(false);
  });
  it("rejects non-integers", () => {
    expect(() => roundDiv(1.5, 2)).toThrow();
  });
  it("parses dollar strings without float error", () => {
    expect(toCents("1,204.28")).toBe(120428);
    expect(toCents("$2790")).toBe(279000);
    expect(toCents("0.1")).toBe(10);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1094.8)).toBe(109480);
    expect(toCents("-12.5")).toBe(-1250);
    expect(() => toCents("12.345")).toThrow();
    expect(() => toCents("abc")).toThrow();
  });
  it("formats AUD", () => {
    expect(formatAud(279000)).toBe("$2,790.00");
    expect(formatAud(-1250)).toBe("-$12.50");
    expect(formatAud(5)).toBe("$0.05");
    expect(formatAud(123456789)).toBe("$1,234,567.89");
  });
  it("handles percentages and ratios", () => {
    expect(applyBp(120428, 12500)).toBe(150535);
    expect(applyBp(6311, 12500)).toBe(7889); // 7888.75 rounds up
    expect(ratioBp(1, 3)).toBe(3333);
    expect(ratioBp(1, 0)).toBeNull();
    expect(centiToInput(600)).toBe("6");
    expect(centiToInput(125)).toBe("1.25");
    expect(centiToInput(150)).toBe("1.5");
  });
});

describe("pricing engine — not GST registered (current)", () => {
  const r = calculatePricing(items, base);

  it("uses GST-inclusive purchase prices as the cost basis", () => {
    expect(r.costBasis).toBe("inc-gst");
    expect(r.items[0].costCents).toBe(120428);
  });
  it("calculates cable by metres consumed from a 305 m box", () => {
    // $192.50 × 100 / 305 = $63.1147…
    expect(r.items[2].costCents).toBe(6311);
  });
  it("never costs or prices components already included in a kit", () => {
    expect(r.items[1]).toEqual({ costCents: 0, sellCents: 0, purchaseGstCents: 0 });
  });
  it("totals costs", () => {
    expect(r.equipmentCostCents).toBe(120428 + 7920);
    expect(r.materialCostCents).toBe(6311);
    expect(r.directCostCents).toBe(128348 + 6311 + 4000);
  });
  it("charges the fixed package price with no GST", () => {
    expect(r.netCents).toBe(279000);
    expect(r.gstCents).toBe(0);
    expect(r.totalCents).toBe(279000);
    expect(r.adjustmentCents).toBe(0);
  });
  it("calculates profitability", () => {
    expect(r.overheadAllowanceCents).toBe(22320);
    expect(r.warrantyAllowanceCents).toBe(5580);
    expect(r.grossProfitCents).toBe(279000 - 138659);
    expect(r.contributionCents).toBe(140341 - 22320 - 5580);
    expect(r.ownerLabourNotionalCents).toBe(36000);
    expect(r.surplusCents).toBe(112441 - 36000);
    expect(r.grossMarginBp).toBe(5030);
    expect(r.markupBp).toBe(10121);
    expect(r.warnings).toEqual([]);
  });
  it("produces customer price lines that sum to the net price", () => {
    const lines = customerPriceLines(r, "fixed", "ASTO Home CCTV 6MP");
    expect(lines).toEqual([{ label: "ASTO Home CCTV 6MP — supply and installation", amountCents: 279000 }]);
  });
  it("states that no GST is charged", () => {
    expect(gstStatement(false, 1000)).toContain("not registered for GST");
  });
});

describe("pricing engine — calculated mode", () => {
  const r = calculatePricing(items, { ...base, mode: "calculated" });
  it("applies markup to each priced line", () => {
    expect(r.equipmentSellCents).toBe(150535 + 9900);
    expect(r.materialSellCents).toBe(7889);
    expect(r.consumablesSellCents).toBe(5000);
    expect(r.labourSellCents).toBe(78000);
    expect(r.netCents).toBe(150535 + 9900 + 7889 + 5000 + 78000);
  });
  it("customer lines sum to net", () => {
    const sum = customerPriceLines(r, "calculated", "").reduce((a, l) => a + l.amountCents, 0);
    expect(sum).toBe(r.netCents);
  });
  it("respects per-item markup and fixed per-unit sell prices", () => {
    const r2 = calculatePricing(
      [{ ...kit6mp, markupBp: 1000 }, { ...cable100m, sellUnitCents: 150 }],
      { ...base, mode: "calculated", consumablesCostCents: 0, labourHoursCenti: 0 },
    );
    expect(r2.items[0].sellCents).toBe(132471); // 120428 × 1.10 = 132470.8
    expect(r2.items[1].sellCents).toBe(15000); // 100 m × $1.50
  });
  it("applies installation complexity to labour", () => {
    const r3 = calculatePricing(items, { ...base, mode: "calculated", complexityBp: 12500 });
    expect(r3.effectiveLabourHoursCenti).toBe(750);
    expect(r3.labourSellCents).toBe(97500);
  });
});

describe("pricing engine — fixed package extras", () => {
  it("charges extras and extra labour on top of the package without double counting", () => {
    const extraCamera: PricingItem = { ...kit6mp, costExGstCents: 15000, costIncGstCents: 16500, inPackage: false };
    const r = calculatePricing([...items, extraCamera], { ...base, labourHoursCenti: 750, travelChargeCents: 5000 });
    expect(r.extrasSellCents).toBe(20625); // 16500 × 1.25
    expect(r.extraLabourHoursCenti).toBe(150);
    expect(r.extraLabourSellCents).toBe(19500);
    expect(r.netCents).toBe(279000 + 20625 + 19500 + 5000);
    const lines = customerPriceLines(r, "fixed", "Pkg");
    expect(lines.reduce((a, l) => a + l.amountCents, 0)).toBe(r.netCents);
  });
});

describe("pricing engine — price override", () => {
  it("keeps internal costs accurate when the final price is overridden", () => {
    const r = calculatePricing(items, { ...base, priceOverrideCents: 250000 });
    expect(r.netCents).toBe(250000);
    expect(r.calculatedNetCents).toBe(279000);
    expect(r.adjustmentCents).toBe(-29000);
    expect(r.directCostCents).toBe(138659);
    expect(r.grossProfitCents).toBe(250000 - 138659);
    const lines = customerPriceLines(r, "fixed", "Pkg");
    expect(lines.at(-1)).toEqual({ label: "Discount", amountCents: -29000 });
    expect(lines.reduce((a, l) => a + l.amountCents, 0)).toBe(250000);
  });
  it("warns when below the profit thresholds", () => {
    const r = calculatePricing(items, { ...base, priceOverrideCents: 160000 });
    expect(r.warnings.some((w) => w.includes("Gross margin"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("Surplus"))).toBe(true);
    const loss = calculatePricing(items, { ...base, priceOverrideCents: 100000 });
    expect(loss.warnings.some((w) => w.includes("does not cover"))).toBe(true);
  });
});

describe("pricing engine — GST registered (future)", () => {
  const reg = { ...base, gstRegistered: true };
  it("uses GST-exclusive costs and records input tax credits", () => {
    const r = calculatePricing(items, reg);
    expect(r.costBasis).toBe("ex-gst");
    expect(r.equipmentCostCents).toBe(109480 + 7200);
    expect(r.materialCostCents).toBe(5738); // 17500 × 100 / 305 = 5737.7
    expect(r.inputTaxCreditCents).toBe(10948 + 720 + (6311 - 5738));
  });
  it("adds GST to the customer price", () => {
    const r = calculatePricing(items, reg);
    expect(r.netCents).toBe(279000);
    expect(r.gstCents).toBe(27900);
    expect(r.totalCents).toBe(306900);
  });
  it("splits a GST-inclusive override into net and GST exactly", () => {
    const r = calculatePricing(items, { ...reg, priceOverrideCents: 300000 });
    expect(r.netCents).toBe(272727);
    expect(r.gstCents).toBe(27273);
    expect(r.netCents + r.gstCents).toBe(300000);
  });
  it("rounds GST on awkward amounts", () => {
    const r = calculatePricing([], { ...reg, mode: "calculated", consumablesCostCents: 0, labourHoursCenti: 0, travelChargeCents: 12345 });
    expect(r.gstCents).toBe(1235); // 1234.5 rounds up
    expect(r.totalCents).toBe(13580);
  });
});
