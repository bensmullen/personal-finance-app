import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import type { EvidenceSelection, EvidenceWorkerResponse } from "./protocol.js";
import { calculationFingerprint, INTERACTIVE_ENGINE_VERSION } from "../../src/application/interactiveForecast.js";
import { createHouseholdForecastRequest, type PersonalHouseholdSessionExecutionConfiguration } from "../../src/application/householdProjection.js";
import { resolvePersonalSessionSettings, type PersonalDraft, type PersonalSessionSettings } from "../../src/application/personalMvp.js";
import { simulationWindowProblem } from "../../src/application/forecastSetup.js";
import { applicationPerformanceRegistry } from "../../src/application/performance.js";
import { claimForecastEvidenceWorker, forecastEvidenceController, ForecastController, StandaloneController, type StandaloneView, type StandaloneWorkerPort, type EvidenceWorkerPort, type ForecastSubmission, type ForecastView, type ForecastWorkerPort } from "./controller.js";

const makeWorker = (): ForecastWorkerPort => new Worker(new URL("./household.worker.ts", import.meta.url), { type: "module" }) as unknown as ForecastWorkerPort;
const scheduler = {
  set: (callback: () => void, delay: number) => setTimeout(callback, delay),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function useStandaloneForecast() {
  const [view, setView] = useState<StandaloneView>({ pending: false, stale: false });
  const [controller] = useState(() => new StandaloneController(() => new Worker(new URL("./household.worker.ts", import.meta.url), { type: "module" }) as unknown as StandaloneWorkerPort, setView));
  useEffect(() => () => controller.dispose(), [controller]);
  return { view, controller };
}

/** Panels only subscribe. The baseline controller releases their shared worker
 * on source replacement, invalidation or disposal, rather than on navigation. */
export function useForecastEvidence(forecast: PersonalHouseholdForecastReadModel | undefined, model: PersonalDraft, current: boolean, selection: EvidenceSelection) {
  // Resolve ownership on every render: an immediate baseline cache hit can
  // replace its disposed controller while retaining the exact result object.
  const scope = current && forecast && forecast.status !== "unavailable" && forecast.points.length
    ? forecastEvidenceController(forecast, model, () => claimForecastEvidenceWorker(forecast) ?? new Worker(new URL("./household.worker.ts", import.meta.url), { type: "module" }) as unknown as EvidenceWorkerPort)
    : undefined;
  const [revision, setRevision] = useState(0);
  const [settled, setSettled] = useState<{ scope: typeof scope; key: string; response: EvidenceWorkerResponse }>();
  const { operation, startIndex, liabilityId } = selection;
  const key = `${operation}:${startIndex}:${liabilityId}:${revision}`;
  useEffect(() => {
    if (!scope) return;
    return scope.select({ operation, startIndex, liabilityId }, response => {
      setSettled({ scope, key, response });
    }, revision > 0);
  }, [scope, key, operation, startIndex, liabilityId, revision]);
  const response = current && scope && settled && settled.scope === scope && settled.key === key ? settled.response : undefined;
  useEffect(() => {
    if (response?.outcome === "result") scope?.rendered(response.requestId);
  }, [scope, response]);
  return {
    detail: response?.outcome === "result" ? response.detail : undefined,
    window: response?.outcome === "result" ? response.window : undefined,
    error: response?.outcome === "error" ? response.error : undefined,
    refresh: () => setRevision(value => value + 1),
    diagnostics: scope?.diagnostics ?? [],
  };
}

export function useInteractiveForecast(model: PersonalDraft | undefined, configuration: PersonalHouseholdSessionExecutionConfiguration | undefined, settings: PersonalSessionSettings, replacementIdentity = 0) {
  const [baseline, setBaseline] = useState<ForecastView>({ lifecycle: "idle", pending: false, stale: false });
  const [comparison, setComparison] = useState<ForecastView>({ lifecycle: "idle", pending: false, stale: false });
  const [baselineChannel] = useState(() => new ForecastController(makeWorker, scheduler, setBaseline, (record) => applicationPerformanceRegistry.record(record)));
  const [comparisonChannel] = useState(() => new ForecastController(makeWorker, scheduler, setComparison, (record) => applicationPerformanceRegistry.record(record)));
  const effectiveConfiguration = useMemo(() => configuration === undefined ? undefined : { ...configuration, ...settings }, [configuration, settings]);
  const input = useMemo((): Extract<ForecastSubmission, { operation: "baseline_forecast" }> | undefined => {
    if (!model || !effectiveConfiguration || !resolvePersonalSessionSettings(settings, "cash_flow").request || simulationWindowProblem(model, settings.simulationStart, settings.simulationEnd)) return undefined;
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
    baselineChannel.reset();
    comparisonChannel.reset();
  }, [replacementIdentity, baselineChannel, comparisonChannel]);
  useLayoutEffect(() => {
    if (input) baselineChannel.submit(input);
    else baselineChannel.invalidate("Complete forecast setup to run this household.");
    comparisonChannel.invalidate("Comparison inputs changed. Run a new comparison.");
  }, [input?.fingerprint, replacementIdentity, baselineChannel, comparisonChannel]);
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
