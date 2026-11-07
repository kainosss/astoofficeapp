import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { centiToInput, centsToInput, toCenti, toCents } from "../../shared/money";
import type { QuoteStatus } from "../../shared/types";

// ---------- Data loading ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  return { data, setData, error, loading, reload };
}

// ---------- Toasts ----------
type Toast = { message: string; kind: "ok" | "error" };
const ToastCtx = createContext<(message: string, kind?: Toast["kind"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((message: string, kind: Toast["kind"] = "ok") => {
    setToast({ message, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), kind === "error" ? 6000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={`toast ${toast.kind === "error" ? "error" : ""}`} role="status">{toast.message}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Layout bits ----------
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  if (error) return <div className="notice error">{error}</div>;
  return <div className="loading">Loading…</div>;
}

export const STATUS_LABEL: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired" };
export function StatusBadge({ status }: { status: QuoteStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ""}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

// ---------- Numeric inputs (string while editing, integer on commit) ----------
function useNumericInput(value: number | null, format: (n: number | null) => string, parse: (s: string) => number, onChange: (v: number | null) => void, allowEmpty: boolean) {
  const [text, setText] = useState(format(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(format(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (s: string) => {
    if (s.trim() === "") {
      setInvalid(false);
      onChange(allowEmpty ? null : 0);
      return;
    }
    try {
      const n = parse(s);
      setInvalid(false);
      onChange(n);
    } catch {
      setInvalid(true);
    }
  };
  return {
    value: text,
    className: invalid ? "invalid" : "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setText(e.target.value); commit(e.target.value); },
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; if (!invalid) setText(format(value)); },
  };
}

type NumProps = { value: number | null; onChange: (v: number | null) => void; allowEmpty?: boolean; placeholder?: string; disabled?: boolean; min?: number; ariaLabel?: string; className?: string };

/** Dollar input storing integer cents. */
export function MoneyInput({ value, onChange, allowEmpty = false, placeholder, disabled, ariaLabel, className }: NumProps) {
  const p = useNumericInput(value, centsToInput, (s) => { const c = toCents(s); if (c < 0) throw new Error(); return c; }, onChange, allowEmpty);
  return (
    <div className="input-affix">
      <span className="pre">$</span>
      <input {...p} className={`num has-pre ${p.className} ${className ?? ""}`} inputMode="decimal" placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} />
    </div>
  );
}

/** Decimal input storing hundredths (quantities, hours, percentages as basis points). */
export function DecimalInput({ value, onChange, allowEmpty = false, placeholder, disabled, suffix, ariaLabel, className }: NumProps & { suffix?: string }) {
  const p = useNumericInput(value, centiToInput, (s) => { const c = toCenti(s); if (c < 0) throw new Error(); return c; }, onChange, allowEmpty);
  return (
    <div className="input-affix">
      <input {...p} className={`num ${suffix ? "has-post" : ""} ${p.className} ${className ?? ""}`} inputMode="decimal" placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} />
      {suffix && <span className="post">{suffix}</span>}
    </div>
  );
}

export const PercentInput = (props: NumProps) => <DecimalInput {...props} suffix="%" />;

// ---------- Icons (simple inline strokes) ----------
const PATHS: Record<string, string> = {
  dashboard: "M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z",
  quote: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8M9 9h3",
  customers: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  equipment: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  package: "M3 7h18v13H3zM3 7l2-4h14l2 4M9 11h6",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  plus: "M12 5v14M5 12h14",
  x: "M18 6L6 18M6 6l12 12",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M19 12l-7 7-7-7",
  menu: "M3 6h18M3 12h18M3 18h18",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  copy: "M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  back: "M19 12H5M12 19l-7-7 7-7",
};
export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
