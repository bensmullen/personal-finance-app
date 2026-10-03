import { afterEach, describe, expect, it, vi } from "vitest";
import { BaselineCache, calculationFingerprint, forecastPage, isCacheableBaseline, sampleForecastChart } from "../src/application/interactiveForecast.js";
import { createEmptyPersonalDraft, getCurrentPosition, patchPersonalObject, createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { createHouseholdForecastRequest, type PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import { createGoldenHouseholdSessionConfiguration } from "../src/application/goldenHousehold.js";
import { ForecastController, type ForecastSubmission, type ForecastWorkerPort } from "../ui/forecast/controller.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse } from "../ui/forecast/protocol.js";
import { ExplanationCache, ResultExplanationCache } from "../ui/forecast/explanations.js";
import type { PerformanceRecord } from "../src/diagnostics/performance.js";

const model = createEmptyPersonalDraft("10000000-0000-4000-8000-000000000001");
const request = createHouseholdForecastRequest({ ...createGoldenHouseholdSessionConfiguration(), simulationEnd: "2026-02-01" }, "10000000-0000-4000-8000-000000000002");
const submission = (fingerprint = "a"): ForecastSubmission => ({ operation: "baseline_forecast", model, request, fingerprint,
  performanceContext: { runId: request.runIdentity, dataClassification: "synthetic", modelCounts: {}, executionLocation: "browser_worker", cacheState: "miss" } });
const financial = (status: "completed" | "incomplete" = "completed", identity = "original") =>
  ({ scope: "household", status, identity } as unknown as PersonalHouseholdForecastReadModel);

class DeferredWorker implements ForecastWorkerPort {
  onmessage: ForecastWorkerPort["onmessage"] = null;
  onerror: ForecastWorkerPort["onerror"] = null;
  onmessageerror: ForecastWorkerPort["onmessageerror"] = null;
  message!: ForecastWorkerRequest;
  terminated = false;
  postMessage(message: ForecastWorkerRequest): void { this.message = message; }
  terminate(): void { this.terminated = true; }
  complete(result = financial(), records: readonly PerformanceRecord[] = []): void {
    // Deliver even after termination, proving response suppression independently.
    this.onmessage?.({ data: { operation: this.message.operation, requestId: this.message.requestId, fingerprint: this.message.fingerprint,
      outcome: "result", result, records } });
  }
  respond(response: ForecastWorkerResponse): void { this.onmessage?.({ data: response }); }
}
const channel = (sink?: (record: PerformanceRecord) => void) => {
  const workers: DeferredWorker[] = [];
  const records: PerformanceRecord[] = [];
  const controller = new ForecastController(() => { const worker = new DeferredWorker(); workers.push(worker); return worker; },
    { set: (callback, delay) => setTimeout(callback, delay), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    () => {}, sink ?? ((record) => records.push(record)));
  return { controller, workers, records };
};
afterEach(() => { vi.useRealTimers(); });

describe("R2 economics and current position", () => {
  it("ignores run identity, preserves key-order determinism, and includes every economic boundary", () => {
    const fingerprint = calculationFingerprint("baseline_forecast", model, request);
    expect(calculationFingerprint("baseline_forecast", model, { ...request, runIdentity: "different" })).toBe(fingerprint);
    expect(calculationFingerprint("baseline_forecast", { objects: model.objects, modelId: model.modelId, financialSpecificationVersion: model.financialSpecificationVersion, modelFormatVersion: model.modelFormatVersion }, request)).toBe(fingerprint);
    for (const changed of [ { ...request, asOf: "2026-01-02" }, { ...request, dataCutoff: "2025-12-31" },
      { ...request, compiler: { ...request.compiler, cashFlow: { ...request.compiler.cashFlow!, months: 2 } } },
      { ...request, compiler: { ...request.compiler, cashFlow: { ...request.compiler.cashFlow!, sameInstantCashFlowOrder: "expense_before_income" as const } } } ])
      expect(calculationFingerprint("baseline_forecast", model, changed)).not.toBe(fingerprint);
    expect(calculationFingerprint("baseline_forecast", { ...model, modelFormatVersion: "different" }, request)).not.toBe(fingerprint);
    expect(calculationFingerprint("baseline_forecast", { ...model, objects: { ...model.objects, Account: [{ opening_balance: "10" }] } }, request)).not.toBe(fingerprint);
    expect(calculationFingerprint("scenario_comparison", model, request, { rate: "0.04" })).not.toBe(calculationFingerprint("scenario_comparison", model, request, { rate: "0.05" }));
    expect(calculationFingerprint("major_asset_debt_comparison", model, request, { principal: "10" })).not.toBe(calculationFingerprint("major_asset_debt_comparison", model, request, { principal: "11" }));
    expect(calculationFingerprint("scenario_comparison", model, request, [])).not.toBe(fingerprint);
  });
  it("reports complete, partial, invalid and unsupported current state without a forecast", () => {
    const golden = createGoldenHouseholdDraft();
    const boundary = { baseCurrency: "USD", asOf: "2026-01-01" };
    const current = getCurrentPosition(golden, boundary);
    expect(current.netWorth).toBeDefined();
    expect(current.netWorth?.exact).toBe("309330.29");
    expect(current.assets?.exact).toBe("535000");
    expect(current.status).toBe(current.unavailable.length ? "partial" : "complete");
    expect(getCurrentPosition(golden, { ...boundary, asOf: "invalid" }).status).toBe("invalid");
    const income = golden.objects.Income![0] as Record<string, string>;
    expect(getCurrentPosition(patchPersonalObject(golden, "Income", income.income_id!, { related_event_id: null }), boundary).status).toBe("complete");
    const partial = getCurrentPosition(patchPersonalObject(golden, "Income", income.income_id!, { frequency: "weekly" }), boundary);
    expect(partial.status).toBe("partial");
    expect(partial.monthlyIncome).toBeUndefined();
    expect(partial.netWorth?.exact).toBe("309330.29");
    expect(partial.diagnostics.length).toBeGreaterThan(0);
    const unsupported = getCurrentPosition({ ...golden, objects: { ...golden.objects, Household: [] } }, boundary);
    expect(unsupported.status).toBe("unsupported");
    expect(unsupported.netWorth).toBeUndefined();
  });
  it("validates exact opening investment values and does not invent FX conversion", () => {
    const golden = createGoldenHouseholdDraft();
    const boundary = { baseCurrency: "USD", asOf: "2026-01-01" };
    const investment = golden.objects.Investment![0] as Record<string, string>;
    // Imported authored data must be tested independently of editor mutability rules.
    const withInvestment = (draft: typeof golden, patch: Record<string, string | null>) => ({
      ...draft, objects: { ...draft.objects, Investment: draft.objects.Investment!.map((item) => {
        const position = item as Record<string, string>;
        return position.investment_id === investment.investment_id ? { ...position, ...patch } : item;
      }) },
    });
    for (const patch of [
      { market_value: "1" }, { price: null }, { price: "-1" },
      { market_value: "not-money" }, { quantity: "-1" }, { quantity: "not-quantity" },
      { quantity: "0", market_value: "1" },
    ]) expect(getCurrentPosition(withInvestment(golden, patch), boundary).status).toBe("invalid");
    const derived = getCurrentPosition(withInvestment(golden, { market_value: null }), boundary);
    expect(derived.netWorth?.exact).toBe("309330.29");
    const foreign = { ...golden, objects: { ...golden.objects, Account: golden.objects.Account!.map((item) => {
      const account = item as Record<string, string>;
      return account.account_id === investment.account_id ? { ...account, currency: "EUR", opening_balance: "0" } : item;
    }) } };
    const unavailable = getCurrentPosition(foreign, boundary);
    expect(unavailable.status).toBe("partial");
    expect(unavailable.assets).toBeUndefined();
    expect(unavailable.netWorth).toBeUndefined();
    expect(unavailable.cash).toBeDefined();
    expect(unavailable.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "FX_UNSUPPORTED", entityType: "Investment" })]));
    const zero = getCurrentPosition(withInvestment(foreign, { quantity: "0", price: null, market_value: "0" }), boundary);
    expect(zero.assets).toBeDefined();
    expect(zero.diagnostics.some((item) => item.code === "FX_UNSUPPORTED")).toBe(false);
  });
});

