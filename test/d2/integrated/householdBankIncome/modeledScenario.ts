import { addPersonalObject, createGoldenHouseholdDraft, patchPersonalObject, type JsonObject } from "../../../../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../../../../src/application/goldenHousehold.js";
import { authorPayrollContributionPlan } from "../../../../src/application/compiler/payrollAuthoring.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { USD } from "../../../../src/values/index.js";

export const modeledId = (n: number) => `27710000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
export function rebindModeledBank(model: ReturnType<typeof createGoldenHouseholdDraft>, ownerId: string) {
  return { ...model, objects: { ...model.objects, Account: model.objects.Account!.map(value =>
    record(value) && value.account_id === ids.checking
      ? { ...value, owner_id: ownerId } : value) } };
}
export function modeledSource(elected = false, family = false) {
  let model = patchPersonalObject(createGoldenHouseholdDraft(), "Income", ids.income, { income_type: "salary" });
  if (family) {
    model = patchPersonalObject(model, "Household", ids.household, { members: [ids.person, modeledId(1)], filing_status: "married_joint", household_type: "couple" });
    model = patchPersonalObject(model, "Person", ids.person, { date_of_birth: "1971-01-01" });
    model = addPersonalObject(model, "Person", modeledId(1), { household_id: ids.household, first_name: "Spouse", last_name: "Example", date_of_birth: "1971-01-01", residence_jurisdiction: "US-NY" });
    model = addPersonalObject(model, "Income", modeledId(2), { owner_id: modeledId(1), income_type: "salary", source: "Spouse salary", amount: "9000", frequency: "monthly", start_date: "2026-01-02", gross_or_net: "gross" });
    model = { ...model, objects: { ...model.objects,
      Person: model.objects.Person!.map(value => record(value) && value.person_id === ids.person ? { ...value, date_of_birth: "1971-01-01" } : value),
      Account: model.objects.Account!.map(value => record(value) && (value.account_id === ids.retirementAccount || value.account_id === ids.brokerageAccount) ? {
        ...value, account_type: "hsa_investment", tax_treatment: "tax_free", owner_id: value.account_id === ids.brokerageAccount ? modeledId(1) : ids.person,
      } : value),
      Investment: model.objects.Investment!.map(value => record(value) && value.investment_id === ids.brokerageInvestment ? { ...value, owner_id: modeledId(1), tax_treatment: "tax_free" } : value),
    } };
    const facts = { taxYear: 2026, ageAtYearEnd: 55, hsaFullYearEligible: true, hsaCoverage: "family" as const };
    model = authorPayrollContributionPlan(model, { primitiveId: modeledId(3), investmentId: ids.retirementInvestment, incomeId: ids.income, priority: 10, character: "employee_hsa", calculation: { kind: "fixed", amount: "5500" }, vestedFraction: "1", excessPolicy: "reject", facts: { ...facts, hsaFamilyAllocation: "4500" } });
    model = authorPayrollContributionPlan(model, { primitiveId: modeledId(4), investmentId: ids.brokerageInvestment, incomeId: modeledId(2), priority: 20, character: "employee_hsa", calculation: { kind: "fixed", amount: "5250" }, vestedFraction: "1", excessPolicy: "reject", facts: { ...facts, hsaFamilyAllocation: "4250" } });
  } else {
    model = rebindModeledBank(model, ids.household);
    if (elected) model = authorPayrollContributionPlan(model, { primitiveId: modeledId(3), investmentId: ids.retirementInvestment,
      incomeId: ids.income, priority: 10, character: "traditional_401k", calculation: { kind: "fixed", amount: "100" },
      planKey: "synthetic-employer", vestedFraction: "1", excessPolicy: "reject", facts: { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: "100000" } });
  }
  return model;
}
export function modeledRequest(months = 1) {
  const full = createGoldenHouseholdForecastRequest();
  const end = new Date(Date.UTC(2026, months, 1)).toISOString().slice(0, 10);
  return { ...full, compiler: { ...full.compiler,
    cashFlow: { ...full.compiler.cashFlow!, simulationEnd: end, months },
    // This wage/provenance fixture is not a test of VS3 cross-owner investment purchases.
    investments: { ...full.compiler.investments!, simulationEnd: end, months, purchaseInstructions: [] },
    liabilities: { ...full.compiler.liabilities!, simulationEnd: end, months },
  } };
}
export function modeledContext(months = 1) {
  const request = modeledRequest(months);
  return createRunContext({ runId: runId(request.runIdentity), scenarioId: scenarioId(ids.rootScenario),
    asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"),
    simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant(`${request.compiler.cashFlow.simulationEnd}T00:00:00.000Z`), baseCurrency: USD });
}
