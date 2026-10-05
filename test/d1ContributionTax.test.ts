import { describe, expect, it } from "vitest";
import { domainId } from "../src/identity/index.js";
import { accountingTransactionId, createAccountingTransaction, createAccountingLeg } from "../src/accounting/index.js";
import { applyAccountingTransactionAtomically, cloneAuthoritativeState } from "../src/state/index.js";
import { decideContribution, recordContribution, type ContributionPolicy } from "../src/simulation/contributions.js";
import { runHouseholdKernel, type HouseholdKernelParticipant } from "../src/simulation/householdExecution.js";
import { compileHouseholdKernel } from "../src/simulation/r3/compiledHousehold.js";
import { createHouseholdTaxParticipant, taxCreditPositionIds } from "../src/simulation/tax.js";
import { contributionCharacters } from "../src/rules/contribution2026.js";
import { taxHouseholdFixture, taxHouseholdIds as ids } from "./fixtures/t1aTaxHouseholds.js";
import { syntheticPayroll } from "./fixtures/t1aTaxRules.js";
import { instant } from "../src/time/index.js";
import { money, Quantity, SHARE } from "../src/values/index.js";
import type { PayrollContributionAllocation } from "../src/simulation/payrollContributions.js";

const start = instant("2026-01-01T00:00:00.000Z"), until = instant("2027-01-01T00:00:00.000Z");
const accountId = domainId("account", "d1c60000-0000-4000-8000-000000000001"), positionId = domainId("position", "d1c60000-0000-4000-8000-000000000002");
const policy = (character: ContributionPolicy["character"]): ContributionPolicy => ({ character, personId: ids.person, householdId: ids.household, excessPolicy: "reject", facts: { taxYear: 2026, ageAtYearEnd: 36, taxableCompensation: money("1000"), eligiblePlanCompensation: money("1000"), workplacePlanCovered: false, filingStatus: "single", hsaCoverage: "self", hsaFullYearEligible: true }, limits: (character === "traditional_ira" ? ["ira_shared" as const] : character.endsWith("_hsa") ? ["hsa_individual" as const] : character === "after_tax_401k" || character === "employer_401k" ? ["401k_additions" as const] : ["401k_additions" as const, "401k_elective" as const]).map((kind, index) => ({ kind, ruleId: `d1c60000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`, target: { targetType: "person", targetId: ids.person }, bucketKey: kind === "401k_additions" ? "401k_additions:sponsor" : kind, includedCharacters: contributionCharacters(kind) })) });
const fixture2026 = (months = 1, payment = false) => {
  const fixture = taxHouseholdFixture({ months });
  const income = fixture.compiled.cashFlowInput!.incomes[0]!;
  const input = { ...fixture.input, simulationStart: start, catalog: [{ ...fixture.input.catalog[0]!, effectiveFrom: start, effectiveUntil: until }], incomes: [{ ...fixture.input.incomes[0]!, start: "2026-01-01" }], payments: payment ? [{ id: "jan-payment", jurisdiction: "US:FEDERAL", at: instant("2026-01-20T00:00:00.000Z"), amount: money("150"), kind: "withholding" as const }] : [], settlements: [{ id: "final", jurisdiction: "US:FEDERAL", taxYear: "2026", at: instant("2026-12-31T23:59:59.999Z") }] };
  const context = { ...fixture.context, simulationStart: start, simulationEnd: instant(months === 1 ? "2026-02-01T00:00:00.000Z" : "2026-03-01T00:00:00.000Z") };
  const opening = cloneAuthoritativeState(fixture.compiled.reconciledOpeningState);
  opening.accounts[accountId] = { id: accountId, ownerId: ids.person, kind: "retirement", cash: money("0") };
  opening.positions[positionId] = { id: positionId, accountId, quantity: Quantity.parse("0", SHARE), price: money("100"), carryingValue: money("0") };
  const compiled = { ...fixture.compiled, reconciledOpeningState: opening, participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input), cashFlowInput: { ...fixture.compiled.cashFlowInput!, incomes: [{ ...income, start, end: instant("2026-02-01T00:00:00.000Z"), growthBaseAt: instant("2026-01-15T00:00:00.000Z"), recurrence: { ...income.recurrence, anchor: instant("2026-01-15T00:00:00.000Z") } }] } };
  return { input, context, compiled };
};

