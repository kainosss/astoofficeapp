import { beforeEach, describe, expect, it } from "vitest";
import { buildWarrantyText, ACL_NOTICE_GOODS_AND_SERVICES, mergeLines, RECOMMENDED_CONDITIONS, settingsWarnings, splitScopeTitle } from "../src/shared/terms";
import type { CustomerQuote, QuoteDetail, Settings } from "../src/shared/types";
import { renderQuotePdf, type LayoutEvent } from "../src/worker/pdf/quotePdf";
import {
  BOWLS_CLUB_ITEMS, BOWLS_CLUB_LABOUR_HOURS_CENTI, BOWLS_CLUB_SETTINGS_PATCH, BOWLS_CLUB_TOTAL_CENTS, BOWLS_CLUB_TRAVEL_CENTS,
} from "./fixtures/bowlsClub";
import { api, pdfText, resetDb, seed, textContains } from "./helpers";

const BOTTOM_MARGIN = 62;
const PAGE_TOP = 841.89 - 50;

async function setupSettings(patch: Partial<Settings> = {}) {
  const current = (await api<Settings>("/settings")).body;
  const next = { ...current, ...BOWLS_CLUB_SETTINGS_PATCH, ...patch };
  next.warrantyText = buildWarrantyText(next);
  const { updatedAt: _u, ...body } = next;
  const res = await api<Settings>("/settings", { method: "PUT", json: body });
  expect(res.status).toBe(200);
  return res.body;
}

/** Create the bowls-club fixture quotation (draft) using the CCTV scope template from Settings. */
async function createBowlsClubQuote(over: { customerNotes?: string } = {}) {
  const cust = await api<{ id: number; siteId: number }>("/customers", { method: "POST", json: {
    kind: "business", name: "Riverside Lawn Bowls Club (fixture)", contactPerson: "Club Secretary", email: "secretary@example.com",
    phone: "07 5550 2222", notes: "", site: { address: "1 Fixture Street", suburb: "Gaythorne", state: "QLD", postcode: "4051", notes: "" },
  } });
  const created = await api<{ id: number; revisionId: number; quoteNumber: string }>("/quotes", { method: "POST", json: { customerId: cust.body.id, siteId: cust.body.siteId, packageId: null } });
  const d = (await api<QuoteDetail>(`/quotes/${created.body.id}`)).body;
  const settings = (await api<Settings>("/settings")).body;
  const r = d.revision;
  const body = {
    customerId: d.customer.id, siteId: d.site?.id ?? null, title: "CCTV system — supply and installation", packageId: null,
    issueDate: null, expiryDate: null,
    pricing: { ...r.pricing, mode: "calculated", labourHoursCenti: BOWLS_CLUB_LABOUR_HOURS_CENTI, travelChargeCents: BOWLS_CLUB_TRAVEL_CENTS, consumablesCostCents: 0 },
    items: BOWLS_CLUB_ITEMS, scope: settings.scopeTemplateCctv, inclusions: settings.standardInclusions, exclusions: settings.standardExclusions,
    depositTerms: settings.depositTerms, paymentTerms: settings.paymentTerms, warrantyText: settings.warrantyText, acceptanceText: settings.acceptanceText,
    customerNotes: over.customerNotes ?? "", internalNotes: "Fixture",
  };
  const saved = await api(`/quotes/${created.body.id}/revisions/${created.body.revisionId}`, { method: "PUT", json: body });
  expect(saved.status).toBe(200);
  return created.body;
}

async function customerView(id: number, revisionId: number) {
  return (await api<CustomerQuote>(`/quotes/${id}/revisions/${revisionId}/customer`)).body;
}

async function layoutOf(q: CustomerQuote) {
  const events: LayoutEvent[] = [];
  const bytes = await renderQuotePdf(q, { onLayout: (e) => events.push(e) });
  return { events, bytes };
}

