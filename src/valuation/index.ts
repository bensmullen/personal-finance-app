import type { AccountState, AuthoritativeState, PositionState } from "../state/index.js";
import { type Currency, Money, sumMoney } from "../values/index.js";

/** Static valuation rule already used by the current single-period runners. */
export const positionMarketValue = (position: PositionState): Money =>
  position.price.times(position.quantity.amount);

export const totalPositionMarketValue = (
  positions: Iterable<PositionState>,
  currency: Currency,
): Money => sumMoney([...positions].map(positionMarketValue), currency);

export const accountValue = (
  account: AccountState,
  positions: Iterable<PositionState>,
): Money => account.cash.plus(sumMoney(
  [...positions].filter((position) => position.accountId === account.id).map(positionMarketValue),
  account.cash.currency,
));

export const accountValueFromState = (state: AuthoritativeState, accountId: string): Money => {
  const account = state.accounts[accountId];
  if (account === undefined) throw new Error(`Unknown account ${accountId}`);
  return accountValue(account, Object.values(state.positions));
};
