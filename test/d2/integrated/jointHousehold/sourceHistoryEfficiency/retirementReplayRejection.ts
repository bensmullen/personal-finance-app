import { ValidationError } from "../../../../../src/diagnostics/index.js";

export function expectRetirementReplayRejection(attempt: () => unknown): true {
  try {
    attempt();
  } catch (error) {
    const cause = error instanceof Error && error.message.startsWith("HOUSEHOLD_REPLAY_BASIS_MISMATCH:")
      ? error.cause : error;
    if (cause instanceof ValidationError && cause.issues.length === 1 &&
        cause.issues[0]?.code === "D2_SETTLEMENT_RECEIPT_INVALID" &&
        cause.issues[0]?.message === "Retirement original unavailable at outward observation") return true;
    throw error;
  }
  throw new Error("Portable replay admitted an unavailable retirement original");
}
