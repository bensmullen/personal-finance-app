import { domainId } from "../../src/identity/index.js";
import { createAuthoritativeState } from "../../src/state/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../src/funding/index.js";
import { createRunContext, runId, scenarioId } from "../../src/simulation/run.js";
import { createPrimitiveRuntimeStateStore } from "../../src/simulation/period.js";
import { createHouseholdTaxParticipant, taxCreditPositionIds, type HouseholdTaxInput } from "../../src/simulation/tax.js";
import { compileHouseholdKernel } from "../../src/simulation/r3/compiledHousehold.js";
import type { ExecutableHouseholdProjection } from "../../src/simulation/householdExecution.js";
import { instant, utcMonthlyPeriods } from "../../src/time/index.js";
import { money, Rate, rateConvention, Ratio, USD } from "../../src/values/index.js";
import { taxRule } from "./t1aTaxRules.js";

export const taxHouseholdIds = {
  household: domainId("household", "86000000-0000-4000-8000-000000000001"),
  person: domainId("person", "86000000-0000-4000-8000-000000000002"),
  cash: domainId("account", "86000000-0000-4000-8000-000000000003"),
  income: domainId("income", "86000000-0000-4000-8000-000000000004"),
  payable: domainId("liability", "86000000-0000-4000-8000-000000000005"),
};
export const taxHouseholdFixture = (options: { readonly months?: number; readonly amount?: string; readonly openingCash?: string; readonly withholding?: string; readonly input?: Partial<HouseholdTaxInput>; readonly incomeType?: string; readonly taxCharacter?: string } = {}) => {
  const ids = taxHouseholdIds, months = options.months ?? 1;
  const start = instant("2024-01-01T00:00:00.000Z"), end = utcMonthlyPeriods(start, months).at(-1)!.end;
  const input: HouseholdTaxInput = {
    catalog: [taxRule(1, { jurisdiction: "US:FEDERAL", income: { ...taxRule().income!, ordinaryBrackets: [{ lower: money("0"), rate: Ratio.parse("0.1") }], standardDeduction: money("0") } })],
    filingStatus: "single", simulationStart: start, ownerId: ids.household,
    incomes: [{ id: ids.income, ownerId: ids.person, incomeType: options.incomeType ?? "salary", taxCharacter: options.taxCharacter ?? "ordinary", start: "2024-01-01",
      residence: [{ state_jurisdiction: "TEST:RESIDENCE", effective_date: "2024-01-01" }],
      work: [{ state_jurisdiction: "TEST:SERVICE", allocation: "1", effective_date: "2024-01-01" }], eligibility: [] }], eligibility: [],
    fundingPolicy: createFundingPolicy({ id: fundingPolicyId("test:tax"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: true, insufficientFundsBehavior: "unfunded" }), refundAccountId: ids.cash,
    payments: options.withholding === undefined ? [] : Array.from({ length: months }, (_, index) => ({ id: `withholding-${index}`, jurisdiction: "US:FEDERAL", at: instant(`2024-${String(index + 1).padStart(2, "0")}-20T00:00:00.000Z`), amount: money(options.withholding!), kind: "withholding" as const })),
    settlements: [{ id: "final-2024", jurisdiction: "US:FEDERAL", taxYear: "2024", at: instant("2024-12-31T23:59:59.999Z") }],
    diagnostics: [], ...options.input,
  };
  const context = createRunContext({ runId: runId("86000000-0000-4000-8000-000000000007"), scenarioId: scenarioId("86000000-0000-4000-8000-000000000008"), asOf: instant("2023-12-31T00:00:00.000Z"), dataCutoff: instant("2023-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: end, baseCurrency: USD });
  const compiled: ExecutableHouseholdProjection = {
    reconciledOpeningState: createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, kind: "cash", ownerId: ids.person, cash: money(options.openingCash ?? "0") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } }),
    reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), executionMonths: months, scenarioIdentity: context.scenarioId, scenarioBindings: {}, standaloneAssets: [],
    participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input),
    cashFlowInput: { householdId: ids.household, ownerId: ids.person, cashAccountId: ids.cash, expensePayableLiabilityId: ids.payable, baseCurrency: USD, sameInstantCashFlowOrder: "income_before_expense", expenses: [], events: [], incomes: [{ id: ids.income, ownerId: ids.person, depositAccountId: ids.cash, baseMonthlyAmount: money(options.amount ?? "1000"), start, recurrence: { kind: "utc_monthly", anchor: instant("2024-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: start, primitiveIds: { growth: domainId("primitive-instance", "86000000-0000-4000-8001-000000000001"), recurrence: domainId("primitive-instance", "86000000-0000-4000-8001-000000000002") } }] },
  };
  return { input, context, compiled, kernel: compileHouseholdKernel(compiled, start) };
};
