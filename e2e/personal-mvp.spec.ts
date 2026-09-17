import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
  await expect(page.getByText(/edits stay in memory until saved/i)).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toContainText("OverviewMoneyNet WorthPlanSettings");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Model Settings", exact: true })
    .click();
  await expect(page.getByLabel("Simulation end")).toHaveValue("2036-01-01");
});

test("session settings drive horizons and block invalid run ordering", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Model Settings", exact: true })
    .click();
  await page.getByLabel("As of").fill("2026-02-01");
  await page.getByLabel("Data cutoff").fill("2026-02-01");
  await page.getByLabel("Simulation end").fill("2026-04-01");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: /Run cash flow forecast/ }).click();
  await expect(page.getByText("As of 2026-02-01T00:00:00.000Z")).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Detailed cash-flow forecast" })
      .locator("tbody tr"),
  ).toHaveCount(3);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Model Settings", exact: true })
    .click();
  await page.getByLabel("Simulation end").fill("2026-01-01");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: /Run cash flow forecast/ }).click();
  await expect(
    page.getByText("Simulation start must be before simulation end."),
  ).toBeVisible();
});

test("Money cash-flow run uses its explicit scope after Plan selects investments", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByLabel("Forecast scope").selectOption("investments");
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Cash Flow", exact: true }).click();
  await page.getByRole("button", { name: "Run cash-flow forecast" }).click();
  await expect(
    page.getByRole("table", { name: "Detailed cash-flow forecast" }),
  ).toBeVisible();
  await expect(
    page.getByText("Forecast unavailable for this model"),
  ).toHaveCount(0);
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
  await expect(
    page.getByRole("button", { name: /Updated example salary/ }),
  ).toBeVisible();

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
  await expect(
    page.getByRole("button", { name: /Example mortgage/ }),
  ).toBeVisible();
});

test("Debt runs the explicitly configured mortgage surface without classifying funding stress as partial coverage", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: /Everyday checking/ }).click();
  await page.getByLabel("Balance").fill("100");
  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await page.getByLabel("Execution owner").selectOption({ label: "Taylor Example" });
  await page.getByLabel("Payment anchor").fill("2022-02-01");
  await page.getByLabel("Total payment count").fill("360");
  await page.getByLabel("Funding account").selectOption({ label: "Everyday checking" });
  await page.getByLabel("Settlement priority").fill("1");
  await page.getByRole("button", { name: "Run liability forecast" }).click();
  await expect(page.getByRole("table", { name: "Detailed liability forecast" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Detailed liability forecast" }).locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Detailed liability forecast" })).toContainText("Contractual payment");
  await expect(page.getByRole("table", { name: "Detailed liability forecast" })).toContainText("Interest");
  await expect(page.getByRole("table", { name: "Detailed liability forecast" })).toContainText("Scheduled principal");
  await expect(page.getByRole("table", { name: "Detailed liability forecast" })).toContainText("Ending principal");
  await expect(page.getByRole("table", { name: "Detailed liability forecast" })).toContainText("Required funding");
  await page.getByText("Explain").first().click();
  await expect(page.locator("code").first()).toContainText("compiler:canonical:Liability");
  await expect(page.getByText("Forecast diagnostics")).toBeVisible();
  await expect(page.getByText(/unfunded \(required debt service\)/).first()).toBeVisible();
  await expect(page.getByText("Debt coverage is partial where diagnostics are listed")).toHaveCount(0);
});

test("Debt execution settings are session-only and clear on model import", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await page.getByLabel("Execution owner").selectOption({ label: "Taylor Example" });
  await page.getByLabel("Payment anchor").fill("2022-02-01");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await downloadPromise;
  await page.locator('input[type="file"]').setInputFiles((await download.path())!);
  await page.getByRole("button", { name: "Import into session" }).click();
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(page.getByLabel("Execution owner")).toHaveValue("");
  await expect(page.getByLabel("Payment anchor")).toHaveValue("");
});

test("Investments execute only after explicit owner selection and owner state clears on import", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByLabel("Forecast scope").selectOption("investments");
  await page
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await page.getByRole("button", { name: "Run investments forecast" }).click();
  await expect(
    page.getByRole("table", { name: "Detailed investment forecast" }),
  ).toBeVisible();
  await expect(
    page.getByText("Forecast unavailable for this model"),
  ).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await downloadPromise;
  await page
    .locator('input[type="file"]')
    .setInputFiles((await download.path())!);
  await page.getByRole("button", { name: "Import into session" }).click();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByLabel("Forecast scope").selectOption("investments");
  await expect(page.getByLabel("Execution owner")).toHaveValue("");
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
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
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
  for (const starter of ["Retire earlier/later", "Earn more/less", "Spend more/less", "Change investment returns", "Pay debt faster", "Change funding behavior"])
    await expect(page.getByRole("heading", { name: starter })).toBeVisible();
  await page.getByLabel("Exact effective annual rate").fill("0.0500");
  await page.getByLabel("Income target").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await expect(page.getByText("Active scope: cash flow")).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Current plan, alternative/ }),
  ).toBeVisible();
  await expect(page.getByText(/income growth/)).toBeVisible();
  await page.getByText("Explain").first().click();
  await expect(page.locator("code").first()).toContainText(
    "salary-growth-assumption",
  );
});

test("manual local save survives reload and explicit load without restoring execution state", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  await page.getByLabel("Source / name").fill("Recognizable saved salary");
  await page.getByRole("button", { name: "Close editor" }).click();

  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await page.getByLabel("Execution owner").selectOption({ label: "Taylor Example" });
  await page.getByLabel("Payment anchor").fill("2022-02-01");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByLabel("Forecast scope").selectOption("investments");
  await page.getByLabel("Execution owner").selectOption({ label: "Taylor Example" });
  await page.getByRole("button", { name: "Run investments forecast" }).click();
  await expect(page.getByRole("table", { name: "Detailed investment forecast" })).toBeVisible();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Income target").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await expect(page.getByRole("table", { name: /Current plan, alternative/ })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Canonical model saved to this browser")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Load saved model" }).click();
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(page.getByRole("button", { name: /Recognizable saved salary/ })).toBeVisible();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByLabel("Forecast scope").selectOption("investments");
  await expect(page.getByLabel("Execution owner")).toHaveValue("");
  await expect(page.getByRole("table", { name: "Detailed investment forecast" })).toHaveCount(0);
  await page.getByRole("button", { name: "Compare Plans", exact: true }).click();
  await expect(page.getByText("No executable comparison is available yet.")).toBeVisible();
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(page.getByLabel("Execution owner")).toHaveValue("");
  await expect(page.getByLabel("Payment anchor")).toHaveValue("");
});

test("current and exact saved recovery exports match, and confirmed delete removes only local data", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();

  const currentDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const current = await currentDownload;
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export saved backup", exact: true }).click();
  const backup = await backupDownload;
  expect(await readFile((await current.path())!, "utf8")).toBe(await readFile((await backup.path())!, "utf8"));

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete saved local model", exact: true }).click();
  await expect(page.getByText(/open model is unchanged/i)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Load saved model" })).toHaveCount(0);
});
