import { DecimalAmount } from "../values/index.js";
import { PerformanceRegistry, type PerformanceContext, type PerformanceObserver, type PerformanceResources } from "../diagnostics/performance.js";
export { PERFORMANCE_PHASES, type PerformanceContext, type PerformancePhase } from "../diagnostics/performance.js";

export const applicationPerformanceRegistry = new PerformanceRegistry(100);

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
