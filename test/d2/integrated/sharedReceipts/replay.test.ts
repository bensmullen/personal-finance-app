import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { admit, availability, ids, independentSources, registerMockAuthorities } from "./scenario.js";
import { replayFixture } from "./replayScenario.js";
import { laterReceipt, registerLaterParticipantCodec } from "./laterParticipant.js";
import { money } from "../../../../src/values/index.js";

registerMockAuthorities();
registerLaterParticipantCodec();
beforeEach(() => { independentSources.clear(); availability.source = true; availability.calls = 0; availability.failAt = 0; });

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const object = (v: Json): { [key: string]: Json } => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected wire object");
  return v;
};
const items = (v: Json): Json[] => { const value = object(v).value; if (!Array.isArray(value)) throw new Error("Expected wire items"); return value; };
const field = (v: Json, key: string): Json => {
  for (const entry of items(v)) if (Array.isArray(entry) && entry[0] === key && entry[1] !== undefined) return entry[1];
  throw new Error(`Missing wire field ${key}`);
};
const removeField = (v: Json, key: string) => { object(v).value = items(v).filter(entry => !Array.isArray(entry) || entry[0] !== key); };
const replaceField = (v: Json, key: string, replacement: Json) => {
  for (const entry of items(v)) if (Array.isArray(entry) && entry[0] === key) { entry[1] = replacement; return; }
  throw new Error(`Missing replace field ${key}`);
};
const expanded = (encoded: string): Json => {
  const definitions = new Map<number, Json>();
  const expand = (v: Json): Json => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(expand);
    if (v.kind === "definition") {
      if (!Array.isArray(v.value) || typeof v.value[0] !== "number" || v.value[1] === undefined) throw new Error("Invalid definition");
      const result = expand(v.value[1]); definitions.set(v.value[0], result); return result;
    }
    if (v.kind === "reference") {
      if (typeof v.value !== "number") throw new Error("Invalid reference");
      return definitions.get(v.value) ?? null;
    }
    return Object.fromEntries(Object.entries(v).map(([key, value]) => [key, expand(value)]));
  };
  return JSON.parse(JSON.stringify(expand(JSON.parse(encoded))));
};

