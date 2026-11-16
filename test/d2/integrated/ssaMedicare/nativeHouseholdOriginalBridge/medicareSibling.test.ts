import { beforeEach, expect, it } from "vitest";
import { attachSsaMedicare } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { attachMedicareBank } from "../../../../../src/simulation/d2/integration/medicareBank/index.js";
import { compileHouseholdKernel, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { createAuthoritativeState } from "../../../../../src/state/index.js";
import { money, USD } from "../../../../../src/values/index.js";
import { bank, confirmations, household, input as medicareInput, payable, person, request } from "../../medicareBank/scenario.js";
import { fixture, ids, input } from "../scenario.js";
import { publish, registerTestOriginals, resetNativeSources } from "./sources.js";

registerTestOriginals();
beforeEach(resetNativeSources);

function relabel<T>(input: T): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return value.replaceAll(household, ids.household).replaceAll(person(), ids.person);
    if (Array.isArray(value)) return value.map(visit);
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)])) : value;
  };
  return visit(input) as T;
}

it("keeps a standalone BANK premium usable and refuses a second collection for that member and month", () => {
  const { context } = fixture();
  const paymentAccountId = bank(), payableId = payable("part_b");
  const state = createAuthoritativeState({ accounts: {
    [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") },
    [paymentAccountId]: { id: paymentAccountId, kind: "checking", ownerId: ids.person, cash: money("2000") },
  }, liabilities: { [payableId]: { id: payableId, balance: money("0") } } });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: {},
    scenarioIdentity: context.scenarioId, scenarioBindings: {}, executionMonths: 1, cashFlowInput: {
      householdId: ids.household, ownerId: ids.person, baseCurrency: USD, cashAccountId: paymentAccountId,
      expensePayableLiabilityId: payableId, incomes: [], expenses: [], events: [],
    } }, context.simulationStart);
  const raw = request("2026-06", ["part_b"]), config = {
    ...medicareInput(raw, kernel), request: relabel(raw), confirmed: relabel(confirmations(raw)),
  };
  const standalone = attachMedicareBank(config);
  expect(standalone.netCashCoverage, JSON.stringify(standalone.diagnostics)).toBe("complete");
  const result = runHouseholdKernel({ kernel: standalone.kernel, runContext: context });
  expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
  expect(result.state.accounts[paymentAccountId]!.cash.equals(money("1920"))).toBe(true);
  expect(restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(result)).periods).toEqual(result.periods);
  const addressedSsa = { ...input([]), nativePayments: [publish("2026-06", ["part_b"])] };
  expect(() => attachSsaMedicare(standalone.kernel, addressedSsa)).toThrow("cannot also execute");

  const reverse = attachMedicareBank({ ...config, kernel: attachSsaMedicare(kernel, addressedSsa) });
  if (reverse.netCashCoverage === "complete") {
    const refused = runHouseholdKernel({ kernel: reverse.kernel, runContext: context });
    expect(refused.periods).toHaveLength(0);
    expect(refused.state.accounts[paymentAccountId]!.cash.equals(money("2000"))).toBe(true);
    expect(refused.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(refused.state.ssaMedicarePayments).toBeUndefined();
  } else {
    expect(reverse.diagnostics.some(diagnostic => diagnostic.diagnosticCode === "MEDICARE_DOUBLE_ROUTE")).toBe(true);
  }
});
