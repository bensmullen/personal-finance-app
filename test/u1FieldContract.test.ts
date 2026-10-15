import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FINANCIAL_FIELDS, U1_INVENTORY, ENTITY_FIELD_INVENTORY, entityField, financialField, fieldProblem, compareDecimal, unvestedProblem, effectiveAnnualReturnProblem } from "../ui/authoring/fieldContract.js";
import { getPersonalEditorMetadata } from "../src/application/personalMvp.js";
import { entityRelationshipProblems } from "../ui/authoring/entityProblems.js";
import { importPersonalModelJson } from "../src/application/modelPortability.js";
import { objectEntries } from "../ui/entityPresentation.js";
import { payrollCharacters, authoringFailure } from "../ui/authoring/contributionChoices.js";
import { currentPlan, simulationWindowProblem, replaceCurrentPlanHorizon } from "../src/application/forecastSetup.js";
import { createGoldenHouseholdExampleDraft } from "../src/application/personalMvp.js";

describe("U1 guided authoring contract", () => {
  it("guards linked executable returns without redefining unrelated signed rates", () => {
    const draft = importPersonalModelJson(readFileSync(new URL("./fixtures/d1-integrated-uat-model.json", import.meta.url), "utf8"));
    const assumption = objectEntries(draft, "Assumption").find(item => item.name === "Brokerage return")!;
    for (const value of ["-1", "-1.000", "-0.2", "-0", "0", "+0.08"]) {
      expect(effectiveAnnualReturnProblem(value), value).toBeUndefined();
      expect(entityRelationshipProblems("Assumption", { ...assumption, value }, draft), value).toEqual({});
    }
    for (const value of ["-1.000000000000000001", "-1.5", "-2", "", "Invalid percentage:bad"]) {
      expect(effectiveAnnualReturnProblem(value), value).toBeDefined();
      expect(entityRelationshipProblems("Assumption", { ...assumption, value }, draft).value, value).toBeDefined();
    }
    for (const [field, value] of Object.entries({ unit: "nominal annual rate", category: "inflation", start_date: "2026-01-01", end_date: "2030-01-01", scenario_id: "other-plan" })) {
      expect(entityRelationshipProblems("Assumption", { ...assumption, [field]: value }, draft)[field], field).toBeDefined();
    }
    expect(entityRelationshipProblems("Assumption", { ...assumption, name: "My return estimate", source: "historical", value: "-0.1" }, draft)).toEqual({});
    const unrelated = { assumption_id: "unlinked", unit: "other signed rate", category: "inflation", value: "-1.5" };
    expect(entityRelationshipProblems("Assumption", unrelated, draft)).toEqual({});
    expect(fieldProblem(financialField("interest_rate"), "-150")).toBeUndefined();
    expect(assumption.value).toBe("0");
  });
  it("resolves ambiguous properties against domain and authoritative edit state", () => {
    expect(entityField("maturity_date", "Investment")?.description).toMatch(/Treasury or CD/);
    expect(entityField("maturity_date", "Investment")?.dependencies).not.toContain("totalPayments");
    expect(entityField("maturity_date", "Liability")?.label).toBe("Contractual final payment");
    expect(entityField("source", "Assumption")?.description).not.toMatch(/employer|paying/i);
    expect(entityField("source", "Income")?.description).toMatch(/paying this income/);
    expect(entityField("category", "Assumption")?.example).toBe("market_return");
    expect(entityField("category", "Expense")?.label).toBe("Spending category");
    expect(entityField("maturity_date", "Income")).toBeUndefined();
    const metadata = getPersonalEditorMetadata();
    for (const [context, keys] of Object.entries(ENTITY_FIELD_INVENTORY)) {
      const fields = metadata[context as keyof typeof metadata].fields;
      for (const key of keys) {
        const descriptor = Object.entries(fields).find(([name]) => name === key)?.[1];
        expect(descriptor, `${context}.${key}`).toBeDefined();
        const field = entityField(key, context, descriptor, true);
        expect(field, `${context}.${key}`).toBeDefined();
        expect(field?.state).toBe(descriptor!.required ? "required" : "optional");
        if (descriptor && "enumValues" in descriptor) expect(descriptor.enumValues).toContain(field!.example.toLowerCase().replaceAll(" ", "_"));
      }
    }
    expect(entityField("opening_balance", "Account", metadata.Account.fields.opening_balance, false, "0")?.state).toBe("read-only");
    expect(entityField("opening_balance", "Account", metadata.Account.fields.opening_balance, false, undefined)?.state).toBe("required");
  });
  it("checks exact bounded ownership without forbidding legitimate signed rates", () => {
    expect(compareDecimal("9007199254740993.01", "9007199254740993.00")).toBe(1);
    expect(unvestedProblem("101", "100")).toBeDefined();
    expect(unvestedProblem("-0.01", "100")).toBeDefined();
    expect(unvestedProblem("100.000", "100")).toBeUndefined();
    expect(unvestedProblem("0", "0")).toBeUndefined();
    expect(fieldProblem(financialField("vested"), "100.01")).toBeDefined();
    expect(fieldProblem(financialField("vested"), "-1")).toBeDefined();
    expect(fieldProblem(financialField("vested"), "100")).toBeUndefined();
    expect(fieldProblem(financialField("return"), "-20")).toBeUndefined();
    const draft = createGoldenHouseholdExampleDraft();
    expect(entityRelationshipProblems("Investment", { investment_type: "bond", instrument_subtype: "treasury_bill", acquisition_date: "2026-01-01", maturity_date: "2025-12-31" }, draft).maturity_date).toBeDefined();
    expect(entityRelationshipProblems("Income", { gross_or_net: "gross", start_date: "2026-01-01", end_date: "2027-01-01" }, draft)).toEqual({});
    expect(entityRelationshipProblems("Income", { gross_or_net: "gross", start_date: "2026-01-01", end_date: "2026-01-01" }, draft).end_date).toBeDefined();
  });
  it("keeps arbitrary exceptions and identifiers out of normal save failures", () => {
    for (const reason of ["Compiler failed at 90000000-0000-4000-8000-000000000001", "invalid payload {input_bindings: []}", "PAYROLL_RATE_INVALID", "IRA_CONTRIBUTION_FACTS_REQUIRED"]) {
      expect(authoringFailure(new Error(reason))).not.toMatch(/90000000|Compiler|input_bindings|PAYROLL_|IRA_/);
    }
  });
  it("protects payroll and IRA ownership when editing existing financial objects", () => {
    const draft = importPersonalModelJson(readFileSync(new URL("./fixtures/d1-integrated-uat-model.json", import.meta.url), "utf8"));
    const salary = objectEntries(draft, "Income").find(item => item.income_type === "salary")!;
    expect(entityRelationshipProblems("Income", { ...salary, gross_or_net: "net" }, draft).gross_or_net).toContain("payroll contributions");
    const account = objectEntries(draft, "Account").find(item => item.account_type === "traditional_401k")!;
    expect(entityRelationshipProblems("Account", { ...account, owner_id: "other-owner" }, draft).owner_id).toContain("salary owner");
    const ira = objectEntries(draft, "Account").find(item => item.account_type === "roth_ira")!;
    expect(entityRelationshipProblems("Account", { ...ira, owner_id: "other-owner" }, draft).owner_id).toContain("IRA eligibility");
    expect(entityRelationshipProblems("Account", account, draft)).toEqual({});
  });
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
    expect(fieldProblem(financialField("taxDate"), "02-30")).toBeDefined();
    expect(fieldProblem(financialField("taxDate"), "02-29")).toBeUndefined();
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
