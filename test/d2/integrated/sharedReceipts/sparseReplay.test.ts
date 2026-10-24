import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { exportHouseholdReplayCheckpointRoots, replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact,
  type ReplayExportMeasurement, type ReplayRestoreMeasurement } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { createIndexedExecutionState, snapshotAuthoritativeCheckpoint, PersistentStringIndex } from "../../../../src/state/index.js";
import { deriveStatements } from "../../../../src/statements/index.js";
import { decimal, money, USD } from "../../../../src/values/index.js";
import { mixedFixture, resetSourceCalls, sourceCalls } from "./sparseScenario.js";
import { ids as payrollIds } from "../../health/premiums/payrollPort/scenario.js";
import { expandedWire, wireField, wireItems, replaceWireField } from "./wireFixture.js";

// Observe the actual index implementation, including constructors, structural
// validators, source verification and the registrar. Inner-loop counters alone
// would miss a whole-history materialization elsewhere in the restore path.
const indexWork = () => {
  let nodes = 0, rows = 0;
  const changes = PersistentStringIndex.prototype.changesSince, entries = PersistentStringIndex.prototype.entries;
  const changeSpy = vi.spyOn(PersistentStringIndex.prototype, "changesSince").mockImplementation(function (this: PersistentStringIndex<unknown>, before: PersistentStringIndex<unknown>) {
    const result = changes.call(this, before); nodes += result.visitedNodes; return result;
  });
  const entrySpy = vi.spyOn(PersistentStringIndex.prototype, "entries").mockImplementation(function* (this: PersistentStringIndex<unknown>) {
    for (const entry of entries.call(this)) { rows++; yield entry; }
  });
  return { stop: () => { changeSpy.mockRestore(); entrySpy.mockRestore(); return { nodes, rows }; } };
};

