"use client";
import { cloneElement, useId, useState, useEffect, type ReactElement, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";
import { financialField, fieldProblem } from "./fieldContract.js";

type Control = ReactElement<InputHTMLAttributes<HTMLInputElement> & SelectHTMLAttributes<HTMLSelectElement>>;
/** Opens all enclosing disclosures before focusing the actual repair control. */
export function focusRepair(target: HTMLElement | null | undefined) {
  if (!target) return;
  let ancestor = target.parentElement;
  while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
  target.focus(); target.scrollIntoView({ block: "center", behavior: "smooth" });
}
export function FieldShell({ fieldKey, children, required = false, error, hint, repairKey }: {
  fieldKey: string; children: Control; required?: boolean; error?: string | undefined; hint?: string; repairKey?: string | undefined;
}) {
  const field = financialField(fieldKey), id = useId();
  const readOnly = children.props.readOnly || children.props.disabled;
  const problem = readOnly ? undefined : error ?? fieldProblem(field, children.props.value, required);
  const help = `${field.description} ${field.why} Unit: ${field.unit}. Example: ${field.example}. ${field.suggestion}`;
  return <div className={`field-shell${problem ? " field-invalid" : ""}${readOnly ? " field-readonly" : ""}`} data-financial-field={fieldKey} data-disclosure={field.disclosure} data-field-state={readOnly ? "read-only" : required ? "required" : field.state}>
    <div className="field-heading"><label htmlFor={id}>{field.label}{required && <span aria-label="required"> *</span>}</label>
      <details className="field-help"><summary role="button" aria-label={`Help for ${field.label}`} aria-description={help} title={help}>?</summary><div role="note">{help}</div></details>
    </div>
    {cloneElement(children, { id, required, "aria-label": children.props["aria-label"] ?? field.label, "aria-invalid": !!problem,
      "aria-describedby": `${id}-hint${problem ? ` ${id}-error` : ""}`, ...({ "data-repair": repairKey ?? fieldKey } as object) })}
    <small id={`${id}-hint`}>{hint ?? field.unit}{readOnly ? " · Read-only" : ""}</small>
    {problem && <p className="field-error" role="alert" id={`${id}-error`}>{problem}</p>}
  </div>;
}
export function FinancialInput({ fieldKey, value, onChange, options, required = false, error, repairKey, readOnly = false }: {
  fieldKey: string; value: string; onChange: (value: string) => void; options?: readonly { value: string; label: string }[];
  required?: boolean; error?: string | undefined; repairKey?: string | undefined; readOnly?: boolean;
}) {
  const field = financialField(fieldKey);
  return <FieldShell fieldKey={fieldKey} required={required} error={error} repairKey={repairKey}>
    {options ? <select value={value} onChange={event => onChange(event.target.value)} disabled={readOnly}><option value="">Choose {field.label.toLowerCase()}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input value={value} readOnly={readOnly} type={field.format === "date" ? "date" : "text"} inputMode={field.format === "integer" ? "numeric" : ["money", "decimal", "percent"].includes(field.format) ? "decimal" : undefined} placeholder={field.example} onChange={event => onChange(event.target.value)} />}
  </FieldShell>;
}
/** Workflow-local summary uses the same rendered field errors, not a second validator. */
export function RepairSummary({ errors }: { errors: readonly { target: string; message: string }[] }) {
  if (!errors.length) return null;
  return <section className="repair-summary" role="alert" aria-label="Plan needs attention"><strong>Complete these choices before forecasting</strong><ul>{errors.map(item => <li key={item.target}><button type="button" onClick={() => focusRepair(document.querySelector<HTMLElement>(`[data-repair="${CSS.escape(item.target)}"]`))}>{item.message}</button></li>)}</ul></section>;
}
export function FinancialSection({ title, children, open = false, attention = false, id }: { title: string; children: ReactNode; open?: boolean; attention?: boolean; id?: string }) {
  const [expanded, setExpanded] = useState(open || attention);
  useEffect(() => { if (open || attention) setExpanded(true); }, [open, attention]);
  return <details className={`financial-section${attention ? " section-invalid" : ""}`} open={expanded || attention} onToggle={event => setExpanded(event.currentTarget.open)} id={id}><summary>{title}{attention && <span> · Needs attention</span>}</summary>{children}</details>;
}
