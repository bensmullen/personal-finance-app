import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { DomainId } from "../identity/index.js";

declare const fundingPolicyIdBrand: unique symbol;
export type FundingPolicyId = string & { readonly [fundingPolicyIdBrand]: "FundingPolicyId" };
export type AccountId = DomainId<"account">;

export const fundingPolicyId = (value: string): FundingPolicyId => {
  if (value.trim().length === 0) throw new Error("Funding policy identity cannot be empty");
  return value as FundingPolicyId;
};

export interface CashAccountFundingSource {
  readonly kind: "cash_account";
  readonly accountId: AccountId;
}

export type FundingSource = CashAccountFundingSource;
export type InsufficientFundsBehavior = "unfunded" | "deferred" | "contract_default";

export interface FundingPolicy {
  readonly id: FundingPolicyId;
  readonly orderedSources: readonly FundingSource[];
  readonly allowPartial: boolean;
  readonly insufficientFundsBehavior: InsufficientFundsBehavior;
}

export const createFundingPolicy = (draft: FundingPolicy): FundingPolicy => {
  if (draft.orderedSources.length === 0) {
    failValidation({ severity: "error", code: issueCodes.fundingPolicyInvalid, message: `Funding policy ${draft.id} must declare at least one source`, entityType: "funding_policy", entityId: draft.id, fieldPath: "orderedSources" });
  }
  const seen = new Set<string>();
  for (const source of draft.orderedSources) {
    if (source.kind !== "cash_account" || source.accountId === undefined) {
      failValidation({ severity: "error", code: issueCodes.fundingPolicyInvalid, message: `Funding policy ${draft.id} contains an unsupported source`, entityType: "funding_policy", entityId: draft.id, fieldPath: "orderedSources" });
    }
    if (seen.has(source.accountId)) {
      failValidation({ severity: "error", code: issueCodes.fundingPolicyInvalid, message: `Funding policy ${draft.id} repeats cash account ${source.accountId}`, entityType: "funding_policy", entityId: draft.id, relatedIds: [source.accountId] });
    }
    seen.add(source.accountId);
  }
  return Object.freeze({
    ...draft,
    orderedSources: Object.freeze(draft.orderedSources.map((source) => Object.freeze({ ...source }))),
  });
};
