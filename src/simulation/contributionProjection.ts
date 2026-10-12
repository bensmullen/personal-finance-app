import type { ContributionPolicy } from "./contributions.js";
import type { Instant } from "../time/index.js";
import { domainId } from "../identity/index.js";
import { deriveD1ContributionCapacity } from "../rules/contribution2026.js";
import { taxDiagnostic } from "./tax/contracts.js";
import { Money } from "../values/index.js";

const applicableFacts = (policy: ContributionPolicy, at: Instant) => (policy.annualFacts ?? []).filter(row =>
  row.personId === policy.personId && row.householdId === policy.householdId && row.character === policy.character &&
  row.year === Number(at.slice(0, 4)) && row.effectiveStart <= at && at < row.effectiveEnd &&
  policy.limits.some(binding => binding.bucketKey === row.bucketKey &&
    (binding.kind !== "401k_additions" || row.sponsorId === binding.bucketKey.slice("401k_additions:".length))));
const equivalent = (a: unknown, b: unknown) => a instanceof Money && b instanceof Money ? a.equals(b) : a === b;
function selectedFacts(policy: ContributionPolicy, at: Instant) {
  const rows = applicableFacts(policy, at);
  const facts: Record<string, unknown> = {};
  const problems = rows.flatMap(row => row.status === "true_conflict" ? row.problems : []);
  for (const row of rows) for (const [key, value] of Object.entries(row.facts)) {
    if (value === undefined || key === "annualFactProjection" || key === "lawProjection") continue;
    if (facts[key] !== undefined && !equivalent(facts[key], value)) problems.push(`Conflicting ${key} sources for ${row.year} ${row.bucketKey}`);
    else facts[key] = value;
  }
  return { rows, facts, problems };
}

/** Future annual facts are forecast assumptions, never rewritten observed facts. */
export function contributionPolicyAt(policy: ContributionPolicy, at: Instant): ContributionPolicy {
  const year = Number(at.slice(0, 4));
  if (policy.forecastLawPolicy !== "projected_current_law" || year < policy.facts.taxYear || year <= 2026) return policy;
  if (year === policy.facts.taxYear) return { ...policy, facts: { ...policy.facts, lawProjection: "projected_current_law" } };
  const selected = selectedFacts(policy, at);
  return { ...policy, facts: { ...(selected.problems.length ? {} : selected.facts), taxYear: year, lawProjection: "projected_current_law" } };
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
  const selected = selectedFacts(policy, at);
  const missing = [...new Set([...selected.problems, ...kinds.flatMap(kind => {
    const capacity = deriveD1ContributionCapacity(kind, projected.facts);
    return capacity.status === "incomplete" ? capacity.diagnostics : [];
  })])];
  return missing.length ? [taxDiagnostic("contribution_annual_facts", `${projected.facts.taxYear} ${policy.character.replaceAll("_", " ")} capacity/tax treatment is incomplete: ${missing.join(", ")}. Future contributions are not executed. Review that year's named income, employer, tax or health-coverage source; base-year facts are not reused automatically.`, "US:FEDERAL", policy.personId)] : [];
}
