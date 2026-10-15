import type { ContributionPolicy } from "../simulation/contributions.js";
import { canonicalSerialize } from "../simulation/run.js";
import { resolveScopedFact, type FactScope, type FactSource } from "./factResolution.js";

/** Only metadata with no meaning for observed, base-year capacity is excluded.
 * Law selection, owner, sponsor, legal bindings and every annual fact remain.
 * Future execution continues to use its original, unmodified projection policy.
 */
export function annualPolicyFingerprint(policy: ContributionPolicy): string {
  const { annualFactProjection: _projection, ...facts } = policy.facts;
  return canonicalSerialize({ personId: policy.personId, householdId: policy.householdId,
    facts: Object.fromEntries(Object.entries(facts).map(([key, value]) => [key,
      typeof value === "object" ? { currency: value.currency.code, amount: value.amount.toString() } : value])),
    limits: policy.limits.map(binding => ({ kind: binding.kind, bucketKey: binding.bucketKey,
      target: binding.target, includedCharacters: [...binding.includedCharacters].sort() }))
      .sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b))) });
}

/** Compatibility comparison, not a write migration or a new capacity formula. */
export function resolveAnnualPolicyCopies(investmentId: string, sources: readonly {
  id: string; label: string; policy: ContributionPolicy;
}[]) {
  const first = sources[0];
  if (!first) throw new Error("Annual policy sources are required");
  const scope: FactScope = { personId: first.policy.personId, householdId: first.policy.householdId,
    taxYear: first.policy.facts.taxYear, holdingId: investmentId };
  // Sponsor is kept inside the value here: D1's YTD entry cannot select two
  // sponsors on the same holding/character. Never silently select one of them.
  const observations: FactSource<string>[] = sources.map(source => ({ id: source.id, label: source.label,
    scope: { personId: source.policy.personId, householdId: source.policy.householdId,
      taxYear: source.policy.facts.taxYear, holdingId: investmentId },
    value: annualPolicyFingerprint(source.policy), provenance: "observed" }));
  return resolveScopedFact({ semanticId: "investment.past_usage", scope, sources: observations,
    dependencies: ["person.birthdate", "employer.plan_terms", "employer.eligible_pay", "tax.filing_status", "health.coverage"],
    repair: { owner: "Net Worth → Investments & retirement", entityType: "Investment", entityId: investmentId, field: "contribution_model_id" },
    equal: (a, b) => a === b });
}
