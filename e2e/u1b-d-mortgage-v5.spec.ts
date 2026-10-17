import { expect, test, type Page } from "@playwright/test";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";
import { inspectLiabilityBalanceWindow, inspectMortgageWindow } from "../src/application/mortgageChartData.js";
import type { PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import type { ForecastWorkerResponse } from "../src/application/interactiveForecast.js";
import { addPersonalObject, createEmptyPersonalDraft, createGoldenHouseholdDraft, exportPersonalModelJson } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { formatExactMoney } from "../ui/entityPresentation.js";

const outlook = (page: Page, property = false) => page.getByRole("region", { name: property ? "Property mortgage outlook" : "Debt outlook", exact: true });
const status = (page: Page) => page.getByRole("status", { name: "Household forecast status", exact: true });
test.beforeEach(() => { test.setTimeout(120_000); });

async function observe(page: Page, missing = false) {
  await page.addInitScript(({ missing }) => {
    const target = window as typeof window & { __mortgageResponses: ForecastWorkerResponse[] };
    target.__mortgageResponses = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent<ForecastWorkerResponse>) => {
          const response = event.data;
          if (response.operation !== "baseline_forecast" || response.outcome !== "result") return;
          if (missing && "points" in response.result) for (const point of response.result.points) Object.assign(point, { traceRefs: [] });
          target.__mortgageResponses = [...target.__mortgageResponses.slice(-2), response];
        });
      }
    };
  }, { missing });
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  const previous = await status(page).getAttribute("data-request-id");
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  await expect(status(page)).not.toHaveAttribute("data-request-id", previous ?? "");
  await expect(status(page)).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/, { timeout: 30_000 });
  await expect(status(page)).toHaveAttribute("data-pending", "false");
}
async function setup(page: Page, width: number, denied = false) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  if (denied) {
    // Author the zero-funded account through the existing owner instead of
    // importing a bare model: import intentionally clears session execution
    // choices, making this a forecast-setup test rather than a funding test.
    const bankName = "Isolated mortgage bank";
    await navigateOwner(page, "Money", "Accounts");
    await page.getByRole("button", { name: "+ Add Account", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Create Account", exact: true });
    await editor.getByLabel("Name", { exact: true }).fill(bankName);
    await editor.getByLabel("Account type", { exact: true }).selectOption("checking");
    await editor.getByLabel("Owner", { exact: true }).selectOption(ids.person);
    await editor.getByLabel("Opening date", { exact: true }).fill("2026-01-01");
    await editor.getByLabel("Cash balance", { exact: true }).fill("0");
    await editor.getByRole("button", { name: "Create Account", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await clickFinancialDestination(page, "Debt");
    await page.getByLabel("Mortgage payment account", { exact: true }).selectOption({ label: bankName });
  }
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation start", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-03-01");
  // Imports reset forecast configuration and close disclosures. A collapsed
  // <details> is a group, not a visible region, so open it via its summary first.
  const taxSummary = page.locator("details > summary").filter({ hasText: "Tax payments & refunds" }).first();
  const disclosure = taxSummary.locator("..");
  if (await disclosure.getAttribute("open") === null) await taxSummary.click();
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  await taxes.getByLabel("Tax payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption({ label: "Everyday checking" });
  for (const name of ["Federal income tax", "New York"]) await taxes.getByRole("button", { name: `Suggest April 15 for ${name}`, exact: true }).click();
  for (const checkbox of await taxes.getByRole("checkbox").all()) await checkbox.check();
  await run(page);
}
async function appliedSource(page: Page) {
  const fingerprint = await status(page).getAttribute("data-fingerprint");
  const result = await page.evaluate(fingerprint => {
    const target = window as typeof window & { __mortgageResponses: ForecastWorkerResponse[] };
    const response = [...target.__mortgageResponses].reverse().find(item => item.fingerprint === fingerprint && item.outcome === "result");
    return response?.outcome === "result" ? response.result as PersonalHouseholdForecastReadModel : undefined;
  }, fingerprint);
  if (!result || result.status === "unavailable") throw new Error("Applied household source missing");
  return result;
}
async function fits(page: Page, property = false) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const figure = outlook(page, property).getByRole("region", { name: "Mortgage amortization", exact: true }).getByRole("figure");
  const box = await figure.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const readout = await figure.locator(".mortgage-readout").boundingBox();
  expect(readout!.x).toBeGreaterThanOrEqual(box!.x);
  expect(readout!.x + readout!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
}

for (const width of [1440, 390]) {
  test(`Debt primary household liability chart uses the reconciled source at ${width}px`, async ({ page }) => {
    await observe(page); await setup(page, width);
    const source = await appliedSource(page), expected = inspectLiabilityBalanceWindow(source, 0);
    await clickFinancialDestination(page, "Debt");
    const chart = page.getByRole("region", { name: "Household liability balance outlook", exact: true });
    await expect(chart).toHaveAttribute("data-evidence-state", expected.status);
    await expect(chart).toContainText(formatExactMoney(source.openingSnapshot.totalLiabilities.amount, source.openingSnapshot.totalLiabilities.currency));
    const selected = chart.getByLabel("Selected liability month", { exact: true });
    await selected.focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await expect(selected).toHaveValue(expected.rows[1]!.start);
    await chart.getByText("Exact household liability balances", { exact: true }).click();
    const row = chart.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "2026-02-01 → 2026-03-01", exact: true }) });
    const month = expected.rows[1]!;
    await expect(row.getByRole("cell")).toHaveText(month.supported
      ? [formatExactMoney(month.amount, month.currency), "Committed household forecast"]
      : ["Unavailable", "Incomplete coverage"]);
    const figure = await chart.getByRole("figure", { name: "Modeled household liability balances", exact: true }).boundingBox();
    expect(figure!.x).toBeGreaterThanOrEqual(0);
    expect(figure!.x + figure!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test(`Debt paid bars and keyboard/table match real committed source at ${width}px`, async ({ page }) => {
    await observe(page); await setup(page, width);
    const source = await appliedSource(page), expected = inspectMortgageWindow(source.points, ids.mortgage);
    await clickFinancialDestination(page, "Debt");
    await expect(outlook(page)).toHaveAttribute("data-evidence-state", "current");
    const month = outlook(page).getByLabel("Selected mortgage month", { exact: true });
    await month.focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await expect(month).toHaveValue(expected.rows[1]!.start);
    await outlook(page).getByText("Exact mortgage payments & sources", { exact: true }).click();
    const row = outlook(page).getByRole("region", { name: "Exact mortgage payment data", exact: true }).getByRole("row").filter({ has: page.getByRole("rowheader", { name: "2026-02-01 → 2026-03-01", exact: true }) });
    const values = expected.rows[1]!;
    await expect(row.getByRole("cell")).toHaveText([values.openingPrincipal, values.interestPaid, values.scheduledPrincipalPaid, values.extraPrincipalPaid, values.endingPrincipal, values.scheduledDue, values.interestAccrued]
      .map(value => formatExactMoney(value, values.currency)).concat(`${values.funding.replaceAll("_", " ")} / ${values.extraFunding.replaceAll("_", " ")}`));
    await expect(outlook(page)).toContainText("Partial window at the forecast boundary");
    await fits(page);
  });
  test(`Real Estate has sourced cost, linked mortgage, honest equity and preserved Debt selection at ${width}px`, async ({ page }) => {
    await observe(page); await setup(page, width);
    await clickFinancialDestination(page, "Real Estate");
    await expect(outlook(page, true)).toHaveAttribute("data-evidence-state", "current");
    const mortgage = outlook(page, true).getByLabel("Mortgage", { exact: true });
    await mortgage.selectOption(ids.mortgage);
    await outlook(page, true).getByLabel("Selected mortgage month", { exact: true }).selectOption("2026-02-01T00:00:00.000Z");
    await expect(outlook(page, true)).toContainText("Linked property: Example home");
    await expect(outlook(page, true)).toContainText("Current equity cannot be reconciled");
    await expect(page.getByRole("region", { name: "Real Estate outlook", exact: true })).toContainText("Current market value and home equity are unavailable from this cost source");
    await fits(page, true);
    await clickFinancialDestination(page, "Debt");
    await expect(outlook(page).getByLabel("Selected mortgage month", { exact: true })).toHaveValue("2026-02-01T00:00:00.000Z");
    await clickFinancialDestination(page, "Cash");
    await expect(page.getByRole("region", { name: "Your Paycheck", exact: true })).toBeVisible();
  });
  test(`Unfunded scheduled debt never appears as positive cash paid at ${width}px`, async ({ page }) => {
    await observe(page); await setup(page, width, true);
    const expected = inspectMortgageWindow((await appliedSource(page)).points, ids.mortgage);
    expect(expected.rows[0]).toMatchObject({ interestPaid: "0", scheduledPrincipalPaid: "0", extraPrincipalPaid: "0" });
    await clickFinancialDestination(page, "Debt");
    await expect(outlook(page)).toHaveAttribute("data-evidence-state", "current");
    await expect(outlook(page)).toContainText("No cash payment posted in this month");
    for (const segment of await outlook(page).locator(".mortgage-month").first().locator(".mortgage-column > span").all())
      await expect(segment).toHaveAttribute("style", "height: 0%;");
    await fits(page);
  });
  test(`Missing mortgage replay is recoverable without phantom bars at ${width}px`, async ({ page }) => {
    await observe(page, true); await setup(page, width);
    await clickFinancialDestination(page, "Debt");
    await expect(outlook(page)).toHaveAttribute("data-evidence-state", "error");
    await expect(outlook(page).locator(".mortgage-amortization").getByRole("figure")).toHaveCount(0);
    await expect(outlook(page).getByRole("figure", { name: "Modeled household liability balances", exact: true })).toBeVisible();
    await expect(outlook(page).getByRole("alert")).toContainText("missing or mismatched period");
    await outlook(page).getByRole("button", { name: "Retry mortgage evidence", exact: true }).click();
    await expect(outlook(page)).toHaveAttribute("data-evidence-state", "error");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Mortgage owner cancel/save and stale recovery retain the selected period across screens", async ({ page }) => {
  await observe(page); await setup(page, 390); await clickFinancialDestination(page, "Real Estate");
  const month = () => outlook(page, true).getByLabel("Selected mortgage month", { exact: true });
  await month().selectOption("2026-02-01T00:00:00.000Z");
  await outlook(page, true).getByRole("button", { name: "Review mortgage source", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Liability", exact: true });
  await editor.getByLabel("Name", { exact: true }).fill("Cancelled mortgage name");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(month()).toHaveValue("2026-02-01T00:00:00.000Z");
  await expect(outlook(page, true)).not.toContainText("Cancelled mortgage name");
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-01-01");
  await clickFinancialDestination(page, "Real Estate");
  await outlook(page, true).getByRole("button", { name: "Review mortgage source", exact: true }).click();
  await editor.getByLabel("Name", { exact: true }).fill("Reviewed home loan");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(outlook(page, true)).toHaveAttribute("data-evidence-state", "stale");
  await expect(outlook(page, true).getByRole("figure")).toHaveCount(0);
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-03-01");
  await run(page); await clickFinancialDestination(page, "Debt");
  await expect(outlook(page)).toHaveAttribute("data-evidence-state", "current");
  await expect(outlook(page).getByLabel("Selected mortgage month", { exact: true })).toHaveValue("2026-02-01T00:00:00.000Z");
  await expect(outlook(page).getByRole("heading", { name: "Reviewed home loan · mortgage paydown", exact: true })).toBeVisible();
});

test("No mortgage and unsupported borrowing expose the existing owner without fabricated amortization", async ({ page }) => {
  const id = (n: number) => `d1610000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  let model = createEmptyPersonalDraft(id(1));
  model = addPersonalObject(model, "Household", id(2), { name: "Synthetic debt coverage", members: [id(3)] });
  model = addPersonalObject(model, "Person", id(3), { household_id: id(2), first_name: "Sample", last_name: "Owner", date_of_birth: "1990-01-01" });
  model = addPersonalObject(model, "Liability", id(4), { owner_id: id(2), name: "Sample card", liability_type: "credit_card", principal: "500", current_balance: "500", interest_rate: "0.2", origination_date: "2026-01-01" });
  await page.setViewportSize({ width: 390, height: 900 }); await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-debt.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(model)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await expect(outlook(page)).toHaveAttribute("data-evidence-state", "unavailable");
  await expect(outlook(page)).toContainText("No mortgage recorded");
  await expect(outlook(page)).toContainText("Sample card");
  await expect(outlook(page)).toContainText("Mortgage amortization unavailable for this debt type");
  await expect(outlook(page).getByRole("figure")).toHaveCount(0);
});
