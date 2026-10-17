import { describe, expect, it } from "vitest";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { runHouseholdKernel, replayHouseholdForecastWindow, exportHouseholdReplayCheckpoints, registerHouseholdReplayCheckpoints } from "../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { USD } from "../src/values/index.js";
import { PerformanceRegistry, type PerformanceObserver } from "../src/diagnostics/performance.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest } from "./fixtures/d1IntegratedHousehold.js";
import { taxHouseholdFixture } from "./fixtures/t1aTaxHouseholds.js";

function fixture(months = 36, integrated = false) {
  const end = new Date(Date.UTC(2026, months, 1)).toISOString().slice(0, 10);
  const base = integrated ? d1IntegratedCompilerRequest() : createGoldenHouseholdForecastRequest().compiler;
  const compiler = { ...base,
    cashFlow: { ...base.cashFlow!, simulationEnd: end, months },
    investments: { ...base.investments!, simulationEnd: end, months },
    liabilities: { ...base.liabilities!, simulationEnd: end, months } };
  const compiled = compileHouseholdProjection(integrated ? createD1IntegratedHousehold({ projectAnnualFacts: true }) : createGoldenHouseholdDraft(), compiler);
  if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled));
  const runContext = createRunContext({ runId: runId("d1610000-0000-4000-8000-000000000001"), scenarioId: scenarioId(ids.rootScenario),
    asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"),
    simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant(`${end}T00:00:00.000Z`), baseCurrency: USD });
  const request = { kernel: compiled.value.executionKernel!, runContext };
  return { source: runHouseholdKernel(request), detail: () => runHouseholdKernel({ ...request, resultTier: "detail" }) };
}
const transported = (source: ReturnType<typeof fixture>["source"]) =>
  restorePortableHouseholdReplayArtifact(structuredClone(JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(source)))));
function meter() {
  const registry = new PerformanceRegistry(); let tick = 0;
  const observer: PerformanceObserver = { clock: { now: () => ++tick }, sink: registry,
    context: { runId: "portable-checkpoint", dataClassification: "synthetic", modelCounts: {}, executionLocation: "local_node", cacheState: "not_applicable" } };
  return { observer, counters: () => registry.latest("engine.execute")!.resources!.structuralCounters! };
}

