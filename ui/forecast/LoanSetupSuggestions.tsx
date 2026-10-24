import { mortgageRemainingSchedule } from "../../src/application/compiler/liabilities.js";

/** Read-only compiler-backed schedule preview; acceptance stays in Debt. */
export function LoanSetupSuggestions({ firstPayment, maturity, origination, asOf, count, confirm }: { firstPayment: string; maturity: string; origination: string; asOf: string; count: string; confirm: (count: string) => void }) {
  const schedule = mortgageRemainingSchedule(firstPayment, maturity, asOf);
  if (!firstPayment) return <p>What is the first contractual monthly payment date? Enter the date from the loan agreement below.</p>;
  if (!schedule || firstPayment <= origination) return <p role="alert">The first payment and recorded maturity do not form a supported monthly schedule after origination. Confirm the dated loan evidence.</p>;
  return <aside className="starting-points" aria-label="Derived mortgage schedule"><p>Source: first payment {firstPayment}, recorded maturity {maturity}, forecast boundary {asOf}.</p>
    <p><strong>{schedule.remaining} remaining payments</strong> of {schedule.total} original payments. Next: {schedule.next ?? "none"}. Payment-day gaps use the loan compiler's monthly skip convention.</p>
    {String(schedule.total) !== count && <button type="button" onClick={() => confirm(String(schedule.total))}>Confirm derived original count · {schedule.total}</button>}
    <p>The original count is not the remaining count. Funding, balance and contractual rate still require their own source evidence.</p>
  </aside>;
}
