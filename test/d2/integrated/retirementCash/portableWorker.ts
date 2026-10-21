// A new process explicitly imports the opt-in participant's registered codec.
// No shared replay composition file is modified for this scoped integration.
import "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { fixture } from "./scenario.js";
const path = process.env.PFM_RETIREMENT_CASH_TEST_PAYLOAD;
if (!path) throw new Error("RETIREMENT_CASH_TEST_PAYLOAD_MISSING");
const { artifact, selected, fundedPlan } = JSON.parse(readFileSync(path, "utf8"));
// Reconstruct the synthetic independent publisher, never from artifact bytes.
if (fundedPlan) {
  const { funded } = await import("./fundedScenario.js");
  funded(fixture(fundedPlan.months), fundedPlan.label, fundedPlan.amounts);
}
const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
