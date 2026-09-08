import { expect, test } from "@playwright/test";

const loadExample = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example" }).click();
  await expect(
    page.getByRole("heading", { name: "How am I doing?" }),
  ).toBeVisible();
};

test("guided setup reaches the Personal-MVP overview", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Guided setup · 1 of 7")).toBeVisible();
  for (let step = 0; step < 6; step += 1)
    await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(
    page.getByText("Your starting financial picture is ready"),
  ).toBeVisible();
  await expect(page.getByText(/Session only/)).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toContainText("OverviewMoneyNet WorthPlanSettings");
});

test("money and net-worth workflows update friendly editors and forecast", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  await page.getByLabel("Source / name").fill("Updated example salary");
  await page.getByRole("button", { name: "Close editor" }).click();
  await expect(page.getByRole("button", { name: /Updated example salary/ })).toBeVisible();

  await page.getByRole("button", { name: "Spending", exact: true }).click();
  await page.getByRole("button", { name: /Living costs/ }).click();
  await page.getByLabel("Amount").fill("20000.00");
  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Cash Flow", exact: true }).click();
  await page.getByRole("button", { name: "Run cash-flow forecast" }).click();
  await expect(
    page.getByText("Financial outcome · Modeled stress"),
  ).toBeVisible();
  await expect(page.getByText("No observed history loaded")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Detailed cash-flow forecast" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What do I own and owe?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(page.getByRole("button", { name: /Example mortgage/ })).toBeVisible();
});

test("model portability and deterministic what-if comparison stay explicit", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export model", exact: true }).click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(exportedPath).toBeTruthy();
  await page.locator('input[type="file"]').setInputFiles(exportedPath!);
  await expect(page.getByText("Compatible and ready to import")).toBeVisible();
  await page.getByRole("button", { name: "Import into session" }).click();
  await expect(
    page.getByText("Model imported into this session"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByRole("button", { name: "Compare this plan" }).click();
  await expect(page.getByText("Active scope: cash flow")).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Current plan, alternative/ }),
  ).toBeVisible();
  await expect(page.getByText(/income growth/)).toBeVisible();
  await page.getByText("Explain").first().click();
  await expect(page.locator("code").first()).toContainText("salary-growth-assumption");
});
