import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalmDisclosure, CalmMetric } from "../ui/calm/CalmPresentation.js";

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
});
