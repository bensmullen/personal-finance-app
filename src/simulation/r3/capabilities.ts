import type { TaxOutputCapabilities } from "../tax/contracts.js";
import { createTaxDiagnosticKey } from "../tax/contracts.js";
import { immutableConfiguration } from "./compiledHousehold.js";

type Capability = TaxOutputCapabilities[string];

/**
 * Merge exactly as before (first appearance orders keys; last value wins), but preserve
 * one immutable value/diagnostic array for fields sharing the same inputs.
 * Payroll and annual-tax projections often expose the same diagnostic set
 * across dozens of affected outputs; separately serializing and allocating
 * that set for every field on every month exhausts long-horizon forecasts.
 *
 * Caches are local to this calculation. No cross-run mutable identity or capability
 * state is retained; published results remain frozen and structurally equal.
 */
export const createOutputCapabilityMerger = () => {
  const initial = new WeakMap<Capability, Capability>();
  const combined = new WeakMap<Capability, WeakMap<Capability, Capability>>();
  const diagnosticKey = createTaxDiagnosticKey();
  const keys = new WeakMap<Capability["diagnostics"][number], string>();
  const key = (diagnostic: Capability["diagnostics"][number]) => {
    let value = keys.get(diagnostic);
    if (value === undefined) { value = diagnosticKey(diagnostic); keys.set(diagnostic, value); }
    return value;
  };
  const unique = (diagnostics: readonly Capability["diagnostics"][number][]): Capability["diagnostics"] =>
    Object.freeze([...new Map(diagnostics.map(diagnostic => [key(diagnostic), diagnostic])).values()]);
  return (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined => {
    const result: Record<string, Capability> = {};
    const snapshots = new WeakMap<Capability, Capability>();
    for (const input of inputs) for (const [field, source] of Object.entries(input ?? {})) {
      // Cache only snapshots from the immutable boundary, never mutable callers.
      let value = snapshots.get(source);
      if (value === undefined) { value = immutableConfiguration(source); snapshots.set(source, value); }
      const prior = result[field];
      if (prior === undefined) {
        let normalized = initial.get(value);
        if (normalized === undefined) {
          normalized = immutableConfiguration<Capability>({ dependency: value.dependency, status: value.status, diagnostics: unique(value.diagnostics) });
          initial.set(value, normalized);
          initial.set(normalized, normalized);
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
          merged = immutableConfiguration<Capability>({
            dependency: prior.dependency === "tax_affected" || value.dependency === "tax_affected" ? "tax_affected" : "tax_independent",
            status: prior.status === "incomplete" || value.status === "incomplete" ? "incomplete" : "complete",
            diagnostics: unique([...prior.diagnostics, ...value.diagnostics]),
          });
          nextForPrior.set(value, merged);
          initial.set(merged, merged);
        }
        result[field] = merged;
      }
    }
    return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
  };
};

export const mergeOutputCapabilities = (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined =>
  createOutputCapabilityMerger()(inputs);
