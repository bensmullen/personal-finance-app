import { expect, it, vi } from "vitest";
import { validateAuthoritativeState } from "../../../../../src/state/index.js";
import { attachRetirementCash, evaluateFundedRmdSatisfaction } from "../../../../../src/simulation/d2/integration/retirementCash/index.js";
import { qualifyRetirementRecordedSource, readRetirementRawSource } from "../../../../../src/simulation/d2/integration/retirementCash/source.js";
import { observeHouseholdForecastSources, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact, type ReplayRestoreMeasurement } from "../../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { money } from "../../../../../src/values/index.js";
import { funded, sources } from "../../retirementCash/fundedScenario.js";
import { fixture, ids } from "../../retirementCash/scenario.js";

// The protected 1/2/13 benchmark owns the ordinary CI budget. Detailed
// instrumentation for the full batch runs only in a separate profiling job.
const counts = process.env.PFM_PROFILE_RETIREMENT_13 === "1" ? [13] : [1, 2];
it.each(counts)("attributes posting and portable replay costs for %i funded withdrawals", count => {
  const f = fixture();
  const plan = funded(f, `phase-cost:${count}`, Array<string>(count).fill("50"));
  const marker = "UNIQUE_FULL_ORIGINAL_RETIREMENT_CATALOG_".repeat(256);
  const cash = { ...plan.raw.cash, members: plan.raw.cash.members.map(member => ({ ...member,
    source: { ...member.source, sourcePublication: marker } })) };
  const published = { ...plan.raw, cash };
  sources.set(plan.raw.sourceId, published);
  const publicationBytes = Buffer.byteLength(canonicalSerialize(published));
  const lookup = sources.get.bind(sources);
  let returnedBytes = 0, traversedEnvelopeBytes = 0;
  const reads = vi.spyOn(sources, "get").mockImplementation(id => {
    const original = lookup(id);
    if (original !== published) return original;
    returnedBytes += publicationBytes;
    // Count one traversal per response even if the evaluator reads it again.
    let pending = 1;
    const visit = (value: unknown): unknown => {
      const record = value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
      if (!record && !Array.isArray(value)) {
        if (--pending === 0) traversedEnvelopeBytes += publicationBytes;
        return value;
      }
      const fields = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
      pending += fields.length - 1;
      if (pending === 0) traversedEnvelopeBytes += publicationBytes;
      const copy = Array.isArray(value) ? [...value] : { ...value as object };
      for (const [key, item] of fields) {
        let accessed = false, child: unknown;
        Object.defineProperty(copy, key, { enumerable: true, get: () => {
          if (!accessed) { child = visit(item); accessed = true; }
          return child;
        } });
      }
      return copy;
    };
    // Ordinary smoke measurements skip the getter instrumentation.
    return count === 13 ? visit(original) as typeof original : original;
  });
  const measure = <T>(phase: string, operation: () => T): T => {
    reads.mockClear();
    returnedBytes = 0;
    traversedEnvelopeBytes = 0;
    const started = performance.now();
    const cpuStart = process.cpuUsage();
    const value = operation();
    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuStart);
    console.info("Synthetic retirement phase", JSON.stringify({ count, phase, wallMs,
      cpuMicroseconds: cpu.user + cpu.system, publisherReads: reads.mock.calls.length, returnedBytes,
      ...(count === 13 ? { traversedEnvelopeBytes } : {}) }));
    return value;
  };
  try {
    const kernel = measure("pin_original", () => attachRetirementCash(f.kernel, { ...cash, fundedRmd: plan.reference }).kernel);
    const forecast = measure("selected_run_and_posting", () => runHouseholdKernel({ kernel, runContext: f.context }));
    expect(forecast.periods).toHaveLength(1);
    const gross = BigInt(count) * 50n;
    expect(forecast.state.accounts[ids.ira]!.cash.equals(money(String(1000n - gross)))).toBe(true);
    expect(forecast.state.accounts[ids.bank]!.cash.equals(money(String(200n + gross)))).toBe(true);
    const receipts = Object.values(forecast.state.retirementDistributionAllocations!);
    expect(receipts).toHaveLength(count);
    if (count === 13) {
      const originals = measure("read_full_originals", () => receipts.map(record => readRetirementRawSource(record.source, f.context)!));
      measure("rebuild_recorded_sources", () => receipts.forEach((record, index) => {
        expect(qualifyRetirementRecordedSource(originals[index]!, record.operationId, f.context, record.source.ruleVersion).status).toBe("qualified");
      }));
      measure("validate_committed_journal", () => validateAuthoritativeState(forecast.state));
      const j1 = measure("reconcile_account_year_j1", () => evaluateFundedRmdSatisfaction(plan.reference, forecast.state, f.context, f.period.end));
      expect(j1.annual?.obligations[0]?.satisfied).toEqual(money(String(gross)));
    }
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
}, counts[0] === 13 ? 120_000 : 5_000);
