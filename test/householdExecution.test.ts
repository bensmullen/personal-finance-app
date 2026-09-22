import { describe, expect, it } from "vitest";
import type { CompiledHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { domainId } from "../src/identity/index.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { runCompiledHouseholdProjection } from "../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { runVerticalSlice3 } from "../src/simulation/verticalSlice3.js";
import type { FixedAmortizingLoan } from "../src/simulation/verticalSlice4.js";
import type { VerticalSlice2Input } from "../src/simulation/verticalSlice2.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant } from "../src/time/index.js";
import { Quantity, Rate, RoundingPolicy, SHARE, USD, money, rateConvention, ratePeriod } from "../src/values/index.js";

const ids = {
  household: domainId("household", "93000000-0000-4000-8000-000000000001"), owner: domainId("person", "93000000-0000-4000-8000-000000000002"),
  cash: domainId("account", "93000000-0000-4000-8000-000000000003"), payable: domainId("liability", "93000000-0000-4000-8000-000000000004"),
  income: domainId("income", "93000000-0000-4000-8000-000000000005"), position: domainId("position", "93000000-0000-4000-8000-000000000006"),
  expense: domainId("expense", "93000000-0000-4000-8000-000000000017"),
  standaloneAsset: "93000000-0000-4000-8000-000000000012",
  missingPrincipal: domainId("liability", "93000000-0000-4000-8000-000000000009"), missingInterest: domainId("liability", "93000000-0000-4000-8000-000000000010"), loan: domainId("loan-contract", "93000000-0000-4000-8000-000000000011"),
  secondPrincipal: domainId("liability", "93000000-0000-4000-8000-000000000014"), secondInterest: domainId("liability", "93000000-0000-4000-8000-000000000015"), secondLoan: domainId("loan-contract", "93000000-0000-4000-8000-000000000016"),
  savings: domainId("account", "93000000-0000-4000-8000-000000000019"), transfer: domainId("transfer", "93000000-0000-4000-8000-000000000020"),
};
const scenario = "93000000-0000-4000-8000-000000000007";
const start = instant("2026-01-01T00:00:00.000Z"); const end = instant("2026-02-01T00:00:00.000Z");
const primitive = (suffix: string) => domainId("primitive-instance", `93000000-0000-4000-8001-${suffix.padStart(12, "0")}`);
const cashFlow: VerticalSlice2Input = { householdId: ids.household, ownerId: ids.owner, cashAccountId: ids.cash, expensePayableLiabilityId: ids.payable, baseCurrency: USD, sameInstantCashFlowOrder: "income_before_expense", expenses: [], events: [], incomes: [{ id: ids.income, ownerId: ids.owner, depositAccountId: ids.cash, baseMonthlyAmount: money("100"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: instant("2026-01-15T00:00:00.000Z"), primitiveIds: { growth: primitive("1"), recurrence: primitive("2") } }] };
const opening = () => createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, kind: "brokerage", ownerId: ids.owner, cash: money("10") } }, positions: { [ids.position]: { id: ids.position, accountId: ids.cash, quantity: Quantity.parse("5", SHARE), price: money("10"), carryingValue: money("50") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } });
const context = (months = 1) => createRunContext({ runId: runId("93000000-0000-4000-8000-000000000008"), scenarioId: scenarioId(scenario), asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: months === 1 ? end : instant("2026-03-01T00:00:00.000Z"), baseCurrency: USD });
const compiled = (lateFailure = false, withAsset = false): CompiledHouseholdProjection => ({ cashFlowInput: cashFlow, ...(lateFailure ? { liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [{ id: ids.loan, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, primitiveIds: { schedule: primitive("20"), amortization: primitive("21"), accrual: primitive("22") } } as never] } } : {}), reconciledOpeningState: opening(), reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), standaloneAssets: withAsset ? [{ id: ids.standaloneAsset, value: money("7") }] : [], scenarioIdentity: scenario, executionMonths: 1, contentionPolicy: { id: "pr20-order", version: "1", rules: [] }, diagnostics: [], scenarioBindings: { cashFlow: { incomeIds: {}, expenseIds: {}, accountIds: {}, retirementEvents: {} } } });

