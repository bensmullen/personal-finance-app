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
  review: (type: "Income" | "Investment" | "Liability" | "Account" | "Expense", id: string) => void;
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
    try { cache.set(point.periodStart, inspectMonthlyMoney(point, draft)); setError(""); setRevision(value => value + 1); }
    catch { setError("Monthly evidence could not be loaded. Update the forecast and retry this month."); }
  };
  useEffect(() => {
    setError("");
    if (!current || !point || cache.has(point.periodStart)) return;
    try { cache.set(point.periodStart, inspectMonthlyMoney(point, draft)); setRevision(value => value + 1); }
    catch { setError("Monthly evidence could not be loaded. Update the forecast and retry this month."); }
  }, [current, point, cache, draft]);
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
          <p><strong>{amount(detail.denominator)}</strong> {detail.basis === "gross_payroll" ? "gross payroll earnings" : "recorded household income"}</p>
          <small>Same-month income versus posted uses · opening savings and employer contributions excluded from income.</small>
          <p role="note">Incomplete allocation · Taxes withheld: not modeled. Unallocated money is not leftover pay.</p>
          <PaycheckComparison draft={draft} detail={detail} amount={amount} review={review} setup={setup} />
          {Number(detail.otherIncome) > 0 && detail.basis === "gross_payroll" && <small>Other recurring income: {amount(detail.otherIncome)} · outside the payroll basis.</small>}
          <small>Cash uses may draw on savings or other receipts; this comparison does not identify which paycheck funded a payment.</small>
          {Number(detail.additionalFunding) > 0 && <p role="status">Cash uses exceed this month's income basis by {amount(detail.additionalFunding)}. Additional money comes from savings or other sources.</p>}
          <small>Modeled bank deposits: {amount(detail.deposited)}. This excludes unmodeled withholding and is not an after-tax paycheck estimate.</small>
          <button type="button" onClick={setup}>Review tax payment setup</button>
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
        </details>
      </>}
    </>}
  </section>;
}

function PaycheckComparison({ draft, detail, amount, review, setup }: {
  draft: PersonalDraft;
  detail: Detail; amount: (value: string) => string;
  review: (type: "Income" | "Investment" | "Liability" | "Account" | "Expense", id: string) => void;
  setup: () => void;
}) {
  // Numbers here control display geometry only; all amounts/remainders above
  // are exact application-layer money. Stable display order is not funding order.
  const denominator = Number(detail.denominator);
  const categories = [...detail.categories, ...(Number(detail.unallocated) > 0 ? [{
    id: "unallocated", kind: "unallocated", label: "Unallocated / not fully modeled", amount: detail.unallocated,
    sourceIds: [], holdingIds: [], accountIds: [], liabilityIds: [], expenseIds: [],
  }] : [])];
  let remaining = 100;
  const segments = categories.map(item => {
    const percent = denominator > 0 ? Number(item.amount) / denominator * 100 : 0;
    const width = Math.min(remaining, Math.max(0, percent)); remaining -= width;
    return { ...item, percent, width };
  });
  return <>
    {denominator > 0 ? <div className="paycheck-bar" role="img" aria-label={`${segments.map(item => `${item.label} ${amount(item.amount)}`).join("; ")}; total income basis ${amount(detail.denominator)}; taxes withheld not modeled`}>
      {segments.map(item => item.width > 0 && <span key={item.id} className={`paycheck-${item.kind}`} style={{ width: `${item.width}%`, flexBasis: "auto" }} title={`${item.label}: ${amount(item.amount)} (${item.percent.toFixed(1)}% of income basis)`} />)}
    </div> : <p>No income was posted in this month. The amounts below show cash uses from other sources.</p>}
    <ul className="paycheck-legend">{segments.map((item, index) => <li key={item.id}>
      <span aria-hidden="true" className={`paycheck-key paycheck-${item.kind}`}>{index + 1}</span>
      <span><strong>{item.label}</strong> · {amount(item.amount)}{denominator > 0 && ` (${item.percent.toFixed(1)}%)`}
        {["ira", "brokerage"].includes(item.kind) && <small>Asset transfer · not spending</small>}
        {item.kind === "mortgage" && <small>Principal & interest · principal repays debt</small>}
        {item.holdingIds.map(id => <button key={id} type="button" onClick={() => review("Investment", id)}>{referenceLabel(draft, "Investment", id)}</button>)}
        {item.liabilityIds.map(id => <button key={id} type="button" onClick={() => review("Liability", id)}>{referenceLabel(draft, "Liability", id)}</button>)}
        {item.expenseIds.map(id => <button key={id} type="button" onClick={() => review("Expense", id)}>Review {referenceLabel(draft, "Expense", id)}</button>)}
        {!item.holdingIds.length && !item.liabilityIds.length && !item.expenseIds.length && item.accountIds.map(id => <button key={id} type="button" onClick={() => review("Account", id)}>{referenceLabel(draft, "Account", id)}</button>)}
        {item.kind === "unallocated" && <button type="button" onClick={setup}>Review coverage</button>}
      </span>
    </li>)}</ul>
    <details><summary>Comparison details</summary><p>Posted uses: {amount(detail.totalUses)}. Net change in modeled account cash: {amount(detail.cashChange)}; this is not a bank balance or disposable pay.</p>
      {detail.receipts.map(receipt => <p key={receipt.id}>{receipt.label}: {amount(receipt.amount)} · <button type="button" onClick={() => review("Account", receipt.accountId)}>{referenceLabel(draft, "Account", receipt.accountId)}</button></p>)}
      <p>When uses exceed income, bar widths are capped in display order. Dollar amounts and percentages show the full uncapped uses.</p>
      <details><summary>Technical details / source transactions</summary><pre>{JSON.stringify(detail.categories.map(item => ({ category: item.label, sources: item.sourceIds })), null, 2)}</pre></details>
    </details>
  </>;
}
