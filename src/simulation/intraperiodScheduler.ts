import type { ValidationIssue } from "../diagnostics/index.js";
import type { AccountId } from "../accounting/index.js";
import type { DomainId, GeneratedOccurrenceKey } from "../identity/index.js";
import type { CalculationTraceRef } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import { canonicalSerialize } from "./run.js";
import { indexReachability } from "./r3/ordering.js";

/** PR20's deliberately small, versioned cross-domain ordering vocabulary. */
export type HouseholdOperationClass =
  | "cash_income_settlement" | "cash_expense_settlement"
  | "investment_transfer" | "investment_purchase" | "investment_fee"
  | "liability_required_service" | "liability_extra_principal"
  /** Additional participants use domain:class names; no central domain priority. */
  | (string & {});

export type HouseholdWorkDomain = "cash_flow" | "investments" | "liabilities" | (string & {});
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
  readonly policy?: HouseholdContentionPolicy;
  /** Explicit predecessor -> successor edges; runtime may add resolved contention edges later. */
  readonly dependencies: readonly HouseholdPlanDependency[];
}

export type HouseholdPlanDependency =
  | { readonly before: string; readonly after: string; readonly source: "explicit" }
  | { readonly before: string; readonly after: string; readonly source: "policy"; readonly policyId: string; readonly policyVersion: "1" };

export type HouseholdPlanResult =
  | { readonly status: "compiled"; readonly value: HouseholdScheduledPlan }
  | { readonly status: "invalid_model"; readonly diagnostics: readonly ValidationIssue[] };

const domainFor = (kind: HouseholdOperationClass): HouseholdWorkDomain =>
  kind.startsWith("cash_") ? "cash_flow" : kind.startsWith("investment_") ? "investments"
    : kind.startsWith("liability_") ? "liabilities" : kind.split(":")[0] ?? "";
const issue = (code: string, message: string, relatedIds: readonly string[] = []): HouseholdPlanResult => ({
  status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code, message, entityType: "household_projection", relatedIds: Object.freeze([...relatedIds].sort()) }]),
});
const canonicalRule = (rule: HouseholdContentionRule): string => `${rule.before}\u0000${rule.after}`;
const ordered = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] => [...values].sort((a, b) => a.id.localeCompare(b.id));
const canonicalRules = (rules: readonly HouseholdContentionRule[]): readonly HouseholdContentionRule[] =>
  [...new Map(rules.map((rule) => [canonicalRule(rule), rule])).values()].sort((a, b) => canonicalRule(a).localeCompare(canonicalRule(b)));

export const canonicalHouseholdContentionPolicy = (policy: HouseholdContentionPolicy | undefined): HouseholdContentionPolicy | undefined =>
  policy === undefined ? undefined : Object.freeze({ id: policy.id, version: policy.version, rules: Object.freeze(canonicalRules(policy.rules)) });

/** The canonical semantic form used in fingerprints; unordered plan members are sorted. */
export const canonicalHouseholdWorkPlan = (descriptors: readonly HouseholdWorkDescriptor[], policy?: HouseholdContentionPolicy): unknown => ({
  descriptors: ordered(descriptors).map((descriptor) => ({
    ...descriptor,
    dependsOn: [...descriptor.dependsOn].sort(),
    resourceAccesses: [...descriptor.resourceAccesses].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b))),
    traceRefs: [...descriptor.traceRefs].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b))),
  })),
  ...(policy === undefined ? {} : { policy: canonicalHouseholdContentionPolicy(policy) }),
});


/**
 * Validates and materializes one intraperiod graph.  It intentionally knows no
 * slice priorities: callers must translate their local contracts into dependsOn.
 */
