import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../model/version.js";
import { canonicalSerialize } from "../simulation/run.js";
import type { ExecutableScenarioIntent } from "./compiler/scenarios.js";
import type { HouseholdForecastRequest, MajorAssetDebtAddition, PersonalHouseholdForecastReadModel, PersonalHouseholdScenarioComparisonReadModel } from "./householdProjection.js";
import type { PerformanceClock, PerformanceContext, PerformanceObserver, PerformanceRecord } from "./performance.js";
import { runPersonalHouseholdForecast, comparePersonalHouseholdScenarioIntents, comparePersonalHouseholdMajorAssetDebtAddition } from "./householdProjection.js";
import { createApplicationPerformanceObserver, forecastTransportCounters, sampledJsHeapBytes } from "./performance.js";
import { validateForecastCatalogTable, validateForecastDiagnostics, validateForecastLawReference } from "./forecastDiagnosticTransport.js";

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
    if ("scope" in result && result.status !== "unavailable") {
      // Observation failure cannot change a financial execution result.
      try {
        const started = clock.now();
        const counters = forecastTransportCounters(result);
        const heap = sampledJsHeapBytes();
        records.push({ phase: "transport.serialization", availability: "not_measured",
          context: { ...message.performanceContext, executionLocation: "browser_worker", cacheState: "miss" },
          resources: { metering: "not_metered", structuralCounters: { ...counters, transportCounterCollectionMs: Math.max(0, clock.now() - started) }, ...(heap === undefined ? {} : { memoryBytes: heap }) } });
      } catch { /* Bounded, optional diagnostics only. */ }
    }
    // Comparison APIs have no observer seam. Do not invent their timing.
    return { ...boundary, outcome: "result", result: toForecastWorkerResult(result), records };
  } catch {
    // Runtime error text is deliberately portable and contains no personal data.
    return { ...boundary, outcome: "error", error: { code: "EXECUTION_ERROR", message: "Unexpected household execution error." }, records };
  }
};

export const INTERACTIVE_ENGINE_VERSION = CURRENT_RUN_VERSIONS.engineVersion;

/** Checks both baseline and comparison transport without decoding proof on the
 * main thread. Exact catalog content is requalified by the source-owned worker. */
export const forecastResultCatalogsValid = (result: ForecastWorkerResult): boolean => {
  try {
    if ("scope" in result) {
      if (result.status === "unavailable") return true;
      validateForecastDiagnostics(result.diagnostics ?? [], [result.openingSnapshot?.outputCapabilities, ...(result.points ?? []).map(point => point.outputCapabilities)], result.diagnosticCatalogs);
      return true;
    }
    const tables = result.diagnosticCatalogs ?? [];
    const sources = new Set<string>();
    for (const table of tables) {
      validateForecastCatalogTable(table, table.source);
      const identity = JSON.stringify([table.source.runId, table.source.inputFingerprint]);
      if (sources.has(identity)) return false;
      sources.add(identity);
    }
    for (const diagnostic of result.diagnostics ?? []) {
      const law = diagnostic.projectedLaw;
      if (!law) continue;
      const matches = tables.filter(table => table.entries.some(entry => entry.id === law.catalogRef));
      if (!matches.length || matches.some(table => table.entries.find(entry => entry.id === law.catalogRef)!.content !== matches[0]!.entries.find(entry => entry.id === law.catalogRef)!.content)) return false;
      validateForecastLawReference(law, matches[0]!);
    }
    for (const alternative of result.alternatives) for (const period of alternative.points) for (const point of [period.baseline, period.alternative]) {
      let catalogRef: string | undefined;
      for (const output of Object.values(point.outputCapabilities ?? {})) {
        const law = output.diagnostics.find((item: import("./forecastDiagnosticTransport.js").ForecastTaxDiagnostic) => item.projectedLaw !== undefined)?.projectedLaw;
        if (law && "catalogRef" in law) { catalogRef = law.catalogRef; break; }
      }
      const table = tables.find(candidate => point.traceRefs.some(ref => ref.traceId ===
        `household:replay:${candidate.source.inputFingerprint}:${point.periodStart}:${point.periodEnd}`) &&
        (catalogRef === undefined || candidate.entries.some(entry => entry.id === catalogRef)));
      validateForecastDiagnostics([], [point.outputCapabilities], table);
    }
    return true;
  } catch { return false; }
};

/** Only transport metadata is canonicalized; direct comparison callers retain exact values. */
export const toForecastWorkerResult = (result: ForecastWorkerResult): ForecastWorkerResult => {
  if (!forecastResultCatalogsValid(result)) throw new Error("FORECAST_CATALOG_MISMATCH: invalid diagnostic transport");
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

/** Verify transport pairing without changing the engine's financial status. */
export const baselineResultMatchesRequest = (result: PersonalHouseholdForecastReadModel, request: HouseholdForecastRequest): boolean => {
  if (result.status === "unavailable") return true;
  try {
    validateForecastDiagnostics(result.diagnostics ?? [], [result.openingSnapshot?.outputCapabilities, ...result.points.map(point => point.outputCapabilities)],
      result.diagnosticCatalogs, result.diagnosticCatalogs ? { runId: request.runIdentity, inputFingerprint: result.diagnosticCatalogs.source.inputFingerprint } : undefined);
    if (result.diagnosticCatalogs && result.points.some(point => !point.traceRefs.some(ref =>
      ref.traceId === `household:replay:${result.diagnosticCatalogs!.source.inputFingerprint}:${point.periodStart}:${point.periodEnd}`))) return false;
  } catch { return false; }
  const boundary = request.compiler.cashFlow ?? request.compiler.investments ?? request.compiler.liabilities;
  if (!boundary) return false;
  const start = `${boundary.simulationStart}T00:00:00.000Z`, end = `${boundary.simulationEnd}T00:00:00.000Z`;
  if (result.requestedHorizon.start !== start || result.requestedHorizon.end !== end || result.asOf !== `${request.asOf}T00:00:00.000Z` || result.dataCutoff !== `${request.dataCutoff}T00:00:00.000Z`) return false;
  let through = start;
  for (const point of result.points) {
    const next = new Date(through);
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (point.periodStart !== through || point.periodEnd !== next.toISOString() || point.periodEnd > end) return false;
    through = point.periodEnd;
  }
  return (result.reachedThrough ?? start) === through && (result.status !== "completed" || through === end);
};

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
