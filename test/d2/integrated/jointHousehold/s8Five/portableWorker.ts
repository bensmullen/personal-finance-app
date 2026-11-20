import { readFileSync } from "node:fs";
import type { Period } from "../../../../../src/time/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { replayHouseholdForecastWindow } from "../../../../../src/simulation/householdExecution.js";
import { restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { healthFault } from "./healthAndRetirement.js";
import { household, installPublishers } from "./scenario.js";

const [, , path, mode] = process.argv;
if (!path || mode !== "available" && mode !== "withdrawn") throw new Error("Expected payload and source condition");
// Rebuild independent issuer books before decoding any caller-provided data.
installPublishers();
household(12);
if (mode === "withdrawn") healthFault.premium = true;
const { artifact, windows } = JSON.parse(readFileSync(path, "utf8")) as { artifact: unknown; windows: readonly Period[] };
try {
  const restored = restorePortableHouseholdReplayArtifact(artifact);
  if (mode !== "available") throw new Error("Withdrawn source was accepted");
  process.stdout.write(JSON.stringify(windows.map(window => {
    const replay = replayHouseholdForecastWindow(restored, window);
    return canonicalSerialize({ state: replay.state, periods: replay.periods });
  })));
} catch (error) {
  if (mode !== "withdrawn" || !(error instanceof Error) || !error.message.includes("HOUSEHOLD_REPLAY_BASIS_MISMATCH")) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
