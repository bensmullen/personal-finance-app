import { test, expect, type Page, type Locator } from "@playwright/test";
import { FINANCIAL_FIELDS, entityField } from "../ui/authoring/fieldContract.js";
import { readFileSync } from "node:fs";
import { navigateOwner, showReadiness, openFinancialSection } from "./navigation.js";
import { createGoldenHouseholdExampleDraft, exportPersonalModelJson } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";

const navigate = async (page: Page, area: string, section: string) => {
  await navigateOwner(page, area, section);
  if (section === "Investments & retirement") for (const summary of await page.locator(".account-holdings > summary").all()) {
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  }
};
const open = async (scope: Page | Locator, title: string) => {
  const summary = scope.locator("summary").filter({ hasText: title }).first();
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
};
// These journeys exercise the historical NY incomplete-payroll contract. The
// July-pay Philadelphia age-90 flagship has separate one-click coverage.
const loadHistoricalMonthlyExample = async (page: Page) => {
  await page.goto("/");
  // Open the import owner without starting a separate 649-month demonstration.
  for (const [label, value] of [["Household name", "Historical owner workspace"], ["Monthly income", "0"], ["Opening cash balance", "0"], ["Asset cost basis", "0"], ["Current debt", "0"], ["Monthly spending", "0"]] as const) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByLabel("Projection horizon (years)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "historical-monthly.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(createGoldenHouseholdExampleDraft())) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigate(page, "Money", "Income");
  await page.getByLabel("Income receiving account", { exact: true }).selectOption(ids.checking);
  await navigate(page, "Net Worth", "Debt");
  // Debt & mortgage is now displayed directly, not behind the old disclosure.
  // Keep the true source-owned financing facts and validation unchanged.
  await expect(page.getByRole("group", { name: "Example mortgage", exact: true })).toBeVisible();
  await page.getByLabel("Debt owner", { exact: true }).selectOption(ids.person);
  const mortgage = page.getByRole("group", { name: "Example mortgage", exact: true });
  await mortgage.getByLabel("First monthly payment", { exact: true }).fill("2022-02-01");
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("360");
  await mortgage.getByLabel("Mortgage payment account", { exact: true }).selectOption(ids.checking);
  await mortgage.getByLabel("Same-day mortgage order", { exact: true }).fill("1");
  await navigate(page, "Plan", "Current Plan");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-04-01");
  await openFinancialSection(page, "Investments");
  await page.getByLabel("Investment owner", { exact: true }).selectOption(ids.person);
  await open(page, "Tax payments & refunds");
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  await taxes.getByLabel("Tax payment account", { exact: true }).selectOption(ids.checking);
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption(ids.checking);
  for (const [jurisdiction, label] of [["US:FEDERAL", "Federal income tax"], ["US:NY", "New York"]]) {
    const summary = taxes.locator("details > summary").filter({ hasText: label }).first();
    await expect(summary).toBeVisible();
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
    await taxes.getByRole("button", { name: `Suggest April 15 for ${label}`, exact: true }).click();
    await taxes.getByLabel(`Confirm ${jurisdiction} forecast settlement convention`, { exact: true }).check();
  }
  await page.locator('[data-repair="lawScenario"]').check();
  await test.step("Historical monthly worker returns actual incomplete coverage for January–March", async () => {
    const status = page.getByRole("status", { name: "Household forecast status", exact: true });
    await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
    await expect(status).toHaveAttribute("data-lifecycle", "incomplete");
  });
};
const assertContractAndGeometry = async (page: Page, width: number) => {
  const registry = JSON.parse(readFileSync(new URL("../docs/specs/verification/u1-fact-ownership.json", import.meta.url), "utf8")) as { records: { id: string }[] };
  const controls = page.locator('[data-authoring-scope] input, [data-authoring-scope] select, [data-tax-setup] input, [data-tax-setup] select');
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    // Picking adults for a suggested horizon is a transient UI selection, not
    // an owned/saved financial fact. Verify its accessible group and DOB label;
    // all actual authoring fields (including target age) still require FieldShell.
    const planningAdults = control.locator('xpath=ancestor::section[@aria-label="Age-oriented forecast target"]/fieldset[legend="Select planning adults"]');
    if (await control.getAttribute("type") === "checkbox" && await planningAdults.count()) {
      await expect(control).toHaveAttribute("type", "checkbox");
      await expect(control.locator("xpath=ancestor::label[1]")).toContainText("DOB");
      continue;
    }
    const shell = control.locator('xpath=ancestor::*[@data-financial-field][1]');
    await expect(shell).toHaveCount(1);
    const key = await shell.getAttribute("data-financial-field");
    const family = await shell.getAttribute("data-semantic-family");
    expect(registry.records.some(row => row.id === family), `${key}: ${family}`).toBe(true);
    expect(await shell.getAttribute("data-semantic-binding")).toBeTruthy();
    expect(await shell.getAttribute("data-semantic-scope")).toBeTruthy();
    const state = await shell.getAttribute("data-field-state");
    if (state === "required") {
      await expect(shell.locator(".field-required")).toBeVisible();
      // Required-field meaning is already asserted through the visible marker;
      // an exact theme color is not a product or accessibility acceptance contract.
    } else if (state === "optional") await expect(shell.locator(".field-optional")).toContainText("(optional)");
    else await expect(shell.locator(".field-managed")).toBeVisible();
    const id = await control.getAttribute("id");
    await expect(shell.locator(`label[for="${id}"]`)).toHaveCount(1);
    expect(FINANCIAL_FIELDS[key!], key!).toBeDefined();
    const scope = await control.evaluate(element => element.closest("[data-authoring-scope]")?.getAttribute("data-authoring-scope"));
    const field = scope?.startsWith("entity-") ? entityField(key!, scope.slice("entity-".length), undefined, false, undefined, await control.getAttribute("aria-label") === "Annual assumption rate" ? "effective annual rate" : undefined) : FINANCIAL_FIELDS[key!];
    expect(field, `${scope}:${key}`).toBeDefined();
    // A target age is a user-owned proposal with a specialized accessible
    // label and help copy; its semantic key/binding remains the registry horizon.
    const ageTarget = key === "horizon" && await control.locator('xpath=ancestor::section[@aria-label="Age-oriented forecast target"]').count() > 0;
    const expectedLabel = ageTarget ? "Target age" : field!.label;
    const expectedDescription = ageTarget
      ? "Requested forecast cutoff age for the explicitly selected planning adults; the birthday month is included."
      : field!.description;
    const heading = shell.locator(".field-heading label");
    await expect(heading).toContainText(expectedLabel);
    await expect(shell.locator(".field-help summary")).toHaveAttribute("aria-description", new RegExp(expectedDescription.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const label = await heading.boundingBox();
    expect(label!.width).toBeGreaterThan(90);
    expect(label!.height).toBeLessThan(100);
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThan(await control.getAttribute("type") === "checkbox" ? 16 : 120);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await control.getAttribute("aria-describedby")).toBeTruthy();
  }
};

