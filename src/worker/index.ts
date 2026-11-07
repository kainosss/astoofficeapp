import { Hono } from "hono";
import { authenticate, AuthError } from "./auth";
import { getDb } from "./db/client";
import type { Env } from "./env";
import { equipmentRoutes, packageRoutes } from "./routes/catalog";
import { customerRoutes } from "./routes/customers";
import { dashboardRoutes } from "./routes/dashboard";
import { exportRoutes } from "./routes/exports";
import { quoteRoutes } from "./routes/quotes";
import { settingsRoutes } from "./routes/settings";
import { sameOriginWrites, securityHeaders } from "./security";
import { HttpError } from "./services/quotes";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("*", securityHeaders());

app.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error("Unhandled error", err);
  return c.json({ error: "An unexpected error occurred." }, 500);
});

const api = new Hono<AppEnv>();

// Every API route requires an authenticated, authorised administrator.
api.use("*", async (c, next) => {
  const user = await authenticate(c.req.raw, c.env);
  c.set("user", user);
  c.set("db", getDb(c.env.DB));
  await next();
});
api.use("*", sameOriginWrites());

api.get("/me", (c) => c.json({ email: c.var.user.email, role: c.var.user.role, via: c.var.user.via, environment: c.env.ENVIRONMENT }));
api.route("/settings", settingsRoutes);
api.route("/customers", customerRoutes);
api.route("/equipment", equipmentRoutes);
api.route("/packages", packageRoutes);
api.route("/quotes", quoteRoutes);
api.route("/dashboard", dashboardRoutes);
api.route("/export", exportRoutes);
api.all("*", (c) => c.json({ error: "Not found." }, 404));

app.route("/api", api);

// Everything else is the single-page app (static assets).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
