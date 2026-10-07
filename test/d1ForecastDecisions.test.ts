import { describe, expect, it } from "vitest";
import { currentPlan, replaceCurrentPlanHorizon, simulationWindowProblem } from "../src/application/forecastSetup.js";
import { compileForecastTaxSettlements, forecastTaxJurisdictions, forecastTaxSetupProblem } from "../src/application/taxForecastSetup.js";
import { createGoldenHouseholdExampleDraft, exportPersonalModelJson, importPersonalModelJson, authorPersonalPurchasePlan, type PersonalDraft, type JsonObject } from "../src/application/personalMvp.js";
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
import { USD, money } from "../src/values/index.js";
import { contributionPolicyAt, contributionRuleIdAt } from "../src/simulation/contributionProjection.js";
import { decideContribution } from "../src/simulation/contributions.js";
import { getPersonalPurchasePlans, getPayrollContributionPlans, patchPersonalObject, authorDomainOperation } from "../src/application/personalMvp.js";
import { summarizeHouseholdPeriod } from "../src/simulation/r3/summaryPeriod.js";
import { federalBaseDeductionOnlyEligibilityKey, fullYearResidentEligibilityKey } from "../src/rules/tax/contracts.js";
import { recognizedGrossTaxableBaseEligibilityKey } from "../src/rules/tax/recognition.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest, integratedId, integratedIds } from "./fixtures/d1IntegratedHousehold.js";

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
const kernel = (request: HouseholdProjectionCompilerRequest, model: PersonalDraft = createD1IntegratedHousehold()) => {
  const compiled = compileHouseholdProjection(model, request);
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
    const record = (item: unknown): item is JsonObject => item !== null && typeof item === "object" && !Array.isArray(item);
    for (const [type, entries] of Object.entries(model.objects)) if (type !== "Scenario") expect(next.objects[type]).toEqual(entries.map(item => record(item) && item.scenario_id === old.scenario_id ? { ...item, scenario_id: replacementId } : item));
    expect(simulationWindowProblem(model, "2026-01-01", "2037-01-01")).toContain("exceeds");
    expect(simulationWindowProblem(next, "2026-01-01", "2037-01-01")).toBeUndefined();
    expect(importPersonalModelJson(exportPersonalModelJson(next))).toEqual(next);
    const request = d1IntegratedCompilerRequest();
    const rebased = compileHouseholdProjection(next, { ...request, cashFlow: { ...request.cashFlow!, scenarioId: replacementId }, investments: { ...request.investments!, scenarioId: replacementId }, liabilities: { ...request.liabilities!, scenarioId: replacementId } });
    expect(rebased.status).toBe("compiled");
    if (rebased.status === "compiled") {
      const before = runHouseholdKernel({ kernel: kernel(request), runContext: context("2026-02-01") });
      const after = runHouseholdKernel({ kernel: rebased.value.executionKernel!, runContext: createRunContext({ ...context("2026-02-01"), scenarioId: scenarioId(replacementId) }) });
      // Generated occurrence identities explicitly contain Scenario identity.
      // Everything else, including all economic amounts, must remain exact.
      expect(canonicalSerialize(after.state)).toBe(canonicalSerialize(before.state).replaceAll(golden.rootScenario, replacementId));
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
    expect(forecastTaxJurisdictions({ ...model, objects: { ...model.objects, Income: [] } })).toEqual(["US:FEDERAL", "US:NY"]);
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
    // The audited fixture's IRA purchase is one-time. Author a recurring IRA
    // through the normal contract to prove future personal contributions too.
    const recurring = authorPersonalPurchasePlan(createD1IntegratedHousehold({ projectAnnualFacts: true }), { primitiveId: integratedId(30), investmentId: integratedIds.ira, sourceCashAccountId: golden.savings, amount: "500", frequency: "monthly", date: "2026-01-10", order: 10, excessPolicy: "auto_cap", contributionFacts: { annualFactProjection: "confirmed_nominal_carry_forward", taxYear: 2026, ageAtYearEnd: 36, taxableCompensation: "108000", filingStatus: "single", rothMagi: "108000", workplacePlanCovered: true } });
    const result = runHouseholdKernel({ kernel: kernel({ ...long, forecastLawPolicy: "projected_current_law", tax: compileForecastTaxSettlements(settlementSetup, "2026-01-01", "2036-01-01") }, recurring), runContext: context("2036-01-01") });
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

  it("does not reuse near-threshold Roth MAGI or workplace/HSA annual facts as modeled salary grows", () => {
    let model = createD1IntegratedHousehold();
    model = patchPersonalObject(model, "Income", golden.income, { amount: "13500" });
    model = patchPersonalObject(model, "Assumption", golden.salaryGrowthAssumption, { value: "0.20" });
    model = authorPersonalPurchasePlan(model, { primitiveId: integratedId(30), investmentId: integratedIds.ira, sourceCashAccountId: golden.savings, amount: "500", frequency: "monthly", date: "2026-01-10", order: 10, excessPolicy: "auto_cap", contributionFacts: { taxYear: 2026, ageAtYearEnd: 36, taxableCompensation: "162000", filingStatus: "single", rothMagi: "162000" } });
    const ira = getPersonalPurchasePlans(model).find(plan => plan.investmentId === integratedIds.ira)!.contribution!;
    const futureIra = contributionPolicyAt({ ...ira, forecastLawPolicy: "projected_current_law" }, instant("2027-01-10T00:00:00.000Z"));
    expect(futureIra.facts).toEqual({ taxYear: 2027, ageAtYearEnd: 37, lawProjection: "projected_current_law" });
    for (const plan of getPayrollContributionPlans(model)) {
      const future = contributionPolicyAt({ ...plan.allocation.policy, forecastLawPolicy: "projected_current_law" }, instant("2027-01-01T00:00:00.000Z"));
      expect(future.facts.eligiblePlanCompensation).toBeUndefined();
      expect(future.facts.hsaFullYearEligible).toBeUndefined();
      expect(future.facts.hsaCoverage).toBeUndefined();
    }
    const executionKernel = kernel({ ...requestThrough("2027-02-01", 13), forecastLawPolicy: "projected_current_law" }, model);
    const summary = runHouseholdKernel({ kernel: executionKernel, runContext: context("2027-02-01") });
    const detail = runHouseholdKernel({ kernel: executionKernel, runContext: context("2027-02-01"), resultTier: "detail" });
    expect(summary.stoppedAt, JSON.stringify(summary.diagnostics)).toBeUndefined();
    expect(summary.reachedThrough).toBe("2027-02-01T00:00:00.000Z");
    expect(Object.values(summary.state.contributions ?? {}).some(entry => entry.at >= "2027-01-01")).toBe(false);
    const wages = detail.periods.map(period => period.cashFlow!.recurringIncomeRecognized);
    expect(wages[12]!.compare(wages[0]!)).toBeGreaterThan(0);
    expect(wages[12]!.compare(money("14000", USD))).toBeGreaterThan(0); // annualized pay now exceeds the $168k phaseout ceiling
    expect(summary.diagnostics.some(item => item.message.includes("2027 roth ira") && item.message.includes("ROTH_MAGI_REQUIRED"))).toBe(true);
    expect(summary.diagnostics.some(item => item.message.includes("HSA_FULL_YEAR_ELIGIBILITY_AND_COVERAGE_REQUIRED"))).toBe(true);
    expect(summary.diagnostics.some(item => item.message.includes("PLAN_COMPENSATION_REQUIRED"))).toBe(true);
    expect(detail.periods[12]!.outputCapabilities?.statementIncome.status).toBe("complete");
    expect(detail.periods[12]!.outputCapabilities?.contributionPrincipal.status).toBe("incomplete");
    expect(summary.state).toEqual(detail.state);
    expect(summary.periods).toEqual(detail.periods.map(summarizeHouseholdPeriod));
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(summary))));
    const window = { start: instant("2027-01-01T00:00:00.000Z"), end: instant("2027-02-01T00:00:00.000Z") };
    expect(canonicalSerialize(replayHouseholdForecastWindow(restored, window))).toBe(canonicalSerialize(replayHouseholdForecastWindow(summary, window)));
  });

  it("gives projected contribution applications distinct stable identities and resolvable base-rule lineage", () => {
    const model = createD1IntegratedHousehold({ projectAnnualFacts: true });
    const policy = { ...getPersonalPurchasePlans(model).find(plan => plan.investmentId === integratedIds.ira)!.contribution!, forecastLawPolicy: "projected_current_law" as const };
    const state = runHouseholdKernel({ kernel: kernel(d1IntegratedCompilerRequest(), model), runContext: context("2026-02-01") }).state;
    const decide = (year: number) => decideContribution(state, policy, integratedIds.iraAccount, instant(`${year}-02-01T00:00:00.000Z`), money("100", USD));
    const verified = decide(2026), projected = decide(2027), repeated = decide(2027), later = decide(2030);
    expect(projected.accepted.amount.toString()).toBe("100");
    expect(canonicalSerialize(projected)).toBe(canonicalSerialize(repeated));
    for (const binding of policy.limits) {
      const identity = contributionRuleIdAt(binding.ruleId, policy, instant("2027-02-01T00:00:00.000Z"));
      expect(verified.buckets.some(bucket => bucket.ruleId === binding.ruleId)).toBe(true);
      expect(identity).not.toBe(binding.ruleId);
      expect(later.buckets.some(bucket => bucket.ruleId === identity)).toBe(false);
      const bucket = projected.buckets.find(bucket => bucket.ruleId === identity)!;
      expect(bucket.facts).toMatchObject({ provenance: "projected_current_law", baseRuleId: binding.ruleId, baseYear: "2026", projectedYear: "2027", projectionPolicy: "nominal_carry_forward", annualFacts: "explicit_confirmed_forecast_assumption" });
      expect(projected.applications.find(application => application.ruleId === identity)!.traceRefs![0]!.ruleIds).toEqual(expect.arrayContaining([identity, binding.ruleId]));
    }
    expect(importPersonalModelJson(exportPersonalModelJson(model))).toEqual(model);
  });

  it("surfaces projected state law actually applied to a portfolio-only household without Income objects", () => {
    let model = createD1IntegratedHousehold();
    model = { ...model, objects: { ...model.objects, Income: [], Expense: [], Insurance: [], PrimitiveInstance: model.objects.PrimitiveInstance!.filter(value => ![30, 110, 130, 140, 150].map(integratedId).includes(String((value as JsonObject).primitive_instance_id))), Investment: model.objects.Investment!.map(value => ({ ...(value as JsonObject), contribution_model_id: null })) } };
    model = patchPersonalObject(model, "Person", golden.person, { residence_jurisdiction_periods: [{ effective_date: "2026-01-01", state_jurisdiction: "US-PA" }], tax_eligibility_periods: [federalBaseDeductionOnlyEligibilityKey, fullYearResidentEligibilityKey("US:PA"), recognizedGrossTaxableBaseEligibilityKey("US:PA")].map(key => ({ effective_date: "2026-01-01", key, value: true })) });
    model = patchPersonalObject(model, "Account", golden.savings, { interest_rate: "0.126825030131969720661201", interest_convention: "effective_annual_monthly", first_credit_date: "2027-01-15" });
    model = authorDomainOperation(model, { eventId: integratedId(997), effectId: integratedId(998), primitiveId: integratedId(999), name: "Projected portfolio gain", kind: "sale", holdingId: golden.brokerageInvestment, amount: "1100", quantity: "10", date: "2027-01-21", order: 20 });
    const base = d1IntegratedCompilerRequest();
    const boundary = { simulationStart: "2027-01-01", simulationEnd: "2027-02-01", asOf: "2027-01-01", months: 1 };
    const { cashFlow: _cashFlow, ...portfolioRequest } = base;
    const compiled = compileHouseholdProjection(model, { ...portfolioRequest, forecastLawPolicy: "projected_current_law", investments: { ...base.investments!, ...boundary }, liabilities: { ...base.liabilities!, ...boundary }, tax: compileForecastTaxSettlements({ ...settlementSetup, conventions: [{ jurisdiction: "US:FEDERAL", monthDay: "04-15", priority: 0, confirmed: true }, { jurisdiction: "US:PA", monthDay: "04-15", priority: 1, confirmed: true }] }, boundary.simulationStart, boundary.simulationEnd) });
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled.diagnostics));
    const stateBasis = compiled.value.projectedLaw!.filter(rule => rule.jurisdiction === "US:PA");
    expect(stateBasis.length).toBeGreaterThan(0);
    expect(stateBasis.every(rule => rule.baseYear === 2026 && rule.from.startsWith("2027-01-01"))).toBe(true);
    const result = runHouseholdKernel({ kernel: compiled.value.executionKernel!, runContext: createRunContext({ ...context("2027-02-01"), asOf: instant("2027-01-01T00:00:00.000Z"), dataCutoff: instant("2027-01-01T00:00:00.000Z"), simulationStart: instant("2027-01-01T00:00:00.000Z") }), resultTier: "detail" });
    expect(result.stoppedAt, JSON.stringify(result.diagnostics)).toBeUndefined();
    expect(result.periods[0]!.transactions.some(transaction => transaction.type === "cash_interest")).toBe(true);
    expect(result.periods[0]!.transactions.some(transaction => transaction.type === "sale")).toBe(true);
    expect(result.periods[0]!.transactions.some(transaction => transaction.type === "tax_liability")).toBe(true);
    expect(result.diagnostics.some(item => "category" in item && item.category === "projected_current_law" && "jurisdiction" in item && item.jurisdiction === "US:PA")).toBe(true);
  });
});
