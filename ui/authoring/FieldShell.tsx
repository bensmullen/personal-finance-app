"use client";
import { cloneElement, useId, useState, useEffect, type ChangeEvent, type ReactElement, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";
import { financialField, fieldProblem, type FinancialField } from "./fieldContract.js";
import { normalizePersonalInput } from "../forecast/PersonalInputNormalizer.js";

type Control = ReactElement<InputHTMLAttributes<HTMLInputElement> & SelectHTMLAttributes<HTMLSelectElement>>;
export const confirmationField = (key: string) => ["ytdConfirmed", "taxConfirm", "operationAcceptance", "samePlan"].includes(key);
export function financialControlValue(key: string, props: { type?: string | undefined; checked?: boolean | undefined; value?: unknown }): unknown {
  return props.type === "checkbox" ? confirmationField(key) ? props.checked ? "confirmed" : "" : props.checked : props.value;
}
export function FieldStateCue({ state }: { state: FinancialField["state"] }) {
  if (state === "required") return <span className="field-required" aria-label="required"> *</span>;
  if (state === "optional") return <em className="field-optional"> (optional)</em>;
  return <span className="field-managed"> ({state === "derived" ? "calculated" : "read-only"})</span>;
}
/** Opens all enclosing disclosures before focusing the actual repair control. */
export function focusRepair(target: HTMLElement | null | undefined) {
  if (!target) return;
  let ancestor = target.parentElement;
  while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
  target.focus(); target.scrollIntoView({ block: "center", behavior: "smooth" });
}
export function commitAtControl(control: HTMLElement, commit: () => void) {
  const top = control.getBoundingClientRect().top;
  commit();
  requestAnimationFrame(() => {
    if (!control.isConnected) return;
    const shift = control.getBoundingClientRect().top - top;
    if (shift) window.scrollBy({ top: shift, behavior: "auto" });
    control.focus({ preventScroll: true });
  });
}
export function FieldShell({ fieldKey, children, required = false, error, hint, repairKey, presentation }: {
  fieldKey: string; children: Control; required?: boolean; error?: string | undefined; hint?: string; repairKey?: string | undefined; presentation?: FinancialField | undefined;
}) {
  const field = presentation ?? financialField(fieldKey), id = useId();
  const [alternateDate, setAlternateDate] = useState("");
  if (field.disclosure !== "technical" && !field.semanticFamily) throw new Error(`Missing financial ownership binding: ${fieldKey}`);
  const readOnly = children.props.readOnly || field.state === "read-only" || field.state === "derived";
  const state = field.state === "derived" ? "derived" : readOnly ? "read-only" : required ? "required" : "optional";
  const value = financialControlValue(fieldKey, children.props);
  const problem = readOnly ? undefined : error ?? fieldProblem(field, value, required);
  const normalization = !readOnly && children.type === "input" && typeof value === "string" && ["money", "decimal", "percent"].includes(field.format)
    ? normalizePersonalInput(value, field.format as "money" | "decimal" | "percent", field.unit.includes("USD") ? "USD" : undefined) : undefined;
  const help = `${field.description}${field.why === field.description ? "" : ` ${field.why}`} Unit: ${field.unit}. Example: ${field.example}. Source: ${field.source}. ${field.suggestion}`;
  const applyCanonical = (canonical: string) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    input.value = canonical;
    const handler = children.props.onChange as ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
    handler?.({ target: input, currentTarget: input } as ChangeEvent<HTMLInputElement>);
    input.focus();
  };
  const fullDate = alternateDate ? normalizePersonalInput(alternateDate, "date") : undefined;
  const month = alternateDate && ["simulationStart", "simulationEnd", "setupStart"].includes(fieldKey) ? normalizePersonalInput(alternateDate, "month") : undefined;
  const datePreview = fullDate && !fullDate.ok && month?.ok ? { ok: true as const, canonical: `${month.canonical}-01`, unit: "first day of the selected monthly forecast boundary" } : fullDate;
  return <div className={`field-shell${problem ? " field-invalid" : ""}${readOnly ? " field-readonly" : ""}`} data-financial-field={fieldKey} data-disclosure={field.disclosure} data-field-state={state} data-semantic-family={field.semanticFamily} data-semantic-binding={field.semanticBinding} data-semantic-scope={field.semanticScope}>
    <div className="field-heading"><label htmlFor={id}>{field.label}<FieldStateCue state={state} /></label>
      <details className="field-help"><summary role="button" aria-label={`Help for ${field.label}`} aria-description={help} title={help}>?</summary><div role="note">{help}</div></details>
    </div>
    {cloneElement(children, { id, required: !readOnly && required && (children.props.type !== "checkbox" || confirmationField(fieldKey)), "aria-required": !readOnly && required, "aria-label": children.props["aria-label"] ?? field.label, "aria-invalid": !!problem,
      "aria-describedby": `${id}-hint${problem ? ` ${id}-error` : ""}`, ...({ "data-repair": repairKey ?? fieldKey } as object) })}
    <small id={`${id}-hint`}>{hint ?? field.unit} · {state === "derived" ? "Calculated" : state === "read-only" ? "Read-only" : state === "required" ? "Required" : "Optional"}</small>
    {normalization?.ok && normalization.canonical !== value && <div className="normalization-preview" role="note">Preview: {normalization.canonical} {normalization.unit}. <button type="button" onClick={() => applyCanonical(normalization.canonical)}>Use normalized value</button></div>}
    {!readOnly && field.format === "date" && <details className="date-entry"><summary>Enter another date format</summary><label htmlFor={`${id}-alternate`}>Unambiguous full date</label><input id={`${id}-alternate`} aria-label={`Alternate date for ${field.label}`} value={alternateDate} onChange={event => setAlternateDate(event.target.value)} placeholder="31/12/2026 or 2026-12-31" />
      <small>Day/month order must be unambiguous. Month/year entry is supported only for forecast boundaries that require the first day of the month.</small>
      {datePreview?.ok ? <p>Preview: {datePreview.canonical} · {datePreview.unit}. <button type="button" onClick={() => { applyCanonical(datePreview.canonical); setAlternateDate(""); }}>Use normalized date</button></p> : datePreview && <p role="alert">{datePreview.reason}</p>}
    </details>}
    {problem && <p className="field-error" role="alert" id={`${id}-error`}>{problem}</p>}
  </div>;
}
export function FinancialInput({ fieldKey, value, onChange, options, required = false, error, repairKey, readOnly = false }: {
  fieldKey: string; value: string; onChange: (value: string) => void; options?: readonly { value: string; label: string }[];
  required?: boolean; error?: string | undefined; repairKey?: string | undefined; readOnly?: boolean;
}) {
  const field = financialField(fieldKey);
  return <FieldShell fieldKey={fieldKey} required={required} error={error} repairKey={repairKey} presentation={readOnly ? { ...field, state: "read-only" } : field}>
    {options ? <select value={value} onChange={event => onChange(event.target.value)} disabled={readOnly}><option value="">Choose {field.label.toLowerCase()}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input value={value} readOnly={readOnly} type={field.format === "date" ? "date" : "text"} inputMode={field.format === "integer" ? "numeric" : ["money", "decimal", "percent"].includes(field.format) ? "decimal" : undefined} placeholder={field.example} onChange={event => onChange(event.target.value)} />}
  </FieldShell>;
}
/** Workflow-local summary uses the same rendered field errors, not a second validator. */
export function RepairSummary({ errors }: { errors: readonly { target: string; message: string }[] }) {
  if (!errors.length) return null;
  return <section className="repair-summary" role="alert" aria-label="Plan needs attention"><strong>Complete these choices before forecasting</strong><ul>{errors.map(item => <li key={item.target}><button type="button" onClick={() => focusRepair(document.querySelector<HTMLElement>(`[data-repair="${CSS.escape(item.target)}"]`))}>{item.message}</button></li>)}</ul></section>;
}
const SECTION_PURPOSES: Readonly<Record<string, string>> = {
  "Annual eligibility facts": "These details help estimate how much you may contribute to retirement and health accounts each year.",
  "IRA eligibility & tax facts": "Your contribution-year income and eligibility determine IRA limits and modeled tax treatment.",
  "IRA & brokerage contributions": "Choose a holding and schedule purchases funded from checking or savings.",
  "Workplace & HSA contributions": "Choose the salary and workplace holding for employee or employer contributions.",
  "Annual contribution allowance": "Review annual limits and the capacity left after earlier and forecast contributions.",
  "Contributions already made this year": "Earlier contributions reduce the annual allowance available to your forecast.",
  "Debt & mortgage": "Choose which account pays each mortgage and check its contractual payment schedule.",
  "Investments": "Choose whose holdings the forecast includes; account cash and holdings are valued separately.",
  "Other investment activity": "Schedule supported investment purchases, sales, income and retirement transfers.",
  "Extra mortgage payments & refinancing": "Schedule extra principal or replace a supported fixed mortgage on a payment date.",
};
export function FinancialSection({ title, children, open = false, attention = false, id, purpose }: { title: string; children: ReactNode; open?: boolean; attention?: boolean; id?: string; purpose?: string }) {
  const [expanded, setExpanded] = useState(open || attention);
  useEffect(() => { if (open || attention) setExpanded(true); }, [open, attention]);
  const explanation = purpose ?? SECTION_PURPOSES[title];
  return <details className={`financial-section${attention ? " section-invalid" : ""}`} open={expanded || attention} onToggle={event => setExpanded(event.currentTarget.open)} id={id}><summary>{title}{attention && <span> · Needs attention</span>}</summary>{explanation && <p className="muted">{explanation}</p>}{children}</details>;
}
