import { failValidation } from "../../../../diagnostics/index.js";

let active: Map<string, string> | undefined;

/** Execution is synchronous. The scheduler shares period-local observations
 * of each exact event query across speculative work and final dispatch. */
export function withFixedLoanOriginalObservations<T>(observations: Map<string, string>, execute: () => T): T {
  const previous = active;
  active = observations;
  try {
    return execute();
  } finally {
    active = previous;
  }
}

export function observeFixedLoanOriginal(key: string, digest: string): void {
  if (!active) return;
  const previous = active.get(key);
  if (previous !== undefined && previous !== digest)
    failValidation({ severity: "error", code: "FIXED_LOAN_ORIGINAL_CHANGED", entityType: "fixed_loan_original",
      message: "Fixed loan source changed during the candidate instant" });
  active.set(key, digest);
}
