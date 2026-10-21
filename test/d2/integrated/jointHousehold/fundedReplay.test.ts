import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { money } from "../../../../src/values/index.js";
import { ids } from "./combinedScenario.js";
import { fundedHousehold, resetSources } from "./fundedScenario.js";

beforeEach(resetSources);
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const object = (x: Json): { [key: string]: Json } => x as { [key: string]: Json };
const items = (x: Json): Json[] => object(x).value as Json[];
const field = (x: Json, key: string): Json => (items(x).find(e => Array.isArray(e) && e[0] === key) as Json[])[1]!;
const replace = (x: Json, key: string, value: Json): void => {
  (items(x).find(e => Array.isArray(e) && e[0] === key) as Json[])[1] = value;
};
const expand = (encoded: string): Json => {
  const refs = new Map<number, Json>();
  const visit = (x: Json): Json => {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(visit);
    if (x.kind === "definition") {
      const [id, payload] = x.value as Json[];
      const result = visit(payload!); refs.set(id as number, result); return result;
    }
    if (x.kind === "reference") return JSON.parse(JSON.stringify(refs.get(x.value as number))) as Json;
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, visit(v)]));
  };
  return visit(JSON.parse(encoded) as Json);
};

describe("#149 S8-3 real joint-household funded RMD portable acceptance", () => {
  it.each([13, 25])("replays %i months through detail, summary and independent fresh-process publishers", months => {
    const s = fundedHousehold({ months });
    const summary = runHouseholdKernel({ kernel: s.kernel, runContext: s.context }), detail = s.run();
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(months);
    expect(detail.periods, JSON.stringify(detail.diagnostics)).toHaveLength(months);
    expect(summary.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(detail.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(summary.status).toBe("incomplete"); expect(detail.status).toBe("incomplete");
    expect(summary.state).toEqual(detail.state); expect(summary.primitiveState).toEqual(detail.primitiveState);
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.outputCapabilities).toEqual(detail.outputCapabilities);
    // Neither missing 2027 nor missing 2028 law becomes complete by carrying
    // the funded 2026 annual obligation into a new tax year.
    expect(summary.outputCapabilities?.rmdSatisfaction?.status).toBe("incomplete");
    expect(summary.outputCapabilities?.retirementCashTransfer?.status).toBe("complete");
    expect(summary.outputCapabilities?.retirementTax?.status).toBe("incomplete");
    expect(s.satisfaction(summary.state)).toMatchObject({ coverage: "incomplete", reason: "source_not_qualified" });
    expect(s.satisfaction(summary.state).annual!.obligations.map(o => o.satisfied.amount.toString())).toEqual(["700"]);
    expect(detail.periods.every(p => p.statements.income.equals(money("1000")))).toBe(true);
    expect(Object.keys(summary.state.d2PostedTransactions!)).toHaveLength(6);
    expect(Object.keys(summary.state.retirementDistributionAllocations!)).toHaveLength(2);
    expect(Object.keys(summary.state.d2SettlementReceipts!)).toHaveLength(2);
    const txs = detail.periods.flatMap(p => p.transactions);
    expect(txs.filter(t => t.type === "retirement_cash_transfer").map(t => t.id)).toEqual(["withdraw:s8-3:first", "withdraw:s8-3:second"]);
    expect(new Set(txs.map(t => t.id)).size).toBe(txs.length);
    expect(detail.state.identities.postedTransactionIds).toHaveLength(txs.length);
    const checkpoints = exportHouseholdReplayCheckpoints(summary);
    expect(checkpoints.map(c => c.at)).toEqual(months === 13 ? ["2027-01-01T00:00:00.000Z"]
      : ["2027-01-01T00:00:00.000Z", "2028-01-01T00:00:00.000Z"]);
    for (const c of checkpoints) {
      expect(c.state.d2PostedTransactions).toEqual(detail.state.d2PostedTransactions);
      expect(c.state.retirementDistributionAllocations).toEqual(detail.state.retirementDistributionAllocations);
      expect(c.state.accounts[ids.retirement]!.cash.amount.toString()).toBe("300");
    }
    const artifact = createPortableHouseholdReplayArtifact(summary);
    expect(artifact.version).toBe("household-replay/v3");
    const wire = expand(artifact.encoded), deltas = items(field(wire, "checkpoints"));
    if (months === 25) for (const key of ["d2PostedTransactions", "d2SettlementReceipts", "retirementDistributionAllocations"]) {
      const delta = field(field(deltas[1]!, "records"), key);
      expect(items(field(delta, "set"))).toEqual([]); expect(items(field(delta, "remove"))).toEqual([]);
    }
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(exportHouseholdReplayCheckpoints(restored)).toEqual(checkpoints);
    const directory = mkdtempSync(join(tmpdir(), "pfm-s8-funded-"));
    const child = (selected: (typeof detail.periods)[number]["period"], mode: string) => {
      const path = join(directory, "payload.json"); writeFileSync(path, JSON.stringify({ artifact, selected }));
      const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./fundedPortableWorker.ts", import.meta.url))], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30_000,
        env: { ...process.env, PFM_S8_FUNDED_PAYLOAD: path, PFM_S8_FUNDED_MONTHS: String(months), PFM_S8_FUNDED_SOURCE_MODE: mode } });
      expect(worker.error).toBeUndefined(); expect(worker.status, worker.stderr).toBe(0);
      return JSON.parse(worker.stdout);
    };
    try {
      for (const index of [0, 1, months - 1]) {
        const selected = detail.periods[index]!.period, expected = replayHouseholdForecastWindow(summary, selected);
        const portable = replayHouseholdForecastWindow(restored, selected);
        expect(portable.state).toEqual(expected.state); expect(portable.periods).toEqual([detail.periods[index]]);
        expect(replayHouseholdForecastWindow(restored, selected)).toEqual(portable);
        expect(child(selected, "present")).toEqual({ state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods),
          publisherRead: true, qualification: "qualified", coverage: "incomplete", satisfied: ["700"] });
      }
      const selected = detail.periods.at(-1)!.period, expected = replayHouseholdForecastWindow(summary, selected);
      for (const mode of ["absent", "tampered"]) {
        const result = child(selected, mode);
        expect(result.state).toBe(canonicalSerialize(expected.state));
        expect(result.publisherRead).toBe(true);
        expect(result.qualification).toBe(mode === "absent" ? "unavailable" : "incomplete");
        expect(result.coverage).toBe("incomplete"); expect(result.satisfied).toEqual(["0"]);
        expect(result.newPosting).toEqual({ periods: 0, state: canonicalSerialize(s.opening) });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 120_000);

  it.each(["authorization", "allocation", "proof"])("rejects portable %s forgery with recomputed integrity", mode => {
    const s = fundedHousehold({ months: 13 }), out = runHouseholdKernel({ kernel: s.kernel, runContext: s.context });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(13);
    const artifact = createPortableHouseholdReplayArtifact(out), wire = expand(artifact.encoded);
    const records = field(items(field(wire, "checkpoints"))[0]!, "records");
    const journal = field(field(records, "retirementDistributionAllocations"), "set");
    const record = field(journal, "withdraw:s8-3:first");
    if (mode === "authorization") replace(record, "authorizationId", "forged");
    else if (mode === "allocation") replace(items(field(record, "allocations"))[0]!, "approvalId", "forged");
    else {
      const proof = field(field(field(records, "d2PostedTransactions"), "set"), "withdraw:s8-3:first");
      replace(field(proof, "transaction"), "date", "2026-01-21T00:00:00.000Z");
    }
    const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: s.context, openingState: encoded });
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    expect(out.state.accounts[ids.bank]!.cash.amount.toString()).toBe("6605.07");
  });
});
