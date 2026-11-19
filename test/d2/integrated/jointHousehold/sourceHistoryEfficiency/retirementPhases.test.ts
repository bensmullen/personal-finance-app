import { expect, it, vi } from "vitest";
import { attachRetirementCash } from "../../../../../src/simulation/d2/integration/retirementCash/index.js";
import { observeHouseholdForecastSources, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact, type ReplayRestoreMeasurement } from "../../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { money } from "../../../../../src/values/index.js";
import { funded, sources } from "../../retirementCash/fundedScenario.js";
import { fixture, ids } from "../../retirementCash/scenario.js";

it.each([1, 2])("attributes posting and portable replay costs for %i funded withdrawals", count => {
  const f = fixture();
  const plan = funded(f, `phase-cost:${count}`, Array<string>(count).fill("50"));
  const marker = "UNIQUE_FULL_ORIGINAL_RETIREMENT_CATALOG_".repeat(256);
  const cash = { ...plan.raw.cash, members: plan.raw.cash.members.map(member => ({ ...member,
    source: { ...member.source, sourcePublication: marker } })) };
  sources.set(plan.raw.sourceId, { ...plan.raw, cash });
  const reads = vi.spyOn(sources, "get");
  const measure = <T>(phase: string, operation: () => T): T => {
    reads.mockClear();
    const started = performance.now();
    const cpuStart = process.cpuUsage();
    const value = operation();
    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuStart);
    console.info("Synthetic retirement phase", JSON.stringify({ count, phase, wallMs,
      cpuMicroseconds: cpu.user + cpu.system, publisherReads: reads.mock.calls.length }));
    return value;
  };
  try {
    const kernel = measure("pin_original", () => attachRetirementCash(f.kernel, { ...cash, fundedRmd: plan.reference }).kernel);
    const forecast = measure("selected_run_and_posting", () => runHouseholdKernel({ kernel, runContext: f.context }));
    expect(forecast.periods).toHaveLength(1);
    expect(forecast.state.accounts[ids.ira]!.cash.equals(money(count === 1 ? "950" : "900"))).toBe(true);
    expect(forecast.state.accounts[ids.bank]!.cash.equals(money(count === 1 ? "250" : "300"))).toBe(true);
    const receipts = Object.values(forecast.state.retirementDistributionAllocations!);
    expect(receipts).toHaveLength(count);
    const serialized = measure("serialize_config_and_receipts", () => [
      canonicalSerialize(kernel.executable.participants![0]!.economicInputs), canonicalSerialize(receipts),
    ]);
    const artifact = measure("portable_export", () => createPortableHouseholdReplayArtifact(forecast));
    expect(reads.mock.calls).toHaveLength(count);
    for (const value of [...serialized, artifact.encoded]) expect(value).not.toContain("UNIQUE_FULL_ORIGINAL_RETIREMENT_CATALOG_");
    let cold: ReplayRestoreMeasurement | undefined;
    const transported = JSON.parse(JSON.stringify(artifact)) as unknown;
    const restored = measure("cold_restore_and_regenerate", () => restorePortableHouseholdReplayArtifact(transported, {
      now: () => performance.now(), record: measurement => { cold = measurement; },
    }));
    expect(cold?.cache).toBe("cold");
    console.info("Synthetic retirement portable restore", JSON.stringify({ count, decodeMs: cold?.decodeMs,
      checkpointRestoreValidationMs: cold?.checkpointRestoreValidationMs, sourceRequalificationMs: cold?.sourceRequalificationMs }));
    const replayed = measure("replay_window", () => replayHouseholdForecastWindow(restored, f.period));
    expect(replayed.state).toEqual(forecast.state);
    measure("outward_source_observation", () => observeHouseholdForecastSources(restored));
    expect(reads.mock.calls).toHaveLength(count);
  } finally {
    reads.mockRestore();
    sources.delete(plan.raw.sourceId);
  }
});
