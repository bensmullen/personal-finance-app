import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { authoredContributionRules, compileContributionPolicy, type AuthoredContributionFacts } from "./contributionAuthoring.js";
import { objects, UUID, type CanonicalObject } from "./shared.js";

const ADAPTER = "d1-historical-contribution-scope/v1";
const record = (value: JsonValue | undefined): value is CanonicalObject => typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (code: string): never => { throw new Error(code); };
export const historicalAccountTypes = ["traditional_401k", "roth_401k", "traditional_ira", "roth_ira", "hsa", "hsa_investment"];

/** Legal-scope facts, never linked to a future contribution schedule. */
export const historicalContributionScopes = (model: PortableModelEnvelope) => {
 const scopes = objects(model, "PrimitiveInstance").flatMap(item => {
  if (!record(item.parameters) || item.parameters.adapter !== ADAPTER) return [];
  const params = item.parameters;
  const roots = objects(model, "Scenario").filter(row => row.enabled === true && row.base_scenario_id == null);
  if (item.primitive_id !== "P03" || item.enabled !== true || roots.length !== 1 || item.scenario_id !== roots[0]!.scenario_id || item.start_date != null || item.end_date != null || !record(item.input_bindings) || Object.keys(item.input_bindings).length || typeof params.investmentId !== "string") return fail("HISTORICAL_SCOPE_INVALID");
  const investment = objects(model, "Investment").find(row => row.investment_id === params.investmentId);
  const account = objects(model, "Account").find(row => row.account_id === investment?.account_id);
  const person = objects(model, "Person").find(row => row.person_id === account?.owner_id);
  if (!investment || !account || !person || investment.owner_id !== person.person_id || account.currency !== "USD" || !historicalAccountTypes.includes(String(account.account_type)) || !record(params.facts) || typeof params.facts.taxYear !== "number") return fail("HISTORICAL_SCOPE_ACCOUNT_REQUIRED");
  const hsa = String(account.account_type).startsWith("hsa"), ira = String(account.account_type).endsWith("_ira");
  const character = hsa ? "employee_hsa" : ira ? account.account_type === "roth_ira" ? "roth_ira" : "traditional_ira" : account.account_type === "roth_401k" ? "roth_401k" : "traditional_401k";
  const planKey = typeof params.planKey === "string" ? params.planKey : undefined;
  const rules = authoredContributionRules(String(person.person_id), hsa ? ["hsa_individual", ...(params.facts.hsaCoverage === "family" ? ["hsa_family" as const] : [])] : ira ? ["ira_shared", ...(character === "roth_ira" ? ["roth_ira" as const] : [])] : ["401k_additions", "401k_elective"], params.facts.taxYear, { ...(planKey === undefined ? {} : { planKey }), householdId: String(person.household_id) });
  const policy = compileContributionPolicy({ ...model, objects: { ...model.objects, TaxRule: rules } }, { ...account, contribution_limit_rule_id: null, contribution_limit_rule_ids: rules.map(rule => String(rule.tax_rule_id)) }, { character, personId: String(person.person_id), householdId: String(person.household_id), facts: params.facts, excessPolicy: "reject" });
  return [{ id: String(item.primitive_instance_id), investmentId: params.investmentId, policy }];
});
 if (new Set(scopes.map(row => `${row.investmentId}:${row.policy.facts.taxYear}`)).size !== scopes.length) return fail("HISTORICAL_SCOPE_AMBIGUOUS");
 return scopes;
};

export interface HistoricalContributionScope {
  readonly id: string;
  readonly investmentId: string;
  readonly planKey?: string;
  readonly facts: AuthoredContributionFacts;
}
export const authorHistoricalContributionScope = (model: PortableModelEnvelope, scope: HistoricalContributionScope): PortableModelEnvelope => {
  if (!UUID.test(scope.id)) return fail("HISTORICAL_SCOPE_ID_INVALID");
  const prior = objects(model, "PrimitiveInstance").find(row => row.primitive_instance_id === scope.id);
  if (prior && (!record(prior.parameters) || prior.parameters.adapter !== ADAPTER || prior.parameters.investmentId !== scope.investmentId)) return fail("HISTORICAL_SCOPE_ID_COLLISION");
  const roots = objects(model, "Scenario").filter(row => row.enabled === true && row.base_scenario_id == null);
  if (roots.length !== 1) return fail("HISTORICAL_SCOPE_ROOT_REQUIRED");
  const facts: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(scope.facts)) if (value !== undefined) facts[key] = value;
  const next = { ...model, objects: { ...model.objects, PrimitiveInstance: [...objects(model, "PrimitiveInstance").filter(row => row.primitive_instance_id !== scope.id), { primitive_instance_id: scope.id, primitive_id: "P03", enabled: true, scenario_id: roots[0]!.scenario_id!, input_bindings: {}, parameters: { adapter: ADAPTER, investmentId: scope.investmentId, facts, ...(scope.planKey === undefined ? {} : { planKey: scope.planKey }) } }] } };
  historicalContributionScopes(next);
  return next;
};
