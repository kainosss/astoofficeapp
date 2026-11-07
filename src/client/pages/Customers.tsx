import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { CustomerListRow } from "../../shared/types";
import { api } from "../api";
import { Icon, Loading, PageHeader, useLoad } from "../components/ui";
import { NewCustomerModal } from "./NewQuote";

export function Customers() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const { data, error } = useLoad(() => api.get<CustomerListRow[]>(`/customers?q=${encodeURIComponent(q)}${archived ? "&archived=1" : ""}`), [q, archived]);
  const nav = useNavigate();
  const showNew = params.get("new") === "1";
  return (
    <>
      <PageHeader title="Customers" sub="Customers and their installation addresses." actions={<button className="btn primary" onClick={() => setParams({ new: "1" })}><Icon name="plus" />New customer</button>} />
      <div className="card">
        <div className="toolbar">
          <input type="search" placeholder="Search name, phone, email, address or suburb" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" autoFocus />
          <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Include archived</label>
        </div>
        {!data ? <Loading error={error} /> : data.length === 0 ? <div className="empty">No customers found.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Phone</th><th className="hide-sm">Email</th><th className="hide-sm">Address</th><th className="num hide-sm">Quotes</th></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/customers/${c.id}`)}>
                    <td><strong>{c.name}</strong>{c.archived && <span className="badge neutral" style={{ marginLeft: 6 }}>Archived</span>}<div className="sub">{c.kind === "business" ? `Business${c.contactPerson ? ` · ${c.contactPerson}` : ""}` : c.contactPerson}</div></td>
                    <td className="nowrap">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}>{c.phone}</a> : "—"}</td>
                    <td className="hide-sm">{c.email || "—"}</td>
                    <td className="hide-sm">{c.primarySite || "—"}{c.siteCount > 1 && <span className="sub"> +{c.siteCount - 1} more</span>}</td>
                    <td className="num hide-sm">{c.quoteCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showNew && <NewCustomerModal onClose={() => setParams({})} onCreated={(id) => nav(`/customers/${id}`)} />}
    </>
  );
}
