import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  createSyntheticPersonalDraft,
  exportPersonalModelJson,
} from "../src/application/personalMvp.js";

const loadExample = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example" }).click();
  await expect(
    page.getByRole("heading", { name: "How am I doing?" }),
  ).toBeVisible();
};

const importDraft = async (
  page: import("@playwright/test").Page,
  draft: unknown,
) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportPersonalModelJson(draft as never)),
  });
  await page.getByRole("button", { name: "Import into session" }).click();
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
  await expect(
    page.getByText(/edits stay in memory until saved/i),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toContainText("OverviewMoneyNet WorthPlanSettings");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Model Settings", exact: true })
    .click();
  await expect(page.getByLabel("Simulation end")).toHaveValue("2036-01-01");
});

test("Golden household runs, compares, explains, and distinguishes modeled liquidity stress", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Run household forecast" }).click();
  const forecast = page.getByRole("table", {
    name: "Reconciled household forecast",
  });
  await expect(forecast).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Completed through 2036-01-01")).toBeVisible();
  await expect(forecast.locator("tbody tr")).toHaveCount(120);
  await forecast.getByText("Explain").first().click();
  await expect(
    page
      .getByText(/Source records carried by this result:.*Example salary/)
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        /Assumptions referenced by the calculation trace: Salary growth/,
      )
      .first(),
  ).toBeVisible();
  await expect(forecast.locator("code").first()).toContainText(
    "compiler:canonical:Income",
  );

  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await expect(page.getByText("309,330.29").first()).toBeVisible();
  await expect(page.getByText("535000", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Model Settings", exact: true })
    .click();
  await page.getByLabel("Simulation end").fill("2027-01-01");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Investment target").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare investment return" }).click();
  const lower = page.getByRole("table", { name: "What-if alternative household comparison" });
  await expect(lower).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/investment return/).first()).toBeVisible();
  await lower.getByText("Explain").last().click();
  await expect(lower.locator("code").last()).not.toBeEmpty();

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Retirement income").selectOption({ index: 1 });
  await page
    .getByLabel("Canonical retirement event")
    .selectOption({ label: "Planned retirement" });
  await page.getByLabel("New retirement date").fill("2026-02-01");
  await page.getByRole("button", { name: "Compare retirement date" }).click();
  const retirement = page.getByRole("table", {
    name: "What-if alternative household comparison",
  });
  await expect(retirement).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/retirement date/i).first()).toBeVisible();
  await expect(
    page.getByText("Financial outcome · Modeled liquidity stress"),
  ).toBeVisible();
  await retirement.getByText("Explain").last().click();
  await expect(retirement.locator("code").last()).not.toBeEmpty();
});

test("canonical edits invalidate a displayed household forecast", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Model Settings", exact: true })
    .click();
  await page.getByLabel("Simulation end").fill("2026-02-01");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Run household forecast" }).click();
  await expect(
    page.getByRole("table", { name: "Reconciled household forecast" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  await page.getByLabel("Amount").fill("9100.00");
  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Reconciled household forecast" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Run the reconciled household forecast"),
  ).toBeVisible();
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
    page.getByText("Simulation start must be before simulation end.").first(),
  ).toBeVisible();
});

test("Money cash-flow run uses its explicit scope after Plan selects investments", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByLabel("Forecast scope").selectOption("investments");
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Cash Flow", exact: true }).click();
  await page.getByRole("button", { name: "Run cash-flow forecast" }).click();
  await expect(
    page.getByRole("table", { name: "Reconciled household forecast" }),
  ).toBeVisible();
  await expect(
    page.getByText("Forecast unavailable for this model"),
  ).toHaveCount(0);
});

