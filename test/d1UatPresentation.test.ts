import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, createGoldenHouseholdExampleDraft, editPersonalRetirementDate, type JsonObject } from "../src/application/personalMvp.js";
import { mortgageFinalPaymentDate, mortgagePaymentCount } from "../src/application/compiler/liabilities.js";
import { currentPlan, editCurrentPlanHorizon, simulationWindowProblem } from "../src/application/forecastSetup.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS } from "../src/application/goldenHousehold.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { compileHouseholdTax } from "../src/application/compiler/tax.js";
import { groupDiagnostics, forecastDiagnosticMessage, investmentAccountSummary, percentageToRate, rateToPercentage } from "../ui/entityPresentation.js";

describe("D1 UAT presentation boundaries", () => {
  it("uses the compiler's monthly mortgage schedule, including skipped invalid payment days", () => {
    expect(mortgageFinalPaymentDate("2022-02-01", "360")).toBe("2052-01-01");
    expect(mortgagePaymentCount("2022-02-01", "2052-01-01")).toBe("360");
    expect(mortgagePaymentCount("2026-01-31", "2026-04-30")).toBeUndefined();
    expect(mortgageFinalPaymentDate("2026-01-31", "3")).toBe("2026-05-31");
    expect(mortgageFinalPaymentDate("2026-02-30", "360")).toBeUndefined();
    expect(mortgageFinalPaymentDate("2022-02-01", "0")).toBeUndefined();
  });
  it("extends only Current Plan dates and keeps the run window and retirement inside that plan", () => {
    const model = createGoldenHouseholdExampleDraft();
    expect(simulationWindowProblem(model, "2026-01-01", "2037-01-01")).toContain("exceeds Current plan end 2036-01-01");
    const extended = editCurrentPlanHorizon(model, "2026-01-01", "2040-01-01");
    expect(currentPlan(extended)?.end_date).toBe("2040-01-01");
    expect(extended.objects.Income).toEqual(model.objects.Income);
    expect(extended.objects.Event).toEqual(model.objects.Event);
    expect(simulationWindowProblem(extended, "2026-01-01", "2037-01-01")).toBeUndefined();
    expect(() => editCurrentPlanHorizon(model, "2026-01-01", "2035-01-01")).toThrow("retirement date");
    expect(() => editPersonalRetirementDate(model, GOLDEN_HOUSEHOLD_IDS.income, "2041-01-01")).toThrow("Current Plan horizon");
  });
  it("runs the normal known-tax-facts example for the actual requested ten years without silent truncation", () => {
    const result = runPersonalHouseholdForecast(createGoldenHouseholdExampleDraft(), createGoldenHouseholdForecastRequest());
    expect(result.status, JSON.stringify(result)).not.toBe("unavailable");
    if (result.status === "unavailable") return;
    // No recurring statutory contribution is authored in this example. Missing
    // future tax law must be scoped incompleteness rather than stopping cash flow.
    expect(result.stoppedAt, JSON.stringify(result.diagnostics)).toBeUndefined();
    expect(result.reachedThrough).toBe("2036-01-01T00:00:00.000Z");
    expect(result.points).toHaveLength(120);
    expect(result.diagnostics.some(item => item.code === "PFA-TAX-009")).toBe(true);
  });
  it("attributes a later-year contribution stop without projecting law, and combines cash settlement remedies", () => {
    expect(forecastDiagnosticMessage({ code: "RULE_INPUT_INVALID", message: "Contribution facts do not cover this UTC year" })).toContain("cover 2026 only");
    expect(forecastDiagnosticMessage({ code: "PFA-TAX-009", category: "payment_funding" } as never)).toBe(forecastDiagnosticMessage({ code: "PFA-TAX-009", category: "settlement_timing" } as never));
    expect(forecastDiagnosticMessage({ code: "PFA-TAX-009", category: "rule_selection", jurisdiction: "US:FEDERAL" } as never)).toBe(forecastDiagnosticMessage({ code: "PFA-TAX-009", category: "legal_base_or_component", jurisdiction: "US:FEDERAL" } as never));
  });
  it("groups repeated tax roots without discarding affected outputs or merging different reasons", () => {
    const root = { code: "PFA-TAX-009", category: "filing_status", entityType: "tax_capability", message: "Explicit unambiguous filing status is required." };
    const groups = groupDiagnostics([
      { ...root, entityId: "income-a", affectedOutputs: ["cash", "netWorth"] },
      { ...root, entityId: "income-b", affectedOutputs: ["netWorth", "netIncome"] },
      { ...root, entityId: "income-a", affectedOutputs: ["cash"] },
      { ...root, category: "rule_selection", jurisdiction: "US:NY", message: "No supported rule" },
      { ...root, category: "rule_selection", jurisdiction: "US:NY", message: "No supported rule in a later year" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ occurrences: 3, affectedOutputs: ["cash", "netIncome", "netWorth"] });
    expect(forecastDiagnosticMessage(groups[0]!.diagnostic)).toContain("Tax filing status is missing or conflicting");
    expect(forecastDiagnosticMessage(groups[1]!.diagnostic)).toContain("New York");
    expect(groups[1]!.messages).toEqual(["No supported rule", "No supported rule in a later year"]);
    expect(groupDiagnostics([{ ...root, affectedOutputs: ["cash"] }])[0]!.key).toBe(groups[0]!.key);
  });
  it.each([ ["5", "0.05"], ["5.25", "0.0525"], ["0.000000000000000001", "0.00000000000000000001"], ["-100", "-1"], ["100", "1"] ])("converts %s percent to exact canonical %s", (percent, rate) => {
    expect(percentageToRate(percent)).toBe(rate);
    expect(rateToPercentage(rate)).toBe(percent);
  });
  it("rejects ambiguous percentage text rather than silently storing a different rate", () => {
    for (const text of ["5%", "1,000", "1e2", "five"]) expect(() => percentageToRate(text)).toThrow();
  });
  it("supplies explicit known facts for the normal example without changing the audited fixture", () => {
    const example = createGoldenHouseholdExampleDraft();
    const tax = compileHouseholdTax(example);
    expect(tax.status).toBe("compiled");
    if (tax.status !== "compiled") return;
    expect(tax.value.filingStatus).toBe("single");
    expect(tax.value.diagnostics.some(item => item.category === "filing_status")).toBe(false);
    expect(tax.value.incomes[0]!.residence).toEqual([{ effective_date: "2026-01-01", state_jurisdiction: "US-NY" }]);
    expect(tax.value.incomes[0]!.work).toEqual([{ effective_date: "2026-01-01", state_jurisdiction: "US-NY", allocation: "1" }]);
    expect((createGoldenHouseholdDraft().objects.Person![0] as JsonObject).filing_status).toBeUndefined();
    expect(example.objects.Account).toEqual(createGoldenHouseholdDraft().objects.Account);
    expect(example.objects.Investment).toEqual(createGoldenHouseholdDraft().objects.Investment);
  });
  it("presents wrapper cash separately from exact holdings and avoids pretending missing prices are zero", () => {
    const draft = createGoldenHouseholdDraft();
    const account = draft.objects.Account![2] as JsonObject;
    expect(investmentAccountSummary(account, draft, "USD")).toBe("Total account value: 100,000 USD · Cash inside account: 0 USD · Investments/holdings: 100,000 USD");
    const missing = { ...draft, objects: { ...draft.objects, Investment: draft.objects.Investment!.map(value => ({ ...(value as JsonObject), price: null, market_value: null })) } };
    expect(investmentAccountSummary(account, missing, "USD")).toContain("Total account value unavailable");
  });
});
