import { describe, expect, it } from "vitest";
import { comparePersonalHouseholdMajorAssetDebtAddition, comparePersonalHouseholdScenarios, createGoldenHouseholdDraft, createGoldenHouseholdForecastRequest, createSyntheticPersonalDraft, runPersonalHouseholdForecast, type HouseholdForecastRequest } from "../src/application/index.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { assumptionId, scenarioId } from "../src/model/index.js";
import type { ExecutableScenario } from "../src/simulation/scenario.js";
import { instant } from "../src/time/index.js";
import { Rate, rateConvention } from "../src/values/index.js";

const request = (runIdentity: string): HouseholdForecastRequest => ({
  asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity,
  compiler: {
    cashFlow: { baseCurrency: "USD", simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3, sameInstantCashFlowOrder: "income_before_expense" },
    investments: { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3, executionOwnerId: "90000000-0000-4000-8000-000000000003", transferInstructions: [], purchaseInstructions: [] },
    liabilities: { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3, executionOwnerId: "90000000-0000-4000-8000-000000000003", executionProfiles: [] },
    contentionPolicy: { id: "pr20-application-order", version: "1", rules: [] },
  },
});
const model = (): ReturnType<typeof createSyntheticPersonalDraft> => { const value = createSyntheticPersonalDraft(); return { ...value, objects: { ...value.objects, Investment: [], Liability: [] } }; };
const investmentModel = (): ReturnType<typeof createSyntheticPersonalDraft> => {
  const value = createSyntheticPersonalDraft();
  const brokerage = "90000000-0000-4000-8000-000000000013";
  const primitive = "90000000-0000-4000-8000-000000000024";
  const marketAssumption = "90000000-0000-4000-8000-000000000025";
  return {
    ...value,
    objects: {
      ...value.objects,
      Liability: [],
      Account: [
        { ...(value.objects.Account as readonly Record<string, unknown>[])[0]!, transaction_ids: [], return_model_id: null },
        { ...(value.objects.Account as readonly Record<string, unknown>[])[0]!, account_id: brokerage, name: "Brokerage", account_type: "taxable_brokerage", opening_balance: "0.00", transaction_ids: [], return_model_id: null },
      ] as never,
      Investment: [{ ...(value.objects.Investment as readonly Record<string, unknown>[])[0]!, owner_id: "90000000-0000-4000-8000-000000000003", account_id: brokerage, quantity: "10", price: "10", market_value: "100", expected_return: null, volatility: null, contribution_model_id: null, return_model_id: primitive, rebalancing_rule_id: null }] as never,
      Assumption: [...(value.objects.Assumption as readonly Record<string, unknown>[]), { ...(value.objects.Assumption as readonly Record<string, unknown>[])[0]!, assumption_id: marketAssumption, name: "Market return", category: "market_return", value: "0.12", unit: "effective annual rate" }] as never,
      Scenario: [{ ...(value.objects.Scenario as readonly Record<string, unknown>[])[0]!, assumption_ids: ["90000000-0000-4000-8000-000000000010", marketAssumption] }] as never,
      PrimitiveInstance: [...(value.objects.PrimitiveInstance as readonly Record<string, unknown>[]), { primitive_instance_id: primitive, primitive_id: "P23", input_bindings: { rate: marketAssumption }, parameters: {}, scenario_id: "90000000-0000-4000-8000-000000000011", enabled: true }] as never,
    },
  };
};
const liabilityModel = (): ReturnType<typeof createSyntheticPersonalDraft> => {
  const value = createSyntheticPersonalDraft();
  return { ...value, objects: { ...value.objects, Income: [], Expense: [], Investment: [] } };
};

