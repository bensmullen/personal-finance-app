import type { JsonValue, PortableModelEnvelope } from "../model/modelVersion.js";
import type { AuthoredContributionFacts } from "./compiler/contributionAuthoring.js";
import { objects, UUID, type CanonicalObject } from "./compiler/shared.js";
import { factScopeKey, resolveScopedFact, resolveAgeAtYearEnd, type FactScope, type ResolvedFact } from "./factResolution.js";
import { canonicalSerialize } from "../simulation/run.js";
import { decimal } from "../values/index.js";

export type AnnualField = Exclude<keyof AuthoredContributionFacts, "annualFactProjection" | "taxYear">;
export function annualFieldsFor(character: string): readonly AnnualField[] {
  return character.endsWith("_hsa") ? ["ageAtYearEnd", "hsaFullYearEligible", "hsaCoverage", "hsaFamilyAllocation"]
    : character.includes("401k") ? ["ageAtYearEnd", "eligiblePlanCompensation", "planHasRoth", "priorYearSponsorWages"]
      : ["ageAtYearEnd", "taxableCompensation", "filingStatus", ...(character === "roth_ira" ? ["rothMagi" as const] : ["deductionMagi" as const, "workplacePlanCovered" as const, "spouseWorkplacePlanCovered" as const]), "livesWithSpouse"];
}
export function authoredAnnualFacts(model: PortableModelEnvelope, character: string, scope: FactScope, openingReference?: string): AuthoredContributionFacts {
  const facts: Record<string, JsonValue> = { taxYear: scope.taxYear };
  for (const field of annualFieldsFor(character)) {
    const resolved = resolveAnnualFinancialFact(model, field, scope, openingReference);
    if (resolved.status === "true_conflict") throw new Error(`ANNUAL_FACT_CONFLICT:${field}:${scope.taxYear}:${resolved.sources.map(source => source.label).join(" / ")}`);
    if (resolved.value !== undefined) facts[field] = resolved.value;
  }
  return facts as unknown as AuthoredContributionFacts;
}
export const annualFieldOwners: Record<AnnualField, { semanticId: string; owner: "people" | "income" | "investment"; fieldKey: string; sponsor?: boolean }> = {
  ageAtYearEnd: { semanticId: "person.age_year_end", owner: "people", fieldKey: "age" },
  taxableCompensation: { semanticId: "income.ira_compensation", owner: "income", fieldKey: "taxableCompensation" },
  eligiblePlanCompensation: { semanticId: "employer.eligible_pay", owner: "investment", fieldKey: "eligiblePlanCompensation", sponsor: true },
  priorYearSponsorWages: { semanticId: "income.prior_sponsor_wages", owner: "income", fieldKey: "priorYearSponsorWages", sponsor: true },
  planHasRoth: { semanticId: "employer.plan_terms", owner: "investment", fieldKey: "planHasRoth", sponsor: true },
  filingStatus: { semanticId: "tax.filing_status", owner: "people", fieldKey: "filingStatus" },
  rothMagi: { semanticId: "tax.roth_magi", owner: "people", fieldKey: "rothMagi" },
  deductionMagi: { semanticId: "tax.deduction_magi", owner: "people", fieldKey: "deductionMagi" },
  livesWithSpouse: { semanticId: "tax.filing_status", owner: "people", fieldKey: "livesWithSpouse" },
  workplacePlanCovered: { semanticId: "tax.deduction_magi", owner: "people", fieldKey: "covered" },
  spouseWorkplacePlanCovered: { semanticId: "tax.deduction_magi", owner: "people", fieldKey: "spouseCovered" },
  hsaFullYearEligible: { semanticId: "health.coverage", owner: "people", fieldKey: "hsaFullYearEligible" },
  hsaCoverage: { semanticId: "health.coverage", owner: "people", fieldKey: "hsaCoverage" },
  hsaFamilyAllocation: { semanticId: "health.coverage", owner: "people", fieldKey: "hsaFamilyAllocation" },
};
export const financialFactAdapter = "u1-scoped-financial-fact/v1";
export const isFactRecord = (value: JsonValue | undefined): value is CanonicalObject => value !== null && typeof value === "object" && !Array.isArray(value);

