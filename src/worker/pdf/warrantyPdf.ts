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
import { warrantySections, workmanshipMonths } from "../../shared/terms";
import type { CustomerQuote } from "../../shared/types";
import {
  BODY, C, continuationHeader, createDocument, drawDocumentHeader, drawFooters, drawParties, formatDate, HEADING_H, LEADING, M,
  USABLE, WIDTH, wrap, Writer, type RenderOptions,
} from "./layout";

export async function renderWarrantyPdf(q: CustomerQuote, options: RenderOptions = {}): Promise<Uint8Array> {
  const name = q.business.name.trim() || "ASTO SECURITY";
  const draft = q.status === "draft";
  const months = workmanshipMonths(q.warrantyText);
  const { doc, fonts, clean, logo } = await createDocument(
    { title: `${name} Warranty Statement — Quotation ${q.reference}`, author: name, subject: `Warranty Statement for quotation ${q.reference}` },
    q.business.logoDataUrl,
  );
  const w = new Writer(doc, fonts, clean, continuationHeader(name, `Warranty Statement — Quotation ${q.reference}${draft ? " (DRAFT)" : ""}`), options.onLayout);

  // ---------- Header & parties ----------
  drawDocumentHeader(w, logo, q.business, draft ? "WARRANTY STATEMENT — DRAFT" : "WARRANTY STATEMENT",
    [["Quotation", q.reference], ["Quotation date", formatDate(q.issueDate)],
      ["Workmanship warranty", months ? `${months} months` : "See below"]]);
  drawParties(w, q, "CUSTOMER");

  // ---------- Title & purpose ----------
  const title = wrap(clean(`Warranty Statement for quotation ${q.reference}`), fonts.bold, 12.5, WIDTH);
  w.y -= 14;
  title.forEach((l) => { w.y -= 17.75; w.text(l, M.left, w.y + 3, { font: fonts.bold, size: 12.5 }); });
  w.y -= 4;
  w.paragraph(
    `This Warranty Statement accompanies quotation ${q.reference} dated ${formatDate(q.issueDate)} and forms part of that quotation. ` +
    `It applies to the goods and services supplied by ${name} under that quotation at the installation address shown above.`,
    { labels: false, keep: true },
  );

  // ---------- Warrantor details (name, ABN, address, phone, email) ----------
  const rows: [string, string][] = [
    ["Business name", name],
    ["ABN", q.business.abn.trim() || "[ABN to be provided]"],
    ["Business address", q.business.address.trim() || "[Business address to be provided]"],
    ["Phone", q.business.phone.trim() || "[Phone number to be provided]"],
    ["Email", q.business.email.trim() || "[Email address to be provided]"],
  ];
  const valueX = M.left + 120;
  const rowLines = rows.map(([, v]) => wrap(clean(v), fonts.regular, BODY, WIDTH - 126));
  const rowsHeight = rowLines.reduce((h, ls) => h + ls.length * LEADING + 4, 0) + 6;
  w.heading("Warrantor", rowsHeight);
  const rowsTop = w.y;
  w.page.drawRectangle({ x: M.left, y: w.y - rowsHeight + 2, width: WIDTH, height: rowsHeight - 2, color: C.fill });
  w.y -= 3;
  rows.forEach(([k], i) => {
    w.y -= LEADING;
    w.text(k, M.left + 8, w.y + 3, { font: fonts.bold, size: 9, color: C.muted });
    rowLines[i].forEach((l, j) => { if (j) w.y -= LEADING; w.text(l, valueX, w.y + 3); });
    w.y -= 4;
  });
  w.y -= 3;
  w.record("warrantor", "warrantor", rowsTop);

  // ---------- Warranty sections from the revision's saved wording ----------
  const sections = warrantySections(q.warrantyText);
  if (!sections.length) {
    w.textSection("Warranty terms", "[Warranty information to be provided — add it in Settings → Warranty.]", { labels: false });
  }
  for (const s of sections) {
    const text = s.paragraphs.join("\n\n");
    // The Australian Consumer Law section (incl. the prescribed notice) is always kept on one page.
    if (s.title === "Australian Consumer Law") {
      const h = s.paragraphs.reduce((acc, p) => acc + w.paragraphHeight(p, { labels: false }), 0);
      if (HEADING_H + h <= USABLE) w.ensure(HEADING_H + h);
      w.heading(s.title, h);
      s.paragraphs.forEach((p) => w.paragraph(p, { labels: false, keep: true }));
    } else {
      w.textSection(s.title, text, { labels: false });
    }
  }

  // ---------- Footer on every page ----------
  drawFooters(w, `${name}  |  ABN ${q.business.abn.trim() || "[to be provided]"}  |  Warranty Statement — Quotation ${q.reference}`,
    draft ? "DRAFT — ACCOMPANIES A DRAFT QUOTATION" : null);

  return doc.save();
}
