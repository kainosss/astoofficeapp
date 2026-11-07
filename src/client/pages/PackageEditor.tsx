import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { calculatePricing } from "../../shared/pricing";
import { formatAud } from "../../shared/money";
import { itemsFromPackage, pricingFrom, toPricingItems } from "../../shared/quoteBuilder";
import type { Equipment, Package, PackageItem, Settings } from "../../shared/types";
import { api } from "../api";
import { DecimalInput, Field, Icon, Loading, MoneyInput, PageHeader, PercentInput, useLoad, useToast } from "../components/ui";
import { SummaryPanel } from "./QuoteBuilder";

type PkgInput = Omit<Package, "id">;
const blank: PkgInput = {
  name: "", description: "", pricingMode: "fixed", fixedPriceCents: null, labourHoursCenti: 600, labourRateCents: null, markupBp: null,
  complexityBp: 10000, travelChargeCents: 0, travelCostCents: 0, consumablesCostCents: 0, scope: "", inclusions: "", exclusions: "", notes: "", active: true, items: [],
};

export function PackageEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const toast = useToast();
  const eq = useLoad(() => api.get<Equipment[]>("/equipment"));
  const settings = useLoad(() => api.get<Settings>("/settings"));
  const [pkg, setPkg] = useState<PkgInput | null>(isNew ? { ...blank } : null);
  const [addId, setAddId] = useState("");
  useEffect(() => { if (!isNew) api.get<Package>(`/packages/${id}`).then(({ id: _id, ...p }) => setPkg(p)).catch((e) => toast(e.message, "error")); }, [id, isNew, toast]);

  const preview = useMemo(() => {
    if (!pkg || !eq.data || !settings.data) return null;
    const eqMap = new Map(eq.data.map((e) => [e.id, e]));
    const full = { ...pkg, id: 0 } as Package;
    const pricing = pricingFrom(settings.data, full);
    return { totals: calculatePricing(toPricingItems(itemsFromPackage(full, eqMap)), pricing), pricing };
  }, [pkg, eq.data, settings.data]);

  if (!pkg || !eq.data || !settings.data || !preview) return <Loading error={eq.error || settings.error} />;
  const set = (patch: Partial<PkgInput>) => setPkg({ ...pkg, ...patch });
  const setItem = (i: number, patch: Partial<PackageItem>) => set({ items: pkg.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const eqById = new Map(eq.data.map((e) => [e.id, e]));
  const fixed = pkg.pricingMode === "fixed";

  const save = async () => {
    const body = { ...pkg, items: pkg.items.map(({ role, equipmentId, description, quantityCenti, inPackage }) => ({ role, equipmentId, description, quantityCenti, inPackage })) };
    try {
      if (isNew) { const r = await api.post<{ id: number }>("/packages", body); toast("Package created."); nav(`/packages/${r.id}`, { replace: true }); }
      else { await api.put(`/packages/${id}`, body); toast("Package saved."); }
    } catch (e) { toast((e as Error).message, "error"); }
  };

  return (
    <>
      <PageHeader title={isNew ? "New package" : pkg.name || "Package"} sub="Changes apply to new quotations only."
        actions={<><button className="btn" onClick={() => nav("/packages")}>Back</button><button className="btn primary" disabled={!pkg.name.trim()} onClick={save}>Save package</button></>} />
      <div className="builder">
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <div className="card"><div className="card-body grid g4">
            <Field label="Package name" className="span2"><input value={pkg.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Pricing">
              <select value={pkg.pricingMode} onChange={(e) => set({ pricingMode: e.target.value as PkgInput["pricingMode"] })}><option value="fixed">Fixed package price</option><option value="calculated">Calculated from items</option></select>
            </Field>
            <Field label="Package selling price" hint={fixed ? "Starting customer price" : "Not used for calculated pricing"}><MoneyInput value={pkg.fixedPriceCents} allowEmpty disabled={!fixed} onChange={(v) => set({ fixedPriceCents: v })} /></Field>
            <Field label="Description" className="span-all"><input value={pkg.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Installation allowance"><DecimalInput value={pkg.labourHoursCenti} onChange={(v) => set({ labourHoursCenti: v ?? 0 })} suffix="h" /></Field>
            <Field label="Labour rate" hint={`Blank = ${formatAud(settings.data.labourRateCents)}/h`}><MoneyInput value={pkg.labourRateCents} allowEmpty onChange={(v) => set({ labourRateCents: v })} /></Field>
            <Field label="Markup" hint="Blank = business default"><PercentInput value={pkg.markupBp} allowEmpty onChange={(v) => set({ markupBp: v })} /></Field>
            <Field label="Complexity multiplier"><DecimalInput value={pkg.complexityBp / 100} onChange={(v) => set({ complexityBp: Math.round((v ?? 100) * 100) })} suffix="×" /></Field>
            <Field label="Travel charge"><MoneyInput value={pkg.travelChargeCents} onChange={(v) => set({ travelChargeCents: v ?? 0 })} /></Field>
            <Field label="Travel cost (internal)"><MoneyInput value={pkg.travelCostCents} onChange={(v) => set({ travelCostCents: v ?? 0 })} /></Field>
            <Field label="Consumables cost"><MoneyInput value={pkg.consumablesCostCents} onChange={(v) => set({ consumablesCostCents: v ?? 0 })} /></Field>
            <label className="check" style={{ alignSelf: "end", paddingBottom: 8 }}><input type="checkbox" checked={pkg.active} onChange={(e) => set({ active: e.target.checked })} />Active</label>
          </div></div>

          <div className="card">
            <div className="card-head"><h2>Package contents</h2><span className="muted small">Kit components are listed for the customer but carry no cost — the kit price covers them.</span></div>
            <div className="table-wrap"><table className="table items">
              <thead><tr><th>Item</th><th style={{ width: 110 }} className="num">Qty</th>{fixed && <th style={{ width: 70 }}>In price</th>}<th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {pkg.items.map((it, i) => {
                  const e = it.equipmentId ? eqById.get(it.equipmentId) : undefined;
                  return (
                    <tr key={i} className={it.role === "included" ? "included" : ""}>
                      <td className="desc">
                        {it.role === "included"
                          ? <><input value={it.description} onChange={(ev) => setItem(i, { description: ev.target.value })} aria-label="Component description" /><div className="sub"><span className="badge kit">Included in kit — no cost</span></div></>
                          : <><select value={it.equipmentId ?? ""} onChange={(ev) => setItem(i, { equipmentId: Number(ev.target.value) })} aria-label="Equipment">
                              {eq.data!.map((x) => <option key={x.id} value={x.id}>{[x.manufacturer, x.name].filter(Boolean).join(" ")}</option>)}
                            </select>
                            {e && <div className="sub">{formatAud(settings.data!.gstRegistered ? e.costExGstCents : e.costIncGstCents)} {e.packQuantity > 1 ? `per ${e.packQuantity} ${e.unit}` : "each"}{e.isEstimate && <> <span className="badge estimate">Estimate</span></>}</div>}</>}
                      </td>
                      <td><DecimalInput value={it.quantityCenti} onChange={(v) => setItem(i, { quantityCenti: v ?? 0 })} suffix={e && e.unit !== "each" ? e.unit : undefined} /></td>
                      {fixed && <td style={{ textAlign: "center" }}>{it.role === "priced" && <input type="checkbox" checked={it.inPackage} onChange={(ev) => setItem(i, { inPackage: ev.target.checked })} aria-label="Included in package price" />}</td>}
                      <td><button className="btn ghost icon sm" onClick={() => set({ items: pkg.items.filter((_, idx) => idx !== i) })} aria-label="Remove"><Icon name="trash" /></button></td>
                    </tr>
                  );
                })}
                {pkg.items.length === 0 && <tr><td colSpan={4} className="empty">No contents yet.</td></tr>}
              </tbody>
            </table></div>
            <div className="toolbar" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>
              <select value={addId} onChange={(e) => setAddId(e.target.value)} style={{ maxWidth: 360 }} aria-label="Add equipment">
                <option value="">Add equipment…</option>
                {eq.data.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.category} — {[e.manufacturer, e.name].filter(Boolean).join(" ")}</option>)}
              </select>
              <button className="btn sm" disabled={!addId} onClick={() => { set({ items: [...pkg.items, { sortOrder: pkg.items.length, role: "priced", equipmentId: Number(addId), description: "", quantityCenti: 100, inPackage: true }] }); setAddId(""); }}><Icon name="plus" />Add</button>
              <span className="grow" />
              <button className="btn sm ghost" onClick={() => set({ items: [...pkg.items, { sortOrder: pkg.items.length, role: "included", equipmentId: null, description: "Kit component", quantityCenti: 100, inPackage: true }] })}><Icon name="plus" />Kit component</button>
            </div>
          </div>

          <div className="card"><div className="card-head"><h2>Default quotation text</h2></div><div className="card-body grid g2">
            <Field label="Scope of works" className="span2"><textarea rows={4} value={pkg.scope} onChange={(e) => set({ scope: e.target.value })} /></Field>
            <Field label="Inclusions" hint="Blank = standard inclusions from Settings"><textarea rows={4} value={pkg.inclusions} onChange={(e) => set({ inclusions: e.target.value })} /></Field>
            <Field label="Exclusions" hint="Blank = standard exclusions from Settings"><textarea rows={4} value={pkg.exclusions} onChange={(e) => set({ exclusions: e.target.value })} /></Field>
            <Field label="Internal notes" className="span2"><textarea rows={2} value={pkg.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </div></div>
        </div>
        <aside className="summary"><SummaryPanel totals={preview.totals} pricing={preview.pricing} /></aside>
      </div>
    </>
  );
}
