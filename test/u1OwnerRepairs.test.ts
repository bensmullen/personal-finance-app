import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, authorHistoricalContributionScope, authorPayrollContributionPlan, authorOpeningContributionUsage, getOpeningContributionReadiness, getOpeningContributionUsage, exportPersonalModelJson, importPersonalModelJson, patchPersonalObject } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { investmentFieldApplies, investmentProductNotice } from "../ui/authoring/investmentFields.js";
import { exactDiagnosticTargets, diagnosticTargets } from "../ui/authoring/diagnosticTargets.js";
import { savedActivity } from "../ui/authoring/ScheduledActivity.js";
import { authoringFailure } from "../ui/authoring/contributionChoices.js";

const facts = { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: "108000" };
const history = () => authorHistoricalContributionScope(createGoldenHouseholdDraft(), { id: "d1940000-0000-4000-8000-000000000001", investmentId: ids.retirementInvestment, planKey: "Example employer", facts });

describe("U1 owner follow-up read models", () => {
  it.each(["equity", "fund", "crypto"])("keeps option and fixed-income terms out of %s editing without deleting stored facts", investment_type => {
    const holding = { investment_type, strike_price: "50", maturity_date: "2027-01-01" };
    expect(investmentFieldApplies("strike_price", holding)).toBe(false);
    expect(investmentFieldApplies("maturity_date", holding)).toBe(false);
    expect(investmentFieldApplies("quantity", holding)).toBe(true);
    expect(holding.strike_price).toBe("50");
  });
  it("requires a supported subtype before showing contractual instrument inputs", () => {
    expect(investmentProductNotice({ investment_type: "option" })).toMatch(/supported long equity call/);
    expect(investmentFieldApplies("strike_price", { investment_type: "option" })).toBe(false);
    expect(investmentFieldApplies("strike_price", { investment_type: "option", instrument_subtype: "long_equity_call" })).toBe(true);
    for (const instrument_subtype of ["treasury_bill", "treasury_note", "treasury_bond", "cd"]) {
      expect(investmentFieldApplies("face_value", { investment_type: "bond", instrument_subtype })).toBe(true);
      expect(investmentFieldApplies("strike_price", { investment_type: "bond", instrument_subtype })).toBe(false);
    }
  });
  it("distinguishes the actual historical prerequisites and persists known-zero history without cash mutation", () => {
    const original = createGoldenHouseholdDraft();
    expect(getOpeningContributionReadiness(original, "2026-07-01").missingAccountIds).toContain(ids.retirementAccount);
    const incomplete = authorHistoricalContributionScope(original, { id: "d1940000-0000-4000-8000-000000000001", investmentId: ids.retirementInvestment, planKey: "Example employer", facts: { taxYear: 2026 } });
    const readiness = getOpeningContributionReadiness(incomplete, "2026-07-01");
    expect(readiness.ready).toBe(false);
    expect(authoringFailure(new Error(readiness.reason))).toMatch(/annual pay eligible/);
    const model = history();
    expect(getOpeningContributionReadiness(model, "2026-07-01").ready).toBe(true);
    expect(getOpeningContributionReadiness(model, "2027-07-01").ready).toBe(false);
    const saved = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] });
    expect(saved.objects.Account).toEqual(model.objects.Account);
    expect(getOpeningContributionUsage(importPersonalModelJson(exportPersonalModelJson(saved)))).toEqual({ asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] });
    const unrelated = patchPersonalObject(saved, "Income", ids.income, { amount: "9100" });
    expect(getOpeningContributionReadiness(unrelated, "2026-07-01")).toEqual(getOpeningContributionReadiness(saved, "2026-07-01"));
  });
  it("never merges conflicting prior-history and future employer scopes", () => {
    const model = authorPayrollContributionPlan(history(), { primitiveId: "d1940000-0000-4000-8000-000000000002", investmentId: ids.retirementInvestment, incomeId: ids.income, character: "traditional_401k", priority: 10, calculation: { kind: "fixed", amount: "100" }, planKey: "Different employer", vestedFraction: "1", excessPolicy: "reject", facts });
    expect(getOpeningContributionReadiness(model, "2026-07-01").reason).toBe("HISTORICAL_SCOPE_CONFLICT");
    expect(authoringFailure(new Error("HISTORICAL_SCOPE_CONFLICT"))).toMatch(/same holding and year disagree/);
    expect(() => authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] })).toThrow("HISTORICAL_SCOPE_CONFLICT");
    expect(savedActivity(model).find(row => row.investmentId === ids.retirementInvestment)?.detail).toContain("100 USD");
  });
  it("resolves multi-related IDs exactly and offers editable repair only for supported mutable facts", () => {
    const draft = createGoldenHouseholdDraft();
    const targets = diagnosticTargets(draft, { entityId: ids.income, fieldPath: "amount", relatedIds: [ids.checking, ids.mortgage, "unknown"] });
    expect(targets).toHaveLength(4);
    expect(targets[0]).toMatchObject({ label: "Example salary", field: "amount", editable: true });
    expect(targets[1]).toMatchObject({ label: "Everyday checking", editable: false });
    expect(targets[3]).toMatchObject({ type: "Unresolved reference", editable: false });
    expect(exactDiagnosticTargets(draft, ids.checking, "opening_balance")[0]?.editable).toBe(false);
    expect(exactDiagnosticTargets(draft, ids.income.slice(0, 20))).toEqual([]);
  });
});
