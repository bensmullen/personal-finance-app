import { DecimalAmount } from "../values/index.js";
import { PERFORMANCE_PHASES, PerformanceRegistry, type PerformanceContext, type PerformanceObserver, type PerformanceResources } from "../diagnostics/performance.js";
export { PERFORMANCE_PHASES, type PerformanceContext, type PerformancePhase, type PerformanceClock, type PerformanceObserver, type PerformanceRecord } from "../diagnostics/performance.js";

export const applicationPerformanceRegistry = new PerformanceRegistry(100);

/** Strict financial completion; capability-gated incomplete results remain rejected. */
export const requireCompletedPerformanceForecast = <T extends {
  readonly status: string;
  readonly reachedThrough?: string;
  readonly requestedHorizon?: Readonly<{ start: string; end: string }>;
}>(result: T, fixtureId: string): T => {
  if (result.status !== "completed" || result.requestedHorizon === undefined || result.reachedThrough !== result.requestedHorizon.end)
    throw new Error(`${fixtureId} did not complete its requested horizon (${result.status}).`);
  return result;
};

/** Proves computational horizon execution for performance evidence only, never financial completeness. */
export const requireFullHorizonPerformanceForecast = <T extends {
  readonly status: string;
  readonly reachedThrough?: string;
  readonly requestedHorizon?: Readonly<{ start: string; end: string }>;
}>(result: T, fixtureId: string): T => {
  if ((result.status !== "completed" && result.status !== "incomplete")
    || result.requestedHorizon === undefined || result.reachedThrough === undefined
    || result.reachedThrough !== result.requestedHorizon.end)
    throw new Error(`${fixtureId} did not execute its full requested horizon (${result.status}).`);
  return result;
};

/** Bounded comparison execution evidence only; omit financial points and configuration values. */
export const createPerformanceComparisonValidation = (
  fixtureId: string,
  comparison: { readonly status: string; readonly executionError?: true; readonly alternatives: readonly {
    readonly name: string; readonly status: string; readonly comparedThrough?: string;
  }[] },
  intents: readonly { readonly scenarioId: string; readonly baseScenarioId?: string; readonly name: string;
    readonly changes: readonly { readonly kind: string }[] }[],
  baselineScenarioId: string | undefined,
  horizon: Readonly<{ start: string; end: string }>,
) => {
  if (baselineScenarioId === undefined || intents.length !== 1 || intents[0]!.changes.length !== 1 || intents[0]!.changes[0]!.kind !== "investment_return"
    || intents[0]!.baseScenarioId !== baselineScenarioId || intents[0]!.scenarioId === baselineScenarioId)
    throw new Error(`${fixtureId} must declare one lower-return comparison intent with distinct scenario identity.`);
  if (comparison.executionError === true || (comparison.status !== "completed" && comparison.status !== "incomplete")
    || comparison.alternatives.length !== intents.length
    || comparison.alternatives.some((alternative, index) => (alternative.status !== "completed" && alternative.status !== "incomplete")
      || alternative.name !== intents[index]!.name || alternative.comparedThrough !== `${horizon.end}T00:00:00.000Z`))
    throw new Error(`${fixtureId} bounded lower-return comparison did not execute its full horizon (${comparison.status}).`);
  return Object.freeze({ fixtureId, applicability: "applicable", status: comparison.status,
    measurement: "not_measured; validation outside baseline timing/resource samples", horizon: Object.freeze({ ...horizon }),
    alternatives: Object.freeze(comparison.alternatives.map((alternative, index) => Object.freeze({
      scenarioId: intents[index]!.scenarioId, changeKinds: Object.freeze(intents[index]!.changes.map((change) => change.kind)),
      status: alternative.status, comparedThrough: alternative.comparedThrough,
    }))),
  });
};

/** Runtime-neutral artifact transformation: retain interpretation, never forecast financial values. */
export const createPerformanceEvidenceSample = (
  registry: PerformanceRegistry,
  outcome: { readonly status: string; readonly requestedHorizon?: Readonly<{ start: string; end: string }>; readonly reachedThrough?: string },
  resources: PerformanceResources,
) => {
  const context = registry.latest("forecast.total")?.context;
  requireFullHorizonPerformanceForecast(outcome, context?.fixtureId ?? "unavailable");
  if (context === undefined) throw new Error("Forecast performance context is unavailable.");
  return Object.freeze({ context, status: outcome.status, requestedHorizon: outcome.requestedHorizon, reachedThrough: outcome.reachedThrough,
    totalMs: registry.latest("forecast.total")?.availability === "measured" ? registry.latest("forecast.total")?.durationMs : undefined,
    phases: Object.freeze(Object.fromEntries(PERFORMANCE_PHASES.map((phase) => [phase, Object.freeze({
      availability: registry.latest(phase)?.availability ?? (phase.startsWith("ui.") || phase === "current_snapshot.total" ? "not_applicable" : "not_measured"),
      summary: registry.summary(phase), records: registry.records(phase),
    })]))),
    resources: Object.freeze({ ...resources }),
  });
};

export const createApplicationPerformanceObserver = (
  clock: PerformanceObserver["clock"],
  context: PerformanceContext,
  sink: PerformanceObserver["sink"] = applicationPerformanceRegistry,
): PerformanceObserver => Object.freeze({ clock, context: Object.freeze({ ...context, modelCounts: Object.freeze({ ...context.modelCounts }) }), sink });

export interface MeteredPricingRate {
  readonly unit: string;
  readonly ratePerUnit: string;
  readonly currency: string;
}
export interface MeteredCost {
  readonly currency: string;
  readonly amount: string;
  readonly units: Readonly<Record<string, string>>;
}

/** Application/runtime-only translation. Exact decimal strings never enter engine semantics. */
export const translateMeteredCost = (
  resources: PerformanceResources,
  pricing: readonly MeteredPricingRate[],
): readonly MeteredCost[] => {
  if (resources.metering !== "metered" || resources.billingUnits === undefined) return Object.freeze([]);
  const totals = new Map<string, DecimalAmount>();
  for (const rate of pricing) {
    const units = resources.billingUnits[rate.unit];
    if (units === undefined) continue;
    const cost = DecimalAmount.parse(units).times(DecimalAmount.parse(rate.ratePerUnit));
    totals.set(rate.currency, (totals.get(rate.currency) ?? DecimalAmount.zero()).plus(cost));
  }
  return Object.freeze([...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => Object.freeze({ currency, amount: amount.toString(), units: Object.freeze({ ...resources.billingUnits }) })));
};
