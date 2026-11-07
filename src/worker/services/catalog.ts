import { asc, eq, inArray } from "drizzle-orm";
import type { Equipment, Package, PackageItem } from "../../shared/types";
import { nowIso, schema, type Db } from "../db/client";

type EquipmentRow = typeof schema.equipment.$inferSelect;
type PackageRow = typeof schema.packages.$inferSelect;

export function toEquipment(r: EquipmentRow): Equipment {
  return {
    id: r.id, manufacturer: r.manufacturer, name: r.name, supplier: r.supplier, sku: r.sku, category: r.category,
    kind: r.kind, unit: r.unit, packQuantity: r.packQuantity, costExGstCents: r.costExGstCents,
    costIncGstCents: r.costIncGstCents, markupBp: r.markupBp, sellPriceCents: r.sellPriceCents,
    customerDescription: r.customerDescription, notes: r.notes, isEstimate: r.isEstimate, active: r.active, updatedAt: r.updatedAt,
  };
}

export async function listEquipment(db: Db): Promise<Equipment[]> {
  const rows = await db.select().from(schema.equipment).orderBy(asc(schema.equipment.category), asc(schema.equipment.name)).all();
  return rows.map(toEquipment);
}

export async function getEquipmentMap(db: Db, ids?: number[]): Promise<Map<number, Equipment>> {
  const rows = ids
    ? ids.length ? await db.select().from(schema.equipment).where(inArray(schema.equipment.id, ids)).all() : []
    : await db.select().from(schema.equipment).all();
  return new Map(rows.map((r) => [r.id, toEquipment(r)]));
}

export async function saveEquipment(db: Db, id: number | null, values: Omit<Equipment, "id" | "updatedAt">): Promise<number> {
  if (id === null) {
    const row = await db.insert(schema.equipment).values(values).returning({ id: schema.equipment.id }).get();
    return row.id;
  }
  await db.update(schema.equipment).set({ ...values, updatedAt: nowIso() }).where(eq(schema.equipment.id, id));
  return id;
}

function toPackage(r: PackageRow, items: PackageItem[]): Package {
  return {
    id: r.id, name: r.name, description: r.description, pricingMode: r.pricingMode, fixedPriceCents: r.fixedPriceCents,
    labourHoursCenti: r.labourHoursCenti, labourRateCents: r.labourRateCents, markupBp: r.markupBp, complexityBp: r.complexityBp,
    travelChargeCents: r.travelChargeCents, travelCostCents: r.travelCostCents, consumablesCostCents: r.consumablesCostCents,
    scope: r.scope, inclusions: r.inclusions, exclusions: r.exclusions, notes: r.notes, active: r.active, items,
  };
}

export async function listPackages(db: Db): Promise<Package[]> {
  const pkgs = await db.select().from(schema.packages).orderBy(asc(schema.packages.name)).all();
  const items = await db.select().from(schema.packageItems).orderBy(asc(schema.packageItems.sortOrder)).all();
  const equipment = await getEquipmentMap(db);
  return pkgs.map((p) => toPackage(p, items.filter((i) => i.packageId === p.id).map((i) => ({
    id: i.id, sortOrder: i.sortOrder, role: i.role, equipmentId: i.equipmentId, description: i.description,
    quantityCenti: i.quantityCenti, inPackage: i.inPackage, equipment: i.equipmentId ? equipment.get(i.equipmentId) ?? null : null,
  }))));
}

export async function getPackage(db: Db, id: number): Promise<Package | null> {
  return (await listPackages(db)).find((p) => p.id === id) ?? null;
}

export async function savePackage(db: Db, id: number | null, values: Omit<Package, "id" | "items">, items: Omit<PackageItem, "sortOrder" | "equipment">[]): Promise<number> {
  let pkgId = id;
  if (pkgId === null) {
    pkgId = (await db.insert(schema.packages).values(values).returning({ id: schema.packages.id }).get()).id;
  } else {
    await db.update(schema.packages).set({ ...values, updatedAt: nowIso() }).where(eq(schema.packages.id, pkgId));
  }
  const pid = pkgId;
  const statements = [
    db.delete(schema.packageItems).where(eq(schema.packageItems.packageId, pid)),
    ...items.map((i, idx) => db.insert(schema.packageItems).values({
      packageId: pid, sortOrder: idx, role: i.role, equipmentId: i.role === "included" ? null : i.equipmentId,
      description: i.description, quantityCenti: i.quantityCenti, inPackage: i.inPackage,
    })),
  ];
  await db.batch(statements as [typeof statements[0], ...typeof statements]);
  return pid;
}
