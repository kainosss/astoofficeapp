import { Hono } from "hono";
import { audit, getSettings, updateSettings } from "../services/settings";
import type { AppEnv } from "../types";
import { settingsSchema } from "../validation";
import { validate } from "./util";

export const settingsRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await getSettings(c.var.db)))
  .put("/", validate("json", settingsSchema), async (c) => {
    const body = c.req.valid("json");
    const saved = await updateSettings(c.var.db, body);
    await audit(c.var.db, c.var.user.email, "settings.update", "settings", 1);
    return c.json(saved);
  });
