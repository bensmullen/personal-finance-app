import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SharedContextRibbon, forecastContextLabel } from "../ui/calm/CalmPresentation.js";
import { sharedContextIdentity } from "../ui/PersonalFinanceApp.js";
import { createEmptyPersonalDraft, createGoldenHouseholdDraft } from "../src/application/personalMvp.js";

describe("shared household context", () => {
  it.each([
    ["completed", false, false, false, "Ready"],
    ["completed", true, false, false, "Running"],
    ["completed", false, true, false, "Out of date"],
    ["completed", false, false, true, "Out of date"],
    ["incomplete", false, false, false, "Partial"],
    ["unsupported", false, false, false, "Unsupported"],
    ["error", false, true, false, "Failed"],
    ["idle", false, false, false, "Needs setup"],
    ["cancelled", false, true, false, "Cancelled"],
    ["unknown", false, false, false, "Unavailable"],
  ])("preserves %s lifecycle (pending %s, stale %s, setup %s)", (lifecycle, pending, stale, setup, expected) => {
    expect(forecastContextLabel({ lifecycle, pending, stale }, setup)).toBe(expected);
  });

  it("uses real canonical labels, distinct IDs for duplicate names, and explicit empty states", () => {
    const empty = createEmptyPersonalDraft("94000000-0000-4000-8000-000000000240");
    expect(sharedContextIdentity(empty)).toEqual({ household: "Unnamed household", people: [], plan: "No active plan" });
    const draft = createGoldenHouseholdDraft();
    const original = JSON.stringify(draft);
    const one = sharedContextIdentity(draft);
    expect(one.people).toHaveLength(1);
    expect(one.people[0]!.label).toBe("Taylor Example");
    const person = draft.objects.Person![0] as Record<string, any>;
    const duplicates = { ...draft, objects: { ...draft.objects, Person: [person, { ...person, person_id: "94000000-0000-4000-8000-000000000241" }, { ...person, person_id: "94000000-0000-4000-8000-000000000242", first_name: "", last_name: "" }] } };
    const identity = sharedContextIdentity(duplicates);
    expect(new Set(identity.people.map(item => item.id)).size).toBe(3);
    expect(identity.people.map(item => item.label)).toEqual(["Taylor Example · member 1 · born 1990-01-01", "Taylor Example · member 2 · born 1990-01-01", "Unnamed person"]);
    expect(JSON.stringify(draft)).toBe(original);
  });

  it("prefers the actual executable root over the saved plan and qualifies fallback", () => {
    const draft = createGoldenHouseholdDraft();
    const selectedId = "94000000-0000-4000-8000-000000000243";
    const scenario = draft.objects.Scenario![0] as Record<string, any>;
    const changed = { ...draft, objects: { ...draft.objects, Scenario: [...draft.objects.Scenario!, { ...scenario, scenario_id: selectedId, name: "Selected executable plan" }] } };
    expect(sharedContextIdentity(changed, selectedId).plan).toBe("Selected executable plan");
    expect(sharedContextIdentity(draft, "missing").plan).toContain("saved plan (execution not selected)");
    expect(sharedContextIdentity({ ...draft, objects: { ...draft.objects, Scenario: [] } }, selectedId).plan).toBe("No active plan");
  });

  it("renders one read-only context with independent save and model/forecast meaning", () => {
    const html = renderToStaticMarkup(<SharedContextRibbon {...sharedContextIdentity(createGoldenHouseholdDraft())}
      modelStatus="Ready" modelDetails={<p>As of 2026-01-01; data cutoff 2026-01-01</p>}
      forecast={<span>Forecast: Partial</span>} save={() => { throw new Error("Render cannot save"); }} saveLabel="Save"
      storage="Trusted origin; export recommended." onPerson={() => { throw new Error("Render cannot select"); }} onPeople={() => {}} />);
    expect(html).toContain("Model: Ready");
    expect(html).toContain("Forecast: Partial");
    expect(html).toContain("Household forecast");
    expect(html).toContain("Manual save");
    expect(html).not.toMatch(/<input|<select|\sopen(?:[=>\s])/);
    expect(html).not.toContain("90000000-");
    // Its serialization depends on small identity labels, never forecast months.
    expect(html.length).toBeLessThan(5000);
  });
});
