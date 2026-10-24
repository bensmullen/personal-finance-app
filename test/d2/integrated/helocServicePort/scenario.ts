import { createHash } from "node:crypto";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { domainId } from "../../../../src/identity/index.js";
import { calculationTraceId } from "../../../../src/lineage/index.js";
import { claimId, recognitionId, settlementId } from "../../../../src/semantics/identity.js";
import { createAuthoritativeState, d2SettlementSourceFingerprint, registerD2SettlementSourceAuthority,
  type D2HelocSettlementReceipt } from "../../../../src/state/index.js";
import { proposeHelocPhaseServicing, type PhaseServicingRequest } from "../../../../src/simulation/d2/debt/heloc/phaseServicing.js";
import type { Source } from "../../../../src/simulation/d2/debt/heloc/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { money, USD, type Money } from "../../../../src/values/index.js";
export const ids = { bank: domainId("account", "149b0000-0000-4000-8000-000000000001"),
  person: domainId("person", "149b0000-0000-4000-8000-000000000002"), household: domainId("household", "149b0000-0000-4000-8000-000000000003"),
  principal: domainId("liability", "149b0000-0000-4000-8000-000000000004"), charges: domainId("liability", "149b0000-0000-4000-8000-000000000005") };
const known = instant("2023-01-01T00:00:00.000Z");
export const context = { asOf: instant("2026-02-01T00:00:00.000Z"), dataCutoff: instant("2026-02-01T00:00:00.000Z") };
export const opening = () => createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, ownerId: ids.person, kind: "checking", cash: money("500") } },
  liabilities: { [ids.principal]: { id: ids.principal, balance: money("1000") }, [ids.charges]: { id: ids.charges, balance: money("0") } } });