describe("Personal household projection application seam", () => {
  it("compares only a declared projection-start major asset and matching fixed debt", () => {
    const result = comparePersonalHouseholdMajorAssetDebtAddition(
      createGoldenHouseholdDraft(), createGoldenHouseholdForecastRequest("94000000-0000-4000-8000-000000000099"), {
        asset: { asset_id: "94000000-0000-4000-8000-000000000097", name: "Scenario home", asset_type: "real_estate", owner_id: "90000000-0000-4000-8000-000000000002", acquisition_cost: "400000", current_value: "400000", valuation_method: "cost", liquidity_class: "illiquid" },
        liability: { liability_id: "94000000-0000-4000-8000-000000000098", name: "Scenario mortgage", liability_type: "mortgage", owner_id: "90000000-0000-4000-8000-000000000002", principal: "300000", current_balance: "300000", interest_rate: "0.05", rate_type: "fixed", payment_frequency: "monthly", origination_date: "2026-01-01", collateral_id: "94000000-0000-4000-8000-000000000097" },
        profile: { liabilityId: "94000000-0000-4000-8000-000000000098", kind: "vs4_fixed_monthly_fully_amortizing", paymentAnchor: "2026-01-01", totalPayments: 360, fundingAccountId: "90000000-0000-4000-8000-000000000004", settlementPriority: 2, openingContractStatus: "current" },
      },
    );
    expect(result.status, JSON.stringify(result)).toBe("completed");
    if (result.status === "unavailable") return;
    expect(result.alternatives[0]!.declaredDifference).toBe("major_asset_debt_addition");
    expect(result.alternatives[0]!.points[0]!.deltas.netWorth.amount).not.toBe("0");
  }, 60_000);
  it("exposes reconciled household metrics and completion boundaries", () => {
    const result = runPersonalHouseholdForecast(model(), request("94000000-0000-4000-8000-000000000001"));
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.scope).toBe("household");
    expect(result.points).toHaveLength(3);
    expect(result.reachedThrough).toBe("2026-04-01T00:00:00.000Z");
    expect(result.points.every((point) => point.traceIds.length > 0)).toBe(true);
  });

  it("compares independently executed reconciled household runs", () => {
    const value = model();
    const result = comparePersonalHouseholdScenarios({ baseline: { name: "Baseline", model: value, request: request("94000000-0000-4000-8000-000000000002") }, alternatives: [{ name: "Equivalent", model: value, request: request("94000000-0000-4000-8000-000000000003") }] });
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.alternatives[0]!.points).toHaveLength(3);
    expect(result.alternatives[0]!.points.every((point) => point.deltas.netWorth.amount === "0")).toBe(true);
  });

  it("rejects hidden non-scenario execution-boundary differences", () => {
    const value = model();
    const baseline = request("94000000-0000-4000-8000-000000000004");
    const alternative = { ...request("94000000-0000-4000-8000-000000000005"), dataCutoff: "2025-12-30" };
    const result = comparePersonalHouseholdScenarios({ baseline: { name: "Baseline", model: value, request: baseline }, alternatives: [{ name: "Different cutoff", model: value, request: alternative }] });
    expect(result.status).toBe("unavailable");
    expect(result.diagnostics.some((issue) => issue.code === "HOUSEHOLD_SCENARIO_INCOMPATIBLE")).toBe(true);
  });

  it("rejects contention policy changes that are not scenario overlays", () => {
    const value = model();
    const baseline = request("94000000-0000-4000-8000-000000000006");
    const changed = request("94000000-0000-4000-8000-000000000007");
    const alternative = { ...changed, compiler: { ...changed.compiler, contentionPolicy: { id: "different-policy", version: "1" as const, rules: [] } } };
    const result = comparePersonalHouseholdScenarios({ baseline: { name: "Baseline", model: value, request: baseline }, alternatives: [{ name: "Changed policy", model: value, request: alternative }] });
    expect(result.status).toBe("unavailable");
    expect(result.diagnostics.some((issue) => issue.code === "HOUSEHOLD_SCENARIO_INCOMPATIBLE")).toBe(true);
  });

  it("rejects an ordinary model edit that is not represented by a scenario overlay", () => {
    const baselineModel = model();
    const editedModel = {
      ...baselineModel,
      objects: {
        ...baselineModel.objects,
        Income: (baselineModel.objects.Income as readonly Record<string, unknown>[])
          .map((income) => ({ ...income, amount: "7000.00" })) as never,
      },
    };
    const result = comparePersonalHouseholdScenarios({
      baseline: { name: "Baseline", model: baselineModel, request: request("94000000-0000-4000-8000-000000000008") },
      alternatives: [{ name: "Edited model", model: editedModel, request: request("94000000-0000-4000-8000-000000000009") }],
    });
    expect(result.status).toBe("unavailable");
    expect(result.diagnostics.some((issue) => issue.code === "HOUSEHOLD_SCENARIO_INCOMPATIBLE")).toBe(true);
  });

  it("compares the externally supplied investment overlay that household execution actually runs", () => {
    const root = scenarioId("90000000-0000-4000-8000-000000000011");
    const leaf = scenarioId("90000000-0000-4000-8000-000000000021");
    const position = "90000000-0000-4000-8000-000000000009";
    const assumption = assumptionId("90000000-0000-4000-8000-000000000025");
    const horizon = { start: instant("2026-01-01T00:00:00.000Z"), end: instant("2026-04-01T00:00:00.000Z") };
    const scenarios: readonly ExecutableScenario[] = [
      { scenarioId: root, name: "Root", horizon, timestep: "monthly", enabled: true, stochastic: false, simulationCount: 1, changes: [] },
      { scenarioId: leaf, baseScenarioId: root, name: "Higher return", horizon, timestep: "monthly", enabled: true, stochastic: false, simulationCount: 1, changes: [{ kind: "investment_return", positionId: position as never, rate: Rate.fromDecimal("0.2", rateConvention.effectiveAnnual()), assumptionId: assumption }] },
    ];
    const base = request("94000000-0000-4000-8000-000000000022");
    const withInvestments: HouseholdForecastRequest = { ...base, compiler: { ...base.compiler, investments: { ...base.compiler.investments!, scenarioId: String(root) } } };
    const result = comparePersonalHouseholdScenarios({ scenarios, baselineScenarioId: root, baseline: { name: "Base", model: investmentModel(), request: withInvestments }, alternatives: [{ name: "Higher return", model: investmentModel(), request: { ...withInvestments, runIdentity: "94000000-0000-4000-8000-000000000023" }, scenarioId: leaf }] });
    expect(result.status, JSON.stringify(result)).toBe("completed");
    const difference = result.alternatives[0]!.configurationDifferences.find((item) => item.changeKind === "investment_return");
    expect(difference?.before).not.toBeNull();
    expect(difference?.after).not.toBeNull();
    expect(difference?.assumptionIds).toContain(assumption);
  });

  it("reports non-null before/after values for an executed liability funding overlay", () => {
    const root = scenarioId("90000000-0000-4000-8000-000000000011");
    const leaf = scenarioId("90000000-0000-4000-8000-000000000026");
    const base = request("94000000-0000-4000-8000-000000000027");
    const liabilityRequest: HouseholdForecastRequest = { ...base, compiler: { liabilities: { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3, executionOwnerId: "90000000-0000-4000-8000-000000000003", scenarioId: String(root), executionProfiles: [{ liabilityId: "90000000-0000-4000-8000-000000000008", kind: "vs4_fixed_monthly_fully_amortizing", paymentAnchor: "2022-02-01", totalPayments: 360, fundingAccountId: "90000000-0000-4000-8000-000000000004", settlementPriority: 1, openingContractStatus: "current" }] } } };
    const sourceModel = liabilityModel();
    const compiled = compileHouseholdProjection(sourceModel, liabilityRequest.compiler);
    expect(compiled.status, JSON.stringify(compiled)).toBe("compiled");
    if (compiled.status !== "compiled") return;
    const loan = compiled.value.liabilityInput!.loans[0]!;
    const replacementPolicy = createFundingPolicy({ id: fundingPolicyId("scenario:liability-funding"), orderedSources: [...loan.fundingPolicy.orderedSources], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const horizon = { start: instant("2026-01-01T00:00:00.000Z"), end: instant("2026-04-01T00:00:00.000Z") };
    const scenarios: readonly ExecutableScenario[] = [
      { scenarioId: root, name: "Root", horizon, timestep: "monthly", enabled: true, stochastic: false, simulationCount: 1, changes: [] },
      { scenarioId: leaf, baseScenarioId: root, name: "Funding policy", horizon, timestep: "monthly", enabled: true, stochastic: false, simulationCount: 1, changes: [{ kind: "loan_funding_policy", loanId: loan.id, fundingPolicy: replacementPolicy, assumptionId: assumptionId("90000000-0000-4000-8000-000000000010") }] },
    ];
    const result = comparePersonalHouseholdScenarios({ scenarios, baselineScenarioId: root, baseline: { name: "Base", model: sourceModel, request: liabilityRequest }, alternatives: [{ name: "Funding policy", model: sourceModel, request: { ...liabilityRequest, runIdentity: "94000000-0000-4000-8000-000000000028" }, scenarioId: leaf }] });
    expect(result.status, JSON.stringify(result)).toBe("completed");
    const difference = result.alternatives[0]!.configurationDifferences.find((item) => item.changeKind === "loan_funding_policy");
    expect(difference?.before).not.toBeNull();
    expect(difference?.after).toMatchObject({ id: "scenario:liability-funding" });
    expect(difference?.assumptionIds).toContain(assumptionId("90000000-0000-4000-8000-000000000010"));
  });
});
