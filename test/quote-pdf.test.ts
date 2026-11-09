import { env } from "cloudflare:test";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { buildWarrantyText, ACL_NOTICE_GOODS_AND_SERVICES, documentWarnings, mergeLines, RECOMMENDED_CONDITIONS, settingsWarnings, splitScopeTitle, warrantySections } from "../src/shared/terms";
import type { CustomerQuote, QuoteDetail, Settings } from "../src/shared/types";
import { renderQuotePdf, type LayoutEvent } from "../src/worker/pdf/quotePdf";
import { renderWarrantyPdf } from "../src/worker/pdf/warrantyPdf";
import {
  BOWLS_CLUB_EQUIPMENT_CENTS, BOWLS_CLUB_ITEMS, BOWLS_CLUB_LABOUR_CENTS, BOWLS_CLUB_LABOUR_HOURS_CENTI, BOWLS_CLUB_MATERIALS_CENTS,
  BOWLS_CLUB_SETTINGS_PATCH, BOWLS_CLUB_TOTAL_CENTS, BOWLS_CLUB_TRAVEL_CENTS,
} from "./fixtures/bowlsClub";
import { TEST_LOGO_DATA_URL } from "./fixtures/testLogo";
import { api, pdfPlain, pdfText, resetDb, seed, textContains } from "./helpers";

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
    expect(d.revision.totals.items.map((i) => i.sellCents)).toEqual([155400, 70000, 20000, 37000, 11000]);
    expect(d.revision.totals.equipmentSellCents).toBe(BOWLS_CLUB_EQUIPMENT_CENTS);
    expect(d.revision.totals.materialSellCents + d.revision.totals.consumablesSellCents).toBe(BOWLS_CLUB_MATERIALS_CENTS);
    expect(d.revision.totals.labourSellCents).toBe(BOWLS_CLUB_LABOUR_CENTS);
    expect(d.revision.totals.travelSellCents).toBe(0);
    const cq = await customerView(q.id, q.revisionId);
    expect(cq.totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
    expect(cq.priceLines).toEqual([
      { label: "Equipment", amountCents: 245400 },
      { label: "Cabling, materials and consumables", amountCents: 48000 },
      { label: "Installation and configuration labour", amountCents: 135200 },
    ]);
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
    for (const leak of ["189.20", "528.00", "154.00", "165.00", "60.00", "Tradezone", "FIXTURE-", "Sundries", "markup", "margin", "surplus"])
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

  it("shows only the short warranty summary and acknowledges the Warranty Statement in the quotation", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const text = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    for (const s of [
      "ASTO SECURITY provides a 12-month installation workmanship warranty. Supplied equipment is covered by the applicable manufacturer's warranty.",
      "Full warranty terms, claim procedures and Australian Consumer Law information are provided in the accompanying ASTO SECURITY Warranty Statement, which forms part of this quotation.",
      "and acknowledge receipt of the accompanying ASTO SECURITY Warranty Statement",
      "Written acceptance can also be sent by email to office@example.com", "Customer name", "Signature", "Date",
      "No deposit is required.", "Payment is due within 14 calendar days of the invoice date.", "$2,454.00", "$480.00", "$1,352.00",
    ]) expect(textContains(text, s), `quotation missing "${s}"`).toBe(true);
    // The full warranty and ACL notice are NOT repeated in the quotation.
    for (const s of ["How to claim", "Our goods and services come with guarantees", "Claim expenses"])
      expect(textContains(text, s), `quotation should not contain "${s}"`).toBe(false);
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

// ---------------------------------------------------------------------------
// Separate Warranty Statement
// ---------------------------------------------------------------------------

async function warrantyLayout(q: CustomerQuote) {
  const events: LayoutEvent[] = [];
  const bytes = await renderWarrantyPdf(q, { onLayout: (e) => events.push(e) });
  return { events, bytes };
}

function assertWarrantyLayout(events: LayoutEvent[]) {
  for (const e of events) expect(e.bottom, `${e.kind} "${e.label}" runs into the footer`).toBeGreaterThanOrEqual(BOTTOM_MARGIN - 0.5);
  events.forEach((e, i) => {
    if (e.kind !== "heading") return;
    expect(events[i + 1]?.page, `heading "${e.label}" separated from its content`).toBe(e.page);
  });
  const acl = events.findIndex((e) => e.kind === "heading" && e.label === "Australian Consumer Law");
  expect(acl).toBeGreaterThanOrEqual(0);
  const aclPages = new Set(events.slice(acl).map((e) => e.page));
  expect(aclPages.size, "Australian Consumer Law section split across pages").toBe(1);
  // Only genuinely long paragraphs (here: the synthetic test wording) may split; real warranty paragraphs never do.
  expect(events.filter((e) => e.kind === "split-paragraph" && !e.label.startsWith("Additional warranty wording"))).toEqual([]);
}

/** Every line of the prescribed notice (bullets are drawn as dots, so compare the text after them). */
function aclLines(): string[] {
  return ACL_NOTICE_GOODS_AND_SERVICES.split("\n").map((l) => l.replace(/^•\s*/, "").trim());
}

describe("Warranty Statement PDF", () => {
  it("contains the header, references, warrantor details and every warranty section", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const res = await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/warranty-pdf?download=1`);
    expect(res.status).toBe(200);
    expect(res.res.headers.get("content-type")).toBe("application/pdf");
    expect(res.res.headers.get("content-disposition")).toContain(`${q.quoteNumber}-Warranty-Statement-DRAFT.pdf`);
    const text = await pdfText(res.body);
    for (const s of [
      "ASTO SECURITY", "WARRANTY STATEMENT", q.quoteNumber, "Riverside Lawn Bowls Club (fixture)", "1 Fixture Street", "Gaythorne QLD 4051",
      "ABN 00 000 000 000", "10 Example Street, Brisbane QLD 4000", "office@example.com", "0491 570 156",
      `This Warranty Statement forms part of quotation ${q.quoteNumber}`,
      "WARRANTOR", "INSTALLATION WORKMANSHIP WARRANTY", "MANUFACTURER EQUIPMENT WARRANTY", "HOW TO MAKE A WARRANTY CLAIM",
      "WARRANTY CLAIM EXPENSES", "VOLUNTARY WARRANTY CONDITIONS", "AUSTRALIAN CONSUMER LAW",
      "12 months from the date of completion", "Equipment is covered by the applicable manufacturer's warranty",
      "will bear the reasonable expenses of making a warranty claim", "send your receipts with your claim to office@example.com",
      "do not exclude or reduce your rights under the Australian Consumer Law",
      "The benefits given by this warranty are in addition to other rights and remedies you have under a law in relation to the goods and services to which the warranty relates.",
      ...aclLines(),
    ]) expect(textContains(text, s), `warranty statement missing "${s}"`).toBe(true);
    for (const leak of ["189.20", "528.00", "154.00", "165.00", "Tradezone", "FIXTURE-", "$4,286.00", "markup"])
      expect(textContains(text, leak), `warranty statement leaked "${leak}"`).toBe(false);
  });

  it("keeps headings with content and the ACL section on one page, wherever the page boundary falls", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const base = await customerView(q.id, q.revisionId);
    assertWarrantyLayout((await warrantyLayout(base)).events);
    for (let n = 0; n <= 40; n += 2) {
      const extra = Array.from({ length: n }, (_, i) => `Additional warranty wording sentence ${i + 1} for layout testing.`).join(" ");
      const variant = { ...base, warrantyText: n ? base.warrantyText.replace("This voluntary workmanship", `${extra}\n\nThis voluntary workmanship`) : base.warrantyText };
      try { assertWarrantyLayout((await warrantyLayout(variant)).events); } catch (e) { throw new Error(`with ${n} extra sentences: ${(e as Error).message}`); }
    }
  });

  it("splits saved wording into sections without losing or changing any words", () => {
    const text = buildWarrantyText({ ...BOWLS_CLUB_SETTINGS_PATCH, workmanshipWarrantyMonths: 12 });
    const sections = warrantySections(text);
    expect(sections.map((s) => s.title)).toEqual([
      "Installation Workmanship Warranty", "Manufacturer Equipment Warranty", "How to Make a Warranty Claim",
      "Warranty Claim Expenses", "Voluntary Warranty Conditions", "Australian Consumer Law",
    ]);
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    const rebuilt = norm(sections.flatMap((s) => s.paragraphs).join(" "));
    const original = norm(text.replace(/^(Workmanship warranty|Equipment warranty|How to claim|Claim expenses):\s*/gm, ""));
    expect(rebuilt).toBe(original);
    expect(sections.at(-1)!.paragraphs.at(-1)).toBe(ACL_NOTICE_GOODS_AND_SERVICES);
  });
});

describe("quotation and Warranty Statement together", () => {
  it("fits the bowls club quotation onto two pages and keeps the $4,286.00 total", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const cq = await customerView(q.id, q.revisionId);
    expect(cq.totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
    const { events } = await layoutOf(cq);
    assertLayoutRules(events);
    expect(Math.max(...events.map((e) => e.page))).toBe(2);
  });

  it("downloads both documents as one PDF, quotation first", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const pages = async (path: string) => (await PDFDocument.load((await api<ArrayBuffer>(path)).body)).getPageCount();
    const quotePages = await pages(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`);
    const warrantyPages = await pages(`/quotes/${q.id}/revisions/${q.revisionId}/warranty-pdf`);
    const both = await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/documents-pdf?download=1`);
    expect(both.res.headers.get("content-disposition")).toContain("Quotation-and-Warranty-Statement");
    expect((await PDFDocument.load(both.body)).getPageCount()).toBe(quotePages + warrantyPages);
    const plain = pdfPlain(await pdfText(both.body));
    expect(plain.indexOf("QUOTATION")).toBeLessThan(plain.indexOf("WARRANTY STATEMENT"));
  });

  it("freezes both documents when issued: later Settings changes do not alter them", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "sent" } });
    const read = async (kind: string) => pdfPlain(await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/${kind}`)).body));
    const [quoteBefore, warrantyBefore] = [await read("pdf"), await read("warranty-pdf")];
    await setupSettings({ email: "changed@example.com", phone: "0491 570 999", workmanshipWarrantyMonths: 24, businessName: "Renamed" });
    expect(await read("pdf")).toBe(quoteBefore);
    expect(await read("warranty-pdf")).toBe(warrantyBefore);
    expect(warrantyBefore).not.toContain("changed@example.com");
    expect(warrantyBefore).toContain(q.quoteNumber);
    expect((await customerView(q.id, q.revisionId)).documentFormat).toBe(2);
  });

  it("references the same revision in a new revision's quotation and Warranty Statement", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "sent" } });
    const rev2 = (await api<{ revisionId: number }>(`/quotes/${q.id}/revise`, { method: "POST" })).body.revisionId;
    const ref = `${q.quoteNumber} Rev 2`;
    for (const kind of ["pdf", "warranty-pdf"]) {
      const text = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${rev2}/${kind}`)).body);
      expect(textContains(text, ref), `${kind} missing ${ref}`).toBe(true);
    }
    expect((await customerView(q.id, q.revisionId)).totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
    expect((await customerView(q.id, rev2)).totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
  });

  it("keeps quotations issued before this change exactly as issued (full warranty inline)", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "sent" } });
    // Simulate a revision issued by the previous version (no documentFormat recorded in its snapshot).
    await env.DB.prepare("UPDATE quote_revisions SET snapshot = json_remove(snapshot, '$.documentFormat') WHERE id = ?").bind(q.revisionId).run();
    const cq = await customerView(q.id, q.revisionId);
    expect(cq.documentFormat).toBe(1);
    const text = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    expect(textContains(text, "Our goods and services come with guarantees that cannot be excluded")).toBe(true);
    expect(textContains(text, "acknowledge receipt of the accompanying")).toBe(false);
    expect(cq.totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
  });

  it("regenerates draft documents from refreshed terms", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    await setupSettings({ workmanshipWarrantyMonths: 24 });
    const settings = (await api<Settings>("/settings")).body;
    const d = (await api<QuoteDetail>(`/quotes/${q.id}`)).body;
    const r = d.revision;
    await api(`/quotes/${q.id}/revisions/${q.revisionId}`, { method: "PUT", json: {
      customerId: d.customer.id, siteId: d.site?.id ?? null, title: r.title, packageId: r.packageId, issueDate: null, expiryDate: null,
      pricing: r.pricing, items: r.items, scope: r.scope, inclusions: r.inclusions, exclusions: r.exclusions, depositTerms: r.depositTerms,
      paymentTerms: r.paymentTerms, warrantyText: settings.warrantyText, acceptanceText: r.acceptanceText, customerNotes: r.customerNotes, internalNotes: r.internalNotes,
    } });
    const quote = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    const warranty = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/warranty-pdf`)).body);
    expect(textContains(quote, "a 24-month installation workmanship warranty")).toBe(true);
    expect(textContains(warranty, "24 months from the date of completion")).toBe(true);
    expect((await customerView(q.id, q.revisionId)).totalCents).toBe(BOWLS_CLUB_TOTAL_CENTS);
  });

  it("warns about missing mandatory information before issuing", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const complete = await customerView(q.id, q.revisionId);
    expect(documentWarnings(complete)).toEqual([]);
    const incomplete = { ...complete, business: { ...complete.business, email: "", address: "" }, warrantyText: "12-month workmanship warranty. [to be confirmed]" };
    const w = documentWarnings(incomplete);
    for (const s of ["email", "address", "prescribed Australian Consumer Law notice", "in addition to other rights", "who bears the expenses", "[placeholder]"])
      expect(w.some((x) => x.includes(s)), `missing warning about "${s}"`).toBe(true);
  });
});

