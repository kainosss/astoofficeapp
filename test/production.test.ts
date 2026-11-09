/**
 * Runs the real Worker app with PRODUCTION settings against every API route, verifying
 * that nothing is reachable without a valid Cloudflare Access token for an allowlisted admin.
 */
import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/worker/env";
import { app } from "../src/worker/index";
import { resetDb, seed } from "./helpers";

const TEAM = "https://asto-prod-test.cloudflareaccess.com";
const AUD = "prod-audience-tag";
const HOST = "https://office.astosec.com";

const prodEnv = (over: Partial<Env> = {}): Env => ({
  DB: env.DB, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
  ENVIRONMENT: "production", AUTH_MODE: "access", DEV_USER_EMAIL: "",
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@astosec.example", ...over,
});

const ROUTES: [string, string, unknown?][] = [
  ["GET", "/api/me"], ["GET", "/api/settings"], ["PUT", "/api/settings", {}],
  ["GET", "/api/customers"], ["POST", "/api/customers", { kind: "individual", name: "X" }], ["GET", "/api/customers/1"],
  ["PUT", "/api/customers/1", {}], ["POST", "/api/customers/1/sites", {}], ["PUT", "/api/customers/1/sites/1", {}], ["DELETE", "/api/customers/1/sites/1"],
  ["GET", "/api/equipment"], ["GET", "/api/equipment/1"], ["POST", "/api/equipment", {}], ["PUT", "/api/equipment/1", {}],
  ["GET", "/api/packages"], ["GET", "/api/packages/1"], ["POST", "/api/packages", {}], ["PUT", "/api/packages/1", {}],
  ["GET", "/api/quotes"], ["POST", "/api/quotes", {}], ["GET", "/api/quotes/template"], ["GET", "/api/quotes/1"], ["DELETE", "/api/quotes/2"],
  ["PUT", "/api/quotes/1/revisions/1", {}], ["POST", "/api/quotes/1/revisions/1/status", { status: "accepted" }],
  ["POST", "/api/quotes/1/revise", {}], ["POST", "/api/quotes/1/duplicate", {}],
  ["GET", "/api/quotes/1/revisions/1/customer"], ["GET", "/api/quotes/1/revisions/1/pdf"],
  ["GET", "/api/quotes/1/revisions/1/warranty-pdf"], ["GET", "/api/quotes/1/revisions/1/documents-pdf"],
  ["GET", "/api/dashboard"], ["GET", "/api/export/backup.json"], ["GET", "/api/export/customers.csv"],
  ["GET", "/api/export/quotes.csv"], ["GET", "/api/export/equipment.csv"], ["GET", "/api/does-not-exist"],
];

async function call(method: string, path: string, e: Env, body?: unknown, headers: Record<string, string> = {}, host = HOST) {
  const h = new Headers(headers);
  if (body !== undefined) h.set("content-type", "application/json");
  return app.fetch(new Request(`${host}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), e);
}

let privateKey: CryptoKey;
let jwks: unknown;
const sign = (email: string, aud = AUD) => new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "prod-k1" })
  .setIssuer(TEAM).setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(privateKey);

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "prod-k1", alg: "RS256" }] };
});

beforeEach(async () => {
  await resetDb();
  await seed();
  // Serve the test key set at the team's certs URL; refuse every other outbound request.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `${TEAM}/cdn-cgi/access/certs`) return Response.json(jwks);
    throw new Error(`Unexpected outbound fetch: ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("production: every API route requires valid Access authentication", () => {
  it("fails closed (500, no data) when Access secrets are missing", async () => {
    const e = prodEnv({ ACCESS_TEAM_DOMAIN: undefined as unknown as string, ACCESS_AUD: undefined as unknown as string, ADMIN_EMAILS: undefined as unknown as string });
    for (const [m, p, b] of ROUTES) {
      const res = await call(m, p, e, b, { "cf-access-jwt-assertion": await sign("owner@astosec.example") });
      expect(res.status, `${m} ${p}`).toBe(500);
      expect(await res.json(), `${m} ${p}`).toEqual({ error: expect.stringContaining("not fully configured") });
    }
  });

  it("returns 401 for every route without a token", async () => {
    for (const [m, p, b] of ROUTES) expect((await call(m, p, prodEnv(), b)).status, `${m} ${p}`).toBe(401);
  });

  it("ignores spoofable identity headers", async () => {
    const headers = { "cf-access-authenticated-user-email": "owner@astosec.example", "x-forwarded-email": "owner@astosec.example" };
    for (const [m, p, b] of ROUTES) expect((await call(m, p, prodEnv(), b, headers)).status, `${m} ${p}`).toBe(401);
  });

  it("returns 401 for tokens issued for another Access application", async () => {
    const token = await sign("owner@astosec.example", "another-app");
    for (const [m, p, b] of ROUTES) expect((await call(m, p, prodEnv(), b, { "cf-access-jwt-assertion": token })).status, `${m} ${p}`).toBe(401);
  });

  it("returns 403 for valid Access users who are not on the admin allowlist", async () => {
    const token = await sign("someone.else@example.com");
    for (const [m, p, b] of ROUTES) expect((await call(m, p, prodEnv(), b, { "cf-access-jwt-assertion": token })).status, `${m} ${p}`).toBe(403);
  });

  it("refuses the development bypass in production, even on localhost", async () => {
    const e = prodEnv({ AUTH_MODE: "dev-bypass", DEV_USER_EMAIL: "dev@localhost" });
    for (const [m, p, b] of ROUTES) expect((await call(m, p, e, b, {}, "http://localhost")).status, `${m} ${p}`).toBe(500);
  });

  it("allows the authorised administrator (header or Access cookie)", async () => {
    const token = await sign("Owner@astosec.example");
    const me = await call("GET", "/api/me", prodEnv(), undefined, { "cf-access-jwt-assertion": token });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "owner@astosec.example", via: "access", environment: "production" });
    const viaCookie = await call("GET", "/api/customers", prodEnv(), undefined, { cookie: `CF_Authorization=${token}` });
    expect(viaCookie.status).toBe(200);
    const pdf = await call("GET", "/api/quotes/1/revisions/1/pdf", prodEnv(), undefined, { cookie: `CF_Authorization=${token}` });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
  });

  it("persists quotations for the authorised administrator", async () => {
    const auth = { "cf-access-jwt-assertion": await sign("owner@astosec.example") };
    const created = await call("POST", "/api/quotes", prodEnv(), { customerId: 1, siteId: 1, packageId: 1 }, auth);
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: number };
    const read = await call("GET", `/api/quotes/${id}`, prodEnv(), undefined, auth);
    expect(read.status).toBe(200);
  });

  it("still rejects cross-site writes from an authenticated browser", async () => {
    const auth = { cookie: `CF_Authorization=${await sign("owner@astosec.example")}`, origin: "https://evil.example" };
    expect((await call("POST", "/api/customers", prodEnv(), { kind: "individual", name: "X" }, auth)).status).toBe(403);
  });
});
