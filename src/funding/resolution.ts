import type { Instant } from "../time/index.js";
import { failValidation, issueCodes, validationIssue, type ValidationIssue } from "../diagnostics/index.js";
import type { ObligationOrRight } from "../semantics/claim.js";
import type { ClaimId, SettlementProposalId } from "../semantics/identity.js";
import {
  assertAuthoritativeSettlementProposal,
  type SettlementProposal,
} from "../semantics/settlementProposal.js";
import { Money } from "../values/index.js";
import {
  createFundingPolicy,
  type AccountId,
  type FundingPolicy,
  type FundingPolicyId,
} from "./policy.js";

export type ConstraintOutcomeStatus =
  | "fully_satisfied"
  | "partially_satisfied"
  | "deferred"
  | "unfunded"
  | "rejected"
  | "contract_default";

export interface ConstraintOutcome {
  readonly proposalId: SettlementProposalId;
  readonly claimId: ClaimId;
  readonly fundingPolicyId: FundingPolicyId;
  readonly status: ConstraintOutcomeStatus;
  readonly acceptedAmount: Money;
  readonly evaluatedAt: Instant;
}

export interface FundingAllocation {
  readonly kind: "cash_account";
  readonly accountId: AccountId;
  readonly amount: Money;
}

export type AcceptedConstraintOutcomeStatus = "fully_satisfied" | "partially_satisfied";
export type CashFundingNonAcceptanceStatus = "unfunded" | "deferred" | "contract_default";

export interface LiquidityShortfall {
  readonly proposalId: SettlementProposalId;
  readonly claimId: ClaimId;
  readonly fundingPolicyId: FundingPolicyId;
  readonly requestedAmount: Money;
  readonly fundedAmount: Money;
  readonly shortfallAmount: Money;
  readonly evaluatedAt: Instant;
}

interface FundingResolutionBase<Status extends ConstraintOutcomeStatus> {
  readonly proposal: SettlementProposal;
  readonly outcome: ConstraintOutcome & { readonly status: Status };
  readonly acceptedAmount: Money;
  readonly fundingAllocations: readonly FundingAllocation[];
  readonly liquidityShortfall?: LiquidityShortfall;
  readonly issues: readonly ValidationIssue[];
}

declare const acceptedFundingAuthority: unique symbol;
const authoritativeAcceptedFunding = new WeakSet<object>();

export type AcceptedFundingResolution = Readonly<
  FundingResolutionBase<AcceptedConstraintOutcomeStatus> & {
    readonly [acceptedFundingAuthority]: true;
  }
>;

export type UnacceptedFundingResolution = Readonly<
  FundingResolutionBase<CashFundingNonAcceptanceStatus>
>;

/** The generic cash resolver leaves `rejected` to domain-specific resolvers. */
export type FundingResolution = AcceptedFundingResolution | UnacceptedFundingResolution;

export const isAcceptedFundingResolution = (
  resolution: FundingResolution,
): resolution is AcceptedFundingResolution =>
  authoritativeAcceptedFunding.has(resolution);

export function assertAcceptedFundingResolution(
  resolution: unknown,
): asserts resolution is AcceptedFundingResolution {
  if (
    typeof resolution !== "object"
    || resolution === null
    || !authoritativeAcceptedFunding.has(resolution)
  ) {
    failValidation({
      severity: "error",
      code: issueCodes.fundingNotAuthoritative,
      message: "A settlement requires positive accepted funding produced by resolveFunding",
      entityType: "funding_resolution",
    });
  }

  const accepted = resolution as AcceptedFundingResolution;
  if (
    (accepted.outcome.status !== "fully_satisfied" && accepted.outcome.status !== "partially_satisfied")
    || !accepted.acceptedAmount.isPositive()
    || accepted.fundingAllocations.length === 0
  ) {
    failValidation({
      severity: "error",
      code: issueCodes.settlementAmountInvalid,
      message: "Accepted funding must have a positive amount, allocation, and accepted outcome",
      entityType: "funding_resolution",
    });
  }

  const allocated = accepted.fundingAllocations.reduce(
    (total, allocation) => total.plus(allocation.amount),
    Money.zero(accepted.acceptedAmount.currency),
  );
  if (
    !allocated.equals(accepted.acceptedAmount)
    || accepted.outcome.proposalId !== accepted.proposal.id
    || accepted.outcome.claimId !== accepted.proposal.claimId
    || (accepted.proposal.fundingPolicyId !== undefined
      && accepted.proposal.fundingPolicyId !== accepted.outcome.fundingPolicyId)
  ) {
    failValidation({
      severity: "error",
      code: issueCodes.settlementAmountInvalid,
      message: "Accepted funding authority is internally inconsistent",
      entityType: "funding_resolution",
    });
  }
}

const createLiquidityShortfall = (
  proposal: SettlementProposal,
  policy: FundingPolicy,
  fundedAmount: Money,
  evaluatedAt: Instant,
): LiquidityShortfall => {
  if (fundedAmount.isNegative() || !fundedAmount.currency.equals(proposal.requestedAmount.currency)) {
    throw new Error("Liquidity shortfall funded amount must be non-negative and use proposal currency");
  }
  const shortfallAmount = proposal.requestedAmount.minus(fundedAmount);
  if (!shortfallAmount.isPositive()) throw new Error("Liquidity shortfall amount must be positive");
  if (!proposal.requestedAmount.equals(fundedAmount.plus(shortfallAmount))) {
    throw new Error("Liquidity shortfall must reconcile requested, funded, and shortfall amounts");
  }
  return Object.freeze({
    proposalId: proposal.id,
    claimId: proposal.claimId,
    fundingPolicyId: policy.id,
    requestedAmount: proposal.requestedAmount,
    fundedAmount,
    shortfallAmount,
    evaluatedAt,
  });
};

