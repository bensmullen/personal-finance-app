import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingTransaction } from "../../../../../src/accounting/index.js";
import { domainId } from "../../../../../src/identity/index.js";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { taxBalanceIds } from "../../../../../src/simulation/tax/contracts.js";
import { fsaScopeId, type FsaIdentity, type FsaSource, type FsaRequest, type FsaReceipt } from "../../../../../src/simulation/d2/health/fsa/index.js";
import { fsaPayrollDigest, type FsaOriginalContribution, type FsaOriginalPaycheck, type FsaOriginalWindow,
  type FsaPayrollOriginals } from "../../../../../src/simulation/d2/health/fsa/payrollBinding/index.js";

export const scope: FsaIdentity = { householdId: "synthetic-household", personId: "synthetic-employee",
  employerId: "synthetic-employer", planId: "synthetic-plan", planYearId: "2026" };
export const bank = domainId("account", "14800000-0000-4000-8000-000000000003");
const retirement = domainId("position", "14800000-0000-4000-8000-000000000004");
const hsa = domainId("position", "14800000-0000-4000-8000-000000000005");
const known = instant("2025-12-01T00:00:00.000Z");
export const context = { asOf: instant("2026-12-31T23:59:59.999Z"), dataCutoff: instant("2026-12-31T23:59:59.999Z") };
export const window = (sourceId: string): FsaOriginalWindow => ({ sourceId, sourceVersion: "synthetic/v1", publishedAt: known, knownAt: known,
  effectiveFrom: instant("2025-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z") });
export const evidence = (ruleFamily: string, subjectId: string): FsaSource => ({ ruleFamily, subjectId,
  ruleSnapshotId: `synthetic:${ruleFamily}:${subjectId}`, version: "synthetic/v1", jurisdiction: "US-test",
  sourcePublication: "Authored synthetic fixture; NOT legal or employer evidence", projectionStatus: "verified",
  start: civilDate("2025-01-01"), endExclusive: civilDate("2028-01-01"), asOf: civilDate("2025-12-01"), verifiedThrough: civilDate("2027-12-31") });
