import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiabilityBalanceOutlook, MortgageAmortization } from "../ui/forecast/MortgageAmortization.js";
import { inspectLiabilityBalanceWindow, inspectMortgageWindow, mortgageWindowTotals } from "../src/application/mortgageChartData.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { formatExactMoney } from "../ui/entityPresentation.js";

function window() {
  const request = createGoldenHouseholdForecastRequest();
  const result = runPersonalHouseholdForecast(createGoldenHouseholdDraft(), { ...request, compiler: { ...request.compiler,
    cashFlow: { ...request.compiler.cashFlow!, simulationEnd: "2027-02-01", months: 13 },
    investments: { ...request.compiler.investments!, simulationEnd: "2027-02-01", months: 13 },
    liabilities: { ...request.compiler.liabilities!, simulationEnd: "2027-02-01", months: 13 } } });
  if (result.status === "unavailable") throw new Error(result.message);
  return result;
}
describe("U1B-D exact mortgage presentation", () => {
  it("uses household total liabilities for the primary debt chart and gates incomplete coverage", () => {
    const forecast = window(), data = inspectLiabilityBalanceWindow(forecast, 0);
    expect(data.rows).toHaveLength(12);
    expect(data.opening.amount).toBe(forecast.openingSnapshot.totalLiabilities.amount);
    expect(data.rows[1]!.amount).toBe(forecast.points[1]!.totalLiabilities.amount);
    const render = (value = data) => renderToStaticMarkup(<LiabilityBalanceOutlook data={value} selectedStart={value.rows[1]!.start} selectMonth={() => {}} />);
    expect(render()).toContain('aria-label="Selected liability month"');
    expect(render()).toContain('aria-label="Modeled household liability balances"');
    expect(render()).toContain("Committed household forecast");
    expect(render()).toContain(formatExactMoney(data.rows[1]!.amount, data.rows[1]!.currency));
    const incomplete = { ...data, status: "incomplete" as const, rows: data.rows.map(row => ({ ...row, supported: false })) };
    expect(render(incomplete)).toContain("liability forecast incomplete");
    expect(render(incomplete)).toContain("Incomplete coverage");
    expect(render(incomplete)).toContain("height:0%");
    expect(render(incomplete)).not.toContain("ending household liabilities");
    const late = inspectLiabilityBalanceWindow(forecast, 12);
    expect(late.opening.amount).toBe(forecast.points[11]!.totalLiabilities.amount);
    expect(late.rows).toHaveLength(1);
  });
  it("provides discrete month controls, distinct paid categories and an exact accessible table", () => {
    const data = inspectMortgageWindow(window().points.slice(0, 12), ids.mortgage), selected = data.rows[1]!;
    const before = JSON.stringify(data);
    const html = renderToStaticMarkup(<MortgageAmortization window={data} selectedStart={selected.start} selectMonth={() => {}} loanName="Example mortgage" />);
    for (const label of ["Interest paid", "Scheduled principal paid", "Extra principal paid", "Ending modeled loan principal", "Scheduled due (not paid)", "Interest accrued (not paid)", "Cumulative paid from forecast start", "Posted transaction evidence"])
      expect(html).toContain(label);
    expect(html).toContain('aria-label="Selected mortgage month"');
    expect(html).toContain('scope="row"');
    expect(html).toContain(formatExactMoney(selected.endingPrincipal, selected.currency));
    expect(html).toContain(formatExactMoney(mortgageWindowTotals(data, selected.start)!.interest, selected.currency));
    expect(html).toContain("Example mortgage monthly cash paid");
    expect(html).toContain("mortgage-series-2");
    expect(html).toContain("fully satisfied");
    expect(html).toContain("Loan paydown alone does not establish future home equity");
    expect(html).not.toMatch(/NaN|Infinity|height:-/);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("labels a late partial window honestly and cannot continue full cumulatives across missing principal coverage", () => {
    const data = inspectMortgageWindow(window().points.slice(12), ids.mortgage);
    const render = (value = data) => renderToStaticMarkup(<MortgageAmortization window={value} selectedStart={value.rows[0]!.start} selectMonth={() => {}} loanName="Example mortgage" />);
    expect(render()).toContain("Window-to-date paid");
    expect(render()).toContain("Full forecast cumulative amounts are unavailable");
    const partial = { ...data, status: "incomplete" as const, rows: data.rows.map(row => ({ ...row, reconciled: false })) };
    expect(render(partial)).toContain("Cumulative paid amounts unavailable");
    expect(render(partial)).toContain("Partial principal coverage");
  });
});
