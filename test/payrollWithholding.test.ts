import { describe, expect, it } from "vitest";
import { assertBalanced } from "../src/accounting/index.js";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { money, Quantity, SHARE, USD } from "../src/values/index.js";
import { instant } from "../src/time/index.js";
import { authorPayrollWithholding, durablePayrollWithholding, type PayrollWithholdingPlan } from "../src/application/compiler/payrollWithholding.js";
import { compileCashFlow } from "../src/application/compiler/cashFlow.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { createGoldenHouseholdDraft, patchPersonalObject } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { payrollContributionCandidate, type PayrollContributionAllocation } from "../src/simulation/payrollContributions.js";
import { stableContributionRuleId } from "../src/application/compiler/contributionAuthoring.js";
import { contributionCharacters } from "../src/rules/contribution2026.js";
import { runHouseholdKernel } from "../src/simulation/householdExecution.js";
import { compileHouseholdKernel } from "../src/simulation/r3/compiledHousehold.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { createHouseholdTaxParticipant, taxBalanceIds, taxCreditPositionIds } from "../src/simulation/tax/participant.js";
import type { HouseholdTaxInput, PayrollWithholdingElection } from "../src/simulation/tax/contracts.js";
import { taxHouseholdFixture, taxHouseholdIds as ids } from "./fixtures/t1aTaxHouseholds.js";
import { deriveStatements } from "../src/statements/index.js";
import { canonicalSerialize } from "../src/simulation/run.js";
import { taxRule } from "./fixtures/t1aTaxRules.js";
import { paycheckFixture as healthPaycheckFixture } from "./d2/health/premiums/payrollPort/scenario.js";

describe("P2 health expense alongside existing retirement payroll", () => {
  it("reconciles 1000 gross = 50 retirement + 150 health + 100 withholding + 700 BANK", () => {
    const allocation: PayrollContributionAllocation = { id: "retirement-50", priority: 0,
      accountId: domainId("account", uuid(80)), positionId: domainId("position", uuid(81)),
      calculation: { kind: "fixed", amount: money("50") }, vestedFraction: "1",
      policy: { personId: ids.person, householdId: ids.household, character: "traditional_401k", excessPolicy: "reject",
        facts: { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: money("100000") },
        limits: ["401k_additions", "401k_elective"].map(kind => ({ kind: kind as "401k_additions" | "401k_elective",
          ruleId: stableContributionRuleId(ids.person, kind as "401k_additions" | "401k_elective", 2026), target: { targetType: "person", targetId: ids.person },
          bucketKey: kind === "401k_additions" ? "401k_additions:sponsor" : kind, includedCharacters: contributionCharacters(kind as "401k_additions" | "401k_elective") })) } };
    const f = healthPaycheckFixture("retirement-health", { at, allocations: [allocation] });
    const result = payrollContributionCandidate(f.opening, f.input);
    assertBalanced(result.transactions[0]!);
    expect(result.gross.equals(money("1000"))).toBe(true);
    expect(result.employeeContributions.equals(money("50"))).toBe(true);
    expect(result.takeHomeCash.equals(money("700"))).toBe(true);
    expect(result.transactions[0]!.legs.filter(l => l.type === "expense")).toEqual([expect.objectContaining({ amount: money("150") })]);
    expect(result.state.positions[taxBalanceIds("US:FEDERAL", "2026").creditPositionId]!.carryingValue.equals(money("100"))).toBe(true);
  });
});

