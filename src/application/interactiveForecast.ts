import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../model/version.js";
import { canonicalSerialize } from "../simulation/run.js";
import type { ExecutableScenarioIntent } from "./compiler/scenarios.js";
import type { HouseholdForecastRequest, MajorAssetDebtAddition, PersonalHouseholdForecastReadModel, PersonalHouseholdScenarioComparisonReadModel } from "./householdProjection.js";
import type { PerformanceClock, PerformanceContext, PerformanceObserver, PerformanceRecord } from "./performance.js";
import { runPersonalHouseholdForecast, comparePersonalHouseholdScenarioIntents, comparePersonalHouseholdMajorAssetDebtAddition } from "./householdProjection.js";
import { createApplicationPerformanceObserver } from "./performance.js";

interface RequestBoundary {
  readonly requestId: number;
  readonly fingerprint: string;
  readonly model: PortableModelEnvelope;
  readonly request: HouseholdForecastRequest;
  readonly performanceContext: PerformanceContext;
}
export type ForecastWorkerRequest = RequestBoundary & (
  | { readonly operation: "baseline_forecast" }
  | { readonly operation: "scenario_comparison"; readonly intents: readonly ExecutableScenarioIntent[] }
  | { readonly operation: "major_asset_debt_comparison"; readonly addition: MajorAssetDebtAddition }
);
export type ForecastWorkerResult = PersonalHouseholdForecastReadModel | PersonalHouseholdScenarioComparisonReadModel;
export type ForecastWorkerResponse = Pick<ForecastWorkerRequest, "operation" | "requestId" | "fingerprint"> & {
  readonly records: readonly PerformanceRecord[];
} & (
  | { readonly outcome: "result"; readonly result: ForecastWorkerResult }
  | { readonly outcome: "error"; readonly error: { readonly code: "EXECUTION_ERROR"; readonly message: string } }
);

/** Runtime-neutral seam; invoked only inside the dedicated Worker in the browser. */
export const executeForecastWorkerRequest = (message: ForecastWorkerRequest, clock: PerformanceClock): ForecastWorkerResponse => {
  const records: PerformanceRecord[] = [];
  const boundary = { operation: message.operation, requestId: message.requestId, fingerprint: message.fingerprint };
  let observer: PerformanceObserver | undefined;
  try {
    observer = createApplicationPerformanceObserver(clock,
      { ...message.performanceContext, executionLocation: "browser_worker", cacheState: "miss", workerConcurrency: 1 },
      { record: (record) => { records.push(record); } });
  } catch { /* Instrumentation setup cannot prevent financial execution. */ }
  try {
    const result = message.operation === "baseline_forecast"
      ? runPersonalHouseholdForecast(message.model, message.request, observer)
      : message.operation === "scenario_comparison"
        ? comparePersonalHouseholdScenarioIntents(message.model, message.request, message.intents)
        : comparePersonalHouseholdMajorAssetDebtAddition(message.model, message.request, message.addition);
    if (result.status === "unavailable" && result.executionError)
      return { ...boundary, outcome: "error", error: { code: "EXECUTION_ERROR", message: "Unexpected household execution error." }, records };
    // Comparison APIs have no observer seam. Do not invent their timing.
    return { ...boundary, outcome: "result", result: toForecastWorkerResult(result), records };
  } catch {
    // Runtime error text is deliberately portable and contains no personal data.
    return { ...boundary, outcome: "error", error: { code: "EXECUTION_ERROR", message: "Unexpected household execution error." }, records };
  }
};

export const INTERACTIVE_ENGINE_VERSION = CURRENT_RUN_VERSIONS.engineVersion;

/** Only transport metadata is canonicalized; direct comparison callers retain exact values. */
export const toForecastWorkerResult = (result: ForecastWorkerResult): ForecastWorkerResult => {
  if (!("alternatives" in result)) return result;
  return { ...result, alternatives: result.alternatives.map((alternative) => ({
    ...alternative,
    configurationDifferences: alternative.configurationDifferences.map((difference) => ({
      ...difference,
      before: JSON.parse(canonicalSerialize(difference.before)),
      after: JSON.parse(canonicalSerialize(difference.after)),
    })),
  })) };
};


