import { getPayrollContributionPlans, getPersonalPurchasePlans, type JsonObject, type PersonalDraft, type PersonalObjectType } from "../../src/application/personalMvp.js";
import { objectEntries, isCashFlowPaymentAccount } from "../entityPresentation.js";

/** Bounded relationship checks only. Financial calculations stay in D1. */
export function entityRelationshipProblems(type: PersonalObjectType, item: JsonObject, draft: PersonalDraft): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const period = (start: string, end: string) => {
    if (typeof item[start] === "string" && typeof item[end] === "string" && item[end] && item[start] >= item[end]) errors[end] = "Choose an end date after the start date.";
  };
  period("start_date", "end_date");
  period("opening_date", "closing_date");
  period("date_of_birth", "date_of_death");
  if (type === "Investment") period("acquisition_date", "maturity_date");
  if (type === "Liability") period("origination_date", "maturity_date");
  if (type === "Income" && item.gross_or_net !== "gross" && item.gross_or_net !== "net") errors.gross_or_net = "Choose gross pay or take-home pay.";
  if (type === "Expense" && item.payment_account_id && !objectEntries(draft, "Account").some(account => account.account_id === item.payment_account_id && isCashFlowPaymentAccount(account))) errors.payment_account_id = "Choose checking, savings, or cash to pay spending.";
  try {
    const payroll = getPayrollContributionPlans(draft);
    if (type === "Income" && payroll.some(plan => plan.incomeId === item.income_id)) {
      if (item.gross_or_net === "net") errors.gross_or_net = "This salary funds payroll contributions. Keep gross pay or revise those contributions first.";
      if (payroll.some(plan => plan.incomeId === item.income_id && objectEntries(draft, "Account").find(account => account.account_id === plan.allocation.accountId)?.owner_id !== item.owner_id)) errors.owner_id = "Keep the contribution account owner or revise the payroll contributions first.";
    }
    if (type === "Investment") {
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
