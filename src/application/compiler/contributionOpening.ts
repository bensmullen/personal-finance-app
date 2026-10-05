import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import type { AuthoritativeState, ContributionState } from "../../state/index.js";
import type { ContributionPolicy, ContributionCharacter } from "../../simulation/contributions.js";
import { deriveD1ContributionCapacity, contributionCharacters, type D1CapacityKind } from "../../rules/contribution2026.js";
import { domainId } from "../../identity/index.js";
import { instant } from "../../time/index.js";
import { money, USD } from "../../values/index.js";
import { authoredContributionRules, compileContributionPolicy } from "./contributionAuthoring.js";
import { historicalContributionScopes, historicalAccountTypes } from "./contributionHistoryScopes.js";
import { durablePayrollAllocations } from "./payrollAuthoring.js";
import { durablePersonalPurchaseInstructions } from "./personalPurchases.js";
import { EXACT_DECIMAL, UUID, objects, utcDate, type CanonicalObject } from "./shared.js";
import { canonicalSerialize } from "../../simulation/run.js";

const ADAPTER = "d1-opening-contribution-usage/v1";
const SNAPSHOT_ID = "d1c60000-0000-4000-8000-000000000001";
const record = (value: JsonValue | undefined): value is CanonicalObject => typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(message); };
const exact = (value: JsonValue | undefined) => typeof value === "string" && EXACT_DECIMAL.test(value) && !money(value, USD).isNegative() && money(value, USD).amount.fitsScale(2) ? money(value, USD) : fail("OPENING_USAGE_AMOUNT_INVALID");
const identity = (policy: ContributionPolicy, kind: D1CapacityKind, key: string) => `${kind === "hsa_family" ? "household" : "person"}:${kind === "hsa_family" ? policy.householdId : policy.personId}:${key}:${policy.facts.taxYear}`;
const scopeConfirmation = (option: { investmentId: string; policy: ContributionPolicy }) => canonicalSerialize({ investmentId: option.investmentId, policy: option.policy });

/** Historical characters may differ from the allocation currently planned for this holding. */
export const openingContributionOptions = (model: PortableModelEnvelope) => {
  const plans = [...historicalContributionScopes(model), ...durablePayrollAllocations(model).map(item => ({ investmentId: String(item.allocation.positionId), policy: item.allocation.policy })), ...durablePersonalPurchaseInstructions(model).flatMap(item => item.contribution ? [{ investmentId: item.investmentId, policy: item.contribution }] : [])];
  const options = plans.flatMap(plan => {
    const investment = objects(model, "Investment").find(item => item.investment_id === plan.investmentId)!;
    const account = objects(model, "Account").find(item => item.account_id === investment.account_id)!;
    const characters: readonly ContributionCharacter[] = plan.policy.character.endsWith("_ira") ? [account.account_type === "roth_ira" ? "roth_ira" : "traditional_ira"] : plan.policy.character.endsWith("_hsa") ? ["employee_hsa", "employer_hsa"] : account.account_type === "roth_401k" ? ["roth_401k"] : ["traditional_401k", "after_tax_401k", "employer_401k"];
    return characters.map(character => {
      const kinds: D1CapacityKind[] = character.endsWith("_ira") ? ["ira_shared", ...(character === "roth_ira" ? ["roth_ira" as const] : [])] : character.endsWith("_hsa") ? ["hsa_individual", ...(plan.policy.facts.hsaCoverage === "family" ? ["hsa_family" as const] : [])] : ["401k_additions", ...(["traditional_401k", "roth_401k"].includes(character) ? ["401k_elective" as const] : [])];
      const planKey = plan.policy.limits.find(binding => binding.kind === "401k_additions")?.bucketKey.slice("401k_additions:".length);
      const rules = authoredContributionRules(plan.policy.personId, kinds, plan.policy.facts.taxYear, { ...(planKey === undefined ? {} : { planKey }), householdId: plan.policy.householdId });
      const limits = kinds.map(kind => {
        const key = kind === "401k_additions" ? `${kind}:${planKey}` : kind;
        const rule = rules.find(item => Array.isArray(item.contribution_limits) && record(item.contribution_limits[0]) && item.contribution_limits[0].kind === kind)!;
        return { kind, ruleId: String(rule.tax_rule_id), bucketKey: key, target: kind === "hsa_family" ? { targetType: "household" as const, targetId: domainId("household", plan.policy.householdId) } : { targetType: "person" as const, targetId: domainId("person", plan.policy.personId) }, includedCharacters: contributionCharacters(kind) };
      });
      const policy: ContributionPolicy = { ...plan.policy, character, limits, excessPolicy: "reject" };
      return { investmentId: plan.investmentId, accountId: String(account.account_id), character, policy, rules };
    });
  });
  const unique = new Map<string, typeof options[number]>();
  for (const option of options) {
    const key = `${option.investmentId}:${option.character}:${option.policy.facts.taxYear}`;
    const previous = unique.get(key);
    if (previous && canonicalSerialize(previous.policy) !== canonicalSerialize(option.policy)) return fail("HISTORICAL_SCOPE_CONFLICT");
    unique.set(key, option);
  }
  return [...unique.values()];
};

