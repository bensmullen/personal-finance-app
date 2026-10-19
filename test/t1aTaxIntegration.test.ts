import { describe, expect, it } from "vitest";
import { assertBalanced } from "../src/accounting/index.js";
import { compileHouseholdTax, validateResidenceTaxPeriods, validateWorkTaxAllocations, resolveTaxEligibility } from "../src/application/compiler/tax.js";
import { runHouseholdKernel, runCompiledHouseholdProjection, replayHouseholdForecastWindow, type HouseholdForecastSummaryResult, type CompiledHouseholdProjectionRunResult } from "../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { applyHouseholdExecutionOverlay, compileHouseholdKernel } from "../src/simulation/r3/compiledHousehold.js";
import { canonicalSerialize } from "../src/simulation/run.js";
import { createHouseholdTaxParticipant, emptyTaxIncome, taxCreditPositionIds, type HouseholdTaxInput, type CompiledTaxIncome } from "../src/simulation/tax.js";
import { alphaStateTaxCatalog, alphaLocalTaxCatalog, resolveTaxCoreRule, fullYearResidentEligibilityKey, recognizeTaxLegalBases, recognizedGrossTaxableBaseEligibilityKey, applyTaxCoreRule } from "../src/rules/index.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { money, Ratio } from "../src/values/index.js";
import { CURRENT_RUN_VERSIONS } from "../src/model/version.js";
import { ValidationError } from "../src/diagnostics/index.js";
import { domainId } from "../src/identity/index.js";
import { taxHouseholdFixture } from "./fixtures/t1aTaxHouseholds.js";
import { taxRule, syntheticPayroll } from "./fixtures/t1aTaxRules.js";
import { federal2026TaxCatalog } from "../src/rules/tax/lawCatalog.js";
import { taxCatalogFingerprint } from "../src/rules/tax/catalog.js";
import { taxDiagnostic, taxOutputCapabilities } from "../src/simulation/tax/contracts.js";
import { mergeOutputCapabilities } from "../src/simulation/r3/capabilities.js";

const differenceContext = (actual: unknown, expected: unknown): string => {
  const left = canonicalSerialize(actual), right = canonicalSerialize(expected);
  let index = 0; while (index < left.length && left[index] === right[index]) index++;
  return `First canonical difference at ${index}: actual=${left.slice(Math.max(0, index - 120), index + 400)} expected=${right.slice(Math.max(0, index - 120), index + 400)}`;
};

const localFixture = (year: string, months: number, state: string, source: Partial<CompiledTaxIncome>, inputOverrides: Partial<HouseholdTaxInput> = {}, startMonth = "01") => {
  const fixture = taxHouseholdFixture({ months });
  const from = instant(`${year}-01-01T00:00:00.000Z`), until = instant(`${Number(year) + 1}-01-01T00:00:00.000Z`);
  const federal = { ...fixture.input.catalog[0]!, effectiveFrom: from, effectiveUntil: until };
  const stateRule = taxRule(10, { jurisdiction: state, effectiveFrom: from, effectiveUntil: until, income: { ...federal.income!, ordinaryBrackets: [{ lower: money("0"), rate: federal.income!.preferentialBrackets![0]!.rate }] } });
  const input: HouseholdTaxInput = { ...fixture.input, simulationStart: from, catalog: [federal, stateRule], incomes: [{ ...fixture.input.incomes[0]!, start: `${year}-${startMonth}-01`, ...source }],
    settlements: [{ id: "final-federal", jurisdiction: "US:FEDERAL", taxYear: year, at: instant(`${year}-12-31T23:59:59.999Z`), priority: 0 }, { id: "final-state", jurisdiction: state, taxYear: year, at: instant(`${year}-12-31T23:59:59.999Z`), priority: 1 }], ...inputOverrides };
  const context = { ...fixture.context, simulationStart: from, simulationEnd: utcMonthlyPeriods(from, months).at(-1)!.end };
  const cash = fixture.compiled.cashFlowInput!;
  const compiled = { ...fixture.compiled, participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input), cashFlowInput: { ...cash, incomes: [{ ...cash.incomes[0]!, start: instant(`${year}-${startMonth}-01T00:00:00.000Z`), growthBaseAt: instant(`${year}-${startMonth}-15T00:00:00.000Z`), recurrence: { ...cash.incomes[0]!.recurrence, anchor: instant(`${year}-${startMonth}-15T00:00:00.000Z`) } }] } };
  return { input, context, kernel: compileHouseholdKernel(compiled, from) };
};

