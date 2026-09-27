import {
  GOLDEN_HOUSEHOLD_IDS,
  addPersonalObject,
  createGoldenHouseholdDraft,
  createGoldenHouseholdForecastRequest,
  type HouseholdForecastRequest,
  type JsonObject,
  type PersonalDraft,
} from "../../src/application/index.js";

export interface PerformanceFixtureCoverage {
  readonly canonicalObjectCounts: Readonly<Record<string, number>>;
  readonly primitives: readonly string[];
  readonly rules: readonly string[];
  readonly events: readonly string[];
  readonly scenarios: readonly string[];
  readonly executionMechanics: readonly string[];
  readonly unsupportedGaps: readonly string[];
}
export interface PerformanceHouseholdFixture {
  readonly id: "realistic-household" | "stress-household";
  readonly classification: "synthetic";
  readonly model: PersonalDraft;
  readonly request: HouseholdForecastRequest;
  readonly coverage: PerformanceFixtureCoverage;
}

const uuid = (family: "a" | "b", sequence: number) => `9${family === "a" ? "1" : "2"}000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
const through = (request: HouseholdForecastRequest, end: string, months: number): HouseholdForecastRequest => Object.freeze({
  ...request,
  compiler: Object.freeze({
    ...request.compiler,
    cashFlow: Object.freeze({ ...request.compiler.cashFlow!, simulationEnd: end, months }),
    investments: Object.freeze({ ...request.compiler.investments!, simulationEnd: end, months }),
    liabilities: Object.freeze({ ...request.compiler.liabilities!, simulationEnd: end, months }),
  }),
});
const counts = (model: PersonalDraft) => Object.freeze(Object.fromEntries(Object.entries(model.objects).map(([type, values]) => [type, values.length])));
const withScenarioEnd = (model: PersonalDraft, endDate: string): PersonalDraft => Object.freeze({
  ...model,
  objects: Object.freeze({
    ...model.objects,
    Scenario: Object.freeze((model.objects.Scenario ?? []).map((scenario) => Object.freeze({ ...(scenario as JsonObject), end_date: endDate }))),
  }),
});
const appendGrowthPrimitive = (model: PersonalDraft, id: string, assumptionId: string): PersonalDraft => Object.freeze({
  ...model,
  objects: Object.freeze({
    ...model.objects,
    PrimitiveInstance: Object.freeze([...(model.objects.PrimitiveInstance ?? []), Object.freeze({ primitive_instance_id: id, primitive_id: "P08", input_bindings: Object.freeze({ rate: assumptionId }), parameters: Object.freeze({}), scenario_id: GOLDEN_HOUSEHOLD_IDS.rootScenario, enabled: true })]),
  }),
});
const coverage = (model: PersonalDraft, stress: boolean): PerformanceFixtureCoverage => Object.freeze({
  canonicalObjectCounts: counts(model),
  primitives: Object.freeze(["P08 indexed recurring cash flow", "P23 periodic investment return", "VS4 fixed amortizing liability"]),
  rules: Object.freeze(["salary growth", "expense inflation", "investment return", "explicit contention policy"]),
  events: Object.freeze(["scheduled retirement/income termination"]),
  scenarios: Object.freeze(["current plan", "lower-return comparison", "earlier-retirement comparison"]),
  executionMechanics: Object.freeze(["opening reconciliation", "monthly recurrence", "funding/settlement", "investment purchase", "mark-to-market", "debt amortization", ...(stress ? ["long horizon", "high recurring-flow count"] : [])]),
  unsupportedGaps: Object.freeze(["multi-member household (HOUSEHOLD_MULTI_MEMBER_UNSUPPORTED)", "tax execution", "stochastic execution", "worker execution"]),
});

const addCashFlowsAndAssets = (base: PersonalDraft, family: "a" | "b", incomes: number, expenses: number, assets: number): PersonalDraft => {
  let model = base;
  for (let index = 0; index < incomes; index += 1) {
    const primitiveId = uuid(family, 700 + index);
    model = appendGrowthPrimitive(model, primitiveId, GOLDEN_HOUSEHOLD_IDS.salaryGrowthAssumption);
    model = addPersonalObject(model, "Income", uuid(family, 100 + index), {
      owner_id: GOLDEN_HOUSEHOLD_IDS.person,
      source: `Synthetic supplemental income ${index + 1}`,
      amount: `${800 + index * 25}.00`, frequency: "monthly", start_date: `2026-01-${String(4 + (index % 20)).padStart(2, "0")}`,
      gross_or_net: "gross", growth_model_id: primitiveId,
    });
  }
  for (let index = 0; index < expenses; index += 1) {
    const primitiveId = uuid(family, 800 + index);
    model = appendGrowthPrimitive(model, primitiveId, "90000000-0000-4000-8000-000000000017");
    model = addPersonalObject(model, "Expense", uuid(family, 300 + index), {
      owner_id: GOLDEN_HOUSEHOLD_IDS.household,
      category: `Synthetic household expense ${index + 1}`,
      amount: `${120 + (index % 8) * 15}.00`, frequency: "monthly", start_date: `2026-01-${String(15 + (index % 13)).padStart(2, "0")}`,
      payment_account_id: GOLDEN_HOUSEHOLD_IDS.checking,
      growth_model_id: primitiveId,
    });
  }
  for (let index = 0; index < assets; index += 1)
    model = addPersonalObject(model, "Asset", uuid(family, 500 + index), {
      name: `Synthetic durable asset ${index + 1}`, asset_type: "personal_property", owner_id: GOLDEN_HOUSEHOLD_IDS.household,
      acquisition_date: "2020-01-01", acquisition_cost: `${5000 + index * 250}.00`, valuation_method: "cost",
    });
  return model;
};

export const createRealisticPerformanceFixture = (): PerformanceHouseholdFixture => {
  const model = withScenarioEnd(addCashFlowsAndAssets(createGoldenHouseholdDraft(), "a", 1, 2, 2), "2028-01-01");
  return Object.freeze({ id: "realistic-household", classification: "synthetic", model, request: through(createGoldenHouseholdForecastRequest(uuid("a", 900)), "2028-01-01", 24), coverage: coverage(model, false) });
};

export const createStressPerformanceFixture = (): PerformanceHouseholdFixture => {
  const model = withScenarioEnd(addCashFlowsAndAssets(createGoldenHouseholdDraft(), "b", 2, 4, 12), "2031-01-01");
  return Object.freeze({ id: "stress-household", classification: "synthetic", model, request: through(createGoldenHouseholdForecastRequest(uuid("b", 900)), "2031-01-01", 60), coverage: coverage(model, true) });
};
