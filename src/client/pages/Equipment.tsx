import { useMemo, useState } from "react";
import { applyBp, formatAud, formatBp, roundDiv } from "../../shared/money";
import type { Equipment as Eq, Settings } from "../../shared/types";
import { api } from "../api";
import { Field, Icon, Loading, Modal, MoneyInput, PageHeader, PercentInput, useLoad, useToast } from "../components/ui";

type EqInput = Omit<Eq, "id" | "updatedAt">;
const blank: EqInput = {
  manufacturer: "", name: "", supplier: "Tradezone", sku: "", category: "Cameras", kind: "equipment", unit: "each", packQuantity: 1,
  costExGstCents: 0, costIncGstCents: 0, markupBp: null, sellPriceCents: null, customerDescription: "", notes: "", isEstimate: true, active: true,
};

/** Suggested selling price per unit on the current cost basis. */
export function suggestedSell(e: Pick<Eq, "costExGstCents" | "costIncGstCents" | "packQuantity" | "markupBp" | "sellPriceCents">, s: Settings): number {
  if (e.sellPriceCents !== null) return e.sellPriceCents;
  const basis = s.gstRegistered ? e.costExGstCents : e.costIncGstCents;
  return applyBp(roundDiv(basis, Math.max(1, e.packQuantity)), 10000 + (e.markupBp ?? s.defaultMarkupBp));
}