describe("R2 request channels", () => {
  it("keeps missing configuration idle and retains invalidated baseline/comparison results as stale", () => {
    for (const operation of ["baseline_forecast", "scenario_comparison"] as const) {
      const { controller, workers } = channel();
      controller.invalidate();
      expect(controller.state).toMatchObject({ lifecycle: "idle", pending: false, stale: false });
      const input: ForecastSubmission = operation === "baseline_forecast" ? submission() : { ...submission(), operation, intents: [] };
      controller.submit(input, true);
      const good = financial();
      workers[0]!.complete(good);
      controller.submit({ ...input, fingerprint: "new-economics" }, true);
      controller.invalidate("Inputs changed. Run a new comparison.");
      workers[1]!.complete(financial("completed", "superseded"));
      expect(controller.state).toMatchObject({ lifecycle: "stale", pending: false, stale: true, lastGoodResult: good, resultFingerprint: "a", message: "Inputs changed. Run a new comparison." });
      expect(controller.state.latestResult).toBeUndefined();
      controller.dispose();
    }
  });
  it("debounces exactly 300 ms and manual recalculation supersedes pending and active work", () => {
    vi.useFakeTimers();
    const { controller, workers } = channel();
    expect(controller.state.lifecycle).toBe("idle");
    controller.submit(submission());
    vi.advanceTimersByTime(299);
    expect(workers).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(workers).toHaveLength(1);
    controller.submit(submission("b"));
    expect(workers[0]!.terminated).toBe(true);
    controller.submit(submission("c"), true);
    expect(workers).toHaveLength(2);
    vi.advanceTimersByTime(300);
    expect(workers).toHaveLength(2);
    workers[0]!.complete(financial("completed", "old"));
    expect(controller.state.lastGoodResult).toBeUndefined();
    const latest = financial();
    workers[1]!.complete(latest);
    expect(controller.state.lastGoodResult).toBe(latest);
    expect(controller.state.lifecycle).toBe("completed");
    controller.submit(submission(), true);
    expect(workers).toHaveLength(3); // The superseded response did not seed the cache.
    controller.dispose();
  });
  it("accepts only the latest operation, request ID and fingerprint, including telemetry", () => {
    const { controller, workers, records } = channel();
    controller.submit(submission(), true);
    controller.submit(submission("b"), true);
    const old = workers[0]!, current = workers[1]!;
    const record: PerformanceRecord = { phase: "forecast.total", availability: "measured", durationMs: 10, context: old.message.performanceContext };
    old.complete(financial(), [record]);
    const response: ForecastWorkerResponse = { ...current.message, outcome: "result", result: financial(), records: [record] };
    current.respond({ ...response, fingerprint: "wrong" });
    current.respond({ ...response, requestId: -1 });
    current.respond({ ...response, operation: "scenario_comparison" });
    expect(controller.state.pending).toBe(true);
    expect(records.filter((item) => item.phase === "forecast.total")).toHaveLength(0);
    current.complete(financial("incomplete"), [record]);
    expect(controller.state.lifecycle).toBe("incomplete");
    expect(records.filter((item) => item.phase === "forecast.total")).toHaveLength(1);
    old.complete();
    expect(controller.state.lifecycle).toBe("incomplete");
    controller.dispose();
  });
  it("retains the last good result as stale during debounce, error and unsupported replacement", () => {
    vi.useFakeTimers();
    const { controller, workers } = channel();
    controller.submit(submission(), true);
    const good = financial();
    workers[0]!.complete(good);
    controller.submit(submission("replacement"));
    expect(controller.state).toMatchObject({ lifecycle: "stale", stale: true, pending: true, lastGoodResult: good, resultModel: model });
    vi.advanceTimersByTime(300);
    const worker = workers[1]!;
    worker.respond({ ...worker.message, outcome: "error", error: { code: "EXECUTION_ERROR", message: "failed" }, records: [] });
    expect(controller.state).toMatchObject({ lifecycle: "error", stale: true, pending: false, lastGoodResult: good });
    controller.submit(submission("unsupported"), true);
    workers[2]!.complete({ scope: "household", status: "unavailable", message: "coverage", diagnostics: [] });
    expect(controller.state).toMatchObject({ lifecycle: "unsupported", stale: true, lastGoodResult: good });
    controller.submit(submission("unsupported"), true);
    expect(workers).toHaveLength(4); // Unsupported replacement was not cached.
    controller.dispose();
  });
  it("isolates baseline from comparison supersession and never caches comparisons", () => {
    const a = channel(), b = channel();
    a.controller.submit(submission(), true);
    const comparison: ForecastSubmission = { ...submission(), operation: "scenario_comparison", intents: [] };
    b.controller.submit(comparison, true);
    b.controller.submit(comparison, true);
    expect(a.workers[0]!.terminated).toBe(false);
    b.workers[1]!.complete({ status: "completed", baselineName: "Current plan", alternatives: [], diagnostics: [] } as never);
    b.controller.submit(comparison, true);
    expect(b.workers).toHaveLength(3);
    a.controller.dispose(); b.controller.dispose();
  });
  it("terminates on cleanup, invalidation, construction, postMessage and message failures without fallback", () => {
    vi.useFakeTimers();
    const { controller, workers } = channel();
    controller.submit(submission()); controller.dispose();
    vi.advanceTimersByTime(300); expect(workers).toHaveLength(0);
    controller.submit(submission(), true); controller.invalidate();
    workers[0]!.complete(); expect(controller.state.lastGoodResult).toBeUndefined();
    controller.submit(submission("b"), true); workers[1]!.onmessageerror?.();
    expect(controller.state.lifecycle).toBe("error"); expect(workers[1]!.terminated).toBe(true);
    controller.submit(submission("c"), true); workers[2]!.onerror?.({ preventDefault() {} });
    expect(controller.state.lifecycle).toBe("error");
    controller.dispose(); workers[2]!.complete(); expect(controller.state.lifecycle).toBe("idle");
    for (const make of [() => { throw new Error("constructor"); }, () => ({ ...new DeferredWorker(), postMessage() { throw new Error("clone"); }, terminate() {}, onmessage: null, onerror: null, onmessageerror: null })]) {
      const failing = new ForecastController(make, { set: () => 0, clear() {} }, () => {}, () => {});
      failing.submit(submission(), true);
      expect(failing.state.lifecycle).toBe("error"); failing.dispose();
    }
  });
  it("returns cached financial identity without fresh execution timing; sink failure is isolated", () => {
    const { controller, workers, records } = channel();
    controller.submit(submission(), true);
    const good = financial("incomplete"); workers[0]!.complete(good);
    controller.submit(submission(), true);
    expect(controller.state.cacheState).toBe("hit"); expect(controller.state.lastGoodResult).toBe(good);
    expect(workers).toHaveLength(1);
    expect(records.at(-1)).toMatchObject({ availability: "not_measured", context: { cacheState: "hit" } });
    expect(records.at(-1)?.durationMs).toBeUndefined();
    const throwing = channel(() => { throw new Error("sink"); });
    throwing.controller.submit(submission(), true); throwing.workers[0]!.complete(good);
    expect(throwing.controller.state.lastGoodResult).toBe(good);
    controller.dispose(); throwing.controller.dispose();
  });
});