describe("T1A household tax integration", () => {
  // A bounded, source-qualified interest-only case: no wage withholding or benefits are invented.
  const lawScenario = (year = "2027", months = 12) => {
    const seed = taxHouseholdFixture();
    const householdId = String(seed.input.ownerId), personId = seed.input.incomes[0]!.ownerId;
    const model = { modelId: domainId("model", "88000000-0000-4000-8000-000000000099"),
      modelFormatVersion: CURRENT_RUN_VERSIONS.modelFormatVersion, financialSpecificationVersion: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      objects: { Household: [{ household_id: householdId, members: [personId], filing_status: "single" }], Person: [{ person_id: personId, household_id: householdId }] } };
    const compiled = compileHouseholdTax(model, { asOf: `${year}-01-01`, simulationStart: `${year}-01-01`, simulationEnd: `${Number(year) + 1}-01-01`,
      projectedCurrentLawThrough: "2029-01-01", catalog: [...federal2026TaxCatalog, ...alphaStateTaxCatalog.filter(rule => rule.jurisdiction === "US:GA" && rule.effectiveFrom.startsWith("2026"))] });
    if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled.diagnostics));
    const fixture = localFixture(year, months, "US:GA", { incomeType: "interest", work: [],
      residence: [{ state_jurisdiction: "US:GA", effective_date: `${year}-01-01` }],
      eligibility: ["federal_base_deduction_only", fullYearResidentEligibilityKey("US:GA"), recognizedGrossTaxableBaseEligibilityKey("US:GA")].map(key => ({ key, value: true, effective_date: `${year}-01-01` })) },
      { catalog: compiled.value.catalog, projectedCurrentLawAssumption: compiled.value.projectedCurrentLawAssumption!, filingStatuses: compiled.value.filingStatuses! });
    const { filingStatus: _legacy, ...input } = fixture.input;
    return { ...fixture, input };
  };
  type TaxChanges = { readonly [K in keyof HouseholdTaxInput]?: HouseholdTaxInput[K] | undefined };
  function scenarioRun(fixture: ReturnType<typeof lawScenario>, changes: TaxChanges, resultTier: "detail"): CompiledHouseholdProjectionRunResult;
  function scenarioRun(fixture: ReturnType<typeof lawScenario>, changes?: TaxChanges): HouseholdForecastSummaryResult;
  function scenarioRun(fixture: ReturnType<typeof lawScenario>, changes: TaxChanges = {}, resultTier?: "detail"): CompiledHouseholdProjectionRunResult | HouseholdForecastSummaryResult {
    // Preserve the typed required input while omitting explicitly cleared optional facts.
    const input: HouseholdTaxInput = Object.assign({}, fixture.input, changes);
    for (const [key, value] of Object.entries(input)) if (value === undefined) Reflect.deleteProperty(input, key);
    const request = { kernel: applyHouseholdExecutionOverlay(fixture.kernel, { participants: [createHouseholdTaxParticipant(input)] }), runContext: fixture.context };
    return resultTier === "detail" ? runHouseholdKernel({ ...request, resultTier: "detail" }) : runHouseholdKernel(request);
  }

  it("keeps verified 2026 computation complete without projected-law qualifications", () => {
    const verified = scenarioRun(lawScenario("2026"));
    expect(verified.status).toBe("completed");
    expect(verified.diagnostics).toEqual([]);
  });

  it("separates explicitly selected projected 2027 computation from law confidence without changing annual postings", () => {
    const fixture = lawScenario(), summary = scenarioRun(fixture), detail = scenarioRun(fixture, {}, "detail");
    expect(summary.status).toBe("completed");
    expect(summary.reachedThrough).toBe(fixture.context.simulationEnd);
    expect(summary.outputCapabilities?.netWorth?.status).toBe("complete");
    expect(summary.periods.at(-1)!.cash.equals(money("11401.20"))).toBe(true);
    expect(summary.periods.at(-1)!.liabilities.isZero()).toBe(true);
    const qualifications = summary.outputCapabilities!.netWorth!.diagnostics;
    expect(qualifications.length).toBeGreaterThan(0);
    expect(qualifications.every(item => item.category === "projected_current_law")).toBe(true);
    expect(qualifications).toEqual(expect.arrayContaining([expect.objectContaining({ jurisdiction: "US:FEDERAL", projectedLaw: expect.objectContaining({
      baseYear: 2026, baseRuleVersion: "US:FEDERAL:2026:v1", catalogFingerprint: taxCatalogFingerprint(fixture.input.catalog),
      effectiveFrom: "2027-01-01T00:00:00.000Z", effectiveUntil: "2029-01-01T00:00:00.000Z", assumption: fixture.input.projectedCurrentLawAssumption,
    }) })]));
    expect(detail.status).toBe(summary.status);
    expect(detail.outputCapabilities).toEqual(summary.outputCapabilities);
    expect(detail.diagnostics).toEqual(summary.diagnostics);
    expect(canonicalSerialize(detail.state)).toBe(canonicalSerialize(summary.state));
    for (const [index, period] of detail.periods.entries()) {
      expect(period.outputCapabilities).toEqual(summary.periods[index]!.outputCapabilities);
      expect(canonicalSerialize(period.statements)).toBe(canonicalSerialize(summary.periods[index]!.statements));
    }
    const unselected = scenarioRun(fixture, { projectedCurrentLawAssumption: undefined }, "detail");
    expect(unselected.status).toBe("incomplete");
    expect(unselected.runMetadata.inputFingerprint).not.toBe(detail.runMetadata.inputFingerprint);
    expect(canonicalSerialize(unselected.state)).toBe(canonicalSerialize(detail.state));
    expect(unselected.periods.map(period => canonicalSerialize(period.transactions))).toEqual(detail.periods.map(period => canonicalSerialize(period.transactions)));
    expect(unselected.outputCapabilities?.statementIncome?.status).toBe("complete");
    expect(unselected.outputCapabilities!.cash!.diagnostics.every(item => item.projectedLaw === undefined)).toBe(true);
    // Prior CI spent 4.7s on the combined baseline before replay failed. Keep
    // all three annual executions with a bounded budget for posting equivalence.
  }, 15_000);

  it("roundtrips legacy unselected projected-law artifacts through the summary replay contract", () => {
    const unselected = scenarioRun(lawScenario("2027", 2), { projectedCurrentLawAssumption: undefined });
    const restored = restorePortableHouseholdReplayArtifact(structuredClone(createPortableHouseholdReplayArtifact(unselected)));
    const rerun = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    expect(rerun.runMetadata).toEqual(unselected.runMetadata);
    expect(rerun.diagnostics).toEqual(unselected.diagnostics);
    expect(rerun.outputCapabilities).toEqual(unselected.outputCapabilities);
    expect(canonicalSerialize(rerun.state)).toBe(canonicalSerialize(unselected.state));
  });

  it("detects the real projected salary gross-to-net gap without changing modeled postings", () => {
    const interest = lawScenario();
    const source = interest.input.incomes[0]!;
    const fixture = { ...interest, input: { ...interest.input, incomes: [{ ...source, incomeType: "salary",
      work: [{ state_jurisdiction: "US:GA", allocation: "1", effective_date: "2027-01-01" }] }] } };
    expect(fixture.input.diagnostics).toEqual([]);
    expect(fixture.input.payments).toEqual([]);
    const summary = scenarioRun(fixture), detail = scenarioRun(fixture, {}, "detail");
    const gap = expect.objectContaining({ category: "wage_gross_to_net_withholding", entityId: source.id, taxYear: "2027" });
    expect(summary.status).toBe("incomplete");
    expect(summary.reachedThrough).toBe(fixture.context.simulationEnd);
    expect(summary.periods).toHaveLength(12);
    expect(summary.periods[0]!.cash.equals(money("1000"))).toBe(true);
    expect(summary.periods[0]!.statements.income.equals(money("1000"))).toBe(true);
    expect(summary.periods.at(-1)!.liabilities.isZero()).toBe(true);
    expect(summary.outputCapabilities?.cash?.status).toBe("incomplete");
    expect(summary.outputCapabilities?.netWorth?.status).toBe("incomplete");
    expect(summary.outputCapabilities?.statementIncome?.status).toBe("complete");
    expect(summary.outputCapabilities?.cash?.diagnostics).toEqual(expect.arrayContaining([
      gap, expect.objectContaining({ category: "projected_current_law", projectedLaw: expect.any(Object) }),
    ]));
    expect(summary.diagnostics).toContainEqual(gap);
    expect(detail.status).toBe(summary.status);
    expect(detail.outputCapabilities).toEqual(summary.outputCapabilities);
    expect(detail.diagnostics).toEqual(summary.diagnostics);
    expect(canonicalSerialize(detail.state)).toBe(canonicalSerialize(summary.state));
    for (const [index, period] of detail.periods.entries()) {
      expect(period.outputCapabilities).toEqual(summary.periods[index]!.outputCapabilities);
      expect(period.outputCapabilities?.cash?.status).toBe("incomplete");
      expect(period.outputCapabilities?.cash?.diagnostics).toContainEqual(gap);
    }
    // The legacy unselected path keeps its original diagnostics and all postings,
    // including funded final settlements, even though both runs are incomplete.
    const legacy = scenarioRun(fixture, { projectedCurrentLawAssumption: undefined }, "detail");
    expect(legacy.status).toBe("incomplete");
    expect(legacy.outputCapabilities?.cash?.diagnostics.some(item => item.category === "wage_gross_to_net_withholding")).toBe(false);
    expect(canonicalSerialize(legacy.state)).toBe(canonicalSerialize(detail.state));
    expect(legacy.periods.map(period => canonicalSerialize(period.transactions))).toEqual(detail.periods.map(period => canonicalSerialize(period.transactions)));
    // Prior CI spent 11.9s on the combined case. Keep annual posting equivalence
    // here and exercise replay/payment/verified-law paths in a bounded fixture.
  }, 15_000);

  it("roundtrips the projected wage limitation and rejects standalone withholding as a payroll binding", () => {
    const interest = lawScenario("2027", 2);
    const source = interest.input.incomes[0]!;
    const fixture = { ...interest, input: { ...interest.input, incomes: [{ ...source, incomeType: "salary",
      work: [{ state_jurisdiction: "US:GA", allocation: "1", effective_date: "2027-01-01" }] }] } };
    const summary = scenarioRun(fixture);
    const gap = expect.objectContaining({ category: "wage_gross_to_net_withholding", entityId: source.id, taxYear: "2027" });
    const restored = restorePortableHouseholdReplayArtifact(structuredClone(createPortableHouseholdReplayArtifact(summary)));
    const replay = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    expect(replay.status).toBe("incomplete");
    expect(replay.outputCapabilities).toEqual(summary.outputCapabilities);
    expect(replay.diagnostics).toEqual(summary.diagnostics);
    expect(canonicalSerialize(replay.state)).toBe(canonicalSerialize(summary.state));
    const payment = scenarioRun(fixture, { payments: [{ id: "standalone-withholding", jurisdiction: "US:FEDERAL",
      at: instant("2027-01-20T00:00:00.000Z"), amount: money("10"), kind: "withholding" }] });
    expect(payment.status).toBe("incomplete");
    expect(payment.outputCapabilities?.cash?.diagnostics).toContainEqual(gap);
    expect(scenarioRun(interest).status).toBe("completed");
    const verified = lawScenario("2026", 1);
    const verifiedWages = scenarioRun(verified, { incomes: [{ ...verified.input.incomes[0]!, incomeType: "salary",
      work: [{ state_jurisdiction: "US:GA", allocation: "1", effective_date: "2026-01-01" }] }] });
    expect(verifiedWages.outputCapabilities?.cash?.diagnostics.some(item => item.category === "wage_gross_to_net_withholding")).toBe(false);
  });

  it("retains every substantive limitation alongside projected-law qualifications", () => {
    // Each limitation is observable on the first recognized income; annual
    // settlement and year-transition coverage remain in the dedicated cases.
    const fixture = lawScenario("2027", 1);
    for (const category of ["withholding", "payroll", "benefits", "unknown_future_capability"]) {
      const result = scenarioRun(fixture, { diagnostics: [taxDiagnostic(category, "Material capability unavailable")] });
      expect(result.status).toBe("incomplete");
      expect(result.outputCapabilities?.cash?.diagnostics.some(item => item.category === category)).toBe(true);
      expect(result.outputCapabilities?.cash?.diagnostics.some(item => item.projectedLaw)).toBe(true);
    }
    for (const changes of [
      { settlements: [] }, { fundingPolicy: undefined }, { filingStatuses: {} },
      { filingStatuses: { "2027": { householdId: String(fixture.input.ownerId), taxYear: "2027", status: "true_conflict", sources: [] } } },
      { incomes: [{ ...fixture.input.incomes[0]!, incomeType: "business" }] },
      { incomes: [{ ...fixture.input.incomes[0]!, eligibility: fixture.input.incomes[0]!.eligibility.filter(item => item.key !== recognizedGrossTaxableBaseEligibilityKey("US:GA")) }] },
      { incomes: [{ ...fixture.input.incomes[0]!, residence: [{ state_jurisdiction: "US:ZZ", effective_date: "2027-01-01" }] }] },
    ] satisfies readonly TaxChanges[]) {
      const result = scenarioRun(fixture, changes);
      expect(result.status).toBe("incomplete");
      expect(result.outputCapabilities?.netWorth?.status).toBe("incomplete");
      expect(result.outputCapabilities?.statementIncome?.status).toBe("complete");
    }
    const { projectedCurrentLawAssumption: _selected, ...unselected } = fixture.input;
    const absent = scenarioRun(fixture, { ...unselected, catalog: [], projectedCurrentLawAssumption: undefined });
    expect(absent.status).toBe("incomplete");
    expect(absent.outputCapabilities?.cash?.diagnostics.some(item => item.category === "rule_selection")).toBe(true);
  });

  it("preserves law basis across portable replay and keeps failed execution incomplete", () => {
    const fixture = lawScenario("2027", 2), forecast = scenarioRun(fixture);
    const restored = restorePortableHouseholdReplayArtifact(structuredClone(createPortableHouseholdReplayArtifact(forecast)));
    const rerun = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    expect(rerun.runMetadata).toEqual(forecast.runMetadata);
    expect(rerun.outputCapabilities).toEqual(forecast.outputCapabilities);
    expect(rerun.diagnostics).toEqual(forecast.diagnostics);
    expect(canonicalSerialize(rerun.state)).toBe(canonicalSerialize(forecast.state));
    const window = forecast.periods.at(-1)!.period;
    expect(replayHouseholdForecastWindow(restored, window)).toEqual(replayHouseholdForecastWindow(forecast, window));
    const failed = scenarioRun(fixture, { refundAccountId: "86000000-0000-4000-8000-000000000099" as never });
    expect(failed.status).toBe("incomplete");
    expect(failed.stoppedAt).toBe(fixture.context.simulationStart);
    expect(failed.reachedThrough).toBeUndefined();
    expect(failed.periods).toHaveLength(0);
  });

  it("merges a complete projected year with missing next-year facts without losing its reached boundary", () => {
    const nextYearUnknown = lawScenario("2027", 13), fullPeriodRun = scenarioRun(nextYearUnknown);
    expect(fullPeriodRun.periods[11]!.outputCapabilities?.cash?.status).toBe("complete");
    expect(fullPeriodRun.periods[12]!.outputCapabilities?.cash?.status).toBe("incomplete");
    expect(fullPeriodRun.status).toBe("incomplete");
    expect(fullPeriodRun.reachedThrough).toBe(nextYearUnknown.context.simulationEnd);
    expect(fullPeriodRun.outputCapabilities?.cash?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "projected_current_law", projectedLaw: expect.any(Object) }),
      expect.objectContaining({ category: "filing_status_year_unknown", taxYear: "2028" }),
    ]));
  });

  it("fails closed on stale law selections and merges qualifications without losing missing capability", () => {
    const fixture = lawScenario("2027", 1), selection = fixture.input.projectedCurrentLawAssumption!;
    expect(Object.isFrozen(selection)).toBe(true);
    for (const change of [{ catalogFingerprint: "stale" }, { householdId: "another-household" }, { through: "2029-02-30" }]) {
      expect(() => createHouseholdTaxParticipant({ ...fixture.input, projectedCurrentLawAssumption: { ...selection, ...change } })).toThrow("Projected law requires");
    }
    const complete = scenarioRun(fixture).outputCapabilities!;
    const warning = complete.cash!.diagnostics[0]!;
    expect(taxOutputCapabilities([warning]).cash!.status).toBe("incomplete");
    expect(taxOutputCapabilities([taxDiagnostic("projected_current_law", "Unbound warning")], selection).cash!.status).toBe("incomplete");
    expect(taxOutputCapabilities([warning], { ...selection, through: "2028-01-01" }).cash!.status).toBe("incomplete");
    expect(mergeOutputCapabilities([complete, complete])).toEqual(complete);
    const incomplete = taxOutputCapabilities([taxDiagnostic("legal_base_or_component", "Missing base")]);
    for (const inputs of [[complete, incomplete], [incomplete, complete]]) {
      const merged = mergeOutputCapabilities(inputs)!;
      expect(merged.cash!.status).toBe("incomplete");
      expect(merged.cash!.diagnostics).toContainEqual(warning);
      expect(merged.statementIncome!.status).toBe("complete");
    }
  });

  it("restores portable tax participants and reproduces sparse replay, diagnostics and basis", () => {
    const fixture = taxHouseholdFixture({ months: 13 });
    const forecast = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context });
    expect(forecast.periods, JSON.stringify(forecast.diagnostics)).toHaveLength(13);
    const artifact = structuredClone(createPortableHouseholdReplayArtifact(forecast));
    const restored = restorePortableHouseholdReplayArtifact(artifact);
    const rerun = runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext });
    expect(rerun.runMetadata).toEqual(forecast.runMetadata);
    expect(canonicalSerialize(rerun.state)).toBe(canonicalSerialize(forecast.state));
    expect(rerun.periods).toEqual(forecast.periods);
    expect(rerun.diagnostics).toEqual(forecast.diagnostics);
    expect(rerun.outputCapabilities).toEqual(forecast.outputCapabilities);
    const window = forecast.periods[12]!.period;
    const local = replayHouseholdForecastWindow(forecast, window);
    const transported = replayHouseholdForecastWindow(restored, window);
    expect(transported, differenceContext(transported, local)).toEqual(local);
  });

  it("keeps participant-free execution and portable replay free of capability metadata", () => {
    const fixture = taxHouseholdFixture();
    const { participants: _participants, nonInvestmentPositionIds: _positions, ...executable } = fixture.compiled;
    const kernel = compileHouseholdKernel(executable, fixture.context.simulationStart);
    const summary = runHouseholdKernel({ kernel, runContext: fixture.context });
    const detail = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(summary.status).toBe("completed");
    expect(summary).not.toHaveProperty("outputCapabilities");
    expect(detail).not.toHaveProperty("outputCapabilities");
    expect(summary.periods[0]).not.toHaveProperty("outputCapabilities");
    expect(detail.periods[0]).not.toHaveProperty("outputCapabilities");
    const restored = restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(summary));
    expect(restored.replay.kernel.executable).not.toHaveProperty("participants");
    expect(runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext }).runMetadata).toEqual(summary.runMetadata);
  });

  it("accrues liability from actual salary without consuming cash before payment", () => {
    const fixture = taxHouseholdFixture();
    const result = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context, resultTier: "detail" });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.cash.equals(money("1000"))).toBe(true);
    expect(result.periods[0]!.liabilities.equals(money("100"))).toBe(true);
    expect(result.periods[0]!.netWorth.equals(money("900"))).toBe(true);
    expect(result.periods[0]!.statements.expenses.equals(money("100"))).toBe(true);
    for (const transaction of result.periods[0]!.transactions) assertBalanced(transaction);
    expect(result.periods[0]!.traceRefs.some(ref => ref.ruleIds?.includes(fixture.input.catalog[0]!.id))).toBe(true);
    expect(result.periods[0]!.traceRefs.some(ref => ref.traceId.includes("compiler:canonical:Income:"))).toBe(true);
  });

  it("keeps withholding, liability, credits and final refund separate in both tiers", () => {
    const fixture = taxHouseholdFixture({ months: 12, withholding: "150" });
    const detail = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context });
    expect(detail.status).toBe("completed");
    expect(summary.status).toBe("completed");
    expect(detail.periods[0]!.cash.equals(money("850"))).toBe(true);
    expect(detail.periods[0]!.assets.equals(money("900"))).toBe(true);
    expect(detail.periods[0]!.investmentValue.isZero()).toBe(true);
    expect(detail.periods.at(-1)!.cash.equals(money("10800"))).toBe(true);
    expect(detail.periods.flatMap(period => period.transactions).filter(transaction => transaction.type === "tax_refund")).toHaveLength(1);
    for (let index = 0; index < 12; index++) {
      expect(canonicalSerialize(detail.periods[index]!.statements)).toBe(canonicalSerialize(summary.periods[index]!.statements));
      expect(detail.periods[index]!.netWorth.equals(summary.periods[index]!.netWorth)).toBe(true);
    }
    expect(canonicalSerialize(detail.state), differenceContext(detail.state, summary.state)).toBe(canonicalSerialize(summary.state));
  });

  it("uses ordinary funding constraints for final tax liquidity shortfalls", () => {
    const fixture = taxHouseholdFixture({ months: 12, input: { catalog: [taxRule(1, { jurisdiction: "US:FEDERAL", payroll: syntheticPayroll })] } });
    const salary = fixture.compiled.cashFlowInput!;
    // An explicit expense draws all earned cash before the authored final tax date.
    const compiled = { ...fixture.compiled, cashFlowInput: { ...salary, expenses: [{ id: domainId("expense", "86000000-0000-4000-8000-000000000009"), ownerId: salary.ownerId, paymentAccountId: salary.cashAccountId, payableLiabilityId: salary.expensePayableLiabilityId, fundingPolicy: fixture.input.fundingPolicy!, baseMonthlyAmount: money("1000"), start: fixture.context.simulationStart, recurrence: { kind: "utc_monthly" as const, anchor: instant("2024-01-25T00:00:00.000Z"), invalidDayPolicy: "skip" as const }, inflationRate: salary.incomes[0]!.growthRate, inflationBaseAt: instant("2024-01-25T00:00:00.000Z"), primitiveIds: { indexGrowth: domainId("primitive-instance", "86000000-0000-4000-8001-000000000003"), inflationLink: domainId("primitive-instance", "86000000-0000-4000-8001-000000000004"), recurrence: domainId("primitive-instance", "86000000-0000-4000-8001-000000000005") } }] } };
    const result = runCompiledHouseholdProjection({ compiled, runContext: fixture.context });
    expect(result.periods.at(-1)!.cash.isZero()).toBe(true);
    expect(result.periods.at(-1)!.liquidityShortfalls.length).toBeGreaterThan(0);
    expect(result.periods.at(-1)!.liabilities.isPositive()).toBe(true);
  });

  it("accrues employee payroll and NIIT from recognized economics", () => {
    const fixture = taxHouseholdFixture();
    const payroll = taxHouseholdFixture({ input: { catalog: [{ ...fixture.input.catalog[0]!, payroll: syntheticPayroll }] } });
    const payrollResult = runHouseholdKernel({ kernel: payroll.kernel, runContext: payroll.context, resultTier: "detail" });
    expect(payrollResult.periods[0]!.liabilities.equals(money("176.50"))).toBe(true);
    const investment = taxHouseholdFixture({ amount: "300000", incomeType: "interest", input: { catalog: [{ ...fixture.input.catalog[0]!, niit: { rate: Ratio.parse("0.038"), threshold: money("200000") } }] } });
    const investmentResult = runHouseholdKernel({ kernel: investment.kernel, runContext: investment.context, resultTier: "detail" });
    expect(investmentResult.periods[0]!.liabilities.equals(money("33800"))).toBe(true);
  });

  it.each([
    ["interest", "ordinary", "100"], ["dividend", "ordinary", "100"], ["dividend", "qualified_dividend", "0"],
    ["capital_gain", "short_term_capital_gain", "100"], ["capital_gain", "long_term_capital_gain", "0"],
    ["pension", "tax_free", "0"],
  ])("recognizes %s/%s through the existing cash operation", (incomeType, taxCharacter, liability) => {
    const fixture = taxHouseholdFixture({ incomeType, taxCharacter });
    const result = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context, resultTier: "detail" });
    expect(result.periods[0]!.liabilities.equals(money(liability))).toBe(true);
  });

  it.each(["business", "rental", "equity_compensation", "pension"])("keeps uncharacterized %s/T1B economics explicitly incomplete", incomeType => {
    const fixture = taxHouseholdFixture({ incomeType });
    const result = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context });
    expect(result.status).toBe("incomplete");
    expect(result.outputCapabilities?.netWorth?.status).toBe("incomplete");
    expect(result.outputCapabilities?.currentPosition?.status).toBe("complete");
    expect(result.periods[0]!.cash.equals(money("1000"))).toBe(true);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === "PFA-TAX-009")).toBe(true);
  });

  it("diagnoses missing/ambiguous catalog coverage without claiming zero liability", () => {
    for (const catalog of [[], [taxRule(1, { jurisdiction: "US:FEDERAL" }), taxRule(2, { jurisdiction: "US:FEDERAL" })]]) {
      const fixture = taxHouseholdFixture({ input: { catalog } });
      const result = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context });
      expect(result.status).toBe("incomplete");
      expect(result.periods[0]!.outputCapabilities?.cash?.status).toBe("incomplete");
      expect(result.periods[0]!.outputCapabilities?.statementIncome?.status).toBe("complete");
    }
  });
  it("does not extrapolate a tax rule across its exclusive effective-date boundary", () => {
    const fixture = taxHouseholdFixture({ months: 13 });
    const result = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context });
    expect(result.periods[11]!.outputCapabilities?.cash?.status).toBe("complete");
    expect(result.periods[12]!.outputCapabilities?.cash?.status).toBe("incomplete");
    expect(result.outputCapabilities?.cash?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PFA-TAX-009", jurisdiction: "US:FEDERAL", category: "rule_selection" })]));
  });

  it("replays deterministically and reuses bindings while recomputing altered salary economics", () => {
    const fixture = taxHouseholdFixture();
    expect(applyHouseholdExecutionOverlay(fixture.kernel, {})).toBe(fixture.kernel);
    const input = fixture.compiled.cashFlowInput!;
    const altered = applyHouseholdExecutionOverlay(fixture.kernel, { cashFlowInput: { ...input, incomes: [{ ...input.incomes[0]!, baseMonthlyAmount: money("2000") }] } });
    expect(altered.executable.participants).toBe(fixture.kernel.executable.participants);
    const base = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context });
    const next = runHouseholdKernel({ kernel: altered, runContext: fixture.context });
    expect(base.periods[0]!.liabilities.equals(money("100"))).toBe(true);
    expect(next.periods[0]!.liabilities.equals(money("200"))).toBe(true);
    expect(base.runMetadata.inputFingerprint).not.toBe(next.runMetadata.inputFingerprint);
    expect(canonicalSerialize(base.state)).toBe(canonicalSerialize(runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context }).state));
  });

  it("rolls back financial and domain realization state on a hard tax execution failure", () => {
    const fixture = taxHouseholdFixture({ input: { refundAccountId: "86000000-0000-4000-8000-000000000099" as never } });
    const result = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context, resultTier: "detail" });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(0);
    expect(canonicalSerialize(result.state)).toBe(canonicalSerialize(fixture.compiled.reconciledOpeningState));
  });
});

