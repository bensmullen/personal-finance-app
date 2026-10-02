import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { createApplicationPerformanceObserver, requireCompletedPerformanceForecast, createPerformanceEvidenceSample } from "../src/application/performance.js";
import { PerformanceRegistry, type PerformanceContext } from "../src/diagnostics/performance.js";
import { createGoldenHouseholdDraft, createGoldenHouseholdForecastRequest, runPersonalHouseholdForecast } from "../src/application/index.js";
import { createRealisticPerformanceFixture, createStressPerformanceFixture, createPerformanceScalingFixtures } from "../test/fixtures/performanceHouseholds.js";

const configuredCount = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
};
const warmups = configuredCount("PERF_WARMUPS", 2);
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
    ...("comparisonIntents" in fixture ? { comparisonIntents: fixture.comparisonIntents.map((intent) => ({ scenarioId: intent.scenarioId, name: intent.name, changeKinds: intent.changes.map((change) => change.kind) })), comparisonMeasurement: "not_measured; exercised by declared CI comparison request" } : {}),
    ...("dimensions" in fixture ? { scalingDimensions: fixture.dimensions } : {}) }), runs: Object.freeze(runs) }));
}

const artifact = Object.freeze({
  schemaVersion: "r1-performance-baseline-v2", classification: "engineering-reference", budgetStatus: "non-budget-non-SLA", optimizationStatus: "pre-optimization",
  capturedHead, generatedAt: new Date().toISOString(),
  environment: Object.freeze({ runtime: process.version, platform: process.platform, architecture: process.arch }), capture: Object.freeze({ warmups, measuredRuns }),
  placement: Object.freeze({ localNode: "measured", browserMain: "interactive/in-memory; not a retained representative-device baseline", serverCloud: "not_implemented/not_measured", recommendation: "deferred_until_approved_budgets" }),
  fixtures: Object.freeze(captured.filter((fixture) => fixture.kind === "primary")),
  scalingProbes: Object.freeze(captured.filter((fixture) => fixture.kind === "scaling")),
});
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(`Captured ${fixtures.length} fixtures (${warmups} warmups + ${measuredRuns} measured each) to ${outputPath}`);
