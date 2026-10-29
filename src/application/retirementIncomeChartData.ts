import type { PersonalDraft } from "./personalMvp.js";
import { getPersonalRetirementPlans } from "./personalMvp.js";
import { objects } from "./compiler/shared.js";
import { age90Horizon, birthdayAtAge, retirementProposals } from "./forecastReadiness.js";
import type { PersonalHouseholdForecastReadModel } from "./householdProjection.js";

/** One capability boundary. Aggregate statements and balance deltas cannot prove
 * cash-source identity. Do not manufacture a residual or treat missing as zero.
 * Follow-on: the source-owned read model must expose immutable period [start,end),
 * sourceId, personId, family, exact amount/currency, gross/net/cash basis,
 * withholding coverage, capability status and trace refs, plus disjoint transfer/
 * distribution identities. Reconciliation and no-double-count proofs belong to
 * that source producer before any V6 stacked-series selector can consume it.
 */
const incomeSources = Object.freeze({
  status: "unavailable" as const,
  reason: "missing_identity_safe_period_income_streams" as const,
  series: Object.freeze([]),
  unsupported: Object.freeze(["Wages", "Pension", "Social Security", "Annuity", "Investment withdrawals", "Other income"]),
});

/** Calendar/identity selection only; financial resources stay in existing selectors. */
export function selectRetirementIncomeChartData(model: PersonalDraft, asOf: string, personIds: readonly string[], forecast?: PersonalHouseholdForecastReadModel) {
  const plans = getPersonalRetirementPlans(model);
  const proposals = retirementProposals(model, asOf);
  const incomes = objects(model, "Income");
  const adults = Object.freeze(objects(model, "Person").filter(person => {
    const adultAt = birthdayAtAge(String(person.date_of_birth ?? ""), 18);
    return objects(model, "Household").some(household => household.household_id === person.household_id && Array.isArray(household.members) && household.members.includes(person.person_id!)) && (!adultAt || adultAt <= asOf);
  }).map(person => {
    const personId = String(person.person_id);
    return Object.freeze({ personId, name: `${String(person.first_name ?? "")} ${String(person.last_name ?? "")}`.trim() || "Person",
      dob: typeof person.date_of_birth === "string" ? person.date_of_birth : undefined,
      selected: personIds.includes(personId),
      age90: birthdayAtAge(String(person.date_of_birth ?? ""), 90),
      proposal: proposals.find(proposal => proposal.personId === personId)?.date,
      confirmed: Object.freeze(plans.filter(plan => incomes.some(income => income.income_id === plan.incomeId && income.owner_id === personId)).map(plan => {
        const dob = String(person.date_of_birth ?? "");
        const years = Number(plan.date.slice(0, 4)) - Number(dob.slice(0, 4));
        const birthday = birthdayAtAge(dob, years);
        const age = birthday && plan.date >= dob ? years - Number(plan.date < birthday) : undefined;
        return Object.freeze({ ...plan, age });
      })),
    });
  }));
  const result = forecast && forecast.status !== "unavailable" ? forecast : undefined;
  const horizon = age90Horizon(model, personIds, asOf);
  return Object.freeze({ incomeSources, adults,
    age90: horizon ? Object.freeze({ ...horizon, targets: Object.freeze(horizon.targets.map(target => Object.freeze({ ...target }))) }) : undefined,
    modeledRetirements: Object.freeze((result?.retirementMilestones ?? []).map(item => Object.freeze({ ...item }))),
    mortgagePayoffs: Object.freeze((result?.debtPayoffs ?? []).map(item => Object.freeze({ ...item, name: String(objects(model, "Liability").find(loan => loan.liability_id === item.loanId)?.name ?? "Mortgage") }))),
  });
}
