import type { HouseholdForecastPoint } from "./householdProjection.js";
import { restorePortableHouseholdReplayArtifact } from "../simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../simulation/householdExecution.js";
import { instant } from "../time/index.js";
import { Currency, Money } from "../values/index.js";

export interface MonthlyMoneyLine {
  readonly id: string;
  readonly date: string;
  readonly amount: string;
  readonly accountIds: readonly string[];
  readonly holdingIds: readonly string[];
  readonly kind: "employee" | "transfer";
}
/** Inspect committed evidence only. A transfer is never attributed to a paycheck. */
export function inspectMonthlyMoney(point: HouseholdForecastPoint) {
  const ref = point.traceRefs.find(value => value.replayArtifact !== undefined);
  if (!ref) throw new Error("Monthly evidence is unavailable");
  const address = ref.replayArtifact as { basis: unknown; start: string; end: string };
  if (address.start !== point.periodStart || address.end !== point.periodEnd) throw new Error("Monthly evidence does not match the selected period");
  const basis = restorePortableHouseholdReplayArtifact(address.basis);
  if (`household:replay:${basis.runMetadata.inputFingerprint}:${address.start}:${address.end}` !== ref.traceId) throw new Error("Monthly evidence identity does not match");
  const replay = replayHouseholdForecastWindow(basis, { start: instant(address.start), end: instant(address.end) });
  const currency = Currency.of(point.cash.currency);
  let income = Money.zero(currency), employee = Money.zero(currency), deposited = Money.zero(currency);
  const lines: MonthlyMoneyLine[] = [];
  const cashUses: { id: string; date: string; amount: string; accountId: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const period of replay.periods) for (const tx of period.transactions) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    // Keep other posted money-out visible, without reclassifying it as an
    // income-funded allocation or adding it to consumption totals.
    if (tx.type !== "investment_purchase" && !tx.type.startsWith("mortgage_")) for (const leg of tx.legs) {
      if (leg.type === "cash" && leg.posting === "credit") cashUses.push({ id: `${tx.id}:${leg.accountId}`, date: tx.date,
        amount: leg.amount.amount.toString(), accountId: String(leg.accountId),
        label: tx.type === "expense_settlement" ? "Living costs paid" : "Other modeled cash movement" });
    }
    if (tx.type === "income" || tx.type === "payroll_income") {
      for (const leg of tx.legs) {
        if (leg.type === "income" && leg.posting === "credit") income = income.plus(leg.amount);
        if (leg.type === "cash" && leg.posting === "debit") deposited = deposited.plus(leg.amount);
        if (tx.type === "payroll_income" && leg.type === "asset" && leg.posting === "debit") {
          employee = employee.plus(leg.amount);
          lines.push({ id: `${tx.id}:${leg.entityId}`, kind: "employee", date: tx.date, amount: leg.amount.amount.toString(), accountIds: [], holdingIds: [String(leg.entityId)] });
        }
      }
    }
    if (tx.type === "investment_purchase") {
      const holdings = tx.legs.flatMap(leg => leg.type === "asset" && leg.posting === "debit" ? [String(leg.entityId)] : []);
      for (const leg of tx.legs) if (leg.type === "cash" && leg.posting === "credit") lines.push({ id: `${tx.id}:${leg.accountId}`, kind: "transfer", date: tx.date, amount: leg.amount.amount.toString(), accountIds: [String(leg.accountId)], holdingIds: holdings });
    }
  }
  const loans = basis.replay.kernel.executable.liabilityInput?.loans ?? [];
  const mortgages = replay.periods.flatMap(period => (period.liability?.liabilities ?? []).map(item => {
    const loan = loans.find(value => value.id === item.loanId);
    return { liabilityId: String(loan?.principalLiabilityId ?? ""), date: String(item.scheduledAt),
      fundingAccountIds: loan?.fundingPolicy.orderedSources.map(value => String(value.accountId)) ?? [],
      contractual: item.contractualPayment.amount.toString(), payment: item.scheduledPayment.amount.toString(),
      principal: item.scheduledPrincipalPaid.amount.toString(), interest: item.currentInterest.amount.toString(),
      extra: item.extraPrincipalPaid.amount.toString(), status: item.scheduledFundingStatus === "fully_satisfied" ? "Paid" : "Not fully funded" };
  }));
  return { currency: currency.code, income: income.amount.toString(), employee: employee.amount.toString(), deposited: deposited.amount.toString(),
    // This is coverage of gross recognition, NOT leftover or spendable income.
    unreconciled: income.minus(employee).amount.toString(), lines, mortgages, cashUses,
    withholding: "not_modeled" as const, status: "incomplete" as const };
}
