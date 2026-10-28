"use client";

import { useEffect, useId, useState } from "react";
import * as React from "react";
import { Bar, Cell, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CashChartDetails, ForecastProgress } from "../../calm/CalmPresentation.js";
import type { ForecastChartData, ForecastChartMetric, ForecastChartPeriod, ForecastChartValue } from "../../../src/application/forecastChartData.js";
import { formatExactMoney } from "../../entityPresentation.js";

type Kind = "wealth" | "cash" | "statement";
type Series = { key: ForecastChartMetric; label: string; color: string; dash?: string; bar?: boolean };
const cashLabel = "Total Cash Balance";
const families: Record<Kind, { title: string; series: readonly Series[] }> = {
  wealth: { title: "Assets, liabilities and net worth", series: [
    { key: "netWorth", label: "Net worth", color: "#1e6756" },
    { key: "totalAssets", label: "Total assets", color: "#3e5f8a", dash: "8 3" },
    { key: "totalLiabilities", label: "Total liabilities", color: "#9b5b2d", dash: "3 3" },
  ] },
  cash: { title: cashLabel, series: [
    { key: "totalModeledCash", label: cashLabel, color: "#1e6756" },
    { key: "totalModeledCashChange", label: "Cash Balance Change", color: "#1e6756", bar: true },
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

function ExactPeriod({ point, series, readable = false }: { point: ForecastChartPeriod; series: readonly Series[]; readable?: boolean }) {
  return <><strong>Projected {readable ? readablePeriod(point) : chartPeriodLabel(point)}</strong><dl className="chart-exact-values">{series.map(item => <div key={item.key}><dt>{item.label}</dt><dd>{exactChartValue(point.metrics[item.key], item.key === "totalModeledCashChange")}</dd></div>)}</dl></>;
}

/** Compact decimal-string formatting is display only, never financial arithmetic. */
export function compactChartValue(value: ForecastChartValue, signed = false): string {
  if (value.amount === null || value.status === "unavailable") return "Unavailable";
  const negative = value.amount.startsWith("-");
  const [whole = "0", fraction = ""] = value.amount.replace(/^-/, "").split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  const power = digits.length > 9 ? 9 : digits.length > 6 ? 6 : digits.length > 3 ? 3 : 0;
  const suffix = power === 9 ? "B" : power === 6 ? "M" : power === 3 ? "k" : "";
  const raw = BigInt(`${digits}${fraction.padEnd(2, "0").slice(0, 2)}`);
  const divisor = 10n ** BigInt(power);
  const rounded = power ? (raw + divisor / 2n) / divisor : raw + ((fraction[2] ?? "0") >= "5" ? 1n : 0n);
  const text = `${rounded / 100n}.${String(rounded % 100n).padStart(2, "0")}`.replace(/\.00$/, "");
  const zero = !/[1-9]/.test(value.amount);
  return `${negative && !zero ? "−" : signed && !zero ? "+" : ""}${value.currency === "USD" ? "$" : `${value.currency} `}${text}${suffix}${value.status === "incomplete" ? " · incomplete" : ""}`;
}

export function CompactPeriod({ point, series, stale = false }: { point: ForecastChartPeriod; series: readonly Series[]; stale?: boolean }) {
  return <div className="chart-compact-readout"><small>{point.periodStart.slice(0, point.granularity === "annual" ? 4 : 7)} · projected{point.coverage === "partial_year" ? " · partial" : ""}{stale ? " · out of date" : ""}</small>{series.map(item => <div key={item.key}>{item.key === "totalModeledCash" ? "Total" : item.key === "totalModeledCashChange" ? "Change" : item.label}: {compactChartValue(point.metrics[item.key], item.key === "totalModeledCashChange")}</div>)}</div>;
}

/** Recharts supplies the active band for bars and a single x for lines. */
function PeriodCrosshair({ points, width = 0, height = 0 }: { points?: readonly { x: number; y: number }[]; width?: number; height?: number }) {
  const point = points?.[0];
  const x = point ? point.x + (points?.[1] ? 0 : width / 2) : 0;
  return point ? <line className="chart-crosshair" x1={x} x2={x} y1={point.y} y2={points?.[1]?.y ?? point.y + height} stroke="#66726d" strokeWidth={1} pointerEvents="none" /> : null;
}

export function FinancialChart({ annual, monthly, kind, stale, pending = false, calm = false, children }: { annual: ForecastChartData; monthly: ForecastChartData; kind: Kind; stale: boolean; pending?: boolean; calm?: boolean; children?: React.ReactNode }) {
  const id = useId();
  const { title, series } = families[kind];
  const [granularity, setGranularity] = useState<"annual" | "monthly">(kind === "statement" ? "monthly" : "annual");
  const [windowStart, setWindowStart] = useState("");
  const [selected, setSelected] = useState("");
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [readoutRoom, setReadoutRoom] = useState(88);
  useEffect(() => {
    // Reserve scaled text space above the plot, including browser text enlargement.
    const update = () => setReadoutRoom(Math.ceil(parseFloat(getComputedStyle(document.documentElement).fontSize) * 5.5));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  const source = granularity === "annual" ? annual : monthly;
  const chosenStart = monthly.points.findIndex(point => point.periodStart === windowStart);
  const startIndex = chosenStart < 0 ? kind === "statement" ? Math.max(0, monthly.points.length - 12) : 0 : chosenStart;
  const points = granularity === "annual" ? source.points : source.points.slice(startIndex, startIndex + 12);
  const active = points.find(point => point.periodStart === selected) ?? points.at(-1);
  const plotted = series.filter(item => !hidden.includes(item.key));
  const rows = points.map(point => Object.fromEntries([
    ["label", granularity === "annual" ? point.periodStart.slice(0, 4) : point.periodStart.slice(0, 7)],
    ["source", point],
    ...plotted.flatMap(item => ["complete", "incomplete"].map(status => [
      `${item.key}_${status}`, point.metrics[item.key].status === status ? chartCoordinate(point.metrics[item.key]) : null,
    ])),
  ]));
  const precisionOmitted = points.some(point => series.some(item => point.metrics[item.key].amount !== null && point.metrics[item.key].status !== "unavailable" && chartCoordinate(point.metrics[item.key]) === null));
  const partial = points.some(point => series.some(item => point.metrics[item.key].status !== "complete"));
  const opening = source.opening;
  const calmWealth = calm && kind === "wealth";
  const cashAxis: React.ComponentProps<typeof YAxis> = kind === "cash" ? { domain: [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)], label: { value: source.currency ?? "Currency", angle: -90, position: "insideLeft" } } : {};
  const legend = <div className="chart-legend" role="group" aria-label={`${title} legend`}>{series.map((item, index) => <button key={item.key} type="button" aria-pressed={!hidden.includes(item.key)} onClick={() => setHidden(current => current.includes(item.key) ? current.filter(key => key !== item.key) : [...current, item.key])}><span aria-hidden="true" style={{ color: item.color }}>{item.bar ? "▥" : index === 0 ? "━━" : index === 1 ? "┄┄" : "···"}</span> {item.label}</button>)}</div>;
  const openingDetails = opening && kind !== "statement" && <details className="chart-opening"><summary>Opening position · {date(opening.at)} · snapshot, separate from projected periods</summary><dl className="chart-exact-values">{series.filter(item => !item.bar).map(item => <div key={item.key}><dt>{item.label}</dt><dd>{exactChartValue(opening.metrics[item.key])}</dd></div>)}</dl></details>;
  const controls = <div className="chart-controls">
    <div className="chart-control"><label htmlFor={`${id}-grouping`}>Period</label><select id={`${id}-grouping`} value={granularity} onChange={event => { setGranularity(event.target.value as "annual" | "monthly"); setSelected(""); }}><option value="annual">Annual · supported horizon</option><option value="monthly">Monthly · up to 12 months</option></select></div>
    {granularity === "monthly" && <div className="chart-control"><label htmlFor={`${id}-range`}>Monthly range starting</label><select id={`${id}-range`} value={monthly.points[startIndex]?.periodStart ?? ""} onChange={event => { setWindowStart(event.target.value); setSelected(""); }}>{monthly.points.map(point => <option key={point.periodStart} value={point.periodStart}>{point.periodStart.slice(0, 7)}</option>)}</select></div>}
    <div className="chart-control"><label htmlFor={`${id}-period`}>Selected projected period</label><select id={`${id}-period`} value={active?.periodStart ?? ""} onChange={event => setSelected(event.target.value)}>{points.map(point => <option key={point.periodStart} value={point.periodStart}>{calm && kind !== "wealth" ? readablePeriod(point) : chartPeriodLabel(point)}</option>)}</select></div>
  </div>;
  return <figure className="forecast-figure financial-chart" aria-label={kind === "wealth" ? "Household financial outlook chart" : title} aria-busy={pending}>
    <figcaption><h3 id={`${id}-title`}>{title}</h3>
      {kind === "cash" && <p className="chart-subtitle">(Including cash in investment accounts)</p>}
      <p className="chart-qualification">Projected · {source.currency}{stale || pending ? " · out of date retained result" : ""}</p>
      <ForecastProgress pending={pending} retained={points.length > 0} />
    </figcaption>
    {!points.length ? <p className={calmWealth ? "calm-empty" : undefined} role="status">{calmWealth ? "No future periods are available. The recorded opening position is separate from a projected path." : "No modeled periods available. The opening snapshot is not projected history."}</p> : <>
      {!plotted.length && <p role="status">All series hidden. Choose a legend item to show it again; exact values remain below.</p>}
      {partial && <p className="chart-qualification">Incomplete forecast · gaps are unavailable.</p>}
      {precisionOmitted && <p role="note">Some amounts exceed chart display precision. Exact values remain in Chart Details.</p>}
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={rows} accessibilityLayer stackOffset="sign" barCategoryGap="10%" barGap={2} margin={{ top: readoutRoom, right: kind === "cash" ? 8 : 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" minTickGap={28} tickMargin={10} />
            <YAxis yAxisId="balance" width={kind === "cash" ? 64 : 54} tickFormatter={axisAmount} {...cashAxis} />
            <ReferenceLine yAxisId="balance" y={0} stroke="#66726d" />
            {/* Reserve space above the plot; Recharts bounds horizontal placement. */}
            <Tooltip filterNull={false} cursor={<PeriodCrosshair />} offset={4} position={{ y: 0 }} allowEscapeViewBox={{ x: false, y: false }} content={({ active: hovering, payload }) => {
              const point = payload?.[0]?.payload?.source as ForecastChartPeriod | undefined;
              return hovering && point && plotted.length ? <CompactPeriod point={point} series={plotted} stale={stale || pending} /> : null;
            }} />
            {plotted.flatMap(item => ["complete", "incomplete"].map(status => item.bar
              ? <Bar key={`${item.key}_${status}`} className={`chart-bar-${item.key}-${status}`} dataKey={`${item.key}_${status}`} stackId={item.key} yAxisId="balance" fill={status === "incomplete" ? "#fff" : item.color} stroke={item.color} strokeWidth={2} strokeDasharray={status === "incomplete" ? "3 2" : undefined} isAnimationActive={false}>
                {kind === "cash" && points.map(point => <Cell key={point.periodStart} {...cashChangeAppearance(point)} />)}
              </Bar>
              // Recharts renders a fallback dot for a singleton even when dot=false.
              // An empty renderer suppresses that glyph while retaining its tooltip payload.
              : <Line key={`${item.key}_${status}`} dataKey={`${item.key}_${status}`} yAxisId="balance" type="linear" stroke={item.color} strokeWidth={2} strokeDasharray={status === "incomplete" ? `${item.dash ?? "6 2"} 1 3` : item.dash} dot={rows.length === 1 ? () => <g /> : false} activeDot={false} connectNulls={false} isAnimationActive={false} />))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {legend}{controls}
    </>}
    <CashChartDetails title={title}><section aria-label={`${title} chart details`}>
      <p>Forecast, not account history · {source.currency}. Axis positions and compact hover amounts are approximate; tables and selected values retain exact source amounts.</p>
      <p>Dashed lines and faded bars indicate incomplete values; gaps are unavailable. Partial years are not annualized.</p>
      <p>{kind === "statement" ? "Income and expenses when recognized; not bank receipts/disbursements or disposable wages." : "Balances are period-closing stocks."} {kind === "cash" && "Bars show signed change in the same all-account cash balance, not salary less expenses. Positive changes are green, negative changes are red, zero is neutral. Faded bars mark incomplete values or partial years; unavailable values leave gaps. Partial years are not annualized."}</p>
      {calmWealth && <p className="chart-axis-note">{granularity === "annual" ? "Annual" : "Monthly"} closing balances ({source.currency}). Axis labels and positions are approximate; readouts are exact.</p>}
      {children}
      {active && <div className="chart-selected" role="status" aria-label={`${title} exact selected period`}><ExactPeriod point={active} series={series} readable={calm && kind !== "wealth"} /></div>}
      {points.length > 0 && <details className="chart-table"><summary>Show exact chart data · {points.length} {granularity === "annual" ? points.length === 1 ? "year" : "years" : points.length === 1 ? "month" : "months"}</summary>
        <div className="table-scroll" role="region" aria-label={`${title} exact data`} tabIndex={0}><table><caption>{title} · {stale ? "out of date retained result" : "modeled projection"} · current displayed range</caption><thead><tr><th scope="col">Projected period [start, end)</th>{series.map(item => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.periodStart}><th scope="row">{chartPeriodLabel(point)}</th>{series.map(item => <td key={item.key}>{exactChartValue(point.metrics[item.key], item.key === "totalModeledCashChange")}</td>)}</tr>)}</tbody></table></div>
      </details>}
    {openingDetails}
    <details className="chart-basis"><summary>Chart sources &amp; basis</summary><p>Source: reconciled household forecast via the exact chart selector. Stock values use the last supported close; period totals sum only covered months. Partial years are not annualized.</p>{source.boundaries && <p>As of {source.boundaries.asOf}; data cutoff {source.boundaries.dataCutoff}. Actual/forecast boundary {source.boundaries.actualForecastBoundary}; all displayed periods are modeled, with no observed performance history.</p>}<p>Bank-only spendable cash, disposable payroll, investment attribution and retirement income by source are unavailable in these charts.</p>{source.sourceFingerprint && <p>Result fingerprint: <code>{source.sourceFingerprint}</code></p>}</details>
    </section></CashChartDetails>
  </figure>;
}
