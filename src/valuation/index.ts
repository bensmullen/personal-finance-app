import type { PositionState } from "../state/index.js";
import { type Currency, Money, sumMoney } from "../values/index.js";

/** Static valuation rule already used by the current single-period runners. */
export const positionMarketValue = (position: PositionState): Money =>
  position.price.times(position.quantity.amount);

export const totalPositionMarketValue = (
  positions: Iterable<PositionState>,
  currency: Currency,
): Money => sumMoney([...positions].map(positionMarketValue), currency);