describe("D1 committed contribution tax integration", () => {
  it("does not recognize opening capacity history as new payroll or IRA tax economics", () => {
    const fixture = fixture2026();
    const opening = cloneAuthoritativeState(fixture.compiled.reconciledOpeningState);
    opening.contributions = {
      historical: { source: "opening", id: "historical", at: instant("2026-01-10T00:00:00.000Z"), personId: ids.person, accountId, character: "traditional_ira", amount: money("500"), eligibleDeduction: money("500"), buckets: [] },
    };
    const compiled = { ...fixture.compiled, reconciledOpeningState: opening };
    const result = runHouseholdKernel({ kernel: compileHouseholdKernel(compiled, start), runContext: fixture.context, resultTier: "detail" });
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.statements.income.amount.toString()).toBe("1000");
    expect(result.periods[0]!.statements.expenses.amount.toString()).toBe("100");
    expect(result.periods[0]!.cash.amount.toString()).toBe("1000");
    expect(result.state.positions[positionId]!.carryingValue.isZero()).toBe(true);
    expect(Object.values(result.state.contributions!)).toHaveLength(1);
  });
  it.each([false, true])("reverses earlier accrued IRA tax without a second payment (already paid: %s)", paid => {
    const fixture = fixture2026(2, paid), at = instant("2026-02-10T00:00:00.000Z"), contributionPolicy = policy("traditional_ira");
    const participant: HouseholdKernelParticipant = { id: "ira", version: "test-v1", economicInputs: { contributionPolicy }, prepare: (_context, period) => ({ id: "ira", operations: period.start <= at && at < period.end ? [{ descriptor: { id: "ira:purchase", domain: "investments", operationClass: "investment_purchase", sequencingInstant: at, dependsOn: [], resourceAccesses: [], traceRefs: [] }, execute: opening => {
      const decision = decideContribution(opening.state, contributionPolicy, accountId, at, money("500"));
      const state = cloneAuthoritativeState(opening.state);
      const transaction = createAccountingTransaction({ id: accountingTransactionId("ira:purchase"), date: at, type: "investment_purchase", legs: [createAccountingLeg({ type: "cash", posting: "credit", amount: money("500"), accountId: ids.cash, cashFlowClass: "investing" }), createAccountingLeg({ type: "asset", posting: "debit", amount: money("500"), entityId: positionId, quantity: Quantity.parse("5", SHARE) })] });
      applyAccountingTransactionAtomically(state, transaction);
      return { ...opening, state: recordContribution(state, contributionPolicy, accountId, "ira:purchase", at, decision), facts: { transactions: [transaction], traceRefs: [] } };
    } }] : [] }) };
    const kernel = compileHouseholdKernel({ ...fixture.compiled, participants: [...fixture.compiled.participants, participant] }, start);
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" }), summary = runHouseholdKernel({ kernel, runContext: fixture.context });
    expect(detail.status, JSON.stringify(detail.diagnostics)).toBe("completed");
    expect(detail.periods[0]!.statements.expenses.amount.toString()).toBe("100");
    expect(detail.periods[1]!.statements.expenses.amount.toString()).toBe("-50");
    expect(detail.periods[1]!.statements.income.isZero()).toBe(true);
    expect(detail.periods[1]!.statements.operatingCashFlow.isZero()).toBe(true);
    expect(detail.periods[1]!.netWorth.amount.toString()).toBe("950");
    expect(detail.periods[1]!.liabilities.amount.toString()).toBe(paid ? "0" : "50");
    expect(detail.periods[1]!.cash.amount.toString()).toBe(paid ? "350" : "500");
    expect(detail.periods[1]!.transactions.filter(transaction => transaction.type === "tax_liability_reversal")).toHaveLength(1);
    expect(detail.periods.map(period => period.statements)).toEqual(summary.periods.map(period => period.statements));
    expect(Object.values(detail.state.contributions!)).toHaveLength(1);
  });
  it.each([["traditional_401k", "166.5"], ["roth_401k", "176.5"], ["after_tax_401k", "176.5"], ["employee_hsa", "158.85"], ["employer_401k", "176.5"], ["employer_hsa", "176.5"]] as const)("keeps %s tax character distinct from compensation recognition", (character, expectedTax) => {
    const fixture = fixture2026();
    const allocation: PayrollContributionAllocation = { id: "allocation", priority: 10, accountId, positionId, policy: policy(character), calculation: { kind: "fixed", amount: money("100") }, vestedFraction: "1" };
    const tax = createHouseholdTaxParticipant({ ...fixture.input, catalog: [{ ...fixture.input.catalog[0]!, payroll: syntheticPayroll }] });
    const compiled = { ...fixture.compiled, participants: [tax], cashFlowInput: { ...fixture.compiled.cashFlowInput, incomes: fixture.compiled.cashFlowInput.incomes.map(income => ({ ...income, payrollContributions: [allocation] })) } };
    const result = runHouseholdKernel({ kernel: compileHouseholdKernel(compiled, start), runContext: fixture.context, resultTier: "detail" });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.statements.expenses.amount.toString()).toBe(expectedTax);
    expect(result.periods[0]!.statements.income.amount.toString()).toBe(character.startsWith("employer_") ? "1100" : "1000");
    expect(result.periods[0]!.cash.amount.toString()).toBe(character.startsWith("employer_") ? "1000" : "900");
    expect(result.state.positions[positionId]!.carryingValue.amount.toString()).toBe("100");
  });
});
