import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { registerMockAuthorities } from "./scenario.js";
import { loadIndependentReplaySources } from "./replayScenario.js";

const path = process.env.PFM_SHARED_RECEIPTS_PAYLOAD;
if (!path) throw new Error("SHARED_RECEIPTS_PAYLOAD_MISSING");
const { artifact, selected, sources } = JSON.parse(readFileSync(path, "utf8"));
if (sources === true) { registerMockAuthorities(); loadIndependentReplaySources(); }
try {
  const restored = restorePortableHouseholdReplayArtifact(artifact);
  const result = replayHouseholdForecastWindow(restored, selected);
  process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
} catch (error) {
  if (sources === true) throw error;
  process.stdout.write(JSON.stringify({ rejected: error instanceof Error && error.message.includes("HOUSEHOLD_REPLAY_BASIS_MISMATCH") }));
}
