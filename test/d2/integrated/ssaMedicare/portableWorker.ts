// Executed by CI in an independent process using an isolated input file. No integration module is
// imported here: replay's existing codec-registration boundary must suffice.
import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
const payloadPath = process.env.PFM_SSA_MEDICARE_TEST_PAYLOAD;
if (!payloadPath) throw new Error("SSA_MEDICARE_TEST_PAYLOAD_MISSING: fresh process requires an input file");
const { artifact, selected } = JSON.parse(readFileSync(payloadPath, "utf8"));
const restored = restorePortableHouseholdReplayArtifact(artifact);
const result = replayHouseholdForecastWindow(restored, selected);
process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
