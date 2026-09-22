import { describe, expect, it } from "vitest";
import { comparePersonalHouseholdScenarios, createSyntheticPersonalDraft, runPersonalHouseholdForecast, type HouseholdForecastRequest } from "../src/application/index.js";

const request = (runIdentity: string): HouseholdForecastRequest => ({
  asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity,
  compiler: {
    cashFlow: { baseCurrency: "USD", simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3, sameInstantCashFlowOrder: "income_before_expense" },
    investments: { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3, executionOwnerId: "90000000-0000-4000-8000-000000000003", transferInstructions: [], purchaseInstructions: [] },
    liabilities: { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3, executionOwnerId: "90000000-0000-4000-8000-000000000003", executionProfiles: [] },
    contentionPolicy: { id: "pr20-application-order", version: "1", rules: [] },
  },
});
const model = () => { const value = createSyntheticPersonalDraft(); return { ...value, objects: { ...value.objects, Investment: [], Liability: [] } }; };

describe("Personal household projection application seam", () => {
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
});
