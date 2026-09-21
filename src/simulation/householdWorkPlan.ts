import { generatedOccurrenceKey } from "../identity/index.js";
import { subtractMilliseconds, utcMonthlyOccurrences, type Instant, type Period } from "../time/index.js";
import type { RunContext } from "./run.js";
import type { VerticalSlice2Input } from "./verticalSlice2.js";
import type { VerticalSlice3Input } from "./verticalSlice3.js";
import type { VerticalSlice4Input } from "./verticalSlice4.js";
import type { HouseholdWorkDescriptor } from "./intraperiodScheduler.js";

const descriptor = (value: Omit<HouseholdWorkDescriptor, "dependsOn" | "traceRefs"> & { readonly dependsOn?: readonly string[] }): HouseholdWorkDescriptor =>
  Object.freeze({ ...value, dependsOn: Object.freeze([...(value.dependsOn ?? [])].sort()), traceRefs: Object.freeze([]), resourceAccesses: Object.freeze([...value.resourceAccesses]) });
const mergeDependency = (work: HouseholdWorkDescriptor, dependency: string): HouseholdWorkDescriptor =>
  descriptor({ ...work, dependsOn: [...work.dependsOn, dependency] });
const selected = (schedule: { readonly kind: "explicit_instants"; readonly instants: readonly Instant[] } | { readonly kind: "utc_monthly"; readonly anchor: Instant; readonly invalidDayPolicy: "skip" }, period: Period): readonly Instant[] =>
  schedule.kind === "explicit_instants" ? schedule.instants.filter((at) => at >= period.start && at < period.end).sort() : utcMonthlyOccurrences(schedule.anchor, period, schedule.invalidDayPolicy);
const cashConsumes = (policy: { readonly orderedSources: readonly { readonly accountId: string }[] }) => policy.orderedSources.map((source) => ({ kind: "account_cash" as const, accountId: source.accountId as HouseholdWorkDescriptor["resourceAccesses"][number]["accountId"], mode: "consume" as const }));

/**
 * Potential VS2 work for a period. Event/state-dependent eligibility remains a
 * runtime decision; this deliberately declares every permitted funding source
 * so shared-liquidity preflight is conservative.
 */
export const describeVerticalSlice2PeriodWork = (context: RunContext, input: VerticalSlice2Input, period: Period): readonly HouseholdWorkDescriptor[] => {
  const work: HouseholdWorkDescriptor[] = [];
  for (const income of input.incomes) for (const at of utcMonthlyOccurrences(income.recurrence.anchor, period, income.recurrence.invalidDayPolicy)) {
    if (at < income.start || (income.end !== undefined && at >= income.end)) continue;
    const occurrenceIdentity = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: income.primitiveIds.recurrence, scheduledAt: at, semanticEffectType: "income-recognition", economicTargetId: income.id });
    work.push(descriptor({ id: `cash-income:${income.id}:${occurrenceIdentity}`, domain: "cash_flow", operationClass: "cash_income_settlement", sequencingInstant: at, resourceAccesses: [{ kind: "account_cash", accountId: income.depositAccountId, mode: "produce" }], primitiveInstanceId: income.primitiveIds.recurrence, occurrenceIdentity }));
  }
  for (const expense of input.expenses) for (const at of utcMonthlyOccurrences(expense.recurrence.anchor, period, expense.recurrence.invalidDayPolicy)) {
    if (at < expense.start || (expense.end !== undefined && at >= expense.end)) continue;
    const occurrenceIdentity = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: expense.primitiveIds.recurrence, scheduledAt: at, semanticEffectType: "expense-recognition", economicTargetId: expense.id });
    work.push(descriptor({ id: `cash-expense:${expense.id}:${occurrenceIdentity}`, domain: "cash_flow", operationClass: "cash_expense_settlement", sequencingInstant: at, resourceAccesses: cashConsumes(expense.fundingPolicy), primitiveInstanceId: expense.primitiveIds.recurrence, occurrenceIdentity }));
  }
  const ordered = work.slice();
  for (let index = 0; index < ordered.length; index += 1) for (let previous = 0; previous < index; previous += 1) {
    const left = ordered[previous]!; const right = ordered[index]!;
    if (left.sequencingInstant !== right.sequencingInstant) continue;
    const incomeExpense = left.operationClass !== right.operationClass;
    if (incomeExpense) {
      const incomeFirst = input.sameInstantCashFlowOrder === "income_before_expense";
      const before = left.operationClass === "cash_income_settlement" ? (incomeFirst ? left : right) : (incomeFirst ? right : left);
      const after = before === left ? right : left;
      ordered[ordered.indexOf(after)] = mergeDependency(after, before.id);
      continue;
    }
    if (left.operationClass !== "cash_expense_settlement") continue;
    const leftExpense = input.expenses.find((item) => left.id.includes(`:${item.id}:`))!;
    const rightExpense = input.expenses.find((item) => right.id.includes(`:${item.id}:`))!;
    if (leftExpense.settlementPriority === rightExpense.settlementPriority) continue;
    const before = leftExpense.settlementPriority! < rightExpense.settlementPriority! ? left : right;
    const after = before === left ? right : left;
    ordered[ordered.indexOf(after)] = mergeDependency(after, before.id);
  }
  return Object.freeze(ordered.sort((a, b) => a.id.localeCompare(b.id)));
};

