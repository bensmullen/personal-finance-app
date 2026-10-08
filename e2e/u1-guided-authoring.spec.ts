import { test, expect, type Page, type Locator } from "@playwright/test";
import { FINANCIAL_FIELDS, entityField } from "../ui/authoring/fieldContract.js";
import { readFileSync } from "node:fs";

const navigate = async (page: Page, area: string, section: string) => {
  await page.getByRole("button", { name: area, exact: true }).click();
  await page.getByRole("button", { name: section, exact: true }).click();
};
const open = async (scope: Page | Locator, title: string) => {
  const summary = scope.locator("summary").filter({ hasText: title }).first();
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
};
const assertContractAndGeometry = async (page: Page, width: number) => {
  const controls = page.locator('[data-authoring-scope] input, [data-authoring-scope] select, [data-tax-setup] input, [data-tax-setup] select');
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const shell = control.locator('xpath=ancestor::*[@data-financial-field][1]');
    await expect(shell).toHaveCount(1);
    const key = await shell.getAttribute("data-financial-field");
    expect(FINANCIAL_FIELDS[key!], key!).toBeDefined();
    const scope = await control.evaluate(element => element.closest("[data-authoring-scope]")?.getAttribute("data-authoring-scope"));
    const field = scope?.startsWith("entity-") ? entityField(key!, scope.slice("entity-".length), undefined, false, undefined, await control.getAttribute("aria-label") === "Annual assumption rate" ? "effective annual rate" : undefined) : FINANCIAL_FIELDS[key!];
    expect(field, `${scope}:${key}`).toBeDefined();
    const heading = shell.locator(".field-heading label");
    await expect(heading).toContainText(field!.label);
    await expect(shell.locator(".field-help summary")).toHaveAttribute("aria-description", new RegExp(field!.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const label = await heading.boundingBox();
    expect(label!.width).toBeGreaterThan(90);
    expect(label!.height).toBeLessThan(100);
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThan(await control.getAttribute("type") === "checkbox" ? 16 : 120);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await control.getAttribute("aria-describedby")).toBeTruthy();
  }
};

test("U1 normal navigation, staged salary, direct repair, mortgage and horizon guidance", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example" }).click();
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

  await open(page, "Debt & mortgage");
  const mortgage = page.getByRole("group", { name: "Example mortgage" });
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("359");
  await expect(mortgage.getByLabel("Number of monthly payments", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Apply setup & run forecast", exact: true })).toBeDisabled();
  await mortgage.getByRole("button", { name: "Use calculated contractual maturity 2051-12-01", exact: true }).click();
  await expect(mortgage).toContainText("Contractual final payment / maturity: 2051-12-01");
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("360");
  await mortgage.getByRole("button", { name: "Use calculated contractual maturity 2052-01-01", exact: true }).click();

  const income = page.getByLabel("Income receiving account", { exact: true });
  const account = await income.inputValue();
  await income.selectOption("");
  const checklist = page.getByRole("region", { name: "Forecast setup checklist" });
  await checklist.getByRole("button", { name: /^Income receiving account:/ }).click();
  await expect(income).toBeFocused();
  await expect(income).toHaveAttribute("aria-invalid", "true");
  await income.selectOption(account);
  await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  await expect(page.getByText("Completed through 2036-01-01 · Some outputs are partially modeled", { exact: true })).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertContractAndGeometry(page, width);
  }
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
  await ira.getByRole("button", { name: "Manage contributions to IRA-DEMO", exact: true }).click();
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
  await hsa.getByRole("button", { name: "Manage contributions to HSA-EMPLOYEE", exact: true }).click();
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
  await expect(hsa).toContainText("employer hsa");
  await ira.getByRole("button", { name: "Manage contributions to IRA-DEMO", exact: true }).click();
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveValue("501");
  await personal.getByLabel("Purchase investment", { exact: true }).selectOption({ label: "SPOT-DEMO" });
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveValue("75.00");
  expect(errors).toEqual([]);
});

test("U1 rendered assumption and fixed-income guidance use their own financial meaning", async ({ page }) => {
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

test("U1 creates payroll contributions through the account action and retains another dirty draft", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Use synthetic example" }).click();
  await navigate(page, "Net Worth", "Investments & retirement");
  await page.getByRole("button", { name: "Manage contributions to RETIREMENT-DEMO", exact: true }).first().click();
  const payroll = page.getByRole("region", { name: "Saved payroll contributions" });
  await payroll.getByLabel("Payroll salary", { exact: true }).selectOption({ label: "Example salary" });
  await payroll.getByLabel("Payroll contribution rate", { exact: true }).fill("5");
  await payroll.getByLabel("Employer / plan group", { exact: true }).fill("Example employer");
  await payroll.getByRole("button", { name: "Save payroll contribution", exact: true }).click();
  await expect(payroll.getByText(/^Saved payroll: traditional 401k to RETIREMENT-DEMO/)).toBeVisible();
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
