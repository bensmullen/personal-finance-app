import { describe, expect, it } from "vitest";
import { inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest, integratedIds } from "./fixtures/d1IntegratedHousehold.js";
import { money } from "../src/values/index.js";
import { diagnosticSummary, primaryForecastDiagnostic } from "../ui/authoring/diagnosticSummary.js";

describe("U1 monthly committed evidence", () => {
  it("excludes employer assets from employee pay and never attributes savings-funded purchases to income", () => {
    const model = createD1IntegratedHousehold();
    const result = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "d1940000-0000-4000-8000-000000000094" });
    if (result.status === "unavailable") throw new Error(`Integrated household must have monthly evidence: ${JSON.stringify(result.diagnostics)}`);
    const before = JSON.stringify(result);
    const month = inspectMonthlyMoney(result.points[0]!, model);
    expect(month).toMatchObject({ income: "9000", employee: "550", deposited: "8450", unreconciled: "8450", status: "incomplete", withholding: "not_modeled" });
    expect(month.lines.filter(line => line.kind === "employee")).toHaveLength(2);
    expect(month.lines.some(line => line.holdingIds.includes(integratedIds.match))).toBe(false);
    const ira = month.lines.filter(line => line.kind === "transfer" && line.holdingIds.includes(integratedIds.ira));
    // D1 uses the authored date to select the eligible month; its existing
    // investment purchase contract posts at that month's closing instant.
    expect(ira).toMatchObject([{ amount: "500", accountIds: [golden.savings], date: "2026-01-31T23:59:59.999Z" }]);
    const mortgage = month.mortgages.find(item => item.liabilityId === golden.mortgage)!;
    expect(mortgage.fundingAccountIds).toEqual([golden.checking]);
    expect(money(mortgage.principal).plus(money(mortgage.interest)).amount.toString()).toBe(mortgage.payment);
    expect(mortgage.paid).toBe(mortgage.payment);
    expect(month.mortgages).toHaveLength(1);
    expect(month).toMatchObject({ basis: "gross_payroll", denominator: "9000", otherIncome: "0" });
    const amountFor = (kind: string) => month.categories.filter(row => row.kind === kind).reduce((sum, row) => sum.plus(money(row.amount)), money("0")).amount.toString();
    expect(amountFor("workplace")).toBe("550");
    expect(amountFor("mortgage")).toBe(mortgage.paid);
    expect(amountFor("ira")).toBe("500");
    expect(amountFor("tax")).toBe("500");
    const premiums = month.categories.filter(row => row.policyIds.includes(integratedIds.policy));
    expect(premiums).toMatchObject([{ kind: "living", amount: "50", accountIds: [golden.checking], policyIds: [integratedIds.policy] }]);
    expect(premiums.flatMap(row => row.sourceIds)).toHaveLength(1);
    const legIds = month.categories.flatMap(row => row.sourceIds);
    expect(new Set(legIds).size).toBe(legIds.length);
    expect(month.categories.some(row => row.holdingIds.includes(integratedIds.match))).toBe(false);
    expect(month.categories.find(row => row.kind === "ira")?.accountIds).toEqual([golden.savings]);
    expect(money(month.denominator).plus(money(month.additionalFunding)).minus(money(month.totalUses)).amount.toString()).toBe(month.unallocated);
    expect(month.receipts.some(row => row.label === "Investment sale proceeds")).toBe(true);
    expect(JSON.stringify(result)).toBe(before);
    expect(inspectMonthlyMoney(result.points[0]!, model)).toEqual(month);
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
    expect(diagnosticSummary({ code: "INVESTMENT_STOCHASTIC_RETURN_UNSUPPORTED" })).toMatchObject({ problem: expect.stringContaining("future probabilistic forecasting"), remedy: expect.stringContaining("clear the stored Volatility") });
    expect(diagnosticSummary({ code: "PFA-TAX-009", entityType: "tax_capability", category: "payment_funding" }).remedy).toContain("cash accounts");
    expect(diagnosticSummary({ code: "PFA-TAX-009", entityType: "tax_capability", category: "local_residence_jurisdiction", jurisdiction: "US-NY" }).remedy).toContain("cannot be repaired");
    expect(diagnosticSummary({ code: "UNSUPPORTED_NEW_CAPABILITY" }).remedy).toContain("no supported editor repair");
    expect(diagnosticSummary({ code: "RULE_INPUT_INVALID", message: "HISTORICAL_SCOPE_ERROR" }).problem).not.toContain("HISTORICAL_SCOPE_ERROR");
  });
  it("surfaces the refinance boundary ahead of unrelated errors and scoped tax limitations", () => {
    const tax = { code: "PFA-TAX-009", entityType: "tax_capability", category: "payment_funding", severity: "error" };
    const generic = { code: "RULE_INPUT_INVALID", severity: "error" };
    const refinance = { code: "MORTGAGE_REFINANCE_UNSUPPORTED", message: "Choose a scheduled monthly payment date for refinance. Off-cycle closings require unsupported daily/stub-period interest." };
    expect(primaryForecastDiagnostic([tax, generic, refinance])).toBe(refinance);
    expect(primaryForecastDiagnostic([refinance, tax, generic])).toBe(refinance);
    expect(diagnosticSummary(refinance)).toMatchObject({
      problem: "Choose a scheduled monthly payment date for refinance.",
      remedy: expect.stringContaining("Under Debt → Extra mortgage payments & refinancing, disable the saved refinance"),
    });
    expect(diagnosticSummary(refinance).remedy).not.toContain("Investment and retirement operations");
    expect(primaryForecastDiagnostic([tax, generic])).toBe(generic);
    expect(primaryForecastDiagnostic([tax])).toBe(tax);
    expect(primaryForecastDiagnostic([])).toBeUndefined();
  });
});
