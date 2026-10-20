import { createAccountingTransaction } from "../../../../src/accounting/index.js";
import type { HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { registerHouseholdParticipantCodec } from "../../../../src/simulation/r3/participantCodec.js";
import { applyD2SettlementAtomically, cloneAuthoritativeState } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { fsa, ids } from "./scenario.js";

/** Fixed independent source fixture, not domain eligibility evaluation and not
 * recovered from portable receipt bytes or posting identities. */
export const laterReceipt = () => {
  const base = fsa("in-horizon-partial", "500");
  return { ...base, effectiveAt: instant("2026-03-15T00:00:00.000Z"),
    originalTransaction: createAccountingTransaction({ ...base.originalTransaction, date: instant("2026-03-10T00:00:00.000Z") }),
    paymentTransaction: createAccountingTransaction({ ...base.paymentTransaction, date: instant("2026-03-15T00:00:00.000Z") }) };
};

export const laterParticipant = (): HouseholdKernelParticipant => ({
  id: "synthetic_shared_receipt", version: "1", portableCodec: "test-shared-receipt/v1",
  economicInputs: "independently-fixed-march-fixture",
  prepare: (context, period) => {
    const receipt = laterReceipt();
    return { id: "synthetic_shared_receipt", operations: receipt.effectiveAt < period.start || receipt.effectiveAt >= period.end ? [] : [{
      descriptor: { id: receipt.operationId, domain: "synthetic_shared_receipt", operationClass: "synthetic_shared_receipt:allocation",
        sequencingInstant: receipt.effectiveAt, dependsOn: [], traceRefs: [],
        resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }] },
      execute: opening => {
        const state = cloneAuthoritativeState(opening.state);
        const result = applyD2SettlementAtomically(state, receipt, context);
        if (result.status === "incomplete") throw new Error(`SYNTHETIC_SOURCE_INCOMPLETE: ${result.reason}`);
        return { ...opening, state, facts: { transactions: result.status === "already_committed" ? []
          : [receipt.originalTransaction, receipt.paymentTransaction] } };
      },
    }] };
  },
});

export const registerLaterParticipantCodec = () => registerHouseholdParticipantCodec({
  codec: "test-shared-receipt/v1",
  restore: inputs => {
    if (inputs !== "independently-fixed-march-fixture") throw new Error("SYNTHETIC_SOURCE_INPUT_MISMATCH");
    return laterParticipant();
  },
});
