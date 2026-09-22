import { describe, expect, it } from "vitest";
import type { CompiledHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { domainId } from "../src/identity/index.js";
import { runCompiledHouseholdProjection } from "../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import type { VerticalSlice2Input } from "../src/simulation/verticalSlice2.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant } from "../src/time/index.js";
import { Quantity, Rate, SHARE, USD, money, rateConvention } from "../src/values/index.js";

const ids = {
  household: domainId("household", "93000000-0000-4000-8000-000000000001"), owner: domainId("person", "93000000-0000-4000-8000-000000000002"),
  cash: domainId("account", "93000000-0000-4000-8000-000000000003"), payable: domainId("liability", "93000000-0000-4000-8000-000000000004"),
  income: domainId("income", "93000000-0000-4000-8000-000000000005"), position: domainId("position", "93000000-0000-4000-8000-000000000006"),
  standaloneAsset: "93000000-0000-4000-8000-000000000012",
  missingPrincipal: domainId("liability", "93000000-0000-4000-8000-000000000009"), missingInterest: domainId("liability", "93000000-0000-4000-8000-000000000010"), loan: domainId("loan-contract", "93000000-0000-4000-8000-000000000011"),
};
const scenario = "93000000-0000-4000-8000-000000000007";
const start = instant("2026-01-01T00:00:00.000Z"); const end = instant("2026-02-01T00:00:00.000Z");
const primitive = (suffix: string) => domainId("primitive-instance", `93000000-0000-4000-8001-${suffix.padStart(12, "0")}`);
const cashFlow: VerticalSlice2Input = { householdId: ids.household, ownerId: ids.owner, cashAccountId: ids.cash, expensePayableLiabilityId: ids.payable, baseCurrency: USD, sameInstantCashFlowOrder: "income_before_expense", expenses: [], events: [], incomes: [{ id: ids.income, ownerId: ids.owner, depositAccountId: ids.cash, baseMonthlyAmount: money("100"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: instant("2026-01-15T00:00:00.000Z"), primitiveIds: { growth: primitive("1"), recurrence: primitive("2") } }] };
const opening = () => createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, kind: "brokerage", ownerId: ids.owner, cash: money("10") } }, positions: { [ids.position]: { id: ids.position, accountId: ids.cash, quantity: Quantity.parse("5", SHARE), price: money("10"), carryingValue: money("50") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } });
const context = () => createRunContext({ runId: runId("93000000-0000-4000-8000-000000000008"), scenarioId: scenarioId(scenario), asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: end, baseCurrency: USD });
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

  it("rolls back cash-flow and identities when a later slice fails", () => {
    const result = runCompiledHouseholdProjection({ runContext: context(), compiled: compiled(true) });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(0);
    expect(result.state.accounts[ids.cash]!.cash.equals(money("10"))).toBe(true);
    expect(result.state.identities.postedTransactionIds).toEqual([]);
    expect(result.primitiveState).toEqual({});
    expect(result.stoppedAt).toBe(start);
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
});
