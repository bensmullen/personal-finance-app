import { describe, expect, it } from "vitest";
import { assertBalanced } from "../src/accounting/index.js";
import { compileHouseholdTax, validateResidenceTaxPeriods, validateWorkTaxAllocations, resolveTaxEligibility } from "../src/application/compiler/tax.js";
import { runHouseholdKernel, runCompiledHouseholdProjection } from "../src/simulation/householdExecution.js";
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

const localFixture = (year: string, months: number, state: string, source: Partial<CompiledTaxIncome>, inputOverrides: Partial<HouseholdTaxInput> = {}, startMonth = "01") => {
  const fixture = taxHouseholdFixture({ months });
  const from = instant(`${year}-01-01T00:00:00.000Z`), until = instant(`${Number(year) + 1}-01-01T00:00:00.000Z`);
  const federal = { ...fixture.input.catalog[0]!, effectiveFrom: from, effectiveUntil: until };
  const stateRule = taxRule(10, { jurisdiction: state, effectiveFrom: from, effectiveUntil: until, income: { ...federal.income!, ordinaryBrackets: [{ lower: money("0"), rate: federal.income!.preferentialBrackets![0]!.rate }] } });
  const input: HouseholdTaxInput = { ...fixture.input, simulationStart: from, catalog: [federal, stateRule], incomes: [{ ...fixture.input.incomes[0]!, start: `${year}-${startMonth}-01`, ...source }],
    settlements: [{ id: "final-federal", jurisdiction: "US:FEDERAL", taxYear: year, at: instant(`${year}-12-31T23:59:59.999Z`), priority: 0 }, { id: "final-state", jurisdiction: state, taxYear: year, at: instant(`${year}-12-31T23:59:59.999Z`), priority: 1 }], ...inputOverrides };
  const context = { ...fixture.context, simulationStart: from, simulationEnd: utcMonthlyPeriods(from, months).at(-1)!.end };
  const cash = fixture.compiled.cashFlowInput!;
  const compiled = { ...fixture.compiled, participants: [createHouseholdTaxParticipant(input)], nonInvestmentPositionIds: taxCreditPositionIds(input), cashFlowInput: { ...cash, incomes: [{ ...cash.incomes[0]!, start: instant(`${year}-${startMonth}-01T00:00:00.000Z`), growthBaseAt: from, recurrence: { ...cash.incomes[0]!.recurrence, anchor: instant(`${year}-${startMonth}-15T00:00:00.000Z`) } }] } };
  return { input, context, kernel: compileHouseholdKernel(compiled, from) };
};

describe("T1A household tax integration", () => {
  it("accrues liability from actual salary without consuming cash before payment", () => {
    const fixture = taxHouseholdFixture();
    const result = runHouseholdKernel({ kernel: fixture.kernel, runContext: fixture.context, resultTier: "detail" });
    expect(result.status).toBe("completed");
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
    expect(canonicalSerialize(detail.state)).toBe(canonicalSerialize(summary.state));
  });

  it("uses ordinary funding constraints for final tax liquidity shortfalls", () => {
    const fixture = taxHouseholdFixture({ months: 12, input: { catalog: [taxRule(1, { jurisdiction: "US:FEDERAL", payroll: syntheticPayroll })] } });
    const salary = fixture.compiled.cashFlowInput!;
    // An explicit expense draws all earned cash before the authored final tax date.
    const compiled = { ...fixture.compiled, cashFlowInput: { ...salary, expenses: [{ id: domainId("expense", "86000000-0000-4000-8000-000000000009"), ownerId: salary.ownerId, paymentAccountId: salary.cashAccountId, payableLiabilityId: salary.expensePayableLiabilityId, fundingPolicy: fixture.input.fundingPolicy!, baseMonthlyAmount: money("1000"), start: fixture.context.simulationStart, recurrence: { kind: "utc_monthly" as const, anchor: instant("2024-01-25T00:00:00.000Z"), invalidDayPolicy: "skip" as const }, inflationRate: salary.incomes[0]!.growthRate, inflationBaseAt: fixture.context.simulationStart, primitiveIds: { indexGrowth: domainId("primitive-instance", "86000000-0000-4000-8001-000000000003"), inflationLink: domainId("primitive-instance", "86000000-0000-4000-8001-000000000004"), recurrence: domainId("primitive-instance", "86000000-0000-4000-8001-000000000005") } }] } };
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
    expect(result.diagnostics.some(issue => issue.message.includes("Unsupported tax coverage"))).toBe(true);
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
