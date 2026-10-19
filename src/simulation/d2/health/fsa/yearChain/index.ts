import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { Money, USD } from "../../../../../values/index.js";
import { evaluateFsa, fsaScopeId, type FsaDiagnostic, type FsaIdentity, type FsaPeriod,
  type FsaRequest, type FsaResult, type FsaSource } from "../index.js";

/** Domain-local bindings, not a shared settlement/authentication port. */
export interface FsaYearChainRequest {
  readonly prior: FsaRequest;
  readonly successor: FsaRequest;
  readonly calendar: { readonly prior: FsaSource | null; readonly successor: FsaSource | null };
  readonly carryoverLaw: { readonly planYearId: string; readonly planCap: Money;
    readonly legalCap: Money; readonly evidence: FsaSource } | null;
  /** Detect source amendments; these fingerprints do not authenticate sources. */
  readonly expectedInputs: { readonly prior: string; readonly successor: string };
  readonly transferId: string;
  /** Retained for #149; never trusted as a receipt here. */
  readonly externalCloseout: { readonly closeoutId: string; readonly transferId: string;
    readonly from: FsaIdentity; readonly to: FsaIdentity; readonly amount: Money;
    readonly priorInputFingerprint: string; readonly successorInputFingerprint: string;
    readonly settlementIds: readonly string[]; readonly evidence: FsaSource } | null;
  /** Conflict hints can veto a proposal, but cannot prove uniqueness. */
  readonly competingTransfers: readonly { readonly transferId: string; readonly from: FsaIdentity;
    readonly to: FsaIdentity }[];
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const zero = (): Money => Money.zero(USD);
/** Canonical full-content fingerprint, not a signature. Arrays are unordered fact sets. */
export const fsaYearChainFingerprint = (value: unknown): string => {
  if (value instanceof Money) return fsaYearChainFingerprint(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(fsaYearChainFingerprint).sort(compare).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => compare(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${fsaYearChainFingerprint(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const snapshot = <T>(value: T): T => {
  if (value instanceof Money || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)
    .sort((a, b) => compare(fsaYearChainFingerprint(a), fsaYearChainFingerprint(b)))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]))) as T;
};
const identity = (p: FsaIdentity): FsaIdentity => ({ householdId: p.householdId, personId: p.personId,
  employerId: p.employerId, planId: p.planId, planYearId: p.planYearId });
const same = (a: FsaIdentity, b: FsaIdentity): boolean => fsaScopeId(a) === fsaScopeId(b);
const annual = (p: FsaPeriod): boolean => {
  civilDate(p.start); civilDate(p.endExclusive);
  return p.endExclusive === `${String(Number(p.start.slice(0, 4)) + 1).padStart(4, "0")}${p.start.slice(4)}`;
};
const admitted = (s: FsaSource | null, family: string, subject: string, p: FsaPeriod, at: CivilDate): boolean => {
  if (!s) return false;
  [s.start, s.endExclusive, s.asOf, s.verifiedThrough].forEach(civilDate);
  return s.ruleFamily === family && s.subjectId === subject && s.projectionStatus === "verified"
    && [s.ruleSnapshotId, s.sourcePublication, s.version, s.jurisdiction].every(text)
    && s.start <= p.start && s.endExclusive >= p.endExclusive && s.asOf <= at && at <= s.verifiedThrough;
};
const exact = (m: Money): boolean => m instanceof Money && m.currency.equals(USD)
  && !m.isNegative() && m.amount.fitsScale(2);

export interface FsaYearChainBundle {
  readonly contractVersion: "d2-shared/v1";
  readonly kind: "uncommitted_fsa_year_chain_authorization";
  readonly committed: false;
  readonly postable: false;
  readonly coverage: "incomplete";
  readonly proposalCoverage: "complete" | "incomplete";
  readonly successorCoverage: "incomplete";
  readonly netWorthTreatment: "excluded_restricted_entitlement";
  readonly payrollEffectCoverage: "incomplete";
  readonly reimbursementSettlementCoverage: "incomplete";
  readonly taxCoverage: "incomplete";
  readonly inputs: FsaYearChainRequest;
  readonly fingerprints: { readonly prior: string; readonly successor: string;
    readonly priorEvaluation: string; readonly successorEvaluation: string };
  /** Exact raw-input owner evaluations, not evidence of shared authentication. */
  readonly evaluations: { readonly prior: FsaResult; readonly successor: FsaResult };
  readonly from: FsaIdentity;
  readonly to: FsaIdentity;
  readonly memberIds: { readonly prior: readonly string[]; readonly successor: readonly string[] };
  readonly transferId: string;
  readonly effectiveAt: CivilDate;
  readonly closeDueAt: CivilDate;
  readonly proposedCarryover: Money;
  readonly appliedCarryover: Money;
  readonly proposedForfeiture: Money;
  readonly priorGraceAvailable: Money;
  readonly closingEntitlement: Money | null;
  readonly provenance: readonly { readonly planYearId: string; readonly proofId: string;
    readonly receiptId: string; readonly settlementId: string | null; readonly memberId: string;
    readonly incurredAt: CivilDate; readonly submittedAt: CivilDate }[];
  readonly diagnostics: readonly FsaDiagnostic[];
}

/** Compose the owner, never calculate claims or mint a finalized FsaPriorCarryover. */
export function bindFsaYearChain(input: FsaYearChainRequest): FsaYearChainBundle {
  const prior = evaluateFsa(input.prior), successor = evaluateFsa(input.successor);
  const p = input.prior.plan, n = input.successor.plan;
  const fingerprints = { prior: fsaYearChainFingerprint(input.prior), successor: fsaYearChainFingerprint(input.successor),
    priorEvaluation: fsaYearChainFingerprint(prior), successorEvaluation: fsaYearChainFingerprint(successor) };
  const diagnostics: FsaDiagnostic[] = [];
  const diagnose = (code: string, fact: string, ref = input.transferId) => diagnostics.push({ ...identity(p),
    diagnosticCode: code, sourceEntityPath: `fsa/yearChain/${fsaScopeId(p)}/${encodeURIComponent(ref)}`,
    period: p.period, affectedOutput: "year_end", coverage: "incomplete", missingFacts: [fact],
    ruleSnapshotId: p.planEvidence?.ruleSnapshotId ?? null, traceRefs: [fsaScopeId(p), fsaScopeId(n), ref] });
  if (!annual(p.period) || !annual(n.period) || p.period.endExclusive !== n.period.start
    || p.planYearId === n.planYearId || input.prior.evaluatedAt !== input.successor.evaluatedAt) {
    diagnose("ADJACENT_ANNUAL_YEARS_REQUIRED", "Exactly two consecutive 12-month years evaluated at the same boundary");
  }
  if (p.householdId !== n.householdId || p.personId !== n.personId || p.employerId !== n.employerId || p.planId !== n.planId) {
    diagnose("IDENTITY_CONFLICT", "Exact unchanged household, employee, employer and plan identities");
  }
  for (const [r, calendar] of [[input.prior, input.calendar.prior], [input.successor, input.calendar.successor]] as const) {
    if (!admitted(calendar, "health_fsa_calendar", fsaScopeId(r.plan), r.plan.period, r.evaluatedAt)) {
      diagnose("CALENDAR_EVIDENCE_REQUIRED", "Effective sourced calendar for each exact plan year", fsaScopeId(r.plan));
    }
  }
  if (fingerprints.prior !== input.expectedInputs.prior || fingerprints.successor !== input.expectedInputs.successor) {
    diagnose("STALE_SOURCE", "Rebind changed election, adjustment, history or adjudication sources before proposing closeout");
  }
  if (prior.entitlementCoverage !== "complete" || successor.entitlementCoverage !== "complete" || prior.yearEndCoverage !== "complete") {
    diagnose("OWNER_EVALUATION_INCOMPLETE", "Both unchanged owner evaluations and prior year-end evidence must be admitted");
  }
  // The owner accepts a domain-local finalized flag. This binder cannot authenticate it.
  if (input.prior.priorCarryover || input.successor.priorCarryover) {
    diagnose("UNAUTHENTICATED_PRIOR_TRANSFER", "#149 must authenticate every opening transfer and original settlement history");
  }
  if (!text(input.transferId)) diagnose("TRANSFER_ID_REQUIRED", "Stable external one-time transfer identity");
  for (const other of input.competingTransfers) {
    if (other.transferId === input.transferId || same(other.from, p)) {
      diagnose("TRANSFER_CONFLICT", "No replay or competing successor may claim the same closing entitlement", other.transferId);
    }
  }
  const previousProofs = new Set(input.prior.receipts.map(r => r.proofId));
  const previousReceipts = new Set(input.prior.receipts.map(r => r.receiptId));
  const previousSettlements = new Set(input.prior.receipts.flatMap(r =>
    r.reimbursement?.status === "settled" && r.reimbursement.settlementId ? [r.reimbursement.settlementId] : []));
  for (const r of input.successor.receipts) {
    if (previousProofs.has(r.proofId) || previousReceipts.has(r.receiptId)
      || (r.reimbursement?.status === "settled" && r.reimbursement.settlementId !== null
        && previousSettlements.has(r.reimbursement.settlementId))) {
      diagnose("CROSS_YEAR_BENEFIT_CONFLICT", "Original-year receipts/settlements cannot be successor expenses", r.proofId);
    }
  }
  const rule = p.yearEnd;
  if (rule?.kind === "carryover" && p.termination?.kind !== "terminated") {
    const law = input.carryoverLaw, next = rule.nextEnrollment;
    if (!law || law.planYearId !== p.planYearId || !exact(law.planCap) || !exact(law.legalCap)
      || !law.planCap.equals(rule.planCap) || !law.legalCap.equals(rule.legalCap)
      || !admitted(law.evidence, "health_fsa_carryover_law", fsaScopeId(p), p.period, input.prior.evaluatedAt)) {
      diagnose("YEAR_SPECIFIC_CARRYOVER_LAW_REQUIRED", "Exact effective-year legal cap and plan permission; no current-year substitution");
    }
    if (!next || !same(next, n) || next.period.start !== n.period.start || next.period.endExclusive !== n.period.endExclusive
      || (next.enrolled && (n.coverage.start !== n.period.start || !n.members.some(m =>
        m.memberId === p.personId && m.coverage.start === n.period.start)))) {
      diagnose("SUCCESSOR_ENROLLMENT_REQUIRED", "Source-bound successor enrollment and member eligibility at transfer boundary");
    }
  }
  const close = prior.disposition;
  const unresolvedReceipts = input.prior.receipts.some(r => r.reimbursement?.status === "pending"
    || (r.reimbursement?.status === "not_adjudicated" && r.decision?.kind !== "denied"
      && r.decision?.eligibleAmount.isPositive()));
  if (!close || close.status !== "proposed" || prior.claims.some(c => c.settlementRequired) || unresolvedReceipts) {
    diagnose("PRIOR_CLOSE_PENDING", "Runout/grace/termination must expire and every approved reimbursement must settle");
  }
  const external = input.externalCloseout;
  if (external && (!text(external.closeoutId) || external.transferId !== input.transferId || !same(external.from, p)
    || !same(external.to, n) || !exact(external.amount) || !close || !external.amount.equals(close.carryover)
    || external.priorInputFingerprint !== fingerprints.prior || external.successorInputFingerprint !== fingerprints.successor
    || new Set(external.settlementIds).size !== external.settlementIds.length
    || fsaYearChainFingerprint(external.settlementIds) !== fsaYearChainFingerprint([...previousSettlements])
    || !admitted(external.evidence, "health_fsa_closeout", external.closeoutId, p.period, input.prior.evaluatedAt))) {
    diagnose("EXTERNAL_CLOSEOUT_CONFLICT", "Exact closeout, source versions, amount, parties and original settlement identities");
  }
  const proposalComplete = diagnostics.length === 0;
  const grace = prior.entitlementCoverage === "complete" && !input.prior.priorCarryover
    && diagnostics.every(d => d.diagnosticCode === "PRIOR_CLOSE_PENDING")
    && rule?.kind === "grace_period" ? close?.graceAvailable ?? zero() : zero();
  diagnose("requires_149_authoritative_closeout",
    "#149 shared one-writer must authenticate complete claim/payment/payroll history, prove unique closeout/transfer receipt and atomically settle; no domain trust port exists");
  return snapshot<FsaYearChainBundle>({ contractVersion: "d2-shared/v1", kind: "uncommitted_fsa_year_chain_authorization",
    committed: false, postable: false, coverage: "incomplete", proposalCoverage: proposalComplete ? "complete" : "incomplete",
    successorCoverage: "incomplete", netWorthTreatment: "excluded_restricted_entitlement",
    payrollEffectCoverage: "incomplete", reimbursementSettlementCoverage: "incomplete", taxCoverage: "incomplete",
    inputs: input, fingerprints, evaluations: { prior, successor }, from: identity(p), to: identity(n),
    memberIds: { prior: p.members.map(m => m.memberId), successor: n.members.map(m => m.memberId) },
    transferId: input.transferId, effectiveAt: n.period.start,
    closeDueAt: p.termination?.kind === "terminated" ? p.termination.submitEndExclusive : p.submitEndExclusive,
    proposedCarryover: proposalComplete ? close!.carryover : zero(), appliedCarryover: zero(),
    proposedForfeiture: proposalComplete ? close!.forfeiture : zero(), priorGraceAvailable: grace,
    closingEntitlement: proposalComplete ? prior.entitlement!.remaining : null,
    provenance: [input.prior, input.successor].flatMap(r => r.receipts.map(receipt => ({
      planYearId: r.plan.planYearId, proofId: receipt.proofId, receiptId: receipt.receiptId, memberId: receipt.memberId,
      incurredAt: receipt.incurredAt, submittedAt: receipt.submittedAt,
      settlementId: receipt.reimbursement?.status === "settled" ? receipt.reimbursement.settlementId : null }))), diagnostics });
}
