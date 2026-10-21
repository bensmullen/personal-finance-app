import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { publisher, registerPublisher } from "./scenario.js";

const path = process.env.PFM_CARD_BANK_PAYLOAD;
if (!path) throw new Error("CARD_BANK_PAYLOAD_MISSING");
const { artifact, selected, sources } = JSON.parse(readFileSync(path, "utf8"));
// Fixed synthetic issuer documents are reconstructed independently here. No
// receipt, journal, raw source or source callback is loaded from the artifact.
if (sources !== false) registerPublisher();
else publisher.read = () => undefined;
try {
  const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
} catch (error) {
  if (sources !== false) throw error;
  process.stdout.write(JSON.stringify({ rejected: error instanceof Error && error.message.includes("HOUSEHOLD_REPLAY_BASIS_MISMATCH") }));
}
