import { Link, useNavigate } from "react-router-dom";
import { calculatePricing } from "../../shared/pricing";
import { centiToInput, formatAud, formatBp } from "../../shared/money";
import { itemsFromPackage, pricingFrom, toPricingItems } from "../../shared/quoteBuilder";
import type { Equipment, Package, Settings } from "../../shared/types";
import { api } from "../api";
import { Icon, Loading, PageHeader, useLoad } from "../components/ui";

export function Packages() {
  const pkgs = useLoad(() => api.get<Package[]>("/packages"));
  const eq = useLoad(() => api.get<Equipment[]>("/equipment"));
  const settings = useLoad(() => api.get<Settings>("/settings"));
  const nav = useNavigate();
  if (!pkgs.data || !eq.data || !settings.data) return <Loading error={pkgs.error || eq.error || settings.error} />;
  const eqMap = new Map(eq.data.map((e) => [e.id, e]));
  return (
    <>
      <PageHeader title="CCTV Packages" sub="Reusable starting points for quotations. Editing a package never changes existing quotations."
        actions={<Link className="btn primary" to="/packages/new"><Icon name="plus" />New package</Link>} />
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Package</th><th>Pricing</th><th className="num">Labour</th><th className="num">Customer price</th><th className="num hide-sm">Direct costs</th><th className="num hide-sm">Gross margin</th><th className="num hide-sm">Surplus</th></tr></thead>
            <tbody>
              {pkgs.data.map((p) => {
                const t = calculatePricing(toPricingItems(itemsFromPackage(p, eqMap)), pricingFrom(settings.data!, p));
                return (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/packages/${p.id}`)}>
                    <td><strong>{p.name}</strong>{!p.active && <span className="badge neutral" style={{ marginLeft: 6 }}>Inactive</span>}<div className="sub">{p.description}</div></td>
                    <td>{p.pricingMode === "fixed" ? "Fixed" : "Calculated"}</td>
                    <td className="num">{centiToInput(p.labourHoursCenti)} h</td>
                    <td className="num"><strong>{formatAud(t.totalCents)}</strong></td>
                    <td className="num hide-sm">{formatAud(t.directCostCents)}</td>
                    <td className="num hide-sm">{formatBp(t.grossMarginBp)}</td>
                    <td className={`num hide-sm ${t.surplusCents < 0 ? "neg" : ""}`}>{formatAud(t.surplusCents)}</td>
                  </tr>
                );
              })}
              {pkgs.data.length === 0 && <tr><td colSpan={7} className="empty">No packages yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card-body small muted">Margins use current catalogue costs and business settings, with no travel.</div>
      </div>
    </>
  );
}
