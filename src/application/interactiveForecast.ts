import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../model/version.js";
import { canonicalSerialize } from "../simulation/run.js";
import type { HouseholdForecastRequest } from "./householdProjection.js";

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
