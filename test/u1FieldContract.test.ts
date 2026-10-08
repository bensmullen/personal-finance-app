import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FINANCIAL_FIELDS, U1_INVENTORY, financialField, fieldProblem } from "../ui/authoring/fieldContract.js";
import { payrollCharacters, authoringFailure } from "../ui/authoring/contributionChoices.js";
import { currentPlan, simulationWindowProblem, replaceCurrentPlanHorizon } from "../src/application/forecastSetup.js";
import { createGoldenHouseholdExampleDraft } from "../src/application/personalMvp.js";

describe("U1 guided authoring contract", () => {
  it("requires complete metadata for every inventoried common and advanced control", () => {
    expect(new Set(U1_INVENTORY.fields).size).toBe(U1_INVENTORY.fields.length);
    for (const key of U1_INVENTORY.fields) {
      const field = financialField(key);
      for (const value of [field.label, field.description, field.why, field.unit, field.example, field.source, field.suggestion]) expect(value, key).not.toBe("");
      expect(["common", "advanced", "technical", "derived", "unsupported"]).toContain(field.disclosure);
      expect(["required", "optional", "derived", "read-only"]).toContain(field.state);
      expect(fieldProblem(field, field.example)).toBeUndefined();
    }
    expect(() => financialField("new_unregistered_financial_input")).toThrow("Missing financial field metadata");
  });
  it("makes entity editing opt-in rather than exposing new schema fields", () => {
    expect(FINANCIAL_FIELDS.expected_return).toBeUndefined();
    expect(FINANCIAL_FIELDS.volatility).toBeUndefined();
    expect(FINANCIAL_FIELDS.return_model_id).toBeUndefined();
    for (const path of ["../ui/PersonalFinanceApp.tsx", "../ui/EntityEditor.tsx", "../ui/forecast/TaxSettlementControls.tsx"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      for (const [, key] of source.matchAll(/fieldKey="([^"]+)"/g)) expect(() => financialField(key!)).not.toThrow();
    }
  });
  it("rejects invalid dates, formats and missing facts without coercing money", () => {
    expect(fieldProblem(financialField("purchaseAmount"), "", true)).toContain("so this activity can be forecast");
    expect(fieldProblem(financialField("purchaseAmount"), "1,000.00")).toBeDefined();
    expect(fieldProblem(financialField("purchaseAmount"), "9007199254740993.01")).toBeUndefined();
    expect(fieldProblem(financialField("paymentAnchor"), "2026-02-30")).toBeDefined();
    expect(fieldProblem(financialField("taxDate"), "02-29")).toBeDefined();
    expect(fieldProblem(financialField("taxDate"), "04-15")).toBeUndefined();
    expect(fieldProblem(financialField("payrollPriority"), "1.5")).toBeDefined();
    expect(fieldProblem(financialField("age"), "-1")).toBeDefined();
  });
  it("filters payroll contributions to the existing D1 account contracts", () => {
    expect(payrollCharacters("traditional_401k")).toEqual(["traditional_401k", "after_tax_401k", "employer_401k"]);
    expect(payrollCharacters("roth_401k")).toEqual(["roth_401k"]);
    expect(payrollCharacters("hsa_investment")).toEqual(["employee_hsa", "employer_hsa"]);
    expect(payrollCharacters("taxable_brokerage")).toEqual([]);
    expect(authoringFailure(new Error("PAYROLL_DESTINATION_CHARACTER_MISMATCH"))).not.toMatch(/PAYROLL_|UUID/);
  });
  it("validates run dates immediately and extends the plan only through its existing adapter", () => {
    const draft = createGoldenHouseholdExampleDraft();
    expect(simulationWindowProblem(draft, "2026-02-30", "2036-01-01")).toContain("valid Simulation dates");
    expect(simulationWindowProblem(draft, "2026-01-02", "2036-01-01")).toContain("first day");
    expect(simulationWindowProblem(draft, "2036-01-01", "2026-01-01")).toContain("end after start");
    const next = replaceCurrentPlanHorizon(draft, "94111111-1111-4111-8111-111111111111", "2026-01-01", "2046-01-01", { start: "2026-01-01", end: "2036-01-01" });
    expect(currentPlan(next)?.end_date).toBe("2046-01-01");
    expect(currentPlan(draft)?.end_date).toBe("2036-01-01");
  });
});
