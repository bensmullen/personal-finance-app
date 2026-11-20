import { executeForecastWorkerRequest as calculate } from "../../src/application/interactiveForecast.js";
import { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import { householdEvidenceProof, householdEvidenceSelectionMeasurements, restoreHouseholdEvidencePoints, inspectMortgageWindow, type HouseholdEvidenceProof, type ReplayRestoreMeasurement } from "../../src/application/mortgageChartData.js";
import { runPersonalForecast } from "../../src/application/personalMvp.js";
import type { PerformanceClock } from "../../src/application/performance.js";
import { sampledJsHeapBytes } from "../../src/application/performance.js";
import { restoreHouseholdForecastEvidence } from "../../src/application/householdProjection.js";
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
  let verification: EvidenceWorkerResponse["verification"];
  let boundSource: typeof source;
  const report = (phase: Extract<EvidenceWorkerResponse, { outcome: "progress" }>["phase"], measurements?: EvidenceWorkerResponse["measurements"]) => {
    const heap = sampledJsHeapBytes();
    try { progress?.({ ...boundary, outcome: "progress", phase, ownership, sourceIdentityMatched,
      ...(verification ? { verification } : {}), ...(heap === undefined ? {} : { workerHeapBytes: heap }),
      ...(measurements ? { measurements } : {}), ...timing() }); }
    catch { /* Telemetry cannot change evidence execution. */ }
  };
  try {
    report("received");
    boundSource = source;
    if (message.source) {
      const basis = message.source.basis ?? generatedBasis;
      if (!basis) throw new Error("Missing original proof");
      boundSource = source = { ...message.source, basis };
      ownership = message.source.basis ? "transported_source" : "retained_source";
    } else if (boundSource?.basis) {
      ownership = boundSource.basis === generatedBasis ? "retained_source" : "transported_source";
    }
    if (!boundSource?.basis) throw new Error("Selected forecast evidence is unavailable.");
    // Callbacks can synchronously replace the worker's retained source.
    const { basis, model, diagnosticCatalogs } = boundSource;
    report("source_bound");
    let restore: ReplayRestoreMeasurement | undefined;
    const observation = { now: () => clock.now(), phase: (phase: import("../../src/application/mortgageChartData.js").HouseholdEvidencePhase,
      counts?: EvidenceWorkerResponse["verification"]) => { if (counts) verification = counts; report(phase); },
      record: (measurement: ReplayRestoreMeasurement) => { restore = measurement; } };
    const points = restoreHouseholdEvidencePoints(basis, message, message.points, message.fingerprint, diagnosticCatalogs,
      observation, model);
    sourceIdentityMatched = true;
    const restoredAt = now();
    report("restored", { ...householdEvidenceSelectionMeasurements(basis, message, message.points.length, model),
      ...(restore === undefined ? {} : { restore }) });
    const point = points[0];
    if (!point) throw new Error("Selected forecast period is unavailable.");
    const result = message.operation === "monthly_evidence"
      ? { detail: inspectMonthlyMoney(point, model, { ...observation, record() {} }) }
      : { window: inspectMortgageWindow(points, message.liabilityId, { ...observation, record() {} }, model) };
    const projectedAt = now();
    const heap = sampledJsHeapBytes();
    const measurements = { ...householdEvidenceSelectionMeasurements(basis, message, points.length, model),
      ...(restore === undefined ? {} : { restore }),
      ...(started === undefined || restoredAt === undefined ? {} : { restoreAndSourceValidationMs: Math.max(0, restoredAt - started) }),
      ...(restoredAt === undefined || projectedAt === undefined ? {} : { replayAndProjectionMs: Math.max(0, projectedAt - restoredAt) }),
      ...(heap === undefined ? {} : { workerHeapAfterBytes: heap }) };
    report("projected");
    const response = { ...boundary, outcome: "result" as const, ...result, measurements, ownership, sourceIdentityMatched, ...(verification ? { verification } : {}), ...timing() };
    restoreHouseholdForecastEvidence(basis, model);
    return response;
  } catch {
    if (source === boundSource) source = undefined;
    // Portable messages contain no financial facts or raw runtime errors.
    return { ...boundary, outcome: "error", ownership, sourceIdentityMatched: false, ...(verification ? { verification } : {}), error: "Monthly evidence has missing or mismatched period/source data. Update the forecast and retry.", ...timing() };
  }
}
