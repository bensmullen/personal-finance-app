import type { CivilDate } from "../../../../../time/index.js";
import type { Currency, Money, RoundingMode } from "../../../../../values/index.js";
import type { EducationPlan, EducationSource, Span } from "../types.js";
import type { RothTransferRequest } from "../rothTransfer/types.js";

export interface PlanIdentity {
  readonly householdId: string; readonly ownerId: string; readonly beneficiaryId: string;
  readonly planId: string; readonly providerId: string; readonly accountId: string;
  readonly cashAccountId: string; readonly taxBucket: "education_529";
}
export interface TrusteeAcceptance {
  readonly transferId: string; readonly operationId: string; readonly claimId: string;
  readonly sourceAccountId: string; readonly destinationAccountId: string;
  readonly originatingTrusteeId: string; readonly receivingTrusteeId: string;
  readonly sourceVersion: string; readonly amount: Money;
  readonly status: "confirmed" | "revoked" | "unknown";
  readonly source: EducationSource;
}
export interface PlanClaim extends PlanIdentity {
  readonly operationId: string; readonly claimId: string; readonly transferId: string;
  readonly kind: "distribution" | "plan_transfer" | "roth_transfer";
  readonly state: "posted" | "pending_authorized";
  readonly effectiveAt: CivilDate; readonly amount: Money; readonly basis: Money; readonly earnings: Money;
  readonly destinationAccountId: string; readonly source: EducationSource;
}
export interface PlanTransferRequest {
  readonly operationId: string; readonly claimId: string; readonly transferId: string;
  readonly kind: "529_plan_to_plan" | "529_plan_to_plan_beneficiary_change";
  readonly effectiveAt: CivilDate; readonly knownAt: CivilDate; readonly taxYear: number;
  readonly currency: Currency; readonly amount: Money;
  readonly plan: EducationPlan;
  readonly history: RothTransferRequest["history"];
  readonly holdings: RothTransferRequest["holdings"] & {
    /** Current lots must already be transferable cash; no implicit sale. */
    readonly form: "cash_at_par" | "invested_or_inaccessible";
  };
  readonly destination: PlanIdentity & {
    readonly stateJurisdiction: string; readonly localJurisdiction: string;
    readonly route: "direct_trustee" | "bank"; readonly eligible: "yes" | "unknown";
    readonly source: EducationSource;
  };
  readonly originatingAcceptance: TrusteeAcceptance;
  readonly receivingAcceptance: TrusteeAcceptance;
  readonly rules?: {
    readonly source: EducationSource;
    readonly treatment: "ordinary_direct_529_continuation" | "unsupported";
    readonly eligibleMaximum: Money; readonly electionWindow: Span;
    readonly sameYearEligibility: "verified" | "unknown";
    readonly planAgeContinuity: "verified_preserved" | "unknown";
    readonly rothEligibilityContinuity: "verified_preserved" | "unknown";
    /** Each lot's basis and earnings multiplied by amount/value, rounded once each.
     * If the cents do not sum to the request, an authoritative residual method is required. */
    readonly allocation: "whole_plan" | "per_lot_proportional" | "unsupported";
    readonly rounding: RoundingMode;
  };
  readonly beneficiaryChange: null | {
    readonly changeId: string; readonly fromBeneficiaryId: string; readonly toBeneficiaryId: string;
    readonly legalPermission: "yes" | "unknown"; readonly planPermission: "yes" | "unknown";
    readonly source: EducationSource; readonly planSource: EducationSource;
  };
  readonly jurisdictionPermissions: readonly {
    readonly side: "original" | "receiving"; readonly level: "state" | "local";
    readonly permitted: "yes" | "no" | "unknown"; readonly source: EducationSource;
  }[];
  readonly claims: {
    readonly at: CivilDate; readonly complete: "all_household_plan_claims_including_pending" | "unknown";
    readonly entries: readonly PlanClaim[]; readonly source: EducationSource;
  };
  readonly rothUsage: RothTransferRequest["usage"];
}
export interface TransferredLot {
  readonly lotId: string; readonly basisId: string; readonly fundingOperationId: string;
  readonly fundedAt: CivilDate; readonly originalPrincipal: Money;
  readonly originalBasis: Money; readonly originalEarnings: Money;
  readonly transferredBasis: Money; readonly transferredEarnings: Money;
  readonly remainingBasis: Money; readonly remainingEarnings: Money;
}
export type PlanTransferOutput = "eligibility" | "basis_earnings" | "continuity" | "funding" | "claim_registry" | "ira_capacity" | "federal_tax" | "state_tax" | "local_tax" | "settlement";
export interface PlanTransferCoverage {
  readonly operationId: string; readonly sourceEntityPath: string; readonly period: Span;
  readonly affectedOutput: PlanTransferOutput; readonly coverage: "complete" | "incomplete";
  readonly diagnosticCode: string | null; readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null; readonly traceRefs: readonly string[];
}
export interface PlanTransferProposal {
  readonly contractVersion: "d2-shared/v1"; readonly committed: false; readonly postable: false;
  readonly physicalTransfer: "not_applied"; readonly status: "conditional_uncommitted";
  readonly kind: PlanTransferRequest["kind"]; readonly operationId: string; readonly claimId: string;
  readonly transferId: string; readonly transferKey: string;
  readonly instrumentFamily: "education_529"; readonly taxBucket: "education_529";
  readonly actorId: string; readonly priority: "movement"; readonly dependsOn: readonly string[];
  readonly effectiveAt: CivilDate; readonly taxYear: number; readonly ruleSnapshotId: string;
  readonly sourcePlan: PlanIdentity; readonly destinationPlan: PlanIdentity;
  readonly sourceAccountId: string; readonly destinationAccountId: string;
  readonly grossAmount: Money; readonly basis: Money; readonly earnings: Money;
  /** One wrapped economic asset per side; these are not additional cash postings. */
  readonly sourcePlanAssetDelta: Money; readonly destinationPlanAssetDelta: Money;
  readonly remainingSourceValue: Money; readonly remainingSourceBasis: Money; readonly remainingSourceEarnings: Money;
  readonly ownedBankCashDelta: Money; readonly consumptionExpenseDelta: Money; readonly movementNetWorthDelta: Money;
  readonly lots: readonly TransferredLot[];
  readonly preservedHistory: PlanTransferRequest["history"];
  readonly beneficiaryChange: PlanTransferRequest["beneficiaryChange"];
  readonly preservedRothUsage: PlanTransferRequest["rothUsage"];
  readonly legalProof: { readonly rules: NonNullable<PlanTransferRequest["rules"]>;
    readonly jurisdictionPermissions: PlanTransferRequest["jurisdictionPermissions"] };
  readonly fundingProof: { readonly snapshot: EducationPlan["snapshot"];
    readonly holdings: PlanTransferRequest["holdings"]; readonly claims: PlanTransferRequest["claims"];
    readonly originatingAcceptance: TrusteeAcceptance; readonly receivingAcceptance: TrusteeAcceptance };
  readonly traceRefs: readonly string[]; readonly sources: readonly EducationSource[];
}
export interface PlanTransferResult {
  readonly proposals: readonly PlanTransferProposal[];
  readonly coverage: readonly PlanTransferCoverage[];
}
