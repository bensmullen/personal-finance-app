import { describe, expect, it, vi } from "vitest";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { compileHouseholdKernel, runHouseholdKernel, replayHouseholdForecastWindow, exportHouseholdReplayCheckpoints, registerHouseholdReplayCheckpoints } from "../src/simulation/householdExecution.js";
import * as periodExecution from "../src/simulation/period.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { restoreHouseholdForecastEvidence } from "../src/application/householdProjection.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { Quantity, Rate, RoundingPolicy, SHARE, USD, money, rateConvention } from "../src/values/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { PerformanceRegistry, type PerformanceObserver } from "../src/diagnostics/performance.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest } from "./fixtures/d1IntegratedHousehold.js";
import { taxHouseholdFixture } from "./fixtures/t1aTaxHouseholds.js";
import { applicationReplayArtifact } from "./fixtures/applicationReplay.js";

function fixture(months = 36, integrated = false) {
  const end = new Date(Date.UTC(2026, months, 1)).toISOString().slice(0, 10);
  const base = integrated ? d1IntegratedCompilerRequest() : createGoldenHouseholdForecastRequest().compiler;
  const compiler = { ...base,
    cashFlow: { ...base.cashFlow!, simulationEnd: end, months },
    investments: { ...base.investments!, simulationEnd: end, months },
    liabilities: { ...base.liabilities!, simulationEnd: end, months } };
  const model = integrated ? createD1IntegratedHousehold({ projectAnnualFacts: true }) : createGoldenHouseholdDraft();
  const compiled = compileHouseholdProjection(model, compiler);
  if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled));
  const runContext = createRunContext({ runId: runId("d1610000-0000-4000-8000-000000000001"), scenarioId: scenarioId(ids.rootScenario),
    asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"),
    simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant(`${end}T00:00:00.000Z`), baseCurrency: USD });
  const request = { kernel: compiled.value.executionKernel!, runContext };
  return { source: runHouseholdKernel(request), detail: () => runHouseholdKernel({ ...request, resultTier: "detail" }),
    model, artifact: () => applicationReplayArtifact(model, compiler, runContext) };
}
const transported = (f: ReturnType<typeof fixture>) =>
  restoreHouseholdForecastEvidence(JSON.parse(JSON.stringify(f.artifact())), structuredClone(f.model));
function meter() {
  const registry = new PerformanceRegistry(); let tick = 0;
  const observer: PerformanceObserver = { clock: { now: () => ++tick }, sink: registry,
    context: { runId: "portable-checkpoint", dataClassification: "synthetic", modelCounts: {}, executionLocation: "local_node", cacheState: "not_applicable" } };
  return { observer, counters: () => registry.latest("engine.execute")!.resources!.structuralCounters! };
}

