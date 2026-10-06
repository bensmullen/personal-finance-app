import { addPersonalObject, authorDomainOperation, authorPersonalPurchasePlan, createGoldenHouseholdDraft, patchPersonalObject, type PersonalDraft } from "../../src/application/personalMvp.js";
import { authorPayrollContributionPlan } from "../../src/application/compiler/payrollAuthoring.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as golden } from "../../src/application/goldenHousehold.js";
import { createFundingPolicy, fundingPolicyId } from "../../src/funding/index.js";
import { domainId } from "../../src/identity/index.js";
import { federalBaseDeductionOnlyEligibilityKey } from "../../src/rules/tax/contracts.js";
import { createRunContext, runId, scenarioId } from "../../src/simulation/run.js";
import { instant } from "../../src/time/index.js";
import { money, USD } from "../../src/values/index.js";

export const integratedId = (n: number) => `d1cc0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const integratedIds = {
  iraAccount: integratedId(1), ira: integratedId(2), match: integratedId(3),
  hsaAccount: integratedId(4), hsaEmployee: integratedId(5), hsaEmployer: integratedId(6),
  treasury: integratedId(7), crypto: integratedId(8), policy: integratedId(9), death: integratedId(10),
  linkedAsset: integratedId(11), cryptoPurchase: integratedId(40),
};

/** Synthetic Golden Household extension. January isolates integration from
 * growth/annual-limit edges already proved in D1-A. Death is an insurance
 * counterfactual; no real household data is used.
 */
export const createD1IntegratedHousehold = (): PersonalDraft => {
  let model = createGoldenHouseholdDraft();
  for (const value of model.objects.Assumption ?? []) {
    const assumption = value as { assumption_id: string };
    model = patchPersonalObject(model, "Assumption", assumption.assumption_id, { value: "0" });
  }
  model = patchPersonalObject(model, "Person", golden.person, { filing_status: "single", residence_jurisdiction_periods: [{ effective_date: "2026-01-01", state_jurisdiction: "US-NY" }], tax_eligibility_periods: [{ effective_date: "2026-01-01", key: federalBaseDeductionOnlyEligibilityKey, value: true }] });
  model = patchPersonalObject(model, "Income", golden.income, { work_service_jurisdiction_allocations: [{ effective_date: "2026-01-02", state_jurisdiction: "US-NY", allocation: "1" }] });
  for (const investmentId of [golden.retirementInvestment, golden.brokerageInvestment]) {
    model = patchPersonalObject(model, "Investment", investmentId, { acquisition_date: "2024-01-01", cost_basis: investmentId === golden.retirementInvestment ? "100000" : "50000", after_tax_basis: "0" });
  }
  model = addPersonalObject(model, "Asset", integratedIds.linkedAsset, { name: "Brokerage holding reference", asset_type: "other", owner_id: golden.person, acquisition_cost: "50000", acquisition_date: "2024-01-01", valuation_method: "cost" });
  model = patchPersonalObject(model, "Investment", golden.brokerageInvestment, { asset_id: integratedIds.linkedAsset });
  for (const [accountId, account_type, name] of [
    [integratedIds.iraAccount, "roth_ira", "Personal Roth IRA"], [integratedIds.hsaAccount, "hsa_investment", "Health savings investments"],
  ] as const) model = addPersonalObject(model, "Account", accountId, { name, account_type, owner_id: golden.person, opening_date: "2020-01-01", opening_balance: "0", tax_treatment: "tax_free" });
  for (const [investmentId, accountId, symbol] of [
    [integratedIds.ira, integratedIds.iraAccount, "IRA-DEMO"], [integratedIds.match, golden.retirementAccount, "MATCH-DEMO"],
    [integratedIds.hsaEmployee, integratedIds.hsaAccount, "HSA-EMPLOYEE"], [integratedIds.hsaEmployer, integratedIds.hsaAccount, "HSA-EMPLOYER"],
  ] as const) {
    const returnId = integratedId(200 + Number(investmentId.slice(-12)));
    model = { ...model, objects: { ...model.objects, PrimitiveInstance: [...model.objects.PrimitiveInstance!, { primitive_instance_id: returnId, primitive_id: "P23", input_bindings: { rate: "90000000-0000-4000-8000-000000000019" }, parameters: {}, scenario_id: golden.rootScenario, enabled: true }] } };
    model = addPersonalObject(model, "Investment", investmentId, { owner_id: golden.person, account_id: accountId, investment_type: "fund", symbol, quantity: "0", price: "100", market_value: "0", return_model_id: returnId, after_tax_basis: "0" });
    model = { ...model, objects: { ...model.objects, Investment: model.objects.Investment!.map(value => (value as { investment_id: string }).investment_id === investmentId ? { ...(value as Record<string, import("../../src/model/modelVersion.js").JsonValue>), owner_id: golden.person, price: "100", market_value: "0" } : value) } };
  }
  const facts = { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: "108000", hsaFullYearEligible: true, hsaCoverage: "self" as const };
  for (const [investmentId, character, calculation, priority] of [
    [golden.retirementInvestment, "traditional_401k", { kind: "percent", rate: "0.05" }, 10],
    [integratedIds.match, "employer_401k", { kind: "match", rate: "0.5", compensationCapRate: "0.06" }, 20],
    [integratedIds.hsaEmployee, "employee_hsa", { kind: "fixed", amount: "100" }, 30],
    [integratedIds.hsaEmployer, "employer_hsa", { kind: "fixed", amount: "25" }, 40],
  ] as const) model = authorPayrollContributionPlan(model, { primitiveId: integratedId(100 + priority), investmentId, character, calculation, priority, incomeId: golden.income, planKey: "golden-employer", vestedFraction: "1", excessPolicy: "auto_cap", facts });
  model = authorPersonalPurchasePlan(model, { primitiveId: integratedId(30), investmentId: integratedIds.ira, sourceCashAccountId: golden.savings, amount: "500", frequency: "once", date: "2026-01-10", order: 10, excessPolicy: "auto_cap", contributionFacts: { taxYear: 2026, ageAtYearEnd: 36, taxableCompensation: "108000", filingStatus: "single", rothMagi: "108000", workplacePlanCovered: true } });
  model = authorPersonalPurchasePlan(model, { primitiveId: integratedId(31), investmentId: golden.brokerageInvestment, sourceCashAccountId: golden.checking, amount: "1000", frequency: "once", date: "2026-01-10", order: 20 });
  model = addPersonalObject(model, "Investment", integratedIds.treasury, { owner_id: golden.person, account_id: golden.brokerageAccount, investment_type: "bond", instrument_subtype: "treasury_bill", symbol: "BILL-DEMO", quantity: "0", price: "980", market_value: "0", cost_basis: "980", acquisition_date: "2026-01-01", maturity_date: "2026-01-20", face_value: "1000", funding_account_id: golden.checking, settlement_account_id: golden.savings, return_model_id: null });
  model = addPersonalObject(model, "Investment", integratedIds.crypto, { owner_id: golden.person, account_id: golden.brokerageAccount, investment_type: "crypto", symbol: "SPOT-DEMO", quantity: "0", price: "100", market_value: "0", return_model_id: null });
  for (const [n, terms] of [
    [40, { kind: "purchase", holdingId: integratedIds.crypto, cashAccountId: golden.checking, amount: "200", quantity: "2", date: "2026-01-11", order: 10 }],
    [43, { kind: "sale", holdingId: integratedIds.crypto, amount: "300", quantity: "2", date: "2026-01-21", order: 10 }],
    [46, { kind: "sale", holdingId: golden.brokerageInvestment, amount: "1100", quantity: "10", date: "2026-01-21", order: 20 }],
    [49, { kind: "reinvest_dividend", holdingId: golden.brokerageInvestment, amount: "100", quantity: "1", date: "2026-01-22", order: 10, dividendCharacter: "qualified" }],
  ] as const) model = authorDomainOperation(model, { eventId: integratedId(n), effectId: integratedId(n + 1), primitiveId: integratedId(n + 2), name: `Synthetic ${terms.kind}`, ...terms });
  model = { ...model, objects: { ...model.objects,
    Event: [...model.objects.Event!, { event_id: integratedIds.death, name: "Synthetic term-life counterfactual", event_type: "death", start_date: "2026-01-25", scenario_id: golden.rootScenario, enabled: true, trigger_type: "scheduled", effect_ids: [], dependencies: [], precedence: 0 }],
    Insurance: [{ insurance_id: integratedIds.policy, name: "Synthetic term life", owner_id: golden.person, insurance_type: "life", policy_family: "term_life_lump_sum", insured_person_id: golden.person, beneficiary_id: golden.household, premium_account_id: golden.checking, benefit_account_id: golden.savings, premium: "50", premium_frequency: "monthly", coverage_amount: "100000", start_date: "2026-01-01", end_date: "2027-01-01", death_event_id: integratedIds.death }],
  } };
  // Like the canonical Golden builder, record observed opening prices/values
  // explicitly: the generic authoring descriptor omits derived fields.
  const prices = new Map<string, string>([[integratedIds.ira, "100"], [integratedIds.match, "100"], [integratedIds.hsaEmployee, "100"], [integratedIds.hsaEmployer, "100"], [integratedIds.treasury, "980"], [integratedIds.crypto, "100"]]);
  return { ...model, objects: { ...model.objects, Investment: model.objects.Investment!.map(value => {
    const item = value as { investment_id: string };
    return prices.has(item.investment_id) ? { ...item, owner_id: golden.person, price: prices.get(item.investment_id)!, market_value: "0" } : value;
  }) } };
};

export const d1IntegratedCompilerRequest = () => {
  const request = createGoldenHouseholdForecastRequest().compiler;
  return { ...request,
    cashFlow: { ...request.cashFlow!, simulationEnd: "2026-02-01", months: 1 },
    investments: { ...request.investments!, simulationEnd: "2026-02-01", months: 1, purchaseInstructions: [] },
    liabilities: { ...request.liabilities!, simulationEnd: "2026-02-01", months: 1 },
    // Mortgage, bill acquisition and premium share checking on January 1.
    contentionPolicy: { id: "d1-integrated-obligations", version: "1" as const, rules: [
      { before: "liability_required_service", after: "domain_mechanics:purchase" },
      { before: "liability_required_service", after: "domain_mechanics:insurance_premium" },
    ] },
    tax: {
      fundingPolicy: createFundingPolicy({ id: fundingPolicyId("d1-integrated-tax"), orderedSources: [{ kind: "cash_account" as const, accountId: domainId("account", golden.checking) }], allowPartial: false, insufficientFundsBehavior: "unfunded" }),
      refundAccountId: domainId("account", golden.checking),
      payments: [{ id: "d1-federal-payment", jurisdiction: "US:FEDERAL", at: instant("2026-01-28T00:00:00.000Z"), amount: money("500", USD), kind: "estimated" as const }],
      settlements: [{ id: "d1-final-federal", jurisdiction: "US:FEDERAL", taxYear: "2026", at: instant("2026-12-31T23:59:59.999Z") }],
    },
  };
};

export const d1IntegratedRunContext = () => createRunContext({ runId: runId(integratedId(99)), scenarioId: scenarioId(golden.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD });
