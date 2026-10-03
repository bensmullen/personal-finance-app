import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { calculationFingerprint, INTERACTIVE_ENGINE_VERSION } from "../../src/application/interactiveForecast.js";
import { createHouseholdForecastRequest, type PersonalHouseholdSessionExecutionConfiguration } from "../../src/application/householdProjection.js";
import { resolvePersonalSessionSettings, type PersonalDraft, type PersonalSessionSettings } from "../../src/application/personalMvp.js";
import { applicationPerformanceRegistry } from "../../src/application/performance.js";
import { ForecastController, type ForecastSubmission, type ForecastView, type ForecastWorkerPort } from "./controller.js";

const makeWorker = (): ForecastWorkerPort => new Worker(new URL("./household.worker.ts", import.meta.url), { type: "module" }) as unknown as ForecastWorkerPort;
const scheduler = {
  set: (callback: () => void, delay: number) => setTimeout(callback, delay),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function useInteractiveForecast(model: PersonalDraft | undefined, configuration: PersonalHouseholdSessionExecutionConfiguration | undefined, settings: PersonalSessionSettings) {
  const [baseline, setBaseline] = useState<ForecastView>({ lifecycle: "idle", pending: false, stale: false });
  const [comparison, setComparison] = useState<ForecastView>({ lifecycle: "idle", pending: false, stale: false });
  const [baselineChannel] = useState(() => new ForecastController(makeWorker, scheduler, setBaseline, (record) => applicationPerformanceRegistry.record(record)));
  const [comparisonChannel] = useState(() => new ForecastController(makeWorker, scheduler, setComparison, (record) => applicationPerformanceRegistry.record(record)));
  const effectiveConfiguration = useMemo(() => configuration === undefined ? undefined : { ...configuration, ...settings }, [configuration, settings]);
  const input = useMemo((): Extract<ForecastSubmission, { operation: "baseline_forecast" }> | undefined => {
    if (!model || !effectiveConfiguration || !resolvePersonalSessionSettings(settings, "cash_flow").request) return undefined;
    try {
      const request = createHouseholdForecastRequest(effectiveConfiguration, crypto.randomUUID());
      const fingerprint = calculationFingerprint("baseline_forecast", model, request);
      return { operation: "baseline_forecast", model, request, fingerprint, performanceContext: {
        runId: request.runIdentity, dataClassification: "user", modelCounts: Object.fromEntries(Object.entries(model.objects).map(([name, values]) => [name, values.length])),
        horizon: { start: effectiveConfiguration.simulationStart, end: effectiveConfiguration.simulationEnd },
        modelVersion: model.modelFormatVersion, specificationVersion: model.financialSpecificationVersion,
        engineVersion: INTERACTIVE_ENGINE_VERSION, executionLocation: "browser_worker", runtime: "browser",
        browser: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent, cacheState: "miss", workerConcurrency: 1,
      } };
    } catch { return undefined; }
  }, [model, effectiveConfiguration]);
  // Only economic changes trigger execution. Navigation, pages and explanations do not.
  useLayoutEffect(() => {
    if (input) baselineChannel.submit(input);
    else baselineChannel.invalidate();
    comparisonChannel.invalidate("Comparison inputs changed. Run a new comparison.");
  }, [input?.fingerprint, baselineChannel, comparisonChannel]);
  useEffect(() => () => { baselineChannel.dispose(); comparisonChannel.dispose(); }, [baselineChannel, comparisonChannel]);

  const compare = (operation: "scenario_comparison" | "major_asset_debt_comparison", economicInputs: unknown) => {
    if (!input) return;
    const request = { ...input.request, runIdentity: crypto.randomUUID() };
    const common = { ...input, request, fingerprint: calculationFingerprint(operation, input.model, request, economicInputs),
      performanceContext: { ...input.performanceContext, runId: request.runIdentity } };
    comparisonChannel.submit(operation === "scenario_comparison"
      ? { ...common, operation, intents: economicInputs as Extract<ForecastSubmission, { operation: "scenario_comparison" }>["intents"] }
      : { ...common, operation, addition: economicInputs as Extract<ForecastSubmission, { operation: "major_asset_debt_comparison" }>["addition"] }, true);
  };
  return { baseline, comparison, effectiveConfiguration, available: input !== undefined,
    recalculate: () => {
      if (input) {
        const runIdentity = crypto.randomUUID();
        baselineChannel.submit({ ...input, request: { ...input.request, runIdentity }, performanceContext: { ...input.performanceContext, runId: runIdentity } }, true);
      } else baselineChannel.invalidate();
    },
    // Retirement comparison can supply its explicitly bound baseline configuration.
    compare: (submission: Exclude<ForecastSubmission, { operation: "baseline_forecast" }>) => comparisonChannel.submit(submission, true),
    compareInputs: compare, input };
}
