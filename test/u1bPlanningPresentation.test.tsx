import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createGoldenHouseholdExampleDraft } from "../src/application/personalMvp.js";
import { RetirementIncomeChart } from "../ui/forecast/RetirementIncomeChart.js";

describe("Planning source-truthful presentation", () => {
  it.each(["idle", "error", "cancelled", "unsupported"])("retains explicit source and lifecycle gaps for %s", lifecycle => {
    const html = renderToStaticMarkup(React.createElement(RetirementIncomeChart, { draft: createGoldenHouseholdExampleDraft(), asOf: "2026-01-01", start: "2026-01-01", end: "2080-01-01", stale: false, pending: false, lifecycle, onEvents: () => {} }));
    expect(html).toContain("Retirement source breakdown unavailable");
    expect(html).toContain("Confirmed retirement event");
    expect(html).toContain("2080-01-01");
    expect(html).toContain("cutoff is not a death date");
    expect(html).toContain("Review retirement dates");
    expect(html).not.toContain("recharts-surface");
    expect(html).not.toContain("fully modeled to 90");
    if (lifecycle === "error") expect(html).toContain("Forecast failed.");
    if (lifecycle === "cancelled") expect(html).toContain("Forecast cancelled.");
  });
});
