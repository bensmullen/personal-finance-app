"use client";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import type { PersonalDraft } from "../../src/application/personalMvp.js";
import { formatExactMoney, referenceLabel, objectEntries, objectId } from "../entityPresentation.js";
import { FieldShell } from "../authoring/FieldShell.js";
import { CashAllocation } from "./CashAllocation.js";
import { decimal } from "../../src/values/index.js";

type Detail = ReturnType<typeof inspectMonthlyMoney>;
export function MonthlyMoneyPanel({ draft, forecast, current, mode, review, setup, coverageSetup, selectedMonth, selectMonth }: {
  draft: PersonalDraft; forecast?: PersonalHouseholdForecastReadModel | undefined; current: boolean;
  mode: "paycheck" | "debt" | "spending";
  review: (type: "Income" | "Investment" | "Liability" | "Account" | "Expense" | "Insurance", id: string) => void;
  setup: () => void;
  coverageSetup?: (() => void) | undefined;
  selectedMonth?: string | undefined; selectMonth?: ((month: string) => void) | undefined;
}) {
  const points = forecast && forecast.status !== "unavailable" ? forecast.points : [];
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const cache = useMemo(() => new Map<string, Detail>(), [forecast, draft]);
  const [, setRevision] = useState(0);
  const point = points.find(value => value.periodStart.slice(0, 7) === (selectedMonth ?? selected)) ?? points[0];
  useEffect(() => {
    const month = point?.periodStart.slice(0, 7);
    if (month && month !== (selectedMonth ?? selected)) (selectMonth ?? setSelected)(month);
  }, [point, selectedMonth, selected, selectMonth]);
  const detail = current && point ? cache.get(point.periodStart) : undefined;
  const amount = (value: string) => formatExactMoney(value, detail?.currency ?? point?.cash.currency);
  const inspect = () => {
    if (!point || !current) return;
    try { cache.set(point.periodStart, inspectMonthlyMoney(point, draft)); setError(""); setRevision(value => value + 1); }
    catch { cache.delete(point.periodStart); setError("Monthly evidence could not be loaded. Update the forecast and retry this month."); }
  };
  useEffect(() => {
    setError("");
    if (!current || !point || cache.has(point.periodStart)) return;
    try { cache.set(point.periodStart, inspectMonthlyMoney(point, draft)); setRevision(value => value + 1); }
    catch { setError("Monthly evidence could not be loaded. Update the forecast and retry this month."); }
  }, [current, point, cache, draft]);
  const holdingLink = (id: string) => <button key={id} type="button" onClick={() => review("Investment", id)}>{referenceLabel(draft, "Investment", id)}</button>;
  return <section className="panel monthly-money" data-evidence-state={!point ? "unavailable" : !current ? "stale" : error ? "error" : detail ? "incomplete" : "loading"} aria-label={mode === "paycheck" ? "Your Paycheck" : mode === "debt" ? "Monthly mortgage payments" : "Housing payments and transfers"}>
    <div className="panel-head"><h2>{mode === "paycheck" ? "Where modeled income goes" : mode === "debt" ? "Monthly mortgage payments" : "Housing payments & transfers"}</h2>
      {!!points.length && <FieldShell fieldKey="moneyMonth" required><select aria-label={`${mode} forecast month`} value={point?.periodStart.slice(0, 7) ?? ""} onChange={event => { (selectMonth ?? setSelected)(event.target.value); setError(""); }}>{points.map(value => <option key={value.periodStart} value={value.periodStart.slice(0, 7)}>{value.periodStart.slice(0, 10)} → {value.periodEnd.slice(0, 10)} (exclusive)</option>)}</select></FieldShell>}
    </div>
    {!current || !point ? <><p role="status">{!point ? "Monthly evidence unavailable. This breakdown needs a supported household forecast." : "Out of date · retained forecast. Monthly evidence needs an update before it can be presented as current."}</p>
      {mode !== "paycheck" && objectEntries(draft, "Liability").filter(value => value.liability_type === "mortgage").map(value => <p key={objectId("Liability", value)}>{referenceLabel(draft, "Liability", objectId("Liability", value))} · Payment not available. Review contractual terms and payment funding in Forecast setup.</p>)}
      <button type="button" onClick={setup}>Review forecast setup</button></> : <>
      <small>Household · modeled forecast · {point.periodStart.slice(0, 10)} to {point.periodEnd.slice(0, 10)} (exclusive)</small>
      <small>Current forecast · {forecast?.status === "incomplete" ? "partial forecast horizon" : "selected modeled month"}. Monthly comparison only; annual funding coverage is unavailable.</small>
      <button type="button" onClick={inspect}>Refresh selected month</button>
      {!detail && !error && <p role="status">Loading this month's committed activity…</p>}
      {error && <><p role="alert">{error}</p><button type="button" onClick={inspect}>Retry selected month</button><button type="button" onClick={setup}>Review forecast setup</button></>}
      {detail && <>
        {mode === "paycheck" && <>
          <p><strong>{amount(detail.denominator)}</strong> {detail.basis === "gross_payroll" ? "gross payroll earnings" : "recorded household income"}</p>
          <small>Same-month income versus posted uses · opening savings and employer contributions excluded from income.</small>
          <CashAllocation draft={draft} detail={detail} review={review} setup={coverageSetup ?? setup} />
          {decimal(detail.otherIncome).isPositive() && detail.basis === "gross_payroll" && <small>Other recurring income: {amount(detail.otherIncome)} · outside the payroll basis.</small>}
          <small>Modeled bank deposits: {amount(detail.deposited)}. This excludes unmodeled withholding and is not an after-tax paycheck estimate.</small>
          {objectEntries(draft, "Income").map(value => <button key={objectId("Income", value)} type="button" onClick={() => review("Income", objectId("Income", value))}>{referenceLabel(draft, "Income", objectId("Income", value))}</button>)}
        </>}
        <details open={mode !== "paycheck"}><summary>Inspect modeled cash uses</summary>
        <div aria-label="Mortgage cash payments">{!detail.mortgages.length && <p>No mortgage payment was scheduled in this modeled month.</p>}{detail.mortgages.map(item => <article key={`${item.liabilityId}:${item.date}`}>
          <h3>{referenceLabel(draft, "Liability", item.liabilityId)}</h3>
          <p><strong>{amount(item.payment)} / month</strong> · scheduled payment due · {item.date.slice(0, 10)}</p>
          <small>Ordinary contractual payment: {amount(item.contractual)}. Cash actually paid: {item.paid === undefined ? "Not available" : amount(item.paid)}.</small>
          <p>Principal repaid {amount(item.principal)} · interest recognized {amount(item.interest)} · extra principal paid separately {amount(item.extra)}</p>
          <small>Principal repayment reduces debt; only interest is expense. Funding: {item.status}. Escrow additions are not modeled.</small>
          {item.fundingAccountIds.map(id => <button key={id} type="button" onClick={() => review("Account", id)}>{referenceLabel(draft, "Account", id)}</button>)}
          <button type="button" onClick={() => review("Liability", item.liabilityId)}>Review mortgage</button>
        </article>)}</div>
        {mode !== "debt" && <div aria-label="Transfers and contributions not spending"><h3>Transfers & contributions (not spending)</h3>
          {detail.lines.filter(line => line.kind === "transfer").map(line => <p key={line.id}>{amount(line.amount)} · {line.date.slice(0, 10)} {line.accountIds.map(id => <button key={id} type="button" onClick={() => review("Account", id)}>{referenceLabel(draft, "Account", id)}</button>)} → {line.holdingIds.map(holdingLink)}</p>)}
          <small>Posted investment funding is shown once; its source may include opening savings. It is not added to spending or attributed to this month's pay.</small>
        </div>}
        {mode !== "debt" && <div aria-label="Other posted cash uses">{detail.cashUses.map(line => <p key={line.id}>{line.label} · {amount(line.amount)} · {line.date.slice(0, 10)} <button type="button" onClick={() => review("Account", line.accountId)}>{referenceLabel(draft, "Account", line.accountId)}</button></p>)}</div>}
        {mode !== "debt" && detail.categories.some(item => item.policyIds.length) && <section aria-label="Insurance payments"><h3>Insurance premiums paid</h3>{detail.categories.filter(item => item.policyIds.length).map(item => <p key={item.id}>{item.label} · {amount(item.amount)}{item.policyIds.map(id => <button key={id} type="button" onClick={() => review("Insurance", id)}>Review policy</button>)}{item.accountIds.map(id => <button key={id} type="button" onClick={() => review("Account", id)}>{referenceLabel(draft, "Account", id)}</button>)}</p>)}</section>}
        </details>
      </>}
    </>}
  </section>;
}
