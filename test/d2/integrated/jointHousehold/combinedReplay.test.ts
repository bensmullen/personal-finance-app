import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { attachCardBank } from "../../../../src/simulation/d2/integration/cardBank/index.js";
import { attachFsaCash, fsaCashSourceFingerprint } from "../../../../src/simulation/d2/integration/fsaCash/index.js";
import { combinedScenario, ids, medicalSource, registerPublishers, resetPublishers } from "./combinedScenario.js";

registerPublishers();
beforeEach(resetPublishers);

// Adversarial wire edits intentionally recompute change-detection integrity.
// Rejection must come from canonical history and independent source authority.
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const object = (x: Json): { [key: string]: Json } => x as { [key: string]: Json };
const items = (x: Json): Json[] => object(x).value as Json[];
const field = (x: Json, key: string): Json => (items(x).find(entry => Array.isArray(entry) && entry[0] === key) as Json[])[1]!;
const replace = (x: Json, key: string, value: Json): void => {
  (items(x).find(entry => Array.isArray(entry) && entry[0] === key) as Json[])[1] = value;
};
const remove = (x: Json, key: string): void => { object(x).value = items(x).filter(entry => !Array.isArray(entry) || entry[0] !== key); };
const expanded = (encoded: string): Json => {
  const refs = new Map<number, Json>();
  const visit = (x: Json): Json => {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(visit);
    if (x.kind === "definition") {
      const [id, payload] = x.value as Json[];
      const result = visit(payload!); refs.set(id as number, result); return result;
    }
    if (x.kind === "reference") return JSON.parse(JSON.stringify(refs.get(x.value as number))) as Json;
    return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, visit(value)]));
  };
  return visit(JSON.parse(encoded) as Json);
};

