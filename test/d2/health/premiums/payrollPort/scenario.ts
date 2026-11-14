import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingTransaction } from "../../../../../src/accounting/index.js";
import { domainId } from "../../../../../src/identity/index.js";
import { createAuthoritativeState, registerPayrollHealthSourceAuthority, type PayrollHealthDeductionEvidence,
  type AppliedPayrollHealthWageBase, type PayrollHealthSourceBinding } from "../../../../../src/state/index.js";
import { taxBalanceIds, type PayrollWithholdingElection } from "../../../../../src/simulation/tax/contracts.js";
import type { PayrollContributionAllocation } from "../../../../../src/simulation/payrollContributions.js";
import { calculationTraceId, calculationTraceRef } from "../../../../../src/lineage/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { instant } from "../../../../../src/time/index.js";
import { decimal, money, Quantity, SHARE, Unit } from "../../../../../src/values/index.js";
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
  readonly bases?: readonly AppliedPayrollHealthWageBase[];
  readonly allocations?: readonly PayrollContributionAllocation[];
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
  const withholding = (options.jurisdictions ?? ["US:FEDERAL"]).map(jurisdiction => jurisdiction === "US:FEDERAL" ? election : {
    ...election, id: `${election.id}:${jurisdiction}`, jurisdiction, calculation: { kind: "fixed" as const, amount: money("0") },
  });
  const allocations = [...(options.allocations ?? [])].sort((a, b) => a.priority - b.priority);
  const opening = createAuthoritativeState({
    accounts: {
      [ids.cash]: { id: ids.cash, ownerId: ids.person, kind: "checking", cash: money("0") },
      ...Object.fromEntries(allocations.map(({ accountId }) => [accountId, {
        id: accountId, ownerId: ids.person, kind: "retirement" as const, cash: money("0"),
      }])),
    },
    positions: Object.fromEntries(allocations.map(({ accountId, positionId }) => [positionId, {
      id: positionId, accountId, quantity: Quantity.parse("0", SHARE), price: money("100"), carryingValue: money("0"),
    }])),
  });
  const input = { id, incomeId: ids.income, ownerId: ids.person, occurrenceId: source.occurrenceId, at: date, gross: money("1000"),
    depositAccountId: ids.cash, allocations, withholding };
  // The source fixture signs fixed employee deductions. Employer allocations
  // have separate postings and never reduce the signed paycheck's BANK credit.
  const employeeDeductions = allocations.filter(item => !item.policy.character.startsWith("employer_")).map(item => {
    if (item.calculation.kind !== "fixed") throw new Error("The synthetic employer original requires fixed deductions");
    return { id: `${id}:${item.id}`, character: item.policy.character, amount: item.calculation.amount, positionId: item.positionId };
  }).filter(item => item.amount.isPositive());
  let expenseKey = 0n;
  for (const character of key) expenseKey = BigInt.asUintN(48, expenseKey * 131n + BigInt(character.codePointAt(0)!));
  const employeeAmount = money(options.amount ?? "150"), expenseId = domainId("health-expense", `149c0000-0000-4000-8000-${expenseKey.toString(16).padStart(12, "0")}`);
  const deduction: PayrollHealthDeductionEvidence = { version: "payroll-health-deduction/v1", source, at: date, gross: money("1000"), employeeAmount,
    employerAmount: money("400"), expenseId, contributions: employeeDeductions.map(({ positionId: _position, ...item }) => item),
    withholding: withholding.map(e => ({ electionId: e.id, jurisdiction: e.jurisdiction, amount: e.calculation.kind === "fixed" ? e.calculation.amount : money("0") })), deductionInventory: [source.claimId],
    appliedJurisdictionWageBases: options.bases ?? [] };
  const taxYear = date.slice(0, 4);
  const withheld = deduction.withholding.reduce((total, credit) => total.plus(credit.amount), money("0"));
  const contributed = employeeDeductions.reduce((total, item) => total.plus(item.amount), money("0"));
  const takeHome = deduction.gross.minus(withheld).minus(employeeAmount).minus(contributed);
  const transaction = createAccountingTransaction({ id, date, type: "payroll_income", traceRefs: [
    calculationTraceRef(calculationTraceId(`payroll:${id}:gross:${ids.income}`),
      allocations.flatMap(item => item.policy.limits.map(binding => domainId("tax-rule", binding.ruleId)))),
    ...withholding.map(e => calculationTraceRef(calculationTraceId(
      `payroll:withholding:${e.id}:income:${ids.income}:owner:${ids.person}:employer:${employer}:occurrence:${source.occurrenceId}:year:${taxYear}:jurisdiction:${e.jurisdiction}:provenance:${e.provenance}`,
    ))),
  ], legs: [
    ...employeeDeductions.map(item => createAccountingLeg({
      type: "asset", posting: "debit", entityId: item.positionId, amount: item.amount,
      quantity: new Quantity(item.amount.amount.times(decimal("0.01")), SHARE),
    })),
    ...deduction.withholding.filter(credit => credit.amount.isPositive()).map(credit => createAccountingLeg({
      type: "asset", posting: "debit", entityId: taxBalanceIds(credit.jurisdiction, taxYear).creditPositionId,
      amount: credit.amount, quantity: Quantity.parse(credit.amount.amount.toString(), Unit.of("usd_tax_credit")),
    })),
    ...(employeeAmount.isPositive() ? [createAccountingLeg({ type: "expense", posting: "debit", entityId: expenseId, amount: employeeAmount })] : []),
    ...(takeHome.isPositive() ? [createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.cash, amount: takeHome, cashFlowClass: "operating" })] : []),
    createAccountingLeg({ type: "income", posting: "credit", amount: deduction.gross }),
  ] });
  originals.set(source.sourceId, { deduction, transaction });
  return { opening, input: { ...input, healthPremium: { source, context } }, deduction, transaction, election };
}
