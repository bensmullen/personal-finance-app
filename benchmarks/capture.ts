import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createApplicationPerformanceObserver, requireFullHorizonPerformanceForecast, createPerformanceComparisonValidation, createPerformanceEvidenceSample } from "../src/application/performance.js";
import { PerformanceRegistry, PERFORMANCE_PHASES, type PerformanceContext } from "../src/diagnostics/performance.js";
import { createGoldenHouseholdDraft, createGoldenHouseholdForecastRequest, runPersonalHouseholdForecast } from "../src/application/index.js";
import { comparePersonalHouseholdScenarioIntents } from "../src/application/householdProjection.js";
import { createRealisticPerformanceFixture, createStressPerformanceFixture, createPerformanceScalingFixtures, createFlagshipHorizonProbes } from "../test/fixtures/performanceHouseholds.js";
import { captureReusableKernelEvidence } from "./r3/captureKernel.js";
import { canonicalSerialize } from "../src/simulation/run.js";

const configuredCount = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
};
const warmups = configuredCount("PERF_WARMUPS", 2);
if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error("R3 performance evidence requires the supported Node 22 runtime.");
const measuredRuns = configuredCount("PERF_RUNS", 5);
if (measuredRuns < 1 || measuredRuns > 20 || warmups > 10) throw new Error("Capture requires 1–20 measured runs and 0–10 warmups.");
const outputPath = resolve(process.env.PERF_OUTPUT ?? "benchmarks/r1-engineering-reference.json");
const countObjects = (model: ReturnType<typeof createGoldenHouseholdDraft>) => Object.freeze(Object.fromEntries(Object.entries(model.objects).map(([name, values]) => [name, values.length])));
const primaryFixtures = [
  { id: "golden-household", model: createGoldenHouseholdDraft(), request: createGoldenHouseholdForecastRequest("93000000-0000-4000-8000-000000000001"), coverage: { class: "golden", executionMechanics: ["T1A tax execution and output completeness gating"], unsupportedGaps: ["multi-member", "full target-cohort tax completeness when authored facts or verified law are missing", "stochastic execution", "worker execution"] } },
  createRealisticPerformanceFixture(),
  createStressPerformanceFixture(),
] as const;
const scalingFixtures = createPerformanceScalingFixtures();
const fixtures = [...primaryFixtures, ...scalingFixtures];
const capturedHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(capturedHead)) throw new Error("Captured Git head is unavailable.");

/**
 * One-shot, reproducible diagnostic via existing manually dispatched
 * engineering-validation/performance (warmups=0, runs=1). This augments the
 * ordinary R1/R3 capture rather than changing its baseline evidence. It is
 * intentionally not part of the regular multi-run performance profile or CI.
 */
// Each probe runs in a separate child process. This permits a diagnostic
// cutoff without terminating the GitHub job or losing completed horizons.
// The 240-second cutoff is damage containment, NEVER a product SLA.
/** Merkle-style canonical identity: equal values hash equally regardless of sharing.
 * Historical JSON canonicalization expanded the same large replay artifact once
 * per monthly trace anchor and could exhaust V8 after execution had returned.
 * Visit each object at most once; preserve sorted keys, ordered arrays and the
 * existing canonical serialization of financial value classes.
 */
const canonicalGraphDigest = (input: unknown): string => {
  const hashes = new WeakMap<object, string>(), active = new Set<object>();
  const visit = (value: unknown): string => {
    if (value === null || typeof value !== "object")
      return createHash("sha256").update("primitive:").update(canonicalSerialize(value)).digest("hex");
    const cached = hashes.get(value);
    if (cached !== undefined) return cached;
    if (active.has(value)) throw new Error("Canonical benchmark graph cannot contain cycles.");
    active.add(value);
    try {
      const hash = createHash("sha256");
      if (Array.isArray(value)) {
        hash.update("array:").update(String(value.length)).update(":");
        for (const item of value) hash.update(visit(item)).update(";");
      } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
        hash.update("record:").update(String(keys.length)).update(":");
        for (const key of keys) hash.update(JSON.stringify(key)).update(":").update(visit(record[key])).update(";");
      } else {
        hash.update("canonical-class:").update(canonicalSerialize(value));
      }
      const result = hash.digest("hex");
      hashes.set(value, result);
      return result;
    } finally { active.delete(value); }
  };
  return visit(input);
};

