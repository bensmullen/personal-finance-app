import { sha256 } from "../../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate, instant } from "../../../../../../time/index.js";
import { Money, USD } from "../../../../../../values/index.js";
import { immutableConfiguration } from "../../../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../../../run.js";
import { fsaScopeId, type FsaReceipt, type FsaRequest } from "../../index.js";
import { bindFsaYearChain, fsaYearChainFingerprint } from "../index.js";
import type { FsaYearChainOriginalContext, FsaYearChainOriginalPin, FsaYearChainOriginalProvider,
  FsaYearChainOriginalRef, FsaYearOriginal, FsaYearOriginalInventory, FsaYearOriginalQuery,
  FsaYearOriginalRole } from "./types.js";

export type * from "./types.js";

const roles = ["plan", "election", "calendar", "law", "yearEnd", "carryoverLaw", "termination", "enrollment",
  "history", "claims", "paid", "reimbursed", "payroll", "closeout", "transfers"] as const;
const digest = (value: unknown): string => `sha256:${sha256(canonicalSerialize(value))}`;
const text = (value: string): boolean => typeof value === "string" && value.trim().length > 0;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const date = (at: string) => civilDate(at.slice(0, 10));
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const limits = Object.freeze({ committed: false, postable: false, physicalSettlement: "incomplete",
  payrollEffectCoverage: "incomplete", reimbursementSettlementCoverage: "incomplete", taxCoverage: "incomplete",
  netWorthTreatment: "excluded_restricted_entitlement", appliedCarryover: Money.zero(USD) } as const);

type Reason = "ORIGINAL_UNAVAILABLE" | "ORIGINAL_INCOMPLETE" | "ORIGINAL_INVALID" | "ORIGINAL_NOT_KNOWN"
  | "ORIGINAL_WITHDRAWN" | "ORIGINAL_CONFLICT" | "ORIGINAL_CHANGED" | "HISTORY_CONFLICT" | "REPLAY_MISMATCH";
class Incomplete extends Error {
  constructor(readonly reason: Reason, readonly role?: FsaYearOriginalRole) { super(reason); }
}

function inventoryDigest(inventory: FsaYearOriginalInventory): string {
  // Revision order is a transport detail. Original document content retains its order.
  return digest({ ...inventory, roles: roles.map(role => [role,
    [...inventory.roles[role]].sort((a, b) => compare(a.revisionId, b.revisionId))]) });
}

function bankMatches(fact: { readonly proofId: string; readonly receiptId: string; readonly memberId: string;
  readonly accountId: string; readonly ownerId: string; readonly householdBank: boolean }, receipt: FsaReceipt): boolean {
  const destination = receipt.destination;
  return !!destination && fact.proofId === receipt.proofId && fact.receiptId === receipt.receiptId
    && fact.memberId === receipt.memberId && fact.accountId === destination.accountId && fact.ownerId === destination.ownerId
    && fact.householdBank === (destination.householdBank === true);
}

function uniqueBy<T>(records: readonly T[], id: (record: T) => string): Map<string, T> {
  const byId = new Map<string, T>();
  for (const record of records) {
    const key = id(record);
    if (!text(key) || byId.has(key)) throw new Incomplete("HISTORY_CONFLICT");
    byId.set(key, record);
  }
  return byId;
}

