import { expect, it } from "vitest";
import { attachRetirementCash, evaluateFundedRmdSatisfaction } from "../../../../../src/simulation/d2/integration/retirementCash/index.js";
import { runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { money } from "../../../../../src/values/index.js";
import { funded, sources } from "../../retirementCash/fundedScenario.js";
import { fixture, ids } from "../../retirementCash/scenario.js";

it("admits a single funded distribution and account-year J1, then rejects a warm release after publisher withdrawal", () => {
  const { kernel: base, context } = fixture();
  const plan = funded(fixture(), "348-funded-release");
  const kernel = attachRetirementCash(base, plan.cash).kernel;
  const result = runHouseholdKernel({ kernel, runContext: context });
  expect(result.periods).toHaveLength(1);
  expect(result.state.accounts[ids.ira]!.cash.equals(money("500"))).toBe(true);
  expect(result.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
  expect(result.periods[0]!.netWorth.equals(money("1200"))).toBe(true);
  expect(result.outputCapabilities?.retirementTax?.status).toBe("incomplete");
  expect(Object.values(result.state.retirementDistributionAllocations ?? {})).toHaveLength(1);
  const satisfaction = evaluateFundedRmdSatisfaction(plan.reference, result.state, context, context.simulationEnd);
  expect(satisfaction.annual?.obligations).toHaveLength(1);
  expect(satisfaction.annual?.obligations[0]?.satisfied.equals(money("500"))).toBe(true);
  expect(satisfaction.annual?.obligations[0]?.remaining.equals(money("200"))).toBe(true);

  const artifact = createPortableHouseholdReplayArtifact(result);
  expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(result.periods);
  expect(() => restorePortableHouseholdReplayArtifact(artifact, {
    now: () => 0, record: () => { sources.delete(plan.raw.sourceId); },
  })).toThrow(/HOUSEHOLD_REPLAY_BASIS_MISMATCH/);
  expect(result.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
});
