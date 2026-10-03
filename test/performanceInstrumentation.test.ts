import { describe, expect, it } from "vitest";
import { createApplicationPerformanceObserver, translateMeteredCost, requireCompletedPerformanceForecast, createPerformanceEvidenceSample } from "../src/application/performance.js";
import { PerformanceRegistry, createPerformanceSession, type PerformanceContext } from "../src/diagnostics/performance.js";
import { runPersonalHouseholdForecast, comparePersonalHouseholdScenarioIntents } from "../src/application/householdProjection.js";
import { createRealisticPerformanceFixture, createStressPerformanceFixture, createPerformanceScalingFixtures } from "./fixtures/performanceHouseholds.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { runCompiledHouseholdProjection } from "../src/simulation/householdExecution.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { USD } from "../src/values/index.js";
import { executeForecastWorkerRequest } from "../ui/forecast/execute.js";
import { ForecastController, type ForecastWorkerPort } from "../ui/forecast/controller.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse } from "../ui/forecast/protocol.js";
import { calculationFingerprint } from "../src/application/interactiveForecast.js";

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
  it("returns structured-clone safe Worker records with observational financial execution", () => {
    const fixture = createRealisticPerformanceFixture();
    const request = oneMonth(fixture.request);
    const performanceContext: PerformanceContext = { ...context, executionLocation: "browser_worker", cacheState: "miss", workerConcurrency: 1 };
    const message: ForecastWorkerRequest = { operation: "baseline_forecast", requestId: 1,
      fingerprint: calculationFingerprint("baseline_forecast", fixture.model, request), model: fixture.model, request, performanceContext };
    let tick = 0;
    const response = executeForecastWorkerRequest(structuredClone(message), { now: () => ++tick });
    expect(response.outcome).toBe("result");
    if (response.outcome !== "result") throw new Error("Worker failed");
    expect(response.result).toEqual(runPersonalHouseholdForecast(fixture.model, request));
    expect(structuredClone(response)).toEqual(response);
    expect(response).toMatchObject({ operation: message.operation, requestId: 1, fingerprint: message.fingerprint });
    expect(response.records.find((record) => record.phase === "forecast.total")?.context).toMatchObject({ executionLocation: "browser_worker", cacheState: "miss", workerConcurrency: 1, status: "completed" });
    expect(response.records.some((record) => record.phase === "transport.serialization")).toBe(false);
    const clockFailure = executeForecastWorkerRequest(message, { now() { throw new Error("clock"); } });
    expect(clockFailure.outcome === "result" && clockFailure.result).toEqual(response.result);
    expect(clockFailure.records.filter((record) => record.phase === "forecast.total")[0]?.availability).toBe("unavailable");
    const setupFailure = executeForecastWorkerRequest({ ...message, performanceContext: new Proxy(performanceContext, { ownKeys() { throw new Error("instrumentation setup"); } }) }, { now: () => ++tick });
    expect(setupFailure.outcome === "result" && setupFailure.result).toEqual(response.result);
    expect(setupFailure.records).toEqual([]);
    const comparison = executeForecastWorkerRequest({ ...message, operation: "scenario_comparison", intents: [] }, { now: () => ++tick });
    expect(comparison.outcome).toBe("result"); expect(comparison.records).toEqual([]);
    const major = executeForecastWorkerRequest({ ...message, operation: "major_asset_debt_comparison", addition: { asset: {}, liability: {}, profile: request.compiler.liabilities!.executionProfiles[0]! } }, { now: () => ++tick });
    expect(major.outcome).toBe("result"); expect(major.records).toEqual([]);
  });

  it("attributes unmeasured transport to browser_main and never fabricates cached execution", () => {
    const fixture = createRealisticPerformanceFixture();
    const request = oneMonth(fixture.request);
    const registry = new PerformanceRegistry();
    let workerRequest: ForecastWorkerRequest | undefined;
    const worker: ForecastWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, terminate() {}, postMessage(message) { workerRequest = message; } };
    const controller = new ForecastController(() => worker, { set: () => 0, clear() {} }, () => {}, registry.record.bind(registry));
    const input = { operation: "baseline_forecast" as const, fingerprint: calculationFingerprint("baseline_forecast", fixture.model, request), model: fixture.model, request, performanceContext: context };
    controller.submit(input, true);
    expect(registry.latest("transport.serialization")).toMatchObject({ availability: "not_measured", context: { executionLocation: "browser_main", cacheState: "miss" } });
    expect(registry.summary("forecast.total")).toBeUndefined();
    let tick = 0;
    const response: ForecastWorkerResponse = executeForecastWorkerRequest(workerRequest!, { now: () => ++tick });
    worker.onmessage?.({ data: response });
    expect(registry.summary("forecast.total")?.count).toBe(1);
    const original = controller.state.lastGoodResult;
    controller.submit(input, true);
    expect(controller.state.lastGoodResult).toBe(original);
    expect(registry.latest("forecast.total")).toMatchObject({ availability: "not_measured", context: { cacheState: "hit", executionLocation: "browser_main" } });
    expect(registry.latest("forecast.total")?.durationMs).toBeUndefined();
    expect(registry.summary("forecast.total")?.count).toBe(1);
    expect(registry.summary("transport.serialization")).toBeUndefined();
    controller.dispose();
  });
  it("is observational and aggregates phase segments", () => {
    const fixture = createRealisticPerformanceFixture();
    const request = oneMonth(fixture.request);
    const baseline = runPersonalHouseholdForecast(fixture.model, request);
    expect(baseline.status, JSON.stringify(baseline.diagnostics)).toBe("completed");
    let tick = 0;
    const registry = new PerformanceRegistry();
    const observed = runPersonalHouseholdForecast(fixture.model, request, createApplicationPerformanceObserver({ now: () => ++tick }, context, registry));
    expect(observed).toEqual(baseline);
    expect(registry.summary("forecast.total")?.count).toBe(1);
    expect(registry.summary("engine.prepare")?.latest).toBeGreaterThan(1);
    expect(registry.summary("engine.execute")?.count).toBe(1);
    // A unit-step clock proves these sibling phases cannot include each other.
    expect(registry.summary("compile.model_and_slices")?.latest).toBe(1);
    expect(registry.summary("compile.opening_reconciliation")?.latest).toBe(2);
    expect(registry.latest("transport.serialization")?.availability).toBe("not_applicable");
    expect(registry.summary("transport.serialization")).toBeUndefined();
    for (const phase of ["forecast.total", "compile.model_and_slices", "engine.execute", "application.read_model"] as const) {
      expect(registry.latest(phase)?.context).toMatchObject({ ...context, status: "completed" });
    }
  });

  it("swallows throwing clock and sink failures without changing success or failure", () => {
    const fixture = createRealisticPerformanceFixture();
    const request = oneMonth(fixture.request);
    const baseline = runPersonalHouseholdForecast(fixture.model, request);
    const throwing = createApplicationPerformanceObserver({ now: () => { throw new Error("clock"); } }, context, { record: () => { throw new Error("sink"); } });
    expect(runPersonalHouseholdForecast(fixture.model, request, throwing)).toEqual(baseline);
    const invalid = { ...request, asOf: "2027-01-01" };
    expect(runPersonalHouseholdForecast(fixture.model, invalid, throwing)).toEqual(runPersonalHouseholdForecast(fixture.model, invalid));
    const throwingSink = createApplicationPerformanceObserver({ now: () => 1 }, context, { record: () => { throw new Error("sink"); } });
    expect(runPersonalHouseholdForecast(fixture.model, request, throwingSink)).toEqual(baseline);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const registry = new PerformanceRegistry();
      expect(runPersonalHouseholdForecast(fixture.model, request, createApplicationPerformanceObserver({ now: () => value }, context, registry))).toEqual(baseline);
      expect(registry.latest("forecast.total")?.availability).toBe("unavailable");
    }
  });

  it("keeps only the latest 100 completed measurements and exposes summaries", () => {
    const registry = new PerformanceRegistry();
    for (let index = 0; index < 120; index += 1) registry.record({ phase: "forecast.total", availability: "measured", durationMs: index, context });
    expect(registry.records("forecast.total")).toHaveLength(100);
    expect(registry.summary("forecast.total")).toMatchObject({ latest: 119, p50: 69, p95: 114, max: 119, count: 100, context });
    expect(registry.summary("forecast.total")?.contexts).toHaveLength(100);
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
    // Only realistic execution is ordinary-CI evidence.
    {
      const fixture = realistic;
      const boundedRequest = oneMonth(fixture.request);
      const result = runPersonalHouseholdForecast(fixture.model, boundedRequest);
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
      requireCompletedPerformanceForecast(result, fixture.id);
      if (result.status !== "completed") throw new Error("Fixture failed.");
      expect(result.points).toHaveLength(1);
      expect(result.reachedThrough).toBe(result.requestedHorizon.end);
      expect(result.openingSnapshot.positions).toHaveLength(fixture.coverage.canonicalObjectCounts.Investment!);
      expect(result.retirementMilestones).toHaveLength(fixture.request.compiler.cashFlow!.retirementBindings!.length);
      expect(result.points[0]!.investmentContributionPrincipal.amount).not.toBe("0");
      expect(result.points[0]!.debtPrincipalReduction.amount).not.toBe("0");
      const mechanicsRequest = { ...boundedRequest, compiler: { ...boundedRequest.compiler,
        cashFlow: { ...boundedRequest.compiler.cashFlow!, simulationEnd: "2026-03-01", months: 2 },
        investments: { ...boundedRequest.compiler.investments!, simulationEnd: "2026-03-01", months: 2 },
        liabilities: { ...boundedRequest.compiler.liabilities!, simulationEnd: "2026-03-01", months: 2 },
      } };
      const compiled = compileHouseholdProjection(fixture.model, mechanicsRequest.compiler);
      expect(compiled.status).toBe("compiled");
      if (compiled.status !== "compiled") throw new Error("Fixture compilation failed.");
      expect(compiled.value.investmentInput!.transfers).toHaveLength(1);
      expect(compiled.value.liabilityInput!.loans.some((loan) => (loan.extraPrincipalPayments?.length ?? 0) > 0)).toBe(true);
      const executed = runCompiledHouseholdProjection({ compiled: { ...compiled.value, executionMonths: 2 }, runContext: createRunContext({
        runId: runId(fixture.request.runIdentity), scenarioId: scenarioId(compiled.value.scenarioIdentity), baseCurrency: USD,
        asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"),
        simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-03-01T00:00:00.000Z"),
      }) });
      expect(executed.status, JSON.stringify(executed.diagnostics)).toBe("completed");
      const savings = "90000000-0000-4000-8000-000000000013";
      expect(executed.state.accounts[savings]!.cash.minus(compiled.value.reconciledOpeningState.accounts[savings]!.cash).amount.toString()).toBe("100");
      expect(executed.periods[1]!.liability!.liabilities.some((loan) => loan.extraPrincipalPaid.isPositive())).toBe(true);
      const traceIds = new Set(result.points.flatMap((point) => point.traceIds));
      for (const type of ["Income", "Expense", "Investment"] as const) {
        for (const item of fixture.model.objects[type] ?? []) {
          const id = (item as Record<string, unknown>)[`${type.toLowerCase()}_id`];
          expect(traceIds.has(`compiler:canonical:${type}:${String(id)}`)).toBe(true);
        }
      }
      expect(fixture.coverage.scenarios).toHaveLength(2);
      expect(fixture.coverage.rules.join(" ")).not.toContain("contention policy");
    }
    expect(stress.coverage.canonicalObjectCounts.Expense).toBeGreaterThan(realistic.coverage.canonicalObjectCounts.Expense!);
    expect(realistic.coverage.unsupportedGaps.join(" ")).toContain("multi-member");
    for (const type of ["Account", "Income", "Expense", "Investment", "Liability", "Event", "PrimitiveInstance"] as const) {
      expect(stress.coverage.canonicalObjectCounts[type]).toBeGreaterThan(realistic.coverage.canonicalObjectCounts[type]!);
    }
    expect(stress.dimensions.horizonMonths).toBe(180);
    expect(stress.dimensions.recurringOperationCount).toBeGreaterThan(realistic.dimensions.recurringOperationCount);
    const stressRequest = oneMonth(stress.request);
    const stressCompiled = compileHouseholdProjection(stress.model, stressRequest.compiler);
    expect(stressCompiled.status, JSON.stringify(stressCompiled.diagnostics)).toBe("compiled");
    if (stressCompiled.status !== "compiled") throw new Error("Stress fixture compilation failed.");
    const stressInputs = stressCompiled.value;
    expect(stressInputs.executionMonths).toBe(1);
    expect(stressInputs.cashFlowInput!.incomes).toHaveLength(stress.coverage.canonicalObjectCounts.Income!);
    expect(stressInputs.cashFlowInput!.expenses).toHaveLength(stress.coverage.canonicalObjectCounts.Expense!);
    expect(stressInputs.cashFlowInput!.events).toHaveLength(stress.request.compiler.cashFlow!.retirementBindings!.length);
    expect(stressInputs.investmentInput!.purchases).toHaveLength(stress.request.compiler.investments!.purchaseInstructions.length);
    expect(stressInputs.investmentInput!.transfers).toHaveLength(stress.request.compiler.investments!.transferInstructions.length);
    expect(stress.request.compiler.investments!.purchaseInstructions.some((purchase) => purchase.schedule.kind === "utc_monthly")).toBe(true);
    expect(stress.request.compiler.investments!.transferInstructions.some((transfer) => transfer.schedule.kind === "utc_monthly")).toBe(true);
    expect(stressInputs.liabilityInput!.loans).toHaveLength(stress.coverage.canonicalObjectCounts.Liability!);
    // Future extra-principal instructions and their required-service contract are
    // declarations here; execution belongs to the full heavy forecast.
    expect(stress.request.compiler.liabilities!.executionProfiles.some((profile) =>
      (profile.extraPrincipalPayments?.length ?? 0) > 0 && profile.paymentAnchor.endsWith("-01")
      && (profile.extraPrincipalPayments ?? []).every((payment) => payment.scheduledAt === "2026-02-01"),
    )).toBe(true);
    expect(stressInputs.scenarioIdentity).toBe(stress.request.compiler.cashFlow!.scenarioId);
    expect(stress.model.objects.Scenario).toHaveLength(1);
    expect(stress.coverage.scenarios.join(" ")).toContain("heavy validation");
    expect(stress.coverage.executionMechanics).toContain("extra principal with required-service dependency");
    expect(stress.coverage.unsupportedGaps.join(" ")).toContain("multi-member");
    expect(stress.coverage.executableEvidence.join(" ")).toContain("benchmarks/capture.ts: bounded lower-return comparison validation");
  });

  it("executes the declared lower-return comparison intent", () => {
    {
      const fixture = createRealisticPerformanceFixture();
      expect(fixture.comparisonIntents).toHaveLength(1);
      const comparison = comparePersonalHouseholdScenarioIntents(fixture.model, oneMonth(fixture.request), fixture.comparisonIntents);
      expect(comparison.status, JSON.stringify(comparison.diagnostics)).toBe("completed");
      expect(comparison.alternatives).toHaveLength(1);
      expect(comparison.alternatives[0]!.status).toBe("completed");
      expect(comparison.alternatives[0]!.points.some((point) => point.deltas.netWorth.amount !== "0")).toBe(true);
    }
    const stress = createStressPerformanceFixture();
    expect(stress.comparisonIntents).toHaveLength(1);
    const intent = stress.comparisonIntents[0]!;
    expect(intent.baseScenarioId).toBe(stress.request.compiler.investments!.scenarioId);
    expect(intent.scenarioId).not.toBe(intent.baseScenarioId);
    expect(intent.changes).toHaveLength(1);
    const change = intent.changes[0]!;
    expect(change.kind).toBe("investment_return");
    if (change.kind !== "investment_return") throw new Error("Stress intent must change investment return.");
    expect(change.annualRate).toBe("0.0200");
    const target = (stress.model.objects.Investment ?? []).find((value) =>
      (value as Record<string, unknown>).investment_id === change.investmentId,
    ) as Record<string, unknown> | undefined;
    expect(target).toBeDefined();
    expect((stress.model.objects.PrimitiveInstance ?? []).some((value) => {
      const primitive = value as Record<string, unknown>;
      return primitive.primitive_instance_id === target?.return_model_id && primitive.primitive_id === "P23";
    })).toBe(true);
  });

  it("declares an independent horizon and recurring-operation scaling matrix with bounded compilation", () => {
    const fixtures = createPerformanceScalingFixtures();
    expect(fixtures).toHaveLength(4);
    expect(new Set(fixtures.map((fixture) => fixture.dimensions.horizonMonths))).toEqual(new Set([12, 24]));
    expect(new Set(fixtures.map((fixture) => fixture.dimensions.recurringOperationCount)).size).toBe(2);
    for (const fixture of fixtures) {
      expect(fixture.request.compiler.cashFlow!.months).toBe(fixture.dimensions.horizonMonths);
      expect(fixture.request.compiler.investments!.months).toBe(fixture.dimensions.horizonMonths);
      expect(fixture.request.compiler.liabilities!.months).toBe(fixture.dimensions.horizonMonths);
      expect(fixture.dimensions.modelEntityCount).toBe(Object.values(fixture.coverage.canonicalObjectCounts).reduce((sum, count) => sum + count, 0));
      const counts = fixture.coverage.canonicalObjectCounts;
      const investments = fixture.request.compiler.investments!;
      expect(fixture.dimensions.recurringOperationCount).toBe((counts.Income ?? 0) + (counts.Expense ?? 0)
        + investments.purchaseInstructions.filter((item) => item.schedule.kind === "utc_monthly").length
        + investments.transferInstructions.length + fixture.request.compiler.liabilities!.executionProfiles.length);
      expect(fixture.coverage.executableEvidence.length).toBeGreaterThan(0);
      expect(fixture.coverage.scenarios).toHaveLength(2);
      expect(fixture.coverage.unsupportedGaps.join(" ")).toContain("multi-member");
      const compiled = compileHouseholdProjection(fixture.model, oneMonth(fixture.request).compiler);
      expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("compiled");
      if (compiled.status !== "compiled") throw new Error("Scaling fixture compilation failed.");
      expect(compiled.value.executionMonths).toBe(1);
      expect(compiled.value.cashFlowInput!.incomes).toHaveLength(counts.Income!);
      expect(compiled.value.cashFlowInput!.expenses).toHaveLength(counts.Expense!);
      expect(compiled.value.investmentInput!.returns).toHaveLength(counts.Investment!);
      expect(compiled.value.liabilityInput!.loans).toHaveLength(counts.Liability!);
    }
  });

  it("rejects partial/unavailable evidence without manufacturing timing or success", () => {
    for (const status of ["incomplete", "unavailable", "unsupported", "error"]) {
      expect(() => requireCompletedPerformanceForecast({ status }, "fixture")).toThrow("did not complete");
    }
    expect(() => requireCompletedPerformanceForecast({ status: "completed", requestedHorizon: { start: "2026-01-01", end: "2027-01-01" }, reachedThrough: "2026-02-01" }, "fixture")).toThrow();
  });

  it("retains record/summary/artifact context and absolute memory without retaining financial results", () => {
    const fixture = createRealisticPerformanceFixture();
    const registry = new PerformanceRegistry();
    const sampleContext: PerformanceContext = { ...context, horizon: { start: "2026-01-01", end: "2026-02-01" }, modelCounts: fixture.coverage.canonicalObjectCounts,
      modelVersion: fixture.model.modelFormatVersion, specificationVersion: fixture.model.financialSpecificationVersion, engineVersion: "0.1.0", scalingDimensions: { ...fixture.dimensions, horizonMonths: 1 } };
    let tick = 0;
    const result = runPersonalHouseholdForecast(fixture.model, oneMonth(fixture.request), createApplicationPerformanceObserver({ now: () => ++tick }, sampleContext, registry));
    const sample = createPerformanceEvidenceSample(registry, result, { cpuTimeMs: 1, memoryBytes: 1024, memoryDeltaBytes: -64, metering: "not_metered" });
    expect(sample.context).toMatchObject({ ...sampleContext, status: "completed" });
    expect(sample.phases["forecast.total"]!.summary?.contexts).toEqual([sample.context]);
    expect(sample.phases["transport.serialization"]!.availability).toBe("not_applicable");
    expect(sample.resources).toEqual({ cpuTimeMs: 1, memoryBytes: 1024, memoryDeltaBytes: -64, metering: "not_metered" });
    expect(sample.requestedHorizon?.end).toBe(sample.reachedThrough);
    expect(sample).not.toHaveProperty("points");
    expect(sample).not.toHaveProperty("openingSnapshot");
    expect(() => createPerformanceEvidenceSample(registry, { status: "incomplete" }, { metering: "not_metered" })).toThrow();
  });

  it("preserves thrown operations and ignores reversed diagnostic clocks", () => {
    const failure = new Error("authoritative failure");
    const registry = new PerformanceRegistry();
    let tick = 10;
    const session = createPerformanceSession(createApplicationPerformanceObserver({ now: () => --tick }, context, registry));
    expect(() => session.measure("engine.execute", () => { throw failure; })).toThrow(failure);
    session.finish();
    expect(registry.latest("engine.execute")?.availability).toBe("unavailable");
    expect(registry.summary("engine.execute")).toBeUndefined();
  });
});
