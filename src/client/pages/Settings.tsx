import { useEffect, useState } from "react";
import { formatAud } from "../../shared/money";
import type { Settings } from "../../shared/types";
import { api } from "../api";
import { DecimalInput, Field, Icon, Loading, MoneyInput, PageHeader, PercentInput, useToast } from "../components/ui";

const MAX_LOGO_BYTES = 280_000;

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  useEffect(() => { api.get<Settings>("/settings").then(setS).catch((e) => setError(e.message)); }, []);
  if (!s) return <Loading error={error} />;
  const set = (patch: Partial<Settings>) => { setS({ ...s, ...patch }); setDirty(true); };
  const text = (k: keyof Settings) => ({ value: String(s[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [k]: e.target.value } as Partial<Settings>) });

  const save = async () => {
    try {
      const { updatedAt: _u, ...body } = s;
      setS(await api.put<Settings>("/settings", body)); setDirty(false); toast("Settings saved. Existing issued quotations are unchanged.");
    } catch (e) { toast((e as Error).message, "error"); }
  };
  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) { toast("Logo must be a PNG or JPEG image.", "error"); return; }
    if (file.size > MAX_LOGO_BYTES) { toast("Logo must be smaller than 280 KB.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => set({ logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <>
      <PageHeader title="Settings" sub="Business details and pricing defaults. Changes apply to new quotations and drafts — issued quotations keep the values they were issued with."
        actions={<button className="btn primary" disabled={!dirty} onClick={save}>Save settings</button>} />
      <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
        <div className="card">
          <div className="card-head"><h2>Business details</h2><span className="muted small">Shown on quotations</span></div>
          <div className="card-body grid g3">
            <Field label="Business name"><input {...text("businessName")} /></Field>
            <Field label="ABN" hint="Leave blank until confirmed — quotations show a placeholder"><input {...text("abn")} inputMode="numeric" placeholder="Not provided" /></Field>
            <Field label="Phone"><input {...text("phone")} placeholder="Not provided" /></Field>
            <Field label="Email"><input type="email" {...text("email")} placeholder="Not provided" /></Field>
            <Field label="Website"><input {...text("website")} placeholder="Optional" /></Field>
            <Field label="Business address"><input {...text("address")} /></Field>
            <div className="span-all row" style={{ alignItems: "center", gap: 16 }}>
              <div style={{ width: 180, height: 64, border: "1px dashed var(--border-strong)", borderRadius: 5, display: "grid", placeItems: "center", background: "#fafbfb" }}>
                {s.logoDataUrl ? <img src={s.logoDataUrl} alt="Logo" style={{ maxWidth: 170, maxHeight: 56 }} /> : <span className="muted small">No logo — name is used</span>}
              </div>
              <label className="btn sm"><input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => onLogo(e.target.files?.[0])} />Upload logo</label>
              {s.logoDataUrl && <button className="btn sm ghost" onClick={() => set({ logoDataUrl: null })}>Remove</button>}
              <span className="muted small">PNG or JPEG, under 280 KB. A wide logo around 600 × 200 px works best.</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Pricing defaults</h2></div>
          <div className="card-body grid g4">
            <Field label="Labour charge-out rate" hint="Per hour"><MoneyInput value={s.labourRateCents} onChange={(v) => set({ labourRateCents: v ?? 0 })} /></Field>
            <Field label="Default equipment markup"><PercentInput value={s.defaultMarkupBp} onChange={(v) => set({ defaultMarkupBp: v ?? 0 })} /></Field>
            <Field label="Quotation validity" hint="Days from issue"><DecimalInput value={s.quoteValidityDays * 100} onChange={(v) => set({ quoteValidityDays: Math.max(1, Math.round((v ?? 3000) / 100)) })} suffix="days" /></Field>
            <div />
            <div className="span-all">
              <label className="check"><input type="checkbox" checked={s.gstRegistered} onChange={(e) => set({ gstRegistered: e.target.checked })} /><b>Registered for GST</b></label>
              <div className="muted small" style={{ marginTop: 4, maxWidth: 760 }}>
                {s.gstRegistered
                  ? "GST is added to customer prices, and supplier prices excluding GST are used as the cost basis (assumes GST credits are claimable on eligible purchases)."
                  : "No GST is charged on quotations. GST paid on supplier purchases cannot be claimed back, so prices including GST are used as the cost basis."}
              </div>
            </div>
            <Field label="GST rate"><PercentInput value={s.gstRateBp} onChange={(v) => set({ gstRateBp: v ?? 1000 })} disabled={!s.gstRegistered} /></Field>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Internal profitability assumptions</h2><span className="internal-tag">Internal</span></div>
          <div className="card-body grid g4">
            <Field label="Overhead allowance" hint="% of selling price (insurance, vehicle, tools, software)"><PercentInput value={s.overheadBp} onChange={(v) => set({ overheadBp: v ?? 0 })} /></Field>
            <Field label="Warranty allowance" hint="% of selling price (call-backs, replacements)"><PercentInput value={s.warrantyBp} onChange={(v) => set({ warrantyBp: v ?? 0 })} /></Field>
            <Field label="Notional owner labour" hint="Per hour — a management figure, not a wage"><MoneyInput value={s.ownerLabourCostCents} onChange={(v) => set({ ownerLabourCostCents: v ?? 0 })} /></Field>
            <div />
            <Field label="Warn below gross margin"><PercentInput value={s.minGrossMarginBp} onChange={(v) => set({ minGrossMarginBp: v ?? 0 })} /></Field>
            <Field label="Warn below surplus" hint={`Currently ${formatAud(s.minSurplusCents)} per job`}><MoneyInput value={s.minSurplusCents} onChange={(v) => set({ minSurplusCents: v ?? 0 })} /></Field>
            <div className="span-all muted small">These starting values are assumptions — review them against your actual costs.</div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Standard quotation text</h2><span className="muted small">Copied into new quotations</span></div>
          <div className="card-body grid g2">
            <Field label="Standard inclusions" hint="One per line"><textarea rows={6} {...text("standardInclusions")} /></Field>
            <Field label="Standard exclusions" hint="One per line"><textarea rows={6} {...text("standardExclusions")} /></Field>
            <Field label="Deposit terms"><textarea rows={3} {...text("depositTerms")} /></Field>
            <Field label="Payment terms"><textarea rows={3} {...text("paymentTerms")} /></Field>
            <Field label="Warranty information" hint="Do not limit customers' rights under the Australian Consumer Law"><textarea rows={4} {...text("warrantyText")} /></Field>
            <Field label="Acceptance instructions"><textarea rows={4} {...text("acceptanceText")} /></Field>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Data export and backup</h2></div>
          <div className="card-body stack">
            <div className="row">
              <a className="btn" href="/api/export/backup.json"><Icon name="download" />Full backup (JSON)</a>
              <a className="btn" href="/api/export/customers.csv"><Icon name="download" />Customers (CSV)</a>
              <a className="btn" href="/api/export/quotes.csv"><Icon name="download" />Quotations (CSV)</a>
              <a className="btn" href="/api/export/equipment.csv"><Icon name="download" />Equipment (CSV)</a>
            </div>
            <div className="muted small">Backups contain customer details and supplier pricing — store them privately. Database-level backups can also be taken with Wrangler (see README).</div>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" disabled={!dirty} onClick={save}>Save settings</button></div>
      </div>
    </>
  );
}
