import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../accounting/index.js";
import { domainId } from "../../../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { claimId, recognitionId, settlementId } from "../../../../semantics/identity.js";
import { d2SettlementSourceFingerprint, registerD2SettlementSourceAuthority,
  type D2HelocSettlementReceipt, type D2SettlementSourceContext } from "../../../../state/index.js";
import { instant, type Instant } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../run.js";
import { proposeHelocPhaseServicing, type PhaseServicingRequest } from "../../debt/heloc/phaseServicing.js";
import type { Source } from "../../debt/heloc/index.js";
import type { ConfirmedHelocDraws } from "../helocDraws/index.js";

export interface HelocSourceWitness {
  readonly source: Source;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
}
/** Original complete issuer archive. Authentication comes from the independent
 * reader, never the document's labels, a receipt, or portable configuration. */
export interface HelocServiceDocument {
  readonly sourceId: string;
  readonly version: string;
  readonly issuerId: string;
  readonly documentId: string;
  readonly documentVersion: string;
  readonly sourceApprovalId: string;
  readonly checkpointId: string;
  readonly historyVersion: string;
  readonly request: PhaseServicingRequest;
  readonly provenance: readonly HelocSourceWitness[];
  readonly bankDebitId: string;
  readonly chargeLiabilityId: string | null;
  readonly feeNature: D2HelocSettlementReceipt["feeNature"];
  readonly priorDraws: readonly ConfirmedHelocDraws[];
}
export interface HelocBankDebit {
  readonly id: string;
  readonly version: string;
  readonly status: "posted" | "authorized" | "scheduled";
  readonly classification: "BANK";
  readonly householdId: string;
  readonly personId: string;
  readonly issuerId: string;
  readonly lineId: string;
  readonly liabilityId: string;
  readonly bankAccountId: string;
  readonly operationId: string;
  readonly authorizationId: string;
  readonly fundingId: string;
  readonly approvalId: string;
  readonly settlementId: string;
  readonly effectiveAt: Instant;
  readonly authorizedAt: Instant;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly amount: Money;
  readonly bankCashBefore: Money;
  readonly executionOrder?: { readonly sequenceId: string; readonly position: number };
}
export interface HelocServicingSourcePorts {
  readonly issuer: { readonly read: (sourceId: string) => HelocServiceDocument | undefined };
  readonly bank: { readonly read: (bankDebitId: string) => HelocBankDebit | undefined };
}
export interface HelocServicingIncomplete {
  readonly status: "incomplete";
  readonly diagnosticSeam: "S7";
  readonly reason: "source_unavailable" | "source_not_qualified";
}
export interface QualifiedHelocService {
  readonly status: "qualified";
  readonly document: HelocServiceDocument;
  readonly bank: HelocBankDebit;
  readonly receipt: D2HelocSettlementReceipt;
}
let ports: HelocServicingSourcePorts | undefined;
export const serviceInstant = (date: string): Instant => instant(`${date}T00:00:00.000Z`);
export const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const named = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const dated = (s: Instant): boolean => { try { return instant(s) === s; } catch { return false; } };
const incomplete = (reason: HelocServicingIncomplete["reason"]): HelocServicingIncomplete =>
  ({ status: "incomplete", diagnosticSeam: "S7", reason });

/** Register once at composition, also in every cold restore process. The codec
 * cannot install a publisher. The two readers retrieve authenticated originals. */
export function registerHelocServicingSourcePorts(value: HelocServicingSourcePorts): void {
  if (ports) throw new Error("HELOC_SERVICING_SOURCE_PORT_DUPLICATE");
  registerD2SettlementSourceAuthority("heloc_phase_service", { qualify: (binding, context) => {
    if (binding.kind !== "heloc_phase_service") return { status: "incomplete", reason: "source_not_qualified" };
    const q = qualifyHelocServicingSource(binding.sourceId, context);
    return q.status === "qualified" ? { status: "qualified", receipt: q.receipt }
      : { status: "incomplete", reason: q.reason };
  } });
  ports = Object.freeze({ issuer: Object.freeze({ read: value.issuer.read }), bank: Object.freeze({ read: value.bank.read }) });
}

/** Rebuild both signed journals. B1 alone evaluates interest and allocations;
 * neither a B1 proposal nor its payment status authorizes an actual BANK debit. */
