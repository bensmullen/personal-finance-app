import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { ids, install } from "./scenario.js";

const path = process.env.PFM_STAGE_C_PAYLOAD;
if (!path) throw new Error("STAGE_C_PAYLOAD_MISSING");
const { artifact, selected, sources } = JSON.parse(readFileSync(path, "utf8"));
if (sources) install(); // Reconstruct originals independently; never seed from the payload.
try {
  const restored = restorePortableHouseholdReplayArtifact(artifact), result = replayHouseholdForecastWindow(restored, selected);
  process.stdout.write(JSON.stringify({ bank: result.state.accounts[ids.bank]!.cash.amount.toString(), ira: result.state.accounts[ids.ira]!.cash.amount.toString() }));
} catch (error) {
  if (sources) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
