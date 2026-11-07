import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { centiToInput, formatAud } from "../../shared/money";
import type { CustomerQuote, QuoteDetail, QuoteStatus } from "../../shared/types";
import { api, pdfUrl } from "../api";
import { formatDate, Icon, Loading, PageHeader, STATUS_LABEL, StatusBadge, useLoad, useToast } from "../components/ui";
import { SummaryPanel } from "./QuoteBuilder";

type Tab = "preview" | "pdf" | "internal";

export function QuoteView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const revisionId = params.get("revision");
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("preview");
  const [busy, setBusy] = useState(false);
  const detail = useLoad(() => api.get<QuoteDetail>(`/quotes/${id}${revisionId ? `?revisionId=${revisionId}` : ""}`), [id, revisionId]);
  const rev = detail.data?.revision;
  const customer = useLoad(
    () => (rev ? api.get<CustomerQuote>(`/quotes/${id}/revisions/${rev.id}/customer`) : Promise.resolve(null)),
    [rev?.id, rev?.updatedAt],
  );

  if (!detail.data || !rev) return <Loading error={detail.error} />;
  const d = detail.data;

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await fn(); toast(message); await detail.reload(); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  };
  const setStatus = (status: QuoteStatus) => {
    if (status === "sent" && !window.confirm("Mark this quotation as sent?\n\nThis issues the quotation: the revision is locked and its prices, terms and business details are preserved exactly as issued. Further changes will need a new revision.")) return;
    void act(() => api.post(`/quotes/${d.id}/revisions/${rev.id}/status`, { status }), `Marked as ${STATUS_LABEL[status].toLowerCase()}.`);
  };
  const revise = async () => {
    setBusy(true);
    try {
      await api.post(`/quotes/${d.id}/revise`);
      nav(`/quotes/${d.id}/edit`);
    } catch (e) { toast((e as Error).message, "error"); setBusy(false); }
  };
  const duplicate = async () => {
    if (!window.confirm(`Create a new quotation as a copy of ${d.quoteNumber}${rev.revision > 1 ? ` Rev ${rev.revision}` : ""}?`)) return;
    try {
      const r = await api.post<{ id: number; quoteNumber: string }>(`/quotes/${d.id}/duplicate?revisionId=${rev.id}`);
      toast(`Created ${r.quoteNumber}.`);
      nav(`/quotes/${r.id}/edit`);
    } catch (e) { toast((e as Error).message, "error"); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete draft quotation ${d.quoteNumber}? This cannot be undone.`)) return;
    try { await api.del(`/quotes/${d.id}`); toast("Quotation deleted."); nav("/quotes"); } catch (e) { toast((e as Error).message, "error"); }
  };

  const latest = d.isLatest;
  const isDraft = rev.status === "draft";
  const neverIssued = d.revisions.every((r) => !r.locked);

  return (
    <>
      <PageHeader
        title={<span className="row">{d.quoteNumber}{rev.revision > 1 && <span className="muted">Rev {rev.revision}</span>}<StatusBadge status={rev.status} /></span>}
        sub={<>{d.customer.name}{d.site ? ` · ${d.site.address}, ${d.site.suburb}` : ""} · {rev.title}</>}
        actions={<>
          {latest && isDraft && <Link className="btn primary" to={`/quotes/${d.id}/edit`}><Icon name="edit" />Edit</Link>}
          {latest && !isDraft && <button className="btn" disabled={busy} onClick={revise}><Icon name="edit" />New revision</button>}
          <a className="btn" href={pdfUrl(d.id, rev.id, true)}><Icon name="download" />Download PDF</a>
          <button className="btn" onClick={duplicate}><Icon name="copy" />Duplicate</button>
          {neverIssued && <button className="btn danger" onClick={remove}><Icon name="trash" /></button>}
        </>}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ borderBottom: 0 }}>
          <span className="small muted">Status</span>
          {latest ? (
            isDraft ? <button className="btn sm primary" disabled={busy} onClick={() => setStatus("sent")}>Mark as sent (issue)</button> : (
              (["sent", "accepted", "declined", "expired"] as QuoteStatus[]).filter((s) => s !== rev.status).map((s) => (
                <button key={s} className="btn sm" disabled={busy} onClick={() => setStatus(s)}>Mark {STATUS_LABEL[s].toLowerCase()}</button>
              ))
            )
          ) : <span className="small">Older revision — status changes apply to the latest revision only.</span>}
          <span className="grow" />
          <span className="small muted">Revision</span>
          <select style={{ width: "auto" }} value={rev.id} onChange={(e) => setParams({ revision: e.target.value })} aria-label="Revision">
            {d.revisions.map((r) => <option key={r.id} value={r.id}>Rev {r.revision} — {STATUS_LABEL[r.status]}{r.issueDate ? `, issued ${formatDate(r.issueDate)}` : ""} — {formatAud(r.totalCents)}</option>)}
          </select>
        </div>
        {rev.locked && (
          <div className="notice ok" style={{ margin: "0 12px 12px" }}>
            Issued {formatDate(rev.issuedAt)} — locked. Prices, GST treatment, terms and business details are preserved as issued.
          </div>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>Customer preview</button>
        <button className={tab === "pdf" ? "active" : ""} onClick={() => setTab("pdf")}>PDF</button>
        <button className={tab === "internal" ? "active" : ""} onClick={() => setTab("internal")}>Internal costing</button>
      </div>

      {tab === "preview" && (customer.data ? <CustomerPreview q={customer.data} /> : <Loading error={customer.error} />)}
      {tab === "pdf" && <PdfPreview src={pdfUrl(d.id, rev.id)} />}
      {tab === "internal" && <InternalCosting d={d} />}
    </>
  );
}

function PdfPreview({ src }: { src: string }) {
  // Fetch as a blob so the preview works under the strict CSP and with Access cookies.
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    fetch(src, { credentials: "same-origin" })
      .then(async (r) => { if (!r.ok) throw new Error(`PDF could not be generated (${r.status})`); return r.blob(); })
      .then((b) => { revoke = URL.createObjectURL(b); setUrl(revoke); })
      .catch((e) => setError(e.message));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [src]);
  if (error) return <div className="notice error">{error}</div>;
  if (!url) return <Loading />;
  return <iframe className="pdf-frame" src={url} title="Quotation PDF preview" />;
}

function CustomerPreview({ q }: { q: CustomerQuote }) {
  const biz = q.business;
  return (
    <div className="preview">
      {q.isDraft && <div className="notice warn no-print" style={{ marginBottom: 14 }}>Draft preview — dates are provisional until the quotation is marked as sent.</div>}
      <div className="p-head">
        <div>
          {biz.logoDataUrl ? <img className="p-logo" src={biz.logoDataUrl} alt={biz.name} /> : <div className="p-biz">{biz.name}</div>}
          <div className="small muted" style={{ marginTop: 4 }}>
            ABN {biz.abn || "[to be provided]"}<br />
            {biz.address && <>{biz.address}<br /></>}
            {[biz.phone, biz.email].filter(Boolean).join(" | ") || "[Contact details to be provided]"}
          </div>
        </div>
        <div className="p-meta">
          <strong>QUOTATION</strong>
          <div className="small"><span className="muted">Quote number</span> <b>{q.reference}</b></div>
          <div className="small"><span className="muted">Issue date</span> {formatDate(q.issueDate)}</div>
          <div className="small"><span className="muted">Valid until</span> {formatDate(q.expiryDate)}</div>
        </div>
      </div>
      <div className="grid g2">
        <div>
          <h4 style={{ marginTop: 0 }}>Prepared for</h4>
          <b>{q.customer.name}</b>
          {q.customer.contactPerson && q.customer.contactPerson !== q.customer.name && <div>Attn: {q.customer.contactPerson}</div>}
          {q.customer.phone && <div>{q.customer.phone}</div>}
          {q.customer.email && <div>{q.customer.email}</div>}
        </div>
        <div>
          <h4 style={{ marginTop: 0 }}>Installation address</h4>
          {q.site ? <><b>{q.site.address}</b><div>{q.site.suburb} {q.site.state} {q.site.postcode}</div></> : <span className="muted">To be confirmed</span>}
        </div>
      </div>
      {q.title && <h2 style={{ marginTop: 18 }}>{q.title}</h2>}
      {q.scope && <><h4>Scope of works</h4><div className="pre">{q.scope}</div></>}
      {q.lines.length > 0 && <>
        <h4>Equipment and materials</h4>
        <table className="table">
          <thead><tr><th>Description</th><th className="num">Quantity</th></tr></thead>
          <tbody>
            {q.lines.map((l, i) => (
              <tr key={i}>
                <td style={l.included ? { paddingLeft: 26, color: "var(--muted)" } : undefined}>{l.description}
                  {l.included && <span className="small"> — included in kit</span>}{l.extra && <span className="small muted"> — additional</span>}</td>
                <td className="num">{l.quantity}{l.unit !== "each" ? ` ${l.unit}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>}
      <h4>Price</h4>
      <table className="table">
        <tbody>
          {q.priceLines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="num">{formatAud(l.amountCents)}</td></tr>)}
          {q.gstRegistered && <><tr><td>Subtotal (excluding GST)</td><td className="num">{formatAud(q.netCents)}</td></tr><tr><td>GST</td><td className="num">{formatAud(q.gstCents)}</td></tr></>}
        </tbody>
      </table>
      <div className="p-total"><span>Total payable{q.gstRegistered ? " (including GST)" : ""}</span><span>{formatAud(q.totalCents)}</span></div>
      <div className="small muted" style={{ marginTop: 6, fontStyle: "italic" }}>{q.gstStatement}</div>
      {q.inclusions.length > 0 && <><h4>Inclusions</h4><ul>{q.inclusions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {q.exclusions.length > 0 && <><h4>Exclusions</h4><ul>{q.exclusions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {q.customerNotes && <><h4>Notes</h4><div className="pre">{q.customerNotes}</div></>}
      <h4>Deposit and payment terms</h4>
      <div className="pre">{q.depositTerms || "[Deposit terms to be provided]"}</div>
      <div className="pre" style={{ marginTop: 6 }}>{q.paymentTerms || "[Payment terms to be provided]"}</div>
      <h4>Warranty</h4>
      <div className="pre">{q.warrantyText || "[Warranty information to be provided]"}</div>
      <h4>Customer acceptance</h4>
      {q.acceptanceText && <div className="pre">{q.acceptanceText}</div>}
      <p><b>I accept quotation {q.reference} for a total of {formatAud(q.totalCents)}{q.gstRegistered ? " including GST" : ""}.</b></p>
      <div className="grid g2" style={{ marginTop: 26, gap: 28 }}>
        {["Customer name", "Signature", "Date", "Purchase order / reference (optional)"].map((l) => (
          <div key={l} style={{ borderTop: "1px solid var(--muted)", paddingTop: 4 }} className="small muted">{l}</div>
        ))}
      </div>
    </div>
  );
}

function InternalCosting({ d }: { d: QuoteDetail }) {
  const r = d.revision;
  const t = r.totals;
  return (
    <div className="builder">
      <div className="card">
        <div className="card-head"><h2>Line items and costs</h2><span className="internal-tag">Internal — never shown to customers</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Item</th><th className="hide-sm">Supplier / SKU</th><th className="num">Qty</th><th className="num">Cost ex GST</th><th className="num">Cost inc GST</th><th className="num">Line cost</th><th className="num">Line sell</th></tr></thead>
            <tbody>
              {r.items.map((i, idx) => (
                <tr key={idx}>
                  <td>{i.role === "included" ? <span className="muted">↳ {i.description} <span className="badge kit">in kit</span></span> : <>{i.name || i.description}{i.isEstimate && <> <span className="badge estimate">Estimate</span></>}{r.pricing.mode === "fixed" && !i.inPackage && <> <span className="badge neutral">Extra</span></>}</>}</td>
                  <td className="hide-sm small">{[i.supplier, i.sku].filter(Boolean).join(" · ")}</td>
                  <td className="num">{centiToInput(i.quantityCenti)}{i.unit !== "each" ? ` ${i.unit}` : ""}</td>
                  <td className="num">{i.role === "included" ? "—" : <>{formatAud(i.costExGstCents)}{i.packQuantity > 1 && <div className="sub">per {i.packQuantity}</div>}</>}</td>
                  <td className="num">{i.role === "included" ? "—" : formatAud(i.costIncGstCents)}</td>
                  <td className="num">{formatAud(t.items[idx]?.costCents ?? 0)}</td>
                  <td className="num">{formatAud(t.items[idx]?.sellCents ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body small muted">
          Pricing mode: {r.pricing.mode === "fixed" ? `fixed package price ${formatAud(r.pricing.fixedPriceCents ?? 0)}` : "calculated"} ·
          Labour {centiToInput(r.pricing.labourHoursCenti)} h × {formatAud(r.pricing.labourRateCents)}/h (complexity ×{(r.pricing.complexityBp / 10000).toFixed(2)}) ·
          GST {r.pricing.gstRegistered ? "registered" : "not registered"} · Values as saved{r.locked ? " and issued" : ""}.
          {r.internalNotes && <div style={{ marginTop: 8 }}><b>Internal notes:</b> {r.internalNotes}</div>}
        </div>
      </div>
      <div className="summary"><SummaryPanel totals={t} pricing={r.pricing} /></div>
    </div>
  );
}
