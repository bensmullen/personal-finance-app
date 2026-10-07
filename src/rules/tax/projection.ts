import { domainId } from "../../identity/index.js";
import { instant } from "../../time/index.js";
import { createTaxCatalog } from "./catalog.js";
import type { TaxCoreRule } from "./contracts.js";

/** Separate forecast catalog; source-backed definitions are never modified. */
export function projectedCurrentLawCatalog(verified: readonly TaxCoreRule[], end: string): readonly TaxCoreRule[] {
  const groups = new Map<string, TaxCoreRule[]>();
  for (const rule of verified) {
    if (rule.provenance.type !== "verified_law") continue;
    const applicability = rule.jurisdiction === "US:FEDERAL" ? [] : rule.applicability;
    const key = JSON.stringify([rule.jurisdiction, rule.filingStatus, applicability.map(condition => JSON.stringify(Object.entries(condition).sort(([a], [b]) => a.localeCompare(b)))).sort()]);
    groups.set(key, [...groups.get(key) ?? [], rule]);
  }
  const projections: TaxCoreRule[] = [];
  for (const rules of groups.values()) {
    const ordered = rules.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let index = 0; index < ordered.length; index++) {
      const base = ordered[index]!;
      const until = ordered[index + 1]?.effectiveFrom ?? instant(`${end}T00:00:00.000Z`);
      const from = base.effectiveUntil < "2027-01-01T00:00:00.000Z" ? instant("2027-01-01T00:00:00.000Z") : base.effectiveUntil;
      if (from >= until || base.provenance.type !== "verified_law") continue;
      const projectedPrefix = (BigInt(`0x${base.id.slice(0, 8)}`) ^ 0x10000000n).toString(16).padStart(8, "0");
      projections.push({ ...base, id: domainId("tax-rule", `${projectedPrefix}${base.id.slice(8)}`), version: `${base.version}:projected-current-law:nominal-v1`,
        effectiveFrom: from, effectiveUntil: until,
        provenance: { ...base.provenance, type: "projected_current_law", baseRuleId: base.id, baseYear: Number(base.effectiveFrom.slice(0, 4)), policy: "nominal_carry_forward",
          limitations: [...base.provenance.limitations, "Forecast assumption: nominal carry-forward; no inflation indexing or future legislation inferred."] } });
    }
  }
  return createTaxCatalog([...verified, ...projections]);
}
