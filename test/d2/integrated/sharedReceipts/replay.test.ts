import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { actualJournals, availability, independentSources, registerMockAuthorities } from "./scenario.js";
import { replayFixture } from "./replayScenario.js";

registerMockAuthorities();
beforeEach(() => { independentSources.clear(); actualJournals.clear(); availability.source = true; availability.calls = 0; availability.failAt = 0; });

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

  it("refuses intact receipt bytes when independent actual posted journals are unavailable", () => {
    const f = replayFixture(), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    actualJournals.clear();
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  });

  it("preserves legacy v1/v2/v3 absence and explicitly empty optional records", () => {
    const f = replayFixture(false), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    for (const version of ["household-replay/v1", "household-replay/v2", "household-replay/v3"] as const) {
      const restored = restorePortableHouseholdReplayArtifact({ ...artifact, version });
      expect(replayHouseholdForecastWindow(restored, summary.periods.at(-1)!.period).state.d2SettlementReceipts).toBeUndefined();
    }
    const wire = expanded(artifact.encoded);
    for (const checkpoint of items(field(wire, "checkpoints"))) removeField(field(checkpoint, "records"), "d2SettlementReceipts");
    const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.runContext, openingState: encoded });
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).not.toThrow();
    const empty = replayFixture(false, 13, true);
    const emptySummary = runHouseholdKernel({ kernel: empty.kernel, runContext: empty.runContext });
    const emptyRestored = restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(emptySummary));
    expect(emptyRestored.replay.kernel.executable.reconciledOpeningState.d2SettlementReceipts).toEqual({});
    expect(replayHouseholdForecastWindow(emptyRestored, emptySummary.periods.at(-1)!.period).state.d2SettlementReceipts).toEqual({});
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
