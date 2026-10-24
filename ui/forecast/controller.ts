import { BaselineCache, FORECAST_DEBOUNCE_MS, initialForecastState, isCacheableBaseline, isCurrentForecastResponse, pendingForecastState, settledForecastState, type ForecastState } from "../../src/application/interactiveForecast.js";
import type { PerformanceContext, PerformanceRecord } from "../../src/application/performance.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse, ForecastWorkerResult } from "./protocol.js";
import { baselineResultMatchesRequest, forecastResultCatalogsValid } from "../../src/application/interactiveForecast.js";
import type { EvidenceSelection, EvidenceWorkerRequest, EvidenceWorkerResponse } from "./protocol.js";
import type { PersonalDraft, PersonalForecastReadModel, ForecastRequest } from "../../src/application/personalMvp.js";
import type { StandaloneWorkerRequest, StandaloneWorkerResponse } from "./protocol.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import { boundedEvidencePoints } from "../../src/application/mortgageChartData.js";
export { boundedEvidencePoints } from "../../src/application/mortgageChartData.js";

export const EVIDENCE_DEADLINE_MS = 25_000;
export const FORECAST_DEADLINE_MS = 150_000;
const evidenceScheduler: ForecastScheduler = { set: (callback, delay) => setTimeout(callback, delay), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
export interface EvidenceDiagnostic {
  readonly requestId: number;
  readonly operation: EvidenceSelection["operation"];
  readonly startIndex: number;
  readonly phase: "created" | "posted" | "settled" | "rendered" | "ignored" | "mismatched" | "error" | "timeout" | Extract<EvidenceWorkerResponse, { outcome: "progress" }>["phase"];
  readonly elapsedMs: number;
  readonly pointCount: number;
}

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
  readonly evidenceSourceReady?: boolean;
  onmessage: ((event: { data: EvidenceWorkerResponse }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(request: EvidenceWorkerRequest): void;
  terminate(): void;
}

// The baseline result owns lifetime across routes, including screens with no
// evidence panel. Claiming transfers its idle worker to the evidence controller.
const retainedEvidenceWorkers = new WeakMap<object, EvidenceWorkerPort>();
const forecastEvidenceControllers = new WeakMap<object, Map<PersonalDraft, EvidenceController>>();
export function forecastEvidenceController(forecast: PersonalHouseholdForecastReadModel, model: PersonalDraft, makeWorker: () => EvidenceWorkerPort): EvidenceController {
  let controllers = forecastEvidenceControllers.get(forecast);
  if (!controllers) { controllers = new Map(); forecastEvidenceControllers.set(forecast, controllers); }
  let controller = controllers.get(model);
  if (!controller) { controller = new EvidenceController({ forecast, model }, makeWorker); controllers.set(model, controller); }
  return controller;
}
export function claimForecastEvidenceWorker(forecast: PersonalHouseholdForecastReadModel): EvidenceWorkerPort | undefined {
  const worker = retainedEvidenceWorkers.get(forecast);
  retainedEvidenceWorkers.delete(forecast);
  return worker;
}

export interface StandaloneWorkerPort {
  onmessage: ((event: { data: StandaloneWorkerResponse }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(message: StandaloneWorkerRequest): void;
  terminate(): void;
}
export interface StandaloneView {
  readonly pending: boolean;
  readonly stale: boolean;
  readonly result?: PersonalForecastReadModel;
  readonly error?: string | undefined;
  readonly durationMs?: number;
  readonly cancelled?: boolean;
}
/** Exact existing standalone application API, with independent cancellation and
 * request ownership. It must never substitute a household run or shorter dates. */
export class StandaloneController {
  #worker: StandaloneWorkerPort | undefined;
  #timer: unknown;
  #sequence = 0;
  #view: StandaloneView = { pending: false, stale: false };
  constructor(readonly makeWorker: () => StandaloneWorkerPort, readonly changed: (view: StandaloneView) => void,
    readonly scheduler: ForecastScheduler = evidenceScheduler) {}
  #publish(view: StandaloneView): void { this.#view = view; this.changed(view); }
  #stop(): void {
    ++this.#sequence;
    this.scheduler.clear(this.#timer); this.#timer = undefined;
    if (this.#worker) {
      this.#worker.onmessage = null; this.#worker.onerror = null; this.#worker.onmessageerror = null;
      try { this.#worker.terminate(); } catch { /* Latest request remains authoritative. */ }
    }
    this.#worker = undefined;
  }
  run(model: PersonalDraft, request: ForecastRequest): void {
    this.#stop();
    const requestId = this.#sequence;
    this.#publish({ ...this.#view, pending: true, stale: this.#view.result !== undefined, error: undefined, cancelled: false });
    const fail = () => {
      if (requestId !== this.#sequence) return;
      this.#stop();
      this.#publish({ ...this.#view, pending: false, error: "Standalone forecast could not be calculated. Run the forecast again to retry." });
    };
    try {
      const worker = this.makeWorker(); this.#worker = worker;
      worker.onerror = event => { event.preventDefault(); fail(); };
      worker.onmessageerror = fail;
      worker.onmessage = ({ data }) => {
        if (requestId !== this.#sequence) return;
        if (data.operation !== "standalone_forecast" || data.requestId !== requestId) { fail(); return; }
        if (data.outcome === "error" || data.result.scope !== request.scope || data.result.simulationStart !== request.simulationStart || data.result.simulationEnd !== request.simulationEnd) { fail(); return; }
        if (data.result.status === "completed" && ("points" in data.result ? data.result.points.length : data.result.liabilityPeriodTotals.length) !== request.months) { fail(); return; }
        this.#stop();
        this.#publish({ pending: false, stale: false, result: data.result, durationMs: data.durationMs });
      };
      this.#timer = this.scheduler.set(fail, 60_000);
      worker.postMessage({ operation: "standalone_forecast", requestId, model, request });
    } catch { fail(); }
  }
  invalidate(): void { this.#stop(); this.#publish({ ...this.#view, pending: false, stale: this.#view.result !== undefined, error: undefined, cancelled: false }); }
  cancel(): void { this.#stop(); this.#publish({ ...this.#view, pending: false, stale: this.#view.result !== undefined, cancelled: true }); }
  reset(): void { this.#stop(); this.#publish({ pending: false, stale: false }); }
  dispose(): void { this.#stop(); }
}

/** One evidence worker per immutable source shared by all visible panels.
 * It never submits a forecast. Only bounded exact read models cross back. */
export class EvidenceController {
  #worker: EvidenceWorkerPort | undefined;
  #sequence = 0;
  #sent = false;
  #cache = new Map<string, EvidenceWorkerResponse>();
  #settled = new Map<number, { boundary: Pick<EvidenceWorkerRequest, "requestId" | "operation" | "startIndex">; started: number; pointCount: number }>();
  #pending = new Map<number, { key: string; boundary: Pick<EvidenceWorkerRequest, "operation" | "requestId" | "fingerprint" | "startIndex" | "liabilityId">; timer?: unknown; started: number; pointCount: number; listeners: Set<(response: EvidenceWorkerResponse) => void> }>();
  readonly diagnostics: EvidenceDiagnostic[] = [];
  constructor(readonly source: { forecast: PersonalHouseholdForecastReadModel; model: PersonalDraft }, readonly makeWorker: () => EvidenceWorkerPort,
    readonly scheduler: ForecastScheduler = evidenceScheduler, readonly now: () => number = () => performance.now()) {}
  #observe(item: { boundary: Pick<EvidenceWorkerRequest, "requestId" | "operation" | "startIndex">; started: number; pointCount: number }, phase: EvidenceDiagnostic["phase"]): void {
    try {
      const elapsedMs = this.now() - item.started;
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
        const diagnostic: EvidenceDiagnostic = { requestId: item.boundary.requestId, operation: item.boundary.operation,
          startIndex: item.boundary.startIndex, phase, elapsedMs, pointCount: item.pointCount };
        this.diagnostics.push(diagnostic);
        if (this.diagnostics.length > 32) this.diagnostics.shift();
        // Safe counters only. A test-runner listener can retain these before a
        // later page crash; no financial source/fingerprint is sent to logs.
        if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent === "function")
          globalThis.dispatchEvent(new CustomEvent("pfm-evidence-phase", { detail: diagnostic }));
      }
    } catch { /* Observation never affects execution. */ }
  }
  #fail(phase: "error" | "timeout" = "error", sourceError = false): void {
    const pending = [...this.#pending.values()];
    this.dispose();
    for (const item of pending) {
      this.#observe(item, phase);
      for (const listener of item.listeners) listener({ ...item.boundary, outcome: "error", error: sourceError
        ? "Monthly evidence has missing or mismatched period/source data. Update the forecast and retry."
        : phase === "timeout" ? "Monthly evidence took too long to load. Retry the selected evidence or update the forecast."
          : "Monthly evidence could not be verified. Retry the selected evidence or update the forecast." });
    }
  }
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
    let started = 0;
    try { started = this.now(); } catch { /* Optional observation. */ }
    const pending = { key, boundary, started, pointCount: selection.operation === "monthly_evidence" ? 1 : Math.min(12, forecast.status === "unavailable" ? 0 : forecast.points.length - selection.startIndex), timer: undefined as unknown, listeners: new Set([changed]) };
    this.#pending.set(boundary.requestId, pending);
    const fail = () => this.#fail();
    let bounded: ReturnType<typeof boundedEvidencePoints>;
    try { bounded = boundedEvidencePoints(forecast, selection); }
    catch {
      this.#fail("error", true);
      return () => {};
    }
    try {
      pending.timer = this.scheduler.set(() => {
        if (pending.listeners.size) this.#fail("timeout");
        else this.#pending.delete(boundary.requestId);
      }, EVIDENCE_DEADLINE_MS);
      if (!this.#worker) {
        this.#worker = this.makeWorker();
        const owner = this.#worker;
        const failOwner = () => { if (this.#worker === owner) fail(); };
        this.#observe(pending, "created");
        this.#worker.onmessage = ({ data }) => {
          if (this.#worker !== owner) return;
          const item = this.#pending.get(data.requestId);
          if (!item) {
            this.#observe({ boundary: data, started, pointCount: 0 }, "ignored");
            return; // Superseded response; live requests still have deadlines.
          }
          if (data.operation !== item.boundary.operation || data.fingerprint !== item.boundary.fingerprint || data.startIndex !== item.boundary.startIndex || data.liabilityId !== item.boundary.liabilityId) {
            this.#observe(item, "mismatched"); fail(); return;
          }
          if (data.outcome === "progress") {
            this.#observe(item, data.phase);
            for (const listener of item.listeners) listener(data);
            return;
          }
          if (data.outcome === "error") { this.#fail("error", true); return; }
          if (data.outcome === "result") {
            const point = this.source.forecast.status !== "unavailable" ? this.source.forecast.points[data.startIndex] : undefined;
            const end = this.source.forecast.status !== "unavailable" ? this.source.forecast.points[data.startIndex + item.pointCount - 1]?.periodEnd : undefined;
            if (data.operation === "monthly_evidence" ? !data.detail : !data.window || data.window.start !== point?.periodStart || data.window.end !== end || data.window.rows.length !== item.pointCount || data.window.liabilityId !== data.liabilityId ||
              `household:replay:${data.window.fingerprint}:${point?.periodStart}:${point?.periodEnd}` !== item.boundary.fingerprint ||
              data.window.rows.some((row, index) => this.source.forecast.status === "unavailable" || row.start !== this.source.forecast.points[data.startIndex + index]?.periodStart || row.end !== this.source.forecast.points[data.startIndex + index]?.periodEnd)) { fail(); return; }
            if (this.#cache.size >= 4) this.#cache.delete(this.#cache.keys().next().value!);
            this.#cache.set(item.key, data);
          }
          this.#pending.delete(data.requestId);
          this.scheduler.clear(item.timer);
          this.#observe(item, "settled");
          if (this.#settled.size >= 4) this.#settled.delete(this.#settled.keys().next().value!);
          this.#settled.set(data.requestId, { boundary: { requestId: data.requestId, operation: data.operation, startIndex: data.startIndex }, started: item.started, pointCount: item.pointCount });
          for (const listener of item.listeners) listener(data);
        };
        this.#worker.onerror = event => { event.preventDefault(); failOwner(); };
        this.#worker.onmessageerror = failOwner;
      }
      const message = { ...boundary, points: bounded.points,
        ...(!this.#sent ? { source: { ...(!this.#worker.evidenceSourceReady ? { basis: bounded.basis } : {}), model: this.source.model,
          ...(forecast.status !== "unavailable" && forecast.diagnosticCatalogs ? { diagnosticCatalogs: forecast.diagnosticCatalogs } : {}) } } : {}) };
      this.#observe(pending, "posted");
      this.#sent = true;
      this.#worker.postMessage(message);
    } catch { fail(); }
    return () => { pending.listeners.delete(changed); };
  }
  rendered(requestId: number): void {
    const item = this.#settled.get(requestId);
    if (item) { this.#observe(item, "rendered"); this.#settled.delete(requestId); }
  }
  dispose(): void {
    for (const item of this.#pending.values()) this.scheduler.clear(item.timer);
    if (this.#worker) {
      this.#worker.onmessage = null; this.#worker.onerror = null; this.#worker.onmessageerror = null;
      try { this.#worker.terminate(); } catch { /* Disposed ownership is authoritative. */ }
    }
    this.#worker = undefined; this.#sent = false; this.#pending.clear(); this.#cache.clear(); this.#settled.clear();
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
  #retained: { result: object } | undefined;
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
  #releaseEvidence(): void {
    if (!this.#retained) return;
    for (const controller of forecastEvidenceControllers.get(this.#retained.result)?.values() ?? []) controller.dispose();
    forecastEvidenceControllers.delete(this.#retained.result);
    const unclaimed = retainedEvidenceWorkers.get(this.#retained.result);
    retainedEvidenceWorkers.delete(this.#retained.result);
    try { unclaimed?.terminate(); } catch { /* Ownership still ends. */ }
    this.#retained = undefined;
  }
  #record(record: PerformanceRecord): void { try { this.record(record); } catch { /* Observational only. */ } }
  #now(): number | undefined { try { const value = this.now(); return Number.isFinite(value) ? value : undefined; } catch { return undefined; } }
  submit(input: ForecastSubmission, immediate = false): void {
    const cached = input.operation === "baseline_forecast" ? this.#cache.get(input.fingerprint) : undefined;
    // Only the current immutable result and its original model may keep the
    // authenticated worker source. The economic cache key is not source proof.
    const retain = cached !== undefined && cached === this.#retained?.result && cached === this.#state.lastGoodResult &&
      this.#state.resultFingerprint === input.fingerprint && this.#state.resultModel === input.model &&
      !this.#state.pending && !this.#state.stale;
    if (!retain) this.#releaseEvidence();
    this.#stop();
    const requestId = ++this.#sequence;
    const message = { ...input, requestId } as ForecastWorkerRequest;
    this.#publish({ ...pendingForecastState(this.#state, requestId, input.fingerprint), latestResult: undefined, cacheState: undefined, performanceContext: undefined });
    const run = () => {
      this.#timer = undefined;
      if (!isCurrentForecastResponse(this.#state, message)) return;
      const context: PerformanceContext = { ...input.performanceContext, executionLocation: "browser_main", cacheState: cached ? "hit" : input.operation === "baseline_forecast" ? "miss" : "not_applicable" };
      if (cached !== undefined) {
        this.#retained = { result: cached };
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
          for (const record of data.records) this.#record(record);
          if (data.outcome === "error") {
            this.#stop();
            this.#publish(settledForecastState(this.#state, "error", undefined, data.error.message));
            return;
          }
          const result = data.result;
          if (!forecastResultCatalogsValid(result)) {
            this.#stop();
            this.#publish(settledForecastState(this.#state, "error", undefined, "Forecast source qualifications do not match. Recalculate to retry."));
            return;
          }
          if (input.operation === "baseline_forecast" && "points" in result && "scope" in result && !baselineResultMatchesRequest(result, input.request)) {
            this.#stop();
            this.#publish(settledForecastState(this.#state, "error", undefined, "Forecast periods do not match the requested window. Recalculate to retry."));
            return;
          }
          const good = isCacheableBaseline(result.status);
          if (input.operation === "baseline_forecast" && good && "points" in result) {
            const evidenceWorker = worker as unknown as EvidenceWorkerPort;
            Object.defineProperty(evidenceWorker, "evidenceSourceReady", { value: true, configurable: true });
            this.#retained = { result };
            retainedEvidenceWorkers.set(result, evidenceWorker);
            worker.onmessage = null;
            const releaseIdleOwner = () => { if (this.#retained?.result === result) this.#releaseEvidence(); };
            worker.onerror = event => { event.preventDefault(); releaseIdleOwner(); };
            worker.onmessageerror = releaseIdleOwner;
            this.#worker = undefined;
          }
          this.#stop();
          if (input.operation === "baseline_forecast" && good) this.#cache.put(input.fingerprint, result);
          this.#publish({ ...settledForecastState(this.#state, isCacheableBaseline(result.status) ? result.status : "unsupported", result,
            result.status === "unavailable" ? result.message : undefined),
            latestResult: result,
            ...(good ? { resultModel: input.model, resultRequest: input.request, performanceContext: { ...context, status: result.status } } : {}) });
        };
        // postMessage's full boundary is not reliably separable into serialization vs enqueue.
        // Mark unmeasured, never attribute the roundtrip or financial work to transport.
        this.#record({ phase: "transport.serialization", availability: "not_measured", context });
        this.#timer = this.scheduler.set(fail, FORECAST_DEADLINE_MS);
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
    this.#releaseEvidence();
    this.#stop();
    this.#publish({ ...this.#state, pending: false, stale: this.#state.lastGoodResult !== undefined,
      lifecycle: this.#state.lastGoodResult === undefined ? "idle" : "stale", latestResult: undefined, message });
  }
  /** A replacement model must never inherit results or diagnostics from another model. */
  reset(): void {
    this.#releaseEvidence();
    this.#stop();
    ++this.#sequence;
    this.#cache.clear();
    this.#publish(initialForecastState());
  }
  dispose(): void {
    this.#releaseEvidence();
    this.#stop();
    this.#state = initialForecastState();
    this.#cache.clear();
  }
}
