import type { Page } from "@playwright/test";

/** Follow the same visible destination/More navigation at both supported sizes. */
export async function clickFinancialDestination(page: Page, label: string) {
  const destination = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: label, exact: true });
  if (await destination.isVisible()) { await destination.click(); return; }
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("navigation", { name: "More destinations" }).getByRole("button", { name: label, exact: true }).click();
}

export async function navigateOwner(page: Page, owner: string, section: string) {
  const label = owner === "Money" ? "Cash" : owner === "Plan" ? "Planning"
    : owner === "Net Worth" ? (["Real Estate", "Other Assets", "Debt"].includes(section) ? section : "Investing") : owner;
  if (owner === "Settings") await page.getByRole("button", { name: "Settings", exact: true }).click();
  else await clickFinancialDestination(page, label);
  if (!["Real Estate", "Other Assets", "Debt"].includes(section)) {
    await page.locator(".subnav").getByRole("button", { name: section, exact: true }).click();
  }
}

export async function showReadiness(page: Page) {
  const panel = page.locator(".task-readiness");
  if (await panel.getAttribute("open") === null) await panel.locator(":scope > summary").click();
}

export async function showForecastLimitations(page: Page) {
  const status = page.getByRole("status", { name: "Household forecast status" });
  const guidance = status.locator(".forecast-guidance");
  if (await guidance.getAttribute("open") === null) await guidance.locator(":scope > summary").click();
  const more = guidance.getByText(/^Review \d+ more scoped limitations$/);
  if (await more.count() && await more.locator("..").getAttribute("open") === null) await more.click();
}
