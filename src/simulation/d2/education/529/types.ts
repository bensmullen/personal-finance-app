import type { CivilDate } from "../../../../time/index.js";
import type { Currency, Money, RoundingMode } from "../../../../values/index.js";

export interface Span { readonly start: CivilDate; readonly endExclusive: CivilDate }
/** Sources attest facts in this plan/provider/owner/beneficiary context. */
export interface EducationSource extends Span {
  readonly sourceId: string;
  readonly sourcePublication: string;
  readonly publishedAt: CivilDate;
  readonly asOf: CivilDate;
  readonly ruleSnapshotId: string;
  readonly ruleFamily: "education_529";
  readonly jurisdiction: string;
  readonly version: string;
  readonly verification: "verified" | "unverified";
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
  readonly householdId: string;
  readonly ownerId: string;
  readonly beneficiaryId: string;
  readonly planId: string;
  readonly providerId: string;
  readonly currency: Currency;
}
export interface ContributionLot {
  readonly lotId: string;
  readonly basisId: string;
  readonly fundingOperationId: string;
  readonly fundedAt: CivilDate;
  readonly principal: Money;
  readonly source: EducationSource;
}
export interface HistoricalDistribution {
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "qualified_distribution" | "nonqualified_distribution";
  readonly paidExpenseId: string | null;
  readonly effectiveAt: CivilDate;
  readonly gross: Money;
  readonly basisRecovered: Money;
  readonly earnings: Money;
  readonly source: EducationSource;
}
export interface EducationPlan {
  readonly householdId: string;
  readonly ownerId: string;
  readonly beneficiaryId: string;
  readonly planId: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly cashAccountId: string;
  readonly taxBucket: "education_529";
  readonly treatment: "ordinary_original_owner" | "special";
  readonly stateJurisdiction: string;
  readonly localJurisdiction: string;
  readonly source: EducationSource;
  /** Complete since inception; unfunded contributions/proposals are excluded. */
  readonly contributions: readonly ContributionLot[];
  readonly distributions: readonly HistoricalDistribution[];
  readonly snapshot: {
    readonly at: CivilDate;
    readonly taxYear: number | null;
    readonly currentValue: Money | null;
    readonly contributionBasis: Money | null;
    readonly earnings: Money | null;
    readonly unencumberedCash: Money | null;
    readonly history: "complete_since_inception" | "unknown";
    readonly source: EducationSource;
  };
}
export interface EducationRules {
  readonly source: EducationSource;
  readonly expenseCategory: "postsecondary_tuition" | "unsupported";
  readonly qualifiedTreatment: "earnings_excluded" | "unsupported";
  readonly nonqualifiedTreatment: "earnings_income_basis_return" | "unsupported";
  readonly allocation: "current_plan_aggregate_earnings_over_value" | "unsupported";
  readonly earningsRounding: RoundingMode;
  readonly expenseYear: "paid_year_or_direct_payment_event";
}
export interface ExpenseAdjustment {
  readonly allocationId: string;
  readonly kind: "scholarship" | "grant" | "tax_credit" | "other_529" | "other_reimbursement";
  readonly amount: Money;
  readonly source: EducationSource;
}
export interface EducationExpense {
  readonly expenseId: string;
  /** Canonical bill identity across renamed expenses, plans and providers. */
  readonly paidExpenseId: string;
  readonly beneficiaryId: string;
  readonly studentId: string;
  readonly institutionId: string;
  readonly payeeId: string;
  readonly termId: string;
  readonly ownerRelationship: string;
  readonly category: "postsecondary_tuition" | "precollege" | "vocational" | "loan" | "special_education" | "unsupported";
  readonly taxYear: number;
  readonly incurredAt: CivilDate;
  readonly paidAt: CivilDate | null;
  readonly payerId: string;
  readonly payerAccountId: string;
  readonly paymentMethod: "bank_paid" | "direct_plan_payment";
  readonly billed: Money;
  readonly eligibleBilled: Money;
  readonly adjustedEligible: Money;
  readonly adjustments: readonly ExpenseAdjustment[];
  readonly adjustmentsComplete: "verified_complete" | "unknown";
  readonly unreimbursedUse: "verified" | "unknown";
  readonly recognition: { readonly status: "already_recognized" | "unrecognized"; readonly economicExpenseId: string; readonly source: EducationSource };
  /** Required for direct pay: sourced unpaid institution claim, distinct from
   * the distribution claim. Recognition remains a separate economic event. */
  readonly unpaidClaim: { readonly claimId: string; readonly outstanding: Money; readonly source: EducationSource } | null;
  readonly source: EducationSource;
}
export interface ExpenseUsage {
  readonly operationId: string;
  readonly claimId: string;
  readonly planId: string;
  readonly providerId: string;
  readonly paidExpenseId: string;
  readonly beneficiaryId: string;
  readonly taxYear: number;
  readonly amount: Money;
  readonly effectiveAt: CivilDate;
  readonly state: "posted" | "pending_authorized";
  readonly source: EducationSource;
}
export type EducationRoute = {
  readonly kind: "owned_bank";
  readonly accountId: string;
  readonly ownerId: string;
  readonly householdId: string;
  readonly observedAt: CivilDate;
  readonly openingCash: Money;
  readonly source: EducationSource;
} | {
  readonly kind: "institution";
  readonly accountId: string;
  readonly institutionId: string;
  readonly payeeId: string;
  readonly source: EducationSource;
};
export interface EducationRequest {
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "qualified_distribution" | "nonqualified_distribution" | "roth_rollover" | "plan_rollover" | "beneficiary_change" | "contribution";
  readonly effectiveAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly taxYear: number;
  readonly currency: Currency;
  readonly gross: Money;
  readonly plan: EducationPlan;
  readonly rules?: EducationRules;
  readonly qualification: {
    readonly at: CivilDate;
    readonly beneficiaryId: string;
    readonly studentId: string;
    readonly institutionId: string;
    readonly termId: string;
    readonly categoryEligible: "yes" | "no" | "unknown";
    readonly source: EducationSource;
  } | null;
  readonly expense: EducationExpense | null;
  /** Cross-plan/cross-benefit usage excludes adjustments already itemized on
   * the bill. Allocation IDs and operation IDs cannot overlap. */
  readonly usage: { readonly at: CivilDate; readonly complete: "verified_complete" | "unknown"; readonly entries: readonly ExpenseUsage[]; readonly source: EducationSource };
  readonly route: EducationRoute;
  readonly authorization: {
    readonly permitted: "yes" | "no" | "unknown";
    readonly operationId: string;
    readonly claimId: string;
    readonly destinationAccountId: string;
    readonly gross: Money;
    readonly source: EducationSource;
  };
}
export type EducationOutput = "qualification" | "basis_earnings" | "funded_route" | "federal_character" | "penalty" | "state_tax" | "local_tax" | "contribution_deduction" | "settlement";
export interface EducationCoverage {
  readonly sourceEntityPath: string;
  readonly period: Span;
  readonly affectedOutput: EducationOutput;
  readonly coverage: "complete" | "incomplete" | "not_applicable";
  readonly diagnosticCode: string | null;
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface EducationProposal {
  readonly contractVersion: "d2-shared/v1";
  readonly committed: false;
  readonly postable: false;
  readonly instrumentFamily: "education_529";
  readonly status: "conditional_uncommitted";
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "qualified_distribution" | "nonqualified_distribution";
  readonly actorId: string;
  readonly householdId: string;
  readonly beneficiaryId: string;
  readonly planId: string;
  readonly providerId: string;
  readonly sourceAccountId: string;
  readonly planAccountId: string;
  readonly destinationAccountId: string;
  readonly taxBucket: "education_529";
  readonly effectiveAt: CivilDate;
  readonly taxYear: number;
  readonly ruleSnapshotId: string;
  readonly priority: "movement";
  readonly dependsOn: readonly string[];
  readonly grossAmount: Money;
  readonly originalPlanValue: Money;
  readonly originalBasis: Money;
  readonly originalEarnings: Money;
  readonly basisLotIds: readonly { readonly lotId: string; readonly basisId: string }[];
  readonly basisRecovered: Money;
  readonly earnings: Money;
  readonly planAssetDelta: Money;
  readonly ownedBankCashDelta: Money;
  readonly institutionClaimLiabilityDelta: Money;
  readonly institutionPaymentAmount: Money;
  readonly basisDelta: Money;
  readonly movementNetWorthDelta: Money;
  readonly bankReceiptCharacter: "owned_transfer" | "not_applicable";
  readonly expense: {
    readonly paidExpenseId: string;
    readonly economicExpenseId: string;
    readonly recognize: boolean;
    readonly amount: Money;
    readonly institutionClaimId: string | null;
    readonly adjustmentAllocationIds: readonly string[];
  } | null;
  readonly fundingProof: {
    readonly planSnapshot: EducationPlan["snapshot"];
    readonly route: EducationRoute;
    readonly usage: EducationRequest["usage"];
  };
  readonly taxFacts: {
    readonly jurisdiction: string;
    readonly lawVersion: string;
    readonly ruleSnapshotId: string;
    readonly incomeCharacter: "qualified_529_earnings_excluded" | "nonqualified_529_earnings";
    readonly gross: Money;
    readonly taxable: Money;
    readonly basisRecovered: Money;
    readonly completeness: "complete_character_only";
  };
  readonly conditions: readonly string[];
  readonly traceRefs: readonly string[];
  readonly sources: readonly EducationSource[];
}
export interface EducationResult {
  readonly proposals: readonly EducationProposal[];
  readonly coverage: readonly EducationCoverage[];
}
