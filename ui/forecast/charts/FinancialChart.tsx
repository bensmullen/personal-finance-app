"use client";

import { useId, useState } from "react";
import * as React from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastChartData, ForecastChartMetric, ForecastChartPeriod, ForecastChartValue } from "../../../src/application/forecastChartData.js";
import { formatExactMoney } from "../../entityPresentation.js";

type Kind = "wealth" | "cash" | "statement";
type Series = { key: ForecastChartMetric; label: string; color: string; dash?: string; bar?: boolean };
const cashLabel = "Total modeled cash (including cash in investment accounts)";
const families: Record<Kind, { title: string; series: readonly Series[] }> = {
  wealth: { title: "Assets, liabilities and net worth", series: [
    { key: "netWorth", label: "Net worth", color: "#1e6756" },
    { key: "totalAssets", label: "Total assets", color: "#3e5f8a", dash: "8 3" },
    { key: "totalLiabilities", label: "Total liabilities", color: "#9b5b2d", dash: "3 3" },
  ] },
  cash: { title: cashLabel, series: [
    { key: "totalModeledCash", label: cashLabel, color: "#1e6756" },
    { key: "totalModeledCashChange", label: "Signed cash balance change", color: "#785592", bar: true },
  ] },
  statement: { title: "Modeled statement income versus expenses", series: [
    { key: "modeledStatementIncome", label: "Recognized income", color: "#3e5f8a", bar: true },
    { key: "modeledStatementExpenses", label: "Recognized expenses", color: "#9b5b2d", bar: true },
  ] },
};
const date = (at: string) => at.slice(0, 10);
export const chartPeriodLabel = (point: ForecastChartPeriod) => `${date(point.periodStart)} → ${date(point.periodEnd)} (exclusive)${point.coverage === "partial_year" ? ` · partial year, ${point.coveredMonthCount} ${point.coveredMonthCount === 1 ? "month" : "months"}` : ""}`;

export function exactChartValue(value: ForecastChartValue, signed = false): string {
  if (value.amount === null || value.status === "unavailable") return "Unavailable";
  const sign = signed ? value.amount.startsWith("-") ? "Decrease · " : /^0(?:\.0+)?$/.test(value.amount) ? "No change · " : "Increase · +" : "";
  return `${sign}${formatExactMoney(value.amount, value.currency)}${value.status === "incomplete" ? " · Incomplete" : ""}${value.closingAt ? ` · closing ${date(value.closingAt)}` : ""}`;
}

/** Approximate coordinates only; exact strings remain in readouts/tables. */
export function chartCoordinate(value: ForecastChartValue): number | null {
  if (value.amount === null || value.status === "unavailable") return null;
  const number = Number(value.amount);
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER / 100 &&
    (number !== 0 || !/[1-9]/.test(value.amount)) ? number : null;
}
const axisAmount = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function ExactPeriod({ point, series }: { point: ForecastChartPeriod; series: readonly Series[] }) {
  return <><strong>Projected {chartPeriodLabel(point)}</strong><dl className="chart-exact-values">{series.map(item => <div key={item.key}><dt>{item.label}</dt><dd>{exactChartValue(point.metrics[item.key], item.key === "totalModeledCashChange")}</dd></div>)}</dl></>;
}

