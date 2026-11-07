export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** "development" | "test" | "production" */
  ENVIRONMENT: string;
  /** "access" (Cloudflare Access JWT verification) or "dev-bypass" (local development only). */
  AUTH_MODE: string;
  DEV_USER_EMAIL: string;
  /** e.g. https://yourteam.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN: string;
  /** Cloudflare Access application audience (AUD) tag. */
  ACCESS_AUD: string;
  /** Comma-separated administrator email allowlist. */
  ADMIN_EMAILS: string;
}