describe("#149 S8-2 independently requalified combined portable v3 baseline", () => {
  it.each([13, 25])("preserves %i-month detail, summary, sparse checkpoints, exact archives and fresh-process replay", months => {
    const s = combinedScenario({ months });
    expect(attachCardBank(s.kernel, { sourceIds: ["s8-issuer-source"] })).toBe(s.kernel);
    expect(attachFsaCash(s.kernel, { sources: [{ sourceId: "s8-medical-source", expectedSource: fsaCashSourceFingerprint(medicalSource()) }] })).toBe(s.kernel);
    const summary = runHouseholdKernel({ kernel: s.kernel, runContext: s.context }), detail = s.run();
    expect(summary.status).toBe("incomplete"); expect(detail.status).toBe("incomplete");
    expect(summary.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(detail.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(summary.periods).toHaveLength(months); expect(detail.periods).toHaveLength(months);
    expect(summary.state).toEqual(detail.state); expect(summary.primitiveState).toEqual(detail.primitiveState);
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.state.d2SettlementReceipts).toEqual(detail.state.d2SettlementReceipts);
    expect(Object.keys(summary.state.d2SettlementReceipts!)).toHaveLength(2);
    expect(Object.keys(summary.state.d2PostedTransactions!)).toHaveLength(5);
    expect(summary.state.d2PostedTransactions).toEqual(detail.state.d2PostedTransactions);
    expect(summary.state.retirementDistributionAllocations).toEqual(detail.state.retirementDistributionAllocations);
    expect(detail.periods.every(p => p.statements.income.amount.toString() === "1000")).toBe(true);
    const txs = detail.periods.flatMap(p => p.transactions);
    expect(new Set(txs.map(tx => tx.id)).size).toBe(txs.length);
    expect(detail.state.identities.postedTransactionIds).toHaveLength(txs.length);
    for (const type of ["issuer_card_charge", "funded_card_payment", "fsa_medical_expense_payment", "fsa_expense_reimbursement", "retirement_cash_transfer"])
      expect(txs.filter(t => t.type === type)).toHaveLength(1);
    const checkpoints = exportHouseholdReplayCheckpoints(summary);
    expect(checkpoints.map(c => c.at)).toEqual(months === 13 ? ["2027-01-01T00:00:00.000Z"]
      : ["2027-01-01T00:00:00.000Z", "2028-01-01T00:00:00.000Z"]);
    for (const c of checkpoints) {
      expect(c.state.d2SettlementReceipts).toEqual(detail.state.d2SettlementReceipts);
      expect(c.state.d2PostedTransactions).toEqual(detail.state.d2PostedTransactions);
      expect(c.state.retirementDistributionAllocations?.["s8-retirement-posted"]?.rmdSatisfaction).toBe("not_applied");
    }
    const artifact = createPortableHouseholdReplayArtifact(summary);
    expect(artifact.version).toBe("household-replay/v3");
    const wire = expanded(artifact.encoded), deltas = items(field(wire, "checkpoints"));
    expect(deltas).toHaveLength(checkpoints.length);
    if (months === 25) for (const key of ["d2PostedTransactions", "d2SettlementReceipts", "retirementDistributionAllocations"]) {
      const delta = field(field(deltas[1]!, "records"), key);
      expect(items(field(delta, "set"))).toEqual([]);
      expect(items(field(delta, "remove"))).toEqual([]);
    }
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(exportHouseholdReplayCheckpoints(restored)).toEqual(checkpoints);
    const directory = mkdtempSync(join(tmpdir(), "pfm-s8-combined-"));
    const child = (selected: (typeof detail.periods)[number]["period"], mode: string) => {
      const path = join(directory, "payload.json"); writeFileSync(path, JSON.stringify({ artifact, selected }), "utf8");
      const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./combinedPortableWorker.ts", import.meta.url))], {
        encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30_000,
        env: { ...process.env, PFM_S8_PAYLOAD: path, PFM_S8_SOURCE_MODE: mode },
      });
      expect(worker.error).toBeUndefined(); expect(worker.status, worker.stderr).toBe(0);
      return JSON.parse(worker.stdout);
    };
    try {
      // Opening replay proves the dates before a sparse checkpoint as well as
      // the later resume. Every selected window compares all participants.
      for (const index of [0, 1, months - 1]) {
        const selected = detail.periods[index]!.period, expected = replayHouseholdForecastWindow(summary, selected);
        const portable = replayHouseholdForecastWindow(restored, selected);
        expect(portable.state).toEqual(expected.state); expect(portable.periods).toEqual([detail.periods[index]]);
        expect(replayHouseholdForecastWindow({ ...summary }, selected)).toEqual(expected);
        expect(replayHouseholdForecastWindow(restored, selected)).toEqual(portable);
        expect(child(selected, "available")).toEqual({ state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods),
          requalified: { fsa: true, card: true, retirement: true } });
      }
      const selected = detail.periods.at(-1)!.period;
      for (const mode of ["missing_fsa", "missing_card", "altered_fsa", "altered_card", "altered_retirement", "failing_fsa", "failing_card"])
        expect(child(selected, mode)).toEqual({ rejected: true });
      // J1 structural history remains portable without its source owner. Cash
      // is preserved and the journal never gains RMD or complete-tax authority.
      const expected = replayHouseholdForecastWindow(summary, selected);
      expect(child(selected, "missing_retirement")).toEqual({ state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods),
        requalified: { fsa: true, card: true, retirement: false } });
      expect(expected.state.retirementDistributionAllocations?.["s8-retirement-posted"]).toMatchObject({ rmdSatisfaction: "not_applied", tax: "incomplete" });
      expect(expected.state.accounts[ids.retirement]!.cash.amount.toString()).toBe("500");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 120_000);

  it.each(["receipt", "approval", "journal", "proof", "retirement", "rmd"] as const)(
    "rejects %s committed checkpoint tampering even with recomputed integrity", mode => {
      const s = combinedScenario({ months: 13 }), summary = runHouseholdKernel({ kernel: s.kernel, runContext: s.context });
      expect(summary.status).toBe("incomplete"); expect(summary.periods).toHaveLength(13);
      expect(summary.diagnostics.filter(d => d.severity === "error")).toEqual([]);
      const artifact = createPortableHouseholdReplayArtifact(summary), wire = expanded(artifact.encoded);
      const records = field(items(field(wire, "checkpoints"))[0]!, "records");
      const receipts = field(field(records, "d2SettlementReceipts"), "set"), proofs = field(field(records, "d2PostedTransactions"), "set");
      if (mode === "receipt") object(field(field(receipts, "fsa-cash:s8-medical-source:receipt"), "amount")).value = ["1001", "USD"];
      else if (mode === "approval") replace(field(field(receipts, "card-bank:payment-february"), "source"), "paymentApprovalId", "forged");
      else if (mode === "journal") replace(field(field(proofs, "card-charge-january"), "transaction"), "date", "2026-01-30T17:00:00.000Z");
      else if (mode === "proof") remove(proofs, "fsa-cash:s8-medical-source:original");
      else {
        const record = field(field(field(records, "retirementDistributionAllocations"), "set"), "s8-retirement-posted");
        if (mode === "rmd") replace(record, "rmdSatisfaction", "applied");
        else replace(record, "authorizationId", "forged");
      }
      const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: s.context, openingState: encoded });
      expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
      expect(summary.state.accounts[ids.bank]!.cash).toEqual(s.run().state.accounts[ids.bank]!.cash);
    });
});
