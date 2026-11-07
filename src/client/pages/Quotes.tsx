import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatAud } from "../../shared/money";
import { QUOTE_STATUSES, type QuoteListRow } from "../../shared/types";
import { api } from "../api";
import { formatDate, Icon, Loading, PageHeader, STATUS_LABEL, StatusBadge, useLoad } from "../components/ui";

export function Quotes() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, error } = useLoad(() => api.get<QuoteListRow[]>(`/quotes?q=${encodeURIComponent(q)}&status=${status}`), [q, status]);
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Quotations" sub="Every quotation, latest revision shown." actions={<Link className="btn primary" to="/quotes/new"><Icon name="plus" />New quotation</Link>} />
      <div className="card">
        <div className="toolbar">
          <input type="search" placeholder="Search number, customer, title or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search quotations" />
          <div className="tabs" role="tablist">
            <button className={status === "" ? "active" : ""} onClick={() => setStatus("")}>All</button>
            {QUOTE_STATUSES.map((s) => <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</button>)}
          </div>
        </div>
        {!data ? <Loading error={error} /> : data.length === 0 ? <div className="empty">No quotations found.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Quote</th><th>Customer</th><th className="hide-sm">Installation address</th><th>Status</th><th className="hide-sm">Issued</th><th className="hide-sm">Valid until</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/quotes/${r.id}`)}>
                    <td className="nowrap"><strong>{r.quoteNumber}</strong>{r.revision > 1 && <span className="muted small"> Rev {r.revision}</span>}</td>
                    <td>{r.customerName}<div className="sub">{r.title}</div></td>
                    <td className="hide-sm">{r.siteLabel || <span className="muted">—</span>}</td>
                    <td><StatusBadge status={r.status} />{r.status === "sent" && r.expiryDate && r.expiryDate < today && <div className="sub">Past expiry</div>}</td>
                    <td className="hide-sm nowrap">{formatDate(r.issueDate)}</td>
                    <td className="hide-sm nowrap">{formatDate(r.expiryDate)}</td>
                    <td className="num">{formatAud(r.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
