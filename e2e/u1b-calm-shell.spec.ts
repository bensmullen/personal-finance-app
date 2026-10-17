import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";

async function exportedModel(page: Page) {
  await navigateOwner(page, "Settings", "Import / Export");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}

for (const width of [1440, 390]) test(`Calm destinations, source repair and Cancel at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  const status = page.getByRole("status", { name: "Household forecast status" });
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  const before = await exportedModel(page);
  if (width === 390) {
    const more = page.getByRole("button", { name: "More", exact: true });
    await more.click();
    const destinations = page.getByRole("navigation", { name: "More destinations" });
    for (const label of ["Real Estate", "Other Assets", "Debt", "Household & People", "Save / Return", "Income", "Spending", "Accounts", "Life Events", "Technical Details"]) {
      await expect(destinations.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute("aria-expanded", "false");
  }

  for (const label of ["Overview", "Cash", "Investing", "Real Estate", "Other Assets", "Debt", "Planning"]) {
    await clickFinancialDestination(page, label);
    const summary = page.getByRole("region", { name: "Household current summary" });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("as of 2026-01-01");
    const box = await summary.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(900);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect(page.locator(".task-readiness")).not.toHaveAttribute("open");
    await expect(status.locator("[data-diagnostic-root]:visible")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // This is the same canonical entity editor, kept over its originating month.
  await clickFinancialDestination(page, "Cash");
  const paycheck = page.getByRole("region", { name: "Your Paycheck", exact: true });
  const month = paycheck.getByLabel("paycheck forecast month", { exact: true });
  await month.selectOption("2026-02");
  const salary = paycheck.getByRole("button", { name: "Example salary", exact: true });
  await salary.click();
  const income = page.getByRole("dialog", { name: "Edit Income", exact: true });
  const amount = income.getByLabel("Amount", { exact: true });
  const original = await amount.inputValue();
  await amount.fill("12345.67");
  await income.getByRole("button", { name: "Cancel", exact: true }).click();
  await income.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(income).toHaveCount(0);
  await expect(month).toHaveValue("2026-02");
  await expect(salary).toBeFocused();
  await salary.click();
  await expect(amount).toHaveValue(original);
  await income.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await exportedModel(page)).toEqual(before);

  await clickFinancialDestination(page, "Real Estate");
  const property = page.getByRole("region", { name: "Real Estate outlook" });
  const editHome = property.getByRole("button", { name: "Edit Example home", exact: true });
  await editHome.click();
  const asset = page.getByRole("dialog", { name: "Edit Asset", exact: true });
  await expect(asset.getByLabel("Name", { exact: true })).toBeFocused();
  await asset.getByLabel("Name", { exact: true }).fill("Reviewed example home");
  await asset.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(property).toContainText("Reviewed example home");
  await navigateOwner(page, "Net Worth", "Property & other assets");
  await expect(page.locator("button.card-main").filter({ hasText: "Reviewed example home" })).toBeVisible();
  const after = await exportedModel(page);
  const expected = structuredClone(before);
  expected.objects.Asset.find((item: { name: string }) => item.name === "Example home").name = "Reviewed example home";
  expect(after).toEqual(expected);

  // Missing assets/holdings cannot turn into generated chart data.
  const empty = structuredClone(before);
  empty.objects.Investment = [];
  empty.objects.Asset = [];
  await page.locator('input[type="file"]').setInputFiles({ name: "empty-synthetic-assets.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(empty)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await clickFinancialDestination(page, "Investing");
  await expect(page.getByRole("region", { name: "Investing outlook" })).toContainText("No investment holdings recorded");
  await clickFinancialDestination(page, "Other Assets");
  await expect(page.getByRole("region", { name: "Other Assets outlook" })).toContainText("No other assets recorded · no chart data");
  expect(errors).toEqual([]);
});
