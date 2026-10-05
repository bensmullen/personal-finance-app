import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import type { InvestmentPurchaseExecutionInstruction } from "./investments.js";
import { UUID, EXACT_DECIMAL, canonicalId, objects, utcDate, preflightCanonicalCollections } from "./shared.js";
import { money, Currency } from "../../values/index.js";
import { authoredContributionRules, compileContributionPolicy, parseContributionFacts, type AuthoredContributionFacts } from "./contributionAuthoring.js";
import { canonicalSerialize } from "../../simulation/run.js";
import { normalizeContributionLimitRuleIds } from "./contributionBindings.js";
import { PAYROLL_ADAPTER, durablePayrollAllocations } from "./payrollAuthoring.js";

const record = (value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
const VERSION = "d1-personal-purchase/v1";
export const personalPurchaseInstructionId = (id: string): string => {
  let hash = 14695981039346656037n;
  for (const character of id.toLowerCase()) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
  return `d1c10000-0000-4000-8000-${(hash & 0xffffffffffffn).toString(16).padStart(12, "0")}`;
};

/** P03 owns recurrence; the linked adapter supplies the explicit VS3 funding policy. */
export const durablePersonalPurchaseInstructions = (model: PortableModelEnvelope): readonly InvestmentPurchaseExecutionInstruction[] => Object.freeze(objects(model, "Investment").flatMap(investment => {
  if (investment.contribution_model_id == null) return [];
  const primitive = objects(model, "PrimitiveInstance").find(item => canonicalId(item, "primitive_instance_id") === String(investment.contribution_model_id).toLowerCase());
  if (primitive && record(primitive.parameters) && primitive.parameters.adapter === PAYROLL_ADAPTER) { durablePayrollAllocations(model); return []; }
  if (!primitive || primitive.primitive_id !== "P03" || primitive.enabled !== true || !record(primitive.parameters) || primitive.parameters.adapter !== VERSION || !record(primitive.input_bindings)) throw new Error("INVESTMENT_CONTRIBUTION_MODEL_UNSUPPORTED");
  if (primitive.start_date != null || primitive.end_date != null) throw new Error("PERSONAL_PURCHASE_PRIMITIVE_DATES_UNSUPPORTED");
  if (Object.keys(primitive.parameters).some(key => !["adapter", "order", "schedule", "contribution"].includes(key)) || Object.keys(primitive.input_bindings).some(key => !["source_cash_account_id", "amount"].includes(key))) throw new Error("PERSONAL_PURCHASE_POLICY_FIELDS_UNSUPPORTED");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1 || String(primitive.scenario_id).toLowerCase() !== canonicalId(roots[0]!, "scenario_id")) throw new Error("PERSONAL_PURCHASE_ROOT_REQUIRED");
  const source = primitive.input_bindings.source_cash_account_id;
  const amount = primitive.input_bindings.amount;
  const order = primitive.parameters.order;
  const schedule = primitive.parameters.schedule;
  if (typeof source !== "string" || !UUID.test(source) || typeof amount !== "string" || !EXACT_DECIMAL.test(amount) || typeof order !== "number" || !Number.isSafeInteger(order) || order < 0 || !record(schedule)) throw new Error("PERSONAL_PURCHASE_POLICY_INVALID");
  const account = objects(model, "Account").find(item => canonicalId(item, "account_id") === source.toLowerCase());
  const destination = objects(model, "Account").find(item => canonicalId(item, "account_id") === String(investment.account_id).toLowerCase());
  if (!account || !["checking", "savings"].includes(String(account.account_type))) throw new Error("PERSONAL_PURCHASE_CHECKING_OR_SAVINGS_REQUIRED");
  if (!destination || !["taxable_brokerage", "traditional_ira", "roth_ira"].includes(String(destination.account_type))) throw new Error("PERSONAL_PURCHASE_DESTINATION_CHARACTER_UNSUPPORTED");
  if (account.currency !== destination.currency) throw new Error("PERSONAL_PURCHASE_CURRENCY_MISMATCH");
  const ira = destination.account_type === "traditional_ira" || destination.account_type === "roth_ira";
  const contribution = ira ? compileContributionPolicy(model, destination, primitive.parameters.contribution) : undefined;
  if (ira && (destination.currency !== "USD" || contribution?.character !== destination.account_type || destination.tax_treatment !== (destination.account_type === "traditional_ira" ? "tax_deferred" : "tax_free"))) throw new Error("PERSONAL_PURCHASE_DESTINATION_CHARACTER_UNSUPPORTED");
  if (!ira && (destination.tax_treatment !== "taxable" || primitive.parameters.contribution != null)) throw new Error("PERSONAL_PURCHASE_DESTINATION_CHARACTER_UNSUPPORTED");
  if (primitive.scenario_id !== investment.scenario_id && investment.scenario_id != null) throw new Error("PERSONAL_PURCHASE_SCENARIO_MISMATCH");
  let executionSchedule: InvestmentPurchaseExecutionInstruction["schedule"];
  if (schedule.kind === "utc_monthly" && typeof schedule.anchor === "string" && utcDate(schedule.anchor) && schedule.invalidDayPolicy === "skip") executionSchedule = { kind: "utc_monthly", anchor: schedule.anchor, invalidDayPolicy: "skip" };
  else if (schedule.kind === "explicit_dates" && Array.isArray(schedule.dates) && schedule.dates.length === 1 && typeof schedule.dates[0] === "string" && utcDate(schedule.dates[0])) executionSchedule = { kind: "explicit_dates", dates: [schedule.dates[0]] };
  else throw new Error("PERSONAL_PURCHASE_SCHEDULE_UNSUPPORTED");
  const instruction: InvestmentPurchaseExecutionInstruction = { id: personalPurchaseInstructionId(String(primitive.primitive_instance_id)), investmentId: String(investment.investment_id), sourceCashAccountId: source.toLowerCase(), amount, order, schedule: executionSchedule, quantityRounding: { scale: 12, mode: "half_even" }, ...(contribution === undefined ? {} : { contribution }) };
  return [instruction];
}));

