import { dollars, money, month, runVerticalSlicePeriod, type VerticalSliceInput } from "./verticalSlice1.js";

export interface DemoRow {
  label: string;
  value: string;
  detail?: string;
}

export interface DemoViewModel {
  title: string;
  rows: DemoRow[];
  transactions: Array<{ type: string; amount: string; cashFlow: string }>;
}

export const buildVerticalSliceDemo = (): DemoViewModel => {
  const input: VerticalSliceInput = {
    householdId: "demo-household",
    ownerId: "demo-person",
    checkingAccountId: "demo-checking",
    retirementAccountId: "demo-retirement",
    taxLiabilityId: "demo-tax-payable",
    monthlyGrossCompensation: money("10000"),
    taxRate: 0.20,
    retirementContribution: money("2000"),
    monthlyLivingExpense: money("4000"),
  };

  const result = runVerticalSlicePeriod({
    period: month(2026, 1),
    input,
    openingState: {
      accounts: {
        [input.checkingAccountId]: { id: input.checkingAccountId, ownerId: input.ownerId, kind: "checking", cash: 0n },
        [input.retirementAccountId]: { id: input.retirementAccountId, ownerId: input.ownerId, kind: "retirement", cash: 0n },
      },
      liabilities: { [input.taxLiabilityId]: { id: input.taxLiabilityId, balance: 0n } },
      obligations: {},
      postedTransactionIds: [],
    },
  });

  return {
    title: "January household cash flow",
    rows: [
      { label: "Gross compensation", value: dollars(result.outputs.grossCompensation) },
      { label: "Tax expense", value: dollars(result.outputs.taxExpense) },
      { label: "Retirement transfer", value: dollars(result.outputs.retirementContribution), detail: "Internal household transfer" },
      { label: "Living expenses", value: dollars(result.outputs.livingExpenses) },
      { label: "Checking", value: dollars(result.outputs.checkingCash) },
      { label: "Retirement", value: dollars(result.outputs.retirementCash) },
      { label: "Tax payable", value: dollars(result.outputs.taxPayable) },
      { label: "Operating cash flow", value: dollars(result.statements.operatingCashFlow) },
      { label: "Net worth", value: dollars(result.statements.netWorth) },
    ],
    transactions: result.transactions.map((transaction) => ({
      type: transaction.type,
      amount: dollars(transaction.legs.find((leg) => leg.posting === "debit")?.amount ?? 0n),
      cashFlow: transaction.cashFlowClass,
    })),
  };
};
