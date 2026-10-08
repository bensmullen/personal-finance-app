import { test, expect, type Page, type Locator } from "@playwright/test";
import { FINANCIAL_FIELDS } from "../ui/authoring/fieldContract.js";

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
    const heading = shell.locator(".field-heading label");
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
  await expect(personal.getByLabel("Purchase funding account").locator('option[value="d1cc0000-0000-4000-8000-000000000001"]')).toHaveCount(0);
  await personal.getByLabel("Purchase amount", { exact: true }).fill("invalid");
  await expect(personal.getByLabel("Purchase amount", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(personal.getByRole("button", { name: "Save investment purchase", exact: true })).toBeDisabled();
  await personal.getByLabel("Purchase amount", { exact: true }).fill("501");
  await personal.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await expect(personal).toContainText("501");

  await navigate(page, "Net Worth", "Investments & retirement");
  const hsa = page.getByRole("article").filter({ has: page.locator("strong", { hasText: /^Health savings investments$/ }) });
  await hsa.getByRole("button", { name: "Manage contributions to HSA-EMPLOYEE", exact: true }).click();
  const payroll = page.getByRole("region", { name: "Saved payroll contributions" });
  await expect(payroll.getByLabel("Payroll destination", { exact: true })).toHaveValue("d1cc0000-0000-4000-8000-000000000005");
  await expect(payroll.getByLabel("Payroll contribution character").locator("option")).toHaveCount(2);
  await expect(payroll.getByLabel("Payroll contribution character").locator('option[value="traditional_401k"]')).toHaveCount(0);
  await expect(payroll.getByLabel("Payroll contribution method").locator('option[value="match"]')).toHaveCount(0);
  await payroll.getByLabel("Payroll contribution character").selectOption("employer_hsa");
  await expect(payroll.getByLabel("Payroll contribution method").locator('option[value="match"]')).toHaveCount(1);
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await assertContractAndGeometry(page, width); }
  expect(await payroll.innerText()).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\[object Object\]/i);
  expect(errors).toEqual([]);
});
