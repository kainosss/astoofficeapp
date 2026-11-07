import { useState } from "react";
import type { Customer, Site } from "../../shared/types";
import { Field } from "./ui";

export type CustomerInput = Pick<Customer, "kind" | "name" | "contactPerson" | "email" | "phone" | "notes" | "archived">;
export type SiteInput = Pick<Site, "address" | "suburb" | "state" | "postcode" | "notes">;
export const emptyCustomer: CustomerInput = { kind: "individual", name: "", contactPerson: "", email: "", phone: "", notes: "", archived: false };
export const emptySite: SiteInput = { address: "", suburb: "", state: "QLD", postcode: "", notes: "" };
const STATES = ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"];

export function CustomerFields({ value, onChange }: { value: CustomerInput; onChange: (v: CustomerInput) => void }) {
  const set = (k: keyof CustomerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid g2">
      <Field label="Type">
        <select value={value.kind} onChange={set("kind")}><option value="individual">Individual</option><option value="business">Business</option></select>
      </Field>
      <Field label={value.kind === "business" ? "Business name" : "Customer name"}><input value={value.name} onChange={set("name")} required autoFocus /></Field>
      <Field label="Contact person"><input value={value.contactPerson} onChange={set("contactPerson")} /></Field>
      <Field label="Phone"><input value={value.phone} onChange={set("phone")} inputMode="tel" /></Field>
      <Field label="Email" className="span2"><input type="email" value={value.email} onChange={set("email")} /></Field>
      <Field label="Notes" className="span2"><textarea value={value.notes} onChange={set("notes")} rows={2} /></Field>
    </div>
  );
}

export function SiteFields({ value, onChange }: { value: SiteInput; onChange: (v: SiteInput) => void }) {
  const set = (k: keyof SiteInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid g4">
      <Field label="Street address" className="span-all"><input value={value.address} onChange={set("address")} /></Field>
      <Field label="Suburb" className="span2"><input value={value.suburb} onChange={set("suburb")} /></Field>
      <Field label="State"><select value={value.state} onChange={set("state")}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Postcode"><input value={value.postcode} onChange={set("postcode")} inputMode="numeric" maxLength={4} /></Field>
      <Field label="Site notes" className="span-all"><textarea value={value.notes} onChange={set("notes")} rows={2} placeholder="Access, roof space, pets, parking…" /></Field>
    </div>
  );
}

/** Controlled helper to keep form state + submitting flag together. */
export function useFormState<T>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { value, setValue, busy, setBusy, error, setError };
}
