import { describe, expect, it } from "vitest";
import { createFlagshipHouseholdDraft, createGoldenHouseholdDraft, exportPersonalModelJson, importPersonalModelJson, resolvePersonalSessionSettings, runPersonalForecast, type JsonObject, type PersonalDraft } from "../src/application/personalMvp.js";
import { age90Horizon, birthdayAtAge, retirementProposals, resolveForecastReadiness } from "../src/application/forecastReadiness.js";
import { createGoldenExampleConfiguration, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { createHouseholdForecastRequest, runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { baselineResultMatchesRequest, calculationFingerprint } from "../src/application/interactiveForecast.js";
import { boundedEvidencePoints, claimForecastEvidenceWorker, forecastEvidenceController, EVIDENCE_DEADLINE_MS, FORECAST_DEADLINE_MS, EvidenceController, ForecastController, StandaloneController, type StandaloneWorkerPort, type EvidenceWorkerPort, type ForecastWorkerPort } from "../ui/forecast/controller.js";
import type { EvidenceWorkerRequest, EvidenceWorkerResponse, ForecastWorkerRequest, StandaloneWorkerRequest } from "../ui/forecast/protocol.js";
import { executeForecastWorkerRequest } from "../ui/forecast/execute.js";
import { cashComparison, inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import { inspectMortgageWindow } from "../src/application/mortgageChartData.js";
import type { HouseholdForecastRequest, PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import { acceptRetirementProposal, acceptPlanningStarters } from "../src/application/forecastSetup.js";
import { diagnosticSummary } from "../ui/authoring/diagnosticSummary.js";

const withDob = (dob: string): PersonalDraft => {
  const model = createGoldenHouseholdDraft();
  return { ...model, objects: { ...model.objects, Person: (model.objects.Person as readonly JsonObject[]).map(person => ({ ...person, date_of_birth: dob })) } };
};

// Transport-only fixtures: no amounts or replay are synthesized. The real
// engine regression below separately requires the actual two monthly results.
const transportResult = (request: HouseholdForecastRequest, status: "completed" | "incomplete" = "completed", count = request.compiler.cashFlow!.months!): PersonalHouseholdForecastReadModel => {
  const start = `${request.compiler.cashFlow!.simulationStart}T00:00:00.000Z`;
  const at = (offset: number) => { const date = new Date(start); date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString(); };
  return { scope: "household", status, asOf: `${request.asOf}T00:00:00.000Z`, dataCutoff: `${request.dataCutoff}T00:00:00.000Z`,
    requestedHorizon: { start, end: `${request.compiler.cashFlow!.simulationEnd}T00:00:00.000Z` },
    reachedThrough: at(count), points: Array.from({ length: count }, (_, index) => ({ periodStart: at(index), periodEnd: at(index + 1) })),
  } as unknown as PersonalHouseholdForecastReadModel;
};

describe("U1B request and period pairing", () => {
  it("rejects wrong windows, missing completed periods and gaps while preserving truthful zero-period incomplete", () => {
    const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: "2026-03-01" }, ids.model);
    const good = transportResult(request);
    expect(baselineResultMatchesRequest(good, request)).toBe(true);
    expect(baselineResultMatchesRequest(transportResult(request, "completed", 0), request)).toBe(false);
    expect(baselineResultMatchesRequest(transportResult(request, "incomplete", 0), request)).toBe(true);
    if (good.status === "unavailable") throw new Error("Expected transport fixture");
    expect(baselineResultMatchesRequest({ ...good, points: good.points.slice(1) }, request)).toBe(false);
    expect(baselineResultMatchesRequest({ ...good, requestedHorizon: { ...good.requestedHorizon, end: "2080-02-01T00:00:00.000Z" } }, request)).toBe(false);
  });
  it("keeps the latest short request paired through supersession, cache hits, invalidation and retry", () => {
    const workers: (ForecastWorkerPort & { request?: ForecastWorkerRequest })[] = [];
    const controller = new ForecastController(() => {
      const worker: ForecastWorkerPort & { request?: ForecastWorkerRequest } = {
        onmessage: null, onerror: null, onmessageerror: null, terminate() {}, postMessage(message) { this.request = message; },
      };
      workers.push(worker); return worker;
    }, { set: (_callback, delay) => { expect(delay).toBe(FORECAST_DEADLINE_MS); return 0; }, clear: () => {} }, () => {}, () => {});
    const model = createFlagshipHouseholdDraft();
    const submit = (end: string) => {
      const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: end }, ids.model);
      return { operation: "baseline_forecast" as const, model, request, fingerprint: calculationFingerprint("baseline_forecast", model, request),
        performanceContext: { runId: request.runIdentity, dataClassification: "synthetic" as const, modelCounts: {}, executionLocation: "browser_worker" as const, cacheState: "miss" as const } };
    };
    const deliver = (index: number, result = transportResult(workers[index]!.request!.request)) => {
      const message = workers[index]!.request!;
      workers[index]!.onmessage?.({ data: { operation: message.operation, requestId: message.requestId, fingerprint: message.fingerprint, outcome: "result", result, records: [] } });
    };
    const long = submit("2080-02-01"), short = submit("2026-03-01");
    controller.submit(long, true); controller.submit(short, true);
    deliver(0);
    expect(controller.state.pending).toBe(true);
    const good = transportResult(short.request);
    deliver(1, good);
    expect(controller.state).toMatchObject({ lastGoodResult: good, resultRequest: short.request, cacheState: "miss", resultFingerprint: short.fingerprint });
    controller.submit(short, true);
    expect(workers).toHaveLength(2);
    expect(controller.state).toMatchObject({ lastGoodResult: good, cacheState: "hit", pending: false });
    controller.submit(long, true);
    expect(controller.state.latestResult).toBeUndefined();
    controller.invalidate(); deliver(2);
    expect(controller.state).toMatchObject({ lastGoodResult: good, stale: true, pending: false });
    controller.submit(long, true);
    deliver(3, transportResult(short.request));
    expect(controller.state).toMatchObject({ lifecycle: "error", lastGoodResult: good, stale: true });
    controller.submit(short, true);
    expect(controller.state).toMatchObject({ lifecycle: "completed", cacheState: "hit", resultRequest: short.request });
    controller.reset(); controller.submit(short, true);
    expect(workers).toHaveLength(5);
    expect(controller.state.lastGoodResult).toBeUndefined();
    controller.dispose();
  });
});