test("money and net-worth workflows update friendly editors and forecast", async ({
  page,
}) => {
  test.setTimeout(60_000);
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
    page.getByText("Financial outcome · Modeled liquidity stress"),
  ).toBeVisible();
  await expect(page.getByText("No observed history loaded")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Reconciled household forecast" }),
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

test("Debt runs the explicitly configured mortgage surface without classifying funding stress as partial coverage", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: /Everyday checking/ }).click();
  await page.getByLabel("Balance").fill("100");
  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await page
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await page.getByLabel("Payment anchor").fill("2022-02-01");
  await page.getByLabel("Total payment count").fill("360");
  await page
    .getByLabel("Funding account")
    .selectOption({ label: "Everyday checking" });
  await page.getByLabel("Settlement priority").fill("1");
  await page.getByRole("button", { name: "Run liability forecast" }).click();
  await expect(
    page.getByRole("table", { name: "Detailed liability forecast" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Detailed liability forecast" })
      .locator("tbody tr")
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Detailed liability forecast" }),
  ).toContainText("Contractual payment");
  await expect(
    page.getByRole("table", { name: "Detailed liability forecast" }),
  ).toContainText("Interest");
  await expect(
    page.getByRole("table", { name: "Detailed liability forecast" }),
  ).toContainText("Scheduled principal");
  await expect(
    page.getByRole("table", { name: "Detailed liability forecast" }),
  ).toContainText("Ending principal");
  await expect(
    page.getByRole("table", { name: "Detailed liability forecast" }),
  ).toContainText("Required funding");
  await page.getByText("Explain").first().click();
  await expect(page.locator("code").first()).toContainText(
    "compiler:canonical:Liability",
  );
  await expect(page.getByText("Forecast diagnostics")).toBeVisible();
  await expect(
    page.getByText(/unfunded \(required debt service\)/).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Debt coverage is partial where diagnostics are listed"),
  ).toHaveCount(0);
});

test("Debt execution settings are session-only and clear on model import", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await page
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await page.getByLabel("Payment anchor").fill("2022-02-01");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Export current model", exact: true })
    .click();
  const download = await downloadPromise;
  await page
    .locator('input[type="file"]')
    .setInputFiles((await download.path())!);
  await page.getByRole("button", { name: "Import into session" }).click();
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(page.getByLabel("Execution owner")).toHaveValue("");
  await expect(page.getByLabel("Payment anchor")).toHaveValue("");
});

test("Investments execute only after explicit owner selection and owner state clears on import", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const standalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await standalone.getByLabel("Forecast scope").selectOption("investments");
  await standalone
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await standalone
    .getByRole("button", { name: "Run investments forecast" })
    .click();
  await expect(
    standalone.getByRole("table", { name: "Detailed investment forecast" }),
  ).toBeVisible();
  await expect(
    page.getByText("Forecast unavailable for this model"),
  ).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Export current model", exact: true })
    .click();
  const download = await downloadPromise;
  await page
    .locator('input[type="file"]')
    .setInputFiles((await download.path())!);
  await page.getByRole("button", { name: "Import into session" }).click();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const restoredStandalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await restoredStandalone
    .getByLabel("Forecast scope")
    .selectOption("investments");
  await expect(restoredStandalone.getByLabel("Execution owner")).toHaveValue("");
});

test("model portability and deterministic what-if comparison stay explicit", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  for (const starter of [
    "Retire earlier/later",
    "Earn more/less",
    "Spend more/less",
    "Change investment returns",
    "Pay debt faster",
    "Change funding behavior",
  ])
    await expect(page.getByRole("heading", { name: starter })).toBeVisible();
  await page.getByLabel("Exact effective annual rate").fill("0.0500");
  await page.getByLabel("Income target").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toBeVisible();
  await expect(page.getByText(/income growth/)).toBeVisible();
  await page.getByText("Explain").first().click();
  await expect(page.locator("code").first()).toContainText(
    "salary-growth-assumption",
  );

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export current model", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Compare Plans", exact: true })
    .click();
  await expect(
    page.getByText("No executable comparison is available yet."),
  ).toBeVisible();
});

test("What If executes retirement without mutating the baseline binding", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  const baselineDate = await page.getByLabel("Baseline retirement date").inputValue();
  await expect(page.getByLabel("Baseline retirement income")).not.toHaveValue("");
  await expect(page.getByLabel("Baseline canonical retirement event")).toHaveValue(
    /.+/,
  );
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Retirement income").selectOption({ index: 1 });
  await page
    .getByLabel("Canonical retirement event")
    .selectOption({ label: "Planned retirement" });
  await page.getByLabel("New retirement date").fill("2026-02-01");
  await page.getByRole("button", { name: "Compare retirement date" }).click();
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toBeVisible();
  await expect(page.getByText(/retirement date/i)).toBeVisible();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await expect(page.getByLabel("Baseline retirement income")).not.toHaveValue("");
  await expect(page.getByLabel("Baseline canonical retirement event")).toHaveValue(
    /.+/,
  );
  await expect(page.getByLabel("Baseline retirement date")).toHaveValue(
    baselineDate,
  );
});

