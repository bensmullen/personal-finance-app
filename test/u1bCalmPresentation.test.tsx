import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalmDisclosure, CalmMetric } from "../ui/calm/CalmPresentation.js";
import { HouseholdChart } from "../ui/forecast/HouseholdChart.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { createGoldenHouseholdSessionConfiguration } from "../src/application/goldenHousehold.js";
import { createHouseholdForecastRequest, runPersonalHouseholdForecast } from "../src/application/householdProjection.js";

describe("Calm sourced read-only presentation", () => {
  it("preserves an exact source amount beyond binary precision and escapes source text", () => {
    const html = renderToStaticMarkup(<CalmMetric label="Cash and savings" value="9,007,199,254,740,993.001 KWD" source="Recorded accounts · as of 2026-01-01" explanation="Excludes <investment> cash." />);
    expect(html).toContain("9,007,199,254,740,993.001 KWD");
    expect(html.match(/Recorded accounts · as of 2026-01-01/g)).toHaveLength(1);
    expect(html).toContain("Excludes &lt;investment&gt; cash.");
    expect(html).not.toMatch(/<input|<select|<button/);
  });

  it("distinguishes missing values from a recorded zero without synthesizing a result", () => {
    const missing = renderToStaticMarkup(<CalmMetric label="Net worth" value={undefined} source="Recorded assets less liabilities" explanation="Some sources are unavailable." />);
    const zero = renderToStaticMarkup(<CalmMetric label="Net worth" value="0.00 USD" source="Recorded assets less liabilities" explanation="Recorded zero." />);
    expect(missing).toContain("Unavailable");
    expect(missing).not.toContain("0.00");
    expect(zero).toContain("0.00 USD");
    expect(zero).not.toContain("Unavailable");
  });

  it("retains source limitations in a named native disclosure, collapsed by default", () => {
    const html = renderToStaticMarkup(<CalmDisclosure title="How this is calculated / data coverage"><p>After-tax totals are unavailable.</p></CalmDisclosure>);
    expect(html).toContain("<summary>How this is calculated / data coverage</summary>");
    expect(html).toContain("After-tax totals are unavailable.");
    expect(html).not.toMatch(/\sopen(?:[=>\s])/);
  });

  it("keeps partial and stale coverage visible while disclosing exact boundaries only on Overview", () => {
    const result = runPersonalHouseholdForecast(createGoldenHouseholdDraft(), createHouseholdForecastRequest({
      ...createGoldenHouseholdSessionConfiguration(), simulationEnd: "2026-04-01",
    }, "94000000-0000-4000-8000-000000000170"));
    if (result.status === "unavailable" || !result.points[0]) throw new Error("Expected supported synthetic forecast points");
    // A bounded partial-result presentation fixture uses genuine engine points;
    // its requested horizon is retained rather than filling the missing months.
    const partial = { ...result, status: "incomplete" as const, points: result.points.slice(0, 1), reachedThrough: result.points[0].periodEnd, stoppedAt: result.points[0].periodEnd };
    const before = JSON.stringify(partial);
    const overview = renderToStaticMarkup(<HouseholdChart forecast={partial} cashFlowOnly={false} stale calm sourceFingerprint="synthetic-coverage" />);
    const disclosureStart = overview.indexOf('<details class="calm-disclosure chart-range"');
    expect(disclosureStart).toBeGreaterThan(0);
    const visibleCoverage = overview.slice(0, overview.indexOf('<figure class="forecast-figure financial-chart"'));
    expect(visibleCoverage).toContain("Out of date");
    expect(visibleCoverage).toContain("Partial horizon");
    expect(visibleCoverage).toContain("available results end before February 1, 2026");
    expect(visibleCoverage).toContain("No past account history is included.");
    expect(visibleCoverage).not.toContain("exclusive");
    expect(overview).toContain('<summary>Forecast range / Data coverage</summary>');
    expect(overview).toContain(`<dt>Requested end (exclusive)</dt><dd>${partial.requestedHorizon.end}</dd>`);
    expect(overview).toContain(`<dt>Available results end (exclusive)</dt><dd>${partial.reachedThrough}</dd>`);
    expect(overview).not.toContain('chart-range" open');
    const cash = renderToStaticMarkup(<HouseholdChart forecast={partial} cashFlowOnly stale sourceFingerprint="synthetic-coverage" />);
    expect(cash).not.toContain("chart-range");
    expect(cash).toContain("Requested 2026-01-01");
    expect(cash).toContain("(exclusive). Modeled through 2026-02-01");
    expect(cash).toContain("No observed history loaded.");
    expect(JSON.stringify(partial)).toBe(before);
  });
});
