import type { TipsLot, TipsRequest, TipsRule, TipsOutput } from "../index.js";
import type { TipsIdentity, TipsConditionalOccurrence, TipsBoundCoverage } from "../sourceBinding/index.js";

export interface TipsEvent {
  readonly occurrenceId: string; readonly operationId: string; readonly claimId: string;
  readonly effectiveAt: TipsRequest["effectiveAt"]; readonly knownAt: TipsRequest["knownAt"];
  readonly effectiveMonth: string; readonly period: TipsRequest["period"];
}
export type IssueTerms = Pick<TipsLot, "securityId" | "issueId" | "issueDate" | "maturityDate" | "annualCouponRate"
  | "firstCouponDate" | "lastCouponDate" | "couponDates" | "denomination">;
export type OwnedTerms = Omit<TipsLot, keyof IssueTerms | "opening">;
export interface TipsOriginalPayloads {
  readonly security: { readonly complete: true; readonly issues: readonly IssueTerms[] };
  readonly terms: { readonly complete: true; readonly rules: readonly TipsRule[] };
  readonly ownership: { readonly lot: OwnedTerms; readonly beneficialOwnerId: string; readonly floorEligible: boolean };
  readonly basis: { readonly checkpointId: string; readonly status: "committed"; readonly opening: TipsLot["opening"] };
  readonly funding: { readonly complete: true; readonly entries: readonly {
    readonly operationId: string; readonly identity: TipsIdentity; readonly accountId: string;
    readonly fundedAt: TipsRequest["effectiveAt"]; readonly status: "posted" | "pending";
    readonly debit: TipsLot["fundingCost"]; readonly acquisitionCredit: TipsLot["fundingCost"];
  }[] };
  /** Exhaustive revisions/competitors for exactly the requested series/months. */
  readonly cpi: { readonly complete: true; readonly seriesId: string; readonly months: readonly TipsRequest["effectiveAt"][];
    readonly observations: TipsRequest["observations"] };
  readonly law: { readonly authority: "enacted" | "unverified"; readonly legalSourceId: string;
    readonly taxRules: TipsRequest["taxRules"] };
  readonly history: { readonly complete: "since_inception_including_pending";
    readonly checkpointId: string; readonly opening: TipsLot["opening"];
    readonly entries: readonly { readonly identity: TipsIdentity; readonly operationId: string; readonly claimId: string;
      readonly kind: "coupon" | "indexation" | "redemption" | "basis_recognition" | "claim_use";
      readonly start: TipsRequest["effectiveAt"]; readonly effectiveAt: TipsRequest["effectiveAt"];
      readonly basisDelta: TipsLot["fundingCost"] }[] };
}
export type TipsOriginalRole = keyof TipsOriginalPayloads;
export interface TipsOriginalPin {
  readonly producerId: string; readonly sourceId: string; readonly version: string; readonly digest: string;
}
export interface TipsRoleOriginal<K extends TipsOriginalRole> {
  readonly contractVersion: "tips-role-original/v1"; readonly role: K;
  readonly producerId: string; readonly sourceId: string; readonly version: string; readonly status: "active" | "withdrawn";
  readonly identity: TipsIdentity; readonly event: TipsEvent;
  readonly publishedAt: TipsRequest["effectiveAt"]; readonly knownAt: TipsRequest["effectiveAt"];
  readonly asOf: TipsRequest["effectiveAt"]; readonly start: TipsRequest["effectiveAt"]; readonly endExclusive: TipsRequest["effectiveAt"];
  readonly payload: TipsOriginalPayloads[K];
}
export interface TipsOriginalBinding {
  readonly contractVersion: "tips-original-binding/v1";
  readonly identity: TipsIdentity; readonly event: TipsEvent;
  readonly originals: { readonly [K in TipsOriginalRole]: TipsOriginalPin };
}
export interface TipsOriginalQuery {
  readonly identity: TipsIdentity; readonly event: TipsEvent; readonly sourceId: string;
  readonly cpiScope: { readonly seriesId: string; readonly months: readonly TipsRequest["effectiveAt"][] } | null;
}
/** Trusted composition-root capabilities, independent of consumer pins. Each
 * returns the latest exhaustive original, including withdrawal and amendments.
 * This module supplies no production publisher connectivity. */
export type TipsOriginalProviders = { readonly [K in TipsOriginalRole]?: {
  readonly producerId: string; readonly authority: K;
  readonly read: (query: TipsOriginalQuery) => TipsRoleOriginal<K> | undefined;
} };
export type TipsOriginalCode = "INVALID_BINDING" | "PROVIDER_REQUIRED" | "INDEPENDENT_PROVIDER_REQUIRED"
  | "ORIGINAL_UNAVAILABLE" | "ORIGINAL_CHANGED" | "ORIGINAL_SCOPE_MISMATCH" | "CHRONOLOGY_INVALID"
  | "INVENTORY_INCOMPLETE" | "ISSUER_CONFLICT" | "OWNERSHIP_MISMATCH" | "FUNDING_UNPAID"
  | "BASIS_CONFLICT" | "LEGAL_AUTHORITY_REQUIRED" | "HISTORY_CONFLICT" | "DUPLICATE_CLAIM" | "EVALUATION_INCOMPLETE";
export interface TipsOriginalResult {
  readonly occurrences: readonly (Omit<TipsConditionalOccurrence, "original" | "contractVersion"> & {
    readonly contractVersion: "tips-original-binding/v1";
    readonly originals: TipsOriginalBinding["originals"]; readonly operationId: string; readonly claimId: string;
  })[];
  readonly diagnostics: readonly { readonly occurrenceId: string; readonly code: TipsOriginalCode;
    readonly affectedOutputs: readonly TipsOutput[]; readonly coverage: "incomplete";
    readonly outputs?: readonly TipsBoundCoverage[] }[];
}