export function FinancialChart({ annual, monthly, kind, stale }: { annual: ForecastChartData; monthly: ForecastChartData; kind: Kind; stale: boolean }) {
  const id = useId();
  const { title, series } = families[kind];
  const [granularity, setGranularity] = useState<"annual" | "monthly">(kind === "statement" ? "monthly" : "annual");
  const [windowStart, setWindowStart] = useState("");
  const [selected, setSelected] = useState("");
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const source = granularity === "annual" ? annual : monthly;
  const chosenStart = monthly.points.findIndex(point => point.periodStart === windowStart);
  const startIndex = chosenStart < 0 ? kind === "statement" ? Math.max(0, monthly.points.length - 12) : 0 : chosenStart;
  const points = granularity === "annual" ? source.points : source.points.slice(startIndex, startIndex + 12);
  const active = points.find(point => point.periodStart === selected) ?? points.at(-1);
  const plotted = series.filter(item => !hidden.includes(item.key));
  const rows = points.map(point => Object.fromEntries([
    ["label", granularity === "annual" ? point.periodStart.slice(0, 4) : point.periodStart.slice(0, 7)],
    ["source", point],
    ...series.flatMap(item => ["complete", "incomplete"].map(status => [
      `${item.key}_${status}`, point.metrics[item.key].status === status ? chartCoordinate(point.metrics[item.key]) : null,
    ])),
  ]));
  const precisionOmitted = points.some(point => series.some(item => point.metrics[item.key].amount !== null && point.metrics[item.key].status !== "unavailable" && chartCoordinate(point.metrics[item.key]) === null));
  const partial = points.some(point => series.some(item => point.metrics[item.key].status !== "complete"));
  const opening = source.opening;
  return <figure className="forecast-figure financial-chart" aria-label={kind === "wealth" ? "Household financial outlook chart" : title}>
    <figcaption><h3 id={`${id}-title`}>{title}</h3>
      <p className="muted">Household · {source.currency} · Deterministic projection{stale ? " · out of date" : ""}. {kind === "statement" ? "Recognized modeling measures; these are not bank receipts/disbursements or disposable wages." : "Balances are period-closing stocks."} {kind === "cash" && "Bars show signed change in the same all-account cash balance, not salary less expenses."}</p>
    </figcaption>
    {opening && kind !== "statement" && <details className="chart-opening"><summary>Opening position · {date(opening.at)} · snapshot, separate from projected periods</summary><dl className="chart-exact-values">{series.filter(item => !item.bar).map(item => <div key={item.key}><dt>{item.label}</dt><dd>{exactChartValue(opening.metrics[item.key])}</dd></div>)}</dl></details>}
    {!points.length ? <p role="status">No modeled periods available. The opening snapshot is not projected history.</p> : <>
      <div className="chart-controls">
        <div className="chart-control"><label htmlFor={`${id}-grouping`}>Period grouping</label><select id={`${id}-grouping`} value={granularity} onChange={event => { setGranularity(event.target.value as "annual" | "monthly"); setSelected(""); }}><option value="annual">Annual · supported horizon</option><option value="monthly">Monthly · up to 12 months</option></select></div>
        {granularity === "monthly" && <div className="chart-control"><label htmlFor={`${id}-range`}>Monthly range starting</label><select id={`${id}-range`} value={monthly.points[startIndex]?.periodStart ?? ""} onChange={event => { setWindowStart(event.target.value); setSelected(""); }}>{monthly.points.map(point => <option key={point.periodStart} value={point.periodStart}>{point.periodStart.slice(0, 7)}</option>)}</select></div>}
        <div className="chart-control"><label htmlFor={`${id}-period`}>Selected projected period</label><select id={`${id}-period`} value={active?.periodStart ?? ""} onChange={event => setSelected(event.target.value)}>{points.map(point => <option key={point.periodStart} value={point.periodStart}>{chartPeriodLabel(point)}</option>)}</select></div>
      </div>
      <div className="chart-legend" role="group" aria-label={`${title} legend`}>{series.map((item, index) => <button key={item.key} type="button" aria-pressed={!hidden.includes(item.key)} onClick={() => setHidden(current => current.includes(item.key) ? current.filter(key => key !== item.key) : [...current, item.key])}><span aria-hidden="true" style={{ color: item.color }}>{item.bar ? "▥" : index === 0 ? "━━" : index === 1 ? "┄┄" : "···"}</span> {item.label}</button>)}</div>
      {!plotted.length && <p role="status">All series hidden. Choose a legend item to show it again; exact values remain below.</p>}
      {partial && <p className="chart-qualification">Incomplete values use dotted lines with markers or outlined bars. Unavailable values leave gaps. Tax and other capability limits remain unresolved; exact values below retain each metric’s status.</p>}
      <p className="chart-axis-note">{granularity === "annual" ? "Annual" : "Monthly"} {kind === "statement" ? "recognized period totals" : "closing balances"} ({source.currency}){kind === "cash" ? ` · right axis: signed ${granularity} balance change (${source.currency})` : ""}. Axis labels and positions are approximate; readouts are exact.</p>
      {precisionOmitted && <p role="note">Some amounts exceed chart display precision and are omitted from the graph. Exact values remain available below.</p>}
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={rows} accessibilityLayer barCategoryGap="10%" barGap={2} margin={{ top: 12, right: kind === "cash" ? 8 : 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" minTickGap={28} tickMargin={10} />
            <YAxis yAxisId="balance" width={54} tickFormatter={axisAmount} />
            {kind === "cash" && <YAxis yAxisId="change" orientation="right" width={54} tickFormatter={axisAmount} />}
            <ReferenceLine yAxisId={kind === "cash" ? "change" : "balance"} y={0} stroke="#66726d" />
            <Tooltip content={({ active: hovering, payload }) => {
              const point = payload?.[0]?.payload?.source as ForecastChartPeriod | undefined;
              return hovering && point ? <div className="chart-readout"><p>{point.granularity === "annual" ? "Annual" : "Monthly"} modeled period [start, end)</p><ExactPeriod point={point} series={series} /><p>{point.coveredMonthCount} covered {point.coveredMonthCount === 1 ? "source month" : "source months"}.</p></div> : null;
            }} />
            {plotted.flatMap(item => ["complete", "incomplete"].map(status => item.bar
              ? <Bar key={`${item.key}_${status}`} dataKey={`${item.key}_${status}`} stackId={item.key} yAxisId={kind === "cash" ? "change" : "balance"} fill={status === "incomplete" ? "#fff" : item.color} stroke={item.color} strokeWidth={2} strokeDasharray={status === "incomplete" ? "3 2" : undefined} isAnimationActive={false} />
              : <Line key={`${item.key}_${status}`} dataKey={`${item.key}_${status}`} yAxisId="balance" type="linear" stroke={item.color} strokeWidth={2} strokeDasharray={status === "incomplete" ? `${item.dash ?? "6 2"} 1 3` : item.dash} dot={{ r: status === "incomplete" ? 3 : 2 }} connectNulls={false} isAnimationActive={false} />))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {active && <div className="chart-selected" role="status" aria-label={`${title} exact selected period`}><ExactPeriod point={active} series={series} /></div>}
      <details className="chart-table"><summary>Show exact chart data · {points.length} {granularity === "annual" ? points.length === 1 ? "year" : "years" : points.length === 1 ? "month" : "months"}</summary>
        <div className="table-scroll" role="region" aria-label={`${title} exact data`} tabIndex={0}><table><caption>{title} · {stale ? "out of date retained result" : "modeled projection"} · current displayed range</caption><thead><tr><th scope="col">Projected period [start, end)</th>{series.map(item => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.periodStart}><th scope="row">{chartPeriodLabel(point)}</th>{series.map(item => <td key={item.key}>{exactChartValue(point.metrics[item.key], item.key === "totalModeledCashChange")}</td>)}</tr>)}</tbody></table></div>
      </details>
    </>}
    <details className="chart-basis"><summary>Chart sources &amp; basis</summary><p>Source: reconciled household forecast via the exact chart selector. Stock values use the last supported close; period totals sum only covered months. Partial years are not annualized.</p>{source.boundaries && <p>As of {source.boundaries.asOf}; data cutoff {source.boundaries.dataCutoff}. Actual/forecast boundary {source.boundaries.actualForecastBoundary}; all displayed periods are modeled, with no observed performance history.</p>}<p>Bank-only spendable cash, disposable payroll, investment attribution and retirement income by source are unavailable in these charts.</p>{source.sourceFingerprint && <p>Result fingerprint: <code>{source.sourceFingerprint}</code></p>}</details>
  </figure>;
}
