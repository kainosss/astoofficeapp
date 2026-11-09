/**
 * ASTO SECURITY quotation PDF (A4) generated with pdf-lib — runs inside Cloudflare Workers.
 * Input is the CustomerQuote whitelist only, so internal costs can never reach the PDF.
 *
 * Layout rules (page breaks):
 * - A section heading always stays with the start of its content.
 * - Short paragraphs (and each bullet) are kept whole; long paragraphs split with at least
 *   MIN_LINES lines on each side of the break.
 * - Small sections (e.g. deposit and payment terms, price summary) are kept together when they fit.
 * - Bullet lists break only between items, with the heading kept with the first two items.
 * - The customer acceptance block, including signature fields, is never split.
 * - Table rows are never split and the table header repeats on a new page.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts, type RGB } from "pdf-lib";
import { formatAud } from "../../shared/money";
import { splitScopeTitle } from "../../shared/terms";
import type { CustomerQuote } from "../../shared/types";

const A4: [number, number] = [595.28, 841.89];
const M = { left: 50, right: 50, top: 50, bottom: 62 };
const WIDTH = A4[0] - M.left - M.right;
const USABLE = A4[1] - M.top - M.bottom;
/** Paragraphs up to this many lines are never split. */
const KEEP_LINES = 12;
/** Minimum lines either side of a paragraph break (orphan/widow control). */
const MIN_LINES = 3;
/** Sections up to this share of a page are kept on one page. */
const KEEP_SECTION_RATIO = 0.45;

const BODY = 9.5;
const LEADING = BODY * 1.42;
const HEADING_H = 28;

const C = {
  green: rgb(0.122, 0.361, 0.247), // #1F5C3F forest green
  greenTint: rgb(0.93, 0.955, 0.94),
  text: rgb(0.13, 0.15, 0.17),
  muted: rgb(0.40, 0.44, 0.48),
  rule: rgb(0.84, 0.87, 0.89),
  fill: rgb(0.965, 0.97, 0.972),
};

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }

/** Layout event recorded for automated page-break tests. */
export interface LayoutEvent { kind: string; label: string; page: number; top: number; bottom: number }
export interface RenderOptions { onLayout?: (e: LayoutEvent) => void }

function makeSanitiser(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  const map: Record<string, string> = { "−": "-", "‑": "-", " ": " ", " ": " ", " ": " ", "✓": "x", "✔": "x" };
  return (s: string) => Array.from(s.replace(/\t/g, "  ")).map((ch) => {
    if (ch === "\n") return ch;
    if (supported.has(ch.codePointAt(0)!)) return ch;
    return map[ch] ?? "?";
  }).join("");
}

function wrapLine(para: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!para.trim()) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of para.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
    if (line) out.push(line);
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
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return text.split(/\r?\n/).flatMap((p) => wrapLine(p, font, size, maxWidth));
}

/** A laid-out line inside a paragraph block. */
interface Line { text: string; font: PDFFont; indent: number; bullet?: boolean; color?: RGB }

/** "Label: text" at the start of a paragraph (short label, no full stop) is shown as a bold sub-heading. */
function splitLabel(p: string): [string, string] | null {
  const m = p.match(/^([^:.\n]{3,48}):\s+([\s\S]+)$/);
  return m ? [m[1].trim(), m[2]] : null;
}

