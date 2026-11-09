import { useEffect, useMemo, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { applyBp, centiToInput, formatAud, formatBp, roundDiv } from "../../shared/money";
import type { PricingResult } from "../../shared/pricing";
import { calculateRevision, equipmentToQuoteItem, includedItem, type NewRevisionContentShape } from "../builder";
import type { CustomerListRow, Equipment, Package, QuoteDetail, QuoteItem, RevisionPricing, Settings, Site } from "../../shared/types";
import { api } from "../api";
import { scopeTemplate } from "../../shared/quoteBuilder";
import { SCOPE_TEMPLATE_LABELS, type ScopeTemplateKey } from "../../shared/terms";
import { DecimalInput, Field, Icon, Loading, Modal, MoneyInput, PageHeader, PercentInput, StatusBadge, useLoad, useToast } from "../components/ui";
import { NewCustomerModal, NewSiteModal } from "./NewQuote";

type Form = NewRevisionContentShape & { customerId: number; siteId: number | null };

const COMPLEXITY = [
  { bp: 10000, label: "Standard (×1.00)" },
  { bp: 11500, label: "Moderate — two-storey / tight roof space (×1.15)" },
  { bp: 13000, label: "Complex — difficult access, long runs (×1.30)" },
  { bp: 15000, label: "Very complex (×1.50)" },
];

function formFromDetail(d: QuoteDetail): Form {
  const r = d.revision;
  return {
    customerId: d.customer.id, siteId: d.site?.id ?? null, title: r.title, packageId: r.packageId, pricing: r.pricing,
    items: r.items.map(({ id: _id, ...i }) => i), scope: r.scope, inclusions: r.inclusions, exclusions: r.exclusions,
    depositTerms: r.depositTerms, paymentTerms: r.paymentTerms, warrantyText: r.warrantyText, acceptanceText: r.acceptanceText,
    customerNotes: r.customerNotes, internalNotes: r.internalNotes, issueDate: r.issueDate, expiryDate: r.expiryDate,
  };
}

export function QuoteBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const detail = useLoad(() => api.get<QuoteDetail>(`/quotes/${id}`), [id]);
  const equipment = useLoad(() => api.get<Equipment[]>("/equipment"));
  const packages = useLoad(() => api.get<Package[]>("/packages"));
  const settings = useLoad(() => api.get<Settings>("/settings"));
  const customers = useLoad(() => api.get<CustomerListRow[]>("/customers"));
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [modal, setModal] = useState<null | "customer" | "site" | "refresh">(null);
  const [addId, setAddId] = useState("");

  useEffect(() => { if (detail.data && !form) setForm(formFromDetail(detail.data)); }, [detail.data, form]);
  useEffect(() => {
    if (!form?.customerId) return;
    api.get<{ sites: Site[] }>(`/customers/${form.customerId}`).then((d) => setSites(d.sites));
  }, [form?.customerId]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("You have unsaved changes. Leave without saving?")) blocker.proceed(); else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const totals = useMemo(() => (form ? calculateRevision(form.items, form.pricing) : null), [form]);

  if (!detail.data || !form || !totals || !equipment.data || !packages.data || !settings.data || !customers.data)
    return <Loading error={detail.error || equipment.error || packages.error || settings.error || customers.error} />;

  const d = detail.data;
  if (d.revision.locked || d.revision.status !== "draft") {
    return (
      <div className="stack">
        <div className="notice info">This revision has been issued and is locked to preserve what the customer received. Create a new revision to make changes.</div>
        <div><Link className="btn" to={`/quotes/${d.id}`}>Back to quotation</Link></div>
      </div>
    );
  }

  const p = form.pricing;
  const fixed = p.mode === "fixed";
  const registered = p.gstRegistered;
  const update = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setDirty(true); };
  const setPricing = (patch: Partial<RevisionPricing>) => update({ pricing: { ...p, ...patch } });
  const setItem = (idx: number, patch: Partial<QuoteItem>) => update({ items: form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
  const removeItem = (idx: number) => update({ items: form.items.filter((_, i) => i !== idx) });
  const moveItem = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= form.items.length) return;
    const items = [...form.items];
    [items[idx], items[j]] = [items[j], items[idx]];
    update({ items });
  };
  const addCatalogue = () => {
    const e = equipment.data!.find((x) => x.id === Number(addId));
    if (!e) return;
    update({ items: [...form.items, equipmentToQuoteItem(e, { inPackage: false, quantityCenti: e.unit === "m" ? 1000 : 100 })] });
    setAddId("");
  };
  const addCustom = () => update({ items: [...form.items, { ...equipmentToQuoteItem({ id: 0, manufacturer: "", name: "", supplier: "", sku: "", category: "Other", kind: "equipment", unit: "each", packQuantity: 1, costExGstCents: 0, costIncGstCents: 0, markupBp: null, sellPriceCents: null, customerDescription: "", notes: "", isEstimate: true, active: true }), equipmentId: null, description: "New item" }] });
  const addIncluded = () => update({ items: [...form.items, includedItem("Component included in kit", 100)] });

  const applyPackage = async (pkgId: number | null) => {
    if (form.items.length && !window.confirm("Replace the current line items, labour and pricing with this starting point? Customer details and terms are kept.")) return;
    const t = await api.get<NewRevisionContentShape>(`/quotes/template${pkgId ? `?packageId=${pkgId}` : ""}`);
    update({ items: t.items, pricing: t.pricing, packageId: t.packageId, title: t.title, scope: t.scope || form.scope });
  };

  const refreshCosts = () => {
    let changed = 0;
    const items = form.items.map((it) => {
      const e = it.equipmentId ? equipment.data!.find((x) => x.id === it.equipmentId) : undefined;
      if (!e || it.role === "included") return it;
      if (e.costExGstCents !== it.costExGstCents || e.costIncGstCents !== it.costIncGstCents || e.packQuantity !== it.packQuantity) changed++;
      return { ...it, costExGstCents: e.costExGstCents, costIncGstCents: e.costIncGstCents, packQuantity: e.packQuantity, isEstimate: e.isEstimate };
    });
    update({ items });
    toast(changed ? `Updated costs on ${changed} line${changed > 1 ? "s" : ""} from the catalogue.` : "All costs already match the catalogue.");
  };

  const s = settings.data;
  const settingsDiffer = s.gstRegistered !== p.gstRegistered || s.gstRateBp !== p.gstRateBp;

  const save = async (then?: "view") => {
    setSaving(true);
    try {
      await api.put(`/quotes/${d.id}/revisions/${d.revision.id}`, form);
      setDirty(false);
      toast("Quotation saved.");
      if (then === "view") setTimeout(() => nav(`/quotes/${d.id}`), 0);
      else void detail.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const costCol = registered ? "Cost ex GST" : "Cost inc GST";
  const customer = customers.data.find((c) => c.id === form.customerId);

  return (
    <>
      <PageHeader
        title={<span className="row">{d.quoteNumber}{d.revision.revision > 1 && <span className="muted">Rev {d.revision.revision}</span>}<StatusBadge status="draft" />{dirty && <span className="badge neutral">Unsaved changes</span>}</span>}
        sub={customer ? `${customer.name}${form.title ? ` — ${form.title}` : ""}` : undefined}
        actions={<>
          <Link className="btn" to={`/quotes/${d.id}`}><Icon name="eye" />Preview</Link>
          <button className="btn" disabled={saving} onClick={() => save("view")}>Save and preview</button>
          <button className="btn primary" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save"}</button>
        </>}
      />
      <div className="grid g2" style={{ gap: 16, marginBottom: 16, alignItems: "start" }}>
          {/* 1. Customer and site */}
          <div className="card">
            <div className="card-head"><div className="section-title"><span className="step">1</span><h2>Customer and installation address</h2></div></div>
            <div className="card-body grid g2">
              <Field label={<span className="row" style={{ justifyContent: "space-between" }}>Customer <button type="button" className="btn ghost sm" onClick={() => setModal("customer")}><Icon name="plus" />New</button></span>}>
                <select value={form.customerId} onChange={(e) => update({ customerId: Number(e.target.value), siteId: null })}>
                  {customers.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label={<span className="row" style={{ justifyContent: "space-between" }}>Installation address <button type="button" className="btn ghost sm" onClick={() => setModal("site")}><Icon name="plus" />Add</button></span>}>
                <select value={form.siteId ?? ""} onChange={(e) => update({ siteId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">To be confirmed</option>
                  {sites.map((st) => <option key={st.id} value={st.id}>{st.address}, {st.suburb} {st.state} {st.postcode}</option>)}
                </select>
              </Field>
              <Field label="Quotation title" className="span2"><input value={form.title} onChange={(e) => update({ title: e.target.value })} /></Field>
            </div>
          </div>

          {/* 2. Package */}
          <div className="card">
            <div className="card-head"><div className="section-title"><span className="step">2</span><h2>Starting point</h2></div>
              <span className="muted small">{p.packageName ? `Based on ${p.packageName}` : "Custom quotation"}</span></div>
            <div className="card-body stack" style={{ gap: 8 }}>
              <select value="" onChange={(e) => e.target.value && applyPackage(e.target.value === "scratch" ? null : Number(e.target.value))} aria-label="Apply package">
                <option value="">Apply a CCTV package…</option>
                {packages.data.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}{x.fixedPriceCents !== null ? ` — ${formatAud(x.fixedPriceCents)}` : ""}</option>)}
                <option value="scratch">Start from scratch (clear items)</option>
              </select>
              <span className="muted small">Applying a package replaces line items, labour and pricing.</span>
            </div>
          </div>

      </div>

          {/* 3. Line items (full width) */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div className="section-title"><span className="step">3</span><h2>Equipment and materials</h2></div>
              <div className="row">
                <span className="small muted">Total <b className="strong" style={{ color: "var(--green)" }}>{formatAud(totals.totalCents)}</b></span>
                <span className="small muted">Surplus <b className={totals.surplusCents < 0 ? "neg" : ""}>{formatAud(totals.surplusCents)}</b></span>
                <button className="btn sm ghost" onClick={refreshCosts} title="Replace line costs with current catalogue prices">Update costs from catalogue</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table items">
                <thead>
                  <tr>
                    <th style={{ width: 52 }}></th>
                    <th>Description (shown to customer)</th>
                    <th style={{ width: 104 }} className="num">Qty</th>
                    <th style={{ width: 130 }} className="num">{costCol}</th>
                    <th style={{ width: 92 }} className="num">Markup</th>
                    <th style={{ width: 116 }} className="num">Sell / unit</th>
                    <th style={{ width: 92 }} className="num">Line cost</th>
                    <th style={{ width: 92 }} className="num">Line sell</th>
                    {fixed && <th style={{ width: 44 }} title="Covered by the fixed package price">In pkg</th>}
                    <th style={{ width: 34 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.length === 0 && <tr><td colSpan={10} className="empty">No items yet. Apply a package or add equipment below.</td></tr>}
                  {form.items.map((it, idx) => {
                    const r = totals.items[idx];
                    const included = it.role === "included";
                    const costValue = registered ? it.costExGstCents : it.costIncGstCents;
                    const setCost = (v: number | null) => {
                      const c = v ?? 0;
                      const rate = p.gstRateBp;
                      setItem(idx, registered
                        ? { costExGstCents: c, costIncGstCents: roundDiv(c * (10000 + rate), 10000) }
                        : { costIncGstCents: c, costExGstCents: roundDiv(c * 10000, 10000 + rate) });
                    };
                    const autoUnitSell = it.quantityCenti ? roundDiv(r.sellCents * 100, it.quantityCenti) : 0;
                    return (
                      <tr key={idx} className={included ? "included" : ""}>
                        <td className="nowrap">
                          <button className="btn ghost icon sm" onClick={() => moveItem(idx, -1)} aria-label="Move up"><Icon name="up" /></button>
                          <button className="btn ghost icon sm" onClick={() => moveItem(idx, 1)} aria-label="Move down"><Icon name="down" /></button>
                        </td>
                        <td className="desc">
                          <input value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} aria-label="Customer description" />
                          <div className="sub" style={{ marginTop: 3 }}>
                            {included ? <span className="badge kit">Included in kit — no separate cost</span> : <>
                              {it.name || "Custom item"}{it.sku && <> · <span className="mono">{it.sku}</span></>}{it.supplier && <> · {it.supplier}</>}
                              {it.packQuantity > 1 && <> · pack of {it.packQuantity} {it.unit}</>}
                              {it.isEstimate && <> <span className="badge estimate">Estimate</span></>}
                            </>}
                          </div>
                        </td>
                        <td>
                          <DecimalInput value={it.quantityCenti} onChange={(v) => setItem(idx, { quantityCenti: v ?? 0 })} suffix={it.unit !== "each" ? it.unit : undefined} ariaLabel="Quantity" />
                          {!included && (
                            <label className="check small" style={{ marginTop: 4, fontSize: 11.5 }} title="Untick to show 'Included' instead of the quantity on the customer quotation (e.g. cabling, consumables)">
                              <input type="checkbox" checked={it.showQuantity !== false} onChange={(e) => setItem(idx, { showQuantity: e.target.checked })} />Show qty
                            </label>
                          )}
                        </td>
                        {included ? <td colSpan={5} className="muted small">Part of the kit price above</td> : <>
                          <td>
                            <MoneyInput value={costValue} onChange={setCost} ariaLabel={costCol} />
                            {it.packQuantity > 1 && <div className="sub right">per {it.packQuantity} {it.unit}</div>}
                          </td>
                          <td><PercentInput value={it.markupBp} allowEmpty placeholder={centiToInput(p.markupBp)} onChange={(v) => setItem(idx, { markupBp: v })} ariaLabel="Markup" /></td>
                          <td><MoneyInput value={it.sellUnitCents} allowEmpty placeholder={(autoUnitSell / 100).toFixed(2)} onChange={(v) => setItem(idx, { sellUnitCents: v })} ariaLabel="Sell price per unit" /></td>
                          <td className="num">{formatAud(r.costCents)}</td>
                          <td className="num">{fixed && it.inPackage ? <span className="muted" title="Included in the package price">{formatAud(r.sellCents)}</span> : formatAud(r.sellCents)}</td>
                        </>}
                        {fixed && <td style={{ textAlign: "center" }}>{!included && <input type="checkbox" checked={it.inPackage} onChange={(e) => setItem(idx, { inPackage: e.target.checked })} aria-label="Included in package price" />}</td>}
                        <td><button className="btn ghost icon sm" onClick={() => removeItem(idx)} aria-label="Remove line"><Icon name="trash" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="toolbar" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>
              <select value={addId} onChange={(e) => setAddId(e.target.value)} style={{ maxWidth: 380 }} aria-label="Add from catalogue">
                <option value="">Add from catalogue…</option>
                {equipment.data.filter((e) => e.active).map((e) => (
                  <option key={e.id} value={e.id}>{e.category} — {[e.manufacturer, e.name].filter(Boolean).join(" ")}{e.isEstimate ? " (estimate)" : ""}</option>
                ))}
              </select>
              <button className="btn sm" disabled={!addId} onClick={addCatalogue}><Icon name="plus" />Add</button>
              <span className="grow" />
              <button className="btn sm ghost" onClick={addCustom}><Icon name="plus" />Custom item</button>
              <button className="btn sm ghost" onClick={addIncluded}><Icon name="plus" />Kit component</button>
            </div>
          </div>

      <div className="builder">
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {/* 4. Labour and pricing */}
          <div className="card">
            <div className="card-head"><div className="section-title"><span className="step">4</span><h2>Labour, travel and pricing</h2></div>
              <div className="seg" role="group" aria-label="Pricing mode">
                <button className={fixed ? "active" : ""} onClick={() => setPricing({ mode: "fixed", fixedPriceCents: p.fixedPriceCents ?? totals.calculatedNetCents, packageLabourHoursCenti: p.packageLabourHoursCenti || p.labourHoursCenti })}>Fixed package price</button>
                <button className={!fixed ? "active" : ""} onClick={() => setPricing({ mode: "calculated" })}>Calculated price</button>
              </div>
            </div>
            <div className="card-body stack">
              {settingsDiffer && (
                <div className="notice info row" style={{ justifyContent: "space-between" }}>
                  <span>This quotation uses {p.gstRegistered ? "GST-registered" : "not-registered"} pricing, but business settings are now {s.gstRegistered ? "GST-registered" : "not registered"}.</span>
                  <button className="btn sm" onClick={() => setPricing({ gstRegistered: s.gstRegistered, gstRateBp: s.gstRateBp })}>Apply current GST setting</button>
                </div>
              )}
              <div className="grid g4">
                {fixed && <>
                  <Field label="Package price" hint={registered ? "Excluding GST" : "No GST charged"}><MoneyInput value={p.fixedPriceCents} onChange={(v) => setPricing({ fixedPriceCents: v })} /></Field>
                  <Field label="Hours included in package"><DecimalInput value={p.packageLabourHoursCenti} onChange={(v) => setPricing({ packageLabourHoursCenti: v ?? 0 })} suffix="h" /></Field>
                </>}
                <Field label="Labour hours" hint={fixed ? "Hours above the package allowance are charged" : undefined}><DecimalInput value={p.labourHoursCenti} onChange={(v) => setPricing({ labourHoursCenti: v ?? 0 })} suffix="h" /></Field>
                <Field label="Labour rate" hint="Per hour"><MoneyInput value={p.labourRateCents} onChange={(v) => setPricing({ labourRateCents: v ?? 0 })} /></Field>
                <Field label="Installation complexity" className={fixed ? "" : "span2"}>
                  <select value={COMPLEXITY.some((c) => c.bp === p.complexityBp) ? p.complexityBp : "custom"} onChange={(e) => e.target.value !== "custom" && setPricing({ complexityBp: Number(e.target.value) })}>
                    {COMPLEXITY.map((c) => <option key={c.bp} value={c.bp}>{c.label}</option>)}
                    {!COMPLEXITY.some((c) => c.bp === p.complexityBp) && <option value="custom">Custom (×{(p.complexityBp / 10000).toFixed(2)})</option>}
                  </select>
                </Field>
                <Field label="Default equipment markup"><PercentInput value={p.markupBp} onChange={(v) => setPricing({ markupBp: v ?? 0 })} /></Field>
                <Field label="Travel charge" hint="Charged to customer"><MoneyInput value={p.travelChargeCents} onChange={(v) => setPricing({ travelChargeCents: v ?? 0 })} /></Field>
                <Field label="Travel cost" hint="Internal (fuel, tolls)"><MoneyInput value={p.travelCostCents} onChange={(v) => setPricing({ travelCostCents: v ?? 0 })} /></Field>
                <Field label="Consumables cost" hint={fixed ? "Internal — covered by package" : "Charged with markup"}><MoneyInput value={p.consumablesCostCents} onChange={(v) => setPricing({ consumablesCostCents: v ?? 0 })} /></Field>
                <Field label="Overhead allowance" hint="Internal, % of price"><PercentInput value={p.overheadBp} onChange={(v) => setPricing({ overheadBp: v ?? 0 })} /></Field>
                <Field label="Warranty allowance" hint="Internal, % of price"><PercentInput value={p.warrantyBp} onChange={(v) => setPricing({ warrantyBp: v ?? 0 })} /></Field>
                <Field label="Notional owner labour" hint="Per hour — management figure only"><MoneyInput value={p.ownerLabourCostCents} onChange={(v) => setPricing({ ownerLabourCostCents: v ?? 0 })} /></Field>
                <Field label="Final price override" hint={registered ? "Total payable inc GST. Blank = calculated" : "Total payable. Blank = calculated"} className="span2">
                  <MoneyInput value={p.priceOverrideCents} allowEmpty placeholder={`Calculated: ${formatAud(totals.calculatedNetCents + (registered ? applyBp(totals.calculatedNetCents, p.gstRateBp) : 0))}`} onChange={(v) => setPricing({ priceOverrideCents: v })} />
                </Field>
              </div>
            </div>
          </div>

          {/* 5. Customer-facing content */}
          <div className="card">
            <div className="card-head"><div className="section-title"><span className="step">5</span><h2>Scope, inclusions and terms</h2></div>
              <button className="btn sm" onClick={() => setModal("refresh")}>Refresh terms from Settings</button></div>
            <div className="card-body grid g2">
              <Field className="span2" label={<span className="row" style={{ justifyContent: "space-between" }}>Scope of works
                <select style={{ width: "auto", height: 28, fontSize: 12.5 }} value="" aria-label="Insert scope template" onChange={(e) => {
                  const key = e.target.value as ScopeTemplateKey;
                  if (!key) return;
                  if (form.scope.trim() && !window.confirm(`Replace the current scope of works with the ${SCOPE_TEMPLATE_LABELS[key]} template?`)) return;
                  update({ scope: scopeTemplate(s, key) });
                }}>
                  <option value="">Insert template…</option>
                  {(Object.keys(SCOPE_TEMPLATE_LABELS) as ScopeTemplateKey[]).map((k) => <option key={k} value={k}>{SCOPE_TEMPLATE_LABELS[k]}</option>)}
                </select></span>} hint="Shown above the equipment list. A first line starting with &quot;Scope of Works&quot; becomes the heading.">
                <textarea rows={8} value={form.scope} onChange={(e) => update({ scope: e.target.value })} /></Field>
              <Field label="Inclusions" hint="One per line"><textarea rows={6} value={form.inclusions} onChange={(e) => update({ inclusions: e.target.value })} /></Field>
              <Field label="Exclusions" hint="One per line"><textarea rows={6} value={form.exclusions} onChange={(e) => update({ exclusions: e.target.value })} /></Field>
              <Field label="Deposit terms"><textarea rows={3} value={form.depositTerms} onChange={(e) => update({ depositTerms: e.target.value })} /></Field>
              <Field label="Payment terms"><textarea rows={3} value={form.paymentTerms} onChange={(e) => update({ paymentTerms: e.target.value })} /></Field>
              <Field label="Warranty information"><textarea rows={4} value={form.warrantyText} onChange={(e) => update({ warrantyText: e.target.value })} /></Field>
              <Field label="Acceptance instructions"><textarea rows={4} value={form.acceptanceText} onChange={(e) => update({ acceptanceText: e.target.value })} /></Field>
              <Field label="Notes to customer" className="span2"><textarea rows={2} value={form.customerNotes} onChange={(e) => update({ customerNotes: e.target.value })} /></Field>
              <Field label="Issue date" hint="Blank = date the quotation is marked as sent"><input type="date" value={form.issueDate ?? ""} onChange={(e) => update({ issueDate: e.target.value || null })} /></Field>
              <Field label="Valid until" hint={`Blank = issue date + ${s.quoteValidityDays} days`}><input type="date" value={form.expiryDate ?? ""} onChange={(e) => update({ expiryDate: e.target.value || null })} /></Field>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Internal notes</h2><span className="internal-tag">Internal</span></div>
            <div className="card-body"><textarea rows={3} value={form.internalNotes} onChange={(e) => update({ internalNotes: e.target.value })} aria-label="Internal notes" placeholder="Never shown to the customer" /></div>
          </div>
        </div>

        <aside className="summary">
          <SummaryPanel totals={totals} pricing={p} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary grow" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save quotation"}</button>
            <button className="btn" disabled={saving} onClick={() => save("view")}>Save and preview</button>
          </div>
        </aside>
      </div>

      {modal === "refresh" && <RefreshTermsModal form={form} settings={s} onClose={() => setModal(null)} onApply={(patch) => { update(patch); setModal(null); toast("Terms refreshed — review and save the quotation."); }} />}
      {modal === "customer" && <NewCustomerModal onClose={() => setModal(null)} onCreated={async (cid, sid) => {
        setModal(null); await customers.reload(); update({ customerId: cid, siteId: sid });
      }} />}
      {modal === "site" && <NewSiteModal customerId={form.customerId} onClose={() => setModal(null)} onCreated={async (sid) => {
        setModal(null); const r = await api.get<{ sites: Site[] }>(`/customers/${form.customerId}`); setSites(r.sites); update({ siteId: sid });
      }} />}
    </>
  );
}

export function SummaryPanel({ totals: t, pricing: p }: { totals: PricingResult; pricing: RevisionPricing }) {
  const fixed = p.mode === "fixed";
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card">
        <div className="card-head"><h2>Customer price</h2></div>
        <div className="card-body">
          <dl>
            {fixed ? <>
              <dt>Package price</dt><dd>{formatAud(t.packageSellCents)}</dd>
              {t.extrasSellCents !== 0 && <><dt>Additional items</dt><dd>{formatAud(t.extrasSellCents)}</dd></>}
              {t.extraLabourSellCents !== 0 && <><dt>Extra labour ({centiToInput(t.extraLabourHoursCenti)} h)</dt><dd>{formatAud(t.extraLabourSellCents)}</dd></>}
            </> : <>
              <dt>Equipment</dt><dd>{formatAud(t.equipmentSellCents)}</dd>
              <dt>Materials and consumables</dt><dd>{formatAud(t.materialSellCents + t.consumablesSellCents)}</dd>
              <dt>Labour ({centiToInput(t.effectiveLabourHoursCenti)} h)</dt><dd>{formatAud(t.labourSellCents)}</dd>
            </>}
            {t.travelSellCents !== 0 && <><dt>Travel</dt><dd>{formatAud(t.travelSellCents)}</dd></>}
            {t.adjustmentCents !== 0 && <><dt>{t.adjustmentCents < 0 ? "Discount (override)" : "Adjustment (override)"}</dt><dd className={t.adjustmentCents < 0 ? "neg" : ""}>{formatAud(t.adjustmentCents)}</dd></>}
            {p.gstRegistered && <><dt>Subtotal ex GST</dt><dd>{formatAud(t.netCents)}</dd><dt>GST</dt><dd>{formatAud(t.gstCents)}</dd></>}
          </dl>
          <hr />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="strong">Total payable</span><span className="total">{formatAud(t.totalCents)}</span>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>{p.gstRegistered ? `Includes GST at ${p.gstRateBp / 100}%` : "Not GST-registered — no GST charged"}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Profitability</h2><span className="internal-tag">Internal</span></div>
        <div className="card-body">
          <dl>
            <dt>Equipment cost</dt><dd>{formatAud(t.equipmentCostCents)}</dd>
            <dt>Materials cost</dt><dd>{formatAud(t.materialCostCents)}</dd>
            <dt>Consumables</dt><dd>{formatAud(t.consumablesCostCents)}</dd>
            {t.travelCostCents !== 0 && <><dt>Travel cost</dt><dd>{formatAud(t.travelCostCents)}</dd></>}
            <dt className="strong">Direct costs</dt><dd className="strong">{formatAud(t.directCostCents)}</dd>
          </dl>
          <div className="muted small" style={{ margin: "4px 0 0" }}>
            {t.costBasis === "inc-gst" ? "Cost basis: supplier prices including GST (GST is not claimable while unregistered)." : `Cost basis: prices excluding GST. Est. input tax credits ${formatAud(t.inputTaxCreditCents)}.`}
          </div>
          <hr />
          <dl>
            <dt>Selling price {p.gstRegistered ? "(ex GST)" : ""}</dt><dd>{formatAud(t.netCents)}</dd>
            <dt>Gross profit</dt><dd className={t.grossProfitCents < 0 ? "neg" : ""}>{formatAud(t.grossProfitCents)}</dd>
            <dt>Overhead allowance ({formatBp(p.overheadBp)})</dt><dd>−{formatAud(t.overheadAllowanceCents)}</dd>
            <dt>Warranty allowance ({formatBp(p.warrantyBp)})</dt><dd>−{formatAud(t.warrantyAllowanceCents)}</dd>
            <dt className="strong" title="Before owner labour and personal tax">Contribution</dt><dd className="strong">{formatAud(t.contributionCents)}</dd>
            <dt title="Management figure only — not a wage">Notional owner labour ({centiToInput(t.effectiveLabourHoursCenti)} h)</dt><dd>−{formatAud(t.ownerLabourNotionalCents)}</dd>
            <dt className="strong">Surplus</dt><dd className={`strong ${t.surplusCents < 0 ? "neg" : "pos"}`}>{formatAud(t.surplusCents)}</dd>
          </dl>
          <hr />
          <dl>
            <dt>Gross margin</dt><dd>{formatBp(t.grossMarginBp)}</dd>
            <dt>Markup on direct costs</dt><dd>{formatBp(t.markupBp)}</dd>
            <dt>Contribution margin</dt><dd>{formatBp(t.contributionMarginBp)}</dd>
          </dl>
          {t.warnings.length > 0 && <div className="notice warn" style={{ marginTop: 12 }}><strong>Check pricing</strong><ul>{t.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          <div className="muted small" style={{ marginTop: 10 }}>Contribution is before the owner's own labour and personal income tax. Notional owner labour is a management figure, not a deductible wage.</div>
        </div>
      </div>
    </div>
  );
}

type TermKey = "depositTerms" | "paymentTerms" | "warrantyText" | "acceptanceText" | "inclusions" | "exclusions" | "scope";
const TERM_LABELS: Record<TermKey, string> = {
  depositTerms: "Deposit terms", paymentTerms: "Payment terms", warrantyText: "Warranty information",
  acceptanceText: "Acceptance instructions", inclusions: "Inclusions", exclusions: "Exclusions and conditions", scope: "Scope of works (template)",
};

/** Replace selected customer-facing text on a DRAFT with the current Settings wording. Prices and items are never touched. */
function RefreshTermsModal({ form, settings, onClose, onApply }: {
  form: Pick<NewRevisionContentShape, TermKey>; settings: Settings; onClose: () => void; onApply: (patch: Partial<Pick<NewRevisionContentShape, TermKey>>) => void;
}) {
  const [scopeKey, setScopeKey] = useState<ScopeTemplateKey>("cctv");
  const fresh: Record<TermKey, string> = {
    depositTerms: settings.depositTerms, paymentTerms: settings.paymentTerms, warrantyText: settings.warrantyText,
    acceptanceText: settings.acceptanceText, inclusions: settings.standardInclusions, exclusions: settings.standardExclusions,
    scope: scopeTemplate(settings, scopeKey),
  };
  const keys = Object.keys(TERM_LABELS) as TermKey[];
  const differs = (k: TermKey) => (form[k] ?? "").trim() !== fresh[k].trim();
  const [selected, setSelected] = useState<Set<TermKey>>(() => new Set(keys.filter((k) => k !== "scope" && differs(k))));
  const toggle = (k: TermKey) => setSelected((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const apply = () => {
    const replacing = [...selected].filter((k) => (form[k] ?? "").trim() && differs(k));
    if (replacing.length && !window.confirm(`Replace the existing text in: ${replacing.map((k) => TERM_LABELS[k]).join(", ")}?\n\nEquipment, quantities, prices and internal costs are not changed.`)) return;
    const patch: Partial<Record<TermKey, string>> = {};
    selected.forEach((k) => { patch[k] = fresh[k]; });
    onApply(patch);
  };
  return (
    <Modal title="Refresh terms from Settings" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!selected.size} onClick={apply}>Refresh selected</button></>}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="muted small">Choose which sections to replace with the current Settings wording. The quote number, customer, equipment, quantities, prices and internal costs stay the same. Issued quotations are never changed.</div>
        {keys.map((k) => (
          <label key={k} className="check" style={{ justifyContent: "space-between" }}>
            <span className="row" style={{ gap: 7 }}><input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} />{TERM_LABELS[k]}</span>
            <span className="small muted">{differs(k) ? (form[k]?.trim() ? "Differs from Settings" : "Empty on this quote") : "Already matches"}</span>
          </label>
        ))}
        {selected.has("scope") && (
          <Field label="Scope template">
            <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value as ScopeTemplateKey)}>
              {(Object.keys(SCOPE_TEMPLATE_LABELS) as ScopeTemplateKey[]).map((k) => <option key={k} value={k}>{SCOPE_TEMPLATE_LABELS[k]}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
