import { readFileSync } from "node:fs";
import { restoreHouseholdForecastEvidence } from "../../../../src/application/householdProjection.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import type { PortableModelEnvelope } from "../../../../src/model/modelVersion.js";
import type { PortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
const path = process.env.PFM_MODELED_PAYROLL_PAYLOAD;
if (!path) throw new Error("MISSING_SYNTHETIC_PAYLOAD");
const { artifact, model } = JSON.parse(readFileSync(path, "utf8")) as { artifact: PortableHouseholdReplayArtifact; model: PortableModelEnvelope };
const restored = restoreHouseholdForecastEvidence(artifact, model);
const first = restored.periods[0]!.period;
const detail = replayHouseholdForecastWindow(restored, first);
let missingRejected = false, changedRejected = false;
try { restoreHouseholdForecastEvidence(artifact); } catch { missingRejected = true; }
try { restoreHouseholdForecastEvidence(artifact, { ...model, objects: { ...model.objects, Income: [] } }); } catch { changedRejected = true; }
process.stdout.write(JSON.stringify({ cash: detail.periods[0]!.cash.amount.toString(), missingRejected, changedRejected }));
