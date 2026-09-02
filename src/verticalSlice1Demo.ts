import { Percentage, RoundingPolicy, canonicalOpeningState, createFundingPolicy, createRunContext, domainId, formatMoney, fundingPolicyId, instant, money, runId, runVerticalSlicePeriod, scenarioId, summarizeCashFlowClass, utcMonth, type Money, type VerticalSliceInput } from "./verticalSlice1.js";

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

const displayMoney = (value: Money): string =>
  formatMoney(value, RoundingPolicy.currency(value.currency.minorUnitScale, "half_up"));

export const buildVerticalSliceDemo = (): DemoViewModel => {
  const checkingAccountId = domainId("account", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  const ownerId = domainId("person", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  const retirementAccountId = domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  const input: VerticalSliceInput = {
    householdId: domainId("household", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ownerId,
    checkingAccountId,
    retirementAccountId,
    taxLiabilityId: domainId("liability", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
    monthlyGrossCompensation: money("10000"),
    ruleCatalog: [
      { id: domainId("tax-rule", "30000000-0000-4000-8000-000000000011"), kind: "proportional_income_tax", target: { targetType: "person", targetId: ownerId }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveRate: Percentage.parse("20").toRatio(), postingRounding: RoundingPolicy.currency(2, "half_up") },
      { id: domainId("tax-rule", "30000000-0000-4000-8000-000000000012"), kind: "product_operation_eligibility", target: { targetType: "account", targetId: retirementAccountId }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), operation: "contribution", allowed: true },
      { id: domainId("tax-rule", "30000000-0000-4000-8000-000000000013"), kind: "annual_contribution_limit", target: { targetType: "account", targetId: retirementAccountId }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"), calendarYear: 2026, calendar: "utc", annualLimit: money("24000") },
    ],
    incomeTaxRuleIds: [domainId("tax-rule", "30000000-0000-4000-8000-000000000011")],
    retirementContribution: money("2000"),
    retirementEligibilityRuleIds: [domainId("tax-rule", "30000000-0000-4000-8000-000000000012")],
    retirementContributionLimitRuleIds: [domainId("tax-rule", "30000000-0000-4000-8000-000000000013")],
    retirementContributionUsage: { calendarYear: 2026, usedBeforePeriod: money("0") },
    monthlyLivingExpense: money("4000"),
    taxFundingPolicy: createFundingPolicy({
      id: fundingPolicyId("funding:tax:checking"),
      orderedSources: [{ kind: "cash_account", accountId: checkingAccountId }],
      allowPartial: false,
      insufficientFundsBehavior: "unfunded",
    }),
  };

  const period = utcMonth(2026, 1);
  const result = runVerticalSlicePeriod({
    period,
    input,
    openingState: canonicalOpeningState(input),
    runContext: createRunContext({
      runId: runId("11111111-1111-4111-8111-111111111111"),
      scenarioId: scenarioId("22222222-2222-4222-8222-222222222222"),
      asOf: period.start,
      dataCutoff: period.start,
      simulationStart: period.start,
      simulationEnd: period.end,
      baseCurrency: input.monthlyGrossCompensation.currency,
    }),
  });

  return {
    title: "January household cash flow",
    rows: [
      { label: "Gross compensation", value: displayMoney(result.outputs.grossCompensation) },
      { label: "Tax expense", value: displayMoney(result.outputs.taxExpense) },
      { label: "Retirement transfer", value: displayMoney(result.outputs.retirementContribution), detail: "Internal household transfer" },
      { label: "Living expenses", value: displayMoney(result.outputs.livingExpenses) },
      { label: "Checking", value: displayMoney(result.outputs.checkingCash) },
      { label: "Retirement", value: displayMoney(result.outputs.retirementCash) },
      { label: "Tax payable", value: displayMoney(result.outputs.taxPayable) },
      { label: "Operating cash flow", value: displayMoney(result.statements.operatingCashFlow) },
      { label: "Net worth", value: displayMoney(result.statements.netWorth) },
    ],
    transactions: result.transactions.map((transaction) => ({
      type: transaction.type,
      amount: displayMoney(transaction.legs.find((leg) => leg.posting === "debit")!.amount),
      cashFlow: summarizeCashFlowClass(transaction),
    })),
  };
};