export const unrepresentedHistoricalAccounts = (model: PortableModelEnvelope, year: number) => {
  const options = openingContributionOptions(model).filter(option => option.policy.facts.taxYear === year);
  return objects(model, "Account").filter(account => {
    if (!historicalAccountTypes.includes(String(account.account_type))) return false;
    const holdings = objects(model, "Investment").filter(row => row.account_id === account.account_id);
    return !holdings.length || holdings.some(row => !options.some(option => option.investmentId === row.investment_id));
  });
};
const requireRepresentableHistory = (model: PortableModelEnvelope, year: number) => {
  const missing = unrepresentedHistoricalAccounts(model, year);
  if (missing.length) return fail(`OPENING_USAGE_SCOPE_REQUIRED: Define historical legal scope and annual facts for ${missing.map(account => String(account.account_id)).join(", ")} before confirming all prior usage.`);
  for (const option of openingContributionOptions(model).filter(row => row.policy.facts.taxYear === year)) {
    for (const binding of option.policy.limits) {
      const capacity = deriveD1ContributionCapacity(binding.kind, option.policy.facts);
      if (capacity.status !== "complete") return fail(`OPENING_USAGE_SCOPE_INCOMPLETE: ${capacity.diagnostics.join(", ")}`);
    }
  }
};

export interface OpeningContributionUsageEntry {
  readonly id: string;
  readonly investmentId: string;
  readonly character: ContributionCharacter;
  readonly amount: string;
  /** Amount inside annual additions / ordinary HSA family capacity, excluding catch-up. */
  readonly ordinaryAmount?: string;
}
export interface OpeningContributionUsagePlan {
  readonly asOf: string;
  readonly entries: readonly OpeningContributionUsageEntry[];
  /** Explicit confirmation includes zero usage for every omitted category/path in each covered scope. */
  readonly allPriorUsageKnown: true;
}
const snapshot = (model: PortableModelEnvelope) => {
  const snapshots = objects(model, "PrimitiveInstance").filter(item => record(item.parameters) && item.parameters.adapter === ADAPTER);
  if (snapshots.length > 1) return fail("OPENING_USAGE_SNAPSHOT_AMBIGUOUS");
  return snapshots[0];
};
export const savedOpeningContributionUsage = (model: PortableModelEnvelope): OpeningContributionUsagePlan | undefined => {
  const item = snapshot(model), params = item?.parameters;
  if (!record(params)) return undefined;
  if (typeof params.asOf !== "string" || !utcDate(params.asOf) || params.allPriorUsageKnown !== true || !Array.isArray(params.entries)) return fail("OPENING_USAGE_SNAPSHOT_INVALID");
  return { asOf: params.asOf, allPriorUsageKnown: true, entries: params.entries.map(entry => {
    if (!record(entry) || typeof entry.id !== "string" || typeof entry.investmentId !== "string" || typeof entry.amount !== "string" || !record(entry.contribution)) return fail("OPENING_USAGE_ENTRY_INVALID");
    const character = entry.contribution.character;
    if (character !== "traditional_ira" && character !== "roth_ira" && character !== "traditional_401k" && character !== "roth_401k" && character !== "after_tax_401k" && character !== "employer_401k" && character !== "employee_hsa" && character !== "employer_hsa") return fail("OPENING_USAGE_CHARACTER_INVALID");
    return { id: entry.id, investmentId: entry.investmentId, character, amount: entry.amount, ...(typeof entry.ordinaryAmount === "string" ? { ordinaryAmount: entry.ordinaryAmount } : {}) };
  }) };
};

