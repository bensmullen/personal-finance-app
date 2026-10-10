"use client";
import { getPersonalPurchasePlans, getPayrollContributionPlans, getHistoricalContributionScopes, type PersonalDraft } from "../../src/application/personalMvp.js";
import { objectEntries, referenceLabel } from "../entityPresentation.js";
import { financialField } from "./fieldContract.js";

const factFields: Readonly<Record<string, string>> = { ageAtYearEnd: "age", taxableCompensation: "taxableCompensation", eligiblePlanCompensation: "eligiblePlanCompensation", priorYearSponsorWages: "priorYearSponsorWages", planHasRoth: "planHasRoth", hsaFullYearEligible: "hsaFullYearEligible", hsaCoverage: "hsaCoverage", hsaFamilyAllocation: "hsaFamilyAllocation", filingStatus: "filingStatus", rothMagi: "rothMagi" };
const applies = (key: string, character: string) => key === "ageAtYearEnd" || (character.endsWith("_hsa") ? key.startsWith("hsa") : character.endsWith("_ira") ? ["taxableCompensation", "filingStatus", ...(character === "roth_ira" ? ["rothMagi"] : [])].includes(key) : ["eligiblePlanCompensation", "priorYearSponsorWages", "planHasRoth"].includes(key));
/** All alternate account/holding surfaces link to the same future-plan editor. Historical policies stay distinct. */
export function EligibilitySummary({ draft, accountId, investmentId, review }: { draft: PersonalDraft; accountId?: string; investmentId?: string; review?: (id: string, kind: "personal" | "payroll") => void }) {
  try {
    const policies = [...getPersonalPurchasePlans(draft).flatMap(plan => plan.contribution ? [{ investmentId: plan.investmentId, policy: plan.contribution, kind: "personal" as const }] : []), ...getPayrollContributionPlans(draft).map(plan => ({ investmentId: String(plan.allocation.positionId), policy: plan.allocation.policy, kind: "payroll" as const }))];
    const holdings = objectEntries(draft, "Investment");
    const rows = policies.filter(row => investmentId ? row.investmentId === investmentId : holdings.some(holding => holding.account_id === accountId && holding.investment_id === row.investmentId));
    if (!rows.length) return null;
    const history = getHistoricalContributionScopes(draft);
    return <details className="financial-section"><summary>Saved annual eligibility</summary><p>These facts help estimate contribution limits. Review/edit changes the existing contribution plan; this summary is read-only.</p>{rows.map(row => <section key={`${row.kind}:${row.investmentId}`} aria-label={`Eligibility for ${referenceLabel(draft, "Investment", row.investmentId)}`}><strong>Future {row.policy.character.replaceAll("_", " ")} · {referenceLabel(draft, "Investment", row.investmentId)}</strong><p>{referenceLabel(draft, "Person", row.policy.personId)} · {row.policy.facts.taxYear} · {row.policy.limits.find(limit => limit.kind === "401k_additions")?.bucketKey.slice("401k_additions:".length) ?? "Personal annual allowance"}</p><dl>{Object.entries(factFields).filter(([key]) => applies(key, row.policy.character)).map(([key, field]) => {
      const value = row.policy.facts[key as keyof typeof row.policy.facts];
      return <div key={key}><dt>{financialField(field).label}</dt><dd>{value === undefined ? "Not recorded · capacity may need review" : typeof value === "object" ? `${value.amount.toString()} USD` : typeof value === "boolean" ? value ? "Yes" : "No" : String(value).replaceAll("_", " ")}</dd></div>;
    })}</dl>{history.filter(scope => scope.investmentId === row.investmentId).map(scope => <p key={scope.id}>Separate prior-history scope · {scope.policy.facts.taxYear}. Review historical account or employer plan under Current Plan → Contributions already made this year. Shared facts in the same holding/year must agree; this forecast never silently combines different employers or years.</p>)}{review && <button type="button" onClick={() => review(row.investmentId, row.kind)}>Review/edit eligibility for {referenceLabel(draft, "Investment", row.investmentId)}</button>}</section>)}</details>;
  } catch { return <p role="note">Saved eligibility needs review in Current Plan’s contribution editors.</p>; }
}
