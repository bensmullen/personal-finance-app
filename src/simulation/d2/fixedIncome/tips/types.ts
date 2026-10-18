import type { CivilDate } from "../../../../time/index.js";
import type { DecimalAmount, Money, RoundingPolicy } from "../../../../values/index.js";

export interface Span { readonly start: CivilDate; readonly endExclusive: CivilDate }
export interface TipsSource extends Span {
  readonly sourceId: string;
  readonly ruleSnapshotId: string;
  readonly ruleFamily: "tips";
  readonly sourcePublication: string;
  readonly publishedAt: CivilDate;
  readonly asOf: CivilDate;
  readonly version: string;
  readonly jurisdiction: string;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export interface TipsLot {
  readonly householdId: string;
  readonly personId: string;
  readonly holdingId: string;
  readonly lotId: string;
  readonly basisId: string;
  readonly securityId: string;
  readonly issueId: string; // CUSIP or stable issue identifier
  readonly wrapperId: string;
  readonly taxBucket: "taxable" | "tax_deferred" | "unknown";
  readonly stateJurisdiction: string;
  readonly destination: { readonly accountId: string; readonly personId: string; readonly wrapperId: string; readonly kind: "wrapper_cash" };
  readonly issueDate: CivilDate;
  readonly maturityDate: CivilDate;
  readonly purchaseDate: CivilDate;
  readonly purchaseKind: "issuance_at_par" | "secondary_market" | "other";
  readonly fundingAccountId: string;
  readonly originalPrincipal: Money;
  readonly parAmount: Money;
  readonly fundingCost: Money;
  readonly denomination: "USD";
  readonly annualCouponRate: DecimalAmount; // decimal annual rate, never percent
  readonly firstCouponDate: CivilDate;
  readonly lastCouponDate: CivilDate;
  readonly couponDates: readonly CivilDate[];
  readonly lotTreatment: "single_ordinary_lot" | "special_basis_or_multiple_lots";
  readonly source: TipsSource;
  /** Read-only committed checkpoint; proposals do not advance it. */
  readonly opening: {
    readonly at: CivilDate;
    readonly carrying: Money;
    readonly basis: Money;
    readonly cumulativeIndexation: Money;
    readonly source: TipsSource;
  };
}
export interface CpiPoint {
  readonly seriesId: string;
  readonly month: CivilDate;
  readonly value: DecimalAmount;
  readonly source: TipsSource;
}
export interface TipsRule {
  readonly issueId: string;
  readonly source: TipsSource;
  readonly seriesId: string;
  readonly lagMonths: number;
  readonly interpolation: "linear_day_minus_one_over_days_in_current_month" | "unsupported";
  readonly calendar: "gregorian_unadjusted" | "unsupported";
  readonly base: { readonly referenceDate: CivilDate; readonly denominator: DecimalAmount; readonly source: TipsSource };
  readonly referenceRounding: RoundingPolicy;
  readonly ratioRounding: RoundingPolicy;
  readonly principalRounding: RoundingPolicy;
  readonly couponRounding: RoundingPolicy;
  readonly couponConvention: "indexed_principal_times_annual_rate_times_sourced_fraction" | "unsupported";
  readonly couponPeriods: readonly { readonly start: CivilDate; readonly endExclusive: CivilDate; readonly paymentDate: CivilDate; readonly yearFraction: DecimalAmount }[];
  readonly carryingBasisConvention: "signed_indexation_no_other_adjustments" | "unsupported";
  readonly deflation: "signed_indexation" | "unsupported";
  readonly maturityFloor: "eligible_original_par" | "unsupported";
}
export interface TipsTaxRule {
  readonly source: TipsSource;
  readonly taxBucket: "taxable" | "tax_deferred";
  readonly treatment: "signed_oid_and_coupon" | "no_current_tax_facts" | "exempt" | "unsupported";
}
export interface TipsRequest {
  readonly lot: TipsLot;
  readonly period: Span;
  readonly effectiveAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly rule?: TipsRule;
  readonly observations: readonly CpiPoint[];
  readonly taxRules: readonly TipsTaxRule[];
  readonly action: "scheduled_observation" | "sale" | "split" | "early_redemption";
  readonly couponQuote?: { readonly quoteId: string; readonly paymentDate: CivilDate; readonly amount: Money; readonly source: TipsSource };
}
export type TipsOutput = "indexation" | "basis" | "computed_coupon" | "quoted_coupon" | "maturity" | "federal_tax" | "state_tax" | "settlement";
export type TipsCode = "SOURCE_NOT_ADMITTED" | "LOT_NOT_ADMITTED" | "INVALID_REQUEST" | "CURRENCY_OR_AMOUNT_INVALID"
  | "RULE_REQUIRED" | "CONVENTION_NOT_ADMITTED" | "CPI_REQUIRED" | "CPI_CONFLICT" | "OPENING_NOT_RECONCILED"
  | "DUPLICATE_COUPON" | "COUPON_PERIOD_REQUIRED" | "NEGATIVE_PRINCIPAL" | "TAX_LAW_REQUIRED" | "TAX_LAW_CONFLICT"
  | "DEFLATION_NOT_ADMITTED" | "FLOOR_TAX_CHARACTER_REQUIRED" | "SHARED_SETTLEMENT_PENDING";
export interface TipsCoverage {
  readonly sourceEntityPath: string;
  readonly period: Span;
  readonly affectedOutput: TipsOutput;
  readonly coverage: "complete" | "incomplete" | "not_applicable";
  readonly diagnosticCode: TipsCode | null;
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface TipsTaxFact {
  readonly taxYear: number;
  readonly jurisdiction: string;
  readonly incomeCharacter: "coupon_interest" | "noncash_inflation_oid" | "noncash_deflation_adjustment";
  readonly gross: Money;
  readonly taxable: Money;
  readonly basisRecovered: Money;
  readonly lawVersion: string;
  readonly ruleSnapshotId: string;
  readonly completeness: "complete_character_only";
  readonly source: TipsSource;
}
export interface TipsProposal {
  readonly contractVersion: "d2-shared/v1";
  readonly status: "conditional_uncommitted";
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "indexation" | "computed_coupon" | "quoted_coupon" | "maturity";
  readonly actorId: string;
  readonly householdId: string;
  readonly holdingId: string;
  readonly lotId: string;
  readonly securityId: string;
  readonly issueId: string;
  readonly basisId: string;
  readonly taxBucket: TipsLot["taxBucket"];
  readonly effectiveAt: CivilDate;
  readonly period: Span;
  readonly ruleSnapshotId: string;
  readonly source: string;
  readonly destination: string;
  readonly priority: "recognition" | "movement";
  readonly dependsOn: readonly string[];
  readonly conditions: readonly string[];
  readonly grossAmount: Money;
  readonly originalPrincipal: Money;
  readonly adjustedPrincipal: Money | null;
  readonly referenceCpi: DecimalAmount | null;
  readonly indexRatio: DecimalAmount | null;
  readonly cashDelta: Money;
  readonly assetDelta: Money;
  readonly basisDelta: Money;
  readonly netWorthDelta: Money;
  readonly recognitionFacts: readonly { readonly character: "noncash_indexation" | "coupon_interest" | "maturity_floor_uplift"; readonly amount: Money }[];
  readonly taxFacts: readonly TipsTaxFact[];
  readonly traceRefs: readonly string[];
  readonly sources: readonly TipsSource[];
}
export interface TipsResult { readonly proposals: readonly TipsProposal[]; readonly coverage: readonly TipsCoverage[] }
