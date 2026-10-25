import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { money } from "../../../../src/values/index.js";
import { document, fixture, ids, publisher, registerPublisher } from "./scenario.js";

registerPublisher();
beforeEach(() => { publisher.read = document; });
describe("#203 independent source-qualified portable replay", () => {
  it.each([13, 25])("preserves original charge and later repayment through %i months and fresh processes", months => {
    const f = fixture(months), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    const detail = runHouseholdKernel({ kernel: f.kernel, runContext: f.context, resultTier: "detail" });
    expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(detail.state));
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.periods[0]!.cash.equals(money("500"))).toBe(true);
    expect(summary.periods[0]!.liabilities.equals(money("1020"))).toBe(true);
    expect(summary.state.accounts[ids.bank]!.cash.equals(money("300"))).toBe(true);
    expect(summary.state.liabilities[ids.card]!.balance.equals(money("820"))).toBe(true);
    expect(summary.state.identities.postedTransactionIds).toHaveLength(2);
    expect(exportHouseholdReplayCheckpoints(summary).some(c => c.state.d2SettlementReceipts !== undefined)).toBe(true);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const directory = mkdtempSync(join(tmpdir(), "pfm-card-bank-"));
    try {
      for (const selected of [summary.periods[0]!.period, summary.periods[1]!.period, summary.periods.at(-1)!.period]) {
        const expected = replayHouseholdForecastWindow(summary, selected);
        const restored = replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), selected);
        expect(canonicalSerialize(restored.state)).toBe(canonicalSerialize(expected.state));
        const path = join(directory, "payload.json");
        writeFileSync(path, JSON.stringify({ artifact, selected, sources: true }), "utf8");
        const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
          env: { ...process.env, PFM_CARD_BANK_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        });
        expect(worker.status, worker.stderr).toBe(0);
        expect(JSON.parse(worker.stdout)).toEqual({ state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods) });
      }
      const path = join(directory, "missing-sources.json");
      writeFileSync(path, JSON.stringify({ artifact, selected: summary.periods.at(-1)!.period, sources: false }), "utf8");
      const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
        env: { ...process.env, PFM_CARD_BANK_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      });
      expect(worker.status, worker.stderr).toBe(0);
      expect(JSON.parse(worker.stdout)).toEqual({ rejected: true });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  // Four fresh vite-node child processes are part of the portable replay proof.
  // Their startup time fluctuates on shared CI hosts; retain every assertion.
  }, 20_000);
  it("rejects receipt/archive wire tampering and unavailable or changed independent issuer sources", () => {
    const f = fixture(13), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    const artifact = createPortableHouseholdReplayArtifact(result);
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact,
      encoded: artifact.encoded.replace("funded_card_payment", "forged_card_payment") })).toThrow();
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact,
      encoded: artifact.encoded.replace("issuer-approved-split", "forged-approved-split") })).toThrow();
    publisher.read = () => undefined;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
    publisher.read = () => ({ ...document(), payment: { ...document().payment, authorizationId: "different-signature" } });
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
  });
});
