import type { MiddlewareHandler } from "hono";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "SAMEORIGIN");
    h.set("Referrer-Policy", "no-referrer");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (c.req.path.startsWith("/api/")) h.set("Cache-Control", "no-store");
  };
}

/** Reject cross-site state-changing requests (defence in depth on top of Access + JSON-only bodies). */
export function sameOriginWrites(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = c.req.header("origin");
      const self = new URL(c.req.url).origin;
      if (origin && origin !== self) return c.json({ error: "Cross-origin request refused." }, 403);
      const secFetchSite = c.req.header("sec-fetch-site");
      if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none")
        return c.json({ error: "Cross-site request refused." }, 403);
    }
    await next();
  };
}
