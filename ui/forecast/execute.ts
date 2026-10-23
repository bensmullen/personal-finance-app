import { executeForecastWorkerRequest as calculate } from "../../src/application/interactiveForecast.js";
import { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import { householdEvidenceProof, householdEvidenceSelectionMeasurements, restoreHouseholdEvidencePoints, inspectMortgageWindow, type HouseholdEvidenceProof, type ReplayRestoreMeasurement } from "../../src/application/mortgageChartData.js";
import { runPersonalForecast } from "../../src/application/personalMvp.js";
import type { PerformanceClock } from "../../src/application/performance.js";
import { sampledJsHeapBytes } from "../../src/application/performance.js";
import type { EvidenceWorkerRequest, EvidenceWorkerResponse, ForecastWorkerRequest, ForecastWorkerResponse, StandaloneWorkerRequest, StandaloneWorkerResponse } from "./protocol.js";

let source: EvidenceWorkerRequest["source"];
let generatedBasis: HouseholdEvidenceProof | undefined;

/** Restore/checkpoint validation and financial replay stay off the UI thread.
 * The worker owns only one source and returns small exact read models. */
export function executeForecastWorkerRequest(message: ForecastWorkerRequest, clock: PerformanceClock): ForecastWorkerResponse;
export function executeForecastWorkerRequest(message: EvidenceWorkerRequest, clock: PerformanceClock, progress?: (response: EvidenceWorkerResponse) => void): EvidenceWorkerResponse;
export function executeForecastWorkerRequest(message: StandaloneWorkerRequest, clock: PerformanceClock): StandaloneWorkerResponse;
export function executeForecastWorkerRequest(message: ForecastWorkerRequest | EvidenceWorkerRequest | StandaloneWorkerRequest, clock: PerformanceClock,
  progress?: (response: EvidenceWorkerResponse) => void): ForecastWorkerResponse | EvidenceWorkerResponse | StandaloneWorkerResponse;
export function executeForecastWorkerRequest(message: ForecastWorkerRequest | EvidenceWorkerRequest | StandaloneWorkerRequest, clock: PerformanceClock,
  progress?: (response: EvidenceWorkerResponse) => void): ForecastWorkerResponse | EvidenceWorkerResponse | StandaloneWorkerResponse {
  if (message.operation === "baseline_forecast" || message.operation === "scenario_comparison" || message.operation === "major_asset_debt_comparison") {
    source = undefined;
    generatedBasis = undefined;
    const response = calculate(message, clock);
    if (message.operation === "baseline_forecast" && response.outcome === "result" && "points" in response.result) {
      generatedBasis = householdEvidenceProof(response.result.points);
    }
    return response;
  }
  if (message.operation === "standalone_forecast") {
    const boundary = { operation: message.operation, requestId: message.requestId };
    try {
      const start = clock.now();
      const result = runPersonalForecast(message.model, message.request);
      return { ...boundary, outcome: "result", result, durationMs: clock.now() - start };
    } catch { return { ...boundary, outcome: "error", error: "Standalone execution failed. Run the forecast again to retry." }; }
  }
  const boundary = { operation: message.operation, requestId: message.requestId, fingerprint: message.fingerprint, startIndex: message.startIndex, liabilityId: message.liabilityId };
  const now = () => { try { return clock.now(); } catch { return undefined; } };
  const started = now();
  const timing = () => { const end = now(); return started !== undefined && end !== undefined && Number.isFinite(end - started) && end >= started ? { durationMs: end - started } : {}; };
  let ownership: NonNullable<EvidenceWorkerResponse["ownership"]> = "missing_source";
  let sourceIdentityMatched = false;
  const report = (phase: Extract<EvidenceWorkerResponse, { outcome: "progress" }>["phase"], measurements?: EvidenceWorkerResponse["measurements"]) => {
    try { progress?.({ ...boundary, outcome: "progress", phase, ownership, sourceIdentityMatched, ...(measurements ? { measurements } : {}), ...timing() }); }
    catch { /* Telemetry cannot change evidence execution. */ }
  };
  try {
    report("received");
    if (message.source) {
      const basis = message.source.basis ?? generatedBasis;
      if (!basis) throw new Error("Missing original proof");
      source = { ...message.source, basis };
      ownership = message.source.basis ? "transported_source" : "retained_source";
    } else if (source?.basis) {
      ownership = source.basis === generatedBasis ? "retained_source" : "transported_source";
    }
    if (!source?.basis) throw new Error("Selected forecast evidence is unavailable.");
    report("source_bound");
    let restore: ReplayRestoreMeasurement | undefined;
    const selectionMeasurements = () => householdEvidenceSelectionMeasurements(source!.basis!, message, message.points.length);
    const observation = { now: () => clock.now(), phase: (phase: import("../../src/application/mortgageChartData.js").HouseholdEvidencePhase) => report(phase),
      record: (measurement: ReplayRestoreMeasurement) => { restore = measurement; } };
    const points = restoreHouseholdEvidencePoints(source.basis, message, message.points, message.fingerprint, source.diagnosticCatalogs,
      observation);
    sourceIdentityMatched = true;
    const restoredAt = now();
    report("restored", { ...selectionMeasurements(), ...(restore === undefined ? {} : { restore }) });
    const point = points[0];
    if (!point) throw new Error("Selected forecast period is unavailable.");
    const result = message.operation === "monthly_evidence"
      ? { detail: inspectMonthlyMoney(point, source.model, { ...observation, record() {} }) }
      : { window: inspectMortgageWindow(points, message.liabilityId, { ...observation, record() {} }) };
    const projectedAt = now();
    const heap = sampledJsHeapBytes();
    const measurements = { ...householdEvidenceSelectionMeasurements(source.basis, message, points.length),
      ...(restore === undefined ? {} : { restore }),
      ...(started === undefined || restoredAt === undefined ? {} : { restoreAndSourceValidationMs: Math.max(0, restoredAt - started) }),
      ...(restoredAt === undefined || projectedAt === undefined ? {} : { replayAndProjectionMs: Math.max(0, projectedAt - restoredAt) }),
      ...(heap === undefined ? {} : { workerHeapAfterBytes: heap }) };
    report("projected");
    return { ...boundary, outcome: "result", ...result, measurements, ownership, sourceIdentityMatched, ...timing() };
  } catch {
    source = undefined;
    // Portable messages contain no financial facts or raw runtime errors.
    return { ...boundary, outcome: "error", ownership, sourceIdentityMatched, error: "Monthly evidence has missing or mismatched period/source data. Update the forecast and retry.", ...timing() };
  }
}