/** Split free text into paragraphs (blank-line separated). */
function paragraphs(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

class Writer {
  page!: PDFPage;
  y = 0;
  pageTop = 0;
  pages: PDFPage[] = [];
  constructor(
    private doc: PDFDocument,
    public f: Fonts,
    public clean: (s: string) => string,
    private onNewPage: (w: Writer) => void,
    private onLayout?: (e: LayoutEvent) => void,
  ) {
    this.newPage();
  }
  get pageNo() { return this.pages.length; }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - M.top;
    if (this.pages.length > 1) this.onNewPage(this);
    this.pageTop = this.y;
  }
  room() { return this.y - M.bottom; }
  /** Start a new page unless `height` fits in the remaining space (never from the top of a fresh page). */
  ensure(height: number) {
    if (height > this.room() && this.y < this.pageTop - 1) this.newPage();
  }
  record(kind: string, label: string, top: number) {
    this.onLayout?.({ kind, label, page: this.pageNo, top, bottom: this.y });
  }
  text(s: string, x: number, y: number, opts: { font?: PDFFont; size?: number; color?: RGB } = {}) {
    this.page.drawText(this.clean(s), { x, y, font: opts.font ?? this.f.regular, size: opts.size ?? BODY, color: opts.color ?? C.text });
  }
  rightText(s: string, xRight: number, y: number, opts: { font?: PDFFont; size?: number; color?: RGB } = {}) {
    const font = opts.font ?? this.f.regular;
    const size = opts.size ?? BODY;
    const clean = this.clean(s);
    this.page.drawText(clean, { x: xRight - font.widthOfTextAtSize(clean, size), y, font, size, color: opts.color ?? C.text });
  }

  // ---------- Paragraph layout ----------
  /** Lay out a paragraph into lines (handles "Label:" sub-headings and "•" bullet lines). */
  layout(p: string, opts: { font?: PDFFont; color?: RGB; labels?: boolean } = {}): Line[] {
    const font = opts.font ?? this.f.regular;
    const lines: Line[] = [];
    let body = this.clean(p);
    const label = opts.labels !== false ? splitLabel(body) : null;
    if (label) {
      lines.push({ text: label[0], font: this.f.bold, indent: 0 });
      body = label[1];
    }
    for (const src of body.split("\n")) {
      const bullet = /^\s*[•\-*]\s+/.test(src);
      const content = bullet ? src.replace(/^\s*[•\-*]\s+/, "") : src;
      const indent = bullet ? 14 : 0;
      wrapLine(content, font, BODY, WIDTH - indent).forEach((t, i) =>
        lines.push({ text: t, font, indent, bullet: bullet && i === 0, color: opts.color }));
    }
    return lines;
  }
  linesHeight(lines: Line[]) { return lines.length * LEADING; }
  private drawLine(l: Line) {
    this.y -= LEADING;
    if (l.bullet) this.page.drawCircle({ x: M.left + 4, y: this.y + 6, size: 1.6, color: C.green });
    if (l.text) this.text(l.text, M.left + l.indent, this.y + 3, { font: l.font, color: l.color });
  }
  /** Draw a paragraph with keep-together and orphan/widow control. */
  paragraph(p: string, opts: { font?: PDFFont; color?: RGB; labels?: boolean; keep?: boolean; gapAfter?: number } = {}) {
    let lines = this.layout(p, opts);
    const keep = opts.keep ?? lines.length <= KEEP_LINES;
    const top = this.y;
    let startPage = this.pageNo;
    if (keep || lines.length < MIN_LINES * 2) {
      this.ensure(this.linesHeight(lines));
      startPage = this.pageNo;
      const t = this.y;
      lines.forEach((l) => this.drawLine(l));
      this.onLayout?.({ kind: "paragraph", label: p.slice(0, 40), page: startPage, top: t, bottom: this.y });
    } else {
      while (lines.length) {
        const fit = Math.floor(this.room() / LEADING);
        if (fit >= lines.length) { lines.forEach((l) => this.drawLine(l)); lines = []; break; }
        const take = Math.min(fit, lines.length - MIN_LINES);
        if (take < MIN_LINES) { this.newPage(); continue; }
        lines.slice(0, take).forEach((l) => this.drawLine(l));
        lines = lines.slice(take);
        this.newPage();
      }
      this.onLayout?.({ kind: "split-paragraph", label: p.slice(0, 40), page: startPage, top, bottom: this.y });
    }
    this.y -= opts.gapAfter ?? 4;
  }
  /** Height a paragraph would take if kept together (used to keep small sections whole). */
  paragraphHeight(p: string, opts: { font?: PDFFont; labels?: boolean } = {}) {
    return this.linesHeight(this.layout(p, opts)) + 4;
  }
  /** Minimum height that must follow a heading: the whole first block if short, else its first lines. */
  leadHeight(p: string, opts: { labels?: boolean } = {}) {
    const n = this.layout(p, opts).length;
    return (n <= KEEP_LINES ? n : MIN_LINES) * LEADING + 4;
  }

  // ---------- Headings ----------
  /** Draw a section heading, ensuring `following` points of content fit beneath it. */
  heading(s: string, following: number) {
    this.ensure(HEADING_H + following);
    const top = this.y;
    this.y -= 20;
    this.text(s.toUpperCase(), M.left, this.y, { font: this.f.bold, size: 9, color: C.green });
    this.y -= 5;
    this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: M.left + WIDTH, y: this.y }, thickness: 0.6, color: C.rule });
    this.y -= 3;
    this.record("heading", s, top);
  }
  /** A text section: heading + paragraphs; kept on one page when small enough. */
  textSection(title: string, text: string, opts: { labels?: boolean } = {}) {
    const paras = paragraphs(text);
    if (!paras.length) return;
    const total = paras.reduce((h, p) => h + this.paragraphHeight(p, opts), 0);
    if (total + HEADING_H <= USABLE * KEEP_SECTION_RATIO) this.ensure(total + HEADING_H);
    this.heading(title, this.leadHeight(paras[0], opts));
    paras.forEach((p) => this.paragraph(p, opts));
  }
  bulletSection(title: string, items: string[]) {
    if (!items.length) return;
    // Lists may break between items; the heading always stays with at least the first two items.
    this.heading(title, items.slice(0, 2).reduce((h, i) => h + this.bulletHeight(i), 0));
    for (const item of items) {
      this.ensure(this.bulletHeight(item));
      const top = this.y;
      const label = splitLabel(this.clean(item));
      if (label) {
        this.y -= LEADING;
        this.page.drawCircle({ x: M.left + 4, y: this.y + 6, size: 1.6, color: C.green });
        this.text(label[0], M.left + 14, this.y + 3, { font: this.f.bold });
        for (const l of wrap(label[1], this.f.regular, BODY, WIDTH - 14)) { this.y -= LEADING; this.text(l, M.left + 14, this.y + 3); }
        this.y -= 3;
      } else {
        wrap(this.clean(item), this.f.regular, BODY, WIDTH - 14).forEach((l, i) => {
          this.y -= LEADING;
          if (i === 0) this.page.drawCircle({ x: M.left + 4, y: this.y + 6, size: 1.6, color: C.green });
          this.text(l, M.left + 14, this.y + 3);
        });
      }
      this.record("bullet", item.slice(0, 40), top);
    }
  }
  bulletHeight(item: string) {
    const label = splitLabel(this.clean(item));
    if (label) return LEADING + wrap(label[1], this.f.regular, BODY, WIDTH - 14).length * LEADING + 3;
    return wrap(this.clean(item), this.f.regular, BODY, WIDTH - 14).length * LEADING;
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

const STATUS_TITLE: Record<CustomerQuote["status"], string> = {
  draft: "QUOTATION — DRAFT", sent: "QUOTATION", accepted: "QUOTATION — ACCEPTED", declined: "QUOTATION — DECLINED", expired: "QUOTATION — EXPIRED",
};


export async function renderQuotePdf(q: CustomerQuote, options: RenderOptions = {}): Promise<Uint8Array> {
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

  const status = q.status ?? (q.isDraft ? "draft" : "sent");
  const continuationHeader = (w: Writer) => {
    w.text(q.business.name, M.left, w.y - 4, { font: w.f.bold, size: 10, color: C.green });
    const label = status === "sent" ? "" : ` (${STATUS_TITLE[status].replace("QUOTATION — ", "")})`;
    w.rightText(`Quotation ${q.reference}${label}`, M.left + WIDTH, w.y - 4, { size: 9, color: C.muted });
    w.y -= 12;
    w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: M.left + WIDTH, y: w.y }, thickness: 1, color: C.green });
    w.y -= 6;
  };
  const w = new Writer(doc, fonts, clean, continuationHeader, options.onLayout);
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

  w.rightText(STATUS_TITLE[status], right, top - 18, { font: fonts.bold, size: 16, color: C.text });
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
    lines.forEach((l, i) => wrap(clean(l), i === 0 ? fonts.bold : fonts.regular, BODY, colW).forEach((wl) => {
      w.text(wl, x, y, { font: i === 0 ? fonts.bold : fonts.regular }); y -= 13;
    }));
    return y;
  };
  w.y = Math.min(drawCol(custLines, M.left), drawCol(siteLines, M.left + WIDTH / 2 + 10)) - 4;

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
  w.textSection("Warranty", placeholder(q.warrantyText, "Warranty information"));

  // ---------- Acceptance (never split) ----------
  const acceptParas = [
    ...paragraphs(q.acceptanceText),
    ...(q.business.email.trim() ? [`Written acceptance can also be sent by email to ${q.business.email.trim()}, quoting ${q.reference}.`] : []),
  ];
  const statement = `I accept quotation ${q.reference} for a total of ${formatAud(q.totalCents)}${q.gstRegistered ? " including GST" : ""}.`;
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
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    const y = M.bottom - 30;
    page.drawLine({ start: { x: M.left, y: y + 12 }, end: { x: right, y: y + 12 }, thickness: 0.5, color: C.rule });
    const left = clean(`${q.business.name}  |  ABN ${q.business.abn.trim() || "[to be provided]"}  |  Quotation ${q.reference}`);
    page.drawText(left, { x: M.left, y, font: fonts.regular, size: 7.5, color: C.muted });
    const pn = `Page ${i + 1} of ${total}`;
    page.drawText(pn, { x: right - fonts.regular.widthOfTextAtSize(pn, 7.5), y, font: fonts.regular, size: 7.5, color: C.muted });
    if (status === "draft") {
      const d = "DRAFT — NOT AN ISSUED QUOTATION";
      page.drawText(d, { x: M.left + WIDTH / 2 - fonts.bold.widthOfTextAtSize(d, 7.5) / 2, y: y - 11, font: fonts.bold, size: 7.5, color: C.muted });
    }
  });

  return doc.save();
}