describe("canonical tax jurisdiction facts", () => {
  it("scopes person eligibility to its owned Income instead of merging different employees", () => {
    const household = "88000000-0000-4000-8000-000000000001", first = "88000000-0000-4000-8000-000000000002", second = "88000000-0000-4000-8000-000000000003";
    const result = compileHouseholdTax({ modelId: domainId("model", "88000000-0000-4000-8000-000000000004"), modelFormatVersion: CURRENT_RUN_VERSIONS.modelFormatVersion, financialSpecificationVersion: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      objects: { Household: [{ household_id: household, members: [first, second], filing_status: "married_joint" }],
        Person: [first, second].map((person_id, index) => ({ person_id, household_id: household, residence_jurisdiction_periods: [{ state_jurisdiction: "US:CO", effective_date: "2026-01-01" }], tax_eligibility_periods: [{ key: "denver_employee_opt_eligible", value: index === 0, effective_date: "2026-01-01" }] })),
        Income: [first, second].map((owner_id, index) => ({ income_id: `88000000-0000-4000-8000-${String(index + 5).padStart(12, "0")}`, owner_id, income_type: "salary", start_date: "2026-01-01" })) } });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") throw new Error("Expected valid person-scoped facts");
    expect(resolveTaxEligibility(result.value.incomes.find(item => item.ownerId === first)!.eligibility, "2026-04-01").denver_employee_opt_eligible).toBe(true);
    expect(resolveTaxEligibility(result.value.incomes.find(item => item.ownerId === second)!.eligibility, "2026-04-01").denver_employee_opt_eligible).toBe(false);
    expect(result.value.eligibility).toHaveLength(0);
  });
  it("validates half-open residence and exact hybrid-work allocations", () => {
    expect(() => validateResidenceTaxPeriods([{ state_jurisdiction: "US:PA", effective_date: "2024-01-01", expiration_date: "2024-07-01" }, { state_jurisdiction: "US:NY", effective_date: "2024-07-01" }])).not.toThrow();
    expect(() => validateResidenceTaxPeriods([{ state_jurisdiction: "US:PA", effective_date: "2024-01-01" }, { state_jurisdiction: "US:NY", effective_date: "2024-07-01" }])).toThrow(ValidationError);
    expect(() => validateWorkTaxAllocations([{ state_jurisdiction: "US:PA", allocation: "0.1", effective_date: "2024-01-01" }, { state_jurisdiction: "US:NY", allocation: "0.9", effective_date: "2024-01-01" }], "2024-01-01")).not.toThrow();
    expect(() => validateWorkTaxAllocations([{ state_jurisdiction: "US:PA", allocation: "0.99", effective_date: "2024-01-01" }], "2024-01-01")).toThrow(ValidationError);
    expect(() => validateResidenceTaxPeriods([{ state_jurisdiction: "US:PA", psd_code: "12345", effective_date: "2024-01-01" }])).toThrow(ValidationError);
  });
  it("does not override contradictory eligibility facts", () => {
    expect(() => resolveTaxEligibility([{ key: "denver_employee_opt_eligible", value: true, effective_date: "2024-01-01" }, { key: "denver_employee_opt_eligible", value: false, effective_date: "2024-01-01" }], "2024-05-01")).toThrow(ValidationError);
  });
  it.each(["PA", "NY", "NJ", "CO", "CA", "AZ", "GA", "MA"])("selects verified 2025 %s coverage and requires explicit legal-base facts", state => {
    const jurisdiction = `US:${state}`;
    const facts = { residenceJurisdictions: [jurisdiction], workJurisdictions: [], eligibility: { [fullYearResidentEligibilityKey(jurisdiction)]: true } };
    const resolved = resolveTaxCoreRule(alphaStateTaxCatalog, jurisdiction, "single", instant("2025-07-01T00:00:00.000Z"), facts);
    expect(resolved.rule.provenance.type).toBe("verified_law");
    expect(() => recognizeTaxLegalBases(resolved.rule, { ...emptyTaxIncome(), wages: money("100000") }, facts)).toThrow(ValidationError);
  });
});

