import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import type { AuthoritativeState } from "../../state/index.js";
import { deriveD1ContributionCapacity } from "../../rules/contribution2026.js";
import { Money, USD } from "../../values/index.js";
import { durablePersonalPurchaseInstructions } from "./personalPurchases.js";
import { durablePayrollAllocations } from "./payrollAuthoring.js";
import { objects } from "./shared.js";
import { compileOpeningContributionUsage, savedOpeningContributionUsage } from "./contributionOpening.js";

export interface ContributionCapacityReadModel {
  readonly accountId: string; readonly year: number; readonly bucketIdentity: string; readonly categories: readonly string[];
  readonly annualLimit?: string; readonly yearToDate?: string; readonly remaining?: string; readonly diagnostics: readonly string[];
  readonly openingUsage?: string; readonly forecastUsage?: string;
}
/** Capacity uses the same law facts and committed ledger as execution, never the account balance. */
export const contributionCapacityReadModel = (model: PortableModelEnvelope, state?: AuthoritativeState): readonly ContributionCapacityReadModel[] => {
  const plans = [...durablePersonalPurchaseInstructions(model).flatMap(item => item.contribution === undefined ? [] : [{ accountId: String(item.contribution.limits.find(binding => binding.target.targetType === "account")?.target.targetId ?? ""), investmentId: item.investmentId, policy: item.contribution }]),
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
  return Object.freeze([...rows.values()].sort((a, b) => `${a.accountId}:${a.bucketIdentity}`.localeCompare(`${b.accountId}:${b.bucketIdentity}`)));
};
