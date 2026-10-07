import { describe, expect, it } from "vitest";
import { currentPlan, replaceCurrentPlanHorizon, simulationWindowProblem } from "../src/application/forecastSetup.js";
import { compileForecastTaxSettlements, forecastTaxJurisdictions, forecastTaxSetupProblem } from "../src/application/taxForecastSetup.js";
import { createGoldenHouseholdExampleDraft, exportPersonalModelJson, importPersonalModelJson, type JsonObject } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { compileHouseholdTax } from "../src/application/compiler/tax.js";
import { compileHouseholdProjection, type HouseholdProjectionCompilerRequest } from "../src/application/compiler/householdProjection.js";
import { projectedCurrentLawCatalog } from "../src/rules/tax/projection.js";
import { federal2024TaxCatalog, federal2026TaxCatalog } from "../src/rules/tax/lawCatalog.js";
import { resolveTaxCoreRule, taxCatalogFingerprint } from "../src/rules/tax/catalog.js";
import { domainId } from "../src/identity/index.js";
import { instant } from "../src/time/index.js";
import { runHouseholdKernel, replayHouseholdForecastWindow } from "../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { createRunContext, runId, scenarioId, canonicalSerialize } from "../src/simulation/run.js";
import { USD } from "../src/values/index.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest, integratedId } from "./fixtures/d1IntegratedHousehold.js";