export function qualifyHelocServicingSource(sourceId: string, context: D2SettlementSourceContext): QualifiedHelocService | HelocServicingIncomplete {
  let raw: HelocServiceDocument | undefined, debit: HelocBankDebit | undefined;
  try { raw = ports?.issuer.read(sourceId); debit = raw && ports?.bank.read(raw.bankDebitId); }
  catch { return incomplete("source_unavailable"); }
  if (!raw || !debit) return incomplete("source_unavailable");
  try {
    const d = immutableConfiguration(raw), b = immutableConfiguration(debit), r = d.request;
    const result = proposeHelocPhaseServicing(r), p = result.proposals[0], t = r.terms;
    if (!p || !t || result.obligationCoverage !== "complete") return incomplete("source_not_qualified");
    const due = serviceInstant(p.dueAt), payment = r.payment, line = r.line;
    if (![context.asOf, context.dataCutoff, b.effectiveAt, b.authorizedAt, b.publishedAt, b.knownAt].every(dated)
      || context.dataCutoff > context.asOf || b.authorizedAt > b.effectiveAt || b.publishedAt > b.knownAt
      || b.knownAt !== due || b.publishedAt !== due || b.knownAt > context.dataCutoff || b.publishedAt > context.asOf)
      return incomplete("source_not_qualified");
    if (d.sourceId !== sourceId || ![sourceId, d.version, d.issuerId, d.documentId, d.documentVersion, d.sourceApprovalId,
      d.checkpointId, d.historyVersion, b.id, b.version, b.approvalId, b.settlementId].every(named)
      || b.id !== d.bankDebitId || b.status !== "posted" || b.classification !== "BANK"
      || b.effectiveAt !== due || b.householdId !== line.householdId || b.personId !== line.borrowerId
      || line.ownerId !== b.personId || b.issuerId !== d.issuerId || b.lineId !== line.lineId
      || b.liabilityId !== line.liabilityAccountId || b.bankAccountId !== line.bankAccountId
      || b.operationId !== payment.operationId || !payment.authorization || !payment.funding
      || payment.status === "scheduled" || b.authorizationId !== payment.authorization.authorizationId
      || b.fundingId !== payment.funding.fundingId || !payment.funding.amount.equals(p.gross_due)
      || !b.amount.equals(p.gross_due)) return incomplete("source_not_qualified");
    if (t.issuerQuote && (t.issuerQuote.issuerId !== d.issuerId || t.issuerQuote.documentId !== d.documentId
      || t.issuerQuote.source.version !== d.documentVersion)) return incomplete("source_not_qualified");
    if (t.method === "b1_daily_simple" && p.interestEvidence !== "b1_computed") return incomplete("source_not_qualified");
    const exact = (m: Money): boolean => m instanceof Money && m.currency.equals(USD) && !m.isNegative() && m.amount.fitsScale(2);
    if (![b.amount, b.bankCashBefore, p.principal_due, p.interest_due, p.fees_due].every(exact)
      || !b.amount.isPositive() || (p.fees_due.isZero() ? d.feeNature !== "none" : d.feeNature !== "documented_service_expense"))
      return incomplete("source_not_qualified");
    const sources: Source[] = [];
    const visit = (v: unknown): void => {
      if (!v || typeof v !== "object" || v instanceof Money) return;
      if ("sourcePublication" in v && "ruleSnapshotId" in v) { sources.push(v as Source); return; }
      for (const child of Object.values(v)) visit(child);
    };
    visit(r); visit(d.priorDraws);
    const unique = [...new Map(sources.map(s => [canonicalSerialize(s), s])).values()];
    const deadlines = new Map<string, Instant>();
    const bind = (s: Source, at: string): void => {
      const key = canonicalSerialize(s), prior = deadlines.get(key), deadline = serviceInstant(at);
      if (!prior || deadline < prior) deadlines.set(key, deadline);
    };
    bind(line.source, line.period.start); bind(line.interest.source, line.period.start);
    bind(r.checkpoint.originalSource, r.checkpoint.originalAt); bind(r.checkpoint.source, r.checkpoint.closingAt);
    bind(t.source, line.period.start); bind(payment.source, payment.effectiveAt);
    if (line.rate) {
      bind(line.rate.source, line.period.start);
      if (line.rate.legalMaximum) bind(line.rate.legalMaximum.source, line.period.start);
      for (const reset of line.rate.resets) bind(reset.source, reset.effectiveAt);
      for (const observation of line.rate.observations) bind(observation.source, observation.observedAt);
    }
    for (const h of r.checkpoint.history) bind(h.source, h.effectiveAt);
    if (d.provenance.length !== unique.length) return incomplete("source_not_qualified");
    for (const s of unique) {
      const witnesses = d.provenance.filter(w => same(w.source, s));
      if (witnesses.length !== 1) return incomplete("source_not_qualified");
      const w = witnesses[0]!;
      if (![w.publishedAt, w.knownAt].every(dated) || w.publishedAt > w.knownAt || w.knownAt > due
        || w.knownAt > (deadlines.get(canonicalSerialize(s)) ?? due)
        || w.knownAt > context.dataCutoff || w.publishedAt > context.asOf
        || s.publishedAt !== w.publishedAt.slice(0, 10) || s.asOf !== w.knownAt.slice(0, 10))
        return incomplete("source_not_qualified");
    }
    const order = b.executionOrder;
    if (order && (!named(order.sequenceId) || !Number.isSafeInteger(order.position) || order.position < 0)) return incomplete("source_not_qualified");
    const charges = p.interest_due.plus(p.fees_due);
    if (charges.isZero() ? d.chargeLiabilityId !== null : !d.chargeLiabilityId || d.chargeLiabilityId === line.liabilityAccountId)
      return incomplete("source_not_qualified");
    const principalId = domainId("liability", line.liabilityAccountId), bankId = domainId("account", line.bankAccountId);
    const chargeId = d.chargeLiabilityId === null ? null : domainId("liability", d.chargeLiabilityId);
    const traceIds = [p.interestClaimId, sourceId, d.version, d.documentId, b.id, b.version].map(calculationTraceId);
    const traceRefs = traceIds.map(id => calculationTraceRef(id));
    const paymentTransaction = createAccountingTransaction({ id: accountingTransactionId(`heloc-service-posting:${payment.operationId}`), type: "heloc_service", date: due, traceRefs,
      legs: [...(p.principal_due.isPositive() ? [createAccountingLeg({ type: "liability", posting: "debit", entityId: principalId, amount: p.principal_due })] : []),
        ...(chargeId ? [createAccountingLeg({ type: "liability", posting: "debit", entityId: chargeId, amount: charges })] : []),
        createAccountingLeg({ type: "cash", posting: "credit", accountId: bankId, amount: p.gross_due, cashFlowClass: "operating" })] });
    const originalTransaction = charges.isZero() ? paymentTransaction : createAccountingTransaction({
      id: accountingTransactionId(`${p.interestClaimId}/recognize`), type: "heloc_interest", date: due, traceRefs,
      legs: [createAccountingLeg({ type: "expense", posting: "debit", amount: charges }),
        createAccountingLeg({ type: "liability", posting: "credit", entityId: chargeId!, amount: charges })] });
    const publishedAt = d.provenance.reduce((at, w) => w.publishedAt > at ? w.publishedAt : at, b.publishedAt);
    const knownAt = d.provenance.reduce((at, w) => w.knownAt > at ? w.knownAt : at, b.knownAt);
    const source = { kind: "heloc_phase_service" as const, version: "heloc-phase-source/v1" as const,
      sourceId, sourceVersion: d.version, ruleVersion: line.source.ruleSnapshotId, publishedAt, knownAt,
      householdId: domainId("household", line.householdId), personId: domainId("person", line.borrowerId),
      sourceApprovalId: d.sourceApprovalId, paymentApprovalId: b.approvalId, issuerId: d.issuerId,
      lineId: line.lineId, liabilityId: principalId, checkpointId: d.checkpointId, historyVersion: d.historyVersion,
      documentId: d.documentId, documentVersion: d.documentVersion,
      originalInputDigest: sha256(canonicalSerialize({ document: d, bank: b })), method: t.method, phase: t.phase.kind,
      phaseStart: serviceInstant(t.phase.start), phaseEnd: serviceInstant(t.phase.endExclusive), periodStart: serviceInstant(p.period.start),
      periodEnd: serviceInstant(p.period.endExclusive), dueAt: due, interestClaimId: p.interestClaimId,
      fundingId: b.fundingId, bankDebitId: b.id, ...(order ? { executionOrder: order } : {}) };
    const receipt: D2HelocSettlementReceipt = { schemaVersion: "d2-shared/heloc-settlement/v1", kind: "heloc_phase_service",
      id: `heloc-service:${b.id}`, operationId: payment.operationId, authorizationId: b.authorizationId,
      claimId: claimId(p.claimId), paymentId: b.id, recognitionId: recognitionId(`${p.interestClaimId}/recognize`),
      settlementId: settlementId(b.settlementId), effectiveAt: due, bankAccountId: bankId, bankCashBefore: b.bankCashBefore,
      amount: p.gross_due, traceIds, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source), source,
      originalTransaction, paymentTransaction, liabilityId: principalId, openingPrincipal: p.finalBalanceIntent.opening,
      principalPaid: p.principal_due, interest: p.interest_due, fee: p.fees_due, feeNature: d.feeNature,
      chargeLiabilityId: chargeId, originalProof: charges.isZero() ? "principal_only" : "recognized_charge" };
    return immutableConfiguration({ status: "qualified", document: d, bank: b, receipt });
  } catch { return incomplete("source_not_qualified"); }
}
