import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addPersonalObject, createEmptyPersonalDraft, createGoldenHouseholdExampleDraft, exportPersonalModelJson, getCurrentPosition, type PersonalDraft } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner, openFinancialSection, expectForecastWindow } from "./navigation.js";

const forecastStatus = (page: Page) => page.getByRole("status", { name: "Household forecast status", exact: true });

async function openImportWorkspace(page: Page) {
  await page.goto("/");
  for (const [label, value] of [["Household name", "Parity workspace"], ["Monthly income", "0"], ["Opening cash balance", "0"], ["Asset cost basis", "0"], ["Current debt", "0"], ["Monthly spending", "0"]] as const) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByLabel("Projection horizon (years)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
}

// Layout/source/focus recovery uses twenty real historical months, enough for
// two annual closing points and genuine line geometry. The mandatory
// one-click 649-month real-engine checks remain in u1b-low-input-forecast.spec.ts.
async function loadHistoricalOverview(page: Page) {
  await openImportWorkspace(page);
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "historical-parity.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(createGoldenHouseholdExampleDraft())) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigateOwner(page, "Money", "Income");
  await page.getByLabel("Income receiving account", { exact: true }).selectOption({ label: "Everyday checking" });
  await clickFinancialDestination(page, "Debt");
  // Debt is a direct owner editor; no obsolete outer disclosure.
  await expect(page.getByRole("group", { name: "Example mortgage", exact: true })).toBeVisible();
  await page.getByLabel("Debt owner", { exact: true }).selectOption({ label: "Taylor Example" });
  const mortgage = page.getByRole("group", { name: "Example mortgage", exact: true });
  await mortgage.getByLabel("First monthly payment", { exact: true }).fill("2022-02-01");
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("360");
  await mortgage.getByLabel("Mortgage payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await mortgage.getByLabel("Same-day mortgage order", { exact: true }).fill("1");
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation end", { exact: true }).fill("2027-09-01");
  for (const title of ["Investments", "Tax payments & refunds"]) {
    await openFinancialSection(page, title);
  }
  await page.getByLabel("Investment owner", { exact: true }).selectOption({ label: "Taylor Example" });
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  await taxes.getByLabel("Tax payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption({ label: "Everyday checking" });
  for (const [jurisdiction, label] of [["US:FEDERAL", "Federal income tax"], ["US:NY", "New York"]] as const) {
    const section = taxes.locator("summary").filter({ hasText: label }).first();
    await expect(section).toBeVisible();
    if (await section.locator("..").getAttribute("open") === null) await section.click();
    await taxes.getByRole("button", { name: `Suggest April 15 for ${label}`, exact: true }).click();
    await taxes.getByLabel(`Confirm ${jurisdiction} forecast settlement convention`, { exact: true }).check();
  }
  await page.locator('[data-repair="lawScenario"]').check();
  await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  await expect(forecastStatus(page)).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  await expect(forecastStatus(page)).toHaveAttribute("data-lifecycle", "incomplete");
  await expectForecastWindow(page, "2026-01-01", "2027-09-01", 20);
  await clickFinancialDestination(page, "Overview");
}

// Independent first-screen checks: failures in the longer interaction journey
// below must not prevent either the supported or recorded-only layout checks.
for (const width of [1440, 390]) {
  test(`Overview bounded historical plot first-screen layout at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await loadHistoricalOverview(page);
    await expect(forecastStatus(page)).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
    await expect(forecastStatus(page)).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
    const chart = page.getByRole("figure", { name: "Household financial outlook chart", exact: true });
    await expect(chart.locator(".recharts-responsive-container svg.recharts-surface")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const plot = await chart.locator(".recharts-responsive-container svg.recharts-surface").boundingBox();
    expect(plot!.height).toBeGreaterThanOrEqual(width === 1440 ? 230 : 250);
    // Historical tax gaps leave the complete series empty. Require actual
    // partial-series geometry, not merely a chart container or legend.
    await expect(chart.locator('.recharts-line path.recharts-line-curve[d^="M"]').first()).toBeVisible();
    await expect(chart.getByRole("group", { name: "Assets, liabilities and net worth legend" }).getByRole("button")).toHaveCount(3);
    if (width === 1440) {
      expect(plot!.y).toBeGreaterThan(0);
      expect(plot!.y + plot!.height).toBeLessThanOrEqual(900);
      const setup = await page.locator(".task-readiness").boundingBox();
      expect(setup!.y).toBeGreaterThan(plot!.y + plot!.height);
      for (const value of await page.locator(".calm-metric-value").all()) {
        const box = await value.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(900);
      }
    }
    await expect(chart).toContainText("Forecast, not account history");
    await expect(chart).not.toContainText("Deterministic projection");
    await expect(page.locator(".chart-range")).not.toHaveAttribute("open");
    await expect(chart.locator(".chart-control-details")).not.toHaveAttribute("open");
    await expect(page.getByText("Forecast assumptions and supporting details", { exact: true }).locator("..")).not.toHaveAttribute("open");
    await expect(page.locator(".task-readiness")).not.toHaveAttribute("open");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`Overview H04 honest graph state, one repair and sourced cards at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const id = (suffix: string) => `b0400000-0000-4000-8000-${suffix.padStart(12, "0")}`;
    let draft = createEmptyPersonalDraft(id("1"));
    draft = addPersonalObject(draft, "Household", id("2"), { name: "Rick Barlow · H04 opening only", members: [id("3")] });
    draft = addPersonalObject(draft, "Person", id("3"), { household_id: id("2"), first_name: "Rick", last_name: "Barlow", date_of_birth: "1981-01-01" });
    draft = addPersonalObject(draft, "Account", id("4"), { name: "H04 checking", account_type: "checking", owner_id: id("3"), currency: "USD", opening_date: "2026-01-01", opening_balance: "1350" });
    draft = addPersonalObject(draft, "Account", id("5"), { name: "H04 savings", account_type: "savings", owner_id: id("3"), currency: "USD", opening_date: "2026-01-01", opening_balance: "2400" });
    await openImportWorkspace(page);
    await navigateOwner(page, "Settings", "Import / Export");
    await page.locator('input[type="file"]').setInputFiles({ name: "h04-opening-only.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(draft)) });
    await page.getByRole("button", { name: "Import into session", exact: true }).click();
    await clickFinancialDestination(page, "Overview");
    await expect(forecastStatus(page)).toHaveAttribute("data-lifecycle", "idle");
    const current = page.getByRole("region", { name: "Your finances today", exact: true });
    const correction = page.getByRole("alert", { name: "Priority correction", exact: true });
    await expect(current.getByRole("article")).toHaveCount(3);
    const position = getCurrentPosition(draft, { asOf: "2026-01-01", baseCurrency: "USD" });
    for (const [label, value] of [["Cash and savings", position.cash], ["Outstanding debt", position.liabilities], ["Net worth", position.netWorth]] as const) {
      await expect(current.getByRole("article", { name: label, exact: true }).locator(".calm-metric-value")).toHaveText(value?.display ?? "Unavailable");
    }
    await expect(correction).toHaveCount(1);
    await expect(correction).toContainText("Choose one enabled Current Plan");
    await expect(correction.getByRole("button")).toHaveCount(1);
    await expect(page.locator(".calm-empty")).toContainText("Your forecast is not ready yet");
    await page.evaluate(() => window.scrollTo(0, 0));
    const cards = await current.boundingBox();
    const blocker = await correction.boundingBox();
    const empty = await page.locator(".calm-empty").boundingBox();
    expect(blocker!.y).toBeGreaterThan(empty!.y);
    expect(blocker!.y + blocker!.height).toBeLessThanOrEqual(empty!.y + empty!.height);
    expect(empty!.height).toBeGreaterThanOrEqual(300);
    expect(cards!.y).toBeGreaterThan(empty!.y + empty!.height);
    if (width === 1440) {
      expect(cards!.y).toBeGreaterThan(0);
      expect(cards!.y + cards!.height).toBeLessThan(900);
      expect(blocker!.y + blocker!.height).toBeLessThan(900);
    }
    expect(await current.evaluate(element => !!(element.compareDocumentPosition(document.querySelector(".calm-empty")!) & Node.DOCUMENT_POSITION_PRECEDING))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".task-readiness")).not.toHaveAttribute("open");
    await correction.getByRole("button", { name: "Review forecast dates", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your current plan", exact: true })).toBeVisible();
    await clickFinancialDestination(page, "Overview");
    // Overview is visible in primary navigation at both widths, so clicking
    // it retains keyboard focus on that button (unlike a route behind More).
    const overviewNav = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true });
    await expect(overviewNav).toHaveAttribute("aria-current", "page");
    await expect(overviewNav).toBeFocused();
    await expect(current.getByRole("article", { name: "Cash and savings", exact: true }).locator(".calm-metric-value")).toHaveText("$3750.00");
  });
}

async function exportSource(page: Page) {
  await navigateOwner(page, "Settings", "Import / Export");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await pending;
  return readFile((await download.path())!, "utf8");
}

for (const width of [1440, 390]) test(`Overview mortgage setup distinguishes retained stale graph from missing graph at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await loadHistoricalOverview(page);
  await expect(forecastStatus(page)).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  const original = await exportSource(page);
  await clickFinancialDestination(page, "Debt");
  const payments = page.getByRole("group", { name: "Example mortgage", exact: true }).getByLabel("Number of monthly payments", { exact: true });
  const mortgageDetails = payments.locator("xpath=ancestor::details[1]");
  if (await mortgageDetails.count() && await mortgageDetails.getAttribute("open") === null) await mortgageDetails.locator(":scope > summary").click();
  await payments.fill("");
  await clickFinancialDestination(page, "Overview");
  const correction = page.getByRole("alert", { name: "Priority correction", exact: true });
  await expect(correction).toContainText("original payment count from the dated contract");
  await expect(correction.getByRole("button")).toHaveCount(1);
  await expect(page.locator(".chart-freshness")).toContainText("Out of date");
  await expect(page.locator(".calm-outlook svg.recharts-surface")).toBeVisible();
  await correction.getByRole("button", { name: "Review setup", exact: true }).click();
  await expect(payments).toBeFocused();
  // Import deliberately clears the retained result and session-only setup.
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-mortgage-recovery.json", mimeType: "application/json", buffer: Buffer.from(original) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  for (const [problem, field, choice] of [
    ["Income receiving account", "Income receiving account", "Everyday checking"],
    ["Investment owner", "Investment owner", "Taylor Example"],
    ["Debt owner", "Debt owner", "Taylor Example"],
  ]) {
    await clickFinancialDestination(page, "Overview");
    await expect(correction).toContainText(problem);
    await correction.getByRole("button", { name: "Review setup", exact: true }).click();
    const control = page.getByRole("combobox", { name: field, exact: true });
    await expect(control).toBeFocused();
    await control.selectOption({ label: choice });
  }
  await clickFinancialDestination(page, "Overview");
  await expect(forecastStatus(page)).toHaveAttribute("data-lifecycle", "idle");
  await expect(page.locator(".calm-outlook svg")).toHaveCount(0);
  await expect(correction).toContainText("Example mortgage: Enter the first monthly payment date.");
  await expect(correction.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Your finances today", exact: true }).getByRole("article")).toHaveCount(3);
  await correction.getByRole("button", { name: "Review setup", exact: true }).click();
  await expect(page.getByRole("group", { name: "Example mortgage", exact: true }).getByLabel("First monthly payment", { exact: true })).toBeFocused();
  expect(await exportSource(page)).toBe(original);
  // exportSource ends on non-Calm Settings. Verify narrow-page geometry on
  // Overview, the route owned by this issue, after completing the recovery.
  await clickFinancialDestination(page, "Overview");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`Overview hierarchy, exact current sources and recorded-only recovery at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  const height = width === 390 ? 844 : 900;
  await page.setViewportSize({ width, height });
  await loadHistoricalOverview(page);
  await expect(forecastStatus(page)).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  const original = await exportSource(page);
  const draft = JSON.parse(original) as PersonalDraft;
  const position = getCurrentPosition(draft, { asOf: "2026-01-01", baseCurrency: "USD" });
  await clickFinancialDestination(page, "Overview");
  const main = page.locator("#main-content");
  await expect(main.locator("h1")).toHaveText("Know where you stand.");
  await expect(main.locator(".calm-action-primary")).toHaveCount(1);
  await expect(main.getByRole("button", { name: "Explore your plan", exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "See monthly cash", exact: true })).toBeVisible();
  await expect(page.locator(".household-summary dl")).toHaveCount(0);
  await expect(main.locator(".compact-blocker")).toHaveCount(0);
  const outlook = page.getByRole("region", { name: "Your money over time", exact: true });
  await expect(outlook.getByRole("figure", { name: "Household financial outlook chart", exact: true })).toBeVisible();
  await expect(outlook.locator(".chart-coverage")).toContainText("No past account history is included.");
  await expect(outlook.locator(".chart-coverage")).not.toContainText("exclusive");
  const forecastRange = outlook.locator(".chart-range");
  await expect(forecastRange).not.toHaveAttribute("open");
  const graphBox = await outlook.boundingBox();
  const headBox = await main.locator(".calm-page-header").boundingBox();
  expect(graphBox!.y).toBeGreaterThan(headBox!.y + headBox!.height);
  expect(graphBox!.y).toBeLessThan(height);
  await expect(forecastStatus(page)).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
  if (await forecastStatus(page).getAttribute("data-lifecycle") === "incomplete") {
    await expect(forecastStatus(page)).toContainText("Partially modeled");
    await expect(forecastStatus(page)).toContainText("after-tax totals may be unavailable");
  }
  const current = page.getByRole("region", { name: "Your finances today", exact: true });
  await expect(current.getByRole("article")).toHaveCount(3);
  for (const [label, value] of [["Cash and savings", position.cash], ["Outstanding debt", position.liabilities], ["Net worth", position.netWorth]] as const) {
    const card = current.getByRole("article", { name: label, exact: true });
    await expect(card.locator(".calm-metric-value")).toHaveText(value?.display ?? "Unavailable");
    await expect(card.locator(".calm-metric-source")).toContainText("as of 2026-01-01");
  }
  const coverage = page.getByText("How this is calculated / data coverage", { exact: true });
  const details = coverage.locator("..");
  await expect(details).not.toHaveAttribute("open");
  await coverage.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("not verified take-home pay or bank deposits");
  await coverage.click();
  await expect(details).not.toHaveAttribute("open");
  await expect(page.locator(".task-readiness")).not.toHaveAttribute("open");
  await expect(forecastStatus(page).getByText("Technical forecast details", { exact: true }).locator("..")).not.toHaveAttribute("open");
  await expect(page.getByText("More about your finances · Current position details", { exact: true }).locator("..")).not.toHaveAttribute("open");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const primary = main.getByRole("button", { name: "Explore your plan", exact: true });
  expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await primary.click();
  await expect(page.getByRole("heading", { name: "Your current plan", exact: true })).toBeVisible();
  await expect(main).toBeFocused();
  expect(await exportSource(page)).toBe(original);

  // Unapplied session setup must mark the retained chart out of date without
  // changing the recorded current position or presenting the old result as ready.
  await navigateOwner(page, "Plan", "Current Plan");
  await openFinancialSection(page, "Tax payments & refunds");
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption("");
  await clickFinancialDestination(page, "Overview");
  await expect(forecastStatus(page)).toContainText("Update needed");
  await expect(forecastStatus(page)).toContainText("Old result");
  await expect(outlook.locator(".chart-freshness")).toContainText("Out of date");
  await expect(forecastRange).not.toHaveAttribute("open");
  await outlook.locator(".chart-control-details > summary").click();
  await forecastRange.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await expect(forecastRange).toHaveAttribute("open", "");
  await expect(forecastRange).toContainText("these boundaries belong to the retained forecast");
  await expect(forecastRange).toContainText("[start, end)");
  await forecastRange.locator(":scope > summary").click();
  await expect(current.getByRole("article", { name: "Cash and savings", exact: true }).locator(".calm-metric-value")).toHaveText(position.cash?.display ?? "Unavailable");
  await expect(page.getByRole("alert", { name: "Priority correction", exact: true })).toHaveCount(1);
  await navigateOwner(page, "Settings", "Import / Export");

  // Import clears only session forecast choices. Known source facts remain useful.
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-overview.json", mimeType: "application/json", buffer: Buffer.from(original) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await clickFinancialDestination(page, "Overview");
  await expect(forecastStatus(page)).toHaveAttribute("data-lifecycle", "idle");
  await expect(page.getByRole("alert", { name: "Priority correction", exact: true })).toHaveCount(1);
  await expect(page.getByRole("alert", { name: "Priority correction", exact: true }).getByRole("button")).toHaveCount(1);
  await expect(outlook.getByRole("figure")).toHaveCount(0);
  await expect(current.getByRole("article", { name: "Cash and savings", exact: true }).locator(".calm-metric-value")).toHaveText(position.cash?.display ?? "Unavailable");
  // This fixture loses its session-only income receiving account on import.
  // The recovery belongs to Income, where the missing source route is authored.
  await expect(page.getByRole("alert", { name: "Priority correction", exact: true })).toContainText("Income receiving account");
  await page.getByRole("alert", { name: "Priority correction", exact: true }).getByRole("button", { name: "Review setup", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Cash sections", exact: true }).getByRole("button", { name: "Income", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Income deposit routing", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Income receiving account", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