function readYear(inventory: FsaYearOriginalInventory, query: FsaYearOriginalQuery,
  publishers: FsaYearChainOriginalProvider["publishers"]) {
  const { scope, period } = inventory;
  if (inventory.version !== "fsa-year-original-inventory/v1" || !same(inventory.query, query)
    || inventory.complete !== true) throw new Incomplete("ORIGINAL_INCOMPLETE");
  const at = date(query.asOf);
  const sources = new Map<FsaYearOriginalRole, { readonly publisherId: string; readonly sourceId: string;
    readonly version: string; readonly revisionId: string; readonly publishedAt: string; readonly knownAt: string;
    readonly effectiveAt: string; readonly digest: string; readonly historyDigest: string }>();
  const select = <R extends FsaYearOriginalRole>(role: R, rows: readonly FsaYearOriginal<R>[]) => {
    if (!rows?.length) throw new Incomplete("ORIGINAL_INCOMPLETE", role);
    const revisions = new Map<string, FsaYearOriginal<R>>();
    for (const row of rows) {
      if (row.publisherId !== publishers[role] || !same(row.scope, scope) || !same(row.period, period)
        || ![row.sourceId, row.version, row.revisionId, row.originalContent].every(text)
        || revisions.has(row.revisionId) || !["published", "withdrawn"].includes(row.status)
        || instant(row.publishedAt) > instant(row.knownAt) || !instant(row.effectiveAt)) {
        throw new Incomplete("ORIGINAL_INVALID", role);
      }
      revisions.set(row.revisionId, row);
    }
    const known = rows.filter(row => row.knownAt <= query.dataCutoff && row.effectiveAt <= query.asOf);
    const retired = new Set<string>();
    for (const row of known) {
      if (row.replaces === null) continue;
      const prior = revisions.get(row.replaces);
      if (!prior || prior.sourceId !== row.sourceId || prior.knownAt >= row.knownAt
        || prior.effectiveAt > row.effectiveAt || retired.has(prior.revisionId)) throw new Incomplete("ORIGINAL_CONFLICT", role);
      retired.add(prior.revisionId);
    }
    const active = known.filter(row => !retired.has(row.revisionId));
    const record = active[0];
    if (!record) throw new Incomplete("ORIGINAL_NOT_KNOWN", role);
    if (active.length !== 1) throw new Incomplete("ORIGINAL_CONFLICT", role);
    if (record.status !== "published") throw new Incomplete("ORIGINAL_WITHDRAWN", role);
    const { publisherId, sourceId, version, revisionId, publishedAt, knownAt, effectiveAt } = record;
    sources.set(role, { publisherId, sourceId, version, revisionId, publishedAt, knownAt, effectiveAt, digest: digest(record),
      historyDigest: digest([...known].sort((a, b) => compare(a.revisionId, b.revisionId))) });
    return record;
  };

  const originals = inventory.roles;
  const plan = select("plan", originals.plan).value;
  const election = select("election", originals.election).value;
  const calendar = select("calendar", originals.calendar).value;
  const law = select("law", originals.law).value;
  const yearEnd = select("yearEnd", originals.yearEnd).value;
  const carryoverLaw = select("carryoverLaw", originals.carryoverLaw).value;
  const termination = select("termination", originals.termination);
  const enrollment = select("enrollment", originals.enrollment).value;
  const history = select("history", originals.history);
  const claims = select("claims", originals.claims);
  const paid = select("paid", originals.paid);
  const reimbursed = select("reimbursed", originals.reimbursed);
  const payroll = select("payroll", originals.payroll);
  const closeout = select("closeout", originals.closeout).value;
  const transfers = select("transfers", originals.transfers).value;

  if (history.value.through !== at || history.value.through > date(history.publishedAt))
    throw new Incomplete("ORIGINAL_INCOMPLETE", "history");
  if (termination.value.kind === "terminated" && date(termination.effectiveAt) !== termination.value.incurredEndExclusive)
    throw new Incomplete("ORIGINAL_CONFLICT", "termination");
  if (enrollment.enrolledAtStart !== (enrollment.coverage.start === period.start
    && enrollment.members.some(member => member.memberId === scope.personId && member.coverage.start === period.start))) {
    throw new Incomplete("ORIGINAL_CONFLICT", "enrollment");
  }
  // Reconcile independently published legal caps with plan terms. The owner computes the transfer.
  if (yearEnd.kind === "carryover" ? (!carryoverLaw || carryoverLaw.planYearId !== scope.planYearId
    || !carryoverLaw.planCap.equals(yearEnd.planCap) || !carryoverLaw.legalCap.equals(yearEnd.legalCap)
    || carryoverLaw.evidence.ruleFamily !== "health_fsa_carryover_law" || carryoverLaw.evidence.subjectId !== fsaScopeId(scope)
    || carryoverLaw.evidence.projectionStatus !== "verified" || carryoverLaw.evidence.start > period.start
    || carryoverLaw.evidence.endExclusive < period.endExclusive || carryoverLaw.evidence.verifiedThrough < at
    || carryoverLaw.evidence.asOf > at) : carryoverLaw !== null) throw new Incomplete("ORIGINAL_CONFLICT", "carryoverLaw");

  const paidById = uniqueBy(paid.value, fact => fact.paymentRef);
  const reimbursedById = uniqueBy(reimbursed.value, fact => fact.settlementId);
  const usedPayments = new Set<string>(), usedSettlements = new Set<string>();
  for (const claim of claims.value) {
    if (claim.submittedAt > date(claims.publishedAt) || (claim.decision && claim.decision.decidedAt > date(claims.publishedAt)))
      throw new Incomplete("HISTORY_CONFLICT", "claims");
    if (claim.payment.status === "paid") {
      const id = claim.payment.paymentRef;
      const fact = paidById.get(id);
      if (!fact || usedPayments.has(id) || instant(fact.occurredAt) > paid.publishedAt
        || date(fact.occurredAt) !== claim.payment.paidAt || !fact.amount.isPositive() || !fact.amount.equals(claim.payment.amount)
        || fact.payeeId !== claim.payeeId || !bankMatches(fact, claim)) throw new Incomplete("HISTORY_CONFLICT", "paid");
      usedPayments.add(id);
    }
    const deposit = claim.reimbursement;
    if (deposit && (deposit.status === "pending" || deposit.status === "settled")
      && (deposit.adjudicatedAt > date(claims.publishedAt) || (deposit.settledAt && deposit.settledAt > date(claims.publishedAt))))
      throw new Incomplete("HISTORY_CONFLICT", "claims");
    if (deposit?.status === "settled") {
      const id = deposit.settlementId;
      const fact = id === null ? undefined : reimbursedById.get(id);
      if (id === null || !fact || usedSettlements.has(id) || instant(fact.occurredAt) > reimbursed.publishedAt
        || date(fact.occurredAt) !== deposit.settledAt || !fact.amount.equals(deposit.approvedAmount)
        || fact.employerId !== scope.employerId || claim.payment.status !== "paid"
        || paidById.get(claim.payment.paymentRef)!.occurredAt > fact.occurredAt || !bankMatches(fact, claim)) {
        throw new Incomplete("HISTORY_CONFLICT", "reimbursed");
      }
      usedSettlements.add(id);
    }
  }
  if (usedPayments.size !== paidById.size || usedSettlements.size !== reimbursedById.size
    || payroll.value.some(row => row.effectiveAt > date(payroll.publishedAt))) throw new Incomplete("HISTORY_CONFLICT");

  const request: FsaRequest = { evaluatedAt: at, historyThrough: history.value.through, historyEvidence: history.value.evidence,
    receipts: claims.value, payroll: payroll.value, priorCarryover: transfers.openingTransfer,
    plan: { householdId: scope.householdId, personId: scope.personId, employerId: scope.employerId,
      planId: scope.planId, planYearId: scope.planYearId, period, law, yearEnd, termination: termination.value,
      coverage: enrollment.coverage, members: enrollment.members, annualElection: election.annualElection,
      employerContribution: election.employerContribution, instrumentFamily: plan.instrumentFamily, planEvidence: plan.planEvidence,
      planElectionLimit: plan.planElectionLimit, planEmployerLimit: plan.planEmployerLimit, uniformCoverage: plan.uniformCoverage,
      allocationPolicy: plan.allocationPolicy, submitEndExclusive: plan.submitEndExclusive } };
  return { request, calendar, carryoverLaw, closeout, transfers, enrolledAtStart: enrollment.enrolledAtStart,
    sources: [...sources].map(([role, reference]) => ({ role, ...reference })),
    bankIds: [...paid.value, ...reimbursed.value].map(row => row.bankEventId),
    paymentRefs: [...paidById.keys()], settlementIds: [...reimbursedById.keys()] };
}

