import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashAllocation, cashComparison, type MonthlyEvidenceDetail } from "../ui/forecast/CashAllocation.js";
import { MonthlyMoneyPanel } from "../ui/forecast/MonthlyMoneyPanel.js";
import { cashChangeAppearance, chartCoordinate } from "../ui/forecast/charts/FinancialChart.js";
import { selectForecastChartData } from "../src/application/forecastChartData.js";
import { taxOutputCapabilities } from "../src/simulation/tax/contracts.js";
import { createEmptyPersonalDraft, patchPersonalObject, type PersonalDraft } from "../src/application/personalMvp.js";
import { authorPayrollWithholding } from "../src/application/compiler/payrollWithholding.js";
import { objects } from "../src/application/compiler/shared.js";
import { GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { decimal } from "../src/values/index.js";
import type { MonthlyUse } from "../src/application/monthlyMoney.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { householdEvidenceMonth } from "../src/application/mortgageChartData.js";
import type { HouseholdForecastPoint } from "../src/application/householdProjection.js";
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
    lines: [], mortgages: [], cashUses: [], withholding: "not_modeled", withholdingAmount: undefined, status: "incomplete", ...overrides };
}
const render = (detail = evidence()) => renderToStaticMarkup(React.createElement(CashAllocation, { draft, detail, review: noop, setup: noop }));

function postedMonth(point: HouseholdForecastPoint) {
  const address = point.traceRefs.find(ref => ref.replayArtifact !== undefined)!.replayArtifact as { basis: unknown; start: string; end: string };
  const basis = restorePortableHouseholdReplayArtifact(address.basis);
  return { basis, transactions: householdEvidenceMonth(basis, address.start, address.end).flatMap(period => period.transactions) };
}

function withheldModel(amount: string | undefined, contributions = true): PersonalDraft {
  let model = createD1IntegratedHousehold();
  if (!contributions) {
    const payrollIds = new Set(objects(model, "PrimitiveInstance").filter(item => {
      const params = item.parameters;
      return params && typeof params === "object" && !Array.isArray(params) && params.adapter === "d1-payroll-contribution/v1";
    }).map(item => item.primitive_instance_id));
    model = { ...model, objects: { ...model.objects,
      PrimitiveInstance: objects(model, "PrimitiveInstance").filter(item => !payrollIds.has(item.primitive_instance_id)),
      Investment: objects(model, "Investment").map(item => payrollIds.has(item.contribution_model_id) ? { ...item, contribution_model_id: null } : item),
    } };
  }
  return amount === undefined ? model : authorPayrollWithholding(model, {
    id: "17100000-0000-4000-8000-000000000001", incomeId: golden.income, ownerId: golden.person,
    employerId: "Example salary", depositAccountId: golden.checking, jurisdiction: "US:FEDERAL", effectiveDate: "2026-01-01",
    provenance: "Synthetic selected-month withholding regression", userConfirmed: true, calculation: { kind: "fixed", amount },
  });
}

