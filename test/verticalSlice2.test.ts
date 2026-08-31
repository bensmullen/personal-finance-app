import { describe, expect, it } from "vitest";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId, generatedOccurrenceKey, type GeneratedOccurrenceKey } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Money, Rate, USD, money, rateConvention } from "../src/values/index.js";
import { runVerticalSlice2, type VerticalSlice2Input } from "../src/verticalSlice2.js";

const ids = {
  household: domainId("household", "10000000-0000-4000-8000-000000000001"),
  person: domainId("person", "10000000-0000-4000-8000-000000000002"),
  cash: domainId("account", "10000000-0000-4000-8000-000000000003"),
  payable: domainId("liability", "10000000-0000-4000-8000-000000000004"),
  salary: domainId("income", "10000000-0000-4000-8000-000000000005"),
  rent: domainId("expense", "10000000-0000-4000-8000-000000000006"),
  club: domainId("expense", "10000000-0000-4000-8000-000000000007"),
  clubStart: domainId("event", "10000000-0000-4000-8000-000000000008"),
  clubStop: domainId("event", "10000000-0000-4000-8000-000000000009"),
};

const primitive = (suffix: number) => domainId("primitive-instance", `20000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`);
const start = instant("2026-01-01T00:00:00.000Z");
const anchor = instant("2026-01-15T00:00:00.000Z");

const context = (months: number, run = "30000000-0000-4000-8000-000000000001") => {
  const periods = utcMonthlyPeriods(start, months);
  return createRunContext({
    runId: runId(run),
    scenarioId: scenarioId("30000000-0000-4000-8000-000000000002"),
    asOf: instant("2025-12-31T00:00:00.000Z"),
    dataCutoff: instant("2025-12-31T00:00:00.000Z"),
    simulationStart: start,
    simulationEnd: periods[periods.length - 1]!.end,
    baseCurrency: USD,
  });
};

const funding = createFundingPolicy({
  id: fundingPolicyId("funding:vs2:checking"),
  orderedSources: [{ kind: "cash_account", accountId: ids.cash }],
  allowPartial: false,
  insufficientFundsBehavior: "unfunded",
});

const input = (salaryGrowth = "0", inflation = "0"): VerticalSlice2Input => ({
  householdId: ids.household,
  ownerId: ids.person,
  cashAccountId: ids.cash,
  expensePayableLiabilityId: ids.payable,
  baseCurrency: USD,
  incomes: [{
    id: ids.salary,
    ownerId: ids.person,
    depositAccountId: ids.cash,
    baseMonthlyAmount: money("1000"),
    start,
    recurrence: { kind: "utc_monthly", anchor, invalidDayPolicy: "skip" },
    growthRate: Rate.fromDecimal(salaryGrowth, rateConvention.effectiveAnnual()),
    growthBaseAt: anchor,
    primitiveIds: { growth: primitive(1), recurrence: primitive(2) },
  }],
  expenses: [{
    id: ids.rent,
    ownerId: ids.household,
    paymentAccountId: ids.cash,
    payableLiabilityId: ids.payable,
    baseMonthlyAmount: money("100"),
    start,
    recurrence: { kind: "utc_monthly", anchor, invalidDayPolicy: "skip" },
    inflationRate: Rate.fromDecimal(inflation, rateConvention.effectiveAnnual()),
    inflationBaseAt: anchor,
    fundingPolicy: funding,
    primitiveIds: { indexGrowth: primitive(3), inflationLink: primitive(4), recurrence: primitive(5) },
  }, {
    id: ids.club,
    ownerId: ids.household,
    paymentAccountId: ids.cash,
    payableLiabilityId: ids.payable,
    baseMonthlyAmount: money("50"),
    start,
    recurrence: { kind: "utc_monthly", anchor, invalidDayPolicy: "skip" },
    inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
    inflationBaseAt: anchor,
    fundingPolicy: funding,
    activationEventId: ids.clubStart,
    terminationEventId: ids.clubStop,
    primitiveIds: { indexGrowth: primitive(6), inflationLink: primitive(7), recurrence: primitive(8), activation: primitive(9), termination: primitive(10) },
  }],
  events: [
    { id: ids.clubStop, targetId: ids.club, kind: "termination", effectiveAt: instant("2026-06-15T00:00:00.000Z") },
    { id: ids.clubStart, targetId: ids.club, kind: "activation", effectiveAt: instant("2026-03-15T00:00:00.000Z") },
  ],
});

const opening = (cash = "0", generatedOccurrenceKeys: readonly GeneratedOccurrenceKey[] = []) => createAuthoritativeState({
  accounts: { [ids.cash]: { id: ids.cash, kind: "checking", ownerId: ids.person, cash: money(cash) } },
  liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } },
  identities: { generatedOccurrenceKeys },
});

