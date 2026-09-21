import { describe, expect, it } from "vitest";
import type { CompiledHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { domainId } from "../src/identity/index.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { runHouseholdProjection } from "../src/simulation/householdProjection.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant } from "../src/time/index.js";
import { Currency, Quantity, SHARE, money } from "../src/values/index.js";

const householdId = domainId("household", "91000000-0000-4000-8000-000000000001");
const ownerId = domainId("person", "91000000-0000-4000-8000-000000000002");
const accountId = domainId("account", "91000000-0000-4000-8000-000000000003");
const positionId = domainId("position", "91000000-0000-4000-8000-000000000004");
const payableId = domainId("liability", "91000000-0000-4000-8000-000000000005");
const scenario = "91000000-0000-4000-8000-000000000006";

const compiled = (): CompiledHouseholdProjection => ({
  cashFlowInput: { householdId, ownerId, cashAccountId: accountId, expensePayableLiabilityId: payableId, baseCurrency: Currency.of("USD"), incomes: [], expenses: [], events: [], sameInstantCashFlowOrder: "income_before_expense" },
  investmentInput: { householdId, ownerId, baseCurrency: Currency.of("USD"), valuationAccountingPolicy: "economic_only", ruleCatalog: [], transfers: [], purchases: [], fees: [], returns: [] },
  liabilityInput: { householdId, ownerId, baseCurrency: Currency.of("USD"), loans: [] },
  openingState: createAuthoritativeState({
    accounts: { [accountId]: { id: accountId, kind: "brokerage", ownerId, cash: money("100") } },
    positions: { [positionId]: { id: positionId, accountId, quantity: Quantity.parse("5", SHARE), price: money("10"), carryingValue: money("50") } },
    liabilities: { [payableId]: { id: payableId, balance: money("20") } },
  }),
  primitiveState: createPrimitiveRuntimeStateStore(), scenarioIdentity: scenario, executionMonths: 1, diagnostics: [],
});

describe("reconciled household projection", () => {
  it("commits one shared period and counts account cash plus position value once", () => {
    const result = runHouseholdProjection({ compiled: compiled(), runContext: createRunContext({
      runId: runId("91000000-0000-4000-8000-000000000007"), scenarioId: scenarioId(scenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: Currency.of("USD"),
    }) });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]!.cash.equals(money("100"))).toBe(true);
    expect(result.periods[0]!.investmentValue.equals(money("50"))).toBe(true);
    expect(result.periods[0]!.assets.equals(money("150"))).toBe(true);
    expect(result.periods[0]!.liabilities.equals(money("20"))).toBe(true);
    expect(result.periods[0]!.netWorth.equals(money("130"))).toBe(true);
    expect(result.reachedThrough).toBe("2026-02-01T00:00:00.000Z");
  });
});
