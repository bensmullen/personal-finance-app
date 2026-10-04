import type { OperationCommutativity } from "./operations.js";

/**
 * The mortgage consumes zero cash and observes invariant total pool liquidity.
 * Its claim/primitive writes are disjoint from a fixed owned-account transfer.
 * Source allocation is absent for the unfunded mortgage; transfer feasibility,
 * accepted amounts, postings and mortgage shortfall therefore remain identical.
 */
export const fundingPoolConservationProof = (
  contracts: readonly (OperationCommutativity | undefined)[],
): boolean => {
  if (contracts.length !== 2) return false;
  const transfer = contracts.find(contract => contract?.kind === "fixed_owned_transfer");
  const mortgage = contracts.find(contract => contract?.kind === "guaranteed_unfunded_pool");
  if (transfer?.kind !== "fixed_owned_transfer" || mortgage?.kind !== "guaranteed_unfunded_pool") return false;
  if (transfer.primitiveIds.some(id => mortgage.primitiveIds.includes(id))) return false;
  return mortgage.accounts.includes(transfer.source) && mortgage.accounts.includes(transfer.destination);
};
