/**
 * Reusable customer-facing wording: scope templates, standard conditions and warranty text.
 * All of it is copied into Settings and remains editable; nothing here is applied to issued quotes.
 */

export type ScopeTemplateKey = "cctv" | "alarm" | "maintenance";

export const SCOPE_TEMPLATE_LABELS: Record<ScopeTemplateKey, string> = {
  cctv: "CCTV installation",
  alarm: "Intruder alarm installation",
  maintenance: "Preventative maintenance",
};

export const DEFAULT_SCOPE_CCTV = [
  "Scope of Works – CCTV Installation",
  "",
  "Supply, installation, configuration and testing of the CCTV system and equipment listed in this quotation.",
  "",
  "Installation includes Cat6 network cabling, RJ45 terminations, camera mounting and surface-mounted ducting where required to achieve a neat and professional finish.",
  "",
  "Final camera positions, equipment locations and cable routes will be confirmed with the customer prior to installation.",
  "",
  "System commissioning includes recording configuration, remote viewing setup (subject to suitable internet connectivity) and a basic customer demonstration.",
  "",
  "Any unforeseen works outside the agreed scope will be discussed and approved by the customer before proceeding.",
].join("\n");

// Starting drafts for review in Settings (no apostrophes: these are also SQL column defaults).
export const DEFAULT_SCOPE_ALARM = [
  "Scope of Works – Intruder Alarm Installation",
  "",
  "Supply, installation, programming and testing of the intruder alarm system and equipment listed in this quotation.",
  "",
  "Final detector, keypad, siren and control panel locations will be confirmed with the customer prior to installation.",
  "",
  "Commissioning includes zone programming, user code setup and a basic customer demonstration of arming and disarming the system.",
  "",
  "Any unforeseen works outside the agreed scope will be discussed and approved by the customer before proceeding.",
].join("\n");

export const DEFAULT_SCOPE_MAINTENANCE = [
  "Scope of Works – Preventative Maintenance",
  "",
  "Inspection and testing of the security equipment listed in this quotation, including checking operation, power supplies, recording and connectivity where applicable.",
  "",
  "Minor adjustments and cleaning are included. Any faulty equipment or additional work identified will be reported and quoted separately before proceeding.",
].join("\n");

export const DEFAULT_SCOPE_TEMPLATES: Record<ScopeTemplateKey, string> = {
  cctv: DEFAULT_SCOPE_CCTV,
  alarm: DEFAULT_SCOPE_ALARM,
  maintenance: DEFAULT_SCOPE_MAINTENANCE,
};

/** Standard conditions, added to the editable exclusions list as "Label: text" lines. */
export const RECOMMENDED_CONDITIONS: string[] = [
  "Recording and storage: Recording duration depends on camera resolution, recording settings, storage capacity and activity levels. No specific recording retention period is guaranteed unless expressly stated in the quotation.",
  "Power and network requirements: The quotation assumes suitable existing power, internet and network infrastructure is available where required. New electrical power points, internet services and network upgrades are excluded unless specifically included.",
  "Installation conditions: Pricing assumes reasonable access to the agreed installation locations. Additional work arising from unforeseen access restrictions or concealed site conditions will be discussed and approved before proceeding.",
  "CCTV privacy: The customer is responsible for the lawful operation of the CCTV system, including required notices, privacy obligations and appropriate management of recorded footage. This does not remove ASTO SECURITY's own applicable legal obligations.",
];

/** Append recommended lines that are not already present (matched by their label). */
export function mergeLines(existing: string, additions: string[]): string {
  const lines = existing.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const has = (add: string) => {
    const label = add.split(":")[0].trim().toLowerCase();
    return lines.some((l) => l.toLowerCase().replace(/^[-•*]\s*/, "").startsWith(label));
  };
  return [...lines, ...additions.filter((a) => !has(a))].join("\n");
}

/**
 * Prescribed text for a warranty against defects covering goods AND services
 * (Competition and Consumer Regulations 2010, regulation 90). Do not abbreviate.
 */
export const ACL_NOTICE_GOODS_AND_SERVICES = [
  "Our goods and services come with guarantees that cannot be excluded under the Australian Consumer Law. For major failures with the service, you are entitled:",
  "• to cancel your service contract with us; and",
  "• to a refund for the unused portion, or to compensation for its reduced value.",
  "You are also entitled to choose a refund or replacement for major failures with goods. If a failure with the goods or a service does not amount to a major failure, you are entitled to have the failure rectified in a reasonable time. If this is not done you are entitled to a refund for the goods and to cancel the contract for the service and obtain a refund of any unused portion. You are also entitled to be compensated for any other reasonably foreseeable loss or damage from a failure in the goods or service.",
].join("\n");

export type ClaimExpensesPolicy = "" | "business" | "customer";

