import { domainId } from "../../identity/index.js";
import { civilDate, instant } from "../../time/index.js";
import { DecimalAmount, Money, Ratio, RoundingPolicy, decimal } from "../../values/index.js";
import type { TaxBracket, TaxCoreRule } from "./contracts.js";

function invalid(message: string): never { throw new Error(message); }
const text = (value: string): void => { if (typeof value !== "string" || value.trim().length === 0) invalid("Tax rule requires nonempty identity/metadata"); };
export const assertTaxMoney = (value: Money, signed = false): void => {
  if (!(value instanceof Money) || value.currency.code !== "USD" || (!signed && value.isNegative())) invalid("Tax money must be exact USD and nonnegative unless a net gain/loss");
};
const rate = (value: Ratio): void => {
  if (!(value instanceof Ratio) || value.value.isNegative() || value.value.compare(decimal("1")) > 0) invalid("Tax rate must be an explicit ratio in [0, 1]");
};
export const assertTaxBrackets = (brackets: readonly TaxBracket[]): void => {
  if (!Array.isArray(brackets) || brackets.length === 0 || !brackets[0]?.lower.isZero()) invalid("Tax brackets must start at zero");
  const published = brackets.some((bracket) => bracket.baseTax !== undefined);
  for (let index = 0; index < brackets.length; index += 1) {
    const bracket = brackets[index]!;
    assertTaxMoney(bracket.lower); rate(bracket.rate);
    if (index > 0 && bracket.lower.compare(brackets[index - 1]!.lower) <= 0) invalid("Tax bracket boundaries must strictly increase");
    if (published && bracket.baseTax === undefined) invalid("Published schedules require an intercept for every bracket");
    if (bracket.baseTax !== undefined) assertTaxMoney(bracket.baseTax);
  }
  if (published && !brackets[0]!.baseTax!.isZero()) invalid("Initial schedule intercept must be zero");
};