const replacementId = integratedId(991);
const settlementSetup = {
  paymentAccountId: golden.checking, refundAccountId: golden.savings,
  conventions: [{ jurisdiction: "US:FEDERAL", monthDay: "04-15", priority: 0, confirmed: true }, { jurisdiction: "US:NY", monthDay: "04-15", priority: 1, confirmed: true }],
};
const context = (end: string) => createRunContext({ runId: runId(integratedId(992)), scenarioId: scenarioId(golden.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant(`${end}T00:00:00.000Z`), baseCurrency: USD });
const requestThrough = (end: string, months: number): HouseholdProjectionCompilerRequest => {
  const base = d1IntegratedCompilerRequest();
  return { ...base, cashFlow: { ...base.cashFlow!, simulationEnd: end, months }, investments: { ...base.investments!, simulationEnd: end, months }, liabilities: { ...base.liabilities!, simulationEnd: end, months } };
};
const kernel = (request: HouseholdProjectionCompilerRequest) => {
  const compiled = compileHouseholdProjection(createD1IntegratedHousehold(), request);
  expect(compiled.status).toBe("compiled");
  if (compiled.status !== "compiled") throw new Error(compiled.diagnostics.map(item => item.message).join(" "));
  return compiled.value.executionKernel!;
};

describe("Issue 80 resolved forecast decisions", () => {
  it("replaces Current Plan identity, preserves owned economics/references and exports one enabled root", () => {
    const model = createD1IntegratedHousehold();
    const old = currentPlan(model)!;
    const next = replaceCurrentPlanHorizon(model, replacementId, "2026-01-01", "2037-01-01", { start: "2026-01-01", end: "2036-01-01" });
    expect(currentPlan(model)).toBe(old);
    expect(currentPlan(next)).toEqual({ ...old, scenario_id: replacementId, end_date: "2037-01-01" });
    expect((next.objects.Scenario as readonly JsonObject[]).filter(item => item.enabled && item.base_scenario_id == null)).toHaveLength(1);
    expect((next.objects.Scenario as readonly JsonObject[]).find(item => item.scenario_id === old.scenario_id)).toMatchObject({ start_date: old.start_date, end_date: old.end_date, enabled: false });
    for (const [type, entries] of Object.entries(model.objects)) if (type !== "Scenario") expect(next.objects[type]).toEqual(entries.map(item => typeof item === "object" && item !== null && !Array.isArray(item) && item.scenario_id === old.scenario_id ? { ...item, scenario_id: replacementId } : item));
    expect(simulationWindowProblem(model, "2026-01-01", "2037-01-01")).toContain("exceeds");
    expect(simulationWindowProblem(next, "2026-01-01", "2037-01-01")).toBeUndefined();
    expect(importPersonalModelJson(exportPersonalModelJson(next))).toEqual(next);
    const request = d1IntegratedCompilerRequest();
    const rebased = compileHouseholdProjection(next, { ...request, cashFlow: { ...request.cashFlow!, scenarioId: replacementId }, investments: { ...request.investments!, scenarioId: replacementId }, liabilities: { ...request.liabilities!, scenarioId: replacementId } });
    expect(rebased.status).toBe("compiled");
    if (rebased.status === "compiled") {
      const before = runHouseholdKernel({ kernel: kernel(request), runContext: context("2026-02-01") });
      const after = runHouseholdKernel({ kernel: rebased.value.executionKernel!, runContext: createRunContext({ ...context("2026-02-01"), scenarioId: scenarioId(replacementId) }) });
      expect(after.state).toEqual(before.state);
    }
  });

  it("rejects shortening and child topology non-destructively with a normal correction path", () => {
    const model = createGoldenHouseholdExampleDraft(), before = exportPersonalModelJson(model);
    expect(() => replaceCurrentPlanHorizon(model, replacementId, "2026-01-01", "2030-01-01", { start: "2026-01-01", end: "2036-01-01" })).toThrow("Correct Simulation dates");
    expect(() => replaceCurrentPlanHorizon(model, replacementId, "2026-01-01", "2030-01-01", { start: "2026-01-01", end: "2027-01-01" })).toThrow("Correct retirement dates");
    const childModel = { ...model, objects: { ...model.objects, Scenario: [...model.objects.Scenario!, { ...currentPlan(model)!, scenario_id: integratedId(993), base_scenario_id: golden.rootScenario }] } };
    expect(() => replaceCurrentPlanHorizon(childModel, replacementId, "2026-01-01", "2037-01-01", { start: "2026-01-01", end: "2036-01-01" })).toThrow("alternatives");
    expect(exportPersonalModelJson(model)).toBe(before);
  });

  it("keeps verified 2026 selection exact, separates projection provenance and prefers later verified rules", () => {
    const verified = [...federal2024TaxCatalog, ...federal2026TaxCatalog], fingerprint = taxCatalogFingerprint(verified);
    const base = federal2026TaxCatalog.find(rule => rule.filingStatus === "single")!;
    const future = { ...base, id: domainId("tax-rule", integratedId(994)), version: "future-enacted-test", effectiveFrom: instant("2028-01-01T00:00:00.000Z"), effectiveUntil: instant("2029-01-01T00:00:00.000Z") };
    const catalog = projectedCurrentLawCatalog([...verified, future], "2036-01-01");
    const facts = { residenceJurisdictions: ["US:NY"], workJurisdictions: ["US:NY"], eligibility: { federal_base_deduction_only: true } };
    const resolve = (year: string) => resolveTaxCoreRule(catalog, "US:FEDERAL", "single", instant(`${year}-01-01T00:00:00.000Z`), facts).rule;
    expect(resolve("2026")).toEqual(base);
    expect(resolve("2027").provenance).toMatchObject({ type: "projected_current_law", baseYear: 2026, baseRuleId: base.id });
    expect(resolve("2027").income).toEqual(base.income);
    expect(resolve("2028")).toEqual(future);
    expect(resolve("2029").provenance).toMatchObject({ type: "projected_current_law", baseYear: 2028, baseRuleId: future.id });
    expect(taxCatalogFingerprint(verified)).toBe(fingerprint);
    expect(taxCatalogFingerprint(catalog)).not.toBe(fingerprint);
  });

  it("requires confirmed accounts/dates and includes exact scheduled-later settlements without estimated amounts", () => {
    const model = createGoldenHouseholdExampleDraft();
    expect(forecastTaxJurisdictions(model)).toEqual(["US:FEDERAL", "US:NY"]);
    expect(forecastTaxSetupProblem(model, undefined, "2026-01-01", "2026-02-01")).toContain("confirm");
    expect(forecastTaxSetupProblem(model, settlementSetup, "2026-01-01", "2026-02-01")).toBeUndefined();
    const request = compileForecastTaxSettlements(settlementSetup, "2026-01-01", "2026-02-01");
    expect(request.payments).toBeUndefined();
    expect(request.settlements).toEqual([{ id: "forecast-tax:US:FEDERAL:2026", jurisdiction: "US:FEDERAL", taxYear: "2026", at: "2027-04-15T00:00:00.000Z", priority: 0 }, { id: "forecast-tax:US:NY:2026", jurisdiction: "US:NY", taxYear: "2026", at: "2027-04-15T00:00:00.000Z", priority: 1 }]);
    expect(compileHouseholdTax(model, request).status).toBe("compiled");
    expect(() => compileForecastTaxSettlements({ ...settlementSetup, conventions: [{ ...settlementSetup.conventions[0]!, confirmed: false }] }, "2026-01-01", "2027-01-01")).toThrow("Confirm");
    expect(forecastTaxSetupProblem(model, { ...settlementSetup, conventions: settlementSetup.conventions.map(item => ({ ...item, priority: 0 })) }, "2026-01-01", "2027-01-01")).toContain("distinct priorities");
    expect(() => compileForecastTaxSettlements({ ...settlementSetup, conventions: [{ ...settlementSetup.conventions[0]!, monthDay: "02-30" }] }, "2026-01-01", "2027-01-01")).toThrow();
  });

  it("preserves 2026 economics and continues ten years of recurring contributions under explicit projected law", () => {
    const firstYear = requestThrough("2027-01-01", 12);
    const verified = runHouseholdKernel({ kernel: kernel(firstYear), runContext: context("2027-01-01") });
    const projected = runHouseholdKernel({ kernel: kernel({ ...firstYear, forecastLawPolicy: "projected_current_law" }), runContext: context("2027-01-01") });
    expect(projected.state).toEqual(verified.state);
    const long = requestThrough("2036-01-01", 120);
    const result = runHouseholdKernel({ kernel: kernel({ ...long, forecastLawPolicy: "projected_current_law", tax: compileForecastTaxSettlements(settlementSetup, "2026-01-01", "2036-01-01") }), runContext: context("2036-01-01") });
    expect(result.stoppedAt, JSON.stringify(result.diagnostics)).toBeUndefined();
    expect(result.reachedThrough).toBe("2036-01-01T00:00:00.000Z");
    expect(result.periods).toHaveLength(120);
    const future = Object.values(result.state.contributions ?? {}).filter(entry => entry.at >= "2027-01-01");
    expect(future.some(entry => entry.character === "roth_ira")).toBe(true);
    expect(future.some(entry => entry.character === "employee_hsa")).toBe(true);
    expect(future.every(entry => entry.buckets.every(bucket => bucket.facts?.provenance === "projected_current_law"))).toBe(true);
    expect(result.diagnostics.some(item => "category" in item && item.category === "projected_current_law")).toBe(true);
    expect(result.diagnostics.some(item => "category" in item && ["payment_funding", "settlement_timing"].includes(String(item.category)))).toBe(false);
    const artifact = JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(result)));
    const restored = restorePortableHouseholdReplayArtifact(artifact);
    const window = { start: instant("2027-04-01T00:00:00.000Z"), end: instant("2027-05-01T00:00:00.000Z") };
    expect(canonicalSerialize(replayHouseholdForecastWindow(restored, window))).toBe(canonicalSerialize(replayHouseholdForecastWindow(result, window)));
  }, 60_000);
});
