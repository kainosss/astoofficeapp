/**
 * Authentication and authorisation.
 *
 * Production: Cloudflare Access sits in front of office.astosec.com. Every request carries a
 * signed JWT (`Cf-Access-Jwt-Assertion` header, or the `CF_Authorization` cookie). We verify it
 * cryptographically against the team's published JWKS, enforcing issuer, audience, expiry and
 * algorithm, then check the email against an explicit administrator allowlist.
 *
 * Development: AUTH_MODE="dev-bypass" signs everyone in as DEV_USER_EMAIL, but ONLY when
 * ENVIRONMENT is not "production" AND the request is to localhost. Any other combination fails closed.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "./env";

export interface AuthUser { email: string; role: "admin"; via: "access" | "dev-bypass" }

export class AuthError extends Error {
  constructor(public status: 401 | 403 | 500, message: string) { super(message); }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const jwksCache = new Map<string, JWTVerifyGetKey>();

function normaliseTeamDomain(domain: string): string {
  const d = domain.trim().replace(/\/+$/, "");
  return d.startsWith("https://") ? d : `https://${d}`;
}

export function adminAllowlist(env: Env): string[] {
  return (env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.startsWith("REPLACE_WITH");
}

function readToken(req: Request): string | null {
  const header = req.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Verify a Cloudflare Access JWT. Exported separately so it can be tested with a local key set. */
export async function verifyAccessJwt(token: string, env: Env, getKey: JWTVerifyGetKey): Promise<AuthUser> {
  const issuer = normaliseTeamDomain(env.ACCESS_TEAM_DOMAIN);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, getKey, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      clockTolerance: 30,
      requiredClaims: ["exp", "iat", "email"],
    }));
  } catch {
    throw new AuthError(401, "Invalid or expired Cloudflare Access token.");
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  const allow = adminAllowlist(env);
  if (!email || !allow.includes(email)) throw new AuthError(403, "This account is not authorised to use ASTO Office.");
  return { email, role: "admin", via: "access" };
}

export async function authenticate(req: Request, env: Env): Promise<AuthUser> {
  const production = env.ENVIRONMENT === "production";

  if (env.AUTH_MODE === "dev-bypass") {
    if (production) throw new AuthError(500, "Development authentication bypass is disabled in production.");
    const host = new URL(req.url).hostname;
    if (!LOCAL_HOSTS.has(host)) throw new AuthError(403, "Development authentication bypass only works on localhost.");
    return { email: env.DEV_USER_EMAIL || "dev@localhost", role: "admin", via: "dev-bypass" };
  }

  if (env.AUTH_MODE !== "access") throw new AuthError(500, "Authentication is not configured.");
  if (isPlaceholder(env.ACCESS_TEAM_DOMAIN) || isPlaceholder(env.ACCESS_AUD) || adminAllowlist(env).length === 0 || (env.ADMIN_EMAILS ?? "").includes("REPLACE_WITH"))
    throw new AuthError(500, "Cloudflare Access is not fully configured (team domain, audience and admin emails are required).");

  const token = readToken(req);
  if (!token) throw new AuthError(401, "Sign in through Cloudflare Access is required.");

  const issuer = normaliseTeamDomain(env.ACCESS_TEAM_DOMAIN);
  let getKey = jwksCache.get(issuer);
  if (!getKey) {
    getKey = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, getKey);
  }
  return verifyAccessJwt(token, env, getKey);
}
