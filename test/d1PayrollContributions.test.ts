import { describe, expect, it } from "vitest";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { deriveStatements, createStatementFlowAccumulator, deriveStatementsFromFlows, deriveVerticalSliceStatements } from "../src/statements/index.js";
import { createAccountingLeg, createAccountingTransaction, accountingTransactionId, assertBalanced } from "../src/accounting/index.js";
import { payrollContributionCandidate, type PayrollContributionAllocation } from "../src/simulation/payrollContributions.js";
import type { ContributionCharacter, ContributionPolicy } from "../src/simulation/contributions.js";
import { contributionCharacters, type D1CapacityKind, type D1ContributionFacts } from "../src/rules/contribution2026.js";
import { authoredContributionRules, stableContributionRuleId } from "../src/application/compiler/contributionAuthoring.js";
import { authorPayrollContributionPlan, durablePayrollAllocations } from "../src/application/compiler/payrollAuthoring.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { money, Quantity, SHARE, USD } from "../src/values/index.js";
import { instant } from "../src/time/index.js";

const id = (value: number) => `d1c50000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const person = domainId("person", golden.person), household = domainId("household", golden.household), cash = domainId("account", id(1));
const at = instant("2026-01-15T00:00:00.000Z");
const facts: D1ContributionFacts = { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: money("100000"), hsaFullYearEligible: true, hsaCoverage: "self" };
const policy = (character: ContributionCharacter, overrides: Partial<D1ContributionFacts> = {}, personId = String(person)): ContributionPolicy => {
  const kinds: D1CapacityKind[] = character.endsWith("_hsa") ? ["hsa_individual", ...(overrides.hsaCoverage === "family" ? ["hsa_family" as const] : [])] : ["401k_additions", ...(["traditional_401k", "roth_401k"].includes(character) ? ["401k_elective" as const] : [])];
  return { character, personId, householdId: household, facts: { ...facts, ...overrides }, excessPolicy: "reject", limits: kinds.map(kind => ({ kind, ruleId: stableContributionRuleId(kind === "hsa_family" ? household : personId, kind, 2026), target: kind === "hsa_family" ? { targetType: "household", targetId: household } : { targetType: "person", targetId: domainId("person", personId) }, bucketKey: kind === "401k_additions" ? "401k_additions:sponsor" : kind, includedCharacters: contributionCharacters(kind) })) };
};
const allocation = (number: number, character: ContributionCharacter, amount: string, overrides: Partial<D1ContributionFacts> = {}): PayrollContributionAllocation => ({ id: id(number), priority: number, accountId: domainId("account", id(number + 100)), positionId: domainId("position", id(number + 200)), policy: policy(character, overrides), calculation: { kind: "fixed", amount: money(amount) }, vestedFraction: "1" });
const opening = (allocations: readonly PayrollContributionAllocation[]) => createAuthoritativeState({ accounts: { [cash]: { id: cash, ownerId: person, kind: "checking", cash: money("0") }, ...Object.fromEntries(allocations.map(item => [item.accountId, { id: item.accountId, ownerId: domainId("person", item.policy.personId), kind: "retirement" as const, cash: money("0") }])) }, positions: Object.fromEntries(allocations.map(item => [item.positionId, { id: item.positionId, accountId: item.accountId, quantity: Quantity.parse("0", SHARE), price: money("100"), carryingValue: money("0") }])) });
const payroll = (state: ReturnType<typeof opening>, allocations: readonly PayrollContributionAllocation[], gross = "1000", key = "payroll:1") => payrollContributionCandidate(state, { id: key, incomeId: golden.income, at, gross: money(gross), depositAccountId: cash, allocations });

describe("D1 payroll recognition and shared contribution capacity", () => {
  it("balances gross salary, four employee characters, match, fixed employer benefit and HSA seed", () => {
    const allocations = [allocation(1, "traditional_401k", "100"), allocation(2, "roth_401k", "50"), allocation(3, "after_tax_401k", "25"), allocation(4, "employee_hsa", "50"),
      { ...allocation(5, "employer_401k", "0"), calculation: { kind: "match" as const, rate: "0.5", compensationCapRate: "0.06" } }, allocation(6, "employer_401k", "40"), allocation(7, "employer_hsa", "25")];
    const original = opening(allocations), result = payroll(original, allocations);
    expect(result.gross.amount.toString()).toBe("1000"); expect(result.takeHomeCash.amount.toString()).toBe("775");
    expect(result.state.positions[allocations[4]!.positionId]!.carryingValue.amount.toString()).toBe("30");
    const statements = deriveStatements(result.state, result.transactions, USD);
    expect(statements.income.amount.toString()).toBe("1095"); expect(statements.netWorth.amount.toString()).toBe("1095");
    expect(statements.operatingCashFlow.amount.toString()).toBe("775"); expect(statements.expenses.isZero()).toBe(true);
    expect(Object.values(result.state.contributions!)).toHaveLength(7);
    const additions = Object.values(result.state.contributions!).flatMap(entry => entry.buckets.filter(bucket => bucket.identity.includes("401k_additions"))).reduce((sum, bucket) => sum.plus(bucket.amount), money("0"));
    expect(additions.amount.toString()).toBe("245");
    result.transactions.forEach(assertBalanced); expect(original.accounts[cash]!.cash.isZero()).toBe(true);
  });
  it.each([[36, "24500"], [50, "32500"], [60, "35750"], [63, "35750"], [64, "32500"]])("enforces age %s elective capacity across two participant paths", (age, limit) => {
    const first = allocation(1, "roth_401k", "20000", { ageAtYearEnd: age, planHasRoth: true, priorYearSponsorWages: money("100000") });
    const second = { ...allocation(2, "traditional_401k", "20000", { ageAtYearEnd: age, planHasRoth: true, priorYearSponsorWages: money("100000") }), policy: { ...policy("traditional_401k", { ageAtYearEnd: age, planHasRoth: true, priorYearSponsorWages: money("100000") }), excessPolicy: "auto_cap" as const } };
    const result = payroll(opening([first, second]), [first, second], "50000");
    expect(Object.values(result.state.contributions!).reduce((sum, entry) => sum.plus(entry.amount), money("0")).amount.toString()).toBe(limit);
    expect(result.takeHomeCash.equals(money("50000").minus(money(limit)))).toBe(true);
  });
  it("excludes catch-up from annual additions and requires Roth catch-up for high prior sponsor wages", () => {
    const employer = allocation(2, "employer_401k", "47500", { ageAtYearEnd: 60, planHasRoth: true, priorYearSponsorWages: money("160000") });
    const employee = allocation(1, "roth_401k", "35750", { ageAtYearEnd: 60, planHasRoth: true, priorYearSponsorWages: money("160000") });
    const result = payroll(opening([employee, employer]), [employee, employer], "100000");
    const additions = Object.values(result.state.contributions!).flatMap(entry => entry.buckets.filter(bucket => bucket.identity.includes("401k_additions"))).reduce((sum, bucket) => sum.plus(bucket.amount), money("0"));
    expect(additions.amount.toString()).toBe("72000");
    const traditional = { ...employee, policy: { ...employee.policy, character: "traditional_401k" as const } };
    expect(() => payroll(opening([traditional]), [traditional], "100000")).toThrow(/must be Roth/);
  });
  it("caps employer annual additions after employee usage and rolls back a rejected payroll", () => {
    const employee = allocation(1, "after_tax_401k", "250", { eligiblePlanCompensation: money("300") });
    const employer = allocation(2, "employer_401k", "100", { eligiblePlanCompensation: money("300") });
    const original = opening([employee, employer]); expect(() => payroll(original, [employee, employer])).toThrow();
    expect(original.contributions).toBeUndefined(); expect(original.accounts[cash]!.cash.isZero()).toBe(true);
    const capped = { ...employer, policy: { ...employer.policy, excessPolicy: "auto_cap" as const } };
    const result = payroll(original, [employee, capped]);
    expect(result.state.positions[employer.positionId]!.carryingValue.amount.toString()).toBe("50");
    expect(result.takeHomeCash.amount.toString()).toBe("750");
  });
  it("shares ordinary HSA family capacity while each spouse keeps an individual catch-up", () => {
    const first = allocation(1, "employee_hsa", "5500", { ageAtYearEnd: 55, hsaCoverage: "family", hsaFamilyAllocation: money("4500") });
    const spouse = { ...allocation(2, "employee_hsa", "5250", { ageAtYearEnd: 55, hsaCoverage: "family", hsaFamilyAllocation: money("4250") }), policy: policy("employee_hsa", { ageAtYearEnd: 55, hsaCoverage: "family", hsaFamilyAllocation: money("4250") }, id(999)) };
    const original = opening([first, spouse]);
    const one = payroll(original, [first], "10000"), two = payroll(one.state, [spouse], "10000", "spouse-payroll");
    const family = Object.values(two.state.contributions!).flatMap(entry => entry.buckets.filter(bucket => bucket.identity.includes(":hsa_family:"))).reduce((sum, bucket) => sum.plus(bucket.amount), money("0"));
    expect(family.amount.toString()).toBe("8750");
    expect(Object.values(two.state.contributions!).reduce((sum, entry) => sum.plus(entry.amount), money("0")).amount.toString()).toBe("10750");
    const extra = { ...allocation(3, "employer_hsa", "1", { ageAtYearEnd: 55, hsaCoverage: "family", hsaFamilyAllocation: money("4500") }), accountId: first.accountId, positionId: first.positionId };
    expect(() => payroll(two.state, [extra], "1000", "extra-payroll")).toThrow();
  });
  it("round-trips durable salary allocation, rule and plan-scope identities", () => {
    const authored = authorPayrollContributionPlan(createGoldenHouseholdDraft(), { primitiveId: id(888), investmentId: golden.retirementInvestment, incomeId: golden.income, priority: 10, character: "traditional_401k", calculation: { kind: "percent", rate: "0.05" }, planKey: "sponsor", vestedFraction: "1", excessPolicy: "reject", facts: { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: "100000" } });
    const imported = importPersonalModelJson(exportPersonalModelJson(authored));
    expect(durablePayrollAllocations(imported)).toEqual(durablePayrollAllocations(authored));
    expect(authoredContributionRules(golden.person, ["401k_additions"], 2026, { planKey: "sponsor" })[0]!.contribution_limits).toMatchObject([{ bucket_key: "401k_additions:sponsor" }]);
  });
});

describe("signed statement postings", () => {
  it("reconciles a tax accrual and partial credit reversal in direct and streamed derivation", () => {
    const liability = domainId("liability", id(777));
    const state = createAuthoritativeState({ liabilities: { [liability]: { id: liability, balance: money("60") } } });
    const accrual = createAccountingTransaction({ id: accountingTransactionId("tax:first"), date: at, type: "tax_liability", legs: [createAccountingLeg({ type: "tax", posting: "debit", amount: money("100") }), createAccountingLeg({ type: "liability", posting: "credit", entityId: liability, amount: money("100") })] });
    const reversal = createAccountingTransaction({ id: accountingTransactionId("tax:reversal"), date: at, type: "tax_liability_reversal", legs: [createAccountingLeg({ type: "tax", posting: "credit", amount: money("40") }), createAccountingLeg({ type: "liability", posting: "debit", entityId: liability, amount: money("40") })] });
    const accumulator = createStatementFlowAccumulator(USD); accumulator.add(accrual); accumulator.add(reversal);
    const direct = deriveStatements(state, [accrual, reversal], USD), streamed = deriveStatementsFromFlows(state, accumulator.snapshot(), USD), vertical = deriveVerticalSliceStatements(state, [accrual, reversal], USD);
    expect(direct).toEqual(streamed); expect(direct.expenses.amount.toString()).toBe("60"); expect(direct.liabilities.amount.toString()).toBe("60");
    expect(vertical.netIncome.amount.toString()).toBe("-60"); expect(direct.operatingCashFlow.isZero()).toBe(true);
  });
});
