import { Link, useNavigate } from "react-router-dom";
import { formatAud } from "../../shared/money";
import type { DashboardData } from "../../shared/types";
import { api } from "../api";
import { formatDate, Icon, Loading, PageHeader, StatusBadge, useLoad } from "../components/ui";

export function Dashboard() {
  const { data, error } = useLoad(() => api.get<DashboardData>("/dashboard"));
  const nav = useNavigate();
  if (!data) return <Loading error={error} />;
  const stats = [
    { label: "Total quotations", value: String(data.totalQuotes), note: `${data.customerCount} customers` },
    { label: "Draft", value: String(data.byStatus.draft), note: "Not yet issued" },
    { label: "Sent", value: String(data.byStatus.sent), note: data.expiringSoon ? `${data.expiringSoon} expiring within 7 days` : "Awaiting response" },
    { label: "Accepted", value: String(data.byStatus.accepted), note: formatAud(data.acceptedValueCents) },
    { label: "Outstanding value", value: formatAud(data.outstandingValueCents), note: `${data.outstandingCount} sent and still valid` },
  ];
  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={<>
          <Link className="btn" to="/customers?new=1"><Icon name="plus" />New customer</Link>
          <Link className="btn primary" to="/quotes/new"><Icon name="plus" />New quotation</Link>
        </>}
      />
      <div className="stats">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-note">{s.note}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head"><h2>Recent quotations</h2><Link to="/quotes" className="small">View all</Link></div>
        {data.recent.length === 0 ? (
          <div className="empty">No quotations yet. <Link to="/quotes/new">Create the first quotation</Link>.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Quote</th><th>Customer</th><th className="hide-sm">Site</th><th>Status</th><th className="hide-sm">Updated</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.recent.map((q) => (
                  <tr key={q.id} className="clickable" onClick={() => nav(`/quotes/${q.id}`)}>
                    <td className="nowrap"><strong>{q.quoteNumber}</strong>{q.revision > 1 && <span className="muted small"> Rev {q.revision}</span>}</td>
                    <td>{q.customerName}<div className="sub">{q.title}</div></td>
                    <td className="hide-sm">{q.siteLabel || <span className="muted">—</span>}</td>
                    <td><StatusBadge status={q.status} /></td>
                    <td className="hide-sm nowrap">{formatDate(q.updatedAt)}</td>
                    <td className="num">{formatAud(q.totalCents)}</td>
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
