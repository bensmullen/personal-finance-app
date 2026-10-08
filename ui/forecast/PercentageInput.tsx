import { useEffect, useState, useId } from "react";
import { percentageToRate, rateToPercentage } from "../entityPresentation.js";
import { FieldShell, RepairSummary } from "../authoring/FieldShell.js";
import { FINANCIAL_FIELDS, financialField, fieldProblem } from "../authoring/fieldContract.js";

export function FieldHelp({ label, children }: { label: string; children: string }) {
  return <details style={{ minWidth: 0, maxWidth: "42rem" }}><summary title={children}>About {label.toLowerCase()}</summary><p>{children}</p></details>;
}

/** UI percentages cross this boundary as exact canonical fraction strings. */
export function PercentageInput({ label, value, onChange, fieldKey: explicitKey, required = false, repairKey, error }: { label: string; value: string; onChange: (value: string) => void; fieldKey?: string; required?: boolean; repairKey?: string; error?: string | undefined }) {
  const identity = useId();
  const display = () => { try { return rateToPercentage(value); } catch { return ""; } };
  const [text, setText] = useState(display);
  useEffect(() => { if (!value.startsWith("Invalid percentage:")) setText(display()); }, [value]);
  const valid = text === "" || /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text);
  const fieldKey = explicitKey ?? Object.values(FINANCIAL_FIELDS).find(field => field.label === label)?.key
    ?? ({ "Annual growth / return": "return", "Major debt annual rate": "interest_rate", "Replacement nominal annual rate": "interest_rate" } as Record<string, string>)[label];
  if (!fieldKey) throw new Error(`Missing financial percentage metadata: ${label}`);
  const problem = error ?? (!valid ? "Enter a percentage such as 5 or 5.25 without the % sign." : fieldProblem(financialField(fieldKey), text, required));
  const target = repairKey ?? `percentage:${identity}`;
  return <div><RepairSummary errors={problem ? [{ target, message: `${label}: ${problem}` }] : []} /><FieldShell fieldKey={fieldKey} repairKey={target} required={required} error={problem} hint="Enter a percentage, for example 5.25 for 5.25%.">
    <input aria-label={label} inputMode="decimal" value={text} onChange={event => {
      const next = event.target.value; setText(next);
      try { onChange(next === "" ? "" : percentageToRate(next)); }
      catch { onChange(`Invalid percentage:${next}`); }
    }} />
  </FieldShell></div>;
}
