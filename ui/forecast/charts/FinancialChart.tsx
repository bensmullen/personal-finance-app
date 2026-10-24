"use client";

import { useId, useState } from "react";
import * as React from "react";
import { Bar, Cell, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CashDetailsContent } from "../../calm/CalmPresentation.js";
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
    { key: "totalModeledCashChange", label: "Signed cash balance change", color: "#1e6756", bar: true },
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

/** Display attributes only; sign and coverage come from the exact selector. */
export function cashChangeAppearance(point: ForecastChartPeriod) {
  const value = point.metrics.totalModeledCashChange;
  const direction = value.amount === null || value.status === "unavailable" ? "unavailable" : /^-?0(?:\.0+)?$/.test(value.amount) ? "zero" : value.amount.startsWith("-") ? "decrease" : "increase";
  const color = direction === "decrease" ? "#a43d3d" : direction === "increase" ? "#1e6756" : "#66726d";
  return { fill: color, stroke: color, fillOpacity: point.coverage === "partial_year" || value.status === "incomplete" ? 0.4 : 1,
    "data-direction": direction, "data-coverage": point.coverage,
    "aria-label": `${chartPeriodLabel(point)} · ${direction} · ${exactChartValue(value, true)}` };
}
const axisAmount = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function readablePeriod(point: ForecastChartPeriod): string {
  const label = point.granularity === "annual" ? point.periodStart.slice(0, 4)
    : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(point.periodStart));
  return `${label}${point.coverage === "partial_year" ? ` · partial year, ${point.coveredMonthCount} covered months` : ""}`;
}

function ExactPeriod({ point, series, readable = false, compact = false }: { point: ForecastChartPeriod; series: readonly Series[]; readable?: boolean; compact?: boolean }) {
  return <><strong>Projected {readable ? readablePeriod(point) : chartPeriodLabel(point)}</strong><dl className="chart-exact-values">{series.map(item => <div key={item.key}><dt>{compact && item.key === "totalModeledCash" ? "Cash balance" : compact && item.key === "totalModeledCashChange" ? "Signed change" : item.label}</dt><dd>{exactChartValue(point.metrics[item.key], item.key === "totalModeledCashChange")}</dd></div>)}</dl></>;
}

