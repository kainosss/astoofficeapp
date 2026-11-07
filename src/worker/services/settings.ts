import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "../../shared/quoteBuilder";
import type { Settings } from "../../shared/types";
import { nowIso, schema, type Db } from "../db/client";

export async function getSettings(db: Db): Promise<Settings> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  if (row) {
    const { id: _id, ...rest } = row;
    return rest;
  }
  await db.insert(schema.settings).values({ id: 1, ...DEFAULT_SETTINGS }).onConflictDoNothing();
  return { ...DEFAULT_SETTINGS };
}

export async function updateSettings(db: Db, values: Omit<Settings, "updatedAt">): Promise<Settings> {
  await getSettings(db);
  await db.update(schema.settings).set({ ...values, updatedAt: nowIso() }).where(eq(schema.settings.id, 1));
  return getSettings(db);
}

export async function audit(db: Db, actor: string, action: string, entity = "", entityId: string | number = "", detail = "") {
  await db.insert(schema.auditLog).values({ actor, action, entity, entityId: String(entityId), detail });
}
