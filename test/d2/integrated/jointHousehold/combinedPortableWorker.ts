import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { cardSource, combinedScenario, medicalSource, publishers, registerPublishers, retirementSource, sourceReads } from "./combinedScenario.js";

const path = process.env.PFM_S8_PAYLOAD;
if (!path) throw new Error("S8_PAYLOAD_MISSING");
const mode = process.env.PFM_S8_SOURCE_MODE ?? "available";
const months = Number(process.env.PFM_S8_MONTHS);
if (months !== 13 && months !== 25) throw new Error("S8_HORIZON_INVALID");
// Composition happens before decoding payloads. No artifact-derived documents
// or receipt echo authority are installed, even for negative restore cases.
registerPublishers({ fsa: mode !== "missing_fsa", card: mode !== "missing_card", retirement: mode !== "missing_retirement" });
const { wages } = combinedScenario({ months });
if (mode === "missing_employer") wages.source.mode = "missing";
if (mode === "changed_employer") wages.source.mode = "changed";
if (mode === "missing_wage_bank") wages.source.mode = "bank_missing";
if (mode === "changed_wage_bank") wages.source.mode = "bank_owner";
if (mode === "altered_fsa") publishers.fsa = () => ({ ...medicalSource(), version: "amended" });
if (mode === "altered_card") publishers.card = () => ({ ...cardSource(), payment: { ...cardSource().payment, authorizationId: "amended" } });
if (mode === "altered_retirement") publishers.retirement = () => ({ ...retirementSource(), authorizationId: "amended" });
if (mode === "failing_fsa") publishers.fsa = () => { throw new Error("Independent medical publisher unavailable"); };
if (mode === "failing_card") publishers.card = () => { throw new Error("Independent issuer publisher unavailable"); };
const { artifact, selected } = JSON.parse(readFileSync(path, "utf8"));
let restored: ReturnType<typeof restorePortableHouseholdReplayArtifact>;
try { restored = restorePortableHouseholdReplayArtifact(artifact); }
catch (error) {
  if (mode === "available" || mode === "missing_retirement") throw error;
  if (!(error instanceof Error) || !error.message.includes("HOUSEHOLD_REPLAY_BASIS_MISMATCH")) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
  process.exit(0);
}
if (mode !== "available" && mode !== "missing_retirement") throw new Error("Unqualified combined artifact unexpectedly restored");
const replay = replayHouseholdForecastWindow(restored, selected);
process.stdout.write(JSON.stringify({ state: canonicalSerialize(replay.state), periods: canonicalSerialize(replay.periods),
  requalified: { fsa: sourceReads.fsa > 0, card: sourceReads.card > 0, retirement: sourceReads.retirement > 0,
    employer: wages.reads.employer > 0, wageBank: wages.reads.bank > 0 } }));
