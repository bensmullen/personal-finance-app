import type { ContributionPolicy } from "./contributions.js";
import type { Instant } from "../time/index.js";
import { domainId } from "../identity/index.js";
import { deriveD1ContributionCapacity } from "../rules/contribution2026.js";
import { taxDiagnostic } from "./tax/contracts.js";

/** Future annual facts are forecast assumptions, never rewritten observed facts. */
export function contributionPolicyAt(policy: ContributionPolicy, at: Instant): ContributionPolicy {
  const year = Number(at.slice(0, 4));
  if (policy.forecastLawPolicy !== "projected_current_law" || year < policy.facts.taxYear || year <= 2026) return policy;
  return { ...policy, facts: { ...(year === policy.facts.taxYear || policy.facts.annualFactProjection === "confirmed_nominal_carry_forward" ? policy.facts : {}), taxYear: year, lawProjection: "projected_current_law",
    ...(policy.facts.ageAtYearEnd === undefined ? {} : { ageAtYearEnd: policy.facts.ageAtYearEnd + year - policy.facts.taxYear }) } };
}

/** Deterministic projected namespace derived from base identity and calendar year. */
export function contributionRuleIdAt(baseRuleId: string, policy: ContributionPolicy, at: Instant): string {
  const year = Number(at.slice(0, 4));
  if (contributionPolicyAt(policy, at).facts.lawProjection !== "projected_current_law") return baseRuleId;
  const base = domainId("tax-rule", baseRuleId);
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  for (const byte of new TextEncoder().encode(`projected-contribution:nominal-v1:${base}:${year}`)) hash = BigInt.asUintN(128, (hash ^ BigInt(byte)) * 0x0000000001000000000000000000013bn);
  const hex = hash.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function projectedContributionDiagnostics(policy: ContributionPolicy, at: Instant) {
  const projected = contributionPolicyAt(policy, at);
  if (projected.facts.lawProjection !== "projected_current_law") return [];
  const kinds = policy.limits.filter(binding => binding.includedCharacters.includes(policy.character)).map(binding => binding.kind);
  const missing = [...new Set(kinds.flatMap(kind => {
    const capacity = deriveD1ContributionCapacity(kind, projected.facts);
    return capacity.status === "incomplete" ? capacity.diagnostics : [];
  }))];
  return missing.length ? [taxDiagnostic("contribution_annual_facts", `${projected.facts.taxYear} ${policy.character.replaceAll("_", " ")} capacity/tax treatment is incomplete: ${missing.join(", ")}. Future contributions are not executed. Supply or explicitly confirm future annual personal-fact assumptions in the contribution plan; base-year facts are not reused automatically.`, "US:FEDERAL", policy.personId)] : [];
}
