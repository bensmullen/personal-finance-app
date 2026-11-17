import { replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { ids } from "../householdBankAuthority/scenario.js";

const chunks: Buffer[] = [];
let bytes = 0;
for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
  bytes += chunk.length;
  if (bytes > 2 * 1024 * 1024) throw new Error("Portable replay worker input exceeds the fixture limit");
  chunks.push(chunk);
}
const { artifact, selected, sources } = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
if (sources) {
  const { fixture } = await import("./scenario.js");
  fixture("student", "growth", 13, 13);
}
try {
  const result = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
  process.stdout.write(JSON.stringify({ periods: result.periods.length, cash: result.state.accounts[ids.bank]?.cash.amount.toString(),
    proofs: Object.keys(result.state.d2PostedTransactions ?? {}).length }));
} catch (error) {
  if (sources) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
