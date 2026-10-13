import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { objects, utcDate } from "./compiler/shared.js";

/** A value is reusable only inside the complete semantic scope, never by label. */
export interface FactScope {
  readonly personId: string;
  readonly taxYear: number;
  readonly householdId?: string;
  readonly sponsorId?: string;
  readonly accountId?: string;
  readonly holdingId?: string;
  readonly scenarioId?: string;
  readonly effectiveStart?: string;
  readonly effectiveEnd?: string;
  readonly bucketKey?: string;
  readonly character?: string;
}
export interface FactSource<T> {
  readonly id: string;
  readonly label: string;
  readonly scope: FactScope;
  readonly value: T;
  readonly provenance: "observed" | "legacy_snapshot" | "commitment" | "calculated" | "assumption";
  readonly ruleVersion?: string;
}
export interface FactRepair {
  readonly owner: string;
  readonly entityType: "Person" | "Investment";
  readonly entityId: string;
  readonly field: string;
}
export interface ResolvedFact<T> {
  readonly semanticId: string;
  readonly scope: FactScope;
  readonly status: "known" | "derived" | "assumed" | "missing" | "true_conflict" | "unsupported";
  readonly value?: T;
  readonly sources: readonly FactSource<T>[];
  readonly dependencies: readonly string[];
  readonly repair: FactRepair;
  readonly reason?: string;
}
export function factScopeKey(scope: FactScope): string {
  return JSON.stringify([scope.personId, scope.taxYear, scope.householdId ?? null,
    scope.sponsorId ?? null, scope.accountId ?? null, scope.holdingId ?? null,
    scope.scenarioId ?? null, scope.effectiveStart ?? null, scope.effectiveEnd ?? null,
    scope.bucketKey ?? null, scope.character ?? null]);
}

/** Coalesces identical observations without erasing provenance or choosing a winner. */
export function resolveScopedFact<T>(input: {
  semanticId: string; scope: FactScope; sources: readonly FactSource<T>[];
  dependencies: readonly string[]; repair: FactRepair;
  equal: (a: T, b: T) => boolean;
}): ResolvedFact<T> {
  const sources = input.sources.filter(source => factScopeKey(source.scope) === factScopeKey(input.scope))
    .slice().sort((a, b) => a.id.localeCompare(b.id));
  const first = sources[0];
  const base = { semanticId: input.semanticId, scope: input.scope, dependencies: input.dependencies, repair: input.repair, sources };
  if (!first) return { ...base, status: "missing" };
  if (sources.some(source => !input.equal(first.value, source.value))) return { ...base, status: "true_conflict" };
  return { ...base, value: first.value, status: sources.some(source => source.provenance === "observed" || source.provenance === "legacy_snapshot" || source.provenance === "commitment")
    ? "known" : sources.some(source => source.provenance === "calculated") ? "derived" : "assumed" };
}

/** Calendar derivation only; this does not rewrite any compatibility policy. */
export function resolveAgeAtYearEnd(model: PortableModelEnvelope, personId: string, taxYear: number): ResolvedFact<number> {
  const scope = { personId, taxYear };
  const repair: FactRepair = { owner: "Settings → Household & People", entityType: "Person", entityId: personId, field: "date_of_birth" };
  const base = { semanticId: "person.age_year_end", scope, dependencies: ["person.birthdate", "plan.projection_year"], repair };
  if (!Number.isSafeInteger(taxYear) || taxYear < 1 || taxYear > 9999) return { ...base, status: "missing", sources: [], reason: "Choose a valid contribution year." };
  const people = objects(model, "Person").filter(person => person.person_id === personId);
  const sources = people.flatMap(person => {
    const birth = person.date_of_birth;
    if (typeof birth !== "string" || !utcDate(birth) || birth > `${String(taxYear).padStart(4, "0")}-12-31`) return [];
    return [{ id: `${personId}:date_of_birth:${birth}`, label: "Recorded date of birth", scope,
      value: taxYear - Number(birth.slice(0, 4)), provenance: "calculated" as const, ruleVersion: "calendar-december-31/v1" }];
  });
  const result = resolveScopedFact({ ...base, sources, equal: (a, b) => a === b });
  // Duplicate birth records with equal ages are still ambiguous identity data.
  if (people.length > 1) return { ...base, sources, status: "true_conflict", reason: "More than one person record has this identity. Import corrected person records." };
  return result.status === "missing" ? { ...result, reason: "Record this person's date of birth in Household & People." } : result;
}

/** Exact unsupported boundary; salary is not eligibility evidence or MAGI. */
export function futureContributionFactBoundary(scope: FactScope, holdingId: string): ResolvedFact<never> {
  return { semanticId: "investment.contribution_projection", scope, status: "unsupported", sources: [],
    dependencies: ["income.annual_pay", "employer.eligible_pay", "tax.roth_magi", "health.coverage"],
    repair: { owner: "Net Worth → Investments & retirement", entityType: "Investment", entityId: holdingId, field: "contribution_model_id" },
    reason: "Year-by-year eligibility is not supported yet. Review supported-year results; salary growth cannot establish future eligible pay, tax income or health coverage." };
}