test("Owner monthly evidence: paycheck coverage, matching Debt and Spending, and contribution navigation", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await loadHistoricalMonthlyExample(page);
  await test.step("Technical diagnostic provenance is deferred and remains accessible", async () => {
    const status = page.getByRole("status", { name: "Household forecast status", exact: true });
    await expect(status.locator("pre")).toHaveCount(0);
    await status.locator(".forecast-guidance > summary").click();
    const technical = status.locator("details").filter({ has: page.locator(":scope > summary", { hasText: /^Technical diagnostic details$/ }) });
    await technical.locator(":scope > summary").click();
    await expect(technical.locator("pre")).toHaveCount(0);
    await technical.locator("details > summary").first().click();
    await expect(technical.locator("pre").first()).toContainText("PFA-TAX");
    await technical.locator(":scope > summary").click();
    await expect(technical.locator("pre")).toHaveCount(0);
  });
  await navigate(page, "Money", "Cash Flow");
  const pay = page.getByRole("region", { name: "Your Paycheck", exact: true });
  await expect(pay.getByRole("button", { name: "Review selected month" })).toHaveCount(0);
  await expect(pay).toContainText("Incomplete allocation");
  await expect(pay).toContainText("not leftover pay");
  await expect(pay.getByRole("img")).toHaveAttribute("aria-label", /Mortgage payment.*total income basis.*taxes withheld not modeled/i);
  await pay.getByLabel("paycheck forecast month").selectOption("2026-02");
  await expect(pay).toContainText("2026-02-01 to 2026-03-01");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const bar = await pay.getByRole("img").boundingBox();
    expect(bar!.width).toBeGreaterThan(200);
    expect(bar!.x + bar!.width).toBeLessThanOrEqual(width);
    await assertContractAndGeometry(page, width);
  }
  await navigate(page, "Net Worth", "Debt");
  const debt = page.getByRole("region", { name: "Monthly mortgage payments", exact: true });
  await expect(debt.locator('[aria-label="Mortgage cash payments"]')).toBeVisible();
  const payment = await debt.locator('[aria-label="Mortgage cash payments"]').innerText();
  await expect(debt).toContainText("contractual payment");
  await navigate(page, "Money", "Spending");
  const spending = page.getByRole("region", { name: "Housing payments and transfers", exact: true });
  await expect(spending.locator('[aria-label="Mortgage cash payments"]')).toBeVisible();
  expect(await spending.locator('[aria-label="Mortgage cash payments"]').innerText()).toBe(payment);
  await expect(spending).toContainText("Principal repayment reduces debt");
  await navigate(page, "Plan", "Current Plan");
  await expect(page.getByRole("region", { name: "Saved investment purchases" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Saved payroll contributions" })).toHaveCount(0);
  await page.getByRole("button", { name: "Review or edit contributions" }).click();
  await expect(page.locator("#investment-contribution-summary")).toBeFocused();
  await page.getByRole("button", { name: "Manage contributions to RETIREMENT-DEMO", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Saved payroll contributions" }).getByLabel("Payroll destination", { exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("U1 normal navigation, staged salary, direct repair, mortgage and horizon guidance", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await loadHistoricalMonthlyExample(page);
  const status = page.getByRole("status", { name: "Household forecast status" });
  await expect(status).toHaveAttribute("data-lifecycle", "incomplete", { timeout: 30_000 });
  await expect(status).toContainText("New York");
  const messages = await status.locator("[data-diagnostic-root]").allTextContents();
  expect(new Set(messages).size).toBe(messages.length);

  await navigate(page, "Money", "Income");
  await page.locator("button.card-main").filter({ hasText: "Example salary" }).click();
  const editor = page.getByRole("dialog", { name: "Edit Income" });
  const amount = editor.getByLabel("Amount", { exact: true });
  const original = await amount.inputValue();
  await amount.fill("9100.00");
  await page.keyboard.press("Escape");
  const unsaved = editor.getByRole("alert", { name: "Unsaved changes" });
  await expect(unsaved).toBeVisible();
  await unsaved.getByRole("button", { name: "Continue editing" }).click();
  await expect(amount).toHaveValue("9100.00");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await unsaved.getByRole("button", { name: "Discard changes" }).click();
  await page.locator("button.card-main").filter({ hasText: "Example salary" }).click();
  await expect(amount).toHaveValue(original);
  await amount.fill("");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await editor.getByRole("alert", { name: "Plan needs attention" }).first().getByRole("button", { name: /^Amount:/ }).click();
  await expect(amount).toBeFocused();
  const help = editor.getByRole("button", { name: "Help for Amount", exact: true });
  await help.focus(); await page.keyboard.press("Enter");
  await expect(editor.getByRole("note").filter({ hasText: "Amount for each occurrence" })).toBeVisible();
  await amount.fill(original);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor).toHaveCount(0);

  await navigate(page, "Plan", "Current Plan");
  await open(page, "Tax payments & refunds");
  const taxes = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  await taxes.getByLabel("Tax payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await taxes.getByLabel("Tax refund account", { exact: true }).selectOption({ label: "Everyday checking" });
  for (const name of ["Federal income tax", "New York"]) {
    // Jurisdiction-specific tax conventions use their own disclosure sections.
    // Open the selected legal source before confirming its settlement date.
    await open(taxes, name);
    await taxes.getByRole("button", { name: `Suggest April 15 for ${name}`, exact: true }).click();
  }
  for (const checkbox of await taxes.getByRole("checkbox").all()) await checkbox.check();
  const dates = page.getByRole("region", { name: "Current Plan horizon" });
  await dates.getByLabel("Simulation end", { exact: true }).fill("2037-01-01");
  await expect(dates.getByLabel("Simulation end", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.locator('[data-authoring-scope="plan-horizon"]').getByRole("alert", { name: "Plan needs attention" }).getByRole("button", { name: /^Simulation end:/ }).click();
  await expect(dates.getByLabel("Simulation end", { exact: true })).toBeFocused();
  await dates.getByLabel("Simulation end", { exact: true }).fill("2036-01-01");
  await dates.getByLabel("Current plan end", { exact: true }).fill("2037-01-01");
  await dates.getByRole("button", { name: "Apply Current Plan dates", exact: true }).click();
  await expect(dates).toContainText("2037-01-01");

  await navigate(page, "Net Worth", "Debt");
  const mortgage = page.getByRole("group", { name: "Example mortgage" });
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("359");
  await expect(mortgage.getByLabel("Number of monthly payments", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await navigate(page, "Plan", "Current Plan");
  await expect(page.getByRole("button", { name: "Apply setup & run forecast", exact: true })).toBeDisabled();
  await navigate(page, "Net Worth", "Debt");
  await mortgage.getByRole("button", { name: "Use calculated contractual maturity 2051-12-01", exact: true }).click();
  await expect(mortgage).toContainText("Contractual final payment / maturity: 2051-12-01");
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("360");
  await mortgage.getByRole("button", { name: "Use calculated contractual maturity 2052-01-01", exact: true }).click();

  await navigate(page, "Money", "Income");
  const income = page.getByLabel("Income receiving account", { exact: true });
  const account = await income.inputValue();
  await income.selectOption("");
  await navigate(page, "Plan", "Current Plan");
  const checklist = page.getByRole("region", { name: "Forecast setup checklist" });
  await showReadiness(page);
  await checklist.getByRole("button", { name: /^Income receiving account:/ }).click();
  await expect(income).toBeFocused();
  await expect(income).toHaveAttribute("aria-invalid", "true");
  await income.selectOption(account);
  await navigate(page, "Plan", "Current Plan");
  await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  await expect(page.getByText("Completed through 2036-01-01 · Some outputs are partially modeled", { exact: true })).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertContractAndGeometry(page, width);
  }
  expect(errors).toEqual([]);
});

test("Owner repair: account-first holdings and subtype-specific controls remain readable on desktop and mobile", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/d1-integrated-uat-model.json");
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit holding BROKERAGE-DEMO", exact: true })).toBeHidden();
  const brokerage = page.locator(".account-holdings").filter({ has: page.locator("summary", { hasText: /^Holdings in Taxable brokerage$/ }) });
  const accountButton = page.getByRole("button", { name: "Review account Taxable brokerage", exact: true });
  await accountButton.focus(); await page.keyboard.press("Enter");
  await expect(accountButton).toHaveAttribute("aria-expanded", "true");
  await expect(brokerage.getByRole("button", { name: "Edit holding BROKERAGE-DEMO", exact: true })).toBeVisible();
  await expect(brokerage.getByRole("button", { name: /IRA-DEMO|RETIREMENT-DEMO/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit account Taxable brokerage", exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const box = await brokerage.getByRole("button", { name: "Edit holding BROKERAGE-DEMO", exact: true }).boundingBox();
    expect(box?.width).toBeGreaterThan(180);
    await brokerage.getByRole("button", { name: "Edit holding BROKERAGE-DEMO", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Investment" });
    await open(editor, "Additional financial details");
    await expect(editor.getByLabel("Call exercise price", { exact: true })).toHaveCount(0);
    await expect(editor.getByLabel("Investment maturity", { exact: true })).toHaveCount(0);
    await expect(editor.locator("summary").filter({ hasText: /^Entity IDs$/ })).toBeVisible();
    await assertContractAndGeometry(page, width);
    await editor.getByRole("button", { name: "Close editor", exact: true }).click();
  }
  await brokerage.getByRole("button", { name: "+ Add Investment", exact: true }).click();
  const creating = page.getByRole("dialog", { name: "Create Investment" });
  await creating.getByLabel("Investment type", { exact: true }).selectOption("option");
  await expect(creating.getByText(/Choose a supported long equity call product/)).toBeVisible();
  await expect(creating.getByLabel("Call exercise price", { exact: true })).toHaveCount(0);
  await creating.getByLabel("Investment product", { exact: true }).selectOption("long_equity_call");
  await open(creating, "Additional financial details");
  await expect(creating.getByLabel("Call exercise price", { exact: true })).toBeVisible();
  await expect(creating.getByLabel("Investment maturity", { exact: true })).toHaveCount(0);
  await creating.getByLabel("Investment type", { exact: true }).selectOption("bond");
  await creating.getByLabel("Investment product", { exact: true }).selectOption("cd");
  await expect(creating.getByLabel("Investment maturity", { exact: true })).toBeVisible();
  await expect(creating.getByLabel("Call exercise price", { exact: true })).toHaveCount(0);
  await creating.getByLabel("Investment type", { exact: true }).selectOption("crypto");
  await expect(creating.getByLabel("Investment maturity", { exact: true })).toHaveCount(0);
  await expect(creating.getByLabel("Call exercise price", { exact: true })).toHaveCount(0);
  await creating.getByRole("button", { name: "Cancel", exact: true }).click();
  await creating.getByRole("button", { name: "Discard changes", exact: true }).click();
  expect(errors).toEqual([]);
});

test("Owner repair: historical scope and prior YTD save work in one session with an announced result and reload", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Net Worth", "Investments & retirement"); await open(page, "Contributions already made this year");
  const usage = page.getByRole("region", { name: "Prior year-to-date contributions" });
  await usage.getByLabel("Historical holding", { exact: true }).selectOption({ label: "RETIREMENT-DEMO" });
  await usage.getByLabel("Employer / plan group", { exact: true }).fill("Example employer");
  await open(usage, "Annual eligibility · 2026");
  await expect(usage.getByLabel("Age at year end", { exact: true })).toHaveCount(0);
  await usage.getByRole("button", { name: "Review annual pay eligible for this plan", exact: true }).click();
  const payFact = page.getByRole("dialog", { name: "Edit Annual pay eligible for this plan", exact: true });
  await payFact.getByLabel("Annual pay eligible for this plan", { exact: true }).fill("108000");
  await payFact.getByRole("button", { name: "Confirm & save fact", exact: true }).click();
  await usage.getByRole("button", { name: "Save historical scope", exact: true }).click();
  await expect(usage.getByRole("status").filter({ hasText: /Historical eligibility saved/ })).toBeVisible();
  await usage.getByLabel("YTD forecast boundary", { exact: true }).fill("2026-07-01");
  const totals = usage.getByRole("textbox", { name: /prior YTD total/ });
  await totals.first().fill("100");
  await usage.getByRole("textbox", { name: /prior YTD amount excluding catch-up/ }).first().fill("100");
  const confirmation = usage.getByRole("checkbox", { name: "Confirm all prior contributions are known", exact: true });
  await confirmation.check();
  // Saving an unchanged legal scope produces a new model object. It must not
  // reset unrelated dirty totals or the known-usage confirmation.
  await usage.getByRole("button", { name: "Save historical scope", exact: true }).click();
  await expect(confirmation).toBeChecked(); await expect(totals.first()).toHaveValue("100");
  const save = usage.getByRole("button", { name: "Save prior YTD usage", exact: true });
  await expect(save).toBeEnabled(); await save.scrollIntoViewIfNeeded();
  const before = await save.boundingBox(); await save.click();
  await expect(save).toBeFocused();
  const after = await save.boundingBox(); expect(Math.abs(after!.y - before!.y)).toBeLessThan(120);
  await expect(usage.getByRole("status").filter({ hasText: /Prior usage saved for 2026 before 2026-07-01/ })).toBeVisible();
  await open(usage, "Saved prior usage"); await expect(usage).toContainText("100 USD");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Canonical model saved to this browser/)).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await navigate(page, "Net Worth", "Investments & retirement"); await open(page, "Contributions already made this year");
  await expect(usage.getByLabel("YTD forecast boundary", { exact: true })).toHaveValue("2026-07-01");
  await expect(totals.first()).toHaveValue("100");
  await open(usage, "Saved prior usage"); await expect(usage).toContainText("100 USD");
  await usage.getByLabel("YTD forecast boundary", { exact: true }).fill("2027-07-01");
  await expect(save).toBeDisabled(); await expect(usage.getByRole("alert").filter({ hasText: /Define the historical account/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("U1 account actions choose the authoritative personal and workplace paths", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/d1-integrated-uat-model.json");
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigate(page, "Net Worth", "Investments & retirement");
  const ira = page.getByRole("article").filter({ has: page.locator("strong", { hasText: /^Personal Roth IRA$/ }) });
  await expect(ira).toContainText("Total account value");
  await expect(ira).toContainText("Cash inside account");
  await expect(ira).toContainText("Saved future contributions");
  await ira.getByRole("region", { name: "Contributions for Personal Roth IRA", exact: true }).getByRole("button", { name: "Manage contributions to IRA-DEMO", exact: true }).click();
  const personal = page.getByRole("region", { name: "Saved investment purchases" });
  await expect(personal.getByLabel("Purchase investment", { exact: true })).toHaveValue("d1cc0000-0000-4000-8000-000000000002");
  await expect(personal.getByLabel("Purchase funding account", { exact: true }).locator('option[value="d1cc0000-0000-4000-8000-000000000001"]')).toHaveCount(0);
  await personal.getByLabel("Purchase amount", { exact: true }).fill("invalid");
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(personal.getByRole("button", { name: "Save investment purchase", exact: true })).toBeDisabled();
  await personal.getByLabel("Purchase amount", { exact: true }).fill("501");
  await personal.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await expect(personal.getByText(/^Saved purchase:.*501/)).toBeVisible();
  await personal.getByLabel("Purchase investment", { exact: true }).selectOption({ label: "SPOT-DEMO" });
  await personal.getByLabel("Purchase funding account", { exact: true }).selectOption({ label: "Everyday checking" });
  await personal.getByLabel("Purchase amount", { exact: true }).fill("75.00");
  await personal.getByLabel("Purchase start date", { exact: true }).fill("2026-02-01");
  await personal.getByLabel("Purchase amount", { exact: true }).fill("75.001");
  await personal.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await expect(personal.getByRole("alert").filter({ hasText: "currency precision" })).toBeVisible();
  await personal.getByRole("button", { name: "Review purchase amount", exact: true }).click();
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toBeFocused();
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveValue("75.001");
  await expect(personal.getByText(/^Saved purchase: SPOT-DEMO/)).toHaveCount(0);
  await personal.getByLabel("Purchase amount", { exact: true }).fill("75.00");
  await personal.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await expect(personal.getByText(/^Saved purchase: SPOT-DEMO.*75/)).toBeVisible();

  await navigate(page, "Net Worth", "Investments & retirement");
  const hsa = page.getByRole("article").filter({ has: page.locator("strong", { hasText: /^Health savings investments$/ }) });
  await hsa.getByRole("region", { name: "Contributions for Health savings investments", exact: true }).getByRole("button", { name: "Manage contributions to HSA-EMPLOYEE", exact: true }).click();
  const payroll = page.getByRole("region", { name: "Saved payroll contributions" });
  await expect(payroll.getByLabel("Payroll destination", { exact: true })).toHaveValue("d1cc0000-0000-4000-8000-000000000005");
  await expect(payroll.getByLabel("Payroll contribution character", { exact: true }).locator("option")).toHaveCount(2);
  await expect(payroll.getByLabel("Payroll contribution character", { exact: true }).locator('option[value="traditional_401k"]')).toHaveCount(0);
  await expect(payroll.getByLabel("Payroll contribution method", { exact: true }).locator('option[value="match"]')).toHaveCount(0);
  await payroll.getByLabel("Payroll contribution character", { exact: true }).selectOption("employer_hsa");
  await expect(payroll.getByLabel("Payroll contribution method", { exact: true }).locator('option[value="match"]')).toHaveCount(1);
  await payroll.getByLabel("Payroll contribution method", { exact: true }).selectOption("percent");
  await payroll.getByLabel("Payroll contribution rate", { exact: true }).fill("101");
  await expect(payroll.getByLabel("Payroll contribution rate", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(payroll.getByRole("button", { name: "Save payroll contribution", exact: true })).toBeDisabled();
  await payroll.getByLabel("Payroll contribution rate", { exact: true }).fill("1");
  await payroll.getByRole("button", { name: "Save payroll contribution", exact: true }).click();
  await expect(payroll.getByText(/^Saved payroll: employer hsa to HSA-EMPLOYEE/)).toBeVisible();
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await assertContractAndGeometry(page, width); }
  expect(await payroll.innerText()).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\[object Object\]/i);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Canonical model saved to this browser/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await navigate(page, "Net Worth", "Investments & retirement");
  await expect(ira).toContainText("501");
  await ira.locator(":scope > details > summary").filter({ hasText: /^Scheduled activity/ }).click();
  await expect(ira.locator(":scope > details").last()).toContainText("501");
  await expect(hsa).toContainText("employer hsa");
  await ira.getByRole("region", { name: "Contributions for Personal Roth IRA", exact: true }).getByRole("button", { name: "Manage contributions to IRA-DEMO", exact: true }).click();
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveValue("501");
  await personal.getByLabel("Purchase investment", { exact: true }).selectOption({ label: "SPOT-DEMO" });
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveValue("75.00");
  expect(errors).toEqual([]);
});

test("U1 rendered assumption and fixed-income guidance use their own financial meaning", async ({ page }) => {
  // CI exhausted the default whole-test budget. This journey checks every
  // visible field's contract and geometry three times across two editors and
  // both viewport widths; retain all assertions with a bounded per-test budget.
  test.setTimeout(120_000);
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/d1-integrated-uat-model.json");
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigate(page, "Plan", "Assumptions");
  await page.locator("button.card-main").filter({ hasText: "Brokerage return" }).click();
  const assumption = page.getByRole("dialog", { name: "Edit Assumption" });
  await open(assumption, "Additional financial details");
  await expect(assumption.getByLabel("Assumption source", { exact: true })).toHaveValue("user");
  await assumption.getByRole("button", { name: "Help for Assumption source", exact: true }).click();
  await expect(assumption.getByRole("note").filter({ hasText: "historical evidence" })).toBeVisible();
  await expect(assumption.getByLabel("Assumption category", { exact: true })).toHaveValue("market_return");
  await expect(assumption.getByLabel("Annual assumption rate", { exact: true })).toHaveValue("0");
  await assertContractAndGeometry(page, 1440);
  await assumption.getByRole("button", { name: "Close editor", exact: true }).click();
  await navigate(page, "Net Worth", "Investments & retirement");
  await page.locator("button.card-main").filter({ hasText: "BILL-DEMO" }).click();
  const investment = page.getByRole("dialog", { name: "Edit Investment" });
  await open(investment, "Additional financial details");
  await investment.getByRole("button", { name: "Help for Investment maturity", exact: true }).click();
  await expect(investment.getByRole("note").filter({ hasText: "Treasury or CD" })).toBeVisible();
  await expect(investment.getByLabel("Contractual final payment", { exact: true })).toHaveCount(0);
  await investment.getByLabel("Investment maturity", { exact: true }).fill("2025-01-01");
  await expect(investment.getByLabel("Investment maturity", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(investment.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await investment.getByRole("alert", { name: "Plan needs attention" }).first().getByRole("button", { name: /^Investment maturity:/ }).click();
  await expect(investment.getByLabel("Investment maturity", { exact: true })).toBeFocused();
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await assertContractAndGeometry(page, width); }
});

test("U1 saved-fact repair distinguishes editable facts from immutable corrections", async ({ page }) => {
  const model = JSON.parse(readFileSync("test/fixtures/d1-integrated-uat-model.json", "utf8"));
  // Deliberately incomplete imported facts exercise real repair routing.
  model.objects.Income[0].amount = "";
  model.objects.Account[0].opening_balance = "invalid";
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "incomplete-synthetic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  const banner = page.getByRole("alert", { name: "Saved plan needs attention" });
  await showReadiness(page);
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "Review cash balance", exact: true })).toHaveCount(0);
  await banner.getByRole("button", { name: "Review amount", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Income" });
  await expect(editor.getByLabel("Amount", { exact: true })).toBeFocused();
  await editor.getByLabel("Amount", { exact: true }).fill("9000.00");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(banner.getByRole("button", { name: "Review amount", exact: true })).toHaveCount(0);
  await banner.getByRole("button", { name: "Import corrected records", exact: true }).first().click();
  await expect(page.locator('input[type="file"]')).toBeVisible();
});

test("Owner repair: exact diagnostic ID lookup opens named records and preserves immutable correction paths", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const model = JSON.parse(readFileSync("test/fixtures/d1-integrated-uat-model.json", "utf8"));
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/d1-integrated-uat-model.json");
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigate(page, "Settings", "Technical diagnostics");
  const lookup = page.getByLabel("Find a record by exact ID", { exact: true });
  await lookup.fill(model.objects.Income[0].income_id);
  const reference = page.locator(".diagnostic-references").filter({ hasText: /Income · Example salary/ });
  await expect(reference).toContainText("Taylor Example");
  await reference.getByRole("button", { name: "Open record", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit Income" })).toBeVisible();
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await navigate(page, "Settings", "Technical diagnostics");
  await lookup.fill(model.objects.Account[0].account_id);
  await expect(page.locator(".diagnostic-references").filter({ hasText: /Everyday checking/ })).toContainText("corrected-model import");
  await lookup.fill("90000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("status").filter({ hasText: /No exact record matches/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open record", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Owner repair: saved investment actions and linked eligibility summaries are inspectable by account", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/d1-integrated-uat-model.json");
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigate(page, "Net Worth", "Investments & retirement");
  const brokerage = page.locator("article").filter({ has: page.locator("strong", { hasText: /^Taxable brokerage$/ }) });
  const activity = brokerage.locator(":scope > details").filter({ has: page.locator("summary").filter({ hasText: /^Scheduled activity/ }) }).last();
  await activity.locator(":scope > summary").click();
  await expect(activity.getByText(/^Investment sale · BROKERAGE-DEMO$/, { exact: true })).toHaveCount(1);
  await expect(activity.getByText(/^Dividend reinvestment · BROKERAGE-DEMO$/, { exact: true })).toHaveCount(1);
  await expect(activity).toContainText("2026-01-21");
  await expect(activity).not.toContainText("IRA-DEMO");
  await expect(activity.getByRole("button", { name: "Edit event", exact: true })).toHaveCount(0);
  const ira = page.locator("article").filter({ has: page.locator("strong", { hasText: /^Personal Roth IRA$/ }) });
  const eligibility = ira.locator(':scope > details > section[aria-label="Eligibility for IRA-DEMO"]');
  await open(eligibility.locator(".."), "Saved annual eligibility");
  await expect(eligibility).toContainText("Taylor Example"); await expect(eligibility).toContainText("2026");
  await eligibility.getByRole("button", { name: "Review/edit eligibility for IRA-DEMO", exact: true }).click();
  const personal = page.getByRole("region", { name: "Saved investment purchases" });
  await expect(personal.getByLabel("Purchase investment", { exact: true })).toHaveValue("d1cc0000-0000-4000-8000-000000000002");
  await open(personal, "Annual eligibility · 2026");
  await expect(personal.getByLabel("Age at year end", { exact: true })).toHaveCount(0);
  await expect(personal).toContainText("From date of birth · Household & People");
  await personal.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await navigate(page, "Net Worth", "Investments & retirement");
  await open(eligibility.locator(".."), "Saved annual eligibility");
  await expect(eligibility.locator("dd").filter({ hasText: /^36$/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Owner repair: isolated mortgage shortfalls name the evaluated payment account and navigate to funding", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  // The supported flagship has $4M in checking, so a shortfall must be
  // authored explicitly rather than assumed. Use the real account owner UI.
  const bankName = "Isolated mortgage bank";
  await navigate(page, "Money", "Accounts");
  await page.getByRole("button", { name: "+ Add Account", exact: true }).click();
  const bank = page.getByRole("dialog", { name: "Create Account", exact: true });
  await bank.getByLabel("Name", { exact: true }).fill(bankName);
  await bank.getByLabel("Account type", { exact: true }).selectOption("checking");
  await bank.getByLabel("Owner", { exact: true }).selectOption(ids.person);
  await bank.getByLabel("Account opened", { exact: true }).fill("2026-01-01");
  await bank.getByLabel("Cash balance", { exact: true }).fill("0");
  await bank.getByRole("button", { name: "Create Account", exact: true }).click();
  await expect(bank).toHaveCount(0);
  await navigate(page, "Net Worth", "Debt");
  await page.getByLabel("Mortgage payment account", { exact: true }).selectOption({ label: bankName });
  await navigate(page, "Plan", "Current Plan"); await open(page, "Expert standalone forecasts");
  const standalone = page.getByRole("region", { name: "Standalone forecast drill-down" });
  await standalone.getByLabel("Forecast scope", { exact: true }).selectOption("liabilities");
  await standalone.getByRole("button", { name: "Run liabilities forecast", exact: true }).click();
  await expect(standalone.getByText("Isolated liabilities forecast", { exact: true })).toBeVisible();
  await expect(standalone.getByRole("note").filter({ hasText: /does not include salary or spending/ })).toBeVisible();
  const explanation = standalone.getByRole("region", { name: "Mortgage funding explanation" }).first();
  await expect(explanation).toContainText("Example mortgage"); await expect(explanation).toContainText("2026-01-01");
  await expect(explanation).toContainText("Payment account: Isolated mortgage bank");
  await expect(explanation).toContainText("Required $1325.29; available $0.00");
  await explanation.getByRole("button", { name: "Review mortgage payment account", exact: true }).click();
  const funding = page.getByLabel("Mortgage payment account", { exact: true });
  await expect(funding).toBeFocused(); await expect(funding).toBeVisible();
  await navigate(page, "Plan", "Current Plan");
  await open(page, "Expert standalone forecasts");
  await standalone.getByLabel("Forecast scope", { exact: true }).selectOption("cash_flow");
  await standalone.getByRole("button", { name: "Run cash flow forecast", exact: true }).click();
  await expect(standalone.getByText("Standalone cash-flow forecast · no mortgage execution", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Owner repair: a real multi-record funding diagnostic opens the editable spending field", async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const model = JSON.parse(readFileSync("test/fixtures/d1-integrated-uat-model.json", "utf8"));
  model.objects.Expense[0].payment_account_id = model.objects.Account.find((account: { account_type: string }) => account.account_type === "traditional_401k").account_id;
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "unsupported-payment-account-synthetic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigate(page, "Plan", "Current Plan"); await open(page, "Expert standalone forecasts");
  const standalone = page.getByRole("region", { name: "Standalone forecast drill-down" });
  await standalone.getByLabel("Forecast scope", { exact: true }).selectOption("cash_flow");
  await standalone.getByRole("button", { name: "Run cash flow forecast", exact: true }).click();
  const root = standalone.locator("[data-diagnostic-root]").filter({ hasText: "Living costs" }).first();
  await expect(root).toContainText("Expense · Living costs"); await expect(root).toContainText("Account · Workplace retirement");
  expect(await root.innerText()).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i);
  await root.getByRole("button", { name: "Review Funding account", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Expense" });
  await expect(editor.getByLabel("Funding account", { exact: true })).toBeFocused();
  const checkingId = model.objects.Account.find((account: { account_type: string }) => account.account_type === "checking").account_id;
  await expect(editor.getByLabel("Funding account", { exact: true }).locator(`option[value="${checkingId}"]`)).toContainText("Everyday checking");
  await editor.getByLabel("Funding account", { exact: true }).selectOption(checkingId);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(errors).toEqual([]);
});

test("U1 creates payroll contributions through the account action and retains another dirty draft", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Net Worth", "Investments & retirement");
  await page.getByRole("button", { name: "Manage contributions to RETIREMENT-DEMO", exact: true }).first().click();
  const payroll = page.getByRole("region", { name: "Saved payroll contributions" });
  await payroll.getByLabel("Payroll salary", { exact: true }).selectOption({ label: "Example salary" });
  await payroll.getByLabel("Payroll contribution rate", { exact: true }).fill("5");
  await payroll.getByLabel("Employer / plan group", { exact: true }).fill("Example employer");
  await payroll.getByRole("button", { name: "Save payroll contribution", exact: true }).click();
  // The explicitly synthetic flagship has a sourced Roth workplace plan.
  await expect(payroll.getByText(/^Saved payroll: roth 401k to RETIREMENT-DEMO\./)).toBeVisible();
  await payroll.getByLabel("Payroll contribution rate", { exact: true }).fill("6");
  await open(page, "IRA & brokerage contributions");
  const personal = page.getByRole("region", { name: "Saved investment purchases" });
  await personal.getByLabel("Purchase investment", { exact: true }).selectOption({ label: "BROKERAGE-DEMO" });
  await personal.getByLabel("Purchase funding account", { exact: true }).selectOption({ label: "Everyday checking" });
  await personal.getByLabel("Purchase amount", { exact: true }).fill("100");
  await personal.getByLabel("Purchase start date", { exact: true }).fill("2026-02-01");
  await personal.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await expect(personal.getByText(/^Saved purchase: BROKERAGE-DEMO/)).toBeVisible();
  await expect(payroll.getByLabel("Payroll contribution rate", { exact: true })).toHaveValue("6");
  await personal.getByLabel("Purchase amount", { exact: true }).fill("125");
  await payroll.getByRole("button", { name: "Save payroll contribution", exact: true }).click();
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveValue("125");
});
