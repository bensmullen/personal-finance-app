import type { VerticalSlice4Input } from "../../simulation/verticalSlice4.js";

export interface MortgageFundingContext {
  readonly liabilityId: string;
  readonly fundingAccountIds: readonly string[];
  readonly settlementPriority?: number;
}
/** Preserve execution bindings at result creation, rather than reading edited session settings. */
export function mortgageFundingContext(input: VerticalSlice4Input | undefined, policyId: string): MortgageFundingContext | undefined {
  const matches = input?.loans.flatMap<MortgageFundingContext>(loan => {
    if (String(loan.fundingPolicy.id) === policyId) return [{ liabilityId: String(loan.principalLiabilityId), fundingAccountIds: loan.fundingPolicy.orderedSources.map(source => String(source.accountId)), settlementPriority: loan.settlementPriority }];
    return (loan.extraPrincipalPayments ?? []).filter(extra => String(extra.fundingPolicy.id) === policyId).map(extra => ({ liabilityId: String(loan.principalLiabilityId), fundingAccountIds: extra.fundingPolicy.orderedSources.map(source => String(source.accountId)) }));
  }) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}
