import { useEffect, useState } from "react";
import { percentageToRate, rateToPercentage } from "../entityPresentation.js";

export function FieldHelp({ label, children }: { label: string; children: string }) {
  return <details style={{ minWidth: 0, maxWidth: "42rem" }}><summary title={children}>About {label.toLowerCase()}</summary><p>{children}</p></details>;
}

/** UI percentages cross this boundary as exact canonical fraction strings. */
export function PercentageInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const display = () => { try { return rateToPercentage(value); } catch { return ""; } };
  const [text, setText] = useState(display);
  useEffect(() => { if (!value.startsWith("Invalid percentage:")) setText(display()); }, [value]);
  const valid = text === "" || /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text);
  return <div style={{ minWidth: 0, width: "100%", maxWidth: "32rem" }}>
    <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", minWidth: 0, writingMode: "horizontal-tb", wordBreak: "normal" }}>
      <span style={{ minWidth: "10rem", flex: "1 1 12rem" }}>{label} (%)</span>
      <input aria-label={label} inputMode="decimal" aria-invalid={!valid} value={text}
        style={{ width: "8rem", maxWidth: "100%", flex: "0 1 8rem" }} onChange={event => {
          const next = event.target.value; setText(next);
          try { onChange(next === "" ? "" : percentageToRate(next)); }
          catch { onChange(`Invalid percentage:${next}`); }
        }} />
      <span>{text || "0"}%</span>
    </label>
    {!valid && <p role="alert">Enter a percentage such as 5 or 5.25 without the % sign.</p>}
    <FieldHelp label={label}>Enter a percentage: 5 means 5%, and 5.25 means 5.25%. The app stores the exact decimal fraction so the forecast can use this rate without losing precision.</FieldHelp>
  </div>;
}
