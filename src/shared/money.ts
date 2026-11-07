/**
 * Decimal-safe money helpers. All amounts are integer cents (AUD).
 * Percentages are integer basis points (1% = 100 bp). Quantities/hours are integer hundredths.
 */

/** Integer division rounded half away from zero. Both arguments must be integers; b > 0. */
export function roundDiv(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`roundDiv requires integers (got ${a}, ${b})`);
  if (b <= 0) throw new Error("roundDiv divisor must be positive");
  if (!Number.isSafeInteger(a)) throw new Error("Amount is outside the safe calculation range");
  const sign = a < 0 ? -1 : 1;
  const abs = Math.abs(a);
  const q = Math.floor(abs / b);
  const r = abs - q * b;
  const result = r * 2 >= b ? q + 1 : q;
  return result === 0 ? 0 : sign * result;
}

/** Apply a basis-point percentage to an amount: amount × bp / 10000, rounded. */
export function applyBp(amountCents: number, bp: number): number {
  return roundDiv(amountCents * bp, 10000);
}

/** Ratio of two cent amounts as basis points (rounded). Returns null when the denominator is 0. */
export function ratioBp(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  if (denominator < 0) return roundDiv(-numerator * 10000, -denominator);
  return roundDiv(numerator * 10000, denominator);
}

/** Parse a user-entered dollar string/number ("1,204.28", "$2790") into integer cents. */
export function toCents(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid amount");
    return Math.round(value * 100 + (value >= 0 ? 1e-9 : -1e-9));
  }
  const cleaned = value.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) throw new Error(`Invalid amount: ${value}`);
  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Parse a decimal with up to 2 places (quantity, hours, percentage) into hundredths. */
export function toCenti(value: string | number): number {
  return toCents(value);
}

/** Format integer cents as AUD, e.g. 279000 -> "$2,790.00". */
export function formatAud(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const c = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${c}`;
}

/** Format cents as a plain decimal string for inputs, e.g. 120428 -> "1204.28". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

/** Format hundredths (qty/hours/percent) for inputs, trimming trailing zeros: 600 -> "6", 125 -> "1.25". */
export function centiToInput(centi: number | null | undefined): string {
  if (centi === null || centi === undefined) return "";
  return centsToInput(centi).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** Format basis points as a percentage string: 2500 -> "25%", 3333 -> "33.33%". */
export function formatBp(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "—";
  return `${centiToInput(bp)}%`;
}

/** Basis points <-> percentage input. A percentage input "25" is 2500 bp. */
export const bpToInput = centiToInput;
export const inputToBp = toCenti;
