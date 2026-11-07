/**
 * ASTO SECURITY quotation PDF (A4) generated with pdf-lib — runs inside Cloudflare Workers.
 * Input is the CustomerQuote whitelist only, so internal costs can never reach the PDF.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts, type RGB } from "pdf-lib";
import { formatAud } from "../../shared/money";
import type { CustomerQuote } from "../../shared/types";

const A4: [number, number] = [595.28, 841.89];
const M = { left: 50, right: 50, top: 50, bottom: 62 };
const WIDTH = A4[0] - M.left - M.right;

const C = {
  green: rgb(0.122, 0.361, 0.247), // #1F5C3F forest green
  greenTint: rgb(0.93, 0.955, 0.94),
  text: rgb(0.13, 0.15, 0.17),
  muted: rgb(0.40, 0.44, 0.48),
  rule: rgb(0.84, 0.87, 0.89),
  fill: rgb(0.965, 0.97, 0.972),
};

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }

function makeSanitiser(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  const map: Record<string, string> = { "−": "-", "‑": "-", " ": " ", " ": " ", " ": " ", "✓": "x", "✔": "x" };
  return (s: string) => Array.from(s.replace(/\t/g, "  ")).map((ch) => {
    if (ch === "\n") return ch;
    if (supported.has(ch.codePointAt(0)!)) return ch;
    return map[ch] ?? "?";
  }).join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      // Break very long words.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth) {
        let i = w.length;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > maxWidth) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(private doc: PDFDocument, public f: Fonts, public clean: (s: string) => string, private onNewPage: (w: Writer) => void) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - M.top;
    if (this.pages.length > 1) this.onNewPage(this);
  }
  ensure(height: number) {
    if (this.y - height < M.bottom) this.newPage();
  }
  text(s: string, x: number, y: number, opts: { font?: PDFFont; size?: number; color?: RGB } = {}) {
    this.page.drawText(this.clean(s), { x, y, font: opts.font ?? this.f.regular, size: opts.size ?? 9.5, color: opts.color ?? C.text });
  }
  rightText(s: string, xRight: number, y: number, opts: { font?: PDFFont; size?: number; color?: RGB } = {}) {
    const font = opts.font ?? this.f.regular;
    const size = opts.size ?? 9.5;
    const clean = this.clean(s);
    this.page.drawText(clean, { x: xRight - font.widthOfTextAtSize(clean, size), y, font, size, color: opts.color ?? C.text });
  }
  /** Wrapped paragraph flowing across pages. */
  paragraph(s: string, opts: { font?: PDFFont; size?: number; color?: RGB; indent?: number; width?: number; leading?: number } = {}) {
    const font = opts.font ?? this.f.regular;
    const size = opts.size ?? 9.5;
    const leading = opts.leading ?? size * 1.42;
    const x = M.left + (opts.indent ?? 0);
    for (const line of wrap(this.clean(s), font, size, (opts.width ?? WIDTH) - (opts.indent ?? 0))) {
      this.ensure(leading);
      this.y -= leading;
      if (line) this.text(line, x, this.y + 3, { font, size, color: opts.color });
    }
  }
  heading(s: string) {
    this.ensure(46);
    this.y -= 20;
    this.text(s.toUpperCase(), M.left, this.y, { font: this.f.bold, size: 9, color: C.green });
    this.y -= 5;
    this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: M.left + WIDTH, y: this.y }, thickness: 0.6, color: C.rule });
    this.y -= 3;
  }
  bullets(items: string[]) {
    for (const item of items) {
      const lines = wrap(this.clean(item), this.f.regular, 9.5, WIDTH - 14);
      lines.forEach((line, i) => {
        this.ensure(13.5);
        this.y -= 13.5;
        if (i === 0) this.page.drawCircle({ x: M.left + 4, y: this.y + 6, size: 1.6, color: C.green });
        this.text(line, M.left + 14, this.y + 3);
      });
    }
  }
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; type: "png" | "jpeg" } | null {
  const m = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] as "png" | "jpeg" };
}

const placeholder = (v: string, label: string) => (v.trim() ? v.trim() : `[${label} to be provided]`);

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

