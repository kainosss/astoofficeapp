// Pre-deploy safety check for the production Worker configuration. Runs locally; contacts nothing.
import { readFileSync } from "node:fs";

function stripJsonc(text) {
  let out = "", inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === "\\") { out += n; i++; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const cfg = JSON.parse(stripJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")));
const prod = cfg.env?.production ?? {};
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };

check(prod.name === "asto-office", "env.production.name must be asto-office");
check(prod.workers_dev === false && cfg.workers_dev === false, "workers_dev must be false (top level and production)");
check(prod.preview_urls === false && cfg.preview_urls === false, "preview_urls must be false (top level and production)");
check(prod.vars?.ENVIRONMENT === "production", "ENVIRONMENT must be production");
check(prod.vars?.AUTH_MODE === "access", "AUTH_MODE must be access");
check(!prod.vars?.DEV_USER_EMAIL, "DEV_USER_EMAIL must be empty in production");
for (const k of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ADMIN_EMAILS"])
  check(!(k in (prod.vars ?? {})), `${k} must be a secret (wrangler secret put ${k} --env production), not a plain var`);
const db = prod.d1_databases?.[0];
check(db?.database_name === "asto-office-prod", "production D1 database must be asto-office-prod");
check(db?.database_id && /^[0-9a-f-]{36}$/.test(db.database_id) && !/^0{8}-/.test(db.database_id), "production D1 database_id is not set (run wrangler d1 create first)");
const routes = prod.routes ?? [];
check(routes.length === 1 && routes[0].pattern === "office.astosec.com" && routes[0].custom_domain === true, "production must route only the custom domain office.astosec.com");

if (problems.length) {
  console.error("Production configuration is NOT ready:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("Production configuration checks passed.");
