import { expect, test } from "@playwright/test";
import { clickFinancialDestination } from "./navigation.js";

for (const width of [1440, 390]) {
  test(`Planning sourced dates, honest V6 gap and single retirement owner at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
    await clickFinancialDestination(page, "Planning");
    const outlook = page.getByRole("region", { name: "Planning outlook", exact: true });
    const composition = outlook.getByRole("figure", { name: "Retirement income composition", exact: true });
    await expect(composition).toHaveAttribute("data-source-status", "unavailable");
    await expect(composition.getByRole("heading", { name: "Retirement source breakdown unavailable" })).toBeVisible();
    await expect(composition.locator("svg")).toHaveCount(0);
    const timeline = outlook.getByRole("region", { name: "Your planning timeline", exact: true });
    await expect(timeline).toContainText("Confirmed retirement event");
    await expect(timeline).toContainText("cutoff is not a death date");
    await timeline.getByText("Compare adults’ age-90 dates", { exact: true }).click();
    const adults = timeline.getByRole("checkbox");
    expect(await adults.count()).toBeGreaterThan(0);
    await adults.first().check();
    await expect(timeline).toContainText("Monthly exclusive end:");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await outlook.getByRole("button", { name: "Review retirement dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Saved retirement plan", exact: true })).toBeVisible();
  });

  test(`Planning keyboard disclosure and uncomputed resources at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
    await clickFinancialDestination(page, "Planning");
    const gap = page.getByRole("figure", { name: "Retirement income composition", exact: true });
    const details = gap.locator(".cash-chart-details");
    await expect(details).not.toHaveAttribute("open");
    await details.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("missing categories are unavailable, never zero");
    await expect(details).toContainText("identity-safe per-period");
  });
}
