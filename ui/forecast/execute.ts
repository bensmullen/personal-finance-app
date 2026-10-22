import { executeForecastWorkerRequest as calculate } from "../../src/application/interactiveForecast.js";
import { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import { MortgageWindowCache } from "../../src/application/mortgageChartData.js";
import type { PerformanceClock } from "../../src/application/performance.js";
import type { EvidenceWorkerRequest, EvidenceWorkerResponse, ForecastWorkerRequest, ForecastWorkerResponse } from "./protocol.js";

let source: EvidenceWorkerRequest["source"];
let mortgages: MortgageWindowCache | undefined;

/** Restore/checkpoint validation and financial replay stay off the UI thread.
 * The worker owns only one source and returns small exact read models. */
export function executeForecastWorkerRequest(message: ForecastWorkerRequest, clock: PerformanceClock): ForecastWorkerResponse;
export function executeForecastWorkerRequest(message: EvidenceWorkerRequest, clock: PerformanceClock): EvidenceWorkerResponse;
export function executeForecastWorkerRequest(message: ForecastWorkerRequest | EvidenceWorkerRequest, clock: PerformanceClock): ForecastWorkerResponse | EvidenceWorkerResponse {
  if (message.operation === "baseline_forecast" || message.operation === "scenario_comparison" || message.operation === "major_asset_debt_comparison") return calculate(message, clock);
  const boundary = { operation: message.operation, requestId: message.requestId, fingerprint: message.fingerprint, startIndex: message.startIndex, liabilityId: message.liabilityId };
  const now = () => { try { return clock.now(); } catch { return undefined; } };
  const started = now();
  const timing = () => { const end = now(); return started !== undefined && end !== undefined && Number.isFinite(end - started) && end >= started ? { durationMs: end - started } : {}; };
  try {
    if (message.source) {
      source = message.source;
      mortgages = new MortgageWindowCache(source.forecast);
    }
    if (!source || source.forecast.status === "unavailable" || !Number.isSafeInteger(message.startIndex) || message.startIndex < 0)
      throw new Error("Selected forecast evidence is unavailable.");
    const point = source.forecast.points[message.startIndex];
    if (!point) throw new Error("Selected forecast period is unavailable.");
    if (point.traceRefs.find(ref => ref.replayArtifact !== undefined)?.traceId !== message.fingerprint)
      throw new Error("Selected forecast identity does not match.");
    const result = message.operation === "monthly_evidence"
      ? { detail: inspectMonthlyMoney(point, source.model) }
      : { window: mortgages!.get(message.liabilityId, message.startIndex) };
    return { ...boundary, outcome: "result", ...result, ...timing() };
  } catch {
    // Portable messages contain no financial facts or raw runtime errors.
    return { ...boundary, outcome: "error", error: "Monthly evidence has missing or mismatched period/source data. Update the forecast and retry.", ...timing() };
  }
}