export interface WarrantyInputs {
  businessName: string;
  email: string;
  phone: string;
  address: string;
  workmanshipWarrantyMonths: number;
  manufacturerWarrantyText: string;
  claimExpensesPolicy: ClaimExpensesPolicy;
}

const missing = (label: string) => `[${label} — add in Settings]`;

/** Compose warranty wording from Settings. Missing details become visible placeholders, never invented values. */
export function buildWarrantyText(s: WarrantyInputs): string {
  const name = s.businessName.trim() || "ASTO SECURITY";
  const email = s.email.trim() || missing("business email");
  const phone = s.phone.trim() || missing("business phone");
  const address = s.address.trim() || missing("business address");
  const months = s.workmanshipWarrantyMonths > 0 ? s.workmanshipWarrantyMonths : 12;
  const expenses =
    s.claimExpensesPolicy === "business"
      ? `${name} will bear the reasonable expenses of making a warranty claim. To be reimbursed, send your receipts with your claim to ${email}.`
      : s.claimExpensesPolicy === "customer"
        ? "You are responsible for any expenses you incur in making a warranty claim under this voluntary warranty. This does not affect your rights under the Australian Consumer Law."
        : missing("Choose who bears warranty claim expenses");
  return [
    `Workmanship warranty: ${name} warrants its installation workmanship for ${months} months from the date of completion. If a defect in our installation workmanship appears during this period (for example a faulty termination, a loose mounting or a cable fault caused by our installation), we will rectify it at no charge.`,
    "",
    `Equipment warranty: ${s.manufacturerWarrantyText.trim() || missing("manufacturer warranty wording")}`,
    "",
    `How to claim: Contact ${name} within the warranty period by email at ${email} or by phone on ${phone}, describing the problem and quoting your quotation or invoice number. Our business address is ${address}. We will arrange to inspect the system and advise you of the outcome.`,
    "",
    `Claim expenses: ${expenses}`,
    "",
    "This voluntary workmanship warranty does not cover damage caused by misuse, accident, power surges, vandalism, or alterations or repairs carried out by other parties. These limits apply only to this voluntary warranty and do not exclude or reduce your rights under the Australian Consumer Law.",
    "",
    "The benefits given by this warranty are in addition to other rights and remedies you have under a law in relation to the goods and services to which the warranty relates.",
    "",
    ACL_NOTICE_GOODS_AND_SERVICES,
  ].join("\n");
}

export interface SettingsWarningInputs extends WarrantyInputs {
  abn: string;
  warrantyText: string;
  depositTerms: string;
  paymentTerms: string;
}

/** Missing or placeholder information that should be fixed before issuing quotations. */
export function settingsWarnings(s: SettingsWarningInputs): string[] {
  const w: string[] = [];
  if (!s.abn.trim()) w.push("ABN is not set.");
  if (!s.email.trim()) w.push("Business email is not set (required in warranty information).");
  if (!s.phone.trim()) w.push("Business phone is not set (required in warranty information).");
  if (!s.address.trim()) w.push("Business address is not set (required in warranty information).");
  if (!s.claimExpensesPolicy) w.push("Choose who bears warranty claim expenses (required in warranty information).");
  if (!s.manufacturerWarrantyText.trim()) w.push("Manufacturer warranty wording is not set.");
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  if (!norm(s.warrantyText).includes(norm(ACL_NOTICE_GOODS_AND_SERVICES).slice(0, 120)))
    w.push("Warranty information does not contain the prescribed Australian Consumer Law notice for goods and services.");
  if (/\[[^\]]*(to be confirmed|add in settings|to be provided)[^\]]*\]/i.test([s.warrantyText, s.depositTerms, s.paymentTerms].join("\n")))
    w.push("Deposit, payment or warranty text still contains placeholder wording in [brackets].");
  return w;
}

/** Scope text may start with its own title line ("Scope of Works – CCTV Installation"). */
export function splitScopeTitle(scope: string): { title: string; body: string } {
  const lines = scope.replace(/\r\n/g, "\n").split("\n");
  const first = lines[0]?.trim() ?? "";
  if (/^scope of works\b/i.test(first) && first.length <= 80) return { title: first, body: lines.slice(1).join("\n").trim() };
  return { title: "Scope of works", body: scope.trim() };
}

// ---------------------------------------------------------------------------
// Warranty Statement (separate document accompanying each quotation)
// ---------------------------------------------------------------------------

/** Quotation document format: 1 = full warranty printed inside the quotation (legacy issued quotes),
 *  2 = short warranty summary in the quotation + separate Warranty Statement. */
export type DocumentFormat = 1 | 2;
export const CURRENT_DOCUMENT_FORMAT: DocumentFormat = 2;

export const BENEFITS_IN_ADDITION =
  "The benefits given by this warranty are in addition to other rights and remedies you have under a law in relation to the goods and services to which the warranty relates.";

