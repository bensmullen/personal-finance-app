import type { ValidationIssue } from "../diagnostics/index.js";
import type { AccountId } from "../accounting/index.js";
import type { DomainId, GeneratedOccurrenceKey } from "../identity/index.js";
import type { CalculationTraceRef } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import { canonicalSerialize } from "./run.js";

/** PR20's deliberately small, versioned cross-domain ordering vocabulary. */
export type HouseholdOperationClass =
  | "cash_income_settlement" | "cash_expense_settlement"
  | "investment_transfer" | "investment_purchase" | "investment_fee"
  | "liability_required_service" | "liability_extra_principal";

export type HouseholdWorkDomain = "cash_flow" | "investments" | "liabilities";
export type PrimitiveInstanceId = DomainId<"primitive-instance">;

export interface HouseholdContentionRule {
  readonly before: HouseholdOperationClass;
  readonly after: HouseholdOperationClass;
}

export interface HouseholdContentionPolicy {
  readonly id: string;
  readonly version: "1";
  readonly rules: readonly HouseholdContentionRule[];
}

export interface HouseholdCashResourceAccess {
  readonly kind: "account_cash";
  readonly accountId: AccountId;
  readonly mode: "produce" | "consume";
}
export type HouseholdResourceAccess = HouseholdCashResourceAccess;

/** Serializable only: executors deliberately do not belong to the fingerprinted plan. */
export interface HouseholdWorkDescriptor {
  readonly id: string;
  readonly domain: HouseholdWorkDomain;
  readonly operationClass?: HouseholdOperationClass;
  readonly sequencingInstant: Instant;
  readonly dependsOn: readonly string[];
  readonly resourceAccesses: readonly HouseholdResourceAccess[];
  readonly primitiveInstanceId?: PrimitiveInstanceId;
  readonly occurrenceIdentity?: GeneratedOccurrenceKey;
  readonly traceRefs: readonly CalculationTraceRef[];
}

export interface HouseholdScheduledPlan {
  readonly descriptors: readonly HouseholdWorkDescriptor[];
  readonly policy: HouseholdContentionPolicy;
  /** predecessor -> successor edges, including translated policy edges. */
  readonly dependencies: readonly HouseholdPlanDependency[];
}

export type HouseholdPlanDependency =
  | { readonly before: string; readonly after: string; readonly source: "explicit" }
  | { readonly before: string; readonly after: string; readonly source: "policy"; readonly policyId: string; readonly policyVersion: "1" };

export type HouseholdPlanResult =
  | { readonly status: "compiled"; readonly value: HouseholdScheduledPlan }
  | { readonly status: "invalid_model"; readonly diagnostics: readonly ValidationIssue[] };

const domainFor = (kind: HouseholdOperationClass): HouseholdWorkDomain =>
  kind.startsWith("cash_") ? "cash_flow" : kind.startsWith("investment_") ? "investments" : "liabilities";
const issue = (code: string, message: string, relatedIds: readonly string[] = []): HouseholdPlanResult => ({
  status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code, message, entityType: "household_projection", relatedIds: Object.freeze([...relatedIds].sort()) }]),
});
const canonicalRule = (rule: HouseholdContentionRule): string => `${rule.before}\u0000${rule.after}`;
const ordered = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] => [...values].sort((a, b) => a.id.localeCompare(b.id));
const canonicalRules = (rules: readonly HouseholdContentionRule[]): readonly HouseholdContentionRule[] =>
  [...new Map(rules.map((rule) => [canonicalRule(rule), rule])).values()].sort((a, b) => canonicalRule(a).localeCompare(canonicalRule(b)));

export const canonicalHouseholdContentionPolicy = (policy: HouseholdContentionPolicy): HouseholdContentionPolicy =>
  Object.freeze({ id: policy.id, version: policy.version, rules: Object.freeze(canonicalRules(policy.rules)) });