describe("portable sparse household replay checkpoints", () => {
  it("round-trips late one and twelve month windows with the same settled detail and bounded actual work", () => {
    const { source, detail } = fixture(); const original = detail(), restored = transported(source);
    expect(restored).not.toBe(source);
    for (const [start, length] of [[25, 1], [23, 12], [24, 12], [0, 1], [25, 1]] as const) {
      const window = { start: source.periods[start]!.period.start, end: source.periods[start + length - 1]!.period.end };
      const metrics = meter();
      const actual = replayHouseholdForecastWindow(restored, window, metrics.observer);
      expect(actual.periods).toEqual(original.periods.slice(start, start + length));
      expect(actual.periods).toEqual(replayHouseholdForecastWindow(source, window).periods);
      expect(actual.runMetadata).toEqual(source.runMetadata);
      expect(metrics.counters().householdPeriodsExecuted).toBeLessThanOrEqual(length + 11);
      expect(metrics.counters().replayCheckpointResumes).toBe(start < 12 ? 0 : 1);
      expect(actual.periods.flatMap(period => period.transactions).filter(tx => tx.type === "mortgage_interest_settlement")).toEqual(
        original.periods.slice(start, start + length).flatMap(period => period.transactions).filter(tx => tx.type === "mortgage_interest_settlement"));
    }
  });
  it("transports domain and tax runtime using supported value constructors", () => {
    const { source, detail } = fixture(24, true), restored = transported(source);
    expect(exportHouseholdReplayCheckpoints(source)).toHaveLength(source.periods.filter((period, index) =>
      (index + 1) % 12 === 0 && period.period.end < source.replay.runContext.simulationEnd).length);
    // The integrated fixture can stop before its requested end. A checkpoint
    // cannot resume a period that precedes the checkpoint's boundary.
    expect(source.periods.length, JSON.stringify(source.diagnostics)).toBeGreaterThan(0);
    const index = Math.min(12, source.periods.length - 1), selected = source.periods[index]!;
    const metrics = meter(), replay = replayHouseholdForecastWindow(restored, selected.period, metrics.observer);
    expect(replay.periods).toEqual(detail().periods.slice(index, index + 1));
    expect(metrics.counters().replayCheckpointResumes).toBe(index >= 12 ? 1 : 0);
    expect(metrics.counters().householdPeriodsExecuted).toBeLessThanOrEqual(12);
    expect(replay.outputCapabilities).toEqual(selected.outputCapabilities);
  });
  it.each([13, 24, 36])("preserves T1A canonical state, tax runtime and ordered evidence through %s months", months => {
    const tax = taxHouseholdFixture({ months });
    const source = runHouseholdKernel({ kernel: tax.kernel, runContext: tax.context });
    expect(source.periods, JSON.stringify(source.diagnostics)).toHaveLength(months);
    const restored = restorePortableHouseholdReplayArtifact(structuredClone(createPortableHouseholdReplayArtifact(source)));
    const sameCanonical = (actual: unknown, expected: unknown, stage: string) => {
      const left = canonicalSerialize(actual), right = canonicalSerialize(expected);
      let at = 0; while (at < left.length && left[at] === right[at]) at++;
      expect(left, `${stage}: first canonical difference ${at}; actual ${left.slice(Math.max(0, at - 100), at + 400)}; expected ${right.slice(Math.max(0, at - 100), at + 400)}`).toBe(right);
    };
    // Isolate execution-input transport, checkpoint transport, and continuation.
    sameCanonical(restored.replay.kernel.canonicalInputs, source.replay.kernel.canonicalInputs, "execution inputs");
    sameCanonical(exportHouseholdReplayCheckpoints(restored as typeof source), exportHouseholdReplayCheckpoints(source), "checkpoint state/primitive/tax runtime");
    const rerun = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    sameCanonical(rerun.state, source.state, "full rerun state (no checkpoint resume)");
    expect(rerun.diagnostics).toEqual(source.diagnostics);
    expect(rerun.outputCapabilities).toEqual(source.outputCapabilities);
    const detail = runHouseholdKernel({ kernel: tax.kernel, runContext: tax.context, resultTier: "detail" });
    for (const length of [1, Math.min(12, months - 12)]) {
      const start = months - length, selected = { start: source.periods[start]!.period.start, end: source.periods.at(-1)!.period.end };
      const metrics = meter(), actual = replayHouseholdForecastWindow(restored, selected, metrics.observer);
      const local = replayHouseholdForecastWindow(source, selected);
      sameCanonical(actual.state, detail.state, "resumed vs untransported full detail state");
      sameCanonical(actual.primitiveState, detail.primitiveState, "resumed primitive runtime");
      expect(actual).toEqual(local);
      expect(actual.periods).toEqual(detail.periods.slice(start));
      expect(actual.periods.flatMap(period => period.transactions)).toEqual(detail.periods.slice(start).flatMap(period => period.transactions));
      expect(actual.runMetadata).toEqual(source.runMetadata);
      expect(metrics.counters().replayCheckpointResumes).toBe(1);
      expect(metrics.counters().householdPeriodsExecuted).toBeLessThanOrEqual(length + 11);
    }
  });
  it("rejects missing, corrupt, truncated, unknown-version and mismatched checkpoint evidence", () => {
    const { source } = fixture(); const artifact = createPortableHouseholdReplayArtifact(source);
    for (const bad of [null, {}, { ...artifact, version: "unknown" }, { ...artifact, integrity: undefined },
      { ...artifact, encoded: artifact.encoded.slice(0, -10) },
      { ...artifact, encoded: artifact.encoded.replace("2026-01-01", "2025-01-01") }])
      expect(() => restorePortableHouseholdReplayArtifact(bad)).toThrow();
    const checkpoints = exportHouseholdReplayCheckpoints(source), target = transported(source);
    for (const bad of [[], [...checkpoints].reverse(), checkpoints.slice(1),
      checkpoints.map((value, index) => index ? value : { ...value, at: source.periods[0]!.period.end }),
      checkpoints.map(value => ({ ...value, runId: "d1610000-0000-4000-8000-000000000099" as typeof value.runId })),
      checkpoints.map(value => ({ ...value, outputCapabilities: {} })),
      checkpoints.map(value => ({ ...value, fingerprint: "wrong" as typeof value.fingerprint }))])
      expect(() => registerHouseholdReplayCheckpoints(target, bad)).toThrow(/BASIS_MISMATCH/);
    const other = fixture(24).source;
    expect(() => registerHouseholdReplayCheckpoints(other, checkpoints)).toThrow();
    expect(replayHouseholdForecastWindow(target, source.periods[25]!.period).periods).toEqual(replayHouseholdForecastWindow(source, source.periods[25]!.period).periods);
  });
  it("keeps legacy opening replay usable without advertising portable checkpoints", () => {
    const { source } = fixture(12);
    const v3 = createPortableHouseholdReplayArtifact(source);
    for (const version of ["household-replay/v1", "household-replay/v2"] as const) {
      const restored = restorePortableHouseholdReplayArtifact({ ...v3, version, integrity: undefined });
      expect(replayHouseholdForecastWindow(restored, source.periods[0]!.period).periods).toEqual(replayHouseholdForecastWindow(source, source.periods[0]!.period).periods);
    }
  });
  it("records sparse count and linear encoded-byte growth on bounded synthetic horizons", () => {
    const short = fixture(24).source, longer = fixture(48).source;
    const bytes = (source: typeof short) => new TextEncoder().encode(createPortableHouseholdReplayArtifact(source).encoded).byteLength;
    expect(exportHouseholdReplayCheckpoints(short)).toHaveLength(1);
    expect(exportHouseholdReplayCheckpoints(longer)).toHaveLength(3);
    expect(bytes(longer)).toBeLessThan(bytes(short) * 3);
    expect(bytes(longer)).toBeLessThan(8_000_000);
  });
});
