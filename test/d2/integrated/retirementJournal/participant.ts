import { ValidationError } from "../../../../src/diagnostics/index.js";
import type { HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { registerHouseholdParticipantCodec } from "../../../../src/simulation/r3/participantCodec.js";
import { applyRetirementDistributionAtomically } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { distribution, ids } from "./scenario.js";

export const laterDistribution = () => ({ ...distribution(true, "later"), effectiveAt: instant("2026-03-15T00:00:00.000Z") });
/** Synthetic writer client only. Production retirement integration belongs to J2. */
export const participant = (fail = false): HouseholdKernelParticipant => ({
  id: "synthetic_retirement_j1", version: "1", portableCodec: "test-retirement-j1/v1", economicInputs: fail,
  prepare: (context, period) => {
    const d = laterDistribution();
    if (d.effectiveAt < period.start || d.effectiveAt >= period.end) return { id: "synthetic_retirement_j1", operations: [] };
    const post: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number] = {
      descriptor: { id: d.operationId, domain: "synthetic_retirement_j1", operationClass: "synthetic_retirement_j1:distribution",
        sequencingInstant: d.effectiveAt, dependsOn: [], traceRefs: [], resourceAccesses: [
          { kind: "account_cash", accountId: ids.source, mode: "consume" }, { kind: "account_cash", accountId: ids.bank, mode: "produce" },
        ] },
      execute: candidate => {
        const result = applyRetirementDistributionAtomically(candidate.state, d, context);
        if (result.status === "incomplete") throw new ValidationError({ severity: "error", code: "J1_SOURCE_UNAVAILABLE", entityType: "retirement", message: result.reason });
        return { ...candidate, facts: { transactions: [candidate.state.d2PostedTransactions![d.transactionId]!.transaction] } };
      },
    };
    return { id: "synthetic_retirement_j1", operations: fail ? [post, {
      descriptor: { ...post.descriptor, id: "later-failure", sequencingInstant: instant("2026-03-16T00:00:00.000Z"), dependsOn: [d.operationId], resourceAccesses: [] },
      execute: () => { throw new ValidationError({ severity: "error", code: "J1_LATE_PERIOD_FAILURE", entityType: "retirement", message: "Synthetic later period failure" }); },
    }] : [post] };
  },
});
export const registerParticipantCodec = () => registerHouseholdParticipantCodec({ codec: "test-retirement-j1/v1",
  restore: value => {
    if (typeof value !== "boolean") throw new Error("J1_PARTICIPANT_INPUT_INVALID");
    return participant(value);
  },
});