/** Opening usage only seeds capacity history; it never posts economics or reconstructs balances. */
export const compileOpeningContributionUsage = (model: PortableModelEnvelope, start: string): { contributions: Record<string, ContributionState>; accounts: AuthoritativeState["accounts"] } => {
  if (!utcDate(start)) return fail("OPENING_USAGE_BOUNDARY_INVALID");
  const year = Number(start.slice(0, 4)), options = openingContributionOptions(model).filter(option => option.policy.facts.taxYear === year);
  const contributions: Record<string, ContributionState> = {}, accounts: AuthoritativeState["accounts"] = {};
  if (!options.length && !snapshot(model)) return { contributions, accounts };
  const item = snapshot(model), params = item?.parameters;
  const required = [...new Set(options.flatMap(option => option.policy.limits.map(binding => identity(option.policy, binding.kind, binding.bucketKey))))].sort();
  const missingFacts = [...new Set(options.flatMap(option => {
    const person = objects(model, "Person").find(row => row.person_id === option.policy.personId);
    const name = [person?.first_name, person?.last_name].filter(value => typeof value === "string").join(" ") || "contributor";
    return option.policy.limits.map(binding => `${binding.kind.replaceAll("_", " ")} usage for ${binding.kind === "hsa_family" ? "the household" : name}${binding.kind === "401k_additions" ? ` (${binding.bucketKey.slice("401k_additions:".length)})` : ""}`);
  }))];
  if (!item) {
    if (start === `${year}-01-01`) return { contributions, accounts };
    return fail(`OPENING_CONTRIBUTION_USAGE_REQUIRED: Confirm prior ${year} YTD usage before ${start}: ${missingFacts.join(", ")}; unknown usage cannot be treated as zero.`);
  }
  const saved = savedOpeningContributionUsage(model)!;
  const root = objects(model, "Scenario").filter(row => row.enabled === true && row.base_scenario_id == null);
  if (!record(params) || item.enabled !== true || item.primitive_id !== "P03" || root.length !== 1 || item.scenario_id !== root[0]!.scenario_id || item.start_date != null || item.end_date != null || !record(item.input_bindings) || Object.keys(item.input_bindings).length || !Array.isArray(params.confirmedBuckets)) return fail("OPENING_USAGE_SNAPSHOT_INVALID");
  if (saved.asOf.slice(0, 4) !== start.slice(0, 4)) {
    if (start === `${year}-01-01`) return { contributions, accounts };
    return fail(`OPENING_CONTRIBUTION_USAGE_REQUIRED: Supply ${year} prior YTD history.`);
  }
  requireRepresentableHistory(model, year);
  const confirmedBuckets = params.confirmedBuckets;
  if (saved.asOf !== start || required.some(key => !confirmedBuckets.includes(key))) return fail(`OPENING_CONTRIBUTION_USAGE_REQUIRED: Confirm complete prior YTD usage at forecast boundary ${start} for all current scopes.`);
  if (params.confirmedScopes !== undefined ? !Array.isArray(params.confirmedScopes) || options.some(option => !Array.isArray(params.confirmedScopes) || !params.confirmedScopes.includes(scopeConfirmation(option))) : historicalContributionScopes(model).length > 0) return fail("OPENING_CONTRIBUTION_USAGE_REQUIRED: Reconfirm prior history after adding or changing historical scopes.");
  const at = instant(new Date(Date.parse(`${start}T00:00:00.000Z`) - 1).toISOString());
  const entries = params.entries;
  if (!Array.isArray(entries)) return fail("OPENING_USAGE_ENTRIES_INVALID");
  const paths = new Set<string>();
  for (const value of entries) {
    if (!record(value) || typeof value.id !== "string" || !UUID.test(value.id) || typeof value.investmentId !== "string") return fail("OPENING_USAGE_ENTRY_INVALID");
    const investment = objects(model, "Investment").find(row => row.investment_id === value.investmentId);
    const account = objects(model, "Account").find(row => row.account_id === investment?.account_id);
    if (!account || !investment || account.currency !== "USD") return fail("OPENING_USAGE_ACCOUNT_REQUIRED");
    if (!record(value.contribution)) return fail("OPENING_USAGE_ENTRY_INVALID");
    const character = value.contribution.character;
    const option = options.find(row => row.investmentId === value.investmentId && row.character === character);
    if (!option) return fail("OPENING_USAGE_CHARACTER_INVALID");
    const policy = compileContributionPolicy({ ...model, objects: { ...model.objects, TaxRule: option.rules } }, { ...account, contribution_limit_rule_id: null, contribution_limit_rule_ids: option.rules.map(rule => String(rule.tax_rule_id)) }, value.contribution);
    if (canonicalSerialize(policy) !== canonicalSerialize(option.policy)) return fail("OPENING_USAGE_SCOPE_CHANGED");
    if (policy.facts.taxYear !== year || !options.some(option => option.investmentId === value.investmentId && option.character === policy.character)) return fail("OPENING_USAGE_CHARACTER_INVALID");
    const amount = exact(value.amount), split = policy.character === "traditional_401k" || policy.character === "roth_401k" || policy.character.endsWith("_hsa") && policy.facts.hsaCoverage === "family";
    const ordinary = split ? exact(value.ordinaryAmount) : amount;
    if (ordinary.compare(amount) > 0 || start === `${year}-01-01` && amount.isPositive()) return fail("OPENING_USAGE_SPLIT_INVALID");
    const catchupKind = policy.character.includes("401k") ? "401k_elective" : "hsa_individual";
    if (split) {
      const capacity = deriveD1ContributionCapacity(catchupKind, policy.facts);
      if (capacity.status !== "complete") return fail(capacity.diagnostics.join(", "));
      if (amount.minus(ordinary).compare(capacity.catchupCapacity) > 0 || policy.character === "traditional_401k" && capacity.rothCatchupRequired && amount.compare(ordinary) > 0) return fail("OPENING_USAGE_CATCHUP_INVALID");
    }
    const id = `opening:${value.id}`;
    if (contributions[id]) return fail("OPENING_USAGE_DUPLICATE_IDENTITY");
    const path = `${value.investmentId}:${policy.character}`;
    if (paths.has(path)) return fail("OPENING_USAGE_DUPLICATE_PATH: Enter one aggregate prior-YTD total for each holding and contribution character.");
    paths.add(path);
    contributions[id] = { source: "opening", id, at, personId: policy.personId, accountId: String(account.account_id), character: policy.character, amount,
      buckets: policy.limits.filter(binding => binding.includedCharacters.includes(policy.character)).map(binding => {
        const capacity = deriveD1ContributionCapacity(binding.kind, policy.facts);
        if (capacity.status !== "complete") return fail(capacity.diagnostics.join(", "));
        return { identity: identity(policy, binding.kind, binding.bucketKey), amount: binding.kind === "401k_additions" || binding.kind === "hsa_family" ? ordinary : amount, annualLimit: capacity.capacity, ruleIds: [binding.ruleId], facts: { kind: binding.kind } };
      }) };
    const accountId = domainId("account", String(account.account_id));
    accounts[accountId] = { id: accountId, ownerId: domainId("person", String(account.owner_id)), kind: policy.character.endsWith("_hsa") ? "other" : "retirement", cash: exact(account.opening_balance) };
  }
  return { contributions, accounts };
};

