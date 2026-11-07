# ASTO Office — Production Deployment

Target: `https://office.astosec.com`, Cloudflare Workers + D1, protected by Cloudflare Access.
Nothing in this guide touches the public `astosec.com` website, existing DNS records or Google Workspace.

## What production looks like

| Item | Setting |
| --- | --- |
| Worker | `asto-office` (`wrangler deploy --env production`) |
| Hostname | `office.astosec.com` only (Workers Custom Domain) |
| `*.workers.dev` / preview URLs | **Disabled** (`workers_dev: false`, `preview_urls: false`) — they would not be behind Access |
| Database | D1 `asto-office-db-prod`, location hint `oc` (Oceania), created empty; schema from `migrations/` |
| Auth | Cloudflare Access (one-time PIN to your email) **and** in-Worker JWT verification + admin allowlist |
| Config | `ENVIRONMENT=production`, `AUTH_MODE=access` (committed); `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS` as **encrypted secrets** (not in git) |
| Logs | Workers Logs enabled (errors only are logged; no customer data is logged deliberately) |

Safety rails already in the code:
- If any Access secret is missing, every API request returns HTTP 500 with no data (fails closed).
- The development bypass is refused when `ENVIRONMENT=production`, and only ever works on `localhost`.
- Identity headers such as `Cf-Access-Authenticated-User-Email` are ignored; only a signed, verified JWT counts.
- `npm run deploy` refuses to deploy unless `npm run deploy:check` passes (no workers.dev, no preview URLs, Access mode, secrets not in plain vars, real D1 id, custom domain only), then runs all tests and builds.
- The migration contains no data. Seed data can only be loaded with `--local`; there is no production seed script.

## Costs to approve

| Service | Plan | Cost |
| --- | --- | --- |
| Workers | **Workers Paid (recommended)** | US$5/month minimum (includes 10M requests and 30M CPU-ms per month; this app will use a tiny fraction) |
| | Workers Free (not recommended) | $0, but **10 ms CPU per request**. Measured PDF generation is ~6 ms warm for a typical quote and ~13 ms for a 60-line quote, plus cold-start overhead, so PDF downloads would fail intermittently. |
| D1 | Included with either plan | $0 at this scale (Free: 5M rows read/day, 100k rows written/day, 5 GB). Time Travel point-in-time restore: 7 days (Free) / 30 days (Paid). |
| Cloudflare Zero Trust (Access) | Free plan | $0 for up to 50 users. Cloudflare may ask for a payment method when you activate Zero Trust, even on the Free plan. |
| Custom domain | — | $0 (requires `astosec.com` to be an active zone in the same Cloudflare account) |

Check Cloudflare's current pricing pages before approving; figures above are as understood at the time of writing.

## Checklist

**Y** = you, in the Cloudflare dashboard. **C** = Claude can run it after your approval and with Cloudflare credentials (or you can run the same command yourself).

### A. Decisions and dashboard set-up (before anything is created)

1. **Y — Confirm the zone.** Cloudflare dashboard → `astosec.com` → DNS → Records: confirm the zone is active in this account and that **no `office` record exists**. Change nothing.
2. **Y — Choose the Workers plan.** Workers & Pages → Plans: upgrade to Workers Paid (US$5/month) — recommended — or accept the Free-plan PDF risk.
3. **Y — Enable Zero Trust (Free).** Zero Trust → choose a team name. Your team domain will be `https://<team>.cloudflareaccess.com`.
4. **Y — Login method.** Zero Trust → Settings → Authentication: use **One-time PIN** (codes emailed to you). This avoids any Google Workspace changes.
5. **Y — Create the Access application** (do this *before* deployment so the hostname is protected from the first second):
   - Access → Applications → Add → **Self-hosted**. Name: `ASTO Office`.
   - Public hostname: subdomain `office`, domain `astosec.com`, path empty (whole site).
   - Session duration: 24 hours (or shorter).
   - Identity providers: **One-time PIN only**; enable "Instant Auth" if offered.
   - Policy: name `ASTO admin`, Action **Allow**, Include → **Emails** → *your authorised email address* (only that one). Add no other rules. **Do not** add any Bypass or Service Auth policy, and do not use "Everyone".
   - Save, then open the application and copy the **Application Audience (AUD) Tag**.
6. **Y — Send Claude** (or keep for yourself): the team domain, the AUD tag, and the authorised email. These go into Worker secrets, not into git.
7. **Y — Credentials for deployment (choose one):**
   - (a) Run the C-steps yourself on your computer after `npx wrangler login`; or
   - (b) Create an API token (My Profile → API Tokens → "Edit Cloudflare Workers" template; ensure it includes Workers Scripts Edit, D1 Edit, and Workers Routes/custom-domain rights for the `astosec.com` zone; restrict it to your account and that zone; short expiry). Claude will request it through the session's secure credential form — never paste it into chat.

### B. Create and deploy (each step needs your explicit approval)

8. **C — Create the database:** `npx wrangler d1 create asto-office-db-prod --location=oc`. Put the returned `database_id` into `wrangler.jsonc` → `env.production.d1_databases[0].database_id`, and commit.
9. **C — Apply the schema (empty database):** `npm run db:migrate:prod`. Verify it is empty:
   `npx wrangler d1 execute asto-office-db-prod --env production --remote --command "SELECT (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM quotes) AS quotes"` → both `0`.
10. **C — Deploy:** `npm run deploy` (config check → tests → build → `wrangler deploy --env production`).
    ⚠️ This attaches the Custom Domain `office.astosec.com`, which **creates one DNS record (`office`) in the `astosec.com` zone**. No other record is touched. Requires your DNS approval.
    Until step 11 the API returns HTTP 500 (fails closed); Access already blocks the hostname.
11. **C — Set secrets** (values from step 6):
    `npx wrangler secret put ACCESS_TEAM_DOMAIN --env production`
    `npx wrangler secret put ACCESS_AUD --env production`
    `npx wrangler secret put ADMIN_EMAILS --env production`

### C. Verify (no further changes)

12. **C — Unauthenticated check:** `curl -s -o /dev/null -w "%{http_code}\n" https://office.astosec.com/api/me` → a 302 redirect or 401/403 from Access, **never** app data.
13. **Y — Sign in** at `https://office.astosec.com` in a private window: Access login → enter email → PIN → app loads. The sidebar shows your email and **no** yellow "development" badge.
14. **Y — Dashboard check:** Workers & Pages → `asto-office` → Settings → Domains & Routes: `workers.dev` **Disabled**, Preview URLs **Disabled**, custom domain `office.astosec.com` active.
15. **Y — First use:** Settings → enter business name, ABN, phone, email, address, logo, deposit/payment/warranty terms; review overhead, warranty, owner-labour and threshold assumptions. Equipment → add the catalogue (the production database starts empty — no fictional customers or sample quotes).
16. **Y — Smoke test:** create a customer and quote, save, preview, download the PDF, then take a backup (Settings → Full backup).

### D. Backups and operations

- **In-app:** Settings → Full backup (JSON) and CSV exports. Store privately (contains customer data and supplier pricing).
- **Database dump:** `npm run backup:prod` (writes `backups/asto-office-prod-<timestamp>.sql`, git-ignored).
- **Point-in-time restore:** `npx wrangler d1 time-travel info asto-office-db-prod --env production` / `... time-travel restore ...` (7 days Free, 30 days Paid).
- **Schema changes later:** `npm run db:generate` → review SQL → `npm run db:migrate:prod` → `npm run deploy`.
- **Rotate access:** edit the Access policy email and `ADMIN_EMAILS` together.
