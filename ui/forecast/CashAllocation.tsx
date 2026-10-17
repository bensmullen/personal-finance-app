"use client";
import * as React from "react";
import { Currency, decimal, RoundingPolicy } from "../../src/values/index.js";
import type { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import type { PersonalDraft } from "../../src/application/personalMvp.js";
import { formatExactMoney, referenceLabel } from "../entityPresentation.js";

export type MonthlyEvidenceDetail = ReturnType<typeof inspectMonthlyMoney>;
export type CashSourceReview = (type: "Income" | "Investment" | "Liability" | "Account" | "Expense" | "Insurance", id: string) => void;

/** Presentation only: exact source values/order, disposable bounded coordinates. */
export function cashComparison(detail: MonthlyEvidenceDetail) {
  try {
    Currency.of(detail.currency);
    const income = decimal(detail.denominator), uses = decimal(detail.totalUses);
    const remainder = decimal(detail.unallocated), excess = decimal(detail.additionalFunding);
    const categories = detail.categories.filter(item => !decimal(item.amount).isZero()).slice().sort((a, b) =>
      decimal(b.amount).compare(decimal(a.amount)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sum = categories.reduce((value, item) => value.plus(decimal(item.amount)), decimal("0"));
    const sourceIds = categories.flatMap(item => item.sourceIds);
    const coherent = new Set(sourceIds).size === sourceIds.length && !uses.isNegative() && !remainder.isNegative() && !excess.isNegative()
      && categories.every(item => decimal(item.amount).isPositive() && item.sourceIds.length > 0)
      && sum.equals(uses) && income.minus(uses).equals(remainder.minus(excess))
      && !(remainder.isPositive() && excess.isPositive());
    const scale = uses.compare(income) > 0 ? uses : income;
    const percent = (value: string) => scale.isPositive()
      ? Number(decimal(value).dividedBy(scale, new RoundingPolicy(8, "half_even")).times(decimal("100")).toString()) : 0;
    return { categories, coherent, drawable: coherent && income.isPositive() && categories.length > 0,
      overflow: excess.isPositive(), remainder: remainder.isPositive(), scale: scale.toString(), percent };
  } catch { return undefined; }
}

export function CashAllocation({ draft, detail, review, setup }: {
  draft: PersonalDraft; detail: MonthlyEvidenceDetail; review: CashSourceReview; setup: () => void;
}) {
  const view = cashComparison(detail);
  const amount = (value: string) => formatExactMoney(value, detail.currency);
  const categories = view?.categories ?? detail.categories;
  return <div className="cash-allocation">
    <p role="note"><strong>Incomplete allocation · source-backed comparison</strong> · Payroll withholding / taxes withheld: amount unknown, not modeled. Unreconciled money is not leftover pay.
      {" "}<button type="button" onClick={setup}>Review tax coverage & setup</button></p>
    <p>Illustrative source-backed comparison of same-month income and posted uses. It does not identify which paycheck funded a payment. Savings, borrowing or sale proceeds may also support cash uses.</p>
    {view?.drawable ? <figure aria-label="Where modeled income goes comparison">
      <figcaption>{view.overflow ? `Known uses · scale ${amount(view.scale)}` : `Income basis · ${amount(detail.denominator)}`}</figcaption>
      {view.overflow && <div className="cash-income-reference"><span style={{ width: `${view.percent(detail.denominator)}%` }} /><small>Income reference · {amount(detail.denominator)}</small></div>}
      <div className="paycheck-bar" role="img" aria-label={`${categories.map(item => `${item.label}: ${amount(item.amount)}`).join("; ")}${view.remainder ? `; Unreconciled arithmetic difference: ${amount(detail.unallocated)}` : ""}; total income basis ${amount(detail.denominator)}; taxes withheld not modeled, amount unknown. ${view.overflow ? "Scale is total known uses, not a funded income allocation." : "Not disposable earnings."}`}>
        {categories.map(item => <span key={item.id} className={`paycheck-${item.kind}`} style={{ width: `${view.percent(item.amount)}%`, flexBasis: "auto" }} title={`${item.label}: ${amount(item.amount)}`} />)}
        {view.remainder && <span className="paycheck-unallocated" style={{ width: `${view.percent(detail.unallocated)}%`, flexBasis: "auto" }} title={`Unreconciled arithmetic difference: ${amount(detail.unallocated)}`} />}
      </div>
      {view.overflow && <small>All known categories shown on the total-use scale; this is not a 100%-income allocation.</small>}
    </figure> : <p role="status">{!view?.coherent ? "Comparison graphic unavailable: source amounts or transaction coverage cannot be reconciled." : "No positive income basis or categorized posted uses for a comparison graphic."} Exact available evidence is below.</p>}
    {view?.overflow && <p className="cash-excess" role="status"><strong>Uses exceeding this income basis: {amount(detail.additionalFunding)}</strong><br />Additional funding not attributed. This amount is outside the income comparison; its funding source is not established.</p>}
    <ul className="paycheck-legend" aria-label="Known uses and comparison remainder">{categories.map((item, index) => <li key={item.id}>
      <span aria-hidden="true" className={`paycheck-key paycheck-${item.kind}`}>{index + 1}</span>
      <span><strong>{item.label}</strong> · {amount(item.amount)}
        {["ira", "brokerage"].includes(item.kind) && <small>Asset transfer · not spending</small>}
        {item.kind === "workplace" && <small>Employee contribution · employer contributions excluded</small>}
        {item.kind === "mortgage" && <small>Principal & interest · principal repays debt, not consumption</small>}
        <details><summary>Review {item.label} sources</summary>
          {item.holdingIds.map(id => <button key={id} type="button" onClick={() => review("Investment", id)}>{referenceLabel(draft, "Investment", id)}</button>)}
          {item.liabilityIds.map(id => <button key={id} type="button" onClick={() => review("Liability", id)}>{referenceLabel(draft, "Liability", id)}</button>)}
          {item.expenseIds.map(id => <button key={id} type="button" onClick={() => review("Expense", id)}>Review {referenceLabel(draft, "Expense", id)}</button>)}
          {item.policyIds.map(id => <button key={id} type="button" onClick={() => review("Insurance", id)}>Review insurance policy</button>)}
          {item.accountIds.map(id => <button key={id} type="button" onClick={() => review("Account", id)}>{referenceLabel(draft, "Account", id)}</button>)}
          {!item.sourceIds.length && <p>Source evidence unavailable.</p>}
        </details>
      </span>
    </li>)}{view?.remainder && <li><span aria-hidden="true" className="paycheck-key paycheck-unallocated">?</span><span><strong>Unreconciled arithmetic difference</strong> · {amount(detail.unallocated)}<small>Not fully modeled · not disposable or unspent earnings</small><button type="button" onClick={setup}>Review coverage</button></span></li>}</ul>
    <details><summary>Exact monthly comparison & receipts</summary>
      <div className="cash-exact-table" role="region" aria-label="Exact monthly comparison" tabIndex={0}><table><caption>Same-month comparison · {detail.currency} · incomplete</caption><thead><tr><th scope="col">Evidence</th><th scope="col">Exact amount</th></tr></thead><tbody>
        <tr><th scope="row">{detail.basis === "gross_payroll" ? "Gross payroll earnings" : "Recorded household income"}</th><td>{amount(detail.denominator)}</td></tr>
        {categories.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{amount(item.amount)}</td></tr>)}
        <tr><th scope="row">Total known uses</th><td>{amount(detail.totalUses)}</td></tr>
        <tr><th scope="row">Unreconciled arithmetic difference · not disposable earnings</th><td>{amount(detail.unallocated)}</td></tr>
        <tr><th scope="row">Uses exceeding this income basis · funding not attributed</th><td>{amount(detail.additionalFunding)}</td></tr>
        <tr><th scope="row">Payroll withholding</th><td>Unknown · not modeled</td></tr>
        <tr><th scope="row">Net modeled account cash change · flow, not a balance</th><td>{amount(detail.cashChange)}</td></tr>
      </tbody></table></div>
      {detail.receipts.map(receipt => <p key={receipt.id}>{receipt.label}: {amount(receipt.amount)} · <button type="button" onClick={() => review("Account", receipt.accountId)}>{referenceLabel(draft, "Account", receipt.accountId)}</button></p>)}
      <details><summary>Technical details / source transactions</summary><pre>{JSON.stringify(detail.categories.map(item => ({ category: item.label, sources: item.sourceIds })), null, 2)}</pre></details>
    </details>
  </div>;
}
