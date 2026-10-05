import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import type { FilingStatus } from "../../rules/tax/contracts.js";
import { contributionCharacters, type D1ContributionFacts, type D1CapacityKind } from "../../rules/contribution2026.js";
import type { ContributionCharacter, ContributionPolicy, ContributionLimitBinding } from "../../simulation/contributions.js";
import { domainId } from "../../identity/index.js";
import { money, USD } from "../../values/index.js";
import { normalizeContributionLimitRuleIds } from "./contributionBindings.js";
import { UUID, EXACT_DECIMAL, objects, canonicalId, type CanonicalObject } from "./shared.js";

export interface AuthoredContributionFacts {
  readonly taxYear: number;
  readonly ageAtYearEnd?: number;
  readonly taxableCompensation?: string;
  readonly eligiblePlanCompensation?: string;
  readonly filingStatus?: FilingStatus;
  readonly rothMagi?: string;
  readonly deductionMagi?: string;
  readonly livesWithSpouse?: boolean;
  readonly workplacePlanCovered?: boolean;
  readonly spouseWorkplacePlanCovered?: boolean;
  readonly priorYearSponsorWages?: string;
  readonly planHasRoth?: boolean;
  readonly hsaFullYearEligible?: boolean;
  readonly hsaCoverage?: "self" | "family";
  readonly hsaFamilyAllocation?: string;
}
const record = (value: JsonValue | undefined): value is CanonicalObject => typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (code: string): never => { throw new Error(code); };
const amount = (value: JsonValue | undefined) => value === undefined ? undefined : typeof value === "string" && EXACT_DECIMAL.test(value) && !money(value, USD).isNegative() ? money(value, USD) : fail("CONTRIBUTION_FACT_MONEY_INVALID");
const bool = (value: JsonValue | undefined) => value === undefined ? undefined : typeof value === "boolean" ? value : fail("CONTRIBUTION_FACT_BOOLEAN_INVALID");
const integer = (value: JsonValue | undefined) => value === undefined ? undefined : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail("CONTRIBUTION_FACT_INTEGER_INVALID");
export const parseContributionFacts = (value: JsonValue | undefined): D1ContributionFacts => {
  if (!record(value) || typeof value.taxYear !== "number") return fail("CONTRIBUTION_FACT_YEAR_REQUIRED");
  const status = value.filingStatus;
  if (status !== undefined && !["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"].includes(String(status))) return fail("CONTRIBUTION_FILING_STATUS_INVALID");
  const coverage = value.hsaCoverage;
  if (coverage !== undefined && coverage !== "self" && coverage !== "family") return fail("HSA_COVERAGE_INVALID");
  const hsaCoverage: "self" | "family" | undefined = coverage;
  const filingStatus: FilingStatus | undefined = status === "single" || status === "married_joint" || status === "married_separate" || status === "head_of_household" || status === "qualifying_surviving_spouse" ? status : undefined;
  const facts = { taxYear: integer(value.taxYear)!, ageAtYearEnd: integer(value.ageAtYearEnd), taxableCompensation: amount(value.taxableCompensation), eligiblePlanCompensation: amount(value.eligiblePlanCompensation),
    filingStatus,
    rothMagi: amount(value.rothMagi), deductionMagi: amount(value.deductionMagi), livesWithSpouse: bool(value.livesWithSpouse), workplacePlanCovered: bool(value.workplacePlanCovered), spouseWorkplacePlanCovered: bool(value.spouseWorkplacePlanCovered),
    priorYearSponsorWages: amount(value.priorYearSponsorWages), planHasRoth: bool(value.planHasRoth), hsaFullYearEligible: bool(value.hsaFullYearEligible), hsaCoverage, hsaFamilyAllocation: amount(value.hsaFamilyAllocation) };
  return { taxYear: facts.taxYear,
    ...(facts.ageAtYearEnd === undefined ? {} : { ageAtYearEnd: facts.ageAtYearEnd }),
    ...(facts.taxableCompensation === undefined ? {} : { taxableCompensation: facts.taxableCompensation }),
    ...(facts.eligiblePlanCompensation === undefined ? {} : { eligiblePlanCompensation: facts.eligiblePlanCompensation }),
    ...(facts.filingStatus === undefined ? {} : { filingStatus: facts.filingStatus }),
    ...(facts.rothMagi === undefined ? {} : { rothMagi: facts.rothMagi }),
    ...(facts.deductionMagi === undefined ? {} : { deductionMagi: facts.deductionMagi }),
    ...(facts.livesWithSpouse === undefined ? {} : { livesWithSpouse: facts.livesWithSpouse }),
    ...(facts.workplacePlanCovered === undefined ? {} : { workplacePlanCovered: facts.workplacePlanCovered }),
    ...(facts.spouseWorkplacePlanCovered === undefined ? {} : { spouseWorkplacePlanCovered: facts.spouseWorkplacePlanCovered }),
    ...(facts.priorYearSponsorWages === undefined ? {} : { priorYearSponsorWages: facts.priorYearSponsorWages }),
    ...(facts.planHasRoth === undefined ? {} : { planHasRoth: facts.planHasRoth }),
    ...(facts.hsaFullYearEligible === undefined ? {} : { hsaFullYearEligible: facts.hsaFullYearEligible }),
    ...(facts.hsaCoverage === undefined ? {} : { hsaCoverage: facts.hsaCoverage }),
    ...(facts.hsaFamilyAllocation === undefined ? {} : { hsaFamilyAllocation: facts.hsaFamilyAllocation }),
  };
};
export const stableContributionRuleId = (personId: string, kind: string, year: number): string => {
  let hash = 14695981039346656037n;
  for (const character of `${personId.toLowerCase()}:${kind}:${year}`) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
  return `d1c30000-0000-4000-8000-${(hash & 0xffffffffffffn).toString(16).padStart(12, "0")}`;
};

