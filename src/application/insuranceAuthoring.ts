import type { JsonObject, PersonalDraft } from "./personalMvp.js";
import { objects, UUID, utcDate } from "./compiler/shared.js";
import { decimal } from "../values/index.js";
export class InsuranceAuthoringError extends Error {}

export interface TermLifeTerms {
  readonly owner: string; readonly insured: string; readonly beneficiary: string;
  readonly premiumAccount: string; readonly benefitAccount: string;
  readonly premium: string; readonly benefit: string; readonly start: string; readonly end: string;
}
/** Canonical policy terms only. A policy save never authors a scenario event. */
export function termLifeProblems(model: PersonalDraft, terms: TermLifeTerms): Readonly<Partial<Record<keyof TermLifeTerms, string>>> {
  const errors: Partial<Record<keyof TermLifeTerms, string>> = {};
  const people = objects(model, "Person"), households = objects(model, "Household"), accounts = objects(model, "Account");
  const owner = people.find(item => item.person_id === terms.owner);
  if (!owner) errors.owner = "Choose the household person who owns this policy.";
  if (!people.some(item => item.person_id === terms.insured && item.household_id === owner?.household_id)) errors.insured = "Choose an insured person in the policy owner's household.";
  if (!people.some(item => item.person_id === terms.beneficiary && item.household_id === owner?.household_id) && !households.some(item => item.household_id === terms.beneficiary && item.household_id === owner?.household_id)) errors.beneficiary = "Choose one beneficiary in the same household.";
  const bank = (id: string) => accounts.find(item => item.account_id === id && ["checking", "savings"].includes(String(item.account_type)) && item.currency === "USD");
  if (bank(terms.premiumAccount)?.owner_id !== terms.owner || !terms.owner) errors.premiumAccount = "Choose the owner's USD checking or savings account for premiums.";
  const destination = bank(terms.benefitAccount);
  const householdBeneficiary = households.some(item => item.household_id === terms.beneficiary);
  if (!destination || (householdBeneficiary ? !people.some(item => item.person_id === destination.owner_id && item.household_id === terms.beneficiary) : destination.owner_id !== terms.beneficiary)) errors.benefitAccount = "Choose a USD checking or savings account belonging to the beneficiary or, for a household beneficiary, one of its people.";
  for (const key of ["premium", "benefit"] as const) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(terms[key]) || decimal(terms[key]).isNegative()) errors[key] = "Enter an exact nonnegative dollar amount without commas.";
  }
  if (!utcDate(terms.start)) errors.start = "Choose a valid coverage start date.";
  if (!utcDate(terms.end) || terms.end <= terms.start) errors.end = "Choose an exclusive coverage end after the start date.";
  return errors;
}
export function authorTermLifePolicy(model: PersonalDraft, policyId: string, terms: TermLifeTerms): PersonalDraft {
  if (!UUID.test(policyId) || Object.keys(termLifeProblems(model, terms)).length) throw new InsuranceAuthoringError("Review the highlighted policy terms before saving.");
  const prior = objects(model, "Insurance").find(item => item.insurance_id === policyId);
  if (prior && (prior.policy_family !== "term_life_lump_sum" || prior.insurance_type !== "life")) throw new InsuranceAuthoringError("This policy type is not supported by the term-life editor. Import corrected policy terms.");
  if (prior?.death_event_id != null && prior.insured_person_id !== terms.insured) throw new InsuranceAuthoringError("Unlink the death scenario before changing the insured person.");
  const death = objects(model, "Event").find(item => item.event_id === prior?.death_event_id);
  if (death && (String(death.start_date) < terms.start || String(death.start_date) >= terms.end)) throw new InsuranceAuthoringError("The linked death scenario falls outside these coverage dates. Review the life event or unlink it before changing coverage.");
  const policy: JsonObject = { ...prior, insurance_id: policyId, owner_id: terms.owner, insured_person_id: terms.insured, beneficiary_id: terms.beneficiary,
    insurance_type: "life", policy_family: "term_life_lump_sum", premium_frequency: "monthly", premium: terms.premium, coverage_amount: terms.benefit,
    premium_account_id: terms.premiumAccount, benefit_account_id: terms.benefitAccount, start_date: terms.start, end_date: terms.end };
  return { ...model, objects: { ...model.objects, Insurance: [...objects(model, "Insurance").filter(item => item.insurance_id !== policyId), policy] } };
}
export interface DeathScenarioTerms { readonly eventId: string; readonly policyId: string; readonly scenarioId: string; readonly date: string; readonly enabled: boolean; }
/** Shared Life Events commit path, including contextual entry from Insurance. */
export function authorInsuredDeathScenario(model: PersonalDraft, terms: DeathScenarioTerms): PersonalDraft {
  const policy = objects(model, "Insurance").find(item => item.insurance_id === terms.policyId);
  const scenario = objects(model, "Scenario").find(item => item.scenario_id === terms.scenarioId && item.enabled === true && item.base_scenario_id == null);
  if (!UUID.test(terms.eventId) || !policy || !scenario || !utcDate(terms.date)) throw new InsuranceAuthoringError("Choose a saved policy, an enabled current plan and a valid scenario date.");
  if (terms.date < String(policy.start_date) || terms.date >= String(policy.end_date)) throw new InsuranceAuthoringError("Choose a death scenario date within the policy's coverage dates.");
  const prior = objects(model, "Event").find(item => item.event_id === terms.eventId);
  if (prior && (prior.event_type !== "death" || prior.trigger_type !== "scheduled" || prior.trigger_condition != null || prior.probability_model_id != null)) throw new InsuranceAuthoringError("This existing event cannot be edited as a scheduled death scenario. Preserve it and import a corrected scenario.");
  // Shared legacy triggers cannot silently change another policy's insured/date.
  const linked = objects(model, "Insurance").filter(item => item.death_event_id === terms.eventId);
  if (linked.some(item => item.insured_person_id !== policy.insured_person_id || terms.date < String(item.start_date) || terms.date >= String(item.end_date))) throw new InsuranceAuthoringError("This event is shared with another policy whose insured person or coverage dates conflict. Review those policies before changing it.");
  const event: JsonObject = { ...prior, event_id: terms.eventId, name: prior?.name ?? "Insured death scenario", event_type: "death", trigger_type: "scheduled", start_date: terms.date, scenario_id: terms.scenarioId, enabled: terms.enabled,
    effect_ids: prior?.effect_ids ?? [], dependencies: prior?.dependencies ?? [], precedence: prior?.precedence ?? 0 };
  return { ...model, objects: { ...model.objects,
    Event: [...objects(model, "Event").filter(item => item.event_id !== terms.eventId), event],
    Insurance: objects(model, "Insurance").map(item => item === policy ? { ...item, death_event_id: terms.eventId } : item),
    Scenario: objects(model, "Scenario").map(item => {
      const ids = Array.isArray(item.event_ids) ? item.event_ids : [];
      return item === scenario ? { ...item, event_ids: [...new Set([...ids, terms.eventId])] } : prior?.scenario_id === item.scenario_id ? { ...item, event_ids: ids.filter(id => id !== terms.eventId) } : item;
    }),
  } };
}
/** Removing a link never deletes a historical Event or its scenario lineage. */
export function unlinkPolicyDeathScenario(model: PersonalDraft, policyId: string): PersonalDraft {
  return { ...model, objects: { ...model.objects, Insurance: objects(model, "Insurance").map(item => {
    if (item.insurance_id !== policyId) return item;
    const { death_event_id: _link, ...policy } = item;
    return policy;
  }) } };
}
