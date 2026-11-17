import type { AccountingTransaction, AccountId } from "../../../../accounting/index.js";
import { domainId, type GeneratedOccurrenceKey } from "../../../../identity/index.js";
import type { Obligation, Right, Settlement } from "../../../../semantics/index.js";
import { applyAccountingTransactionAtomically, applyFixedLoanOriginalPosting, type AuthoritativeState, type FixedLoanPostingEvidence } from "../../../../state/index.js";
import type { Period } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import type { RunContext } from "../../../run.js";
import { fixedLoanDebitDenial, qualifyFixedLoanBankDebit } from "./bank.js";
import { qualifyFixedLoanOriginal, rejectFixedLoanOriginal } from "./source.js";

type Original = ReturnType<typeof qualifyFixedLoanOriginal>;
type Posting = { readonly occurrenceId: GeneratedOccurrenceKey } & ({ readonly kind: "interest_recognition" }
  | { readonly kind: "interest_settlement" | "principal_settlement" | "extra_principal"; readonly settlement: Settlement });

export function assertFixedLoanBankAllocation(state: AuthoritativeState, original: Original | undefined,
  allocations: readonly { readonly accountId: AccountId; readonly amount: Money }[]): void {
  if (original === undefined) return;
  const allocation = allocations[0];
  const bank = allocation && state.accounts[allocation.accountId];
  if (allocations.length !== 1 || !allocation || !bank || allocation.accountId !== original.payment.original.bank.accountId ||
      bank.id !== allocation.accountId || bank.ownerId !== original.contract.original.householdId ||
      (bank.kind !== "checking" && bank.kind !== "savings") || !bank.cash.currency.equals(USD) ||
      bank.cash.compare(allocation.amount) < 0)
    rejectFixedLoanOriginal("Required actual funding must use the one household-owned BANK named by the lender");
}

export function postFixedLoanJournal(
  state: AuthoritativeState, transaction: AccountingTransaction, period: Period, run: RunContext,
  original: Original | undefined, claim: Obligation | Right, posting: Posting,
): void {
  if (original === undefined) return applyAccountingTransactionAtomically(state, transaction);
  const contract = original.contract.original, payment = original.payment.original;
  const eventId = posting.kind === "extra_principal" ? `liability-extra:${payment.extra?.instructionId}:${posting.occurrenceId}` :
    `liability-required:${contract.loanId}:${posting.occurrenceId}`;
  const event = { runId: run.runId, scenarioId: run.scenarioId, eventId, eventAt: transaction.date,
    asOf: run.asOf, dataCutoff: run.dataCutoff, householdId: contract.householdId, personId: contract.borrowerId };
  const amount = posting.kind === "interest_recognition" ? claim.originalAmount : posting.settlement.amount;
  const classification = ((): FixedLoanPostingEvidence["classification"] => {
    if (posting.kind === "interest_recognition") return { kind: posting.kind };
    const allocations = transaction.legs.flatMap(leg => leg.type === "cash" && leg.posting === "credit" ?
      [{ accountId: leg.accountId, amount: leg.amount }] : []);
    assertFixedLoanBankAllocation(state, original, allocations);
    try {
      const bank = state.accounts[domainId("account", payment.bank.accountId)]!;
      const { pin, inventoryDigest } = qualifyFixedLoanBankDebit(payment, event, bank.kind, amount, allocations);
      return { kind: posting.kind, settlementId: posting.settlement.id, route: pin, bankInventoryDigest: inventoryDigest };
    } catch (error) {
      if (fixedLoanDebitDenial(error) !== undefined) {
        const reread = qualifyFixedLoanOriginal({ reference: contract.reference, runId: run.runId, scenarioId: run.scenarioId,
          asOf: run.asOf, dataCutoff: run.dataCutoff, eventAt: event.eventAt });
        if (reread.digest !== original.digest) rejectFixedLoanOriginal("Lender original changed during BANK admission");
      }
      throw error;
    }
  })();
  applyFixedLoanOriginalPosting(state, transaction, { version: "fixed-loan-posting/v1",
    context: { ...event, direction: "debit", bankAccountId: domainId("account", payment.bank.accountId) }, period,
    loanId: contract.loanId, occurrenceId: posting.occurrenceId, family: contract.debtFamily, legalOwnerId: contract.legalOwnerId,
    liabilityId: posting.kind === "interest_recognition" || posting.kind === "interest_settlement" ?
      contract.interestPayableLiabilityId : contract.principalLiabilityId,
    claimId: claim.id, recognitionId: claim.originatingRecognitionId, amount, original: contract.reference,
    authorizedTotal: posting.kind === "interest_recognition" ? payment.currentInterest : posting.kind === "interest_settlement" ?
      payment.interestDue : posting.kind === "principal_settlement" ? payment.principalDue : payment.extra?.authorizedAmount ?? Money.zero(USD),
    contractRevisionId: original.contract.revisionId, paymentSourceId: payment.sourceId,
    paymentRevisionId: original.payment.revisionId, inventoryDigest: original.digest, classification });
}
