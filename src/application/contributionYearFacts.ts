import type { PortableModelEnvelope, JsonValue } from "../model/modelVersion.js";
import type { ContributionPolicy, SourceQualifiedContributionYear } from "../simulation/contributions.js";
import type { D1ContributionFacts } from "../rules/contribution2026.js";
import { deriveD1ContributionCapacity } from "../rules/contribution2026.js";
import { parseContributionFacts } from "./compiler/contributionAuthoring.js";
import { resolveAnnualFinancialFact, type AnnualField } from "./financialFacts.js";
import type { FilingStatus } from "../rules/tax/contracts.js";

/** Fresh execution uses the same filing unit/year authority as household taxes. */
export function withAnnualFilingStatus(model: PortableModelEnvelope, policy: ContributionPolicy, openingReference?: string): ContributionPolicy {
  if (!policy.character.endsWith("_ira")) return policy;
  const resolved = resolveAnnualFinancialFact(model, "filingStatus", { personId: policy.personId, householdId: policy.householdId, taxYear: policy.facts.taxYear }, openingReference);
  const { filingStatus: _old, ...facts } = policy.facts;
  return { ...policy, facts: { ...facts, ...(resolved.value === undefined || resolved.status === "true_conflict" ? {} : { filingStatus: resolved.value as FilingStatus }) } };
}

const fieldsFor = (kind: string): readonly (keyof D1ContributionFacts)[] => kind === "401k_additions" ? ["eligiblePlanCompensation"]
  : kind === "401k_elective" ? ["ageAtYearEnd", "priorYearSponsorWages", "planHasRoth"]
    : kind.startsWith("hsa_") ? ["ageAtYearEnd", "hsaFullYearEligible", "hsaCoverage", "hsaFamilyAllocation"]
      : kind === "roth_ira" ? ["ageAtYearEnd", "taxableCompensation", "filingStatus", "rothMagi", "livesWithSpouse"]
        : ["ageAtYearEnd", "taxableCompensation", "filingStatus", "deductionMagi", "workplacePlanCovered", "spouseWorkplacePlanCovered", "livesWithSpouse"];

/** Original dated facts only. Adapter snapshots never propagate into another year. */
export function resolveContributionYearSchedule(model: PortableModelEnvelope, policy: ContributionPolicy,
  start: string, end: string, openingReference?: string): readonly SourceQualifiedContributionYear[] {
  const rows: SourceQualifiedContributionYear[] = [];
  // Dates are compiler-validated UTC boundaries. End is exclusive.
  const first = Number(start.slice(0, 4)), last = Number(end.slice(0, 4));
  for (let year = Math.max(first, policy.facts.taxYear + 1); year <= last; year++) {
    if (`${year}-01-01` >= end) break;
    for (const binding of policy.limits.filter(item => item.includedCharacters.includes(policy.character))) {
      const sponsorId = binding.kind === "401k_additions" ? binding.bucketKey.slice("401k_additions:".length)
        : policy.limits.find(item => item.kind === "401k_additions")?.bucketKey.slice("401k_additions:".length);
      const values: Record<string, unknown> = {};
      const sources: SourceQualifiedContributionYear["sources"][number][] = [];
      const problems: string[] = [];
      for (const field of fieldsFor(binding.kind)) {
        const resolved = resolveAnnualFinancialFact(model, field as AnnualField, { personId: policy.personId, householdId: policy.householdId, taxYear: year, ...(sponsorId === undefined ? {} : { sponsorId }) }, openingReference);
        sources.push(...resolved.sources.map(source => ({ id: source.id, field, ruleVersion: source.ruleVersion ?? "dated-contribution-fact/v1" })));
        if (resolved.status === "true_conflict") problems.push(`${year}: conflicting ${field} in ${resolved.sources.map(source => source.label).join(", ")}`);
        else if (resolved.value !== undefined) values[field] = resolved.value;
      }
      const facts: D1ContributionFacts = { ...parseContributionFacts({ ...values as Record<string, JsonValue>, taxYear: year }), lawProjection: "projected_current_law" };
      const capacity = deriveD1ContributionCapacity(binding.kind, facts);
      rows.push(Object.freeze({ personId: policy.personId, householdId: policy.householdId, year,
        character: policy.character, bucketKey: binding.bucketKey, ...(sponsorId === undefined ? {} : { sponsorId }),
        effectiveStart: `${year}-01-01T00:00:00.000Z`, effectiveEnd: `${year + 1}-01-01T00:00:00.000Z`,
        status: problems.length ? "true_conflict" : capacity.status === "incomplete" ? "missing" : "known",
        facts: Object.freeze(facts), sources: Object.freeze(sources.sort((a, b) => `${a.field}:${a.id}`.localeCompare(`${b.field}:${b.id}`))),
        problems: Object.freeze([...problems, ...(capacity.status === "incomplete" ? capacity.diagnostics : [])]) }));
    }
  }
  return Object.freeze(rows);
}

export function withContributionYearSchedule(model: PortableModelEnvelope, policy: ContributionPolicy, start: string, end: string, openingReference?: string): ContributionPolicy {
  return { ...withAnnualFilingStatus(model, policy, openingReference), forecastLawPolicy: "projected_current_law", annualFacts: resolveContributionYearSchedule(model, policy, start, end, openingReference) };
}
