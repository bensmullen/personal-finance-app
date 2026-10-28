import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { clickFinancialDestination, navigateOwner, expectForecastWindow } from "./navigation.js";

import { cashComparison, inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import type { PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import type { ForecastWorkerResponse } from "../src/application/interactiveForecast.js";
import { addPersonalObject, createEmptyPersonalDraft, exportPersonalModelJson, getCurrentPosition, type PersonalDraft } from "../src/application/personalMvp.js";
import { decimal } from "../src/values/index.js";
import { formatExactMoney } from "../ui/entityPresentation.js";

const panel = (page: Page) => page.getByRole("region", { name: "Your Paycheck", exact: true });
const status = (page: Page) => page.locator('.forecast-status[aria-label="Household forecast status"]');
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page)!.push(error.message));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

// Observe the actual worker result; do not substitute a made-up financial run.
async function observe(page: Page, corruptReplay = false) {
  await page.addInitScript(({ corruptReplay }) => {
    const observed = window as typeof window & { __cashResults: ForecastWorkerResponse[] };
    observed.__cashResults = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent<ForecastWorkerResponse>) => {
          const response = event.data;
          if (response.operation !== "baseline_forecast" || response.outcome !== "result") return;
          // Dedicated corruption case: emulate loss of the replay attachment in
          // transport, leaving the independently useful V2/V3 source intact.
          if (corruptReplay && "points" in response.result) {
            for (const point of response.result.points) Object.assign(point, { traceRefs: [] });
          }
          observed.__cashResults = [...observed.__cashResults.slice(-3), response];
        });
      }
    };
  }, { corruptReplay });
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  const before = await status(page).getAttribute("data-request-id");
  const more = page.getByRole("button", { name: "More", exact: true });
  const mobile = await more.isVisible();
  if (mobile) await more.click();
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  if (mobile) await page.keyboard.press("Escape");
  await expect(status(page)).not.toHaveAttribute("data-request-id", before ?? "");
  await expect(status(page)).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/, { timeout: 30_000 });
  await expect(status(page)).toHaveAttribute("data-pending", "false");
  await expectForecastWindow(page, "2026-01-01", "2026-03-01", 2);
}
async function setup(page: Page, width = 1440, spending?: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  if (spending) {
    await navigateOwner(page, "Money", "Spending");
    await page.getByRole("button", { name: /Living costs/ }).click();
    const editor = page.getByRole("dialog", { name: "Edit Expense", exact: true });
    await editor.getByLabel("Amount", { exact: true }).fill(spending);
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation start", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-03-01");
  // A collapsed <details> exposes only its summary; its child region cannot
  // be located by role until we open the outer disclosure.
  const taxSummary = page.locator("details > summary").filter({ hasText: "Tax payments & refunds" }).first();
  if (await taxSummary.locator("..").getAttribute("open") === null) await taxSummary.click();
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  await taxes.getByLabel("Tax payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption({ label: "Everyday checking" });
  // The explicitly synthetic flagship is resident in Philadelphia, PA.
  // Confirm every jurisdiction actually sourced by its household record.
  for (const name of ["Federal income tax", "Pennsylvania", "Philadelphia wage tax"]) {
    const summary = taxes.locator("summary").filter({ hasText: name }).first();
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
    await taxes.getByRole("button", { name: `Suggest April 15 for ${name}`, exact: true }).click();
  }
  for (const checkbox of await taxes.getByRole("checkbox").all()) await checkbox.check();
  await run(page);
  await clickFinancialDestination(page, "Cash");
}
async function exported(page: Page) {
  await navigateOwner(page, "Settings", "Import / Export");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}
async function appliedSource(page: Page) {
  const requestId = await status(page).getAttribute("data-request-id");
  const fingerprint = await status(page).getAttribute("data-fingerprint");
  const cacheHit = await status(page).getAttribute("data-cache-state") === "hit";
  const forecast = await page.evaluate(({ requestId, fingerprint, cacheHit }) => {
    const observed = window as typeof window & { __cashResults: ForecastWorkerResponse[] };
    const response = [...observed.__cashResults].reverse().find(item => item.fingerprint === fingerprint && (cacheHit || String(item.requestId) === requestId));
    return response?.outcome === "result" ? response.result as PersonalHouseholdForecastReadModel : undefined;
  }, { requestId, fingerprint, cacheHit });
  if (!forecast || forecast.status === "unavailable") throw new Error("Expected the applied household source");
  expect(forecast.requestedHorizon).toEqual({ start: "2026-01-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" });
  expect(forecast.points).toHaveLength(2);
  return forecast;
}

for (const width of [1440, 390]) {
  test(`Calm Cash shows real flagship withholding and separate recorded balances at ${width}px`, async ({ page }) => {
    await observe(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
    await expect(status(page)).toHaveAttribute("data-lifecycle", "completed", { timeout: 30_000 });
    const model = JSON.parse(await exported(page)) as PersonalDraft;
    await clickFinancialDestination(page, "Cash");
    await expect(page.getByRole("heading", { name: "Your cash, coming in and going out.", exact: true })).toBeVisible();
    const cashRun = page.getByRole("button", { name: "Run cash-flow forecast", exact: true });
    await expect(cashRun).toHaveCount(1);
    await expect(cashRun).toBeVisible();
    await expect(cashRun).toBeEnabled();
    const charts = page.locator(".calm-cash-charts");
    const chartDetails = page.locator(".cash-chart-details");
    await expect(chartDetails).toHaveCount(3);
    await expect(chartDetails.nth(0)).toHaveAttribute("aria-label", "Total Cash Balance Chart Details");
    await expect(chartDetails.nth(1)).toHaveAttribute("aria-label", "Modeled statement income versus expenses Chart Details");
    await expect(chartDetails.nth(2)).toHaveAttribute("aria-label", "Where modeled income goes Chart Details");
    for (const details of await chartDetails.all()) await expect(details).not.toHaveAttribute("open");
    // The approved sequence is chart → its details → the next chart, in DOM
    // and rendered geometry. No shared end-of-page evidence container remains.
    const stack = charts.locator(".financial-chart > figcaption h3, .cash-chart-details > summary, .monthly-money > .panel-head h2");
    await expect(stack).toHaveText([
      "Total Cash Balance", "Chart Details",
      "Modeled statement income versus expenses", "Chart Details",
      "Explain this month’s income", "Chart Details",
    ]);
    const boxes = await Promise.all((await stack.all()).map(element => element.boundingBox()));
    for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height);
    for (const [index, details] of (await chartDetails.all()).entries()) {
      const summary = details.locator(":scope > summary");
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(summary).toBeFocused();
      for (const [otherIndex, other] of (await chartDetails.all()).entries()) {
        if (otherIndex === index) await expect(other).toHaveAttribute("open", "");
        else await expect(other).not.toHaveAttribute("open");
      }
      await page.keyboard.press("Enter");
    }
    // The month picker retains its tiny accessible field-help disclosure;
    // only large explanatory chart disclosures belong in Chart Details.
    await expect(charts.locator("details[open]:not(.field-help)")).toHaveCount(0);
    await expect(charts.locator(".financial-chart")).toHaveCount(2);
    for (const figure of await charts.locator(".financial-chart").all()) {
      const title = await figure.locator("figcaption").boundingBox();
      const graphic = await figure.locator(".chart").boundingBox();
      const controls = await figure.locator(".chart-controls").boundingBox();
      expect(graphic!.y - (title!.y + title!.height)).toBeLessThanOrEqual(16);
      expect(controls!.y).toBeGreaterThanOrEqual(graphic!.y + graphic!.height);
      await expect(figure.locator(".chart-selected")).not.toBeVisible();
      const summary = await figure.locator(".cash-chart-details > summary").boundingBox();
      expect(summary!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
      await expect(figure.locator(".cash-chart-details .chart-table")).toHaveCount(1);
      await expect(figure.getByText("Exact monthly comparison & receipts", { exact: true })).toHaveCount(0);
      const select = figure.getByRole("combobox").first();
      expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await select.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
    }
    const headings = charts.locator(".financial-chart h3");
    expect(await headings.first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(20);
    const v3Graphic = await charts.locator(".financial-chart .chart").nth(1).boundingBox();
    const v4Title = await panel(page).getByRole("heading", { level: 2 }).boundingBox();
    expect(v4Title!.y).toBeGreaterThan(v3Graphic!.y + v3Graphic!.height);
    await expect(panel(page)).toHaveAttribute("data-evidence-state", "incomplete");
    const allocationGraphic = await panel(page).locator(".paycheck-bar").boundingBox();
    const monthControl = await panel(page).getByLabel("paycheck forecast month", { exact: true }).boundingBox();
    expect(monthControl!.y).toBeGreaterThan(allocationGraphic!.y + allocationGraphic!.height);
    expect(allocationGraphic!.y - (v4Title!.y + v4Title!.height)).toBeLessThan(120);
    const recorded = page.getByRole("region", { name: "Recorded cash today", exact: true });
    const details = panel(page).locator(".cash-chart-details");
    const allocationDetails = await details.locator(":scope > summary").boundingBox();
    const allocationLegend = await panel(page).locator(".paycheck-legend").boundingBox();
    expect(allocationDetails!.y).toBeGreaterThanOrEqual(monthControl!.y + monthControl!.height);
    expect(allocationDetails!.y).toBeGreaterThanOrEqual(allocationLegend!.y + allocationLegend!.height);
    await expect(details.locator(".chart-table")).toHaveCount(0);
    await expect(details).not.toHaveAttribute("open");
    await expect(recorded).toBeVisible();
    await expect(recorded.getByRole("article", { name: "Bank cash and savings", exact: true })).toContainText("Recorded bank accounts · as of 2026-01-01");
    await expect(recorded.getByRole("article", { name: "Cash inside investment accounts", exact: true })).toContainText("Recorded investment accounts · as of 2026-01-01");
    const month = panel(page).getByLabel("paycheck forecast month", { exact: true });
    await month.selectOption("2026-07");
    await expect(month.locator("option:checked")).toHaveText("July 2026");
    await expect(panel(page)).toHaveAttribute("data-evidence-state", "incomplete");
    const requestBeforeDisclosure = await status(page).getAttribute("data-request-id");
    const resultsBeforeDisclosure = await page.evaluate(() => (window as typeof window & { __cashResults: ForecastWorkerResponse[] }).__cashResults.length);
    await details.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(month).toHaveValue("2026-07");
    await expect(page.getByText("Exact monthly comparison & receipts", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Forecast assumptions and supporting details", { exact: true })).toHaveCount(1);
    await expect(status(page)).toHaveAttribute("data-request-id", requestBeforeDisclosure!);
    expect(await page.evaluate(() => (window as typeof window & { __cashResults: ForecastWorkerResponse[] }).__cashResults.length)).toBe(resultsBeforeDisclosure);
    for (const other of await charts.locator(".financial-chart .cash-chart-details").all()) await expect(other).not.toHaveAttribute("open");
    const source = await page.evaluate(() => {
      const observed = window as typeof window & { __cashResults: ForecastWorkerResponse[] };
      const response = observed.__cashResults.at(-1);
      return response?.outcome === "result" ? response.result as PersonalHouseholdForecastReadModel : undefined;
    });
    if (!source || source.status === "unavailable") throw new Error("Expected actual flagship forecast");
    const expected = inspectMonthlyMoney(source.points.find(point => point.periodStart.startsWith("2026-07"))!, model);
    expect(expected.withholding).toBe("posted");
    expect(decimal(expected.withholdingAmount!).isPositive()).toBe(true);
    expect(expected.categories.some(item => item.label === "Employee retirement")).toBe(false);
    await expect(details).toContainText(`${formatExactMoney(expected.withholdingAmount!, expected.currency)} · posted elections only`);
    await expect(details).toContainText("Discretionary Income — unavailable: income, withholding and funding are not fully reconciled.");
    await expect(details).toContainText("Unverified comparison remainder · not disposable income");
    await expect(panel(page)).not.toContainText("Unreconciled arithmetic difference");
    await expect(panel(page)).not.toContainText("Unknown · not modeled");
    await expect(panel(page)).not.toContainText("excludes unmodeled withholding");
    await details.getByText("Exact monthly comparison & receipts", { exact: true }).click();
    await expect(details.getByRole("row", { name: /^Payroll withholding coverage/ }).getByRole("cell")).toContainText(formatExactMoney(expected.withholdingAmount!, expected.currency));
    expect(cashComparison(expected)?.coherent).toBe(true);
    // Text enlargement must reflow without hiding controls or widening the page.
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    const enlarged = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      // Diagnostic only: preserve the strict no-page-overflow assertion.
      monthAncestors: (() => {
        const selected = document.querySelector('[aria-label="paycheck forecast month"]');
        const ancestors: string[] = [];
        for (let element = selected; element && ancestors.length < 8; element = element.parentElement) {
          const bounds = element.getBoundingClientRect();
          ancestors.push(`${element.tagName.toLowerCase()}: ${String(element.className).slice(0, 70)}; x=${Math.round(bounds.left)}, width=${Math.round(bounds.width)}`);
        }
        return ancestors;
      })(),
      overhanging: Array.from(document.querySelectorAll("body *")).flatMap(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.right > innerWidth + 1
          ? [`${element.tagName.toLowerCase()}: ${String(element.className).slice(0, 90)}; x=${Math.round(bounds.left)}, width=${Math.round(bounds.width)}`]
          : [];
      }).slice(0, 18),
    }));
    expect(enlarged.scrollWidth, JSON.stringify(enlarged)).toBeLessThanOrEqual(enlarged.viewportWidth);
    await expect(month).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`Cash selected month matches real replay, exact table and immutable sources at ${width}px`, async ({ page }) => {
    await observe(page);
    await setup(page, width);
    const source = await appliedSource(page);
    expect(source.status).toBe("completed");
    expect(source.reachedThrough).toBe("2026-03-01T00:00:00.000Z");
    expect(source.points.map(point => point.statementIncome.amount)).toEqual(["0", "0"]);
    await expect(status(page)).toHaveAttribute("data-lifecycle", "completed");
    const request = await status(page).getAttribute("data-request-id");
    const before = await exported(page);
    await clickFinancialDestination(page, "Cash");
    const selected = panel(page).getByLabel("paycheck forecast month", { exact: true });
    await selected.focus();
    await expect(selected).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(selected).toHaveValue("2026-02");
    await expect(panel(page)).toHaveAttribute("data-evidence-state", "incomplete");
    const expected = inspectMonthlyMoney(source.points[1]!, JSON.parse(before) as PersonalDraft);
    if (decimal(expected.unallocated).isPositive()) await expect(panel(page).locator(".paycheck-bar > span").last()).toHaveClass("paycheck-unallocated");
    const exact = (amount: string) => formatExactMoney(amount, expected.currency);
    const details = panel(page).locator(".cash-chart-details");
    await details.locator(":scope > summary").click();
    const summary = details.getByText("Exact monthly comparison & receipts", { exact: true });
    await summary.focus(); await page.keyboard.press("Enter");
    const table = details.getByRole("region", { name: "Exact monthly comparison", exact: true }).getByRole("table");
    await expect(table).toBeVisible();
    for (const item of expected.categories) {
      await expect(table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: item.label, exact: true }) }).getByRole("cell")).toHaveText(exact(item.amount));
    }
    await expect(table.getByRole("row", { name: /Total known uses/ }).getByRole("cell")).toHaveText(exact(expected.totalUses));
    await expect(table.getByRole("row", { name: /^Payroll withholding/ }).getByRole("cell")).toHaveText("Unknown · not modeled");
    await expect(details).toContainText("Discretionary Income — unavailable: income, withholding and funding are not fully reconciled.");
    await expect(details).toContainText("Unverified comparison remainder · not disposable income");
    const comparison = panel(page).getByRole("figure", { name: "Where modeled income goes comparison", exact: true });
    expect(expected.denominator).toBe("0");
    await expect(panel(page).locator(".chart-status")).toContainText("Zero modeled income");
    await expect(panel(page).locator(".chart-status")).toContainText("not a paycheck-funded allocation");
    await expect(comparison.locator(".cash-income-reference")).toHaveCount(0);
    await expect(comparison.locator(".paycheck-unallocated")).toHaveCount(0);
    await expect(comparison.locator(".paycheck-bar > span")).toHaveCount(expected.categories.length);
    const v3 = page.getByRole("figure", { name: "Modeled statement income versus expenses", exact: true });
    const v2 = page.getByRole("figure", { name: "Total Cash Balance", exact: true });
    const v2Box = await v2.boundingBox(), v3Box = await v3.boundingBox(), v4Box = await comparison.boundingBox();
    expect(v2Box!.y).toBeLessThan(v3Box!.y);
    expect(v3Box!.y).toBeLessThan(v4Box!.y);
    await details.getByRole("region", { name: "Exact monthly comparison", exact: true }).focus();
    await expect(details.getByRole("region", { name: "Exact monthly comparison", exact: true })).toBeFocused();
    await expect(status(page)).toHaveAttribute("data-request-id", request!);
    expect(await exported(page)).toBe(before);
    await clickFinancialDestination(page, "Cash");
    await expect(selected).toHaveValue("2026-02");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`Cash partial excess keeps all known categories and touch sources at ${width}px`, async ({ page }) => {
    await observe(page);
    await setup(page, width, "20000.00");
    const source = await appliedSource(page);
    const model = JSON.parse(await exported(page)) as PersonalDraft;
    await clickFinancialDestination(page, "Cash");
    const expected = inspectMonthlyMoney(source.points[0]!, model);
    expect(decimal(expected.additionalFunding).isPositive()).toBe(true);
    await expect(panel(page)).toHaveAttribute("data-evidence-state", "incomplete");
    await expect(panel(page).locator(".cash-excess")).toContainText(formatExactMoney(expected.additionalFunding, expected.currency));
    await expect(panel(page).locator(".cash-excess")).toContainText("Additional funding not attributed");
    await expect(panel(page).locator(".paycheck-bar > span")).toHaveCount(expected.categories.length);
    await expect(panel(page).getByRole("img")).toHaveAttribute("aria-label", /Scale is total known uses/);
    const widths = await panel(page).locator(".paycheck-bar > span").evaluateAll(spans => spans.map(span => span.getBoundingClientRect().width));
    expect(widths.every(value => value > 0)).toBe(true);
    const expense = expected.categories.find(item => item.expenseIds.length)!;
    const details = panel(page).locator(".cash-chart-details");
    await details.locator(":scope > summary").click();
    await details.getByText(`Review ${expense.label} sources`, { exact: true }).click();
    await details.getByRole("button", { name: `Review ${expense.label}`, exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit Expense", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Cash owner edit/cancel/save retains month, marks old evidence stale and recovers", async ({ page }) => {
  await setup(page);
  const month = panel(page).getByLabel("paycheck forecast month", { exact: true });
  await month.selectOption("2026-02");
  const before = await exported(page);
  await clickFinancialDestination(page, "Cash");
  const tasks = page.getByRole("navigation", { name: "Cash tasks", exact: true });
  for (const owner of ["Accounts", "Insurance & coverage", "Spending", "Income"]) {
    await tasks.getByRole("button", { name: `Review ${owner} sources`, exact: true }).click();
    await expect(page.locator(".subnav").getByRole("button", { name: owner, exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Return to Cash breakdown", exact: true }).click();
    await expect(month).toHaveValue("2026-02");
    await expect(month).toBeFocused();
  }
  await panel(page).getByRole("button", { name: "Example salary", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Income", exact: true });
  const original = await editor.getByLabel("Amount", { exact: true }).inputValue();
  await editor.getByLabel("Amount", { exact: true }).fill("12345.67");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(month).toHaveValue("2026-02");
  expect(await exported(page)).toBe(before);
  // Disable automatic execution through the real setup owner, so retained
  // stale results can be observed without a race against a fast worker.
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-01-01");
  await clickFinancialDestination(page, "Cash");
  await tasks.getByRole("button", { name: "Review Income sources", exact: true }).click();
  const routing = page.getByRole("region", { name: "Income deposit routing", exact: true });
  await routing.getByLabel("Income receiving account", { exact: true }).selectOption("");
  await page.getByRole("button", { name: /Example salary/ }).click();
  await expect(editor.getByLabel("Amount", { exact: true })).toHaveValue(original);
  await editor.getByLabel("Amount", { exact: true }).fill("10000.00");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Return to Cash breakdown", exact: true }).click();
  await expect(panel(page)).toHaveAttribute("data-evidence-state", "stale");
  await expect(page.getByRole("button", { name: "Run cash-flow forecast", exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("Out of date · retained forecast");
  await expect(panel(page).getByRole("img")).toHaveCount(0);
  await expect(month).toHaveValue("2026-02");
  await tasks.getByRole("button", { name: "Review Income sources", exact: true }).click();
  await routing.getByLabel("Income receiving account", { exact: true }).selectOption({ label: "Everyday checking" });
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-03-01");
  await run(page);
  await clickFinancialDestination(page, "Cash");
  await expect(panel(page)).toHaveAttribute("data-evidence-state", "incomplete");
  await expect(month).toHaveValue("2026-02");
  await expect(panel(page).getByRole("img")).toBeVisible();
  const changed = JSON.parse(await exported(page)) as { objects: { Income: { amount: string }[] } };
  expect(changed.objects.Income.some(income => income.amount === "10000.00")).toBe(true);
});

test("Missing replay offers retry and setup without phantom amounts or hiding V2/V3", async ({ page }) => {
  await observe(page, true);
  await setup(page);
  await expect(panel(page)).toHaveAttribute("data-evidence-state", "error");
  await expect(panel(page).getByRole("alert")).toContainText("Monthly evidence could not be loaded");
  await expect(panel(page).getByRole("img")).toHaveCount(0);
  await expect(page.locator(".financial-chart")).toHaveCount(2);
  await panel(page).getByRole("button", { name: "Retry selected month", exact: true }).click();
  await expect(panel(page)).toHaveAttribute("data-evidence-state", "error");
  await panel(page).getByRole("button", { name: "Review forecast setup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your current plan", exact: true })).toBeVisible();
});

for (const width of [1440, 390]) test(`H04 bank-only no forecast has an accessible fallback and owner routes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const id = (n: number) => `cc040000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  let model = createEmptyPersonalDraft(id(1));
  model = addPersonalObject(model, "Household", id(2), { name: "H04 opening cash only", members: [id(3)] });
  model = addPersonalObject(model, "Person", id(3), { household_id: id(2), first_name: "Rick", last_name: "Barlow", date_of_birth: "1981-01-01" });
  model = addPersonalObject(model, "Account", id(4), { name: "H04 checking", account_type: "checking", owner_id: id(3), currency: "USD", opening_date: "2026-01-01", opening_balance: "1350" });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "h04-cash.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(model)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await clickFinancialDestination(page, "Cash");
  const position = getCurrentPosition(model, { asOf: "2026-01-01", baseCurrency: "USD" });
  await expect(page.getByRole("article", { name: "Bank cash and savings", exact: true }).locator(".calm-metric-value")).toHaveText(position.cash!.display);
  await expect(page.locator(".financial-chart")).toHaveCount(0);
  await expect(panel(page)).toHaveAttribute("data-evidence-state", "unavailable");
  await expect(panel(page)).toContainText("Monthly evidence unavailable");
  await expect(panel(page).getByRole("img")).toHaveCount(0);
  await expect(panel(page).getByRole("combobox")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Cash tasks", exact: true }).getByRole("button", { name: "Review Accounts sources", exact: true }).click();
  await expect(page.getByRole("button", { name: /H04 checking/ })).toBeVisible();
  await page.getByRole("button", { name: "Return to Cash breakdown", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const cashRun = page.getByRole("button", { name: "Run cash-flow forecast", exact: true });
  await expect(cashRun).toHaveCount(1);
  await expect(cashRun).toBeVisible();
  await cashRun.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your current plan", exact: true })).toBeVisible();
});