/** Original compatibility carriers remain provenance, never second edit owners. */
export function contributionFactSources(model: PortableModelEnvelope) {
  return objects(model, "PrimitiveInstance").flatMap(primitive => {
    if (primitive.enabled !== true || !isFactRecord(primitive.parameters)) return [];
    const params = primitive.parameters;
    if (!["d1-historical-contribution-scope/v1", "d1-payroll-contribution/v1", "d1-personal-purchase/v1"].includes(String(params.adapter))) return [];
    const contribution = isFactRecord(params.contribution) ? params.contribution : undefined;
    const raw = contribution?.facts ?? params.facts;
    if (!isFactRecord(raw) || typeof raw.taxYear !== "number") return [];
    const holding = objects(model, "Investment").find(item => params.adapter === "d1-historical-contribution-scope/v1" ? item.investment_id === params.investmentId : item.contribution_model_id === primitive.primitive_instance_id);
    const account = objects(model, "Account").find(item => item.account_id === holding?.account_id);
    const person = objects(model, "Person").find(item => item.person_id === account?.owner_id);
    if (!holding || !account || !person) return [];
    const ruleIds = [account.contribution_limit_rule_id, ...(Array.isArray(account.contribution_limit_rule_ids) ? account.contribution_limit_rule_ids : [])];
    const keys = [...new Set(objects(model, "TaxRule").filter(rule => ruleIds.includes(rule.tax_rule_id)).flatMap(rule => Array.isArray(rule.contribution_limits) ? rule.contribution_limits : [])
      .flatMap(limit => isFactRecord(limit) && limit.kind === "401k_additions" && typeof limit.bucket_key === "string" ? [limit.bucket_key.slice("401k_additions:".length)] : []))];
    const sponsorId = typeof params.planKey === "string" ? params.planKey : keys.length === 1 ? keys[0] : undefined;
    return [{ id: String(primitive.primitive_instance_id), label: `${params.adapter === "d1-historical-contribution-scope/v1" ? "Recorded history" : "Saved contribution"} · ${String(holding.symbol ?? account.name ?? "Investment account")}`,
      scope: { personId: String(person.person_id), householdId: String(person.household_id), taxYear: raw.taxYear,
        ...(sponsorId === undefined ? {} : { sponsorId }) } satisfies FactScope,
      holdingId: String(holding.investment_id), accountId: String(account.account_id), accountType: String(account.account_type), facts: raw }];
  }).sort((a, b) => a.id.localeCompare(b.id));
}
export function annualFactScope(field: AnnualField, scope: FactScope): FactScope {
  const family = annualFieldOwners[field];
  return { personId: field === "filingStatus" ? scope.householdId ?? scope.personId : scope.personId, taxYear: scope.taxYear,
    ...(scope.householdId === undefined ? {} : { householdId: scope.householdId }),
    ...(family.sponsor && scope.sponsorId !== undefined ? { sponsorId: scope.sponsorId } : {}) };
}
const numericFields = new Set<AnnualField>(["taxableCompensation", "eligiblePlanCompensation", "priorYearSponsorWages", "rothMagi", "deductionMagi", "hsaFamilyAllocation"]);
const booleanFields = new Set<AnnualField>(["planHasRoth", "hsaFullYearEligible", "workplacePlanCovered", "spouseWorkplacePlanCovered", "livesWithSpouse"]);
export function resolveAnnualFinancialFact(model: PortableModelEnvelope, field: AnnualField, context: FactScope, openingReference?: string): ResolvedFact<JsonValue> {
  const family = annualFieldOwners[field], scope = annualFactScope(field, context);
  const repair = { owner: family.owner === "people" ? "Settings → Household & People" : family.owner === "income" ? "Money → Income" : "Net Worth → Investments & retirement",
    entityType: "Person" as const, entityId: context.personId, field };
  if (field === "ageAtYearEnd") return resolveAgeAtYearEnd(model, scope.personId, scope.taxYear);
  const original = contributionFactSources(model).filter(source => factScopeKey(annualFactScope(field, source.scope)) === factScopeKey(scope) && source.facts[field] !== undefined &&
    (field.startsWith("hsa") ? source.accountType.startsWith("hsa") : family.sponsor ? source.accountType.endsWith("_401k") : source.accountType.endsWith("_ira")))
    .map(source => ({ id: source.id, label: source.label, scope, value: source.facts[field]!, provenance: "observed" as const, ruleVersion: "d1-explicit-year-fact/v1" }));
  const records = objects(model, "PrimitiveInstance").flatMap(item => {
    const params = item.parameters;
    if (!isFactRecord(params) || params.adapter !== financialFactAdapter || params.field !== field || !isFactRecord(params.scope) || factScopeKey(annualFactScope(field, params.scope as unknown as FactScope)) !== factScopeKey(scope) || params.value === undefined) return [];
    return [{ id: String(item.primitive_instance_id), label: params.provenance === "assumption" ? "Confirmed future-year assumption" : "Confirmed source correction", scope, value: params.value, provenance: params.provenance === "assumption" ? "assumption" as const : "observed" as const, ruleVersion: financialFactAdapter }];
  });
  // A correction is explicit and names the exact observations reconciled. New
  // imported contradictions still appear; no timestamp or last-write precedence.
  const reconciledValues = new Set(objects(model, "PrimitiveInstance").flatMap(item => {
    const params = item.parameters;
    return isFactRecord(params) && params.adapter === financialFactAdapter && params.field === field && isFactRecord(params.scope) && factScopeKey(annualFactScope(field, params.scope as unknown as FactScope)) === factScopeKey(scope) && Array.isArray(params.originalSources)
      ? params.originalSources.flatMap(value => isFactRecord(value) ? [`${String(value.id)}:${canonicalSerialize(value.value)}`] : []) : [];
  }));
  const legacy = field === "filingStatus" && openingReference?.slice(0, 4) === String(scope.taxYear)
    ? [...objects(model, "Household").filter(item => item.household_id === scope.householdId), ...objects(model, "Person").filter(item => item.household_id === scope.householdId)]
      .flatMap(item => item.filing_status == null ? [] : [{ id: String(item.person_id ?? item.household_id),
        label: `${String(item.name ?? item.first_name ?? "Household member")} · filing status as of ${openingReference!.slice(0, 10)}`,
        scope, value: item.filing_status === "qualifying_widow_er" ? "qualifying_surviving_spouse" : item.filing_status,
        provenance: "legacy_snapshot" as const, ruleVersion: "legacy-opening-year/v1" }]) : [];
  const result = resolveScopedFact({ semanticId: family.semanticId, scope, repair, dependencies: ["plan.projection_year"],
    sources: [...[...original, ...legacy].filter(source => !reconciledValues.has(`${source.id}:${canonicalSerialize(source.value)}`)), ...records], equal: (a, b) => {
      if (numericFields.has(field) && typeof a === "string" && typeof b === "string") {
        try { return decimal(a).equals(decimal(b)); } catch { return false; }
      }
      return canonicalSerialize(a) === canonicalSerialize(b);
    } });
  if (field === "filingStatus" && result.sources.some(source => !["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"].includes(String(source.value)))) {
    const { value: _value, ...rest } = result;
    return { ...rest, status: "true_conflict", reason: "A recorded annual filing status is invalid. Confirm the correct status for this year." };
  }
  return result;
}