/** The canonical semantic form used in fingerprints; unordered plan members are sorted. */
export const canonicalHouseholdWorkPlan = (descriptors: readonly HouseholdWorkDescriptor[], policy: HouseholdContentionPolicy): unknown => ({
  descriptors: ordered(descriptors).map((descriptor) => ({
    ...descriptor,
    dependsOn: [...descriptor.dependsOn].sort(),
    resourceAccesses: [...descriptor.resourceAccesses].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b))),
    traceRefs: [...descriptor.traceRefs].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b))),
  })),
  policy: canonicalHouseholdContentionPolicy(policy),
});

const overlaps = (left: HouseholdWorkDescriptor, right: HouseholdWorkDescriptor): readonly string[] => {
  const resources = new Set<string>();
  for (const a of left.resourceAccesses) for (const b of right.resourceAccesses)
    if (a.kind === "account_cash" && b.kind === "account_cash" && a.accountId === b.accountId && !(a.mode === "produce" && b.mode === "produce")) resources.add(String(a.accountId));
  return [...resources].sort();
};

const reachable = (from: string, to: string, edges: readonly { readonly before: string; readonly after: string }[]): boolean => {
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.before, [...(next.get(edge.before) ?? []), edge.after]);
  const seen = new Set<string>(); const pending = [...(next.get(from) ?? [])];
  while (pending.length) { const current = pending.pop()!; if (current === to) return true; if (!seen.has(current)) { seen.add(current); pending.push(...(next.get(current) ?? [])); } }
  return false;
};

const policyPrecedes = (before: HouseholdOperationClass, after: HouseholdOperationClass, rules: readonly HouseholdContentionRule[]): boolean =>
  reachable(before, after, rules);

/**
 * Validates and materializes one intraperiod graph.  It intentionally knows no
 * slice priorities: callers must translate their local contracts into dependsOn.
 */
