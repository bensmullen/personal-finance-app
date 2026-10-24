import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashAllocation, cashComparison, type MonthlyEvidenceDetail } from "../ui/forecast/CashAllocation.js";
import { MonthlyMoneyPanel } from "../ui/forecast/MonthlyMoneyPanel.js";
import { createEmptyPersonalDraft } from "../src/application/personalMvp.js";
import type { MonthlyUse } from "../src/application/monthlyMoney.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest, integratedIds } from "./fixtures/d1IntegratedHousehold.js";

const draft = createEmptyPersonalDraft("cc000000-0000-4000-8000-000000000001");
const noop = () => {};
function category(id: string, amount: string, kind: MonthlyUse["kind"] = "living"): MonthlyUse {
  return { id, label: id, amount, kind, sourceIds: [`posted:${id}`], accountIds: [], holdingIds: [], liabilityIds: [], expenseIds: [], policyIds: [] };
}
function evidence(overrides: Partial<MonthlyEvidenceDetail> = {}): MonthlyEvidenceDetail {
  return { currency: "USD", income: "100", payroll: "100", otherIncome: "0", basis: "gross_payroll", denominator: "100",
    categories: [category("Small", "10"), category("Large", "30")], totalUses: "40", unallocated: "60", additionalFunding: "0",
    cashChange: "60", otherReceipts: "0", receipts: [], employee: "0", deposited: "100", unreconciled: "100",
    lines: [], mortgages: [], cashUses: [], withholding: "not_modeled", status: "incomplete", ...overrides };
}
const render = (detail = evidence()) => renderToStaticMarkup(React.createElement(CashAllocation, { draft, detail, review: noop, setup: noop }));

