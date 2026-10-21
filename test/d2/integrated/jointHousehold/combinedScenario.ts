import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { ValidationError } from "../../../../src/diagnostics/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { calculationTraceId } from "../../../../src/lineage/index.js";
import { applyRetirementDistributionAtomically, createAuthoritativeState, registerRetirementDistributionSourceAuthority,
  retirementDistributionSourceFingerprint, type RetirementDistributionRecord } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { registerHouseholdParticipantCodec } from "../../../../src/simulation/r3/participantCodec.js";
import { attachCardBank, registerCardBankSourcePort, type CardBankDocument } from "../../../../src/simulation/d2/integration/cardBank/index.js";
import { attachFsaCash, fsaCashSourceFingerprint, registerFsaCashSourceProvider, type FsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/index.js";
import { fsaScopeId } from "../../../../src/simulation/d2/health/fsa/index.js";
import { scenario, start } from "./scenario.js";
import { evidence, provenance } from "../fsaCash/scenario.js";
import { document as issuerDocument } from "../cardBank/scenario.js";

// Independent synthetic publisher facts, rebuilt in each process. Providers
// never accept a receipt, portable source snapshot, or replay artifact as input.
export const ids = {
  ...scenario().ids,
  retirement: domainId("account", "14920000-0000-4000-8000-000000000001"),
  card: domainId("liability", "14920000-0000-4000-8000-000000000002"),
  other: domainId("person", "14920000-0000-4000-8000-000000000003"),
};
export const at = (date: string) => instant(`${date}T12:00:00.000Z`);

export function medicalSource(): FsaCashSource {
  const who = { householdId: ids.household, personId: ids.member, employerId: "s8-employer", planId: "s8-plan", planYearId: "2026" };
  const span = { start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") };
  const scope = fsaScopeId(who), proofId = "s8-medical-proof", paid = civilDate("2026-01-10"), settled = civilDate("2026-02-16");
  const request: FsaCashSource["request"] = {
    plan: { ...who, instrumentFamily: "health_fsa", period: span, coverage: span,
      annualElection: money("2000"), employerContribution: money("0"), planElectionLimit: money("2000"), planEmployerLimit: money("0"),
      planEvidence: evidence("health_fsa_plan", scope), law: { planYearId: "2026", electionLimit: money("2000"),
        employerLimit: money("0"), totalLimit: money("2000"), evidence: evidence("health_fsa_law", "2026") },
      uniformCoverage: "full_election_and_employer", allocationPolicy: "prior_first_then_current/incurred_submitted_proof/v1",
      members: [{ memberId: ids.member, coverage: span,
        evidence: evidence("health_fsa_member", [scope, ids.member].map(encodeURIComponent).join("/")) }],
      termination: { kind: "none" }, submitEndExclusive: civilDate("2027-04-01"), yearEnd: { kind: "forfeiture" } },
    receipts: [{ ...who, proofId, receiptId: "s8-medical-receipt", memberId: ids.member, payeeId: "s8-clinic",
      expenseType: "qualified_medical_service", incurredAt: paid, submittedAt: paid, incurredAmount: money("1000"),
      payment: { status: "paid", paidAt: paid, amount: money("1000"), paymentRef: "s8-medical-paid" },
      destination: { accountId: ids.bank, kind: "bank_cash", ownerId: ids.member, householdId: ids.household,
        evidence: evidence("health_fsa_destination", ids.bank) }, evidence: evidence("health_fsa_receipt", proofId),
      decision: { kind: "eligible", eligibleAmount: money("1000"), decidedAt: paid, evidence: evidence("health_fsa_adjudication", proofId) },
      reimbursement: { status: "settled", approvedAmount: money("1000"), allocations: [{ planYearId: "2026", amount: money("1000") }],
        adjudicatedAt: paid, settledAt: settled, settlementId: "s8-plan-settlement", evidence: evidence("health_fsa_reimbursement", proofId) } }],
    payroll: [], priorCarryover: null, evaluatedAt: settled, historyThrough: settled,
    historyEvidence: evidence("health_fsa_complete_history", scope),
  };
  return { sourceId: "s8-medical-source", version: "synthetic/v1", request, provenance: provenance(request),
    original: { ...who, proofId, memberId: ids.member, payeeId: "s8-clinic", medicalReceiptId: "s8-medical-receipt",
      expensePaymentId: "s8-medical-paid", approvalId: "s8-medical-approval", bankAccountId: ids.bank,
      incurredAt: at(paid), paidAt: at(paid), amount: money("1000"), bankCashBefore: money("3000"), publishedAt: at(paid), knownAt: at(paid) },
    deposit: { status: "posted", sourceApprovalId: "s8-plan-approval", paymentApprovalId: "s8-bank-approval",
      authorizationId: "s8-deposit-authorization", paymentId: "s8-plan-deposit", entitlementConsumptionId: "s8-consumption",
      bankAccountId: ids.bank, householdId: ids.household, ownerId: ids.member, settledAt: at(settled), amount: money("1000"),
      bankCashBefore: money("1700"), publishedAt: at(settled), knownAt: at(settled) } };
}

export function cardSource(): CardBankDocument {
  const d = issuerDocument(), c = d.request.cards[0]!;
  const source = { ...c.statementSource, personId: ids.member, cardAccountId: ids.card };
  return { ...d, sourceId: "s8-issuer-source", request: { ...d.request, cards: [{ ...c,
    householdId: ids.household, personId: ids.member, cardAccountId: ids.card, statementSource: source,
    minimum: { ...c.minimum, source }, postingPolicy: { ...c.postingPolicy, source }, allocationPolicy: { ...c.allocationPolicy, source },
    charges: c.charges.map(x => ({ ...x, source })),
    payment: { ...c.payment, payerId: ids.member, sourceAccountId: ids.bank, source },
  }] }, provenance: d.provenance.map(w => ({ ...w, source })), payment: { ...d.payment,
    householdId: ids.household, personId: ids.member, cardAccountId: ids.card, bankAccountId: ids.bank, bankCashBefore: money("1900") } };
}

export function retirementSource(): RetirementDistributionRecord {
  const source = { sourceId: "s8-retirement-source", sourceVersion: "synthetic/v1", ruleVersion: "synthetic/v1",
    publishedAt: at("2025-12-01"), knownAt: at("2025-12-01"), householdId: ids.household, personId: ids.member,
    sourceApprovalId: "s8-retirement-source-approval", paymentApprovalId: "s8-retirement-payment-approval" };
  return { version: "retirement-distribution/v1", transactionId: accountingTransactionId("s8-retirement-posted"),
    originalPostingProofId: accountingTransactionId("s8-retirement-posted"), operationId: "s8-retirement-operation",
    withdrawalId: "s8-retirement-withdrawal", authorizationId: "s8-retirement-authorization",
    householdId: ids.household, personId: ids.member, sourceAccountId: ids.retirement, destinationAccountId: ids.bank,
    effectiveAt: at("2026-01-22"), taxYear: 2026, gross: money("500"), netBank: money("500"), withholding: money("0"),
    instrumentFamily: "traditional_ira", taxBucket: "pretax", beneficiaryId: null, distributionKind: "ordinary_cash",
    source, sourceEvidenceFingerprint: retirementDistributionSourceFingerprint(source), traceIds: [calculationTraceId("s8-retirement-source-trace")],
    rmdSatisfaction: "not_applied", tax: "incomplete", allocations: [] };
}

export const publishers: {
  fsa: (id: string) => FsaCashSource | undefined;
  card: (id: string) => CardBankDocument | undefined;
  retirement: (id: string) => RetirementDistributionRecord | undefined;
} = {
  fsa: id => id === "s8-medical-source" ? medicalSource() : undefined,
  card: id => id === "s8-issuer-source" ? cardSource() : undefined,
  retirement: id => id === "s8-retirement-source" ? retirementSource() : undefined,
};
export const sourceReads = { fsa: 0, card: 0, retirement: 0 };
export function resetPublishers(): void {
  sourceReads.fsa = 0; sourceReads.card = 0; sourceReads.retirement = 0;
  publishers.fsa = id => id === "s8-medical-source" ? medicalSource() : undefined;
  publishers.card = id => id === "s8-issuer-source" ? cardSource() : undefined;
  publishers.retirement = id => id === "s8-retirement-source" ? retirementSource() : undefined;
}

/** Test-only J1 writer client. No production J2 participant or RMD application. */
export function structuralRetirement(): HouseholdKernelParticipant {
  return { id: "s8_j1_structure", version: "1", portableCodec: "test-s8-j1/v1", economicInputs: { sourceId: "s8-retirement-source" },
    prepare: (context, period) => {
      const d = retirementSource();
      return { id: "s8_j1_structure", operations: d.effectiveAt < period.start || d.effectiveAt >= period.end ? [] : [{
        descriptor: { id: d.operationId, domain: "s8_j1_structure", sequencingInstant: d.effectiveAt, dependsOn: [], traceRefs: [],
          resourceAccesses: [{ kind: "account_cash", accountId: ids.retirement, mode: "consume" },
            { kind: "account_cash", accountId: ids.bank, mode: "produce" }] },
        execute: candidate => {
          const posted = candidate.state.identities.postedTransactionIds.includes(d.transactionId);
          const result = applyRetirementDistributionAtomically(candidate.state, d, context);
          if (result.status === "incomplete") throw new ValidationError({ severity: "error", code: "S8_J1_SOURCE_INCOMPLETE",
            entityType: "retirement", message: result.reason });
          return { ...candidate, facts: { transactions: posted ? []
            : [candidate.state.d2PostedTransactions![d.transactionId]!.transaction] } };
        },
      }] };
    } };
}

export function registerPublishers({ fsa = true, card = true, retirement = true } = {}): void {
  if (fsa) registerFsaCashSourceProvider({ lookup: id => { sourceReads.fsa++; return publishers.fsa(id); } });
  if (card) registerCardBankSourcePort({ read: id => { sourceReads.card++; return publishers.card(id); } });
  if (retirement) registerRetirementDistributionSourceAuthority({ qualify: binding => {
    sourceReads.retirement++;
    const distribution = publishers.retirement(binding.sourceId);
    return distribution ? { status: "qualified", distribution } : { status: "incomplete", reason: "source_unavailable" };
  } });
  registerHouseholdParticipantCodec({ codec: "test-s8-j1/v1", restore: value => {
    if (JSON.stringify(value) !== JSON.stringify({ sourceId: "s8-retirement-source" })) throw new Error("S8_J1_CODEC_INPUT_INVALID");
    return structuralRetirement();
  } });
}

export function combinedScenario({ months = 2, cash = "2000", fsa = medicalSource() } = {}) {
  // S8-1 stays untouched. Confirmed premiums/extra principal cover 2026 only;
  // longer replay never invents 2027/28 premium sources.
  const base = scenario({ months: 12, cash });
  const opening = createAuthoritativeState({ accounts: { ...base.opening.accounts,
    [ids.retirement]: { id: ids.retirement, kind: "retirement", ownerId: ids.member, cash: money("1000") } },
    positions: {}, liabilities: { ...base.opening.liabilities, [ids.card]: { id: ids.card, balance: money("1000") } } });
  const context = { ...base.context, asOf: at("2029-12-31"), dataCutoff: at("2029-12-31"),
    simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end };
  const extended = applyHouseholdExecutionOverlay(base.attached.kernel, { executionMonths: months, reconciledOpeningState: opening,
    scenarioBindings: { source: "#149 S8-2; historical synthetic dated confirmations; J1 structure only" }, participants: [structuralRetirement()] });
  const kernel = attachFsaCash(attachCardBank(extended, { sourceIds: ["s8-issuer-source"] }), {
    sources: [{ sourceId: fsa.sourceId, expectedSource: fsaCashSourceFingerprint(fsa) }],
  });
  return { base, opening, context, kernel, run: () => runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" }) };
}
