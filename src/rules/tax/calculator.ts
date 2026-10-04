import { failValidation, issueCodes } from "../../diagnostics/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../lineage/index.js";
import { Money, USD, sumMoney } from "../../values/index.js";
import type { RuleApplication } from "../contracts.js";
import { resolvedRuleValue, type ResolvedRule } from "../resolver.js";
import { taxCatalogFingerprint } from "./catalog.js";
import type { TaxBracket, TaxCalculationInput, TaxCoreResult } from "./contracts.js";
import { assertTaxBrackets, assertTaxMoney, immutableTaxData } from "./definition.js";

const zero = (): Money => Money.zero(USD);
const min = (a: Money, b: Money): Money => a.compare(b) < 0 ? a : b;
const positive = (value: Money): Money => value.isNegative() ? zero() : value;
function unsupported(message: string): never {
  return failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: `Unsupported tax capability: ${message}`, entityType: "tax_calculation" });
}

/** Unrounded exact tax; bracket order is validated, never used as hidden precedence. */
const bracketTax = (base: Money, brackets: readonly TaxBracket[]): Money => {
  if (brackets[0]!.baseTax !== undefined) {
    const bracket = [...brackets].reverse().find((entry) => entry.lower.isZero() || base.compare(entry.lower) > 0)!;
    return bracket.baseTax!.plus(base.minus(bracket.lower).times(bracket.rate.value));
  }
  return sumMoney(brackets.map((bracket, index) => {
    const upper = brackets[index + 1]?.lower;
    const width = positive((upper === undefined ? base : min(base, upper)).minus(bracket.lower));
    return width.times(bracket.rate.value);
  }));
};

export const calculateProgressiveTax = (base: Money, brackets: readonly TaxBracket[], rounding: import("../../values/index.js").RoundingPolicy): Money => {
  assertTaxMoney(base); assertTaxBrackets(brackets);
  return bracketTax(base, brackets).round(rounding);
};

const validateInput = (input: TaxCalculationInput): void => {
  const signed = new Set(["shortTermGains", "longTermGains"]);
  for (const key of ["wages", "taxableInterest", "ordinaryDividends", "qualifiedDividends", "shortTermGains", "longTermGains", "traditionalContributions", "eligibleTraditionalDeduction", "traditionalDistributions", "traditionalDistributionBasisRecovered", "rothContributions", "rothDistributions", "taxableRothDistributions"] as const) {
    assertTaxMoney(input.income[key], signed.has(key));
  }
  for (const amount of [input.withholding, input.estimatedPayments, input.priorPaymentCredit]) {
    assertTaxMoney(amount);
    if (!amount.amount.fitsScale(2)) throw new Error("Supplied payments/credits must be posted USD cents");
  }
  for (const amount of [input.basicDeductionElection, input.explicitTaxableBase, input.adjustedGrossIncome, input.modifiedAdjustedGrossIncome, input.netInvestmentIncome]) if (amount !== undefined) assertTaxMoney(amount);
  for (const amount of Object.values(input.additionalTaxBases ?? {})) assertTaxMoney(amount);
  if (input.income.eligibleTraditionalDeduction.compare(input.income.traditionalContributions) > 0
    || input.income.traditionalDistributionBasisRecovered.compare(input.income.traditionalDistributions) > 0
    || input.income.taxableRothDistributions.compare(input.income.rothDistributions) > 0) throw new Error("Retirement deductions/basis/taxable portions cannot exceed the underlying amounts");
  if (input.employeeWages !== undefined) {
    const keys = new Set<string>();
    for (const employee of input.employeeWages) {
      assertTaxMoney(employee.wages);
      if (employee.employeeKey.trim().length === 0 || keys.has(employee.employeeKey)) throw new Error("Employee wage bases require unique explicit employee keys");
      keys.add(employee.employeeKey);
    }
  }
  if (input.periodicWages !== undefined) assertTaxMoney(input.periodicWages.wages);
  if (input.rmd !== undefined) {
    assertTaxMoney(input.rmd.priorYearEndBalance);
    if (!Number.isSafeInteger(input.rmd.age) || input.rmd.age < 0) throw new Error("RMD requires explicit attained age");
  }
};

