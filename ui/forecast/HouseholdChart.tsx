"use client";

import { memo, useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { sampleForecastChart } from "../../src/application/interactiveForecast.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import { formatExactMoney } from "../entityPresentation.js";

type Result = Extract<PersonalHouseholdForecastReadModel, { status: "completed" | "incomplete" }>;
type Point = Result["points"][number];
type ChartPoint = { period: string; source: Point; netWorth: number; assets: number; liabilities: number; cash: number; income: number; expenses: number };
const axisAmount = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
function Readout({ active, payload }: { active?: boolean; payload?: readonly { payload?: ChartPoint }[] }) {
  const point = payload?.[0]?.payload?.source;
  if (!active || !point) return null;
  return <div className="chart-readout">
    <strong>Month starting {point.periodStart.slice(0, 10)}</strong>
    <dl>
      <dt>Net worth</dt><dd>{formatExactMoney(point.netWorth.amount, point.netWorth.currency)}</dd>
      <dt>Assets</dt><dd>{formatExactMoney(point.totalAssets.amount, point.totalAssets.currency)}</dd>
      <dt>Liabilities</dt><dd>{formatExactMoney(point.totalLiabilities.amount, point.totalLiabilities.currency)}</dd>
      <dt>Cash</dt><dd>{formatExactMoney(point.cash.amount, point.cash.currency)}</dd>
      <dt>Income</dt><dd>{formatExactMoney(point.statementIncome.amount, point.statementIncome.currency)}</dd>
      <dt>Expenses</dt><dd>{formatExactMoney(point.statementExpenses.amount, point.statementExpenses.currency)}</dd>
    </dl>
  </div>;
}

/** Display coordinates and chart interactions never feed back into execution. */
export const HouseholdChart = memo(function HouseholdChart({ forecast, cashFlowOnly }: { forecast: Result; cashFlowOnly: boolean }) {
  const chart = useMemo(() => sampleForecastChart(forecast.points).map((point) => ({
    period: point.periodStart.slice(0, 7), source: point,
    netWorth: Number(point.netWorth.amount), assets: Number(point.totalAssets.amount),
    liabilities: Number(point.totalLiabilities.amount), cash: Number(point.cash.amount),
    income: Number(point.statementIncome.amount), expenses: Number(point.statementExpenses.amount),
  })), [forecast.points]);
  const first = forecast.points[0], last = forecast.points.at(-1);
  if (!first || !last) return <p>No monthly forecast points are available.</p>;
  return <figure className="forecast-figure" aria-label={cashFlowOnly ? "Monthly income and expenses chart" : "Household financial outlook chart"}>
    <figcaption>
      <strong>{cashFlowOnly ? "Monthly income and expenses" : "Household outlook"} · {first.netWorth.currency}</strong>
      <p>{cashFlowOnly
        ? `Last modeled month: income ${formatExactMoney(last.statementIncome.amount, last.statementIncome.currency)}; expenses ${formatExactMoney(last.statementExpenses.amount, last.statementExpenses.currency)}.`
        : `Net worth: ${formatExactMoney(first.netWorth.amount, first.netWorth.currency)} at the first modeled month → ${formatExactMoney(last.netWorth.amount, last.netWorth.currency)} at the last modeled month.`}</p>
      <p className="muted">Deterministic projection under configured assumptions. Month labels mark period starts. Use arrow keys in the chart to inspect points, or Show forecast details for the full monthly readout.</p>
    </figcaption>
    <div className="chart">
      <ResponsiveContainer>
        <LineChart data={chart} accessibilityLayer margin={{ top: 12, right: 16, bottom: 12, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" minTickGap={40} tickMargin={10} />
          <YAxis width={70} tickFormatter={axisAmount} />
          <Tooltip content={<Readout />} />
          <Legend />
          {cashFlowOnly ? <>
            <Line dataKey="income" name="Income" stroke="#26755f" strokeWidth={3} dot={false} isAnimationActive={false} />
            <Line dataKey="expenses" name="Expenses" stroke="#9b5b2d" strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
          </> : <>
            <Line dataKey="netWorth" name="Net worth" stroke="#26755f" strokeWidth={3} dot={false} isAnimationActive={false} />
            <Line dataKey="assets" name="Total assets" stroke="#3e5f8a" strokeDasharray="8 3" dot={false} isAnimationActive={false} />
            <Line dataKey="liabilities" name="Liabilities" stroke="#9b5b2d" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            <Line dataKey="cash" name="Cash" stroke="#785592" strokeDasharray="10 3 2 3" dot={false} isAnimationActive={false} />
          </>}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </figure>;
});
