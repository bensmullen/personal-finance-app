import { describe, expect, it } from "vitest";
import { addPersonalObject, createEmptyPersonalDraft, createGoldenHouseholdExampleDraft } from "../src/application/personalMvp.js";
import { selectRetirementIncomeChartData } from "../src/application/retirementIncomeChartData.js";
import { objects } from "../src/application/compiler/shared.js";
import type { PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";

describe("retirement source capability boundary", () => {
  it("does not attribute aggregate income or investment balances to retirement streams", () => {
    const model = createGoldenHouseholdExampleDraft();
    const before = JSON.stringify(model);
    const data = selectRetirementIncomeChartData(model, "2026-01-01", []);
    expect(data.incomeSources.status).toBe("unavailable");
    expect(data.incomeSources.reason).toBe("missing_identity_safe_period_income_streams");
    expect(data.incomeSources.series).toEqual([]);
    expect(data.incomeSources.unsupported).toContain("Social Security");
    expect(Object.isFrozen(data.incomeSources.series)).toBe(true);
    expect(data.adults.some(adult => adult.confirmed.length > 0)).toBe(true);
    expect(JSON.stringify(model)).toBe(before);
    expect(selectRetirementIncomeChartData(model, "2026-01-01", [])).toEqual(data);
  });
  it("only labels payoffs as mortgages when the modeled loan has a mortgage source type", () => {
    const base = createGoldenHouseholdExampleDraft();
    const mortgage = objects(base, "Liability").find(loan => loan.liability_type === "mortgage");
    expect(mortgage).toBeDefined();
    const autoId = "b1870000-0000-4000-8000-000000000098";
    const model = addPersonalObject(base, "Liability", autoId, { name: "Auto loan", liability_type: "auto" });
    const forecast = {
      status: "completed", retirementMilestones: [],
      debtPayoffs: [
        { loanId: String(mortgage!.liability_id), scheduledAt: "2030-01-01" },
        { loanId: autoId, scheduledAt: "2031-01-01" },
        { loanId: "b1870000-0000-4000-8000-000000000099", scheduledAt: "2032-01-01" },
      ],
    } as unknown as PersonalHouseholdForecastReadModel;
    expect(selectRetirementIncomeChartData(model, "2026-01-01", [], forecast).mortgagePayoffs).toEqual([
      { loanId: String(mortgage!.liability_id), scheduledAt: "2030-01-01", name: String(mortgage!.name ?? "Mortgage") },
    ]);
  });
  it("uses the existing later-of-90 calendar rule and keeps missing DOB unknown", () => {
    const id = (n: number) => `b1870000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    let model = createEmptyPersonalDraft(id(1));
    model = addPersonalObject(model, "Household", id(2), { name: "Synthetic", members: [id(3), id(4), id(5)] });
    for (const [n, dob] of [[3, "1980-02-29"], [4, "1985-06-15"], [5, undefined]] as const) model = addPersonalObject(model, "Person", id(n), { household_id: id(2), first_name: `Adult ${n}`, ...(dob ? { date_of_birth: dob } : {}) });
    const data = selectRetirementIncomeChartData(model, "2026-01-01", [id(3), id(4)]);
    expect(data.age90?.through).toBe("2075-06-15");
    expect(data.age90?.end).toBe("2075-07-01");
    expect(data.adults[0]!.age90).toBe("2070-02-28");
    expect(data.adults[2]!.age90).toBeUndefined();
    expect(data.adults[2]!.confirmed).toEqual([]);
    expect(selectRetirementIncomeChartData(model, "2026-01-01", [id(5)]).age90).toBeUndefined();
  });
});
