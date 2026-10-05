import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { domainId } from "../../identity/index.js";
import { money, Quantity, SHARE, USD, decimal } from "../../values/index.js";
import type { AuthoritativeState } from "../../state/index.js";
import type { PayrollContributionAllocation } from "../../simulation/payrollContributions.js";
import { canonicalSerialize } from "../../simulation/run.js";
import { authoredContributionRules, compileContributionPolicy, type AuthoredContributionFacts } from "./contributionAuthoring.js";
import { normalizeContributionLimitRuleIds } from "./contributionBindings.js";
import { objects, canonicalId, UUID, EXACT_DECIMAL, type CanonicalObject } from "./shared.js";

export const PAYROLL_ADAPTER = "d1-payroll-contribution/v1";
const record = (value: JsonValue | undefined): value is CanonicalObject => typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(message); };
const rate = (value: JsonValue | undefined): string => {
  if (typeof value !== "string" || !EXACT_DECIMAL.test(value) || decimal(value).isNegative() || decimal(value).compare(decimal("1")) > 0) return fail("PAYROLL_RATE_INVALID");
  return value;
};
const fixed = (value: JsonValue | undefined) => {
  if (typeof value !== "string" || !EXACT_DECIMAL.test(value) || money(value).isNegative() || !money(value).amount.fitsScale(2)) return fail("PAYROLL_FIXED_AMOUNT_INVALID");
  return money(value);
};
export interface DurablePayrollAllocation { readonly incomeId: string; readonly allocation: PayrollContributionAllocation }
export const supportsD1SpouseHsaScope = (model: PortableModelEnvelope, members: readonly string[]): boolean => {
  if (members.length !== 2) return false;
  const plans = durablePayrollAllocations(model);
  return members.every(member => plans.some(item => item.allocation.policy.personId === member && item.allocation.policy.character.endsWith("_hsa") && item.allocation.policy.facts.hsaCoverage === "family" && item.allocation.policy.facts.hsaFullYearEligible === true));
};

