import { domainId } from "../../../../src/identity/index.js";
import { createAuthoritativeState, type AuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, Money, USD } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { fsaScopeId, type FsaPlan, type FsaReceipt, type FsaSource, type FsaRequest } from "../../../../src/simulation/d2/health/fsa/index.js";
import { fsaCashSourceFingerprint, type FsaCashSource, type FsaCashInput } from "../../../../src/simulation/d2/integration/fsaCash/index.js";

export const uuid = (n: number) => `202f0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { household: domainId("household", uuid(1)), person: domainId("person", uuid(2)),
  bank: domainId("account", uuid(3)), other: domainId("person", uuid(4)) };
export const at = (date: string) => instant(`${date}T12:00:00.000Z`);
export const publication = { publishedAt: at("2025-01-01"), knownAt: at("2025-01-02") };
const span = { start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") };
export function evidence(ruleFamily: string, subjectId: string): FsaSource {
  return { start: civilDate("2025-01-01"), endExclusive: civilDate("2030-01-01"), ruleFamily, subjectId,
    ruleSnapshotId: `synthetic:${ruleFamily}:${subjectId}`, jurisdiction: "US:synthetic", sourcePublication: "Fixed artificial plan; not law",
    version: "synthetic/v1", asOf: civilDate("2025-01-01"), verifiedThrough: civilDate("2029-12-31"), projectionStatus: "verified" };
}
export function provenance(request: unknown): FsaCashSource["provenance"] {
  const found = new Map<string, FsaSource>();
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object" || v instanceof Money) return;
    if ("ruleSnapshotId" in v && "sourcePublication" in v) found.set(canonicalSerialize(v), v as FsaSource);
    else Object.values(v).forEach(visit);
  };
  visit(request);
  return [...found.values()].map(e => ({ evidence: e, ...publication }));
}
/** Independent raw employer/medical/BANK source store; never stores shared receipts. */
export function source(label = "one", amount = "1000", paid = "2026-01-10", settled = "2026-02-15"): FsaCashSource {
  const who = { householdId: ids.household, personId: ids.person, employerId: "synthetic-employer", planId: "synthetic-plan", planYearId: "2026" };
  const scope = fsaScopeId(who), proofId = `proof:${label}`, medicalReceiptId = `medical:${label}`;
  const plan: FsaPlan = { ...who, instrumentFamily: "health_fsa", period: span, coverage: span,
    annualElection: money("2000"), employerContribution: money("0"), planElectionLimit: money("2000"), planEmployerLimit: money("0"),
    planEvidence: evidence("health_fsa_plan", scope), law: { planYearId: who.planYearId, electionLimit: money("2000"),
      employerLimit: money("0"), totalLimit: money("2000"), evidence: evidence("health_fsa_law", who.planYearId) },
    uniformCoverage: "full_election_and_employer", allocationPolicy: "prior_first_then_current/incurred_submitted_proof/v1",
    members: [{ memberId: ids.person, coverage: span,
      evidence: evidence("health_fsa_member", [scope, ids.person].map(encodeURIComponent).join("/")) }],
    termination: { kind: "none" }, submitEndExclusive: civilDate("2027-04-01"), yearEnd: { kind: "forfeiture" } };
  const r: FsaReceipt = { ...who, proofId, receiptId: medicalReceiptId, memberId: ids.person, payeeId: "synthetic-clinic",
    expenseType: "qualified_medical_service", incurredAt: civilDate(paid), submittedAt: civilDate(paid), incurredAmount: money("1000"),
    payment: { status: "paid", paidAt: civilDate(paid), amount: money("1000"), paymentRef: `paid:${label}` },
    destination: { accountId: ids.bank, kind: "bank_cash", ownerId: ids.person, householdId: ids.household,
      evidence: evidence("health_fsa_destination", ids.bank) }, evidence: evidence("health_fsa_receipt", proofId),
    decision: { kind: "eligible", eligibleAmount: money("1000"), decidedAt: civilDate(paid), evidence: evidence("health_fsa_adjudication", proofId) },
    reimbursement: { status: "settled", approvedAmount: money(amount), allocations: [{ planYearId: who.planYearId, amount: money(amount) }],
      adjudicatedAt: civilDate(paid), settledAt: civilDate(settled), settlementId: `settlement:${label}`, evidence: evidence("health_fsa_reimbursement", proofId) } };
  const request: FsaRequest = { plan, receipts: [r], payroll: [], priorCarryover: null, evaluatedAt: civilDate(settled),
    historyThrough: civilDate(settled), historyEvidence: evidence("health_fsa_complete_history", scope) };
  return { sourceId: `source:${label}`, version: "synthetic/v1", request, provenance: provenance(request),
    original: { ...who, proofId, memberId: ids.person, payeeId: r.payeeId, medicalReceiptId, expensePaymentId: `paid:${label}`,
      approvalId: `expense-approved:${label}`, bankAccountId: ids.bank, incurredAt: at(paid), paidAt: at(paid), amount: money("1000"),
      bankCashBefore: money("1500"), ...publication },
    deposit: { status: "posted", sourceApprovalId: `plan-approved:${label}`, paymentApprovalId: `bank-approved:${label}`,
      authorizationId: `authorization:${label}`, paymentId: `deposit:${label}`, entitlementConsumptionId: `consume:${label}`,
      bankAccountId: ids.bank, householdId: ids.household, ownerId: ids.person, settledAt: at(settled), amount: money(amount),
      bankCashBefore: money("500"), ...publication } };
}
export const input = (...sources: FsaCashSource[]): FsaCashInput => ({ sources: sources.map(s => ({ sourceId: s.sourceId, expectedSource: fsaCashSourceFingerprint(s) })) });
export function fixture(months = 2, opening?: AuthoritativeState, month = "2026-01") {
  const start = instant(`${month}-01T00:00:00.000Z`);
  const state = opening ?? createAuthoritativeState({ accounts: {
    [ids.bank]: { id: ids.bank, ownerId: ids.person, kind: "checking", cash: money("1500") },
  } });
  const context = createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)), asOf: at("2029-12-31"),
    dataCutoff: at("2029-12-31"), simulationStart: start, simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: { synthetic: "#202 FSA cash" } }, start);
  return { kernel, state, context };
}
