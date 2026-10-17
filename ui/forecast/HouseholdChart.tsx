"use client";

import { memo, useMemo } from "react";
import * as React from "react";
import { selectForecastChartData } from "../../src/application/forecastChartData.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import { FinancialChart } from "./charts/FinancialChart.js";

/** Only the application selector groups periods or derives financial values. */
export const HouseholdChart = memo(function HouseholdChart({ forecast, cashFlowOnly, stale = false, sourceFingerprint }: {
  forecast: PersonalHouseholdForecastReadModel;
  cashFlowOnly: boolean;
  stale?: boolean;
  sourceFingerprint?: string;
}) {
  const annual = useMemo(() => selectForecastChartData(forecast, { granularity: "annual", sourceFingerprint }), [forecast, sourceFingerprint]);
  const monthly = useMemo(() => selectForecastChartData(forecast, { granularity: "monthly", sourceFingerprint }), [forecast, sourceFingerprint]);
  return <div className="financial-charts" data-chart-status={annual.status} data-supported-months={monthly.points.length} data-unavailable-reason={annual.unavailableReason}>
    {stale && <p className="chart-freshness" role="status">Out of date · retained forecast from the previous applied inputs. Update the forecast before relying on these values.</p>}
    {annual.boundaries && <p className="chart-coverage">Requested {annual.boundaries.requestedHorizon.start.slice(0, 10)} → {annual.boundaries.requestedHorizon.end.slice(0, 10)} (exclusive). Modeled through {(annual.boundaries.reachedThrough ?? annual.boundaries.requestedHorizon.start).slice(0, 10)} (exclusive). {annual.horizonCoverage === "partial" && <strong>Partial horizon · no projection beyond this boundary. </strong>}No observed history loaded.</p>}
    {annual.status === "unavailable" ? <p role="status">Chart data unavailable. Review forecast diagnostics and source setup; no values have been substituted.</p> : <>
      <FinancialChart key={cashFlowOnly ? "cash" : "wealth"} annual={annual} monthly={monthly} kind={cashFlowOnly ? "cash" : "wealth"} stale={stale} />
      {cashFlowOnly && <FinancialChart annual={annual} monthly={monthly} kind="statement" stale={stale} />}
    </>}
  </div>;
});
