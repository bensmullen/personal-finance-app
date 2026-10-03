import { DecimalAmount } from "../values/index.js";
import { PERFORMANCE_PHASES, PerformanceRegistry, type PerformanceContext, type PerformanceObserver, type PerformanceResources } from "../diagnostics/performance.js";
export { PERFORMANCE_PHASES, type PerformanceContext, type PerformancePhase, type PerformanceClock, type PerformanceObserver, type PerformanceRecord } from "../diagnostics/performance.js";

export const applicationPerformanceRegistry = new PerformanceRegistry(100);

/** Partial financial execution is never a successful benchmark sample. */
export const requireCompletedPerformanceForecast = <T extends {
  readonly status: string;
  readonly reachedThrough?: string;
  readonly requestedHorizon?: Readonly<{ start: string; end: string }>;
}>(result: T, fixtureId: string): T => {
  if (result.status !== "completed" || result.requestedHorizon === undefined || result.reachedThrough !== result.requestedHorizon.end)
    throw new Error(`${fixtureId} did not complete its requested horizon (${result.status}).`);
  return result;
};

/** Runtime-neutral artifact transformation: retain interpretation, never forecast financial values. */
export const createPerformanceEvidenceSample = (
  registry: PerformanceRegistry,
  outcome: { readonly status: string; readonly requestedHorizon?: Readonly<{ start: string; end: string }>; readonly reachedThrough?: string },
  resources: PerformanceResources,
) => {
  const context = registry.latest("forecast.total")?.context;
  requireCompletedPerformanceForecast(outcome, context?.fixtureId ?? "unavailable");
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