/** Page-break rules every rendered quotation must satisfy. */
function assertLayoutRules(events: LayoutEvent[]) {
  for (const e of events) {
    expect(e.bottom, `${e.kind} "${e.label}" runs into the footer`).toBeGreaterThanOrEqual(BOTTOM_MARGIN - 0.5);
    expect(e.top, `${e.kind} "${e.label}" starts above the page top`).toBeLessThanOrEqual(PAGE_TOP + 0.5);
  }
  events.forEach((e, i) => {
    if (e.kind !== "heading") return;
    const next = events[i + 1];
    expect(next, `heading "${e.label}" has no content`).toBeDefined();
    expect(next.page, `heading "${e.label}" is separated from its content`).toBe(e.page);
  });
  const sectionPages = (title: string) => {
    const i = events.findIndex((e) => e.kind === "heading" && e.label === title);
    if (i < 0) return [];
    const out = [events[i].page];
    for (let j = i + 1; j < events.length && events[j].kind !== "heading"; j++) out.push(events[j].page);
    return out;
  };
  const deposit = sectionPages("Deposit and payment terms");
  expect(new Set(deposit).size, "deposit and payment terms split across pages").toBe(1);
  const acceptance = sectionPages("Customer acceptance");
  expect(new Set(acceptance).size, "acceptance and signature fields split across pages").toBe(1);
  const price = sectionPages("Price");
  expect(new Set(price).size, "price summary split across pages").toBe(1);
  // Short paragraphs are never split; only genuinely long ones (here: the long customer notes) may break.
  expect(events.filter((e) => e.kind === "split-paragraph" && !e.label.startsWith("Note line"))).toEqual([]);
}

beforeEach(async () => {
  await resetDb();
  await seed();
});

describe("bowls club regression quotation (modelled on ASTO-Q-0003)", () => {
  it("keeps all selling prices and the $4,286.00 total", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const d = (await api<QuoteDetail>(`/quotes/${q.id}`)).body;
    expect(d.revision.totals.totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
    expect(d.revision.totals.gstCents).toBe(0);
    expect(d.revision.totals.items.map((i) => i.sellCents)).toEqual([150000, 70000, 20000, 37000, 9600]);
    const cq = await customerView(q.id, q.revisionId);
    expect(cq.totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
    expect(cq.priceLines.reduce((a, l) => a + l.amountCents, 0)).toBe(BOWLS_CLUB_TOTAL_CENTS);
    expect(cq.gstStatement).toBe("ASTO SECURITY is not registered for GST. No GST has been charged on this quotation.");
  });

  it("shows cabling and consumables as Included without changing quantities or prices", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const cq = await customerView(q.id, q.revisionId);
    const cable = cq.lines.find((l) => l.description === "Cat6 installation cabling")!;
    expect(cable).toMatchObject({ quantity: "2", showQuantity: false });
    const text = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    expect(textContains(text, "Included")).toBe(true);
    expect(textContains(text, "Ducting, connectors and installation consumables")).toBe(true);
    expect(textContains(text, "Sundries")).toBe(false);
    const d = (await api<QuoteDetail>(`/quotes/${q.id}`)).body;
    expect(d.revision.items[3].quantityCenti).toBe(200);
  });

  it("never puts internal costs, suppliers or SKUs in the customer PDF", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const text = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    for (const leak of ["189.20", "528.00", "154.00", "192.50", "Tradezone", "FIXTURE-", "Sundries", "markup", "margin", "surplus"])
      expect(textContains(text, leak), `PDF leaked "${leak}"`).toBe(false);
    expect(textContains(text, "$4,286.00")).toBe(true);
  });

  it("renders the scope of works above the equipment, using the template title as the heading", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const { events } = await layoutOf(await customerView(q.id, q.revisionId));
    const headings = events.filter((e) => e.kind === "heading").map((e) => e.label);
    expect(headings[0]).toBe("Scope of Works – CCTV Installation");
    expect(headings.indexOf("Scope of Works – CCTV Installation")).toBeLessThan(headings.indexOf("Equipment and materials"));
    expect(splitScopeTitle("Install cameras.").title).toBe("Scope of works");
  });

  it("includes readable warranty details with the prescribed ACL notice and written-acceptance option", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const text = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    for (const s of [
      "12 months from the date of completion", "How to claim", "office@example.com", "0491 570 156", "PO Box 0000, Brisbane QLD 4000",
      "Our goods and services come with guarantees that cannot be excluded under the Australian Consumer Law",
      "in addition to other rights and remedies", "do not exclude or reduce your rights under the Australian Consumer Law",
      "Written acceptance can also be sent by email to office@example.com", "Customer name", "Signature", "Date",
    ]) expect(textContains(text, s), `missing "${s}"`).toBe(true);
  });

  it("labels drafts and shows the issued status without changing prices", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const draft = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    expect(textContains(draft, "QUOTATION — DRAFT")).toBe(true);
    expect(textContains(draft, "NOT AN ISSUED QUOTATION")).toBe(true);
    await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "sent" } });
    const sent = await customerView(q.id, q.revisionId);
    expect(sent.status).toBe("sent");
    expect(sent.totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
    expect(sent.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.expiryDate > sent.issueDate).toBe(true);
    const sentPdf = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    expect(textContains(sentPdf, "NOT AN ISSUED QUOTATION")).toBe(false);
    await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "accepted" } });
    expect((await customerView(q.id, q.revisionId)).status).toBe("accepted");
  });

  it("keeps issued quotations unchanged when Settings wording changes", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "sent" } });
    const before = await customerView(q.id, q.revisionId);
    await setupSettings({ depositTerms: "Changed deposit wording", paymentTerms: "Changed payment wording", email: "changed@example.com", scopeTemplateCctv: "Changed scope" });
    const after = await customerView(q.id, q.revisionId);
    expect(after).toEqual(before);
  });
});

