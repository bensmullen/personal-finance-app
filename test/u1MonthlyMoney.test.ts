import { describe, expect, it } from "vitest";
import { inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest, integratedIds } from "./fixtures/d1IntegratedHousehold.js";
import { money } from "../src/values/index.js";
import { diagnosticSummary } from "../ui/authoring/diagnosticSummary.js";

describe("U1 monthly committed evidence", () => {
  it("excludes employer assets from employee pay and never attributes savings-funded purchases to income", () => {
    const model = createD1IntegratedHousehold();
    const result = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "u1-monthly-evidence" });
    if (result.status === "unavailable") throw new Error("Integrated household must have monthly evidence");
    const before = JSON.stringify(result);
    const month = inspectMonthlyMoney(result.points[0]!);
    expect(month).toMatchObject({ income: "9000", employee: "550", deposited: "8450", unreconciled: "8450", status: "incomplete", withholding: "not_modeled" });
    expect(month.lines.filter(line => line.kind === "employee")).toHaveLength(2);
    expect(month.lines.some(line => line.holdingIds.includes(integratedIds.match))).toBe(false);
    const ira = month.lines.filter(line => line.kind === "transfer" && line.holdingIds.includes(integratedIds.ira));
    expect(ira).toMatchObject([{ amount: "500", accountIds: [golden.savings], date: "2026-01-10T00:00:00.000Z" }]);
    const mortgage = month.mortgages.find(item => item.liabilityId === golden.mortgage)!;
    expect(mortgage.fundingAccountIds).toEqual([golden.checking]);
    expect(money(mortgage.principal).plus(money(mortgage.interest)).amount.toString()).toBe(mortgage.payment);
    expect(mortgage.paid).toBe(mortgage.payment);
    expect(month.mortgages).toHaveLength(1);
    expect(JSON.stringify(result)).toBe(before);
    expect(inspectMonthlyMoney(result.points[0]!)).toEqual(month);
  });
  it("keeps period identity, different months and unsupported evidence boundaries explicit", () => {
    const result = runPersonalHouseholdForecast(createGoldenHouseholdDraft(), createGoldenHouseholdForecastRequest());
    if (result.status === "unavailable") throw new Error("Golden household must run");
    const first = result.points[0]!, second = result.points[1]!;
    expect(inspectMonthlyMoney(first).mortgages[0]?.date.slice(0, 7)).toBe(first.periodStart.slice(0, 7));
    expect(inspectMonthlyMoney(second).mortgages[0]?.date.slice(0, 7)).toBe(second.periodStart.slice(0, 7));
    expect(() => inspectMonthlyMoney({ ...first, traceRefs: [] })).toThrow("unavailable");
    expect(() => inspectMonthlyMoney({ ...first, periodStart: second.periodStart })).toThrow("selected period");
  });
  it("presents coverage, dates and uneditable capabilities with a problem and honest remedy", () => {
    expect(diagnosticSummary({ code: "RULE_INPUT_INVALID", message: "Contribution facts do not cover this UTC year" })).toMatchObject({ problem: expect.stringContaining("contribution-year coverage"), remedy: expect.stringContaining("before that boundary") });
    expect(diagnosticSummary({ code: "FORECAST_HORIZON_INVALID" }).remedy).toContain("month-start");
    expect(diagnosticSummary({ code: "PFA-TAX-009", entityType: "tax_capability", category: "payment_funding" }).remedy).toContain("cash accounts");
    expect(diagnosticSummary({ code: "PFA-TAX-009", entityType: "tax_capability", category: "local_residence_jurisdiction", jurisdiction: "US-NY" }).remedy).toContain("cannot be repaired");
    expect(diagnosticSummary({ code: "UNSUPPORTED_NEW_CAPABILITY" }).remedy).toContain("future capability");
    expect(diagnosticSummary({ code: "RULE_INPUT_INVALID", message: "HISTORICAL_SCOPE_ERROR" }).problem).not.toContain("HISTORICAL_SCOPE_ERROR");
  });
});