test("What If executes deterministic investment return", async ({ page }) => {
  test.setTimeout(120_000);
  const draft = structuredClone(createSyntheticPersonalDraft()) as any;
  const assumptionId = "98000000-0000-4000-8000-000000000001";
  const primitiveId = "98000000-0000-4000-8000-000000000002";
  const brokerageAccountId = "98000000-0000-4000-8000-000000000003";
  const taylorExamplePersonId = "90000000-0000-4000-8000-000000000003";
  draft.objects.Account.push({
    ...draft.objects.Account[0],
    account_id: brokerageAccountId,
    name: "Scenario brokerage",
    account_type: "taxable_brokerage",
    owner_id: taylorExamplePersonId,
    opening_balance: "0.00",
  });
  draft.objects.Assumption.push({
    assumption_id: assumptionId,
    name: "Return",
    category: "market_return",
    value: "0.05",
    unit: "effective annual rate",
    source: "user",
    scenario_id: "90000000-0000-4000-8000-000000000011",
  });
  draft.objects.Scenario[0].assumption_ids.push(assumptionId);
  draft.objects.PrimitiveInstance.push({
    primitive_instance_id: primitiveId,
    primitive_id: "P23",
    input_bindings: { rate: assumptionId },
    parameters: {},
    scenario_id: "90000000-0000-4000-8000-000000000011",
    enabled: true,
  });
  Object.assign(draft.objects.Investment[0], {
    owner_id: taylorExamplePersonId,
    account_id: brokerageAccountId,
    quantity: "10",
    price: "10.00",
    market_value: "100.00",
    expected_return: null,
    volatility: null,
    contribution_model_id: null,
    return_model_id: primitiveId,
    rebalancing_rule_id: null,
  });
  await importDraft(page, draft);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Model Settings", exact: true })
    .click();
  await page.getByLabel("Simulation end").fill("2027-01-01");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  const configuration = page.getByRole("region", {
    name: "Household execution configuration",
  });
  const mortgage = configuration.getByRole("group", {
    name: "Example mortgage",
  });
  await configuration
    .getByLabel("Cash-flow execution account")
    .selectOption({ label: "Everyday checking" });
  await configuration
    .getByLabel("Execution owner")
    .first()
    .selectOption({ label: "Taylor Example" });
  await configuration
    .getByLabel("Execution owner")
    .last()
    .selectOption({ label: "Taylor Example" });
  await mortgage.getByLabel("Payment anchor").fill("2022-02-01");
  await mortgage.getByLabel("Total payment count").fill("360");
  await mortgage
    .getByLabel("Funding account")
    .selectOption({ label: "Everyday checking" });
  await mortgage.getByLabel("Settlement priority").fill("1");
  await configuration
    .getByRole("button", { name: "Apply household execution configuration" })
    .click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Investment target").selectOption({ index: 1 });
  await page.getByLabel("Exact effective annual rate").fill("0.0700");
  await page.getByRole("button", { name: "Compare investment return" }).click();
  await expect(
    page.getByRole("table", { name: "What-if alternative household comparison" }),
  ).toBeVisible();
  await expect(page.getByText(/investment return/i)).toBeVisible();
});

test("What If executes explicit liability extra principal", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Liability target").selectOption({ index: 1 });
  await page.getByLabel("Extra principal amount").fill("not-money");
  await expect(
    page.getByText("Enter an exact decimal amount, such as 100.00."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compare extra principal" }),
  ).toBeDisabled();
  await page.getByLabel("Extra principal amount").fill("100.00");
  await page.getByLabel("Extra principal date").fill("2026-02-01");
  await page
    .getByLabel("Extra principal funding account")
    .selectOption({ label: "Everyday checking" });
  await page.getByRole("button", { name: "Compare extra principal" }).click();
  await expect(
    page.getByRole("table", { name: "What-if alternative household comparison" }),
  ).toBeVisible();
  await expect(page.getByText(/extra principal payment/i)).toBeVisible();
});

test("What If preserves explicitly reversed funding priority", async ({
  page,
}) => {
  const draft = structuredClone(createSyntheticPersonalDraft()) as any;
  draft.objects.Account.push({
    ...draft.objects.Account[0],
    account_id: "98000000-0000-4000-8000-000000000003",
    name: "Reserve checking",
  });
  await importDraft(page, draft);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page
    .getByLabel("Funding account to add")
    .selectOption({ label: "Everyday checking" });
  await page.getByRole("button", { name: "Add funding source" }).click();
  await page
    .getByLabel("Funding account to add")
    .selectOption({ label: "Reserve checking" });
  await page.getByRole("button", { name: "Add funding source" }).click();
  await page
    .getByRole("button", {
      name: /Move 98000000-0000-4000-8000-000000000003 up/,
    })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Ordered funding accounts" })
      .getByRole("listitem"),
  ).toHaveText([/Reserve checking/, /Everyday checking/]);
});

