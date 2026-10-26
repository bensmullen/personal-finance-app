import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { civilDate } from "../../../../../src/time/index.js";
import { sourceReads } from "../combinedScenario.js";
import { reads as retirementReads } from "../fundedScenario.js";
import { archive, debits, jointHeloc, reads } from "./scenario.js";

const path = process.env.PFM_S8_HELOC_PAYLOAD;
if (!path) throw new Error("S8_4_PAYLOAD_MISSING");
// Reinstall every exact approved publisher before reading artifact bytes.
// The artifact never supplies a document, approval, quote or source catalog.
const s = jointHeloc({ months: 25, payments: 13 }), first = s.pairs[0]!;
const mode = process.env.PFM_S8_HELOC_MODE ?? "present";
if (mode === "withdrawn") archive.delete(first.issuer.sourceId);
if (mode === "version") archive.set(first.issuer.sourceId, { ...first.issuer, version: "changed/v2" });
if (mode === "bank_absent") debits.clear();
if (mode === "approval") debits.set(first.bank.id, { ...first.bank, approvalId: "" });
if (mode === "history") archive.set(first.issuer.sourceId, { ...first.issuer, request: { ...first.issuer.request,
  checkpoint: { ...first.issuer.request.checkpoint, originalAt: civilDate("2024-01-02") } } });
const { artifact, selected } = JSON.parse(readFileSync(path, "utf8"));
let restored: ReturnType<typeof restorePortableHouseholdReplayArtifact>;
try { restored = restorePortableHouseholdReplayArtifact(artifact); }
catch (error) {
  if (mode === "present") throw error;
  process.stdout.write(JSON.stringify({ rejected: true, issuerRead: reads.issuer > 0, bankRead: reads.bank > 0 }));
  process.exit(0);
}
if (mode !== "present") throw new Error("S8_4_INVALID_RESTORE_ACCEPTED");
const out = replayHouseholdForecastWindow(restored, selected);
const twice = replayHouseholdForecastWindow(restored, selected);
if (canonicalSerialize(out.state) !== canonicalSerialize(twice.state) || canonicalSerialize(out.periods) !== canonicalSerialize(twice.periods))
  throw new Error("S8_4_REPLAY_CHANGED");
process.stdout.write(JSON.stringify({ state: canonicalSerialize(out.state), periods: canonicalSerialize(out.periods),
  issuerRead: reads.issuer > 0, bankRead: reads.bank > 0, cardRead: sourceReads.card > 0,
  fsaRead: sourceReads.fsa > 0, retirementRead: retirementReads > 0 }));
