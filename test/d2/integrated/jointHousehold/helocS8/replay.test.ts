import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthoritativeState, requalifyD2SettlementReceiptHistory, applyD2SettlementAtomically } from "../../../../../src/state/index.js";
import { money } from "../../../../../src/values/index.js";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { runHouseholdKernel, replayHouseholdForecastWindow, exportHouseholdReplayCheckpoints } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { archive, debits, ids, jointHeloc, reset } from "./scenario.js";
import type { FsaCashInput } from "../../../../../src/simulation/d2/integration/fsaCash/index.js";

beforeEach(reset);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("#149 S8-4 bounded joint HELOC portable history", () => {
  it("preserves 13 actual installments through summary/detail, split/full and independent cold publishers", () => {
    const s = jointHeloc({ months: 25, payments: 13 });
    const summary = runHouseholdKernel({ kernel: s.kernel, runContext: s.context }), detail = s.run();
    for (const out of [summary, detail]) {
      expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(25);
      expect(out.diagnostics.filter(d => d.severity === "error")).toEqual([]);
      expect(out.status).toBe("incomplete");
      expect(out.state.liabilities[ids.heloc]!.balance.equals(money("690"))).toBe(true);
      expect(out.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
      // 100 + 100 + 11*10 principal; 5.10 + 4.14 + 11*1 interest.
      expect(out.state.accounts[ids.bank]!.cash.equals(money("18274.83"))).toBe(true);
      const receipts = Object.values(out.state.d2SettlementReceipts!).filter(r => r.kind === "heloc_phase_service");
      expect(receipts).toHaveLength(13);
      expect(receipts.reduce((m, r) => m.plus(r.amount), money("0")).equals(money("330.24"))).toBe(true);
      expect(receipts.every(r => r.source.originalInputDigest.length === 64)).toBe(true);
      expect(out.periods.every(p => !p.cash.isNegative() && p.statements.income.equals(money("1000")))).toBe(true);
    }
    expect(summary.state).toEqual(detail.state); expect(summary.primitiveState).toEqual(detail.primitiveState);
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.outputCapabilities).toEqual(detail.outputCapabilities);
    expect(summary.outputCapabilities?.helocTax?.status).toBe("incomplete");
    const txs = detail.periods.flatMap(p => p.transactions);
    expect(txs.filter(t => t.type === "heloc_service")).toHaveLength(13);
    expect(txs.filter(t => t.type === "heloc_interest")).toHaveLength(13);
    expect(new Set(txs.map(t => t.id)).size).toBe(txs.length);
    expect(detail.state.identities.postedTransactionIds).toHaveLength(txs.length + 1); // original draw
    expect(Object.keys(detail.state.d2PostedTransactions!)).toHaveLength(32); // 6 S8-3 + 26 HELOC
    const checkpoints = exportHouseholdReplayCheckpoints(summary);
    expect(checkpoints.map(c => c.at)).toEqual([instant("2027-01-01T00:00:00.000Z"), instant("2028-01-01T00:00:00.000Z")]);
    expect(checkpoints.map(c => Object.values(c.state.d2SettlementReceipts!).filter(r => r.kind === "heloc_phase_service").length)).toEqual([11, 13]);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const restored = restorePortableHouseholdReplayArtifact(copy(artifact));
    expect(exportHouseholdReplayCheckpoints(restored)).toEqual(checkpoints);
    const full = replayHouseholdForecastWindow(restored, { start: detail.periods[0]!.period.start, end: detail.periods.at(-1)!.period.end });
    expect(full.periods).toEqual(detail.periods); expect(full.state).toEqual(detail.state);
    const left = replayHouseholdForecastWindow(restored, { start: detail.periods[0]!.period.start, end: detail.periods[11]!.period.end });
    const right = replayHouseholdForecastWindow(restored, { start: detail.periods[12]!.period.start, end: detail.periods.at(-1)!.period.end });
    expect([...left.periods, ...right.periods]).toEqual(full.periods); expect(right.state).toEqual(full.state);
    const state = createAuthoritativeState(full.state);
    requalifyD2SettlementReceiptHistory(state, s.context);
    const before = canonicalSerialize(state);
    for (const r of Object.values(state.d2SettlementReceipts!)) expect(applyD2SettlementAtomically(state, r, s.context).status).toBe("already_committed");
    expect(canonicalSerialize(state)).toBe(before);

    const directory = mkdtempSync(join(tmpdir(), "pfm-s8-heloc-"));
    try {
      const path = join(directory, "payload.json");
      const child = (index: number, mode: string) => {
        writeFileSync(path, JSON.stringify({ artifact, selected: detail.periods[index]!.period }));
        const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30_000,
          env: { ...process.env, PFM_S8_HELOC_PAYLOAD: path, PFM_S8_HELOC_MODE: mode } });
        expect(worker.error).toBeUndefined(); expect(worker.status, worker.stderr).toBe(0);
        return JSON.parse(worker.stdout);
      };
      for (const index of [1, 13, 24]) {
        const expected = replayHouseholdForecastWindow(summary, detail.periods[index]!.period);
        const selected = replayHouseholdForecastWindow(restored, detail.periods[index]!.period);
        expect(selected.periods).toEqual([detail.periods[index]]); expect(selected.state).toEqual(expected.state);
        expect(child(index, "present")).toEqual({ state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods),
          issuerRead: true, bankRead: true, cardRead: true, fsaRead: true, retirementRead: true });
      }
      for (const mode of ["withdrawn", "version", "bank_absent", "approval", "history"]) {
        const rejected = child(24, mode);
        expect(rejected).toMatchObject({ rejected: true, issuerRead: true });
        if (mode !== "withdrawn") expect(rejected.bankRead).toBe(true);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
    // A restored warm basis cannot authorize changed original publishers either.
    const first = s.pairs[0]!;
    archive.set(first.issuer.sourceId, { ...first.issuer, request: { ...first.issuer.request,
      checkpoint: { ...first.issuer.request.checkpoint, originalAt: civilDate("2024-01-02") } } });
    expect(() => restorePortableHouseholdReplayArtifact(copy(artifact))).toThrow();
    expect(() => replayHouseholdForecastWindow(restored, detail.periods[24]!.period)).toThrow();
    archive.set(first.issuer.sourceId, first.issuer); debits.clear();
    expect(() => restorePortableHouseholdReplayArtifact(copy(artifact))).toThrow();
  // 25 monthly periods, 13 issuer histories, full/split/selected replays and
  // eight independent source-authentication processes justify this test alone.
  }, 90_000);

  it("keeps publisher documents out of checkpoints and reference growth bounded by occurrences", () => {
    const small = jointHeloc({ months: 25, payments: 1 });
    const smallResult = runHouseholdKernel({ kernel: small.kernel, runContext: small.context });
    expect(smallResult.periods, JSON.stringify(smallResult.diagnostics)).toHaveLength(25);
    const smallArtifact = createPortableHouseholdReplayArtifact(smallResult);
    const large = jointHeloc({ months: 25, payments: 13 });
    const largeResult = runHouseholdKernel({ kernel: large.kernel, runContext: large.context });
    expect(largeResult.periods, JSON.stringify(largeResult.diagnostics)).toHaveLength(25);
    const largeArtifact = createPortableHouseholdReplayArtifact(largeResult);
    // Report the separate inherited retirement payload debt as bytes, never as
    // proof that all D2 source transport is compact. Its migration is excluded
    // from this repair and remains mandatory before D2 closeout.
    const legacyRetirement = large.kernel.executable.participants!.find(p => p.id === "d2_retirement_cash")!.economicInputs;
    const retirementBytes = new TextEncoder().encode(canonicalSerialize(legacyRetirement)).byteLength;
    expect(canonicalSerialize(legacyRetirement)).toContain("withdrawals");
    console.info("#149 outstanding retirement economicInputs bytes:", retirementBytes);
    for (const [s, artifact] of [[small, smallArtifact], [large, largeArtifact]] as const) {
      const config = s.kernel.executable.participants!.find(p => p.id === "d2_heloc_servicing")!.economicInputs;
      expect(config).toEqual({ sourceIds: s.pairs.map(p => p.issuer.sourceId).sort() });
      expect(artifact.encoded).not.toContain("Synthetic complete original statement");
      expect(artifact.encoded).not.toContain("original_complete_issuer_statement");
      expect(canonicalSerialize(config)).not.toContain("checkpoint");
      const fsa = s.kernel.executable.participants!.find(p => p.id === "d2_fsa_cash")!;
      expect(fsa.portableCodec).toBe("d2-fsa-cash/v2");
      expect((fsa.economicInputs as FsaCashInput).sources[0]!.expectedSource).toMatch(/^fsa-cash-source\/v2:sha256:[a-f0-9]{64}$/);
      const receipt = Object.values((s === small ? smallResult : largeResult).state.d2SettlementReceipts!)
        .find(r => r.kind === "fsa_paid_reimbursement")!;
      expect(receipt.source.sourceVersion).not.toContain("s8-medical-receipt");
      expect(receipt.source.sourceVersion).toContain("fsa-cash-source/v2:sha256:");
      expect(receipt.sourceEvidenceFingerprint).not.toContain("health_fsa_plan");
      expect(artifact.encoded).not.toContain("Fixed artificial plan; not law");
    }
    const receipts = Object.values(largeResult.state.d2SettlementReceipts!).filter(r => r.kind === "heloc_phase_service");
    expect(receipts).toHaveLength(13);
    // Relative size, no machine/encoding-specific byte threshold. Historical
    // source inputs grow with history; each stored receipt stays constant-sized.
    expect(canonicalSerialize(receipts).length).toBeLessThan(canonicalSerialize(receipts.slice(0, 1)).length * 15);
    expect(largeArtifact.encoded.length).toBeGreaterThan(smallArtifact.encoded.length);
    expect(largeArtifact.encoded.length - smallArtifact.encoded.length).toBeLessThan(smallArtifact.encoded.length * 12);
  // CI #40162488195 runner.log reports 8.9s for these two 25-period forecasts,
  // not a financial mismatch. Bound this serialization oracle alone at 25s.
  }, 25_000);
});
