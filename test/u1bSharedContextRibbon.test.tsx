import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SharedContextRibbon, forecastContextLabel } from "../ui/calm/CalmPresentation.js";
import { sharedContextIdentity } from "../ui/PersonalFinanceApp.js";
import { createEmptyPersonalDraft, createGoldenHouseholdDraft, type PersonalDraft } from "../src/application/personalMvp.js";

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
    expect(sharedContextIdentity(empty)).toMatchObject({ household: "Household unavailable", people: [], plan: "No active plan", membershipReview: expect.any(String) });
    const draft = createGoldenHouseholdDraft();
    const original = JSON.stringify(draft);
    const one = sharedContextIdentity(draft);
    expect(one.people).toHaveLength(1);
    expect(one.people[0]!.label).toBe("Taylor Example");
    const person = draft.objects.Person![0] as Record<string, any>;
    const members = [person, { ...person, person_id: "94000000-0000-4000-8000-000000000241" }, { ...person, person_id: "94000000-0000-4000-8000-000000000242", first_name: "", last_name: "" }];
    const duplicates = { ...draft, objects: { ...draft.objects, Household: [{ ...draft.objects.Household![0]!, members: members.map(item => item.person_id) }], Person: members } };
    const identity = sharedContextIdentity(duplicates);
    expect(new Set(identity.people.map(item => item.id)).size).toBe(3);
    expect(identity.people.map(item => item.label)).toEqual([`Taylor Example · ID ${person.person_id} · born 1990-01-01`, "Taylor Example · ID 94000000-0000-4000-8000-000000000241 · born 1990-01-01", "Unnamed person"]);
    expect(identity.membershipReview).toBeUndefined();
    expect(sharedContextIdentity({ ...duplicates, objects: { ...duplicates.objects, Person: [...members].reverse() } }).people).toEqual(identity.people);
    expect(JSON.stringify(draft)).toBe(original);
  });

  it.each(["unlinked", "foreign", "missing person", "wrong household", "missing household link", "duplicate ID", "missing ID", "duplicate reference", "multiple households", "zero", "unnamed household"])("reconciles %s without inventing membership", kind => {
    const draft = createGoldenHouseholdDraft();
    const person = draft.objects.Person![0]!;
    const household = draft.objects.Household![0]!;
    const extraId = "94000000-0000-4000-8000-000000000244";
    let changed: PersonalDraft = { ...draft, objects: { ...draft.objects } };
    switch (kind) {
      case "unlinked": changed = { ...changed, objects: { ...changed.objects, Person: [person, { ...person, person_id: extraId }] } }; break;
      case "foreign": changed = { ...changed, objects: { ...changed.objects, Person: [person, { ...person, person_id: extraId, household_id: extraId }] } }; break;
      case "missing person": changed = { ...changed, objects: { ...changed.objects, Person: [] } }; break;
      case "wrong household": changed = { ...changed, objects: { ...changed.objects, Household: [{ ...household, household_id: extraId }] } }; break;
      case "missing household link": changed = { ...changed, objects: { ...changed.objects, Person: [{ ...person, household_id: null }] } }; break;
      case "duplicate ID": changed = { ...changed, objects: { ...changed.objects, Person: [person, person] } }; break;
      case "missing ID": changed = { ...changed, objects: { ...changed.objects, Person: [{ ...person, person_id: null }] } }; break;
      case "duplicate reference": changed = { ...changed, objects: { ...changed.objects, Household: [{ ...household, members: [person.person_id!, person.person_id!] }] } }; break;
      case "multiple households": changed = { ...changed, objects: { ...changed.objects, Household: [household, { ...household, household_id: extraId, name: "Other household" }] } }; break;
      case "zero": changed = { ...changed, objects: { ...changed.objects, Household: [{ ...household, members: [] }], Person: [] } }; break;
      case "unnamed household": changed = { ...changed, objects: { ...changed.objects, Household: [{ ...household, name: "" }] } }; break;
    }
    const original = JSON.stringify(changed);
    const identity = sharedContextIdentity(changed);
    if (kind === "unnamed household") {
      expect(identity.household).toBe("Unnamed household");
      expect(identity.people).toHaveLength(1);
      expect(identity.membershipReview).toBeUndefined();
    } else {
      expect(identity.membershipReview).toBeTruthy();
      expect(identity.people.map(item => item.id)).toEqual(kind === "foreign" ? [person.person_id] : []);
      if (kind === "multiple households") expect(identity.household).toBe("Household unavailable");
    }
    expect(JSON.stringify(changed)).toBe(original);
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

  it.each(["Save", "Export your model"])("renders one read-only context with independent %s and model/forecast meaning", saveLabel => {
    const html = renderToStaticMarkup(<SharedContextRibbon {...sharedContextIdentity(createGoldenHouseholdDraft())}
      modelStatus="Ready" modelDetails={<p>As of 2026-01-01; data cutoff 2026-01-01</p>}
      forecast={<span>Forecast: Partial</span>} save={() => { throw new Error("Render cannot save"); }} saveLabel={saveLabel}
      storage="Trusted origin; export recommended." onPerson={() => { throw new Error("Render cannot select"); }} onPeople={() => {}} />);
    expect(html).toContain("Model: Ready");
    expect(html).toContain("Forecast: Partial");
    expect(html).toContain("Household forecast");
    expect(html).toContain("Manual save");
    expect(html).toContain(`>${saveLabel}</button>`);
    expect(html).not.toMatch(/<(?:input|select)\b/i);
    expect(html).not.toMatch(/<details\b[^>]*\sopen(?:[=>\s])/i);
    expect(html).toContain('class="context-save-cue"');
    expect(html).toContain("Forecasts do not save.");
    expect(html).not.toContain("90000000-");
    // Its serialization depends on small identity labels, never forecast months.
    expect(html.length).toBeLessThan(5000);
  });
});