export interface PersonalPurchasePlan {
  readonly primitiveId: string;
  readonly investmentId: string;
  readonly sourceCashAccountId: string;
  readonly amount: string;
  readonly date: string;
  readonly frequency: "once" | "monthly";
  readonly order: number;
  readonly contributionFacts?: AuthoredContributionFacts;
  readonly excessPolicy?: "reject" | "auto_cap";
}

export const authorPersonalPurchasePlan = (model: PortableModelEnvelope, plan: PersonalPurchasePlan): PortableModelEnvelope => {
  const preflight = preflightCanonicalCollections(model, ["Investment", "Account", "PrimitiveInstance", "Scenario"]);
  if (preflight.status !== "compiled") throw new Error(preflight.diagnostics.map(item => item.code).join(","));
  if (!UUID.test(plan.primitiveId) || !utcDate(plan.date) || !["once", "monthly"].includes(plan.frequency)) throw new Error("PERSONAL_PURCHASE_POLICY_INVALID");
  const investment = objects(model, "Investment").find(item => canonicalId(item, "investment_id") === plan.investmentId.toLowerCase());
  if (!investment) throw new Error("PERSONAL_PURCHASE_INVESTMENT_REQUIRED");
  const account = objects(model, "Account").find(item => canonicalId(item, "account_id") === String(investment.account_id).toLowerCase());
  if (!account || typeof account.currency !== "string" || !EXACT_DECIMAL.test(plan.amount)) throw new Error("PERSONAL_PURCHASE_AMOUNT_INVALID");
  const amount = money(plan.amount, Currency.of(account.currency));
  if (!amount.isPositive() || !amount.amount.fitsScale(amount.currency.minorUnitScale)) throw new Error("PERSONAL_PURCHASE_AMOUNT_INVALID");
  const priorId = investment.contribution_model_id;
  if (priorId != null && priorId !== plan.primitiveId.toLowerCase()) throw new Error("PERSONAL_PURCHASE_EXISTING_POLICY_REQUIRES_SAME_ID");
  const existing = objects(model, "PrimitiveInstance").find(item => canonicalId(item, "primitive_instance_id") === plan.primitiveId.toLowerCase());
  if (existing && (priorId == null || !record(existing.parameters) || existing.parameters.adapter !== VERSION)) throw new Error("PERSONAL_PURCHASE_ID_COLLISION");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1) throw new Error("PERSONAL_PURCHASE_ROOT_REQUIRED");
  const schedule: Readonly<Record<string, JsonValue>> = plan.frequency === "once" ? { kind: "explicit_dates", dates: [plan.date] } : { kind: "utc_monthly", anchor: plan.date, invalidDayPolicy: "skip" };
  let contribution: Readonly<Record<string, JsonValue>> | undefined;
  let rules: readonly Readonly<Record<string, JsonValue>>[] = [];
  if (account.account_type === "traditional_ira" || account.account_type === "roth_ira") {
    if (plan.contributionFacts === undefined) throw new Error("IRA_CONTRIBUTION_FACTS_REQUIRED");
    const facts: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(plan.contributionFacts)) if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") facts[key] = value;
    parseContributionFacts(facts);
    const person = objects(model, "Person").find(item => canonicalId(item, "person_id") === account.owner_id);
    if (!person || typeof person.household_id !== "string") throw new Error("CONTRIBUTION_OWNER_REQUIRED");
    contribution = { character: account.account_type, personId: String(person.person_id), householdId: person.household_id, facts, excessPolicy: plan.excessPolicy ?? "reject" };
    rules = authoredContributionRules(String(person.person_id), account.account_type === "roth_ira" ? ["ira_shared", "roth_ira"] : ["ira_shared"], plan.contributionFacts.taxYear);
    for (const rule of rules) {
      const existingRule = objects(model, "TaxRule").find(item => item.tax_rule_id === rule.tax_rule_id);
      if (existingRule && canonicalSerialize(existingRule) !== canonicalSerialize(rule)) throw new Error("CONTRIBUTION_RULE_ID_COLLISION");
    }
  }
  const primitive: Readonly<Record<string, JsonValue>> = { primitive_instance_id: plan.primitiveId.toLowerCase(), primitive_id: "P03", enabled: true, scenario_id: String(roots[0]!.scenario_id),
    input_bindings: { source_cash_account_id: plan.sourceCashAccountId.toLowerCase(), amount: plan.amount },
    parameters: { adapter: VERSION, order: plan.order, schedule, ...(contribution === undefined ? {} : { contribution }) } };
  const next: PortableModelEnvelope = { ...model, objects: { ...model.objects,
    Investment: objects(model, "Investment").map(item => item === investment ? { ...item, contribution_model_id: plan.primitiveId.toLowerCase() } : item),
    PrimitiveInstance: [...objects(model, "PrimitiveInstance").filter(item => canonicalId(item, "primitive_instance_id") !== plan.primitiveId.toLowerCase()), primitive],
    ...(contribution === undefined ? {} : { Account: objects(model, "Account").map(item => item === account ? { ...item, contribution_limit_rule_id: null, contribution_limit_rule_ids: [...new Set([...normalizeContributionLimitRuleIds(item), ...rules.map(rule => String(rule.tax_rule_id))])] } : item),
      TaxRule: [...objects(model, "TaxRule").filter(item => !rules.some(rule => rule.tax_rule_id === item.tax_rule_id)), ...rules] }),
  } };
  durablePersonalPurchaseInstructions(next);
  return next;
};
