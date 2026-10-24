import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingTransaction } from "../../../../../src/accounting/index.js";
import { domainId } from "../../../../../src/identity/index.js";
import { createAuthoritativeState, registerPayrollHealthSourceAuthority, type PayrollHealthDeductionEvidence,
  type AppliedPayrollHealthWageBase, type PayrollHealthSourceBinding } from "../../../../../src/state/index.js";
import { payrollContributionCandidate, type PayrollContributionAllocation } from "../../../../../src/simulation/payrollContributions.js";
import type { PayrollWithholdingElection } from "../../../../../src/simulation/tax/contracts.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { instant } from "../../../../../src/time/index.js";
import { money, Quantity, SHARE } from "../../../../../src/values/index.js";
import { taxHouseholdIds as ids } from "../../../../fixtures/t1aTaxHouseholds.js";

export { ids };
export const at = instant("2024-01-15T00:00:00.000Z");
export const context = { asOf: instant("2023-12-31T00:00:00.000Z"), dataCutoff: instant("2023-12-31T00:00:00.000Z") };
const known = instant("2023-12-01T00:00:00.000Z");
/** Synthetic independent employer originals, not populated from qualify input. */
export const originals = new Map<string, { deduction: PayrollHealthDeductionEvidence; transaction: AccountingTransaction }>();
export const sourceStatus = { available: true, calls: 0 };
registerPayrollHealthSourceAuthority({ qualify: binding => {
  sourceStatus.calls++;
  const original = originals.get(binding.sourceId);
  if (!sourceStatus.available || !original) return { status: "incomplete", reason: "source_unavailable" };
  if (canonicalSerialize(original.deduction.source) !== canonicalSerialize(binding)) return { status: "incomplete", reason: "source_not_qualified" };
  return { status: "qualified", ...original };
} });
export const wageBase = (jurisdiction: string, regime: AppliedPayrollHealthWageBase["regime"], ruleId: string,
  exclusion = "150", before = "1000"): AppliedPayrollHealthWageBase => ({
  jurisdiction, regime, ruleId, ruleVersion: "synthetic-v1", legalPlanSourceId: `synthetic-independent-plan:${jurisdiction}:${regime}`,
  legalPlanSourceVersion: "original/v1", publishedAt: known, knownAt: known,
  effectiveFrom: instant("2024-01-01T00:00:00.000Z"), effectiveUntil: instant("2025-01-01T00:00:00.000Z"),
  before: money(before), exclusion: money(exclusion), after: money(before).minus(money(exclusion)),
});
export function paycheckFixture(key = "jan", options: {
  readonly amount?: string; readonly employer?: string; readonly at?: typeof at;
  readonly transactionId?: string; readonly jurisdictions?: readonly string[];
  readonly bases?: readonly AppliedPayrollHealthWageBase[]; readonly allocations?: readonly PayrollContributionAllocation[];
} = {}) {
  const date = options.at ?? at, employer = options.employer ?? "synthetic-job-A";
  const month = Number(date.slice(5, 7)), year = Number(date.slice(0, 4));
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const id = accountingTransactionId(options.transactionId ?? `tx:recognition:income:${ids.income}:${date}`);
  const source: PayrollHealthSourceBinding = { version: "payroll-health-source/v1", sourceId: `employer-original:${key}`, sourceVersion: "original/v1",
    householdId: ids.household, ownerId: ids.person, incomeId: ids.income, employerId: employer, occurrenceId: `wage:${key}`,
    transactionId: id, bankAccountId: ids.cash, coverageId: `coverage:${employer}`, planId: `plan:${employer}`, electionId: `election:${employer}`,
    claimId: `premium:${key}`, dueAt: date, periodStart: instant(`${date.slice(0, 7)}-01T00:00:00.000Z`),
    periodEnd: instant(`${nextMonth}-01T00:00:00.000Z`),
    publishedAt: known, knownAt: known };
  const election: PayrollWithholdingElection = { id: `withholding:${employer}`, version: "payroll-withholding/v1", incomeId: ids.income, employerId: employer,
    ownerId: ids.person, depositAccountId: ids.cash, jurisdiction: "US:FEDERAL", start: instant("2024-01-01T00:00:00.000Z"),
    provenance: "synthetic original employer election", userConfirmed: true, calculation: { kind: "fixed", amount: money("100") } };
  const allocations = options.allocations ?? [];
  const withholding = (options.jurisdictions ?? ["US:FEDERAL"]).map(jurisdiction => jurisdiction === "US:FEDERAL" ? election : {
    ...election, id: `${election.id}:${jurisdiction}`, jurisdiction, calculation: { kind: "fixed" as const, amount: money("0") },
  });
  const opening = createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, ownerId: ids.person, kind: "checking", cash: money("0") },
    ...Object.fromEntries(allocations.map(a => [a.accountId, { id: a.accountId, ownerId: ids.person, kind: "retirement" as const, cash: money("0") }])) },
    positions: Object.fromEntries(allocations.map(a => [a.positionId, { id: a.positionId, accountId: a.accountId, quantity: Quantity.parse("0", SHARE), price: money("100"), carryingValue: money("0") }])) });
  const input = { id, incomeId: ids.income, ownerId: ids.person, occurrenceId: source.occurrenceId, at: date, gross: money("1000"),
    depositAccountId: ids.cash, allocations, withholding };
  // Reconstruct the independent original signed wage from fixed employer facts.
  // The test source port never reads caller-submitted receipt or journal bytes.
  const baseline = payrollContributionCandidate(opening, input);
  let expenseKey = 0n;
  for (const character of key) expenseKey = BigInt.asUintN(48, expenseKey * 131n + BigInt(character.codePointAt(0)!));
  const employeeAmount = money(options.amount ?? "150"), expenseId = domainId("health-expense", `149c0000-0000-4000-8000-${expenseKey.toString(16).padStart(12, "0")}`);
  const deduction: PayrollHealthDeductionEvidence = { version: "payroll-health-deduction/v1", source, at: date, gross: money("1000"), employeeAmount,
    employerAmount: money("400"), expenseId, contributions: Object.values(baseline.state.contributions ?? {}).filter(c => !c.character.startsWith("employer_")).map(c => ({ id: c.id, character: c.character, amount: c.amount })),
    withholding: withholding.map(e => ({ electionId: e.id, jurisdiction: e.jurisdiction, amount: e.calculation.kind === "fixed" ? e.calculation.amount : money("0") })), deductionInventory: [source.claimId],
    appliedJurisdictionWageBases: options.bases ?? [] };
  const original = baseline.transactions[0]!;
  const transaction = createAccountingTransaction({ ...original, legs: [
    ...original.legs.filter(l => l.type === "asset"),
    ...(employeeAmount.isPositive() ? [createAccountingLeg({ type: "expense", posting: "debit", entityId: expenseId, amount: employeeAmount })] : []),
    createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.cash, amount: baseline.takeHomeCash.minus(employeeAmount), cashFlowClass: "operating" }),
    ...original.legs.filter(l => l.type === "income"),
  ] });
  originals.set(source.sourceId, { deduction, transaction });
  return { opening, input: { ...input, healthPremium: { source, context } }, deduction, transaction, election };
}
