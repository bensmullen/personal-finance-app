"use client";
import { useEffect, useMemo, useState } from "react";
import { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import type { PersonalDraft } from "../../src/application/personalMvp.js";
import { formatExactMoney, referenceLabel, objectEntries, objectId } from "../entityPresentation.js";
import { FieldShell } from "../authoring/FieldShell.js";

type Detail = ReturnType<typeof inspectMonthlyMoney>;
export function MonthlyMoneyPanel({ draft, forecast, current, mode, review, setup }: {
  draft: PersonalDraft; forecast?: PersonalHouseholdForecastReadModel | undefined; current: boolean;
  mode: "paycheck" | "debt" | "spending";
  review: (type: "Income" | "Investment" | "Liability" | "Account", id: string) => void;
  setup: () => void;
}) {
  const points = forecast && forecast.status !== "unavailable" ? forecast.points : [];
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const cache = useMemo(() => new Map<string, Detail>(), [forecast]);
  const [, setRevision] = useState(0);
  const point = points.find(value => value.periodStart.slice(0, 7) === selected) ?? points[0];
  const detail = current && point ? cache.get(point.periodStart) : undefined;
  const amount = (value: string) => formatExactMoney(value, detail?.currency ?? point?.cash.currency);
  const inspect = () => {
    if (!point || !current) return;
    try { cache.set(point.periodStart, inspectMonthlyMoney(point)); setError(""); setRevision(value => value + 1); }
    catch { setError("Monthly evidence could not be loaded. Update the forecast and retry this month."); }
  };
  useEffect(() => {
    setError("");
    if (!current || !point || cache.has(point.periodStart)) return;
    try { cache.set(point.periodStart, inspectMonthlyMoney(point)); setRevision(value => value + 1); }
    catch { setError("Monthly evidence could not be loaded. Update the forecast and retry this month."); }
  }, [current, point, cache]);
  const holdingLink = (id: string) => <button key={id} type="button" onClick={() => review("Investment", id)}>{referenceLabel(draft, "Investment", id)}</button>;
  return <section className="panel monthly-money" aria-label={mode === "paycheck" ? "Your Paycheck" : mode === "debt" ? "Monthly mortgage payments" : "Housing payments and transfers"}>
    <div className="panel-head"><h2>{mode === "paycheck" ? "Your Paycheck" : mode === "debt" ? "Monthly mortgage payments" : "Housing payments & transfers"}</h2>
      {!!points.length && <FieldShell fieldKey="moneyMonth" required><select aria-label={`${mode} forecast month`} value={point?.periodStart.slice(0, 7) ?? ""} onChange={event => { setSelected(event.target.value); setError(""); }}>{points.map(value => <option key={value.periodStart} value={value.periodStart.slice(0, 7)}>{value.periodStart.slice(0, 7)}</option>)}</select></FieldShell>}
    </div>
    {!current || !point ? <><p>{!point ? "This breakdown needs a household forecast." : "These results need an update before reviewing monthly payments."}</p>
      {mode !== "paycheck" && objectEntries(draft, "Liability").filter(value => value.liability_type === "mortgage").map(value => <p key={objectId("Liability", value)}>{referenceLabel(draft, "Liability", objectId("Liability", value))} · Payment not available. Review contractual terms and payment funding in Forecast setup.</p>)}
      <button type="button" onClick={setup}>Review forecast setup</button></> : <>
      <small>Household · modeled forecast · {point.periodStart.slice(0, 10)} to {point.periodEnd.slice(0, 10)} (exclusive)</small>
      {!detail && !error && <p role="status">Loading this month's committed activity…</p>}
      {error && <><p role="alert">{error}</p><button type="button" onClick={inspect}>Retry selected month</button><button type="button" onClick={setup}>Review forecast setup</button></>}
      {detail && <>
        {mode === "paycheck" && <>
          <p><strong>{amount(detail.income)}</strong> recurring household income before modeled employee contributions</p>
          <small>Includes supported salary and other recurring income; employer contributions are excluded.</small>
          <p role="note">Incomplete allocation: withholding is not supported yet, and cash uses are not reconciled to this month's income. Unallocated coverage is not leftover pay.</p>
          {Number(detail.income) > 0 ? <div className="paycheck-bar" role="img" aria-label={`Employee contributions ${amount(detail.employee)}; not yet reconciled ${amount(detail.unreconciled)}; total ${amount(detail.income)}`}>
            {Number(detail.employee) > 0 && <span className="paycheck-employee" style={{ flexGrow: Number(detail.employee) / Number(detail.income) }} />}
            {Number(detail.unreconciled) > 0 && <span className="paycheck-unreconciled" style={{ flexGrow: Number(detail.unreconciled) / Number(detail.income) }} />}
          </div> : <p>No recurring income was posted in this month. Cash uses may draw on savings or other sources.</p>}
          <ul className="paycheck-legend"><li>● Employee workplace contributions · {amount(detail.employee)}{Number(detail.income) > 0 && ` (${(Number(detail.employee) / Number(detail.income) * 100).toFixed(1)}%)`}</li><li><button type="button" onClick={setup}>▧ Not yet reconciled · {amount(detail.unreconciled)}{Number(detail.income) > 0 && ` (${(Number(detail.unreconciled) / Number(detail.income) * 100).toFixed(1)}%)`}</button></li></ul>
          <small>Modeled bank deposits: {amount(detail.deposited)}. This excludes unmodeled withholding and is not an after-tax paycheck estimate.</small>
          <button type="button" onClick={setup}>Review tax payment setup</button>
          {objectEntries(draft, "Income").map(value => <button key={objectId("Income", value)} type="button" onClick={() => review("Income", objectId("Income", value))}>{referenceLabel(draft, "Income", objectId("Income", value))}</button>)}
          {detail.lines.filter(line => line.kind === "employee").map(line => <p key={line.id}>Employee contribution · {amount(line.amount)} · {line.date.slice(0, 10)} {line.holdingIds.map(holdingLink)}</p>)}
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
        </details>
      </>}
    </>}
  </section>;
}
