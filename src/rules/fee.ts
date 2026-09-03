import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../lineage/index.js";
import type { RuleApplication } from "./contracts.js";
import type { Money } from "../values/index.js";
import { resolvedRuleValue, type ResolvedRule } from "./resolver.js";

export const evaluateFixedFee = (resolved: ResolvedRule<"fixed_fee">): RuleApplication<Money> => {
  const rule = resolvedRuleValue(resolved, "fixed_fee");
  const at = resolved.resolvedAt;
  const traceRefs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`rule:${rule.kind}:${rule.id}:${at}`), [rule.id])])!;
  return Object.freeze({ ruleId: rule.id, ruleKind: rule.kind, target: Object.freeze({ ...rule.target }), evaluatedAt: at, result: rule.amount, traceRefs });
};
