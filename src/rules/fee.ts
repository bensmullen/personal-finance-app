import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import type { FixedFeeRule, RuleApplication } from "./contracts.js";
import type { Money } from "../values/index.js";

export const evaluateFixedFee = (rule: FixedFeeRule, at: Instant): RuleApplication<Money> => {
  const traceRefs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`rule:${rule.kind}:${rule.id}:${at}`), [rule.id])])!;
  return Object.freeze({ ruleId: rule.id, ruleKind: rule.kind, target: Object.freeze({ ...rule.target }), evaluatedAt: at, result: rule.amount, traceRefs });
};
