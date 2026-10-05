import type { TaxOutputCapabilities } from "../tax/contracts.js";
import { canonicalSerialize } from "../run.js";
/** Missing dependency support taints the field even when other contributors are complete. */
export const mergeOutputCapabilities = (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined => {
  const result: Record<string, TaxOutputCapabilities[string]> = {};
  for (const input of inputs) for (const [field, value] of Object.entries(input ?? {})) {
    const prior = result[field];
    result[field] = Object.freeze({ dependency: prior?.dependency === "tax_affected" || value.dependency === "tax_affected" ? "tax_affected" : "tax_independent",
      status: prior?.status === "incomplete" || value.status === "incomplete" ? "incomplete" : "complete", diagnostics: Object.freeze([...new Map([...(prior?.diagnostics ?? []), ...value.diagnostics].map(diagnostic => [canonicalSerialize(diagnostic), diagnostic])).values()]) });
  }
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
};