export const buildHouseholdScheduledPlan = (descriptors: readonly HouseholdWorkDescriptor[], policy: HouseholdContentionPolicy | undefined): HouseholdPlanResult => {
  if (policy === undefined || policy.version !== "1" || policy.id.trim() === "") return issue("HOUSEHOLD_CONTENTION_POLICY_INVALID", "A non-empty HouseholdContentionPolicy v1 is required.");
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (descriptor.id.trim() === "" || ids.has(descriptor.id)) return issue("HOUSEHOLD_WORK_PLAN_INVALID", "Household work IDs must be unique and non-empty.", [descriptor.id]);
    ids.add(descriptor.id);
    if (descriptor.operationClass !== undefined && domainFor(descriptor.operationClass) !== descriptor.domain) return issue("HOUSEHOLD_WORK_CLASS_DOMAIN_INVALID", `Work ${descriptor.id} declares an operation class outside its domain.`, [descriptor.id]);
    if (descriptor.dependsOn.some((id) => id === descriptor.id || !ids.has(id) && !descriptors.some((other) => other.id === id))) return issue("HOUSEHOLD_WORK_DEPENDENCY_INVALID", `Work ${descriptor.id} has an invalid dependency.`, [descriptor.id, ...descriptor.dependsOn]);
  }
  const rules = canonicalRules(policy.rules);
  const ruleKeys = new Set<string>();
  for (const rule of rules) {
    if (rule.before === rule.after || domainFor(rule.before) === domainFor(rule.after)) return issue("HOUSEHOLD_CONTENTION_POLICY_INVALID", "Policy rules must relate distinct cross-domain operation classes.", [policy.id]);
    const key = canonicalRule(rule); if (ruleKeys.has(`${rule.after}\u0000${rule.before}`)) return issue("HOUSEHOLD_CONTENTION_POLICY_CONTRADICTION", "Policy contains contradictory precedence rules.", [policy.id]);
    ruleKeys.add(key);
  }
  const policyClasses: HouseholdOperationClass[] = ["cash_income_settlement", "cash_expense_settlement", "investment_transfer", "investment_purchase", "investment_fee", "liability_required_service", "liability_extra_principal"];
  if (policyClasses.some((operationClass) => reachable(operationClass, operationClass, rules))) return issue("HOUSEHOLD_CONTENTION_POLICY_CYCLE", "Household contention policy contains a cycle.", [policy.id]);
  const explicit = descriptors.flatMap((descriptor) => descriptor.dependsOn.map((before) => ({ before, after: descriptor.id, source: "explicit" as const })));
  if (descriptors.some((descriptor) => descriptor.dependsOn.some((before) => descriptors.find((item) => item.id === before)!.sequencingInstant > descriptor.sequencingInstant))) return issue("HOUSEHOLD_TEMPORAL_DEPENDENCY_INVALID", "A work item cannot depend on a later sequencing instant.");
  if (descriptors.some((descriptor) => reachable(descriptor.id, descriptor.id, explicit))) return issue("HOUSEHOLD_WORK_CYCLE", "Explicit household work dependencies contain a cycle.");
  const edges: HouseholdPlanDependency[] = [...explicit];
  const sameInstant = new Map<string, HouseholdWorkDescriptor[]>();
  for (const descriptor of descriptors) sameInstant.set(descriptor.sequencingInstant, [...(sameInstant.get(descriptor.sequencingInstant) ?? []), descriptor]);
  for (const group of sameInstant.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const left = group[i]!; const right = group[j]!; const resources = overlaps(left, right); if (!resources.length) continue;
    const leftBefore = reachable(left.id, right.id, edges); const rightBefore = reachable(right.id, left.id, edges);
    if (leftBefore && rightBefore) return issue("HOUSEHOLD_WORK_CYCLE", "Combined household dependencies contain a cycle.", [left.id, right.id]);
    if (leftBefore || rightBefore) {
      if (left.domain !== right.domain && left.operationClass !== undefined && right.operationClass !== undefined) {
        const forward = policyPrecedes(left.operationClass, right.operationClass, rules);
        const reverse = policyPrecedes(right.operationClass, left.operationClass, rules);
        if ((leftBefore && reverse) || (rightBefore && forward)) return issue("HOUSEHOLD_POLICY_DEPENDENCY_CONTRADICTION", "Policy precedence contradicts an explicit household dependency.", [left.id, right.id, policy.id]);
      }
      continue;
    }
    if (left.domain === right.domain) return issue("HOUSEHOLD_LOCAL_CONTENTION_UNRESOLVED", "Same-domain liquidity contention must be resolved by its local slice contract.", [left.id, right.id, ...resources]);
    if (left.operationClass === undefined || right.operationClass === undefined) return issue("HOUSEHOLD_CONTENTION_UNRESOLVED", "Cross-domain cash contention requires operation classes and explicit precedence.", [left.id, right.id, ...resources, policy.id]);
    const forward = policyPrecedes(left.operationClass, right.operationClass, rules);
    const reverse = policyPrecedes(right.operationClass, left.operationClass, rules);
    if (forward === reverse) return issue("HOUSEHOLD_CONTENTION_UNRESOLVED", "Cross-domain cash contention has no unique policy precedence.", [left.id, right.id, ...resources, policy.id]);
    const edge: HouseholdPlanDependency = forward ? { before: left.id, after: right.id, source: "policy", policyId: policy.id, policyVersion: policy.version } : { before: right.id, after: left.id, source: "policy", policyId: policy.id, policyVersion: policy.version };
    if (reachable(edge.after, edge.before, edges)) return issue("HOUSEHOLD_POLICY_DEPENDENCY_CONTRADICTION", "Policy precedence contradicts an explicit household dependency.", [edge.before, edge.after, policy.id]);
    edges.push(edge);
  }
  return { status: "compiled", value: Object.freeze({ descriptors: Object.freeze(ordered(descriptors)), policy: Object.freeze({ ...policy, rules: Object.freeze(rules) }), dependencies: Object.freeze(edges.sort((a, b) => a.before.localeCompare(b.before) || a.after.localeCompare(b.after))) }) };
};