function ChartDetails({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return collapsed ? <details className="chart-control-details"><summary>Chart controls and exact values</summary>{children}</details> : <>{children}</>;
}

function EvidenceGroup({ cashPage, title, children }: { cashPage: boolean; title: string; children: React.ReactNode }) {
  return cashPage ? <section aria-label={`${title} chart details`}>{children}</section> : <>{children}</>;
}

export function FinancialChart({ annual, monthly, kind, stale, calm = false, children }: { annual: ForecastChartData; monthly: ForecastChartData; kind: Kind; stale: boolean; calm?: boolean; children?: React.ReactNode }) {
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
  const calmWealth = calm && kind === "wealth";
  const cashPage = calm && kind !== "wealth";
  const Evidence = cashPage ? CashDetailsContent : React.Fragment;
  const cashAxis: React.ComponentProps<typeof YAxis> = kind === "cash" ? { domain: [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)], label: { value: source.currency ?? "Currency", angle: -90, position: "insideLeft" } } : {};
  const legend = <div className="chart-legend" role="group" aria-label={`${title} legend`}>{series.map((item, index) => <button key={item.key} type="button" aria-pressed={!hidden.includes(item.key)} onClick={() => setHidden(current => current.includes(item.key) ? current.filter(key => key !== item.key) : [...current, item.key])}><span aria-hidden="true" style={{ color: item.color }}>{item.bar ? "▥" : index === 0 ? "━━" : index === 1 ? "┄┄" : "···"}</span> {item.label}</button>)}</div>;
  const openingDetails = opening && kind !== "statement" && <details className="chart-opening"><summary>Opening position · {date(opening.at)} · snapshot, separate from projected periods</summary><dl className="chart-exact-values">{series.filter(item => !item.bar).map(item => <div key={item.key}><dt>{item.label}</dt><dd>{exactChartValue(opening.metrics[item.key])}</dd></div>)}</dl></details>;
  const controls = <div className="chart-controls">
    <div className="chart-control"><label htmlFor={`${id}-grouping`}>Period grouping</label><select id={`${id}-grouping`} value={granularity} onChange={event => { setGranularity(event.target.value as "annual" | "monthly"); setSelected(""); }}><option value="annual">Annual · supported horizon</option><option value="monthly">Monthly · up to 12 months</option></select></div>
    {granularity === "monthly" && <div className="chart-control"><label htmlFor={`${id}-range`}>Monthly range starting</label><select id={`${id}-range`} value={monthly.points[startIndex]?.periodStart ?? ""} onChange={event => { setWindowStart(event.target.value); setSelected(""); }}>{monthly.points.map(point => <option key={point.periodStart} value={point.periodStart}>{point.periodStart.slice(0, 7)}</option>)}</select></div>}
    <div className="chart-control"><label htmlFor={`${id}-period`}>Selected projected period</label><select id={`${id}-period`} value={active?.periodStart ?? ""} onChange={event => setSelected(event.target.value)}>{points.map(point => <option key={point.periodStart} value={point.periodStart}>{calm && kind !== "wealth" ? readablePeriod(point) : chartPeriodLabel(point)}</option>)}</select></div>
  </div>;
  return <figure className="forecast-figure financial-chart" aria-label={kind === "wealth" ? "Household financial outlook chart" : title}>
    <figcaption><h3 id={`${id}-title`}>{title}</h3>
      {!cashPage && <p className="muted">{calm && kind === "wealth" ? `How your assets, debts and net worth may change. Forecast, not account history · ${source.currency}${stale ? " · out of date" : ""}.` : <>Household · {source.currency} · Forecast, not account history{stale ? " · out of date" : ""}.</>}</p>}
    </figcaption>
    {!calmWealth && !cashPage && openingDetails}
    {!points.length ? <p className={calmWealth ? "calm-empty" : undefined} role="status">{calmWealth ? "No future periods are available. The recorded opening position is separate from a projected path." : "No modeled periods available. The opening snapshot is not projected history."}</p> : <>
      {!calmWealth && !cashPage && controls}
      {!cashPage && legend}
      {!plotted.length && <p role="status">All series hidden. Choose a legend item to show it again; exact values remain below.</p>}
      {partial && <p className="chart-qualification">{cashPage ? "Incomplete forecast · gaps are unavailable. Faded or outlined bars / dotted lines: incomplete values; partial years are not annualized." : calmWealth ? "Dotted lines mark incomplete values; gaps mean unavailable. Tax and other limits remain unresolved." : "Incomplete values use dotted lines with markers or outlined bars. Unavailable values leave gaps. Tax and other capability limits remain unresolved; exact values below retain each metric’s status."}</p>}
      {!calmWealth && !cashPage && <p className="chart-axis-note">{granularity === "annual" ? "Annual" : "Monthly"} {kind === "statement" ? "recognized period totals" : "closing balances"} ({source.currency}). Axis positions are approximate; readouts are exact.</p>}
      {precisionOmitted && <p role="note">Some amounts exceed chart display precision and are omitted from the graph. Exact values remain available below.</p>}
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={rows} accessibilityLayer stackOffset="sign" barCategoryGap="10%" barGap={2} margin={{ top: 12, right: kind === "cash" ? 8 : 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" minTickGap={28} tickMargin={10} />
            <YAxis yAxisId="balance" width={kind === "cash" ? 64 : 54} tickFormatter={axisAmount} {...cashAxis} />
            <ReferenceLine yAxisId="balance" y={0} stroke="#66726d" />
            {/* Bound x and wrapper width together so cursor offsets cannot
                push exact readouts beyond a narrow chart. */}
            <Tooltip position={cashPage ? { x: 0, y: 0 } : { x: 0 }} allowEscapeViewBox={{ x: false, y: false }} content={({ active: hovering, payload }) => {
              const point = payload?.[0]?.payload?.source as ForecastChartPeriod | undefined;
              return hovering && point ? <div className="chart-readout"><p>{point.granularity === "annual" ? "Annual" : "Monthly"} modeled period [start, end)</p><ExactPeriod point={point} series={series} compact={cashPage} /><p>{point.coveredMonthCount} covered {point.coveredMonthCount === 1 ? "source month" : "source months"}.</p></div> : null;
            }} />
            {plotted.flatMap(item => ["complete", "incomplete"].map(status => item.bar
              ? <Bar key={`${item.key}_${status}`} className={`chart-bar-${item.key}-${status}`} dataKey={`${item.key}_${status}`} stackId={item.key} yAxisId="balance" fill={status === "incomplete" ? "#fff" : item.color} stroke={item.color} strokeWidth={2} strokeDasharray={status === "incomplete" ? "3 2" : undefined} isAnimationActive={false}>
                {kind === "cash" && points.map(point => <Cell key={point.periodStart} {...cashChangeAppearance(point)} />)}
              </Bar>
              : <Line key={`${item.key}_${status}`} dataKey={`${item.key}_${status}`} yAxisId="balance" type="linear" stroke={item.color} strokeWidth={2} strokeDasharray={status === "incomplete" ? `${item.dash ?? "6 2"} 1 3` : item.dash} dot={{ r: status === "incomplete" ? 3 : 2 }} connectNulls={false} isAnimationActive={false} />))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {cashPage && legend}
      {cashPage && <><p className="chart-axis-note">{kind === "cash" ? `Balance and signed change · one ${source.currency} axis. Green + / red −; faded means incomplete. Small changes share the balance scale; use monthly zoom or exact values.` : "Recognized flows · not bank receipts/disbursements or disposable wages."}</p>{controls}
        {active && <div className="chart-selected" role="status" aria-label={`${title} exact selected period`}><ExactPeriod point={active} series={series} readable compact /></div>}
      </>}
    </>}
    <Evidence>
    <EvidenceGroup cashPage={cashPage} title={title}>
    {cashPage && <h3>{title} · details</h3>}
    <ChartDetails collapsed={calmWealth}>
      <p>{kind === "statement" ? "Income and expenses when recognized; not bank receipts/disbursements or disposable wages." : "Balances are period-closing stocks."} {kind === "cash" && "Bars show signed change in the same all-account cash balance, not salary less expenses. Positive changes are green, negative changes are red, zero is neutral. Faded bars mark incomplete values or partial years; unavailable values leave gaps. Partial years are not annualized."}</p>
      {calmWealth && <p className="chart-axis-note">{granularity === "annual" ? "Annual" : "Monthly"} closing balances ({source.currency}). Axis labels and positions are approximate; readouts are exact.</p>}
      {children}
      {calmWealth && points.length > 0 && controls}
      {!cashPage && active && <div className="chart-selected" role="status" aria-label={`${title} exact selected period`}><ExactPeriod point={active} series={series} readable={calm && kind !== "wealth"} /></div>}
      {points.length > 0 && <details className="chart-table"><summary>Show exact chart data · {points.length} {granularity === "annual" ? points.length === 1 ? "year" : "years" : points.length === 1 ? "month" : "months"}</summary>
        <div className="table-scroll" role="region" aria-label={`${title} exact data`} tabIndex={0}><table><caption>{title} · {stale ? "out of date retained result" : "modeled projection"} · current displayed range</caption><thead><tr><th scope="col">Projected period [start, end)</th>{series.map(item => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.periodStart}><th scope="row">{chartPeriodLabel(point)}</th>{series.map(item => <td key={item.key}>{exactChartValue(point.metrics[item.key], item.key === "totalModeledCashChange")}</td>)}</tr>)}</tbody></table></div>
      </details>}
    {(calmWealth || cashPage) && openingDetails}
    <details className="chart-basis"><summary>Chart sources &amp; basis</summary><p>Source: reconciled household forecast via the exact chart selector. Stock values use the last supported close; period totals sum only covered months. Partial years are not annualized.</p>{source.boundaries && <p>As of {source.boundaries.asOf}; data cutoff {source.boundaries.dataCutoff}. Actual/forecast boundary {source.boundaries.actualForecastBoundary}; all displayed periods are modeled, with no observed performance history.</p>}<p>Bank-only spendable cash, disposable payroll, investment attribution and retirement income by source are unavailable in these charts.</p>{source.sourceFingerprint && <p>Result fingerprint: <code>{source.sourceFingerprint}</code></p>}</details>
    </ChartDetails>
    </EvidenceGroup>
    </Evidence>
  </figure>;
}