/** A linked P03 adapter allocates actual gross payroll occurrences; it creates no independent cash schedule. */
export const durablePayrollAllocations = (model: PortableModelEnvelope): readonly DurablePayrollAllocation[] => objects(model, "Investment").flatMap(investment => {
  const primitive = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === investment.contribution_model_id);
  if (!primitive || !record(primitive.parameters) || primitive.parameters.adapter !== PAYROLL_ADAPTER) return [];
  if (primitive.primitive_id !== "P03" || primitive.enabled !== true || primitive.start_date != null || primitive.end_date != null || !record(primitive.input_bindings)) return fail("PAYROLL_PRIMITIVE_UNSUPPORTED");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1 || primitive.scenario_id !== roots[0]!.scenario_id || investment.scenario_id != null && investment.scenario_id !== primitive.scenario_id) return fail("PAYROLL_ROOT_SCENARIO_REQUIRED");
  if (Object.keys(primitive.parameters).some(key => !["adapter", "priority", "contribution", "calculation", "vestedFraction"].includes(key)) || Object.keys(primitive.input_bindings).some(key => key !== "income_id")) return fail("PAYROLL_POLICY_FIELDS_UNSUPPORTED");
  const incomeId = primitive.input_bindings.income_id;
  const income = objects(model, "Income").find(item => item.income_id === incomeId);
  const account = objects(model, "Account").find(item => item.account_id === investment.account_id);
  if (typeof incomeId !== "string" || !UUID.test(incomeId) || !income || income.income_type !== "salary" || income.gross_or_net === "net" || !account || account.currency !== "USD" || income.owner_id !== account.owner_id || investment.owner_id !== account.owner_id) return fail("PAYROLL_GROSS_SALARY_OWNER_REQUIRED");
  const policy = compileContributionPolicy(model, account, primitive.parameters.contribution);
  const hsa = policy.character.endsWith("_hsa");
  if (hsa ? !["hsa", "hsa_investment"].includes(String(account.account_type)) || account.tax_treatment !== "tax_free" : !["traditional_401k", "roth_401k"].includes(String(account.account_type))) return fail("PAYROLL_DESTINATION_CHARACTER_UNSUPPORTED");
  if (!hsa && (policy.character === "traditional_401k" || policy.character === "after_tax_401k" || policy.character === "employer_401k") && account.account_type !== "traditional_401k" || policy.character === "roth_401k" && account.account_type !== "roth_401k") return fail("PAYROLL_DESTINATION_CHARACTER_MISMATCH");
  const calculation = primitive.parameters.calculation;
  if (!record(calculation)) return fail("PAYROLL_CALCULATION_REQUIRED");
  const parsed: PayrollContributionAllocation["calculation"] = calculation.kind === "fixed" ? { kind: "fixed", amount: fixed(calculation.amount) }
    : calculation.kind === "percent" ? { kind: "percent", rate: rate(calculation.rate) }
      : calculation.kind === "match" ? { kind: "match", rate: rate(calculation.rate), compensationCapRate: rate(calculation.compensationCapRate) } : fail("PAYROLL_CALCULATION_UNSUPPORTED");
  const priority = primitive.parameters.priority, fraction = rate(primitive.parameters.vestedFraction);
  if (typeof priority !== "number" || !Number.isSafeInteger(priority) || priority < 0) return fail("PAYROLL_PRIORITY_REQUIRED");
  const employer = policy.character.startsWith("employer_");
  if (!employer && fraction !== "1" || policy.character === "employer_hsa" && fraction !== "1" || !employer && parsed.kind === "match") return fail("PAYROLL_VESTING_OR_MATCH_UNSUPPORTED");
  if (investment.investment_type !== "equity" && investment.investment_type !== "fund" || typeof investment.price !== "string" || !EXACT_DECIMAL.test(investment.price) || !money(investment.price).isPositive()) return fail("PAYROLL_EXECUTABLE_POSITION_REQUIRED");
  return [{ incomeId, allocation: { id: String(primitive.primitive_instance_id), priority, accountId: domainId("account", String(account.account_id)), positionId: domainId("position", String(investment.investment_id)), policy, calculation: parsed, vestedFraction: fraction } }];
});

export const payrollOpeningBalances = (model: PortableModelEnvelope, allocations: readonly DurablePayrollAllocation[]) => {
  const accounts: AuthoritativeState["accounts"] = {}, positions: AuthoritativeState["positions"] = {};
  for (const { allocation } of allocations) {
    const account = objects(model, "Account").find(item => item.account_id === allocation.accountId)!;
    const investment = objects(model, "Investment").find(item => item.investment_id === allocation.positionId)!;
    if (typeof account.opening_balance !== "string" || !EXACT_DECIMAL.test(account.opening_balance) || typeof investment.quantity !== "string" || !EXACT_DECIMAL.test(investment.quantity)) return fail("PAYROLL_OPENING_BALANCE_INVALID");
    const price = money(String(investment.price), USD), quantity = Quantity.parse(investment.quantity, SHARE), value = price.times(quantity.amount);
    if (investment.market_value != null && !fixed(investment.market_value).equals(value)) return fail("PAYROLL_MARKET_VALUE_INCONSISTENT");
    accounts[allocation.accountId] = { id: allocation.accountId, ownerId: domainId("person", String(account.owner_id)), kind: allocation.policy.character.endsWith("_hsa") ? "other" : "retirement", cash: money(account.opening_balance, USD) };
    positions[allocation.positionId] = { id: allocation.positionId, accountId: allocation.accountId, quantity, price, carryingValue: value };
  }
  return { accounts, positions };
};