/** Workmanship warranty period in months, read from the revision's own warranty wording. */
export function workmanshipMonths(warrantyText: string): number | null {
  const m = warrantyText.match(/workmanship[^.]*?(\d{1,3})[\s-]*months?/i) ?? warrantyText.match(/(\d{1,3})[\s-]*months?/i);
  return m ? Number(m[1]) : null;
}

/** Short warranty section printed in the quotation (format 2). */
export function warrantySummary(businessName: string, warrantyText: string): string {
  const name = businessName.trim() || "ASTO SECURITY";
  const months = workmanshipMonths(warrantyText);
  const period = months ? `a ${months}-month installation workmanship warranty` : "an installation workmanship warranty";
  return [
    `${name} provides ${period}. Supplied equipment is covered by the applicable manufacturer's warranty.`,
    "",
    `Full warranty terms, claim procedures and Australian Consumer Law information are provided in the accompanying ${name} Warranty Statement, which forms part of this quotation.`,
  ].join("\n");
}

export function acceptanceStatement(reference: string, total: string, gstRegistered: boolean, businessName: string, format: DocumentFormat): string {
  const base = `I accept quotation ${reference} for a total of ${total}${gstRegistered ? " including GST" : ""}`;
  return format === 2
    ? `${base}, and acknowledge receipt of the accompanying ${businessName.trim() || "ASTO SECURITY"} Warranty Statement, which forms part of this quotation.`
    : `${base}.`;
}

export interface WarrantySection { title: string; paragraphs: string[] }

const SECTION_BY_LABEL: [RegExp, string][] = [
  [/^workmanship warranty$/i, "Installation Workmanship Warranty"],
  [/^(equipment|manufacturer('s)?( equipment)?) warranty$/i, "Manufacturer Equipment Warranty"],
  [/^how to (make a (warranty )?)?claim$/i, "How to Make a Warranty Claim"],
  [/^(warranty )?claim expenses$/i, "Warranty Claim Expenses"],
];
const LABEL_RE = /^([^:.\n]{3,48}):\s+([\s\S]+)$/;
const norm = (t: string) => t.replace(/\s+/g, " ").trim();

/** Split saved warranty wording into the Warranty Statement's sections, preserving every word and its order. */
export function warrantySections(text: string): WarrantySection[] {
  const out: WarrantySection[] = [];
  const add = (title: string, para: string) => {
    const last = out[out.length - 1];
    if (last && last.title === title) last.paragraphs.push(para);
    else out.push({ title, paragraphs: [para] });
  };
  const aclStart = norm(ACL_NOTICE_GOODS_AND_SERVICES).slice(0, 60).toLowerCase();
  for (const para of text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const m = para.match(LABEL_RE);
    const mapped = m ? SECTION_BY_LABEL.find(([re]) => re.test(m[1].trim())) : undefined;
    if (m && mapped) { add(mapped[1], m[2].trim()); continue; }
    const n = norm(para).toLowerCase();
    if (n.startsWith(aclStart) || n.startsWith("the benefits given by this warranty")) add("Australian Consumer Law", para);
    else if (/^this voluntary/.test(n) || n.includes("apply only to this voluntary warranty")) add("Voluntary Warranty Conditions", para);
    else add("Warranty Terms", para);
  }
  return out;
}

export interface DocumentCheckInputs {
  business: { name: string; abn: string; email: string; phone: string; address: string };
  warrantyText: string;
  depositTerms: string;
  paymentTerms: string;
}

/** Mandatory or placeholder information missing from a quotation's documents (checked before issuing). */
export function documentWarnings(d: DocumentCheckInputs): string[] {
  const w: string[] = [];
  if (!d.business.abn.trim()) w.push("Business ABN is missing.");
  if (!d.business.address.trim()) w.push("Business address is missing (required in the Warranty Statement).");
  if (!d.business.phone.trim()) w.push("Business phone number is missing (required in the Warranty Statement).");
  if (!d.business.email.trim()) w.push("Business email is missing (required in the Warranty Statement).");
  const text = norm(d.warrantyText);
  if (!text.includes(norm(ACL_NOTICE_GOODS_AND_SERVICES))) w.push("The warranty wording does not contain the complete prescribed Australian Consumer Law notice for goods and services.");
  if (!text.toLowerCase().includes("in addition to other rights and remedies")) w.push("The warranty wording does not state that its benefits are in addition to other rights and remedies under the law.");
  if (!/claim/i.test(text) || !/(contact|email|phone)/i.test(text)) w.push("The warranty wording does not explain how to make a claim.");
  if (!/expense/i.test(text)) w.push("The warranty wording does not state who bears the expenses of making a claim.");
  if (/\[[^\]]{3,}\]/.test([d.warrantyText, d.depositTerms, d.paymentTerms].join("\n"))) w.push("The warranty, deposit or payment wording still contains [placeholder] text.");
  return w;
}
