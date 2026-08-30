import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { DomainId } from "../identity/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import type { Money } from "../values/index.js";
import type { ClaimId, RecognitionId, SettlementId } from "./identity.js";

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

export const assertClaimInvariant = (claim: ObligationOrRight): void => {
  const structural = claim as { readonly id?: string; readonly kind?: unknown };
  if (structural.kind !== "obligation" && structural.kind !== "right") {
    failValidation({ severity: "error", code: issueCodes.claimInvariantInvalid, message: "Claim kind must be obligation or right", entityType: "claim", ...(structural.id === undefined ? {} : { entityId: structural.id }), fieldPath: "kind" });
  }
  if (typeof claim.category !== "string" || claim.category.trim().length === 0) {
    failValidation({ severity: "error", code: issueCodes.claimInvariantInvalid, message: "Claim category cannot be empty", entityType: "claim", entityId: claim.id, fieldPath: "category" });
  }
  if (!claim.originalAmount.isPositive()) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Claim original amount must be positive", entityType: "claim", entityId: claim.id, fieldPath: "originalAmount" });
  }
  if (!claim.originalAmount.currency.equals(claim.outstandingAmount.currency)) {
    failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Claim original and outstanding amounts must use the same currency", entityType: "claim", entityId: claim.id, fieldPath: "outstandingAmount" });
  }
  if (claim.outstandingAmount.isNegative() || claim.outstandingAmount.compare(claim.originalAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Claim outstanding amount must be from zero through the original amount", entityType: "claim", entityId: claim.id, fieldPath: "outstandingAmount" });
  }
  if (new Set(claim.settlementIds).size !== claim.settlementIds.length) {
    failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Claim ${claim.id} contains a duplicate settlement identity`, entityType: "claim", entityId: claim.id, fieldPath: "settlementIds" });
  }
};

export const normalizeClaimLifecycle = (claim: ObligationOrRight): ObligationOrRight => {
  assertClaimInvariant(claim);
  const { settlementIds, traceRefs: suppliedTraceRefs, ...rest } = claim;
  const traceRefs = freezeTraceRefs(suppliedTraceRefs);
  return Object.freeze({
    ...rest,
    settlementIds: Object.freeze([...settlementIds]),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as ObligationOrRight;
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
  const outstandingAmount = draft.outstandingAmount ?? draft.originalAmount;
  const settlementIds = Object.freeze([...(draft.settlementIds ?? [])]);
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return normalizeClaimLifecycle({
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
  } as ObligationOrRight);
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
