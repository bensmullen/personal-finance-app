import { describe, expect, it } from "vitest";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { describeVerticalSlice2PeriodWork, describeVerticalSlice3PeriodWork, describeVerticalSlice4PeriodWork } from "../src/simulation/householdWorkPlan.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Money, Rate, RoundingPolicy, USD, money, rateConvention } from "../src/values/index.js";

const ids = {
  household: domainId("household", "92000000-0000-4000-8000-000000000001"), owner: domainId("person", "92000000-0000-4000-8000-000000000002"), cash: domainId("account", "92000000-0000-4000-8000-000000000003"), cash2: domainId("account", "92000000-0000-4000-8000-000000000004"), payable: domainId("liability", "92000000-0000-4000-8000-000000000005"), income: domainId("income", "92000000-0000-4000-8000-000000000006"), expense: domainId("expense", "92000000-0000-4000-8000-000000000007"), loan: domainId("loan-contract", "92000000-0000-4000-8000-000000000008"), principal: domainId("liability", "92000000-0000-4000-8000-000000000009"), interest: domainId("liability", "92000000-0000-4000-8000-000000000010"), primitive: (value: string) => domainId("primitive-instance", `92000000-0000-4000-8000-${value}`), transfer: domainId("transfer", "92000000-0000-4000-8000-000000000011"), transfer2: domainId("transfer", "92000000-0000-4000-8000-000000000025"),
};
const start = instant("2026-01-01T00:00:00.000Z");
const period = utcMonthlyPeriods(start, 1)[0]!;
const context = createRunContext({ runId: runId("92000000-0000-4000-8000-000000000012"), scenarioId: scenarioId("92000000-0000-4000-8000-000000000013"), asOf: start, dataCutoff: start, simulationStart: start, simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD });
const funding = createFundingPolicy({ id: fundingPolicyId("household-work-plan"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
const schedule = { kind: "utc_monthly" as const, anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" as const };

describe("PR20b slice work-descriptor seams", () => {
  it("preserves VS2 income-before-expense and declares all expense funding resources", () => {
    const work = describeVerticalSlice2PeriodWork(context, { householdId: ids.household, ownerId: ids.owner, cashAccountId: ids.cash, expensePayableLiabilityId: ids.payable, baseCurrency: USD, sameInstantCashFlowOrder: "income_before_expense", events: [], incomes: [{ id: ids.income, ownerId: ids.owner, depositAccountId: ids.cash, baseMonthlyAmount: money("10"), start, recurrence: schedule, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: schedule.anchor, primitiveIds: { growth: ids.primitive("000000000014"), recurrence: ids.primitive("000000000015") } }], expenses: [{ id: ids.expense, ownerId: ids.owner, paymentAccountId: ids.cash, payableLiabilityId: ids.payable, baseMonthlyAmount: money("10"), start, recurrence: schedule, fundingPolicy: { ...funding, orderedSources: [{ kind: "cash_account", accountId: ids.cash }, { kind: "cash_account", accountId: ids.cash2 }] }, settlementPriority: 1, inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), inflationBaseAt: schedule.anchor, primitiveIds: { indexGrowth: ids.primitive("000000000016"), inflationLink: ids.primitive("000000000017"), recurrence: ids.primitive("000000000018") } }] }, period);
    const income = work.find((item) => item.operationClass === "cash_income_settlement")!;
    const expense = work.find((item) => item.operationClass === "cash_expense_settlement")!;
    expect(expense.dependsOn).toContain(income.id);
    expect(expense.resourceAccesses.map((item) => item.accountId)).toEqual([ids.cash, ids.cash2]);
  });

  it("preserves VS3 end-of-period operation dependencies and VS4 required-before-extra phase", () => {
    const investments = describeVerticalSlice3PeriodWork(context, { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, valuationAccountingPolicy: "economic_only", ruleCatalog: [], transfers: [{ id: ids.transfer, sourceAccountId: ids.cash, destinationAccountId: ids.cash2, amount: money("1"), eligibilitySchedule: schedule, executionTiming: "end_of_period", order: 1, schedulePrimitiveId: ids.primitive("000000000019") }, { id: ids.transfer2, sourceAccountId: ids.cash, destinationAccountId: ids.cash2, amount: money("1"), eligibilitySchedule: schedule, executionTiming: "end_of_period", order: 2, schedulePrimitiveId: ids.primitive("000000000026") }], purchases: [], fees: [], returns: [] }, period);
    const firstTransfer = investments.find((item) => item.id.includes(String(ids.transfer)))!;
    const secondTransfer = investments.find((item) => item.id.includes(String(ids.transfer2)))!;
    expect(firstTransfer.operationClass).toBe("investment_transfer");
    expect(secondTransfer.dependsOn).toContain(firstTransfer.id);
    const extraId = domainId("extra-principal-payment", "92000000-0000-4000-8000-000000000020");
    const debt = describeVerticalSlice4PeriodWork(context, { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [{ id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.principal, interestPayableLiabilityId: ids.interest, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0.01", rateConvention.nominalAnnual(12)), totalPayments: 12, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: schedule, fundingPolicy: funding, settlementPriority: 5, extraPrincipalPayments: [{ id: extraId, scheduledAt: schedule.anchor, amount: money("1"), fundingPolicy: funding, primitiveInstanceId: ids.primitive("000000000021") }], postingRounding: new RoundingPolicy(2, "half_even"), primitiveIds: { schedule: ids.primitive("000000000022"), amortization: ids.primitive("000000000023"), accrual: ids.primitive("000000000024") } }] }, period);
    const required = debt.find((item) => item.operationClass === "liability_required_service")!;
    const extra = debt.find((item) => item.operationClass === "liability_extra_principal")!;
    expect(extra.dependsOn).toContain(required.id);
  });
});
