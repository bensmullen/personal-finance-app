import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { createApplicationPerformanceObserver, requireCompletedPerformanceForecast, createPerformanceEvidenceSample } from "../src/application/performance.js";
import { PerformanceRegistry, type PerformanceContext } from "../src/diagnostics/performance.js";
import { createGoldenHouseholdDraft, createGoldenHouseholdForecastRequest, runPersonalHouseholdForecast } from "../src/application/index.js";
import { comparePersonalHouseholdScenarioIntents } from "../src/application/householdProjection.js";
import { createRealisticPerformanceFixture, createStressPerformanceFixture, createPerformanceScalingFixtures } from "../test/fixtures/performanceHouseholds.js";
import { captureReusableKernelEvidence } from "./r3/captureKernel.js";

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
  { id: "golden-household", model: createGoldenHouseholdDraft(), request: createGoldenHouseholdForecastRequest("93000000-0000-4000-8000-000000000001"), coverage: { class: "golden", unsupportedGaps: ["multi-member", "tax execution", "stochastic execution", "worker execution"] } },
  createRealisticPerformanceFixture(),
  createStressPerformanceFixture(),
] as const;
const scalingFixtures = createPerformanceScalingFixtures();
const fixtures = [...primaryFixtures, ...scalingFixtures];
const capturedHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(capturedHead)) throw new Error("Captured Git head is unavailable.");

const captured = [];
for (const fixture of fixtures) {
  for (let index = 0; index < warmups; index += 1) requireCompletedPerformanceForecast(runPersonalHouseholdForecast(fixture.model, fixture.request), fixture.id);
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
    requireCompletedPerformanceForecast(result, fixture.id);
    if (result.status !== "completed") throw new Error(`${fixture.id} did not complete.`);
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
  if (comparison.status !== "completed" || comparison.alternatives.length !== fixture.comparisonIntents.length
    || comparison.alternatives.some((alternative, index) => alternative.status !== "completed"
      || alternative.name !== fixture.comparisonIntents[index]!.name || alternative.comparedThrough !== `${end}T00:00:00.000Z`))
    throw new Error(`${fixture.id} bounded lower-return comparison did not complete (${comparison.status}).`);
  return [Object.freeze({ fixtureId: fixture.id, applicability: "applicable", status: comparison.status,
    measurement: "not_measured; validation outside baseline timing/resource samples", horizon: Object.freeze({ start, end }),
    alternatives: Object.freeze(comparison.alternatives.map((alternative, index) => Object.freeze({
      scenarioId: fixture.comparisonIntents[index]!.scenarioId,
      changeKinds: Object.freeze(fixture.comparisonIntents[index]!.changes.map((change) => change.kind)),
      status: alternative.status, comparedThrough: alternative.comparedThrough,
    }))),
  })];
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