describe("U1B sourced planning readiness", () => {
  it("fails closed on a missed baseline response and mismatched identity, then retries on a fresh worker", () => {
    const model = createFlagshipHouseholdDraft();
    const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: "2026-03-01" }, ids.model);
    const submission = { operation: "baseline_forecast" as const, model, request, fingerprint: calculationFingerprint("baseline_forecast", model, request),
      performanceContext: { runId: request.runIdentity, dataClassification: "synthetic" as const, modelCounts: {}, executionLocation: "browser_worker" as const, cacheState: "miss" as const } };
    const timers = new Map<number, () => void>(); let sequence = 0;
    const workers: (ForecastWorkerPort & { message?: ForecastWorkerRequest; stopped: boolean })[] = [];
    const controller = new ForecastController(() => {
      const worker: typeof workers[number] = { onmessage: null, onerror: null, onmessageerror: null, stopped: false,
        postMessage(message) { this.message = message; }, terminate() { this.stopped = true; } };
      workers.push(worker); return worker;
    }, { set(callback, delay) { expect(delay).toBe(FORECAST_DEADLINE_MS); timers.set(++sequence, callback); return sequence; }, clear(handle) { timers.delete(handle as number); } }, () => {}, () => {});
    controller.submit(submission, true);
    const late = workers[0]!.onmessage!;
    [...timers.values()][0]!();
    expect(controller.state).toMatchObject({ lifecycle: "error", pending: false });
    expect(workers[0]!.stopped).toBe(true);
    expect(timers.size).toBe(0);
    const deliver = (index: number, fingerprint = submission.fingerprint) => ({ ...workers[index]!.message!, fingerprint,
      outcome: "result" as const, result: transportResult(request), records: [] });
    controller.submit(submission, true);
    late({ data: deliver(0) });
    expect(controller.state.pending).toBe(true);
    workers[1]!.onmessage!({ data: deliver(1, "other-household") });
    expect(controller.state.pending).toBe(true); // Foreign responses cannot settle this request.
    [...timers.values()][0]!();
    expect(controller.state).toMatchObject({ lifecycle: "error", pending: false });
    controller.submit(submission, true);
    workers[2]!.onmessage!({ data: deliver(2) });
    expect(controller.state).toMatchObject({ lifecycle: "completed", pending: false });
    expect(timers.size).toBe(0);
    controller.dispose();
  });

  it.each([0, 12, 24])("bounds original-source evidence at index %s, shares its generating worker and independently verifies portable equality", startIndex => {
    const phaseDurations: { phase: string; durationMs: number }[] = [];
    const model = createFlagshipHouseholdDraft();
    const configuration = { ...createGoldenExampleConfiguration(), simulationEnd: "2028-02-01" };
    const request = createHouseholdForecastRequest(configuration, ids.model);
    const submission = { operation: "baseline_forecast" as const, model, request, fingerprint: calculationFingerprint("baseline_forecast", model, request),
      performanceContext: { runId: request.runIdentity, dataClassification: "synthetic" as const, modelCounts: {}, executionLocation: "browser_worker" as const, cacheState: "miss" as const } };
    let baselineMessage: ForecastWorkerRequest | undefined;
    const baselinePort: ForecastWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, postMessage(message) { baselineMessage = message; }, terminate() {} };
    const baseline = new ForecastController(() => baselinePort, { set: () => 0, clear() {} }, () => {}, () => {});
    baseline.submit(submission, true);
    const baselineStarted = performance.now();
    const response = executeForecastWorkerRequest(baselineMessage!, { now: () => performance.now() });
    phaseDurations.push({ phase: "baseline", durationMs: performance.now() - baselineStarted });
    expect(response.outcome).toBe("result");
    if (response.outcome !== "result" || !("points" in response.result)) throw new Error("Missing actual forecast");
    const result = response.result;
    expect(result.scope).toBe("household");
    expect(result.status).toBe("completed");
    expect(result.openingSnapshot.netWorth.amount).toBe("4289330.29");
    expect(result.points[0]!.cash.amount).toBe("4007874.71");
    expect(result.points).toHaveLength(25);
    baselinePort.onmessage!({ data: response });
    const worker = claimForecastEvidenceWorker(result)!;
    expect(worker).toBe(baselinePort);
    expect(claimForecastEvidenceWorker(result)).toBeUndefined();
    const messages: EvidenceWorkerRequest[] = [];
    worker.postMessage = message => {
      messages.push(structuredClone(message));
      const response = executeForecastWorkerRequest(structuredClone(message), { now: () => performance.now() }, progress => {
        if (progress.outcome === "progress" && progress.durationMs !== undefined) phaseDurations.push({ phase: progress.phase, durationMs: progress.durationMs });
        worker.onmessage?.({ data: progress });
      });
      worker.onmessage?.({ data: response });
    };
    const evidence = forecastEvidenceController(result, model, () => worker);
    const before = calculationFingerprint("baseline_forecast", model, request);
    const transportedBasis = structuredClone(boundedEvidencePoints(result, { operation: "mortgage_evidence", startIndex: 0, liabilityId: ids.mortgage }).basis);
    const transportedPoints = result.points.map(point => ({ ...point, traceRefs: point.traceRefs.map(ref => ({ ...ref,
      ...(ref.replayArtifact === undefined ? {} : { replayArtifact: { ...(ref.replayArtifact as object), basis: transportedBasis } }),
    })) }));
    {
      const selection = { operation: "mortgage_evidence" as const, startIndex, liabilityId: ids.mortgage };
      let actual: EvidenceWorkerResponse | undefined;
      evidence.select(selection, response => { actual = response; });
      const selected = actual as EvidenceWorkerResponse | undefined;
      expect(selected?.outcome).toBe("result");
      if (selected?.outcome === "result") {
        expect(selected.window).toEqual(inspectMortgageWindow(result.points.slice(startIndex, startIndex + 12), ids.mortgage));
        const portableStarted = performance.now();
        expect(selected.window).toEqual(inspectMortgageWindow(transportedPoints.slice(startIndex, startIndex + 12), ids.mortgage));
        phaseDurations.push({ phase: "independent_portable_restore_and_replay", durationMs: performance.now() - portableStarted });
      }
      expect(messages.at(-1)!.points).toHaveLength(startIndex === 24 ? 1 : 12);
      expect(messages.at(-1)!.source?.basis).toBeUndefined();
      expect(messages.at(-1)!.points.flatMap(point => point.traceRefs).every(ref => !ref.replayArtifact || !("basis" in (ref.replayArtifact as object)))).toBe(true);
    }
    evidence.select({ operation: "mortgage_evidence", startIndex, liabilityId: ids.mortgage }, () => {});
    expect(messages).toHaveLength(1);
    evidence.select({ operation: "monthly_evidence", startIndex, liabilityId: "" }, response => {
      if (response.outcome === "progress") return;
      expect(response.outcome).toBe("result");
      if (response.outcome === "result") expect(response.detail).toEqual(inspectMonthlyMoney(result.points[startIndex]!, model));
    });
    expect(evidence.diagnostics.map(record => record.phase)).toContain("restored");
    expect(calculationFingerprint("baseline_forecast", model, request)).toBe(before);
    evidence.dispose(); baseline.dispose();
    const selected = messages[0]!;
    const authenticated = { ...selected, source: { basis: transportedBasis, model, diagnosticCatalogs: result.diagnosticCatalogs! } };
    expect(executeForecastWorkerRequest({ ...authenticated, startIndex: startIndex + 1 }, { now: () => 0 }).outcome).toBe("error");
    expect(executeForecastWorkerRequest({ ...authenticated, fingerprint: "other-household" }, { now: () => 0 }).outcome).toBe("error");
    expect(executeForecastWorkerRequest({ ...authenticated, source: { model, basis: { ...transportedBasis, encoded: transportedBasis.encoded + "corrupt" } } }, { now: () => 0 }).outcome).toBe("error");
    const retried = executeForecastWorkerRequest(authenticated, { now: () => 0 });
    expect(retried.outcome).toBe("result");
    if (retried.outcome === "result") expect(retried.window).toEqual(inspectMortgageWindow(result.points.slice(startIndex, startIndex + 12), ids.mortgage));
    console.info("U1B bounded evidence phases", { startIndex, phaseDurations });
  }, 30_000);

  it("keeps evidence ownership across panel gaps and releases it on replacement, cache-hit invalidation and disposal", () => {
    const model = createFlagshipHouseholdDraft();
    const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: "2026-03-01" }, ids.model);
    const submission = { operation: "baseline_forecast" as const, model, request, fingerprint: "lifetime-only",
      performanceContext: { runId: request.runIdentity, dataClassification: "synthetic" as const, modelCounts: {}, executionLocation: "browser_worker" as const, cacheState: "miss" as const } };
    const result = transportResult(request);
    if (result.status === "unavailable") throw new Error("Missing transport fixture");
    const forecast = { ...result, points: result.points.map(point => ({ ...point, traceRefs: [{ traceId: "source-lifetime", replayArtifact: {
      basis: { version: "household-replay/v3", encoded: "transport-only" }, start: point.periodStart, end: point.periodEnd,
    } }] })) } as unknown as PersonalHouseholdForecastReadModel;
    let stopped = 0;
    const port: ForecastWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() { ++stopped; } };
    const baseline = new ForecastController(() => port, { set: () => 0, clear() {} }, () => {}, () => {});
    baseline.submit(submission, true);
    port.onmessage!({ data: { operation: "baseline_forecast", requestId: baseline.state.requestId!, fingerprint: submission.fingerprint, outcome: "result", result: forecast, records: [] } });
    const messages: EvidenceWorkerRequest[] = [];
    const makeWorker = () => {
      const claimed = claimForecastEvidenceWorker(forecast)!;
      claimed.postMessage = message => { messages.push(message); };
      return claimed;
    };
    const cash = forecastEvidenceController(forecast, model, makeWorker);
    const delivered: EvidenceWorkerResponse[] = [];
    const unsubscribe = cash.select({ operation: "monthly_evidence", startIndex: 1, liabilityId: "" }, response => delivered.push(response));
    unsubscribe(); // Cash -> a screen without evidence -> Debt.
    expect(stopped).toBe(0);
    const debt = forecastEvidenceController(forecast, model, makeWorker);
    expect(debt).toBe(cash);
    debt.select({ operation: "mortgage_evidence", startIndex: 0, liabilityId: ids.mortgage }, () => {});
    expect(messages).toHaveLength(2);
    expect(messages[0]!.source).toEqual({ model });
    expect(messages[1]!.source).toBeUndefined();
    const handler = (port as unknown as EvidenceWorkerPort).onmessage!;
    baseline.invalidate();
    expect(stopped).toBe(1);
    handler({ data: { ...messages[0]!, outcome: "error", error: "old-source" } });
    expect(delivered).toHaveLength(0);
    baseline.submit(submission, true); // A cached baseline still owns evidence lifetime.
    const revived = forecastEvidenceController(forecast, model, () => ({ onmessage: null, onerror: null, onmessageerror: null, postMessage(message) { messages.push(message); }, terminate() { ++stopped; } }));
    expect(revived).not.toBe(cash);
    revived.select({ operation: "monthly_evidence", startIndex: 1, liabilityId: "" }, () => {});
    expect(messages.at(-1)!.source?.basis).toBeDefined();
    baseline.reset();
    expect(stopped).toBe(2);
    baseline.dispose();
    expect(stopped).toBe(2);
  });

  it("settles never-answered, mismatched, clone, startup and worker errors; retry owns a fresh channel", () => {
    const model = createFlagshipHouseholdDraft();
    // Transport fixtures have no financial values; only lifecycle is exercised.
    const result = { status: "completed", points: [{ periodStart: "2026-01-01", periodEnd: "2026-02-01", traceRefs: [{ traceId: "source-a", replayArtifact: { basis: { version: "household-replay/v3", encoded: "transport-only" }, start: "2026-01-01", end: "2026-02-01" } }] }] } as unknown as PersonalHouseholdForecastReadModel;
    const timers = new Map<number, () => void>(); let sequence = 0;
    const scheduler = { set(callback: () => void, delay: number) { expect(delay).toBe(EVIDENCE_DEADLINE_MS); timers.set(++sequence, callback); return sequence; }, clear(handle: unknown) { timers.delete(handle as number); } };
    const workers: (EvidenceWorkerPort & { message?: EvidenceWorkerRequest; stopped: boolean })[] = [];
    const controller = new EvidenceController({ forecast: result, model }, () => {
      const worker: typeof workers[number] = { onmessage: null, onerror: null, onmessageerror: null, stopped: false, postMessage(message) { this.message = message; }, terminate() { this.stopped = true; } };
      workers.push(worker); return worker;
    }, scheduler, () => 1);
    const values: EvidenceWorkerResponse[] = [];
    const selection = { operation: "mortgage_evidence" as const, startIndex: 0, liabilityId: ids.mortgage };
    const select = () => controller.select(selection, response => values.push(response), true);
    select();
    controller.select({ ...selection, operation: "monthly_evidence" }, response => values.push(response));
    expect(workers).toHaveLength(1); // concurrent independent panel requests
    const staleHandler = workers[0]!.onmessage!;
    [...timers.values()][0]!();
    expect(values.map(value => value.outcome)).toEqual(["error", "error"]);
    expect(timers.size).toBe(0);
    select();
    staleHandler({ data: { ...workers[0]!.message!, outcome: "error", error: "old" } });
    expect(values).toHaveLength(2);
    const next = workers[1]!;
    next.onmessage!({ data: { ...next.message!, fingerprint: "other-household", outcome: "error", error: "wrong" } });
    expect(values.at(-1)?.outcome).toBe("error");
    expect(next.stopped).toBe(true);
    select();
    const broken = workers.at(-1)!;
    broken.onmessage!({ data: { ...broken.message!, outcome: "error", error: "private runtime exception" } });
    expect(values.at(-1)).toMatchObject({ outcome: "error", error: expect.stringContaining("missing or mismatched period/source data") });
    expect(JSON.stringify(values)).not.toContain("private runtime exception");
    select(); workers.at(-1)!.onmessageerror!();
    select(); workers.at(-1)!.onerror!({ preventDefault() {} });
    select(); const cancelled = workers.at(-1)!.onmessage!; const pending = workers.at(-1)!.message!;
    controller.dispose(); const length = values.length;
    cancelled({ data: { ...pending, outcome: "error", error: "disposed" } });
    expect(values).toHaveLength(length);
    expect(timers.size).toBe(0);
    for (const makeWorker of [() => { throw new Error("startup"); }, () => ({ onmessage: null, onerror: null, onmessageerror: null, postMessage() { throw new Error("clone"); }, terminate() {} })]) {
      const failed = new EvidenceController({ forecast: result, model }, makeWorker, scheduler);
      failed.select(selection, response => expect(response.outcome).toBe("error"));
      expect(timers.size).toBe(0);
    }
    expect(controller.diagnostics.some(record => record.phase === "timeout")).toBe(true);
    expect(JSON.stringify(controller.diagnostics)).not.toContain("transport-only");
  });

  it("runs the exact standalone API off-thread and rejects superseded requests without changing dates or scope", () => {
    const model = createFlagshipHouseholdDraft(), configuration = createGoldenExampleConfiguration();
    const request = resolvePersonalSessionSettings(configuration, "cash_flow").request!;
    const workers: (StandaloneWorkerPort & { message?: StandaloneWorkerRequest; stopped: boolean })[] = [];
    const views: import("../ui/forecast/controller.js").StandaloneView[] = [];
    const timers = new Map<number, () => void>(); let timerId = 0;
    const controller = new StandaloneController(() => {
      const worker: typeof workers[number] = { onmessage: null, onerror: null, onmessageerror: null, stopped: false, postMessage(message) { this.message = message; }, terminate() { this.stopped = true; } };
      workers.push(worker); return worker;
    }, view => views.push(view), { set(callback) { timers.set(++timerId, callback); return timerId; }, clear(handle) { timers.delete(handle as number); } });
    controller.run(model, request);
    expect(workers[0]!.message!.request).toEqual(request);
    expect(request.months).toBe(649);
    expect(views.at(-1)?.pending).toBe(true); // post only; no synchronous execution
    const old = workers[0]!.onmessage!;
    const shortRequest = { ...request, simulationEnd: "2026-03-01", months: 2 };
    controller.run(model, shortRequest);
    const actual = executeForecastWorkerRequest(workers[1]!.message!, { now: () => 0 });
    expect(actual.outcome).toBe("result");
    if (actual.outcome !== "result") throw new Error(actual.error);
    expect(actual.result).toEqual(runPersonalForecast(model, shortRequest));
    expect(actual.result.scope).toBe("cash_flow");
    old({ data: { ...actual, requestId: workers[0]!.message!.requestId } });
    expect(views.at(-1)?.pending).toBe(true);
    workers[1]!.onmessage!({ data: actual });
    expect(views.at(-1)).toMatchObject({ pending: false, stale: false, result: actual.result });
    controller.run(model, request); [...timers.values()][0]!();
    expect(views.at(-1)).toMatchObject({ pending: false, stale: true });
    expect(views.at(-1)?.error).toContain("retry");
    controller.run(model, request); controller.cancel();
    expect(views.at(-1)).toMatchObject({ pending: false, stale: true, cancelled: true });
    controller.invalidate(); expect(views.at(-1)?.cancelled).toBe(false);
    controller.run(model, request);
    const foreign = workers.at(-1)!;
    foreign.onmessage!({ data: { ...actual, requestId: foreign.message!.requestId } }); // Right channel, wrong horizon.
    expect(views.at(-1)).toMatchObject({ pending: false, stale: true, result: actual.result });
    expect(views.at(-1)?.error).toContain("retry");
    controller.run(model, request); workers.at(-1)!.onmessageerror!();
    expect(views.at(-1)?.error).toContain("retry");
    controller.run(model, request); workers.at(-1)!.onerror!({ preventDefault() {} });
    expect(views.at(-1)?.error).toContain("retry");
    expect(timers.size).toBe(0);
    controller.reset(); expect(views.at(-1)?.result).toBeUndefined(); controller.dispose();
    for (const makeWorker of [() => { throw new Error("startup"); }, () => ({ onmessage: null, onerror: null, onmessageerror: null,
      postMessage() { throw new Error("clone"); }, terminate() {} })]) {
      const failed = new StandaloneController(makeWorker, view => views.push(view));
      failed.run(model, request);
      expect(views.at(-1)?.pending).toBe(false);
      expect(views.at(-1)?.error).toContain("retry");
      failed.dispose();
    }
  });

  it("executes both requested months when the accepted flagship horizon is shortened", () => {
    const model = createFlagshipHouseholdDraft();
    const configuration = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-03-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(configuration, ids.model));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    if (result.status === "unavailable") throw new Error(result.message);
    expect(result.points, JSON.stringify(result.diagnostics)).toHaveLength(2);
    expect(result.requestedHorizon.end).toBe("2026-03-01T00:00:00.000Z");
    expect(result.reachedThrough).toBe(result.requestedHorizon.end);
    expect(result.points.map(point => point.statementIncome.amount)).toEqual(["0", "0"]);
    const before = JSON.stringify({ model, result });
    const fingerprintBefore = calculationFingerprint("baseline_forecast", model, createHouseholdForecastRequest(configuration, ids.model));
    let tick = 0;
    const clock = { now: () => ++tick };
    const selection = (startIndex: number): EvidenceWorkerRequest => ({ operation: "monthly_evidence", requestId: startIndex + 1, startIndex, liabilityId: "",
      points: boundedEvidencePoints(result, { operation: "monthly_evidence", startIndex, liabilityId: "" }).points,
      fingerprint: result.points[startIndex]!.traceRefs.find(ref => ref.replayArtifact !== undefined)!.traceId });
    const proof = boundedEvidencePoints(result, selection(0)).basis;
    for (const index of [0, 1]) {
      const response = executeForecastWorkerRequest({ ...selection(index), ...(index === 0 ? { source: structuredClone({ basis: proof, model, diagnosticCatalogs: result.diagnosticCatalogs! }) } : {}) }, clock);
      const { points: _points, ...boundary } = selection(index);
      expect(response).toMatchObject({ ...boundary, outcome: "result", durationMs: expect.any(Number) });
      expect(response.durationMs).toBeGreaterThan(0);
      if (response.outcome !== "result") throw new Error("Expected settled evidence result");
      expect(response.detail).toEqual(inspectMonthlyMoney(result.points[index]!, model));
      expect(cashComparison(response.detail!)?.knownUsesOnly).toBe(true);
      expect(cashComparison(response.detail!)?.drawable).toBe(true);
    }
    const mortgage = executeForecastWorkerRequest({ ...selection(0), operation: "mortgage_evidence", liabilityId: ids.mortgage, points: boundedEvidencePoints(result, { operation: "mortgage_evidence", startIndex: 0, liabilityId: ids.mortgage }).points }, clock);
    expect(mortgage.outcome).toBe("result");
    if (mortgage.outcome === "result") expect(mortgage.window).toEqual(inspectMortgageWindow(result.points, ids.mortgage));
    expect(executeForecastWorkerRequest({ ...selection(0), fingerprint: "wrong-source" }, clock).outcome).toBe("error");
    expect(executeForecastWorkerRequest({ ...selection(0), startIndex: -1 }, clock).outcome).toBe("error");
    const missing = { ...result, points: result.points.map(point => ({ ...point, traceRefs: [] })) };
    expect(executeForecastWorkerRequest({ ...selection(0), points: missing.points.slice(0, 1), source: { basis: proof, model } }, clock).outcome).toBe("error");
    let madeWorker = false;
    const missingEvidence = new EvidenceController({ forecast: missing, model }, () => { madeWorker = true; throw new Error("Missing source must fail before startup"); });
    missingEvidence.select({ operation: "mortgage_evidence", startIndex: 0, liabilityId: ids.mortgage }, response => {
      expect(response).toMatchObject({ outcome: "error", error: expect.stringContaining("missing or mismatched period/source data") });
    });
    expect(madeWorker).toBe(false);
    missingEvidence.dispose();
    expect(executeForecastWorkerRequest({ ...selection(0), source: { basis: proof, model } }, { now() { throw new Error("clock"); } }).outcome).toBe("result");
    expect(JSON.stringify({ model, result })).toBe(before);
    expect(calculationFingerprint("baseline_forecast", model, createHouseholdForecastRequest(configuration, ids.model))).toBe(fingerprintBefore);

    const workers: (EvidenceWorkerPort & { messages: EvidenceWorkerRequest[]; stopped: boolean })[] = [];
    const evidence = new EvidenceController({ forecast: result, model }, () => {
      const worker: typeof workers[number] = { onmessage: null, onerror: null, onmessageerror: null, messages: [], stopped: false,
        postMessage(message) { this.messages.push(message); }, terminate() { this.stopped = true; } };
      workers.push(worker); return worker;
    });
    const delivered: EvidenceWorkerResponse[] = [], cancelled: EvidenceWorkerResponse[] = [];
    const stop = evidence.select(selection(0), response => cancelled.push(response));
    evidence.select(selection(0), response => delivered.push(response));
    stop();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.messages).toHaveLength(1);
    const first = executeForecastWorkerRequest(workers[0]!.messages[0]!, clock);
    workers[0]!.onmessage?.({ data: { ...first, requestId: -1, fingerprint: "superseded-source" } });
    expect(delivered).toHaveLength(0);
    workers[0]!.onmessage?.({ data: first });
    expect(cancelled).toHaveLength(0);
    expect(delivered).toEqual([first]);
    evidence.select(selection(0), response => delivered.push(response));
    expect(workers[0]!.messages).toHaveLength(1); // exact cache hit
    evidence.select(selection(1), response => delivered.push(response));
    expect(workers[0]!.messages[1]!.source).toBeUndefined(); // one transported basis
    workers[0]!.onerror?.({ preventDefault() {} });
    expect(workers[0]!.stopped).toBe(true);
    expect(delivered.at(-1)?.outcome).toBe("error");
    evidence.select(selection(1), response => delivered.push(response));
    expect(workers).toHaveLength(2);
    expect(workers[1]!.messages[0]!.source).toEqual({ basis: proof, model, diagnosticCatalogs: result.diagnosticCatalogs });
    const pending = executeForecastWorkerRequest(workers[1]!.messages[0]!, clock);
    evidence.dispose();
    const count = delivered.length;
    workers[1]!.onmessage?.({ data: pending });
    expect(delivered).toHaveLength(count);
    expect(workers[1]!.stopped).toBe(true);
  });
  it("keeps the economic consequence of partial payroll, contribution and tax coverage visible", () => {
    const summary = (category: string) => diagnosticSummary({ code: "PFA-TAX-009", entityType: "tax_capability", category, taxYear: "2027" });
    expect(summary("contribution_annual_facts").problem).toContain("Affected contributions are skipped; wages and other household activity continue");
    expect(summary("contribution_annual_facts").remedy).toContain("does not establish personal eligibility");
    expect(summary("wage_gross_to_net_withholding").problem).toContain("Gross earnings do not establish spendable net deposits");
    expect(summary("wage_gross_to_net_withholding").problem).toContain("after-tax cash and net worth remain incomplete");
    expect(summary("payroll_source_unsupported").remedy).toContain("unsupported salary and withholding were not executed");
    for (const category of ["filing_status_year_unknown", "filing_status_conflict", "filing_status", "residence_jurisdiction_periods", "local_residence_jurisdiction"])
      expect(summary(category).problem).toContain("incomplete");
    expect(summary("filing_status_year_unknown").remedy).toContain("Household & People");
    expect(summary("filing_status").remedy).toContain("Import");
  });
  it.each([
    ["2008-01-01", "2098-02-01"], ["1960-06-15", "2050-07-01"], ["1990-01-01", "2080-02-01"],
  ])("includes %s's birthday month without a forty-year clip", (dob, end) => {
    expect(age90Horizon(withDob(dob), [ids.person], "2026-01-01")?.end).toBe(end);
  });
  it("handles leap birthdays, older anchors, missing DOB and explicit multi-adult selection", () => {
    expect(birthdayAtAge("2000-02-29", 65)).toBe("2065-02-28");
    expect(age90Horizon(withDob("1930-01-01"), [ids.person], "2026-01-01")).toBeUndefined();
    expect(age90Horizon(withDob("1930-01-01"), [ids.person], "2026-01-01", 100)?.end).toBe("2030-02-01");
    expect(age90Horizon(withDob(""), [ids.person], "2026-01-01")).toBeUndefined();
    expect(age90Horizon(withDob("2015-01-01"), [ids.person], "2026-01-01")).toBeUndefined();
    const model = withDob("1970-06-01"), other = "90000000-0000-4000-8000-000000000099";
    const two = { ...model, objects: { ...model.objects, Household: (model.objects.Household as readonly JsonObject[]).map(household => ({ ...household, members: [ids.person, other] })), Person: [...model.objects.Person!, { ...(model.objects.Person![0] as JsonObject), person_id: other, date_of_birth: "1990-06-01" }] } };
    expect(age90Horizon(two, [ids.person, other], "2026-01-01")?.end).toBe("2080-07-01");
    expect(age90Horizon(two, [ids.person], "2026-01-01")?.end).toBe("2060-07-01");
  });
  it("preserves inputs, economic fingerprints and accepted choices while resolving sources", () => {
    const model = createFlagshipHouseholdDraft(), config = createGoldenExampleConfiguration();
    expect(age90Horizon(model, [ids.person], config.simulationStart)?.end).toBe(config.simulationEnd);
    expect(birthdayAtAge("1990-01-01", 65)).toBe(config.retirementBindings[0]!.baselineDate);
    const json = exportPersonalModelJson(model), request = createHouseholdForecastRequest(config, ids.model);
    const fingerprint = calculationFingerprint("baseline_forecast", model, request);
    const restored = importPersonalModelJson(json);
    const derived = resolveForecastReadiness(restored, config.asOf);
    expect(derived.find(field => field.key === "cashAccount")).toMatchObject({ classification: "losslessly_derived", value: ids.checking });
    expect(derived.find(field => field.key === "investmentOwner")?.classification).toBe("editable_suggestion_needs_acceptance");
    expect(resolveForecastReadiness(model, config.asOf, config).find(field => field.key === "investmentOwner")).toMatchObject({ classification: "known_canonical", value: ids.person });
    expect(resolveForecastReadiness(model, config.asOf, config).find(field => field.key === "mortgage:" + ids.mortgage + ":schedule")?.reason).toContain("313 remaining of 360");
    expect(exportPersonalModelJson(model)).toBe(json);
    expect(calculationFingerprint("baseline_forecast", model, request)).toBe(fingerprint);
  });
  it("requires a choice among banks and preserves contradictory schedule evidence", () => {
    const model = createGoldenHouseholdDraft();
    expect(resolveForecastReadiness(model, "2026-01-01").find(field => field.key === "cashAccount")).toMatchObject({ classification: "user_decision_required", options: expect.any(Array) });
    const config = createGoldenExampleConfiguration();
    const conflict = { ...config, liabilityExecutionProfiles: config.liabilityExecutionProfiles.map(profile => ({ ...profile, totalPayments: 359 })) };
    expect(resolveForecastReadiness(model, "2026-01-01", conflict).find(field => field.key.endsWith(":schedule"))?.reason).toContain("disagree");
  });
  it("offers age 65 without changing wages, and accepts only in the Life Events adapter", () => {
    const original = createGoldenHouseholdDraft();
    const model = { ...original, objects: { ...original.objects, Income: (original.objects.Income as readonly JsonObject[]).map(income => ({ ...income, related_event_id: null })), Event: [] } };
    const before = exportPersonalModelJson(model);
    expect(retirementProposals(model, "2026-02-01")).toMatchObject([{ personId: ids.person, date: "2055-01-01" }]);
    expect(exportPersonalModelJson(model)).toBe(before);
    expect(() => acceptRetirementProposal(model, ids.person, "2055-01-01", ["90000000-0000-4000-8000-000000000099"])).toThrow("Current Plan");
    expect(retirementProposals(original, "2026-01-01")).toEqual([]);
    expect(retirementProposals({ ...model, objects: { ...model.objects, Person: withDob("1950-01-01").objects.Person! } }, "2026-01-01")).toEqual([]);
  });
  it("does not overwrite existing assumptions or create reserve transactions", () => {
    const model = createGoldenHouseholdDraft(), before = exportPersonalModelJson(model);
    let index = 500;
    const accepted = acceptPlanningStarters(model, { inflation: "0.025", wages: "0.03", portfolio: "0.05", reserveMonths: "6" }, () => `90000000-0000-4000-8000-${String(index++).padStart(12, "0")}`);
    expect(accepted.objects.Income).toEqual(model.objects.Income);
    expect(accepted.objects.Investment).toEqual(model.objects.Investment);
    expect(accepted.objects.Transaction).toEqual(model.objects.Transaction);
    expect((accepted.objects.Assumption as readonly JsonObject[]).filter(item => item.name === "Essential-expense reserve goal")).toMatchObject([{ value: "6" }]);
    expect(exportPersonalModelJson(model)).toBe(before);
  });
  it("executes a bounded genuine net-pay result with exact opening and cash values", () => {
    const model = createFlagshipHouseholdDraft();
    const config = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-09-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(config, ids.model));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    if (result.status === "unavailable") return;
    expect(result.points).toHaveLength(8);
    expect(result.openingSnapshot.netWorth.amount).toBe("4289330.29");
    expect(result.points[0]!.cash.amount).toBe("4007874.71");
    expect(result.points[0]!.statementIncome.amount).toBe("0");
    expect(result.points[6]!.statementIncome.amount).not.toBe("0");
    expect(result.diagnostics.some(issue => "category" in issue && issue.category === "wage_gross_to_net_withholding")).toBe(false);
    expect(result.points[0]!.outputCapabilities?.cash?.status).toBe("complete");
    expect(model.objects.Income).toHaveLength(1);
  }, 30_000);
  it("executes accepted starters with unique source bindings and changed economics without mutating the proposal", () => {
    const fixture = createFlagshipHouseholdDraft();
    // Isolate genuinely unspecified rates while retaining the fixture's explicit
    // dates, payroll elections, ownership and settlement authorizations.
    const model: PersonalDraft = { ...fixture, objects: { ...fixture.objects,
      Assumption: [],
      PrimitiveInstance: (fixture.objects.PrimitiveInstance as readonly JsonObject[]).filter(item => !["P08", "P23"].includes(String(item.primitive_id))),
      Scenario: (fixture.objects.Scenario as readonly JsonObject[]).map(item => ({ ...item, assumption_ids: [] })),
      Income: (fixture.objects.Income as readonly JsonObject[]).map(item => ({ ...item, growth_model_id: null })),
      Expense: (fixture.objects.Expense as readonly JsonObject[]).map(item => ({ ...item, growth_model_id: null })),
      Investment: (fixture.objects.Investment as readonly JsonObject[]).map(item => ({ ...item, return_model_id: null })),
    } };
    const before = exportPersonalModelJson(model);
    const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: "2027-09-01", investmentPurchaseInstructions: [] }, ids.model);
    const fingerprint = calculationFingerprint("baseline_forecast", model, request);
    let index = 600;
    const accepted = acceptPlanningStarters(model, { inflation: "0.025", wages: "0.03", portfolio: "0.05", reserveMonths: "6" }, () => `90000000-0000-4000-8000-${String(index++).padStart(12, "0")}`);
    const expenseBindings = (accepted.objects.Expense as readonly JsonObject[]).map(item => item.growth_model_id);
    expect(new Set(expenseBindings).size).toBe(3);
    expect(expenseBindings.every(value => typeof value === "string")).toBe(true);
    expect(calculationFingerprint("baseline_forecast", accepted, request)).not.toBe(fingerprint);
    const baseline = runPersonalHouseholdForecast(model, request);
    const result = runPersonalHouseholdForecast(accepted, request);
    expect(baseline.status, JSON.stringify(baseline.diagnostics)).toBe("completed");
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    if (baseline.status === "unavailable" || result.status === "unavailable") return;
    expect(result.points).toHaveLength(20);
    expect(result.points.at(-1)!.statementIncome.amount).not.toBe(baseline.points.at(-1)!.statementIncome.amount);
    expect(result.points.at(-1)!.investmentValue.amount).not.toBe(baseline.points.at(-1)!.investmentValue.amount);
    expect(result.points.at(-1)!.statementExpenses.amount).not.toBe(baseline.points.at(-1)!.statementExpenses.amount);
    expect(result.points.at(-1)!.cash.amount).not.toBe(baseline.points.at(-1)!.cash.amount);
    expect(accepted.objects.Account).toEqual(model.objects.Account);
    expect(accepted.objects.Transaction).toEqual(model.objects.Transaction);
    expect(accepted.objects.Event).toEqual(model.objects.Event);
    expect(exportPersonalModelJson(model)).toBe(before);
    expect(calculationFingerprint("baseline_forecast", model, request)).toBe(fingerprint);
  }, 30_000);
  it("keeps a missing jurisdiction paycheck binding genuinely incomplete", () => {
    const original = createFlagshipHouseholdDraft();
    const model = { ...original, objects: { ...original.objects, PrimitiveInstance: (original.objects.PrimitiveInstance as readonly JsonObject[]).filter(item => item.primitive_instance_id !== "90000000-0000-4000-8000-000000000112") } };
    const config = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-09-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(config, ids.model));
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ category: "wage_gross_to_net_withholding" }));
    if (result.status !== "unavailable") expect(result.points[6]!.outputCapabilities?.cash?.status).toBe("incomplete");
  }, 30_000);
});
