import { failValidation, issueCodes } from "../../diagnostics/index.js";
import type { Instant } from "../../time/index.js";
import type { RuleCatalog } from "../contracts.js";
import { resolveEffectiveRule, validateRuleCatalog, type ResolvedRule } from "../resolver.js";
import type { FilingStatus, TaxCoreRule, TaxJurisdictionFacts } from "./contracts.js";
import { immutableTaxData } from "./definition.js";

export const createTaxCatalog = (rules: readonly TaxCoreRule[]): readonly TaxCoreRule[] => {
  validateRuleCatalog(rules);
  return immutableTaxData([...rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) failValidation({ severity: "error", code: issueCodes.ruleDefinitionInvalid, message: "Tax catalog contains a nonserializable value", entityType: "rule_catalog" });
    return encoded;
  }
  if ("toJSON" in value && typeof value.toJSON === "function") return canonical(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};

/**
 * Collision-free canonical content identity, deliberately not a lossy ad-hoc hash.
 * The versioned string is suitable for exact persistence/deduplication and basis
 * comparison. A storage adapter may index its cryptographic digest later.
 * Semantically ordered bracket arrays stay ordered; set-like collections sort.
 */
export const taxCatalogFingerprint = (rules: readonly TaxCoreRule[]): string => {
  const catalog = createTaxCatalog(rules).map((rule) => ({
    ...rule,
    ...(rule.income?.additionalTaxes === undefined ? {} : { income: { ...rule.income, additionalTaxes: [...rule.income.additionalTaxes].map((component) => ({ ...component, ...(component.composedFrom === undefined ? {} : { composedFrom: [...component.composedFrom].sort() }) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) } }),
    applicability: [...rule.applicability].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0),
    ...(rule.payroll === undefined ? {} : { payroll: [...rule.payroll].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) }),
    ...(rule.rmd === undefined ? {} : { rmd: { ...rule.rmd, divisors: [...rule.rmd.divisors].sort((a, b) => a.age - b.age) } }),
    provenance: rule.provenance.type === "synthetic_test_only" ? rule.provenance : {
      ...rule.provenance,
      sources: [...rule.provenance.sources].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0),
      limitations: [...rule.provenance.limitations].sort(),
    },
  }));
  return `tax-catalog:canonical-v1:${canonical(catalog)}`;
};

export const resolveTaxCoreRule = (
  catalog: RuleCatalog,
  jurisdiction: string,
  filingStatus: FilingStatus,
  at: Instant,
  facts: TaxJurisdictionFacts,
): ResolvedRule<"tax_core"> => {
  validateRuleCatalog(catalog);
  if (!["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"].includes(filingStatus)
    || !Array.isArray(facts.residenceJurisdictions) || !Array.isArray(facts.workJurisdictions)) {
    failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: "Tax selection requires explicit filing status, residence and work jurisdictions", entityType: "rule_binding" });
  }
  const candidates = catalog.filter((rule): rule is TaxCoreRule => rule.kind === "tax_core" && rule.jurisdiction === jurisdiction
    && (rule.filingStatus === "all" || rule.filingStatus === filingStatus)
    && rule.applicability.every((condition) => {
      if (condition.fact === "eligibility") return facts.eligibility?.[condition.key] === condition.equals;
      if ("includes" in condition) return facts[condition.fact].includes(condition.includes) === condition.present;
      const fact = facts[condition.fact];
      return fact !== undefined && fact === condition.equals;
    }));
  if (candidates.length === 0) failValidation({ severity: "error", code: issueCodes.ruleNotActive, message: `Unsupported tax coverage for ${jurisdiction}/${filingStatus} with supplied jurisdiction facts`, entityType: "rule_binding" });
  const targets = new Set(candidates.map((rule) => rule.target.targetId));
  if (targets.size !== 1) failValidation({ severity: "error", code: issueCodes.ruleDefinitionInvalid, message: "A tax jurisdiction must have one stable catalog target identity", entityType: "rule_binding" });
  return resolveEffectiveRule(catalog, candidates.map((rule) => rule.id), "tax_core", candidates[0]!.target, at);
};
