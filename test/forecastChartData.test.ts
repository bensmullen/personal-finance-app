import { describe, expect, it } from "vitest";
import { selectForecastChartData } from "../src/application/forecastChartData.js";
import {
  createHouseholdForecastRequest, runPersonalHouseholdForecast,
  type HouseholdForecastPoint, type HouseholdMoneyReadModel,
  type PersonalHouseholdForecastReadModel,
} from "../src/application/householdProjection.js";
import { createGoldenHouseholdDraft } from "../src/application/index.js";
import { createGoldenHouseholdSessionConfiguration, GOLDEN_HOUSEHOLD_IDS } from "../src/application/goldenHousehold.js";
import { taxDiagnostic, taxOutputCapabilities, type ProjectedCurrentLawAssumption } from "../src/simulation/tax/contracts.js";
import { Money, USD } from "../src/values/index.js";
import { instant } from "../src/time/index.js";

type AvailableForecast = Extract<PersonalHouseholdForecastReadModel, { status: "completed" | "incomplete" }>;
const money = (amount: string, currency = "USD"): HouseholdMoneyReadModel => ({ amount, currency });
const boundary = (month: number): string => new Date(Date.UTC(2024, month, 1)).toISOString();
const capabilities = taxOutputCapabilities([]);
const point = (month: number, overrides: Partial<HouseholdForecastPoint> = {}): HouseholdForecastPoint => ({
  periodStart: boundary(month), periodEnd: boundary(month + 1),
  outputCapabilities: capabilities,
  cash: money("90"), investmentValue: money("30"),
  assets: money("120"), totalAssets: money("120"),
  liabilities: money("150"), totalLiabilities: money("150"), netWorth: money("-30"),
  statementIncome: money("10.10"), statementExpenses: money("12.20"),
  debtPrincipalReduction: money("0"), gains: money("0"),
  operatingCashFlow: money("0"), investingCashFlow: money("0"), financingCashFlow: money("0"),
  investmentContributionPrincipal: money("0"), fees: money("0"), unrealizedGain: money("0"),
  debtBalances: [], liquidityShortfalls: [], traceIds: [`month:${month}`], traceRefs: [],
  ...overrides,
});
const forecast = (
  points: readonly HouseholdForecastPoint[] = [point(0), point(1)],
  overrides: Partial<AvailableForecast> = {},
): AvailableForecast => ({
  scope: "household", status: "completed", points,
  requestedHorizon: { start: points[0]?.periodStart ?? boundary(0), end: points.at(-1)?.periodEnd ?? boundary(2) },
  ...(points.length ? { reachedThrough: points.at(-1)!.periodEnd } : {}),
  asOf: "2024-02-15", dataCutoff: "2024-01-01",
  simulationStart: points[0]?.periodStart ?? boundary(0), simulationEnd: points.at(-1)?.periodEnd ?? boundary(2),
  actualForecastBoundary: "2024-02-15", actualHistoryAvailable: false,
  openingSnapshot: {
    outputCapabilities: capabilities, cash: money("100"), investmentValue: money("30"), standaloneAssetValue: money("0"),
    totalAssets: money("130"), totalLiabilities: money("150"), netWorth: money("-20"),
    accounts: [{ accountId: "checking", cash: money("20") }, { accountId: "retirement-wrapper", cash: money("80") }],
    positions: [], debts: [],
  },
  contributionCapacities: [], contingentPositions: [], retirementMilestones: [],
  liquidityShortfalls: [], debtPayoffs: [], diagnostics: [], ...overrides,
});