test("manual local save survives reload and explicit load without restoring execution state", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  await page.getByLabel("Source / name").fill("Recognizable saved salary");
  await page.getByRole("button", { name: "Close editor" }).click();

  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await page
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await page.getByLabel("Payment anchor").fill("2022-02-01");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const standalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await standalone.getByLabel("Forecast scope").selectOption("investments");
  await standalone
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await standalone
    .getByRole("button", { name: "Run investments forecast" })
    .click();
  await expect(
    standalone.getByRole("table", { name: "Detailed investment forecast" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Income target").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await expect(
    page.getByRole("table", { name: "What-if alternative household comparison" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Canonical model saved to this browser"),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Load saved model" }).click();
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Recognizable saved salary/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const restoredStandalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await restoredStandalone
    .getByLabel("Forecast scope")
    .selectOption("investments");
  await expect(restoredStandalone.getByLabel("Execution owner")).toHaveValue("");
  await expect(
    restoredStandalone.getByRole("table", { name: "Detailed investment forecast" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Compare Plans", exact: true })
    .click();
  await expect(
    page.getByText("No executable comparison is available yet."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(page.getByLabel("Execution owner")).toHaveValue("");
  await expect(page.getByLabel("Payment anchor")).toHaveValue("");
});

test("current and exact saved recovery exports match, and confirmed delete removes only local data", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();

  const currentDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export current model", exact: true })
    .click();
  const current = await currentDownload;
  const backupDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export saved backup", exact: true })
    .click();
  const backup = await backupDownload;
  expect(await readFile((await current.path())!, "utf8")).toBe(
    await readFile((await backup.path())!, "utf8"),
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete saved local model", exact: true })
    .click();
  await expect(page.getByText(/open model is unchanged/i)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Load saved model" }),
  ).toHaveCount(0);
});

test("PR21 closeout: major asset debt at projection start uses reconciled comparison", async ({ page }) => {
  test.setTimeout(120_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Major asset owner").selectOption({ index: 1 });
  await page.getByLabel("Major asset name").fill("Scenario home");
  await page.getByLabel("Major asset value").fill("400000");
  await page.getByLabel("Major debt amount").fill("300000");
  await page.getByLabel("Major debt annual rate").fill("0.05");
  await page.getByLabel("Major debt payment anchor").fill("2026-01-01");
  await page.getByLabel("Major debt total payments").fill("360");
  await page.getByLabel("Major debt funding account").selectOption({ index: 1 });
  await page.getByLabel("Major debt settlement priority").fill("2");
  await page.getByRole("button", { name: "Compare major asset/debt" }).click();
  await expect(page.getByText("Declared difference: major asset debt addition")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("table", { name: "Add major asset financed by fixed debt at projection start household comparison" })).toBeVisible();
});

test("PR21 closeout: configure save reload reconfigure", async ({ page }) => {
  test.setTimeout(120_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByRole("button", { name: "Run household forecast" }).first().click();
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Income target").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Load saved model" }).click();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await expect(page.getByLabel("Cash-flow execution account")).toHaveValue("");
  await expect(page.getByLabel("Baseline retirement income")).toHaveValue("");
  await expect(page.getByLabel("Baseline canonical retirement event")).toHaveValue("");
  await expect(
    page.getByRole("table", { name: "Reconciled household forecast" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "What-if alternative household comparison" }),
  ).toHaveCount(0);
  const configuration = page.getByRole("region", {
    name: "Household execution configuration",
  });
  const investmentConfiguration = configuration
    .getByRole("heading", { name: "Investment execution configuration" })
    .locator("..");
  const debtConfiguration = configuration
    .getByRole("heading", { name: "Debt execution configuration" })
    .locator("..");
  const mortgage = configuration.getByRole("group", {
    name: "Example mortgage",
  });
  await configuration
    .getByLabel("Cash-flow execution account")
    .selectOption({ label: "Everyday checking" });
  await investmentConfiguration
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await debtConfiguration
    .getByLabel("Execution owner")
    .selectOption({ label: "Taylor Example" });
  await mortgage.getByLabel("Payment anchor").fill("2022-02-01");
  await mortgage.getByLabel("Total payment count").fill("360");
  await mortgage
    .getByLabel("Funding account")
    .selectOption({ label: "Everyday checking" });
  await mortgage.getByLabel("Settlement priority").fill("1");
  await configuration
    .getByLabel("Baseline retirement income")
    .selectOption({ label: "Example salary" });
  await configuration
    .getByLabel("Baseline canonical retirement event")
    .selectOption({ label: "Planned retirement" });
  await expect(configuration.getByLabel("Baseline retirement date")).toHaveValue(
    "2035-01-01",
  );
  await configuration
    .getByRole("button", { name: "Apply retirement binding" })
    .click();
  await configuration
    .getByRole("button", { name: "Apply household execution configuration" })
    .click();
  await expect(
    page.getByText(/Household execution configuration is missing/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Run household forecast" }).first().click();
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible({ timeout: 60_000 });
});