export const buildHouseholdScheduledPlan = (descriptors: readonly HouseholdWorkDescriptor[], policy: HouseholdContentionPolicy | undefined): HouseholdPlanResult => {
  if (policy !== undefined && (policy.version !== "1" || policy.id.trim() === "")) return issue("HOUSEHOLD_CONTENTION_POLICY_INVALID", "A supplied HouseholdContentionPolicy must be non-empty and use version 1.");
  const ids = new Set<string>();
  const workById = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]));
  for (const descriptor of descriptors) {
    if (descriptor.id.trim() === "" || ids.has(descriptor.id)) return issue("HOUSEHOLD_WORK_PLAN_INVALID", "Household work IDs must be unique and non-empty.", [descriptor.id]);
    ids.add(descriptor.id);
    if (descriptor.operationClass !== undefined && domainFor(descriptor.operationClass) !== descriptor.domain) return issue("HOUSEHOLD_WORK_CLASS_DOMAIN_INVALID", `Work ${descriptor.id} declares an operation class outside its domain.`, [descriptor.id]);
    if (descriptor.dependsOn.some((id) => id === descriptor.id || !workById.has(id))) return issue("HOUSEHOLD_WORK_DEPENDENCY_INVALID", `Work ${descriptor.id} has an invalid dependency.`, [descriptor.id, ...descriptor.dependsOn]);
  }
  const rules = canonicalRules(policy?.rules ?? []);
  const ruleKeys = new Set<string>();
  for (const rule of rules) {
    if (rule.before === rule.after || domainFor(rule.before) === domainFor(rule.after)) return issue("HOUSEHOLD_CONTENTION_POLICY_INVALID", "Policy rules must relate distinct cross-domain operation classes.", policy === undefined ? [] : [policy.id]);
    const key = canonicalRule(rule); if (ruleKeys.has(`${rule.after}\u0000${rule.before}`)) return issue("HOUSEHOLD_CONTENTION_POLICY_CONTRADICTION", "Policy contains contradictory precedence rules.", policy === undefined ? [] : [policy.id]);
    ruleKeys.add(key);
  }
  const policyClasses = [...new Set(rules.flatMap(rule => [rule.before, rule.after]))];
  const policyReaches = indexReachability(rules);
  if (policyClasses.some((operationClass) => policyReaches(operationClass, operationClass))) return issue("HOUSEHOLD_CONTENTION_POLICY_CYCLE", "Household contention policy contains a cycle.", policy === undefined ? [] : [policy.id]);
  const explicit = descriptors.flatMap((descriptor) => descriptor.dependsOn.map((before) => ({ before, after: descriptor.id, source: "explicit" as const })));
  if (descriptors.some((descriptor) => descriptor.dependsOn.some((before) => workById.get(before)!.sequencingInstant > descriptor.sequencingInstant))) return issue("HOUSEHOLD_TEMPORAL_DEPENDENCY_INVALID", "A work item cannot depend on a later sequencing instant.");
  const explicitReaches = indexReachability(explicit);
  if (descriptors.some((descriptor) => explicitReaches(descriptor.id, descriptor.id))) return issue("HOUSEHOLD_WORK_CYCLE", "Explicit household work dependencies contain a cycle.");
  for (const edge of explicit) {
    const before = workById.get(edge.before)!;
    const after = workById.get(edge.after)!;
    if (policy !== undefined && before.domain !== after.domain && before.operationClass !== undefined && after.operationClass !== undefined) {
      const forward = policyReaches(before.operationClass, after.operationClass);
      const reverse = policyReaches(after.operationClass, before.operationClass);
      if (reverse && !forward) return issue("HOUSEHOLD_POLICY_DEPENDENCY_CONTRADICTION", "Policy precedence contradicts an explicit household dependency.", [before.id, after.id, policy.id]);
    }
  }
  const edges: HouseholdPlanDependency[] = [...explicit];
  return { status: "compiled", value: Object.freeze({ descriptors: Object.freeze(ordered(descriptors)), ...(policy === undefined ? {} : { policy: Object.freeze({ ...policy, rules: Object.freeze(rules) }) }), dependencies: Object.freeze(edges.sort((a, b) => a.before.localeCompare(b.before) || a.after.localeCompare(b.after))) }) };
};