export const authorOpeningContributionUsage = (model: PortableModelEnvelope, plan: OpeningContributionUsagePlan): PortableModelEnvelope => {
  if (!utcDate(plan.asOf) || plan.allPriorUsageKnown !== true) return fail("OPENING_USAGE_CONFIRMATION_REQUIRED");
  const year = Number(plan.asOf.slice(0, 4)), options = openingContributionOptions(model).filter(option => option.policy.facts.taxYear === year);
  requireRepresentableHistory(model, year);
  const prior = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === SNAPSHOT_ID);
  if (prior && (!record(prior.parameters) || prior.parameters.adapter !== ADAPTER)) return fail("OPENING_USAGE_ID_COLLISION");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1) return fail("OPENING_USAGE_ROOT_REQUIRED");
  const rules = [...new Map(options.flatMap(option => option.rules).map(rule => [String(rule.tax_rule_id), rule])).values()];
  for (const rule of rules) {
    const existing = objects(model, "TaxRule").find(item => item.tax_rule_id === rule.tax_rule_id);
    if (existing && canonicalSerialize(existing) !== canonicalSerialize(rule)) return fail("CONTRIBUTION_RULE_ID_COLLISION");
  }
  const entries = plan.entries.map(entry => {
    const option = options.find(item => item.investmentId === entry.investmentId && item.character === entry.character);
    if (!option) return fail("OPENING_USAGE_PATH_REQUIRED");
    const facts: CanonicalObject = Object.fromEntries(Object.entries(option.policy.facts).map(([key, value]) => [key, typeof value === "object" ? value.amount.toString() : value]));
    return { id: entry.id, investmentId: entry.investmentId, amount: entry.amount, ...(entry.ordinaryAmount === undefined ? {} : { ordinaryAmount: entry.ordinaryAmount }), contribution: { character: entry.character, personId: option.policy.personId, householdId: option.policy.householdId, facts, excessPolicy: "reject" } };
  });
  const confirmedBuckets = [...new Set(options.flatMap(option => option.policy.limits.map(binding => identity(option.policy, binding.kind, binding.bucketKey))))].sort();
  const confirmedScopes = options.map(scopeConfirmation).sort();
  const next: PortableModelEnvelope = { ...model, objects: { ...model.objects,
    TaxRule: [...objects(model, "TaxRule").filter(item => !rules.some(rule => rule.tax_rule_id === item.tax_rule_id)), ...rules],
    PrimitiveInstance: [...objects(model, "PrimitiveInstance").filter(item => item.primitive_instance_id !== SNAPSHOT_ID), { primitive_instance_id: SNAPSHOT_ID, primitive_id: "P03", scenario_id: roots[0]!.scenario_id!, enabled: true, input_bindings: {}, parameters: { adapter: ADAPTER, asOf: plan.asOf, allPriorUsageKnown: true, confirmedBuckets, confirmedScopes, entries } }],
  } };
  compileOpeningContributionUsage(next, plan.asOf);
  return next;
};
