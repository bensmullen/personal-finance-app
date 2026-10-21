import type { CivilDate } from "../../../../../time/index.js";
import type { Money, Currency } from "../../../../../values/index.js";
import type { EducationPlan, EducationSource, Span } from "../types.js";

/** Private S1–S8 input. All law/thresholds come from the verified source owner. */
export interface RothTransferRequest {
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "529_beneficiary_roth_direct_trustee_transfer";
  readonly effectiveAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly taxYear: number;
  readonly currency: Currency;
  readonly amount: Money;
  readonly plan: EducationPlan;
  readonly history: {
    readonly openedAt: CivilDate; readonly beneficiarySince: CivilDate; readonly ageStart: CivilDate;
    readonly complete: "complete_since_inception" | "unknown";
    readonly changes: readonly { readonly changeId: string; readonly kind: "plan_transfer" | "beneficiary_change";
      readonly at: CivilDate; readonly continuity: "verified_preserved" | "unknown"; readonly source: EducationSource }[];
    readonly source: EducationSource;
  };
  readonly rules?: {
    readonly source: EducationSource;
    readonly treatment: "direct_trustee_beneficiary_roth" | "unsupported";
    readonly minimumPlanAgeYears: number;
    readonly ageStartPermission: "original_opening" | "sourced_continuity";
    /** Source defines the inclusive first excluded funding date. */
    readonly recentFrom: CivilDate;
    readonly recentTreatment: "exclude_contributions_and_allocable_earnings";
    readonly lifetimeMaximum: Money;
    readonly annualCapacityRuleSnapshotId: string;
    readonly compensationRuleSnapshotId: string;
  };
  /** Exhaustive current lot partition after historical recoveries. */
  readonly holdings: {
    readonly holdingId: string; readonly complete: "all_current_lots" | "unknown"; readonly source: EducationSource;
    readonly lots: readonly { readonly lotId: string; readonly basisId: string; readonly basis: Money;
      readonly earnings: Money; readonly source: EducationSource }[];
  };
  readonly destination: {
    readonly accountId: string; readonly ownerId: string; readonly householdId: string;
    readonly taxBucket: "roth_ira" | "traditional_ira";
    readonly trusteeId: string; readonly receivingTrusteeId: string;
    readonly route: "direct_trustee" | "bank"; readonly source: EducationSource;
  };
  readonly authorization: {
    readonly permitted: "yes" | "no" | "unknown";
    readonly operationId: string; readonly claimId: string; readonly holdingId: string;
    readonly sourceAccountId: string; readonly destinationAccountId: string;
    readonly receivingTrusteeId: string; readonly amount: Money; readonly source: EducationSource;
  };
  readonly usage: {
    readonly at: CivilDate;
    readonly completeness: "all_beneficiary_lifetime_transfers_and_annual_ira_including_pending" | "unknown";
    readonly source: EducationSource; readonly entries: readonly RothUsage[];
  };
  readonly annualCapacity: IraCapacity;
  readonly compensationCapacity: IraCapacity;
}

/** S5 person/year/scope/version convention as A2. IRA scopes remain private;
 * #149 alone owns the physical shared adapter. No A2 scope is repurposed. */
export interface IraCapacity {
  readonly personId: string; readonly taxYear: number;
  readonly limitScope: { readonly kind: "ira_annual" | "ira_compensation"; readonly aggregationId: "person" };
  readonly ruleSnapshotId: string;
  readonly maximum: Money; readonly used: Money; readonly asOf: CivilDate;
  readonly completeness: "complete" | "unknown";
  readonly source: EducationSource; readonly usageSource: EducationSource;
}
export interface RothUsage {
  readonly operationId: string; readonly claimId: string;
  readonly kind: "529_roth_transfer" | "regular_ira_contribution";
  readonly beneficiaryId: string; readonly ownerId: string; readonly planId: string; readonly providerId: string;
  readonly destinationAccountId: string;
  readonly taxYear: number; readonly effectiveAt: CivilDate;
  readonly state: "posted" | "pending_authorized";
  readonly amount: Money; readonly basis: Money; readonly earnings: Money;
  readonly source: EducationSource;
}
export type RothOutput = "eligibility" | "basis_earnings" | "annual_capacity" | "lifetime_capacity" | "funding" | "federal_tax" | "state_tax" | "local_tax" | "settlement";
export interface RothCoverage {
  readonly operationId: string; readonly sourceEntityPath: string; readonly period: Span;
  readonly affectedOutput: RothOutput; readonly coverage: "complete" | "incomplete";
  readonly diagnosticCode: string | null; readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null; readonly traceRefs: readonly string[];
}
export interface RothProposal {
  readonly contractVersion: "d2-shared/v1"; readonly committed: false; readonly postable: false;
  readonly physicalTransfer: "not_applied"; readonly status: "conditional_uncommitted";
  readonly kind: RothTransferRequest["kind"]; readonly instrumentFamily: "education_529";
  readonly taxBucket: "education_529"; readonly priority: "movement"; readonly dependsOn: readonly string[];
  readonly operationId: string; readonly claimId: string; readonly actorId: string; readonly personId: string;
  readonly householdId: string; readonly beneficiaryId: string; readonly planId: string; readonly providerId: string;
  readonly planAccountId: string; readonly sourceAccountId: string; readonly holdingId: string;
  readonly destinationAccountId: string; readonly receivingTrusteeId: string;
  readonly effectiveAt: CivilDate; readonly taxYear: number; readonly ruleSnapshotId: string;
  readonly grossAmount: Money;
  readonly originalPlanValue: Money; readonly originalBasis: Money; readonly originalEarnings: Money; readonly originalLiquidCash: Money;
  readonly basisLotIds: readonly { readonly lotId: string; readonly basisId: string }[];
  readonly eligibleAmount: Money; readonly excludedAmount: Money;
  readonly eligibleBasis: Money; readonly eligibleEarnings: Money;
  readonly excludedBasis: Money; readonly excludedEarnings: Money;
  readonly availableAnnualRoom: Money; readonly availableCompensationRoom: Money; readonly availableLifetimeRoom: Money;
  readonly proposedCapacity: readonly { readonly key: string; readonly personId: string; readonly taxYear: number;
    readonly legalLimitScope: IraCapacity["limitScope"]; readonly ruleSnapshotId: string;
    readonly priorUsage: Money; readonly proposedIncrement: Money; readonly committed: false }[];
  readonly proposedLifetimeIncrement: Money;
  readonly traceRefs: readonly string[]; readonly sources: readonly EducationSource[];
}
export interface RothTransferResult {
  readonly proposals: readonly RothProposal[];
  /** Available even for an oversized request; never a partial settlement. */
  readonly bounds: readonly { readonly operationId: string; readonly requestedAmount: Money; readonly permittedAmount: Money }[];
  readonly coverage: readonly RothCoverage[];
}
