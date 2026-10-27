import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactPeriod, FinancialChart, compactChartValue, exactChartValue } from "../ui/forecast/charts/FinancialChart.js";
import { ForecastProgress } from "../ui/calm/CalmPresentation.js";
import { forecastChartInterpretation, type ForecastChartData, type ForecastChartPeriod, type ForecastChartValue } from "../src/application/forecastChartData.js";

const value = (amount: string | null, status: ForecastChartValue["status"] = "complete"): ForecastChartValue => ({ amount, status, currency: "USD", traceIds: [] });
const point: ForecastChartPeriod = {
  periodKind: "projected", granularity: "annual", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-04-01T00:00:00.000Z", coveredMonthCount: 3, coverage: "partial_year",
  metrics: { totalModeledCash: value("3254123.456", "incomplete"), totalModeledCashChange: value("-6760.01", "incomplete"), totalAssets: value("4000000"), totalLiabilities: value("745876.544"), netWorth: value("3254123.456"), totalInvestmentValue: value("0"), modeledStatementIncome: value("100"), modeledStatementExpenses: value(null, "unavailable") }, traceIds: [],
};
const cash = { key: "totalModeledCash", label: "Total Cash Balance", color: "#1e6756" } as const;
const change = { key: "totalModeledCashChange", label: "Cash Balance Change", color: "#1e6756", bar: true } as const;
const render = (element: React.ReactElement) => renderToStaticMarkup(element);
const data: ForecastChartData = { status: "incomplete", sourceStatus: "incomplete", granularity: "annual", currency: "USD", actualHistoryAvailable: false, interpretation: forecastChartInterpretation, horizonCoverage: "partial", opening: null, points: [point], monthlyPoints: [point] };

describe("Compact chart selection retains exact source evidence", () => {
  it.each([
    ["3254123.456", false, "$3.25M"], ["6760.01", true, "+$6.76k"],
    ["-6760.01", true, "−$6.76k"], ["0", true, "$0"], ["-0.00", true, "$0"],
    ["12.345", false, "$12.35"], ["9007199254740993.01", false, "$9007199.25B"],
  ] as const)("formats %s only for display", (amount, signed, expected) => {
    const source = Object.freeze(value(amount));
    expect(compactChartValue(source, signed)).toBe(expected);
    expect(source.amount).toBe(amount);
    expect(exactChartValue(source)).not.toContain("M");
  });
  it("keeps missing, incomplete, partial and stale distinct", () => {
    expect(compactChartValue(value(null))).toBe("Unavailable");
    expect(compactChartValue(value("0", "unavailable"))).toBe("Unavailable");
    const html = render(<CompactPeriod point={point} series={[cash, change]} stale />);
    expect(html).toContain("2026 · projected · partial · out of date");
    expect(html).toContain("Total: $3.25M · incomplete");
    expect(html).toContain("Change: −$6.76k · incomplete");
    expect(exactChartValue(point.metrics.totalModeledCash)).toContain("3,254,123.456 USD");
  });
  it("only includes visible series in the compact readout", () => {
    const before = JSON.stringify(point);
    expect(render(<CompactPeriod point={point} series={[cash]} />)).not.toContain("Change:");
    expect(render(<CompactPeriod point={point} series={[change]} />)).not.toContain("Total:");
    expect(render(<CompactPeriod point={point} series={[]} />)).not.toContain("$3.25M");
    expect(JSON.stringify(point)).toBe(before);
  });
  it.each(["wealth", "cash", "statement"] as const)("keeps %s exact selections and tables inside its own collapsed details", kind => {
    const html = render(<FinancialChart annual={data} monthly={data} kind={kind} stale={false} />);
    const details = html.indexOf('<details class="calm-disclosure cash-chart-details');
    expect(details).toBeGreaterThan(html.indexOf("chart-controls"));
    expect(html.slice(details)).toContain('class="chart-selected"');
    expect(html.slice(0, details)).not.toContain('class="chart-selected"');
    expect(html.slice(details)).toContain('class="chart-table"');
    expect(html.slice(details).split("><summary>")[0]).not.toContain(" open");
    expect(html).not.toContain("Period grouping");
    expect(html).toContain(">Period</label>");
  });
  it("mounts one progress indicator only while pending, without replacing retained values", () => {
    const pending = render(<FinancialChart annual={data} monthly={data} kind="cash" stale pending />);
    expect(pending).toContain('aria-busy="true"');
    expect(pending.match(/class="forecast-progress"/g)).toHaveLength(1);
    expect(pending).toContain("Updating · retained results are out of date");
    expect(pending).toContain("3,254,123.456 USD");
    expect(render(<FinancialChart annual={data} monthly={data} kind="cash" stale />)).not.toContain('class="forecast-progress"');
    expect(render(<ForecastProgress pending={false} />)).toBe("");
    expect(render(<ForecastProgress pending />)).toContain("Calculating forecast…");
  });
});
