/**
 * ASTO SECURITY customer quotation PDF (A4), generated with pdf-lib inside Cloudflare Workers.
 * Input is the CustomerQuote whitelist only, so internal costs can never reach the PDF.
 * Layout, typography and page-break rules come from ./layout (shared with the Warranty Statement).
 */
import { formatAud } from "../../shared/money";
import { acceptanceStatement, splitScopeTitle, warrantySummary } from "../../shared/terms";
import type { CustomerQuote } from "../../shared/types";
import {
  BODY, C, continuationHeader, createDocument, drawDocumentHeader, drawFooters, drawParties, formatDate, HEADING_H, M, paragraphs, placeholder, USABLE, WIDTH, wrap, Writer, type RenderOptions,
} from "./layout";

export type { LayoutEvent, RenderOptions } from "./layout";

const STATUS_TITLE: Record<CustomerQuote["status"], string> = {
  draft: "QUOTATION — DRAFT", sent: "QUOTATION", accepted: "QUOTATION — ACCEPTED", declined: "QUOTATION — DECLINED", expired: "QUOTATION — EXPIRED",
};

export async function renderQuotePdf(q: CustomerQuote, options: RenderOptions = {}): Promise<Uint8Array> {
  const { doc, fonts, clean, logo } = await createDocument(
    { title: `${q.business.name} Quotation ${q.reference}`, author: q.business.name, subject: q.title },
    q.business.logoDataUrl,
  );
  const status = q.status ?? (q.isDraft ? "draft" : "sent");
  const format = q.documentFormat ?? 2;
  const statusLabel = status === "sent" ? "" : ` (${STATUS_TITLE[status].replace("QUOTATION — ", "")})`;
  const w = new Writer(doc, fonts, clean, continuationHeader(q.business.name, `Quotation ${q.reference}${statusLabel}`), options.onLayout);
  const right = M.left + WIDTH;

  // ---------- Header & parties ----------
  drawDocumentHeader(w, logo, q.business, STATUS_TITLE[status],
    [["Quote number", q.reference], ["Issue date", formatDate(q.issueDate)], ["Valid until", formatDate(q.expiryDate)]]);
  drawParties(w, q);

  // ---------- Title & scope (scope appears above equipment) ----------
  if (q.title) {
    const t = wrap(clean(q.title), fonts.bold, 12.5, WIDTH);
    w.ensure(14 + t.length * 18);
    w.y -= 14;
    t.forEach((l) => { w.y -= 17.75; w.text(l, M.left, w.y + 3, { font: fonts.bold, size: 12.5 }); });
  }
  if (q.scope.trim()) {
    const { title, body } = splitScopeTitle(q.scope);
    if (body) w.textSection(title, body, { labels: false });
  }

  // ---------- Equipment table ----------
  if (q.lines.length) {
    const qtyX = right - 8;
    const rowH = 15;
    const rows = q.lines.map((line) => {
      const descW = WIDTH - 110 - (line.included ? 14 : 0);
      const wrapped = wrap(clean(line.description), fonts.regular, BODY, descW);
      return { line, wrapped, h: Math.max(1, wrapped.length) * 12.5 + 5 };
    });
    const tableHeader = () => {
      w.page.drawRectangle({ x: M.left, y: w.y - rowH, width: WIDTH, height: rowH, color: C.fill });
      w.text("Description", M.left + 6, w.y - 10.5, { font: fonts.bold, size: 8.5, color: C.muted });
      w.rightText("Quantity", qtyX, w.y - 10.5, { font: fonts.bold, size: 8.5, color: C.muted });
      w.y -= rowH;
    };
    const firstRows = rows.slice(0, 2).reduce((h, r) => h + r.h, 0);
    w.heading("Equipment and materials", rowH + firstRows);
    tableHeader();
    for (const { line, wrapped, h } of rows) {
      if (h > w.room()) { w.newPage(); tableHeader(); }
      const rowTop = w.y;
      const prefix = line.included ? "    " : "";
      wrapped.forEach((wl, i) => w.text(prefix + wl, M.left + 6, w.y - 11 - i * 12.5, { color: line.included ? C.muted : C.text }));
      const qty = line.showQuantity === false ? "Included" : line.unit && line.unit !== "each" ? `${line.quantity} ${line.unit}` : line.quantity;
      w.rightText(qty, qtyX, w.y - 11, { color: line.included || line.showQuantity === false ? C.muted : C.text });
      const tag = line.included ? "Included in kit" : line.extra ? "Additional" : "";
      if (tag) w.rightText(tag, qtyX - 60, w.y - 11, { font: fonts.italic, size: 8, color: C.muted });
      w.y -= h;
      w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: right, y: w.y }, thickness: 0.4, color: C.rule });
      w.record("row", line.description.slice(0, 40), rowTop);
    }
  }

  // ---------- Pricing (kept together) ----------
  const amtX = right - 8;
  const priceRowHeight = (label: string, size = BODY, bold = false) =>
    wrap(clean(label), bold ? fonts.bold : fonts.regular, size, WIDTH - 130).length * (size * 1.35) + 6;
  const gstLines = wrap(clean(q.gstStatement), fonts.italic, 8.5, WIDTH).length;
  const priceHeight = q.priceLines.reduce((h, pl) => h + priceRowHeight(pl.label), 0)
    + 4 + (q.gstRegistered ? priceRowHeight("Subtotal") * 2 : 0) + 28 + gstLines * 8.5 * 1.42 + 4;
  w.ensure(HEADING_H + priceHeight);
  w.heading("Price", priceHeight);
  const priceStart = w.y;
  const priceRow = (label: string, amount: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? BODY;
    const wrapped = wrap(clean(label), opts.bold ? fonts.bold : fonts.regular, size, WIDTH - 130);
    const h = wrapped.length * (size * 1.35) + 6;
    wrapped.forEach((wl, i) => w.text(wl, M.left + 6, w.y - size - 2 - i * size * 1.35, { font: opts.bold ? fonts.bold : fonts.regular, size }));
    w.rightText(amount, amtX, w.y - size - 2, { font: opts.bold ? fonts.bold : fonts.regular, size });
    w.y -= h;
  };
  for (const pl of q.priceLines) priceRow(pl.label, formatAud(pl.amountCents));
  w.page.drawLine({ start: { x: M.left, y: w.y - 2 }, end: { x: right, y: w.y - 2 }, thickness: 0.6, color: C.rule });
  w.y -= 4;
  if (q.gstRegistered) {
    priceRow("Subtotal (excluding GST)", formatAud(q.netCents));
    priceRow("GST", formatAud(q.gstCents));
  }
  w.page.drawRectangle({ x: M.left, y: w.y - 24, width: WIDTH, height: 24, color: C.greenTint });
  w.text(q.gstRegistered ? "Total payable (including GST)" : "Total payable", M.left + 8, w.y - 16, { font: fonts.bold, size: 11 });
  w.rightText(formatAud(q.totalCents), amtX, w.y - 16, { font: fonts.bold, size: 12, color: C.green });
  w.y -= 28;
  for (const l of wrap(clean(q.gstStatement), fonts.italic, 8.5, WIDTH)) { w.y -= 8.5 * 1.42; w.text(l, M.left, w.y + 3, { font: fonts.italic, size: 8.5, color: C.muted }); }
  w.y -= 4;
  w.record("price", "price", priceStart);

  // ---------- Inclusions / exclusions / notes ----------
  w.bulletSection("Inclusions", q.inclusions);
  w.bulletSection("Exclusions", q.exclusions);
  if (q.customerNotes.trim()) w.textSection("Notes", q.customerNotes);

  // ---------- Terms ----------
  w.textSection("Deposit and payment terms", `${placeholder(q.depositTerms, "Deposit terms")}\n\n${placeholder(q.paymentTerms, "Payment terms")}`);
  if (format === 2) {
    // Short summary only — the complete warranty is in the separate Warranty Statement.
    w.textSection("Warranty", warrantySummary(q.business.name, q.warrantyText), { labels: false });
  } else {
    w.textSection("Warranty", placeholder(q.warrantyText, "Warranty information"));
  }

  // ---------- Acceptance (never split) ----------
  const acceptParas = [
    ...paragraphs(q.acceptanceText),
    ...(q.business.email.trim() ? [`Written acceptance can also be sent by email to ${q.business.email.trim()}, quoting ${q.reference}.`] : []),
  ];
  const statement = acceptanceStatement(q.reference, formatAud(q.totalCents), q.gstRegistered, q.business.name, format);
  const fieldsHeight = 14 + 26 + 40 + 20;
  const acceptHeight = acceptParas.reduce((h, p) => h + w.paragraphHeight(p), 0) + w.paragraphHeight(statement, { font: fonts.bold }) + fieldsHeight;
  // Normally the whole block (text + signature fields) moves together; only extremely long
  // acceptance text (taller than a page) falls back to normal paragraph breaking.
  const keepAcceptance = HEADING_H + acceptHeight <= USABLE;
  if (keepAcceptance) w.ensure(HEADING_H + acceptHeight);
  w.heading("Customer acceptance", keepAcceptance ? acceptHeight : w.leadHeight(acceptParas[0] ?? statement));
  const acceptTop = w.y;
  acceptParas.forEach((p) => w.paragraph(p, keepAcceptance ? { keep: true } : {}));
  w.ensure(w.paragraphHeight(statement, { font: fonts.bold }) + fieldsHeight);
  w.paragraph(statement, { font: fonts.bold, keep: true, labels: false });
  w.y -= 14;
  const fieldW = (WIDTH - 30) / 2;
  const field = (label: string, x: number, y: number, width: number) => {
    w.page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.6, color: C.muted });
    w.text(label, x, y - 11, { size: 8, color: C.muted });
  };
  w.y -= 26;
  field("Customer name", M.left, w.y, fieldW);
  field("Signature", M.left + fieldW + 30, w.y, fieldW);
  w.y -= 40;
  field("Date", M.left, w.y, fieldW);
  field("Purchase order / reference (optional)", M.left + fieldW + 30, w.y, fieldW);
  w.y -= 20;
  w.record("acceptance", "acceptance", acceptTop);

  // ---------- Footer on every page ----------
  drawFooters(w, `${q.business.name}  |  ABN ${q.business.abn.trim() || "[to be provided]"}  |  Quotation ${q.reference}`,
    status === "draft" ? "DRAFT — NOT AN ISSUED QUOTATION" : null);

  return doc.save();
}
