import { expect, type Page } from "@playwright/test";

/** Reveal the one authoritative action owner, never click hidden rail controls. */
export async function showStatusActions(page: Page) {
  const more = page.getByRole("button", { name: "More", exact: true });
  if (await more.isVisible() && await more.getAttribute("aria-expanded") !== "true") await more.click();
  const actions = page.getByRole("region", { name: "Status & Actions", exact: true });
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("status", { name: "Household forecast status", exact: true })).toHaveCount(1);
  return actions;
}

export async function openFinancialSection(page: Page, title: string) {
  // Attention text may follow the owned title. Never query an inaccessible
  // child region to find its collapsed parent.
  const summary = page.locator(".financial-section > summary").filter({ hasText: title }).first();
  await expect(summary).toBeVisible();
  if (await summary.locator("..").getAttribute("open") === null) await summary.click({ timeout: 10_000 });
  await expect(summary.locator("..")).toHaveAttribute("open", "");
}

export async function expectForecastWindow(page: Page, start: string, end: string, periods: number) {
  const more = page.getByRole("button", { name: "More", exact: true });
  const opened = await more.isVisible() && await more.getAttribute("aria-expanded") !== "true";
  await showStatusActions(page);
  const status = page.getByRole("status", { name: "Household forecast status", exact: true });
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/, { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-requested-start", start);
  await expect(status).toHaveAttribute("data-requested-end", end);
  await expect(status).toHaveAttribute("data-modeled-periods", String(periods));
  await expect(status).toHaveAttribute("data-reached-through", `${end}T00:00:00.000Z`);
  const fingerprint = await status.getAttribute("data-fingerprint");
  expect(fingerprint).toBeTruthy();
  await expect(status).toHaveAttribute("data-result-fingerprint", fingerprint!);
  if (opened) await more.click();
}

/** Follow the same visible destination/More navigation at both supported sizes. */
export async function clickFinancialDestination(page: Page, label: string) {
  const more = page.getByRole("button", { name: "More", exact: true });
  if (await more.isVisible() && await more.getAttribute("aria-expanded") === "true") await more.click();
  const destination = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: label, exact: true });
  if (await destination.isVisible()) {
    await expect(destination).toBeEnabled();
    await destination.click({ timeout: 10_000 });
    await expect(destination).toHaveAttribute("aria-current", "page");
    return;
  }
  await expect(more).toBeVisible();
  await more.click({ timeout: 10_000 });
  const menu = page.getByRole("navigation", { name: "More destinations" });
  const target = menu.getByRole("button", { name: label, exact: true });
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  await target.click({ timeout: 10_000 });
  await expect(menu).toHaveCount(0);
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
  await showStatusActions(page);
  const status = page.getByRole("status", { name: "Household forecast status" });
  const disclosure = status.locator(".context-disclosure");
  if (await disclosure.getAttribute("open") === null) await disclosure.locator(":scope > summary").click();
  const guidance = status.locator(".forecast-guidance");
  if (await guidance.getAttribute("open") === null) await guidance.locator(":scope > summary").click();
  const more = guidance.getByText(/^Review \d+ more scoped limitations$/);
  if (await more.count() && await more.locator("..").getAttribute("open") === null) await more.click();
}