describe("#149 portable shared-receipt foundation", () => {
  it.each([{ kind: "fsa" as const, months: 13 }, { kind: "card" as const, months: 25 }])(
    "archives the month-one $kind original and month-two settlement through $months-month independent replay", ({ kind, months }) => {
    const receipt = admit(laterReceipt(kind)), f = replayFixture(false, months, false, true, kind);
    const summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const detail = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext, resultTier: "detail" });
    expect(f.opening.d2SettlementReceipts).toBeUndefined();
    expect(f.opening.d2PostedTransactions).toBeUndefined();
    expect(summary.periods[0]!.cash.equals(money("500"))).toBe(true);
    const finalCash = kind === "fsa" ? money("1000") : money("300");
    expect(summary.periods[1]!.cash.equals(finalCash)).toBe(true);
    expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(detail.state));
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.state.identities.postedTransactionIds).toHaveLength(2);
    expect(canonicalSerialize(summary.state.d2SettlementReceipts)).toBe(canonicalSerialize({ [receipt.id]: receipt }));
    const originalPeriod = replayHouseholdForecastWindow(summary, summary.periods[0]!.period);
    expect(originalPeriod.state.d2SettlementReceipts).toBeUndefined();
    expect(Object.keys(originalPeriod.state.d2PostedTransactions!)).toEqual([receipt.originalTransaction.id]);
    expect(originalPeriod.state.d2PostedTransactions![receipt.originalTransaction.id]!.transaction).toEqual(receipt.originalTransaction);
    expect(Object.keys(summary.state.d2PostedTransactions!)).toHaveLength(2);
    expect(summary.state.d2PostedTransactions![receipt.paymentTransaction.id]!.transaction).toEqual(receipt.paymentTransaction);
    expect(summary.state.liabilities[ids.liability]!.balance.equals(money(kind === "fsa" ? "1000" : "820"))).toBe(true);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const checkpoints = exportHouseholdReplayCheckpoints(summary);
    expect(checkpoints.some(c => c.state.d2SettlementReceipts?.[receipt.id] !== undefined)).toBe(true);
    const wireCheckpoints = items(field(expanded(artifact.encoded), "checkpoints"));
    expect(items(field(field(field(wireCheckpoints[0]!, "records"), "d2PostedTransactions"), "set"))).toHaveLength(2);
    if (months === 25) expect(items(field(field(field(wireCheckpoints[1]!, "records"), "d2PostedTransactions"), "set"))).toHaveLength(0);
    const directory = mkdtempSync(join(tmpdir(), "pfm-shared-in-horizon-"));
    try {
      // Month two re-executes the operation; month thirteen resumes a checkpoint
      // containing it. Neither may double-post or invent a settled whole claim.
      for (const selected of [summary.periods[1]!.period, summary.periods.at(-1)!.period]) {
        const expected = replayHouseholdForecastWindow(summary, selected);
        expect(expected.state.identities.postedTransactionIds).toHaveLength(2);
        expect(expected.state.accounts[ids.bank]!.cash.equals(finalCash)).toBe(true);
        expect(canonicalSerialize(expected.state.d2PostedTransactions)).toBe(canonicalSerialize(summary.state.d2PostedTransactions));
        for (let repeat = 0; repeat < 2; repeat++) {
          const restored = restorePortableHouseholdReplayArtifact(artifact);
          expect(canonicalSerialize(replayHouseholdForecastWindow(restored, selected).state)).toBe(canonicalSerialize(expected.state));
        }
        for (const sources of [true, false]) {
          const path = join(directory, "payload.json");
          writeFileSync(path, JSON.stringify({ artifact, selected, sources }), "utf8");
          const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
            fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
            env: { ...process.env, PFM_SHARED_RECEIPTS_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
          });
          expect(worker.status, worker.stderr).toBe(0);
          expect(JSON.parse(worker.stdout)).toEqual(sources
            ? { state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods) } : { rejected: true });
        }
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it.each([13, 25])("preserves exact opening receipt bytes across %s-month detail/summary and independent repeated replay", months => {
    // This exercises foundation persistence. Domain scheduling/source evaluation
    // and in-horizon FSA/card activity remain the #202/#203 adapter gates.
    const f = replayFixture(true, months);
    const summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const detail = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext, resultTier: "detail" });
    expect(summary.periods).toHaveLength(months);
    expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(detail.state));
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.state.identities.postedTransactionIds).toHaveLength(28);
    expect(Object.keys(summary.state.d2SettlementReceipts!)).toHaveLength(14);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const selected = detail.periods.at(-1)!.period;
    const expected = replayHouseholdForecastWindow(summary, selected);
    for (let n = 0; n < 2; n++) {
      const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
      expect(canonicalSerialize(exportHouseholdReplayCheckpoints(restored))).toBe(canonicalSerialize(exportHouseholdReplayCheckpoints(summary)));
      const replay = replayHouseholdForecastWindow(restored, selected);
      expect(canonicalSerialize(replay.state)).toBe(canonicalSerialize(expected.state));
      expect(canonicalSerialize(replay.state.d2SettlementReceipts)).toBe(canonicalSerialize(f.opening.d2SettlementReceipts));
      expect(replay.state.identities.postedTransactionIds).toHaveLength(28);
      expect(replay.periods).toEqual(detail.periods.slice(-1));
    }
    const directory = mkdtempSync(join(tmpdir(), "pfm-shared-receipts-"));
    try {
      for (const sources of [true, false]) {
        const path = join(directory, "payload.json"); writeFileSync(path, JSON.stringify({ artifact, selected, sources }), "utf8");
        const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
          env: { ...process.env, PFM_SHARED_RECEIPTS_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        });
        expect(worker.status, worker.stderr).toBe(0);
        expect(JSON.parse(worker.stdout)).toEqual(sources
          ? { state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods) } : { rejected: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("refuses unavailable independent source history despite intact artifact integrity", () => {
    const f = replayFixture(), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    availability.source = false;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  });

  it("refuses intact receipt bytes when the canonical archive is omitted despite recomputed integrity", () => {
    const f = replayFixture(), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const wire = expanded(artifact.encoded);
    removeField(field(field(wire, "executable"), "reconciledOpeningState"), "d2PostedTransactions");
    for (const checkpoint of items(field(wire, "checkpoints"))) removeField(field(checkpoint, "records"), "d2PostedTransactions");
    const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.runContext, openingState: encoded });
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  });

  it("preserves legacy v1/v2/v3 absence and explicitly empty optional records", () => {
    const f = replayFixture(false), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    for (const version of ["household-replay/v1", "household-replay/v2", "household-replay/v3"] as const) {
      const restored = restorePortableHouseholdReplayArtifact({ ...artifact, version });
      expect(replayHouseholdForecastWindow(restored, summary.periods.at(-1)!.period).state.d2SettlementReceipts).toBeUndefined();
      expect(replayHouseholdForecastWindow(restored, summary.periods.at(-1)!.period).state.d2PostedTransactions).toBeUndefined();
    }
    const wire = expanded(artifact.encoded);
    for (const checkpoint of items(field(wire, "checkpoints"))) {
      removeField(field(checkpoint, "records"), "d2SettlementReceipts");
      removeField(field(checkpoint, "records"), "d2PostedTransactions");
    }
    const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.runContext, openingState: encoded });
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).not.toThrow();
    const empty = replayFixture(false, 13, true);
    const emptySummary = runHouseholdKernel({ kernel: empty.kernel, runContext: empty.runContext });
    const emptyRestored = restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(emptySummary));
    expect(emptyRestored.replay.kernel.executable.reconciledOpeningState.d2SettlementReceipts).toEqual({});
    expect(emptyRestored.replay.kernel.executable.reconciledOpeningState.d2PostedTransactions).toEqual({});
    expect(replayHouseholdForecastWindow(emptyRestored, emptySummary.periods.at(-1)!.period).state.d2SettlementReceipts).toEqual({});
  });

  it.each(["missing-posting", "duplicate-key", "alias", "rewrite", "remove", "operation", "date", "id", "amount", "signed-legs", "owner", "plan"] as const)(
    "rejects in-horizon archive %s even after portable integrity is recomputed", mode => {
      const receipt = admit(laterReceipt()), f = replayFixture(false, 25, false, true);
      const summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
      const artifact = createPortableHouseholdReplayArtifact(summary), wire = expanded(artifact.encoded);
      const checkpoints = items(field(wire, "checkpoints")), set = field(field(field(checkpoints[0]!, "records"), "d2PostedTransactions"), "set");
      const proof = field(set, receipt.paymentTransaction.id), tx = field(proof, "transaction");
      if (mode === "missing-posting") removeField(set, receipt.paymentTransaction.id);
      else if (mode === "duplicate-key") items(set).push([receipt.paymentTransaction.id, proof]);
      else if (mode === "alias") items(set).push(["archive-alias", proof]);
      else if (mode === "remove") object(field(field(field(checkpoints[1]!, "records"), "d2PostedTransactions"), "remove")).value = [receipt.paymentTransaction.id];
      else if (mode === "rewrite") {
        const replacement: Json = JSON.parse(JSON.stringify(proof));
        replaceField(field(replacement, "registration"), "operationId", "rewritten-operation");
        items(field(field(field(checkpoints[1]!, "records"), "d2PostedTransactions"), "set")).push([receipt.paymentTransaction.id, replacement]);
      } else if (mode === "operation") replaceField(field(proof, "registration"), "operationId", "uncommitted-operation");
      else if (mode === "owner") replaceField(field(proof, "registration"), "personId", "149a0000-0000-4000-8000-000000000009");
      else if (mode === "plan") replaceField(field(proof, "registration"), "planId", "unapproved-plan");
      else if (mode === "date") replaceField(tx, "date", "2026-03-16T00:00:00.000Z");
      else if (mode === "id") replaceField(tx, "id", "not-actually-posted");
      else if (mode === "amount") {
        for (const leg of items(field(tx, "legs"))) object(field(leg, "amount")).value = ["499", "USD"];
      } else {
        const legs = items(field(tx, "legs"));
        replaceField(legs[0]!, "posting", "credit"); replaceField(legs[1]!, "posting", "debit");
      }
      const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.runContext, openingState: encoded });
      expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    });

  it.each(["sourceVersion", "amount", "missing-record", "erase-inventory", "remove", "rewrite", "duplicate"] as const)(
    "rejects %s checkpoint tampering even with a recomputed integrity fingerprint", mode => {
      const f = replayFixture(true, 25), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
      const artifact = createPortableHouseholdReplayArtifact(summary), wire = expanded(artifact.encoded);
      const checkpoints = items(field(wire, "checkpoints"));
      const first = checkpoints[0]!, records = field(first, "records");
      const receiptDelta = field(records, "d2SettlementReceipts"), set = field(receiptDelta, "set");
      if (mode === "missing-record" || mode === "erase-inventory") {
        removeField(records, "d2SettlementReceipts");
        if (mode === "erase-inventory") for (const key of ["postedTransactionIds", "recognitionIds", "settlementIds", "externalIdempotencyKeys"])
          object(field(field(field(first, "identities"), key), "add")).value = [];
      }
      else if (mode === "remove") {
        const second = checkpoints[1]!;
        object(field(field(field(second, "records"), "d2SettlementReceipts"), "remove")).value = ["receipt:portable-fsa:0"];
      } else if (mode === "rewrite") {
        const secondSet = field(field(field(checkpoints[1]!, "records"), "d2SettlementReceipts"), "set");
        const original = field(set, "receipt:portable-fsa:0");
        const replacement: Json = JSON.parse(JSON.stringify(original));
        const entries = items(replacement);
        for (const entry of entries) if (Array.isArray(entry) && entry[0] === "operationId") entry[1] = "rewritten-operation";
        items(secondSet).push(["receipt:portable-fsa:0", replacement]);
      } else if (mode === "duplicate") {
        items(set).push(["duplicate-receipt", field(set, "receipt:portable-fsa:0")]);
      } else {
        const receipt = field(set, "receipt:portable-fsa:0");
        if (mode === "sourceVersion") {
          for (const entry of items(field(receipt, "source"))) if (Array.isArray(entry) && entry[0] === "sourceVersion") entry[1] = "altered";
        } else object(field(receipt, "amount")).value = ["1001", "USD"];
      }
      const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.runContext, openingState: encoded });
      expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    });
});
