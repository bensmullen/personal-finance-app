import { describe, expect, it } from "vitest";
import { createApplicationPerformanceObserver, translateMeteredCost } from "../src/application/performance.js";
import { PerformanceRegistry, createPerformanceSession, type PerformanceContext } from "../src/diagnostics/performance.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { createRealisticPerformanceFixture, createStressPerformanceFixture } from "./fixtures/performanceHouseholds.js";

const context: PerformanceContext = Object.freeze({ runId: "performance-test", fixtureId: "realistic-household", dataClassification: "synthetic", modelCounts: Object.freeze({}), executionLocation: "local_node", runtime: "vitest", cacheState: "not_applicable" });
const oneMonth = <T extends ReturnType<typeof createRealisticPerformanceFixture>["request"]>(request: T): T => ({
  ...request,
  compiler: {
    ...request.compiler,
    cashFlow: { ...request.compiler.cashFlow!, simulationEnd: "2026-02-01", months: 1 },
    investments: { ...request.compiler.investments!, simulationEnd: "2026-02-01", months: 1 },
    liabilities: { ...request.compiler.liabilities!, simulationEnd: "2026-02-01", months: 1 },
  },
}) as T;

describe("performance instrumentation", () => {
  it("is observational and aggregates phase segments", () => {
    const fixture = createRealisticPerformanceFixture();
    const request = oneMonth(fixture.request);
    const baseline = runPersonalHouseholdForecast(fixture.model, request);
    let tick = 0;
    const registry = new PerformanceRegistry();
    const observed = runPersonalHouseholdForecast(fixture.model, request, createApplicationPerformanceObserver({ now: () => ++tick }, context, registry));
    expect(observed).toEqual(baseline);
    expect(registry.summary("forecast.total")?.count).toBe(1);
    expect(registry.summary("engine.prepare")?.latest).toBeGreaterThan(1);
    expect(registry.summary("engine.execute")?.count).toBe(1);
  });

  it("swallows throwing clock and sink failures without changing success or failure", () => {
    const fixture = createRealisticPerformanceFixture();
    const request = oneMonth(fixture.request);
    const baseline = runPersonalHouseholdForecast(fixture.model, request);
    const throwing = createApplicationPerformanceObserver({ now: () => { throw new Error("clock"); } }, context, { record: () => { throw new Error("sink"); } });
    expect(runPersonalHouseholdForecast(fixture.model, request, throwing)).toEqual(baseline);
    const invalid = { ...request, asOf: "2027-01-01" };
    expect(runPersonalHouseholdForecast(fixture.model, invalid, throwing)).toEqual(runPersonalHouseholdForecast(fixture.model, invalid));
  });

  it("keeps only the latest 100 completed measurements and exposes summaries", () => {
    const registry = new PerformanceRegistry();
    for (let index = 0; index < 120; index += 1) registry.record({ phase: "forecast.total", availability: "measured", durationMs: index, context });
    expect(registry.records("forecast.total")).toHaveLength(100);
    expect(registry.summary("forecast.total")).toEqual({ latest: 119, p50: 69, p95: 114, max: 119, count: 100 });
  });

  it("uses exact provider-neutral billing units for optional pricing translation", () => {
    expect(translateMeteredCost({ metering: "metered", billingUnits: { compute: "1.25", transfer: "2" } }, [
      { unit: "compute", ratePerUnit: "0.012", currency: "USD" }, { unit: "transfer", ratePerUnit: "0.003", currency: "USD" },
    ])).toEqual([{ currency: "USD", amount: "0.021", units: { compute: "1.25", transfer: "2" } }]);
    expect(translateMeteredCost({ metering: "not_metered" }, [])).toEqual([]);
  });

  it("provides executable distinct synthetic fixtures with explicit gaps", () => {
    const realistic = createRealisticPerformanceFixture();
    const stress = createStressPerformanceFixture();
    expect(realistic.model).not.toEqual(stress.model);
    const realisticResult = runPersonalHouseholdForecast(realistic.model, oneMonth(realistic.request));
    const stressResult = runPersonalHouseholdForecast(stress.model, oneMonth(stress.request));
    expect(realisticResult.status, JSON.stringify(realisticResult)).not.toBe("unavailable");
    expect(stressResult.status, JSON.stringify(stressResult)).not.toBe("unavailable");
    expect(stress.coverage.canonicalObjectCounts.Expense).toBeGreaterThan(realistic.coverage.canonicalObjectCounts.Expense!);
    expect(realistic.coverage.unsupportedGaps.join(" ")).toContain("multi-member");
  }, 60_000);
});