/** Pure, scoped liability calculation: no recognition posting, funding, or state mutation. */
export const applyTaxCoreRule = (resolved: ResolvedRule<"tax_core">, input: TaxCalculationInput): RuleApplication<TaxCoreResult> => {
  const rule = resolvedRuleValue(resolved, "tax_core");
  try { validateInput(input); }
  catch (error) { failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: error instanceof Error ? error.message : "Invalid tax facts", entityType: "tax_calculation", entityId: rule.id }); }
  if ((input.unsupportedConcepts?.length ?? 0) > 0) unsupported([...input.unsupportedConcepts!].sort().join(", "));
  if (rule.income === undefined && (input.explicitTaxableBase !== undefined || input.basicDeductionElection !== undefined)) unsupported("income-tax component missing");
  if (rule.payroll === undefined && input.employeeWages !== undefined) unsupported("employee payroll component missing");
  if (input.rmd !== undefined && rule.rmd === undefined) unsupported("RMD table missing");
  if (input.periodicWages !== undefined && rule.periodicEmployeeTax === undefined) unsupported("periodic employee-tax rule missing");
  if ((input.netInvestmentIncome !== undefined || input.modifiedAdjustedGrossIncome !== undefined) && rule.niit === undefined) unsupported("NIIT rule missing");
  const additionalDefinitions = rule.income?.additionalTaxes ?? [];
  for (const key of Object.keys(input.additionalTaxBases ?? {})) if (!additionalDefinitions.some((component) => component.inputBase === key)) unsupported(`unconfigured additional tax base ${key}`);
  const facts = input.income;
  const taxableTraditionalDistributions = facts.traditionalDistributions.minus(facts.traditionalDistributionBasisRecovered);
  let ordinaryTaxableBase = zero();
  let preferentialTaxableBase = zero();
  let capitalLossDeduction = zero();
  let unusedCapitalLoss = zero();
  let traditionalDeductionApplied = zero();
  let basicDeductionApplied = zero();
  let ordinaryTax = zero();
  let preferentialTax = zero();
  if (rule.income !== undefined) {
    const income = rule.income;
    if (income.basis === "explicit_taxable_base") {
      if (input.explicitTaxableBase === undefined) unsupported("jurisdiction-specific legal taxable base is required");
      if (input.basicDeductionElection !== undefined) unsupported("deductions must already be included in the supplied taxable base");
      ordinaryTaxableBase = input.explicitTaxableBase;
    } else {
      if (input.explicitTaxableBase !== undefined) unsupported("recognized-income rules cannot substitute a supplied taxable base");
      let short = facts.shortTermGains;
      let long = facts.longTermGains;
      // Explicit cross-character netting precedes character-specific rates.
      if (short.isNegative() && long.isPositive()) {
        const offset = min(short.negated(), long); short = short.plus(offset); long = long.minus(offset);
      } else if (long.isNegative() && short.isPositive()) {
        const offset = min(long.negated(), short); long = long.plus(offset); short = short.minus(offset);
      }
      const loss = positive(short.plus(long).negated());
      capitalLossDeduction = min(loss, income.capitalLossDeductionLimit);
      unusedCapitalLoss = loss.minus(capitalLossDeduction);
      traditionalDeductionApplied = income.traditionalContributionDeduction ? facts.eligibleTraditionalDeduction : zero();
      const ordinaryGross = sumMoney([facts.wages, facts.taxableInterest, facts.ordinaryDividends, positive(short), taxableTraditionalDistributions, facts.taxableRothDistributions]);
      let ordinary = ordinaryGross.minus(traditionalDeductionApplied).minus(capitalLossDeduction);
      let preferred = facts.qualifiedDividends.plus(positive(long));
      if (income.capitalTreatment === "ordinary") { ordinary = ordinary.plus(preferred); preferred = zero(); }
      else if (ordinary.isNegative()) preferred = positive(preferred.plus(ordinary));
      ordinary = positive(ordinary);
      const deduction = input.basicDeductionElection ?? income.standardDeduction;
      basicDeductionApplied = min(deduction, ordinary.plus(preferred));
      ordinaryTaxableBase = positive(ordinary.minus(deduction));
      preferentialTaxableBase = positive(preferred.minus(positive(deduction.minus(ordinary))));
    }
    if (income.minimumTaxableBase !== undefined && ordinaryTaxableBase.plus(preferentialTaxableBase).compare(income.minimumTaxableBase) < 0) unsupported("published tax-table coverage below the rate-schedule minimum is missing");
    if (income.maximumAdjustedGrossIncome !== undefined) {
      if (input.adjustedGrossIncome === undefined) unsupported("explicit jurisdiction adjusted gross income required for recapture boundary");
      if (input.adjustedGrossIncome.compare(income.maximumAdjustedGrossIncome) > 0) unsupported("jurisdiction recapture/surtax coverage above configured AGI boundary is missing");
    }
    ordinaryTax = bracketTax(ordinaryTaxableBase, income.ordinaryBrackets).round(rule.rounding);
    if (preferentialTaxableBase.isPositive()) {
      const brackets = income.preferentialBrackets!;
      preferentialTax = bracketTax(ordinaryTaxableBase.plus(preferentialTaxableBase), brackets).minus(bracketTax(ordinaryTaxableBase, brackets)).round(rule.rounding);
    }
  }
  const additionalIncomeTaxes = [...additionalDefinitions].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map((component) => {
    const base = input.additionalTaxBases?.[component.inputBase];
    if (base === undefined) unsupported(`explicit legal base required for ${component.key}`);
    if (component.composedFrom !== undefined) {
      const parts = component.composedFrom.map((key) => {
        const amount = input.additionalTaxBases?.[key];
        if (amount === undefined) unsupported(`missing legal base ${key} for ${component.key} reconciliation`);
        return amount;
      });
      if (!base.equals(ordinaryTaxableBase.plus(sumMoney(parts)))) unsupported(`inconsistent combined legal base for ${component.key}`);
    }
    return Object.freeze({ key: component.key, base, liability: bracketTax(base, component.brackets).round(rule.rounding) });
  });
  const payrollTaxes = [...(rule.payroll ?? [])].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map((component) => {
    if (input.employeeWages === undefined) unsupported("explicit employee payroll taxable-wage bases required");
    const employeeWages = input.employeeWages.map((employee) => employee.wages);
    const wages = component.basis === "per_employee" ? employeeWages : [sumMoney(employeeWages)];
    const bases = wages.map((wage) => positive((component.wageBase === undefined ? wage : min(wage, component.wageBase)).minus(component.threshold)));
    return Object.freeze({ key: component.key, base: sumMoney(bases), liability: sumMoney(bases.map((base) => base.times(component.rate.value).round(rule.rounding))) });
  });
  let niit = zero();
  if (rule.niit !== undefined) {
    if (input.modifiedAdjustedGrossIncome === undefined || input.netInvestmentIncome === undefined) unsupported("NIIT requires explicit MAGI and net investment income");
    niit = min(input.netInvestmentIncome, positive(input.modifiedAdjustedGrossIncome.minus(rule.niit.threshold))).times(rule.niit.rate.value).round(rule.rounding);
  }
  let periodicEmployeeTax = zero();
  if (rule.periodicEmployeeTax !== undefined) {
    if (input.periodicWages === undefined || input.periodicWages.unit !== rule.periodicEmployeeTax.unit) unsupported("periodic employee tax requires wages in the configured assessment period");
    if (input.periodicWages.wages.compare(rule.periodicEmployeeTax.wageThreshold) >= 0) periodicEmployeeTax = rule.periodicEmployeeTax.amount.round(rule.rounding);
  }
  let requiredMinimumDistribution: Money | undefined;
  if (input.rmd !== undefined && rule.rmd !== undefined) {
    if (input.rmd.age < rule.rmd.minimumAge) requiredMinimumDistribution = zero();
    else {
      const entry = rule.rmd.divisors.find((row) => row.age === input.rmd!.age);
      if (entry === undefined) unsupported(`RMD divisor missing for age ${input.rmd.age}`);
      requiredMinimumDistribution = new Money(input.rmd.priorYearEndBalance.amount.dividedBy(entry.divisor, rule.rounding), USD);
    }
  }
  const totalLiability = sumMoney([ordinaryTax, preferentialTax, ...additionalIncomeTaxes.map((component) => component.liability), ...payrollTaxes.map((component) => component.liability), niit, periodicEmployeeTax]);
  const totalPayments = sumMoney([input.withholding, input.estimatedPayments, input.priorPaymentCredit]);
  const traceRefs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`rule:tax_core:${rule.id}:${rule.version}:${resolved.resolvedAt}`), [rule.id])])!;
  const result: TaxCoreResult = immutableTaxData({
    coveredComponents: [
      ...(rule.income === undefined ? [] : [rule.income.basis === "recognized_income" ? "income_characterization_and_liability" : "liability_from_supplied_legal_taxable_base"]),
      ...(rule.payroll === undefined ? [] : ["employee_payroll"]), ...(rule.niit === undefined ? [] : ["niit"]),
      ...(rule.periodicEmployeeTax === undefined ? [] : ["periodic_employee_tax"]), ...(rule.rmd === undefined ? [] : ["rmd_amount"]),
    ],
    grossBases: { ...facts }, taxableTraditionalDistributions, taxableRothDistributions: facts.taxableRothDistributions,
    capitalLossDeduction, unusedCapitalLoss, traditionalDeductionApplied, basicDeductionApplied,
    ordinaryTaxableBase, preferentialTaxableBase, ordinaryTax, preferentialTax, additionalIncomeTaxes, payrollTaxes, niit, periodicEmployeeTax,
    ...(requiredMinimumDistribution === undefined ? {} : { requiredMinimumDistribution }),
    totalLiability, payments: { withholding: input.withholding, estimated: input.estimatedPayments, priorCredit: input.priorPaymentCredit, total: totalPayments },
    balanceDue: positive(totalLiability.minus(totalPayments)), refundableAmount: positive(totalPayments.minus(totalLiability)),
    appliedRules: [{ id: rule.id, version: rule.version }], catalogFingerprint: taxCatalogFingerprint([rule]), traceRefs,
  });
  return Object.freeze({ ruleId: rule.id, ruleKind: rule.kind, target: rule.target, evaluatedAt: resolved.resolvedAt, result, traceRefs });
};
