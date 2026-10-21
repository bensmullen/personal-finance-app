import { readFileSync } from "node:fs";
import { registerFsaCashSourceProvider } from "../../../../src/simulation/d2/integration/fsaCash/index.js";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { source } from "./scenario.js";

const path = process.env.PFM_FSA_CASH_PAYLOAD;
if (!path) throw new Error("FSA_CASH_TEST_PAYLOAD_MISSING");
const mode = process.env.PFM_FSA_CASH_SOURCE;
// Source is reconstructed independently from the fixed synthetic owner fixture,
// not decoded from a caller receipt or from portable artifact economic inputs.
const raw = source();
registerFsaCashSourceProvider({ lookup: id => mode === "missing" || id !== raw.sourceId ? undefined
  : mode === "amended" ? { ...raw, version: "amended" } : raw });
const { artifact, selected } = JSON.parse(readFileSync(path, "utf8"));
try {
  const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  if (mode !== "available") throw new Error("Unqualified source unexpectedly restored");
  process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
} catch (error) {
  if (mode === "available" || (error instanceof Error && error.message === "Unqualified source unexpectedly restored")) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
