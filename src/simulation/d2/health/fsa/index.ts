import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";

/** Domain-local S1–S8 contracts. #149 owns shared adapters and all postings. */
export interface FsaPeriod { readonly start: CivilDate; readonly endExclusive: CivilDate }
export interface FsaIdentity {
  readonly householdId: string;
  readonly personId: string;
  readonly employerId: string;
  readonly planId: string;
  readonly planYearId: string;
}
export interface FsaSource extends FsaPeriod {
  readonly ruleSnapshotId: string;
  readonly subjectId: string;
  readonly ruleFamily: string;
  readonly jurisdiction: string;
  readonly sourcePublication: string;
  readonly version: string;
  readonly asOf: CivilDate;
  readonly verifiedThrough: CivilDate;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export type FsaYearEnd =
  | { readonly kind: "forfeiture" }
  | { readonly kind: "grace_period"; readonly incurredEndExclusive: CivilDate }
  | { readonly kind: "carryover"; readonly planCap: Money; readonly legalCap: Money;
      readonly nextEnrollment: (FsaIdentity & { readonly period: FsaPeriod; readonly enrolled: boolean;
        readonly evidence: FsaSource }) | null };
export interface FsaPlan extends FsaIdentity {
  readonly instrumentFamily: "health_fsa";
  readonly period: FsaPeriod;
  readonly planEvidence: FsaSource | null;
  readonly law: { readonly planYearId: string; readonly electionLimit: Money; readonly employerLimit: Money;
    readonly totalLimit: Money; readonly evidence: FsaSource } | null;
  readonly annualElection: Money;
  readonly employerContribution: Money;
  readonly planElectionLimit: Money;
  readonly planEmployerLimit: Money;
  readonly uniformCoverage: "full_election_and_employer" | "unsupported" | null;
  readonly allocationPolicy: "prior_first_then_current/incurred_submitted_proof/v1";
  readonly coverage: FsaPeriod;
  readonly members: readonly { readonly memberId: string; readonly coverage: FsaPeriod; readonly evidence: FsaSource }[];
  readonly termination: { readonly kind: "none" } | { readonly kind: "terminated";
    readonly incurredEndExclusive: CivilDate; readonly submitEndExclusive: CivilDate;
    readonly disposition: "forfeit_after_runout" } | null;
  readonly submitEndExclusive: CivilDate;
  readonly yearEnd: FsaYearEnd | null;
}
export interface FsaPayrollContribution extends FsaIdentity {
  readonly contributionId: string;
  readonly effectiveAt: CivilDate;
  readonly sourceAccountId: string;
  readonly contributionSource: "employee_salary_reduction" | "employer";
  readonly amount: Money;
  readonly status: "pending" | "previously_posted";
  readonly postingRef: string | null;
  readonly evidence: FsaSource;
}
export interface FsaReceipt extends FsaIdentity {
  readonly proofId: string;
  readonly receiptId: string;
  readonly memberId: string;
  readonly payeeId: string;
  readonly expenseType: "qualified_medical_service" | "unsupported";
  readonly incurredAt: CivilDate;
  readonly submittedAt: CivilDate;
  readonly incurredAmount: Money;
  readonly payment: { readonly status: "unpaid" } | { readonly status: "paid";
    readonly paidAt: CivilDate; readonly amount: Money; readonly paymentRef: string };
  readonly destination: { readonly accountId: string; readonly ownerId: string; readonly householdId: string;
    readonly kind: "bank_cash"; readonly evidence: FsaSource } | null;
  readonly evidence: FsaSource | null;
  readonly decision: { readonly kind: "eligible" | "partial" | "denied";
    readonly eligibleAmount: Money; readonly decidedAt: CivilDate; readonly evidence: FsaSource } | null;
  readonly reimbursement: { readonly status: "not_adjudicated" }
    | { readonly status: "pending" | "settled"; readonly approvedAmount: Money;
        readonly allocations: readonly { readonly planYearId: string; readonly amount: Money }[];
        readonly adjudicatedAt: CivilDate; readonly settlementId: string | null;
        readonly settledAt: CivilDate | null; readonly evidence: FsaSource }
    | { readonly status: "unsupported_reversal" } | null;
}
/** Finalized transfer supplied by the shared S4 owner; not inferred from a prior proposal. */
export interface FsaPriorCarryover {
  readonly from: FsaIdentity;
  readonly fromPeriod: FsaPeriod;
  readonly to: FsaIdentity;
  readonly transferId: string;
  readonly effectiveAt: CivilDate;
  readonly sourceClosingEntitlement: Money;
  readonly planCap: Money;
  readonly legalCap: Money;
  readonly amount: Money;
  readonly yearEndKind: "carryover";
  readonly finalized: true;
  readonly consumedProofIds: readonly string[];
  readonly evidence: FsaSource;
}
export interface FsaRequest {
  readonly evaluatedAt: CivilDate;
  readonly plan: FsaPlan;
  readonly payroll: readonly FsaPayrollContribution[];
  readonly receipts: readonly FsaReceipt[];
  readonly priorCarryover: FsaPriorCarryover | null;
  /** Explicit complete contribution/claim/cross-plan duplicate-benefit history through evaluatedAt. */
  readonly historyEvidence: FsaSource | null;
  readonly historyThrough: CivilDate;
}
export type FsaOutput = "entitlement" | "year_end" | "payroll_effect" | "reimbursement_settlement" | "taxes";
export interface FsaDiagnostic extends FsaIdentity {
  readonly diagnosticCode: string;
  readonly sourceEntityPath: string;
  readonly period: FsaPeriod;
  readonly affectedOutput: FsaOutput;
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface FsaClaimProposal extends FsaIdentity {
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "uncommitted_fsa_reimbursement";
  readonly contractVersion: "d2-shared/v1";
  readonly proofId: string;
  readonly receiptId: string;
  readonly memberId: string;
  readonly payeeId: string;
  readonly incurredAt: CivilDate;
  readonly submittedAt: CivilDate;
  readonly effectiveAt: CivilDate;
  readonly ruleSnapshotId: string;
  readonly incurredAmount: Money;
  readonly payment: FsaReceipt["payment"];
  readonly grossAmount: Money;
  readonly restrictedEntitlementDelta: Money;
  readonly allocations: readonly { readonly planYearId: string; readonly amount: Money }[];
  readonly source: { readonly kind: "employer_health_fsa"; readonly employerId: string; readonly planId: string };
  readonly destinationAccountId: string;
  readonly status: "pending" | "previously_settled";
  readonly settlementId: string | null;
  readonly settlementRequired: boolean;
  readonly medicalDeduction: "not_determined";
  readonly traceRefs: readonly string[];
  readonly evidence: readonly FsaSource[];
}
export interface FsaResult {
  readonly identity: FsaIdentity;
  readonly period: FsaPeriod;
  readonly evaluatedAt: CivilDate;
  readonly entitlementCoverage: "complete" | "incomplete";
  readonly payrollEffectCoverage: "incomplete";
  readonly reimbursementSettlementCoverage: "incomplete";
  readonly taxCoverage: "incomplete";
  readonly yearEndCoverage: "complete" | "incomplete";
  readonly netWorthTreatment: "excluded_restricted_entitlement";
  readonly entitlement: { readonly annualElection: Money; readonly employerContribution: Money;
    readonly currentRemaining: Money; readonly priorRemaining: Money; readonly remaining: Money;
    readonly availableForNewClaims: Money;
    readonly employeePayrollToDate: Money; readonly employerPayrollToDate: Money } | null;
  readonly claims: readonly FsaClaimProposal[];
  readonly payrollIntents: readonly (FsaPayrollContribution & { readonly operationId: string;
    readonly kind: "uncommitted_fsa_payroll"; readonly postingRequired: boolean })[];
  readonly disposition: { readonly kind: FsaYearEnd["kind"]; readonly status: "pending_close" | "proposed";
    readonly fromPlanYearId: string; readonly toPlanYearId: string | null;
    readonly carryover: Money; readonly forfeiture: Money; readonly graceAvailable: Money;
    readonly traceRefs: readonly string[]; readonly evidence: readonly FsaSource[] } | null;
  readonly diagnostics: readonly FsaDiagnostic[];
}

const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const key = (...parts: string[]): string => parts.map(encodeURIComponent).join("/");
const identity = (p: FsaIdentity): FsaIdentity => ({ householdId: p.householdId, personId: p.personId,
  employerId: p.employerId, planId: p.planId, planYearId: p.planYearId });
const same = (a: FsaIdentity, b: FsaIdentity): boolean => Object.keys(identity(a)).every(k =>
  a[k as keyof FsaIdentity] === b[k as keyof FsaIdentity]);
export const fsaScopeId = (p: FsaIdentity): string => key(p.householdId, p.personId, p.employerId, p.planId, p.planYearId);
const zero = (): Money => Money.zero(USD);
const min = (...m: Money[]): Money => m.reduce((a, b) => a.compare(b) <= 0 ? a : b);
const validMoney = (m: Money): void => {
  if (!(m instanceof Money) || !m.currency.equals(USD) || m.isNegative() || !m.amount.fitsScale(2)) {
    throw new Error("FSA amounts require nonnegative exact USD cents; no implicit rounding");
  }
};
const period = (p: FsaPeriod): void => {
  civilDate(p.start); civilDate(p.endExclusive);
  if (p.start >= p.endExclusive) throw new Error("FSA periods must be nonempty and half-open");
};
const within = (d: CivilDate, p: FsaPeriod): boolean => p.start <= d && d < p.endExclusive;
const admitted = (s: FsaSource | null, family: string, subject: string, p: FsaPeriod, at: CivilDate): boolean => {
  if (!s) return false;
  period(s); civilDate(s.asOf); civilDate(s.verifiedThrough);
  return s.ruleFamily === family && s.subjectId === subject && s.projectionStatus === "verified"
    && [s.ruleSnapshotId, s.jurisdiction, s.sourcePublication, s.version].every(text)
    && s.asOf <= at && at <= s.verifiedThrough && s.start <= p.start && s.endExclusive >= p.endExclusive;
};
const point = (s: FsaSource | null, family: string, subject: string, d: CivilDate, at: CivilDate): boolean =>
  !!s && admitted(s, family, subject, s, at) && within(d, s);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** Copy/freeze plain domain records while preserving immutable exact Money semantics. */
const freeze = <T>(value: T): T => {
  if (value instanceof Money || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(v => freeze(v))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freeze(v)]))) as T;
};
const canonical = (value: unknown): string => {
  if (value instanceof Money) return canonical(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
type Historical = Extract<NonNullable<FsaReceipt["reimbursement"]>, { readonly status: "pending" | "settled" }>;
const historical = (r: FsaReceipt): Historical | null =>
  r.reimbursement?.status === "pending" || r.reimbursement?.status === "settled" ? r.reimbursement : null;

/** Pure full-history evaluation; never posts cash, wages, medical deductions or employer assets. */
export const evaluateFsa = (request: FsaRequest): FsaResult => {
  const p = request.plan; const scope = fsaScopeId(p); const at = civilDate(request.evaluatedAt);
  period(p.period); period(p.coverage);
  if (!Object.values(identity(p)).every(text)) throw new Error("Missing FSA identity");
  [p.annualElection, p.employerContribution, p.planElectionLimit, p.planEmployerLimit].forEach(validMoney);
  civilDate(p.submitEndExclusive); civilDate(request.historyThrough);
  const diagnostics: FsaDiagnostic[] = [];
  const diagnose = (code: string, output: FsaOutput, facts: readonly string[], ref = scope) => {
    diagnostics.push({ ...identity(p), diagnosticCode: code, sourceEntityPath: `fsa/${scope}/${key(ref)}`,
      period: p.period, affectedOutput: output, coverage: "incomplete", missingFacts: facts,
      ruleSnapshotId: p.law?.evidence.ruleSnapshotId ?? null, traceRefs: [scope, ref] });
  };
  diagnose("PAYROLL_ADAPTER_PENDING", "payroll_effect", ["#149/#101 actual payroll and wage-base integration"]);
  diagnose("SETTLEMENT_ADAPTER_PENDING", "reimbursement_settlement", ["#149 atomic one-time bank reimbursement"]);
  diagnose("TAX_OWNER_PENDING", "taxes", ["#101/#149 tax characterization; no inferred savings or medical deduction"]);
  const claims: FsaClaimProposal[] = [];
  const payrollIntents: (FsaPayrollContribution & { operationId: string; kind: "uncommitted_fsa_payroll"; postingRequired: boolean })[] = [];
  let disposition: FsaResult["disposition"] = null; let entitlement: FsaResult["entitlement"] = null;
  const incomplete = () => diagnostics.some(d => d.affectedOutput === "entitlement");
  const result = (): FsaResult => freeze({ identity: identity(p), period: p.period, evaluatedAt: at,
    entitlementCoverage: incomplete() ? "incomplete" : "complete",
    yearEndCoverage: incomplete() || diagnostics.some(d => d.affectedOutput === "year_end") ? "incomplete" : "complete",
    payrollEffectCoverage: "incomplete", reimbursementSettlementCoverage: "incomplete", taxCoverage: "incomplete",
    netWorthTreatment: "excluded_restricted_entitlement", entitlement, claims, payrollIntents, disposition,
    diagnostics: diagnostics.sort((a, b) => compare(key(a.affectedOutput, a.sourceEntityPath, a.diagnosticCode),
      key(b.affectedOutput, b.sourceEntityPath, b.diagnosticCode))) });
  if (p.instrumentFamily !== "health_fsa") diagnose("UNSUPPORTED_FAMILY", "entitlement", ["employer health FSA, not HSA/dependent-care FSA"]);
  if (!admitted(p.planEvidence, "health_fsa_plan", scope, p.period, at)) {
    diagnose("PLAN_EVIDENCE_REQUIRED", "entitlement", ["verified effective employer/person/plan-year terms"]);
  }
  if (request.historyThrough !== at || !admitted(request.historyEvidence, "health_fsa_complete_history", scope, p.period, at)) {
    diagnose("HISTORY_REQUIRED", "entitlement", ["complete claim/cross-plan duplicate-benefit/contribution history through evaluation"]);
  }
  if (at < p.period.start || p.coverage.start < p.period.start || p.coverage.endExclusive > p.period.endExclusive) {
    diagnose("COVERAGE_PERIOD_NOT_ADMITTED", "entitlement", ["admitted plan year and coverage within that year"]);
  }
  const law = p.law;
  if (!law || law.planYearId !== p.planYearId || !admitted(law.evidence, "health_fsa_law", p.planYearId, p.period, at)) {
    diagnose("LAW_REQUIRED", "entitlement", ["verified law and limits for this exact plan year"]);
  } else {
    [law.electionLimit, law.employerLimit, law.totalLimit].forEach(validMoney);
    if (p.annualElection.compare(min(law.electionLimit, p.planElectionLimit)) > 0
      || p.employerContribution.compare(min(law.employerLimit, p.planEmployerLimit)) > 0
      || p.annualElection.plus(p.employerContribution).compare(law.totalLimit) > 0) {
      diagnose("LIMIT_EXCEEDED", "entitlement", ["distinct employee, employer and combined limits"]);
    }
  }
  if (p.uniformCoverage !== "full_election_and_employer" || p.allocationPolicy !== "prior_first_then_current/incurred_submitted_proof/v1") {
    diagnose("AVAILABILITY_REQUIRED", "entitlement", ["verified full-year employee/employer availability and allocation policy"]);
  }
  if (!p.termination || !["none", "terminated"].includes(p.termination.kind)) {
    diagnose("TERMINATION_TERMS_REQUIRED", "entitlement", ["explicit termination/continued-coverage and forfeiture terms"]);
  }
  if (!p.yearEnd || !["carryover", "grace_period", "forfeiture"].includes(p.yearEnd.kind)
    || ("incurredEndExclusive" in p.yearEnd && p.yearEnd.kind !== "grace_period")
    || ("planCap" in p.yearEnd && p.yearEnd.kind !== "carryover")) {
    diagnose("YEAR_END_RULE_REQUIRED", "entitlement", ["exclusive carryover OR grace OR forfeiture"]);
  }
  if (p.submitEndExclusive < p.period.endExclusive) diagnose("DEADLINES_REQUIRED", "entitlement", ["explicit runout at/after plan end"]);
  let incurredEnd = p.coverage.endExclusive; let submitEnd = p.submitEndExclusive;
  if (p.yearEnd?.kind === "grace_period") {
    civilDate(p.yearEnd.incurredEndExclusive);
    if (p.yearEnd.incurredEndExclusive <= p.period.endExclusive || p.yearEnd.incurredEndExclusive > submitEnd) {
      diagnose("GRACE_TERMS_REQUIRED", "entitlement", ["sourced grace incurred window within submission deadline"]);
    }
    if (p.coverage.endExclusive === p.period.endExclusive) incurredEnd = p.yearEnd.incurredEndExclusive;
  }
  if (p.termination?.kind === "terminated") {
    civilDate(p.termination.incurredEndExclusive); civilDate(p.termination.submitEndExclusive);
    if (p.termination.incurredEndExclusive < p.coverage.start || p.termination.incurredEndExclusive > p.coverage.endExclusive
      || p.termination.submitEndExclusive < p.termination.incurredEndExclusive
      || p.termination.disposition !== "forfeit_after_runout") {
      diagnose("TERMINATION_TERMS_REQUIRED", "entitlement", ["consistent sourced termination dates"]);
    }
    incurredEnd = p.termination.incurredEndExclusive; submitEnd = p.termination.submitEndExclusive;
  }
  const memberIds = new Set<string>();
  for (const m of p.members) {
    period(m.coverage);
    if (!text(m.memberId) || memberIds.has(m.memberId) || m.coverage.start < p.coverage.start
      || m.coverage.endExclusive > p.coverage.endExclusive
      || !admitted(m.evidence, "health_fsa_member", key(scope, m.memberId), m.coverage, at)) {
      diagnose("MEMBER_EVIDENCE_REQUIRED", "entitlement", ["distinct verified covered members"], m.memberId);
    }
    memberIds.add(m.memberId);
  }
  if (!memberIds.has(p.personId)) diagnose("MEMBER_EVIDENCE_REQUIRED", "entitlement", ["employee enrollment"]);
  const prior = request.priorCarryover;
  if (prior) {
    period(prior.fromPeriod); civilDate(prior.effectiveAt);
    [prior.amount, prior.sourceClosingEntitlement, prior.planCap, prior.legalCap].forEach(validMoney);
    if (!same(prior.to, p) || prior.from.planId !== p.planId || prior.from.personId !== p.personId
      || prior.from.householdId !== p.householdId || prior.from.employerId !== p.employerId
      || prior.from.planYearId === p.planYearId || prior.fromPeriod.endExclusive !== p.period.start
      || prior.effectiveAt !== p.period.start || prior.yearEndKind !== "carryover" || prior.finalized !== true
      || !text(prior.transferId) || !prior.amount.equals(min(prior.sourceClosingEntitlement, prior.planCap, prior.legalCap))
      || new Set(prior.consumedProofIds).size !== prior.consumedProofIds.length || prior.consumedProofIds.some(x => !text(x))
      || !admitted(prior.evidence, "health_fsa_finalized_carryover", prior.transferId, prior.fromPeriod, at)) {
      diagnose("PRIOR_CARRYOVER_REQUIRED", "entitlement", ["finalized capped same-owner adjacent-year transfer with complete proof history"]);
    }
  }
  if (incomplete()) return result();

  let employeePayroll = zero(); let employerPayroll = zero(); let employeeTotal = zero(); let employerTotal = zero();
  const payrollSeen = new Map<string, string>(); const postingIds = new Set<string>();
  for (const c of [...request.payroll].sort((a, b) => compare(a.contributionId, b.contributionId))) {
    validMoney(c.amount); civilDate(c.effectiveAt);
    const serialized = canonical(c);
    if (payrollSeen.has(c.contributionId)) {
      if (payrollSeen.get(c.contributionId) !== serialized) diagnose("PAYROLL_ID_CONFLICT", "entitlement", ["consistent contribution identity"], c.contributionId);
      continue;
    }
    payrollSeen.set(c.contributionId, serialized);
    if (!same(c, p) || !within(c.effectiveAt, p.coverage) || c.effectiveAt >= incurredEnd || c.effectiveAt > at
      || !text(c.contributionId) || !text(c.sourceAccountId) || !["employee_salary_reduction", "employer"].includes(c.contributionSource)
      || !["pending", "previously_posted"].includes(c.status)
      || (c.status === "previously_posted" ? !c.postingRef || postingIds.has(c.postingRef) : c.postingRef !== null)
      || !point(c.evidence, "health_fsa_payroll", c.contributionId, c.effectiveAt, at)) {
      diagnose("PAYROLL_EVIDENCE_REQUIRED", "entitlement", ["scoped dated employee/employer contribution and unique posting status"], c.contributionId); continue;
    }
    if (c.postingRef) postingIds.add(c.postingRef);
    if (c.contributionSource === "employee_salary_reduction") {
      employeeTotal = employeeTotal.plus(c.amount);
      if (c.status === "previously_posted") employeePayroll = employeePayroll.plus(c.amount);
    } else {
      employerTotal = employerTotal.plus(c.amount);
      if (c.status === "previously_posted") employerPayroll = employerPayroll.plus(c.amount);
    }
    payrollIntents.push({ ...c, operationId: key("fsa-payroll", scope, c.contributionId),
      kind: "uncommitted_fsa_payroll", postingRequired: c.status === "pending" });
  }
  if (employeeTotal.compare(p.annualElection) > 0 || employerTotal.compare(p.employerContribution) > 0) {
    diagnose("PAYROLL_EXCEEDS_ELECTION", "entitlement", ["contributions within distinct employee/employer amounts"]);
  }
  if (incomplete()) { payrollIntents.length = 0; return result(); }

  let currentRemaining = p.annualElection.plus(p.employerContribution); let priorRemaining = prior?.amount ?? zero();
  const priorProofs = new Set(prior?.consumedProofIds ?? []);
  const groups = new Map<string, FsaReceipt[]>(); const receiptIds = new Map<string, string>();
  for (const r of request.receipts) {
    if (!text(r.proofId) || !text(r.receiptId)) throw new Error("Missing receipt/proof identity");
    if (receiptIds.has(r.receiptId) && receiptIds.get(r.receiptId) !== r.proofId) {
      diagnose("RECEIPT_ID_CONFLICT", "entitlement", ["receipt identity cannot name two proofs"], r.receiptId);
    }
    receiptIds.set(r.receiptId, r.proofId);
    const group = groups.get(r.proofId) ?? []; group.push(r); groups.set(r.proofId, group);
  }
  const receipts: FsaReceipt[] = [];
  for (const [proof, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
    if (new Set(group.map(r => canonical({ ...r, receiptId: null }))).size > 1) {
      diagnose("RECEIPT_ID_CONFLICT", "entitlement", ["one consistent adjudication per substantiated proof"], proof);
    } else receipts.push([...group].sort((a, b) => compare(a.receiptId, b.receiptId))[0]!);
  }
  // Factual prior approvals precede new claims. New claim priority is explicit in the sourced plan.
  receipts.sort((a, b) => Number(!!historical(b)) - Number(!!historical(a)) || compare(a.incurredAt, b.incurredAt)
    || compare(a.submittedAt, b.submittedAt) || compare(a.proofId, b.proofId));
  const settlementIds = new Set<string>();
  for (const r of receipts) {
    const h = historical(r);
    [r.incurredAmount, ...(r.decision ? [r.decision.eligibleAmount] : []), ...(h ? [h.approvedAmount] : [])].forEach(validMoney);
    civilDate(r.incurredAt); civilDate(r.submittedAt);
    const member = p.members.find(m => m.memberId === r.memberId);
    const memberEnd = member?.coverage.endExclusive === p.period.endExclusive ? incurredEnd : member?.coverage.endExclusive;
    if (priorProofs.has(r.proofId)) {
      if (h) diagnose("HISTORY_CONFLICT", "entitlement", ["prior-year proof cannot have another current-year approval"], r.proofId);
      continue;
    }
    const fail = (code: string, fact: string) => diagnose(code, "entitlement", [fact], r.proofId);
    if (!same(r, p) || !member || !memberEnd || r.incurredAt < member.coverage.start || r.incurredAt >= memberEnd
      || r.incurredAt < p.coverage.start || r.incurredAt >= incurredEnd
      || r.submittedAt < r.incurredAt || r.submittedAt >= submitEnd || r.submittedAt > at) {
      fail(h ? "HISTORY_CONFLICT" : "RECEIPT_NOT_ADMITTED", "correct plan/member and incurred/submitted window"); continue;
    }
    const dest = r.destination;
    if (!r.reimbursement || r.reimbursement.status === "unsupported_reversal" || r.expenseType !== "qualified_medical_service"
      || !text(r.payeeId) || !point(r.evidence, "health_fsa_receipt", r.proofId, r.incurredAt, at)
      || !r.decision || !point(r.decision.evidence, "health_fsa_adjudication", r.proofId, r.decision.decidedAt, at)
      || !dest || dest.kind !== "bank_cash" || !text(dest.accountId) || dest.ownerId !== p.personId
      || dest.householdId !== p.householdId || !point(dest.evidence, "health_fsa_destination", dest.accountId, r.submittedAt, at)) {
      fail("RECEIPT_EVIDENCE_REQUIRED", "qualified proof, decision, reimbursement status and employee destination evidence"); continue;
    }
    civilDate(r.decision.decidedAt);
    if (r.decision.decidedAt < r.submittedAt || r.decision.decidedAt > at) {
      fail("DECISION_CONFLICT", "dated qualification must follow submission and precede evaluation"); continue;
    }
    if (r.payment.status === "paid") {
      validMoney(r.payment.amount); civilDate(r.payment.paidAt);
      if (r.payment.paidAt < r.incurredAt || r.payment.paidAt > at || !text(r.payment.paymentRef)
        || r.payment.amount.compare(r.incurredAmount) > 0) { fail("PAYMENT_FACT_INVALID", "separately dated paid expense"); continue; }
    } else if (r.payment.status !== "unpaid") { fail("PAYMENT_FACT_INVALID", "explicit paid/unpaid fact"); continue; }
    const decision = r.decision;
    if (decision.eligibleAmount.compare(r.incurredAmount) > 0 || (decision.kind === "denied" && !decision.eligibleAmount.isZero())
      || (decision.kind === "eligible" && !decision.eligibleAmount.equals(r.incurredAmount))
      || !["eligible", "partial", "denied"].includes(decision.kind)) {
      fail("DECISION_CONFLICT", "eligible amount must reconcile to decision and incurred expense"); continue;
    }
    if (decision.kind === "denied" || decision.eligibleAmount.isZero()) {
      if (h) fail("HISTORY_CONFLICT", "denied receipt cannot have an approved reimbursement");
      continue;
    }
    if (h) {
      civilDate(h.adjudicatedAt);
      if (h.adjudicatedAt < r.decision.decidedAt || h.adjudicatedAt > at || !h.approvedAmount.isPositive()
        || h.approvedAmount.compare(decision.eligibleAmount) > 0
        || !point(h.evidence, "health_fsa_reimbursement", r.proofId, h.adjudicatedAt, at)
        || (h.status === "pending" && (h.settlementId !== null || h.settledAt !== null))
        || (h.status === "settled" && (!h.settlementId || !h.settledAt || h.settledAt < h.adjudicatedAt || h.settledAt > at))) {
        fail("REIMBURSEMENT_HISTORY_REQUIRED", "verified consistent approval and one-time settlement facts"); continue;
      }
      if (h.settledAt) civilDate(h.settledAt);
      if (h.settlementId) {
        if (settlementIds.has(h.settlementId)) { fail("SETTLEMENT_ID_CONFLICT", "one bank settlement identity per claim"); continue; }
        settlementIds.add(h.settlementId);
      }
    } else if (r.reimbursement.status !== "not_adjudicated") {
      fail("REIMBURSEMENT_HISTORY_REQUIRED", "known pending/settled/unadjudicated status"); continue;
    }
    const available = priorRemaining.plus(currentRemaining);
    const amount = h ? h.approvedAmount : min(decision.eligibleAmount, available);
    if (amount.compare(available) > 0) { fail("HISTORY_EXCEEDS_ENTITLEMENT", "historical approvals within full-year availability"); continue; }
    if (amount.isZero()) continue;
    let previous = min(priorRemaining, amount); let current = amount.minus(previous);
    if (h) {
      h.allocations.forEach(a => validMoney(a.amount));
      if (h.allocations.length === 0 || new Set(h.allocations.map(a => a.planYearId)).size !== h.allocations.length
        || h.allocations.some(a => !a.amount.isPositive() || (a.planYearId !== p.planYearId && a.planYearId !== prior?.from.planYearId))) {
        fail("HISTORY_ALLOCATION_CONFLICT", "explicit distinct prior/current entitlement allocations"); continue;
      }
      previous = h.allocations.find(a => a.planYearId === prior?.from.planYearId)?.amount ?? zero();
      current = h.allocations.find(a => a.planYearId === p.planYearId)?.amount ?? zero();
      if (!previous.plus(current).equals(amount) || previous.compare(priorRemaining) > 0 || current.compare(currentRemaining) > 0) {
        fail("HISTORY_ALLOCATION_CONFLICT", "historical allocations reconcile without reallocating settled consumption"); continue;
      }
    }
    priorRemaining = priorRemaining.minus(previous); currentRemaining = currentRemaining.minus(current);
    const claimId = key("fsa-claim", scope, r.proofId);
    claims.push({ ...identity(p), operationId: key(claimId, "reimbursement"), claimId,
      kind: "uncommitted_fsa_reimbursement", contractVersion: "d2-shared/v1", proofId: r.proofId, receiptId: r.receiptId,
      memberId: r.memberId, payeeId: r.payeeId, incurredAt: r.incurredAt, submittedAt: r.submittedAt,
      effectiveAt: h?.adjudicatedAt ?? decision.decidedAt, ruleSnapshotId: law!.evidence.ruleSnapshotId,
      incurredAmount: r.incurredAmount, payment: r.payment, grossAmount: amount, restrictedEntitlementDelta: amount.negated(),
      allocations: [...(previous.isPositive() && prior ? [{ planYearId: prior.from.planYearId, amount: previous }] : []),
        ...(current.isPositive() ? [{ planYearId: p.planYearId, amount: current }] : [])],
      source: { kind: "employer_health_fsa", employerId: p.employerId, planId: p.planId }, destinationAccountId: dest.accountId,
      status: h?.status === "settled" ? "previously_settled" : "pending", settlementId: h?.settlementId ?? null,
      settlementRequired: h?.status !== "settled", medicalDeduction: "not_determined",
      traceRefs: [scope, r.proofId, r.receiptId, p.planEvidence!.ruleSnapshotId, law!.evidence.ruleSnapshotId,
        ...(prior ? [prior.transferId, prior.evidence.ruleSnapshotId] : [])],
      evidence: [p.planEvidence!, law!.evidence, request.historyEvidence!, member.evidence, r.evidence!, decision.evidence,
        dest.evidence, ...(h ? [h.evidence] : []), ...(prior ? [prior.evidence] : [])] });
  }
  // Unknown prior usage can hide entitlement consumption: suppress the member/year atomically.
  if (incomplete()) { claims.length = 0; payrollIntents.length = 0; return result(); }
  entitlement = { annualElection: p.annualElection, employerContribution: p.employerContribution,
    currentRemaining, priorRemaining, remaining: currentRemaining.plus(priorRemaining),
    availableForNewClaims: at < submitEnd ? currentRemaining.plus(priorRemaining) : zero(),
    employeePayrollToDate: employeePayroll, employerPayrollToDate: employerPayroll };
  const rule = p.yearEnd!; const remaining = entitlement.remaining;
  let carryover = zero(); let forfeiture = zero(); let graceAvailable = zero(); let nextYear: string | null = null;
  const closed = at >= submitEnd && at >= (p.termination?.kind === "terminated" ? incurredEnd : p.period.endExclusive)
    && claims.every(c => !c.settlementRequired);
  if (p.termination?.kind === "terminated") forfeiture = remaining;
  else if (rule.kind === "carryover") {
    [rule.planCap, rule.legalCap].forEach(validMoney);
    const next = rule.nextEnrollment;
    if (!next) diagnose("REENROLLMENT_REQUIRED", "year_end", ["next plan-year enrollment or explicit non-enrollment"]);
    else {
      period(next.period);
      if (next.personId !== p.personId || next.householdId !== p.householdId || next.employerId !== p.employerId
        || next.planId !== p.planId || next.planYearId === p.planYearId || next.period.start !== p.period.endExclusive
        || typeof next.enrolled !== "boolean" || !admitted(next.evidence, "health_fsa_next_enrollment", fsaScopeId(next), next.period, at)) {
        diagnose("REENROLLMENT_REQUIRED", "year_end", ["same-owner adjacent sourced plan-year enrollment"]);
      } else {
        nextYear = next.planYearId; carryover = next.enrolled ? min(remaining, rule.planCap, rule.legalCap) : zero();
        forfeiture = remaining.minus(carryover);
      }
    }
  } else if (rule.kind === "grace_period" && at < incurredEnd) graceAvailable = remaining;
  else forfeiture = remaining;
  if (!diagnostics.some(d => d.affectedOutput === "year_end")) {
    disposition = { kind: p.termination?.kind === "terminated" ? "forfeiture" : rule.kind,
      status: closed ? "proposed" : "pending_close", fromPlanYearId: p.planYearId,
      toPlanYearId: nextYear, carryover, forfeiture, graceAvailable,
      traceRefs: [p.planEvidence!.ruleSnapshotId, law!.evidence.ruleSnapshotId, ...(prior ? [prior.transferId] : []),
        ...(rule.kind === "carryover" && rule.nextEnrollment ? [rule.nextEnrollment.evidence.ruleSnapshotId] : [])],
      evidence: [p.planEvidence!, law!.evidence, request.historyEvidence!, ...(prior ? [prior.evidence] : []),
        ...(rule.kind === "carryover" && rule.nextEnrollment ? [rule.nextEnrollment.evidence] : [])] };
  }
  return result();
};
