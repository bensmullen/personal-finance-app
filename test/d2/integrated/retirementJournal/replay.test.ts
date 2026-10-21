import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { applyHouseholdExecutionOverlay, exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { admit, fixture, registerAuthority } from "./scenario.js";
import { laterDistribution, participant, registerParticipantCodec } from "./participant.js";

beforeAll(registerAuthority);
beforeAll(registerParticipantCodec);

// Expand sharing only for adversarial wire edits; recomputed integrity is never
// treated as independent publisher or original posting authority.
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

describe("J1 portable v3 structural retirement evidence", () => {
  it.each([13, 25])("preserves an in-horizon posting through %s-month sparse checkpoints and independent replay", months => {
    const f = fixture(months, false); admit(laterDistribution());
    const kernel = applyHouseholdExecutionOverlay(f.kernel, { participants: [participant()] });
    const summary = runHouseholdKernel({ kernel, runContext: f.runContext });
    const detail = runHouseholdKernel({ kernel, runContext: f.runContext, resultTier: "detail" });
    expect(summary.periods).toHaveLength(months);
    expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(detail.state));
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(Object.keys(summary.state.retirementDistributionAllocations!)).toEqual([laterDistribution().transactionId]);
    const selected = summary.periods.at(-1)!.period, expected = replayHouseholdForecastWindow(summary, selected);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const restored = restorePortableHouseholdReplayArtifact(artifact);
    expect(canonicalSerialize(exportHouseholdReplayCheckpoints(restored))).toBe(canonicalSerialize(exportHouseholdReplayCheckpoints(summary)));
    const directory = mkdtempSync(join(tmpdir(), "pfm-retirement-j1-later-"));
    try {
      const path = join(directory, "payload.json"); writeFileSync(path, JSON.stringify({ artifact, selected, rows: true, sources: true }), "utf8");
      const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
        env: { ...process.env, PFM_RETIREMENT_J1_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      });
      expect(worker.status, worker.stderr).toBe(0);
      expect(JSON.parse(worker.stdout)).toEqual({ state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods) });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("discards the actual kernel period's journal, proof, IDs and cash when a later operation fails", () => {
    const f = fixture(13, false); admit(laterDistribution());
    const result = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(f.kernel, { participants: [participant(true)] }), runContext: f.runContext });
    expect(result.diagnostics.map(d => d.code)).toContain("J1_LATE_PERIOD_FAILURE");
    expect(result.state.retirementDistributionAllocations).toBeUndefined();
    expect(result.state.d2PostedTransactions).toBeUndefined();
    expect(result.state.identities.postedTransactionIds).toHaveLength(0);
    expect(canonicalSerialize(result.state)).toBe(canonicalSerialize(f.opening));
  });
  it.each([13, 25])("preserves %s-month summary/detail and independent replay with/without journal and allocation rows", months => {
    const directory = mkdtempSync(join(tmpdir(), "pfm-retirement-j1-"));
    try {
      for (const journal of [false, true]) for (const rows of [false, true]) {
        const f = fixture(months, journal, rows);
        const summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
        const detail = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext, resultTier: "detail" });
        expect(summary.periods).toHaveLength(months);
        expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(detail.state));
        expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
        const artifact = createPortableHouseholdReplayArtifact(summary), selected = summary.periods.at(-1)!.period;
        const expected = replayHouseholdForecastWindow(summary, selected);
        const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
        expect(canonicalSerialize(exportHouseholdReplayCheckpoints(restored))).toBe(canonicalSerialize(exportHouseholdReplayCheckpoints(summary)));
        expect(canonicalSerialize(replayHouseholdForecastWindow(restored, selected).state)).toBe(canonicalSerialize(expected.state));
        for (const sources of [true, false]) {
          const path = join(directory, "payload.json"); writeFileSync(path, JSON.stringify({ artifact, selected, rows, sources }), "utf8");
          const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
            fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
            env: { ...process.env, PFM_RETIREMENT_J1_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
          });
          expect(worker.status, worker.stderr).toBe(0);
          // Missing source owner preserves actual cash and structural evidence;
          // the record still explicitly says not_applied / tax incomplete.
          expect(JSON.parse(worker.stdout)).toEqual({ state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods) });
        }
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("reads legacy v1/v2/v3 artifacts and old sparse checkpoints without inventing journal authority", () => {
    const f = fixture(13, false), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    for (const version of ["household-replay/v1", "household-replay/v2", "household-replay/v3"] as const) {
      const restored = restorePortableHouseholdReplayArtifact({ ...artifact, version });
      expect(replayHouseholdForecastWindow(restored, summary.periods.at(-1)!.period).state.retirementDistributionAllocations).toBeUndefined();
    }
    const wire = expanded(artifact.encoded);
    for (const checkpoint of items(field(wire, "checkpoints"))) remove(field(checkpoint, "records"), "retirementDistributionAllocations");
    const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.runContext, openingState: encoded });
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).not.toThrow();
  });

  it.each(["remove", "rewrite", "gross", "source", "proof", "year", "approval", "owner"] as const)(
    "rejects %s checkpoint tampering after integrity is recomputed", mode => {
      const f = fixture(25, true, true), summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
      const artifact = createPortableHouseholdReplayArtifact(summary), wire = expanded(artifact.encoded);
      const checkpoints = items(field(wire, "checkpoints")), first = checkpoints[0]!, second = checkpoints[1]!;
      const records = field(first, "records"), set = field(field(records, "retirementDistributionAllocations"), "set");
      const d = field(set, "posted:first");
      if (mode === "remove") object(field(field(field(second, "records"), "retirementDistributionAllocations"), "remove")).value = ["posted:first"];
      else if (mode === "rewrite") {
        const changed: Json = JSON.parse(JSON.stringify(d)); replace(changed, "operationId", "changed");
        items(field(field(field(second, "records"), "retirementDistributionAllocations"), "set")).push(["posted:first", changed]);
      } else if (mode === "proof") remove(field(field(records, "d2PostedTransactions"), "set"), "posted:first");
      else if (mode === "gross") object(field(d, "gross")).value = ["501", "USD"];
      else if (mode === "source") replace(field(d, "source"), "sourceVersion", "changed");
      else if (mode === "year") replace(d, "taxYear", 2027);
      else if (mode === "owner") replace(d, "personId", "204a0000-0000-4000-8000-000000000099");
      else replace(items(field(d, "allocations"))[0]!, "approvalId", "forged-approval");
      const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.runContext, openingState: encoded });
      expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    });
});
