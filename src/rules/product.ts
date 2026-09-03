import { issueCodes, validationIssue, type ValidationIssue } from "../diagnostics/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../lineage/index.js";
import type { ProductOperationEligibilityRule, RuleApplication } from "./contracts.js";
import { resolvedRuleValue, type ResolvedRule } from "./resolver.js";

export interface ProductEligibilityDecision { readonly decision: "allowed" | "rejected"; readonly allowed: boolean; readonly operation: ProductOperationEligibilityRule["operation"]; readonly ruleId: ProductOperationEligibilityRule["id"]; readonly diagnostics: readonly ValidationIssue[]; }

export const evaluateProductOperationEligibility = (resolved: ResolvedRule<"product_operation_eligibility">): RuleApplication<ProductEligibilityDecision> => {
  const rule = resolvedRuleValue(resolved, "product_operation_eligibility");
  const at = resolved.resolvedAt;
  const diagnostics = rule.allowed ? Object.freeze([]) : Object.freeze([validationIssue({ severity: "warning", code: issueCodes.productOperationNotAllowed, message: `Product rule ${rule.id} does not allow ${rule.operation}`, entityType: "financial_rule", entityId: rule.id, relatedIds: [rule.target.targetId] })]);
  const result = Object.freeze({ decision: rule.allowed ? "allowed" as const : "rejected" as const, allowed: rule.allowed, operation: rule.operation, ruleId: rule.id, diagnostics });
  const traceRefs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`rule:${rule.kind}:${rule.id}:${at}`), [rule.id])])!;
  return Object.freeze({ ruleId: rule.id, ruleKind: rule.kind, target: Object.freeze({ ...rule.target }), evaluatedAt: at, result, traceRefs });
};
