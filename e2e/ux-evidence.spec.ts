import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Manual, external-to-Codex UX evidence. Intentionally skipped in ordinary CI.
 * Use the dedicated workflow_dispatch on the branch/head being reviewed.
 * Never load a real/imported/user-saved household; fresh context + synthetic example only.
 */
test.skip(process.env.PFM_UX_EVIDENCE !== "1", "Only run via the manually triggered UX evidence workflow.");

const navigate = async (page: Page, area: string, section: string) => {
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: area, exact: true }).click();
  await page.getByRole("navigation", { name: `${area} sections` })
    .getByRole("button", { name: section, exact: true }).click();
};

test("synthetic account, income and forecast UX at desktop and narrow viewport", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  page.on("pageerror", error => consoleErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto("/");
  // Fails closed rather than screenshot an existing household or an imported financial model.
  await expect(page.getByRole("button", { name: "Use synthetic example", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  await expect(page.getByRole("status", { name: "Household forecast status" })).toBeVisible();

  const capture = async (label: string, width: number) => {
    const path = testInfo.outputPath(`${label}-${width}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach(`${label}-${width}`, { path, contentType: "image/png" });
  };

  // One bounded, read-only capture per supported viewport and view; no data mutation or broad test replay.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });

    await navigate(page, "Overview", "How am I doing?");
    await capture("01-overview", width);

    await navigate(page, "Money", "Income");
    await capture("02-income", width);
    await page.locator("button.card-main").filter({ hasText: "Example salary" }).click();
    const editor = page.getByRole("dialog", { name: "Edit Income", exact: true });
    await expect(editor).toBeVisible();
    await capture("03-income-edit", width);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();

    await navigate(page, "Net Worth", "Investments & retirement");
    await capture("04-investments", width);

    await navigate(page, "Net Worth", "Debt");
    await capture("05-debt", width);

    await navigate(page, "Plan", "Current Plan");
    await capture("06-current-plan", width);
  }

  expect(consoleErrors, "No unexpected browser exceptions during synthetic review").toEqual([]);
});