export function Equipment() {
  const list = useLoad(() => api.get<Eq[]>("/equipment"));
  const settings = useLoad(() => api.get<Settings>("/settings"));
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<{ id: number | null; value: EqInput } | null>(null);
  const toast = useToast();

  const categories = useMemo(() => [...new Set((list.data ?? []).map((e) => e.category))].sort(), [list.data]);
  if (!list.data || !settings.data) return <Loading error={list.error || settings.error} />;
  const s = settings.data;
  const rows = list.data.filter((e) => (showInactive || e.active) && (!cat || e.category === cat) &&
    (!q || [e.manufacturer, e.name, e.sku, e.supplier, e.category].join(" ").toLowerCase().includes(q.toLowerCase())));

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await api.put(`/equipment/${editing.id}`, editing.value); else await api.post(`/equipment`, editing.value);
      setEditing(null); toast("Equipment saved."); void list.reload();
    } catch (e) { toast((e as Error).message, "error"); }
  };
  const v = editing?.value;
  const set = (patch: Partial<EqInput>) => editing && setEditing({ ...editing, value: { ...editing.value, ...patch } });

  return (
    <>
      <PageHeader title="Equipment" sub={<>Supplier purchase costs and selling prices. Cost basis: <b>{s.gstRegistered ? "excluding GST (GST-registered)" : "including GST (not GST-registered)"}</b>.</>}
        actions={<>
          <a className="btn" href="/api/export/equipment.csv"><Icon name="download" />Export CSV</a>
          <button className="btn primary" onClick={() => setEditing({ id: null, value: { ...blank } })}><Icon name="plus" />Add equipment</button>
        </>} />
      <div className="card">
        <div className="toolbar">
          <input type="search" placeholder="Search product, SKU, manufacturer or supplier" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search equipment" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <label className="check small"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th className="hide-sm">Supplier / SKU</th><th className="hide-sm">Category</th><th className="num">Cost ex GST</th><th className="num">Cost inc GST</th><th className="num">Markup</th><th className="num">Suggested sell</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setEditing({ id: e.id, value: { ...e } })}>
                  <td><strong>{[e.manufacturer, e.name].filter(Boolean).join(" ")}</strong>
                    {e.isEstimate && <span className="badge estimate" style={{ marginLeft: 6 }}>Estimate</span>}
                    {!e.active && <span className="badge neutral" style={{ marginLeft: 6 }}>Inactive</span>}
                    <div className="sub">{e.customerDescription}</div></td>
                  <td className="hide-sm">{e.supplier || "—"}<div className="sub mono">{e.sku}</div></td>
                  <td className="hide-sm">{e.category}</td>
                  <td className="num">{formatAud(e.costExGstCents)}{e.packQuantity > 1 && <div className="sub">per {e.packQuantity} {e.unit}</div>}</td>
                  <td className="num">{formatAud(e.costIncGstCents)}</td>
                  <td className="num">{e.sellPriceCents !== null ? <span className="muted">fixed</span> : formatBp(e.markupBp ?? s.defaultMarkupBp)}{e.markupBp === null && e.sellPriceCents === null && <div className="sub">default</div>}</td>
                  <td className="num">{formatAud(suggestedSell(e, s))}{e.unit !== "each" && <div className="sub">per {e.unit}</div>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="empty">No equipment found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editing && v && (
        <Modal title={editing.id ? "Edit equipment" : "Add equipment"} wide onClose={() => setEditing(null)} footer={<>
          <label className="check small" style={{ marginRight: "auto" }}><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />Active</label>
          <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn primary" disabled={!v.name.trim()} onClick={save}>Save</button>
        </>}>
          <div className="grid g4">
            <Field label="Manufacturer"><input value={v.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} /></Field>
            <Field label="Product name" className="span2"><input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Category"><input list="eq-cats" value={v.category} onChange={(e) => set({ category: e.target.value })} /><datalist id="eq-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Supplier"><input value={v.supplier} onChange={(e) => set({ supplier: e.target.value })} /></Field>
            <Field label="Supplier SKU"><input value={v.sku} onChange={(e) => set({ sku: e.target.value })} className="mono" /></Field>
            <Field label="Type"><select value={v.kind} onChange={(e) => set({ kind: e.target.value as EqInput["kind"] })}><option value="equipment">Equipment</option><option value="material">Material / cable</option></select></Field>
            <Field label="Unit" hint="e.g. each, m"><input value={v.unit} onChange={(e) => set({ unit: e.target.value })} /></Field>
            <Field label="Units per purchase" hint="e.g. 305 for a 305 m box"><input type="number" min={1} value={v.packQuantity} onChange={(e) => set({ packQuantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></Field>
            <Field label="Purchase price ex GST" hint="Per purchase unit"><MoneyInput value={v.costExGstCents} onChange={(c) => set({ costExGstCents: c ?? 0 })} /></Field>
            <Field label="Purchase price inc GST" hint={<button type="button" className="btn ghost sm" style={{ padding: 0, height: "auto" }} onClick={() => set({ costIncGstCents: applyBp(v.costExGstCents, 10000 + s.gstRateBp) })}>Calculate from ex GST</button>}>
              <MoneyInput value={v.costIncGstCents} onChange={(c) => set({ costIncGstCents: c ?? 0 })} /></Field>
            <Field label="Markup" hint={`Blank = default ${formatBp(s.defaultMarkupBp)}`}><PercentInput value={v.markupBp} allowEmpty onChange={(m) => set({ markupBp: m })} /></Field>
            <Field label={`Fixed sell price per ${v.unit || "unit"}`} hint="Optional — overrides markup"><MoneyInput value={v.sellPriceCents} allowEmpty onChange={(c) => set({ sellPriceCents: c })} /></Field>
            <div className="span-all notice info small">
              Suggested selling price: <b>{formatAud(suggestedSell(v, s))}</b> per {v.unit || "unit"}
              {v.packQuantity > 1 && <> (cost {formatAud(roundDiv(s.gstRegistered ? v.costExGstCents : v.costIncGstCents, v.packQuantity))} per {v.unit} on the current cost basis)</>}.
            </div>
            <Field label="Customer description" hint="Shown on quotations" className="span-all"><input value={v.customerDescription} onChange={(e) => set({ customerDescription: e.target.value })} /></Field>
            <Field label="Internal notes" className="span-all"><textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            <label className="check span-all"><input type="checkbox" checked={v.isEstimate} onChange={(e) => set({ isEstimate: e.target.checked })} />Price is an estimate (not yet confirmed with the supplier)</label>
          </div>
        </Modal>
      )}
    </>
  );
}

