import { cashFlowAmount, type AccountingLeg, type AccountingTransaction } from "../accounting/index.js";
import type { AuthoritativeState } from "../state/index.js";
import { totalPositionMarketValue } from "../valuation/index.js";
import { type Currency, Money, sumMoney } from "../values/index.js";

export interface Statements {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly income: Money;
  readonly expenses: Money;
  readonly gains: Money;
  readonly operatingCashFlow: Money;
  readonly investingCashFlow: Money;
  readonly financingCashFlow: Money;
}

export interface VerticalSliceStatements {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly income: Money;
  readonly expenses: Money;
  readonly netIncome: Money;
  readonly operatingCashFlow: Money;
}

const totalByLeg = (
  transactions: readonly AccountingTransaction[],
  currency: Currency,
  type: AccountingLeg["type"],
  side: AccountingLeg["posting"],
): Money => sumMoney(transactions.flatMap((transaction) =>
  transaction.legs.filter((leg) => leg.type === type && leg.posting === side).map((leg) => leg.amount)), currency);

const balanceSheet = (state: AuthoritativeState, currency: Currency) => {
  const cash = sumMoney(Object.values(state.accounts).map((account) => account.cash), currency);
  const assets = cash.plus(totalPositionMarketValue(Object.values(state.positions), currency));
  const liabilities = sumMoney(Object.values(state.liabilities).map((liability) => liability.balance), currency);
  return { cash, assets, liabilities, netWorth: assets.minus(liabilities) };
};

export const deriveStatements = (
  state: AuthoritativeState,
  transactions: readonly AccountingTransaction[],
  currency: Currency,
): Statements => {
  const balances = balanceSheet(state, currency);
  return Object.freeze({
    assets: balances.assets,
    liabilities: balances.liabilities,
    netWorth: balances.netWorth,
    income: totalByLeg(transactions, currency, "income", "credit"),
    expenses: totalByLeg(transactions, currency, "expense", "debit").plus(totalByLeg(transactions, currency, "tax", "debit")),
    gains: totalByLeg(transactions, currency, "gain", "credit"),
    operatingCashFlow: sumMoney(transactions.map((transaction) => cashFlowAmount(transaction, "operating", currency)), currency),
    investingCashFlow: sumMoney(transactions.map((transaction) => cashFlowAmount(transaction, "investing", currency)), currency),
    financingCashFlow: sumMoney(transactions.map((transaction) => cashFlowAmount(transaction, "financing", currency)), currency),
  });
};

export const deriveVerticalSliceStatements = (
  state: AuthoritativeState,
  transactions: readonly AccountingTransaction[],
  currency: Currency,
): VerticalSliceStatements => {
  const balances = balanceSheet(state, currency);
  const income = totalByLeg(transactions, currency, "income", "credit");
  const expenses = totalByLeg(transactions, currency, "expense", "debit").plus(totalByLeg(transactions, currency, "tax", "debit"));
  return Object.freeze({
    assets: balances.assets,
    liabilities: balances.liabilities,
    netWorth: balances.netWorth,
    income,
    expenses,
    netIncome: income.minus(expenses),
    operatingCashFlow: sumMoney(transactions.map((transaction) => cashFlowAmount(transaction, "operating", currency)), currency),
  });
};