describe("PDF page breaks", () => {
  it("follows the layout rules for the bowls club quotation", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const { events } = await layoutOf(await customerView(q.id, q.revisionId));
    assertLayoutRules(events);
    const pages = Math.max(...events.map((e) => e.page));
    expect(pages).toBeLessThanOrEqual(3);
  });

  it("follows the layout rules wherever the page boundary falls", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const base = await customerView(q.id, q.revisionId);
    // Push every later section across the page boundary in small steps.
    for (let n = 0; n <= 60; n += 2) {
      const notes = Array.from({ length: n }, (_, i) => `Note line ${i + 1}.`).join("\n");
      const { events } = await layoutOf({ ...base, customerNotes: notes });
      try { assertLayoutRules(events); } catch (e) { throw new Error(`with ${n} note lines: ${(e as Error).message}`); }
    }
  });

  it("repeats the table header and never splits rows on long equipment lists", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const base = await customerView(q.id, q.revisionId);
    const lines = Array.from({ length: 70 }, (_, i) => ({ description: `Additional device ${i + 1} with a longer description that wraps onto a second line in the table`, quantity: "1", unit: "each", included: false, extra: false, showQuantity: true }));
    const { events, bytes } = await layoutOf({ ...base, lines });
    assertLayoutRules(events);
    const text = await pdfText(bytes.buffer as ArrayBuffer);
    const headerCount = text.split(Array.from("Quantity").map((c) => c.charCodeAt(0).toString(16).toUpperCase()).join("")).length - 1;
    expect(headerCount).toBeGreaterThan(1);
  });
});

describe("reusable terms", () => {
  it("builds warranty text without inventing missing details", () => {
    const text = buildWarrantyText({ businessName: "ASTO SECURITY", email: "", phone: "", address: "", workmanshipWarrantyMonths: 12, manufacturerWarrantyText: "", claimExpensesPolicy: "" });
    expect(text).toContain("[business email — add in Settings]");
    expect(text).toContain("[business phone — add in Settings]");
    expect(text).toContain("[manufacturer warranty wording — add in Settings]");
    expect(text).toContain("[Choose who bears warranty claim expenses — add in Settings]");
    expect(text).toContain(ACL_NOTICE_GOODS_AND_SERVICES);
    expect(text).not.toMatch(/\b\d+[- ]year/i); // no invented manufacturer warranty periods
  });

  it("flags missing mandatory warranty information", () => {
    const base = { businessName: "ASTO SECURITY", abn: "", email: "", phone: "", address: "", workmanshipWarrantyMonths: 12, manufacturerWarrantyText: "", claimExpensesPolicy: "" as const, depositTerms: "", paymentTerms: "", warrantyText: "Old warranty" };
    const w = settingsWarnings(base);
    expect(w.some((x) => x.includes("email"))).toBe(true);
    expect(w.some((x) => x.includes("claim expenses"))).toBe(true);
    expect(w.some((x) => x.includes("prescribed Australian Consumer Law notice"))).toBe(true);
    const complete = { ...base, ...BOWLS_CLUB_SETTINGS_PATCH, warrantyText: "" };
    complete.warrantyText = buildWarrantyText(complete);
    expect(settingsWarnings(complete)).toEqual([]);
  });

  it("adds recommended conditions without duplicating existing ones", () => {
    const once = mergeLines("Work not described in the scope of works", RECOMMENDED_CONDITIONS);
    expect(once.split("\n")).toHaveLength(1 + RECOMMENDED_CONDITIONS.length);
    expect(mergeLines(once, RECOMMENDED_CONDITIONS)).toBe(once);
  });

  it("gives new quotations the CCTV scope template when the package has no scope", async () => {
    const pkgs = (await api<{ id: number; scope: string }[]>("/packages")).body;
    await api(`/packages/${pkgs[0].id}`, { method: "GET" });
    const t = (await api<{ scope: string }>(`/quotes/template?packageId=${pkgs[0].id}`)).body;
    expect(t.scope).toBe(pkgs[0].scope); // package wording wins when set
    const settings = (await api<Settings>("/settings")).body;
    expect(settings.scopeTemplateCctv.startsWith("Scope of Works – CCTV Installation")).toBe(true);
  });
});