export const resolveFunding = (
  proposal: SettlementProposal,
  claim: ObligationOrRight,
  policy: FundingPolicy,
  availableBalances: Readonly<Record<string, Money>>,
  evaluatedAt: Instant = proposal.requestedAt,
): FundingResolution => {
  assertAuthoritativeSettlementProposal(proposal);
  if (evaluatedAt < proposal.requestedAt) {
    failValidation({
      severity: "error",
      code: issueCodes.fundingBeforeProposal,
      message: `Funding for proposal ${proposal.id} cannot be evaluated before the proposal`,
      entityType: "settlement_proposal",
      entityId: proposal.id,
      fieldPath: "evaluatedAt",
    });
  }
  if (proposal.claimId !== claim.id) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: `Funding proposal ${proposal.id} does not reference claim ${claim.id}`, entityType: "settlement_proposal", entityId: proposal.id });
  }
  if (proposal.fundingPolicyId !== undefined && proposal.fundingPolicyId !== policy.id) {
    failValidation({ severity: "error", code: issueCodes.fundingPolicyInvalid, message: `Proposal ${proposal.id} references a different funding policy`, entityType: "settlement_proposal", entityId: proposal.id, relatedIds: [proposal.fundingPolicyId, policy.id] });
  }
  createFundingPolicy(policy);

  let remaining = proposal.requestedAmount;
  const potentialAllocations: FundingAllocation[] = [];
  for (const source of policy.orderedSources) {
    const balance = availableBalances[source.accountId];
    if (balance === undefined) {
      failValidation({ severity: "error", code: issueCodes.fundingSourceNotFound, message: `Funding source account ${source.accountId} was not found`, entityType: "funding_policy", entityId: policy.id, relatedIds: [source.accountId] });
    }
    const available = balance as Money;
    if (!available.currency.equals(proposal.requestedAmount.currency)) {
      failValidation({ severity: "error", code: issueCodes.fundingCurrencyMismatch, message: `Funding source ${source.accountId} currency does not match proposal`, entityType: "funding_policy", entityId: policy.id, relatedIds: [source.accountId] });
    }
    if (available.isNegative()) {
      failValidation({ severity: "error", code: issueCodes.fundingPolicyInvalid, message: `Funding source ${source.accountId} has a negative available balance`, entityType: "funding_policy", entityId: policy.id, relatedIds: [source.accountId] });
    }
    if (remaining.isZero() || available.isZero()) continue;
    const amount = available.compare(remaining) >= 0 ? remaining : available;
    potentialAllocations.push(Object.freeze({ kind: "cash_account", accountId: source.accountId, amount }));
    remaining = remaining.minus(amount);
  }

  const potentiallyFunded = proposal.requestedAmount.minus(remaining);
  const fullyFunded = remaining.isZero();
  const acceptsPartial = !fullyFunded && policy.allowPartial && potentiallyFunded.isPositive();
  const acceptedAmount = fullyFunded || acceptsPartial ? potentiallyFunded : Money.zero(proposal.requestedAmount.currency);
  const allocations = fullyFunded || acceptsPartial ? potentialAllocations : [];
  const status: AcceptedConstraintOutcomeStatus | CashFundingNonAcceptanceStatus = fullyFunded
    ? "fully_satisfied"
    : acceptsPartial
      ? "partially_satisfied"
      : policy.insufficientFundsBehavior;
  const liquidityShortfall = fullyFunded
    ? undefined
    : createLiquidityShortfall(proposal, policy, potentiallyFunded, evaluatedAt);
  const issues = liquidityShortfall === undefined ? [] : [validationIssue({
    severity: "warning",
    code: issueCodes.liquidityShortfall,
    message: `Settlement proposal ${proposal.id} has a liquidity shortfall of ${liquidityShortfall.shortfallAmount.amount.toString()} ${liquidityShortfall.shortfallAmount.currency.code}`,
    entityType: "settlement_proposal",
    entityId: proposal.id,
    relatedIds: [claim.id, policy.id],
  })];
  const outcome = Object.freeze({ proposalId: proposal.id, claimId: claim.id, fundingPolicyId: policy.id, status, acceptedAmount, evaluatedAt });
  const resolution = {
    proposal,
    outcome,
    acceptedAmount,
    fundingAllocations: Object.freeze(allocations),
    ...(liquidityShortfall === undefined ? {} : { liquidityShortfall }),
    issues: Object.freeze(issues),
  };
  if (status === "fully_satisfied" || status === "partially_satisfied") {
    const accepted = Object.freeze({
      ...resolution,
      outcome: outcome as ConstraintOutcome & { readonly status: AcceptedConstraintOutcomeStatus },
    }) as AcceptedFundingResolution;
    authoritativeAcceptedFunding.add(accepted);
    return accepted;
  }
  return Object.freeze({
    ...resolution,
    outcome: outcome as ConstraintOutcome & { readonly status: CashFundingNonAcceptanceStatus },
  });
};
