import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { documents, publish, registerPublisher } from "./scenario.js";
const path = process.env.PFM_HELOC_SERVICE_PAYLOAD;
if (!path) throw new Error("HELOC_SERVICE_PAYLOAD_MISSING");
const { artifact, selected, sources } = JSON.parse(readFileSync(path, "utf8"));
// Reconstruct synthetic originals independently, never from serialized receipts.
if (sources) { publish(documents(13, true)); registerPublisher(); }
try {
  const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
} catch (error) {
  if (sources) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