describe("Vertical Slice 2 growing household cash flow", () => {
  it("composes recurring income, inflation-linked expenses, and half-open events", () => {
    const result = runVerticalSlice2({ runContext: context(13), openingState: opening(), input: input("0.05", "0.02"), months: 13 });
    expect(result.status).toBe("completed");
    expect(result.periods).toHaveLength(13);
    expect(result.periods[0]!.recurringIncomeRecognized.equals(money("1000"))).toBe(true);
    expect(result.periods[12]!.recurringIncomeRecognized.equals(money("1050"))).toBe(true);
    expect(result.periods[12]!.recurringExpenseRecognized.equals(money("102"))).toBe(true);
    expect(result.periods[1]!.expenseOccurrences.map((item) => item.streamId)).not.toContain(ids.club);
    expect(result.periods[2]!.expenseOccurrences.map((item) => item.streamId)).toContain(ids.club);
    expect(result.periods[5]!.expenseOccurrences.map((item) => item.streamId)).not.toContain(ids.club);
    expect(result.periods.flatMap((item) => item.incomeOccurrences).every((item) => item.provenance.factKind === "model_generated")).toBe(true);
    expect(result.periods[12]!.traceRefs.some((ref) => ref.traceId.includes("salary-growth"))).toBe(true);
    expect(result.periods[12]!.traceRefs.some((ref) => ref.traceId.includes("inflation-linked"))).toBe(true);
  });

  it("keeps liquidity shortfall modeled, payable outstanding, and cash non-negative", () => {
    const stressed = input();
    const noIncome = { ...stressed, incomes: [{ ...stressed.incomes[0]!, baseMonthlyAmount: Money.zero(USD) }] };
    const result = runVerticalSlice2({ runContext: context(1), openingState: opening(), input: noIncome, months: 1 });
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.endingCash.equals(money("0"))).toBe(true);
    expect(result.periods[0]!.outstandingExpenseObligations.equals(money("100"))).toBe(true);
    expect(result.periods[0]!.liquidityShortfalls).toHaveLength(1);
    expect(result.periods[0]!.expenseCashSettlement.equals(money("0"))).toBe(true);
  });

  it("enforces exact end boundaries and event input-order independence", () => {
    const bounded = input();
    const endAtOccurrence = { ...bounded, incomes: [{ ...bounded.incomes[0]!, end: instant("2026-03-15T00:00:00.000Z") }] };
    const ended = runVerticalSlice2({ runContext: context(3), openingState: opening(), input: endAtOccurrence, months: 3 });
    expect(ended.periods.map((period) => period.recurringIncomeRecognized.amount.toString())).toEqual(["1000", "1000", "0"]);

    const forward = runVerticalSlice2({ runContext: context(6), openingState: opening(), input: bounded, months: 6 });
    const reversed = runVerticalSlice2({ runContext: context(6, "30000000-0000-4000-8000-000000000004"), openingState: opening(), input: { ...bounded, events: [...bounded.events].reverse() }, months: 6 });
    expect(forward.periods.map((period) => period.endingCash)).toEqual(reversed.periods.map((period) => period.endingCash));
  });

  it("rolls back tentative event state and financial mutations on a later hard failure", () => {
    const model = input();
    const replay = generatedOccurrenceKey({ scenarioId: context(4).scenarioId, primitiveInstanceId: primitive(8), scheduledAt: instant("2026-03-15T00:00:00.000Z"), semanticEffectType: "expense-recognition", economicTargetId: ids.club });
    const result = runVerticalSlice2({ runContext: context(4), openingState: opening("0", [replay]), input: { ...model, expenses: [model.expenses[1]!] }, months: 4 });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(2);
    expect(result.state.accounts[ids.cash]!.cash.equals(money("2000"))).toBe(true);
    expect(result.primitiveState[primitive(9)]).toMatchObject({ primitiveId: "P27", state: { activated: false } });
    expect(result.state.identities.generatedOccurrenceKeys.some((key) => key.includes(primitive(9)))).toBe(false);
  });

  it("completes a deterministic 360-month golden horizon without duplicate occurrences", () => {
    const first = runVerticalSlice2({ runContext: context(360), openingState: opening(), input: input(), months: 360 });
    const second = runVerticalSlice2({ runContext: context(360, "30000000-0000-4000-8000-000000000003"), openingState: opening(), input: input(), months: 360 });
    expect(first.status).toBe("completed");
    expect(first.periods).toHaveLength(360);
    expect(first.periods[0]!.endingCash.equals(money("900"))).toBe(true);
    expect(first.periods[11]!.endingCash.equals(money("10650"))).toBe(true);
    expect(first.periods[359]!.endingCash.equals(money("323850"))).toBe(true);
    expect(first.state.liabilities[ids.payable]!.balance.equals(money("0"))).toBe(true);
    const occurrenceIds = first.periods.flatMap((period) => [...period.incomeOccurrences, ...period.expenseOccurrences].map((item) => item.occurrenceId));
    expect(new Set(occurrenceIds).size).toBe(occurrenceIds.length);
    expect(first.periods.map((item) => ({ income: item.recurringIncomeRecognized, expense: item.recurringExpenseRecognized, cash: item.endingCash })))
      .toEqual(second.periods.map((item) => ({ income: item.recurringIncomeRecognized, expense: item.recurringExpenseRecognized, cash: item.endingCash })));
    expect(first.displayInputs).toMatchObject({ generatedForecastFactKind: "model_generated" });
  }, 15_000);
});
