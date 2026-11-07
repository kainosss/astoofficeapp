import { beforeEach, describe, expect, it } from "vitest";
import type { CustomerQuote, QuoteDetail } from "../src/shared/types";
import { api, pdfText, resetDb, seed, textContains } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seed();
});

/** Recursively collect object keys. */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); allKeys(x, out); }
  return out;
}

async function newQuote(packageId: number | null = 1, customerId = 1, siteId: number | null = 1) {
  const { status, body } = await api<{ id: number; quoteNumber: string; revisionId: number }>("/quotes", { method: "POST", json: { customerId, siteId, packageId } });
  expect(status).toBe(201);
  return body;
}

async function getQuote(id: number, revisionId?: number) {
  return (await api<QuoteDetail>(`/quotes/${id}${revisionId ? `?revisionId=${revisionId}` : ""}`)).body;
}

function saveBody(d: QuoteDetail, patch: Record<string, unknown> = {}) {
  const r = d.revision;
  return {
    customerId: d.customer.id, siteId: d.site?.id ?? null, title: r.title, packageId: r.packageId, issueDate: r.issueDate, expiryDate: r.expiryDate,
    pricing: r.pricing, items: r.items, scope: r.scope, inclusions: r.inclusions, exclusions: r.exclusions, depositTerms: r.depositTerms,
    paymentTerms: r.paymentTerms, warrantyText: r.warrantyText, acceptanceText: r.acceptanceText, customerNotes: r.customerNotes,
    internalNotes: r.internalNotes, ...patch,
  };
}