describe("U1B-C partial cash comparison", () => {
  it("sorts exact amounts beyond binary precision, breaks ties by stable identity, and preserves input", () => {
    const detail = evidence({ currency: "KWD", denominator: "9007199254741000", totalUses: "9007199254740993.003", unallocated: "6.997",
      categories: [category("B", "0.001"), category("C", "9007199254740993.001"), category("A", "0.001"), category("Zero", "0")] });
    const before = JSON.stringify(detail);
    expect(cashComparison(detail)?.categories.map(item => item.id)).toEqual(["C", "A", "B"]);
    const html = render(detail);
    expect(html).toContain("9,007,199,254,740,993.001 KWD");
    expect(html).toContain("0.001 KWD");
    expect(html).not.toContain("<strong>Zero</strong>");
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(JSON.stringify(detail)).toBe(before);
  });
  it("keeps the larger unreconciled difference after all known categories and unknown withholding unquantified", () => {
    const html = render();
    expect(html.indexOf('title="Large:')).toBeLessThan(html.indexOf('title="Small:'));
    expect(html.indexOf('title="Small:')).toBeLessThan(html.indexOf('title="Unreconciled arithmetic difference:'));
    expect(html).toContain("not disposable or unspent earnings");
    expect(html).toContain("<th scope=\"row\">Payroll withholding</th><td>Unknown · not modeled</td>");
    expect(html).not.toContain("paycheck-tax");
    expect(html).toContain("Review tax coverage &amp; setup");
  });
  it("orders distinct decimal amounts that map to the same floating point coordinate", () => {
    const detail = evidence({ denominator: "18014398509481987", totalUses: "18014398509481986.003", unallocated: "0.997",
      categories: [category("A", "9007199254740993.001"), category("B", "9007199254740993.002")] });
    expect(cashComparison(detail)?.categories.map(item => item.id)).toEqual(["B", "A"]);
    expect(cashComparison(detail)?.drawable).toBe(true);
  });
  it("shows every excess category at its full relative size with separate unattributed excess", () => {
    const detail = evidence({ categories: [category("Mortgage", "100", "mortgage"), category("IRA", "50", "ira")], totalUses: "150", unallocated: "0", additionalFunding: "50" });
    const view = cashComparison(detail)!;
    expect(view.drawable).toBe(true);
    expect(view.percent("100")).toBeCloseTo(200 / 3);
    expect(view.percent("50")).toBeCloseTo(100 / 3);
    const html = render(detail);
    expect(html).toContain("Known uses · scale 150 USD");
    expect(html).toContain('title="Mortgage: 100 USD"');
    expect(html).toContain('title="IRA: 50 USD"');
    expect(html).toContain("Uses exceeding this income basis: 50 USD");
    expect(html).toContain("Additional funding not attributed");
    expect(html).toContain("Asset transfer · not spending");
    expect(html).toContain("principal repays debt, not consumption");
    expect(html).not.toContain('class="paycheck-unallocated"');
  });
  it.each([
    { denominator: "0", categories: [], totalUses: "0", unallocated: "0", additionalFunding: "0" },
    { denominator: "-10", totalUses: "40", unallocated: "0", additionalFunding: "50" },
    { categories: [], totalUses: "0", unallocated: "100" },
    { categories: [category("Nothing", "0")], totalUses: "0", unallocated: "100" },
    { totalUses: "41" },
    { categories: [{ ...category("Missing", "40"), sourceIds: [] }] },
    { categories: [{ ...category("One", "20"), sourceIds: ["duplicate"] }, { ...category("Two", "20"), sourceIds: ["duplicate"] }] },
    { currency: "unsupported" },
    { denominator: "corrupt" },
  ])("keeps exact text without a fictitious graphic for unsupported evidence %j", overrides => {
    const html = render(evidence(overrides));
    expect(html).not.toContain('role="img"');
    expect(html).toContain("Exact available evidence is below");
    expect(html).toContain("Exact monthly comparison");
    expect(html).not.toMatch(/NaN|Infinity|width:-/);
  });
  it("draws positive known uses against genuinely zero income without implying paycheck funding", () => {
    const detail = evidence({ basis: "household_income", income: "0", payroll: "0", denominator: "0", totalUses: "40", unallocated: "0", additionalFunding: "40" });
    const before = JSON.stringify(detail), view = cashComparison(detail)!;
    expect(view).toMatchObject({ coherent: true, drawable: true, knownUsesOnly: true, scale: "40", remainder: false });
    expect(view.percent("30")).toBe(75);
    expect(view.percent("10")).toBe(25);
    const html = render(detail);
    expect(html).toContain("Zero modeled income (0 USD) · not a paycheck-funded allocation");
    expect(html).toContain('role="img"');
    expect(html).toContain("Recorded household income</th><td>0 USD");
    expect(html).toContain("Additional funding not attributed");
    expect(html).not.toContain('class="cash-income-reference"');
    expect(html).not.toContain('class="paycheck-unallocated"');
    expect(JSON.stringify(detail)).toBe(before);
    expect(cashComparison({ ...detail, totalUses: "41" })?.drawable).toBe(false);
  });
  it("handles a zero remainder and household income without inventing gross wages", () => {
    const html = render(evidence({ basis: "household_income", categories: [category("Use", "100")], totalUses: "100", unallocated: "0" }));
    expect(html).toContain("Recorded household income");
    expect(html).not.toContain("Gross payroll earnings");
    expect(html).not.toContain('class="paycheck-unallocated"');
  });
  it("links the existing source owners and keeps technical identifiers behind disclosure", () => {
    const html = render(evidence({ categories: [{ ...category("Coverage", "40"), policyIds: ["policy"], accountIds: ["bank"], expenseIds: ["expense"], holdingIds: ["holding"], liabilityIds: ["mortgage"] }] }));
    expect(html).toContain("Review Coverage sources</summary>");
    expect(html).toContain("Review insurance policy");
    expect(html).toContain("Technical details / source transactions</summary>");
    expect(html).toContain("posted:Coverage");
    expect(html).toContain('tabindex="0"');
  });
  it("offers setup without a chart or phantom amounts for unavailable results", () => {
    const empty = renderToStaticMarkup(React.createElement(MonthlyMoneyPanel, { draft, current: false, mode: "paycheck", review: noop, setup: noop }));
    expect(empty).toContain("Monthly evidence unavailable");
    expect(empty).toContain("Review forecast setup");
  });
  it("presents one immutable replay month with payroll, IRA, insurance and mortgage evidence", () => {
    const model = createD1IntegratedHousehold();
    const forecast = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "cc000000-0000-4000-8000-000000000002" });
    if (forecast.status === "unavailable") throw new Error("Integrated source must provide its bounded January replay");
    const before = JSON.stringify({ model, forecast });
    const detail = inspectMonthlyMoney(forecast.points[0]!, model);
    const html = renderToStaticMarkup(React.createElement(CashAllocation, { draft: model, detail, review: noop, setup: noop }));
    expect(cashComparison(detail)?.drawable).toBe(true);
    expect(detail.categories.some(item => item.kind === "ira")).toBe(true);
    expect(detail.categories.some(item => item.kind === "mortgage")).toBe(true);
    expect(detail.categories.some(item => item.policyIds.includes(integratedIds.policy))).toBe(true);
    expect(detail.categories.some(item => item.holdingIds.includes(integratedIds.match))).toBe(false);
    for (const item of detail.categories) expect(html).toContain(`title="${item.label}:`);
    expect(html).toContain("Employee contribution · employer contributions excluded");
    expect(html).toContain("Review insurance policy");
    expect(JSON.stringify({ model, forecast })).toBe(before);
  });
});
