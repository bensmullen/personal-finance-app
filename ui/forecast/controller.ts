import { BaselineCache, FORECAST_DEBOUNCE_MS, initialForecastState, isCacheableBaseline, isCurrentForecastResponse, pendingForecastState, settledForecastState, type ForecastState } from "../../src/application/interactiveForecast.js";
import type { PerformanceContext, PerformanceRecord } from "../../src/application/performance.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse, ForecastWorkerResult } from "./protocol.js";
import { baselineResultMatchesRequest } from "../../src/application/interactiveForecast.js";
import type { EvidenceSelection, EvidenceWorkerRequest, EvidenceWorkerResponse } from "./protocol.js";

export interface ForecastWorkerPort {
  onmessage: ((event: { data: ForecastWorkerResponse }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(request: ForecastWorkerRequest): void;
  terminate(): void;
}
export interface ForecastScheduler {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}

export interface EvidenceWorkerPort {
  onmessage: ((event: { data: EvidenceWorkerResponse }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(request: EvidenceWorkerRequest): void;
  terminate(): void;
}

/** One evidence worker per immutable source shared by all visible panels.
 * It never submits a forecast. Only bounded exact read models cross back. */
export class EvidenceController {
  #worker: EvidenceWorkerPort | undefined;
  #sequence = 0;
  #sent = false;
  #cache = new Map<string, EvidenceWorkerResponse>();
  #pending = new Map<number, { key: string; boundary: Omit<EvidenceWorkerRequest, "source">; listeners: Set<(response: EvidenceWorkerResponse) => void> }>();
  constructor(readonly source: NonNullable<EvidenceWorkerRequest["source"]>, readonly makeWorker: () => EvidenceWorkerPort) {}
  select(selection: EvidenceSelection, changed: (response: EvidenceWorkerResponse) => void, refresh = false): () => void {
    const key = `${selection.operation}:${selection.startIndex}:${selection.liabilityId}`;
    if (refresh) this.#cache.delete(key);
    const cached = this.#cache.get(key);
    if (cached) { changed(cached); return () => {}; }
    const existing = [...this.#pending.values()].find(item => item.key === key);
    if (existing) { existing.listeners.add(changed); return () => { existing.listeners.delete(changed); }; }
    const forecast = this.source.forecast;
    const fingerprint = forecast.status !== "unavailable" ? forecast.points[selection.startIndex]?.traceRefs.find(ref => ref.replayArtifact !== undefined)?.traceId ?? "unavailable" : "unavailable";
    const boundary = { ...selection, requestId: ++this.#sequence, fingerprint };
    const pending = { key, boundary, listeners: new Set([changed]) };
    this.#pending.set(boundary.requestId, pending);
    const fail = () => {
      const pending = [...this.#pending.values()];
      this.dispose();
      for (const item of pending) for (const listener of item.listeners) listener({ ...item.boundary, outcome: "error", error: "Monthly evidence has missing or mismatched period/source data. Update the forecast and retry." });
    };
    try {
      if (!this.#worker) {
        this.#worker = this.makeWorker();
        this.#worker.onmessage = ({ data }) => {
          const item = this.#pending.get(data.requestId);
          if (!item || data.operation !== item.boundary.operation || data.fingerprint !== item.boundary.fingerprint || data.startIndex !== item.boundary.startIndex || data.liabilityId !== item.boundary.liabilityId) return;
          if (data.outcome === "result") {
            const point = this.source.forecast.status !== "unavailable" ? this.source.forecast.points[data.startIndex] : undefined;
            if (data.operation === "monthly_evidence" ? !data.detail : !data.window || data.window.start !== point?.periodStart || data.window.liabilityId !== data.liabilityId) { fail(); return; }
            if (this.#cache.size >= 4) this.#cache.delete(this.#cache.keys().next().value!);
            this.#cache.set(item.key, data);
          }
          this.#pending.delete(data.requestId);
          for (const listener of item.listeners) listener(data);
        };
        this.#worker.onerror = event => { event.preventDefault(); fail(); };
        this.#worker.onmessageerror = fail;
      }
      this.#worker.postMessage({ ...boundary, ...(!this.#sent ? { source: this.source } : {}) });
      this.#sent = true;
    } catch { fail(); }
    return () => { pending.listeners.delete(changed); };
  }
  dispose(): void {
    this.#worker?.terminate(); this.#worker = undefined; this.#sent = false; this.#pending.clear();
  }
}
export type ForecastSubmission = ForecastWorkerRequest extends infer R ? R extends ForecastWorkerRequest ? Omit<R, "requestId"> : never : never;
export interface ForecastView extends ForecastState<ForecastWorkerResult> {
  readonly latestResult?: ForecastWorkerResult | undefined;
  readonly resultModel?: ForecastWorkerRequest["model"] | undefined;
  readonly resultRequest?: ForecastWorkerRequest["request"] | undefined;
  readonly cacheState?: "hit" | "miss" | undefined;
  readonly performanceContext?: PerformanceContext | undefined;
}

/** Each instance owns one supersession channel. Baseline and comparison use separate instances. */
export class ForecastController {
  #state: ForecastView = initialForecastState();
  #sequence = 0;
  #worker: ForecastWorkerPort | undefined;
  #timer: unknown;
  readonly #cache = new BaselineCache<ForecastWorkerResult>();
  constructor(
    readonly makeWorker: () => ForecastWorkerPort,
    readonly scheduler: ForecastScheduler,
    readonly changed: (state: ForecastView) => void,
    readonly record: (record: PerformanceRecord) => void,
    readonly now: () => number = () => performance.now(),
  ) {}
  get state(): ForecastView { return this.#state; }
  #publish(state: ForecastView): void { this.#state = state; this.changed(state); }
  #stop(): void {
    if (this.#timer !== undefined) this.scheduler.clear(this.#timer);
    this.#timer = undefined;
    try { this.#worker?.terminate(); } catch { /* Supersession suppression remains authoritative. */ }
    this.#worker = undefined;
  }
  #record(record: PerformanceRecord): void { try { this.record(record); } catch { /* Observational only. */ } }
  #now(): number | undefined { try { const value = this.now(); return Number.isFinite(value) ? value : undefined; } catch { return undefined; } }
  submit(input: ForecastSubmission, immediate = false): void {
    this.#stop();
    const requestId = ++this.#sequence;
    const message = { ...input, requestId } as ForecastWorkerRequest;
    this.#publish({ ...pendingForecastState(this.#state, requestId, input.fingerprint), latestResult: undefined, cacheState: undefined, performanceContext: undefined });
    const run = () => {
      this.#timer = undefined;
      if (!isCurrentForecastResponse(this.#state, message)) return;
      const cached = input.operation === "baseline_forecast" ? this.#cache.get(input.fingerprint) : undefined;
      const context: PerformanceContext = { ...input.performanceContext, executionLocation: "browser_main", cacheState: cached ? "hit" : input.operation === "baseline_forecast" ? "miss" : "not_applicable" };
      if (cached !== undefined) {
        // Cache hits keep the original financial identity and contribute no fresh timings.
        for (const phase of ["forecast.total", "transport.serialization"] as const)
          this.#record({ phase, availability: "not_measured", context: { ...context, status: cached.status as "completed" | "incomplete" } });
        this.#publish({ ...settledForecastState(this.#state, cached.status as "completed" | "incomplete", cached), latestResult: cached, resultModel: input.model, resultRequest: input.request, cacheState: "hit", performanceContext: context });
        return;
      }
      this.#publish({ ...this.#state, cacheState: input.operation === "baseline_forecast" ? "miss" : undefined });
      try {
        const worker = this.makeWorker();
        this.#worker = worker;
        let sentAt: number | undefined;
        const fail = () => {
          if (!isCurrentForecastResponse(this.#state, message)) return;
          this.#stop();
          this.#publish(settledForecastState(this.#state, "error", undefined, "Unexpected Worker error. Recalculate to retry."));
        };
        worker.onerror = (event) => { event.preventDefault(); fail(); };
        worker.onmessageerror = fail;
        worker.onmessage = ({ data }) => {
          if (data.operation !== message.operation || !isCurrentForecastResponse(this.#state, data)) return;
          const receivedAt = this.#now();
          // Includes queueing, execution and response transport. This is never
          // attributed to serialization or to an exclusive engine phase.
          this.#record({ phase: "transport.worker_roundtrip", context,
            availability: sentAt !== undefined && receivedAt !== undefined && receivedAt >= sentAt ? "measured" : "unavailable",
            ...(sentAt !== undefined && receivedAt !== undefined && receivedAt >= sentAt ? { durationMs: receivedAt - sentAt } : {}),
            resources: { metering: "not_metered", structuralCounters: { workerResponsesReceived: 1 } } });
          this.#stop();
          for (const record of data.records) this.#record(record);
          if (data.outcome === "error") {
            this.#publish(settledForecastState(this.#state, "error", undefined, data.error.message));
            return;
          }
          const result = data.result;
          if (input.operation === "baseline_forecast" && "points" in result && "scope" in result && !baselineResultMatchesRequest(result, input.request)) {
            this.#publish(settledForecastState(this.#state, "error", undefined, "Forecast periods do not match the requested window. Recalculate to retry."));
            return;
          }
          const good = isCacheableBaseline(result.status);
          if (input.operation === "baseline_forecast" && good) this.#cache.put(input.fingerprint, result);
          this.#publish({ ...settledForecastState(this.#state, isCacheableBaseline(result.status) ? result.status : "unsupported", result,
            result.status === "unavailable" ? result.message : undefined),
            latestResult: result,
            ...(good ? { resultModel: input.model, resultRequest: input.request, performanceContext: { ...context, status: result.status } } : {}) });
        };
        // postMessage's full boundary is not reliably separable into serialization vs enqueue.
        // Mark unmeasured, never attribute the roundtrip or financial work to transport.
        this.#record({ phase: "transport.serialization", availability: "not_measured", context });
        sentAt = this.#now();
        worker.postMessage(message);
        const postedAt = this.#now();
        this.#record({ phase: "transport.request_post", context,
          availability: sentAt !== undefined && postedAt !== undefined && postedAt >= sentAt ? "measured" : "unavailable",
          ...(sentAt !== undefined && postedAt !== undefined && postedAt >= sentAt ? { durationMs: postedAt - sentAt } : {}),
          resources: { metering: "not_metered", structuralCounters: { workerRequestsPosted: 1 } } });
      } catch {
        this.#stop();
        this.#publish(settledForecastState(this.#state, "error", undefined, "Worker execution is unavailable. Recalculate to retry."));
      }
    };
    if (immediate) run();
    else this.#timer = this.scheduler.set(run, FORECAST_DEBOUNCE_MS);
  }
  invalidate(message = "Execution configuration is unavailable."): void {
    this.#stop();
    this.#publish({ ...this.#state, pending: false, stale: this.#state.lastGoodResult !== undefined,
      lifecycle: this.#state.lastGoodResult === undefined ? "idle" : "stale", latestResult: undefined, message });
  }
  /** A replacement model must never inherit results or diagnostics from another model. */
  reset(): void {
    this.#stop();
    ++this.#sequence;
    this.#cache.clear();
    this.#publish(initialForecastState());
  }
  dispose(): void {
    this.#stop();
    this.#state = initialForecastState();
    this.#cache.clear();
  }
}