describe("authentication and security", () => {
  it("signs in with the development bypass on localhost", async () => {
    const { status, body } = await api("/me");
    expect(status).toBe(200);
    expect(body.via).toBe("dev-bypass");
  });
  it("refuses the development bypass on any non-local host", async () => {
    const { status } = await api("/me", { host: "office.astosec.com" });
    expect(status).toBe(403);
  });
  it("sets security headers and disables caching on API responses", async () => {
    const { res } = await api("/me");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("refuses cross-origin writes", async () => {
    const { status } = await api("/customers", { method: "POST", headers: { origin: "https://evil.example" }, json: { kind: "individual", name: "X" } });
    expect(status).toBe(403);
  });
  it("returns JSON 404 for unknown API routes", async () => {
    const { status, body } = await api("/nope");
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });
});

describe("customers and sites", () => {
  it("creates a customer with a site and finds it by suburb", async () => {
    const created = await api("/customers", { method: "POST", json: {
      kind: "business", name: "Test Electrical Pty Ltd", contactPerson: "Alex", email: "alex@example.com", phone: "0491 570 999", notes: "",
      site: { address: "1 Test Street", suburb: "Bulimba", state: "QLD", postcode: "4171", notes: "" },
    } });
    expect(created.status).toBe(201);
    const list = await api<any[]>("/customers?q=Bulimba");
    expect(list.body.map((c) => c.name)).toEqual(["Test Electrical Pty Ltd"]);
    const detail = await api(`/customers/${created.body.id}`);
    expect(detail.body.sites).toHaveLength(1);
  });
  it("validates input", async () => {
    const bad = await api("/customers", { method: "POST", json: { kind: "individual", name: "", email: "not-an-email" } });
    expect(bad.status).toBe(422);
    const badPostcode = await api("/customers/1/sites", { method: "POST", json: { address: "1 A St", postcode: "41" } });
    expect(badPostcode.status).toBe(422);
  });
  it("supports multiple sites per customer", async () => {
    const detail = await api("/customers/3");
    expect(detail.body.sites).toHaveLength(2);
  });
});

describe("equipment catalogue", () => {
  it("contains the confirmed ASTO prices", async () => {
    const { body } = await api<any[]>("/equipment");
    const kit6 = body.find((e) => e.sku === "NVR4108-4T-3667K");
    const kit8 = body.find((e) => e.sku === "NVR4108-4T-3867KIT");
    const cable = body.find((e) => e.name.startsWith("Security cable"));
    expect([kit6.costExGstCents, kit6.costIncGstCents, kit6.isEstimate]).toEqual([109480, 120428, false]);
    expect([kit8.costExGstCents, kit8.costIncGstCents]).toEqual([122000, 134200]);
    expect([cable.costExGstCents, cable.costIncGstCents, cable.packQuantity, cable.unit]).toEqual([17500, 19250, 305, "m"]);
    expect(body.find((e) => e.name === "Camera junction box").isEstimate).toBe(true);
  });
  it("rejects an inc-GST price lower than ex-GST", async () => {
    const { status } = await api("/equipment", { method: "POST", json: {
      manufacturer: "", name: "Bad", supplier: "", sku: "", category: "Other", kind: "equipment", unit: "each", packQuantity: 1,
      costExGstCents: 1000, costIncGstCents: 900, markupBp: null, sellPriceCents: null, customerDescription: "", notes: "", isEstimate: false, active: true,
    } });
    expect(status).toBe(422);
  });
  it("lists the two CCTV packages with their starting prices", async () => {
    const { body } = await api<any[]>("/packages");
    const byName = Object.fromEntries(body.map((p) => [p.name, p]));
    expect(byName["ASTO Home CCTV 6MP"].fixedPriceCents).toBe(279000);
    expect(byName["ASTO Home CCTV 4K"].fixedPriceCents).toBe(299000);
    expect(byName["ASTO Home CCTV 6MP"].labourHoursCenti).toBe(600);
  });
});

describe("quotation workflow", () => {
  it("creates sequential quotation numbers from a package", async () => {
    const a = await newQuote();
    const b = await newQuote(2);
    expect(a.quoteNumber).toBe("ASTO-Q-0004"); // three sample quotes are seeded
    expect(b.quoteNumber).toBe("ASTO-Q-0005");
    const d = await getQuote(a.id);
    expect(d.revision.status).toBe("draft");
    expect(d.revision.totals.totalCents).toBe(279000);
    expect(d.revision.pricing.gstRegistered).toBe(false);
    expect(d.revision.items.filter((i) => i.role === "included")).toHaveLength(3);
  });

  it("saves edits and recalculates on the server", async () => {
    const q = await newQuote(null);
    const d = await getQuote(q.id);
    const body = saveBody(d, {
      pricing: { ...d.revision.pricing, mode: "calculated", labourHoursCenti: 300, travelChargeCents: 5000 },
      items: [{ sortOrder: 0, role: "priced", kind: "equipment", equipmentId: 5, name: "Cam", description: "Camera", sku: "", supplier: "", unit: "each",
        quantityCenti: 200, packQuantity: 1, costExGstCents: 16000, costIncGstCents: 17600, markupBp: null, sellUnitCents: null, inPackage: false, isEstimate: true }],
    });
    const saved = await api(`/quotes/${q.id}/revisions/${q.revisionId}`, { method: "PUT", json: body });
    expect(saved.status).toBe(200);
    // 2 × 17600 × 1.25 = 44000; labour 3 × 130 = 39000; travel 5000
    expect(saved.body.totals.netCents).toBe(44000 + 39000 + 5000);
  });

  it("rejects a site belonging to another customer", async () => {
    const { status } = await api("/quotes", { method: "POST", json: { customerId: 1, siteId: 5, packageId: 1 } });
    expect(status).toBe(422);
  });

  it("never exposes internal costing in the customer view", async () => {
    const q = await newQuote();
    const { body } = await api<CustomerQuote>(`/quotes/${q.id}/revisions/${q.revisionId}/customer`);
    const keys = [...allKeys(body)].map((k) => k.toLowerCase());
    for (const forbidden of ["cost", "markup", "margin", "overhead", "warranty allowance", "profit", "surplus", "contribution", "supplier", "sku", "internalnotes", "totals", "pricing"]) {
      expect(keys.some((k) => k.includes(forbidden.replace(" ", ""))), `customer view leaked a "${forbidden}" field`).toBe(false);
    }
    const json = JSON.stringify(body);
    expect(json).not.toContain("120428");
    expect(json).not.toContain("Tradezone");
    expect(json).not.toContain("NVR4108");
    expect(body.totalCents).toBe(279000);
    expect(body.gstStatement).toContain("not registered for GST");
    expect(body.priceLines.reduce((a, l) => a + l.amountCents, 0)).toBe(body.netCents);
  });

  it("generates an A4 PDF with the price but no internal costs", async () => {
    const q = await newQuote();
    const { status, res, body } = await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`);
    expect(status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const head = new TextDecoder("latin1").decode(body.slice(0, 5));
    expect(head).toBe("%PDF-");
    const text = await pdfText(body);
    const pdfContainsText = (_: unknown, t: string) => textContains(text, t);
    expect(pdfContainsText(body, "$2,790.00")).toBe(true);
    expect(pdfContainsText(body, "ASTO-Q-0004")).toBe(true);
    expect(pdfContainsText(body, "not registered for GST")).toBe(true);
    expect(pdfContainsText(body, "1,204.28")).toBe(false);
    expect(pdfContainsText(body, "Tradezone")).toBe(false);
    expect(pdfContainsText(body, "NVR4108")).toBe(false);
    expect(pdfContainsText(body, "25%")).toBe(false);
  });

  it("handles long multi-page quotations", async () => {
    const q = await newQuote(null);
    const d = await getQuote(q.id);
    const items = Array.from({ length: 60 }, (_, i) => ({ sortOrder: i, role: "priced", kind: "equipment", equipmentId: null, name: `Item ${i}`,
      description: `Additional security device number ${i} with a deliberately long description to test wrapping across the table width`, sku: "", supplier: "",
      unit: "each", quantityCenti: 100, packQuantity: 1, costExGstCents: 1000, costIncGstCents: 1100, markupBp: null, sellUnitCents: null, inPackage: false, isEstimate: false }));
    await api(`/quotes/${q.id}/revisions/${q.revisionId}`, { method: "PUT", json: saveBody(d, { items, scope: "Lorem ipsum ".repeat(200) + "émoji 🔒 test" }) });
    const { status, body } = await api<ArrayBuffer>(`/quotes/${q.id}/revisions/${q.revisionId}/pdf`);
    expect(status).toBe(200);
    expect(textContains(await pdfText(body), "Page 3 of")).toBe(true);
  });

  it("locks issued revisions and preserves them through settings changes and revisions", async () => {
    const q = await newQuote();
    const sent = await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "sent" } });
    expect(sent.status).toBe(200);
    const issued = await getQuote(q.id);
    expect(issued.revision.locked).toBe(true);
    expect(issued.revision.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Editing an issued revision is refused.
    const edit = await api(`/quotes/${q.id}/revisions/${q.revisionId}`, { method: "PUT", json: saveBody(issued, { title: "changed" }) });
    expect(edit.status).toBe(409);

    // Change business settings: issued quote keeps its original details and prices.
    const settings = (await api("/settings")).body;
    await api("/settings", { method: "PUT", json: { ...settings, businessName: "Renamed Business", labourRateCents: 20000, gstRegistered: true } });
    const view = (await api<CustomerQuote>(`/quotes/${q.id}/revisions/${q.revisionId}/customer`)).body;
    expect(view.business.name).toBe("ASTO SECURITY");
    expect(view.totalCents).toBe(279000);
    expect(view.gstRegistered).toBe(false);

    // A new revision is a draft copy; revision 1 is untouched.
    const rev = await api(`/quotes/${q.id}/revise`, { method: "POST" });
    expect(rev.status).toBe(201);
    const latest = await getQuote(q.id);
    expect(latest.revision.revision).toBe(2);
    expect(latest.revision.status).toBe("draft");
    expect(latest.revision.pricing.labourRateCents).toBe(13000); // copied from the issued revision, not current settings
    expect(latest.revisions.map((r) => r.status)).toEqual(["sent", "draft"]);
    const r2 = (await api<CustomerQuote>(`/quotes/${q.id}/revisions/${latest.revision.id}/customer`)).body;
    expect(r2.reference).toBe(`${q.quoteNumber} Rev 2`);
    expect(r2.business.name).toBe("Renamed Business"); // drafts show current business details

    // Older revisions cannot change status.
    const old = await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "accepted" } });
    expect(old.status).toBe(409);
  });

  it("enforces status transitions", async () => {
    const q = await newQuote();
    const bad = await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "accepted" } });
    expect(bad.status).toBe(409);
    await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "sent" } });
    const ok = await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "accepted" } });
    expect(ok.status).toBe(200);
    const back = await api(`/quotes/${q.id}/revisions/${q.revisionId}/status`, { method: "POST", json: { status: "draft" } });
    expect(back.status).toBe(409);
  });

  it("duplicates a quotation under a new number", async () => {
    const dup = await api(`/quotes/1/duplicate`, { method: "POST" });
    expect(dup.status).toBe(201);
    expect(dup.body.quoteNumber).toBe("ASTO-Q-0004");
    const d = await getQuote(dup.body.id);
    expect(d.revision.status).toBe("draft");
    expect(d.revision.items.length).toBeGreaterThan(0);
  });

  it("only deletes quotations that were never issued", async () => {
    const issuedDelete = await api(`/quotes/1`, { method: "DELETE" });
    expect(issuedDelete.status).toBe(409);
    const draft = await newQuote();
    expect((await api(`/quotes/${draft.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("searches and filters the quotation list", async () => {
    const sent = await api<any[]>("/quotes?status=sent");
    expect(sent.body.map((q) => q.quoteNumber)).toEqual(["ASTO-Q-0001"]);
    const search = await api<any[]>("/quotes?q=Riverbend");
    expect(search.body).toHaveLength(1);
  });
});

describe("dashboard and exports", () => {
  it("reports real saved data", async () => {
    const { body } = await api("/dashboard");
    expect(body.totalQuotes).toBe(3);
    expect(body.byStatus).toMatchObject({ draft: 1, sent: 1, accepted: 1 });
    expect(body.outstandingValueCents).toBe(279000);
    expect(body.recent).toHaveLength(3);
  });
  it("exports a full JSON backup", async () => {
    const { status, res, body: json } = await api("/export/backup.json");
    expect(status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(json.tables.customers).toHaveLength(4);
    expect(json.tables.quote_revisions).toHaveLength(3);
  });
  it("neutralises spreadsheet formulas in CSV exports", async () => {
    await api("/customers", { method: "POST", json: { kind: "individual", name: "=HYPERLINK(\"http://x\")", contactPerson: "", email: "", phone: "", notes: "" } });
    const { body } = await api<ArrayBuffer>("/export/customers.csv");
    const csv = new TextDecoder().decode(body);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});
