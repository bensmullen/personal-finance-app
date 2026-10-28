"use client";
import * as React from "react";
import { cashComparison } from "../../src/application/monthlyMoney.js";
export { cashComparison };
import type { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import type { PersonalDraft } from "../../src/application/personalMvp.js";
import { formatExactMoney, referenceLabel } from "../entityPresentation.js";
import { CashDetailsContent } from "../calm/CalmPresentation.js";

export type MonthlyEvidenceDetail = ReturnType<typeof inspectMonthlyMoney>;
export type CashSourceReview = (type: "Income" | "Investment" | "Liability" | "Account" | "Expense" | "Insurance", id: string) => void;


export function CashAllocation({ draft, detail, review, setup, controls }: {
  draft: PersonalDraft; detail: MonthlyEvidenceDetail; review: CashSourceReview; setup: () => void; controls?: React.ReactNode;
}) {
  const view = cashComparison(detail);
  const amount = (value: string) => formatExactMoney(value, detail.currency);
  const categories = view?.categories ?? detail.categories;
  const withholding = detail.withholdingAmount === undefined ? "Unknown · not modeled"
    : `${amount(detail.withholdingAmount)} · posted elections only${detail.withholding === "partial" ? "; partial payroll coverage" : "; other taxes may be missing"}`;
  const withholdingDescription = detail.withholdingAmount === undefined ? "taxes withheld not modeled, amount unknown" : `Payroll withholding: ${withholding}`;
  return <div className="cash-allocation">
    {view?.drawable ? <figure aria-label="Where modeled income goes comparison">
      {view.overflow && !view.knownUsesOnly && <div className="cash-income-reference"><span style={{ width: `${view.percent(detail.denominator)}%` }} /><small>Income reference · {amount(detail.denominator)}</small></div>}
      <div className="paycheck-bar" role="img" aria-label={`${categories.map(item => `${item.label}: ${amount(item.amount)}`).join("; ")}${view.remainder ? `; Unverified remainder: ${amount(detail.unallocated)}` : ""}; total income basis ${amount(detail.denominator)}; ${withholdingDescription}. ${view.knownUsesOnly ? "Zero modeled income; not a paycheck-funded allocation. " : ""}${view.overflow ? "Scale is total known uses, not a funded income allocation." : "Not disposable earnings."}`}>
        {categories.map(item => <span key={item.id} className={`paycheck-${item.kind}`} style={{ width: `${view.percent(item.amount)}%`, flexBasis: "auto" }} title={`${item.label}: ${amount(item.amount)}`} />)}
        {view.remainder && <span className="paycheck-unallocated" style={{ width: `${view.percent(detail.unallocated)}%`, flexBasis: "auto" }} title={`Unverified remainder: ${amount(detail.unallocated)}`} />}
      </div>
      {view.overflow && <small>All known categories shown on the total-use scale; this is not a 100%-income allocation.</small>}
    </figure> : <p role="status">{!view?.coherent ? "Comparison graphic unavailable: source amounts or transaction coverage cannot be reconciled." : "No positive income basis or categorized posted uses for a comparison graphic."} Exact available evidence is below.</p>}
    {view?.knownUsesOnly && <p className="chart-status" role="note">Zero modeled income ({amount(detail.denominator)}) · not a paycheck-funded allocation.</p>}
    {controls && <div className="cash-month-controls">{controls}</div>}
    <p className="chart-status" role="note">Discretionary Income — unavailable</p>
    <p role="note">Partial coverage · {detail.withholdingAmount === undefined ? "Payroll withholding unknown · not modeled." : `Posted withholding ${amount(detail.withholdingAmount)}${detail.withholding === "partial" ? " · partial payroll coverage" : " · other taxes may be missing"}.`}
      {" "}<button type="button" onClick={setup}>Review tax coverage & setup</button></p>
    <CashDetailsContent><p>{view?.overflow ? `Known uses · scale ${amount(view.scale)}` : `Income basis · ${amount(detail.denominator)}`}{view?.knownUsesOnly && ` · Zero modeled income (${amount(detail.denominator)}) · not a paycheck-funded allocation`}</p><p>Income and posted uses for the same month · source-backed comparison. This does not identify which paycheck funded a payment. Savings, borrowing or sale proceeds may also support cash uses. Unverified comparison remainder · not disposable income: {amount(detail.unallocated)}. This arithmetic remainder is the income basis less known uses, not verified leftover income. {withholdingDescription}.</p></CashDetailsContent>
    <CashDetailsContent><p>Income, withholding and funding are not fully reconciled; the income comparison cannot establish a spendable after-tax remainder.</p></CashDetailsContent>
    {view?.overflow && <p className="cash-excess" role="status"><strong>Uses exceeding this income basis: {amount(detail.additionalFunding)}</strong><br />Additional funding not attributed. This amount is outside the income comparison; its funding source is not established.</p>}
    <ul className="paycheck-legend" aria-label="Known uses and comparison remainder">{categories.map((item, index) => <li key={item.id}>
      <span aria-hidden="true" className={`paycheck-key paycheck-${item.kind}`}>{index + 1}</span>
      <span><strong>{item.label}</strong> · {amount(item.amount)}
        {["ira", "brokerage"].includes(item.kind) && <small>Asset transfer · not spending</small>}
        {item.kind === "workplace" && <small>Employee contribution · employer contributions excluded</small>}
        {item.label === "Payroll withholding" && <small>Withheld from gross payroll · not a second bank cash outflow or spending</small>}
        {item.kind === "mortgage" && <small>Principal & interest · principal repays debt, not consumption</small>}
        <CashDetailsContent><details><summary>Review {item.label} sources</summary>
          {item.incomeIds?.map(id => <button key={id} type="button" onClick={() => review("Income", id)}>Review {referenceLabel(draft, "Income", id)}</button>)}
          {item.holdingIds.map(id => <button key={id} type="button" onClick={() => review("Investment", id)}>{referenceLabel(draft, "Investment", id)}</button>)}
          {item.liabilityIds.map(id => <button key={id} type="button" onClick={() => review("Liability", id)}>{referenceLabel(draft, "Liability", id)}</button>)}
          {item.expenseIds.map(id => <button key={id} type="button" onClick={() => review("Expense", id)}>Review {referenceLabel(draft, "Expense", id)}</button>)}
          {item.policyIds.map(id => <button key={id} type="button" onClick={() => review("Insurance", id)}>Review insurance policy</button>)}
          {item.accountIds.map(id => <button key={id} type="button" onClick={() => review("Account", id)}>{referenceLabel(draft, "Account", id)}</button>)}
          {!item.sourceIds.length && <p>Source evidence unavailable.</p>}
        </details></CashDetailsContent>
      </span>
    </li>)}{view?.remainder && <li><span aria-hidden="true" className="paycheck-key paycheck-unallocated">?</span><span><strong>Unverified remainder</strong> · {amount(detail.unallocated)}<small>Not verified leftover income</small><button type="button" onClick={setup}>Review coverage</button></span></li>}</ul>
    <CashDetailsContent><details><summary>Exact monthly comparison & receipts</summary>
      <div className="cash-exact-table" role="region" aria-label="Exact monthly comparison" tabIndex={0}><table><caption>Same-month comparison · {detail.currency} · incomplete</caption><thead><tr><th scope="col">Evidence</th><th scope="col">Exact amount</th></tr></thead><tbody>
        <tr><th scope="row">{detail.basis === "gross_payroll" ? "Gross payroll earnings" : "Recorded household income"}</th><td>{amount(detail.denominator)}</td></tr>
        {categories.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{amount(item.amount)}</td></tr>)}
        <tr><th scope="row">Total known uses</th><td>{amount(detail.totalUses)}</td></tr>
        <tr><th scope="row">Unverified comparison remainder · not disposable income</th><td>{amount(detail.unallocated)}</td></tr>
        <tr><th scope="row">Uses exceeding this income basis · funding not attributed</th><td>{amount(detail.additionalFunding)}</td></tr>
        <tr><th scope="row">{detail.withholdingAmount === undefined ? "Payroll withholding" : "Payroll withholding coverage"}</th><td>{withholding}</td></tr>
        <tr><th scope="row">Net modeled account cash change · flow, not a balance</th><td>{amount(detail.cashChange)}</td></tr>
      </tbody></table></div>
      {detail.receipts.map(receipt => <p key={receipt.id}>{receipt.label}: {amount(receipt.amount)} · <button type="button" onClick={() => review("Account", receipt.accountId)}>{referenceLabel(draft, "Account", receipt.accountId)}</button></p>)}
      <details><summary>Technical details / source transactions</summary><pre>{JSON.stringify(detail.categories.map(item => ({ category: item.label, sources: item.sourceIds })), null, 2)}</pre></details>
    </details></CashDetailsContent>
  </div>;
}
