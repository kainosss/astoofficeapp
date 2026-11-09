/**
 * ASTO SECURITY Warranty Statement PDF (A4) — the separate document that accompanies each quotation.
 *
 * Uses the same layout engine, typography, colours, header, parties block and footers as the quotation
 * (./layout), and the SAME revision data: business snapshot, customer, site, reference and the revision's
 * own saved warranty wording. An issued quotation and its Warranty Statement therefore always match.
 *
 * Content comes from the saved warranty wording (Settings → Warranty → Build from template), split into
 * sections without altering any words — the prescribed Australian Consumer Law notice is printed exactly
 * as saved and is never split across pages.
 */
import { warrantySections } from "../../shared/terms";
import type { CustomerQuote } from "../../shared/types";
import {
  BODY, C, continuationHeader, createDocument, drawDocumentHeader, drawFooters, drawParties, formatDate, HEADING_H, LEADING, M,
  USABLE, WIDTH, wrap, Writer, type LayoutEvent, type RenderOptions,
} from "./layout";

/** Space above section headings: normal, then a slightly tighter fallback tried before using a second page. */
const HEADING_GAPS = [15, 12];

interface Pass { bytes: Uint8Array; events: LayoutEvent[]; pages: number }

/**
 * Render the Warranty Statement. It aims for ONE page. If the content does not fit (for example with a tall
 * logo or long contact details), it is rendered on two pages with the break placed before whichever section
 * gives the most balanced pages — never inside a section and never inside the Australian Consumer Law notice.
 */
export async function renderWarrantyPdf(q: CustomerQuote, options: RenderOptions = {}): Promise<Uint8Array> {
  let first = await layoutWarranty(q, null, HEADING_GAPS[0]);
  for (const gap of HEADING_GAPS.slice(1)) if (first.pages > 1) first = await layoutWarranty(q, null, gap);
  let chosen = first;
  if (first.pages > 1) {
    const titles = warrantySections(q.warrantyText).map((sec) => sec.title).slice(1);
    let best: { pass: Pass; score: number } | null = null;
    for (const title of titles) {
      const pass = await layoutWarranty(q, title, HEADING_GAPS[0]);
      if (pass.pages !== 2) continue;
      const fill = [1, 2].map((pg) => {
        const onPage = pass.events.filter((e) => e.page === pg);
        return onPage.length ? onPage[0].top - Math.min(...onPage.map((e) => e.bottom)) : 0;
      });
      const score = Math.abs(fill[0] - fill[1]);
      if (!best || score < best.score) best = { pass, score };
    }
    if (best) chosen = best.pass;
  }
  chosen.events.forEach((e) => options.onLayout?.(e));
  return chosen.bytes;
}

async function layoutWarranty(q: CustomerQuote, breakBefore: string | null, headingGap: number): Promise<Pass> {
  const events: LayoutEvent[] = [];
  const name = q.business.name.trim() || "ASTO SECURITY";
  const draft = q.status === "draft";
  const { doc, fonts, clean, logo } = await createDocument(
    { title: `${name} Warranty Statement — Quotation ${q.reference}`, author: name, subject: `Warranty Statement for quotation ${q.reference}` },
    q.business.logoDataUrl,
  );
  const w = new Writer(doc, fonts, clean, continuationHeader(name, `Warranty Statement — Quotation ${q.reference}${draft ? " (DRAFT)" : ""}`), (e) => events.push(e));
  w.headingGap = headingGap;

  // ---------- Header & parties ----------
  drawDocumentHeader(w, logo, q.business, draft ? "WARRANTY STATEMENT — DRAFT" : "WARRANTY STATEMENT",
    [["Quotation", q.reference], ["Quotation date", formatDate(q.issueDate)]]);
  drawParties(w, q, "CUSTOMER", true);

  // ---------- Purpose ----------
  w.y -= 6;
  w.paragraph(
    `This Warranty Statement forms part of quotation ${q.reference} dated ${formatDate(q.issueDate)} and applies to the goods and services ` +
    `supplied by ${name} under that quotation at the installation address shown above.`,
    { labels: false, keep: true },
  );

  // ---------- Warrantor (name, ABN, address, phone, email) — compact shaded panel ----------
  const details = [
    name,
    `ABN ${q.business.abn.trim() || "[to be provided]"}`,
    q.business.address.trim() || "[Business address to be provided]",
    `Phone ${q.business.phone.trim() || "[to be provided]"}`,
    `Email ${q.business.email.trim() || "[to be provided]"}`,
  ].join("   |   ");
  const labelW = 72;
  const lines = wrap(clean(details), fonts.regular, BODY, WIDTH - labelW - 16);
  const panelH = lines.length * LEADING + 10;
  w.ensure(panelH + 6);
  const panelTop = w.y - 2;
  w.page.drawRectangle({ x: M.left, y: panelTop - panelH, width: WIDTH, height: panelH, color: C.fill });
  w.text("WARRANTOR", M.left + 8, panelTop - 5 - LEADING + 3, { font: fonts.bold, size: 8, color: C.green });
  lines.forEach((l, i) => w.text(l, M.left + 8 + labelW, panelTop - 5 - (i + 1) * LEADING + 3));
  w.y = panelTop - panelH - 2;
  w.record("warrantor", "warrantor", panelTop);

  // ---------- Warranty sections from the revision's saved wording ----------
  const sections = warrantySections(q.warrantyText);
  if (!sections.length) {
    w.textSection("Warranty terms", "[Warranty information to be provided — add it in Settings → Warranty.]", { labels: false });
  }
  for (const sec of sections) {
    if (breakBefore && sec.title === breakBefore && w.pageNo === 1) w.newPage();
    // The Australian Consumer Law section (incl. the prescribed notice) is always kept on one page.
    if (sec.title === "Australian Consumer Law") {
      const h = sec.paragraphs.reduce((acc, p) => acc + w.paragraphHeight(p, { labels: false }), 0);
      if (HEADING_H + h <= USABLE) w.ensure(HEADING_H + h);
      w.heading(sec.title, h);
      sec.paragraphs.forEach((p) => w.paragraph(p, { labels: false, keep: true }));
    } else {
      w.textSection(sec.title, sec.paragraphs.join("\n\n"), { labels: false });
    }
  }

  // ---------- Footer on every page ----------
  drawFooters(w, `${name}  |  ABN ${q.business.abn.trim() || "[to be provided]"}  |  Warranty Statement — Quotation ${q.reference}`,
    draft ? "DRAFT — ACCOMPANIES A DRAFT QUOTATION" : null);

  return { bytes: await doc.save(), events, pages: w.pages.length };
}
