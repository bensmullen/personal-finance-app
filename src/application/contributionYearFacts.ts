import type { PortableModelEnvelope, JsonValue } from "../model/modelVersion.js";
import type { ContributionPolicy, SourceQualifiedContributionYear } from "../simulation/contributions.js";
import type { D1ContributionFacts } from "../rules/contribution2026.js";
import { deriveD1ContributionCapacity } from "../rules/contribution2026.js";
import { Money } from "../values/index.js";
import { objects, type CanonicalObject } from "./compiler/shared.js";
import { parseContributionFacts } from "./compiler/contributionAuthoring.js";
import { resolveAgeAtYearEnd } from "./factResolution.js";

const record = (value: JsonValue | undefined): value is CanonicalObject => !!value && typeof value === "object" && !Array.isArray(value);
const equal = (a: unknown, b: unknown) => a instanceof Money && b instanceof Money ? a.equals(b) : a === b;
const fieldsFor = (kind: string): readonly (keyof D1ContributionFacts)[] => kind === "401k_additions" ? ["eligiblePlanCompensation"]
  : kind === "401k_elective" ? ["ageAtYearEnd", "priorYearSponsorWages", "planHasRoth"]
    : kind.startsWith("hsa_") ? ["ageAtYearEnd", "hsaFullYearEligible", "hsaCoverage", "hsaFamilyAllocation"]
      : kind === "roth_ira" ? ["ageAtYearEnd", "taxableCompensation", "filingStatus", "rothMagi", "livesWithSpouse"]
        : ["ageAtYearEnd", "taxableCompensation", "filingStatus", "deductionMagi", "workplacePlanCovered", "spouseWorkplacePlanCovered", "livesWithSpouse"];

/** Original dated facts only. Adapter snapshots never propagate into another year. */
export function resolveContributionYearSchedule(model: PortableModelEnvelope, policy: ContributionPolicy,
  start: string, end: string): readonly SourceQualifiedContributionYear[] {
  const observations = objects(model, "PrimitiveInstance").flatMap(primitive => {
    if (primitive.enabled !== true || !record(primitive.parameters)) return [];
    const params = primitive.parameters;
    if (params.adapter !== "d1-historical-contribution-scope/v1" && params.adapter !== "d1-payroll-contribution/v1" && params.adapter !== "d1-personal-purchase/v1") return [];
    const contribution = record(params.contribution) ? params.contribution : undefined;
    const raw = contribution?.facts ?? params.facts;
    if (!record(raw)) return [];
    const holding = objects(model, "Investment").find(item => item.investment_id === params.investmentId || item.contribution_model_id === primitive.primitive_instance_id);
    const account = objects(model, "Account").find(item => item.account_id === holding?.account_id);
    const person = objects(model, "Person").find(item => item.person_id === account?.owner_id);
    if (!person || person.person_id !== policy.personId || person.household_id !== policy.householdId) return [];
    // This key identifies a legal plan, never a match on employer display text.
    const sponsor = typeof params.planKey === "string" ? params.planKey : contribution?.planKey;
    let facts: D1ContributionFacts;
    try { facts = parseContributionFacts(raw); } catch { return []; }
    return [{ id: String(primitive.primitive_instance_id), facts, sponsor: typeof sponsor === "string" ? sponsor : undefined }];
  });
  const rows: SourceQualifiedContributionYear[] = [];
  // Dates are compiler-validated UTC boundaries. End is exclusive.
  const first = Number(start.slice(0, 4)), last = Number(end.slice(0, 4));
  for (let year = Math.max(first, policy.facts.taxYear + 1); year <= last; year++) {
    if (`${year}-01-01` >= end) break;
    const age = resolveAgeAtYearEnd(model, policy.personId, year);
    for (const binding of policy.limits.filter(item => item.includedCharacters.includes(policy.character))) {
      const sponsorId = binding.kind === "401k_additions" ? binding.bucketKey.slice("401k_additions:".length)
        : policy.limits.find(item => item.kind === "401k_additions")?.bucketKey.slice("401k_additions:".length);
      const values: Record<string, unknown> = {};
      const sources: SourceQualifiedContributionYear["sources"][number][] = [];
      const problems: string[] = [];
      for (const field of fieldsFor(binding.kind)) {
        const matching = observations.filter(item => item.facts.taxYear === year &&
          (!policy.character.includes("401k") || item.sponsor === sponsorId) && item.facts[field] !== undefined);
        const candidates = matching.map(item => ({ id: item.id, value: item.facts[field], ruleVersion: "dated-contribution-fact/v1" }));
        if (field === "ageAtYearEnd" && age.status === "derived") candidates.push(...age.sources.map(source => ({ id: source.id, value: source.value, ruleVersion: source.ruleVersion! })));
        const initial = candidates[0];
        if (initial) {
          sources.push(...candidates.map(item => ({ id: item.id, field, ruleVersion: item.ruleVersion })));
          if (candidates.some(item => !equal(initial.value, item.value))) problems.push(`${year}: conflicting ${field} in ${candidates.map(item => item.id).join(", ")}`);
          else values[field] = initial.value;
        }
      }
      const facts: D1ContributionFacts = { ...values, taxYear: year, lawProjection: "projected_current_law" };
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

export function withContributionYearSchedule(model: PortableModelEnvelope, policy: ContributionPolicy, start: string, end: string): ContributionPolicy {
  return { ...policy, forecastLawPolicy: "projected_current_law", annualFacts: resolveContributionYearSchedule(model, policy, start, end) };
}
