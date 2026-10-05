import { alphaStateTaxCatalog, alphaLocalTaxCatalog, federalTaxCatalog, taxLawCoverageGaps } from "../../rules/tax/lawCatalog.js";
import { taxCatalogFingerprint } from "../../rules/tax/catalog.js";
import { immutableConfiguration } from "../r3/compiledHousehold.js";

/** Catalog evidence, not a claim that every household's required legal bases are supported. */
export const householdTaxCoverageMatrix = immutableConfiguration({
  fingerprint: taxCatalogFingerprint([...federalTaxCatalog, ...alphaStateTaxCatalog, ...alphaLocalTaxCatalog]),
  rules: [...federalTaxCatalog, ...alphaStateTaxCatalog, ...alphaLocalTaxCatalog].map(rule => ({ jurisdiction: rule.jurisdiction, filingStatus: rule.filingStatus,
    effectiveFrom: rule.effectiveFrom, effectiveUntil: rule.effectiveUntil, id: rule.id, version: rule.version,
    categories: [...(rule.income === undefined ? [] : ["income", ...(rule.income.additionalTaxes?.map(component => component.key) ?? [])]), ...(rule.payroll?.map(component => component.key) ?? []), ...(rule.niit === undefined ? [] : ["niit"]), ...(rule.periodicEmployeeTax === undefined ? [] : ["employee_opt"])],
    provenance: rule.provenance,
    recognition: rule.income?.basis ?? "employee_compensation", applicability: rule.applicability,
  })),
  gaps: [...taxLawCoverageGaps,
    { jurisdiction: "US:FEDERAL", taxYear: 2025, reason: "The merged verified federal catalog contains 2024 and 2026 rules, not 2025. Neither year is substituted." },
    { jurisdiction: "US:CA", reason: "Household recognition of the additional legal Form 540 taxable-income base remains incomplete." },
    { jurisdiction: "US:MA", reason: "Household recognition of the additional legal short-gain and combined-surtax bases remains incomplete." },
    { jurisdiction: "ALL", reason: "Legal taxable-base/AGI equality facts, jurisdiction periods, explicit settlement timing, and supported realized economic sources are prerequisites for affected outputs. Missing facts remain incomplete." },
    { jurisdiction: "ALL", reason: "Account distribution/contribution/RMD tax events not executed by the merged engine, intra-month earned-service allocation, net-to-gross reconstruction and T1B mechanics remain unsupported." },
    { jurisdiction: "ALL", reason: "Decreasing recognized tax liabilities require expense-reversal statement semantics beyond the merged statement accumulator; affected results remain incomplete." },
  ],
});
