import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatAud, centiToInput } from "../../shared/money";
import type { CustomerListRow, Package, Site } from "../../shared/types";
import { api } from "../api";
import { CustomerFields, emptyCustomer, emptySite, SiteFields, type CustomerInput, type SiteInput } from "../components/CustomerForms";
import { Field, Icon, Loading, Modal, PageHeader, useLoad, useToast } from "../components/ui";

export function NewQuote() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const customers = useLoad(() => api.get<CustomerListRow[]>("/customers"));
  const packages = useLoad(() => api.get<Package[]>("/packages"));
  const [customerId, setCustomerId] = useState<number | null>(params.get("customerId") ? Number(params.get("customerId")) : null);
  const [filter, setFilter] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewSite, setShowNewSite] = useState(false);

  useEffect(() => {
    if (!customerId) { setSites([]); setSiteId(null); return; }
    api.get<{ sites: Site[] }>(`/customers/${customerId}`).then((d) => {
      setSites(d.sites);
      setSiteId((cur) => (cur && d.sites.some((s) => s.id === cur) ? cur : d.sites[0]?.id ?? null));
    });
  }, [customerId]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return (customers.data ?? []).filter((c) => !f || [c.name, c.contactPerson, c.email, c.phone, c.primarySite].join(" ").toLowerCase().includes(f));
  }, [customers.data, filter]);

  const create = async () => {
    if (!customerId) return;
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>("/quotes", { customerId, siteId, packageId });
      nav(`/quotes/${r.id}/edit`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  if (!customers.data || !packages.data) return <Loading error={customers.error || packages.error} />;
  const activePackages = packages.data.filter((p) => p.active);
  const selected = customers.data.find((c) => c.id === customerId);

  return (
    <>
      <PageHeader title="New quotation" sub="Choose the customer, installation address and a starting point." />
      <div className="stack" style={{ maxWidth: 920 }}>
        <div className="card">
          <div className="card-head"><div className="section-title"><span className="step">1</span><h2>Customer</h2></div>
            <button className="btn sm" onClick={() => setShowNewCustomer(true)}><Icon name="plus" />New customer</button></div>
          <div className="card-body stack">
            <input type="search" placeholder="Search customers" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search customers" />
            <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 5 }}>
              <table className="table">
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => setCustomerId(c.id)} style={c.id === customerId ? { outline: "2px solid var(--green)", outlineOffset: -2 } : undefined}>
                      <td style={{ width: 28 }}><input type="radio" readOnly checked={c.id === customerId} aria-label={c.name} /></td>
                      <td><strong>{c.name}</strong><div className="sub">{[c.contactPerson, c.phone, c.email].filter(Boolean).join(" · ")}</div></td>
                      <td className="hide-sm sub">{c.primarySite}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td className="empty">No matching customers.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="section-title"><span className="step">2</span><h2>Installation address</h2></div>
            {selected && <button className="btn sm" onClick={() => setShowNewSite(true)}><Icon name="plus" />Add address</button>}</div>
          <div className="card-body">
            {!selected ? <span className="muted">Select a customer first.</span> : sites.length === 0 ? <span className="muted">This customer has no addresses yet — add one, or continue without.</span> : (
              <div className="stack" style={{ gap: 6 }}>
                {sites.map((s) => (
                  <label key={s.id} className="check"><input type="radio" name="site" checked={siteId === s.id} onChange={() => setSiteId(s.id)} />{s.address}, {s.suburb} {s.state} {s.postcode}</label>
                ))}
                <label className="check"><input type="radio" name="site" checked={siteId === null} onChange={() => setSiteId(null)} /><span className="muted">Address to be confirmed</span></label>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="section-title"><span className="step">3</span><h2>Starting point</h2></div></div>
          <div className="card-body stack" style={{ gap: 8 }}>
            {activePackages.map((p) => (
              <label key={p.id} className="check" style={{ alignItems: "flex-start" }}>
                <input type="radio" name="pkg" checked={packageId === p.id} onChange={() => setPackageId(p.id)} style={{ marginTop: 2 }} />
                <span><strong>{p.name}</strong> — {p.pricingMode === "fixed" && p.fixedPriceCents !== null ? formatAud(p.fixedPriceCents) : "calculated price"}
                  <span className="muted small"> · {centiToInput(p.labourHoursCenti)} h labour</span><br /><span className="muted small">{p.description}</span></span>
              </label>
            ))}
            <label className="check"><input type="radio" name="pkg" checked={packageId === null} onChange={() => setPackageId(null)} />Start from scratch</label>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn primary" disabled={!customerId || busy} onClick={create}>{busy ? "Creating…" : "Create quotation"}</button>
        </div>
      </div>

      {showNewCustomer && <NewCustomerModal onClose={() => setShowNewCustomer(false)} onCreated={async (id) => {
        setShowNewCustomer(false); await customers.reload(); setCustomerId(id); setFilter("");
      }} />}
      {showNewSite && customerId && <NewSiteModal customerId={customerId} onClose={() => setShowNewSite(false)} onCreated={async (id) => {
        setShowNewSite(false);
        const d = await api.get<{ sites: Site[] }>(`/customers/${customerId}`);
        setSites(d.sites); setSiteId(id);
      }} />}
    </>
  );
}

export function NewCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number, siteId: number | null) => void }) {
  const [customer, setCustomer] = useState<CustomerInput>(emptyCustomer);
  const [site, setSite] = useState<SiteInput>(emptySite);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ id: number; siteId: number | null }>("/customers", { ...customer, site: site.address.trim() ? site : undefined });
      onCreated(r.id, r.siteId);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="New customer" onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !customer.name.trim()} onClick={save}>Save customer</button></>}>
      <div className="stack">
        {error && <div className="notice error">{error}</div>}
        <CustomerFields value={customer} onChange={setCustomer} />
        <h3>Installation address <span className="muted small" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></h3>
        <SiteFields value={site} onChange={setSite} />
      </div>
    </Modal>
  );
}

export function NewSiteModal({ customerId, onClose, onCreated, initial, siteId }: { customerId: number; onClose: () => void; onCreated: (id: number) => void; initial?: SiteInput; siteId?: number }) {
  const [site, setSite] = useState<SiteInput>(initial ?? emptySite);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      if (siteId) { await api.put(`/customers/${customerId}/sites/${siteId}`, site); onCreated(siteId); }
      else onCreated((await api.post<{ id: number }>(`/customers/${customerId}/sites`, site)).id);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={siteId ? "Edit installation address" : "Add installation address"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!site.address.trim()} onClick={save}>Save address</button></>}>
      {error && <div className="notice error" style={{ marginBottom: 12 }}>{error}</div>}
      <SiteFields value={site} onChange={setSite} />
    </Modal>
  );
}

export { Field };
