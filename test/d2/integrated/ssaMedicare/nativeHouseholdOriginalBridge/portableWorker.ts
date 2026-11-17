import { readFileSync } from "node:fs";
import { replayHouseholdForecastWindow } from "../../../../../src/simulation/householdExecution.js";
import { restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { ids } from "../scenario.js";
import { faults, nativeFixture, registerTestOriginals } from "./sources.js";

const path = process.env.PFM_NATIVE_SSA_ARTIFACT;
if (!path) throw new Error("Missing portable artifact path");
const { artifact, selected } = JSON.parse(readFileSync(path, "utf8"));
const mode = process.env.PFM_NATIVE_SSA_SOURCES;
if (mode !== "unregistered") {
  registerTestOriginals();
  const { events } = nativeFixture(13);
  if (mode === "withdrawn") faults.unavailable = events[12]!.eventId;
}
if (mode === "available") {
  const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  process.stdout.write(JSON.stringify({ cash: canonicalSerialize(result.state.accounts[ids.bank]!.cash), periods: canonicalSerialize(result.periods) }));
} else {
  let refused = false;
  try { restorePortableHouseholdReplayArtifact(artifact); } catch { refused = true; }
  if (!refused) throw new Error("Unauthenticated portable history accepted");
  process.stdout.write(JSON.stringify({ refused }));
}