describe("Cash payroll credit classification from authentic committed replay", () => {
  it.each([true, false])("separates withholding, employee assets and bank-paid tax (contributions %s)", contributions => {
    const model = withheldModel("123.45", contributions);
    const request = { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000002" };
    const forecast = runPersonalHouseholdForecast(model, request);
    if (forecast.status === "unavailable") throw new Error("Expected committed payroll fixture");
    const before = JSON.stringify({ model, forecast });
    const detail = inspectMonthlyMoney(forecast.points[0]!, model);
    expect(detail.withholding).toBe("posted");
    expect(detail.withholdingAmount).toBe("123.45");
    expect(detail.employee).toBe(contributions ? "550" : "0");
    expect(detail.payroll).toBe("9000");
    expect(detail.deposited).toBe(contributions ? "8326.55" : "8876.55");
    expect(detail.unreconciled).toBe(detail.deposited);
    expect(detail.categories.filter(item => item.label === "Payroll withholding")).toEqual([expect.objectContaining({ kind: "tax", amount: "123.45", holdingIds: [], incomeIds: [golden.income] })]);
    expect(detail.categories.find(item => item.label === "Tax cash payment")?.amount).toBe("500");
    expect(detail.categories.some(item => item.label === "Other payroll allocation")).toBe(false);
    expect(detail.lines.filter(item => item.kind === "employee").map(item => item.amount).sort()).toEqual(contributions ? ["100", "450"] : []);
    const ids = detail.categories.flatMap(item => item.sourceIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cashComparison(detail)?.coherent).toBe(true);
    const html = render(detail);
    expect(html).toContain("123.45 USD · posted elections only");
    expect(html).toContain("Withheld from gross payroll · not a second bank cash outflow or spending");
    expect(html).not.toContain("Unknown · not modeled");
    expect(JSON.stringify({ model, forecast })).toBe(before);
    expect(JSON.stringify(runPersonalHouseholdForecast(model, request))).toBe(JSON.stringify(forecast));
  });
  it.each(["0", undefined])("distinguishes explicit zero withholding from missing elections (%s)", amount => {
    const model = withheldModel(amount, false);
    const forecast = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000003" });
    if (forecast.status === "unavailable") throw new Error("Expected payroll fixture");
    const detail = inspectMonthlyMoney(forecast.points[0]!, model);
    expect(detail.withholdingAmount).toBe(amount);
    expect(detail.withholding).toBe(amount === "0" ? "posted" : "not_modeled");
    expect(detail.deposited).toBe("9000");
    expect(detail.categories.filter(item => item.label === "Payroll withholding")).toEqual([]);
    expect(detail.employee).toBe("0");
  });
  it("keeps distinct posted jurisdiction credits exactly once in the same withholding category", () => {
    const model = authorPayrollWithholding(withheldModel("123.45"), {
      id: "17100000-0000-4000-8000-000000000008", incomeId: golden.income, ownerId: golden.person,
      employerId: "Example salary", depositAccountId: golden.checking, jurisdiction: "US:NY", effectiveDate: "2026-01-01",
      provenance: "Synthetic second-jurisdiction election", userConfirmed: true, calculation: { kind: "fixed", amount: "17.01" },
    });
    const forecast = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000009" });
    if (forecast.status === "unavailable") throw new Error("Expected multi-jurisdiction payroll fixture");
    const detail = inspectMonthlyMoney(forecast.points[0]!, model);
    expect(detail.withholdingAmount).toBe("140.46");
    expect(detail.deposited).toBe("8309.54");
    const category = detail.categories.find(item => item.label === "Payroll withholding")!;
    expect(category.amount).toBe("140.46");
    expect(category.sourceIds).toHaveLength(2);
    expect(new Set(category.sourceIds).size).toBe(2);
    expect(category.holdingIds).toEqual([]);
    expect(detail.employee).toBe("550");
  });
  it.each(["gross", "net"])("retains partial coverage with a second unsupported %s payroll election", grossOrNet => {
    let model = withheldModel("123.45");
    const salary = objects(model, "Income")[0]!;
    const incomeId = "17100000-0000-4000-8000-000000000004";
    model = { ...model, objects: { ...model.objects, Income: [...model.objects.Income!, { ...salary, income_id: incomeId, frequency: "biweekly", gross_or_net: grossOrNet, source: "Second synthetic employer", growth_model_id: null, related_event_id: null }] } };
    model = authorPayrollWithholding(model, { id: "17100000-0000-4000-8000-000000000005", incomeId, ownerId: golden.person, employerId: "Second synthetic employer", depositAccountId: golden.checking, jurisdiction: "US:FEDERAL", effectiveDate: "2026-01-01", provenance: "Synthetic unsupported election", userConfirmed: true, calculation: { kind: "fixed", amount: "50" } });
    const forecast = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000006" });
    if (forecast.status === "unavailable") throw new Error("Expected supported payroll alongside unsupported source");
    const detail = inspectMonthlyMoney(forecast.points[0]!, model);
    expect(detail.withholding).toBe("partial");
    expect(detail.withholdingAmount).toBe("123.45");
    expect(render(detail)).toContain("partial payroll coverage");
  });
  it("does not call a mixed month fully covered when another supported salary has no election", () => {
    const source = withheldModel("123.45");
    const model = { ...source, objects: { ...source.objects, Income: [...source.objects.Income!, {
      ...objects(source, "Income")[0]!, income_id: "17100000-0000-4000-8000-000000000010", source: "Second supported salary",
      amount: "100", start_date: "2026-01-03", growth_model_id: null, related_event_id: null,
    }] } };
    const forecast = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000011" });
    if (forecast.status === "unavailable") throw new Error("Expected mixed supported payroll fixture");
    const detail = inspectMonthlyMoney(forecast.points[0]!, model);
    expect(detail.withholding).toBe("partial");
    expect(detail.withholdingAmount).toBe("123.45");
    expect(detail.payroll).toBe("9100");
    expect(detail.deposited).toBe("8426.55");
  });
  it("binds same-jurisdiction withholding to each salary occurrence without duplicating credit assets", () => {
    const source = withheldModel("123.45");
    const incomeId = "17100000-0000-4000-8000-000000000012";
    let model: PersonalDraft = { ...source, objects: { ...source.objects, Income: [...source.objects.Income!, {
      ...objects(source, "Income")[0]!, income_id: incomeId, source: "Second supported salary",
      amount: "100", start_date: "2026-01-03", growth_model_id: null, related_event_id: null,
    }] } };
    model = authorPayrollWithholding(model, {
      id: "17100000-0000-4000-8000-000000000013", incomeId, ownerId: golden.person,
      employerId: "Second supported salary", depositAccountId: golden.checking, jurisdiction: "US:FEDERAL",
      effectiveDate: "2026-01-01", provenance: "Synthetic second employer percentage election", userConfirmed: true,
      calculation: { kind: "percent_gross", rate: "0.1701" },
    });
    const forecast = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000014" });
    if (forecast.status === "unavailable") throw new Error("Expected two supported payroll sources");
    const before = JSON.stringify({ model, forecast });
    const detail = inspectMonthlyMoney(forecast.points[0]!, model);
    expect(detail.withholding).toBe("posted");
    expect(detail.withholdingAmount).toBe("140.46");
    expect(detail.payroll).toBe("9100");
    expect(detail.deposited).toBe("8409.54");
    expect(detail.employee).toBe("550");
    const category = detail.categories.find(item => item.label === "Payroll withholding")!;
    expect(category.sourceIds).toHaveLength(2);
    expect(new Set(category.sourceIds).size).toBe(2);
    expect(category.incomeIds).toEqual(expect.arrayContaining([golden.income, incomeId]));
    expect(category.holdingIds).toEqual([]);
    expect(category.accountIds).toEqual([]);
    const { transactions } = postedMonth(forecast.points[0]!);
    for (const id of category.sourceIds) {
      const [transactionId, index] = id.split(":leg:");
      const leg = transactions.find(tx => tx.id === transactionId)!.legs[Number(index)]!;
      expect(leg.type).toBe("asset");
      expect(leg.posting).toBe("debit");
      expect(["123.45", "17.01"]).toContain(leg.amount.amount.toString());
    }
    expect(JSON.stringify({ model, forecast })).toBe(before);
  });
  it.each(["gross", "net"])("does not import out-of-month tax or fabricate unsupported %s salary execution", grossOrNet => {
    const model = patchPersonalObject(withheldModel(undefined, false), "Income", golden.income, { gross_or_net: grossOrNet });
    const compiler = d1IntegratedCompilerRequest();
    const request = { compiler: { ...compiler, tax: { ...compiler.tax, payments: compiler.tax.payments.map(item => ({ ...item, at: "2026-02-02T00:00:00.000Z" as typeof item.at })) } }, asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000007" };
    // The tax-enabled integrated compiler deliberately omits net salary:
    // it cannot reconstruct gross wages. Other supported domains still run.
    const compiled = compileHouseholdProjection(model, request.compiler);
    if (compiled.status !== "compiled") throw new Error("Expected integrated compilation with source-level capability gaps");
    expect(compiled.value.cashFlowInput?.incomes.some(stream => stream.id === golden.income)).toBe(grossOrNet === "gross");
    const forecast = runPersonalHouseholdForecast(model, request);
    if (forecast.status === "unavailable") throw new Error("Expected supported domains alongside salary source limitations");
    const before = JSON.stringify({ model, forecast });
    const point = forecast.points[0]!;
    const { transactions } = postedMonth(point);
    const salary = transactions.filter(tx => tx.type === "income" || tx.type === "payroll_income");
    expect(salary).toHaveLength(grossOrNet === "gross" ? 1 : 0);
    const postedDeposits = salary.flatMap(tx => tx.legs).reduce((sum, leg) =>
      leg.type === "cash" && leg.posting === "debit" ? sum.plus(leg.amount.amount) : sum, decimal("0"));
    const detail = inspectMonthlyMoney(point, model);
    expect(detail.basis).toBe(grossOrNet === "gross" ? "gross_payroll" : "household_income");
    expect(detail.payroll).toBe(grossOrNet === "gross" ? "9000" : "0");
    expect(detail.deposited).toBe(postedDeposits.toString());
    expect(detail.deposited).toBe(grossOrNet === "gross" ? "9000" : "0");
    if (grossOrNet === "net") {
      expect(point.outputCapabilities?.statementIncome?.status).toBe("incomplete");
      expect(forecast.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ category: "payroll_source_unsupported", entityId: golden.income })]));
      expect(detail.income).toBe("0");
      expect(detail.employee).toBe("0");
    }
    expect(detail.withholdingAmount).toBeUndefined();
    expect(detail.categories.some(item => item.label === "Tax cash payment")).toBe(false);
    expect(transactions.some(tx => tx.type.startsWith("tax") && tx.legs.some(leg => leg.type === "cash" && leg.posting === "credit"))).toBe(false);
    expect(decimal(detail.income).equals(decimal(detail.deposited))).toBe(true);
    expect(decimal(point.cash.amount).minus(decimal(forecast.openingSnapshot.cash.amount)).equals(decimal(detail.cashChange))).toBe(true);
    expect(JSON.stringify({ model, forecast })).toBe(before);
  });
});

