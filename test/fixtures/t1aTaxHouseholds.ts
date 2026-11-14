import { domainId } from "../../src/identity/index.js";
import { compileCashFlow } from "../../src/application/compiler/cashFlow.js";
import { addPersonalObject, createEmptyPersonalDraft } from "../../src/application/personalMvp.js";
import { authorPayrollWithholding, type PayrollWithholdingPlan } from "../../src/application/compiler/payrollWithholding.js";
import { createAuthoritativeState } from "../../src/state/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../src/funding/index.js";
import { createRunContext, runId, scenarioId } from "../../src/simulation/run.js";
import { createPrimitiveRuntimeStateStore } from "../../src/simulation/period.js";
import { createHouseholdTaxParticipant, taxCreditPositionIds, type HouseholdTaxInput } from "../../src/simulation/tax.js";
import { compileHouseholdKernel } from "../../src/simulation/r3/compiledHousehold.js";
import type { ExecutableHouseholdProjection } from "../../src/simulation/householdExecution.js";
import { instant, utcMonthlyPeriods } from "../../src/time/index.js";
import { money, Ratio, USD } from "../../src/values/index.js";
import { taxRule } from "./t1aTaxRules.js";
import { employerWage } from "./employerWage.js";

export const taxHouseholdIds = {
  household: domainId("household", "86000000-0000-4000-8000-000000000001"),
  person: domainId("person", "86000000-0000-4000-8000-000000000002"),
  cash: domainId("account", "86000000-0000-4000-8000-000000000003"),
  income: domainId("income", "86000000-0000-4000-8000-000000000004"),
  payable: domainId("liability", "86000000-0000-4000-8000-000000000005"),
};
export const taxHouseholdFixture = (options: { readonly months?: number; readonly amount?: string; readonly openingCash?: string; readonly withholding?: string; readonly input?: Partial<HouseholdTaxInput>; readonly incomeType?: string; readonly taxCharacter?: string; readonly simulationStart?: string; readonly incomeStart?: string; readonly payrollElection?: PayrollWithholdingPlan; readonly employerOriginal?: boolean } = {}) => {
  const ids = taxHouseholdIds, months = options.months ?? 1;
  const start = instant(`${options.simulationStart ?? "2024-01-01"}T00:00:00.000Z`), end = utcMonthlyPeriods(start, months).at(-1)!.end;
  const incomeStart = options.incomeStart ?? `${start.slice(0, 7)}-15`;
  const input: HouseholdTaxInput = {
    catalog: [taxRule(1, { jurisdiction: "US:FEDERAL", income: { ...taxRule().income!, ordinaryBrackets: [{ lower: money("0"), rate: Ratio.parse("0.1") }], standardDeduction: money("0") } })],
    filingStatus: "single", simulationStart: start, ownerId: ids.household,
    incomes: [{ id: ids.income, ownerId: ids.person, incomeType: options.incomeType ?? "salary", taxCharacter: options.taxCharacter ?? "ordinary", start: "2024-01-01",
      residence: [{ state_jurisdiction: "TEST:RESIDENCE", effective_date: "2024-01-01" }],
      work: [{ state_jurisdiction: "TEST:SERVICE", allocation: "1", effective_date: "2024-01-01" }], eligibility: [] }], eligibility: [],
    fundingPolicy: createFundingPolicy({ id: fundingPolicyId("test:tax"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: true, insufficientFundsBehavior: "unfunded" }), refundAccountId: ids.cash,
    payments: options.withholding === undefined ? [] : Array.from({ length: months }, (_, index) => ({ id: `withholding-${index}`, jurisdiction: "US:FEDERAL", at: instant(`2024-${String(index + 1).padStart(2, "0")}-20T00:00:00.000Z`), amount: money(options.withholding!), kind: "withholding" as const })),
    settlements: [{ id: "final-2024", jurisdiction: "US:FEDERAL", taxYear: "2024", at: instant("2024-12-31T23:59:59.999Z") }],
    diagnostics: [], ...options.input,
  };
  const context = createRunContext({ runId: runId("86000000-0000-4000-8000-000000000007"), scenarioId: scenarioId("86000000-0000-4000-8000-000000000008"), asOf: instant("2023-12-31T00:00:00.000Z"), dataCutoff: instant("2023-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: end, baseCurrency: USD });
  let model = createEmptyPersonalDraft("86000000-0000-4000-8000-000000000006");
  model = addPersonalObject(model, "Household", ids.household, {
    name: "Synthetic tax household", household_type: "individual", formation_date: "2020-01-01",
    members: [ids.person], primary_jurisdiction: "US-NY",
  });
  model = addPersonalObject(model, "Person", ids.person, {
    first_name: "Synthetic", last_name: "Taxpayer", date_of_birth: "1980-01-01",
    household_id: ids.household, residence_jurisdiction: "US-NY",
  });
  model = addPersonalObject(model, "Account", ids.cash, {
    name: "Synthetic cash account", account_type: "cash", owner_id: ids.person,
    opening_date: "2020-01-01", opening_balance: options.openingCash ?? "0",
  });
  model = addPersonalObject(model, "Income", ids.income, {
    owner_id: ids.person, income_type: options.incomeType ?? "salary", source: options.payrollElection?.employerId ?? "Synthetic income source",
    amount: options.amount ?? "1000", frequency: "monthly", start_date: incomeStart, gross_or_net: "gross",
  });
  model = addPersonalObject(model, "Scenario", context.scenarioId, {
    name: "Synthetic tax forecast", start_date: start.slice(0, 10), end_date: end.slice(0, 10),
    timestep: "monthly", enabled: true, stochastic: false, simulation_count: 1, assumption_ids: [], event_ids: [],
  });
  if (options.payrollElection !== undefined) model = authorPayrollWithholding(model, options.payrollElection);
  const cash = compileCashFlow(model, {
    baseCurrency: "USD", asOf: context.asOf.slice(0, 10), simulationStart: start.slice(0, 10),
    simulationEnd: end.slice(0, 10), months, executionAccountId: ids.cash,
    sameInstantCashFlowOrder: "income_before_expense",
  });
  if (cash.status !== "compiled") throw new Error(JSON.stringify(cash.diagnostics));
  const plan = options.payrollElection;
  if (options.employerOriginal && ((options.incomeType ?? "salary") !== "salary" ||
      (plan !== undefined && plan.calculation.kind !== "fixed")))
    throw new Error("Employer archive fixture supports salary with fixed withholding");
  const original = options.employerOriginal ? employerWage(context, {
    householdId: ids.household, personId: ids.person, incomeId: ids.income, bankAccountId: ids.cash,
    employerId: options.payrollElection?.employerId ?? "Synthetic employer archive",
    firstPayday: incomeStart, gross: options.amount ?? "1000",
    ...(plan?.calculation.kind !== "fixed" ? {} : { withholding: {
      id: plan.id, version: "payroll-withholding/v1", incomeId: ids.income, ownerId: ids.person,
      employerId: plan.employerId, depositAccountId: ids.cash, jurisdiction: plan.jurisdiction,
      start: instant(`${plan.effectiveDate}T00:00:00.000Z`),
      ...(plan.expirationDate === undefined ? {} : { end: instant(`${plan.expirationDate}T00:00:00.000Z`) }),
      provenance: plan.provenance, userConfirmed: true, calculation: { kind: "fixed", amount: money(plan.calculation.amount) },
    } }),
  }) : undefined;
  const compiled: ExecutableHouseholdProjection = {
    reconciledOpeningState: createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash,
      kind: original ? "checking" : "cash", ownerId: original ? ids.household : ids.person,
      cash: money(options.openingCash ?? "0") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } }),
    reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), executionMonths: months, scenarioIdentity: context.scenarioId, scenarioBindings: {}, standaloneAssets: [],
    participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input),
    cashFlowInput: { ...cash.value.input, expensePayableLiabilityId: ids.payable,
      ...(original === undefined ? {} : { incomes: [original.income] }) },
  };
  return { input, context, compiled, kernel: compileHouseholdKernel(compiled, start), original };
};
