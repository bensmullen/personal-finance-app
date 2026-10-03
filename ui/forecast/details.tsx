import { useId, useState, type ReactNode } from "react";
import { friendlyText } from "../entityPresentation.js";
import { forecastPage } from "../../src/application/interactiveForecast.js";
import type { HouseholdExplanationReadModel } from "../../src/application/householdProjection.js";
import { ExplanationCache } from "./explanations.js";
export { ExplanationCache } from "./explanations.js";

export function ForecastDetails<T>({ result, rows, label, children }: {
  result: object; rows: readonly T[]; label: string; children: (rows: readonly T[]) => ReactNode;
}) {
  const [expandedResult, setExpandedResult] = useState<object>();
  const detailId = useId();
  const [pagination, setPagination] = useState({ result, page: 0 });
  const expanded = expandedResult === result;
  const page = pagination.result === result ? pagination.page : 0;
  const count = Math.max(1, Math.ceil(rows.length / 24));
  return <section className="forecast-details" aria-label={label}>
    <button aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpandedResult(expanded ? undefined : result)}>{expanded ? "Hide" : "Show"} {label}</button>
    {expanded && <div id={detailId}>
      <div className="forecast-pagination">
        <button disabled={page === 0} onClick={() => setPagination({ result, page: page - 1 })}>Previous page</button>
        <span role="status">Page {page + 1} of {count} · at most 24 rows per page</span>
        <button disabled={page + 1 >= count} onClick={() => setPagination({ result, page: page + 1 })}>Next page</button>
      </div>
      {children(forecastPage(rows, page))}
    </div>}
  </section>;
}

export function LazyExplanation({ cache, rowId, resolve, traceIds, differences }: {
  cache: ExplanationCache<HouseholdExplanationReadModel>; rowId: string; resolve: () => HouseholdExplanationReadModel;
  traceIds: readonly string[]; differences?: readonly string[];
}) {
  const [opened, setOpened] = useState(false);
  const [explanation, setExplanation] = useState<HouseholdExplanationReadModel>();
  return <details onToggle={(event) => {
    if (!event.currentTarget.open || opened) return;
    setExplanation(cache.get(rowId, resolve));
    setOpened(true);
  }}>
    <summary>Explain</summary>
    {opened && (explanation ? <>
      <p>Source records carried by this result: {explanation.sources.map((item) => item.label === item.objectId ? "Unavailable source record" : friendlyText(item.label)).join(", ") || "none resolved"}.</p>
      <p>Event references: {explanation.events.map((item) => item.label === item.eventId ? "Unavailable event reference" : friendlyText(item.label)).join(", ") || "none"}.</p>
      <details>
        <summary>Expert calculation details</summary>
        <p>Assumptions referenced by the calculation trace: {explanation.assumptions.map((item) => `${item.label === item.assumptionId ? "Unavailable assumption" : friendlyText(item.label)}${item.value ? ` (${item.value} ${item.unit ?? ""})` : ""}`).join(", ") || "none"}.</p>
        <p>Rules referenced by the calculation trace: {explanation.rules.map((item) => item.label === item.ruleId ? "Unavailable rule reference" : friendlyText(item.label)).join(", ") || "none"}.</p>
      </details>
      <details>
        <summary>Technical trace details</summary>
        {differences && <p>Scenario difference references: {differences.join(", ") || "none"}.</p>}
        <code>{traceIds.join("\n")}</code>
        <pre>{JSON.stringify(explanation, null, 2)}</pre>
      </details>
    </> : <p>Explanation unavailable.</p>)}
  </details>;
}
