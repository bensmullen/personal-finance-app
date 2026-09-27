import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { createApplicationPerformanceObserver } from "../src/application/performance.js";
import { PerformanceRegistry, PERFORMANCE_PHASES, type PerformanceContext } from "../src/diagnostics/performance.js";
import { createGoldenHouseholdDraft, createGoldenHouseholdForecastRequest, exportPersonalModelJson, runPersonalHouseholdForecast } from "../src/application/index.js";
import { createRealisticPerformanceFixture, createStressPerformanceFixture } from "../test/fixtures/performanceHouseholds.js";

const configuredCount = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
};
const warmups = configuredCount("PERF_WARMUPS", 2);
const measuredRuns = configuredCount("PERF_RUNS", 5);
const outputPath = resolve(process.env.PERF_OUTPUT ?? "benchmarks/r1-engineering-reference.json");
const countObjects = (model: ReturnType<typeof createGoldenHouseholdDraft>) => Object.freeze(Object.fromEntries(Object.entries(model.objects).map(([name, values]) => [name, values.length])));
const fixtures = [
  { id: "golden-household", model: createGoldenHouseholdDraft(), request: createGoldenHouseholdForecastRequest("93000000-0000-4000-8000-000000000001"), coverage: { class: "golden", unsupportedGaps: ["multi-member", "tax execution", "stochastic execution", "worker execution"] } },
  createRealisticPerformanceFixture(),
  createStressPerformanceFixture(),
] as const;

const captured = [];
for (const fixture of fixtures) {
  for (let index = 0; index < warmups; index += 1) runPersonalHouseholdForecast(fixture.model, fixture.request);
  const runs = [];
  for (let index = 0; index < measuredRuns; index += 1) {
    const registry = new PerformanceRegistry();
    const context: PerformanceContext = Object.freeze({
      runId: `${fixture.id}:${index + 1}`, fixtureId: fixture.id, dataClassification: "synthetic", modelCounts: countObjects(fixture.model),
      horizon: Object.freeze({ start: fixture.request.compiler.cashFlow!.simulationStart, end: fixture.request.compiler.cashFlow!.simulationEnd }),
      modelVersion: fixture.model.modelFormatVersion, specificationVersion: fixture.model.financialSpecificationVersion, engineVersion: "0.1.0",
      executionLocation: "local_node", runtime: process.version, cacheState: "not_applicable",
    });
    const cpuStart = process.cpuUsage();
    const memoryStart = process.memoryUsage().heapUsed;
    const result = runPersonalHouseholdForecast(fixture.model, fixture.request, createApplicationPerformanceObserver({ now: () => performance.now() }, context, registry));
    if (result.status === "unavailable") throw new Error(`${fixture.id} is not executable: ${result.message}`);
    const serializationStart = performance.now();
    exportPersonalModelJson(fixture.model);
    registry.record({ phase: "transport.serialization", availability: "measured", durationMs: performance.now() - serializationStart, context });
    const cpu = process.cpuUsage(cpuStart);
    const phases = Object.fromEntries(PERFORMANCE_PHASES.flatMap((phase) => {
      const summary = registry.summary(phase);
      return summary === undefined ? [] : [[phase, summary]];
    }));
    runs.push(Object.freeze({ run: index + 1, totalMs: registry.summary("forecast.total")?.latest, phases, resources: Object.freeze({ cpuTimeMs: (cpu.user + cpu.system) / 1000, memoryDeltaBytes: process.memoryUsage().heapUsed - memoryStart, executionLocation: "local_node", metering: "not_metered" }) }));
  }
  captured.push(Object.freeze({ fixtureId: fixture.id, context: Object.freeze({ modelCounts: countObjects(fixture.model), coverage: fixture.coverage }), runs: Object.freeze(runs) }));
}

const artifact = Object.freeze({
  schemaVersion: "r1-performance-baseline-v1", classification: "engineering-reference", budgetStatus: "non-budget-non-SLA", optimizationStatus: "pre-optimization",
  baseSha: "a7af3607be620eb346440485f289a5aaac17e72a", generatedAt: new Date().toISOString(),
  environment: Object.freeze({ runtime: process.version, platform: process.platform, architecture: process.arch }), capture: Object.freeze({ warmups, measuredRuns }),
  placement: Object.freeze({ localNode: "measured", browserMain: "measured interactively in Settings > Advanced", serverCloud: "not_implemented/not_measured", recommendation: "deferred_until_approved_budgets" }),
  fixtures: Object.freeze(captured),
});
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(`Captured ${fixtures.length} fixtures (${warmups} warmups + ${measuredRuns} measured each) to ${outputPath}`);
