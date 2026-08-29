import type { DomainId, GeneratedOccurrenceKey } from "./identity.js";
import type { Instant } from "./time.js";
import { failValidation, issueCodes } from "./diagnostics.js";
import { freezeTraceRefs, type CalculationTraceRef } from "./lineage.js";
import { sumMoney, type Money } from "./values.js";
import type { FundingAllocation } from "./funding.js";

declare const semanticIdentityBrand: unique symbol;
type SemanticIdentity<Kind extends string> = string & { readonly [semanticIdentityBrand]: Kind };

export type RecognitionId = SemanticIdentity<"RecognitionId">;
export type ClaimId = SemanticIdentity<"ClaimId">;
export type SettlementProposalId = SemanticIdentity<"SettlementProposalId">;
export type SettlementId = SemanticIdentity<"SettlementId">;
export type SemanticEffectId = SemanticIdentity<"SemanticEffectId">;

const semanticId = <Kind extends string>(kind: Kind, value: string): SemanticIdentity<Kind> => {
  if (value.trim().length === 0) throw new Error(`${kind} cannot be empty`);
  return value as SemanticIdentity<Kind>;
};

export const recognitionId = (value: string): RecognitionId => semanticId("RecognitionId", value);
export const claimId = (value: string): ClaimId => semanticId("ClaimId", value);
export const settlementProposalId = (value: string): SettlementProposalId => semanticId("SettlementProposalId", value);
export const settlementId = (value: string): SettlementId => semanticId("SettlementId", value);
export const semanticEffectId = (value: string): SemanticEffectId => semanticId("SemanticEffectId", value);

