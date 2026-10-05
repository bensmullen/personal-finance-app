import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import type { AuthoritativeState } from "../../state/index.js";
import { deriveD1ContributionCapacity } from "../../rules/contribution2026.js";
import { Money, USD } from "../../values/index.js";
import { durablePersonalPurchaseInstructions } from "./personalPurchases.js";
import { durablePayrollAllocations } from "./payrollAuthoring.js";
import { objects } from "./shared.js";

export interface ContributionCapacityReadModel {
  readonly accountId: string; readonly year: number; readonly bucketIdentity: string; readonly categories: readonly string[];
  readonly annualLimit?: string; readonly yearToDate?: string; readonly remaining?: string; readonly diagnostics: readonly string[];
}
/** Capacity uses the same law facts and committed ledger as execution, never the account balance. */
export const contributionCapacityReadModel = (model: PortableModelEnvelope, state?: AuthoritativeState): readonly ContributionCapacityReadModel[] => {
  const plans = [...durablePersonalPurchaseInstructions(model).flatMap(item => item.contribution === undefined ? [] : [{ accountId: String(item.contribution.limits.find(binding => binding.target.targetType === "account")?.target.targetId ?? ""), investmentId: item.investmentId, policy: item.contribution }]),
    ...durablePayrollAllocations(model).map(item => ({ accountId: String(item.allocation.accountId), investmentId: String(item.allocation.positionId), policy: item.allocation.policy }))];
  const rows = new Map<string, ContributionCapacityReadModel>();
  for (const plan of plans) {
    const investment = objects(model, "Investment").find(value => value.investment_id === plan.investmentId);
    const accountId = plan.accountId || String(investment?.account_id ?? "");
    for (const binding of plan.policy.limits.filter(item => item.includedCharacters.includes(plan.policy.character))) {
      const year = plan.policy.facts.taxYear, identity = `${binding.target.targetType}:${binding.target.targetId}:${binding.bucketKey}:${year}`;
      const capacity = deriveD1ContributionCapacity(binding.kind, plan.policy.facts);
      const used = Object.values(state?.contributions ?? {}).flatMap(entry => entry.buckets.filter(bucket => bucket.identity === identity)).reduce((sum, bucket) => sum.plus(bucket.amount), Money.zero(USD));
      rows.set(`${accountId}:${identity}`, capacity.status === "incomplete" ? { accountId, year, bucketIdentity: identity, categories: binding.includedCharacters, diagnostics: capacity.diagnostics }
        : { accountId, year, bucketIdentity: identity, categories: binding.includedCharacters, annualLimit: capacity.capacity.amount.toString(), ...(state === undefined ? {} : { yearToDate: used.amount.toString(), remaining: used.compare(capacity.capacity) >= 0 ? "0" : capacity.capacity.minus(used).amount.toString() }), diagnostics: [] });
    }
  }
  for (const account of objects(model, "Account")) if (["traditional_ira", "roth_ira", "traditional_401k", "roth_401k", "hsa", "hsa_investment"].includes(String(account.account_type)) && ![...rows.values()].some(row => row.accountId === account.account_id)) {
    const accountId = String(account.account_id);
    rows.set(accountId, { accountId, year: 2026, bucketIdentity: "unconfigured", categories: [], diagnostics: ["Author annual eligibility facts and contribution scope to determine capacity."] });
  }
  return Object.freeze([...rows.values()].sort((a, b) => `${a.accountId}:${a.bucketIdentity}`.localeCompare(`${b.accountId}:${b.bucketIdentity}`)));
};