export interface Original { request: PhaseServicingRequest; bankDebit: { id: string; amount: Money; at: string; authenticated: boolean }; bankOpening: Money; feeNature: D2HelocSettlementReceipt["feeNature"] }
export const sources = new Map<string, Original>();
export const authorityStatus = { available: true, calls: 0 };
export function original(key = "jan", interest = "5.10", monthIndex = 0): Original {
  const year = 2026 + Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const period = { start: civilDate(`${year}-${String(month).padStart(2, "0")}-01`), endExclusive: civilDate(`${next}-01`) };
  const phase = { ...period, kind: "amortizing" as const, endExclusive: civilDate(`${year + 1}-${String(month).padStart(2, "0")}-01`) };
  const source: Source = { start: civilDate("2020-01-01"), endExclusive: civilDate("2040-01-01"), householdId: ids.household, personId: ids.person,
    lineId: `line:${key}`, liabilityAccountId: ids.principal, bankAccountId: ids.bank, ruleSnapshotId: "synthetic-heloc/v1", jurisdiction: "US:TEST",
    sourcePublication: "synthetic original issuer contract", publishedAt: civilDate("2023-01-01"), asOf: civilDate("2023-01-01"), version: "1", projectionStatus: "verified" };
  const quoteSource = { ...source, sourcePublication: "synthetic independent complete issuer statement" };
  const amount = money("100").plus(money(interest));
  return { bankOpening: money("500"), bankDebit: { id: `actual-bank-debit:${key}`, amount, at: period.endExclusive, authenticated: true }, feeNature: "none",
    request: { line: { period, evaluatedAsOf: period.endExclusive, householdId: ids.household, ownerId: ids.person, borrowerId: ids.person,
      lineId: source.lineId, liabilityAccountId: ids.principal, bankAccountId: ids.bank, currency: USD, source, creditLimit: money("2000"), openingPrincipal: money("1000"),
      openedAt: civilDate("2024-01-01"), closedAt: phase.start, maturityAt: phase.endExclusive, drawWindow: { start: civilDate("2024-01-01"), endExclusive: phase.start },
      revokedAt: null, phases: [{ start: civilDate("2024-01-01"), endExclusive: phase.start, kind: "interest_only_draw" }, phase], rate: null,
      interest: { source, dayCount: "actual_365_fixed", compounding: "simple", posting: "period_end_after_daily_activity", rounding: "half_up", dueAt: period.endExclusive }, events: [] },
    checkpoint: { originalAt: civilDate("2024-01-01"), originalPrincipal: money("1000"), originalSource: source, closingAt: period.start,
      closingPrincipal: money("1000"), source, history: [] },
    terms: { source, phase, accrualPeriod: period, dueAt: period.endExclusive, convention: "fixed_per_installment", method: "issuer_quoted", rounding: "half_up",
      total: amount, openingPrincipal: money("1000"), closingPrincipal: money("900"), allocation: { interest: money(interest), principal: money("100"), source: quoteSource }, finalQuote: null,
      issuerQuote: { documentId: `document:${key}`, issuerId: "synthetic-issuer", evidenceKind: "original_complete_issuer_statement", source: quoteSource, period, dueAt: period.endExclusive,
        householdId: ids.household, borrowerId: ids.person, lineId: source.lineId, liabilityAccountId: ids.principal, bankAccountId: ids.bank,
        openingPrincipal: money("1000"), closingPrincipal: money("900"), interest: money(interest), principal: money("100"), fees: money("0"), total: amount } },
    payment: { operationId: `service:${key}`, claimId: `heloc/${source.lineId}/${period.start}/${period.endExclusive}/service`, effectiveAt: period.endExclusive, actorId: ids.person,
      bankAccountId: ids.bank, amount, source, status: "authorized", authorization: { authorizationId: `authorization:${key}`, source }, observed: null,
      funding: { fundingId: `funding:${key}`, effectiveAt: period.endExclusive, amount, source } } } };
}
export function reconstruct(key: string, raw: Original): D2HelocSettlementReceipt | undefined {
  const result = proposeHelocPhaseServicing(raw.request), p = result.proposals[0];
  if (!p || !raw.bankDebit.authenticated || raw.bankDebit.at !== p.dueAt || !raw.bankDebit.amount.equals(p.gross_due)) return undefined;
  const r = raw.request, t = r.terms!, due = instant(`${p.dueAt}T00:00:00.000Z`);
  const source = { kind: "heloc_phase_service" as const, version: "heloc-phase-source/v1" as const, sourceId: key, sourceVersion: "original/v1", ruleVersion: r.line.source.ruleSnapshotId,
    publishedAt: known, knownAt: due, householdId: ids.household, personId: ids.person, sourceApprovalId: `source-approval:${key}`, paymentApprovalId: `payment-approval:${key}`,
    issuerId: t.issuerQuote?.issuerId ?? "synthetic-issuer", lineId: p.lineId, liabilityId: ids.principal, checkpointId: `checkpoint:${key}`, historyVersion: "actual-history/v1",
    documentId: t.issuerQuote?.documentId ?? r.line.source.sourcePublication, documentVersion: t.issuerQuote?.source.version ?? t.source.version, method: t.method, phase: t.phase.kind,
    originalInputDigest: createHash("sha256").update(canonicalSerialize(raw.request)).digest("hex"),
    phaseStart: instant(`${t.phase.start}T00:00:00.000Z`), phaseEnd: instant(`${t.phase.endExclusive}T00:00:00.000Z`),
    periodStart: instant(`${p.period.start}T00:00:00.000Z`), periodEnd: instant(`${p.period.endExclusive}T00:00:00.000Z`), dueAt: due,
    interestClaimId: p.interestClaimId, fundingId: r.payment.funding!.fundingId, bankDebitId: raw.bankDebit.id };
  const charges = p.interest_due.plus(p.fees_due);
  const paymentTransaction = createAccountingTransaction({ id: accountingTransactionId(`bank-posting:${key}`), type: "heloc_service", date: due,
    legs: [createAccountingLeg({ type: "liability", posting: "debit", entityId: ids.principal, amount: p.principal_due }),
      ...(charges.isPositive() ? [createAccountingLeg({ type: "liability", posting: "debit", entityId: ids.charges, amount: charges })] : []),
      createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount: p.gross_due, cashFlowClass: "operating" })] });
  const originalTransaction = charges.isZero() ? paymentTransaction : createAccountingTransaction({ id: accountingTransactionId(`charge-posting:${key}`), type: "heloc_interest", date: due,
    legs: [createAccountingLeg({ type: "expense", posting: "debit", amount: charges }), createAccountingLeg({ type: "liability", posting: "credit", entityId: ids.charges, amount: charges })] });
  return { schemaVersion: "d2-shared/heloc-settlement/v1", kind: "heloc_phase_service", id: `receipt:${key}`, operationId: r.payment.operationId,
    authorizationId: r.payment.authorization!.authorizationId, claimId: claimId(p.claimId), paymentId: raw.bankDebit.id, recognitionId: recognitionId(p.interestClaimId), settlementId: settlementId(`settlement:${key}`),
    effectiveAt: due, bankAccountId: ids.bank, bankCashBefore: raw.bankOpening, amount: p.gross_due, traceIds: [calculationTraceId(p.interestClaimId)],
    sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source), source, originalTransaction, paymentTransaction,
    liabilityId: ids.principal, openingPrincipal: p.finalBalanceIntent.opening, principalPaid: p.principal_due, interest: p.interest_due, fee: p.fees_due,
    feeNature: raw.feeNature, chargeLiabilityId: charges.isZero() ? null : ids.charges, originalProof: charges.isZero() ? "principal_only" : "recognized_charge" };
}
registerD2SettlementSourceAuthority("heloc_phase_service", { qualify: binding => {
  authorityStatus.calls++;
  const raw = sources.get(binding.sourceId), receipt = raw && authorityStatus.available ? reconstruct(binding.sourceId, raw) : undefined;
  return receipt ? { status: "qualified", receipt } : { status: "incomplete", reason: "source_unavailable" };
} });
export const admitted = (key = "jan", interest = "5.10") => {
  const raw = original(key, interest); sources.set(key, raw);
  const receipt = reconstruct(key, raw);
  if (!receipt) throw new Error("Invalid synthetic original HELOC fixture");
  return receipt;
};
