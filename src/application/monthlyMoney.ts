import type { HouseholdForecastPoint } from "./householdProjection.js";
import { restorePortableHouseholdReplayArtifact } from "../simulation/r3/replayArtifact.js";
import { householdEvidenceMonth } from "./mortgageChartData.js";
import { Currency, Money, decimal, RoundingPolicy, Unit } from "../values/index.js";
import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { objects } from "./compiler/shared.js";
import { taxBalanceIds } from "../simulation/tax/contracts.js";

export interface MonthlyMoneyLine {
  readonly id: string;
  readonly date: string;
  readonly amount: string;
  readonly accountIds: readonly string[];
  readonly holdingIds: readonly string[];
  readonly kind: "employee" | "transfer";
}
export type MonthlyUseKind = "workplace" | "mortgage" | "living" | "ira" | "brokerage" | "tax" | "other";
export interface MonthlyUse {
  readonly id: string;
  readonly kind: MonthlyUseKind;
  readonly label: string;
  readonly amount: string;
  readonly sourceIds: readonly string[];
  readonly accountIds: readonly string[];
  readonly holdingIds: readonly string[];
  readonly liabilityIds: readonly string[];
  readonly expenseIds: readonly string[];
  readonly policyIds: readonly string[];
  readonly incomeIds?: readonly string[];
}
/** Read-only budgeting comparison. Posted cash uses do not establish cash origin. */
export function inspectMonthlyMoney(point: HouseholdForecastPoint, model?: PortableModelEnvelope,
  observation?: import("./mortgageChartData.js").HouseholdEvidenceObserver) {
  const ref = point.traceRefs.find(value => value.replayArtifact !== undefined);
  if (!ref) throw new Error("Monthly evidence is unavailable");
  const address = ref.replayArtifact as { basis: unknown; start: string; end: string };
  if (address.start !== point.periodStart || address.end !== point.periodEnd) throw new Error("Monthly evidence does not match the selected period");
  const basis = restorePortableHouseholdReplayArtifact(address.basis, observation);
  if (`household:replay:${basis.runMetadata.inputFingerprint}:${address.start}:${address.end}` !== ref.traceId) throw new Error("Monthly evidence identity does not match");
  const periods = householdEvidenceMonth(basis, address.start, address.end, observation);
  const currency = Currency.of(point.cash.currency);
  let income = Money.zero(currency), payroll = Money.zero(currency), otherIncome = Money.zero(currency);
  let employee = Money.zero(currency), deposited = Money.zero(currency), cashChange = Money.zero(currency), otherReceipts = Money.zero(currency);
  let withheld = Money.zero(currency), coveredPayroll = 0, uncoveredPayroll = 0;
  const executable = basis.replay.kernel.executable;
  const loans = executable.liabilityInput?.loans ?? [];
  const uses = new Map<string, MonthlyUse>();
  const addUse = (kind: MonthlyUseKind, label: string, id: string, amount: Money,
    refs: { accountIds?: readonly string[]; holdingIds?: readonly string[]; liabilityIds?: readonly string[]; expenseIds?: readonly string[]; policyIds?: readonly string[]; incomeIds?: readonly string[] } = {}) => {
    if (!amount.isPositive()) return;
    const key = `${kind}:${label}:${(refs.holdingIds ?? []).join()}:${(refs.liabilityIds ?? []).join()}:${(refs.expenseIds ?? []).join()}:${(refs.policyIds ?? []).join()}`;
    const prior = uses.get(key);
    uses.set(key, { id: key, kind, label, amount: (prior ? Money.parse(prior.amount, currency).plus(amount) : amount).amount.toString(),
      sourceIds: [...(prior?.sourceIds ?? []), id],
      accountIds: [...new Set([...(prior?.accountIds ?? []), ...(refs.accountIds ?? [])])],
      holdingIds: [...new Set([...(prior?.holdingIds ?? []), ...(refs.holdingIds ?? [])])],
      liabilityIds: [...new Set([...(prior?.liabilityIds ?? []), ...(refs.liabilityIds ?? [])])],
      expenseIds: [...new Set([...(prior?.expenseIds ?? []), ...(refs.expenseIds ?? [])])],
      incomeIds: [...new Set([...(prior?.incomeIds ?? []), ...(refs.incomeIds ?? [])])],
      policyIds: [...new Set([...(prior?.policyIds ?? []), ...(refs.policyIds ?? [])])] });
  };
  const lines: MonthlyMoneyLine[] = [];
  const cashUses: { id: string; date: string; amount: string; accountId: string; label: string }[] = [];
  const seen = new Set<string>();
  const receipts: { id: string; label: string; amount: string; accountId: string }[] = [];
  for (const period of periods) for (const tx of period.transactions) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    const payrollStream = executable.cashFlowInput?.incomes.find(stream => tx.type === "payroll_income"
      ? tx.traceRefs?.some(ref => ref.traceId === `payroll:${tx.id}:gross:${stream.id}`)
      : tx.id.includes(String(stream.id)) || tx.traceRefs?.some(ref => ref.traceId.includes(String(stream.id))));
    const allocations = payrollStream?.payrollContributions ?? [];
    const source = model && objects(model, "Income").find(item => item.income_id === payrollStream?.id);
    const isPay = tx.type === "payroll_income" || tx.type === "income" && source?.income_type === "salary" && source.gross_or_net !== "net";
    // Committed traces bind elections to this occurrence. Tax-credit assets
    // are neither investment contributions nor independently bank-paid tax.
    const elections = (payrollStream?.payrollWithholding ?? []).filter(item => item.start <= tx.date && (item.end === undefined || tx.date < item.end));
    const creditLegs = new Set<number>();
    let provedElections = 0;
    if (tx.type === "payroll_income") for (const election of elections) {
      const prefix = `payroll:withholding:${election.id}:income:${payrollStream!.id}:owner:${election.ownerId}:employer:${election.employerId}:occurrence:`;
      const suffix = `:year:${tx.date.slice(0, 4)}:jurisdiction:${election.jurisdiction}:provenance:${election.provenance}`;
      if (!tx.traceRefs?.some(ref => ref.traceId.startsWith(prefix) && ref.traceId.endsWith(suffix))) continue;
      const positionId = taxBalanceIds(election.jurisdiction, tx.date.slice(0, 4)).creditPositionId;
      const matches = tx.legs.flatMap((leg, index) => leg.type === "asset" && leg.posting === "debit" && leg.entityId === positionId
        && leg.quantity?.unit.equals(Unit.of("usd_tax_credit")) && leg.quantity.amount.equals(leg.amount.amount) ? [index] : []);
      if (matches.length === 1) {
        const index = matches[0]!;
        creditLegs.add(index);
        withheld = withheld.plus(tx.legs[index]!.amount);
        provedElections++;
      } else if (!matches.length && (election.calculation.kind === "fixed" ? election.calculation.amount.isZero() : decimal(election.calculation.rate).isZero())) {
        provedElections++;
      }
    }
    if (isPay) {
      if (elections.length > 0 && provedElections === elections.length) coveredPayroll++; else uncoveredPayroll++;
    }
    for (const [index, leg] of tx.legs.entries()) {
      if (leg.type === "cash") {
        cashChange = leg.posting === "debit" ? cashChange.plus(leg.amount) : cashChange.minus(leg.amount);
        const internalTransfer = tx.legs.every(item => item.type === "cash") && tx.legs.some(item => item.posting === "debit") && tx.legs.some(item => item.posting === "credit");
        if (leg.posting === "debit" && tx.type !== "income" && tx.type !== "payroll_income" && !internalTransfer) {
          otherReceipts = otherReceipts.plus(leg.amount);
          receipts.push({ id: `${tx.id}:leg:${index}`, label: tx.type === "tax_refund" ? "Tax refund" : tx.type === "sale" ? "Investment sale proceeds" : tx.type === "death_benefit" ? "Insurance benefit" : "Other posted receipt",
            amount: leg.amount.amount.toString(), accountId: String(leg.accountId) });
        }
        if (leg.posting === "credit" && !internalTransfer) {
          const id = `${tx.id}:leg:${index}`, accountIds = [String(leg.accountId)];
          const loan = loans.find(item => tx.legs.some(value => value.type === "liability" &&
            (value.entityId === item.principalLiabilityId || value.entityId === item.interestPayableLiabilityId)));
          const holdings = tx.legs.flatMap(value => value.type === "asset" && value.posting === "debit" ? [String(value.entityId)] : []);
          const purchase = executable.investmentInput?.purchases.find(item => holdings.includes(String(item.targetPositionId)));
          const expenseStream = executable.cashFlowInput?.expenses.find(item => tx.legs.some(value => value.type === "liability" && value.entityId === item.payableLiabilityId));
          const expense = model && objects(model, "Expense").find(item => item.expense_id === expenseStream?.id);
          const policy = model && objects(model, "Insurance").find(item => tx.traceRefs?.some(ref => ref.traceId === `compiler:canonical:Insurance:${item.insurance_id}`));
          if (tx.type.startsWith("mortgage_") && loan) addUse("mortgage", "Mortgage payment", id, leg.amount, { accountIds, liabilityIds: [String(loan.principalLiabilityId)] });
          else if (tx.type === "expense_settlement") addUse("living", String(expense?.category ?? "Living costs"), id, leg.amount, { accountIds, expenseIds: expense ? [String(expense.expense_id)] : [] });
          else if (tx.type === "insurance_premium") addUse("living", typeof policy?.name === "string" ? policy.name : "Insurance premiums", id, leg.amount, { accountIds, policyIds: policy ? [String(policy.insurance_id)] : [] });
          else if (tx.type === "investment_purchase" || tx.type === "purchase" && holdings.length > 0) addUse(purchase?.contribution?.character.endsWith("_ira") ? "ira" : "brokerage",
            purchase?.contribution?.character.endsWith("_ira") ? "IRA contribution" : "Brokerage investment", id, leg.amount, { accountIds, holdingIds: holdings });
          else if (tx.type.includes("tax")) addUse("tax", "Tax cash payment", id, leg.amount, { accountIds });
          else addUse("other", "Other posted cash uses", id, leg.amount, { accountIds, holdingIds: holdings });
        }
      }
      if ((tx.type === "income" || tx.type === "payroll_income") && leg.type === "income" && leg.posting === "credit") {
        if (isPay) payroll = payroll.plus(leg.amount); else otherIncome = otherIncome.plus(leg.amount);
      }
      if (tx.type === "payroll_income" && leg.type === "asset" && leg.posting === "debit") {
        const allocation = allocations.find(value => value.positionId === leg.entityId && !value.policy.character.startsWith("employer_"));
        if (allocation) {
          addUse("workplace", allocation.policy.character === "employee_hsa" ? "Employee HSA" : "Employee retirement",
            `${tx.id}:leg:${index}`, leg.amount, { holdingIds: [String(leg.entityId)] });
          employee = employee.plus(leg.amount);
          lines.push({ id: `${tx.id}:leg:${index}`, kind: "employee", date: tx.date, amount: leg.amount.amount.toString(), accountIds: [], holdingIds: [String(leg.entityId)] });
        } else if (creditLegs.has(index)) {
          addUse("tax", "Payroll withholding", `${tx.id}:leg:${index}`, leg.amount, { incomeIds: [String(payrollStream!.id)] });
        } else addUse("other", "Other payroll allocation", `${tx.id}:leg:${index}`, leg.amount);
      }
    }
    // Keep other posted money-out visible, without reclassifying it as an
    // income-funded allocation or adding it to consumption totals.
    if (tx.type !== "investment_purchase" && tx.type !== "insurance_premium" && !tx.type.startsWith("mortgage_")) for (const leg of tx.legs) {
      if (leg.type === "cash" && leg.posting === "credit") cashUses.push({ id: `${tx.id}:${leg.accountId}`, date: tx.date,
        amount: leg.amount.amount.toString(), accountId: String(leg.accountId),
        label: tx.type === "expense_settlement" ? "Living costs paid" : "Other modeled cash movement" });
    }
    if (tx.type === "income" || tx.type === "payroll_income") {
      for (const leg of tx.legs) {
        if (leg.type === "income" && leg.posting === "credit") income = income.plus(leg.amount);
        if (leg.type === "cash" && leg.posting === "debit") deposited = deposited.plus(leg.amount);
      }
    }
    if (tx.type === "investment_purchase") {
      const holdings = tx.legs.flatMap(leg => leg.type === "asset" && leg.posting === "debit" ? [String(leg.entityId)] : []);
      for (const leg of tx.legs) if (leg.type === "cash" && leg.posting === "credit") lines.push({ id: `${tx.id}:${leg.accountId}`, kind: "transfer", date: tx.date, amount: leg.amount.amount.toString(), accountIds: [String(leg.accountId)], holdingIds: holdings });
    }
  }
  const mortgages = periods.flatMap(period => (period.liability?.liabilities ?? []).map(item => {
    const loan = loans.find(value => value.id === item.loanId);
    const paid = loan ? period.transactions.filter(tx => ["mortgage_principal_payment", "mortgage_interest_settlement"].includes(tx.type) && tx.date === item.scheduledAt && tx.legs.some(leg => leg.type === "liability" && [loan.principalLiabilityId, loan.interestPayableLiabilityId].includes(leg.entityId)))
      .flatMap(tx => tx.legs).reduce((total, leg) => leg.type === "cash" && leg.posting === "credit" ? total.plus(leg.amount) : total, Money.zero(currency)) : undefined;
    return { liabilityId: String(loan?.principalLiabilityId ?? ""), date: String(item.scheduledAt),
      fundingAccountIds: loan?.fundingPolicy.orderedSources.map(value => String(value.accountId)) ?? [],
      contractual: item.contractualPayment.amount.toString(), payment: item.scheduledPayment.amount.toString(), paid: paid?.amount.toString(),
      principal: item.scheduledPrincipalPaid.amount.toString(), interest: item.currentInterest.amount.toString(),
      extra: item.extraPrincipalPaid.amount.toString(), status: item.scheduledFundingStatus === "fully_satisfied" ? "Paid" : "Not fully funded" };
  }));
  const order: MonthlyUseKind[] = ["workplace", "tax", "mortgage", "living", "ira", "brokerage", "other"];
  const categories = [...uses.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id));
  const denominator = payroll.isPositive() ? payroll : income;
  const totalUses = categories.reduce((sum, item) => sum.plus(Money.parse(item.amount, currency)), Money.zero(currency));
  const comparison = denominator.minus(totalUses);
  return { currency: currency.code, income: income.amount.toString(), payroll: payroll.amount.toString(), otherIncome: otherIncome.amount.toString(),
    basis: payroll.isPositive() ? "gross_payroll" as const : "household_income" as const,
    denominator: denominator.amount.toString(), categories, totalUses: totalUses.amount.toString(),
    unallocated: comparison.isNegative() ? "0" : comparison.amount.toString(),
    additionalFunding: comparison.isNegative() ? totalUses.minus(denominator).amount.toString() : "0",
    cashChange: cashChange.amount.toString(), otherReceipts: otherReceipts.amount.toString(), receipts,
    employee: employee.amount.toString(), deposited: deposited.amount.toString(),
    // This is coverage of gross recognition, NOT leftover or spendable income.
    unreconciled: income.minus(employee).minus(withheld).amount.toString(), lines, mortgages, cashUses,
    // Posted-election coverage never proves all legal taxes or disposable pay.
    withholding: coveredPayroll > 0 || withheld.isPositive() ? (!model || uncoveredPayroll > 0 || objects(model, "Income").some(item => item.income_type === "salary"
      && !executable.cashFlowInput?.incomes.some(stream => stream.id === item.income_id)) ? "partial" as const : "posted" as const) : "not_modeled" as const,
    withholdingAmount: coveredPayroll > 0 || withheld.isPositive() ? withheld.amount.toString() : undefined,
    status: "incomplete" as const };
}


/** Exact, read-only cash comparison; application owns Money operations, UI owns rendering. */
/** Presentation only: exact source values/order, disposable bounded coordinates. */
export function cashComparison(detail: ReturnType<typeof inspectMonthlyMoney>) {
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
    const knownUsesOnly = income.isZero() && uses.isPositive();
    return { categories, coherent, knownUsesOnly, drawable: coherent && !income.isNegative() && scale.isPositive() && categories.length > 0,
      overflow: excess.isPositive(), remainder: remainder.isPositive(), scale: scale.toString(), percent };
  } catch { return undefined; }
}


/** UI asks the application for exact sign, never imports engine values directly. */
export function isPositiveMonthlyMoney(value: string): boolean {
  return decimal(value).isPositive();
}
