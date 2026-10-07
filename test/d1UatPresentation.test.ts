import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, createGoldenHouseholdExampleDraft, type JsonObject } from "../src/application/personalMvp.js";
import { compileHouseholdTax } from "../src/application/compiler/tax.js";
import { groupDiagnostics, forecastDiagnosticMessage, investmentAccountSummary, percentageToRate, rateToPercentage } from "../ui/entityPresentation.js";

describe("D1 UAT presentation boundaries", () => {
  it("groups repeated tax roots without discarding affected outputs or merging different reasons", () => {
    const root = { code: "PFA-TAX-009", category: "filing_status", entityType: "tax_capability", message: "Explicit unambiguous filing status is required." };
    const groups = groupDiagnostics([
      { ...root, entityId: "income-a", affectedOutputs: ["cash", "netWorth"] },
      { ...root, entityId: "income-b", affectedOutputs: ["netWorth", "netIncome"] },
      { ...root, entityId: "income-a", affectedOutputs: ["cash"] },
      { ...root, category: "rule_selection", jurisdiction: "US:NY", message: "No supported rule" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ occurrences: 3, affectedOutputs: ["cash", "netIncome", "netWorth"] });
    expect(forecastDiagnosticMessage(groups[0]!.diagnostic)).toContain("Tax filing status is missing or conflicting");
    expect(forecastDiagnosticMessage(groups[1]!.diagnostic)).toContain("New York");
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
