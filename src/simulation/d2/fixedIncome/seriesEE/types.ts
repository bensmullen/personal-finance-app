import type { CivilDate } from "../../../../time/index.js";
import type { DecimalAmount, Money, RoundingPolicy } from "../../../../values/index.js";

export interface Span { readonly start: CivilDate; readonly endExclusive: CivilDate }
export interface EESource extends Span {
  readonly sourceId: string;
  readonly ruleSnapshotId: string;
  readonly ruleFamily: "series_ee";
  readonly sourcePublication: string;
  readonly authority: "official" | "externally_verified";
  readonly publishedAt: CivilDate;
  readonly asOf: CivilDate;
  readonly version: string;
  readonly jurisdiction: string;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export interface EELot {
  readonly householdId: string;
  readonly personId: string;
  readonly beneficiaryId: string | null;
  readonly holdingId: string;
  readonly bondId: string;
  readonly lotId: string;
  readonly basisId: string;
  readonly wrapperId: string;
  readonly taxBucket: "taxable" | "unknown";
  readonly stateJurisdiction: string;
  readonly localJurisdiction: string;
  readonly fundingAccountId: string;
  readonly destination: { readonly accountId: string; readonly personId: string; readonly wrapperId: string; readonly kind: "wrapper_cash" };
  readonly issueMonth: CivilDate;
  readonly purchaseDate: CivilDate;
  readonly acquisitionDate: CivilDate;
  readonly face: Money;
  readonly purchaseCost: Money;
  readonly acquisitionCost: Money;
  readonly treatment: "ordinary_original_owner" | "inherited" | "special";
  readonly source: EESource;
  readonly opening: {
    readonly at: CivilDate;
    readonly carrying: Money;
    readonly purchaseBasis: Money | null;
    readonly recognizedFederalInterest: Money | null;
    readonly election: "current_accrual" | "redemption" | "unsupported";
    readonly redeemed: boolean;
    readonly source: EESource;
  };
}
/** One full issue-month interval; rate is a period fraction, not annual APR. */
export interface EEAccrualPeriod extends Span {
  readonly periodRate: DecimalAmount;
  readonly capitalize: boolean;
  readonly source: EESource;
}
export interface EERule {
  readonly issueMonth: CivilDate;
  readonly source: EESource;
  readonly method: "fixed_issue_schedule" | "historical_issue_schedule" | "unsupported";
  readonly posting: "monthly_interest_rounded_then_capitalized";
  readonly interestRounding: RoundingPolicy;
  readonly capitalizationMonths: number;
  readonly stopAccruingAt: CivilDate;
  readonly firstRedeemableAt: CivilDate;
  readonly penalty: { readonly endExclusive: CivilDate; readonly forfeitureMonths: number; readonly treatment: "last_monthly_interest_only" };
  readonly guarantee: { readonly at: CivilDate; readonly purchaseMultiple: DecimalAmount; readonly eligible: boolean } | null;
  readonly schedule: readonly EEAccrualPeriod[];
}
export interface EETaxRule {
  readonly source: EESource;
  readonly issueMonth: CivilDate;
  readonly election: "current_accrual" | "redemption";
  readonly treatment: "federal_interest_less_previously_recognized" | "state_local_exempt" | "unsupported";
}
export interface EERequest {
  readonly lot: EELot;
  readonly period: Span;
  readonly effectiveAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly action: "valuation" | "redemption" | "education_redemption" | "special_redemption";
  readonly rule?: EERule;
  readonly taxRules: readonly EETaxRule[];
  readonly redemptionQuote?: { readonly quoteId: string; readonly at: CivilDate; readonly amount: Money; readonly source: EESource };
}
export type EEOutput = "accrued_value" | "redemption_value" | "basis" | "federal_tax" | "state_tax" | "local_tax" | "settlement";
export type EECode = "INVALID_REQUEST" | "SOURCE_NOT_ADMITTED" | "LOT_NOT_ADMITTED" | "CURRENCY_OR_AMOUNT_INVALID"
  | "RULE_REQUIRED" | "CONVENTION_NOT_ADMITTED" | "SCHEDULE_INCOMPLETE" | "OPENING_NOT_RECONCILED"
  | "HOLD_RESTRICTION" | "DUPLICATE_REDEMPTION" | "QUOTE_REQUIRED" | "QUOTE_MISMATCH" | "TAX_FACTS_REQUIRED" | "SHARED_SETTLEMENT_PENDING";
export interface EECoverage {
  readonly sourceEntityPath: string;
  readonly period: Span;
  readonly affectedOutput: EEOutput;
  readonly coverage: "complete" | "incomplete" | "not_applicable";
  readonly diagnosticCode: EECode | null;
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface EEValues {
  readonly purchaseCost: Money;
  readonly purchaseBasis: Money | null;
  readonly accruedValue: Money;
  readonly creditedInterest: Money;
  readonly guaranteeUplift: Money;
  readonly forfeitedInterest: Money;
  readonly redemptionValue: Money | null;
}
export interface EETaxFact {
  readonly personId: string;
  readonly basisId: string;
  readonly taxYear: number;
  readonly jurisdiction: string;
  readonly incomeCharacter: "ee_interest" | "ee_state_local_exempt_interest";
  readonly gross: Money;
  readonly taxable: Money;
  readonly basisRecovered: Money;
  readonly previouslyRecognized: Money;
  readonly lawVersion: string;
  readonly ruleSnapshotId: string;
  readonly completeness: "complete_character_only";
  readonly source: EESource;
}
export interface EEProposal {
  readonly lot: EELot;
  readonly contractVersion: "d2-shared/v1";
  readonly status: "conditional_uncommitted";
  readonly instrumentFamily: "series_ee";
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "noncash_accrual" | "redemption";
  readonly actorId: string;
  readonly householdId: string;
  readonly beneficiaryId: string | null;
  readonly bondId: string;
  readonly lotId: string;
  readonly basisId: string;
  readonly wrapperId: string;
  readonly taxBucket: EELot["taxBucket"];
  readonly effectiveAt: CivilDate;
  readonly period: Span;
  readonly ruleSnapshotId: string;
  readonly source: string;
  readonly destination: string;
  readonly priority: "recognition" | "movement";
  readonly dependsOn: readonly string[];
  readonly conditions: readonly string[];
  readonly grossAmount: Money;
  readonly cashDelta: Money;
  readonly assetDelta: Money;
  readonly basisDelta: Money;
  readonly netWorthDelta: Money;
  readonly redeemedPrincipal: Money;
  readonly recognitionFacts: readonly { readonly character: "ee_interest_change"; readonly amount: Money }[];
  readonly taxFacts: readonly EETaxFact[];
  readonly values: EEValues;
  readonly traceRefs: readonly string[];
  readonly sources: readonly EESource[];
}
export interface EEResult { readonly values: EEValues | null; readonly proposals: readonly EEProposal[]; readonly coverage: readonly EECoverage[] }