/** Register at trusted composition time. Only the original reference and run context cross the caller boundary. */
export function registerFsaYearChainOriginalProvider(provider: FsaYearChainOriginalProvider) {
  const { publisherId } = provider;
  const publishers = Object.freeze({ ...provider.publishers });
  const read = provider.read.bind(provider);
  if (!text(publisherId) || !roles.every(role => text(publishers[role])) || publishers.law === publishers.plan
    || publishers.carryoverLaw === publishers.plan || [publishers.paid, publishers.reimbursed].includes(publishers.claims)) {
    throw new Error("FSA_YEAR_ORIGINAL_PUBLISHER_CONFIGURATION");
  }

  function qualify(ref: FsaYearChainOriginalRef, context: FsaYearChainOriginalContext,
    replay?: { readonly expected: FsaYearChainOriginalPin }) {
    try {
      const { runId, asOf, dataCutoff } = context;
      if (ref.publisherId !== publisherId || ![runId, ref.chainId].every(text) || instant(dataCutoff) > instant(asOf))
        throw new Incomplete("ORIGINAL_INVALID");
      const originalRef = Object.freeze({ publisherId, chainId: ref.chainId });
      const queries = (["prior", "successor"] as const).map(year => Object.freeze({ ref: originalRef, year, runId, asOf, dataCutoff }));
      const snapshots = queries.map(query => immutableConfiguration(read(query)));
      const [priorInventory, successorInventory] = snapshots;
      if (!priorInventory || !successorInventory) throw new Incomplete("ORIGINAL_UNAVAILABLE");
      const prior = readYear(priorInventory, queries[0]!, publishers);
      const successor = readYear(successorInventory, queries[1]!, publishers);
      const stamps = snapshots.map(inventory => inventoryDigest(inventory!));
      for (const ids of [[...prior.bankIds, ...successor.bankIds], [...prior.paymentRefs, ...successor.paymentRefs],
        [...prior.settlementIds, ...successor.settlementIds], [prior, successor].flatMap(year =>
          year.request.payroll.flatMap(row => row.postingRef === null ? [] : [row.postingRef]))]) uniqueBy(ids, id => id);
      if (prior.transfers.proposedTransferId !== successor.transfers.proposedTransferId)
        throw new Incomplete("ORIGINAL_CONFLICT", "transfers");
      const priorRule = prior.request.plan.yearEnd;
      if (priorRule?.kind === "carryover" && prior.request.plan.termination?.kind !== "terminated"
        && priorRule.nextEnrollment && priorRule.nextEnrollment.enrolled !== successor.enrolledAtStart) {
        throw new Incomplete("ORIGINAL_CONFLICT", "enrollment");
      }

      let evaluation: ReturnType<typeof bindFsaYearChain>;
      try {
        evaluation = bindFsaYearChain({ prior: prior.request, successor: successor.request,
          calendar: { prior: prior.calendar, successor: successor.calendar }, carryoverLaw: prior.carryoverLaw,
          expectedInputs: { prior: fsaYearChainFingerprint(prior.request), successor: fsaYearChainFingerprint(successor.request) },
          transferId: prior.transfers.proposedTransferId, externalCloseout: prior.closeout,
          competingTransfers: [...prior.transfers.competing, ...successor.transfers.competing,
            ...(successor.closeout ? [successor.closeout] : [])] });
      } finally {
        // Attempt both current reads even if evaluation or one publisher read fails.
        const current = queries.map(query => {
          try { const value = read(query); return value && inventoryDigest(value); }
          catch { return undefined; }
        });
        if (current.some(value => value === undefined)) throw new Incomplete("ORIGINAL_UNAVAILABLE");
        if (current.some((value, i) => value !== stamps[i])) throw new Incomplete("ORIGINAL_CHANGED");
      }

      const { from, to, memberIds, transferId, effectiveAt, closeDueAt, proposedCarryover, proposedForfeiture,
        priorGraceAvailable, closingEntitlement, proposalCoverage, successorCoverage, provenance, diagnostics, evaluations } = evaluation;
      const sources = { prior: prior.sources, successor: successor.sources };
      const proposal = { from, to, memberIds, transferId, effectiveAt, closeDueAt, proposedCarryover, proposedForfeiture,
        priorGraceAvailable, closingEntitlement, proposalCoverage, successorCoverage, provenance, diagnostics,
        priorDisposition: evaluations.prior.disposition?.kind ?? null,
        entitlementCoverage: { prior: evaluations.prior.entitlementCoverage, successor: evaluations.successor.entitlementCoverage },
        ownerDiagnostics: { prior: evaluations.prior.diagnostics, successor: evaluations.successor.diagnostics },
        eligibility: [prior, successor].flatMap(year => year.request.receipts.map(receipt => ({
          planYearId: receipt.planYearId, receiptId: receipt.receiptId, decision: receipt.decision?.kind ?? null,
          reimbursement: receipt.reimbursement?.status ?? null }))).sort((a, b) => compare(canonicalSerialize(a), canonicalSerialize(b))) };
      const sourceScope = { prior: priorInventory.period, successor: successorInventory.period };
      const version = "fsa-year-chain-original/v1";
      const pin: FsaYearChainOriginalPin = { version, digest: digest({ version, queries, sources, sourceScope, proposal,
        ownerEvaluations: { prior: digest(evaluations.prior), successor: digest(evaluations.successor) } }) };
      if (replay && (!replay.expected || !same(replay.expected, pin))) throw new Incomplete("REPLAY_MISMATCH");
      const coverage = evaluations.successor.yearEndCoverage === "complete"
        && (proposalCoverage === "complete" || priorGraceAvailable.isPositive()) ? "conditional" : "incomplete";
      return immutableConfiguration({ kind: "source_checked_fsa_year_chain" as const, ...limits, coverage,
        ref: originalRef, context: { runId, asOf, dataCutoff }, pin, sourceScope, sources, proposal });
    } catch (error) {
      return Object.freeze({ kind: "fsa_year_chain_original_incomplete" as const, ...limits, coverage: "incomplete" as const,
        reason: error instanceof Incomplete ? error.reason : "ORIGINAL_INVALID", role: error instanceof Incomplete ? error.role : undefined });
    }
  }

  return Object.freeze({
    qualify: (ref: FsaYearChainOriginalRef, context: FsaYearChainOriginalContext) => qualify(ref, context),
    replay: (ref: FsaYearChainOriginalRef, context: FsaYearChainOriginalContext, pin: FsaYearChainOriginalPin) =>
      qualify(ref, context, { expected: pin }),
  });
}

export type FsaYearChainOriginalDecision = ReturnType<ReturnType<typeof registerFsaYearChainOriginalProvider>["qualify"]>;