const childMonth = process.env.PFM_U1B_DIAGNOSTIC_PROBE;
if (childMonth !== undefined) {
  const probe = createFlagshipHorizonProbes().find(item => String(item.months) === childMonth);
  if (!probe) throw new Error("Unknown flagship probe month selection.");
  const registry = new PerformanceRegistry();
  const context: PerformanceContext = {
    runId: probe.id, fixtureId: probe.id, dataClassification: "synthetic",
    modelCounts: countObjects(probe.model),
    horizon: { start: probe.request.compiler.cashFlow!.simulationStart, end: probe.request.compiler.cashFlow!.simulationEnd },
    modelVersion: probe.model.modelFormatVersion, specificationVersion: probe.model.financialSpecificationVersion,
    executionLocation: "local_node", runtime: process.version, cacheState: "not_applicable",
  };
  const cpuStart = process.cpuUsage();
  const heapStart = process.memoryUsage().heapUsed;
  const cloneStart = performance.now();
  structuredClone({ model: probe.model, request: probe.request });
  const inputCloneMs = performance.now() - cloneStart;
  const start = performance.now();
  const result = runPersonalHouseholdForecast(probe.model, probe.request,
    createApplicationPerformanceObserver({ now: () => performance.now() }, context, registry));
  const wallMs = performance.now() - start;
  // Flush a distinct stage marker before clone/hash work. A later child OOM
  // must not be misreported as an engine execution failure.
  console.log(`U1B_FLAGSHIP_EXECUTION_RETURNED ${JSON.stringify({ fixtureId: probe.id, months: probe.months, status: result.status,
    points: result.status === "unavailable" ? 0 : result.points.length, wallMs,
    heapAfterExecutionBytes: process.memoryUsage().heapUsed })}`);
  const outputCloneStart = performance.now();
  structuredClone(result);
  const outputCloneMs = performance.now() - outputCloneStart;
  const cpu = process.cpuUsage(cpuStart);
  const sample = {
    fixtureId: probe.id, months: probe.months, status: result.status,
    requestedEnd: result.requestedHorizon?.end ?? null, reachedThrough: result.reachedThrough ?? null,
    pointCount: result.status === "unavailable" ? 0 : result.points.length,
    wallMs, inputCloneMs, outputCloneMs, cpuMs: (cpu.user + cpu.system) / 1000,
    heapAfterBytes: process.memoryUsage().heapUsed, heapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
    // Exact synthetic output identity, outside timing/CPU/clone samples. This
    // includes financial points, coverage, diagnostics and source provenance.
    resultFingerprint: canonicalGraphDigest(result),
    structuralCounters: registry.latest("engine.execute")?.resources?.structuralCounters ?? {},
    phaseInterpretation: "Capability normalization is a subphase of engine.capabilities, also included in summary statements_metrics or detailed trace_result. application.replay_artifact is a subphase of application.read_model. Diagnostic counters distinguish raw-list inspection, exact key computation, shared-prefix lookup, new merge suffixes and array materialization. Request post includes synchronous enqueue work; worker roundtrip includes queueing/execution/response and is never serialization-only. Phase durations are not an exclusive partition of wall time.",
    phasesMs: Object.fromEntries(PERFORMANCE_PHASES.map(phase => {
      const record = registry.latest(phase);
      return [phase, record?.availability === "measured" ? record.durationMs ?? null : null];
    })),
    phaseAvailability: Object.fromEntries(PERFORMANCE_PHASES.map(phase =>
      [phase, registry.latest(phase)?.availability ?? "not_measured"])),
  };
  // Flush IPC evidence before ending the isolated Vite-Node process.
  await new Promise<void>(resolve => { process.stdout.write(`U1B_FLAGSHIP_PROBE_RESULT ${JSON.stringify(sample)}\n`, () => resolve()); });
  process.exit(0);
}

