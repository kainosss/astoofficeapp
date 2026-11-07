import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatAud } from "../../shared/money";
import type { Customer, QuoteListRow, Site } from "../../shared/types";
import { api } from "../api";
import { CustomerFields, type CustomerInput } from "../components/CustomerForms";
import { formatDate, Icon, Loading, Modal, PageHeader, StatusBadge, useLoad, useToast } from "../components/ui";
import { NewSiteModal } from "./NewQuote";

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.get<{ customer: Customer; sites: Site[]; quotes: QuoteListRow[] }>(`/customers/${id}`), [id]);
  const [editing, setEditing] = useState<CustomerInput | null>(null);
  const [siteModal, setSiteModal] = useState<Site | "new" | null>(null);
  if (!data) return <Loading error={error} />;
  const c = data.customer;

  const saveCustomer = async () => {
    try { await api.put(`/customers/${c.id}`, editing); setEditing(null); toast("Customer saved."); void reload(); }
    catch (e) { toast((e as Error).message, "error"); }
  };
  const deleteSite = async (s: Site) => {
    if (!window.confirm(`Delete the address ${s.address}?`)) return;
    try { await api.del(`/customers/${c.id}/sites/${s.id}`); void reload(); } catch (e) { toast((e as Error).message, "error"); }
  };

  return (
    <>
      <PageHeader
        title={<span className="row">{c.name}{c.archived && <span className="badge neutral">Archived</span>}</span>}
        sub={c.kind === "business" ? "Business customer" : "Individual customer"}
        actions={<>
          <button className="btn" onClick={() => setEditing({ kind: c.kind, name: c.name, contactPerson: c.contactPerson, email: c.email, phone: c.phone, notes: c.notes, archived: c.archived })}><Icon name="edit" />Edit</button>
          <Link className="btn primary" to={`/quotes/new?customerId=${c.id}`}><Icon name="plus" />New quotation</Link>
        </>}
      />
      <div className="grid g2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-head"><h2>Contact details</h2></div>
          <div className="card-body">
            <dl className="grid g2" style={{ margin: 0, gap: 10 }}>
              <div><div className="small muted">Contact person</div>{c.contactPerson || "—"}</div>
              <div><div className="small muted">Phone</div>{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a> : "—"}</div>
              <div className="span2"><div className="small muted">Email</div>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</div>
              <div className="span2"><div className="small muted">Notes</div><div style={{ whiteSpace: "pre-wrap" }}>{c.notes || "—"}</div></div>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Installation addresses</h2><button className="btn sm" onClick={() => setSiteModal("new")}><Icon name="plus" />Add</button></div>
          {data.sites.length === 0 ? <div className="empty">No addresses yet.</div> : (
            <table className="table"><tbody>
              {data.sites.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.address}</strong><div className="sub">{s.suburb} {s.state} {s.postcode}</div>{s.notes && <div className="sub">{s.notes}</div>}</td>
                  <td className="right nowrap">
                    <button className="btn ghost sm" onClick={() => setSiteModal(s)}>Edit</button>
                    <button className="btn ghost icon sm" onClick={() => deleteSite(s)} aria-label="Delete address"><Icon name="trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>Quotations</h2></div>
        {data.quotes.length === 0 ? <div className="empty">No quotations for this customer.</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Quote</th><th>Title</th><th className="hide-sm">Site</th><th>Status</th><th className="hide-sm">Issued</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.quotes.map((q) => (
                <tr key={q.id} className="clickable" onClick={() => nav(`/quotes/${q.id}`)}>
                  <td className="nowrap"><strong>{q.quoteNumber}</strong>{q.revision > 1 && <span className="muted small"> Rev {q.revision}</span>}</td>
                  <td>{q.title}</td><td className="hide-sm">{q.siteLabel || "—"}</td><td><StatusBadge status={q.status} /></td>
                  <td className="hide-sm">{formatDate(q.issueDate)}</td><td className="num">{formatAud(q.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {editing && (
        <Modal title="Edit customer" wide onClose={() => setEditing(null)} footer={<>
          <label className="check small" style={{ marginRight: "auto" }}><input type="checkbox" checked={editing.archived} onChange={(e) => setEditing({ ...editing, archived: e.target.checked })} />Archived</label>
          <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn primary" disabled={!editing.name.trim()} onClick={saveCustomer}>Save</button>
        </>}>
          <CustomerFields value={editing} onChange={setEditing} />
        </Modal>
      )}
      {siteModal && (
        <NewSiteModal
          customerId={c.id}
          siteId={siteModal === "new" ? undefined : siteModal.id}
          initial={siteModal === "new" ? undefined : { address: siteModal.address, suburb: siteModal.suburb, state: siteModal.state, postcode: siteModal.postcode, notes: siteModal.notes }}
          onClose={() => setSiteModal(null)}
          onCreated={() => { setSiteModal(null); void reload(); }}
        />
      )}
      <div className="spacer" />
      <button className="btn ghost sm" onClick={() => nav("/customers")}><Icon name="back" />All customers</button>
    </>
  );
}