describe("mixed P1/P2 cold sparse checkpoint work", () => {
  it("exports and cold-restores 1/12/120 histories and checkpoints with proportional total work and transport", () => {
    const observations: { count: number; exported: ReplayExportMeasurement; restored: ReplayRestoreMeasurement;
      work: { nodes: number; rows: number } }[] = [];
    for (const count of [1, 12, 120]) {
      const f = mixedFixture(count), before = canonicalSerialize(f.opening);
      let exported!: ReplayExportMeasurement, restored!: ReplayRestoreMeasurement;
      resetSourceCalls();
      const meter = indexWork();
      let artifact!: ReturnType<typeof createPortableHouseholdReplayArtifact>;
      let cold!: ReturnType<typeof restorePortableHouseholdReplayArtifact>;
      let work!: ReturnType<typeof meter.stop>;
      try {
        artifact = createPortableHouseholdReplayArtifact(f.forecast, false, measurement => { exported = measurement; });
        expect(sourceCalls()).toBe(0);
        cold = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)), {
          now: () => performance.now(), includeCheckpointBytes: true, record: measurement => { restored = measurement; },
        });
      } finally { work = meter.stop(); }
      expect(restored.cache).toBe("cold");
      expect(restored.checkpointCount).toBe(count);
      expect(exported.checkpointCount).toBe(count);
      expect(restored.checkpointFullStateMaterializations).toBe(0);
      expect(exported.materializedCheckpointStates).toBe(0);
      // One cold authentication of each independent original/source. This
      // bound includes both old families and health/HELOC; it is independent
      // of count checkpoints containing the same append-only proof history.
      expect(sourceCalls()).toBeGreaterThanOrEqual(2 * count + 3);
      expect(sourceCalls()).toBeLessThanOrEqual(3 * count + 8);
      expect(exported.checkpointEqualityComparisons).toBeLessThanOrEqual(20);
      expect(exported.checkpointRecordChanges).toBeLessThan(100 * count + 200);
      expect(restored.checkpointRecordChanges!).toBeLessThan(100 * count + 200);
      expect(exported.checkpointIndexNodesVisited).toBeLessThan(500 * count + 500);
      expect(restored.checkpointIndexNodesVisited!).toBeLessThan(500 * count + 500);
      expect(work.rows).toBeLessThan(500 * count + 500);
      const flows = deriveStatements(f.opening, Object.values(f.opening.d2PostedTransactions!).map(p => p.transaction), USD);
      expect(f.opening.accounts[payrollIds.cash]!.cash.equals(money("750").times(decimal(String(count))))).toBe(true);
      expect(flows.income.equals(money("1000").times(decimal(String(count))))).toBe(true);
      expect(flows.expenses.equals(money("150").times(decimal(String(count))).plus(money("25.10")))).toBe(true);
      for (const index of new Set([0, Math.floor(count / 2), count - 1])) {
        const roots = exportHouseholdReplayCheckpointRoots(cold);
        expect(canonicalSerialize(roots[index]!.state)).toBe(before);
      }
      for (const length of [1, Math.min(12, f.forecast.periods.length)]) {
        const selected = { start: f.forecast.periods.at(-length)!.period.start, end: f.forecast.periods.at(-1)!.period.end };
        const expected = replayHouseholdForecastWindow(f.forecast, selected), actual = replayHouseholdForecastWindow(cold, selected);
        expect(canonicalSerialize(actual)).toBe(canonicalSerialize(expected));
        expect(canonicalSerialize(actual.state)).toBe(before);
      }
      observations.push({ count, exported, restored, work });
      const selected = f.forecast.periods.at(-1)!.period, expected = replayHouseholdForecastWindow(f.forecast, selected);
      const directory = mkdtempSync(join(tmpdir(), "pfm-sparse-mixed-"));
      try {
        for (const sources of [true, false]) {
          const path = join(directory, "payload.json");
          writeFileSync(path, JSON.stringify({ artifact, selected, count, sources }), "utf8");
          const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
            fileURLToPath(new URL("./sparseWorker.ts", import.meta.url))], {
            env: { ...process.env, PFM_SPARSE_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
          });
          expect(child.status, child.stderr).toBe(0);
          const result = JSON.parse(child.stdout);
          if (!sources) expect(result).toEqual({ rejected: true });
          else {
            expect(result.state).toBe(canonicalSerialize(expected.state));
            expect(result.periods).toBe(canonicalSerialize(expected.periods));
            expect(result.calls).toBeLessThanOrEqual(3 * count + 8);
          }
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    const mid = observations[1]!, large = observations[2]!;
    expect(large.exported.encodedBytes).toBeLessThan(mid.exported.encodedBytes * 12);
    expect(large.exported.encodedValues).toBeLessThan(mid.exported.encodedValues * 12);
    expect(large.restored.serializedCheckpointBytes!).toBeLessThan(mid.restored.serializedCheckpointBytes! * 12);
    expect(large.work.rows).toBeLessThan(mid.work.rows * 12);
    expect(large.work.nodes).toBeLessThan(mid.work.nodes * 15);
  }, 120_000);

  it.each([false, true])("preserves frozen prior boundaries and honest principal-only=%s source journals", principalOnly => {
    const f = mixedFixture(1, principalOnly), artifact = createPortableHouseholdReplayArtifact(f.forecast);
    const cold = restorePortableHouseholdReplayArtifact({ ...artifact });
    const state = exportHouseholdReplayCheckpointRoots(cold)[0]!.state;
    const before = canonicalSerialize(state), fork = createIndexedExecutionState(state);
    fork.accounts[payrollIds.cash]!.cash = money("999");
    const snapshot = snapshotAuthoritativeCheckpoint(fork, state);
    expect(canonicalSerialize(state)).toBe(before);
    expect(snapshot.accounts[payrollIds.cash]!.cash.equals(money("999"))).toBe(true);
    expect(() => { state.accounts[payrollIds.cash]!.cash = money("1"); }).toThrow();
    expect(() => { delete state.accounts[payrollIds.cash]; }).toThrow();
    expect(Reflect.set(state.identities.postedTransactionIds, "0", "forged")).toBe(false);
    expect(Reflect.defineProperty(state.identities.postedTransactionIds, "toJSON", { value: () => ["forged"] })).toBe(false);
    expect(canonicalSerialize(state)).toBe(before);
    for (const version of ["household-replay/v1", "household-replay/v2"] as const) {
      const legacy = restorePortableHouseholdReplayArtifact({ ...artifact, version });
      expect(canonicalSerialize(replayHouseholdForecastWindow(legacy, f.forecast.periods.at(-1)!.period).state)).toBe(before);
    }
  });

  it("admits newly posted health originals between 1/12/120 boundaries without rescanning earlier source history", () => {
    for (const count of [1, 12, 120]) {
      const f = mixedFixture(count, false, true);
      let exported!: ReplayExportMeasurement, restored!: ReplayRestoreMeasurement;
      const artifact = createPortableHouseholdReplayArtifact(f.forecast, false, value => { exported = value; });
      resetSourceCalls();
      const cold = restorePortableHouseholdReplayArtifact({ ...artifact }, {
        now: () => performance.now(), record: value => { restored = value; },
      });
      expect(restored.checkpointCount).toBe(count);
      expect(restored.checkpointFullStateMaterializations).toBe(0);
      expect(sourceCalls()).toBeLessThanOrEqual(4 * count + 8);
      expect(exported.checkpointRecordChanges).toBeLessThan(150 * count + 200);
      expect(restored.checkpointRecordChanges!).toBeLessThan(150 * count + 200);
      const sourceRoots = exportHouseholdReplayCheckpointRoots(f.forecast), coldRoots = exportHouseholdReplayCheckpointRoots(cold);
      for (const index of new Set([0, Math.floor(count / 2), count - 1])) {
        expect(canonicalSerialize(coldRoots[index]!.state)).toBe(canonicalSerialize(sourceRoots[index]!.state));
        expect(Object.values(coldRoots[index]!.state.d2PostedTransactions!).filter(p => p.registration.kind === "payroll_health_deduction"))
          .toHaveLength(count + index + 1);
      }
      const selected = { start: f.forecast.periods.at(-12)!.period.start, end: f.forecast.periods.at(-1)!.period.end };
      expect(canonicalSerialize(replayHouseholdForecastWindow(cold, selected)))
        .toBe(canonicalSerialize(replayHouseholdForecastWindow(f.forecast, selected)));
      const postingPeriod = f.forecast.periods[12 * (count - 1)]!.period;
      const expectedPosting = replayHouseholdForecastWindow(f.forecast, postingPeriod);
      expect(canonicalSerialize(replayHouseholdForecastWindow(cold, postingPeriod))).toBe(canonicalSerialize(expectedPosting));
      const directory = mkdtempSync(join(tmpdir(), "pfm-sparse-growing-"));
      try {
        const path = join(directory, "payload.json");
        writeFileSync(path, JSON.stringify({ artifact, selected: postingPeriod, count, growing: true, sources: true }), "utf8");
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./sparseWorker.ts", import.meta.url))], {
          env: { ...process.env, PFM_SPARSE_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        });
        expect(child.status, child.stderr).toBe(0);
        const result = JSON.parse(child.stdout);
        expect(result.state).toBe(canonicalSerialize(expectedPosting.state));
        expect(result.periods).toBe(canonicalSerialize(expectedPosting.periods));
        expect(result.calls).toBeLessThanOrEqual(4 * count + 8);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }, 120_000);

  it.each(["payroll-source", "payroll-amount", "heloc-debit", "remove-inherited", "rename-inherited", "erase-identity"])(
    "rejects mixed-history %s after valid wire integrity is recomputed", mode => {
      const f = mixedFixture(12), artifact = createPortableHouseholdReplayArtifact(f.forecast);
      // Warm the original object too: mutating its exact wire must leave the
      // trusted-object fast path and perform independent cold validation.
      const mutable = { ...artifact };
      restorePortableHouseholdReplayArtifact(mutable);
      const wire = expandedWire(artifact.encoded), checkpoints = wireItems(wireField(wire, "checkpoints"));
      const proofId = Object.values(f.opening.d2PostedTransactions!).find(proof => proof.registration.kind ===
        (mode === "heloc-debit" ? "heloc_phase_service" : "payroll_health_deduction"))!.transaction.id;
      const record = (index: number) => wireField(wireField(checkpoints[index]!, "records"), "d2PostedTransactions");
      const proof = wireField(wireField(record(0), "set"), proofId), registration = wireField(proof, "registration");
      if (mode === "payroll-source") replaceWireField(wireField(wireField(registration, "deduction"), "source"), "electionId", "not-the-original-election");
      else if (mode === "payroll-amount") replaceWireField(wireField(registration, "deduction"), "employeeAmount", { kind: "money", value: ["149", "USD"] });
      else if (mode === "heloc-debit") replaceWireField(wireField(wireField(registration, "service"), "source"), "bankDebitId", "unauthenticated-debit");
      else if (mode !== "erase-identity") {
        // Both deletion and relabeling an unchanged inherited row must fail;
        // the next checkpoint cannot repair or silently forget actual history.
        wireItems(wireField(record(1), "remove")).push(proofId);
        if (mode === "rename-inherited") wireItems(wireField(record(1), "set")).push(["renamed-original", proof]);
      }
      if (mode === "erase-identity") wireItems(wireField(wireField(wireField(checkpoints[1]!, "identities"), "postedTransactionIds"), "remove")).push(proofId);
      const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.context, openingState: encoded });
      Object.assign(mutable, { encoded, integrity });
      expect(() => restorePortableHouseholdReplayArtifact(mutable)).toThrow("BASIS_MISMATCH");
    });
});
