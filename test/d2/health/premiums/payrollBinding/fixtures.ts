import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../../src/accounting/index.js";
import { domainId } from "../../../../../src/identity/index.js";
import type { AppliedPayrollHealthWageBase, PayrollHealthSourceBinding } from "../../../../../src/state/index.js";
import { civilDate, instant, type Instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { proposePremiums, type PremiumCoverage, type PremiumRequest, type PremiumSource } from "../../../../../src/simulation/d2/health/premiums/index.js";
import { type OriginalPayrollPremiumFacts, type PayrollPremiumOriginals, type PayrollPremiumSourceWindow } from "../../../../../src/simulation/d2/health/premiums/payrollBinding/index.js";

export const person = domainId("person", "14800000-0000-4000-8000-000000000001");
export const household = domainId("household", "14800000-0000-4000-8000-000000000002");
export const bank = domainId("account", "14800000-0000-4000-8000-000000000003");
const position = domainId("position", "14800000-0000-4000-8000-000000000004");
const known = instant("2023-12-01T12:00:00.000Z");
export const context = { asOf: instant("2023-12-31T23:59:59.000Z"), dataCutoff: instant("2023-12-31T23:59:59.000Z") };
export const source: PremiumSource = { start: civilDate("2023-01-01"), endExclusive: civilDate("2035-01-01"),
  ruleSnapshotId: "synthetic-quote", jurisdiction: "US", ruleFamily: "employer_quote", sourcePublication: "Synthetic employer original; not statutory law",
  asOf: civilDate("2023-12-01"), version: "v1", projectionStatus: "verified" };
const window = (id: string): PayrollPremiumSourceWindow => ({ sourceId: id, sourceVersion: "original/v1", publishedAt: known, knownAt: known,
  effectiveFrom: instant("2024-01-01T00:00:00.000Z"), effectiveUntil: instant("2035-01-01T00:00:00.000Z") });
export const coverage = (id = "A", start = "2024-01-01", end = "2024-02-01", anchor = "2024-01-15", employer = "employer-A"): PremiumCoverage => ({
  id, householdId: household, memberIds: [person, "child"], planId: `plan:${id}`, planFamily: "health_insurance", sponsorId: employer, recipientId: "insurer",
  start: civilDate(start), endExclusive: civilDate(end),
  route: { kind: "pretax_payroll", payerId: person, sponsorId: employer, employmentId: `job:${employer}`, evidence: source },
  eligibility: [person, "child"].map(memberId => ({ memberId, householdId: household, planId: `plan:${id}`, eligible: true, evidence: source })),
  quote: { quoteId: `quote:${id}`, source, gross: money("300"), employer: money("100"), member: money("200"),
    schedule: { anchor: civilDate(anchor), frequency: "monthly", interval: 1, invalidDay: "skip", amountBasis: "per_occurrence_no_proration" } },
});

/** Independent authored source rows: no resolver reads or echoes submitted input. */
export function payroll(c: PremiumCoverage, at: Instant = instant("2024-01-15T17:00:00.000Z"), effective = civilDate(at.slice(0, 10)), key = `${c.id}:${at}`) {
  const incomeId = `salary:${c.sponsorId}`;
  const year = Number(at.slice(0, 4)), month = Number(at.slice(5, 7));
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const s: PayrollHealthSourceBinding = { version: "payroll-health-source/v1", sourceId: `original:${key}`, sourceVersion: "original/v1",
    householdId: household, ownerId: person, incomeId, employerId: c.sponsorId, occurrenceId: `wage:${key}`,
    transactionId: accountingTransactionId(`tx:recognition:income:${incomeId}:${at}`), bankAccountId: bank,
    coverageId: c.id, planId: c.planId, electionId: `election:${c.id}`, claimId: `claim:${key}`, dueAt: at,
    periodStart: instant(`${at.slice(0, 7)}-01T00:00:00.000Z`),
    periodEnd: instant(`${nextMonth}-01T00:00:00.000Z`), publishedAt: known, knownAt: known };
  const w = window(`employment:${c.sponsorId}`);
  const requiredBases: OriginalPayrollPremiumFacts["requiredBases"] = [
    { jurisdiction: "US:FEDERAL", regime: "income", ruleId: "federal", ruleVersion: "synthetic/v1" },
    { jurisdiction: "US:FEDERAL", regime: "payroll", ruleId: "federal", ruleVersion: "synthetic/v1" },
    { jurisdiction: "US:STATE", regime: "income", ruleId: "state", ruleVersion: "synthetic/v1" },
    { jurisdiction: "US:LOCAL", regime: "periodic", ruleId: "local", ruleVersion: "synthetic/v1" },
  ];
  const bases: readonly AppliedPayrollHealthWageBase[] = requiredBases.map(r => ({ ...r, publishedAt: known, knownAt: known,
    effectiveFrom: w.effectiveFrom, effectiveUntil: w.effectiveUntil, legalPlanSourceId: `legal:${r.jurisdiction}:${r.regime}`, legalPlanSourceVersion: "synthetic/v1",
    before: money("950"), exclusion: c.quote.member, after: money("950").minus(c.quote.member) }));
  const facts: OriginalPayrollPremiumFacts = { source: s, employmentId: `job:${c.sponsorId}`, employment: w, bankOwnerId: person, gross: money("1000"),
    transaction: createAccountingTransaction({ id: s.transactionId, date: at, type: "payroll_income", legs: [
      createAccountingLeg({ type: "asset", posting: "debit", entityId: position, amount: money("150") }),
      createAccountingLeg({ type: "cash", posting: "debit", accountId: bank, amount: money("850"), cashFlowClass: "operating" }),
      createAccountingLeg({ type: "income", posting: "credit", amount: money("1000") }),
    ] }),
    quote: { operationId: JSON.stringify(["premium", c.id, c.planId, effective]), quoteId: c.quote.quoteId,
      version: c.quote.source.version, asOf: c.quote.source.asOf, schedule: c.quote.schedule, premiumEffectiveAt: effective, payrollAt: at,
      allocation: "full_quoted_occurrence", grossAmount: c.quote.gross, employerAmount: c.quote.employer, employeeAmount: c.quote.member },
    election: { id: s.electionId, incomeId, ownerId: person, employerId: c.sponsorId, coverageId: c.id, planId: c.planId,
      evidenceWindow: window(`plan-election:${c.id}`), taxCharacter: "section125", section125Qualified: true },
    inventoryComplete: true, contributions: [{ id: `contribution:${key}`, character: "traditional_401k", amount: money("50") }],
    withholding: ["US:FEDERAL", "US:STATE", "US:LOCAL"].map((jurisdiction, i) => ({
      election: { id: `withholding:${c.sponsorId}:${jurisdiction}`, version: "payroll-withholding/v1", incomeId, ownerId: person,
        employerId: c.sponsorId, depositAccountId: bank, jurisdiction, start: w.effectiveFrom, end: w.effectiveUntil,
        provenance: "synthetic original #101 election", userConfirmed: true, calculation: { kind: "fixed", amount: money(i === 0 ? "100" : "0") } },
      amount: money(i === 0 ? "100" : "0"),
    })), deductionInventory: [s.claimId], alreadyAllocated: false, requiredBases, legalInventoryComplete: true };
  return { facts, bases };
}
export function scenario(coverages: readonly PremiumCoverage[] = [coverage()], rows = coverages.map(c => payroll(c))) {
  const request: PremiumRequest = { householdId: household, memberIds: [person, "child"],
    period: { start: civilDate(coverages.reduce((a, c) => a < c.start ? a : c.start, "9999-12-31")),
      endExclusive: civilDate(coverages.reduce((a, c) => a > c.endExclusive ? a : c.endExclusive, "0001-01-01")) },
    coverages, coordination: [] };
  const payrolls = new Map(rows.map(r => [r.facts.source.sourceId, r.facts]));
  const legal = new Map(rows.map(r => [r.facts.source.sourceId, r.bases]));
  const originals: PayrollPremiumOriginals = { premiumRequest: () => request,
    payroll: (id, version) => { const f = payrolls.get(id); return f?.source.sourceVersion === version ? f : undefined; },
    legalBases: (id, version) => version === "original/v1" ? legal.get(id) : undefined };
  return { request, payrolls, legal, input: { context, proposals: proposePremiums(request).proposals,
    bindings: rows.map(r => r.facts.source), originals } };
}
