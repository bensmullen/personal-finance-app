import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import type { AuthoritativeState } from "../../state/index.js";
import { deriveD1ContributionCapacity } from "../../rules/contribution2026.js";
import { Money, USD } from "../../values/index.js";
import { durablePersonalPurchaseInstructions } from "./personalPurchases.js";
import { durablePayrollAllocations } from "./payrollAuthoring.js";
import { objects } from "./shared.js";
import { compileOpeningContributionUsage, savedOpeningContributionUsage } from "./contributionOpening.js";
import { historicalContributionScopes } from "./contributionHistoryScopes.js";

export interface ContributionCapacityReadModel {
  readonly provenance?: "projected_current_law";
  readonly lawVersion?: string;
  readonly accountId: string; readonly year: number; readonly bucketIdentity: string; readonly categories: readonly string[];
  readonly annualLimit?: string; readonly yearToDate?: string; readonly remaining?: string; readonly diagnostics: readonly string[];
  readonly openingUsage?: string; readonly forecastUsage?: string;
}
/** Capacity uses the same law facts and committed ledger as execution, never the account balance. */
export const contributionCapacityReadModel = (model: PortableModelEnvelope, state?: AuthoritativeState): readonly ContributionCapacityReadModel[] => {
  const plans = [...historicalContributionScopes(model).map(item => ({ ...item, accountId: "" })), ...durablePersonalPurchaseInstructions(model).flatMap(item => item.contribution === undefined ? [] : [{ accountId: String(item.contribution.limits.find(binding => binding.target.targetType === "account")?.target.targetId ?? ""), investmentId: item.investmentId, policy: item.contribution }]),
    ...durablePayrollAllocations(model).map(item => ({ accountId: String(item.allocation.accountId), investmentId: String(item.allocation.positionId), policy: item.allocation.policy }))];
  const rows = new Map<string, ContributionCapacityReadModel>();
  let opening: AuthoritativeState["contributions"];
  let openingDiagnostic: string | undefined;
  try {
    const saved = savedOpeningContributionUsage(model);
    opening = saved === undefined ? undefined : compileOpeningContributionUsage(model, saved.asOf).contributions;
  } catch (error) { openingDiagnostic = String(error); }
  for (const plan of plans) {
    const investment = objects(model, "Investment").find(value => value.investment_id === plan.investmentId);
    const accountId = plan.accountId || String(investment?.account_id ?? "");
    for (const binding of plan.policy.limits.filter(item => item.includedCharacters.includes(plan.policy.character))) {
      const year = plan.policy.facts.taxYear, identity = `${binding.target.targetType}:${binding.target.targetId}:${binding.bucketKey}:${year}`;
      const capacity = deriveD1ContributionCapacity(binding.kind, plan.policy.facts);
      const ledger = Object.values(state?.contributions ?? opening ?? {});
      const sum = (entries: typeof ledger) => entries.flatMap(entry => entry.buckets.filter(bucket => bucket.identity === identity)).reduce((total, bucket) => total.plus(bucket.amount), Money.zero(USD));
      const used = sum(ledger), prior = sum(ledger.filter(entry => entry.source === "opening")), forecast = sum(ledger.filter(entry => entry.source !== "opening"));
      const usageKnown = state !== undefined || opening !== undefined;
      rows.set(`${accountId}:${identity}`, capacity.status === "incomplete" ? { accountId, year, bucketIdentity: identity, categories: binding.includedCharacters, diagnostics: capacity.diagnostics }
        : { accountId, year, bucketIdentity: identity, categories: binding.includedCharacters, annualLimit: capacity.capacity.amount.toString(), ...(!usageKnown || openingDiagnostic ? {} : { openingUsage: prior.amount.toString(), forecastUsage: forecast.amount.toString(), yearToDate: used.amount.toString(), remaining: used.compare(capacity.capacity) >= 0 ? "0" : capacity.capacity.minus(used).amount.toString() }), diagnostics: openingDiagnostic ? [openingDiagnostic] : usageKnown ? [] : ["Supply authoritative prior YTD usage for a mid-year start, or run a January 1 forecast."] });
    }
  }
  for (const account of objects(model, "Account")) if (["traditional_ira", "roth_ira", "traditional_401k", "roth_401k", "hsa", "hsa_investment"].includes(String(account.account_type)) && ![...rows.values()].some(row => row.accountId === account.account_id)) {
    const accountId = String(account.account_id);
    rows.set(accountId, { accountId, year: 2026, bucketIdentity: "unconfigured", categories: [], diagnostics: ["Author annual eligibility facts and contribution scope to determine capacity."] });
  }
  // Future rows read the committed authoritative buckets, including their law
  // provenance. They never recalculate capacity with the opening year's facts.
  const projectedEntries = Object.values(state?.contributions ?? {}).filter(entry => entry.source !== "opening");
  const projectedUsage = new Map<string, Money>();
  for (const entry of projectedEntries) for (const bucket of entry.buckets) if (bucket.facts?.provenance === "projected_current_law") projectedUsage.set(bucket.identity, (projectedUsage.get(bucket.identity) ?? Money.zero(USD)).plus(bucket.amount));
  for (const entry of projectedEntries) for (const bucket of entry.buckets) {
    if (bucket.facts?.provenance !== "projected_current_law") continue;
    const year = Number(entry.at.slice(0, 4));
    const used = projectedUsage.get(bucket.identity)!;
    rows.set(`${entry.accountId}:${bucket.identity}`, { accountId: entry.accountId, year, bucketIdentity: bucket.identity,
      categories: plans.flatMap(plan => plan.policy.limits).find(binding => `${binding.target.targetType}:${binding.target.targetId}:${binding.bucketKey}:${year}` === bucket.identity)?.includedCharacters ?? [entry.character],
      annualLimit: bucket.annualLimit.amount.toString(), openingUsage: "0", forecastUsage: used.amount.toString(), yearToDate: used.amount.toString(), remaining: used.compare(bucket.annualLimit) >= 0 ? "0" : bucket.annualLimit.minus(used).amount.toString(), diagnostics: [], provenance: "projected_current_law", lawVersion: String(bucket.facts.lawVersion) });
  }
  return Object.freeze([...rows.values()].sort((a, b) => `${a.accountId}:${a.bucketIdentity}`.localeCompare(`${b.accountId}:${b.bucketIdentity}`)));
};
