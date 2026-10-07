import type { ContributionPolicy } from "./contributions.js";
import type { Instant } from "../time/index.js";

/** Future annual facts are forecast assumptions, never rewritten observed facts. */
export function contributionPolicyAt(policy: ContributionPolicy, at: Instant): ContributionPolicy {
  const year = Number(at.slice(0, 4));
  if (policy.forecastLawPolicy !== "projected_current_law" || year < policy.facts.taxYear || year <= 2026) return policy;
  return { ...policy, facts: { ...policy.facts, taxYear: year, lawProjection: "projected_current_law",
    ...(policy.facts.ageAtYearEnd === undefined ? {} : { ageAtYearEnd: policy.facts.ageAtYearEnd + year - policy.facts.taxYear }) } };
}