if (warmups === 0 && measuredRuns === 1) {
  const probeOutput = resolve("benchmarks/u1b-flagship-diagnostics.json");
  const probes = createFlagshipHorizonProbes();
  const samples: Record<string, unknown>[] = [];
  const persist = async (state: string, current?: string) => {
    await mkdir(resolve(probeOutput, ".."), { recursive: true });
    await writeFile(probeOutput, JSON.stringify({
      schemaVersion: "u1b-flagship-horizons-v1", classification: "synthetic-engineering-diagnostic",
      capturedHead, environment: { runtime: process.version, platform: process.platform, architecture: process.arch },
      measurement: "One synchronous Node 22 execution per horizon, isolated process; not a browser Worker or product latency budget",
      diagnosticCutoffMs: 240000, state, current, samples,
    }, null, 2) + "\n", "utf8");
  };
  let stopped = false;
  for (const probe of probes) {
    await persist("running", probe.id);
    console.log(`U1B_FLAGSHIP_PROBE_START ${probe.id} ${probe.request.compiler.cashFlow!.simulationStart} ${probe.request.compiler.cashFlow!.simulationEnd}`);
    try {
      const output = execFileSync(resolve("node_modules/.bin/vite-node"), ["benchmarks/capture.ts"], {
        encoding: "utf8", timeout: 240000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, PFM_U1B_DIAGNOSTIC_PROBE: String(probe.months) },
      });
      const line = output.split("\n").find(item => item.startsWith("U1B_FLAGSHIP_PROBE_RESULT "));
      if (!line) throw new Error("Probe did not emit diagnostic evidence.");
      const sample = JSON.parse(line.slice("U1B_FLAGSHIP_PROBE_RESULT ".length)) as Record<string, unknown>;
      samples.push(sample);
      await persist("running");
      console.log(line);
    } catch (error) {
      const childOutput = error !== null && typeof error === "object" && "stdout" in error
        ? String(error.stdout) : "";
      const returned = childOutput.split("\\n").find(line => line.startsWith("U1B_FLAGSHIP_EXECUTION_RETURNED "));
      const sample = { fixtureId: probe.id, months: probe.months, status: "not_measured",
        failureStage: returned === undefined ? "execution_or_prior" : "post_execution_clone_or_fingerprint",
        ...(returned === undefined ? {} : { lastSuccessfulStage: returned.slice("U1B_FLAGSHIP_EXECUTION_RETURNED ".length) }),
        failure: error instanceof Error ? error.message.slice(0, 150) : "probe_process_failed",
        diagnosticCutoffMs: 240000 };
      samples.push(sample);
      await persist("stopped", probe.id);
      console.error(`U1B_FLAGSHIP_PROBE_STOP ${JSON.stringify(sample)}`);
      stopped = true;
      break; // Do not waste time on longer horizons after a shorter failure.
    }
  }
  await persist(stopped ? "stopped" : "completed");
  // This explicit one-shot diagnostic is independent of the historical R1/R3
  // baseline, whose old Golden complete-only assumption can now be incomplete
  // under authoritative T1A tax capability gates. Never mask a probe cutoff.
  if (stopped) throw new Error("U1B_FLAGSHIP_DIAGNOSTIC_INCOMPLETE: see benchmarks/u1b-flagship-diagnostics.json; older R1/R3 baselines were not run.");
  console.log("U1B_FLAGSHIP_DIAGNOSTIC_COMPLETE: separate R1/R3 baselines were not run.");
  process.exit(0);
}