describe("portable sparse household replay checkpoints", () => {
  it.each([
    { months: 1, quote: "100.4471698917043012", value: "151710.3400023864283547769060929684" },
    { months: 12, quote: "105.499999999999999718", value: "159800.303359604263937192554053000926" },
    { months: 36, quote: "117.424137499999999055", value: "178982.682646823536858179569432928635" },
  ])("cold restores the exact Golden quote and replays the final month of $months", ({ months, quote, value }) => {
    const f = fixture(months);
    const restored = transported(f);
    expect(restored.periods).toHaveLength(months);
    expect(canonicalSerialize(restored.periods)).toBe(canonicalSerialize(f.source.periods));
    expect(canonicalSerialize(restored.runMetadata)).toBe(canonicalSerialize(f.source.runMetadata));
    const executable = restored.replay.kernel.executable;
    const returnInput = executable.investmentInput!.returns.find(item => item.targetPositionId === ids.brokerageInvestment);
    expect(returnInput?.priceRounding).toMatchObject({ scale: 18, mode: "half_even" });
    expect(executable.reconciledOpeningState.positions[ids.brokerageInvestment]!.price.equals(money("100"))).toBe(true);

    const selected = restored.periods.at(-1)!;
    const metrics = meter();
    const replay = replayHouseholdForecastWindow(restored, selected.period, metrics.observer);
    expect(metrics.counters().replayCheckpointResumes).toBe(months === 36 ? 1 : 0);
    expect(canonicalSerialize(replay.periods)).toBe(canonicalSerialize(f.detail().periods.slice(-1)));
    expect(canonicalSerialize(replay.state)).toBe(canonicalSerialize(f.source.state));
    const brokerage = replay.state.positions[ids.brokerageInvestment]!;
    expect(brokerage.price.equals(money(quote))).toBe(true);
    expect(brokerage.quantity.equals(Quantity.parse("509.955482081557", SHARE))).toBe(true);
    expect(selected.investmentValue.equals(money(value))).toBe(true);
  });

  it("rejects a committed one-month archive with a historically cent-rounded sub-cent quote", () => {
    const { source } = fixture(1);
    const { runContext, kernel } = source.replay;
    const base = kernel.executable;
    const input = base.investmentInput!;
    const position = base.reconciledOpeningState.positions[ids.brokerageInvestment]!;
    const priceRounding = new RoundingPolicy(2, "half_up");
    const legacyKernel = compileHouseholdKernel({
      scenarioIdentity: base.scenarioIdentity,
      scenarioBindings: base.scenarioBindings,
      executionMonths: 1,
      reconciledPrimitiveState: {},
      reconciledOpeningState: createAuthoritativeState({
        accounts: { [position.accountId]: base.reconciledOpeningState.accounts[position.accountId]! },
        positions: {
          [position.id]: { ...position, price: money("0.004"), quantity: Quantity.parse("1000", SHARE), carryingValue: money("4") },
        },
      }),
      investmentInput: {
        ...input, purchases: [],
        returns: [{
          ...input.returns.find(item => item.targetPositionId === position.id)!,
          rate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
          priceRounding,
        }],
      },
    }, runContext.simulationStart);
    const execute = periodExecution.executePeriodWorkCandidate;
    // Reproduce the former boundary while committing the archive, including
    // its original fingerprint, summaries and terminal state.
    const legacy = vi.spyOn(periodExecution, "executePeriodWorkCandidate").mockImplementation((request, summary) =>
      execute({
        ...request,
        work: request.work.map(item => item.kind === "primitive" && item.request.primitiveId === "P23"
          ? { ...item, request: { ...item.request, parameters: { ...item.request.parameters, postingRounding: priceRounding } } }
          : item),
      }, summary));
    const restored = (() => {
      try {
        const old = runHouseholdKernel({ kernel: legacyKernel, runContext });
        expect(old.periods).toHaveLength(1);
        expect(old.periods[0]!.investmentValue.isZero()).toBe(true);
        const archive = restorePortableHouseholdReplayArtifact(structuredClone(createPortableHouseholdReplayArtifact(old)));
        expect(replayHouseholdForecastWindow(archive, old.periods[0]!.period).periods[0]!.investmentValue.isZero()).toBe(true);
        return archive;
      } finally {
        legacy.mockRestore();
      }
    })();
    const current = runHouseholdKernel({ kernel: legacyKernel, runContext });
    expect(canonicalSerialize(current.runMetadata)).toBe(canonicalSerialize(restored.runMetadata));
    expect(current.periods[0]!.investmentValue.equals(money("4"))).toBe(true);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => replayHouseholdForecastWindow(restored, restored.periods[0]!.period)).toThrow(
        expect.objectContaining({ issues: [expect.objectContaining({ code: "HOUSEHOLD_REPLAY_BASIS_MISMATCH" })] }),
      );
    }
  });

  it("round-trips late one and twelve month windows with the same settled detail and bounded actual work", () => {
    const f = fixture(), { source, detail } = f; const original = detail(), restored = transported(f);
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
    const f = fixture(24, true), { source, detail } = f, restored = transported(f);
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
    const tax = taxHouseholdFixture({ months, employerOriginal: true });
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
    sameCanonical(restored.replay.kernel.executable.reconciledOpeningState, source.replay.kernel.executable.reconciledOpeningState, "opening state");
    sameCanonical(restored.replay.kernel.executable.reconciledPrimitiveState, source.replay.kernel.executable.reconciledPrimitiveState, "opening primitive runtime");
    sameCanonical(restored.replay.runContext, source.replay.runContext, "run context");
    sameCanonical(restored.replay.kernel.executable.participants?.map(participant => participant.economicInputs),
      source.replay.kernel.executable.participants?.map(participant => participant.economicInputs), "participant inputs");
    const sourceCheckpoints = exportHouseholdReplayCheckpoints(source), restoredCheckpoints = exportHouseholdReplayCheckpoints(restored);
    sameCanonical(restoredCheckpoints, sourceCheckpoints, "checkpoint state/primitive/tax runtime");
    for (const [index, checkpoint] of sourceCheckpoints.entries()) {
      for (const key of ["contributions", "contingentPositions"] as const) {
        expect(Object.hasOwn(restoredCheckpoints[index]!.state, key)).toBe(Object.hasOwn(checkpoint.state, key));
      }
    }
    const rerun = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    sameCanonical(rerun.state, source.state, "full rerun state (no checkpoint resume)");
    expect(rerun.diagnostics).toEqual(source.diagnostics);
    expect(rerun.outputCapabilities).toEqual(source.outputCapabilities);
    const detail = runHouseholdKernel({ kernel: tax.kernel, runContext: tax.context, resultTier: "detail" });
    for (const length of new Set([1, Math.min(12, months - 12)])) {
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
    const f = fixture(), { source } = f, artifact = f.artifact();
    for (const bad of [null, {}, { ...artifact, version: "unknown" }, { ...artifact, integrity: undefined },
      { ...artifact, encoded: artifact.encoded.slice(0, -10) },
      { ...artifact, encoded: artifact.encoded.replace("2026-01-01", "2025-01-01") }])
      expect(() => restoreHouseholdForecastEvidence(bad, f.model)).toThrow();
    const checkpoints = exportHouseholdReplayCheckpoints(source), target = transported(f);
    for (const bad of [[], [...checkpoints].reverse(), checkpoints.slice(1),
      checkpoints.map((value, index) => index ? value : { ...value, at: source.periods[0]!.period.end }),
      checkpoints.map(value => ({ ...value, runId: "d1610000-0000-4000-8000-000000000099" as typeof value.runId })),
      checkpoints.map(value => ({ ...value, outputCapabilities: {} })),
      checkpoints.map((value, index) => index ? value : { ...value, state: { ...value.state,
        identities: { ...value.state.identities, generatedOccurrenceKeys: [...value.state.identities.generatedOccurrenceKeys].reverse() } } }),
      checkpoints.map((value, index) => index ? value : { ...value, state: { ...value.state,
        identities: { ...value.state.identities, postedTransactionIds: [...value.state.identities.postedTransactionIds, value.state.identities.postedTransactionIds[0]!] } } }),
      checkpoints.map(value => ({ ...value, fingerprint: "wrong" as typeof value.fingerprint }))])
      expect(() => registerHouseholdReplayCheckpoints(target, bad)).toThrow(/BASIS_MISMATCH/);
    const other = fixture(24).source;
    expect(() => registerHouseholdReplayCheckpoints(other, checkpoints)).toThrow();
    expect(replayHouseholdForecastWindow(target, source.periods[25]!.period).periods).toEqual(replayHouseholdForecastWindow(source, source.periods[25]!.period).periods);
  });
  it("keeps legacy opening replay usable without advertising portable checkpoints", () => {
    const tax = taxHouseholdFixture({ months: 12, employerOriginal: true });
    const source = runHouseholdKernel({ kernel: tax.kernel, runContext: tax.context });
    const v3 = createPortableHouseholdReplayArtifact(source);
    for (const version of ["household-replay/v1", "household-replay/v2"] as const) {
      const restored = restorePortableHouseholdReplayArtifact({ ...v3, version, integrity: undefined });
      expect(replayHouseholdForecastWindow(restored, source.periods[0]!.period).periods).toEqual(replayHouseholdForecastWindow(source, source.periods[0]!.period).periods);
    }
  });
  it("bounds sparse checkpoints and distinguishes shared artifact bytes from repeated per-period JSON transport", () => {
    const short = fixture(24), longer = fixture(48);
    const bytes = (f: ReturnType<typeof fixture>) => {
      const { source } = f, artifact = f.artifact(), encoder = new TextEncoder();
      return { periods: source.periods.length, checkpoints: exportHouseholdReplayCheckpoints(source).length,
        sharedArtifact: encoder.encode(JSON.stringify(artifact)).byteLength,
        repeatedPeriodTransport: encoder.encode(JSON.stringify(source.periods.map(period => ({
          start: period.period.start, end: period.period.end, basis: artifact,
        })))).byteLength };
    };
    const shortBytes = bytes(short), longBytes = bytes(longer);
    expect(exportHouseholdReplayCheckpoints(short.source)).toHaveLength(1);
    expect(exportHouseholdReplayCheckpoints(longer.source)).toHaveLength(3);
    expect(longBytes.sharedArtifact).toBeLessThan(shortBytes.sharedArtifact * 3);
    expect(longBytes.sharedArtifact).toBeLessThan(8_000_000);
    expect(longBytes.repeatedPeriodTransport).toBeLessThan(shortBytes.repeatedPeriodTransport * 6);
    expect(longBytes.repeatedPeriodTransport).toBeGreaterThan(longBytes.sharedArtifact * 47);
    // Bounded synthetic evidence only: repeated JSON is deliberately measured
    // separately and is not a claim of linear or 40-year transport scalability.
    console.info("U1B-D synthetic portable checkpoint transport bytes", { short: shortBytes, longer: longBytes });
  });
});
