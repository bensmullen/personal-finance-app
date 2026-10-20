import { describe, expect, it } from "vitest";
import { createFlagshipHouseholdDraft, createGoldenHouseholdDraft, exportPersonalModelJson, importPersonalModelJson, type JsonObject, type PersonalDraft } from "../src/application/personalMvp.js";
import { age90Horizon, birthdayAtAge, retirementProposals, resolveForecastReadiness } from "../src/application/forecastReadiness.js";
import { createGoldenExampleConfiguration, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { createHouseholdForecastRequest, runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { calculationFingerprint } from "../src/application/interactiveForecast.js";
import { acceptRetirementProposal, acceptPlanningStarters } from "../src/application/forecastSetup.js";

const withDob = (dob: string): PersonalDraft => {
  const model = createGoldenHouseholdDraft();
  return { ...model, objects: { ...model.objects, Person: (model.objects.Person as readonly JsonObject[]).map(person => ({ ...person, date_of_birth: dob })) } };
};

describe("U1B sourced planning readiness", () => {
  it.each([
    ["2008-01-01", "2098-02-01"], ["1960-06-15", "2050-07-01"], ["1990-01-01", "2080-02-01"],
  ])("includes %s's birthday month without a forty-year clip", (dob, end) => {
    expect(age90Horizon(withDob(dob), [ids.person], "2026-01-01")?.end).toBe(end);
  });
  it("handles leap birthdays, older anchors, missing DOB and explicit multi-adult selection", () => {
    expect(birthdayAtAge("2000-02-29", 65)).toBe("2065-02-28");
    expect(age90Horizon(withDob("1930-01-01"), [ids.person], "2026-01-01")).toBeUndefined();
    expect(age90Horizon(withDob("1930-01-01"), [ids.person], "2026-01-01", 100)?.end).toBe("2030-02-01");
    expect(age90Horizon(withDob(""), [ids.person], "2026-01-01")).toBeUndefined();
    expect(age90Horizon(withDob("2015-01-01"), [ids.person], "2026-01-01")).toBeUndefined();
    const model = withDob("1970-06-01"), other = "90000000-0000-4000-8000-000000000099";
    const two = { ...model, objects: { ...model.objects, Household: (model.objects.Household as readonly JsonObject[]).map(household => ({ ...household, members: [ids.person, other] })), Person: [...model.objects.Person!, { ...(model.objects.Person![0] as JsonObject), person_id: other, date_of_birth: "1990-06-01" }] } };
    expect(age90Horizon(two, [ids.person, other], "2026-01-01")?.end).toBe("2080-07-01");
    expect(age90Horizon(two, [ids.person], "2026-01-01")?.end).toBe("2060-07-01");
  });
  it("preserves inputs, economic fingerprints and accepted choices while resolving sources", () => {
    const model = createFlagshipHouseholdDraft(), config = createGoldenExampleConfiguration();
    expect(age90Horizon(model, [ids.person], config.simulationStart)?.end).toBe(config.simulationEnd);
    expect(birthdayAtAge("1990-01-01", 65)).toBe(config.retirementBindings[0]!.baselineDate);
    const json = exportPersonalModelJson(model), request = createHouseholdForecastRequest(config, ids.model);
    const fingerprint = calculationFingerprint("baseline_forecast", model, request);
    const restored = importPersonalModelJson(json);
    const derived = resolveForecastReadiness(restored, config.asOf);
    expect(derived.find(field => field.key === "cashAccount")).toMatchObject({ classification: "losslessly_derived", value: ids.checking });
    expect(derived.find(field => field.key === "investmentOwner")?.classification).toBe("editable_suggestion_needs_acceptance");
    expect(resolveForecastReadiness(model, config.asOf, config).find(field => field.key === "investmentOwner")).toMatchObject({ classification: "known_canonical", value: ids.person });
    expect(resolveForecastReadiness(model, config.asOf, config).find(field => field.key === "mortgage:" + ids.mortgage + ":schedule")?.reason).toContain("313 remaining of 360");
    expect(exportPersonalModelJson(model)).toBe(json);
    expect(calculationFingerprint("baseline_forecast", model, request)).toBe(fingerprint);
  });
  it("requires a choice among banks and preserves contradictory schedule evidence", () => {
    const model = createGoldenHouseholdDraft();
    expect(resolveForecastReadiness(model, "2026-01-01").find(field => field.key === "cashAccount")).toMatchObject({ classification: "user_decision_required", options: expect.any(Array) });
    const config = createGoldenExampleConfiguration();
    const conflict = { ...config, liabilityExecutionProfiles: config.liabilityExecutionProfiles.map(profile => ({ ...profile, totalPayments: 359 })) };
    expect(resolveForecastReadiness(model, "2026-01-01", conflict).find(field => field.key.endsWith(":schedule"))?.reason).toContain("disagree");
  });
  it("offers age 65 without changing wages, and accepts only in the Life Events adapter", () => {
    const original = createGoldenHouseholdDraft();
    const model = { ...original, objects: { ...original.objects, Income: (original.objects.Income as readonly JsonObject[]).map(income => ({ ...income, related_event_id: null })), Event: [] } };
    const before = exportPersonalModelJson(model);
    expect(retirementProposals(model, "2026-02-01")).toMatchObject([{ personId: ids.person, date: "2055-01-01" }]);
    expect(exportPersonalModelJson(model)).toBe(before);
    expect(() => acceptRetirementProposal(model, ids.person, "2055-01-01", ["90000000-0000-4000-8000-000000000099"])).toThrow("Current Plan");
    expect(retirementProposals(original, "2026-01-01")).toEqual([]);
    expect(retirementProposals({ ...model, objects: { ...model.objects, Person: withDob("1950-01-01").objects.Person! } }, "2026-01-01")).toEqual([]);
  });
  it("does not overwrite existing assumptions or create reserve transactions", () => {
    const model = createGoldenHouseholdDraft(), before = exportPersonalModelJson(model);
    let index = 500;
    const accepted = acceptPlanningStarters(model, { inflation: "0.025", wages: "0.03", portfolio: "0.05", reserveMonths: "6" }, () => `90000000-0000-4000-8000-${String(index++).padStart(12, "0")}`);
    expect(accepted.objects.Income).toEqual(model.objects.Income);
    expect(accepted.objects.Investment).toEqual(model.objects.Investment);
    expect(accepted.objects.Transaction).toEqual(model.objects.Transaction);
    expect((accepted.objects.Assumption as readonly JsonObject[]).filter(item => item.name === "Essential-expense reserve goal")).toMatchObject([{ value: "6" }]);
    expect(exportPersonalModelJson(model)).toBe(before);
  });
  it("executes a bounded genuine net-pay result with exact opening and cash values", () => {
    const model = createFlagshipHouseholdDraft();
    const config = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-09-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(config, ids.model));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    if (result.status === "unavailable") return;
    expect(result.points).toHaveLength(8);
    expect(result.openingSnapshot.netWorth.amount).toBe("4289330.29");
    expect(result.points[0]!.cash.amount).toBe("4007874.71");
    expect(result.points[0]!.statementIncome.amount).toBe("0");
    expect(result.points[6]!.statementIncome.amount).not.toBe("0");
    expect(result.diagnostics.some(issue => "category" in issue && issue.category === "wage_gross_to_net_withholding")).toBe(false);
    expect(result.points[0]!.outputCapabilities?.cash?.status).toBe("complete");
    expect(model.objects.Income).toHaveLength(1);
  }, 30_000);
  it("keeps a missing jurisdiction paycheck binding genuinely incomplete", () => {
    const original = createFlagshipHouseholdDraft();
    const model = { ...original, objects: { ...original.objects, PrimitiveInstance: (original.objects.PrimitiveInstance as readonly JsonObject[]).filter(item => item.primitive_instance_id !== "90000000-0000-4000-8000-000000000112") } };
    const config = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-09-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(config, ids.model));
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ category: "wage_gross_to_net_withholding" }));
    if (result.status !== "unavailable") expect(result.points[6]!.outputCapabilities?.cash?.status).toBe("incomplete");
  }, 30_000);
});
