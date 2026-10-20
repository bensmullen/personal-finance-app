import { createAccountingTransaction } from "../../../../src/accounting/index.js";
import { ValidationError } from "../../../../src/diagnostics/index.js";
import type { HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { registerHouseholdParticipantCodec } from "../../../../src/simulation/r3/participantCodec.js";
import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, d2SettlementPostingRegistration } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { card, fsa, ids } from "./scenario.js";

/** Fixed independent source fixture, not domain eligibility evaluation and not
 * recovered from portable receipt bytes or posting identities. */
export const laterReceipt = (kind: "fsa" | "card" = "fsa") => {
  const base = kind === "fsa" ? fsa("in-horizon-partial", "500") : card("in-horizon-card");
  return { ...base, effectiveAt: instant("2026-03-15T00:00:00.000Z"),
    originalTransaction: createAccountingTransaction({ ...base.originalTransaction, date: instant("2026-02-10T00:00:00.000Z") }),
    paymentTransaction: createAccountingTransaction({ ...base.paymentTransaction, date: instant("2026-03-15T00:00:00.000Z") }) };
};

export const laterParticipant = (kind: "fsa" | "card" = "fsa"): HouseholdKernelParticipant => ({
  id: "synthetic_shared_receipt", version: "1", portableCodec: "test-shared-receipt/v1",
  economicInputs: kind,
  prepare: (context, period) => {
    const receipt = laterReceipt(kind);
    const originalAt = receipt.originalTransaction.date;
    const original = originalAt >= period.start && originalAt < period.end;
    const payment = receipt.effectiveAt >= period.start && receipt.effectiveAt < period.end;
    return { id: "synthetic_shared_receipt", operations: !original && !payment ? [] : [{
      descriptor: { id: receipt.operationId, domain: "synthetic_shared_receipt", operationClass: "synthetic_shared_receipt:allocation",
        sequencingInstant: original ? originalAt : receipt.effectiveAt, dependsOn: [], traceRefs: [],
        resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }] },
      execute: opening => {
        // Deliberately exercise the kernel's period candidate boundary directly.
        const state = opening.state;
        if (original) {
          applyAccountingTransactionAtomically(state, receipt.originalTransaction, d2SettlementPostingRegistration(receipt, "original"));
          return { ...opening, state, facts: { transactions: [receipt.originalTransaction] } };
        }
        const result = applyD2SettlementAtomically(state, receipt, context);
        if (result.status === "incomplete") throw new ValidationError({ severity: "error", code: "SYNTHETIC_SOURCE_INCOMPLETE",
          message: result.reason, entityType: "synthetic_shared_receipt" });
        return { ...opening, state, facts: { transactions: result.status === "already_committed" ? []
          : [receipt.paymentTransaction] } };
      },
    }] };
  },
});

export const registerLaterParticipantCodec = () => registerHouseholdParticipantCodec({
  codec: "test-shared-receipt/v1",
  restore: inputs => {
    if (inputs !== "fsa" && inputs !== "card") throw new Error("SYNTHETIC_SOURCE_INPUT_MISMATCH");
    return laterParticipant(inputs);
  },
});
