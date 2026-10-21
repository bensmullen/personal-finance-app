import type { TaxOutputCapabilities } from "../tax/contracts.js";
import { canonicalSerialize } from "../run.js";

type Capability = TaxOutputCapabilities[string];

/**
 * Merge exactly as before (first diagnostic occurrence wins), but preserve
 * one immutable value/diagnostic array for fields sharing the same inputs.
 * Payroll and annual-tax projections often expose the same diagnostic set
 * across dozens of affected outputs; separately serializing and allocating
 * that set for every field on every month exhausts long-horizon forecasts.
 *
 * Caches are local to this merge. No cross-run mutable identity or capability
 * state is retained; published results remain frozen and structurally equal.
 */
export const mergeOutputCapabilities = (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined => {
  const result: Record<string, Capability> = {};
  const initial = new WeakMap<Capability, Capability>();
  const combined = new WeakMap<Capability, WeakMap<Capability, Capability>>();
  const unique = (diagnostics: readonly Capability["diagnostics"][number][]): Capability["diagnostics"] =>
    Object.freeze([...new Map(diagnostics.map(diagnostic => [canonicalSerialize(diagnostic), diagnostic])).values()]);
  for (const input of inputs) for (const [field, value] of Object.entries(input ?? {})) {
    const prior = result[field];
    if (prior === undefined) {
      let normalized = initial.get(value);
      if (normalized === undefined) {
        normalized = Object.freeze({ dependency: value.dependency, status: value.status, diagnostics: unique(value.diagnostics) });
        initial.set(value, normalized);
      }
      result[field] = normalized;
    } else {
      let nextForPrior = combined.get(prior);
      if (nextForPrior === undefined) {
        nextForPrior = new WeakMap<Capability, Capability>();
        combined.set(prior, nextForPrior);
      }
      let merged = nextForPrior.get(value);
      if (merged === undefined) {
        merged = Object.freeze({
          dependency: prior.dependency === "tax_affected" || value.dependency === "tax_affected" ? "tax_affected" : "tax_independent",
          status: prior.status === "incomplete" || value.status === "incomplete" ? "incomplete" : "complete",
          diagnostics: unique([...prior.diagnostics, ...value.diagnostics]),
        });
        nextForPrior.set(value, merged);
      }
      result[field] = merged;
    }
  }
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
};