export const request = (): FsaRequest => {
  const period = { start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") };
  return { evaluatedAt: civilDate("2026-12-31"), historyThrough: civilDate("2026-12-31"), priorCarryover: null, payroll: [], receipts: [],
    historyEvidence: evidence("health_fsa_complete_history", fsaScopeId(scope)),
    plan: { ...scope, instrumentFamily: "health_fsa", period, coverage: period,
      planEvidence: evidence("health_fsa_plan", fsaScopeId(scope)),
      annualElection: money("1000"), employerContribution: money("500"), planElectionLimit: money("2000"), planEmployerLimit: money("500"),
      law: { planYearId: scope.planYearId, electionLimit: money("2500"), employerLimit: money("500"), totalLimit: money("3000"),
        evidence: evidence("health_fsa_law", scope.planYearId) },
      uniformCoverage: "full_election_and_employer", allocationPolicy: "prior_first_then_current/incurred_submitted_proof/v1",
      members: [{ memberId: scope.personId, coverage: period,
        evidence: evidence("health_fsa_member", [fsaScopeId(scope), scope.personId].map(encodeURIComponent).join("/")) }],
      termination: { kind: "none" }, submitEndExclusive: civilDate("2027-04-01"), yearEnd: { kind: "forfeiture" } } };
};
/** Literal $1,000 gross = $50 401k + $20 HSA + $100 federal + $10 state + $5 local + $815 cash. */
export function employee(id = "employee-1", date = "2026-01-15", amount = "100") {
  const at = instant(`${date}T17:00:00.000Z`), incomeId = "synthetic-salary";
  const journal = window(`journal:${id}`);
  const transaction = createAccountingTransaction({ id: accountingTransactionId(`tx:recognition:income:${incomeId}:${at}`),
    date: at, type: "payroll_income", legs: [
      createAccountingLeg({ type: "asset", posting: "debit", entityId: retirement, amount: money("50") }),
      createAccountingLeg({ type: "asset", posting: "debit", entityId: hsa, amount: money("20") }),
      ...[["US:FEDERAL", "100"], ["US:STATE", "10"], ["US:LOCAL", "5"]].map(([jurisdiction, value]) =>
        createAccountingLeg({ type: "asset", posting: "debit", entityId: taxBalanceIds(jurisdiction!, "2026").creditPositionId, amount: money(value!) })),
      createAccountingLeg({ type: "cash", posting: "debit", accountId: bank, cashFlowClass: "operating", amount: money("815") }),
      createAccountingLeg({ type: "income", posting: "credit", amount: money("1000") }),
    ] });
  const paycheck: FsaOriginalPaycheck = { incomeId, occurrenceId: `occurrence:${id}`, transactionId: transaction.id,
    employmentId: "synthetic-job", employerId: scope.employerId, ownerId: scope.personId, householdId: scope.householdId,
    dueAt: at, periodStart: instant("2026-01-01T00:00:00.000Z"), periodEnd: instant("2027-01-01T00:00:00.000Z"),
    employment: window("job"), bank: { id: bank, ownerId: scope.personId, householdId: scope.householdId, kind: "BANK", evidence: window("bank") },
    gross: money("1000"), netCash: money("815"), journal, signedJournalDigest: fsaPayrollDigest(transaction), inventoryComplete: true,
    fsaClaimIds: [], contributions: [{ id: "401k", character: "traditional_401k", positionId: retirement, amount: money("50") },
      { id: "hsa", character: "employee_hsa", positionId: hsa, amount: money("20") }],
    withholding: [["US:FEDERAL", "100"], ["US:STATE", "10"], ["US:LOCAL", "5"]].map(([jurisdiction, value]) => ({ amount: money(value!),
      election: { id: `withholding:${jurisdiction}`, version: "payroll-withholding/v1", incomeId, ownerId: scope.personId, employerId: scope.employerId,
        depositAccountId: bank, jurisdiction: jurisdiction!, start: instant("2026-01-01T00:00:00.000Z"), provenance: "synthetic original #101",
        userConfirmed: true, calculation: { kind: "fixed", amount: money(value!) } } })) };
  const row: FsaOriginalContribution = { ref: window(`contribution:${id}`), effectiveAt: at,
    contribution: { ...scope, contributionId: id, effectiveAt: civilDate(date), sourceAccountId: incomeId,
      contributionSource: "employee_salary_reduction", amount: money(amount), status: "pending", postingRef: null,
      evidence: evidence("health_fsa_payroll", id) },
    claimId: `claim:${id}`, authorizationId: `authorization:${id}`, authorization: window(`authorization:${id}`), alreadyAllocated: false,
    election: { id: "synthetic-election", scope, memberId: scope.personId, instrumentFamily: "health_fsa", annualEmployee: money("1000"), annualEmployer: money("500"),
      electedAt: instant("2025-12-15T00:00:00.000Z"), userConfirmed: true, planPermits: true, evidence: window("election") },
    funding: { kind: "employee", paycheck }, wageBases: { complete: true, required: ["US:FEDERAL", "US:STATE", "US:LOCAL"],
      facts: ["US:FEDERAL", "US:STATE", "US:LOCAL"].map(jurisdiction => ({ jurisdiction, regime: "income", ruleId: `synthetic:${jurisdiction}`, evidence: window(jurisdiction) })) } };
  return { row, transaction };
}
export const grant = (id = "grant-1", amount = "25"): FsaOriginalContribution => {
  const e = employee(id);
  return { ...e.row, contribution: { ...e.row.contribution, contributionSource: "employer", sourceAccountId: "employer-funding", amount: money(amount) },
    funding: { kind: "employer_grant", employerId: scope.employerId, fundingOwnerId: scope.employerId, fundingSourceId: "employer-funding", grantId: id,
      authorizedAmount: money(amount), planPermits: true, evidence: window(`grant:${id}`) } };
};
export const paidReceipt = (): FsaReceipt => ({ ...scope, proofId: "proof", receiptId: "receipt", memberId: scope.personId, payeeId: "doctor",
  expenseType: "qualified_medical_service", incurredAt: civilDate("2026-01-03"), submittedAt: civilDate("2026-01-04"), incurredAmount: money("200"),
  payment: { status: "paid", paidAt: civilDate("2026-01-03"), amount: money("200"), paymentRef: "medical-payment" },
  destination: { accountId: bank, ownerId: scope.personId, householdId: scope.householdId, kind: "bank_cash", evidence: evidence("health_fsa_destination", bank) },
  evidence: evidence("health_fsa_receipt", "proof"), decision: { kind: "eligible", eligibleAmount: money("200"), decidedAt: civilDate("2026-01-04"), evidence: evidence("health_fsa_adjudication", "proof") },
  reimbursement: { status: "settled", approvedAmount: money("200"), adjudicatedAt: civilDate("2026-01-04"), allocations: [{ planYearId: "2026", amount: money("200") }],
    settlementId: "medical-settlement", settledAt: civilDate("2026-01-05"), evidence: evidence("health_fsa_reimbursement", "proof") } });

export function scenario(authored = [employee(), employee("employee-2", "2026-01-30")], grants: FsaOriginalContribution[] = [grant()]) {
  const rows = new Map([...authored.map(a => a.row), ...grants].map(r => [r.contribution.contributionId, r]));
  const journals = new Map<string, AccountingTransaction>(authored.map(a => [a.row.funding.kind === "employee" ? a.row.funding.paycheck.journal.sourceId : "", a.transaction]));
  let current = { ...request(), payroll: [...rows.values()].map(r => r.contribution) };
  const originals: FsaPayrollOriginals = {
    request: () => ({ ref: window("original-request"), planRef: window(current.plan.planEvidence!.ruleSnapshotId),
      lawRef: window(current.plan.law!.evidence.ruleSnapshotId), request: current }),
    contribution: id => rows.get(id),
    journal: r => r.sourceVersion === "synthetic/v1" ? journals.get(r.sourceId) : undefined,
  };
  return { rows, journals, get request(): FsaRequest { return current; },
    setRequest: (r: FsaRequest) => { current = { ...r, payroll: [...r.payroll] }; },
    input: { scope, context, originals } };
}
