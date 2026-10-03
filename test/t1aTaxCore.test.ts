import { describe, expect, it } from "vitest";
import { issueCodes, ValidationError } from "../src/diagnostics/index.js";
import { instant } from "../src/time/index.js";
import { Currency, Ratio, RoundingPolicy, money } from "../src/values/index.js";
import { alphaLocalTaxCatalog, alphaStateTaxCatalog, federal2024TaxCatalog, taxLawCoverageGaps, applyTaxCoreRule, calculateProgressiveTax, createTaxCatalog, resolveTaxCoreRule, taxCatalogFingerprint, type TaxCalculationInput, type TaxCoreRule, type TaxJurisdictionFacts } from "../src/rules/index.js";
import { syntheticPayroll, syntheticRmd, taxInput, taxRule } from "./fixtures/t1aTaxRules.js";

const at = instant("2024-06-01T00:00:00.000Z");
const noJurisdictions: TaxJurisdictionFacts = { residenceJurisdictions: [], workJurisdictions: [] };
const resolve = (rule: TaxCoreRule) => resolveTaxCoreRule([rule], rule.jurisdiction, "single", at, noJurisdictions);
const calculate = (input = taxInput(), rule = taxRule()) => applyTaxCoreRule(resolve(rule), input).result;
const errorCode = (operation: () => unknown) => {
  try { operation(); } catch (error) { if (error instanceof ValidationError) return error.issues[0]?.code; throw error; }
  throw new Error("Expected structured validation error");
};

