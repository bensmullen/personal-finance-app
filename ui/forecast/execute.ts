import { executeForecastWorkerRequest as calculate } from "../../src/application/interactiveForecast.js";
import { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import { inspectMortgageWindow } from "../../src/application/mortgageChartData.js";
import { restorePortableHouseholdReplayArtifact } from "../../src/simulation/r3/replayArtifact.js";
import { runPersonalForecast } from "../../src/application/personalMvp.js";
import type { PerformanceClock } from "../../src/application/performance.js";
import type { EvidenceWorkerRequest, EvidenceWorkerResponse, ForecastWorkerRequest, ForecastWorkerResponse, StandaloneWorkerRequest, StandaloneWorkerResponse } from "./protocol.js";

let source: EvidenceWorkerRequest["source"];
let generatedBasis: import("../../src/simulation/r3/replayArtifact.js").PortableHouseholdReplayArtifact | undefined;

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
    const response = calculate(message, clock);
    if (message.operation === "baseline_forecast" && response.outcome === "result" && "points" in response.result) {
      generatedBasis = (response.result.points[0]?.traceRefs.find(ref => ref.replayArtifact !== undefined)?.replayArtifact as { basis?: typeof generatedBasis } | undefined)?.basis;
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
  try {
    progress?.({ ...boundary, outcome: "progress", phase: "received" });
    if (message.source) {
      const basis = message.source.basis ?? generatedBasis;
      if (!basis) throw new Error("Missing original proof");
      source = { model: message.source.model, basis };
      restorePortableHouseholdReplayArtifact(basis);
    }
    if (!source?.basis || !Number.isSafeInteger(message.startIndex) || message.startIndex < 0 ||
      message.points.length < 1 || message.points.length > (message.operation === "monthly_evidence" ? 1 : 12))
      throw new Error("Selected forecast evidence is unavailable.");
    const original = restorePortableHouseholdReplayArtifact(source.basis);
    if (message.points.some((point, index) => original.periods[message.startIndex + index]?.period.start !== point.periodStart ||
      original.periods[message.startIndex + index]?.period.end !== point.periodEnd)) throw new Error("Mismatched period index");
    progress?.({ ...boundary, outcome: "progress", phase: "restored" });
    // Reattach the one worker-owned immutable proof, preserving every original
    // address and trace identity. The application reader validates both.
    const points = message.points.map(point => ({ ...point, traceRefs: point.traceRefs.map(ref => ({ ...ref,
      ...(ref.replayArtifact === undefined ? {} : { replayArtifact: { ...(ref.replayArtifact as { start: string; end: string }), basis: source!.basis } }),
    })) }));
    const point = points[0];
    if (!point) throw new Error("Selected forecast period is unavailable.");
    if (point.traceRefs.find(ref => ref.replayArtifact !== undefined)?.traceId !== message.fingerprint)
      throw new Error("Selected forecast identity does not match.");
    const result = message.operation === "monthly_evidence"
      ? { detail: inspectMonthlyMoney(point, source.model) }
      : { window: inspectMortgageWindow(points, message.liabilityId) };
    return { ...boundary, outcome: "result", ...result, ...timing() };
  } catch {
    // Portable messages contain no financial facts or raw runtime errors.
    return { ...boundary, outcome: "error", error: "Monthly evidence has missing or mismatched period/source data. Update the forecast and retry.", ...timing() };
  }
}