export async function renderQuotePdf(q: CustomerQuote): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${q.business.name} Quotation ${q.reference}`);
  doc.setAuthor(q.business.name);
  doc.setSubject(q.title);
  doc.setCreator("ASTO Office");
  doc.setProducer("ASTO Office");

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const clean = makeSanitiser(fonts.regular);

  let logo: PDFImage | null = null;
  if (q.business.logoDataUrl) {
    const decoded = decodeDataUrl(q.business.logoDataUrl);
    try {
      if (decoded) logo = decoded.type === "png" ? await doc.embedPng(decoded.bytes) : await doc.embedJpg(decoded.bytes);
    } catch { logo = null; }
  }

  const continuationHeader = (w: Writer) => {
    w.text(q.business.name, M.left, w.y - 4, { font: w.f.bold, size: 10, color: C.green });
    w.rightText(`Quotation ${q.reference}${q.isDraft ? " (DRAFT)" : ""}`, M.left + WIDTH, w.y - 4, { size: 9, color: C.muted });
    w.y -= 12;
    w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: M.left + WIDTH, y: w.y }, thickness: 1, color: C.green });
    w.y -= 6;
  };
  const w = new Writer(doc, fonts, clean, continuationHeader);
  const right = M.left + WIDTH;

  // ---------- Header ----------
  const top = w.y;
  if (logo) {
    const scale = Math.min(150 / logo.width, 56 / logo.height, 1);
    const lw = logo.width * scale, lh = logo.height * scale;
    w.page.drawImage(logo, { x: M.left, y: top - lh, width: lw, height: lh });
    w.y = top - lh - 8;
  } else {
    w.text(q.business.name, M.left, top - 20, { font: fonts.bold, size: 20, color: C.green });
    w.y = top - 32;
  }
  const bizLines = [
    q.business.abn.trim() ? `ABN ${q.business.abn.trim()}` : "ABN [to be provided]",
    q.business.address.trim(),
    [q.business.phone.trim(), q.business.email.trim()].filter(Boolean).join("  |  ") || "[Contact details to be provided]",
    q.business.website.trim(),
  ].filter(Boolean);
  for (const line of bizLines) { w.text(line, M.left, w.y, { size: 8.5, color: C.muted }); w.y -= 11.5; }

  w.rightText(q.isDraft ? "QUOTATION — DRAFT" : "QUOTATION", right, top - 18, { font: fonts.bold, size: 16, color: C.text });
  const meta: [string, string][] = [["Quote number", q.reference], ["Issue date", formatDate(q.issueDate)], ["Valid until", formatDate(q.expiryDate)]];
  meta.forEach(([k, v], i) => {
    const y = top - 38 - i * 13;
    w.rightText(v, right, y, { font: fonts.bold, size: 9 });
    w.rightText(k, right - 95, y, { size: 9, color: C.muted });
  });
  w.y = Math.min(w.y, top - 38 - meta.length * 13) - 6;
  w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: right, y: w.y }, thickness: 1.2, color: C.green });
  w.y -= 18;

  // ---------- Customer and site ----------
  const colW = WIDTH / 2 - 10;
  const blockTop = w.y;
  w.text("PREPARED FOR", M.left, w.y, { font: fonts.bold, size: 8, color: C.green });
  w.text("INSTALLATION ADDRESS", M.left + WIDTH / 2 + 10, w.y, { font: fonts.bold, size: 8, color: C.green });
  const custLines = [q.customer.name, q.customer.contactPerson && q.customer.contactPerson !== q.customer.name ? `Attn: ${q.customer.contactPerson}` : "", q.customer.phone, q.customer.email].filter(Boolean);
  const siteLines = q.site ? [q.site.address, [q.site.suburb, q.site.state, q.site.postcode].filter(Boolean).join(" ")].filter(Boolean) : ["To be confirmed"];
  const drawCol = (lines: string[], x: number) => {
    let y = blockTop - 14;
    lines.forEach((l, i) => wrap(clean(l), i === 0 ? fonts.bold : fonts.regular, 9.5, colW).forEach((wl) => {
      w.text(wl, x, y, { font: i === 0 ? fonts.bold : fonts.regular }); y -= 13;
    }));
    return y;
  };
  w.y = Math.min(drawCol(custLines, M.left), drawCol(siteLines, M.left + WIDTH / 2 + 10)) - 4;

  // ---------- Title & scope ----------
  if (q.title) { w.ensure(30); w.y -= 14; w.paragraph(q.title, { font: fonts.bold, size: 12.5 }); }
  if (q.scope.trim()) { w.heading("Scope of works"); w.paragraph(q.scope); }

  // ---------- Equipment table ----------
  if (q.lines.length) {
    w.heading("Equipment and materials");
    const qtyX = right - 8;
    const rowH = 15;
    w.ensure(rowH * 2);
    w.page.drawRectangle({ x: M.left, y: w.y - rowH, width: WIDTH, height: rowH, color: C.fill });
    w.text("Description", M.left + 6, w.y - 10.5, { font: fonts.bold, size: 8.5, color: C.muted });
    w.rightText("Quantity", qtyX, w.y - 10.5, { font: fonts.bold, size: 8.5, color: C.muted });
    w.y -= rowH;
    for (const line of q.lines) {
      const prefix = line.included ? "    " : "";
      const descW = WIDTH - 110 - (line.included ? 14 : 0);
      const font = line.included ? fonts.regular : fonts.regular;
      const wrapped = wrap(clean(line.description), font, 9.5, descW);
      const tag = line.included ? "Included in kit" : line.extra ? "Additional" : "";
      const h = Math.max(1, wrapped.length) * 12.5 + 5;
      w.ensure(h);
      wrapped.forEach((wl, i) => w.text(prefix + wl, M.left + 6, w.y - 11 - i * 12.5, { font, color: line.included ? C.muted : C.text }));
      const qty = line.unit && line.unit !== "each" ? `${line.quantity} ${line.unit}` : line.quantity;
      w.rightText(qty, qtyX, w.y - 11, { color: line.included ? C.muted : C.text });
      if (tag) w.rightText(tag, qtyX - 60, w.y - 11, { font: fonts.italic, size: 8, color: C.muted });
      w.y -= h;
      w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: right, y: w.y }, thickness: 0.4, color: C.rule });
    }
  }

  // ---------- Pricing ----------
  w.heading("Price");
  const amtX = right - 8;
  const priceRow = (label: string, amount: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 9.5;
    const wrapped = wrap(clean(label), opts.bold ? fonts.bold : fonts.regular, size, WIDTH - 130);
    const h = wrapped.length * (size * 1.35) + 6;
    w.ensure(h);
    wrapped.forEach((wl, i) => w.text(wl, M.left + 6, w.y - size - 2 - i * size * 1.35, { font: opts.bold ? fonts.bold : fonts.regular, size }));
    w.rightText(amount, amtX, w.y - size - 2, { font: opts.bold ? fonts.bold : fonts.regular, size });
    w.y -= h;
  };
  for (const pl of q.priceLines) priceRow(pl.label, formatAud(pl.amountCents));
  w.ensure(60);
  w.page.drawLine({ start: { x: M.left, y: w.y - 2 }, end: { x: right, y: w.y - 2 }, thickness: 0.6, color: C.rule });
  w.y -= 4;
  if (q.gstRegistered) {
    priceRow("Subtotal (excluding GST)", formatAud(q.netCents));
    priceRow("GST", formatAud(q.gstCents));
  }
  w.ensure(28);
  w.page.drawRectangle({ x: M.left, y: w.y - 24, width: WIDTH, height: 24, color: C.greenTint });
  w.text(q.gstRegistered ? "Total payable (including GST)" : "Total payable", M.left + 8, w.y - 16, { font: fonts.bold, size: 11 });
  w.rightText(formatAud(q.totalCents), amtX, w.y - 16, { font: fonts.bold, size: 12, color: C.green });
  w.y -= 28;
  w.paragraph(q.gstStatement, { size: 8.5, color: C.muted, font: fonts.italic });

  // ---------- Inclusions / exclusions ----------
  if (q.inclusions.length) { w.heading("Inclusions"); w.bullets(q.inclusions); }
  if (q.exclusions.length) { w.heading("Exclusions"); w.bullets(q.exclusions); }
  if (q.customerNotes.trim()) { w.heading("Notes"); w.paragraph(q.customerNotes); }

  // ---------- Terms ----------
  w.heading("Deposit and payment terms");
  w.paragraph(placeholder(q.depositTerms, "Deposit terms"));
  w.y -= 4;
  w.paragraph(placeholder(q.paymentTerms, "Payment terms"));
  w.heading("Warranty");
  w.paragraph(placeholder(q.warrantyText, "Warranty information"));

  // ---------- Acceptance (kept together) ----------
  const acceptLines = wrap(clean(q.acceptanceText || ""), fonts.regular, 9.5, WIDTH).length;
  w.ensure(46 + acceptLines * 13.5 + 120);
  w.heading("Customer acceptance");
  if (q.acceptanceText.trim()) w.paragraph(q.acceptanceText);
  w.paragraph(`I accept quotation ${q.reference} for a total of ${formatAud(q.totalCents)}${q.gstRegistered ? " including GST" : ""}.`, { font: fonts.bold });
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

  // ---------- Footer on every page ----------
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    const y = M.bottom - 30;
    page.drawLine({ start: { x: M.left, y: y + 12 }, end: { x: right, y: y + 12 }, thickness: 0.5, color: C.rule });
    const left = clean(`${q.business.name}  |  ABN ${q.business.abn.trim() || "[to be provided]"}  |  Quotation ${q.reference}`);
    page.drawText(left, { x: M.left, y, font: fonts.regular, size: 7.5, color: C.muted });
    const pn = `Page ${i + 1} of ${total}`;
    page.drawText(pn, { x: right - fonts.regular.widthOfTextAtSize(pn, 7.5), y, font: fonts.regular, size: 7.5, color: C.muted });
    if (q.isDraft) {
      const d = "DRAFT — NOT AN ISSUED QUOTATION";
      page.drawText(d, { x: M.left + WIDTH / 2 - fonts.bold.widthOfTextAtSize(d, 7.5) / 2, y: y - 11, font: fonts.bold, size: 7.5, color: C.muted });
    }
  });

  return doc.save();
}