export const assertTaxCoreDefinition = (rule: TaxCoreRule): void => {
  domainId("tax-rule", rule.id); domainId("jurisdiction", rule.target.targetId);
  if (rule.target.targetType !== "jurisdiction") invalid("Shared tax rule requires a jurisdiction target");
  text(rule.version); text(rule.jurisdiction);
  if (!["all", "single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"].includes(rule.filingStatus)) invalid("Unsupported filing status in tax definition");
  instant(rule.effectiveFrom); instant(rule.effectiveUntil);
  if (rule.effectiveFrom >= rule.effectiveUntil) invalid("Tax rules require a finite nonempty effective range");
  if (!(rule.rounding instanceof RoundingPolicy) || rule.rounding.scale !== 2 || !["half_up", "half_even", "toward_zero", "away_from_zero", "floor", "ceiling"].includes(rule.rounding.mode)) invalid("Tax rules require explicit USD cent rounding");
  if (!Array.isArray(rule.applicability)) invalid("Tax applicability must be explicit");
  for (const condition of rule.applicability) {
    if (condition.fact === "residenceJurisdictions" || condition.fact === "workJurisdictions") {
      if (!("includes" in condition) || typeof condition.present !== "boolean") invalid("Invalid jurisdiction applicability");
      text(condition.includes);
    } else if (condition.fact === "eligibility") {
      text(condition.key);
      if (typeof condition.equals !== "boolean") invalid("Tax eligibility requires an explicit boolean decision");
    } else {
      if (!["residenceMunicipality", "residencePsdCode", "workMunicipality", "workPsdCode"].includes(condition.fact) || !("equals" in condition)) invalid("Invalid municipality/PSD applicability");
      text(condition.equals);
    }
  }
  if (rule.provenance.type === "verified_law") {
    text(rule.provenance.scope);
    if (!Array.isArray(rule.provenance.limitations) || rule.provenance.sources.length === 0) invalid("Real law requires sources and explicit limitations");
    for (const limitation of rule.provenance.limitations) text(limitation);
    for (const source of rule.provenance.sources) {
      text(source.authority); text(source.reference); civilDate(source.verifiedOn);
      if (!/^https:\/\//.test(source.url)) invalid("Tax law source requires an HTTPS primary-source URL");
    }
  } else if (rule.provenance.type === "synthetic_test_only") text(rule.provenance.description);
  else invalid("Tax provenance is required");
  if (rule.income === undefined && rule.payroll === undefined && rule.niit === undefined && rule.periodicEmployeeTax === undefined && rule.rmd === undefined) invalid("Tax rule must define a supported component");
  if (rule.income !== undefined) {
    const income = rule.income;
    if (!["recognized_income", "explicit_taxable_base"].includes(income.basis) || !["ordinary", "preferential"].includes(income.capitalTreatment) || typeof income.traditionalContributionDeduction !== "boolean") invalid("Invalid tax income characterization");
    assertTaxBrackets(income.ordinaryBrackets);
    assertTaxMoney(income.standardDeduction); assertTaxMoney(income.capitalLossDeductionLimit);
    if (income.capitalTreatment === "preferential") {
      if (income.preferentialBrackets === undefined) invalid("Preferential treatment requires explicit brackets");
      assertTaxBrackets(income.preferentialBrackets);
      if (income.preferentialBrackets.some((bracket) => bracket.baseTax !== undefined)) invalid("Stacked preferential brackets use marginal rates, not published intercepts");
    } else if (income.preferentialBrackets !== undefined) invalid("Ordinary gain treatment cannot declare preferential brackets");
    if (income.basis === "explicit_taxable_base" && (income.capitalTreatment !== "ordinary" || !income.standardDeduction.isZero() || !income.capitalLossDeductionLimit.isZero() || income.traditionalContributionDeduction)) invalid("Explicit taxable bases must already contain deductions and character adjustments");
    if (income.minimumTaxableBase !== undefined) assertTaxMoney(income.minimumTaxableBase);
    if (income.maximumAdjustedGrossIncome !== undefined) assertTaxMoney(income.maximumAdjustedGrossIncome);
    if (income.additionalTaxes !== undefined) {
      if (new Set(income.additionalTaxes.map((component) => component.key)).size !== income.additionalTaxes.length) invalid("Additional income tax keys must be unique");
      for (const component of income.additionalTaxes) {
        text(component.key); text(component.inputBase); assertTaxBrackets(component.brackets);
        if (component.composedFrom !== undefined) {
          if (new Set(component.composedFrom).size !== component.composedFrom.length || component.composedFrom.includes(component.inputBase)) invalid("Additional-base composition cannot duplicate or reference itself");
          for (const key of component.composedFrom) if (!income.additionalTaxes.some((other) => other.inputBase === key)) invalid("Additional-base composition references an unconfigured input");
        }
      }
    }
  }
  if (rule.payroll !== undefined) {
    if (rule.payroll.length === 0 || new Set(rule.payroll.map((component) => component.key)).size !== rule.payroll.length) invalid("Payroll components require unique keys");
    for (const component of rule.payroll) {
      text(component.key); rate(component.rate); assertTaxMoney(component.threshold);
      if (!["per_employee", "combined_wages"].includes(component.basis)) invalid("Payroll basis must be explicit");
      if (component.wageBase !== undefined) {
        assertTaxMoney(component.wageBase);
        if (component.wageBase.compare(component.threshold) < 0) invalid("Payroll cap cannot precede threshold");
      }
    }
  }
  if (rule.niit !== undefined) { rate(rule.niit.rate); assertTaxMoney(rule.niit.threshold); }
  if (rule.periodicEmployeeTax !== undefined) {
    assertTaxMoney(rule.periodicEmployeeTax.amount); assertTaxMoney(rule.periodicEmployeeTax.wageThreshold);
    if (!["calendar_month", "calendar_year"].includes(rule.periodicEmployeeTax.unit)) invalid("Periodic tax requires explicit assessment units");
  }
  if (rule.rmd !== undefined) {
    if (!Number.isSafeInteger(rule.rmd.minimumAge) || rule.rmd.minimumAge < 0 || rule.rmd.divisors.length === 0) invalid("RMD age/table must be explicit");
    const ages = new Set<number>();
    for (const entry of rule.rmd.divisors) {
      if (!Number.isSafeInteger(entry.age) || entry.age < rule.rmd.minimumAge || ages.has(entry.age) || !(entry.divisor instanceof DecimalAmount) || !entry.divisor.isPositive()) invalid("Invalid RMD age/divisor");
      ages.add(entry.age);
    }
  }
};

/** Clone/freeze only data containers; financial value instances are already immutable. */
export const immutableTaxData = <T>(value: T): T => {
  if (Array.isArray(value)) return Object.freeze(value.map((item: unknown) => immutableTaxData(item))) as unknown as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableTaxData(item)]))) as unknown as T;
  }
  return value;
};