const captured = [];
for (const fixture of fixtures) {
  for (let index = 0; index < warmups; index += 1) requireFullHorizonPerformanceForecast(runPersonalHouseholdForecast(fixture.model, fixture.request), fixture.id);
  const runs = [];
  for (let index = 0; index < measuredRuns; index += 1) {
    const registry = new PerformanceRegistry();
    const context: PerformanceContext = Object.freeze({
      runId: `${fixture.id}:${index + 1}`, fixtureId: fixture.id, dataClassification: "synthetic", modelCounts: countObjects(fixture.model),
      horizon: Object.freeze({ start: fixture.request.compiler.cashFlow!.simulationStart, end: fixture.request.compiler.cashFlow!.simulationEnd }),
      modelVersion: fixture.model.modelFormatVersion, specificationVersion: fixture.model.financialSpecificationVersion, engineVersion: "0.1.0",
      executionLocation: "local_node", runtime: process.version, cacheState: "not_applicable",
      ...("dimensions" in fixture ? { scalingDimensions: fixture.dimensions } : {}),
    });
    const cpuStart = process.cpuUsage();
    const memoryStart = process.memoryUsage().heapUsed;
    const result = runPersonalHouseholdForecast(fixture.model, fixture.request, createApplicationPerformanceObserver({ now: () => performance.now() }, context, registry));
    requireFullHorizonPerformanceForecast(result, fixture.id);
    const cpu = process.cpuUsage(cpuStart);
    const sampledHeapUsedBytes = process.memoryUsage().heapUsed;
    runs.push(Object.freeze({ run: index + 1, ...createPerformanceEvidenceSample(registry, result, {
      cpuTimeMs: (cpu.user + cpu.system) / 1000, memoryBytes: sampledHeapUsedBytes,
      memoryDeltaBytes: sampledHeapUsedBytes - memoryStart, metering: "not_metered",
    }), resourceMeaning: Object.freeze({ cpuTimeMs: "process aggregate user + system CPU during synchronous forecast; diagnostic only",
      memoryBytes: "absolute heapUsed sampled after synchronous forecast including observer collection; not peak",
      memoryDeltaBytes: "signed after-minus-before heapUsed; supplemental only" }) }));
  }
  captured.push(Object.freeze({ fixtureId: fixture.id, kind: fixture.id.startsWith("scaling:") ? "scaling" : "primary", context: Object.freeze({ modelCounts: countObjects(fixture.model), coverage: fixture.coverage,
    ...("comparisonIntents" in fixture ? { comparisonIntents: fixture.comparisonIntents.map((intent) => ({ scenarioId: intent.scenarioId, name: intent.name, changeKinds: intent.changes.map((change) => change.kind) })),
      comparisonMeasurement: "not_measured",
      comparisonEvidenceOwner: fixture.id.startsWith("scaling:") ? "intent structure only; no probe comparison execution claim"
        : fixture.id === "realistic-household" ? "bounded ordinary CI and controlled heavy validation" : "controlled heavy validation; ordinary CI structure only",
    } : {}),
    ...("dimensions" in fixture ? { scalingDimensions: fixture.dimensions } : {}) }), runs: Object.freeze(runs) }));
}

// Required execution evidence, after all timing/resource sampling. Never retain
// the comparison's financial points, deltas, or configuration values.
const comparisonValidation = primaryFixtures.flatMap((fixture) => {
  if (!("comparisonIntents" in fixture)) return [];
  if (fixture.comparisonIntents.length !== 1 || fixture.comparisonIntents[0]!.changes.length !== 1
    || fixture.comparisonIntents[0]!.changes[0]!.kind !== "investment_return")
    throw new Error(`${fixture.id} must declare one lower-return comparison intent.`);
  const start = fixture.request.compiler.cashFlow!.simulationStart;
  const end = "2026-02-01";
  const request = { ...fixture.request, compiler: { ...fixture.request.compiler,
    cashFlow: { ...fixture.request.compiler.cashFlow!, simulationEnd: end, months: 1 },
    investments: { ...fixture.request.compiler.investments!, simulationEnd: end, months: 1 },
    liabilities: { ...fixture.request.compiler.liabilities!, simulationEnd: end, months: 1 },
  } };
  const comparison = comparePersonalHouseholdScenarioIntents(fixture.model, request, fixture.comparisonIntents);
  return [createPerformanceComparisonValidation(fixture.id, comparison, fixture.comparisonIntents,
    fixture.request.compiler.investments!.scenarioId, { start, end })];
});

const artifact = Object.freeze({
  schemaVersion: "r1-performance-baseline-v2", classification: "engineering-reference", budgetStatus: "non-budget-non-SLA", optimizationStatus: "R3 kernel; comparison pending valid Node 22 baseline",
  comparisonPoint: Object.freeze({ preR3Head: "2d10b02e7471c8040e30ff6f4d58917c8f67d3f9",
    status: "separate Node 22 performance capture required; historical Node 24 artifact is not a comparison baseline" }),
  reusableKernel: Object.freeze(captureReusableKernelEvidence(fixtures, warmups, measuredRuns)),
  capturedHead, generatedAt: new Date().toISOString(),
  environment: Object.freeze({ runtime: process.version, platform: process.platform, architecture: process.arch }), capture: Object.freeze({ warmups, measuredRuns }),
  placement: Object.freeze({ localNode: "measured", browserMain: "interactive/in-memory; not a retained representative-device baseline", serverCloud: "not_implemented/not_measured", recommendation: "deferred_until_approved_budgets" }),
  fixtures: Object.freeze(captured.filter((fixture) => fixture.kind === "primary")),
  scalingProbes: Object.freeze(captured.filter((fixture) => fixture.kind === "scaling")),
  comparisonValidation: Object.freeze(comparisonValidation),
});
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(`Captured ${fixtures.length} fixtures (${warmups} warmups + ${measuredRuns} measured each) to ${outputPath}`);
