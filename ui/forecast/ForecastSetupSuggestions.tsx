import { useState } from "react";
import type { PersonalDraft, PersonalSessionSettings } from "../../src/application/personalMvp.js";
import { age90Horizon } from "../../src/application/forecastReadiness.js";
import { acceptPlanningStarters, currentPlan, replaceCurrentPlanHorizon, type PlanningStarters } from "../../src/application/forecastSetup.js";
import { objects } from "../../src/application/compiler/shared.js";
import { percentageToRate } from "../entityPresentation.js";
import { FieldShell } from "../authoring/FieldShell.js";
import { financialField, entityField } from "../authoring/fieldContract.js";

export function ForecastSetupSuggestions({ model, settings, apply }: { model: PersonalDraft; settings: PersonalSessionSettings; apply: (model: PersonalDraft, end: string) => void }) {
  const people = objects(model, "Person");
  const [selected, setSelected] = useState<string[]>(people.length === 1 ? [String(people[0]!.person_id)] : []);
  const [age, setAge] = useState("90"), [dismissed, setDismissed] = useState(false), [error, setError] = useState("");
  const proposal = age90Horizon(model, selected, settings.simulationStart, /^\d+$/.test(age) ? Number(age) : 0);
  if (dismissed) return <button type="button" onClick={() => setDismissed(false)}>Review age-90 starting point</button>;
  return <section className="starting-points" aria-label="Age-oriented forecast target">
    <h3>Forecast through age 90</h3><p>Suggested starting point — edit or dismiss. Age 90 is a forecast cutoff, not a death assumption. Your saved dates remain in effect until you apply a change.</p>
    <fieldset><legend>Select planning adults</legend>{people.map(person => <label key={String(person.person_id)}><input type="checkbox" checked={selected.includes(String(person.person_id))} onChange={event => setSelected(previous => event.target.checked ? [...previous, String(person.person_id)] : previous.filter(id => id !== person.person_id))} />{String(person.first_name ?? "Person")} · DOB {String(person.date_of_birth ?? "not recorded")}</label>)}</fieldset>
    <FieldShell fieldKey="horizon" presentation={{ ...financialField("horizon"), state: "optional", disclosure: "common", format: "integer", label: "Target age", unit: "years of age", description: "Requested forecast cutoff age for the explicitly selected planning adults; the birthday month is included.", source: "Selected adults' sourced birth dates and Current Plan" }}><input aria-label="Target age" inputMode="numeric" value={age} onChange={event => setAge(event.target.value)} /></FieldShell>
    {proposal ? <><p>{proposal.targets.map(target => `${target.name}: age ${age} on ${target.birthday}`).join("; ")}. Proposed monthly exclusive end: <strong>{proposal.end}</strong>, including the birthday month.</p>
      <p>Requested coverage is separate from modeled coverage. Future tax law is an assumption; missing financial mechanics remain incomplete.</p>
      <button type="button" onClick={() => {
        try {
          if (!/^\d+$/.test(age) || Number(age) < 1 || Number(age) > 150) throw new Error("Choose an age from 1 to 150.");
          const target = age90Horizon(model, selected, settings.simulationStart, Number(age));
          if (!target) throw new Error("The selected age must be after the run start for every reference adult.");
          const plan = currentPlan(model);
          const next = replaceCurrentPlanHorizon(model, crypto.randomUUID(), String(plan?.start_date ?? settings.simulationStart), target.end, { start: settings.simulationStart, end: target.end });
          apply(next, target.end); setError("");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Review Current Plan dates."); }
      }}>Apply requested age target</button></> : <p>Select eligible planning adults with sourced birth dates and a 90th birthday after the run start. Otherwise choose Current Plan dates directly.</p>}
    <button type="button" onClick={() => setDismissed(true)}>Dismiss age suggestion</button>{error && <p role="alert">{error}</p>}
  </section>;
}

export function PlanningStartingPoints({ model, apply, dismiss }: { model: PersonalDraft; apply: (model: PersonalDraft) => void; dismiss: () => void }) {
  const [values, setValues] = useState({ inflation: "2.5", wages: "3", portfolio: "5", reserveMonths: "6" });
  const [omitted, setOmitted] = useState<string[]>([]), [error, setError] = useState("");
  return <section className="panel starting-points" aria-label="Optional planning starting points"><h2>Planning starting points</h2>
    <p>Suggested starting point — edit or dismiss. Apply once for this new plan. Existing sourced assumptions and contract-specific links take priority.</p>
    {([ ["inflation", "Nominal expense growth", "% annually"], ["wages", "Wage growth", "% annually"], ["portfolio", "Generic portfolio return", "% annually"], ["reserveMonths", "Essential-expense reserve goal", "months; goal only, no cash transfer"] ] as const).filter(([key]) => !omitted.includes(key)).map(([key, label, unit]) => <div key={key}><FieldShell fieldKey="value" presentation={{ ...entityField("value", "Assumption", undefined, true, values[key], key === "reserveMonths" ? "months" : "effective annual rate", undefined, ({ inflation: "inflation", wages: "salary_growth", portfolio: "market_return", reserveMonths: "other" })[key])!, label, unit, format: key === "reserveMonths" ? "integer" : "percent", source: "Optional new-plan proposal; requires explicit acceptance" }}><input aria-label={label} value={values[key]} onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))} /></FieldShell><small>Suggested starting point — edit or dismiss · {unit}</small><button type="button" onClick={() => setOmitted(previous => [...previous, key])}>Dismiss {label.toLowerCase()}</button></div>)}
    <button type="button" onClick={() => { try {
      const accepted: PlanningStarters = Object.fromEntries(Object.entries(values).filter(([key]) => !omitted.includes(key)).map(([key, value]) => [key, key === "reserveMonths" ? value : percentageToRate(value)]));
      apply(acceptPlanningStarters(model, accepted, () => crypto.randomUUID())); dismiss();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Review the suggested values."); } }}>Apply accepted starting points</button>
    <button type="button" onClick={dismiss}>Dismiss all starting points</button>{error && <p role="alert">{error}</p>}
  </section>;
}