describe("exact household forecast chart selection", () => {
  it("maps a short golden household run without changing its read model", () => {
    const request = createHouseholdForecastRequest({
      ...createGoldenHouseholdSessionConfiguration(), simulationEnd: "2026-04-01",
    }, "94000000-0000-4000-8000-000000000129");
    const source = runPersonalHouseholdForecast(createGoldenHouseholdDraft(), request);
    expect(source.status).not.toBe("unavailable");
    if (source.status === "unavailable") throw new Error(source.message);
    const before = JSON.stringify(source);
    const result = selectForecastChartData(source);
    expect(result.status).toBe("incomplete");
    expect(result.points).toHaveLength(3);
    expect(result.opening?.metrics.totalModeledCash.amount).toBe(source.openingSnapshot.cash.amount);
    expect(result.boundaries?.reachedThrough).toBe("2026-04-01T00:00:00.000Z");
    for (const [index, sample] of result.points.entries()) {
      const raw = source.points[index]!;
      expect(sample.metrics.netWorth.amount).toBe(raw.netWorth.amount);
      expect(Money.parse(sample.metrics.totalAssets.amount!, USD)
        .minus(Money.parse(sample.metrics.totalLiabilities.amount!, USD))
        .equals(Money.parse(sample.metrics.netWorth.amount!, USD))).toBe(true);
      expect(sample.metrics.totalModeledCash.amount).toBe(raw.cash.amount);
      expect(sample.traceIds).toEqual(raw.traceIds);
    }
    const bank = source.openingSnapshot.accounts
      .filter(account => [String(GOLDEN_HOUSEHOLD_IDS.checking), String(GOLDEN_HOUSEHOLD_IDS.savings)].includes(account.accountId))
      .reduce((sum, account) => sum.plus(Money.parse(account.cash.amount, USD)), Money.zero(USD));
    expect(Money.parse(result.opening!.metrics.totalModeledCash.amount!, USD).compare(bank)).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("keeps wrapper cash distinct from bank cash and the opening separate from projected history", () => {
    const source = forecast();
    const result = selectForecastChartData(source);
    expect(result.status).toBe("complete");
    expect(result.opening).toMatchObject({ periodKind: "opening", source: "openingSnapshot", at: boundary(0) });
    expect(result.opening?.metrics.totalModeledCash.amount).toBe("100");
    expect(source.openingSnapshot.accounts[0]!.cash.amount).toBe("20");
    expect(result.interpretation.totalModeledCash).toContain("retirement");
    expect(result.interpretation.modeledStatementIncome).toContain("recognized");
    expect(result.interpretation.unsupported).toContain("bankCash");
    expect(result.actualHistoryAvailable).toBe(false);
    expect(result.points.every(sample => sample.periodKind === "projected")).toBe(true);
    expect(result.points[0]!.periodStart).toBe(boundary(0));
    expect(result.points[1]!.periodEnd).toBe("2024-03-01T00:00:00.000Z"); // leap February
    expect(result.opening?.metrics.totalModeledCashChange.amount).toBeNull();
    expect(result.opening?.metrics.modeledStatementIncome.amount).toBeNull();
    expect(result.points[0]!.metrics.netWorth.amount).toBe("-30");
  });

  it("uses opening and consecutive closing cash for exact negative, zero and positive changes", () => {
    const source = forecast([point(0), point(1), point(2, { cash: money("95.01") })]);
    const result = selectForecastChartData(source);
    expect(result.points.map(sample => sample.metrics.totalModeledCashChange.amount)).toEqual(["-10", "0", "5.01"]);
    expect(result.points[1]!.metrics.totalModeledCashChange.traceIds).toEqual(["month:0", "month:1"]);
    const changed = forecast(source.points, { openingSnapshot: { ...source.openingSnapshot, cash: money("105") } });
    expect(selectForecastChartData(changed).points[0]!.metrics.totalModeledCashChange.amount).toBe("-15");
  });

  it("preserves raw decimal strings and aggregates beyond floating point precision", () => {
    const cash = "9007199254740993.000000000000000001";
    const source = forecast([
      point(0, { cash: money(cash), statementIncome: money("9007199254740993.01") }),
      point(1, { cash: money("9007199254740992.999999999999999999"), statementIncome: money("0.02") }),
    ]);
    const result = selectForecastChartData(source, { granularity: "annual" });
    expect(result.monthlyPoints[0]!.metrics.totalModeledCash.amount).toBe(cash);
    expect(result.monthlyPoints[1]!.metrics.totalModeledCashChange.amount).toBe("-0.000000000000000002");
    expect(result.points[0]!.metrics.modeledStatementIncome.amount).toBe("9007199254740993.03");
    expect(result.points[0]!.metrics.totalModeledCashChange.amount).toBe("9007199254740892.999999999999999999");
  });

  it("uses annual closing stocks and summed flows for all twelve months", () => {
    const source = forecast(Array.from({ length: 12 }, (_, month) => point(month, {
      cash: money(String(99 - month)), totalAssets: money(String(129 - month)),
      netWorth: money(String(-21 - month)), statementIncome: money("0.01"), statementExpenses: money("-0.02"),
    })));
    const result = selectForecastChartData(source, { granularity: "annual" });
    expect(result.status).toBe("complete");
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ coverage: "full_year", coveredMonthCount: 12, periodStart: boundary(0), periodEnd: boundary(12) });
    expect(result.points[0]!.metrics.totalAssets.amount).toBe("118");
    expect(result.points[0]!.metrics.netWorth.amount).toBe("-32");
    expect(result.points[0]!.metrics.totalInvestmentValue.amount).toBe("30");
    expect(result.points[0]!.metrics.totalModeledCash.amount).toBe("88");
    expect(result.points[0]!.metrics.totalModeledCashChange).toMatchObject({ amount: "-12", status: "complete" });
    expect(result.points[0]!.metrics.modeledStatementIncome.amount).toBe("0.12");
    expect(result.points[0]!.metrics.modeledStatementExpenses.amount).toBe("-0.24");
    expect(result.monthlyPoints).toHaveLength(12);
  });

  it("splits years by period start and labels partial years without annualizing", () => {
    const result = selectForecastChartData(forecast([point(11), point(12, { cash: money("80") })]), { granularity: "annual" });
    expect(result.status).toBe("incomplete");
    expect(result.points.map(sample => [sample.periodStart, sample.periodEnd, sample.coveredMonthCount, sample.coverage]))
      .toEqual([[boundary(11), boundary(12), 1, "partial_year"], [boundary(12), boundary(13), 1, "partial_year"]]);
    expect(result.points.map(sample => sample.metrics.modeledStatementIncome.amount)).toEqual(["10.1", "10.1"]);
    expect(result.points.every(sample => sample.metrics.modeledStatementIncome.status === "incomplete")).toBe(true);
    expect(result.points.map(sample => sample.metrics.totalModeledCashChange.amount)).toEqual(["-10", "-10"]);
  });

  it("observes per-metric tax capabilities independently of result status", () => {
    const taxIncomplete = taxOutputCapabilities([{
      severity: "warning", code: "PFA-TAX-009", entityType: "tax_capability",
      category: "missing", message: "Missing tax coverage", affectedOutputs: ["cash", "netWorth", "statementExpenses"],
    }]);
    const source = forecast(Array.from({ length: 12 }, (_, month) => point(month, { outputCapabilities: taxIncomplete })), { status: "incomplete" });
    for (const granularity of ["monthly", "annual"] as const) {
      const result = selectForecastChartData(source, { granularity });
      const metrics = result.points[0]!.metrics;
      expect(metrics.totalModeledCash.status).toBe("incomplete");
      expect(metrics.totalModeledCash.amount).not.toBeNull();
      expect(metrics.netWorth.status).toBe("incomplete");
      expect(metrics.modeledStatementExpenses.status).toBe("incomplete");
      expect(metrics.modeledStatementIncome.status).toBe("complete");
      expect(metrics.totalModeledCashChange.status).toBe("incomplete");
      expect(result.opening?.metrics.netWorth.status).toBe("complete");
    }
  });

  it("uses qualified projected-law source capabilities without promoting unrelated missing outputs", () => {
    const selection: ProjectedCurrentLawAssumption = { version: "projected-current-law/v1", selection: "projectedCurrentLawThrough",
      modelId: "chart-model", householdId: "chart-household", through: "2029-01-01", catalogFingerprint: "chart-catalog" };
    const projected = { ...taxDiagnostic("projected_current_law", "Future law is assumed", "US:FEDERAL"), projectedLaw: {
      assumption: selection, catalogFingerprint: selection.catalogFingerprint, ruleId: "projected-rule", ruleVersion: "projected-v1",
      baseRuleId: "base-rule", baseRuleVersion: "base-v1", baseYear: 2026,
      effectiveFrom: instant("2027-01-01T00:00:00.000Z"), effectiveUntil: instant("2029-01-01T00:00:00.000Z"),
    } };
    const qualified = taxOutputCapabilities([projected], selection);
    const missing = taxOutputCapabilities([projected, taxDiagnostic("settlement_timing", "Missing settlement")], selection);
    const source = forecast([point(0, { outputCapabilities: qualified }), point(1, { outputCapabilities: missing })], { status: "incomplete" });
    const result = selectForecastChartData(source);
    expect(result.points[0]!.metrics.netWorth.status).toBe("complete");
    expect(result.points[1]!.metrics.netWorth.status).toBe("incomplete");
    expect(result.points[1]!.metrics.modeledStatementIncome.status).toBe("complete");
    expect(source.points[0]!.outputCapabilities!.netWorth!.diagnostics).toContainEqual(projected);
    expect(result.sourceStatus).toBe("incomplete");
  });

  it("never treats missing capabilities as zero or complete and keeps unrelated metrics", () => {
    const { cash: _cash, ...withoutCash } = capabilities;
    const source = forecast([point(0), point(1, { outputCapabilities: withoutCash })]);
    const result = selectForecastChartData(source);
    expect(result.points[1]!.metrics.totalModeledCash).toMatchObject({ amount: null, status: "unavailable" });
    expect(result.points[1]!.metrics.totalModeledCashChange.amount).toBeNull();
    expect(result.points[1]!.metrics.modeledStatementIncome.status).toBe("complete");
    const annual = selectForecastChartData(source, { granularity: "annual" });
    expect(annual.points[0]!.metrics.totalModeledCash).toMatchObject({ amount: "90", status: "incomplete", closingAt: boundary(1) });
    expect(annual.points[0]!.metrics.totalModeledCashChange).toMatchObject({ amount: null, status: "unavailable" });
    const { outputCapabilities: _capabilities, ...noCapabilities } = point(0);
    expect(selectForecastChartData(forecast([noCapabilities])).points[0]!.metrics.netWorth.amount).toBeNull();
  });

  it("propagates the prior cash endpoint capability without contaminating later complete endpoints", () => {
    const source = forecast([point(0, { outputCapabilities: { ...capabilities, cash: { ...capabilities.cash!, status: "incomplete" } } }), point(1), point(2)]);
    const result = selectForecastChartData(source);
    expect(result.points.map(sample => sample.metrics.totalModeledCashChange.status)).toEqual(["incomplete", "incomplete", "complete"]);
    const annual = selectForecastChartData(source, { granularity: "annual" });
    expect(annual.points[0]!.metrics.totalModeledCash.status).toBe("incomplete");
  });

  it("marks full-year metrics incomplete for a single incomplete source month", () => {
    const source = forecast(Array.from({ length: 12 }, (_, month) => point(month, month === 4 ? {
      outputCapabilities: { ...capabilities, statementExpenses: { ...capabilities.statementExpenses!, status: "incomplete" } },
    } : {})));
    const annual = selectForecastChartData(source, { granularity: "annual" });
    expect(annual.points[0]!.coverage).toBe("full_year");
    expect(annual.points[0]!.metrics.modeledStatementExpenses).toMatchObject({ amount: "146.4", status: "incomplete" });
    expect(annual.points[0]!.metrics.modeledStatementIncome.status).toBe("complete");
    const { statementIncome: _income, ...withoutIncome } = capabilities;
    const missing = forecast(source.points.map((sample, index) => index === 4 ? { ...sample, outputCapabilities: withoutIncome } : sample));
    expect(selectForecastChartData(missing, { granularity: "annual" }).points[0]!.metrics.modeledStatementIncome)
      .toMatchObject({ amount: null, status: "unavailable" });
  });

  it("retains requested/reached/stopped coverage without fabricating unsupported future months", () => {
    const source = forecast([point(0), point(1)], {
      status: "incomplete", requestedHorizon: { start: boundary(0), end: boundary(480) },
      simulationEnd: boundary(480), stoppedAt: boundary(2),
    });
    const result = selectForecastChartData(source);
    expect(result.horizonCoverage).toBe("partial");
    expect(result.points).toHaveLength(2);
    expect(result.boundaries).toMatchObject({ requestedHorizon: source.requestedHorizon, reachedThrough: boundary(2), stoppedAt: boundary(2) });
    expect(selectForecastChartData(forecast([])).points).toEqual([]);
    expect(selectForecastChartData(forecast([])).horizonCoverage).toBe("partial");
  });

  it("returns declared unavailable data without inventing an opening or fingerprint", () => {
    const result = selectForecastChartData({ scope: "household", status: "unavailable", message: "Unsupported source", diagnostics: [] });
    expect(result).toMatchObject({ status: "unavailable", points: [], monthlyPoints: [], opening: null, unavailableReason: "Unsupported source" });
    expect(result).not.toHaveProperty("sourceFingerprint");
  });

  it.each([
    ["gap", [point(0), point(2)]],
    ["duplicate", [point(0), point(0)]],
    ["reverse order", [point(1), point(0)]],
    ["partial month", [point(0, { periodEnd: "2024-01-15T00:00:00.000Z" })]],
    ["non UTC", [point(0, { periodStart: "2024-01-01T00:00:00.000-05:00" })]],
    ["invalid identity", [point(0, { netWorth: money("1") })]],
    ["currency mismatch", [point(0, { statementIncome: money("1", "EUR") })]],
    ["invalid decimal", [point(0, { cash: money("NaN") })]],
  ] as const)("explicitly rejects %s rather than correcting the source", (_name, points) => {
    const result = selectForecastChartData(forecast(points));
    expect(result.status).toBe("unavailable");
    expect(result.points).toEqual([]);
    expect(result.unavailableReason).toBeTruthy();
  });

  it("rejects corrupt opening identity and inconsistent reached coverage", () => {
    const source = forecast();
    expect(selectForecastChartData({ ...source, openingSnapshot: { ...source.openingSnapshot, netWorth: money("0") } }).unavailableReason).toBe("net_worth_identity_mismatch");
    expect(selectForecastChartData({ ...source, reachedThrough: boundary(3) }).unavailableReason).toBe("invalid_reached_coverage");
    expect(selectForecastChartData({ ...source, stoppedAt: boundary(1) }).unavailableReason).toBe("invalid_stopped_coverage");
  });

  it("freezes detached results, preserves every month, and never reads replay artifacts", () => {
    const source = forecast(Array.from({ length: 121 }, (_, month) => point(month)));
    Object.defineProperty(source.points[0]!, "traceRefs", { get: () => { throw new Error("Replay artifacts must not be read"); } });
    const result = selectForecastChartData(source, { granularity: "annual", sourceFingerprint: "external-run-id" });
    expect(result.monthlyPoints).toHaveLength(121);
    expect(result.sourceFingerprint).toBe("external-run-id");
    expect(result).not.toHaveProperty("traceRefs");
    for (const item of [result, result.points, result.monthlyPoints, result.opening, result.opening!.metrics,
      result.boundaries, result.boundaries!.requestedHorizon, result.points[0], result.points[0]!.metrics,
      result.points[0]!.metrics.totalModeledCash, result.points[0]!.metrics.totalModeledCash.traceIds]) {
      expect(Object.isFrozen(item)).toBe(true);
    }
    const first = result.monthlyPoints[0]!;
    expect(Object.isFrozen(first.traceIds)).toBe(true);
    (source.points[0]!.traceIds as string[]).push("later-source-mutation");
    expect(first.traceIds).toEqual(["month:0"]);
    expect(() => { (first.metrics.totalModeledCash as { amount: string }).amount = "0"; }).toThrow();
  });
});
