import { runPersonalHouseholdForecast, comparePersonalHouseholdScenarioIntents, comparePersonalHouseholdMajorAssetDebtAddition } from "../../src/application/householdProjection.js";
import { createApplicationPerformanceObserver } from "../../src/application/performance.js";
import type { PerformanceClock, PerformanceObserver, PerformanceRecord } from "../../src/diagnostics/performance.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse } from "./protocol.js";

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
    return { ...boundary, outcome: "result", result, records };
  } catch {
    // Runtime error text is deliberately portable and contains no personal data.
    return { ...boundary, outcome: "error", error: { code: "EXECUTION_ERROR", message: "Unexpected household execution error." }, records };
  }
};
