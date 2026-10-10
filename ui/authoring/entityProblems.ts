import { getPayrollContributionPlans, getPersonalPurchasePlans, getPayrollOpeningUnvestedUnits, type JsonObject, type PersonalDraft, type PersonalObjectType } from "../../src/application/personalMvp.js";
import { objectEntries, isCashFlowPaymentAccount, linkedReturnAssumption } from "../entityPresentation.js";
import { unvestedProblem, effectiveAnnualReturnProblem } from "./fieldContract.js";
import { investmentFieldApplies } from "./investmentFields.js";

/** Bounded relationship checks only. Financial calculations stay in D1. */
export function entityRelationshipProblems(type: PersonalObjectType, item: JsonObject, draft: PersonalDraft): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  // Use committed facts so retyping staged meaning cannot escape the guard.
  if (type === "Assumption") {
    const original = objectEntries(draft, "Assumption").find(value => value.assumption_id === item.assumption_id);
    const linked = original && objectEntries(draft, "Investment").some(investment =>
      linkedReturnAssumption(draft, investment, String(original.scenario_id))?.assumption_id === item.assumption_id);
    if (original && linked) {
      const problem = effectiveAnnualReturnProblem(item.value);
      if (problem) errors.value = problem;
      if (item.unit !== "effective annual rate") errors.unit = "Keep effective annual rate: linked holdings require this return basis.";
      if (item.category !== "market_return") errors.category = "Keep market return: this assumption supplies the projected return for linked holdings.";
      for (const field of ["start_date", "end_date"] as const) if (item[field] != null) errors[field] = "Leave this date unset. Linked holdings require a return covering the whole plan.";
      if (item.scenario_id !== original.scenario_id) errors.scenario_id = "Keep the linked plan or import a model with a revised return relationship.";
    }
  }
  const period = (start: string, end: string) => {
    if (typeof item[start] === "string" && typeof item[end] === "string" && item[end] && item[start] >= item[end]) errors[end] = "Choose an end date after the start date.";
  };
  period("start_date", "end_date");
  period("opening_date", "closing_date");
  period("date_of_birth", "date_of_death");
  if (type === "Investment" && investmentFieldApplies("maturity_date", item)) period("acquisition_date", "maturity_date");
  if (type === "Liability") period("origination_date", "maturity_date");
  if (type === "Income" && item.gross_or_net !== "gross" && item.gross_or_net !== "net") errors.gross_or_net = "Choose gross pay or take-home pay.";
  if (type === "Expense" && item.payment_account_id && !objectEntries(draft, "Account").some(account => account.account_id === item.payment_account_id && isCashFlowPaymentAccount(account))) errors.payment_account_id = "Choose checking, savings, or cash to pay spending.";
  try {
    const payroll = getPayrollContributionPlans(draft);
    if (type === "Account" && payroll.some(plan => plan.allocation.accountId === item.account_id && objectEntries(draft, "Income").find(income => income.income_id === plan.incomeId)?.owner_id !== item.owner_id)) errors.owner_id = "This account receives payroll contributions. Keep the salary owner or revise those contributions first.";
    if (type === "Account" && getPersonalPurchasePlans(draft).some(plan => plan.contribution && objectEntries(draft, "Investment").find(investment => investment.investment_id === plan.investmentId)?.account_id === item.account_id && plan.contribution.personId !== item.owner_id)) errors.owner_id = "This account has saved IRA eligibility for its owner. Revise those contributions before changing the owner.";
    if (type === "Income" && payroll.some(plan => plan.incomeId === item.income_id)) {
      if (item.gross_or_net === "net") errors.gross_or_net = "This salary funds payroll contributions. Keep gross pay or revise those contributions first.";
      if (payroll.some(plan => plan.incomeId === item.income_id && objectEntries(draft, "Account").find(account => account.account_id === plan.allocation.accountId)?.owner_id !== item.owner_id)) errors.owner_id = "Keep the contribution account owner or revise the payroll contributions first.";
    }
    if (type === "Investment") {
      if (typeof item.investment_id === "string" && typeof item.quantity === "string") {
        const problem = unvestedProblem(getPayrollOpeningUnvestedUnits(draft, item.investment_id), item.quantity);
        if (problem) errors.quantity = "Opening units cannot be smaller than the recorded unvested units. Review employer vesting in Current Plan.";
      }
      const account = objectEntries(draft, "Account").find(account => account.account_id === item.account_id);
      const original = objectEntries(draft, "Investment").find(value => value.investment_id === item.investment_id);
      if (original && original.account_id !== item.account_id && (payroll.some(plan => plan.allocation.positionId === item.investment_id) || getPersonalPurchasePlans(draft).some(plan => plan.investmentId === item.investment_id))) errors.account_id = "This holding has saved contributions. Revise those contributions before changing its account.";
      if (item.owner_id != null && account && item.owner_id !== account.owner_id) errors.account_id = "Choose an account belonging to this holding's owner.";
    }
  } catch {
    // Existing unsupported policies remain visible in their dedicated authoring view.
  }
  return errors;
}
