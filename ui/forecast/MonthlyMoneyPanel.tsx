"use client";
import * as React from "react";
import { useEffect, useState } from "react";
import { isPositiveMonthlyMoney } from "../../src/application/monthlyMoney.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import type { PersonalDraft } from "../../src/application/personalMvp.js";
import { formatExactMoney, referenceLabel, objectEntries, objectId } from "../entityPresentation.js";
import { FieldShell } from "../authoring/FieldShell.js";
import { CashAllocation } from "./CashAllocation.js";
import { useForecastEvidence } from "./useInteractiveForecast.js";
import { CashDetailsContent, CashDetailsScope, CalmDisclosure, ForecastChartPending } from "../calm/CalmPresentation.js";

export function MonthlyMoneyPanel({ draft, forecast, current, pending = false, mode, review, setup, coverageSetup, selectedMonth, selectMonth }: {
  draft: PersonalDraft; forecast?: PersonalHouseholdForecastReadModel | undefined; current: boolean;
  pending?: boolean;
  mode: "paycheck" | "debt" | "spending";
  review: (type: "Income" | "Investment" | "Liability" | "Account" | "Expense" | "Insurance", id: string) => void;
  setup: () => void;
  coverageSetup?: (() => void) | undefined;
  selectedMonth?: string | undefined; selectMonth?: ((month: string) => void) | undefined;
}) {
  const points = forecast && forecast.status !== "unavailable" ? forecast.points : [];
  const [selected, setSelected] = useState("");
  const point = points.find(value => value.periodStart.slice(0, 7) === (selectedMonth ?? selected)) ?? points[0];
  const evidence = useForecastEvidence(forecast, draft, current, { operation: "monthly_evidence", startIndex: point ? points.indexOf(point) : -1, liabilityId: "" });
  const detail = evidence.detail;
  const error = evidence.error ? "Monthly evidence could not be loaded. Update the forecast and retry this month." : "";
  useEffect(() => {
    const month = point?.periodStart.slice(0, 7);
    if (month && month !== (selectedMonth ?? selected)) (selectMonth ?? setSelected)(month);
  }, [point, selectedMonth, selected, selectMonth]);
  const amount = (value: string) => formatExactMoney(value, detail?.currency ?? point?.cash.currency);
  const inspect = evidence.refresh;
  const holdingLink = (id: string) => <button key={id} type="button" onClick={() => review("Investment", id)}>{referenceLabel(draft, "Investment", id)}</button>;
  const monthLabel = (value: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value));
  const Evidence = mode === "paycheck" ? CashDetailsContent : React.Fragment;
  const monthPicker = !!points.length && <FieldShell fieldKey="moneyMonth" required><select aria-label={`${mode} forecast month`} value={point?.periodStart.slice(0, 7) ?? ""} onChange={event => (selectMonth ?? setSelected)(event.target.value)}>{points.map(value => <option key={value.periodStart} value={value.periodStart.slice(0, 7)}>{monthLabel(value.periodStart)}</option>)}</select></FieldShell>;
  return <section className={`${mode === "paycheck" ? "calm-panel" : "panel"} monthly-money`} data-evidence-state={!point ? "unavailable" : !current ? "stale" : error ? "error" : detail ? "incomplete" : "loading"} aria-label={mode === "paycheck" ? "Your Paycheck" : mode === "debt" ? "Monthly mortgage payments" : "Housing payments and transfers"}>
    <CashDetailsScope enabled={mode === "paycheck"} title="Where modeled income goes">
    <div className="panel-head"><h2>{mode === "paycheck" ? "Explain this month’s income" : mode === "debt" ? "Monthly mortgage payments" : "Housing payments & transfers"}</h2>
      {mode !== "paycheck" && monthPicker}
    </div>
    {pending ? <ForecastChartPending title={mode === "paycheck" ? "Where modeled income goes" : "Monthly cash uses"} /> : !current || !point ? <><p role="status">{!point ? "Monthly evidence unavailable. This breakdown needs a supported household forecast." : "Out of date · retained forecast. Monthly evidence needs an update before it can be presented as current."}</p>
      {mode !== "paycheck" && objectEntries(draft, "Liability").filter(value => value.liability_type === "mortgage").map(value => <p key={objectId("Liability", value)}>{referenceLabel(draft, "Liability", objectId("Liability", value))} · Payment not available. Review contractual terms and payment funding in Forecast setup.</p>)}
      <button type="button" onClick={setup}>Review forecast setup</button></> : <>
      <Evidence>
      {mode === "paycheck" && <h3>Monthly allocation · details</h3>}
      <p className="calm-caption">{monthLabel(point.periodStart)} · {mode === "paycheck" ? "Forecast income compared with uses posted in this month." : "Forecast payments and cash movements for this month."} {forecast?.status === "incomplete" && "Some forecast information is incomplete."}</p>
      <CalmDisclosure title="Selected month dates and evidence"><p>Household forecast · {point.periodStart} to {point.periodEnd} (exclusive). This monthly comparison does not establish annual funding coverage.</p><button type="button" onClick={inspect}>Refresh selected month</button></CalmDisclosure>
      </Evidence>
      {!detail && !error && <ForecastChartPending title={mode === "paycheck" ? "Where modeled income goes" : "Monthly cash uses"} />}
      {error && <><p role="alert">{error}</p><button type="button" onClick={inspect}>Retry selected month</button><button type="button" onClick={setup}>Review forecast setup</button></>}
      {detail && <>
        {mode === "paycheck" && <>
          <CashAllocation draft={draft} detail={detail} review={review} setup={coverageSetup ?? setup} controls={monthPicker} />
          <CashDetailsContent>
          <p><strong>{amount(detail.denominator)}</strong> {detail.basis === "gross_payroll" ? "gross payroll earnings" : "recorded household income"}</p>
          <small>Same-month income versus posted uses · opening savings and employer contributions excluded from income.</small>
          {isPositiveMonthlyMoney(detail.otherIncome) && detail.basis === "gross_payroll" && <small>Other recurring income: {amount(detail.otherIncome)} · outside the payroll basis.</small>}
          <small>Modeled bank deposits: {amount(detail.deposited)}. Includes the effect of any posted payroll deductions and withholding; not observed bank activity or proof of all taxes.</small>
          </CashDetailsContent>
          {objectEntries(draft, "Income").map(value => <button key={objectId("Income", value)} type="button" onClick={() => review("Income", objectId("Income", value))}>{referenceLabel(draft, "Income", objectId("Income", value))}</button>)}
        </>}
        <Evidence><details open={mode !== "paycheck"}><summary>Inspect modeled cash uses</summary>
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
        </details></Evidence>
      </>}
    </>}
    {mode === "paycheck" && (!current || !point || !detail) && monthPicker}
    </CashDetailsScope>
  </section>;
}
