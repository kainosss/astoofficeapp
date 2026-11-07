import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema } from "../db/client";
import { getPackage, listEquipment, listPackages, saveEquipment, savePackage, toEquipment } from "../services/catalog";
import { HttpError } from "../services/quotes";
import type { AppEnv } from "../types";
import { equipmentSchema, packageSchema } from "../validation";
import { parseId, validate } from "./util";

export const equipmentRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listEquipment(c.var.db)))
  .get("/:id", async (c) => {
    const row = await c.var.db.select().from(schema.equipment).where(eq(schema.equipment.id, parseId(c.req.param("id")))).get();
    if (!row) throw new HttpError(404, "Equipment not found.");
    return c.json(toEquipment(row));
  })
  .post("/", validate("json", equipmentSchema), async (c) => c.json({ id: await saveEquipment(c.var.db, null, c.req.valid("json")) }, 201))
  .put("/:id", validate("json", equipmentSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const exists = await c.var.db.select({ id: schema.equipment.id }).from(schema.equipment).where(eq(schema.equipment.id, id)).get();
    if (!exists) throw new HttpError(404, "Equipment not found.");
    return c.json({ id: await saveEquipment(c.var.db, id, c.req.valid("json")) });
  });

export const packageRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listPackages(c.var.db)))
  .get("/:id", async (c) => {
    const pkg = await getPackage(c.var.db, parseId(c.req.param("id")));
    if (!pkg) throw new HttpError(404, "Package not found.");
    return c.json(pkg);
  })
  .post("/", validate("json", packageSchema), async (c) => {
    const { items, ...values } = c.req.valid("json");
    return c.json({ id: await savePackage(c.var.db, null, values, items) }, 201);
  })
  .put("/:id", validate("json", packageSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    if (!(await getPackage(c.var.db, id))) throw new HttpError(404, "Package not found.");
    const { items, ...values } = c.req.valid("json");
    return c.json({ id: await savePackage(c.var.db, id, values, items) });
  });
