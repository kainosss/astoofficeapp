/**
 * Shared A4 layout engine for ASTO SECURITY documents (quotation and warranty statement),
 * so both documents use identical typography, colours, margins, headers, footers and page-break rules.
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
export { PDFDocument };

export const A4: [number, number] = [595.28, 841.89];
export const M = { left: 50, right: 50, top: 50, bottom: 62 };
export const WIDTH = A4[0] - M.left - M.right;
export const USABLE = A4[1] - M.top - M.bottom;
/** Paragraphs up to this many lines are never split. */
const KEEP_LINES = 12;
/** Minimum lines either side of a paragraph break (orphan/widow control). */
const MIN_LINES = 3;
/** Sections up to this share of a page are kept on one page. */
const KEEP_SECTION_RATIO = 0.45;

export const BODY = 9.5;
export const LEADING = BODY * 1.42;
export const HEADING_H = 28;

export const C = {
  green: rgb(0.122, 0.361, 0.247), // #1F5C3F forest green
  greenTint: rgb(0.93, 0.955, 0.94),
  text: rgb(0.13, 0.15, 0.17),
  muted: rgb(0.40, 0.44, 0.48),
  rule: rgb(0.84, 0.87, 0.89),
  fill: rgb(0.965, 0.97, 0.972),
};

export interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }

/** Layout event recorded for automated page-break tests. */
export interface LayoutEvent { kind: string; label: string; page: number; top: number; bottom: number }
export interface RenderOptions { onLayout?: (e: LayoutEvent) => void }

export function makeSanitiser(font: PDFFont) {
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

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return text.split(/\r?\n/).flatMap((p) => wrapLine(p, font, size, maxWidth));
}

/** A laid-out line inside a paragraph block. */
interface Line { text: string; font: PDFFont; indent: number; bullet?: boolean; color?: RGB }

/** "Label: text" at the start of a paragraph (short label, no full stop) is shown as a bold sub-heading. */
export function splitLabel(p: string): [string, string] | null {
  const m = p.match(/^([^:.\n]{3,48}):\s+([\s\S]+)$/);
  return m ? [m[1].trim(), m[2]] : null;
}

/** Split free text into paragraphs (blank-line separated). */
export function paragraphs(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export class Writer {
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

export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; type: "png" | "jpeg" } | null {
  const m = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] as "png" | "jpeg" };
}

export const placeholder = (v: string, label: string) => (v.trim() ? v.trim() : `[${label} to be provided]`);

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}


/** Party block used by both documents. */
export interface DocParty {
  business: { name: string; abn: string; email: string; phone: string; address: string; website: string; logoDataUrl: string | null };
  customer: { name: string; contactPerson: string; email: string; phone: string };
  site: { address: string; suburb: string; state: string; postcode: string } | null;
}

/** Create a document with embedded fonts and (optional) logo. */
export async function createDocument(meta: { title: string; author: string; subject: string }, logoDataUrl: string | null) {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setCreator("ASTO Office");
  doc.setProducer("ASTO Office");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const clean = makeSanitiser(fonts.regular);
  let logo: PDFImage | null = null;
  if (logoDataUrl) {
    const decoded = decodeDataUrl(logoDataUrl);
    try {
      if (decoded) logo = decoded.type === "png" ? await doc.embedPng(decoded.bytes) : await doc.embedJpg(decoded.bytes);
    } catch { logo = null; }
  }
  return { doc, fonts, clean, logo };
}

/** Continuation header for pages 2+: business name left, document label right, green rule. */
export function continuationHeader(businessName: string, rightLabel: string) {
  return (w: Writer) => {
    w.text(businessName, M.left, w.y - 4, { font: w.f.bold, size: 10, color: C.green });
    w.rightText(rightLabel, M.left + WIDTH, w.y - 4, { size: 9, color: C.muted });
    w.y -= 12;
    w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: M.left + WIDTH, y: w.y }, thickness: 1, color: C.green });
    w.y -= 6;
  };
}

