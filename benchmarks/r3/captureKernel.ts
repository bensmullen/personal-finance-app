import { performance } from "node:perf_hooks";
import type { PortableModelEnvelope } from "../../src/model/modelVersion.js";
import { compileHouseholdProjection, type HouseholdProjectionCompilerRequest } from "../../src/application/compiler/householdProjection.js";
import { PerformanceRegistry, PERFORMANCE_PHASES } from "../../src/diagnostics/performance.js";
import { runHouseholdKernel } from "../../src/simulation/householdExecution.js";
import { applyHouseholdExecutionOverlay } from "../../src/simulation/r3/compiledHousehold.js";
import { createRunContext, runId, scenarioId } from "../../src/simulation/run.js";
import { instant } from "../../src/time/index.js";
import { Currency } from "../../src/values/index.js";

interface Fixture {
  readonly id: string;
  readonly model: PortableModelEnvelope;
  readonly request: {
    readonly asOf: string; readonly dataCutoff: string;
    readonly compiler: HouseholdProjectionCompilerRequest;
  };
}

/** Heavy-only companion evidence. Keeps full representative/scaling horizons out of unit CI. */
export const captureReusableKernelEvidence = (
  fixtures: readonly Fixture[], warmups: number, measuredRuns: number,
) => fixtures.map(fixture => {
  const compileStart = performance.now();
  const result = compileHouseholdProjection(fixture.model, fixture.request.compiler);
  const compilationMs = performance.now() - compileStart;
  if (result.status !== "compiled" || result.value.executionKernel === undefined)
    throw new Error(fixture.id + " reusable kernel did not compile.");
  const kernel = result.value.executionKernel;
  const boundary = fixture.request.compiler.investments ?? fixture.request.compiler.liabilities ?? fixture.request.compiler.cashFlow;
  if (boundary === undefined) throw new Error("Fixture has no boundary.");
  const context = createRunContext({
    runId: runId("93000000-0000-4000-8000-000000000090"),
    scenarioId: scenarioId(kernel.executable.scenarioIdentity),
    asOf: instant(fixture.request.asOf + "T00:00:00.000Z"), dataCutoff: instant(fixture.request.dataCutoff + "T00:00:00.000Z"),
    simulationStart: instant(boundary.simulationStart + "T00:00:00.000Z"),
    simulationEnd: instant(boundary.simulationEnd + "T00:00:00.000Z"),
    baseCurrency: Currency.of(boundary.baseCurrency),
  });
  const requireCompleted = (run: ReturnType<typeof runHouseholdKernel>) => {
    if (run.status !== "completed" || run.reachedThrough !== context.simulationEnd)
      throw new Error(fixture.id + " reusable kernel failed to reach the requested horizon.");
    return run;
  };
  for (let index = 0; index < warmups; index += 1) requireCompleted(runHouseholdKernel({ kernel, runContext: context }));
  const runs = Array.from({ length: measuredRuns }, (_, index) => {
    const registry = new PerformanceRegistry();
    const cpuStart = process.cpuUsage(); const heapStart = process.memoryUsage().heapUsed; const started = performance.now();
    const run = requireCompleted(runHouseholdKernel({ kernel, runContext: context }, {
      clock: { now: () => performance.now() }, sink: registry,
      context: { runId: fixture.id + ":kernel:" + index, fixtureId: fixture.id, dataClassification: "synthetic",
        modelCounts: Object.fromEntries(Object.entries(fixture.model.objects).map(([name, values]) => [name, values.length])),
        executionLocation: "local_node", runtime: process.version, cacheState: "not_applicable" },
    }));
    const elapsedMs = performance.now() - started; const cpu = process.cpuUsage(cpuStart);
    return Object.freeze({ run: index + 1, elapsedMs, throughputPerSecond: elapsedMs > 0 ? 1000 / elapsedMs : null,
      cpuTimeMs: (cpu.user + cpu.system) / 1000, sampledHeapUsedBytes: process.memoryUsage().heapUsed,
      memoryDeltaBytes: process.memoryUsage().heapUsed - heapStart,
      status: run.status, reachedThrough: run.reachedThrough,
      phases: Object.fromEntries(PERFORMANCE_PHASES.flatMap(phase => {
        const record = registry.latest(phase); return record === undefined ? [] : [[phase, record]];
      })),
    });
  });
  const overlay = applyHouseholdExecutionOverlay(kernel, kernel.cash === undefined ? {} : {
    cashFlowInput: { ...kernel.cash.input, incomes: [...kernel.cash.input.incomes] },
  });
  return Object.freeze({ fixtureId: fixture.id, compilationMs, invariantReuse: {
    investmentStructure: overlay.investments === kernel.investments,
    liabilityStructure: overlay.liabilities === kernel.liabilities,
    horizon: overlay.horizon === kernel.horizon,
    overlayMeaning: "equivalent localized cash-input replacement; financial decision coverage belongs to bounded CI",
  }, horizon: { start: context.simulationStart, end: context.simulationEnd }, runs });
});
