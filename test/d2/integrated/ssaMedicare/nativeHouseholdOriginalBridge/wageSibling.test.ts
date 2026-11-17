import { beforeEach, expect, it } from "vitest";
import { attachSsaMedicare } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal } from "../../../../../src/simulation/d2/integration/householdWages/index.js";
import { compileHouseholdKernel, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import type { RecurringIncomeStream } from "../../../../../src/simulation/verticalSlice2.js";
import { createAuthoritativeState } from "../../../../../src/state/index.js";
import { money, USD } from "../../../../../src/values/index.js";
import { context as wageContext, control, document, ids as wageIds, reset as resetWages } from "../../householdBankIncome/scenario.js";
import { fixture, ids, input } from "../scenario.js";
import { publish, registerTestOriginals, resetNativeSources } from "./sources.js";

registerTestOriginals();
const publisherId = "synthetic:distinct-employer";
let original: HouseholdWageOriginal | undefined;
registerHouseholdWageOriginalProvider({ publisherId, readOriginals: ({ sourceId, context }) =>
  original && original.sourceId === sourceId ? { version: "household-wage-inventory/v1", publisherId, sourceId, context,
    checkedAt: context.asOf, completeThrough: context.dataCutoff, completeness: "complete", originals: [original] } : undefined,
});

beforeEach(() => { resetNativeSources(); resetWages(); original = undefined; });

function rehome(value: unknown, scenario: string): unknown {
  if (typeof value === "string") return value.replaceAll(wageIds.household, ids.household).replaceAll(wageIds.bob, ids.person)
    .replaceAll(wageIds.bank, ids.bank).replaceAll(wageContext().scenarioId, scenario);
  if (Array.isArray(value)) return value.map(item => rehome(item, scenario));
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rehome(item, scenario)])) : value;
}

it.each([false, true])("keeps independent same-member wage posting with withholding elected = %s", payroll => {
  control.payroll = payroll;
  const { context } = fixture(1, undefined, "2026-01");
  original = rehome(document(1), context.scenarioId) as HouseholdWageOriginal;
  const wage: RecurringIncomeStream = { ...original.stream, householdWageSource: {
    version: "household-wage-source/v1",
    bank: { publisherId: "synthetic:household-bank", sourceId: "bank-permission" },
    original: { version: "household-economic-original/v1", family: "wage", publisherId,
      sourceId: original.sourceId, revisionId: original.revisionId, digest: householdWageOriginalDigest(original) },
  } };
  const event = publish("2026-01", ["part_b"]);
  const state = createAuthoritativeState({
    accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") } },
    liabilities: { [wageIds.payable]: { id: wageIds.payable, balance: money("0") } },
  });
  const base = (incomes: readonly RecurringIncomeStream[]) => compileHouseholdKernel({
    reconciledOpeningState: state, reconciledPrimitiveState: {}, scenarioIdentity: context.scenarioId,
    executionMonths: 1, scenarioBindings: {}, cashFlowInput: {
      householdId: ids.household, ownerId: ids.person, cashAccountId: ids.bank, expensePayableLiabilityId: wageIds.payable,
      baseCurrency: USD, incomes, expenses: [], events: [],
    },
  }, context.simulationStart);
  const config = { ...input([]), nativePayments: [event] };
  expect(() => attachSsaMedicare(base([original!.stream]), config)).toThrow("Overlapping income");
  const kernel = attachSsaMedicare(base([wage]), config);
  const result = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
  expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
  expect(result.periods[0]!.transactions.map(transaction => transaction.type)).toEqual(["ssa_medicare_same_event", payroll ? "payroll_income" : "income"]);
  expect(result.state.accounts[ids.bank]!.cash.equals(money(payroll ? "3535.37" : "3545.37"))).toBe(true);
  const forecast = runHouseholdKernel({ kernel, runContext: context });
  expect(restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(forecast)).periods).toEqual(forecast.periods);
});