export interface RecognitionFact {
  readonly id: RecognitionId;
  readonly category: string;
  readonly amount: Money;
  readonly recognizedAt: Instant;
  readonly sourceOccurrenceKey?: GeneratedOccurrenceKey;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface RecognitionFactDraft extends Omit<RecognitionFact, "traceRefs"> {
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const createRecognitionFact = (
  draft: RecognitionFactDraft,
  existingRecognitionIds: Iterable<string> = [],
): RecognitionFact => {
  if (new Set(existingRecognitionIds).has(draft.id)) {
    failValidation({
      severity: "error",
      code: issueCodes.duplicateRecognition,
      message: `Duplicate recognition ${draft.id}`,
      entityType: "recognition",
      entityId: draft.id,
    });
  }
  if (draft.category.trim().length === 0) throw new Error("Recognition category cannot be empty");
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return Object.freeze({
    id: draft.id,
    category: draft.category,
    amount: draft.amount,
    recognizedAt: draft.recognizedAt,
    ...(draft.sourceOccurrenceKey === undefined ? {} : { sourceOccurrenceKey: draft.sourceOccurrenceKey }),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  });
};

export type ClaimKind = "obligation" | "right";
export type ClaimStatus = "outstanding" | "partially_settled" | "settled";

export interface ClaimBase {
  readonly id: ClaimId;
  readonly kind: ClaimKind;
  readonly category: string;
  readonly originatingRecognitionId: RecognitionId;
  readonly economicOwnerId: DomainId<string>;
  readonly balanceEntityId?: DomainId<string>;
  readonly originalAmount: Money;
  readonly outstandingAmount: Money;
  readonly recognizedAt: Instant;
  readonly dueAt?: Instant;
  readonly settlementIds: readonly SettlementId[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface Obligation extends ClaimBase { readonly kind: "obligation"; }
export interface Right extends ClaimBase { readonly kind: "right"; }
export type ObligationOrRight = Obligation | Right;

export interface ClaimDraft extends Omit<ClaimBase, "outstandingAmount" | "settlementIds" | "traceRefs"> {
  readonly outstandingAmount?: Money;
  readonly settlementIds?: readonly SettlementId[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

const validateClaimAmounts = (draft: ClaimDraft, outstandingAmount: Money): void => {
  if (!draft.originalAmount.isPositive()) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Claim original amount must be positive", entityType: "claim", entityId: draft.id, fieldPath: "originalAmount" });
  }
  if (!draft.originalAmount.currency.equals(outstandingAmount.currency)) {
    failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Claim original and outstanding amounts must use the same currency", entityType: "claim", entityId: draft.id, fieldPath: "outstandingAmount" });
  }
  if (outstandingAmount.isNegative() || outstandingAmount.compare(draft.originalAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Claim outstanding amount must be from zero through the original amount", entityType: "claim", entityId: draft.id, fieldPath: "outstandingAmount" });
  }
};

export const createClaim = (
  draft: ClaimDraft,
  existingClaims: Iterable<ObligationOrRight> = [],
): ObligationOrRight => {
  const existing = [...existingClaims];
  if (existing.some((claim) => claim.id === draft.id || claim.originatingRecognitionId === draft.originatingRecognitionId)) {
    failValidation({
      severity: "error",
      code: issueCodes.duplicateRecognition,
      message: `Recognition ${draft.originatingRecognitionId} already created a claim`,
      entityType: "claim",
      entityId: draft.id,
      relatedIds: [draft.originatingRecognitionId],
    });
  }
  if (draft.category.trim().length === 0) throw new Error("Claim category cannot be empty");
  const outstandingAmount = draft.outstandingAmount ?? draft.originalAmount;
  validateClaimAmounts(draft, outstandingAmount);
  const settlementIds = Object.freeze([...(draft.settlementIds ?? [])]);
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return Object.freeze({
    id: draft.id,
    kind: draft.kind,
    category: draft.category,
    originatingRecognitionId: draft.originatingRecognitionId,
    economicOwnerId: draft.economicOwnerId,
    ...(draft.balanceEntityId === undefined ? {} : { balanceEntityId: draft.balanceEntityId }),
    originalAmount: draft.originalAmount,
    outstandingAmount,
    recognizedAt: draft.recognizedAt,
    ...(draft.dueAt === undefined ? {} : { dueAt: draft.dueAt }),
    settlementIds,
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as ObligationOrRight;
};

export const createObligation = (
  draft: Omit<ClaimDraft, "kind">,
  existingClaims: Iterable<ObligationOrRight> = [],
): Obligation => createClaim({ ...draft, kind: "obligation" }, existingClaims) as Obligation;

export const createRight = (
  draft: Omit<ClaimDraft, "kind">,
  existingClaims: Iterable<ObligationOrRight> = [],
): Right => createClaim({ ...draft, kind: "right" }, existingClaims) as Right;

export const claimStatus = (claim: ObligationOrRight): ClaimStatus => {
  if (claim.outstandingAmount.isZero()) return "settled";
  return claim.outstandingAmount.equals(claim.originalAmount) ? "outstanding" : "partially_settled";
};

export interface SettlementProposal {
  readonly id: SettlementProposalId;
  readonly claimId: ClaimId;
  readonly requestedAmount: Money;
  readonly requestedAt: Instant;
  readonly fundingPolicyId?: import("./funding.js").FundingPolicyId;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const createSettlementProposal = (
  draft: SettlementProposal,
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
  return Object.freeze({
    id: draft.id,
    claimId: draft.claimId,
    requestedAmount: draft.requestedAmount,
    requestedAt: draft.requestedAt,
    ...(draft.fundingPolicyId === undefined ? {} : { fundingPolicyId: draft.fundingPolicyId }),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  });
};

export interface Settlement {
  readonly id: SettlementId;
  readonly proposalId: SettlementProposalId;
  readonly claimId: ClaimId;
  readonly amount: Money;
  readonly settledAt: Instant;
  readonly fundingAllocations: readonly FundingAllocation[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const createSettlement = (
  draft: Settlement,
  proposal: SettlementProposal,
  claim: ObligationOrRight,
  existingSettlementIds: Iterable<string> = [],
): Settlement => {
  if (new Set(existingSettlementIds).has(draft.id) || claim.settlementIds.includes(draft.id)) {
    failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Duplicate settlement ${draft.id}`, entityType: "settlement", entityId: draft.id });
  }
  if (draft.proposalId !== proposal.id || draft.claimId !== proposal.claimId || draft.claimId !== claim.id) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: "Settlement, proposal, and claim identities must match", entityType: "settlement", entityId: draft.id });
  }
  if (!draft.amount.isPositive()) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Settlement amount must be positive", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (!draft.amount.currency.equals(claim.outstandingAmount.currency)) {
    failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Settlement currency must match claim currency", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (draft.amount.compare(proposal.requestedAmount) > 0 || draft.amount.compare(claim.outstandingAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementExceedsOutstanding, message: "Settlement exceeds its proposal or outstanding claim amount", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (draft.settledAt < claim.recognizedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeRecognition, message: "Settlement cannot precede recognition", entityType: "settlement", entityId: draft.id, fieldPath: "settledAt" });
  }
  for (const allocation of draft.fundingAllocations) {
    if (!allocation.amount.isPositive()) {
      failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Settlement funding allocations must be positive", entityType: "settlement", entityId: draft.id, fieldPath: "fundingAllocations.amount" });
    }
    if (!allocation.amount.currency.equals(draft.amount.currency)) {
      failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Settlement funding allocation currency must match settlement currency", entityType: "settlement", entityId: draft.id, fieldPath: "fundingAllocations.amount" });
    }
  }
  if (!sumMoney(draft.fundingAllocations.map((allocation) => allocation.amount), draft.amount.currency).equals(draft.amount)) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Settlement funding allocations must equal the accepted settlement amount", entityType: "settlement", entityId: draft.id, fieldPath: "fundingAllocations" });
  }
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return Object.freeze({
    id: draft.id,
    proposalId: draft.proposalId,
    claimId: draft.claimId,
    amount: draft.amount,
    settledAt: draft.settledAt,
    fundingAllocations: Object.freeze(draft.fundingAllocations.map((allocation) => Object.freeze({ ...allocation }))),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  });
};

export const applySettlement = (claim: ObligationOrRight, settlement: Settlement): ObligationOrRight => {
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

export type SemanticEffectKind = "flow" | "recognition" | "claim" | "settlement" | "valuation" | "state";

export interface SemanticEffect {
  readonly id: SemanticEffectId;
  readonly kind: SemanticEffectKind;
  readonly category: string;
  readonly amount?: Money;
  readonly occurredAt?: Instant;
  readonly recognitionId?: RecognitionId;
  readonly claimId?: ClaimId;
  readonly settlementId?: SettlementId;
  readonly description?: string;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const createSemanticEffect = (draft: SemanticEffect): SemanticEffect => {
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return Object.freeze({ ...draft, ...(traceRefs === undefined ? {} : { traceRefs }) });
};