/** VS3 preserves opening-quantity valuation before all end-of-period operations. */
export const describeVerticalSlice3PeriodWork = (context: RunContext, input: VerticalSlice3Input, period: Period): readonly HouseholdWorkDescriptor[] => {
  const at = subtractMilliseconds(period.end, 1); const work: HouseholdWorkDescriptor[] = [];
  const operationOrder = new Map<string, number>(); const operationTargets = new Map<string, readonly string[]>();
  for (const item of input.returns) {
    const occurrenceIdentity = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: item.primitiveIds.markToMarket, scheduledAt: at, semanticEffectType: "mark-to-market", economicTargetId: item.targetPositionId });
    work.push(descriptor({ id: `investment-valuation:${item.targetPositionId}:${at}`, domain: "investments", sequencingInstant: at, resourceAccesses: [], primitiveInstanceId: item.primitiveIds.markToMarket, occurrenceIdentity }));
  }
  const operation = <T extends { readonly id: string; readonly eligibilitySchedule: Parameters<typeof selected>[0]; readonly schedulePrimitiveId: string; readonly order: number }>(item: T, kind: "transfer" | "purchase" | "fee", resources: HouseholdWorkDescriptor["resourceAccesses"], targets: readonly string[]): void => {
    if (selected(item.eligibilitySchedule, period).length !== 1) return;
    const target = kind === "purchase" ? (item as unknown as { readonly targetPositionId: string }).targetPositionId : item.id;
    const occurrenceIdentity = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: item.schedulePrimitiveId as never, scheduledAt: at, semanticEffectType: `investment-${kind}`, economicTargetId: target as never });
    const valuationDependency = kind === "purchase" ? `investment-valuation:${target}:${at}` : undefined;
    const id = `investment-${kind}:${item.id}:${at}`;
    work.push(descriptor({ id, domain: "investments", operationClass: kind === "transfer" ? "investment_transfer" : kind === "purchase" ? "investment_purchase" : "investment_fee", sequencingInstant: at, dependsOn: valuationDependency === undefined ? [] : [valuationDependency], resourceAccesses: resources, primitiveInstanceId: item.schedulePrimitiveId as never, occurrenceIdentity }));
    operationOrder.set(id, item.order); operationTargets.set(id, targets);
  };
  for (const item of input.transfers) operation(item, "transfer", [{ kind: "account_cash", accountId: item.sourceAccountId, mode: "consume" }, { kind: "account_cash", accountId: item.destinationAccountId, mode: "produce" }], [`account:${item.sourceAccountId}`, `account:${item.destinationAccountId}`]);
  for (const item of input.purchases) operation(item, "purchase", [{ kind: "account_cash", accountId: item.sourceCashAccountId, mode: "consume" }], [`account:${item.sourceCashAccountId}`, `position:${item.targetPositionId}`]);
  for (const item of input.fees ?? []) operation(item, "fee", [{ kind: "account_cash", accountId: item.cashAccountId, mode: "consume" }], [`account:${item.cashAccountId}`]);
  for (const target of new Set([...operationTargets.values()].flat())) {
    const chain = work.filter((item) => operationTargets.get(item.id)?.includes(target)).sort((left, right) => operationOrder.get(left.id)! - operationOrder.get(right.id)! || left.id.localeCompare(right.id));
    for (let index = 1; index < chain.length; index += 1) {
      const current = chain[index]!; work[work.indexOf(current)] = mergeDependency(current, chain[index - 1]!.id);
    }
  }
  return Object.freeze(work.sort((a, b) => a.id.localeCompare(b.id)));
};

