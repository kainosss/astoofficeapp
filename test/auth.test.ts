import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticate, AuthError, verifyAccessJwt } from "../src/worker/auth";
import type { Env } from "../src/worker/env";

const TEAM = "https://asto-test.cloudflareaccess.com";
const AUD = "test-audience-tag";

const accessEnv = (over: Partial<Env> = {}): Env => ({
  DB: undefined as unknown as D1Database, ASSETS: undefined as unknown as Fetcher, ENVIRONMENT: "production", AUTH_MODE: "access",
  DEV_USER_EMAIL: "", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@astosec.example, Second@Example.com", ...over,
});

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  otherKey = (await generateKeyPair("RS256")).privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

async function token(claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: string | number; key?: CryptoKey } = {}) {
  return new SignJWT({ email: "owner@astosec.example", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

async function expectAuthError(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toBeInstanceOf(AuthError);
  await p.catch((e: AuthError) => expect(e.status).toBe(status));
}

describe("Cloudflare Access JWT verification", () => {
  it("accepts a valid token for an allowlisted administrator", async () => {
    const user = await verifyAccessJwt(await token(), accessEnv(), jwks);
    expect(user).toEqual({ email: "owner@astosec.example", role: "admin", via: "access" });
  });
  it("matches the allowlist case-insensitively", async () => {
    const user = await verifyAccessJwt(await token({ email: "second@example.com" }), accessEnv(), jwks);
    expect(user.email).toBe("second@example.com");
  });
  it("rejects the wrong audience", async () => {
    await expectAuthError(verifyAccessJwt(await token({}, { aud: "other-app" }), accessEnv(), jwks), 401);
  });
  it("rejects the wrong issuer", async () => {
    await expectAuthError(verifyAccessJwt(await token({}, { iss: "https://evil.cloudflareaccess.com" }), accessEnv(), jwks), 401);
  });
  it("rejects expired tokens", async () => {
    await expectAuthError(verifyAccessJwt(await token({}, { exp: Math.floor(Date.now() / 1000) - 3600 }), accessEnv(), jwks), 401);
  });
  it("rejects tokens signed by an unknown key", async () => {
    await expectAuthError(verifyAccessJwt(await token({}, { key: otherKey }), accessEnv(), jwks), 401);
  });
  it("rejects unsigned / HMAC tokens", async () => {
    const hs = await new SignJWT({ email: "owner@astosec.example" }).setProtectedHeader({ alg: "HS256" }).setIssuer(TEAM).setAudience(AUD)
      .setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode("x".repeat(32)));
    await expectAuthError(verifyAccessJwt(hs, accessEnv(), jwks), 401);
    const none = "eyJhbGciOiJub25lIn0." + btoa(JSON.stringify({ email: "owner@astosec.example", iss: TEAM, aud: AUD })).replace(/=/g, "") + ".";
    await expectAuthError(verifyAccessJwt(none, accessEnv(), jwks), 401);
  });
  it("rejects valid identities that are not administrators", async () => {
    await expectAuthError(verifyAccessJwt(await token({ email: "someone@else.com" }), accessEnv(), jwks), 403);
  });
  it("rejects tokens without an email claim", async () => {
    await expectAuthError(verifyAccessJwt(await token({ email: undefined }), accessEnv(), jwks), 401);
  });
});

describe("authentication configuration", () => {
  const req = (url = "https://office.astosec.com/api/me", headers: Record<string, string> = {}) => new Request(url, { headers });

  it("refuses the development bypass in production", async () => {
    await expectAuthError(authenticate(req("http://localhost/api/me"), accessEnv({ AUTH_MODE: "dev-bypass" })), 500);
  });
  it("refuses the development bypass on non-local hosts", async () => {
    await expectAuthError(authenticate(req(), accessEnv({ ENVIRONMENT: "development", AUTH_MODE: "dev-bypass" })), 403);
  });
  it("fails closed with unknown auth modes", async () => {
    await expectAuthError(authenticate(req(), accessEnv({ AUTH_MODE: "" })), 500);
  });
  it("fails closed when Access is not configured", async () => {
    await expectAuthError(authenticate(req(), accessEnv({ ACCESS_AUD: "REPLACE_WITH_ACCESS_AUD_TAG" })), 500);
    await expectAuthError(authenticate(req(), accessEnv({ ADMIN_EMAILS: "" })), 500);
    await expectAuthError(authenticate(req(), accessEnv({ ACCESS_TEAM_DOMAIN: "" })), 500);
  });
  it("requires a token", async () => {
    await expectAuthError(authenticate(req(), accessEnv()), 401);
  });
  it("does not trust a bare email header", async () => {
    await expectAuthError(authenticate(req(undefined, { "cf-access-authenticated-user-email": "owner@astosec.example" }), accessEnv()), 401);
  });
});
