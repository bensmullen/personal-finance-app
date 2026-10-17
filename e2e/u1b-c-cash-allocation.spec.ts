import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";
import { inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import type { PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import type { ForecastWorkerResponse } from "../src/application/interactiveForecast.js";
import { addPersonalObject, createEmptyPersonalDraft, exportPersonalModelJson, type PersonalDraft } from "../src/application/personalMvp.js";
import { decimal } from "../src/values/index.js";
import { formatExactMoney } from "../ui/entityPresentation.js";

const panel = (page: Page) => page.getByRole("region", { name: "Your Paycheck", exact: true });
const status = (page: Page) => page.getByRole("status", { name: "Household forecast status", exact: true });
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
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  await expect(status(page)).not.toHaveAttribute("data-request-id", before ?? "");
  await expect(status(page)).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/, { timeout: 30_000 });
  await expect(status(page)).toHaveAttribute("data-pending", "false");
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
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  const disclosure = taxes.locator("xpath=ancestor::details[1]");
  if (await disclosure.getAttribute("open") === null) await disclosure.locator(":scope > summary").click();
  await taxes.getByLabel("Tax payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption({ label: "Everyday checking" });
  for (const name of ["Federal income tax", "New York"]) await taxes.getByRole("button", { name: `Suggest April 15 for ${name}`, exact: true }).click();
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
  const cacheHit = await status(page).locator("dt").filter({ hasText: /^Cache$/ }).locator("xpath=following-sibling::dd[1]").textContent() === "hit";
  const forecast = await page.evaluate(({ requestId, fingerprint, cacheHit }) => {
    const observed = window as typeof window & { __cashResults: ForecastWorkerResponse[] };
    const response = [...observed.__cashResults].reverse().find(item => item.fingerprint === fingerprint && (cacheHit || String(item.requestId) === requestId));
    return response?.outcome === "result" ? response.result as PersonalHouseholdForecastReadModel : undefined;
  }, { requestId, fingerprint, cacheHit });
  if (!forecast || forecast.status === "unavailable") throw new Error("Expected the applied household source");
  return forecast;
}

for (const width of [1440, 390]) {
  test(`Cash selected month matches real replay, exact table and immutable sources at ${width}px`, async ({ page }) => {
    await observe(page);
    await setup(page, width);
    const source = await appliedSource(page);
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
    const summary = panel(page).getByText("Exact monthly comparison & receipts", { exact: true });
    await summary.focus(); await page.keyboard.press("Enter");
    const table = panel(page).getByRole("table");
    await expect(table).toBeVisible();
    for (const item of expected.categories) {
      await expect(table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: item.label, exact: true }) }).getByRole("cell")).toHaveText(exact(item.amount));
    }
    await expect(table.getByRole("row", { name: /Total known uses/ }).getByRole("cell")).toHaveText(exact(expected.totalUses));
    await expect(table.getByRole("row", { name: /^Payroll withholding/ }).getByRole("cell")).toHaveText("Unknown · not modeled");
    const comparison = panel(page).getByRole("figure", { name: "Where modeled income goes comparison", exact: true });
    const v3 = page.getByRole("figure", { name: "Modeled statement income versus expenses", exact: true });
    const v2 = page.getByRole("figure", { name: "Total modeled cash (including cash in investment accounts)", exact: true });
    const v2Box = await v2.boundingBox(), v3Box = await v3.boundingBox(), v4Box = await comparison.boundingBox();
    expect(v2Box!.y).toBeLessThan(v3Box!.y);
    expect(v3Box!.y).toBeLessThan(v4Box!.y);
    await panel(page).getByRole("region", { name: "Exact monthly comparison", exact: true }).focus();
    await expect(panel(page).getByRole("region", { name: "Exact monthly comparison", exact: true })).toBeFocused();
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
    await panel(page).getByText(`Review ${expense.label} sources`, { exact: true }).click();
    await panel(page).getByRole("button", { name: `Review ${expense.label}`, exact: true }).click();
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

test("H04 bank-only no forecast has an accessible mobile fallback and owner routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
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
  await expect(panel(page)).toHaveAttribute("data-evidence-state", "unavailable");
  await expect(panel(page)).toContainText("Monthly evidence unavailable");
  await expect(panel(page).getByRole("img")).toHaveCount(0);
  await expect(panel(page).getByRole("combobox")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Cash tasks", exact: true }).getByRole("button", { name: "Review Accounts sources", exact: true }).click();
  await expect(page.getByRole("button", { name: /H04 checking/ })).toBeVisible();
  await page.getByRole("button", { name: "Return to Cash breakdown", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
