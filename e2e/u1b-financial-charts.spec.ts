import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addPersonalObject, createEmptyPersonalDraft, exportPersonalModelJson } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";
import { selectForecastChartData, type ForecastChartValue } from "../src/application/forecastChartData.js";
import type { PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import type { ForecastWorkerResponse } from "../src/application/interactiveForecast.js";
import { Money, USD } from "../src/values/index.js";
import { formatExactMoney } from "../ui/entityPresentation.js";

const cashTitle = "Total modeled cash (including cash in investment accounts)";
const wealthTitle = "Household financial outlook chart";
const statementTitle = "Modeled statement income versus expenses";
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    // CI-only, bounded diagnostics separate missing DOM, closed ancestors,
    // label wiring and accessible names without dumping the household document.
    const dom = await page.locator(".financial-charts").evaluateAll(containers => containers.map(container => ({
      status: container.getAttribute("data-chart-status"),
      months: container.getAttribute("data-supported-months"),
      figures: Array.from(container.querySelectorAll("figure")).map(figure => ({
        name: figure.getAttribute("aria-label"),
        visible: figure.getClientRects().length > 0 && getComputedStyle(figure).visibility !== "hidden",
        closedAncestors: (() => {
          const closed: string[] = [];
          for (let parent = figure.parentElement; parent; parent = parent.parentElement) {
            if (parent instanceof HTMLDetailsElement && !parent.open) closed.push(parent.querySelector("summary")?.textContent ?? "details");
          }
          return closed;
        })(),
        controls: Array.from(figure.querySelectorAll("select")).map(select => ({
          id: select.id, labels: Array.from(select.labels ?? []).map(label => label.textContent),
          ariaLabel: select.getAttribute("aria-label"), labelledBy: select.getAttribute("aria-labelledby"),
          visible: select.getClientRects().length > 0, disabled: select.disabled, value: select.value,
        })),
      })),
    })));
    await testInfo.attach("chart-control-dom", { body: JSON.stringify(dom, null, 2), contentType: "application/json" });
    const charts = page.locator(".financial-charts");
    if (await charts.count() === 1) await testInfo.attach("chart-accessibility", {
      body: (await charts.ariaSnapshot()).slice(0, 12_000), contentType: "text/plain",
    });
  }
  expect(pageErrors.get(page)).toEqual([]);
});

const grouping = (chart: Locator) => chart.getByRole("combobox", { name: "Period grouping", exact: true });
const wealthChart = (page: Page) => page.getByRole("figure", { name: wealthTitle, exact: true });

// Observe real Worker responses without delaying, replacing or modifying them.
// Match both identities on a miss. An explicit cache hit reuses a previous
// response with the same economic fingerprint under a new request ID.
async function observeBaseline(page: Page) {
  await page.addInitScript(() => {
    const observed = window as typeof window & { __chartBaselines: ForecastWorkerResponse[] };
    observed.__chartBaselines = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent<ForecastWorkerResponse>) => {
          if (event.data.operation === "baseline_forecast" && event.data.outcome === "result") {
            observed.__chartBaselines = [...observed.__chartBaselines.slice(-3), event.data];
          }
        });
      }
    };
  });
}

async function appliedSource(page: Page, status: Locator) {
  const requestId = await status.getAttribute("data-request-id");
  const fingerprint = await status.getAttribute("data-fingerprint");
  const cacheHit = await status.locator("dt").filter({ hasText: /^Cache$/ }).locator("xpath=following-sibling::dd[1]").textContent() === "hit";
  const result = await page.evaluate(({ requestId, fingerprint, cacheHit }) => {
    const observed = window as typeof window & { __chartBaselines: ForecastWorkerResponse[] };
    const response = [...observed.__chartBaselines].reverse().find(item => item.fingerprint === fingerprint && (cacheHit || String(item.requestId) === requestId));
    return response?.outcome === "result" ? response.result as PersonalHouseholdForecastReadModel : undefined;
  }, { requestId, fingerprint, cacheHit });
  if (!result || result.status === "unavailable") throw new Error("Missing supported applied baseline Worker result");
  return result;
}