export type ForecastOperation = "baseline_forecast" | "scenario_comparison" | "major_asset_debt_comparison";
export type ForecastLifecycle = "idle" | "running" | "stale" | "completed" | "incomplete" | "unsupported" | "error";
export const FORECAST_DEBOUNCE_MS = 300;

/** Economics only. This versioned non-security hash is not a financial result identity. */
export const calculationFingerprint = (
  operation: ForecastOperation,
  model: PortableModelEnvelope,
  request: HouseholdForecastRequest,
  economicInputs?: unknown,
): string => {
  const { runIdentity: _identity, ...economics } = request;
  const canonical = canonicalSerialize({ schema: "interactive-forecast/v1", operation, model, request: economics,
    economicInputs: economicInputs ?? null, versions: CURRENT_RUN_VERSIONS });
  let hash = 0xcbf29ce484222325n;
  // Hash UTF-16 code units explicitly, consistently across browser and Node.
  for (let i = 0; i < canonical.length; i++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(canonical.charCodeAt(i))) * 0x100000001b3n);
  }
  return `interactive-forecast/v1:${hash.toString(16).padStart(16, "0")}`;
};

export const isCacheableBaseline = (status: string): status is "completed" | "incomplete" =>
  status === "completed" || status === "incomplete";

/** Derived, per-session deterministic LRU. Never stores failed or superseded execution. */
export class BaselineCache<T extends { readonly status: string }> {
  readonly #entries = new Map<string, T>();
  get(fingerprint: string): T | undefined {
    const value = this.#entries.get(fingerprint);
    if (value !== undefined) {
      this.#entries.delete(fingerprint);
      this.#entries.set(fingerprint, value);
    }
    return value;
  }
  put(fingerprint: string, result: T): void {
    if (!isCacheableBaseline(result.status)) return;
    this.#entries.delete(fingerprint);
    this.#entries.set(fingerprint, result);
    if (this.#entries.size > 4) this.#entries.delete(this.#entries.keys().next().value!);
  }
  clear(): void { this.#entries.clear(); }
}

export interface ForecastState<T> {
  readonly lifecycle: ForecastLifecycle;
  readonly pending: boolean;
  readonly stale: boolean;
  readonly lastGoodResult?: T;
  readonly resultFingerprint?: string | undefined;
  readonly requestId?: number;
  readonly fingerprint?: string;
  readonly message?: string | undefined;
}
export const initialForecastState = <T>(): ForecastState<T> => ({ lifecycle: "idle", pending: false, stale: false });
export const pendingForecastState = <T>(state: ForecastState<T>, requestId: number, fingerprint: string): ForecastState<T> => ({
  ...state, lifecycle: state.lastGoodResult === undefined ? "running" : "stale", pending: true,
  stale: state.lastGoodResult !== undefined, requestId, fingerprint, message: undefined,
});
export const isCurrentForecastResponse = <T>(state: ForecastState<T>, response: { readonly requestId: number; readonly fingerprint: string }): boolean =>
  state.pending && state.requestId === response.requestId && state.fingerprint === response.fingerprint;
export const settledForecastState = <T>(state: ForecastState<T>, lifecycle: "completed" | "incomplete" | "unsupported" | "error", result?: T, message?: string): ForecastState<T> => {
  if (isCacheableBaseline(lifecycle) && result !== undefined)
    return { ...state, lifecycle, pending: false, stale: false, lastGoodResult: result, resultFingerprint: state.fingerprint, message };
  return { ...state, lifecycle, pending: false, stale: state.lastGoodResult !== undefined, message };
};

/** Display-only: authoritative arrays are never modified. */
export const sampleForecastChart = <T>(points: readonly T[]): readonly T[] => points.length <= 120
  ? points.slice() : Array.from({ length: 120 }, (_, i) => points[Math.floor(i * (points.length - 1) / 119)]!);
export const forecastPage = <T>(rows: readonly T[], page: number): readonly T[] => {
  const last = Math.max(0, Math.ceil(rows.length / 24) - 1);
  const bounded = Number.isSafeInteger(page) ? Math.max(0, Math.min(last, page)) : 0;
  return rows.slice(bounded * 24, bounded * 24 + 24);
};