describe("allocated state/local household execution", () => {
  it("applies Denver employee OPT to allocated service wages with explicit eligibility, never residence alone", () => {
    const denver = alphaLocalTaxCatalog.find(rule => rule.jurisdiction === "US:CO:DENVER:OPT")!;
    const source = { residence: [{ state_jurisdiction: "US:CO", local_jurisdiction: "US:CO:DENVER", effective_date: "2026-01-01" }], work: [{ state_jurisdiction: "US:CO", local_jurisdiction: "US:CO:DENVER", allocation: "0.5", effective_date: "2026-04-01" }, { state_jurisdiction: "US:CO", local_jurisdiction: "TEST:CO:SERVICE", allocation: "0.5", effective_date: "2026-04-01" }], eligibility: [{ key: "denver_employee_opt_eligible", value: true, effective_date: "2026-04-01" }] };
    const fixture = localFixture("2026", 4, "US:CO", source, {}, "04");
    const kernel = applyHouseholdExecutionOverlay(fixture.kernel, { participants: [createHouseholdTaxParticipant({ ...fixture.input, catalog: [...fixture.input.catalog, denver] })] });
    const result = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(result.periods[3]!.transactions.some(transaction => transaction.traceRefs?.some(ref => ref.ruleIds?.includes(denver.id)) && transaction.legs.some(leg => leg.type === "tax" && leg.amount.equals(money("5.75"))))).toBe(true);
    const residenceOnly = applyHouseholdExecutionOverlay(fixture.kernel, { participants: [createHouseholdTaxParticipant({ ...fixture.input, catalog: [...fixture.input.catalog, denver], incomes: [{ ...fixture.input.incomes[0]!, work: [{ state_jurisdiction: "US:CO", local_jurisdiction: "TEST:CO:SERVICE", allocation: "1", effective_date: "2026-04-01" }] }] })] });
    expect(runHouseholdKernel({ kernel: residenceOnly, runContext: fixture.context, resultTier: "detail" }).periods.flatMap(period => period.transactions).some(transaction => transaction.traceRefs?.some(ref => ref.ruleIds?.includes(denver.id)))).toBe(false);
    const missingEligibility = applyHouseholdExecutionOverlay(kernel, { participants: [createHouseholdTaxParticipant({ ...fixture.input, catalog: [...fixture.input.catalog, denver], incomes: [{ ...fixture.input.incomes[0]!, eligibility: [] }] })] });
    expect(runHouseholdKernel({ kernel: missingEligibility, runContext: fixture.context }).diagnostics.some(issue => issue.message.includes("US:CO:DENVER:OPT"))).toBe(true);
  });

  it("preserves exact PA municipality/PSD facts and diagnoses absent verified EIT/LST law", () => {
    const source = { residence: [{ state_jurisdiction: "US:PA", local_jurisdiction: "TEST:PA:RESIDENCE", municipality: "TEST:RESIDENT-MUNICIPALITY", psd_code: "999901", effective_date: "2024-01-01" }], work: [{ state_jurisdiction: "US:PA", local_jurisdiction: "TEST:PA:SERVICE", municipality: "TEST:WORK-MUNICIPALITY", psd_code: "999902", allocation: "1", effective_date: "2024-01-01" }], eligibility: [] };
    const fixture = localFixture("2024", 1, "US:PA", source);
    const missing = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context });
    expect(missing.outputCapabilities?.cash?.diagnostics.some(issue => issue.jurisdiction === "US:PA:LOCAL:EIT")).toBe(true);
    const eit = taxRule(11, { jurisdiction: "US:PA:LOCAL:EIT", applicability: [{ fact: "residencePsdCode", equals: "999901" }, { fact: "workPsdCode", equals: "999902" }] });
    const { income: _income, ...withoutIncome } = taxRule(12, { jurisdiction: "US:PA:LOCAL:LST", applicability: [{ fact: "workMunicipality", equals: "TEST:WORK-MUNICIPALITY" }] });
    const lst = { ...withoutIncome, periodicEmployeeTax: { amount: money("5"), wageThreshold: money("0"), unit: "calendar_month" as const } };
    const kernel = applyHouseholdExecutionOverlay(fixture.kernel, { participants: [createHouseholdTaxParticipant({ ...fixture.input, catalog: [...fixture.input.catalog, eit, lst] })] });
    const result = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(result.periods[0]!.traceRefs.some(ref => ref.ruleIds?.includes(lst.id))).toBe(true);
    expect(result.periods[0]!.traceRefs.some(ref => ref.ruleIds?.includes(eit.id))).toBe(true);
    const unknown = applyHouseholdExecutionOverlay(kernel, { participants: [createHouseholdTaxParticipant({ ...fixture.input, incomes: [{ ...fixture.input.incomes[0]!, work: [] }] })] });
    expect(runHouseholdKernel({ kernel: unknown, runContext: fixture.context }).diagnostics.some(issue => issue.message.includes("PSD"))).toBe(true);
  });

  it("selects NYC residence independently from New York employment location", () => {
    const nyc = alphaLocalTaxCatalog.find(rule => rule.jurisdiction === "US:NY:NYC" && rule.filingStatus === "single")!;
    const base = { ...emptyTaxIncome(), wages: money("70000") };
    const facts = { residenceJurisdictions: ["US:NY", "US:NY:NYC"], workJurisdictions: ["US:NY"], eligibility: { [fullYearResidentEligibilityKey("US:NY:NYC")]: true, [recognizedGrossTaxableBaseEligibilityKey("US:NY:NYC")]: true } };
    const selected = resolveTaxCoreRule([nyc], "US:NY:NYC", "single", instant("2025-07-01T00:00:00.000Z"), facts);
    const tax = applyTaxCoreRule(selected, { income: base, ...recognizeTaxLegalBases(nyc, base, facts), withholding: money("0"), estimatedPayments: money("0"), priorPaymentCredit: money("0") });
    expect(tax.result.totalLiability.isPositive()).toBe(true);
    expect(() => resolveTaxCoreRule([nyc], "US:NY:NYC", "single", instant("2025-07-01T00:00:00.000Z"), { ...facts, residenceJurisdictions: ["US:NY"], workJurisdictions: ["US:NY:NYC"] })).toThrow(ValidationError);
    const fixture = localFixture("2025", 1, "US:NY", { residence: [{ state_jurisdiction: "US:NY", local_jurisdiction: "US:NY:NYC", effective_date: "2025-01-01" }], work: [{ state_jurisdiction: "US:NY", local_jurisdiction: "TEST:NY:SERVICE", allocation: "1", effective_date: "2025-01-01" }], eligibility: Object.entries(facts.eligibility).map(([key, value]) => ({ key, value, effective_date: "2025-01-01" })) });
    const cash = fixture.kernel.executable.cashFlowInput!;
    const kernel = applyHouseholdExecutionOverlay(fixture.kernel, { cashFlowInput: { ...cash, incomes: [{ ...cash.incomes[0]!, baseMonthlyAmount: money("70000") }] }, participants: [createHouseholdTaxParticipant({ ...fixture.input, catalog: [...fixture.input.catalog, nyc] })] });
    expect(runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" }).periods[0]!.transactions.some(transaction => transaction.traceRefs?.some(ref => ref.ruleIds?.includes(nyc.id)))).toBe(true);
    const outside = applyHouseholdExecutionOverlay(kernel, { participants: [createHouseholdTaxParticipant({ ...fixture.input, catalog: [...fixture.input.catalog, nyc], incomes: [{ ...fixture.input.incomes[0]!, residence: [{ state_jurisdiction: "US:NY", local_jurisdiction: "TEST:NY:RESIDENCE", effective_date: "2025-01-01" }] }] })] });
    expect(runHouseholdKernel({ kernel: outside, runContext: fixture.context, resultTier: "detail" }).periods[0]!.transactions.some(transaction => transaction.traceRefs?.some(ref => ref.ruleIds?.includes(nyc.id)))).toBe(false);
  });

  it("uses the verified Philadelphia resident wage interval regardless of outside-city service", () => {
    const rules = alphaLocalTaxCatalog.filter(rule => rule.jurisdiction === "US:PA:PHILADELPHIA:WAGE");
    const source = { residence: [{ state_jurisdiction: "US:PA", local_jurisdiction: "US:PA:PHILADELPHIA", effective_date: "2026-01-01" }], work: [{ state_jurisdiction: "US:PA", local_jurisdiction: "TEST:PA:OUTSIDE-PHILADELPHIA", allocation: "1", effective_date: "2026-07-01" }], eligibility: [{ key: recognizedGrossTaxableBaseEligibilityKey("US:PA:PHILADELPHIA:WAGE"), value: true, effective_date: "2026-01-01" }, { key: "pa_local_eit_applicable", value: false, effective_date: "2026-01-01" }, { key: "pa_local_lst_applicable", value: false, effective_date: "2026-01-01" }] };
    const fixture = localFixture("2026", 7, "US:PA", source, {}, "07");
    const kernel = applyHouseholdExecutionOverlay(fixture.kernel, { participants: [createHouseholdTaxParticipant({ ...fixture.input, catalog: [...fixture.input.catalog, ...rules] })] });
    const result = runHouseholdKernel({ kernel, runContext: fixture.context, resultTier: "detail" });
    expect(result.periods[6]!.transactions.some(transaction => transaction.legs.some(leg => leg.type === "tax" && leg.amount.equals(money("37.35"))))).toBe(true);
  });
});
