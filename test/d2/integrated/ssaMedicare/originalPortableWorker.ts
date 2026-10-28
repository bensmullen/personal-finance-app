import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { control, register } from "./originalScenario.js";
const unavailable = process.env.PFM_ORIGINALS_UNAVAILABLE;
if (unavailable !== "unregistered") register();
control.missing = unavailable === "missing";
const path = process.env.PFM_SSA_MEDICARE_TEST_PAYLOAD;
if (!path) throw new Error("ORIGINAL_TEST_PAYLOAD_MISSING");
const { artifact, selected } = JSON.parse(readFileSync(path, "utf8"));
if (unavailable !== "available") {
  let refused = false;
  try { restorePortableHouseholdReplayArtifact(artifact); } catch { refused = true; }
  if (!refused) throw new Error("UNAVAILABLE_ORIGINAL_ADMITTED");
  process.stdout.write(JSON.stringify({ refused }));
} else {
  const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
}
