import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { AcceptedFundingResolution, FundingAllocation } from "../funding/index.js";
import { assertAcceptedFundingResolution } from "../funding/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type FactProvenance } from "../model/provenance.js";
import type { Instant } from "../time/index.js";
import type { Money } from "../values/index.js";
import type { ObligationOrRight } from "./claim.js";
import type { ClaimId, SettlementId, SettlementProposalId } from "./identity.js";

interface SettlementData {
  readonly id: SettlementId;
  readonly proposalId: SettlementProposalId;
  readonly claimId: ClaimId;
  readonly amount: Money;
  readonly settledAt: Instant;
  readonly fundingAllocations: readonly FundingAllocation[];
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

declare const settlementAuthority: unique symbol;
const authoritativeSettlements = new WeakSet<object>();

export interface SettlementDraft {
  readonly id: SettlementId;
  readonly settledAt: Instant;
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export type Settlement = Readonly<SettlementData> & {
  readonly [settlementAuthority]: true;
};

export const createSettlement = (
  draft: SettlementDraft,
  acceptedFunding: AcceptedFundingResolution,
  claim: ObligationOrRight,
  existingSettlementIds: Iterable<string> = [],
): Settlement => {
  assertAcceptedFundingResolution(acceptedFunding);
  const proposal = acceptedFunding.proposal;
  const amount = acceptedFunding.acceptedAmount;
  const fundingAllocations = acceptedFunding.fundingAllocations;
  if (new Set(existingSettlementIds).has(draft.id) || claim.settlementIds.includes(draft.id)) {
    failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Duplicate settlement ${draft.id}`, entityType: "settlement", entityId: draft.id });
  }
  if (proposal.claimId !== claim.id) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: "Funding proposal and claim identities must match", entityType: "settlement", entityId: draft.id });
  }
  if (!amount.isPositive()) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Settlement amount must be positive", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (!amount.currency.equals(claim.outstandingAmount.currency)) {
    failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Settlement currency must match claim currency", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (amount.compare(proposal.requestedAmount) > 0 || amount.compare(claim.outstandingAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementExceedsOutstanding, message: "Settlement exceeds its proposal or outstanding claim amount", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (draft.settledAt < claim.recognizedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeRecognition, message: "Settlement cannot precede recognition", entityType: "settlement", entityId: draft.id, fieldPath: "settledAt" });
  }
  if (draft.settledAt < proposal.requestedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeProposal, message: "Settlement cannot precede its proposal", entityType: "settlement", entityId: draft.id, fieldPath: "settledAt" });
  }
  if (draft.settledAt < acceptedFunding.outcome.evaluatedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeFunding, message: "Settlement cannot precede its funding evaluation", entityType: "settlement", entityId: draft.id, fieldPath: "settledAt" });
  }
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  const settlement = Object.freeze({
    id: draft.id,
    proposalId: proposal.id,
    claimId: proposal.claimId,
    amount,
    settledAt: draft.settledAt,
    fundingAllocations: Object.freeze(fundingAllocations.map((allocation) => Object.freeze({ ...allocation }))),
    ...(draft.provenance === undefined ? {} : { provenance: createFactProvenance(draft.provenance) }),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as Settlement;
  authoritativeSettlements.add(settlement);
  return settlement;
};

export const applySettlement = (claim: ObligationOrRight, settlement: Settlement): ObligationOrRight => {
  if (!authoritativeSettlements.has(settlement)) {
    failValidation({ severity: "error", code: issueCodes.settlementNotAuthoritative, message: "Only the exact settlement created by createSettlement may be applied", entityType: "settlement" });
  }
  if (settlement.claimId !== claim.id) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: `Settlement ${settlement.id} does not apply to claim ${claim.id}`, entityType: "settlement", entityId: settlement.id });
  }
  if (claim.settlementIds.includes(settlement.id)) {
    failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Duplicate settlement ${settlement.id}`, entityType: "settlement", entityId: settlement.id });
  }
  if (settlement.amount.compare(claim.outstandingAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementExceedsOutstanding, message: "Settlement exceeds outstanding claim amount", entityType: "settlement", entityId: settlement.id });
  }
  return Object.freeze({
    ...claim,
    outstandingAmount: claim.outstandingAmount.minus(settlement.amount),
    settlementIds: Object.freeze([...claim.settlementIds, settlement.id]),
  });
};
