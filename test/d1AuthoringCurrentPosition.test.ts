import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, getCurrentPosition, patchPersonalObject, runPersonalForecast, type PersonalDraft, type ForecastRequest } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest } from "../src/application/goldenHousehold.js";
import { calculationFingerprint } from "../src/application/interactiveForecast.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { classifyAccountEconomics } from "../src/model/economicClassification.js";
import type { JsonValue } from "../src/model/modelVersion.js";
import { belongsToNetWorthSection } from "../ui/entityPresentation.js";

const boundary = { baseCurrency: "USD", asOf: "2026-01-03" };
const record = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
const change = (model: PersonalDraft, collection: string, id: string, patch: Record<string, JsonValue>): PersonalDraft => ({
  ...model,
  objects: { ...model.objects, [collection]: model.objects[collection]!.map(value => {
    if (!record(value)) return value;
    return value[`${collection.toLowerCase()}_id`] === id ? { ...value, ...patch } : value;
  }) },
});

describe("D1-A current-position economic meaning", () => {
  it("keeps current salary usable with a valid future scheduled retirement", () => {
    const current = getCurrentPosition(createGoldenHouseholdDraft(), boundary);
    expect(current.status).toBe("complete");
    expect(current.monthlyIncome?.exact).toBe("9000");
    expect(current.monthlySpending?.exact).toBe("4800");
    expect(current.monthlyCashFlow?.exact).toBe("4200");
    expect(current.cash?.exact).toBe("35000");
    expect(current.netWorth?.exact).toBe("309330.29");
    expect(current.diagnostics).toEqual([]);
  });

  it.each<Record<string, JsonValue>>([
    { event_type: "custom" }, { trigger_type: "probabilistic" }, { enabled: false },
    { start_date: "2026-01-03" }, { start_date: "invalid" },
    { precedence: 1 }, { duration_days: 1 }, { end_date: "2035-01-02" },
    { probability_model_id: ids.salaryGrowthAssumption },
    { effect_ids: [ids.income] }, { dependencies: [ids.income] },
  ])("continues gating unsupported event semantics: %j", patch => {
    const current = getCurrentPosition(change(createGoldenHouseholdDraft(), "Event", ids.retirementEvent, patch), boundary);
    expect(current.status).toBe("partial");
    expect(current.monthlyIncome).toBeUndefined();
    expect(current.monthlySpending?.exact).toBe("4800");
    expect(current.diagnostics).toContainEqual(expect.objectContaining({ code: "MONTHLY_FLOW_EVENT_SEMANTICS_UNSUPPORTED" }));
  });

  it("requires retirement membership in the selected baseline scenario", () => {
    const model = change(createGoldenHouseholdDraft(), "Scenario", ids.rootScenario, { event_ids: [] });
    expect(getCurrentPosition(model, boundary).monthlyIncome).toBeUndefined();
  });

  it("counts wrapper internal cash separately from spendable cash and positions", () => {
    let model = createGoldenHouseholdDraft();
    model = change(model, "Account", ids.retirementAccount, { opening_balance: "2000", name: "Checking" });
    model = change(model, "Account", ids.brokerageAccount, { opening_balance: "3000", name: "Savings" });
    const current = getCurrentPosition(model, boundary);
    expect(current.cash?.exact).toBe("35000");
    expect(current.wrapperCash?.exact).toBe("5000");
    // 35,000 household cash + 5,000 wrapper cash + 150,000 holdings + 350,000 home.
    expect(current.assets?.exact).toBe("540000");
    expect(current.liabilities?.exact).toBe("225669.71");
    expect(current.netWorth?.exact).toBe("314330.29");
    const wrapper = model.objects.Account!.filter(record).find(value => value.account_id === ids.retirementAccount);
    if (!wrapper) throw new Error("missing fixture wrapper");
    expect(belongsToNetWorthSection(model, "Account", wrapper, "Cash & bank accounts")).toBe(false);
    expect(belongsToNetWorthSection(model, "Account", wrapper, "Investments & retirement")).toBe(true);
    const restored = importPersonalModelJson(exportPersonalModelJson(model));
    expect(getCurrentPosition(restored, boundary)).toEqual(current);
  });

  it("counts an Investment and its linked Asset only once", () => {
    const model = createGoldenHouseholdDraft();
    const assetId = "d1000000-0000-4000-8000-000000000001";
    const linked = change({ ...model, objects: { ...model.objects, Asset: [...model.objects.Asset!, {
      asset_id: assetId, owner_id: ids.person, name: "Same retirement holding", asset_type: "investment",
      acquisition_cost: "100000", valuation_method: "cost",
    }] } }, "Investment", ids.retirementInvestment, { asset_id: assetId });
    const current = getCurrentPosition(linked, boundary);
    expect(current.assets?.exact).toBe("535000");
    expect(current.netWorth?.exact).toBe("309330.29");
  });

  it("does not guess classification from account names", () => {
    expect(classifyAccountEconomics("traditional_401k")).toBe("retirement_wrapper");
    expect(classifyAccountEconomics("taxable_brokerage")).toBe("investment_wrapper");
    expect(classifyAccountEconomics("hsa_investment")).toBe("restricted_wrapper");
    expect(classifyAccountEconomics("other")).toBe("unsupported");
    for (const type of ["checking", "savings", "cash"]) expect(classifyAccountEconomics(type)).toBe("household_cash");
  });

  it("preserves known household cash when a non-cash account class is unsupported", () => {
    const model = change(createGoldenHouseholdDraft(), "Account", ids.retirementAccount, { account_type: "other", opening_balance: "2000" });
    const current = getCurrentPosition(model, boundary);
    expect(current.status).toBe("partial");
    expect(current.cash?.exact).toBe("35000");
    expect(current.monthlyIncome?.exact).toBe("9000");
    expect(current.wrapperCash).toBeUndefined();
    expect(current.assets).toBeUndefined();
    expect(current.netWorth).toBeUndefined();
    expect(current.diagnostics).toContainEqual(expect.objectContaining({ code: "ACCOUNT_ECONOMIC_CLASS_UNSUPPORTED", entityId: ids.retirementAccount }));
  });

  it("executes a baseline linked return edit without changing current holdings or unrelated assumptions", () => {
    let baseline = createGoldenHouseholdDraft();
    for (const assumption of baseline.objects.Assumption!) {
      if (record(assumption) && assumption.category === "market_return")
        baseline = patchPersonalObject(baseline, "Assumption", String(assumption.assumption_id), { value: "0" });
    }
    // (1 + 4095)^(1/12) = 2 exactly: a deliberately synthetic oracle without floating-point expectations.
    const edited = patchPersonalObject(baseline, "Assumption", ids.retirementReturnAssumption, { value: "4095" });
    const request: ForecastRequest = {
      scope: "investments", baseCurrency: "USD", asOf: "2026-01-01", dataCutoff: "2026-01-01",
      simulationStart: "2026-01-01", simulationEnd: "2026-02-01", months: 1,
      sameInstantCashFlowOrder: "income_before_expense", executionOwnerId: ids.person, scenarioId: ids.rootScenario,
      investmentTransferInstructions: [], investmentPurchaseInstructions: [],
    };
    const before = runPersonalForecast(baseline, request);
    const after = runPersonalForecast(edited, request);
    expect(before.status).toBe("completed");
    expect(after.status).toBe("completed");
    if (before.status === "unavailable" || after.status === "unavailable" || before.scope !== "investments" || after.scope !== "investments") throw new Error("fixture did not execute");
    expect(before.points[0]!.portfolioValue.exact).toBe("150000");
    expect(after.points[0]!.portfolioValue.exact).toBe("250000");
    expect(after.points[0]!.unrealizedGain.exact).toBe("100000");
    expect(after.points[0]!.contributionPrincipal.exact).toBe("0");
    expect(after.points[0]!.accountValues.find(value => value.accountId === ids.brokerageAccount)?.value.exact).toBe("50000");
    expect(getCurrentPosition(edited, boundary)).toEqual(getCurrentPosition(baseline, boundary));
    expect(runPersonalForecast(baseline, request)).toEqual(before);
    const householdRequest = createGoldenHouseholdForecastRequest();
    expect(calculationFingerprint("baseline_forecast", baseline, householdRequest)).not.toBe(calculationFingerprint("baseline_forecast", edited, householdRequest));
    expect(runPersonalForecast(importPersonalModelJson(exportPersonalModelJson(edited)), request)).toEqual(after);
  });
});
