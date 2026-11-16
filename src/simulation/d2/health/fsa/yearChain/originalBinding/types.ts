import type { CivilDate, Instant } from "../../../../../../time/index.js";
import type { Money } from "../../../../../../values/index.js";
import type { FsaIdentity, FsaPeriod, FsaPlan, FsaReceipt, FsaRequest, FsaSource } from "../../index.js";
import type { FsaYearChainRequest } from "../index.js";

export interface FsaYearChainOriginalRef {
  readonly publisherId: string;
  readonly chainId: string;
}

export interface FsaYearChainOriginalContext {
  readonly runId: string;
  readonly asOf: Instant;
  readonly dataCutoff: Instant;
}

export interface FsaYearOriginalQuery extends FsaYearChainOriginalContext {
  readonly ref: FsaYearChainOriginalRef;
  readonly year: "prior" | "successor";
}

interface BankFact {
  readonly bankEventId: string;
  readonly proofId: string;
  readonly receiptId: string;
  readonly memberId: string;
  readonly accountId: string;
  readonly ownerId: string;
  readonly householdBank: boolean;
  readonly occurredAt: Instant;
  readonly amount: Money;
}

export interface FsaYearOriginalRoles {
  readonly plan: Pick<FsaPlan, "instrumentFamily" | "planEvidence" | "planElectionLimit" | "planEmployerLimit"
    | "uniformCoverage" | "allocationPolicy" | "submitEndExclusive">;
  readonly election: Pick<FsaPlan, "annualElection" | "employerContribution">;
  readonly calendar: FsaSource;
  readonly law: NonNullable<FsaPlan["law"]>;
  readonly yearEnd: NonNullable<FsaPlan["yearEnd"]>;
  readonly carryoverLaw: FsaYearChainRequest["carryoverLaw"];
  readonly termination: NonNullable<FsaPlan["termination"]>;
  readonly enrollment: Pick<FsaPlan, "coverage" | "members"> & { readonly enrolledAtStart: boolean };
  readonly history: { readonly through: CivilDate; readonly evidence: FsaSource };
  readonly claims: readonly FsaReceipt[];
  readonly paid: readonly (BankFact & { readonly paymentRef: string; readonly payeeId: string })[];
  readonly reimbursed: readonly (BankFact & { readonly settlementId: string; readonly employerId: string })[];
  readonly payroll: FsaRequest["payroll"];
  readonly closeout: FsaYearChainRequest["externalCloseout"];
  readonly transfers: {
    readonly proposedTransferId: string;
    readonly openingTransfer: FsaRequest["priorCarryover"];
    readonly competing: FsaYearChainRequest["competingTransfers"];
  };
}

export type FsaYearOriginalRole = keyof FsaYearOriginalRoles;

interface OriginalRevision {
  readonly scope: FsaIdentity;
  readonly period: FsaPeriod;
  readonly publisherId: string;
  readonly sourceId: string;
  readonly version: string;
  readonly revisionId: string;
  readonly replaces: string | null;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly effectiveAt: Instant;
  readonly originalContent: string;
}

export type FsaYearOriginal<R extends FsaYearOriginalRole> = OriginalRevision & (
  { readonly status: "published"; readonly value: FsaYearOriginalRoles[R] }
  | { readonly status: "withdrawn" }
);

export interface FsaYearOriginalInventory {
  readonly version: "fsa-year-original-inventory/v1";
  readonly query: FsaYearOriginalQuery;
  readonly complete: boolean;
  readonly scope: FsaIdentity;
  readonly period: FsaPeriod;
  /** Each role attests the entire scoped set. Empty histories require a published empty set. */
  readonly roles: { readonly [R in FsaYearOriginalRole]: readonly FsaYearOriginal<R>[] };
}

/** Composition root supplies a trusted provider, including publisher identity for each role.
 * Read the current exhaustive catalog even for historical queries. Keep known history,
 * competing revisions and later amendments. Return undefined if the inventory is lost.
 */
export interface FsaYearChainOriginalProvider {
  readonly publisherId: string;
  readonly publishers: Readonly<Record<FsaYearOriginalRole, string>>;
  readonly read: (query: FsaYearOriginalQuery) => FsaYearOriginalInventory | undefined;
}

export interface FsaYearChainOriginalPin {
  readonly version: "fsa-year-chain-original/v1";
  readonly digest: string;
}