describe("compiled household execution", () => {
  it("derives one closing authority and never double counts the account container", () => {
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: compiled() });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.cash.equals(money("110"))).toBe(true);
    expect(result.periods[0]!.investmentValue.equals(money("50"))).toBe(true);
    expect(result.periods[0]!.assets.equals(money("160"))).toBe(true);
    expect(result.periods[0]!.statements.income.equals(money("100"))).toBe(true);
    expect(result.periods[0]!.transactions).toHaveLength(1);
  });

  it("includes a compiled standalone asset exactly once in closing assets and net worth", () => {
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: compiled(false, true) });
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.assets.equals(money("167"))).toBe(true);
    expect(result.periods[0]!.netWorth.equals(money("167"))).toBe(true);
  });

  it("reconciles real VS2, VS3, and VS4 work through one shared closing state", () => {
    const funding = createFundingPolicy({ id: fundingPolicyId("household:checking"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const investmentInput = {
      householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, valuationAccountingPolicy: "economic_only" as const, ruleCatalog: [], transfers: [], purchases: [], fees: [],
      returns: [{ targetPositionId: ids.position, accountId: ids.cash, rate: Rate.fromDecimal("0", rateConvention.periodic(ratePeriod("1", "calendar_month"))), returnBasis: { kind: "periodic" as const, period: ratePeriod("1", "calendar_month") }, timing: "end_of_period_on_opening_quantity" as const, priceRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { compounding: primitive("40"), markToMarket: primitive("41") } }],
    };
    const liabilityInput = {
      householdId: ids.household, ownerId: ids.owner, baseCurrency: USD,
      loans: [{ id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 1, rateType: "fixed" as const, paymentFrequency: "monthly" as const, interestConvention: "nominal_annual_12" as const, amortization: "fully_amortizing" as const, paymentResetPolicy: "fixed_no_recast" as const, interestCapitalization: "none" as const, partialPaymentPolicy: "all_or_nothing" as const, paymentSchedule: { kind: "utc_monthly" as const, anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" as const }, fundingPolicy: funding, settlementPriority: 1, extraPrincipalPayments: [], postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive("42"), amortization: primitive("43"), accrual: primitive("44") } }],
    };
    const startState = createAuthoritativeState({ ...opening(), liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") }, [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("100") }, [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") } } });
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: { ...compiled(), reconciledOpeningState: startState, investmentInput, liabilityInput, contentionPolicy: { id: "unified", version: "1", rules: [{ before: "cash_income_settlement", after: "liability_required_service" }] } } });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.cash.equals(money("10"))).toBe(true);
    expect(result.periods[0]!.investmentValue.equals(money("50"))).toBe(true);
    expect(result.periods[0]!.liability!.principalReduction.equals(money("100"))).toBe(true);
    expect(result.periods[0]!.netWorth.equals(money("60"))).toBe(true);
    expect(result.periods[0]!.traceRefs.some((ref) => ref.traceId.includes("household:contention-policy:unified:v1"))).toBe(true);

    const unresolved = runCompiledHouseholdProjection({ runContext: context(), compiled: { ...compiled(), reconciledOpeningState: startState, investmentInput, liabilityInput } });
    expect(unresolved.status).toBe("incomplete");
    expect(unresolved.diagnostics.some((issue) => issue.code === "HOUSEHOLD_CONTENTION_UNRESOLVED")).toBe(true);
    expect(unresolved.periods).toHaveLength(0);
    expect(unresolved.state).toEqual(startState);

    const at = (day: string) => instant(`2026-01-${day}T00:00:00.000Z`);
    const runChronology = (incomeAt: string, debtAt: string) => runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(), reconciledOpeningState: startState,
      cashFlowInput: { ...cashFlow, incomes: [{ ...cashFlow.incomes[0]!, recurrence: { kind: "utc_monthly", anchor: at(incomeAt), invalidDayPolicy: "skip" }, growthBaseAt: at(incomeAt) }] },
      investmentInput,
      liabilityInput: { ...liabilityInput, loans: [{ ...liabilityInput.loans[0]!, paymentSchedule: { kind: "utc_monthly", anchor: at(debtAt), invalidDayPolicy: "skip" } }] },
    } });
    const laterIncome = runChronology("20", "05");
    expect(laterIncome.status).toBe("completed");
    expect(laterIncome.periods[0]!.liability!.principalReduction.isZero()).toBe(true);
    const earlierIncome = runChronology("05", "20");
    expect(earlierIncome.status).toBe("completed");
    expect(earlierIncome.periods[0]!.liability!.principalReduction.equals(money("100"))).toBe(true);
  });

  it("rolls back cash-flow and identities when a later slice fails", () => {
    const compounding = primitive("45");
    const markToMarket = primitive("46");
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(true),
      investmentInput: {
        householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, valuationAccountingPolicy: "economic_only", ruleCatalog: [], transfers: [], purchases: [], fees: [],
        returns: [{ targetPositionId: ids.position, accountId: ids.cash, rate: Rate.fromDecimal("0.1", rateConvention.periodic(ratePeriod("1", "calendar_month"))), returnBasis: { kind: "periodic", period: ratePeriod("1", "calendar_month") }, timing: "end_of_period_on_opening_quantity", priceRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { compounding, markToMarket } }],
      },
    } });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(0);
    expect(result.state.accounts[ids.cash]!.cash.equals(money("10"))).toBe(true);
    expect(result.state.identities.postedTransactionIds).toEqual([]);
    expect(result.primitiveState).toEqual({});
    expect(result.primitiveState[compounding]).toBeUndefined();
    expect(result.primitiveState[markToMarket]).toBeUndefined();
    expect(result.stoppedAt).toBe(start);
  });

  it("executes each required service once and retains both loans in the consolidated trajectory", () => {
    const funding = createFundingPolicy({ id: fundingPolicyId("household:two-loans"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const loan = (id: typeof ids.loan, principalLiabilityId: typeof ids.missingPrincipal, interestPayableLiabilityId: typeof ids.missingInterest, priority: number, suffix: string) => ({
      id, ownerId: ids.owner, principalLiabilityId, interestPayableLiabilityId, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 1, rateType: "fixed" as const, paymentFrequency: "monthly" as const, interestConvention: "nominal_annual_12" as const, amortization: "fully_amortizing" as const, paymentResetPolicy: "fixed_no_recast" as const, interestCapitalization: "none" as const, partialPaymentPolicy: "all_or_nothing" as const, paymentSchedule: { kind: "utc_monthly" as const, anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" as const }, fundingPolicy: funding, settlementPriority: priority, extraPrincipalPayments: [], postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive(`${suffix}1`), amortization: primitive(`${suffix}2`), accrual: primitive(`${suffix}3`) },
    });
    const first = loan(ids.loan, ids.missingPrincipal, ids.missingInterest, 2, "6");
    const second = loan(ids.secondLoan, ids.secondPrincipal, ids.secondInterest, 1, "7");
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(), cashFlowInput: undefined,
      reconciledOpeningState: createAuthoritativeState({ ...opening(), accounts: { [ids.cash]: { id: ids.cash, kind: "checking", ownerId: ids.owner, cash: money("200") } }, liabilities: {
        [ids.payable]: { id: ids.payable, balance: money("0") }, [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("100") }, [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") }, [ids.secondPrincipal]: { id: ids.secondPrincipal, balance: money("100") }, [ids.secondInterest]: { id: ids.secondInterest, balance: money("0") },
      } }),
      liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [first, second] },
    } });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.liability!.liabilities).toHaveLength(2);
    expect(result.periods[0]!.liability!.liabilities.map((item) => item.loanId).sort()).toEqual([ids.loan, ids.secondLoan].sort());
    expect(result.periods[0]!.liability!.principalReduction.equals(money("200"))).toBe(true);
    expect(result.state.liabilities[ids.missingPrincipal]!.balance.isZero()).toBe(true);
    expect(result.state.liabilities[ids.secondPrincipal]!.balance.isZero()).toBe(true);
  });

  it("does not fabricate debt service for an already paid-off liability", () => {
    const funding = createFundingPolicy({ id: fundingPolicyId("household:paid-off"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(), cashFlowInput: undefined,
      reconciledOpeningState: createAuthoritativeState({ ...opening(), liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") }, [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("0") }, [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") } } }),
      liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [{ id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 1, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, fundingPolicy: funding, settlementPriority: 1, extraPrincipalPayments: [], postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive("80"), amortization: primitive("81"), accrual: primitive("82") } }] },
    } });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.liability).toBeUndefined();
    expect(result.periods[0]!.transactions).toEqual([]);
    expect(result.primitiveState[primitive("80")]).toBeUndefined();
  });

  it("reports a typed, atomic failure when cross-domain policy closes a local dependency cycle", () => {
    const funding = createFundingPolicy({ id: fundingPolicyId("household:cycle"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const expenseInput: VerticalSlice2Input = {
      ...cashFlow,
      incomes: [],
      expenses: [{ id: ids.expense, ownerId: ids.household, paymentAccountId: ids.cash, payableLiabilityId: ids.payable, baseMonthlyAmount: money("100"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), inflationBaseAt: instant("2026-01-15T00:00:00.000Z"), fundingPolicy: funding, settlementPriority: 1, primitiveIds: { indexGrowth: primitive("90"), inflationLink: primitive("91"), recurrence: primitive("92") } }],
    };
    const openingState = createAuthoritativeState({ ...opening(), accounts: { [ids.cash]: { id: ids.cash, kind: "checking", ownerId: ids.owner, cash: money("100") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") }, [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("100") }, [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") } } });
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(), cashFlowInput: expenseInput, reconciledOpeningState: openingState,
      liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [{ id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 1, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, fundingPolicy: funding, settlementPriority: 1, extraPrincipalPayments: [{ id: domainId("extra-principal-payment", "93000000-0000-4000-8000-000000000018"), scheduledAt: instant("2026-01-15T00:00:00.000Z"), amount: money("10"), fundingPolicy: funding, primitiveInstanceId: primitive("95") }], postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive("93"), amortization: primitive("94"), accrual: primitive("96") } }] },
      contentionPolicy: { id: "local-cycle", version: "1", rules: [{ before: "cash_expense_settlement", after: "liability_required_service" }, { before: "liability_extra_principal", after: "cash_expense_settlement" }] },
    } });
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics.some((issue) => issue.code === "HOUSEHOLD_CONTENTION_POLICY_CYCLE")).toBe(true);
    expect(result.periods).toHaveLength(0);
    expect(result.state).toEqual(openingState);
    expect(result.primitiveState).toEqual({});
  });

  it("uses policy only for material cash contention and selects the stated expense/debt outcome", () => {
    const funding = createFundingPolicy({ id: fundingPolicyId("household:contention-outcomes"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const expenseInput: VerticalSlice2Input = { ...cashFlow, incomes: [], expenses: [{ id: ids.expense, ownerId: ids.household, paymentAccountId: ids.cash, payableLiabilityId: ids.payable, baseMonthlyAmount: money("100"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), inflationBaseAt: instant("2026-01-15T00:00:00.000Z"), fundingPolicy: funding, settlementPriority: 1, primitiveIds: { indexGrowth: primitive("101"), inflationLink: primitive("102"), recurrence: primitive("103") } }] };
    const loan: FixedAmortizingLoan = { id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 1, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, fundingPolicy: funding, settlementPriority: 1, extraPrincipalPayments: [], postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive("104"), amortization: primitive("105"), accrual: primitive("106") } };
    const run = (cash: string, contentionPolicy?: { readonly id: string; readonly version: "1"; readonly rules: readonly { readonly before: "cash_expense_settlement" | "liability_required_service"; readonly after: "cash_expense_settlement" | "liability_required_service" }[] }, selectedLoan: FixedAmortizingLoan = loan) => runCompiledHouseholdProjection({ runContext: context(), compiled: { ...compiled(), cashFlowInput: expenseInput, reconciledOpeningState: createAuthoritativeState({ ...opening(), accounts: { [ids.cash]: { id: ids.cash, kind: "checking", ownerId: ids.owner, cash: money(cash) } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") }, [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("100") }, [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") } } }), liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [selectedLoan] }, ...(contentionPolicy === undefined ? {} : { contentionPolicy }) } });
    const ample = run("200");
    expect(ample.status, JSON.stringify(ample.diagnostics)).toBe("completed");
    expect(ample.periods[0]!.liability!.principalReduction.equals(money("100"))).toBe(true);
    const unresolved = run("100");
    expect(unresolved.status).toBe("incomplete");
    expect(unresolved.diagnostics.some((issue) => issue.code === "HOUSEHOLD_CONTENTION_UNRESOLVED")).toBe(true);
    expect(unresolved.periods).toHaveLength(0);
    const expenseFirst = run("100", { id: "expense-first", version: "1", rules: [{ before: "cash_expense_settlement", after: "liability_required_service" }] });
    expect(expenseFirst.status, JSON.stringify(expenseFirst.diagnostics)).toBe("completed");
    expect(expenseFirst.periods[0]!.liability!.principalReduction.isZero()).toBe(true);
    const debtFirst = run("100", { id: "debt-first", version: "1", rules: [{ before: "liability_required_service", after: "cash_expense_settlement" }] });
    expect(debtFirst.status, JSON.stringify(debtFirst.diagnostics)).toBe("completed");
    expect(debtFirst.periods[0]!.liability!.principalReduction.equals(money("100"))).toBe(true);
    const threeWay = run("100", undefined, { ...loan, extraPrincipalPayments: [{ id: domainId("extra-principal-payment", "93000000-0000-4000-8000-000000000022"), scheduledAt: instant("2026-01-15T00:00:00.000Z"), amount: money("10"), fundingPolicy: funding, primitiveInstanceId: primitive("111") }] });
    expect(threeWay.status).toBe("incomplete");
    const contention = threeWay.diagnostics.find((issue) => issue.code === "HOUSEHOLD_CONTENTION_UNRESOLVED");
    expect(contention?.relatedIds?.filter((id) => id.startsWith("liability-") || id.startsWith("cash-")).length).toBeGreaterThanOrEqual(3);
  });

  it("executes one required service and one dependent extra-principal payment exactly once", () => {
    const funding = createFundingPolicy({ id: fundingPolicyId("household:extra-once"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(), cashFlowInput: undefined,
      reconciledOpeningState: createAuthoritativeState({ ...opening(), accounts: { [ids.cash]: { id: ids.cash, kind: "checking", ownerId: ids.owner, cash: money("200") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") }, [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("200") }, [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") } } }),
      liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [{ id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, originalPrincipal: money("200"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 2, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, fundingPolicy: funding, settlementPriority: 1, extraPrincipalPayments: [{ id: domainId("extra-principal-payment", "93000000-0000-4000-8000-000000000021"), scheduledAt: instant("2026-01-15T00:00:00.000Z"), amount: money("10"), fundingPolicy: funding, primitiveInstanceId: primitive("107") }], postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive("108"), amortization: primitive("109"), accrual: primitive("110") } }] },
    } });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    const rows = result.periods[0]!.liability!.liabilities;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scheduledPrincipalPaid.equals(money("100"))).toBe(true);
    expect(rows[0]!.extraPrincipalPaid.equals(money("10"))).toBe(true);
    expect(result.state.liabilities[ids.missingPrincipal]!.balance.equals(money("90"))).toBe(true);
    expect(result.state.identities.generatedOccurrenceKeys).toHaveLength(2);
  });

  it("does not let an end-of-period investment transfer fund earlier debt service", () => {
    const funding = createFundingPolicy({ id: fundingPolicyId("household:eop"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(), cashFlowInput: undefined,
      reconciledOpeningState: createAuthoritativeState({ ...opening(), accounts: { [ids.cash]: { id: ids.cash, kind: "checking", ownerId: ids.owner, cash: money("0") }, [ids.savings]: { id: ids.savings, kind: "savings", ownerId: ids.owner, cash: money("100") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") }, [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("100") }, [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") } } }),
      investmentInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, valuationAccountingPolicy: "economic_only", ruleCatalog: [], purchases: [], fees: [], returns: [], transfers: [{ id: ids.transfer, sourceAccountId: ids.savings, destinationAccountId: ids.cash, amount: money("100"), eligibilitySchedule: { kind: "explicit_instants", instants: [instant("2026-01-05T00:00:00.000Z")] }, executionTiming: "end_of_period", order: 1, schedulePrimitiveId: primitive("97") }] },
      liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [{ id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 1, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: instant("2026-01-05T00:00:00.000Z"), invalidDayPolicy: "skip" }, fundingPolicy: funding, settlementPriority: 1, extraPrincipalPayments: [], postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive("98"), amortization: primitive("99"), accrual: primitive("100") } }] },
    } });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.liability!.principalReduction.isZero()).toBe(true);
    expect(result.state.accounts[ids.cash]!.cash.equals(money("100"))).toBe(true);
    expect(result.state.liabilities[ids.missingPrincipal]!.balance.equals(money("100"))).toBe(true);
  });

  it("commits a staged termination runtime even when it suppresses every occurrence", () => {
    const termination = domainId("event", "93000000-0000-4000-8000-000000000013");
    const terminationPrimitive = primitive("30");
    const input: VerticalSlice2Input = {
      ...cashFlow,
      incomes: [{ ...cashFlow.incomes[0]!, terminationEventId: termination, primitiveIds: { ...cashFlow.incomes[0]!.primitiveIds, termination: terminationPrimitive } }],
      events: [{ id: termination, targetId: ids.income, kind: "termination", effectiveAt: start }],
    };
    const unrelated = primitive("23");
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: {
      ...compiled(),
      cashFlowInput: input,
      reconciledPrimitiveState: createPrimitiveRuntimeStateStore({
        [unrelated]: { primitiveId: "P23", state: { evaluations: 1, lastClosingValue: money("1") } },
      }),
    } });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.transactions).toHaveLength(0);
    expect(result.primitiveState[terminationPrimitive]?.primitiveId).toBe("P30");
    expect(result.primitiveState[unrelated]?.primitiveId).toBe("P23");
    expect(result.periods[0]!.traceRefs.some((ref) => ref.traceId.includes(`event:${termination}`))).toBe(true);
  });

  it("commits staged P23/P26 runtime only through executed valuations across periods", () => {
    const compounding = primitive("50");
    const markToMarket = primitive("51");
    const investmentInput = {
      householdId: ids.household,
      ownerId: ids.owner,
      baseCurrency: USD,
      valuationAccountingPolicy: "economic_only" as const,
      ruleCatalog: [],
      transfers: [],
      purchases: [],
      fees: [],
      returns: [{
        targetPositionId: ids.position,
        accountId: ids.cash,
        rate: Rate.fromDecimal("0.1", rateConvention.periodic(ratePeriod("1", "calendar_month"))),
        returnBasis: { kind: "periodic" as const, period: ratePeriod("1", "calendar_month") },
        timing: "end_of_period_on_opening_quantity" as const,
        priceRounding: RoundingPolicy.currency(2, "half_up"),
        primitiveIds: { compounding, markToMarket },
      }],
    };
    const standalone = runVerticalSlice3({
      runContext: context(2), openingState: opening(), input: investmentInput, months: 2,
    });
    const household = runCompiledHouseholdProjection({
      runContext: context(2),
      compiled: { ...compiled(), cashFlowInput: undefined, investmentInput, executionMonths: 2 },
    });
    expect(standalone.status, JSON.stringify(standalone.diagnostics)).toBe("completed");
    expect(household.status, JSON.stringify(household.diagnostics)).toBe("completed");
    expect(household.periods).toHaveLength(2);
    expect(household.state).toEqual(standalone.state);
    expect(household.primitiveState[compounding]).toEqual(standalone.primitiveState[compounding]);
    expect(household.primitiveState[markToMarket]).toEqual(standalone.primitiveState[markToMarket]);
    expect(household.primitiveState[compounding]?.state).toMatchObject({ evaluations: 2 });
    expect(household.primitiveState[markToMarket]?.state).toMatchObject({ evaluations: 2 });
    expect(household.periods.every((period) => period.traceRefs.some((ref) => ref.traceId.includes("valuation")))).toBe(true);
  });

  it("canonicalizes irrelevant input ordering but fingerprints contention policy identity", () => {
    const base = compiled();
    const forward = runCompiledHouseholdProjection({ runContext: context(), compiled: base });
    const reordered = runCompiledHouseholdProjection({ runContext: context(), compiled: { ...base, cashFlowInput: { ...cashFlow, incomes: [...cashFlow.incomes].reverse(), expenses: [...cashFlow.expenses].reverse(), events: [...cashFlow.events].reverse() } } });
    expect(reordered.state).toEqual(forward.state);
    expect(reordered.runMetadata.inputFingerprint).toBe(forward.runMetadata.inputFingerprint);
    const changedPolicy = runCompiledHouseholdProjection({ runContext: context(), compiled: { ...base, contentionPolicy: { id: "different-policy", version: "1", rules: [] } } });
    expect(changedPolicy.runMetadata.inputFingerprint).not.toBe(forward.runMetadata.inputFingerprint);
  });
});
