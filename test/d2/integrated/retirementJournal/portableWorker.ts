import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { admit, distribution, registerAuthority } from "./scenario.js";
import { laterDistribution, registerParticipantCodec } from "./participant.js";

registerParticipantCodec();

const path = process.env.PFM_RETIREMENT_J1_PAYLOAD;
if (!path) throw new Error("RETIREMENT_J1_PAYLOAD_MISSING");
const { artifact, selected, rows, sources } = JSON.parse(readFileSync(path, "utf8"));
if (sources) { registerAuthority(); admit(distribution(rows)); admit(laterDistribution()); }
const restored = restorePortableHouseholdReplayArtifact(artifact);
const replay = replayHouseholdForecastWindow(restored, selected);
process.stdout.write(JSON.stringify({ state: canonicalSerialize(replay.state), periods: canonicalSerialize(replay.periods) }));
