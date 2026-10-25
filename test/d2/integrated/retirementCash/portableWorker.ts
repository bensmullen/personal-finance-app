// A new process explicitly imports the opt-in participant's registered codec.
// No shared replay composition file is modified for this scoped integration.
import "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { attachRetirementCash, evaluateFundedRmdSatisfaction } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { readRetirementRawSource, qualifyRetirementRawSource } from "../../../../src/simulation/d2/integration/retirementCash/source.js";
import { funded, sources } from "./fundedScenario.js";
import { fixture } from "./scenario.js";
const path = process.env.PFM_RETIREMENT_CASH_TEST_PAYLOAD;
if (!path) throw new Error("RETIREMENT_CASH_TEST_PAYLOAD_MISSING");
const { artifact, selected, fundedPlan, sourceMode = "present" } = JSON.parse(readFileSync(path, "utf8"));
// Reconstruct the synthetic independent publisher, never from artifact bytes.
const f = fundedPlan ? fixture(fundedPlan.months) : undefined;
const plan = f && funded(f, fundedPlan.label, fundedPlan.amounts);
const newKernel = plan && attachRetirementCash(f!.kernel, plan.cash).kernel;
let sourceEvidence;
let newPosting;
if (fundedPlan) {
  if (sourceMode === "absent") sources.delete(plan!.raw.sourceId);
  if (sourceMode === "tampered") sources.set(plan!.raw.sourceId, { ...plan!.raw,
    availability: plan!.raw.availability.map(a => ({ ...a, knownAt: instant("2099-01-01T00:00:00.000Z") })) });
  const raw = readRetirementRawSource(plan!.reference, f!.context);
  const qualification = raw && qualifyRetirementRawSource(raw, raw.cash.withdrawals.requests[0]!.operationId, f!.context);
  sourceEvidence = { present: !!raw, qualification: qualification?.status ?? "unavailable" };
  if (sourceMode === "present" && (!raw || qualification?.status !== "qualified"))
    throw new Error("RETIREMENT_TEST_INDEPENDENT_PUBLISHER_NOT_QUALIFIED");
  if (sourceMode !== "present") {
    const rejected = runHouseholdKernel({ kernel: newKernel!, runContext: f!.context });
    newPosting = { periods: rejected.periods.length, state: canonicalSerialize(rejected.state) };
  }
}
const restored = restorePortableHouseholdReplayArtifact(artifact);
const result = replayHouseholdForecastWindow(restored, selected);
const twice = replayHouseholdForecastWindow(restored, selected);
if (canonicalSerialize(result.state) !== canonicalSerialize(twice.state) || canonicalSerialize(result.periods) !== canonicalSerialize(twice.periods))
  throw new Error("RETIREMENT_TEST_REPLAY_CHANGED");
const satisfaction = plan && evaluateFundedRmdSatisfaction(plan.reference, result.state, f!.context, f!.context.simulationEnd);
process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods),
  ...(satisfaction ? { sourceEvidence, newPosting, satisfaction: { coverage: satisfaction.coverage, reason: satisfaction.reason ?? null,
    satisfied: satisfaction.annual?.obligations.map(o => canonicalSerialize(o.satisfied)) ?? null } } : {}) }));
