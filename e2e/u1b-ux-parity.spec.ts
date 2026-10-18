import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addPersonalObject, createEmptyPersonalDraft, exportPersonalModelJson, getCurrentPosition, type PersonalDraft } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";

const forecastStatus = (page: Page) => page.getByRole("status", { name: "Household forecast status", exact: true });

// Independent first-screen checks: failures in the longer interaction journey
// below must not prevent either the supported or recorded-only layout checks.
for (const width of [1440, 390]) {
  test(`Overview supported plot first-screen layout at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
    await expect(forecastStatus(page)).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
    await expect(forecastStatus(page)).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
    const chart = page.getByRole("figure", { name: "Household financial outlook chart", exact: true });
    await expect(chart.locator(".recharts-responsive-container svg.recharts-surface")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const plot = await chart.locator(".recharts-responsive-container svg.recharts-surface").boundingBox();
    expect(plot!.height).toBeGreaterThan(0);
    if (width === 1440) {
      expect(plot!.y).toBeGreaterThan(0);
      expect(plot!.y).toBeLessThan(900);
      const setup = await page.locator(".task-readiness").boundingBox();
      expect(setup!.y).toBeGreaterThan(plot!.y + plot!.height);
    }
    await expect(chart).toContainText("Forecast, not account history");
    await expect(chart).not.toContainText("Deterministic projection");
    await expect(page.locator(".chart-range")).not.toHaveAttribute("open");
    await expect(page.locator(".task-readiness")).not.toHaveAttribute("open");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`Overview H04 recorded-only cards precede recovery and empty forecast at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
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
    expect(cards!.y + cards!.height).toBeLessThanOrEqual(blocker!.y);
    expect(blocker!.y + blocker!.height).toBeLessThan(empty!.y);
    if (width === 1440) {
      expect(cards!.y).toBeGreaterThan(0);
      expect(cards!.y + cards!.height).toBeLessThan(900);
      expect(blocker!.y + blocker!.height).toBeLessThan(900);
    }
    expect(await current.evaluate(element => !!(element.compareDocumentPosition(document.querySelector(".calm-empty")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
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

for (const width of [1440, 390]) test(`Overview hierarchy, exact current sources and recorded-only recovery at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  const height = width === 390 ? 844 : 900;
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  await expect(forecastStatus(page)).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  const original = await exportSource(page);
  const draft = JSON.parse(original) as PersonalDraft;
  const position = getCurrentPosition(draft, { asOf: "2026-01-01", baseCurrency: "USD" });
  await clickFinancialDestination(page, "Overview");
  const main = page.locator("#main-content");
  await expect(main.locator("h1")).toHaveText("How am I doing?");
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
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  const taxDisclosure = taxes.locator("xpath=ancestor::details[1]");
  if (await taxDisclosure.getAttribute("open") === null) await taxDisclosure.locator(":scope > summary").click();
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption("");
  await clickFinancialDestination(page, "Overview");
  await expect(forecastStatus(page)).toContainText("Update needed");
  await expect(forecastStatus(page)).toContainText("Old result");
  await expect(outlook.locator(".chart-freshness")).toContainText("Out of date");
  await expect(forecastRange).not.toHaveAttribute("open");
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
