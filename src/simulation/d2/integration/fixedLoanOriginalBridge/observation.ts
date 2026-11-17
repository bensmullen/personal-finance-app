import { failValidation } from "../../../../diagnostics/index.js";

let active: Map<string, string> | undefined;
let replayCapture: ((key: string, observation: ReplayObservation) => void) | undefined;

interface ReplayObservation {
  readonly owner: "lender" | "bank";
  readonly digest: string;
  readonly readDigest: () => string;
}

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

export function observeFixedLoanOriginal(owner: ReplayObservation["owner"], queryKey: string, digest: string, readDigest: () => string): void {
  const key = `${owner}:${queryKey}`;
  const previous = active?.get(key);
  if (previous !== undefined && previous !== digest)
    changed();
  active?.set(key, digest);
  replayCapture?.(key, { owner, digest, readDigest });
}

function changed(): never {
  return failValidation({ severity: "error", code: "FIXED_LOAN_ORIGINAL_CHANGED", entityType: "fixed_loan_original",
    message: "Fixed loan source changed during execution or since replay admission" });
}

/** Retain one private recheck per exact query reconstructed from the execution
 * basis, including qualified lender reads without postings and BANK denials
 * observed in discarded alternatives. Never take this inventory from the wire. */
export function captureFixedLoanReplayObservations<T>(execute: () => T): { readonly result: T; readonly recheck: () => void } {
  const bank = new Map<string, ReplayObservation>(), lender = new Map<string, ReplayObservation>();
  const previous = replayCapture;
  replayCapture = (key, observation) => {
    const inventory = observation.owner === "bank" ? bank : lender;
    const prior = inventory.get(key);
    if (prior === undefined) inventory.set(key, observation);
    else if (prior.digest !== observation.digest) changed();
  };
  try {
    const result = execute();
    const observations = [...bank.values(), ...lender.values()];
    return { result, recheck: () => {
      for (const { digest, readDigest } of observations)
        if (readDigest() !== digest) changed();
    } };
  } finally {
    replayCapture = previous;
  }
}
