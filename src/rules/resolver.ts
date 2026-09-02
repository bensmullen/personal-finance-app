import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { Instant } from "../time/index.js";
import { Money, Ratio, RoundingPolicy, decimal } from "../values/index.js";
import type { FinancialRule, FinancialRuleId, RuleCatalog, RuleKind, RuleTarget } from "./contracts.js";

const definitionError = (rule: FinancialRule, message: string, fieldPath?: string): never => failValidation({
  severity: "error",
  code: issueCodes.ruleDefinitionInvalid,
  message,
  entityType: "financial_rule",
  entityId: rule.id,
  ...(fieldPath === undefined ? {} : { fieldPath }),
});

export const assertValidRuleDefinition = (rule: FinancialRule): void => {
  if (rule.effectiveUntil !== undefined && rule.effectiveFrom >= rule.effectiveUntil) definitionError(rule, `Rule ${rule.id} must have a non-empty effective range`, "effectiveUntil");
  if (rule.target === undefined || !["person", "household", "account", "liability"].includes(rule.target.targetType) || typeof rule.target.targetId !== "string" || rule.target.targetId.length === 0) definitionError(rule, `Rule ${rule.id} requires an explicit supported target`, "target");
  if (rule.kind === "proportional_income_tax" && (!(rule.effectiveRate instanceof Ratio) || !(rule.postingRounding instanceof RoundingPolicy) || rule.effectiveRate.value.isNegative() || rule.effectiveRate.value.compare(decimal("1")) > 0)) definitionError(rule, `Rule ${rule.id} tax rate must be between zero and one with explicit rounding`, "effectiveRate");
  if (rule.kind === "annual_contribution_limit") {
    if (!Number.isSafeInteger(rule.calendarYear) || rule.calendarYear < 100 || rule.calendarYear > 9998 || rule.calendar !== "utc") definitionError(rule, `Rule ${rule.id} requires a valid UTC calendar year`, "calendarYear");
    const expectedFrom = `${String(rule.calendarYear).padStart(4, "0")}-01-01T00:00:00.000Z`;
    const expectedUntil = `${String(rule.calendarYear + 1).padStart(4, "0")}-01-01T00:00:00.000Z`;
    if (rule.effectiveFrom !== expectedFrom || rule.effectiveUntil !== expectedUntil) definitionError(rule, `Rule ${rule.id} effective range must exactly match UTC calendar year ${rule.calendarYear}`, "effectiveFrom");
    if (!(rule.annualLimit instanceof Money) || rule.annualLimit.isNegative()) definitionError(rule, `Rule ${rule.id} annual limit cannot be negative`, "annualLimit");
  }
  if (rule.kind === "product_operation_eligibility" && !["contribution", "withdrawal", "extra_principal"].includes(rule.operation)) definitionError(rule, `Rule ${rule.id} has an unsupported operation`, "operation");
  if (rule.kind === "fixed_fee" && (!(rule.amount instanceof Money) || rule.amount.isNegative())) definitionError(rule, `Rule ${rule.id} fee cannot be negative`, "amount");
};

const sameTarget = (left: RuleTarget, right: RuleTarget): boolean => left.targetType === right.targetType && left.targetId === right.targetId;
const activeAt = (rule: FinancialRule, at: Instant): boolean => rule.effectiveFrom <= at && (rule.effectiveUntil === undefined || at < rule.effectiveUntil);

export const resolveEffectiveRule = <Kind extends RuleKind>(
  catalog: RuleCatalog,
  candidateIds: readonly FinancialRuleId[],
  requiredKind: Kind,
  target: RuleTarget,
  at: Instant,
): Extract<FinancialRule, { readonly kind: Kind }> => {
  if (new Set(candidateIds).size !== candidateIds.length) failValidation({ severity: "error", code: issueCodes.ruleDefinitionInvalid, message: "Rule candidate identities must be unique", entityType: "rule_binding", fieldPath: "candidateIds" });
  const byId = new Map<string, FinancialRule>();
  for (const rule of catalog) {
    assertValidRuleDefinition(rule);
    if (byId.has(rule.id)) failValidation({ severity: "error", code: issueCodes.ruleDefinitionInvalid, message: `Rule catalog contains duplicate identity ${rule.id}`, entityType: "financial_rule", entityId: rule.id });
    byId.set(rule.id, rule);
  }
  const candidates = candidateIds.map((id) => {
    const rule = byId.get(id);
    if (rule === undefined) failValidation({ severity: "error", code: issueCodes.ruleReferenceNotFound, message: `Referenced rule ${id} was not found`, entityType: "rule_binding", entityId: id });
    if (rule.kind !== requiredKind || !sameTarget(rule.target, target)) failValidation({ severity: "error", code: issueCodes.ruleTargetMismatch, message: `Rule ${id} does not match required kind and target`, entityType: "financial_rule", entityId: id, relatedIds: [requiredKind, target.targetType, target.targetId] });
    return rule;
  });
  const active = candidates.filter((rule) => activeAt(rule, at));
  if (active.length === 0) failValidation({ severity: "error", code: issueCodes.ruleNotActive, message: `No active ${requiredKind} rule exists at ${at}`, entityType: "rule_binding", relatedIds: [...candidateIds].sort() });
  if (active.length > 1) failValidation({ severity: "error", code: issueCodes.ruleAmbiguous, message: `Multiple active ${requiredKind} rules exist at ${at}`, entityType: "rule_binding", relatedIds: active.map((rule) => rule.id).sort() });
  return active[0] as Extract<FinancialRule, { readonly kind: Kind }>;
};
