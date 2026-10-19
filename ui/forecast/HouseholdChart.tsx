"use client";

import { memo, useMemo } from "react";
import * as React from "react";
import { selectForecastChartData } from "../../src/application/forecastChartData.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import { FinancialChart } from "./charts/FinancialChart.js";

/** Only the application selector groups periods or derives financial values. */
export const HouseholdChart = memo(function HouseholdChart({ forecast, cashFlowOnly, stale = false, sourceFingerprint, calm = false, supporting }: {
  forecast: PersonalHouseholdForecastReadModel;
  cashFlowOnly: boolean;
  stale?: boolean;
  sourceFingerprint?: string;
  calm?: boolean;
  supporting?: React.ReactNode;
}) {
  const annual = useMemo(() => selectForecastChartData(forecast, { granularity: "annual", sourceFingerprint }), [forecast, sourceFingerprint]);
  const monthly = useMemo(() => selectForecastChartData(forecast, { granularity: "monthly", sourceFingerprint }), [forecast, sourceFingerprint]);
  const rangeDetails = calm && annual.boundaries && <details className="calm-disclosure chart-range"><summary>Forecast range / Data coverage</summary><div>
    <p>Each period includes its start and excludes its end: [start, end). Requested dates describe the chosen horizon; available results may stop earlier.</p>
    <dl>
      <dt>Requested start (inclusive)</dt><dd>{annual.boundaries.requestedHorizon.start}</dd>
      <dt>Requested end (exclusive)</dt><dd>{annual.boundaries.requestedHorizon.end}</dd>
      <dt>Available results end (exclusive)</dt><dd>{annual.boundaries.reachedThrough ?? "No supported coverage reported"}</dd>
    </dl>
    {stale && <p>Out of date: these boundaries belong to the retained forecast, not the changed inputs.</p>}
    {annual.horizonCoverage === "partial" && <p>Partial horizon: no results beyond the available boundary have been filled in.</p>}
    <p>All plotted periods are forecasts. No observed history or past bank transactions are loaded.</p>
  </div></details>;
  return <div className="financial-charts" data-chart-status={annual.status} data-supported-months={monthly.points.length} data-unavailable-reason={annual.unavailableReason}>
    {stale && <p className="chart-freshness" role="status">Out of date · retained forecast from the previous applied inputs. Update the forecast before relying on these values.</p>}
    {annual.boundaries && (calm ? <>
      <p className="chart-coverage">{annual.boundaries.reachedThrough && annual.points.length > 0
        ? `Forecast starts ${coverageDate(annual.boundaries.requestedHorizon.start)}; available results end before ${coverageDate(annual.boundaries.reachedThrough)}.`
        : "No supported forecast periods are available yet."} {annual.horizonCoverage === "partial" && <strong>Partial horizon · results stop before the requested end. No projection beyond the available boundary. </strong>}No past account history is included.</p>
    </> : <p className="chart-coverage">Requested {annual.boundaries.requestedHorizon.start.slice(0, 10)} → {annual.boundaries.requestedHorizon.end.slice(0, 10)} (exclusive). Modeled through {(annual.boundaries.reachedThrough ?? annual.boundaries.requestedHorizon.start).slice(0, 10)} (exclusive). {annual.horizonCoverage === "partial" && <strong>Partial horizon · no projection beyond this boundary. </strong>}No observed history loaded.</p>)}
    {annual.status === "unavailable" ? <p className={calm ? "calm-empty" : undefined} role="status">Chart data unavailable. Review forecast diagnostics and source setup; no values have been substituted.</p> : <>
      <FinancialChart key={cashFlowOnly ? "cash" : "wealth"} annual={annual} monthly={monthly} kind={cashFlowOnly ? "cash" : "wealth"} stale={stale} calm={calm && !cashFlowOnly}>{calm && !cashFlowOnly && <>{rangeDetails}{supporting}</>}</FinancialChart>
      {cashFlowOnly && <FinancialChart annual={annual} monthly={monthly} kind="statement" stale={stale} />}
    </>}
    {annual.status === "unavailable" && <>{rangeDetails}{supporting}</>}
  </div>;
});

/** Calendar formatting only; coverage boundaries come unchanged from the selector. */
function coverageDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}
