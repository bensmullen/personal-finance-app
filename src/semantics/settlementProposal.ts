import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { FundingPolicyId } from "../funding/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type FactProvenance } from "../model/provenance.js";
import type { Instant } from "../time/index.js";
import type { Money } from "../values/index.js";
import type { ObligationOrRight } from "./claim.js";
import type { ClaimId, SettlementProposalId } from "./identity.js";

interface SettlementProposalData {
  readonly id: SettlementProposalId;
  readonly claimId: ClaimId;
  readonly requestedAmount: Money;
  readonly requestedAt: Instant;
  readonly fundingPolicyId?: FundingPolicyId;
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

declare const settlementProposalAuthority: unique symbol;
const authoritativeSettlementProposals = new WeakSet<object>();

export interface SettlementProposalDraft extends SettlementProposalData {}

export type SettlementProposal = Readonly<SettlementProposalData> & {
  readonly [settlementProposalAuthority]: true;
};

export function assertAuthoritativeSettlementProposal(
  proposal: unknown,
): asserts proposal is SettlementProposal {
  if (typeof proposal !== "object" || proposal === null || !authoritativeSettlementProposals.has(proposal)) {
    failValidation({
      severity: "error",
      code: issueCodes.settlementProposalNotAuthoritative,
      message: "Funding requires the exact settlement proposal created by createSettlementProposal",
      entityType: "settlement_proposal",
    });
  }
}

export const createSettlementProposal = (
  draft: SettlementProposalDraft,
  claim: ObligationOrRight,
): SettlementProposal => {
  if (draft.claimId !== claim.id) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: `Settlement proposal ${draft.id} does not reference claim ${claim.id}`, entityType: "settlement_proposal", entityId: draft.id, relatedIds: [draft.claimId, claim.id] });
  }
  if (!draft.requestedAmount.isPositive()) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Settlement proposal amount must be positive", entityType: "settlement_proposal", entityId: draft.id, fieldPath: "requestedAmount" });
  }
  if (!draft.requestedAmount.currency.equals(claim.outstandingAmount.currency)) {
    failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Settlement proposal currency must match claim currency", entityType: "settlement_proposal", entityId: draft.id, fieldPath: "requestedAmount" });
  }
  if (draft.requestedAmount.compare(claim.outstandingAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementExceedsOutstanding, message: "Settlement proposal exceeds outstanding claim amount", entityType: "settlement_proposal", entityId: draft.id, fieldPath: "requestedAmount" });
  }
  if (draft.requestedAt < claim.recognizedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeRecognition, message: "Settlement proposal cannot precede recognition", entityType: "settlement_proposal", entityId: draft.id, fieldPath: "requestedAt" });
  }
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  const proposal = Object.freeze({
    id: draft.id,
    claimId: draft.claimId,
    requestedAmount: draft.requestedAmount,
    requestedAt: draft.requestedAt,
    ...(draft.fundingPolicyId === undefined ? {} : { fundingPolicyId: draft.fundingPolicyId }),
    ...(draft.provenance === undefined ? {} : { provenance: createFactProvenance(draft.provenance) }),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as SettlementProposal;
  authoritativeSettlementProposals.add(proposal);
  return proposal;
};
