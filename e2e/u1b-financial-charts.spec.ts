import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addPersonalObject, createEmptyPersonalDraft, exportPersonalModelJson } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";

const cashTitle = "Total modeled cash (including cash in investment accounts)";
async function exportedBytes(page: Page) {
  await navigateOwner(page, "Settings", "Import / Export");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}

for (const width of [1440, 390]) {
  test(`V1–V3 exact period controls preserve the populated household at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
    const status = page.getByRole("status", { name: "Household forecast status" });
    await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/, { timeout: 30_000 });
    const before = await exportedBytes(page);
    await clickFinancialDestination(page, "Overview");
    const wealth = page.getByRole("figure", { name: "Household financial outlook chart", exact: true });
    await expect(wealth.getByLabel("Period grouping", { exact: true })).toHaveValue("annual");
    await expect(wealth.getByRole("group", { name: "Assets, liabilities and net worth legend" }).getByRole("button")).toHaveCount(3);
    await expect(wealth).toContainText("No observed history loaded");
    await expect(wealth).toContainText("snapshot, separate from projected periods");
    const request = await status.getAttribute("data-request-id");
    await wealth.getByLabel("Period grouping", { exact: true }).selectOption("monthly");
    await wealth.getByLabel("Monthly range starting", { exact: true }).selectOption({ index: 1 });
    const selected = wealth.getByLabel("Selected projected period", { exact: true });
    await selected.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(wealth.getByRole("status", { name: /exact selected period/ })).toContainText("2026-03-01");
    const legend = wealth.getByRole("button", { name: "Total assets", exact: true });
    await legend.focus(); await page.keyboard.press("Enter");
    await expect(legend).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(legend).toHaveAttribute("aria-pressed", "true");
    await wealth.locator(".chart-table > summary").focus();
    await page.keyboard.press("Enter");
    const data = wealth.getByRole("region", { name: "Assets, liabilities and net worth exact data" });
    await expect(data).toBeVisible();
    await data.focus(); await expect(data).toBeFocused();
    expect(await data.locator("tbody tr").count()).toBeLessThanOrEqual(12);
    await expect(status).toHaveAttribute("data-request-id", request!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await clickFinancialDestination(page, "Cash");
    const cash = page.getByRole("figure", { name: cashTitle, exact: true });
    const statements = page.getByRole("figure", { name: "Modeled statement income versus expenses", exact: true });
    await expect(cash.getByLabel("Period grouping", { exact: true })).toHaveValue("annual");
    await expect(cash).toContainText("right axis: signed annual balance change");
    await expect(statements.getByLabel("Period grouping", { exact: true })).toHaveValue("monthly");
    await expect(statements).toContainText("not bank receipts/disbursements or disposable wages");
    await expect(statements.locator(".recharts-bar-rectangle").first()).toBeVisible();
    const cashBox = await cash.boundingBox(), statementsBox = await statements.boundingBox();
    expect(cashBox!.y).toBeLessThan(statementsBox!.y);
    await expect(cash).toContainText("Incomplete");
    await statements.locator(".chart-table > summary").click();
    await expect(statements.getByRole("table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await exportedBytes(page)).toBe(before);

    // A setup change retains old results but must visibly invalidate their currency.
    await navigateOwner(page, "Money", "Income");
    await page.getByLabel("Income receiving account", { exact: true }).selectOption("");
    await clickFinancialDestination(page, "Overview");
    await expect(page.locator(".chart-freshness")).toContainText("Out of date");
    await expect(wealth).toContainText("out of date");
    expect(errors).toEqual([]);
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
