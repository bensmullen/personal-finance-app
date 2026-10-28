import type { CivilDate } from "../../../../../time/index.js";
import type { Money } from "../../../../../values/index.js";
import type { Recipient } from "../coordination/index.js";
import type { BenefitPeriod } from "../index.js";

/** Full source-owned original, independently fetched by the provider. */
export interface SsaOriginalPublication {
  readonly publisherId: string;
  readonly sourceId: string;
  readonly version: string;
  readonly originalId: string;
  readonly householdId: string;
  readonly kind: "original" | "amended";
  readonly revisesOriginalId: string | null;
  readonly status: "active" | "withdrawn";
  readonly publishedAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly asOf: CivilDate;
  readonly eventPeriod: BenefitPeriod;
  readonly recipient: Recipient;
}
export interface SsaOriginalQuery {
  readonly sourceId: string;
  readonly householdId: string;
  readonly recipientPersonId: string;
  readonly knownAt: CivilDate;
  readonly dataCutoff: CivilDate;
}
export interface SsaOriginalHistory {
  readonly query: SsaOriginalQuery;
  readonly publisherId: string;
  readonly authority: "verified_original_inventory" | "unverified";
  readonly completeness: "complete" | "unknown";
  readonly completeThrough: CivilDate;
  readonly checkedAt: CivilDate;
  /** Complete publisher/household/recipient inventory across source IDs,
   * including competing originals, not just the requested source ID. */
  readonly originals: readonly SsaOriginalPublication[];
  readonly revisions: readonly {
    readonly originalId: string;
    readonly revisionId: string;
    readonly knownAt: CivilDate;
    readonly publishedAt: CivilDate;
    readonly kind: "amended" | "corrected" | "withdrawn" | "superseding";
  }[];
}
/** Trusted, separately injected dependency. Must independently consult the
 * authenticated publisher's originals AND revision/withdrawal history as of the
 * query. Never echo pins or consumer VerifiedAward/eligibility flags. This
 * consumer does not provide an SSA ingestion/authentication adapter. */
export interface SsaOriginalProvider {
  readonly publisherId: string;
  readOriginals(query: SsaOriginalQuery): SsaOriginalHistory | undefined;
}
export interface SsaOriginalPin {
  readonly publisherId: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly originalId: string;
  readonly digest: string;
  readonly householdId: string;
  readonly recipientPersonId: string;
  readonly workerRecordPersonIds: readonly string[];
  readonly entitlementIds: readonly string[];
  readonly awardIds: readonly string[];
  readonly electionIds: readonly string[];
  readonly claimingMonths: readonly CivilDate[];
  readonly eventPeriod: BenefitPeriod;
  readonly dataCutoff: CivilDate;
}
export type SsaBindingCode = "INVALID_PIN" | "MISSING_PROVIDER" | "ORIGINAL_UNAVAILABLE" |
  "UNQUALIFIED_INVENTORY" | "ORIGINAL_CHANGED" | "IDENTITY_MISMATCH" | "KNOWN_REVISION" |
  "COMPETING_ORIGINALS" | "UNAVAILABLE_EVIDENCE" | "INVALID_ORIGINAL";
export interface SsaOriginalReference {
  readonly referenceId: string;
  readonly publisherId: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly originalId: string;
  readonly digest: string;
  readonly traceRefs: readonly string[];
}
export interface SsaConditionalInstallment {
  readonly operationId: string;
  readonly claimId: string;
  readonly originalRef: string;
  readonly recipientPersonId: string;
  readonly effectiveAt: CivilDate;
  readonly grossAmount: Money;
  readonly committed: false;
  readonly postable: false;
  readonly bankSettlement: "incomplete";
  readonly taxLiability: "incomplete";
  readonly affectedOutput: "gross_schedule";
  readonly coverage: "conditional";
}
export interface SsaBindingResult {
  readonly contract: "ssa-original-binding/v1";
  readonly originals: readonly SsaOriginalReference[];
  readonly installments: readonly SsaConditionalInstallment[];
  readonly coverage: readonly {
    readonly sourceId: string;
    readonly originalId: string;
    readonly recipientPersonId: string;
    readonly period: BenefitPeriod;
    readonly affectedOutput: "gross_schedule";
    readonly coverage: "conditional" | "incomplete" | "not_applicable";
    readonly diagnosticCodes: readonly string[];
  }[];
}
