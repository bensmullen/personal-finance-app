import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountId } from "../../../../accounting/index.js";
import { domainId } from "../../../../identity/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { claimId, recognitionId, settlementId } from "../../../../semantics/identity.js";
import { d2SettlementSourceFingerprint, registerD2SettlementSourceAuthority,
  type D2FsaSettlementReceipt, type D2FsaSourceBinding, type D2SettlementSourceContext,
  type D2SourceQualification, type D2PostingRegistration } from "../../../../state/index.js";
import { instant, type Instant } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../run.js";
import { evaluateFsa, type FsaIdentity, type FsaRequest, type FsaSource } from "../../health/fsa/index.js";
import { bindFsaYearChain, type FsaYearChainRequest } from "../../health/fsa/yearChain/index.js";

export interface FsaCashStamp { readonly publishedAt: Instant; readonly knownAt: Instant }
export interface FsaCashOrder { readonly sequenceId: string; readonly position: number }
/** Independently confirmed actual medical payment, available before any plan deposit. */
export interface FsaCashOriginal extends FsaIdentity, FsaCashStamp {
  readonly proofId: string;
  readonly memberId: string;
  readonly payeeId: string;
  readonly medicalReceiptId: string;
  readonly expensePaymentId: string;
  readonly approvalId: string;
  readonly bankAccountId: AccountId;
  readonly incurredAt: Instant;
  readonly paidAt: Instant;
  readonly amount: Money;
  readonly bankCashBefore: Money;
  readonly executionOrder?: FsaCashOrder;
}
/** A real confirmed BANK deposit; documentary reimbursement.status is insufficient. */
export interface FsaCashDeposit extends FsaCashStamp {
  readonly status: "posted" | "pending" | "declined";
  readonly sourceApprovalId: string;
  readonly paymentApprovalId: string;
  readonly authorizationId: string;
  readonly paymentId: string;
  readonly entitlementConsumptionId: string;
  readonly bankAccountId: AccountId;
  readonly ownerId: string;
  readonly householdId: string;
  readonly settledAt: Instant;
  readonly amount: Money;
  readonly bankCashBefore: Money;
  readonly executionOrder?: FsaCashOrder;
}
export interface FsaCashSource {
  readonly sourceId: string;
  readonly version: string;
  readonly request: FsaRequest;
  readonly original: FsaCashOriginal;
  readonly deposit: FsaCashDeposit;
  /** Exact source-owner publication/availability for EVERY raw evidence record. */
  readonly provenance: readonly (FsaCashStamp & { readonly evidence: FsaSource })[];
  readonly yearChain?: FsaYearChainRequest;
}
export interface FsaCashReference { readonly sourceId: string; readonly expectedSource: string }
export interface FsaCashSourceProvider {
  /** Lookup raw independently owned facts. The caller's receipt is never supplied. */
  readonly lookup: (sourceId: string) => FsaCashSource | undefined;
}
export type FsaCashIncompleteReason = Extract<D2SourceQualification, { status: "incomplete" }>["reason"];
export class FsaCashIncomplete extends ValidationError {
  readonly seam = "S7";
  readonly coverage = "incomplete";
  constructor(readonly reason: FsaCashIncompleteReason, detail: string) {
    super({ severity: "error", code: reason, entityType: "fsa_cash", message: `S7 FSA_CASH_INCOMPLETE: ${reason}: ${detail}` });
  }
}
export const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
export const fsaCashSourceFingerprint = (source: FsaCashSource): string => canonicalSerialize(source);
const reject = (detail: string): never => { throw new FsaCashIncomplete("source_not_qualified", detail); };
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const exact = (m: Money): boolean => m instanceof Money && m.currency.equals(USD) && !m.isNegative() && m.amount.fitsScale(2);
let provider: FsaCashSourceProvider | undefined;