export interface PayrollContributionPlan {
  readonly primitiveId: string; readonly investmentId: string; readonly incomeId: string; readonly priority: number;
  readonly character: "traditional_401k" | "roth_401k" | "after_tax_401k" | "employee_hsa" | "employer_401k" | "employer_hsa";
  readonly calculation: { readonly kind: "fixed"; readonly amount: string } | { readonly kind: "percent"; readonly rate: string } | { readonly kind: "match"; readonly rate: string; readonly compensationCapRate: string };
  readonly facts: AuthoredContributionFacts; readonly planKey?: string; readonly vestedFraction: string; readonly excessPolicy: "reject" | "auto_cap";
}
export const authorPayrollContributionPlan = (model: PortableModelEnvelope, plan: PayrollContributionPlan): PortableModelEnvelope => {
  if (!UUID.test(plan.primitiveId)) return fail("PAYROLL_POLICY_ID_INVALID");
  const investment = objects(model, "Investment").find(item => canonicalId(item, "investment_id") === plan.investmentId.toLowerCase());
  const account = objects(model, "Account").find(item => item.account_id === investment?.account_id);
  const person = objects(model, "Person").find(item => item.person_id === account?.owner_id);
  if (!investment || !account || !person) return fail("PAYROLL_DESTINATION_REQUIRED");
  if (investment.contribution_model_id != null && investment.contribution_model_id !== plan.primitiveId.toLowerCase()) return fail("PAYROLL_EXISTING_POLICY_REQUIRES_SAME_ID");
  const prior = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === plan.primitiveId.toLowerCase());
  if (prior && (!record(prior.parameters) || prior.parameters.adapter !== PAYROLL_ADAPTER || investment.contribution_model_id !== prior.primitive_instance_id)) return fail("PAYROLL_POLICY_ID_COLLISION");
  const hsa = plan.character.endsWith("_hsa");
  const rules = authoredContributionRules(String(person.person_id), hsa ? ["hsa_individual", ...(plan.facts.hsaCoverage === "family" ? ["hsa_family" as const] : [])] : ["401k_additions", ...(["traditional_401k", "roth_401k"].includes(plan.character) ? ["401k_elective" as const] : [])], plan.facts.taxYear, { ...(plan.planKey === undefined ? {} : { planKey: plan.planKey }), householdId: String(person.household_id) });
  for (const rule of rules) {
    const existing = objects(model, "TaxRule").find(item => item.tax_rule_id === rule.tax_rule_id);
    if (existing && canonicalSerialize(existing) !== canonicalSerialize(rule)) return fail("CONTRIBUTION_RULE_ID_COLLISION");
  }
  const facts: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(plan.facts)) if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") facts[key] = value;
  const root = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (root.length !== 1) return fail("PAYROLL_ROOT_SCENARIO_REQUIRED");
  const primitive: CanonicalObject = { primitive_instance_id: plan.primitiveId.toLowerCase(), primitive_id: "P03", enabled: true, scenario_id: String(root[0]!.scenario_id), input_bindings: { income_id: plan.incomeId },
    parameters: { adapter: PAYROLL_ADAPTER, priority: plan.priority, calculation: { ...plan.calculation }, vestedFraction: plan.vestedFraction, contribution: { character: plan.character, personId: String(person.person_id), householdId: String(person.household_id), facts, excessPolicy: plan.excessPolicy } } };
  const next = { ...model, objects: { ...model.objects,
    Investment: objects(model, "Investment").map(item => item === investment ? { ...item, contribution_model_id: plan.primitiveId.toLowerCase() } : item),
    Account: objects(model, "Account").map(item => item === account ? { ...item, contribution_limit_rule_id: null, contribution_limit_rule_ids: [...new Set([...normalizeContributionLimitRuleIds(item), ...rules.map(rule => String(rule.tax_rule_id))]) ] } : item),
    TaxRule: [...objects(model, "TaxRule").filter(item => !rules.some(rule => rule.tax_rule_id === item.tax_rule_id)), ...rules],
    PrimitiveInstance: [...objects(model, "PrimitiveInstance").filter(item => item.primitive_instance_id !== plan.primitiveId.toLowerCase()), primitive],
  } };
  durablePayrollAllocations(next);
  return next;
};