describe("T1A Phase A deterministic core (synthetic rules)", () => {
  it.each([["0", "0"], ["10000", "1000"], ["10000.01", "1000"], ["10001", "1000.2"], ["20000", "3000"]])("calculates progressive boundary %s", (base, expected) => {
    expect(calculateProgressiveTax(money(base), taxRule().income!.ordinaryBrackets, new RoundingPolicy(2, "half_even")).equals(money(expected))).toBe(true);
  });
  it("selects filing status and rejects overlapping all-status definitions", () => {
    const single = taxRule(); const joint = taxRule(2, { filingStatus: "married_joint" });
    expect(resolveTaxCoreRule([joint, single], single.jurisdiction, "married_joint", at, noJurisdictions).rule.id).toBe(joint.id);
    expect(errorCode(() => resolveTaxCoreRule([single], single.jurisdiction, "head_of_household", at, noJurisdictions))).toBe(issueCodes.ruleNotActive);
    expect(errorCode(() => resolveTaxCoreRule([single, taxRule(3, { filingStatus: "all" })], single.jurisdiction, "single", at, noJurisdictions))).toBe(issueCodes.ruleAmbiguous);
  });
  it("uses half-open ranges and never extrapolates expired law", () => {
    const first = taxRule(); const next = taxRule(2, { version: "v2", effectiveFrom: first.effectiveUntil, effectiveUntil: instant("2026-01-01T00:00:00.000Z") });
    expect(resolveTaxCoreRule([next, first], first.jurisdiction, "single", first.effectiveFrom, noJurisdictions).rule.id).toBe(first.id);
    expect(resolveTaxCoreRule([next, first], first.jurisdiction, "single", first.effectiveUntil, noJurisdictions).rule.id).toBe(next.id);
    for (const date of ["2023-12-31T23:59:59.999Z", "2026-01-01T00:00:00.000Z"]) expect(errorCode(() => resolveTaxCoreRule([first, next], first.jurisdiction, "single", instant(date), noJurisdictions))).toBe(issueCodes.ruleNotActive);
  });
  it("applies basic deductions to ordinary income first and then preferred income", () => {
    const result = calculate(taxInput({ wages: money("500"), qualifiedDividends: money("1000") }));
    expect(result.basicDeductionApplied.equals(money("1000"))).toBe(true);
    expect(result.ordinaryTaxableBase.isZero()).toBe(true);
    expect(result.preferentialTaxableBase.equals(money("500"))).toBe(true);
    expect(calculate(taxInput({ wages: money("100") })).basicDeductionApplied.equals(money("100"))).toBe(true);
    expect(calculate(taxInput({ wages: money("11000") }, { basicDeductionElection: money("2000") })).ordinaryTax.equals(money("900"))).toBe(true);
  });
  it("taxes interest, ordinary dividends and short gains at ordinary rates", () => {
    const result = calculate(taxInput({ wages: money("10000"), taxableInterest: money("1000"), ordinaryDividends: money("1000"), shortTermGains: money("1000") }));
    expect(result.ordinaryTaxableBase.equals(money("12000"))).toBe(true);
    expect(result.ordinaryTax.equals(money("1400"))).toBe(true);
  });
  it("stacks qualified dividends and long gains above ordinary taxable income", () => {
    const result = calculate(taxInput({ wages: money("20000"), qualifiedDividends: money("1000"), longTermGains: money("20000") }));
    expect(result.preferentialTaxableBase.equals(money("21000"))).toBe(true);
    expect(result.preferentialTax.equals(money("3000"))).toBe(true);
  });
  it("nets gain characters and reports bounded loss deductions and unused losses", () => {
    const net = calculate(taxInput({ wages: money("11000"), shortTermGains: money("-2000"), longTermGains: money("3000") }));
    expect(net.preferentialTaxableBase.equals(money("1000"))).toBe(true);
    const loss = calculate(taxInput({ wages: money("11000"), shortTermGains: money("-5000"), longTermGains: money("1000") }));
    expect(loss.capitalLossDeduction.equals(money("3000"))).toBe(true);
    expect(loss.unusedCapitalLoss.equals(money("1000"))).toBe(true);
    expect(loss.ordinaryTaxableBase.equals(money("7000"))).toBe(true);
    expect(calculate(taxInput({ shortTermGains: money("-3000"), qualifiedDividends: money("2000") })).preferentialTaxableBase.isZero()).toBe(true);
  });
  it("distinguishes traditional deduction/basis recovery and Roth characterization", () => {
    const result = calculate(taxInput({ wages: money("11000"), traditionalContributions: money("2000"), eligibleTraditionalDeduction: money("1500"), traditionalDistributions: money("3000"), traditionalDistributionBasisRecovered: money("500"), rothContributions: money("2000"), rothDistributions: money("1000") }));
    expect(result.traditionalDeductionApplied.equals(money("1500"))).toBe(true);
    expect(result.taxableTraditionalDistributions.equals(money("2500"))).toBe(true);
    expect(result.taxableRothDistributions.isZero()).toBe(true);
    expect(result.ordinaryTaxableBase.equals(money("11000"))).toBe(true);
    expect(calculate(taxInput({ rothDistributions: money("1000"), taxableRothDistributions: money("600") }, { basicDeductionElection: money("0") })).ordinaryTax.equals(money("60"))).toBe(true);
  });
  it("applies wage caps per employee and combined additional-tax thresholds", () => {
    const rule = taxRule(1, { payroll: syntheticPayroll });
    for (const wage of ["99999", "100000", "100001"]) {
      const result = calculate(taxInput({ wages: money(wage) }, { employeeWages: [{ employeeKey: "a", wages: money(wage) }] }), rule);
      expect(result.payrollTaxes.find((component) => component.key === "social")!.liability.equals(money(wage === "99999" ? "6199.94" : "6200"))).toBe(true);
    }
    const result = calculate(taxInput({ wages: money("240000") }, { employeeWages: [{ employeeKey: "b", wages: money("120000") }, { employeeKey: "a", wages: money("120000") }] }), rule);
    expect(result.payrollTaxes.find((component) => component.key === "social")!.liability.equals(money("12400"))).toBe(true);
    expect(result.payrollTaxes.find((component) => component.key === "additional")!.liability.equals(money("360"))).toBe(true);
    expect(errorCode(() => calculate(taxInput({ wages: money("1") }), rule))).toBe(issueCodes.ruleInputInvalid);
  });
  it("requires explicit NIIT bases and taxes the lesser of NII and MAGI excess", () => {
    const rule = taxRule(1, { niit: { rate: Ratio.parse("0.038"), threshold: money("200000") } });
    for (const [magi, investment, expected] of [["200000", "10000", "0"], ["205000", "10000", "190"], ["220000", "10000", "380"]] as const) {
      expect(calculate(taxInput({}, { modifiedAdjustedGrossIncome: money(magi), netInvestmentIncome: money(investment) }), rule).niit.equals(money(expected))).toBe(true);
    }
    expect(errorCode(() => calculate(taxInput(), rule))).toBe(issueCodes.ruleInputInvalid);
    expect(errorCode(() => calculate(taxInput({}, { netInvestmentIncome: money("1") })))).toBe(issueCodes.ruleInputInvalid);
  });
  it("keeps payments and settlement arithmetic separate from liability", () => {
    const income = { wages: money("11000") };
    const unpaid = calculate(taxInput(income));
    const paid = calculate(taxInput(income, { withholding: money("800"), estimatedPayments: money("300"), priorPaymentCredit: money("100") }));
    expect(paid.totalLiability.equals(unpaid.totalLiability)).toBe(true);
    expect(unpaid.balanceDue.equals(money("1000"))).toBe(true);
    expect(paid.refundableAmount.equals(money("200"))).toBe(true);
    expect(paid.balanceDue.isZero()).toBe(true);
  });
  it("calculates effective-dated RMD inputs without inventing a distribution", () => {
    const rule = taxRule(1, { rmd: syntheticRmd });
    const result = calculate(taxInput({}, { rmd: { age: 73, priorYearEndBalance: money("265000") } }), rule);
    expect(result.requiredMinimumDistribution!.equals(money("10000"))).toBe(true);
    expect(result.grossBases.traditionalDistributions.isZero()).toBe(true);
    expect(result.totalLiability.isZero()).toBe(true);
    expect(calculate(taxInput({}, { rmd: { age: 72, priorYearEndBalance: money("265000") } }), rule).requiredMinimumDistribution!.isZero()).toBe(true);
    expect(errorCode(() => calculate(taxInput({}, { rmd: { age: 75, priorYearEndBalance: money("265000") } }), rule))).toBe(issueCodes.ruleInputInvalid);
  });
  it("rejects invalid definitions, ambiguous catalogs and missing coverage", () => {
    expect(errorCode(() => createTaxCatalog([taxRule(), taxRule()]))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(errorCode(() => createTaxCatalog([taxRule(1, { effectiveUntil: at, effectiveFrom: at })]))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(errorCode(() => createTaxCatalog([taxRule(1, { income: { ...taxRule().income!, ordinaryBrackets: [{ lower: money("1"), rate: Ratio.parse("0.1") }] } })]))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(errorCode(() => resolveTaxCoreRule([], "MISSING", "single", at, noJurisdictions))).toBe(issueCodes.ruleNotActive);
  });
  it("fingerprints normalized content independent of catalog and set-like collection order", () => {
    const first = taxRule(1, { payroll: syntheticPayroll, rmd: syntheticRmd }); const second = taxRule(2, { filingStatus: "married_joint" });
    expect(taxCatalogFingerprint([first, second])).toBe(taxCatalogFingerprint([second, { ...first, payroll: [...syntheticPayroll].reverse(), rmd: { ...syntheticRmd, divisors: [...syntheticRmd.divisors].reverse() } }]));
    expect(taxCatalogFingerprint([first])).not.toBe(taxCatalogFingerprint([{ ...first, version: "changed" }]));
    expect(taxCatalogFingerprint([first])).not.toBe(taxCatalogFingerprint([{ ...first, income: { ...first.income!, standardDeduction: money("1001") } }]));
  });
  it("snapshots immutable rule data and preserves rule version lineage", () => {
    const rule = taxRule(); const selected = resolve(rule);
    expect(Object.isFrozen(selected.rule.income!.ordinaryBrackets)).toBe(true);
    const result = applyTaxCoreRule(selected, taxInput()).result;
    expect(result.appliedRules).toEqual([{ id: rule.id, version: rule.version }]);
    expect(result.traceRefs[0]!.ruleIds).toContain(rule.id);
    expect(result.catalogFingerprint).toBe(taxCatalogFingerprint([rule]));
    expect(Object.isFrozen(result.grossBases)).toBe(true);
  });
  it("uses exact explicit rounding and rejects mixed currencies/invalid bases", () => {
    const brackets = [{ lower: money("0"), rate: Ratio.parse("0.1") }];
    expect(calculateProgressiveTax(money("0.05"), brackets, new RoundingPolicy(2, "half_even")).isZero()).toBe(true);
    expect(calculateProgressiveTax(money("0.05"), brackets, new RoundingPolicy(2, "half_up")).equals(money("0.01"))).toBe(true);
    for (const input of [taxInput({ wages: money("-1") }), taxInput({ wages: money("1", Currency.of("EUR")) }), taxInput({ eligibleTraditionalDeduction: money("1") }), taxInput({ taxableRothDistributions: money("1") })]) expect(errorCode(() => calculate(input))).toBe(issueCodes.ruleInputInvalid);
    const result = calculate(taxInput({ wages: money("11000.03") }));
    expect(result.totalLiability.amount.fitsScale(2)).toBe(true);
    expect(result.totalLiability.equals(result.ordinaryTax.plus(result.preferentialTax).plus(result.niit))).toBe(true);
    expect(errorCode(() => calculate(taxInput({}, { withholding: money("0.001") })))).toBe(issueCodes.ruleInputInvalid);
  });
  it.each(["self_employment", "business", "amt", "complex_credits", "rental", "foreign", "estate_gift", "equity_compensation"])("rejects T1B concept %s explicitly", (concept) => {
    expect(errorCode(() => calculate(taxInput({}, { unsupportedConcepts: [concept] })))).toBe(issueCodes.ruleInputInvalid);
  });
});

describe("T1A explicit local jurisdiction facts", () => {
  it("selects NYC residency explicitly, never nearby NY residency or NYC work", () => {
    const rule = taxRule(1, { jurisdiction: "TEST:NYC", applicability: [{ fact: "residenceJurisdictions", includes: "TEST:NYC", present: true }] });
    expect(resolveTaxCoreRule([rule], rule.jurisdiction, "single", at, { residenceJurisdictions: ["TEST:NYC"], workJurisdictions: [] }).rule.id).toBe(rule.id);
    expect(errorCode(() => resolveTaxCoreRule([rule], rule.jurisdiction, "single", at, { residenceJurisdictions: ["TEST:NY:NEARBY"], workJurisdictions: ["TEST:NYC"] }))).toBe(issueCodes.ruleNotActive);
  });
  it("distinguishes Philadelphia residents, nonresident city workers and work outside the city", () => {
    const resident = taxRule(1, { jurisdiction: "TEST:PHILA", applicability: [{ fact: "residenceJurisdictions", includes: "TEST:PHILA", present: true }] });
    const nonresident = taxRule(2, { jurisdiction: resident.jurisdiction, applicability: [{ fact: "residenceJurisdictions", includes: "TEST:PHILA", present: false }, { fact: "workJurisdictions", includes: "TEST:PHILA", present: true }] });
    const select = (facts: TaxJurisdictionFacts) => resolveTaxCoreRule([nonresident, resident], resident.jurisdiction, "single", at, facts);
    expect(select({ residenceJurisdictions: ["TEST:PHILA"], workJurisdictions: ["TEST:OUTSIDE"] }).rule.id).toBe(resident.id);
    expect(select({ residenceJurisdictions: ["TEST:OUTSIDE"], workJurisdictions: ["TEST:PHILA"] }).rule.id).toBe(nonresident.id);
    expect(errorCode(() => select({ residenceJurisdictions: ["TEST:OUTSIDE"], workJurisdictions: ["TEST:OUTSIDE"] }))).toBe(issueCodes.ruleNotActive);
  });
  it("requires authoritative municipality/PSD and work-location keys for PA EIT and LST", () => {
    const eit = taxRule(1, { jurisdiction: "TEST:PA:EIT", applicability: [{ fact: "residenceMunicipality", equals: "TEST:MUNICIPALITY" }, { fact: "residencePsdCode", equals: "999901" }, { fact: "workPsdCode", equals: "999902" }] });
    const lst = taxRule(2, { jurisdiction: "TEST:PA:LST", applicability: [{ fact: "workMunicipality", equals: "TEST:WORK" }, { fact: "workPsdCode", equals: "999902" }] });
    const facts = { ...noJurisdictions, residenceMunicipality: "TEST:MUNICIPALITY", residencePsdCode: "999901", workMunicipality: "TEST:WORK", workPsdCode: "999902" };
    for (const rule of [eit, lst]) {
      expect(resolveTaxCoreRule([eit, lst], rule.jurisdiction, "single", at, facts).rule.id).toBe(rule.id);
      expect(errorCode(() => resolveTaxCoreRule([eit, lst], rule.jurisdiction, "single", at, { ...facts, workPsdCode: "999903" }))).toBe(issueCodes.ruleNotActive);
      // A mailing-city-like jurisdiction label cannot supply authoritative municipality/PSD keys.
      expect(errorCode(() => resolveTaxCoreRule([eit, lst], rule.jurisdiction, "single", at, { residenceJurisdictions: ["TEST:MUNICIPALITY"], workJurisdictions: ["TEST:WORK"] }))).toBe(issueCodes.ruleNotActive);
    }
  });
  it("requires Denver work and employee eligibility, independent of residence", () => {
    const rule = alphaLocalTaxCatalog.find((candidate) => candidate.jurisdiction === "US:CO:DENVER:OPT")!;
    const facts = { residenceJurisdictions: ["US:CO:OUTSIDE_DENVER"], workJurisdictions: ["US:CO:DENVER"], eligibility: { denver_employee_opt_eligible: true } };
    const resolved = resolveTaxCoreRule(alphaLocalTaxCatalog, rule.jurisdiction, "single", rule.effectiveFrom, facts);
    for (const [wage, liability] of [["499.99", "0"], ["500", "5.75"], ["1000", "5.75"]] as const) {
      expect(applyTaxCoreRule(resolved, taxInput({}, { periodicWages: { unit: "calendar_month", wages: money(wage) } })).result.periodicEmployeeTax.equals(money(liability))).toBe(true);
    }
    expect(errorCode(() => resolveTaxCoreRule(alphaLocalTaxCatalog, rule.jurisdiction, "single", rule.effectiveFrom, { ...facts, residenceJurisdictions: ["US:CO:DENVER"], workJurisdictions: [] }))).toBe(issueCodes.ruleNotActive);
    expect(errorCode(() => resolveTaxCoreRule(alphaLocalTaxCatalog, rule.jurisdiction, "single", rule.effectiveFrom, { ...facts, eligibility: { denver_employee_opt_eligible: false } }))).toBe(issueCodes.ruleNotActive);
    expect(errorCode(() => applyTaxCoreRule(resolved, taxInput({}, { periodicWages: { unit: "calendar_year", wages: money("6000") } })))).toBe(issueCodes.ruleInputInvalid);
  });
});

describe("T1A bounded, source-identified law catalogs", () => {
  it.each(["PA", "NY", "NJ", "CO", "CA", "AZ", "GA", "MA"])("selects verified %s law deterministically", (state) => {
    const jurisdiction = `US:${state}`;
    const facts = { residenceJurisdictions: [jurisdiction], workJurisdictions: [] };
    const date = instant("2025-06-01T00:00:00.000Z");
    const selected = resolveTaxCoreRule(alphaStateTaxCatalog, jurisdiction, "single", date, facts);
    expect(resolveTaxCoreRule([...alphaStateTaxCatalog].reverse(), jurisdiction, "single", date, facts).rule.id).toBe(selected.rule.id);
    expect(selected.rule.provenance.type).toBe("verified_law");
    expect(errorCode(() => resolveTaxCoreRule(alphaStateTaxCatalog, jurisdiction, "single", instant("2026-01-01T00:00:00.000Z"), facts))).toBe(issueCodes.ruleNotActive);
    const extra: Partial<TaxCalculationInput> = state === "CA" ? { additionalTaxBases: { ca_total_taxable_income: money("110000") } }
      : state === "MA" ? { additionalTaxBases: { ma_taxable_short_gains: money("0"), ma_combined_taxable_income: money("100000") } } : {};
    const result = applyTaxCoreRule(selected, taxInput({}, { explicitTaxableBase: money(state === "CA" ? "110000" : "100000"), adjustedGrossIncome: money("100000"), ...extra })).result;
    expect(result.totalLiability.isPositive()).toBe(true);
    expect(result.coveredComponents).toContain("liability_from_supplied_legal_taxable_base");
    const missingBase = () => applyTaxCoreRule(selected, taxInput());
    expect(errorCode(missingBase)).toBe(issueCodes.ruleInputInvalid);
  });
  it("rejects NY recapture and NY/CA tax-table gaps instead of approximating", () => {
    for (const state of ["NY", "CA"]) {
      const jurisdiction = `US:${state}`;
      const selected = resolveTaxCoreRule(alphaStateTaxCatalog, jurisdiction, "single", instant("2025-06-01T00:00:00.000Z"), { residenceJurisdictions: [jurisdiction], workJurisdictions: [] });
      expect(errorCode(() => applyTaxCoreRule(selected, taxInput({}, { explicitTaxableBase: money("10000"), adjustedGrossIncome: money("10000") })))).toBe(issueCodes.ruleInputInvalid);
      if (state === "NY") expect(errorCode(() => applyTaxCoreRule(selected, taxInput({}, { explicitTaxableBase: money("100000"), adjustedGrossIncome: money("107650.01") })))).toBe(issueCodes.ruleInputInvalid);
    }
  });
  it("requires explicit MA character/surtax bases and applies the extra rates", () => {
    const selected = resolveTaxCoreRule(alphaStateTaxCatalog, "US:MA", "single", instant("2025-06-01T00:00:00.000Z"), { residenceJurisdictions: ["US:MA"], workJurisdictions: [] });
    const result = applyTaxCoreRule(selected, taxInput({}, { explicitTaxableBase: money("1083150"), additionalTaxBases: { ma_taxable_short_gains: money("10000"), ma_combined_taxable_income: money("1093150") } })).result;
    expect(result.additionalIncomeTaxes.find((component) => component.key === "short_term_gains")!.liability.equals(money("850"))).toBe(true);
    expect(result.additionalIncomeTaxes.find((component) => component.key === "income_surtax")!.liability.equals(money("400"))).toBe(true);
    expect(errorCode(() => applyTaxCoreRule(selected, taxInput({}, { explicitTaxableBase: money("100000") })))).toBe(issueCodes.ruleInputInvalid);
    const inconsistent = taxInput({}, { explicitTaxableBase: money("100000"), additionalTaxBases: { ma_taxable_short_gains: money("10000"), ma_combined_taxable_income: money("100000") } });
    expect(errorCode(() => applyTaxCoreRule(selected, inconsistent))).toBe(issueCodes.ruleInputInvalid);
  });
  it("calculates CA's published example and keeps the income surtax separate", () => {
    const selected = resolveTaxCoreRule(alphaStateTaxCatalog, "US:CA", "married_joint", instant("2025-06-01T00:00:00.000Z"), { residenceJurisdictions: ["US:CA"], workJurisdictions: [] });
    const result = applyTaxCoreRule(selected, taxInput({}, { explicitTaxableBase: money("125000"), additionalTaxBases: { ca_total_taxable_income: money("125000") } })).result;
    expect(result.ordinaryTax.equals(money("4768.1"))).toBe(true);
    expect(result.additionalIncomeTaxes[0]!.liability.isZero()).toBe(true);
  });
  it("selects Philadelphia's bounded resident/nonresident rates using explicit work facts", () => {
    const jurisdiction = "US:PA:PHILADELPHIA:WAGE";
    const date = instant("2026-07-01T00:00:00.000Z");
    const resident = resolveTaxCoreRule(alphaLocalTaxCatalog, jurisdiction, "single", date, { residenceJurisdictions: ["US:PA:PHILADELPHIA"], workJurisdictions: [] });
    const worker = resolveTaxCoreRule(alphaLocalTaxCatalog, jurisdiction, "single", date, { residenceJurisdictions: [], workJurisdictions: ["US:PA:PHILADELPHIA"] });
    expect(applyTaxCoreRule(resident, taxInput({}, { explicitTaxableBase: money("1000") })).result.ordinaryTax.equals(money("37.35"))).toBe(true);
    expect(applyTaxCoreRule(worker, taxInput({}, { explicitTaxableBase: money("1000") })).result.ordinaryTax.equals(money("34.25"))).toBe(true);
    expect(errorCode(() => resolveTaxCoreRule(alphaLocalTaxCatalog, jurisdiction, "single", instant("2026-06-30T23:59:59.999Z"), { residenceJurisdictions: ["US:PA:PHILADELPHIA"], workJurisdictions: [] }))).toBe(issueCodes.ruleNotActive);
  });
  it("sources and bounds every real-law entry and preserves known gaps", () => {
    for (const rule of [...alphaStateTaxCatalog, ...alphaLocalTaxCatalog, ...federal2024TaxCatalog]) {
      expect(rule.effectiveFrom < rule.effectiveUntil).toBe(true);
      expect(Object.isFrozen(rule)).toBe(true);
      expect(rule.provenance.type).toBe("verified_law");
      if (rule.provenance.type !== "verified_law") throw new Error("Expected real law");
      expect(rule.provenance.sources.length).toBeGreaterThan(0);
      for (const source of rule.provenance.sources) {
        expect(source.authority.length).toBeGreaterThan(0); expect(source.reference.length).toBeGreaterThan(0);
        expect(source.url).toMatch(/^https:/); expect(source.verifiedOn).toBe("2026-10-03");
      }
    }
    expect(taxLawCoverageGaps.some((gap) => gap.jurisdiction === "US:PA:LOCAL:EIT")).toBe(true);
    expect(errorCode(() => resolveTaxCoreRule(alphaLocalTaxCatalog, "US:PA:LOCAL:EIT", "single", at, noJurisdictions))).toBe(issueCodes.ruleNotActive);
  });
  it("keeps federal 2024 liability, payroll bases and withholding distinct", () => {
    const selected = resolveTaxCoreRule(federal2024TaxCatalog, "US:FEDERAL", "single", at, noJurisdictions);
    const result = applyTaxCoreRule(selected, taxInput({ wages: money("26200") }, { employeeWages: [{ employeeKey: "one", wages: money("25000") }], modifiedAdjustedGrossIncome: money("26200"), netInvestmentIncome: money("0"), withholding: money("2000") })).result;
    expect(result.ordinaryTax.equals(money("1160"))).toBe(true);
    expect(result.payrollTaxes.find((component) => component.key === "social_security")!.liability.equals(money("1550"))).toBe(true);
    expect(result.totalLiability.equals(money("3072.5"))).toBe(true);
    expect(result.balanceDue.equals(money("1072.5"))).toBe(true);
  });
});
