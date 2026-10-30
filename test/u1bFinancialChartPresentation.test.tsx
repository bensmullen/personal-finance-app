import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HouseholdChart } from "../ui/forecast/HouseholdChart.js";
import { chartCoordinate, chartPeriodLabel, exactChartValue } from "../ui/forecast/charts/FinancialChart.js";
import { selectForecastChartData } from "../src/application/forecastChartData.js";
import type { ForecastChartValue } from "../src/application/forecastChartData.js";
import type { HouseholdForecastPoint, PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import { taxDiagnostic, taxOutputCapabilities } from "../src/simulation/tax/contracts.js";
import { selectRetirementIncomeChartData } from "../src/application/retirementIncomeChartData.js";
import { createGoldenHouseholdExampleDraft } from "../src/application/personalMvp.js";

type Available = Extract<PersonalHouseholdForecastReadModel, { status: "completed" | "incomplete" }>;
const money = (amount: string) => ({ amount, currency: "USD" });
const at = (month: number) => new Date(Date.UTC(2026, month, 1)).toISOString();
const capabilities = taxOutputCapabilities([]);
function source(options: { partial?: boolean; missing?: boolean; noInvestments?: boolean; empty?: boolean } = {}): Available {
  const outputCapabilities = Object.fromEntries(Object.entries(capabilities).filter(([key]) => !options.missing || !["cash", "statementExpenses"].includes(key)));
  const point: HouseholdForecastPoint = {
    periodStart: at(0), periodEnd: at(1),
    outputCapabilities,
    cash: money("90.001"), investmentValue: money(options.noInvestments ? "0" : "30"),
    assets: money("120"), totalAssets: money("120"), liabilities: money("150"), totalLiabilities: money("150"), netWorth: money("-30"),
    statementIncome: money("10.101"), statementExpenses: money("-12.202"),
    debtPrincipalReduction: money("0"), gains: money("0"), operatingCashFlow: money("0"), investingCashFlow: money("0"), financingCashFlow: money("0"),
    investmentContributionPrincipal: money("0"), fees: money("0"), unrealizedGain: money("0"),
    debtBalances: [], liquidityShortfalls: [], traceIds: [], traceRefs: [],
  };
  return {
    scope: "household", status: options.partial ? "incomplete" : "completed",
    requestedHorizon: { start: at(0), end: at(options.partial ? 12 : 1) },
    reachedThrough: at(options.empty ? 0 : 1), ...(options.partial ? { stoppedAt: at(options.empty ? 0 : 1) } : {}),
    asOf: "2026-01-01", dataCutoff: "2026-01-01", simulationStart: at(0), simulationEnd: at(options.partial ? 12 : 1),
    actualForecastBoundary: "2026-01-01", actualHistoryAvailable: false,
    openingSnapshot: { outputCapabilities: capabilities, cash: money("100"), investmentValue: money(options.noInvestments ? "0" : "30"), standaloneAssetValue: money("0"), totalAssets: money("130"), totalLiabilities: money("150"), netWorth: money("-20"), accounts: [], positions: [], debts: [] },
    points: options.empty ? [] : [point], contributionCapacities: [], contingentPositions: [], retirementMilestones: [], liquidityShortfalls: [], debtPayoffs: [], diagnostics: [],
  };
}
const render = (forecast: PersonalHouseholdForecastReadModel, cashFlowOnly = true, stale = false, calm = false) => renderToStaticMarkup(React.createElement(HouseholdChart, { forecast, cashFlowOnly, stale, calm }));

describe("U1B exact chart presentation", () => {
  it("never derives retirement stream amounts from aggregate statements or investment changes", () => {
    const forecast = source();
    const model = createGoldenHouseholdExampleDraft();
    const baseline = selectRetirementIncomeChartData(model, "2026-01-01", [], forecast);
    const changed = { ...forecast, points: forecast.points.map(point => ({ ...point, statementIncome: money("999999.999"), investmentValue: money("1") })) };
    expect(selectRetirementIncomeChartData(model, "2026-01-01", [], changed).incomeSources).toBe(baseline.incomeSources);
    expect(baseline.incomeSources.series).toEqual([]);
  });
  it("uses sourced investment closes with exact values and shared disclosures", () => {
    const forecast = source({ partial: true });
    const html = renderToStaticMarkup(React.createElement(HouseholdChart, { forecast, cashFlowOnly: false, investing: true, calm: true, stale: true }));
    expect(html).toContain('aria-label="Total investment balance"');
    expect(html).toContain("30 USD · Incomplete · closing 2026-02-01");
    expect(html).toContain("snapshot, separate from projected periods");
    expect(html).toContain("Out of date");
    expect(html).toContain("Chart Details");
    expect(html).toContain("not earnings, realized return");
    expect(html).not.toContain('aria-label="Household financial outlook chart"');
    expect(html).not.toContain('aria-label="Modeled statement income versus expenses"');
  });
  it("retains the full supported investment horizon beyond forty years in annual view", () => {
    const forecast = source();
    const count = 55 * 12;
    const points = Array.from({ length: count }, (_, index) => ({ ...forecast.points[0]!, periodStart: at(index), periodEnd: at(index + 1) }));
    const long = { ...forecast, requestedHorizon: { start: at(0), end: at(count) }, reachedThrough: at(count), simulationEnd: at(count), points };
    const html = renderToStaticMarkup(React.createElement(HouseholdChart, { forecast: long, cashFlowOnly: false, investing: true, calm: true }));
    expect(html).toContain("Show exact chart data · 55 years");
    expect(html).toContain("2080-01-01 → 2081-01-01");
    expect(html).toContain("closing 2081-01-01");
  });
  it("distinguishes supported zero investment value from unavailable investment capability", () => {
    const forecast = source({ noInvestments: true });
    const zero = renderToStaticMarkup(React.createElement(HouseholdChart, { forecast, cashFlowOnly: false, investing: true }));
    expect(zero).toContain("0 USD · Incomplete");
    const missing = { ...forecast, points: forecast.points.map(point => ({ ...point, outputCapabilities: {} })) };
    const html = renderToStaticMarkup(React.createElement(HouseholdChart, { forecast: missing, cashFlowOnly: false, investing: true }));
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("0 USD · Incomplete");
  });
  it("gives each chart select its own exact external label and unique association", () => {
    const html = render(source());
    // Wrapping a select in a label includes all option text in exact label
    // lookup, even though the computed combobox name omits those options.
    const labels = [...html.matchAll(/<label for="([^"]+)">([^<]+)<\/label><select id="([^"]+)"/g)];
    expect(labels.map(match => match[2])).toEqual([
      "Period", "Selected projected period",
      "Period", "Monthly range starting", "Selected projected period",
    ]);
    for (const match of labels) expect(match[1]).toBe(match[3]);
    expect(new Set(labels.map(match => match[1])).size).toBe(5);
  });
  it("separates all-account cash, signed changes and recognized statements", () => {
    const html = render(source());
    expect(html).toContain("Total Cash Balance");
    expect(html).toContain("Decrease · -9.999 USD");
    expect(html).toContain("-12.202 USD");
    expect(html).toContain("not bank receipts/disbursements or disposable wages");
    expect(html).toContain("snapshot, separate from projected periods");
    expect(html).toContain("Show exact chart data");
    expect(html.match(/No observed history loaded/g)).toHaveLength(1);
    expect(html.match(/Requested 2026-01-01/g)).toHaveLength(1);
  });
  it.each([
    { expense: "-12.202", cash: "90.001", change: "-9.999", label: "Decrease · -9.999 USD" },
    { expense: "12.202", cash: "110.001", change: "10.001", label: "Increase · +10.001 USD" },
    { expense: "0", cash: "100", change: "0", label: "No change · 0 USD" },
  ])("preserves source expense $expense and cash change $change independently", ({ expense, cash, change, label }) => {
    const forecast = source();
    const fixture = { ...forecast, points: forecast.points.map(point => ({ ...point, cash: money(cash), statementExpenses: money(expense) })) };
    const monthly = selectForecastChartData(fixture);
    const annual = selectForecastChartData(fixture, { granularity: "annual" });
    const expenses = monthly.points[0]!.metrics.modeledStatementExpenses;
    expect(expenses).toMatchObject({ amount: expense, status: "complete" });
    expect(chartCoordinate(expenses)).toBe(Number(expense)); // Disposable axis coordinate only.
    expect(exactChartValue(expenses)).toBe(`${expense} USD`);
    expect(annual.points[0]!.metrics.totalModeledCashChange).toMatchObject({ amount: change, status: "incomplete" });
    expect(chartCoordinate(annual.points[0]!.metrics.totalModeledCashChange)).toBe(Number(change));
    const html = render(fixture);
    expect(html).toContain(`<dd>${expense} USD</dd>`);
    expect(html).toContain(`<td>${expense} USD</td>`);
    expect(html).toContain(`<dd>${label} · Incomplete</dd>`);
    expect(html).toContain(`<td>${label} · Incomplete</td>`);
  });
  it("keeps partial coverage and retained stale results explicit without extending history", () => {
    const html = render(source({ partial: true }), false, true);
    expect(html).toContain("Out of date · retained forecast");
    expect(html).toContain("Partial horizon");
    expect(html).toContain("partial year, 1 month");
    expect(html).not.toContain("1 months");
    expect(html).toContain("Incomplete");
    expect(html).toContain("No observed history loaded");
    expect(html).not.toContain("2026-03-01");
    expect(html).toContain("Partial coverage · gaps are unavailable.");
    expect(html).not.toContain("Incomplete forecast");
    expect(html).not.toContain("Projected · USD");
  });
  it("keeps the cash account qualification only in its own collapsed details", () => {
    const html = render(source());
    const title = html.indexOf("<figcaption>");
    const details = html.indexOf('<details class="calm-disclosure cash-chart-details');
    expect(html.slice(title, details)).not.toContain("(Including cash in investment accounts)");
    expect(html.slice(details)).toContain("(Including cash in investment accounts)");
    expect(html.slice(title, html.indexOf('class="chart"', title))).not.toContain("<p");
  });
  it("shows unavailable metric values without substituting zero or hiding supported income", () => {
    const html = render(source({ missing: true }));
    expect(html).toContain("Unavailable");
    expect(html).toContain("10.101 USD");
    expect(html).not.toContain("90.001 USD");
    expect(html).not.toContain("-12.202 USD");
  });
  it("preserves cash/debt outlook without investments and handles no modeled periods", () => {
    expect(render(source({ noInvestments: true }), false)).toContain("-30 USD");
    expect(render(source({ empty: true, partial: true }))).toContain("No modeled periods available");
  });
  it("qualifies tax-affected values independently from recognized income", () => {
    const forecast = source();
    const partial = taxOutputCapabilities([taxDiagnostic("test_coverage", "Synthetic missing tax coverage")]);
    const html = render({ ...forecast, status: "incomplete", points: forecast.points.map(point => ({ ...point, outputCapabilities: partial })) });
    expect(html).toContain("90.001 USD · Incomplete");
    expect(html).toContain("-12.202 USD · Incomplete");
    expect(html).toContain("10.101 USD");
    expect(html).not.toContain("10.101 USD · Incomplete");
  });
  it("handles unavailable source and refuses unsafe plotting coordinates while retaining exact strings", () => {
    const forecast = { status: "unavailable", scope: "household", message: "Needs setup", diagnostics: [] } as PersonalHouseholdForecastReadModel;
    expect(render(forecast)).toContain("Chart data unavailable");
    const cashFallback = render(forecast, true, false, true);
    expect(cashFallback).toContain('aria-label="Total Cash Balance Chart Details"');
    expect(cashFallback).not.toContain("Total modeled cash Chart Details");
    const value: ForecastChartValue = { amount: "9007199254740993.01", currency: "USD", status: "incomplete", traceIds: [] };
    expect(chartCoordinate(value)).toBeNull();
    expect(exactChartValue(value)).toContain("9,007,199,254,740,993.01 USD · Incomplete");
    expect(chartCoordinate({ ...value, amount: null })).toBeNull();
    expect(chartCoordinate({ ...value, amount: "0", status: "unavailable" })).toBeNull();
    expect(chartCoordinate({ ...value, amount: "-12.202" })).toBe(-12.202);
  });
  it("presents annual stock closes and signed period totals with their actual covered bounds", () => {
    const forecast = source();
    const second = { ...forecast.points[0]!, periodStart: at(1), periodEnd: at(2),
      cash: money("80"), totalAssets: money("110"), netWorth: money("-40"),
      statementIncome: money("20.202"), statementExpenses: money("-24.404") };
    const twoMonths = { ...forecast, requestedHorizon: { start: at(0), end: at(2) }, simulationEnd: at(2), reachedThrough: at(2), points: [...forecast.points, second] };
    const annual = selectForecastChartData(twoMonths, { granularity: "annual" });
    expect(chartPeriodLabel(annual.points[0]!)).toBe("2026-01-01 → 2026-03-01 (exclusive) · partial year, 2 months");
    expect(exactChartValue(annual.points[0]!.metrics.modeledStatementIncome)).toBe("30.303 USD · Incomplete");
    expect(exactChartValue(annual.points[0]!.metrics.modeledStatementExpenses)).toBe("-36.606 USD · Incomplete");
    const cash = render(twoMonths);
    expect(cash).toContain("80 USD · Incomplete · closing 2026-03-01");
    expect(cash).toContain("Decrease · -20 USD · Incomplete");
    const wealth = render(twoMonths, false);
    expect(wealth).toContain("110 USD · Incomplete · closing 2026-03-01");
    expect(wealth).toContain("150 USD · Incomplete · closing 2026-03-01");
    expect(wealth).toContain("-40 USD · Incomplete · closing 2026-03-01");
    expect(wealth).not.toContain("Month starting");
  });
  it("defaults statements to the most recent twelve supported months", () => {
    const forecast = source();
    const months = Array.from({ length: 14 }, (_, index) => ({ ...forecast.points[0]!, periodStart: at(index), periodEnd: at(index + 1) }));
    const html = render({ ...forecast, requestedHorizon: { start: at(0), end: at(14) }, simulationEnd: at(14), reachedThrough: at(14), points: months });
    const statement = html.slice(html.indexOf('<figure class="forecast-figure financial-chart" aria-label="Modeled statement'));
    expect(statement).toContain('<option value="2026-03-01T00:00:00.000Z" selected="">2026-03</option>');
    expect(statement).toContain("Show exact chart data · 12 months");
    expect(statement).not.toContain("2026-01-01 → 2026-02-01");
  });
});
