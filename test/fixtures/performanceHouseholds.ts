import {
  GOLDEN_HOUSEHOLD_IDS,
  addPersonalObject,
  createGoldenHouseholdDraft,
  createGoldenHouseholdForecastRequest,
  type HouseholdForecastRequest,
  type JsonObject,
  type PersonalDraft,
} from "../../src/application/index.js";
import { createGoldenHouseholdScenarioIntents } from "../../src/application/goldenHousehold.js";

export interface PerformanceFixtureCoverage {
  readonly canonicalObjectCounts: Readonly<Record<string, number>>;
  readonly primitives: readonly string[];
  readonly rules: readonly string[];
  readonly events: readonly string[];
  readonly scenarios: readonly string[];
  readonly executionMechanics: readonly string[];
  readonly unsupportedGaps: readonly string[];
  readonly executableEvidence: readonly string[];
}
export interface PerformanceHouseholdFixture {
  readonly id: string;
  readonly classification: "synthetic";
  readonly model: PersonalDraft;
  readonly request: HouseholdForecastRequest;
  readonly coverage: PerformanceFixtureCoverage;
  readonly dimensions: Readonly<{ horizonMonths: number; recurringOperationCount: number; modelEntityCount: number }>;
  readonly comparisonIntents: ReturnType<typeof createGoldenHouseholdScenarioIntents>;
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
const coverage = (model: PersonalDraft, stress: boolean, id: string): PerformanceFixtureCoverage => Object.freeze({
  canonicalObjectCounts: counts(model),
  primitives: Object.freeze(["P08 indexed recurring cash flow", "P23 periodic investment return", "VS4 fixed amortizing liability"]),
  rules: Object.freeze(["salary growth", "expense inflation", "investment return"]),
  events: Object.freeze(["scheduled retirement/income termination"]),
  scenarios: Object.freeze(["current plan (baseline request)", id === "realistic-household"
    ? "lower investment returns (bounded CI and controlled heavy validation)"
    : id === "stress-household" ? "lower investment returns (bounded controlled heavy validation; CI structure only)"
      : "lower investment returns (intent structure only for scaling probes; no probe comparison execution claim)"]),
  executionMechanics: Object.freeze(["opening reconciliation", "monthly recurrence", "funding/settlement", "recurring investment purchase", "owned-account transfer", "mark-to-market", "debt amortization", "extra principal with required-service dependency", ...(stress ? ["long horizon", "high recurring-flow count"] : [])]),
  unsupportedGaps: Object.freeze(["multi-member household (HOUSEHOLD_MULTI_MEMBER_UNSUPPORTED)", "tax execution", "stochastic execution", "worker execution"]),
  executableEvidence: Object.freeze([
    id === "realistic-household"
      ? "test/performanceInstrumentation.test.ts: provides executable distinct synthetic fixtures with explicit gaps (bounded realistic execution)"
      : id === "stress-household" ? "test/performanceInstrumentation.test.ts: provides executable distinct synthetic fixtures with explicit gaps (stress compilation/structure only)"
        : "test/performanceInstrumentation.test.ts: declares an independent horizon and recurring-operation scaling matrix with bounded compilation",
    ...(id === "realistic-household" ? ["test/performanceInstrumentation.test.ts: executes the declared lower-return comparison intent (realistic execution only)"] : []),
    ...(id === "realistic-household" || id === "stress-household" ? ["benchmarks/capture.ts: bounded lower-return comparison validation (controlled execution; not timed)"] : []),
    "benchmarks/capture.ts: completed primary/scaling forecast requests",
  ]),
});

const addCashFlowsAndAssets = (base: PersonalDraft, family: "a" | "b", incomes: number, expenses: number, assets: number): PersonalDraft => {
  let model = base;
  for (let index = 0; index < incomes; index += 1) {
    const primitiveId = uuid(family, 700 + index);
    model = appendGrowthPrimitive(model, primitiveId, GOLDEN_HOUSEHOLD_IDS.salaryGrowthAssumption);
    model = addPersonalObject(model, "Income", uuid(family, 100 + index), {
      owner_id: GOLDEN_HOUSEHOLD_IDS.person,
      source: `Synthetic supplemental income ${index + 1}`,
      amount: `${8000 + index * 25}.00`, frequency: "monthly", start_date: `2026-01-${String(4 + (index % 20)).padStart(2, "0")}`,
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

const object = (model: PersonalDraft, type: string, field: string, id: string): JsonObject => {
  const found = (model.objects[type] ?? []).find((value) => (value as JsonObject)[field] === id);
  if (found === undefined) throw new Error(`Synthetic template ${type} ${id} is missing.`);
  return found as JsonObject;
};
const append = (model: PersonalDraft, type: string, value: JsonObject): PersonalDraft => Object.freeze({
  ...model, objects: Object.freeze({ ...model.objects, [type]: Object.freeze([...(model.objects[type] ?? []), Object.freeze(value)]) }),
});
const mapObjects = (model: PersonalDraft, type: string, map: (value: JsonObject) => JsonObject): PersonalDraft => Object.freeze({
  ...model, objects: Object.freeze({ ...model.objects, [type]: Object.freeze((model.objects[type] ?? []).map((value) => Object.freeze(map(value as JsonObject)))) }),
});

/** All extra economics are supported compiler bindings, with explicit funding and dates. */
const representative = (id: string, family: "a" | "b", months: number, scale: number): PerformanceHouseholdFixture => {
  const end = `${2026 + Math.floor(months / 12)}-${String(months % 12 + 1).padStart(2, "0")}-01`;
  const retirementMonth = Math.max(1, months - 6);
  const retirementDate = `${2026 + Math.floor(retirementMonth / 12)}-${String(retirementMonth % 12 + 1).padStart(2, "0")}-01`;
  let model = withScenarioEnd(addCashFlowsAndAssets(createGoldenHouseholdDraft(), family, scale * 2, scale * 3, scale * 2), end);
  let request = through(createGoldenHouseholdForecastRequest(uuid(family, 900)), end, months);
  const investmentTemplate = object(model, "Investment", "investment_id", GOLDEN_HOUSEHOLD_IDS.brokerageInvestment);
  const returnTemplate = object(model, "PrimitiveInstance", "primitive_instance_id", String(investmentTemplate.return_model_id));
  const accountTemplate = object(model, "Account", "account_id", GOLDEN_HOUSEHOLD_IDS.brokerageAccount);
  const debtTemplate = object(model, "Liability", "liability_id", GOLDEN_HOUSEHOLD_IDS.mortgage);
  const eventTemplate = object(model, "Event", "event_id", GOLDEN_HOUSEHOLD_IDS.retirementEvent);
  const purchases = [...request.compiler.investments!.purchaseInstructions];
  const transfers = [...request.compiler.investments!.transferInstructions];
  const profiles = [...request.compiler.liabilities!.executionProfiles];
  const bindings = [...request.compiler.cashFlow!.retirementBindings!];
  const assumptionIds: string[] = [];
  const eventIds: string[] = [];
  // Diversify P08 assumption bindings rather than reusing one rate for every stream.
  for (let index = 0; index < scale * 2; index += 1) {
    const assumptionId = uuid(family, 1100 + index);
    assumptionIds.push(assumptionId);
    model = append(model, "Assumption", { ...object(model, "Assumption", "assumption_id", GOLDEN_HOUSEHOLD_IDS.salaryGrowthAssumption), assumption_id: assumptionId, value: index % 2 === 0 ? "0.0100" : "0.0250" });
    model = mapObjects(model, "PrimitiveInstance", (primitive) => primitive.primitive_instance_id === uuid(family, 700 + index) ? { ...primitive, input_bindings: { rate: assumptionId } } : primitive);
    const eventId = uuid(family, 1200 + index);
    eventIds.push(eventId);
    model = append(model, "Event", { ...eventTemplate, event_id: eventId, start_date: retirementDate, name: `Synthetic income cessation ${index + 1}` });
    bindings.push({ incomeId: uuid(family, 100 + index), canonicalEventId: eventId, terminationEventId: uuid(family, 1300 + index), baselineDate: retirementDate });
  }
  model = mapObjects(model, "Event", (event) => event.event_id === GOLDEN_HOUSEHOLD_IDS.retirementEvent ? { ...event, start_date: retirementDate } : event);
  bindings[0] = { ...bindings[0]!, baselineDate: retirementDate };
  for (let index = 0; index < scale * 2; index += 1) {
    const accountId = uuid(family, 1400 + index);
    const investmentId = uuid(family, 1500 + index);
    const primitiveId = uuid(family, 1600 + index);
    model = append(model, "Account", { ...accountTemplate, account_id: accountId, opening_balance: "0.00", name: `Synthetic investment account ${index + 1}` });
    model = append(model, "Investment", { ...investmentTemplate, investment_id: investmentId, account_id: accountId, return_model_id: primitiveId });
    model = append(model, "PrimitiveInstance", { ...returnTemplate, primitive_instance_id: primitiveId });
    purchases.push({ ...purchases[0]!, id: uuid(family, 1700 + index), investmentId, amount: "100.00", schedule: { kind: "utc_monthly", anchor: `2026-01-${String(11 + index).padStart(2, "0")}`, invalidDayPolicy: "skip" }, order: 20 + index });
  }
  transfers.push({ id: uuid(family, 1800), sourceAccountId: GOLDEN_HOUSEHOLD_IDS.checking, destinationAccountId: GOLDEN_HOUSEHOLD_IDS.savings, amount: "50.00", schedule: { kind: "utc_monthly", anchor: "2026-01-28", invalidDayPolicy: "skip" }, order: 100 });
  for (let index = 0; index < scale; index += 1) {
    const liabilityId = uuid(family, 1900 + index);
    // Let the compiler generate a distinct inert P22 identity for this contract.
    model = append(model, "Liability", { ...debtTemplate, liability_id: liabilityId, amortization_model_id: null });
    profiles.push({ ...profiles[0]!, liabilityId, settlementPriority: 2 + index,
      extraPrincipalPayments: [{ id: uuid(family, 2000 + index), scheduledAt: "2026-02-01", amount: "10.00" }],
    });
  }
  model = mapObjects(model, "Scenario", (scenario) => scenario.scenario_id === GOLDEN_HOUSEHOLD_IDS.rootScenario ? {
    ...scenario, assumption_ids: [...(scenario.assumption_ids as readonly string[]), ...assumptionIds], event_ids: [...(scenario.event_ids as readonly string[]), ...eventIds],
  } : scenario);
  request = Object.freeze({ ...request, compiler: Object.freeze({ ...request.compiler,
    cashFlow: Object.freeze({ ...request.compiler.cashFlow!, retirementBindings: Object.freeze(bindings) }),
    investments: Object.freeze({ ...request.compiler.investments!, purchaseInstructions: Object.freeze(purchases), transferInstructions: Object.freeze(transfers) }),
    liabilities: Object.freeze({ ...request.compiler.liabilities!, executionProfiles: Object.freeze(profiles) }),
  }) });
  const modelCounts = counts(model);
  const dimensions = Object.freeze({ horizonMonths: months, recurringOperationCount: (modelCounts.Income ?? 0) + (modelCounts.Expense ?? 0) + purchases.filter((item) => item.schedule.kind === "utc_monthly").length + transfers.length + profiles.length,
    modelEntityCount: Object.values(modelCounts).reduce((sum, count) => sum + count, 0) });
  const comparisonIntents = Object.freeze(createGoldenHouseholdScenarioIntents().filter((intent) => intent.changes.every((change) => change.kind === "investment_return")));
  return Object.freeze({ id, classification: "synthetic", model, request, dimensions, comparisonIntents, coverage: coverage(model, scale > 1, id) });
};

export const createRealisticPerformanceFixture = (): PerformanceHouseholdFixture => representative("realistic-household", "a", 24, 1);
export const createStressPerformanceFixture = (): PerformanceHouseholdFixture => representative("stress-household", "b", 180, 3);

/** Bounded, independent horizon/count probes; never folded into primary baseline samples. */
export const createPerformanceScalingFixtures = (): readonly PerformanceHouseholdFixture[] => Object.freeze(
  [12, 24].flatMap((months) => [1, 2].map((scale) => representative(`scaling:${months}:${scale}`, "a", months, scale))),
);