/** References published law by kind; canonical rows contain identities/scopes, not copied IRS tables. */
export const authoredContributionRules = (personId: string, kinds: readonly D1CapacityKind[], taxYear: number, scope: { readonly planKey?: string; readonly householdId?: string } = {}): readonly CanonicalObject[] => kinds.map(kind => {
  if (kind === "401k_additions" && !scope.planKey?.trim()) return fail("ANNUAL_ADDITIONS_PLAN_SCOPE_REQUIRED");
  if (kind === "hsa_family" && (!scope.householdId || !UUID.test(scope.householdId))) return fail("HSA_FAMILY_HOUSEHOLD_SCOPE_REQUIRED");
  const target = kind === "hsa_family" ? scope.householdId! : personId;
  const key = kind === "401k_additions" ? `${kind}:${scope.planKey}` : kind;
  return { tax_rule_id: stableContributionRuleId(target, key, taxYear), jurisdiction: "US", tax_type: "other", effective_date: `${taxYear}-01-01`, expiration_date: `${taxYear + 1}-01-01`, calculation_method: "custom",
    contribution_limits: [{ adapter: "d1-contribution-law/v1", kind, target_type: kind === "hsa_family" ? "household" : "person", target_id: target, bucket_key: key, included_characters: [...contributionCharacters(kind)] }] };
});

export const compileContributionPolicy = (model: PortableModelEnvelope, account: CanonicalObject, value: JsonValue | undefined): ContributionPolicy => {
  if (!record(value) || typeof value.personId !== "string" || !UUID.test(value.personId) || typeof value.householdId !== "string" || !UUID.test(value.householdId)) return fail("CONTRIBUTION_SCOPE_INVALID");
  if (String(account.owner_id).toLowerCase() !== value.personId.toLowerCase()) return fail("CONTRIBUTION_ACCOUNT_OWNER_MISMATCH");
  const person = objects(model, "Person").find(item => canonicalId(item, "person_id") === value.personId);
  const household = objects(model, "Household").find(item => canonicalId(item, "household_id") === value.householdId);
  if (!person || person.household_id !== value.householdId || !household) return fail("CONTRIBUTION_HOUSEHOLD_OWNER_MISMATCH");
  const character = value.character;
  if (character !== "traditional_ira" && character !== "roth_ira" && character !== "traditional_401k" && character !== "roth_401k" && character !== "after_tax_401k" && character !== "employee_hsa" && character !== "employer_401k" && character !== "employer_hsa") return fail("CONTRIBUTION_CHARACTER_INVALID");
  if (value.excessPolicy !== "reject" && value.excessPolicy !== "auto_cap") return fail("CONTRIBUTION_EXCESS_POLICY_INVALID");
  const limits: ContributionLimitBinding[] = normalizeContributionLimitRuleIds(account).map(ruleId => {
    const rule = objects(model, "TaxRule").find(item => canonicalId(item, "tax_rule_id") === ruleId);
    if (!rule || !Array.isArray(rule.contribution_limits) || rule.contribution_limits.length !== 1 || !record(rule.contribution_limits[0])) return fail("CONTRIBUTION_RULE_UNSUPPORTED");
    const definition = rule.contribution_limits[0];
    const kind = definition.kind;
    if (definition.adapter !== "d1-contribution-law/v1" || kind !== "ira_shared" && kind !== "roth_ira" && kind !== "401k_elective" && kind !== "401k_additions" && kind !== "hsa_individual" && kind !== "hsa_family") return fail("CONTRIBUTION_RULE_UNSUPPORTED");
    const targetId = definition.target_id, targetType = definition.target_type, bucketKey = definition.bucket_key, included = definition.included_characters;
    if (typeof targetId !== "string" || !UUID.test(targetId) || typeof bucketKey !== "string" || !Array.isArray(included) || included.some(item => typeof item !== "string") || targetType !== "account" && targetType !== "person" && targetType !== "household") return fail("CONTRIBUTION_RULE_SCOPE_INVALID");
    const facts = parseContributionFacts(value.facts);
    if (rule.effective_date !== `${facts.taxYear}-01-01` || rule.expiration_date !== `${facts.taxYear + 1}-01-01`) return fail("CONTRIBUTION_RULE_YEAR_MISMATCH");
    return { ruleId, kind, target: { targetType, targetId: domainId(targetType, targetId) }, bucketKey, includedCharacters: included.map(String) };
  });
  if (character.includes("401k") && limits.filter(binding => binding.kind === "401k_additions").length !== 1) return fail("ANNUAL_ADDITIONS_ACCOUNT_PLAN_AMBIGUOUS");
  return { character, personId: value.personId, householdId: value.householdId, facts: parseContributionFacts(value.facts), excessPolicy: value.excessPolicy, limits };
};
