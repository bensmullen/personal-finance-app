"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import type { PersonalDraft } from "../../src/application/personalMvp.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import { selectRetirementIncomeChartData } from "../../src/application/retirementIncomeChartData.js";
import { CashChartDetails, ForecastProgress } from "../calm/CalmPresentation.js";
import { HouseholdChart } from "./HouseholdChart.js";

/** Read-only timeline. All edits go to the existing Plan owners. */
export function RetirementIncomeChart({ draft, forecast, asOf, start, end, stale, pending, lifecycle, onEvents, onCash }: {
  draft: PersonalDraft; forecast?: PersonalHouseholdForecastReadModel | undefined; asOf: string;
  start: string; end: string; stale: boolean; pending: boolean; lifecycle: string; onEvents: () => void; onCash?: () => void;
}) {
  const [personIds, setPersonIds] = useState<readonly string[]>([]);
  const data = useMemo(() => selectRetirementIncomeChartData(draft, asOf, personIds, forecast), [draft, asOf, personIds, forecast]);
  const supported = forecast && forecast.status !== "unavailable" ? forecast : undefined;
  return <section className="panel section-outlook planning-outlook" aria-label="Planning outlook">
    <p className="eyebrow">Planning</p><h1>Your current plan</h1>
    <p className="planning-insight">{data.adults.map(adult => `${adult.name}: ${adult.confirmed.length ? `retirement planned ${[...new Set(adult.confirmed.map(plan => plan.date))].join(", ")}` : adult.proposal ? `age-65 suggestion ${adult.proposal}, not confirmed` : "retirement date unknown"}`).join(". ") || "Record your household to begin your retirement timeline"}. A complete retirement income picture is still unavailable.</p>
    <button type="button" className="calm-action calm-action-primary" onClick={onEvents}>Review retirement dates</button>
    <figure className="retirement-source-gap" aria-label="Retirement income composition" data-source-status={data.incomeSources.status}>
      <figcaption><h2>Retirement source breakdown unavailable</h2></figcaption>
      <p>The forecast does not yet separate income and cash resources by source. Wages, pensions, Social Security, annuities and withdrawals cannot be shown reliably.</p>
      <p>Available below: retirement dates and supported household investment balances. A balance is a resource, not an amount you can safely spend.</p>
      <a href="#planning-resources">View available investment resources</a>
      {onCash && <button type="button" className="calm-action" onClick={onCash}>Review modeled cash resources</button>}
      <CashChartDetails title="Retirement income composition"><p>Aggregate recognized income is not take-home pay. Asset changes cannot establish withdrawal income. Tax withholding and retirement benefits remain unproven here; missing categories are unavailable, never zero.</p><p>Required source: identity-safe per-period income/cash streams with person, exact amount/currency, gross/net/cash basis, capability and provenance; reconciled transfer/distribution identities must prevent double counting.</p></CashChartDetails>
    </figure>
    <section aria-label="Your planning timeline" className="planning-timeline"><h2>Your planning timeline</h2>
      <p>Requested run: <strong>{start} → {end}</strong> (exclusive end). The requested cutoff is not a death date.</p>
      <p>Current position: recorded opening snapshot. Future values: modeled period closes, with no past account history.</p>
      <ul>{data.adults.map(adult => <li key={adult.personId}>
        <strong>{adult.name}</strong> · {adult.dob ? `DOB ${adult.dob}` : "Birth date unknown; age unavailable"}
        {adult.confirmed.length ? <ul>{adult.confirmed.map(plan => <li key={plan.incomeId}>Confirmed retirement event · {plan.date} · {plan.age === undefined ? "age unknown" : `age ${plan.age}`} · {plan.label}. {supported && !stale && data.modeledRetirements.some(item => item.incomeId === plan.incomeId && item.date === plan.date) ? "Bound in this forecast; execution depends on supported coverage." : "Not confirmed in a current forecast."}</li>)}</ul>
          : <p>{adult.proposal ? `Age-65 proposal · ${adult.proposal} · optional, not confirmed.` : "No confirmed retirement event; a date is optional and no retirement age is assumed."}</p>}
        <small>{adult.age90 ? `Age 90 on ${adult.age90}.` : "Age-90 date unavailable."} Suggestions do not stop wages or start benefits.</small>
      </li>)}</ul>
      {!data.adults.length && <p>No planning adults recorded. Review Household &amp; People for birth dates.</p>}
      <details className="calm-disclosure"><summary>Compare adults’ age-90 dates</summary><div>
        <p>Read-only comparison; apply any horizon change in Forecast setup below. This selection does not change the saved plan or run.</p>
        <fieldset><legend>Adults for timeline comparison</legend>{data.adults.map(adult => <label key={adult.personId}><input type="checkbox" checked={adult.selected} onChange={event => setPersonIds(ids => event.target.checked ? [...ids, adult.personId] : ids.filter(id => id !== adult.personId))} />{adult.name}</label>)}</fieldset>
        <p>{data.age90 ? `Later selected age-90 birthday: ${data.age90.through}. Monthly exclusive end: ${data.age90.end}.` : "Select adults with valid birth dates and future age-90 birthdays. No cutoff is inferred."}</p>
        <a href="#plan-horizon">Review requested age and horizon</a>
      </div></details>
      {!!data.mortgagePayoffs.length && <p>{stale ? "Out of date retained" : "Modeled"} mortgage payoff: {data.mortgagePayoffs.map(item => `${item.scheduledAt.slice(0, 10)} · ${item.name}`).join("; ")}. Only supported modeled payoffs are shown.</p>}
    </section>
    <section id="planning-resources" aria-label="Available planning resources"><h2>Available investment resources</h2>
      {!supported && <ForecastProgress pending={pending} retained={!!forecast} />}
      {supported && (lifecycle === "error" || lifecycle === "cancelled" || lifecycle === "unsupported") && <p role="status">{lifecycle === "error" ? "Replacement forecast failed." : lifecycle === "cancelled" ? "Replacement forecast cancelled." : "Replacement forecast unsupported."} Retained results belong to the previous successful run.</p>}
      {supported ? <><p role="status">{stale ? "Out of date retained forecast. " : ""}Supported results end before {supported.reachedThrough?.slice(0, 10) ?? "unknown"}; requested end {end}. {supported.requestedHorizon.end.slice(0, 10) !== end && "The retained run has a different requested horizon."} {supported.stoppedAt && `Forecast stopped at ${supported.stoppedAt.slice(0, 10)}.`}</p>
        <HouseholdChart forecast={supported} cashFlowOnly={false} investing stale={stale} pending={pending} calm />
        <details className="calm-disclosure"><summary>Coverage and projected law dates</summary><div>
          <p>Future tax and benefit coverage is conditional. Investment balances do not prove retirement income or sufficient funding through age 90.</p>
          {[...new Map((supported.projectedLaw ?? []).map(item => [`${item.jurisdiction}:${item.from}:${item.until}`, item])).values()].map(item => <p key={`${item.jurisdiction}:${item.from}:${item.until}`}>{item.jurisdiction}: projected {item.baseYear} law from {item.from.slice(0, 10)} to {item.until.slice(0, 10)} (exclusive).</p>)}
          <p>Review precise limitations in Status &amp; Actions → Forecast details.</p>
        </div></details>
      </> : <p role="status">{lifecycle === "error" ? "Forecast failed." : lifecycle === "cancelled" ? "Forecast cancelled." : lifecycle === "unsupported" ? "Forecast unsupported." : "No supported forecast yet."} Review forecast setup below; no income or balance path has been substituted.</p>}
    </section>
    <details className="calm-disclosure"><summary>Plan setup and source owners</summary><div><p>Retirement dates: Plan → Life Events. Requested horizon: Plan → Current Plan. Holdings: Investing. Precise forecast sources and diagnostics: Status &amp; Actions.</p><a href="#forecast-setup">Review forecast setup</a></div></details>
  </section>;
}
