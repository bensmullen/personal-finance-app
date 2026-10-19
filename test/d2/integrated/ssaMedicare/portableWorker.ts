// Executed by the CI test in an independent process. No integration module is
// imported here: replay's existing codec-registration boundary must suffice.
import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
const { artifact, selected } = JSON.parse(readFileSync(0, "utf8"));
const restored = restorePortableHouseholdReplayArtifact(artifact);
const result = replayHouseholdForecastWindow(restored, selected);
process.stdout.write(JSON.stringify({ state: canonicalSerialize(result.state), periods: canonicalSerialize(result.periods) }));
