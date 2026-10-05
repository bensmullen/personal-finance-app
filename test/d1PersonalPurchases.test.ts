import { describe, expect, it } from "vitest";
import { authorPersonalPurchasePlan, createGoldenHouseholdDraft, type PersonalDraft } from "../src/application/personalMvp.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { GOLDEN_HOUSEHOLD_IDS as ids, createGoldenHouseholdForecastRequest } from "../src/application/goldenHousehold.js";
import { compileInvestments } from "../src/application/compiler/investments.js";
import { runVerticalSlice3 } from "../src/simulation/verticalSlice3.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { USD } from "../src/values/index.js";
import type { JsonValue } from "../src/model/modelVersion.js";

const record = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
const primitiveId = "d1c20000-0000-4000-8000-000000000001";
const base = (): PersonalDraft => {
  const original = createGoldenHouseholdDraft();
  return { ...original, objects: { ...original.objects, Assumption: original.objects.Assumption!.map(value => record(value) && value.category === "market_return" ? { ...value, value: "0" } : value) } };
};
describe("D1 durable personally funded purchases", () => {
  it.each([
    [ids.checking, "once", "19000", "15000", "510"],
    [ids.savings, "once", "20000", "14000", "510"],
    [ids.checking, "monthly", "18000", "15000", "520"],
    [ids.savings, "monthly", "20000", "13000", "520"],
  ] as const)("executes %s %s with independent cash/quantity effects after import", (sourceCashAccountId, frequency, checking, savings, quantity) => {
    const original = base();
    const authored = authorPersonalPurchasePlan(original, { primitiveId, investmentId: ids.brokerageInvestment, sourceCashAccountId, amount: "1000", frequency, date: "2026-01-10", order: 10 });
    const restored = importPersonalModelJson(exportPersonalModelJson(authored));
    expect(restored).toEqual(authored);
    const request = createGoldenHouseholdForecastRequest().compiler.investments!;
    const compiled = compileInvestments(restored, { ...request, simulationEnd: "2026-03-01", months: 2, purchaseInstructions: [] });
    expect(compiled.status, JSON.stringify(compiled)).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("purchase fixture did not compile");
    const run = runVerticalSlice3({ input: compiled.value.input, openingState: compiled.value.openingState, primitiveState: compiled.value.primitiveState, months: 2,
      runContext: createRunContext({ runId: runId("d1c20000-0000-4000-8000-000000000002"), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-03-01T00:00:00.000Z"), baseCurrency: USD }) });
    expect(run.status).toBe("completed");
    expect(run.state.accounts[ids.checking]!.cash.amount.toString()).toBe(checking);
    expect(run.state.accounts[ids.savings]!.cash.amount.toString()).toBe(savings);
    expect(run.state.accounts[ids.brokerageAccount]!.cash.amount.toString()).toBe("0");
    expect(run.state.positions[ids.brokerageInvestment]!.quantity.amount.toString()).toBe(quantity);
    expect(compiled.value.openingState.accounts[ids.checking]!.cash.amount.toString()).toBe("20000");
    expect(original.objects.Investment!.filter(record).find(item => item.investment_id === ids.brokerageInvestment)!.contribution_model_id).toBeUndefined();
    expect(run.periods.map(item => item.contributionPrincipal.amount.toString())).toEqual(frequency === "once" ? ["1000", "0"] : ["1000", "1000"]);
  });
  it.each([ids.brokerageAccount, ids.retirementAccount])("rejects non-bank funding %s before changing the model", sourceCashAccountId => {
    const model = base();
    expect(() => authorPersonalPurchasePlan(model, { primitiveId, investmentId: ids.brokerageInvestment, sourceCashAccountId, amount: "1000", frequency: "monthly", date: "2026-01-10", order: 10 })).toThrow("PERSONAL_PURCHASE_CHECKING_OR_SAVINGS_REQUIRED");
    expect(model.objects.PrimitiveInstance!.filter(record).some(item => item.primitive_instance_id === primitiveId)).toBe(false);
  });
});
