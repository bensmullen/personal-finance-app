import { BaselineCache, FORECAST_DEBOUNCE_MS, initialForecastState, isCacheableBaseline, isCurrentForecastResponse, pendingForecastState, settledForecastState, type ForecastState } from "../../src/application/interactiveForecast.js";
import type { PerformanceContext, PerformanceRecord } from "../../src/application/performance.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse, ForecastWorkerResult } from "./protocol.js";

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
  submit(input: ForecastSubmission, immediate = false): void {
    this.#stop();
    const requestId = ++this.#sequence;
    const message = { ...input, requestId } as ForecastWorkerRequest;
    this.#publish({ ...pendingForecastState(this.#state, requestId, input.fingerprint), cacheState: undefined, performanceContext: undefined });
    const run = () => {
      this.#timer = undefined;
      if (!isCurrentForecastResponse(this.#state, message)) return;
      const cached = input.operation === "baseline_forecast" ? this.#cache.get(input.fingerprint) : undefined;
      const context: PerformanceContext = { ...input.performanceContext, executionLocation: "browser_main", cacheState: cached ? "hit" : input.operation === "baseline_forecast" ? "miss" : "not_applicable" };
      if (cached !== undefined) {
        // Cache hits keep the original financial identity and contribute no fresh timings.
        for (const phase of ["forecast.total", "transport.serialization"] as const)
          this.#record({ phase, availability: "not_measured", context: { ...context, status: cached.status as "completed" | "incomplete" } });
        this.#publish({ ...settledForecastState(this.#state, cached.status as "completed" | "incomplete", cached), resultModel: input.model, resultRequest: input.request, cacheState: "hit", performanceContext: context });
        return;
      }
      this.#publish({ ...this.#state, cacheState: input.operation === "baseline_forecast" ? "miss" : undefined });
      try {
        const worker = this.makeWorker();
        this.#worker = worker;
        const fail = () => {
          if (!isCurrentForecastResponse(this.#state, message)) return;
          this.#stop();
          this.#publish(settledForecastState(this.#state, "error", undefined, "Unexpected Worker error. Recalculate to retry."));
        };
        worker.onerror = (event) => { event.preventDefault(); fail(); };
        worker.onmessageerror = fail;
        worker.onmessage = ({ data }) => {
          if (data.operation !== message.operation || !isCurrentForecastResponse(this.#state, data)) return;
          this.#stop();
          for (const record of data.records) this.#record(record);
          if (data.outcome === "error") {
            this.#publish(settledForecastState(this.#state, "error", undefined, data.error.message));
            return;
          }
          const result = data.result;
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
        worker.postMessage(message);
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
  dispose(): void {
    this.#stop();
    this.#state = initialForecastState();
    this.#cache.clear();
  }
}
