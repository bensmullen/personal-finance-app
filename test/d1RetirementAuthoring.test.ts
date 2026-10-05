import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, editPersonalRetirementDate, getPersonalRetirementPlans } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { comparePersonalHouseholdScenarioIntents, runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { compileCashFlow } from "../src/application/compiler/cashFlow.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import type { JsonValue } from "../src/model/modelVersion.js";

const record = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);

describe("D1-A durable baseline retirement date", () => {
  it("selects the canonical root when an enabled child scenario also exists", () => {
    const original = createGoldenHouseholdDraft();
    const root = original.objects.Scenario!.filter(record).find(value => value.scenario_id === ids.rootScenario);
    if (!root) throw new Error("fixture root missing");
    const model = { ...original, objects: { ...original.objects, Scenario: [...original.objects.Scenario!, {
      ...root, scenario_id: "d1000000-0000-4000-8000-000000000060", base_scenario_id: ids.rootScenario, enabled: true,
    }] } };
    const edited = editPersonalRetirementDate(model, ids.income, "2026-02-01");
    expect(getPersonalRetirementPlans(edited)[0]!.date).toBe("2026-02-01");
    expect(getPersonalRetirementPlans(model)[0]!.date).toBe("2035-01-01");
  });
  it("updates canonical baseline and derives its binding despite an older session date", () => {
    const original = createGoldenHouseholdDraft();
    const edited = editPersonalRetirementDate(original, ids.income, "2026-02-01");
    expect(getPersonalRetirementPlans(original)[0]!.date).toBe("2035-01-01");
    expect(getPersonalRetirementPlans(edited)[0]!.date).toBe("2026-02-01");
    const request = createGoldenHouseholdForecastRequest();
    const compiled = compileCashFlow(edited, { ...request.compiler.cashFlow!, simulationEnd: "2026-03-01", months: 2 });
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("fixture did not compile");
    expect(compiled.value.input.events[0]!.effectiveAt).toBe("2026-02-01T00:00:00.000Z");
    const derived = compileCashFlow(importPersonalModelJson(exportPersonalModelJson(edited)), { ...request.compiler.cashFlow!, simulationEnd: "2026-03-01", months: 2, retirementBindings: [] });
    expect(derived.status).toBe("compiled");
    if (derived.status !== "compiled") throw new Error("restored fixture did not compile");
    expect(derived.value.input.events[0]!.effectiveAt).toBe("2026-02-01T00:00:00.000Z");
  });
  it("terminates salary in the edited baseline and compares an alternative without mutation", () => {
    const original = createGoldenHouseholdDraft();
    const model = editPersonalRetirementDate(original, ids.income, "2026-02-01");
    const full = createGoldenHouseholdForecastRequest();
    const request = { ...full, compiler: { ...full.compiler,
      cashFlow: { ...full.compiler.cashFlow!, simulationEnd: "2026-03-01", months: 2 },
      investments: { ...full.compiler.investments!, simulationEnd: "2026-03-01", months: 2 },
      liabilities: { ...full.compiler.liabilities!, simulationEnd: "2026-03-01", months: 2 },
    } };
    const baseline = runPersonalHouseholdForecast(model, request);
    expect(baseline.status, JSON.stringify(baseline)).not.toBe("unavailable");
    if (baseline.status === "unavailable") throw new Error(baseline.message);
    expect(baseline.points.map(point => point.statementIncome.amount)).toEqual(["9000", "0"]);
    // Compare through March so the alternative event is inside [start, end).
    // Keep the independent January/February baseline oracle above unchanged.
    const comparisonRequest = { ...request, compiler: { ...request.compiler,
      cashFlow: { ...request.compiler.cashFlow!, simulationEnd: "2026-04-01", months: 3 },
      investments: { ...request.compiler.investments!, simulationEnd: "2026-04-01", months: 3 },
      liabilities: { ...request.compiler.liabilities!, simulationEnd: "2026-04-01", months: 3 },
    } };
    const result = comparePersonalHouseholdScenarioIntents(model, comparisonRequest, [{ scenarioId: "d1000000-0000-4000-8000-000000000050", name: "Retire in March", changes: [{
      kind: "retirement_date", incomeId: ids.income, targetEventId: ids.retirementEvent, baselineDate: "2026-02-01", newDate: "2026-03-01",
      eventId: "d1000000-0000-4000-8000-000000000051",
    }] }]);
    expect(result.status, JSON.stringify(result)).not.toBe("unavailable");
    expect(result.diagnostics.some(diagnostic => diagnostic.code === "RETIREMENT_BINDING_MISMATCH")).toBe(false);
    expect(getPersonalRetirementPlans(model)[0]!.date).toBe("2026-02-01");
    expect(getPersonalRetirementPlans(original)[0]!.date).toBe("2035-01-01");
    expect(runPersonalHouseholdForecast(model, request)).toEqual(baseline);
  });
});
