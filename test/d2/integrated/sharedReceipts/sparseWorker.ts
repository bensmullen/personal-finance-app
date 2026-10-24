import { readFileSync } from "node:fs";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { mixedFixture, resetSourceCalls, sourceCalls } from "./sparseScenario.js";
import { sourceStatus } from "../../health/premiums/payrollPort/scenario.js";
const path = process.env.PFM_SPARSE_PAYLOAD;
if (!path) throw new Error("SPARSE_PAYLOAD_MISSING");
const { artifact, selected, count, principalOnly, growing, sources } = JSON.parse(readFileSync(path, "utf8"));
// Recreate independent employer/issuer/BANK originals from fixed fixtures in
// this process. Never populate any source store from artifact receipt bytes.
mixedFixture(count, principalOnly, growing);
sourceStatus.available = sources;
resetSourceCalls();
try {
  const restored = restorePortableHouseholdReplayArtifact(artifact);
  const calls = sourceCalls();
  const result = replayHouseholdForecastWindow(restored, selected);
  process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods), calls }));
} catch (error) {
  if (sources) throw error;
  process.stdout.write(JSON.stringify({ rejected: error instanceof Error && error.message.includes("BASIS_MISMATCH") }));
}
