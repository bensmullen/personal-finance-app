import type { CivilDate } from "../../../../../time/index.js";
import type { Money } from "../../../../../values/index.js";
import type { CapacityRef, ContributionCandidate, ContributionPermission, ContributionRequest,
  PlanFamily, PlanPeriod, CapacityProposal } from "../index.js";

export type OriginalRole = "plan" | "funding" | "legal" | "history";
export interface MemberIdentity {
  readonly personId: string;
  readonly sponsorId: string;
  readonly planId: string;
  readonly family: PlanFamily;
  readonly destinationAccountId: string;
}
export type Permission = Omit<ContributionPermission, "scopeCompleteness" | "capacities">;
export interface PlanMember extends MemberIdentity {
  readonly ownerPersonId: string;
  readonly enrollment: PlanPeriod;
  readonly participation: "eligible" | "ineligible" | "unknown";
  readonly permissions: readonly Permission[];
}
export interface FundingAuthorization extends MemberIdentity {
  readonly operationId: string;
  readonly claimId: string;
  readonly sourceReferenceId: string;
  readonly sourceAccountId: string;
  readonly effectiveAt: CivilDate;
  readonly amount: Money;
  readonly payer: ContributionRequest["payer"];
  readonly taxBucket: ContributionRequest["taxBucket"];
  readonly contributionType: ContributionRequest["contributionType"];
  readonly kind: "payroll" | "employer";
  /** The funding provider authenticates the complete signed authorization. */
  readonly signedBy: string;
  readonly authorizationId: string;
  readonly compensation: {
    readonly personId: string;
    readonly sponsorId: string;
    readonly sourceAccountId: string;
    readonly type: string;
    readonly eligibleAmount: Money;
    readonly contributionCap: Money;
  };
}
export interface LegalPermission extends MemberIdentity {
  readonly permission: Permission;
  /** Complete applicable scopes, including controlled-group identities. */
  readonly capacities: readonly CapacityRef[];
}
export interface LegalCapacity extends CapacityRef {
  readonly personId: string;
  readonly maximum: Money;
  readonly effective: PlanPeriod;
}
export type HistoricalFamily = PlanFamily | "401k";
export interface HistoricalOperation {
  readonly operationId: string;
  readonly claimId: string;
  readonly sourceReferenceId: string;
  readonly personId: string;
  readonly sponsorId: string;
  readonly family: HistoricalFamily;
  readonly effectiveAt: CivilDate;
  readonly amount: Money;
  readonly capacityKeys: readonly string[];
}
export interface HistoricalCapacity extends CapacityRef {
  readonly personId: string;
  readonly used: Money;
  /** Explicit authoritative zero, never inferred from an empty list. */
  readonly evidence: "confirmed_zero" | "itemized_consumption";
  readonly operationIds: readonly string[];
}
export interface OriginalPayloads {
  readonly plan: { readonly members: readonly PlanMember[] };
  readonly funding: { readonly authorizations: readonly FundingAuthorization[] };
  readonly legal: { readonly permissions: readonly LegalPermission[]; readonly capacities: readonly LegalCapacity[] };
  readonly history: {
    /** Includes all employers, all six families and committed future operations. */
    readonly people: readonly {
      readonly personId: string;
      readonly sponsorIds: readonly string[];
      readonly families: readonly HistoricalFamily[];
    }[];
    readonly capacities: readonly HistoricalCapacity[];
    readonly operations: readonly HistoricalOperation[];
  };
}
export type OriginalPublication<R extends OriginalRole = OriginalRole> = {
  [K in R]: {
    readonly role: K;
    readonly householdId: string;
    readonly taxYear: number;
    readonly publisherId: string;
    readonly sourceId: string;
    readonly originalId: string;
    readonly version: string;
    readonly jurisdiction: string;
    readonly publishedAt: CivilDate;
    readonly knownAt: CivilDate;
    readonly effective: PlanPeriod;
    readonly status: "active" | "withdrawn";
    readonly revisesOriginalId: string | null;
    readonly payload: OriginalPayloads[K];
  }
}[R];
export interface OriginalPin {
  readonly role: OriginalRole;
  readonly publisherId: string;
  readonly sourceId: string;
  readonly originalId: string;
  readonly version: string;
  /** Full-original SHA-256 witness, never authentication. */
  readonly digest: string;
}
export interface OriginalQuery {
  readonly role: OriginalRole;
  readonly householdId: string;
  readonly taxYear: number;
  readonly knownAt: CivilDate;
  readonly dataCutoff: CivilDate;
}
export interface OriginalInventory {
  readonly query: OriginalQuery;
  readonly publisherId: string;
  readonly completeThrough: CivilDate;
  readonly coverage: "complete_year_book" | "partial";
  /** Unfiltered book: competing IDs and inactive originals included. */
  readonly originals: readonly OriginalPublication[];
  readonly revisions: readonly {
    readonly originalId: string;
    readonly revisionId: string;
    readonly knownAt: CivilDate;
    readonly effective: PlanPeriod;
    readonly kind: "amendment" | "withdrawal";
  }[];
}
/** Separately injected infrastructure. authenticate verifies origin AND the
 * entire inventory, including completeness and signed funding originals.
 * Consumer digests/verified flags cannot implement authentication. */
export interface OriginalPublisher<R extends OriginalRole = OriginalRole> {
  readonly role: R;
  readonly publisherId: string;
  retrieve(query: OriginalQuery): OriginalInventory | undefined;
}
export interface OriginalProvider<R extends OriginalRole = OriginalRole> {
  readonly role: R;
  readonly publisherId: string;
  readonly environment: "simulation" | "institution";
  readOriginals(query: OriginalQuery): OriginalInventory | undefined;
  authenticate(inventory: OriginalInventory): boolean;
}
export interface BindingRequest {
  readonly householdId: string;
  readonly taxYear: number;
  readonly asOf: CivilDate;
  readonly dataCutoff: CivilDate;
  readonly period: PlanPeriod;
  readonly operationIds: readonly string[];
  readonly pins: readonly OriginalPin[];
}
export type BindingCode = "INVALID_ORIGINAL" | "MISSING_PROVIDER" | "UNAUTHENTICATED_SOURCE"
  | "INCOMPLETE_INVENTORY" | "COMPETING_ORIGINALS" | "KNOWN_REVISION" | "ORIGINAL_CHANGED"
  | "IDENTITY_CONFLICT" | "UNAVAILABLE_SOURCE" | "INCOMPLETE_HISTORY" | "REPLAYED_CLAIM"
  | "SOURCE_RACE" | "ATOMIC_BATCH_REJECTED";
export interface OriginalReference extends OriginalPin {
  readonly referenceId: string;
  readonly environment: OriginalProvider["environment"];
}
export interface BindingResult {
  readonly contract: "plan-original-binding/v1";
  readonly committed: false;
  readonly postable: false;
  readonly funding: "incomplete";
  readonly tax: "incomplete";
  readonly settlement: "incomplete";
  readonly originals: readonly OriginalReference[];
  readonly candidates: readonly (ContributionCandidate & { readonly sourceRefs: readonly string[] })[];
  readonly capacityProposals: readonly CapacityProposal[];
  readonly coverage: readonly {
    readonly operationId: string;
    readonly period: PlanPeriod;
    readonly sourceEntityPath: string;
    readonly affectedOutput: "contribution_capacity";
    readonly coverage: "conditional" | "incomplete";
    readonly diagnosticCodes: readonly string[];
    readonly traceRefs: readonly string[];
  }[];
  readonly diagnostics: readonly { readonly code: BindingCode; readonly role: OriginalRole | "batch" }[];
}
