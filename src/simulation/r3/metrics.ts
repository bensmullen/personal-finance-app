import type { AuthoritativeState } from "../../state/index.js";
import { Money, type Currency } from "../../values/index.js";
import type { ExecutableHouseholdProjection } from "../householdExecution.js";
import { deriveHouseholdClosingMetrics } from "../householdProjection.js";
/** Accounting receivables are assets but are not portfolio holdings. */
export const householdExecutionMetrics = (state: AuthoritativeState, currency: Currency, input: ExecutableHouseholdProjection) => {
  const metrics = deriveHouseholdClosingMetrics(state, currency, input.standaloneAssets);
  const excluded = (input.nonInvestmentPositionIds ?? []).reduce((sum, id) => sum.plus(state.positions[id]?.carryingValue ?? Money.zero(currency)), Money.zero(currency));
  return Object.freeze({ ...metrics, investmentValue: metrics.investmentValue.minus(excluded) });
};
