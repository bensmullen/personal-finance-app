import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { importPersonalModelJson, type JsonObject } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner, saveCurrentModel } from "./navigation.js";

interface Household {
  name: string;
  income: string;
  cash: string;
  editedIncome: string;
}
const fixture = JSON.parse(await readFile(
  new URL("../test/fixtures/goalFramework/households/guided.json", import.meta.url), "utf8",
)) as { start: string; end: string; asset: string; debt: string; monthlySpending: string; households: Household[] };
const [amber, indigo] = fixture.households as [Household, Household];
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const action = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const evidencePath = (info: TestInfo, name: string) =>
  process.env.PFM_HOUSEHOLD_OUTPUT ? join(process.env.PFM_HOUSEHOLD_OUTPUT, name) : info.outputPath(name);

async function initialize(page: Page, household: Household, rejectMissingIncome = false) {
  await page.goto("/");
  await field(page, "Household name").fill(household.name);
  await action(page, "Continue").click();
  const income = field(page, "Monthly income");
  await expect(income).toHaveValue("");
  if (rejectMissingIncome) {
    await action(page, "Continue").click();
    await expect(income).toHaveAttribute("aria-invalid", "true");
  }
  for (const [label, value] of [
    ["Monthly income", household.income], ["Opening cash balance", household.cash], ["Asset cost basis", fixture.asset],
    ["Current debt", fixture.debt], ["Monthly spending", fixture.monthlySpending],
  ] as const) {
    await field(page, label).fill(value);
    await action(page, "Continue").click();
  }
  await field(page, "Projection horizon (years)").fill("1");
  await field(page, "Projection start date").fill(fixture.start);
  await action(page, "Finish setup").click();
  await expect(page.getByText("Your starting financial picture is ready", { exact: true })).toBeVisible();
}

async function exported(page: Page) {
  await navigateOwner(page, "Settings", "Import / Export");
  const downloading = page.waitForEvent("download");
  await action(page, "Export current model").click();
  const saved = await (await downloading).path();
  if (!saved) throw new Error("Missing canonical export");
  return importPersonalModelJson(await readFile(saved, "utf8"));
}

async function reconcile(page: Page, household: Household, income = household.income) {
  const model = await exported(page);
  const people = model.objects.Person as readonly JsonObject[];
  const households = model.objects.Household as readonly JsonObject[];
  const accounts = model.objects.Account as readonly JsonObject[];
  expect(households).toHaveLength(1);
  expect(people).toHaveLength(1);
  expect(accounts).toHaveLength(1);
  expect(households[0]).toMatchObject({ name: household.name, members: [people[0]!.person_id] });
  expect(people[0]).toMatchObject({ household_id: households[0]!.household_id });
  expect(accounts[0]).toMatchObject({ owner_id: people[0]!.person_id, opening_balance: household.cash });
  expect(model.objects.Income).toEqual([expect.objectContaining({
    owner_id: people[0]!.person_id, amount: income, start_date: fixture.start,
  })]);
  expect(model.objects.Expense).toEqual([expect.objectContaining({
    amount: fixture.monthlySpending, payment_account_id: accounts[0]!.account_id,
  })]);
  expect(model.objects.Scenario).toEqual([expect.objectContaining({ start_date: fixture.start, end_date: fixture.end })]);
  expect(model.objects.Investment ?? []).toHaveLength(0);
  return { model: model.modelId, account: accounts[0]!.account_id, household: households[0]!.household_id };
}

test("guided household edits and reopens at desktop size", async ({ page, context }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    await initialize(page, amber);
    const initial = await reconcile(page, amber);
    await navigateOwner(page, "Money", "Income");
    const card = page.locator("button.card-main").filter({ hasText: "Unnamed income" });
    await expect(card).toContainText("615.37");
    await card.focus();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Income" });
    const amount = editor.getByLabel("Amount", { exact: true });
    await amount.fill(amber.editedIncome);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(card).toContainText("615.37");
    await card.click();
    await amount.fill(amber.editedIncome);
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(card).toContainText("620.19");
    await clickFinancialDestination(page, "Overview");
    await page.screenshot({ path: evidencePath(info, "guided-desktop.png"), animations: "disabled" });
    await saveCurrentModel(page);
    await page.reload();
    await action(page, "Load saved model").click();
    expect(await reconcile(page, amber, amber.editedIncome)).toEqual(initial);
  } finally {
    await context.tracing.stop({ path: evidencePath(info, "guided-trace.zip") });
  }
});

test("entered zero income remains distinct from a blank input on mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await initialize(page, indigo, true);
  await reconcile(page, indigo);
  // Exercise required enlarged text on the actual authoring surface.
  await navigateOwner(page, "Money", "Income");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.locator("button.card-main").filter({ hasText: "Unnamed income" })).toContainText("0.00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidencePath(info, "guided-mobile-200.png"), animations: "disabled" });
});

for (const order of [[amber, indigo], [indigo, amber]] as const) {
  test(`fresh stores preserve account ownership with ${order[0].name} first`, async ({ browser }) => {
    test.setTimeout(60_000);
    const stores = [];
    for (const household of order) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await initialize(page, household);
        await saveCurrentModel(page);
        stores.push(await reconcile(page, household));
      } finally {
        await context.close();
      }
    }
    for (const key of ["model", "household", "account"] as const) expect(stores[0]![key]).not.toBe(stores[1]![key]);
  });
}