const expectedValue = (value: ForecastChartValue, signed = false) => {
  if (value.amount === null || value.status === "unavailable") return "Unavailable";
  const direction = Money.parse(value.amount, USD).compare(Money.zero(USD));
  return `${signed ? direction < 0 ? "Decrease · " : direction > 0 ? "Increase · +" : "No change · " : ""}${formatExactMoney(value.amount, value.currency)}${value.status === "incomplete" ? " · Incomplete" : ""}${value.closingAt ? ` · closing ${value.closingAt.slice(0, 10)}` : ""}`;
};

async function openOverview(page: Page) {
  await clickFinancialDestination(page, "Overview");
  await expect(page.getByRole("heading", { name: "How am I doing?", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(wealthChart(page)).toBeVisible();
}

async function runAppliedBaseline(page: Page) {
  await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  const status = page.getByRole("status", { name: "Household forecast status" });
  const priorRequest = await status.getAttribute("data-request-id");
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  await expect(status).not.toHaveAttribute("data-request-id", priorRequest ?? "");
  await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/, { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-pending", "false");
  return status;
}

async function boundedGolden(page: Page, width: number, monthlySpending?: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  if (monthlySpending) {
    await navigateOwner(page, "Money", "Spending");
    await page.getByRole("button", { name: /Living costs/ }).click();
    const editor = page.getByRole("dialog", { name: "Edit Expense", exact: true });
    await editor.getByLabel("Amount", { exact: true }).fill(monthlySpending);
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation start", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-04-01");
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  const taxDetails = taxes.locator("xpath=ancestor::details[1]");
  if (await taxDetails.getAttribute("open") === null) await taxDetails.locator(":scope > summary").click();
  await taxes.getByLabel("Tax payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption({ label: "Everyday checking" });
  for (const name of ["Federal income tax", "New York"]) {
    await taxes.getByRole("button", { name: `Suggest April 15 for ${name}`, exact: true }).click();
  }
  for (const checkbox of await taxes.getByRole("checkbox").all()) await checkbox.check();
  const status = await runAppliedBaseline(page);
  await openOverview(page);
  const charts = page.locator(".financial-charts");
  await expect(charts).toBeVisible();
  await expect(charts).toHaveAttribute("data-chart-status", /^(complete|incomplete)$/);
  await expect(charts).toHaveAttribute("data-supported-months", "3");
  await expect(charts).toContainText("Requested 2026-01-01 → 2026-04-01 (exclusive). Modeled through 2026-04-01");
  return status;
}
async function exportedBytes(page: Page) {
  await navigateOwner(page, "Settings", "Import / Export");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}

for (const width of [1440, 390]) {
  // Each journey owns a fresh three-month run; a V1 control failure cannot
  // prevent Cash, export/stale recovery or H04 coverage from executing in CI.
  test(`Overview V1 visible controls, keyboard and exact periods at ${width}px`, async ({ page }) => {
    const status = await boundedGolden(page, width);
    const wealth = wealthChart(page);
    await expect(grouping(wealth)).toBeVisible();
    await expect(grouping(wealth)).toHaveValue("annual");
    await expect(wealth.getByLabel("Period grouping", { exact: true })).toHaveValue("annual");
    await grouping(wealth).focus();
    await expect(grouping(wealth)).toBeFocused();
    await expect(wealth.getByRole("group", { name: "Assets, liabilities and net worth legend" }).getByRole("button")).toHaveCount(3);
    await expect(page.getByText(/No observed history loaded/)).toHaveCount(1);
    await expect(wealth).toContainText("snapshot, separate from projected periods");
    const graph = wealth.getByRole("application");
    await expect(graph).toHaveAttribute("tabindex", "0");
    await graph.focus();
    await expect(graph).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(wealth.locator(".chart-readout")).toContainText("Annual modeled period [start, end)");
    await expect(wealth.locator(".chart-readout")).toContainText("Projected 2026-01-01 → 2026-04-01 (exclusive) · partial year, 3 months");
    await expect(wealth.locator(".chart-readout")).not.toContainText("Month starting");
    const request = await status.getAttribute("data-request-id");
    await grouping(wealth).selectOption("monthly");
    const range = wealth.getByRole("combobox", { name: "Monthly range starting", exact: true });
    await expect(wealth.getByLabel("Monthly range starting", { exact: true })).toBeVisible();
    await range.selectOption({ index: 1 });
    const selected = wealth.getByRole("combobox", { name: "Selected projected period", exact: true });
    await expect(selected.locator("option")).toHaveText([
      "2026-02-01 → 2026-03-01 (exclusive)",
      "2026-03-01 → 2026-04-01 (exclusive)",
    ]);
    await selected.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(selected).toHaveValue("2026-03-01T00:00:00.000Z");
    const selectedLabel = await selected.locator("option:checked").innerText();
    const readout = wealth.getByRole("status", { name: /exact selected period/ });
    await expect(readout).toContainText(`Projected ${selectedLabel}`);
    await graph.focus();
    await page.keyboard.press("ArrowRight");
    await expect(wealth.locator(".chart-readout")).toContainText("Monthly modeled period [start, end)");
    const legend = wealth.getByRole("button", { name: "Total assets", exact: true });
    await legend.focus(); await page.keyboard.press("Enter");
    await expect(legend).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(legend).toHaveAttribute("aria-pressed", "true");
    const legendButtons = wealth.getByRole("group", { name: "Assets, liabilities and net worth legend" }).getByRole("button");
    for (const button of await legendButtons.all()) await button.click();
    await expect(wealth.getByText(/All series hidden/)).toBeVisible();
    for (const button of await legendButtons.all()) await button.click();
    await expect(wealth.getByText(/All series hidden/)).toHaveCount(0);
    await wealth.locator(".chart-table > summary").focus();
    await page.keyboard.press("Enter");
    const data = wealth.getByRole("region", { name: "Assets, liabilities and net worth exact data" });
    await expect(data).toBeVisible();
    await data.focus(); await expect(data).toBeFocused();
    expect(await data.locator("tbody tr").count()).toBeLessThanOrEqual(12);
    const selectedRow = data.getByRole("row").filter({ has: page.getByRole("rowheader", { name: selectedLabel, exact: true }) });
    const exactValues = await readout.locator("dd").allTextContents();
    await expect(selectedRow.getByRole("cell")).toHaveText(exactValues);
    await expect(status).toHaveAttribute("data-request-id", request!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`Cash V2/V3 stock, signed flows and dense responsive bars at ${width}px`, async ({ page }) => {
    // Stress the real source without assuming recognized expenses or cash change
    // have a particular sign: unmet funding can affect the modeled result.
    await observeBaseline(page);
    const status = await boundedGolden(page, width, "20000.00");
    const source = await appliedSource(page, status);
    const monthly = selectForecastChartData(source);
    const annual = selectForecastChartData(source, { granularity: "annual" });
    expect(monthly.points).toHaveLength(3);
    expect(annual.points).toHaveLength(1);
    await clickFinancialDestination(page, "Cash");
    await expect(page.getByRole("heading", { name: "What comes in and goes out?", exact: true, level: 1 })).toBeVisible();
    const cash = page.getByRole("figure", { name: cashTitle, exact: true });
    const statements = page.getByRole("figure", { name: statementTitle, exact: true });
    await expect(cash).toBeVisible();
    await expect(statements).toBeVisible();
    await expect(page.getByText(/No observed history loaded/)).toHaveCount(1);
    await expect(grouping(cash)).toHaveValue("annual");
    await expect(cash).toContainText("right axis: signed annual balance change");
    await expect(grouping(statements)).toHaveValue("monthly");
    await expect(statements).toContainText("not bank receipts/disbursements or disposable wages");
    await expect(cash.locator(".recharts-yAxis")).toHaveCount(2);
    await expect(statements.locator(".recharts-yAxis")).toHaveCount(1);
    const cashBox = await cash.boundingBox(), statementsBox = await statements.boundingBox();
    expect(cashBox!.y).toBeLessThan(statementsBox!.y);
    await expect(cash).toContainText("Incomplete");
    await statements.locator(".chart-table > summary").click();
    await expect(statements.getByRole("table")).toBeVisible();
    await expect(statements.getByRole("table").locator("tbody tr")).toHaveCount(3);
    const statementPeriod = statements.getByRole("combobox", { name: "Selected projected period", exact: true });
    await expect(statements.getByLabel("Monthly range starting", { exact: true })).toHaveValue(monthly.points[0]!.periodStart);
    for (const [index, point] of monthly.points.entries()) {
      const raw = source.points[index]!;
      expect(point.metrics.modeledStatementIncome.amount).toBe(raw.statementIncome.amount);
      expect(point.metrics.modeledStatementExpenses.amount).toBe(raw.statementExpenses.amount);
      expect(point.metrics.modeledStatementIncome.status).toBe(raw.outputCapabilities!.statementIncome!.status);
      expect(point.metrics.modeledStatementExpenses.status).toBe(raw.outputCapabilities!.statementExpenses!.status);
      await statementPeriod.selectOption(point.periodStart);
      const values = [expectedValue(point.metrics.modeledStatementIncome), expectedValue(point.metrics.modeledStatementExpenses)];
      await expect(statements.getByRole("table").locator("tbody tr").nth(index).getByRole("cell")).toHaveText(values);
      await expect(statements.getByRole("status", { name: `${statementTitle} exact selected period`, exact: true }).locator("dd")).toHaveText(values);
    }
    const plotBox = await statements.locator(".recharts-xAxis .recharts-cartesian-axis-line").boundingBox();
    const zeroBox = await statements.locator(".recharts-reference-line-line").boundingBox();
    expect(plotBox).not.toBeNull();
    expect(plotBox!.width).toBeGreaterThan(0);
    expect(zeroBox).not.toBeNull();
    let visibleBars = 0;
    let expectedBars = 0;
    for (const key of ["modeledStatementIncome", "modeledStatementExpenses"] as const) {
      for (const capability of ["complete", "incomplete"] as const) {
        const values = monthly.points.map(point => point.metrics[key]).filter(value =>
          value.status === capability && value.amount !== null && Money.parse(value.amount, USD).compare(Money.zero(USD)) !== 0);
        expectedBars += values.length;
        const boxes = [];
        for (const rectangle of await statements.locator(`.chart-bar-${key}-${capability} .recharts-bar-rectangle .recharts-rectangle`).all()) {
          const box = await rectangle.boundingBox();
          if (box && box.width > 0 && box.height > 0) boxes.push(box);
        }
        expect(boxes).toHaveLength(values.length);
        for (const [index, box] of boxes.entries()) {
          visibleBars++;
          // Two semantic stacks occupy the three monthly bands; complete and
          // incomplete Bar elements must not create four narrow series slots.
          expect(box.width).toBeGreaterThan(plotBox!.width / 3 * 0.3);
          const positive = Money.parse(values[index]!.amount!, USD).compare(Money.zero(USD)) > 0;
          expect(Math.abs((positive ? box.y + box.height : box.y) - zeroBox!.y)).toBeLessThanOrEqual(1);
          if (positive) expect(box.y).toBeLessThan(zeroBox!.y);
          else expect(box.y + box.height).toBeGreaterThan(zeroBox!.y);
        }
      }
    }
    expect(expectedBars).toBeGreaterThan(0);
    expect(visibleBars).toBe(expectedBars);
    await cash.locator(".chart-table > summary").click();
    await expect(cash.getByRole("table").locator("tbody tr")).toHaveCount(1);
    const closingCash = source.points.at(-1)!.cash.amount;
    const change = Money.parse(closingCash, USD).minus(Money.parse(source.openingSnapshot.cash.amount, USD)).amount.toString();
    expect(annual.points[0]!.metrics.totalModeledCash.amount).toBe(closingCash);
    expect(annual.points[0]!.metrics.totalModeledCashChange.amount).toBe(change);
    const cashValues = [expectedValue(annual.points[0]!.metrics.totalModeledCash), expectedValue(annual.points[0]!.metrics.totalModeledCashChange, true)];
    await expect(cash.getByRole("status", { name: `${cashTitle} exact selected period`, exact: true }).locator("dd")).toHaveText(cashValues);
    await expect(cash.getByRole("table").locator("tbody td")).toHaveText(cashValues);
    const cashZero = await cash.locator(".recharts-reference-line-line").boundingBox();
    expect(cashZero).not.toBeNull();
    const changeDirection = Money.parse(change, USD).compare(Money.zero(USD));
    let cashBars = 0;
    for (const rectangle of await cash.locator(".recharts-bar-rectangle .recharts-rectangle").all()) {
      const box = await rectangle.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) continue;
      cashBars++;
      expect(Math.abs((changeDirection > 0 ? box.y + box.height : box.y) - cashZero!.y)).toBeLessThanOrEqual(1);
    }
    expect(cashBars).toBe(changeDirection === 0 ? 0 : 1);
    const cashLegend = cash.getByRole("button", { name: "Signed cash balance change", exact: true });
    await cashLegend.focus(); await page.keyboard.press("Enter");
    await expect(cashLegend).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(cashLegend).toHaveAttribute("aria-pressed", "true");
    await cash.getByRole("application").focus(); await page.keyboard.press("ArrowRight");
    await expect(cash.locator(".chart-readout dd")).toHaveText(cashValues);
    await grouping(statements).selectOption("annual");
    await expect(statements.getByRole("table").locator("tbody tr")).toHaveCount(1);
    await expect(statements.getByRole("table")).toContainText("partial year, 3 months");
    for (const [metric, field] of [["modeledStatementIncome", "statementIncome"], ["modeledStatementExpenses", "statementExpenses"]] as const) {
      const coveredSum = source.points.reduce((sum, point) => sum.plus(Money.parse(point[field].amount, USD)), Money.zero(USD)).amount.toString();
      expect(annual.points[0]!.metrics[metric].amount).toBe(coveredSum);
    }
    const statementValues = [expectedValue(annual.points[0]!.metrics.modeledStatementIncome), expectedValue(annual.points[0]!.metrics.modeledStatementExpenses)];
    await expect(statements.getByRole("status", { name: `${statementTitle} exact selected period`, exact: true }).locator("dd")).toHaveText(statementValues);
    await expect(statements.getByRole("table").locator("tbody td")).toHaveText(statementValues);
    await grouping(statements).selectOption("monthly");
    await expect(statements.getByRole("table").locator("tbody tr")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`Read-only Overview to Cash export, retained stale result and edit recovery at ${width}px`, async ({ page }) => {
    const status = await boundedGolden(page, width);
    const before = await exportedBytes(page);
    await openOverview(page);
    const wealth = wealthChart(page);
    await grouping(wealth).selectOption("monthly");
    await wealth.locator(".chart-table > summary").click();
    await expect(wealth.getByRole("table")).toBeVisible();
    await clickFinancialDestination(page, "Cash");
    const cash = page.getByRole("figure", { name: cashTitle, exact: true });
    await expect(cash).toBeVisible();
    await grouping(cash).selectOption("monthly");
    await cash.getByRole("button", { name: "Signed cash balance change", exact: true }).click();
    await expect(cash.getByRole("button", { name: "Signed cash balance change", exact: true })).toHaveAttribute("aria-pressed", "false");
    expect(await exportedBytes(page)).toBe(before);

    // Block a replacement run with an invalid window, then commit a real income
    // edit. This makes the retained result observably stale without a timing race.
    await navigateOwner(page, "Plan", "Current Plan");
    await page.getByLabel("Simulation end", { exact: true }).fill("2026-01-01");
    await navigateOwner(page, "Money", "Income");
    const routing = page.getByRole("region", { name: "Income deposit routing", exact: true });
    await expect(routing).toBeVisible();
    await routing.getByLabel("Income receiving account", { exact: true }).selectOption("");
    await expect(routing.getByLabel("Income receiving account", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: /Example salary/ }).click();
    const editor = page.getByRole("dialog", { name: "Edit Income", exact: true });
    await editor.getByLabel("Amount", { exact: true }).fill("10000.00");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const changed = JSON.parse(await exportedBytes(page));
    expect(changed.objects.Income.some((income: { amount: string }) => income.amount === "10000.00")).toBe(true);
    await openOverview(page);
    await expect(status).toHaveAttribute("data-lifecycle", "stale");
    await expect(page.locator(".chart-freshness")).toContainText("Out of date");
    await expect(wealth).toContainText("out of date");
    await expect(page.locator(".financial-charts")).toHaveAttribute("data-supported-months", "3");

    // Repair through the same visible owners and apply a replacement baseline.
    await navigateOwner(page, "Money", "Income");
    await routing.getByLabel("Income receiving account", { exact: true }).selectOption({ label: "Everyday checking" });
    await navigateOwner(page, "Plan", "Current Plan");
    await page.getByLabel("Simulation end", { exact: true }).fill("2026-04-01");
    await runAppliedBaseline(page);
    await openOverview(page);
    await expect(page.locator(".chart-freshness")).toHaveCount(0);
    await expect(wealth).not.toContainText("out of date");
    await expect(page.locator(".financial-charts")).toHaveAttribute("data-supported-months", "3");
    const recovered = JSON.parse(await exportedBytes(page));
    expect(recovered.objects.Income.some((income: { amount: string }) => income.amount === "10000.00")).toBe(true);
  });

  test(`H04 opening-only, zero-investments and no-result state at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // Narrow H04 blueprint subset: recorded opening cash only. It deliberately
    // does not claim a fully authored/forecast-ready H04 household or assume enrollment.
    const id = (suffix: string) => `b0400000-0000-4000-8000-${suffix.padStart(12, "0")}`;
    let draft = createEmptyPersonalDraft(id("1"));
    draft = addPersonalObject(draft, "Household", id("2"), { name: "Rick Barlow · H04 opening only", members: [id("3")] });
    draft = addPersonalObject(draft, "Person", id("3"), { household_id: id("2"), first_name: "Rick", last_name: "Barlow", date_of_birth: "1981-01-01" });
    draft = addPersonalObject(draft, "Account", id("4"), { name: "H04 checking", account_type: "checking", owner_id: id("3"), currency: "USD", opening_date: "2026-01-01", opening_balance: "1350" });
    draft = addPersonalObject(draft, "Account", id("5"), { name: "H04 savings", account_type: "savings", owner_id: id("3"), currency: "USD", opening_date: "2026-01-01", opening_balance: "2400" });
    await page.goto("/");
    await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
    await navigateOwner(page, "Settings", "Import / Export");
    await page.locator('input[type="file"]').setInputFiles({ name: "h04-opening-only.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(draft)) });
    await page.getByRole("button", { name: "Import into session", exact: true }).click();
    await clickFinancialDestination(page, "Investing");
    await expect(page.getByRole("region", { name: "Investing outlook" })).toContainText("No investment holdings recorded");
    await clickFinancialDestination(page, "Overview");
    await expect(page.getByRole("figure", { name: "Household financial outlook chart" })).toHaveCount(0);
    await expect(page.getByText("Run the reconciled household forecast", { exact: true })).toBeVisible();
    await clickFinancialDestination(page, "Cash");
    await expect(page.getByText(/No supported cash forecast yet/)).toBeVisible();
    await expect(page.locator(".financial-chart")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