describe("Cash signed bar presentation from selector evidence", () => {
  it.each([12, 3])("preserves positive, negative and zero on a shared currency scale over %i months", count => {
    const model = createD1IntegratedHousehold();
    const base = runPersonalHouseholdForecast(model, { compiler: d1IntegratedCompilerRequest(), asOf: "2026-01-01", dataCutoff: "2026-01-01", runIdentity: "17100000-0000-4000-8000-000000000015" });
    if (base.status === "unavailable") throw new Error("Expected a supported read-model fixture");
    // Synthetic chart-source closes isolate sign/coverage, not payroll economics.
    // Every financial delta and annual qualification is still derived by the selector.
    const capabilities = taxOutputCapabilities([]);
    const boundary = (month: number) => new Date(Date.UTC(2026, month, 1)).toISOString();
    for (const [change, direction, color] of [["10.01", "increase", "#1e6756"], ["-10.01", "decrease", "#a43d3d"], ["0", "zero", "#66726d"]] as const) {
      const source = { ...base, simulationStart: boundary(0), simulationEnd: boundary(count), reachedThrough: boundary(count),
        requestedHorizon: { start: boundary(0), end: boundary(count) },
        openingSnapshot: { ...base.openingSnapshot, outputCapabilities: capabilities, cash: { amount: "1000", currency: "USD" } },
        points: Array.from({ length: count }, (_, index) => ({ ...base.points[0]!,
          periodStart: boundary(index), periodEnd: boundary(index + 1), outputCapabilities: capabilities,
          cash: { amount: decimal("1000").plus(decimal(change).times(decimal(String(index + 1)))).toString(), currency: "USD" },
        })),
      };
      const annual = selectForecastChartData(source, { granularity: "annual" }).points[0]!;
      expect(annual.metrics.totalModeledCashChange.amount).toBe(decimal(change).times(decimal(String(count))).toString());
      expect(annual.metrics.totalModeledCashChange.status).toBe(count === 12 ? "complete" : "incomplete");
      expect(cashChangeAppearance(annual)).toMatchObject({ fill: color, stroke: color, fillOpacity: count === 12 ? 1 : 0.4, "data-direction": direction });
      expect(cashChangeAppearance(annual)["aria-label"]).toContain(count === 12 ? "2027-01-01" : "partial year, 3 months");
      const monthly = selectForecastChartData(source).points[0]!;
      expect(cashChangeAppearance(monthly)).toMatchObject({ fill: color, fillOpacity: 1, "data-direction": direction });
      const unavailable = { ...monthly, metrics: { ...monthly.metrics, totalModeledCashChange: { ...monthly.metrics.totalModeledCashChange, amount: null, status: "unavailable" as const } } };
      expect(chartCoordinate(unavailable.metrics.totalModeledCashChange)).toBeNull();
      expect(cashChangeAppearance(unavailable)["data-direction"]).toBe("unavailable");
    }
  });
});

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