describe("R2 derived display helpers", () => {
  it("caches only valid completed/incomplete results in a four-entry deterministic LRU", () => {
    const cache = new BaselineCache<{ status: string; id: string }>();
    for (const status of ["unsupported", "unavailable", "error", "stale", "cancelled", "superseded"]) {
      expect(isCacheableBaseline(status)).toBe(false); cache.put(status, { status, id: status }); expect(cache.get(status)).toBeUndefined();
    }
    for (const id of ["a", "b", "c", "d"]) cache.put(id, { status: id === "a" ? "incomplete" : "completed", id });
    expect(cache.get("missing")).toBeUndefined(); expect(cache.get("a")?.id).toBe("a");
    cache.put("e", { status: "completed", id: "e" });
    expect(cache.get("b")).toBeUndefined();
    for (const id of ["a", "c", "d", "e"]) expect(cache.get(id)?.id).toBe(id);
    cache.clear(); expect(cache.get("a")).toBeUndefined();
  });
  it("samples exactly the specified indexes and paginates at most 24 without changing authority", () => {
    for (const n of [0, 1, 119, 120, 121, 1000]) {
      const rows = Object.freeze(Array.from({ length: n }, (_, i) => ({ id: i })));
      const sampled = sampleForecastChart(rows);
      expect(sampled).toHaveLength(Math.min(n, 120));
      if (n > 120) expect(sampled.map((row) => row.id)).toEqual(Array.from({ length: 120 }, (_, i) => Math.floor(i * (n - 1) / 119)));
      if (n) { expect(sampled[0]).toBe(rows[0]); expect(sampled.at(-1)).toBe(rows.at(-1)); }
      expect(rows).toHaveLength(n);
      const paged = Array.from({ length: Math.ceil(n / 24) }, (_, i) => forecastPage(rows, i));
      expect(paged.flat()).toEqual(rows);
      for (const page of paged) expect(page.length).toBeLessThanOrEqual(24);
      expect(forecastPage(rows, -1)).toEqual(rows.slice(0, 24));
    }
  });
  it("resolves on first request, memoizes success/failure, and discards old result explanations", () => {
    const resolve = vi.fn(() => ({ sources: ["lineage"] }));
    const owner = new ResultExplanationCache<ReturnType<typeof resolve>>();
    const financialResult = {};
    const firstResult = owner.forResult(financialResult);
    expect(resolve).not.toHaveBeenCalled();
    const explanation = firstResult.get("row", resolve);
    expect(firstResult.get("row", resolve)).toBe(explanation); expect(resolve).toHaveBeenCalledTimes(1);
    owner.forResult(financialResult).get("row", resolve); expect(resolve).toHaveBeenCalledTimes(1);
    owner.forResult({}).get("row", resolve); expect(resolve).toHaveBeenCalledTimes(2);
    const fail = vi.fn(() => { throw new Error("unavailable"); });
    expect(firstResult.get("failed", fail)).toBeUndefined(); expect(firstResult.get("failed", fail)).toBeUndefined();
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
