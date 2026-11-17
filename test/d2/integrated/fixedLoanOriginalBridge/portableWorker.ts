import { readFileSync } from "node:fs";
import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { ids } from "../householdBankAuthority/scenario.js";
import { fixture } from "./scenario.js";

const { artifact, selected, sources } = JSON.parse(readFileSync(0, "utf8"));
if (sources) fixture("student", "growth", 13, 13);
try {
  const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  process.stdout.write(JSON.stringify({ periods: result.periods.length, cash: result.state.accounts[ids.bank]?.cash.amount.toString(),
    proofs: Object.keys(result.state.d2PostedTransactions ?? {}).length }));
} catch (error) {
  if (sources) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