/** Explicit atomic reconciliation. Preserves original source snapshots and YTD. */
export function recordAnnualFinancialFact(model: PortableModelEnvelope, input: {
  id: string; field: AnnualField; scope: FactScope; value: JsonValue; reconciledSources: readonly string[]; openingReference?: string; provenance?: "observed" | "assumption";
}): PortableModelEnvelope {
  if (!UUID.test(input.id) || input.field === "ageAtYearEnd") throw new Error("FINANCIAL_FACT_SOURCE_INVALID");
  const scope = annualFactScope(input.field, input.scope);
  if (!Number.isSafeInteger(scope.taxYear) || scope.taxYear < 2026 || scope.taxYear > 9998) throw new Error("CONTRIBUTION_FACT_YEAR_REQUIRED");
  if (annualFieldOwners[input.field].sponsor && !scope.sponsorId) throw new Error("ANNUAL_ADDITIONS_PLAN_SCOPE_REQUIRED");
  if (numericFields.has(input.field) && (typeof input.value !== "string" || !/^\d+(\.\d+)?$/.test(input.value))) throw new Error("CONTRIBUTION_FACT_MONEY_INVALID");
  if (booleanFields.has(input.field) && typeof input.value !== "boolean") throw new Error("FINANCIAL_FACT_VALUE_INVALID");
  if (input.field === "filingStatus" && !["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"].includes(String(input.value))) throw new Error("FINANCIAL_FACT_VALUE_INVALID");
  if (input.field === "hsaCoverage" && !["self", "family"].includes(String(input.value))) throw new Error("FINANCIAL_FACT_VALUE_INVALID");
  if (!objects(model, "Person").some(person => (person.person_id === input.scope.personId || input.field === "filingStatus" && input.scope.personId === scope.householdId) && person.household_id === scope.householdId)) throw new Error("FINANCIAL_FACT_PERSON_SCOPE_INVALID");
  const existing = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === input.id);
  if (existing) throw new Error("FINANCIAL_FACT_ID_COLLISION");
  const sources = resolveAnnualFinancialFact(model, input.field, input.scope, input.openingReference).sources;
  if (sources.some(source => !input.reconciledSources.includes(source.id))) throw new Error("FINANCIAL_FACT_CONFIRM_SOURCES_REQUIRED");
  const root = objects(model, "Scenario").find(item => item.enabled === true && item.base_scenario_id == null);
  if (!root) throw new Error("PAYROLL_ROOT_SCENARIO_REQUIRED");
  // Previously normalized records are replaced only on explicit save. Their
  // immutable payloads are retained in the new record's audit history.
  const prior = objects(model, "PrimitiveInstance").filter(item => isFactRecord(item.parameters) && item.parameters.adapter === financialFactAdapter && item.parameters.field === input.field && isFactRecord(item.parameters.scope) && factScopeKey(annualFactScope(input.field, item.parameters.scope as unknown as FactScope)) === factScopeKey(scope));
  const record: CanonicalObject = { primitive_instance_id: input.id, primitive_id: "P03", enabled: false, scenario_id: root.scenario_id!, input_bindings: {},
    parameters: { adapter: financialFactAdapter, field: input.field, semanticId: annualFieldOwners[input.field].semanticId,
      scope: { ...scope }, scopeKey: factScopeKey(scope), value: input.value, provenance: input.provenance ?? "observed",
      reconciledSources: [...new Set([...input.reconciledSources, ...prior.flatMap(item => isFactRecord(item.parameters) && Array.isArray(item.parameters.reconciledSources) ? item.parameters.reconciledSources : [])])],
      originalSources: [...sources.map(source => ({ id: source.id, value: source.value, label: source.label })), ...prior.flatMap(item => isFactRecord(item.parameters) && Array.isArray(item.parameters.originalSources) ? item.parameters.originalSources : [])], priorCorrections: [...prior] } };
  return { ...model, objects: { ...model.objects, PrimitiveInstance: [...objects(model, "PrimitiveInstance").filter(item => !prior.includes(item)), record] } };
}
