import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { qualifyRetirementRawSource } from "../../../../src/simulation/d2/integration/retirementCash/source.js";
import { instant } from "../../../../src/time/index.js";
import { fundedHousehold, reads, sources } from "./fundedScenario.js";

const path = process.env.PFM_S8_FUNDED_PAYLOAD;
if (!path) throw new Error("S8_FUNDED_PAYLOAD_MISSING");
const months = Number(process.env.PFM_S8_FUNDED_MONTHS);
if (months !== 13 && months !== 25) throw new Error("S8_FUNDED_HORIZON_INVALID");
// Fixed, independently authored publisher reconstruction precedes reading any
// artifact bytes. Only the requested bounded horizon comes from the launcher.
const s = fundedHousehold({ months });
const mode = process.env.PFM_S8_FUNDED_SOURCE_MODE ?? "present";
if (mode === "absent") sources.delete(s.raw[0]!.sourceId);
if (mode === "tampered") {
  const p = s.raw[0]!;
  sources.set(p.sourceId, { ...p, availability: p.availability.map(a => ({ ...a, knownAt: instant("2099-01-01T00:00:00.000Z") })) });
}
const raw = sources.get(s.raw[0]!.sourceId);
const qualification = raw && qualifyRetirementRawSource(raw, raw.cash.withdrawals.requests[0]!.operationId, s.context);
if (mode === "present" && qualification?.status !== "qualified") throw new Error("S8_PUBLISHER_UNQUALIFIED");
const { artifact, selected } = JSON.parse(readFileSync(path, "utf8"));
const restored = restorePortableHouseholdReplayArtifact(artifact);
const out = replayHouseholdForecastWindow(restored, selected);
const twice = replayHouseholdForecastWindow(restored, selected);
if (canonicalSerialize(out.state) !== canonicalSerialize(twice.state) || canonicalSerialize(out.periods) !== canonicalSerialize(twice.periods))
  throw new Error("S8_REPLAY_CHANGED");
const rmd = s.satisfaction(out.state);
const newPosting = mode === "present" ? undefined : s.run();
process.stdout.write(JSON.stringify({ state: canonicalSerialize(out.state), periods: canonicalSerialize(out.periods),
  publisherRead: reads > 0, qualification: qualification?.status ?? "unavailable", coverage: rmd.coverage,
  satisfied: rmd.annual?.obligations.map(o => o.satisfied.amount.toString()) ?? null,
  ...(newPosting ? { newPosting: { periods: newPosting.periods.length, state: canonicalSerialize(newPosting.state) } } : {}) }));
