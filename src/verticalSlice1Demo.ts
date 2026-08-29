import { Rate, RateBasis, canonicalOpeningState, dollars, domainId, money, month, runVerticalSlicePeriod, type VerticalSliceInput } from "./verticalSlice1.js";

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
    householdId: domainId("household", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ownerId: domainId("person", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    checkingAccountId: domainId("account", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    retirementAccountId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
    taxLiabilityId: domainId("liability", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
    monthlyGrossCompensation: money("10000"),
    taxRate: Rate.fromPercentage("20", RateBasis.Proportion),
    retirementContribution: money("2000"),
    monthlyLivingExpense: money("4000"),
  };

  const result = runVerticalSlicePeriod({
    period: month(2026, 1),
    input,
    openingState: canonicalOpeningState(input),
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
      amount: dollars(transaction.legs.find((leg) => leg.posting === "debit")!.amount),
      cashFlow: transaction.cashFlowClass,
    })),
  };
};
