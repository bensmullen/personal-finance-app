/** Presentation bindings to the controlled register; this file owns no facts. */
const groups: Readonly<Record<string, readonly string[]>> = {
  "household.membership": ["setupName", "household_type", "formation_date", "members"],
  "person.identity": ["owner_id", "first_name", "last_name", "household_id", "employment_status"],
  "person.birthdate": ["date_of_birth"], "person.age_year_end": ["age"],
  "person.residence": ["primary_jurisdiction", "residence_jurisdiction"],
  "tax.filing_status": ["filing_status", "filingStatus", "livesWithSpouse"],
  "tax.roth_magi": ["rothMagi"], "tax.deduction_magi": ["deductionMagi"],
  "health.coverage": ["hsaFullYearEligible", "hsaCoverage", "hsaFamilyAllocation"],
  "income.ira_compensation": ["taxableCompensation"], "income.prior_sponsor_wages": ["priorYearSponsorWages"],
  "income.pay_contract": ["setupIncome", "gross_or_net", "income_type"], "income.receiving_bank": ["cashAccount"],
  "spend.recurring": ["setupSpending", "essentiality"], "spend.funding": ["payment_account_id"],
  "bank.cash_account": ["setupCash", "baseCurrency"],
  "investment.holding": ["investment_type", "symbol", "acquisition_date", "tax_treatment", "account_id", "instrument_subtype", "face_value", "coupon_rate", "crediting_frequency", "funding_account_id", "settlement_account_id", "underlying_investment_id", "strike_price", "expiration_date", "contract_multiplier", "lotHolding", "lotDate", "lotUnits", "lotBasis", "unvested"],
  "investment.valuation": ["quantity", "price", "market_value"], "investment.return": ["return"],
  "investment.purchase": ["purchaseInvestment", "purchaseFunding", "purchaseAmount", "purchaseDate", "purchaseFrequency", "purchaseOrder"],
  "investment.payroll": ["payrollDestination", "payrollSalary", "character", "method", "payrollAmount", "payrollRate", "matchCap", "payrollPriority", "vested", "vestDate", "forfeitDate"],
  "investment.annual_eligibility": ["excess", "taxYear"], "investment.contribution_projection": ["annualFacts"],
  "investment.past_usage": ["historicalHolding", "ytdDate", "ytdTotal", "ytdOrdinary", "ytdConfirmed"],
  "employer.plan_terms": ["planKey", "planHasRoth", "covered", "spouseCovered"], "employer.eligible_pay": ["eligiblePlanCompensation"],
  "debt.mortgage_contract": ["setupDebt", "principal", "current_balance", "interest_rate", "origination_date", "rate_type", "payment_frequency", "maturity_date", "collateral_id"],
  "debt.mortgage_schedule": ["paymentAnchor", "totalPayments"], "debt.mortgage_funding": ["mortgageFunding", "settlementPriority"], "debt.extra_refinance": ["extra_payment"],
  "property.asset": ["setupAsset", "asset_type", "acquisition_cost", "liquidity_class"], "property.valuation": ["valuation_method"],
  "life.retirement": ["retirementIncome", "retirementDate"],
  "plan.horizon": ["setupStart", "setupHorizon", "planStart", "planEnd", "simulationStart", "simulationEnd", "horizon", "timestep", "enabled"],
  "plan.forecast_options": ["asOf", "dataCutoff", "cashOrder", "investmentOwner", "debtOwner"],
  "tax.settlement": ["taxPayment", "taxRefund", "taxDate", "taxPriority", "taxConfirm"], "money.paycheck_view": ["moneyMonth"],
};
export const WORKFLOW_FIELD_OWNERS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(groups).flatMap(([family, keys]) => keys.map(key => [key, family]))));
export function entityFieldOwner(context: string, key: string, accountType?: unknown, assumptionCategory?: unknown): string | undefined {
  switch (context) {
    case "Household": return key === "filing_status" ? "tax.filing_status" : key === "primary_jurisdiction" ? "person.residence" : "household.membership";
    case "Person": return key === "date_of_birth" ? "person.birthdate" : key === "filing_status" ? "tax.filing_status" : key === "residence_jurisdiction" ? "person.residence" : key === "household_id" ? "household.membership" : "person.identity";
    case "Income": return key === "source" ? "income.employer" : "income.pay_contract";
    case "Expense": return key === "payment_account_id" ? "spend.funding" : "spend.recurring";
    case "Account": return ["interest_rate", "interest_convention", "first_credit_date"].includes(key) ? "bank.interest" : ["checking", "savings", "cash"].includes(String(accountType ?? "checking")) ? "bank.cash_account" : "investment.account";
    case "Investment": return ["quantity", "price", "market_value"].includes(key) ? "investment.valuation" : "investment.holding";
    case "Asset": return ["market_value", "valuation_method"].includes(key) ? "property.valuation" : "property.asset";
    case "Liability": return key === "extra_payment" ? "debt.extra_refinance" : "debt.mortgage_contract";
    case "Scenario": return "plan.horizon";
    case "Assumption": return assumptionCategory === "market_return" ? "investment.return" : assumptionCategory === "income_growth" || assumptionCategory === "salary_growth" ? "income.growth" : assumptionCategory === "inflation" || assumptionCategory === "expense_growth" ? "spend.inflation" : "plan.assumption_index";
    default: return undefined;
  }
}
