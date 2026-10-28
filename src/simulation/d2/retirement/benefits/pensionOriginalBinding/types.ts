import type { CivilDate } from "../../../../../time/index.js";
import type { BenefitPeriod, BenefitSource, QuotedBenefit } from "../index.js";
import type { PensionBankConfirmation, PensionInstruction, PensionHistory, PensionPaymentIntent } from "../pensionPayment/index.js";

export type PensionOriginalRole = "plan" | "bank" | "legal" | "history";
export interface PensionIdentity {
  readonly householdId: string;
  readonly entitlementId: string;
  readonly pensionId: string;
  readonly planId: string;
  readonly sponsorId: string;
  readonly participantPersonId: string;
  readonly workerRecordPersonId: string;
  readonly beneficiaryId: string | null;
}
export interface PensionOriginalPayloads {
  readonly plan: {
    readonly award: QuotedBenefit;
    readonly employeeBasis: "none" | "unresolved";
    readonly paymentMethod: "quoted_whole_installment" | "unsupported";
  };
  readonly bank: {
    /** The authenticated provider verifies the signature over ALL payment
     * fields, including gross/net, withholding, authorization and funding. */
    readonly signedBy: string;
    readonly institutionId: string;
    readonly confirmations: readonly (Omit<PensionBankConfirmation, "evidence"> & {
      readonly publishedAt: CivilDate;
      readonly knownAt: CivilDate;
    })[];
  };
  readonly legal: {
    readonly instructions: readonly (Omit<PensionInstruction, "evidence"> & {
      readonly householdId: string;
      readonly ownerPersonIds: readonly string[];
      readonly workerRecordPersonId: string;
      readonly beneficiaryId: string | null;
    })[];
  };
  readonly history: Omit<PensionHistory, "evidence" | "exhaustive">;
}
export type PensionOriginalPublication<R extends PensionOriginalRole = PensionOriginalRole> = {
  [K in R]: {
    readonly role: K;
    readonly publisherId: string;
    readonly sourceId: string;
    readonly version: string;
    readonly originalId: string;
    readonly identity: PensionIdentity;
    readonly kind: "original" | "amended";
    readonly revisesOriginalId: string | null;
    readonly status: "active" | "withdrawn";
    readonly publishedAt: CivilDate;
    readonly knownAt: CivilDate;
    readonly eventPeriod: BenefitPeriod;
    readonly source: BenefitSource;
    readonly payload: PensionOriginalPayloads[K];
  }
}[R];
export interface PensionOriginalPin {
  readonly role: PensionOriginalRole;
  readonly publisherId: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly originalId: string;
  /** Full original witness, never authentication. */
  readonly digest: string;
}
export interface PensionOriginalQuery {
  readonly role: PensionOriginalRole;
  readonly householdId: string;
  readonly entitlementId: string;
  readonly knownAt: CivilDate;
  readonly dataCutoff: CivilDate;
}
export interface PensionOriginalInventory {
  readonly query: PensionOriginalQuery;
  readonly publisherId: string;
  readonly authentication: "authenticated_publisher" | "unverified";
  readonly completeness: "complete_since_commencement" | "unknown";
  readonly completeThrough: CivilDate;
  readonly checkedAt: CivilDate;
  /** All source IDs, inactive originals, competing versions and withdrawals
   * for this entitlement/role. Never filter using a consumer pin. */
  readonly originals: readonly PensionOriginalPublication[];
  readonly revisions: readonly {
    readonly originalId: string;
    readonly revisionId: string;
    readonly publishedAt: CivilDate;
    readonly knownAt: CivilDate;
    readonly kind: "amended" | "withdrawn" | "superseding";
  }[];
}
/** Separately injected trust boundary: independently authenticate and retrieve
 * the complete original book. No production pension/BANK adapter is supplied. */
export interface PensionOriginalProvider {
  readonly role: PensionOriginalRole;
  readonly publisherId: string;
  readOriginals(query: PensionOriginalQuery): PensionOriginalInventory | undefined;
}
export interface PensionOriginalClaim {
  readonly identity: PensionIdentity;
  readonly pins: readonly PensionOriginalPin[];
}
export interface PensionBindingRequest {
  readonly householdId: string;
  readonly knownAt: CivilDate;
  readonly dataCutoff: CivilDate;
  readonly horizon: BenefitPeriod;
  readonly claims: readonly PensionOriginalClaim[];
}
export interface PensionOriginalReference extends PensionOriginalPin {
  readonly referenceId: string;
}
export type PensionBindingCode = "INVALID_ORIGINAL" | "MISSING_PROVIDER" | "UNQUALIFIED_INVENTORY"
  | "ORIGINAL_UNAVAILABLE" | "COMPETING_ORIGINALS" | "KNOWN_REVISION" | "ORIGINAL_CHANGED"
  | "IDENTITY_MISMATCH" | "UNAVAILABLE_EVIDENCE" | "CONFLICTING_HISTORY" | "SOURCE_RACE";
export interface PensionBindingResult {
  readonly contract: "pension-original-binding/v1";
  readonly originals: readonly PensionOriginalReference[];
  /** Original intent economics/identities preserved; shared evidence referenced. */
  readonly intents: readonly (Omit<PensionPaymentIntent, "source"> & { readonly sourceRefs: readonly string[] })[];
  readonly coverage: readonly {
    readonly entitlementId: string;
    readonly sourceEntityPath: string;
    readonly period: BenefitPeriod;
    readonly effectiveAt?: CivilDate;
    readonly affectedOutput: "pension_payment_proof";
    readonly coverage: "conditional" | "incomplete";
    readonly diagnosticCodes: readonly string[];
    readonly missingFacts: readonly string[];
    readonly ruleSnapshotId: string;
    readonly traceRefs: readonly string[];
  }[];
  readonly committed: false;
  readonly postable: false;
  readonly tax: "incomplete";
  readonly bankSettlement: "incomplete";
}
