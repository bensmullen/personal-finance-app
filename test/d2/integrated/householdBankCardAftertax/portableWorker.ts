import { readFileSync } from "node:fs";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { control, install } from "./scenario.js";
const { artifact, selected, mode, card } = JSON.parse(readFileSync(process.env.PFM_STAGE_E_PAYLOAD!, "utf8"));
if (mode !== "missing") install();
if (mode === "changed") {
  if (card) control.card = d => ({ ...d, version: "amended" });
  else control.premium = d => ({ ...d, version: "amended" });
}
if (mode === "revoked") control.bank = () => undefined;
try {
  const r = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  process.stdout.write(JSON.stringify({ state: canonicalSerialize(r.state) }));
} catch (e) {
  if (mode === "valid") throw e;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
