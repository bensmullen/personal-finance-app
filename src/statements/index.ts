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

/** Compact accounting flows; the accumulator never retains transaction objects. */
export type StatementFlows = Pick<Statements,
  "income" | "expenses" | "gains" | "operatingCashFlow" | "investingCashFlow" | "financingCashFlow">;

export const createStatementFlowAccumulator = (currency: Currency) => {
  let income = Money.zero(currency);
  let expenses = Money.zero(currency);
  let gains = Money.zero(currency);
  let operatingCashFlow = Money.zero(currency);
  let investingCashFlow = Money.zero(currency);
  let financingCashFlow = Money.zero(currency);
  return {
    add(transaction: AccountingTransaction): void {
      for (const leg of transaction.legs) {
        if (leg.type === "income" && leg.posting === "credit") income = income.plus(leg.amount);
        if ((leg.type === "expense" || leg.type === "tax") && leg.posting === "debit") expenses = expenses.plus(leg.amount);
        if (leg.type === "gain" && leg.posting === "credit") gains = gains.plus(leg.amount);
      }
      operatingCashFlow = operatingCashFlow.plus(cashFlowAmount(transaction, "operating", currency));
      investingCashFlow = investingCashFlow.plus(cashFlowAmount(transaction, "investing", currency));
      financingCashFlow = financingCashFlow.plus(cashFlowAmount(transaction, "financing", currency));
    },
    snapshot(): StatementFlows {
      return Object.freeze({ income, expenses, gains, operatingCashFlow, investingCashFlow, financingCashFlow });
    },
  };
};

export interface VerticalSliceStatements {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly income: Money;
  readonly expenses: Money;
  readonly netIncome: Money;
  readonly operatingCashFlow: Money;
}

export interface CurrentPositionTotals {
  readonly cash: Money;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
}

/** Accounting authority for static current-position balance-sheet aggregation. */
export const deriveCurrentPositionTotals = (
  cashBalances: readonly Money[],
  nonCashAssetValues: readonly Money[],
  liabilityBalances: readonly Money[],
  currency: Currency,
): CurrentPositionTotals => {
  const cash = sumMoney(cashBalances, currency);
  const assets = cash.plus(sumMoney(nonCashAssetValues, currency));
  const liabilities = sumMoney(liabilityBalances, currency);
  return Object.freeze({ cash, assets, liabilities, netWorth: assets.minus(liabilities) });
};

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
  const flows = createStatementFlowAccumulator(currency);
  for (const transaction of transactions) flows.add(transaction);
  return deriveStatementsFromFlows(state, flows.snapshot(), currency);
};

/** The same statement authority accepts streamed flows at a commit boundary. */
export const deriveStatementsFromFlows = (
  state: AuthoritativeState,
  flows: StatementFlows,
  currency: Currency,
): Statements => {
  const balances = balanceSheet(state, currency);
  return Object.freeze({
    assets: balances.assets,
    liabilities: balances.liabilities,
    netWorth: balances.netWorth,
    ...flows,
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