/** VS4 emits required service before every voluntary extra at the same instant. */
export const describeVerticalSlice4PeriodWork = (context: RunContext, input: VerticalSlice4Input, period: Period): readonly HouseholdWorkDescriptor[] => {
  const work: HouseholdWorkDescriptor[] = [];
  const priority = new Map<string, number>();
  for (const loan of input.loans) for (const at of utcMonthlyOccurrences(loan.paymentSchedule.anchor, period, loan.paymentSchedule.invalidDayPolicy)) {
    const occurrenceIdentity = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: loan.primitiveIds.schedule, scheduledAt: at, semanticEffectType: "liability-payment", economicTargetId: loan.principalLiabilityId });
    const requiredId = `liability-required:${loan.id}:${occurrenceIdentity}`;
    work.push(descriptor({ id: requiredId, domain: "liabilities", operationClass: "liability_required_service", sequencingInstant: at, resourceAccesses: cashConsumes(loan.fundingPolicy), primitiveInstanceId: loan.primitiveIds.schedule, occurrenceIdentity }));
    priority.set(requiredId, loan.settlementPriority);
    const extra = (loan.extraPrincipalPayments ?? []).find((item) => item.scheduledAt === at);
    if (extra !== undefined) {
      const extraIdentity = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: extra.primitiveInstanceId, scheduledAt: at, semanticEffectType: "extra-principal-payment", economicTargetId: loan.principalLiabilityId });
      const extraId = `liability-extra:${extra.id}:${extraIdentity}`;
      work.push(descriptor({ id: extraId, domain: "liabilities", operationClass: "liability_extra_principal", sequencingInstant: at, dependsOn: [requiredId], resourceAccesses: cashConsumes(extra.fundingPolicy), primitiveInstanceId: extra.primitiveInstanceId, occurrenceIdentity: extraIdentity }));
      priority.set(extraId, loan.settlementPriority);
    }
  }
  const required = work.filter((item) => item.operationClass === "liability_required_service");
  const extras = work.filter((item) => item.operationClass === "liability_extra_principal");
  for (const phase of [required, extras]) for (const at of new Set(phase.map((item) => item.sequencingInstant))) {
    const chain = phase.filter((item) => item.sequencingInstant === at).sort((left, right) => priority.get(right.id)! - priority.get(left.id)! || left.id.localeCompare(right.id));
    for (let index = 1; index < chain.length; index += 1) {
      const current = chain[index]!; work[work.indexOf(current)] = mergeDependency(current, chain[index - 1]!.id);
    }
  }
  for (const extra of extras) for (const service of required) if (extra.sequencingInstant === service.sequencingInstant) work[work.indexOf(extra)] = mergeDependency(work[work.indexOf(extra)]!, service.id);
  return Object.freeze(work.sort((a, b) => a.id.localeCompare(b.id)));
};