describe("final document checks", () => {
  const imageCount = async (bytes: ArrayBuffer) => (await pdfText(bytes)).split("/Subtype /Image").length - 1;

  it("fits the Warranty Statement on one page without a logo", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const { events } = await warrantyLayout(await customerView(q.id, q.revisionId));
    assertWarrantyLayout(events);
    expect(Math.max(...events.map((e) => e.page))).toBe(1);
  });

  it("shows the configured logo on both documents and keeps the Warranty Statement balanced", async () => {
    await setupSettings({ logoDataUrl: TEST_LOGO_DATA_URL });
    const q = await createBowlsClubQuote();
    const counts: number[] = [];
    for (const kind of ["pdf", "warranty-pdf"]) {
      const bytes = (await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/${kind}`)).body;
      counts.push(await imageCount(bytes)); // a transparent PNG is stored as image + transparency mask
    }
    expect(counts[0], "quotation has no logo image").toBeGreaterThanOrEqual(1);
    expect(counts[1], "warranty statement logo differs from quotation").toBe(counts[0]);
    // Without a logo there are no images at all (text heading is used instead).
    await setupSettings({ logoDataUrl: null });
    const q2 = await createBowlsClubQuote();
    expect(await imageCount((await api<ArrayBuffer>(`/quotes/${q2.id}/revisions/${q2.revisionId}/warranty-pdf`)).body)).toBe(0);
    await setupSettings({ logoDataUrl: TEST_LOGO_DATA_URL });
    const cq = await customerView(q.id, q.revisionId);
    expect(cq.business.logoDataUrl).toBe(TEST_LOGO_DATA_URL);
    const { events } = await warrantyLayout(cq);
    assertWarrantyLayout(events);
    const pages = Math.max(...events.map((e) => e.page));
    if (pages === 2) {
      // Balanced: the second page is never just the legal notice.
      const page2 = events.filter((e) => e.page === 2);
      expect(page2.filter((e) => e.kind === "heading").length).toBeGreaterThanOrEqual(2);
    } else expect(pages).toBe(1);
    // The quotation still fits on two pages with the logo.
    expect(Math.max(...(await layoutOf(cq)).events.map((e) => e.page))).toBe(2);
  });

  it("falls back to two balanced pages when the content cannot fit on one", async () => {
    await setupSettings({ logoDataUrl: TEST_LOGO_DATA_URL });
    const q = await createBowlsClubQuote();
    const base = await customerView(q.id, q.revisionId);
    const long = { ...base, warrantyText: base.warrantyText.replace("This voluntary workmanship", "Additional warranty wording for layout testing. ".repeat(12) + "\n\nThis voluntary workmanship") };
    const { events } = await warrantyLayout(long);
    assertWarrantyLayout(events);
    expect(Math.max(...events.map((e) => e.page))).toBe(2);
    const fill = [1, 2].map((pg) => { const on = events.filter((e) => e.page === pg); return on[0].top - Math.min(...on.map((e) => e.bottom)); });
    expect(Math.min(...fill) / Math.max(...fill), `unbalanced pages: ${fill.map((f) => f.toFixed(0)).join(" / ")}`).toBeGreaterThan(0.4);
  });

  it("uses the same quotation number, revision and warranty terms in both documents, with no internal costs", async () => {
    await setupSettings();
    const q = await createBowlsClubQuote();
    const cq = await customerView(q.id, q.revisionId);
    const quote = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`)).body);
    const warranty = await pdfText((await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/warranty-pdf`)).body);
    for (const doc of [quote, warranty]) {
      expect(textContains(doc, `Quotation ${cq.reference}`)).toBe(true); // footer on every page of both documents
      expect(textContains(doc, cq.customer.name)).toBe(true);
      for (const leak of ["189.20", "528.00", "154.00", "165.00", "Tradezone", "FIXTURE-", "Sundries"]) expect(textContains(doc, leak), leak).toBe(false);
    }
    // Every paragraph of this revision's warranty wording appears in the Warranty Statement...
    for (const sec of warrantySections(cq.warrantyText))
      for (const para of sec.paragraphs)
        for (const line of para.split("\n")) expect(textContains(warranty, line.replace(/^•\s*/, "")), line.slice(0, 50)).toBe(true);
    // ...and the quotation's summary states the same workmanship period.
    expect(textContains(quote, "a 12-month installation workmanship warranty")).toBe(true);
    expect(textContains(warranty, "for 12 months from the date of completion")).toBe(true);
  });
});