/** Composition-root registration once per process, including independent restore. */
export function registerFsaCashSourceProvider(owner: FsaCashSourceProvider): void {
  if (provider) throw new Error("FSA_CASH_SOURCE_PROVIDER_DUPLICATE");
  registerD2SettlementSourceAuthority("fsa_paid_reimbursement", {
    qualify: (binding, context) => {
      if (binding.kind !== "fsa_paid_reimbursement") return { status: "incomplete", reason: "source_not_qualified" };
      try {
        const source = readFsaCashSource(binding.sourceId);
        const receipt = qualifyFsaCashSource(source, context);
        return same(binding, receipt.source) ? { status: "qualified", receipt }
          : { status: "incomplete", reason: "source_not_qualified" };
      } catch (error) {
        if (error instanceof FsaCashIncomplete) return { status: "incomplete", reason: error.reason };
        throw error;
      }
    },
  });
  provider = Object.freeze({ lookup: owner.lookup });
}
export function readFsaCashSource(sourceId: string, expectedSource?: string): FsaCashSource {
  const value = provider?.lookup(sourceId);
  if (!value) throw new FsaCashIncomplete("source_unavailable", sourceId);
  const source = immutableConfiguration(value);
  if (source.sourceId !== sourceId || !text(source.version)
    || (expectedSource !== undefined && fsaCashSourceFingerprint(source) !== expectedSource))
    reject("Source identity/version or pinned raw facts changed");
  return source;
}
function stamp(s: FsaCashStamp, at: Instant, context: D2SettlementSourceContext): void {
  try { [s.publishedAt, s.knownAt, at, context.asOf, context.dataCutoff].forEach(instant); }
  catch { reject("Source owner must provide exact publication and availability instants"); }
  if (s.publishedAt > s.knownAt || s.knownAt > at || s.knownAt > context.dataCutoff || s.publishedAt > context.asOf)
    reject("Source was unavailable at the event or run cutoff");
}
function order(o: FsaCashOrder | undefined): void {
  if (o && (!text(o.sequenceId) || !Number.isSafeInteger(o.position) || o.position < 0)) reject("Invalid authenticated sequence");
}
const key = (s: FsaCashSource) => `fsa-cash:${encodeURIComponent(s.sourceId)}`;
export const originalOperationId = (s: FsaCashSource) => `${key(s)}:original`;
export const depositOperationId = (s: FsaCashSource) => `${key(s)}:deposit`;
export function originalRegistration(s: FsaCashSource): D2PostingRegistration {
  const o = s.original;
  return { role: "original", kind: "fsa_paid_reimbursement", operationId: originalOperationId(s),
    householdId: domainId("household", o.householdId), personId: domainId("person", o.personId), bankAccountId: o.bankAccountId,
    planId: o.planId, planYearId: o.planYearId, memberId: o.memberId, payeeId: o.payeeId,
    medicalReceiptId: o.medicalReceiptId, expensePaymentId: o.expensePaymentId };
}
export function originalTransaction(s: FsaCashSource) {
  const o = s.original, traceRefs = [calculationTraceRef(calculationTraceId(o.approvalId))];
  return createAccountingTransaction({ id: accountingTransactionId(originalOperationId(s)), type: "fsa_medical_expense_payment",
    date: o.paidAt, traceRefs, legs: [createAccountingLeg({ type: "expense", posting: "debit", amount: o.amount }),
      createAccountingLeg({ type: "cash", posting: "credit", accountId: o.bankAccountId, amount: o.amount, cashFlowClass: "operating" })] });
}
export function qualifyFsaCashOriginal(s: FsaCashSource, context: D2SettlementSourceContext): void {
  const o = s.original;
  stamp(o, o.paidAt, context); instant(o.incurredAt); order(o.executionOrder);
  // A purported actually-paid bank confirmation cannot be published before
  // the cash event itself. Earlier plan/medical eligibility facts may exist,
  // but they are not independent evidence that BANK has already paid.
  if (o.publishedAt < o.paidAt || o.knownAt < o.paidAt)
    reject("Independent actual medical BANK payment confirmation predates its event");
  if (![o.householdId, o.personId, o.employerId, o.planId, o.planYearId, o.memberId, o.payeeId,
    o.medicalReceiptId, o.proofId, o.expensePaymentId, o.approvalId, o.bankAccountId].every(text)
    || o.incurredAt > o.paidAt || !exact(o.amount) || !o.amount.isPositive() || !exact(o.bankCashBefore))
    reject("Missing independently approved actual medical payment");
  // The original BANK debit is an actual medical payment, independent of any
  // later FSA reimbursement. It must nonetheless be sourced as PAID at this
  // event: a bare original confirmation cannot overrule contradictory raw
  // payment, member, payee or destination evidence.
  const raw = s.request, plan = raw.plan;
  const claims = raw.receipts.filter(r => r.proofId === o.proofId && r.receiptId === o.medicalReceiptId);
  if (claims.length !== 1) reject("Exactly one source-owned original medical payment required");
  const r = claims[0]!;
  const destination = r.destination, receiptEvidence = r.evidence, planEvidence = plan.planEvidence;
  if (destination === null || receiptEvidence === null || planEvidence === null)
    reject("Original medical expense requires sourced receipt, plan and owned destination");
  const graceEnd = plan.yearEnd?.kind === "grace_period" ? plan.yearEnd.incurredEndExclusive : null;
  // A verified grace period can admit a prior-plan medical expense after the
  // nominal year ends, but cannot silently extend a shorter member enrollment.
  const incurredCovered = (span: { readonly start: string; readonly endExclusive: string }) =>
    span.start <= r.incurredAt && (r.incurredAt < span.endExclusive
      || (graceEnd !== null && span.endExclusive === plan.period.endExclusive && r.incurredAt < graceEnd));
  const fields = ["householdId", "personId", "employerId", "planId", "planYearId"] as const;
  if (fields.some(field => plan[field] !== o[field] || r[field] !== o[field])
    || r.memberId !== o.memberId || r.payeeId !== o.payeeId
    || r.incurredAt !== o.incurredAt.slice(0, 10)
    || r.payment.status !== "paid" || r.payment.paidAt !== o.paidAt.slice(0, 10)
    || r.payment.paymentRef !== o.expensePaymentId || !r.payment.amount.equals(o.amount)
    || !r.incurredAmount.equals(o.amount)
    || destination.accountId !== o.bankAccountId || destination.ownerId !== o.personId
    || destination.householdId !== o.householdId
    || ![plan.period, plan.coverage].every(incurredCovered))
    reject("Original BANK debit requires matching, source-owned PAID medical expense");
  const members = plan.members.filter(m => m.memberId === o.memberId && incurredCovered(m.coverage));
  if (members.length !== 1) reject("Original medical member and coverage must match sourced plan");
  // Only evidence needed to establish the original payment must be available at
  // its date. A future adjudication or deposit is never required or invented.
  for (const e of [planEvidence, members[0]!.evidence, receiptEvidence, destination.evidence]) {
    const matches = s.provenance.filter(p => same(p.evidence, e));
    if (matches.length !== 1) reject("Actual payment evidence must have exactly one independent source timestamp");
    stamp(matches[0]!, o.paidAt, context);
    if (matches[0]!.knownAt.slice(0, 10) < e.asOf)
      reject("Original payment evidence predates its source as-of");
  }
  originalRegistration(s);
}
/** Re-evaluate the entire immutable raw history. Never accept a copied receipt callback. */
export function qualifyFsaCashSource(s: FsaCashSource, context: D2SettlementSourceContext): D2FsaSettlementReceipt {
  try { return deriveReceipt(s, context); }
  catch (error) {
    if (error instanceof FsaCashIncomplete) throw error;
    return reject(error instanceof Error ? error.message : "Malformed raw FSA source");
  }
}
function deriveReceipt(s: FsaCashSource, context: D2SettlementSourceContext): D2FsaSettlementReceipt {
  qualifyFsaCashOriginal(s, context);
  const { request: raw, original: o, deposit: d } = s;
  stamp(d, d.settledAt, context); order(d.executionOrder);
  // A bank posting cannot be independently confirmed before it occurred.
  // Prior plan approval may exist, but it is not posted BANK evidence.
  if (d.status === "posted" && (d.publishedAt < d.settledAt || d.knownAt < d.settledAt))
    reject("Confirmed BANK deposit evidence cannot predate actual settlement");
  const evidence: FsaSource[] = [];
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object" || v instanceof Money) return;
    if ("ruleSnapshotId" in v && "sourcePublication" in v) evidence.push(v as FsaSource);
    else Object.values(v).forEach(visit);
  };
  visit(raw); if (s.yearChain) visit(s.yearChain);
  for (const e of evidence) {
    const matches = s.provenance.filter(p => same(p.evidence, e));
    if (matches.length !== 1) reject("Every raw source needs one exact independent publication/availability record");
    stamp(matches[0]!, d.settledAt, context);
    if (matches[0]!.knownAt.slice(0, 10) < e.asOf) reject("Evidence predates its source as-of");
  }
  if (raw.priorCarryover) reject("No authenticated applied carryover port");
  if (s.yearChain) {
    const chain = bindFsaYearChain(s.yearChain);
    if (!chain.appliedCarryover.isZero() || (!same(raw, s.yearChain.prior) && !same(raw, s.yearChain.successor)))
      reject("Year-chain does not bind this raw request");
  }
  const evaluation = evaluateFsa(raw);
  const r = raw.receipts.find(r => r.proofId === o.proofId && r.receiptId === o.medicalReceiptId);
  const c = evaluation.claims.find(c => c.proofId === o.proofId && c.receiptId === o.medicalReceiptId)
    ?? reject("Qualified FSA claim evidence required");
  const h = r?.reimbursement;
  if (!r || !h || h.status !== "settled")
    throw new FsaCashIncomplete("source_not_qualified", "Settled reimbursement evidence required");
  if (evaluation.entitlementCoverage !== "complete" || !r || !c || raw.receipts.filter(r => r.proofId === o.proofId).length !== 1
    || !h || h.status !== "settled" || !h.settlementId || !h.settledAt || r.payment.status !== "paid" || !r.decision
    || d.status !== "posted" || raw.evaluatedAt !== d.settledAt.slice(0, 10)
    || h.settledAt !== d.settledAt.slice(0, 10) || o.paidAt > d.settledAt
    || r.payment.paidAt !== o.paidAt.slice(0, 10) || r.incurredAt !== o.incurredAt.slice(0, 10)
    || r.payment.paymentRef !== o.expensePaymentId || !r.payment.amount.equals(o.amount)
    || !r.incurredAmount.equals(o.amount) || !r.decision.eligibleAmount.equals(o.amount)
    || !c.grossAmount.equals(d.amount) || !h.approvedAmount.equals(d.amount)
    || !c.restrictedEntitlementDelta.equals(d.amount.negated()) || !exact(d.amount) || !d.amount.isPositive()
    || !exact(d.bankCashBefore) || c.allocations.some(a => a.planYearId !== o.planYearId)
    || [raw.plan, r].some(p => ["householdId", "personId", "employerId", "planId", "planYearId"].some(k =>
      p[k as keyof FsaIdentity] !== o[k as keyof FsaIdentity]))
    || r.memberId !== o.memberId || r.payeeId !== o.payeeId || c.destinationAccountId !== o.bankAccountId
    || d.bankAccountId !== o.bankAccountId || d.ownerId !== o.personId || d.householdId !== o.householdId
    || ![d.sourceApprovalId, d.paymentApprovalId, d.authorizationId, d.paymentId, d.entitlementConsumptionId].every(text))
    reject("Owner eligibility, proof, paid expense, exact plan allocation and actual approved BANK deposit must agree");
  const stamps = [o, d, ...s.provenance];
  stamps.forEach(p => stamp(p, d.settledAt, context));
  const latest = (field: "publishedAt" | "knownAt") => stamps.reduce((a, p) => a > p[field] ? a : p[field], stamps[0]![field]);
  const source: D2FsaSourceBinding = { kind: "fsa_paid_reimbursement", sourceId: s.sourceId,
    sourceVersion: canonicalSerialize({ version: s.version, inputs: fsaCashSourceFingerprint(s) }),
    // Full-content change detection, never authentication of the publisher.
    ruleVersion: c.ruleSnapshotId, publishedAt: latest("publishedAt"), knownAt: latest("knownAt"),
    householdId: domainId("household", o.householdId), personId: domainId("person", o.personId),
    sourceApprovalId: d.sourceApprovalId, paymentApprovalId: d.paymentApprovalId,
    planId: o.planId, planYearId: o.planYearId, memberId: o.memberId, payeeId: o.payeeId,
    medicalReceiptId: o.medicalReceiptId, expensePaymentId: o.expensePaymentId, incurredAt: o.incurredAt,
    entitlementConsumptionId: d.entitlementConsumptionId, ...(d.executionOrder ? { executionOrder: d.executionOrder } : {}) };
  const traceIds = [...new Set([...c.traceRefs, o.approvalId, d.sourceApprovalId, d.paymentApprovalId])].map(calculationTraceId);
  return immutableConfiguration<D2FsaSettlementReceipt>({ schemaVersion: "d2-shared/settlement-receipt/v1", kind: source.kind,
    id: `${key(s)}:receipt`, operationId: depositOperationId(s), authorizationId: d.authorizationId,
    claimId: claimId(c.claimId), paymentId: d.paymentId, recognitionId: recognitionId(`${key(s)}:recognition`),
    settlementId: settlementId(h.settlementId ?? reject("Settled plan reimbursement ID required")), effectiveAt: d.settledAt, bankAccountId: o.bankAccountId,
    // Shared receipt convention is pre-original; the source independently confirms the later actual opening.
    bankCashBefore: d.bankCashBefore.plus(o.amount), amount: d.amount, eligibleExpense: o.amount, entitlementConsumed: d.amount,
    source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source), traceIds, originalTransaction: originalTransaction(s),
    paymentTransaction: createAccountingTransaction({ id: accountingTransactionId(depositOperationId(s)), type: "fsa_expense_reimbursement",
      date: d.settledAt, traceRefs: traceIds.map(id => calculationTraceRef(id)), legs: [
        createAccountingLeg({ type: "cash", posting: "debit", amount: d.amount, accountId: o.bankAccountId, cashFlowClass: "operating" }),
        createAccountingLeg({ type: "expense", posting: "credit", amount: d.amount })] }) });
}