/** First-page header: logo or business name with business details on the left; title and meta on the right. */
export function drawDocumentHeader(w: Writer, logo: PDFImage | null, business: DocParty["business"], title: string, meta: [string, string][]) {
  const right = M.left + WIDTH;
  const top = w.y;
  if (logo) {
    const scale = Math.min(150 / logo.width, 56 / logo.height, 1);
    const lw = logo.width * scale, lh = logo.height * scale;
    w.page.drawImage(logo, { x: M.left, y: top - lh, width: lw, height: lh });
    w.y = top - lh - 8;
  } else {
    w.text(business.name, M.left, top - 20, { font: w.f.bold, size: 20, color: C.green });
    w.y = top - 32;
  }
  const bizLines = [
    business.abn.trim() ? `ABN ${business.abn.trim()}` : "ABN [to be provided]",
    business.address.trim(),
    [business.phone.trim(), business.email.trim()].filter(Boolean).join("  |  ") || "[Contact details to be provided]",
    business.website.trim(),
  ].filter(Boolean);
  for (const line of bizLines) { w.text(line, M.left, w.y, { size: 8.5, color: C.muted }); w.y -= 11.5; }

  w.rightText(title, right, top - 18, { font: w.f.bold, size: 16, color: C.text });
  meta.forEach(([k, v], i) => {
    const y = top - 38 - i * 13;
    // Long values are shortened so they never collide with their label or the business details.
    let value = w.clean(v);
    while (value.length > 4 && w.f.bold.widthOfTextAtSize(value, 9) > 200) value = value.slice(0, -2).trimEnd() + "…";
    w.rightText(value, right, y, { font: w.f.bold, size: 9 });
    const labelRight = right - Math.max(95, w.f.bold.widthOfTextAtSize(value, 9) + 12);
    w.rightText(k, labelRight, y, { size: 9, color: C.muted });
  });
  w.y = Math.min(w.y, top - 38 - meta.length * 13) - 6;
  w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: right, y: w.y }, thickness: 1.2, color: C.green });
  w.y -= 18;
}

/** "Prepared for" / "Installation address" two-column block. */
export function drawParties(w: Writer, p: DocParty, leftTitle = "PREPARED FOR") {
  const colW = WIDTH / 2 - 10;
  const blockTop = w.y;
  w.text(leftTitle, M.left, w.y, { font: w.f.bold, size: 8, color: C.green });
  w.text("INSTALLATION ADDRESS", M.left + WIDTH / 2 + 10, w.y, { font: w.f.bold, size: 8, color: C.green });
  const custLines = [p.customer.name, p.customer.contactPerson && p.customer.contactPerson !== p.customer.name ? `Attn: ${p.customer.contactPerson}` : "", p.customer.phone, p.customer.email].filter(Boolean);
  const siteLines = p.site ? [p.site.address, [p.site.suburb, p.site.state, p.site.postcode].filter(Boolean).join(" ")].filter(Boolean) : ["To be confirmed"];
  const drawCol = (lines: string[], x: number) => {
    let y = blockTop - 14;
    lines.forEach((l, i) => wrap(w.clean(l), i === 0 ? w.f.bold : w.f.regular, BODY, colW).forEach((wl) => {
      w.text(wl, x, y, { font: i === 0 ? w.f.bold : w.f.regular }); y -= 13;
    }));
    return y;
  };
  w.y = Math.min(drawCol(custLines, M.left), drawCol(siteLines, M.left + WIDTH / 2 + 10)) - 4;
}

/** Footer on every page: business | ABN | document reference, page x of y, optional draft notice. */
export function drawFooters(w: Writer, leftText: string, draftNotice: string | null) {
  const right = M.left + WIDTH;
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    const y = M.bottom - 30;
    page.drawLine({ start: { x: M.left, y: y + 12 }, end: { x: right, y: y + 12 }, thickness: 0.5, color: C.rule });
    page.drawText(w.clean(leftText), { x: M.left, y, font: w.f.regular, size: 7.5, color: C.muted });
    const pn = `Page ${i + 1} of ${total}`;
    page.drawText(pn, { x: right - w.f.regular.widthOfTextAtSize(pn, 7.5), y, font: w.f.regular, size: 7.5, color: C.muted });
    if (draftNotice) {
      page.drawText(draftNotice, { x: M.left + WIDTH / 2 - w.f.bold.widthOfTextAtSize(draftNotice, 7.5) / 2, y: y - 11, font: w.f.bold, size: 7.5, color: C.muted });
    }
  });
}
