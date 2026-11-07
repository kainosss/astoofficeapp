import { env, SELF } from "cloudflare:test";
import { seedSql } from "../src/worker/db/seed";

export async function seed() {
  const stmts = seedSql().map((s) => env.DB.prepare(s));
  await env.DB.batch(stmts);
}

export async function resetDb() {
  const tables = ["quote_items", "quote_revisions", "quotes", "package_items", "packages", "equipment", "sites", "customers", "settings", "sequences", "audit_log", "users"];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; host?: string } = {}): Promise<{ status: number; body: T; res: Response }> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const res = await SELF.fetch(`http://${init.host ?? "localhost"}/api${path}`, {
    ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const type = res.headers.get("content-type") || "";
  const body = type.includes("json") ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body: body as T, res };
}

async function inflate(bytes: Uint8Array): Promise<string> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new TextDecoder("latin1").decode(await new Response(stream).arrayBuffer());
  } catch {
    return "";
  }
}

/** Extract all text-bearing content from a PDF (raw + inflated streams) for assertions. */
export async function pdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const raw = new TextDecoder("latin1").decode(bytes);
  const parts = [raw];
  const re = /(?<!end)stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    let stop = end;
    while (stop > start && (bytes[stop - 1] === 0x0a || bytes[stop - 1] === 0x0d)) stop--;
    parts.push(await inflate(bytes.slice(start, stop)));
    re.lastIndex = end;
  }
  return parts.join("\n");
}

/** pdf-lib writes standard-font text as hex strings; search both raw and hex encodings. */
export function textContains(pdf: string, text: string): boolean {
  const hex = Array.from(text).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join("");
  return pdf.includes(text) || pdf.toUpperCase().includes(hex);
}