const uuid = (n: number) => `10100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = instant("2026-01-15T00:00:00.000Z");
const election = (changes: Partial<PayrollWithholdingElection> = {}): PayrollWithholdingElection => ({
  id: uuid(1), version: "payroll-withholding/v1", incomeId: ids.income, ownerId: ids.person, employerId: "synthetic-job-A", depositAccountId: ids.cash,
  jurisdiction: "US:FEDERAL", start: instant("2024-01-01T00:00:00.000Z"), provenance: "explicit synthetic employer election", userConfirmed: true,
  calculation: { kind: "fixed", amount: money("100") }, ...changes,
});
const initial = () => createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, kind: "checking", ownerId: ids.person, cash: money("0") } } });
const paycheck = (elections: readonly PayrollWithholdingElection[], gross = "1000", allocations: readonly PayrollContributionAllocation[] = []) => payrollContributionCandidate(initial(), {
  id: "paycheck", incomeId: ids.income, ownerId: ids.person, occurrenceId: "occurrence-A", at, gross: money(gross), depositAccountId: ids.cash, allocations, withholding: elections,
});

describe("source-bound atomic paycheck", () => {
  it.each([
    [{ kind: "fixed", amount: money("123.45") } as const, "876.55", "123.45"],
    [{ kind: "percent_gross", rate: "0.123456" } as const, "876.54", "123.46"],
    [{ kind: "fixed", amount: money("0") } as const, "1000", "0"],
  ] as const)("posts exact take-home and paid credit for %j", (calculation, cash, credit) => {
    const original = initial();
    const result = payrollContributionCandidate(original, { id: "paycheck", incomeId: ids.income, ownerId: ids.person, occurrenceId: "occurrence-A", at, gross: money("1000"), depositAccountId: ids.cash, allocations: [], withholding: [election({ calculation })] });
    expect(result.state.accounts[ids.cash]!.cash.equals(money(cash))).toBe(true);
    expect(result.state.positions[taxBalanceIds("US:FEDERAL", "2026").creditPositionId]!.carryingValue.equals(money(credit))).toBe(true);
    expect(result.transactions).toHaveLength(1);
    assertBalanced(result.transactions[0]!);
    const statements = deriveStatements(result.state, result.transactions, USD);
    expect(statements.income.equals(money("1000"))).toBe(true);
    expect(statements.netWorth.equals(money("1000"))).toBe(true);
    expect(result.transactions[0]!.legs.filter(leg => leg.type === "cash")).toEqual([expect.objectContaining({ posting: "debit", accountId: ids.cash, amount: money(cash) })]);
    expect(result.withholdingEvidence).toMatchObject({ incomeId: ids.income, ownerId: ids.person, employerId: "synthetic-job-A", occurrenceId: "occurrence-A", transactionId: "paycheck", credits: [{ taxYear: "2026", jurisdiction: "US:FEDERAL" }] });
    expect(original.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(Object.keys(original.positions)).toEqual([]);
  });
  it("rounds gross fractions to cents with the existing payroll half-even policy", () => {
    expect(paycheck([election({ calculation: { kind: "percent_gross", rate: "0.005" } })], "1").takeHomeCash.equals(money("1"))).toBe(true);
    expect(paycheck([election({ calculation: { kind: "percent_gross", rate: "0.015" } })], "1").takeHomeCash.equals(money("0.98"))).toBe(true);
  });
  it("rejects excess deductions, duplicate jurisdictions, and foreign ownership atomically", () => {
    expect(() => paycheck([election({ calculation: { kind: "fixed", amount: money("1000.01") } })])).toThrow("exceed available gross");
    expect(() => paycheck([election(), election({ id: uuid(2) })])).toThrow("Conflicting active");
    expect(() => paycheck([election({ ownerId: uuid(9) })])).toThrow("exact salary source");
    expect(() => paycheck([election({ depositAccountId: domainId("account", uuid(9)) })])).toThrow("exact salary source");
    expect(initial().accounts[ids.cash]!.cash.isZero()).toBe(true);
  });
  it("honors a half-open midyear election change and does not invent gap coverage", () => {
    const boundary = instant("2026-01-15T00:00:00.000Z");
    const first = election({ end: boundary }), next = election({ id: uuid(2), start: boundary, calculation: { kind: "fixed", amount: money("200") } });
    expect(paycheck([first, next]).takeHomeCash.equals(money("800"))).toBe(true);
    expect(paycheck([first]).withholdingEvidence).toBeUndefined();
    expect(paycheck([first]).takeHomeCash.equals(money("1000"))).toBe(true);
  });
  it("posts traditional/Roth/HSA once and leaves employer benefits out of take-home deductions", () => {
    const characters = ["traditional_401k", "roth_401k", "employee_hsa", "employer_401k"] as const;
    const allocations: PayrollContributionAllocation[] = characters.map((character, index) => {
      const kinds = character === "employee_hsa" ? ["hsa_individual" as const] : ["401k_additions" as const, ...(["traditional_401k", "roth_401k"].includes(character) ? ["401k_elective" as const] : [])];
      return { id: uuid(20 + index), priority: index, accountId: domainId("account", uuid(30 + index)), positionId: domainId("position", uuid(40 + index)), calculation: { kind: "fixed", amount: money("100") }, vestedFraction: "1",
        policy: { personId: ids.person, householdId: ids.household, character, excessPolicy: "reject", facts: { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: money("100000"), hsaFullYearEligible: true, hsaCoverage: "self" },
          limits: kinds.map(kind => ({ kind, ruleId: stableContributionRuleId(ids.person, kind, 2026), target: { targetType: "person", targetId: ids.person }, bucketKey: kind === "401k_additions" ? "401k_additions:sponsor" : kind, includedCharacters: contributionCharacters(kind) })) } };
    });
    const original = createAuthoritativeState({ accounts: { ...initial().accounts, ...Object.fromEntries(allocations.map(item => [item.accountId, { id: item.accountId, ownerId: ids.person, kind: "retirement" as const, cash: money("0") }])) },
      positions: Object.fromEntries(allocations.map(item => [item.positionId, { id: item.positionId, accountId: item.accountId, quantity: Quantity.parse("0", SHARE), price: money("100"), carryingValue: money("0") }])) });
    const result = payrollContributionCandidate(original, { id: "combined", incomeId: ids.income, ownerId: ids.person, occurrenceId: "combined-pay", at, gross: money("1000"), depositAccountId: ids.cash, allocations, withholding: [election()] });
    result.transactions.forEach(assertBalanced);
    expect(result.takeHomeCash.equals(money("600"))).toBe(true);
    expect(result.employeeContributions.equals(money("300"))).toBe(true);
    expect(Object.values(result.state.contributions!)).toHaveLength(4);
    expect(allocations.every(item => result.state.positions[item.positionId]!.carryingValue.equals(money("100")))).toBe(true);
    expect(result.transactions).toHaveLength(2);
    expect(deriveStatements(result.state, result.transactions, USD).netWorth.equals(money("1100"))).toBe(true);
    const health = healthPaycheckFixture("hsa-401k-health", { at, allocations });
    const withHealth = payrollContributionCandidate(health.opening, health.input);
    withHealth.transactions.forEach(assertBalanced);
    expect(withHealth.employeeContributions.equals(result.employeeContributions)).toBe(true);
    expect(withHealth.takeHomeCash.equals(money("450"))).toBe(true);
    expect(Object.values(withHealth.state.contributions!)).toHaveLength(4);
    expect(withHealth.transactions[0]!.legs.filter(l => l.type === "expense")).toHaveLength(1);
    expect(deriveStatements(withHealth.state, withHealth.transactions, USD).netWorth.equals(money("950"))).toBe(true);
    expect(() => payrollContributionCandidate(original, { id: "excess", incomeId: ids.income, ownerId: ids.person, occurrenceId: "excess-pay", at, gross: money("1000"), depositAccountId: ids.cash, allocations, withholding: [election({ calculation: { kind: "fixed", amount: money("701") } })] })).toThrow("exceed available gross");
    expect(original.contributions).toBeUndefined();
    expect(original.accounts[ids.cash]!.cash.isZero()).toBe(true);
  });
});

const authoredSource = () => patchPersonalObject(createGoldenHouseholdDraft(), "Income", golden.income, { source: "synthetic-job-A", gross_or_net: "gross", frequency: "monthly" });
const plan = (changes: Partial<PayrollWithholdingPlan> = {}): PayrollWithholdingPlan => ({ id: uuid(1), incomeId: golden.income, ownerId: golden.person, employerId: "synthetic-job-A", depositAccountId: golden.checking,
  jurisdiction: "US:FEDERAL", effectiveDate: "2026-01-01", provenance: "explicit synthetic scenario election", userConfirmed: true, calculation: { kind: "percent_gross", rate: "0.15" }, ...changes });

describe("durable Income authoring and compilation", () => {
  it("survives save/import/reload and leaves the original canonical source untouched", () => {
    const original = authoredSource(), before = canonicalSerialize(original);
    const authored = authorPayrollWithholding(original, plan());
    const imported = importPersonalModelJson(exportPersonalModelJson(authored));
    expect(durablePayrollWithholding(imported)).toEqual(durablePayrollWithholding(authored));
    expect(canonicalSerialize(original)).toBe(before);
    const compiled = compileCashFlow(imported, { baseCurrency: "USD", simulationStart: "2026-01-01", simulationEnd: "2026-02-01", months: 1, sameInstantCashFlowOrder: "income_before_expense", executionAccountId: golden.checking });
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.value.input.incomes.find(item => item.id === golden.income)?.payrollWithholding).toEqual(durablePayrollWithholding(imported));
  });
  it.each([
    { ownerId: uuid(9) }, { employerId: "unrelated employer" }, { depositAccountId: golden.retirementAccount },
    { effectiveDate: "2026-02-30" }, { effectiveDate: "2026-02-01", expirationDate: "2026-01-01" },
    { calculation: { kind: "fixed", amount: "0.001" } }, { calculation: { kind: "fixed", amount: "-1" } },
    { calculation: { kind: "percent_gross", rate: "1.01" } }, { provenance: "" }, { userConfirmed: false },
  ])("rejects malformed or unconfirmed authorizations %j", changes => {
    expect(() => authorPayrollWithholding(authoredSource(), { ...plan(), ...changes } as PayrollWithholdingPlan)).toThrow();
  });
  it.each([{ frequency: "fortnightly" }, { gross_or_net: "unknown" }])("still rejects malformed election sources %j", changes => {
    expect(() => authorPayrollWithholding(patchPersonalObject(authoredSource(), "Income", golden.income, changes), plan())).toThrow("canonical salary source");
  });
  it("rejects a withholding election on a canonical non-salary Income source", () => {
    // income_type is immutable through the normal editor; author an explicit
    // canonical contradiction rather than asking patchPersonalObject to ignore it.
    const source = authoredSource();
    const altered = { ...source, objects: { ...source.objects, Income: source.objects.Income!.map(item =>
      typeof item === "object" && item !== null && !Array.isArray(item) && "income_id" in item && item.income_id === golden.income
        ? { ...item, income_type: "interest" } : item) } };
    expect(() => authorPayrollWithholding(altered, plan())).toThrow("canonical salary source");
  });
  it.each([{ frequency: "biweekly" }, { gross_or_net: "net" }])("does not turn unsupported Income %j into a payroll forecast", changes => {
    const model = patchPersonalObject(authoredSource(), "Income", golden.income, changes);
    const authored = authorPayrollWithholding(model, plan());
    expect(durablePayrollWithholding(importPersonalModelJson(exportPersonalModelJson(authored)))).toHaveLength(1);
    expect(compileCashFlow(authored, { baseCurrency: "USD", simulationStart: "2026-01-01", simulationEnd: "2026-02-01", months: 1, sameInstantCashFlowOrder: "income_before_expense", executionAccountId: golden.checking }).status).toBe("unsupported");
  });
  it.each([{ frequency: "biweekly" }, { gross_or_net: "net" }])("executes independent income while reporting unsupported salary %j per output", changes => {
    const authored = authorPayrollWithholding(patchPersonalObject(authoredSource(), "Income", golden.income, changes), plan());
    const salary = authored.objects.Income![0]!;
    if (typeof salary !== "object" || salary === null || Array.isArray(salary)) throw new Error("Expected canonical salary object");
    const model = { ...authored, objects: { ...authored.objects, Asset: [], Investment: [], Liability: [], Expense: [],
      Income: [salary, { ...salary, income_id: uuid(90), income_type: "interest", source: "synthetic bank interest", amount: "100", frequency: "monthly", gross_or_net: "gross", growth_model_id: null, related_event_id: null }] } };
    const before = canonicalSerialize(model);
    const compiled = compileHouseholdProjection(model, { cashFlow: { baseCurrency: "USD", simulationStart: "2026-01-01", simulationEnd: "2026-02-01", months: 1, sameInstantCashFlowOrder: "income_before_expense", executionAccountId: golden.checking } });
    expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("Expected partial household compilation");
    expect(compiled.value.cashFlowInput!.incomes.map(item => item.id)).toEqual([uuid(90)]);
    const context = { ...taxHouseholdFixture().context, scenarioId: domainId("scenario", golden.rootScenario), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z") };
    const request = { kernel: compiled.value.executionKernel!, runContext: context };
    const summary = runHouseholdKernel(request), detail = runHouseholdKernel({ ...request, resultTier: "detail" });
    const gap = expect.objectContaining({ category: "payroll_source_unsupported", entityId: golden.income });
    expect(summary.status).toBe("incomplete");
    expect(summary.outputCapabilities?.cash?.diagnostics).toContainEqual(gap);
    expect(summary.outputCapabilities?.statementIncome).toMatchObject({ status: "incomplete", diagnostics: expect.arrayContaining([gap]) });
    expect(summary.outputCapabilities?.currentPosition?.status).toBe("complete");
    expect(summary.outputCapabilities?.recurringExpenseRecognized?.status).toBe("complete");
    expect(summary.periods[0]!.statements.income.equals(money("100"))).toBe(true);
    expect(detail.periods.flatMap(period => period.transactions).some(tx => tx.type === "payroll_income")).toBe(false);
    expect(summary.state).toEqual(detail.state);
    expect(summary.outputCapabilities).toEqual(detail.outputCapabilities);
    const restored = restorePortableHouseholdReplayArtifact(structuredClone(createPortableHouseholdReplayArtifact(summary)));
    const replay = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    expect(replay.state).toEqual(summary.state);
    expect(replay.outputCapabilities).toEqual(summary.outputCapabilities);
    expect(replay.runMetadata).toEqual(summary.runMetadata);
    expect(canonicalSerialize(model)).toBe(before);
  });
  it("keeps pre-employment months independent of a later unsupported salary", () => {
    const original = patchPersonalObject(authoredSource(), "Income", golden.income, { frequency: "biweekly" });
    // Income.start_date is immutable in the editor. Construct a deliberate
    // canonical future-start fixture rather than silently discarding a patch.
    const source = { ...original, objects: { ...original.objects, Income: original.objects.Income!.map(item =>
      typeof item === "object" && item !== null && !Array.isArray(item) && "income_id" in item && item.income_id === golden.income
        ? { ...item, start_date: "2026-02-01" } : item) } };
    const authored = authorPayrollWithholding(source, plan({ effectiveDate: "2026-02-01" }));
    const salary = authored.objects.Income![0]!;
    if (typeof salary !== "object" || salary === null || Array.isArray(salary)) throw new Error("Expected Income");
    const model = { ...authored, objects: { ...authored.objects, Asset: [], Investment: [], Liability: [], Expense: [],
      Income: [salary, { ...salary, income_id: uuid(91), income_type: "interest", source: "independent bank interest", amount: "100", frequency: "monthly", gross_or_net: "gross", start_date: "2026-01-01", growth_model_id: null, related_event_id: null }] } };
    const compiled = compileHouseholdProjection(model, { cashFlow: { baseCurrency: "USD", simulationStart: "2026-01-01", simulationEnd: "2026-03-01", months: 2, sameInstantCashFlowOrder: "income_before_expense", executionAccountId: golden.checking } });
    expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("Expected a partially supported executable");
    const context = { ...taxHouseholdFixture().context, scenarioId: domainId("scenario", golden.rootScenario), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-03-01T00:00:00.000Z") };
    const result = runHouseholdKernel({ kernel: compiled.value.executionKernel!, runContext: context });
    expect(result.periods).toHaveLength(2);
    expect(result.periods[0]!.outputCapabilities?.statementIncome?.status).toBe("complete");
    expect(result.periods[1]!.outputCapabilities?.statementIncome?.status).toBe("incomplete");
    expect(result.periods[0]!.statements.income.equals(money("100"))).toBe(true);
    expect(result.periods[1]!.statements.income.equals(money("100"))).toBe(true);
    expect(result.outputCapabilities?.statementIncome?.diagnostics).toContainEqual(expect.objectContaining({ category: "payroll_source_unsupported", entityId: golden.income }));
  });
  it("rejects overlap, accepts adjacent dates, and distinguishes absent from user zero", () => {
    const first = authorPayrollWithholding(authoredSource(), plan({ expirationDate: "2026-07-01" }));
    expect(() => authorPayrollWithholding(first, plan({ id: uuid(2), effectiveDate: "2026-06-30" }))).toThrow("Overlapping");
    const changed = authorPayrollWithholding(first, plan({ id: uuid(2), effectiveDate: "2026-07-01", calculation: { kind: "fixed", amount: "0" } }));
    expect(durablePayrollWithholding(changed)).toHaveLength(2);
    expect(durablePayrollWithholding(authoredSource())).toEqual([]);
    expect(durablePayrollWithholding(changed)[1]!.calculation).toEqual({ kind: "fixed", amount: money("0") });
  });
});

const integrated = (amount: string, options: { readonly months?: number; readonly noPayroll?: boolean; readonly cash?: string; readonly settlementAt?: string } = {}) => {
  const fixture = taxHouseholdFixture({ months: options.months ?? 12, openingCash: options.cash ?? "0" });
  const withholding = election({ calculation: { kind: "fixed", amount: money(amount) } });
  const input: HouseholdTaxInput = { ...fixture.input, payrollWithholding: options.noPayroll ? [] : [withholding], incomes: fixture.input.incomes.map(item => ({ ...item, grossOrNet: "gross", employerId: "synthetic-job-A" })),
    ...(options.settlementAt === undefined ? {} : { settlements: [{ ...fixture.input.settlements![0]!, at: instant(options.settlementAt) }] }) };
  const compiled = { ...fixture.compiled, participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input),
    cashFlowInput: { ...fixture.compiled.cashFlowInput!, incomes: fixture.compiled.cashFlowInput!.incomes.map(item => ({ ...item, ...(options.noPayroll ? {} : { payrollWithholding: [withholding] }) })) } };
  return { input, context: fixture.context, runContext: fixture.context, kernel: compileHouseholdKernel(compiled, fixture.context.simulationStart) };
};

describe("payroll credits, tax accrual and net final settlement", () => {
  it.each([false, true])("keeps open-ended payroll credits out of investable value beyond catalog years (supported law: %s)", supported => {
    const fixture = integrated("100", { months: 13 });
    const input = { ...fixture.input, catalog: supported ? [...fixture.input.catalog, { ...fixture.input.catalog[0]!, id: domainId("tax-rule", uuid(301)), version: "synthetic-2025", effectiveFrom: instant("2025-01-01T00:00:00.000Z"), effectiveUntil: instant("2026-01-01T00:00:00.000Z") }] : fixture.input.catalog,
      settlements: [...fixture.input.settlements!, { id: "final-2025", jurisdiction: "US:FEDERAL", taxYear: "2025", at: instant("2025-12-31T23:59:59.999Z") }] };
    // No payment, catalog rule or settlement enumerates this year in the
    // unsupported case: the actual execution boundary must reserve its credit.
    const creditInput = { ...input, settlements: fixture.input.settlements! };
    const excluded = taxCreditPositionIds(creditInput, fixture.context.simulationEnd);
    const credit = taxBalanceIds("US:FEDERAL", "2025").creditPositionId;
    expect(excluded).toContain(credit);
    const kernel = compileHouseholdKernel({ ...fixture.kernel.executable, participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: excluded }, fixture.context.simulationStart);
    const summary = runHouseholdKernel({ kernel, runContext: fixture.context });
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(summary.status).toBe(supported ? "completed" : "incomplete");
    // Where a 2025 liability is supported, the 2025 paid-tax credit offsets it
    // immediately (zero remaining). Without a 2025 rule, the unconsumed $100
    // must remain a NON-investable paid-tax credit, never free portfolio value.
    expect(summary.state.positions[credit]!.carryingValue.equals(money(supported ? "0" : "100"))).toBe(true);
    expect(summary.periods.at(-1)!.investmentValue.isZero()).toBe(true);
    expect(summary.periods.at(-1)!.cash.equals(money("11700"))).toBe(true);
    expect(summary.state).toEqual(detail.state);
    expect(summary.outputCapabilities).toEqual(detail.outputCapabilities);
    if (!supported) expect(summary.outputCapabilities?.cash?.diagnostics).toContainEqual(expect.objectContaining({ category: "rule_selection", jurisdiction: "US:FEDERAL" }));
    const restored = restorePortableHouseholdReplayArtifact(structuredClone(createPortableHouseholdReplayArtifact(summary)));
    const replay = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    expect(replay.periods).toEqual(summary.periods);
    expect(replay.state).toEqual(summary.state);
  });
  it("keeps two owners' jobs, receiving banks and federal/state/local credits separate", () => {
    const fixture = integrated("100", { months: 1 });
    const ownerB = domainId("person", uuid(101)), incomeB = domainId("income", uuid(102)), bankB = domainId("account", uuid(103));
    const sourceA = { ...fixture.input.incomes[0]!, residence: [{ state_jurisdiction: "US:GA", effective_date: "2024-01-01" }], work: [{ state_jurisdiction: "US:GA", allocation: "1", effective_date: "2024-01-01" }] };
    const sourceB = { ...sourceA, id: incomeB, ownerId: ownerB, employerId: "synthetic-job-B", residence: [{ state_jurisdiction: "US:NY", local_jurisdiction: "US:NY:NYC", effective_date: "2024-01-01" }], work: [{ state_jurisdiction: "US:NY", allocation: "1", effective_date: "2024-01-01" }] };
    const elections = [election(), election({ id: uuid(2), jurisdiction: "US:GA", calculation: { kind: "fixed", amount: money("20") } }),
      ...["US:FEDERAL", "US:NY", "US:NY:NYC"].map((jurisdiction, index) => election({ id: uuid(3 + index), incomeId: incomeB, ownerId: ownerB, employerId: "synthetic-job-B", depositAccountId: bankB, jurisdiction, calculation: { kind: "fixed", amount: money(["150", "30", "10"][index]!) } }))];
    const rules = ["US:GA", "US:NY", "US:NY:NYC"].map((jurisdiction, index) => taxRule(10 + index, { jurisdiction, income: { ...taxRule().income!, standardDeduction: money("0") } }));
    const input = { ...fixture.input, catalog: [...fixture.input.catalog, ...rules], incomes: [sourceA, sourceB], payrollWithholding: elections };
    const cash = fixture.kernel.executable.cashFlowInput!;
    const compiled = { ...fixture.kernel.executable, participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input),
      reconciledOpeningState: createAuthoritativeState({ ...fixture.kernel.executable.reconciledOpeningState, accounts: { ...fixture.kernel.executable.reconciledOpeningState.accounts, [bankB]: { id: bankB, ownerId: ownerB, kind: "checking" as const, cash: money("0") } } }),
      cashFlowInput: { ...cash, incomes: [{ ...cash.incomes[0]!, payrollTaxCreditAccountId: ids.cash, payrollWithholding: elections.filter(item => item.incomeId === ids.income) }, { ...cash.incomes[0]!, id: incomeB, ownerId: ownerB, depositAccountId: bankB, payrollTaxCreditAccountId: ids.cash, payrollWithholding: elections.filter(item => item.incomeId === incomeB), primitiveIds: { growth: domainId("primitive-instance", uuid(104)), recurrence: domainId("primitive-instance", uuid(105)) } }] } };
    const kernel = compileHouseholdKernel(compiled, fixture.context.simulationStart);
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(detail.state.accounts[ids.cash]!.cash.equals(money("880"))).toBe(true);
    expect(detail.state.accounts[bankB]!.cash.equals(money("810"))).toBe(true);
    expect(detail.diagnostics.some(item => "category" in item && item.category === "wage_gross_to_net_withholding")).toBe(false);
    const paid = detail.periods.flatMap(period => period.transactions).filter(tx => tx.type === "payroll_income");
    paid.forEach(assertBalanced);
    expect(paid).toHaveLength(2);
    expect(paid.map(tx => tx.traceRefs!.map(ref => String(ref.traceId)).join(" ")).join(" ")).toContain("synthetic-job-B");
    const reverseKernel = compileHouseholdKernel({ ...compiled, cashFlowInput: { ...compiled.cashFlowInput, incomes: [...compiled.cashFlowInput.incomes].reverse() } }, fixture.context.simulationStart);
    const reversed = runHouseholdKernel({ kernel: reverseKernel, runContext: fixture.context, resultTier: "detail" });
    // Compare every authoritative economic and identity subledger independently,
    // so an ordering disagreement identifies its exact semantic surface.
    for (const section of ["accounts", "positions", "liabilities", "obligations", "identities", "contributions", "contingentPositions", "ssaMedicarePayments"] as const) {
      expect(reversed.state[section], `Reordered income streams changed authoritative ${section}`).toEqual(detail.state[section]);
    }
    expect(reversed.runMetadata).toEqual(detail.runMetadata);
    const missing = { ...input, payrollWithholding: elections.filter(item => item.incomeId === ids.income) };
    const uncoveredKernel = compileHouseholdKernel({ ...compiled, participants: [createHouseholdTaxParticipant(missing)], cashFlowInput: { ...compiled.cashFlowInput, incomes: [compiled.cashFlowInput.incomes[0]!, { ...compiled.cashFlowInput.incomes[1]!, payrollWithholding: [] }] } }, fixture.context.simulationStart);
    const uncovered = runHouseholdKernel({ kernel: uncoveredKernel, runContext: fixture.context });
    expect(uncovered.status).toBe("incomplete");
    expect(uncovered.outputCapabilities?.netWorth?.diagnostics).toContainEqual(expect.objectContaining({ category: "wage_gross_to_net_withholding", entityId: incomeB }));
    expect(uncovered.outputCapabilities?.netWorth?.diagnostics).not.toContainEqual(expect.objectContaining({ category: "wage_gross_to_net_withholding", entityId: ids.income }));
  });
  it.each([["80", "240", "0"], ["100", "0", "0"], ["120", "0", "240"]] as const)("withholding %s leaves only due %s or refund %s", (amount, due, refund) => {
    const fixture = integrated(amount), detail = runHouseholdKernel({ ...fixture, resultTier: "detail" });
    expect(detail.status).toBe("completed");
    const transactions = detail.periods.flatMap(period => period.transactions);
    transactions.forEach(assertBalanced);
    const postings = (kind: string, effect: "debit" | "credit") => transactions.filter(tx => tx.type === kind).flatMap(tx => tx.legs).filter(leg => leg.type === "cash" && leg.posting === effect).reduce((sum, leg) => sum.plus(leg.amount), money("0"));
    expect(postings("tax_final_settlement", "credit").equals(money(due))).toBe(true);
    expect(postings("tax_refund", "debit").equals(money(refund))).toBe(true);
    expect(transactions.filter(tx => tx.type === "tax_withholding")).toHaveLength(0);
    expect(transactions.filter(tx => tx.type === "payroll_income")).toHaveLength(12);
    expect(detail.state.accounts[ids.cash]!.cash.equals(money("10800"))).toBe(true);
    const balances = taxBalanceIds("US:FEDERAL", "2024");
    expect(detail.state.liabilities[balances.liabilityId]!.balance.isZero()).toBe(true);
    expect(detail.state.positions[balances.creditPositionId]!.carryingValue.isZero()).toBe(true);
    expect(detail.periods[0]!.cashFlow!.recurringIncomeRecognized.equals(money("1000"))).toBe(true);
  });
  it("summary/detail/portable replay retain the same state, identity, per-period cash and diagnostics", () => {
    const fixture = integrated("120"), summary = runHouseholdKernel(fixture), detail = runHouseholdKernel({ ...fixture, resultTier: "detail" });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    const replay = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext, resultTier: "detail" });
    expect(summary.status).toBe(detail.status);
    expect(summary.runMetadata).toEqual(detail.runMetadata);
    expect(replay.runMetadata).toEqual(detail.runMetadata);
    expect(replay.state).toEqual(detail.state);
    expect(summary.outputCapabilities).toEqual(detail.outputCapabilities);
    expect(summary.periods.map(period => period.cash)).toEqual(detail.periods.map(period => period.cash));
    expect(replay.periods).toEqual(detail.periods);
  });
  it("keeps estimated cash payments distinct from employer-remitted paycheck credit", () => {
    const fixture = integrated("80");
    const input = { ...fixture.input, payments: [{ id: "estimated", jurisdiction: "US:FEDERAL", at: instant("2024-06-20T00:00:00.000Z"), amount: money("100"), kind: "estimated" as const }] };
    const kernel = compileHouseholdKernel({ ...fixture.kernel.executable, participants: [createHouseholdTaxParticipant(input)] }, fixture.context.simulationStart);
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    const transactions = detail.periods.flatMap(period => period.transactions);
    expect(transactions.filter(tx => tx.type === "tax_estimated").flatMap(tx => tx.legs).filter(leg => leg.type === "cash" && leg.posting === "credit").reduce((sum, leg) => sum.plus(leg.amount), money("0")).equals(money("100"))).toBe(true);
    expect(transactions.filter(tx => tx.type === "tax_final_settlement").flatMap(tx => tx.legs).filter(leg => leg.type === "cash").reduce((sum, leg) => sum.plus(leg.amount), money("0")).equals(money("140"))).toBe(true);
    expect(detail.state.accounts[ids.cash]!.cash.equals(money("10800"))).toBe(true);
  });
  it("resets tax-year credits and settles the preceding year at its actual next-year date", () => {
    const fixture = integrated("120", { months: 24 });
    const input = { ...fixture.input, catalog: [...fixture.input.catalog, { ...fixture.input.catalog[0]!, id: domainId("tax-rule", uuid(300)), version: "synthetic-2025", effectiveFrom: instant("2025-01-01T00:00:00.000Z"), effectiveUntil: instant("2026-01-01T00:00:00.000Z") }],
      settlements: [{ id: "final-2024", jurisdiction: "US:FEDERAL", taxYear: "2024", at: instant("2025-01-01T00:00:00.000Z") }, { id: "final-2025", jurisdiction: "US:FEDERAL", taxYear: "2025", at: instant("2025-12-31T23:59:59.999Z") }] };
    const kernel = compileHouseholdKernel({ ...fixture.kernel.executable, participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input) }, fixture.context.simulationStart);
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(detail.status).toBe("completed");
    expect(detail.state.accounts[ids.cash]!.cash.equals(money("21600"))).toBe(true);
    const refunds = detail.periods.flatMap(period => period.transactions).filter(tx => tx.type === "tax_refund");
    expect(refunds.map(tx => tx.date)).toEqual(["2025-01-01T00:00:00.000Z", "2025-12-31T23:59:59.999Z"]);
    for (const year of ["2024", "2025"]) {
      const balance = taxBalanceIds("US:FEDERAL", year);
      expect(detail.state.liabilities[balance.liabilityId]!.balance.isZero()).toBe(true);
      expect(detail.state.positions[balance.creditPositionId]!.carryingValue.isZero()).toBe(true);
    }
  });
  it("keeps unfunded final tax due as a liability without inventing a bank debit", () => {
    const fixture = integrated("0");
    const cash = fixture.kernel.executable.cashFlowInput!;
    const expense = { id: domainId("expense", uuid(400)), ownerId: ids.person, baseMonthlyAmount: money("1000"), start: fixture.context.simulationStart,
      recurrence: cash.incomes[0]!.recurrence, paymentAccountId: ids.cash, payableLiabilityId: ids.payable, fundingPolicy: { ...fixture.input.fundingPolicy!, allowPartial: false }, inflationRate: cash.incomes[0]!.growthRate, inflationBaseAt: cash.incomes[0]!.growthBaseAt,
      primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(401)), inflationLink: domainId("primitive-instance", uuid(402)), recurrence: domainId("primitive-instance", uuid(403)) } };
    const kernel = compileHouseholdKernel({ ...fixture.kernel.executable, cashFlowInput: { ...cash, expenses: [expense] } }, fixture.context.simulationStart);
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(detail.state.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(detail.state.liabilities[taxBalanceIds("US:FEDERAL", "2024").liabilityId]!.balance.equals(money("1200"))).toBe(true);
    expect(detail.periods.flatMap(period => period.transactions).some(tx => tx.type === "tax_final_settlement")).toBe(false);
    expect(detail.periods.flatMap(period => period.liquidityShortfalls).length).toBeGreaterThan(0);
  });
  it.each(["source_end", "retirement_event"] as const)("does not deposit cash after %s salary termination", kind => {
    const fixture = integrated("100");
    const cash = fixture.kernel.executable.cashFlowInput!;
    const event = domainId("event", uuid(501)), termination = domainId("primitive-instance", uuid(502)), effectiveAt = instant("2024-07-01T00:00:00.000Z");
    const kernel = compileHouseholdKernel({ ...fixture.kernel.executable, cashFlowInput: { ...cash,
      events: kind === "source_end" ? [] : [{ id: event, targetId: ids.income, kind: "termination", effectiveAt }],
      incomes: cash.incomes.map(item => ({ ...item, ...(kind === "source_end" ? { end: effectiveAt } : { terminationEventId: event, primitiveIds: { ...item.primitiveIds, termination } }) })) } }, fixture.context.simulationStart);
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(detail.periods.flatMap(period => period.transactions).filter(tx => tx.type === "payroll_income")).toHaveLength(6);
    expect(detail.state.accounts[ids.cash]!.cash.equals(money("5400"))).toBe(true);
  });
});
