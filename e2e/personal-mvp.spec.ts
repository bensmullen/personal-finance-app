import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { clickFinancialDestination, showReadiness, showForecastLimitations } from "./navigation.js";
import {
  addPersonalObject,
  createEmptyPersonalDraft,
  createGoldenHouseholdDraft,
  createSyntheticPersonalDraft,
  patchPersonalObject,
  exportPersonalModelJson,
  importPersonalModelJson,
  getPersonalPurchasePlans,
  getPayrollContributionPlans,
  getOpeningContributionUsage,
  getPayrollOpeningUnvestedUnits,
  authorPayrollContributionPlan,
  getHistoricalContributionScopes,
  getContributionCapacities,
  type JsonObject,
} from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS, createGoldenHouseholdForecastRequest } from "../src/application/goldenHousehold.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { runHouseholdKernel } from "../src/simulation/householdExecution.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { USD } from "../src/values/index.js";
import { forecastDiagnosticMessage } from "../ui/entityPresentation.js";
import { compileHouseholdTax } from "../src/application/compiler/tax.js";
import { resolveAnnualFinancialFact } from "../src/application/financialFacts.js";

const loadExample = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example" }).click();
  await expect(
    page.getByRole("heading", { name: "How am I doing?" }),
  ).toBeVisible();
};

// Overview keeps exact requested boundaries available through deliberate disclosure.
const expectOverviewRange = async (page: import("@playwright/test").Page, end: string) => {
  const range = page.locator(".chart-range");
  const wasOpen = await range.getAttribute("open") !== null;
  if (!wasOpen) await range.locator(":scope > summary").click();
  await expect(range.getByText("Requested start (inclusive)", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText(/^2026-01-01(?:T.*)?$/);
  await expect(range.getByText("Requested end (exclusive)", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText(new RegExp(`^${end}(?:T.*)?$`));
  await expect(range).toContainText("[start, end)");
  if (!wasOpen) await range.locator(":scope > summary").click();
};

test("U1 annual household filing facts have one accessible owner and survive reload", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const original = importPersonalModelJson(await readFile(new URL("../test/fixtures/d1-integrated-uat-model.json", import.meta.url), "utf8"));
  await importDraft(page, original);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Household & People", exact: true }).click();
  const owner = page.locator('[data-fact-owner="people"]');
  await owner.locator("summary").first().click();
  await owner.getByLabel("Annual facts year", { exact: true }).fill("2027");
  await owner.getByRole("button", { name: "Review annual household filing status", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Annual household filing status", exact: true });
  await dialog.getByLabel("Annual household filing status", { exact: true }).selectOption("married_joint");
  await dialog.getByRole("button", { name: "Confirm & save fact", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(owner).toContainText("Married filing jointly");
  await expect(owner).toContainText("Confirmed annual assumption");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await owner.getByRole("button", { name: "Review annual household filing status", exact: true }).click();
    const control = dialog.getByLabel("Annual household filing status", { exact: true });
    await control.focus();
    await expect(control).toBeFocused();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThan(120);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await dialog.getByRole("button", { name: "Help for Annual household filing status", exact: true }).click();
    await expect(dialog.getByRole("note").filter({ hasText: /complete calendar tax year/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`annual-filing-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(owner.getByRole("button", { name: "Review annual household filing status", exact: true })).toBeFocused();
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await pending;
  const restored = importPersonalModelJson(await readFile((await download.path())!, "utf8"));
  const scope = { personId: GOLDEN_HOUSEHOLD_IDS.person, householdId: GOLDEN_HOUSEHOLD_IDS.household, taxYear: 2027 };
  expect(resolveAnnualFinancialFact(restored, "filingStatus", scope)).toMatchObject({ status: "assumed", value: "married_joint" });
  const tax = compileHouseholdTax(restored, { asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2029-01-01", projectedCurrentLawThrough: "2029-01-01" });
  if (tax.status !== "compiled") throw new Error(JSON.stringify(tax.diagnostics));
  expect(tax.value.filingStatuses!["2027"]).toMatchObject({ status: "known", value: "married_joint" });
  expect(tax.value.filingStatuses!["2028"]!.status).toBe("missing");
  expect(restored.objects.Transaction).toEqual(original.objects.Transaction);
  expect(errors).toEqual([]);
});


const openContributions = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openAuthoringSections(page);
};
const openHoldingActivity = async (page: import("@playwright/test").Page, holdingId: string) => {
  await openContributions(page);
  for (const summary of await page.locator(".account-holdings > summary").all()) {
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  }
  const panel = page.locator(`[data-source-holding="${holdingId}"]`);
  const details = panel.locator("xpath=ancestor::details[1]");
  if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  return panel;
};
const openAuthoringSections = async (page: import("@playwright/test").Page) => {
  for (const title of ["IRA & brokerage contributions", "Workplace & HSA contributions", "Contributions already made this year", "Annual contribution allowance", "Other investment activity", "Extra mortgage payments & refinancing", "Debt & mortgage", "Investments", "Tax payments & refunds", "Employer vesting"]) {
    const summary = page.locator("summary").filter({ hasText: title }).filter({ hasNotText: "Help for" }).first();
    if (await summary.count() && await summary.isVisible() && await summary.locator("..").getAttribute("open") === null) await summary.click();
  }
};
const openEditorFinancialDetails = async (editor: import("@playwright/test").Locator) => {
  const summary = editor.locator("summary").filter({ hasText: /^Additional financial details$/ });
  if (await summary.count() && await summary.locator("..").getAttribute("open") === null) await summary.click();
};

const openReturnDetails = async (page: import("@playwright/test").Page) => {
  for (const summary of await page.locator(".account-holdings > summary").all()) {
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  }
  for (const summary of await page.locator("summary").filter({ hasText: /^Edit projected return$/ }).all()) {
    if (await summary.isVisible() && await summary.locator("..").getAttribute("open") === null) await summary.click();
  }
};
const openAnnualReview = async (region: import("@playwright/test").Locator) => {
  const summary = region.locator("summary").filter({ hasText: /^Annual eligibility ·/ }).first();
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
};
const editAnnualFact = async (page: import("@playwright/test").Page, region: import("@playwright/test").Locator, label: string, value: string, select = false) => {
  await openAnnualReview(region);
  await region.getByRole("button", { name: `Review ${label.toLowerCase()}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit ${label}`, exact: true });
  if (select) await dialog.getByLabel(label, { exact: true }).selectOption(value);
  else await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole("button", { name: "Confirm & save fact", exact: true }).click();
  await expect(dialog).toHaveCount(0);
};

const configureTaxSettlement = async (page: import("@playwright/test").Page) => {
  await openAuthoringSections(page);
  const panel = page.getByRole("region", { name: "Tax payments & refunds", exact: true });
  const confirmations = panel.getByRole("checkbox");
  if (await confirmations.count() === 0) return;
  await panel.getByLabel("Tax payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await panel.getByLabel("Tax refund account", { exact: true }).selectOption({ label: "Everyday checking" });
  for (const jurisdiction of ["US:FEDERAL", "US:NY"]) {
    const confirmation = panel.getByLabel(`Confirm ${jurisdiction} forecast settlement convention`, { exact: true });
    if (await confirmation.count() === 0) continue;
    await panel.getByRole("button", { name: `Suggest April 15 for ${jurisdiction === "US:FEDERAL" ? "Federal income tax" : "New York"}`, exact: true }).click();
    await expect(confirmation).not.toBeChecked();
    await confirmation.check();
  }
};

test("D1-B normal investment controls persist a bank-funded operation without compiler IDs", async ({ page }) => {
  const cryptoId = "d1b90000-0000-4000-8000-000000000001";
  const original = createGoldenHouseholdDraft();
  const draft = { ...original, objects: { ...original.objects, Investment: [...original.objects.Investment!, { investment_id: cryptoId, owner_id: GOLDEN_HOUSEHOLD_IDS.person, account_id: GOLDEN_HOUSEHOLD_IDS.brokerageAccount, investment_type: "crypto", name: "Spot crypto", symbol: "BTC", quantity: "0", price: "100", market_value: "0", currency: "USD" }] } };
  await importDraft(page, draft);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await openContributions(page);
  const panel = await openHoldingActivity(page, cryptoId);
  await panel.getByLabel("Activity type", { exact: true }).selectOption("purchase");
  await expect(panel.getByLabel("Source / target holding", { exact: true })).toHaveValue(cryptoId);
  await expect(panel.getByLabel("Source / target holding", { exact: true })).toBeDisabled();
  await panel.getByLabel("Operation date", { exact: true }).fill("2026-01-10");
  await panel.getByLabel("Operation cash amount", { exact: true }).fill("100");
  await panel.getByLabel("Units / call contracts", { exact: true }).fill("1");
  const funding = panel.getByLabel("Purchase / exercise funding account", { exact: true });
  await expect(funding.locator(`option[value="${GOLDEN_HOUSEHOLD_IDS.brokerageAccount}"]`)).toHaveCount(0);
  await funding.selectOption(GOLDEN_HOUSEHOLD_IDS.checking);
  await panel.getByRole("button", { name: "Save activity", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Activity saved.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await pending, restored = importPersonalModelJson(await readFile((await download.path())!, "utf8"));
  const primitive = (restored.objects.PrimitiveInstance ?? []).find(item => typeof item === "object" && item !== null && !Array.isArray(item) && typeof item.parameters === "object" && item.parameters !== null && !Array.isArray(item.parameters) && item.parameters.adapter === "d1-domain-operation/v1") as JsonObject;
  expect(primitive.parameters).toMatchObject({ kind: "purchase", amount: "100", cashAccountId: GOLDEN_HOUSEHOLD_IDS.checking, holdingId: cryptoId, quantity: "1" });
  const golden = createGoldenHouseholdForecastRequest().compiler;
  const compiled = compileHouseholdProjection(restored, { ...golden, cashFlow: { ...golden.cashFlow!, simulationEnd: "2026-02-01", months: 1 }, investments: { ...golden.investments!, simulationEnd: "2026-02-01", months: 1, purchaseInstructions: [] }, liabilities: { ...golden.liabilities!, simulationEnd: "2026-02-01", months: 1 } });
  expect(compiled.status, JSON.stringify(compiled)).toBe("compiled");
  if (compiled.status !== "compiled") throw new Error("Exported user operation did not compile");
  const result = runHouseholdKernel({ kernel: compiled.value.executionKernel!, resultTier: "detail", runContext: createRunContext({ runId: runId("d1b90000-0000-4000-8000-000000000002"), scenarioId: scenarioId(GOLDEN_HOUSEHOLD_IDS.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD }) });
  expect(result.state.positions[cryptoId]!.quantity.amount.toString()).toBe("1");
  expect(result.state.positions[cryptoId]!.carryingValue.amount.toString()).toBe("100");
  const purchase = result.periods.flatMap(period => period.transactions).find(tx => tx.type === "purchase" && tx.id.startsWith("domain:"));
  expect(purchase?.legs.filter(leg => leg.type === "cash").map(leg => [leg.accountId, leg.posting, leg.amount.amount.toString()])).toEqual([[GOLDEN_HOUSEHOLD_IDS.checking, "credit", "100"]]);
});

const showHouseholdDetails = async (page: import("@playwright/test").Page, channel: "baseline" | "comparison" = "baseline", forecastBudget = 15_000) => {
  const status = page.getByRole("status", { name: channel === "baseline" ? "Household forecast status" : "Household comparison status" });
  await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/, { timeout: forecastBudget });
  const details = page.getByRole("button", { name: channel === "baseline" ? "Show forecast details" : /Show .* comparison details/ });
  if (await details.count()) await details.first().click();
  if (channel === "comparison") await page.getByText("Expert comparison details", { exact: true }).first().click();
};

// Interaction tests need a few periods, not the full Golden retirement horizon.
const useShortHorizon = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-04-01");
};

const openPlanDetails = async (page: import("@playwright/test").Page) => {
  await expect(page.getByRole("heading", { name: "Forecast setup", exact: true })).toBeVisible();
  for (const name of ["Technical retirement binding override", "Expert standalone forecasts"]) {
    const summary = page.locator("summary").filter({ hasText: new RegExp(`^${name}$`) });
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  }
};

const openIncomeOwner = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  return page.getByRole("region", { name: "Income deposit routing", exact: true });
};
const openDebtOwner = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await openAuthoringSections(page);
  return page.getByRole("group", { name: "Example mortgage", exact: true });
};
const returnToCurrentPlan = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
};
/** Exercise each sole source editor, then return to run-level setup. */
const configureOwnedFunding = async (page: import("@playwright/test").Page, options: { missingIncome?: boolean; calculateSchedule?: boolean } = {}) => {
  const income = (await openIncomeOwner(page)).getByLabel("Income receiving account", { exact: true });
  if (options.missingIncome) await expect(income).toHaveAttribute("aria-invalid", "true");
  await income.selectOption({ label: "Everyday checking" });
  const mortgage = await openDebtOwner(page);
  await page.getByLabel("Debt owner", { exact: true }).selectOption({ label: "Taylor Example" });
  await mortgage.getByLabel("First monthly payment", { exact: true }).fill("2022-02-01");
  if (options.calculateSchedule) await mortgage.getByRole("button", { name: "Calculate schedule: use 360 payments from first payment through recorded maturity", exact: true }).click();
  else await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("360");
  await expect(mortgage.getByLabel("Number of monthly payments", { exact: true })).toHaveValue("360");
  await mortgage.getByLabel("Mortgage payment account", { exact: true }).selectOption({ label: "Everyday checking" });
  await mortgage.getByLabel("Same-day mortgage order", { exact: true }).fill("1");
  await returnToCurrentPlan(page);
  await page.getByRole("region", { name: "Household execution configuration", exact: true }).getByLabel("Investment owner", { exact: true }).selectOption({ label: "Taylor Example" });
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

const rawUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test("U1 insurance has one policy owner, optional shared life events and durable legacy links", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const original = importPersonalModelJson(await readFile(new URL("../test/fixtures/d1-integrated-uat-model.json", import.meta.url), "utf8"));
  const legacy = original.objects.Insurance![0] as JsonObject;
  await importDraft(page, original);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Insurance & coverage", exact: true }).click();
  const insurance = page.getByRole("region", { name: "Insurance & coverage", exact: true });
  await insurance.getByRole("button", { name: "Edit policy", exact: true }).click();
  const editor = page.getByRole("region", { name: "Edit term-life policy", exact: true });
  await editor.getByLabel("Monthly premium", { exact: true }).fill("60");
  await editor.getByRole("button", { name: "Save term-life policy", exact: true }).click();
  await insurance.getByRole("button", { name: "Add term-life policy", exact: true }).click();
  await editor.getByLabel("Policy owner", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.person);
  await editor.getByLabel("Insured person", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.person);
  await editor.getByLabel("Benefit beneficiary", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.household);
  await editor.getByLabel("Premium checking / savings account", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.checking);
  await editor.getByLabel("Benefit checking / savings account", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.savings);
  await editor.getByLabel("Monthly premium", { exact: true }).fill("25.50");
  await editor.getByLabel("Lump-sum benefit", { exact: true }).fill("200000");
  await editor.getByLabel("Policy start", { exact: true }).fill("2026-01-01");
  await editor.getByLabel("Policy end (exclusive)", { exact: true }).fill("2027-01-01");
  await expect(editor.getByLabel("Scheduled insured death date", { exact: true })).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const input of await editor.locator("input, select").all()) {
      const box = await input.boundingBox();
      expect(box!.width).toBeGreaterThan(120);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      const shell = input.locator('xpath=ancestor::*[@data-semantic-family][1]');
      await expect(shell).toHaveCount(1);
      expect(await shell.getAttribute("data-semantic-family")).toMatch(/^insurance\.term_life_/);
    }
    await editor.getByRole("button", { name: "Help for Lump-sum benefit", exact: true }).click();
    await expect(editor.getByRole("note").filter({ hasText: "not a current asset" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const policyCard = insurance.getByRole("article").first();
    const cardBox = await policyCard.boundingBox();
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`insurance-policy-${width}.png`), fullPage: true });
    await editor.getByRole("button", { name: "Help for Lump-sum benefit", exact: true }).click();
  }
  await editor.getByRole("button", { name: "Save term-life policy", exact: true }).click();
  await expect(insurance).toContainText("200,000 USD");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const restored = importPersonalModelJson(await readFile((await (await pending).path())!, "utf8"));
  const policies = restored.objects.Insurance as readonly JsonObject[];
  expect(policies).toHaveLength(2);
  expect(policies.find(item => item.insurance_id === legacy.insurance_id)).toMatchObject({ ...legacy, premium: "60" });
  expect(policies.find(item => item.insurance_id !== legacy.insurance_id)).not.toHaveProperty("death_event_id");
  expect(restored.objects.Event).toEqual(original.objects.Event);
  expect(restored.objects.Scenario).toEqual(original.objects.Scenario);
  expect(restored.objects.Expense).toEqual(original.objects.Expense);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Insurance & coverage", exact: true }).click();
  for (const summary of await insurance.locator("summary").filter({ hasText: /^Payment & scenario details$/ }).all()) await summary.click();
  await insurance.getByRole("button", { name: "Add optional death scenario", exact: true }).click();
  const life = page.getByRole("region", { name: "Edit insured death scenario", exact: true });
  await life.getByLabel("Scheduled insured death date", { exact: true }).fill("2026-06-01");
  await life.getByRole("button", { name: "Save life event", exact: true }).click();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Life Events", exact: true }).click();
  await page.getByRole("region", { name: "Insured life events", exact: true }).getByRole("button", { name: "Review life event", exact: true }).last().click();
  await expect(life.getByLabel("Scheduled insured death date", { exact: true })).toHaveValue("2026-06-01");
  await expect(life.locator('[data-semantic-family="life.death_event"]')).toHaveCount(3);
  expect(errors).toEqual([]);
});

const openSalaryFacts = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button").filter({ has: page.locator("strong", { hasText: /^Example salary$/ }) }).click();
  const drawer = page.getByRole("dialog", { name: "Edit Income" });
  await expect(drawer.getByRole("heading", { name: "Example salary" })).toBeVisible();
  await drawer.getByText("Entity IDs", { exact: true }).click();
  await expect(drawer.locator("dd").filter({ hasText: '"allocation": "1"' }).first()).toBeVisible();
  await drawer.getByRole("button", { name: "Close editor", exact: true }).click();
};

test("D1 UAT example, import, guided setup, edits and readable account/rate controls", async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await loadExample(page);
  await openSalaryFacts(page);
  await useShortHorizon(page);
  const status = page.getByRole("status", { name: "Household forecast status" });
  await expect(status).toHaveAttribute("data-lifecycle", "incomplete");
  await expect(status).toContainText("Partially modeled");
  await expect(status).toContainText("New York");
  await expect(status).not.toContainText("Tax filing status is missing");
  const originalRequest = await status.getAttribute("data-request-id");
  await showForecastLimitations(page);
  await expect(status.locator("[data-diagnostic-root]").first()).toBeVisible();
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
  const retirementCard = page.getByRole("article").filter({ has: page.locator("strong").filter({ hasText: /^Workplace retirement$/ }) });
  await expect(retirementCard).toContainText("Total account value: 100,000 USD");
  await expect(retirementCard).toContainText("Cash inside account: 0 USD");
  await expect(retirementCard).toContainText("Investments/holdings: 100,000 USD");
  await expect(page.getByRole("article").filter({ has: page.locator("strong").filter({ hasText: /^Taxable brokerage$/ }) })).toContainText("Total account value: 50,000 USD");

  // Import in this running session, rather than navigating to a fresh app.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/d1-integrated-uat-model.json");
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await expect(status).toHaveAttribute("data-lifecycle", "idle");
  await expect(status).toHaveAttribute("data-pending", "false");
  expect(await status.getAttribute("data-request-id")).toBeNull();
  await expect(page.locator("[data-diagnostic-root]")).toHaveCount(0);
  await expect(page.getByText(/Old result|Stale retained result/)).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toHaveCount(0);
  await openSalaryFacts(page);
  const checklist = page.getByRole("region", { name: "Forecast setup checklist" });
  await showReadiness(page);
  for (const missing of ["Income receiving account", "Investment owner", "Debt owner", "first monthly payment", "number of monthly payments", "mortgage payment account", "same-day mortgage order"]) {
    await expect(checklist).toContainText(missing);
  }
  await expect(checklist).toContainText("clears session-only forecast choices");
  await checklist.getByRole("button", { name: "Complete forecast setup", exact: true }).click();
  const configuration = page.getByRole("region", { name: "Household execution configuration" });
  await configureOwnedFunding(page, { missingIncome: true });
  await configureTaxSettlement(page);
  await expect(checklist).toContainText("Required choices are complete");
  await configuration.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  await expect(status).toHaveAttribute("data-lifecycle", "incomplete");
  await expect(status).not.toHaveAttribute("data-request-id", originalRequest!);
  await expect(status).toContainText("New York");
  await openContributions(page);
  await expect(page.getByRole("region", { name: "Saved payroll contributions" })).toContainText("employer hsa");
  const roots = await status.locator("[data-diagnostic-root]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-diagnostic-root")));
  expect(new Set(roots).size).toBe(roots.length);
  await expect(page.getByRole("button", { name: "Update forecast", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await showHouseholdDetails(page);
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible();

  // An ordinary economic edit reuses the applied configuration and reruns.
  const beforeEdit = await status.getAttribute("data-request-id");
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
  const baselineReturn = page.getByRole("region", { name: "Projected return for RETIREMENT-DEMO" });
  await baselineReturn.getByLabel("Projected annual return", { exact: true }).fill("8");
  await baselineReturn.getByRole("button", { name: "Apply projected return", exact: true }).click();
  await expect(status).not.toHaveAttribute("data-request-id", beforeEdit!);
  await expect(status).toHaveAttribute("data-lifecycle", "incomplete");
  await expect(status).toHaveAttribute("data-pending", "false");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
    await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
    await openContributions(page);
    const payroll = page.getByRole("region", { name: "Saved payroll contributions" });
    await payroll.getByLabel("Payroll destination", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.retirementInvestment);
    const rate = payroll.getByLabel("Payroll contribution rate", { exact: true });
    await expect(rate).toHaveValue("5");
    await rate.fill("5.25");
    await expect(rate).toHaveValue("5.25");
    await openAnnualReview(payroll);
    const help = payroll.getByRole("button", { name: "Help for Annual pay eligible for this plan" });
    await help.focus(); await page.keyboard.press("Enter");
    await expect(payroll.getByRole("note").filter({ hasText: /Full-year pay counted/ })).toBeVisible();
    await expect(help).toHaveAttribute("title", /108000/);
    for (const helpName of ["Help for Last year's pay from this employer", "Help for Employer / plan group", "Help for When a contribution exceeds the limit"]) {
      await payroll.getByRole("button", { name: helpName, exact: true }).click();
    }
    await payroll.getByText("Advanced payroll ordering", { exact: true }).click();
    await payroll.getByRole("button", { name: "Help for Same-paycheck contribution order", exact: true }).click();
    await expect(payroll.getByRole("note").filter({ hasText: /[Ll]ower.*first/ })).toBeVisible();
    const purchases = page.getByRole("region", { name: "Saved investment purchases" });
    await openAuthoringSections(page);
    await purchases.getByText("Advanced same-day purchase ordering", { exact: true }).click();
    await purchases.getByRole("button", { name: "Help for Same-day purchase order", exact: true }).click();
    await expect(purchases.getByRole("note").filter({ hasText: /[Ll]ower.*first/ })).toBeVisible();
    await payroll.getByRole("button", { name: "Help for Age at year end", exact: true }).click();
    await expect(payroll.getByRole("note").filter({ hasText: /Age on December 31/ })).toBeVisible();
    const rateBox = await rate.boundingBox();
    expect(rateBox!.width).toBeGreaterThan(120);
    expect(rateBox!.x + rateBox!.width).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Investing", exact: true }).click();
    await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
    for (const symbol of ["RETIREMENT-DEMO", "BROKERAGE-DEMO"]) {
      const card = page.getByRole("button", { name: `Edit holding ${symbol}`, exact: true }).locator("..");
      const summary = await card.locator("[data-card-summary]").boundingBox();
      expect(summary!.width).toBeGreaterThan(150);
      expect((await card.locator("[data-card-summary] strong").boundingBox())!.height).toBeLessThan(60);
      await expect(card.getByRole("button", { name: /^Manage contributions/ }).first()).toBeVisible();
    }
    const returns = page.getByRole("region", { name: "Projected return for RETIREMENT-DEMO" });
    const returnInput = returns.getByLabel("Projected annual return", { exact: true });
    const labelBox = await returnInput.locator("..").locator(".field-heading label").boundingBox();
    expect(labelBox!.width).toBeGreaterThan(100);
    expect(labelBox!.height).toBeLessThan(80);
    expect((await returnInput.boundingBox())!.x + (await returnInput.boundingBox())!.width).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});

test("D1 resolved decisions extend plan dates, guide tax setup and continue projected ten-year contributions", async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await loadExample(page);
  await openSalaryFacts(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  const dates = page.getByRole("region", { name: "Current Plan horizon" });
  await dates.getByLabel("Simulation end", { exact: true }).fill("2037-01-01");
  await expect(dates).toContainText("exceeds Current plan end 2036-01-01");
  await dates.getByLabel("Simulation end", { exact: true }).fill("2036-01-01");
  await dates.getByLabel("Current plan end", { exact: true }).fill("2037-01-01");
  await dates.getByRole("button", { name: "Apply Current Plan dates", exact: true }).click();
  await expect(dates).toContainText("Available simulation range: 2026-01-01 → 2037-01-01");
  await expect(dates.getByLabel("Simulation end", { exact: true })).toHaveValue("2036-01-01");
  await dates.getByLabel("Simulation end", { exact: true }).fill("2037-01-01");
  await expect(dates.getByText(/exceeds Current plan end/)).toHaveCount(0);
  await dates.getByLabel("Simulation end", { exact: true }).fill("2036-01-01");
  // The normal example has no recurring statutory contribution. Missing future
  // tax law should remain scoped incompleteness, not truncate economic execution.
  const status = page.getByRole("status", { name: "Household forecast status" });
  await expect(status).toHaveAttribute("data-pending", "false");
  await expect(page.getByText("Completed through 2036-01-01 · Some outputs are partially modeled", { exact: true })).toBeVisible();
  const mortgage = await openDebtOwner(page);
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("359");
  await expect(mortgage).toContainText("Schedule mismatch");
  const correction = page.getByRole("region", { name: "Required forecast corrections" }).getByRole("button", { name: /Schedule differs from recorded maturity/ });
  await expect(correction).toBeVisible();
  await correction.click();
  await expect(mortgage.getByLabel("Number of monthly payments", { exact: true })).toBeFocused();
  await expect(mortgage.getByRole("button", { name: "Use calculated contractual maturity 2051-12-01", exact: true })).toBeVisible();
  await mortgage.getByRole("button", { name: "Use calculated contractual maturity 2051-12-01", exact: true }).click();
  await expect(mortgage).toContainText("Contractual final payment / maturity: 2051-12-01");
  await mortgage.getByLabel("Number of monthly payments", { exact: true }).fill("360");
  await mortgage.getByRole("button", { name: "Use calculated contractual maturity 2052-01-01", exact: true }).click();
  await expect(mortgage).toContainText("Calculated final scheduled payment: 2052-01-01");
  await expect(mortgage.getByText(/Schedule mismatch/)).toHaveCount(0);
  const operations = page.getByRole("region", { name: "Mortgage operations" });
  await operations.getByLabel("Activity type", { exact: true }).selectOption("mortgage_extra");
  await operations.getByLabel("Mortgage for extra principal", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.mortgage);
  await operations.getByLabel("Extra principal checking / savings account", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.checking);
  await operations.getByLabel("Operation date", { exact: true }).fill("2031-01-01");
  await operations.getByLabel("Operation cash amount", { exact: true }).fill("300000");
  await operations.getByRole("button", { name: "Save activity", exact: true }).click();
  await returnToCurrentPlan(page);
  await expect(page.getByRole("region", { name: "Projected mortgage payoff" })).toContainText("2031-01-01", { timeout: 30_000 });
  await openDebtOwner(page);
  await expect(mortgage).toContainText("Contractual final payment / maturity: 2052-01-01");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles("test/fixtures/d1-integrated-uat-model.json");
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await openSalaryFacts(page);
  const manage = async (accountName: string, symbol: string) => {
    await page.getByRole("button", { name: "Investing", exact: true }).click();
    await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
    const card = page.getByRole("article").filter({ has: page.locator("strong", { hasText: new RegExp(`^${accountName}$`) }) });
    await expect(card).toContainText("Saved future contributions");
    await card.getByRole("region", { name: `Contributions for ${accountName}`, exact: true }).getByRole("button", { name: `Manage contributions to ${symbol}`, exact: true }).click();
  };
  await manage("Personal Roth IRA", "IRA-DEMO");
  const purchases = page.getByRole("region", { name: "Saved investment purchases" });
  await expect(purchases.getByLabel("Purchase investment", { exact: true })).toHaveValue("d1cc0000-0000-4000-8000-000000000002");
  await purchases.getByLabel("Purchase amount", { exact: true }).fill("501");
  await purchases.getByLabel("Purchase frequency", { exact: true }).selectOption("monthly");
  await openAnnualReview(purchases);
  const iraAssumption = purchases.locator("summary").filter({ hasText: /^Annual eligibility ·/ }).locator("..");
  await expect(iraAssumption.getByRole("checkbox")).toHaveCount(0);
  await expect(iraAssumption).toContainText("Later years need their own dated facts.");
  await purchases.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await expect(purchases).toContainText("501");
  await manage("Health savings investments", "HSA-EMPLOYEE");
  const payroll = page.getByRole("region", { name: "Saved payroll contributions" });
  await expect(payroll.getByLabel("Payroll destination", { exact: true })).toHaveValue("d1cc0000-0000-4000-8000-000000000005");
  await payroll.getByLabel("Payroll contribution amount", { exact: true }).fill("101");
  await openAnnualReview(payroll);
  const hsaAssumption = payroll.locator("summary").filter({ hasText: /^Annual eligibility ·/ }).locator("..");
  await expect(hsaAssumption.getByRole("checkbox")).toHaveCount(0);
  await expect(hsaAssumption).toContainText("Later years need their own dated facts.");
  await payroll.getByRole("button", { name: "Save payroll contribution", exact: true }).click();
  // Export and inspect the same authoritative plans, proving contextual routes
  // updated existing plans rather than introducing duplicate economic routes.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await downloading;
  const restored = importPersonalModelJson(await readFile((await download.path())!, "utf8"));
  const ira = getPersonalPurchasePlans(restored).filter(plan => plan.investmentId === "d1cc0000-0000-4000-8000-000000000002");
  expect(ira).toHaveLength(1); expect(ira[0]!.amount).toBe("501");
  expect(ira[0]!.contribution!.facts.annualFactProjection).toBeUndefined();
  const hsa = getPayrollContributionPlans(restored).filter(plan => plan.allocation.positionId === "d1cc0000-0000-4000-8000-000000000005");
  expect(hsa).toHaveLength(1); expect(hsa[0]!.allocation.calculation).toMatchObject({ kind: "fixed", amount: expect.objectContaining({}) });
  expect(hsa[0]!.allocation.policy.facts.annualFactProjection).toBeUndefined();
  if (hsa[0]!.allocation.calculation.kind === "fixed") expect(hsa[0]!.allocation.calculation.amount.amount.toString()).toBe("101");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  const configuration = page.getByRole("region", { name: "Household execution configuration" });
  await configureOwnedFunding(page, { calculateSchedule: true });
  await configureTaxSettlement(page);
  await configuration.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  // Projected statutory law cannot supply a household's future filing facts.
  // Confirm this synthetic household's 2027 assumption through its sole editor;
  // all other future annual eligibility facts intentionally remain unknown.
  await showForecastLimitations(page);
  await status.getByRole("button", { name: "Review 2027 filing status · Taylor Example", exact: true }).click();
  const filing = page.getByRole("dialog", { name: "Edit Annual household filing status", exact: true });
  await filing.getByLabel("Annual household filing status", { exact: true }).selectOption("single");
  const beforeFilingRequest = await status.getAttribute("data-request-id");
  await filing.getByRole("button", { name: "Confirm & save fact", exact: true }).click();
  await expect(filing).toHaveCount(0);
  await expect(status).not.toHaveAttribute("data-request-id", beforeFilingRequest!, { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  await showForecastLimitations(page);
  await expect(status.getByRole("button", { name: "Review 2028 filing status · Taylor Example", exact: true })).toBeVisible();
  await expect(page.getByRole("alert", { name: "Forecast stopped early" })).toHaveCount(0);
  await expect(page.getByText("Completed through 2036-01-01 · Some outputs are partially modeled", { exact: true })).toBeVisible();
  await showHouseholdDetails(page);
  const basis = page.getByRole("region", { name: "Projected law forecast basis" });
  await expect(basis).toContainText("US:FEDERAL: 2026 source rules projected from 2027-01-01");
  await openContributions(page);
  // Future capacity rows require committed eligible contributions; projected
  // tax law and one filing fact cannot create an annual contribution allowance.
  const capacity = page.getByRole("region", { name: "Contribution capacity" });
  await expect(capacity).not.toContainText("Projected current law");
  await expect(capacity.locator("tbody tr").filter({ hasText: /\/ 2027\b/ })).toHaveCount(0);
  await expect(status).not.toContainText("Tax payments & refunds: choose");
  await expect(status).toContainText("New York");
  await expect(status).toContainText("Future contribution eligibility is not established for 2027.");
  await expect(status).toContainText("Affected contributions are skipped; wages and other household activity continue");
  const primaryMessages = await status.locator("[data-diagnostic-root]").allTextContents();
  expect(new Set(primaryMessages).size).toBe(primaryMessages.length);
  await showForecastLimitations(page);
  await status.getByText("Technical diagnostic details", { exact: true }).click();
  const roots = await status.locator("details details > summary").allTextContents();
  expect(roots.filter(root => root.includes("PFA-TAX-009")).every(root => /rule_selection|local_residence_jurisdiction|canonical_rule_reference|payment_funding|settlement_timing|legal_base_or_component|projected_current_law|contribution_jurisdiction_base|contribution_annual_facts|filing_status|term_life/.test(root))).toBe(true);
  expect(roots.some(root => root.includes("contribution_annual_facts"))).toBe(true);
  expect(errors).toEqual([]);
});

test("D1-C authors, saves, reloads and runs a combined household through normal controls", async ({ page }, testInfo) => {
  const uatJson = await readFile(new URL("../test/fixtures/d1-integrated-uat-model.json", import.meta.url), "utf8");
  await importDraft(page, importPersonalModelJson(uatJson));
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-02-01");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await openContributions(page);
  const operations = await openHoldingActivity(page, GOLDEN_HOUSEHOLD_IDS.brokerageInvestment);
  // The ordinary sales control consumes the same opening lot as the combined
  // arithmetic fixture. No compiler IDs or JSON are entered in the product.
  await operations.getByLabel("Activity type", { exact: true }).selectOption("sale");
  await expect(operations.getByLabel("Source / target holding", { exact: true })).toHaveValue(GOLDEN_HOUSEHOLD_IDS.brokerageInvestment);
  await operations.getByLabel("Operation date", { exact: true }).fill("2026-01-23");
  await operations.getByLabel("Operation cash amount", { exact: true }).fill("550");
  await operations.getByLabel("Units / call contracts", { exact: true }).fill("5");
  await operations.getByRole("button", { name: "Save activity", exact: true }).click();
  await expect(operations.getByRole("status")).toContainText("Activity saved.");
  await expect(operations.getByLabel("Activity type", { exact: true }).locator('option[value="put"]')).toHaveCount(0);
  await expect(operations.getByLabel("Source / target holding", { exact: true })).toBeDisabled();
  await expect(operations.getByLabel("Activity type", { exact: true }).locator('option[value="call_exercise"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Canonical model saved to this browser")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const exported = await readFile((await (await pending).path())!, "utf8");
  await testInfo.attach("d1-integrated-uat-model.json", { body: Buffer.from(exported), contentType: "application/json" });
  const restored = importPersonalModelJson(exported);
  expect(getPayrollContributionPlans(restored)).toHaveLength(4);
  expect(getPersonalPurchasePlans(restored)).toHaveLength(2);
  expect(restored.objects.Insurance).toHaveLength(1);

  await page.reload();
  await page.getByRole("button", { name: "Load saved model" }).click();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-02-01");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await openContributions(page);
  await openHoldingActivity(page, GOLDEN_HOUSEHOLD_IDS.brokerageInvestment);
  await expect(operations).toContainText("Sell investment · 2026-01-23");
  await returnToCurrentPlan(page);
  await openContributions(page);
  const payroll = page.getByRole("region", { name: "Saved payroll contributions" });
  await expect(payroll).toContainText("traditional 401k");
  await expect(payroll).toContainText("employer hsa");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await expect(page.getByRole("heading", { name: "Forecast setup", exact: true })).toBeVisible();
  const configuration = page.getByRole("region", { name: "Household execution configuration" });
  await expect(configuration.getByLabel("Income receiving account", { exact: true })).toHaveCount(0);
  await expect((await openIncomeOwner(page)).getByLabel("Income receiving account", { exact: true })).toHaveValue("");
  await returnToCurrentPlan(page);
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toHaveCount(0);
  await configureOwnedFunding(page);
  await configureTaxSettlement(page);
  await configuration.getByRole("button", { name: "Apply setup & run forecast" }).click();
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  await showHouseholdDetails(page);
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible();
  // Exercise the supported-floor boundary through the mortgage activity form.
  await openDebtOwner(page);
  const mortgageOperations = page.getByRole("region", { name: "Mortgage operations" });
  await mortgageOperations.getByLabel("Activity type", { exact: true }).selectOption("refinance");
  await mortgageOperations.getByLabel("Mortgage to replace", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.mortgage);
  await mortgageOperations.getByLabel("Operation date", { exact: true }).fill("2026-01-15");
  await mortgageOperations.getByLabel("Replacement nominal annual rate", { exact: true }).fill("4");
  await mortgageOperations.getByRole("button", { name: "Save activity", exact: true }).click();
  await returnToCurrentPlan(page);
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  const unsupported = page.getByRole("status", { name: "Household forecast status" });
  await expect(unsupported).toHaveAttribute("data-lifecycle", "unsupported");
  await expect(unsupported.locator(".forecast-primary-guidance")).toContainText(/scheduled monthly.*payment date/);
  await expect(unsupported.locator(".forecast-primary-guidance")).toBeVisible();
  await expect(unsupported).toContainText("Old result — inputs changed; these numbers are not current.");
  await expect(unsupported.locator(".forecast-guidance")).not.toHaveAttribute("open");
  await expect(unsupported.locator("[data-diagnostic-root]:visible")).toHaveCount(0);
  await unsupported.getByRole("button", { name: "Review saved refinance", exact: true }).click();
  await expect(mortgageOperations).toBeVisible();
  await expect(mortgageOperations).toBeFocused();
  await expect(mortgageOperations).toContainText("2026-01-15");
  await expect(mortgageOperations.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
});

test("D1 authors former-employer YTD history without a future contribution instruction", async ({ page }) => {
  page.setDefaultTimeout(5_000);
  const golden = createGoldenHouseholdDraft();
  const object = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
  const model = authorPayrollContributionPlan({ ...golden, objects: { ...golden.objects, Account: golden.objects.Account!.map(value => object(value) && value.account_id === GOLDEN_HOUSEHOLD_IDS.brokerageAccount ? { ...value, account_type: "traditional_401k", tax_treatment: "tax_deferred" } : value) } }, { primitiveId: "d1c80000-0000-4000-8000-000000000001", investmentId: GOLDEN_HOUSEHOLD_IDS.retirementInvestment, incomeId: GOLDEN_HOUSEHOLD_IDS.income, priority: 10, character: "traditional_401k", calculation: { kind: "fixed", amount: "1000" }, planKey: "employer-b", vestedFraction: "1", excessPolicy: "auto_cap", facts: { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: "100000" } });
  await importDraft(page, model); await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await openContributions(page);
  const prior = page.getByRole("region", { name: "Prior year-to-date contributions" });
  await prior.getByLabel("YTD forecast boundary", { exact: true }).fill("2026-07-01");
  await prior.getByRole("checkbox").check();
  await expect(prior.getByRole("button", { name: "Save prior YTD usage", exact: true })).toBeDisabled();
  await expect(prior.getByRole("alert").filter({ hasText: "Define the historical account" })).toBeVisible();
  await prior.getByLabel("Historical holding", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.brokerageInvestment);
  await prior.getByLabel("Employer / plan group", { exact: true }).fill("employer-a");
  await editAnnualFact(page, prior, "Annual pay eligible for this plan", "100000");
  await prior.getByRole("button", { name: "Save historical scope", exact: true }).click();
  await prior.getByLabel("YTD forecast boundary", { exact: true }).fill("2026-07-01");
  await prior.getByRole("textbox", { name: /traditional 401k · 2026 prior YTD total$/ }).first().fill("20000");
  await prior.getByRole("textbox", { name: /traditional 401k · 2026 prior YTD amount excluding catch-up$/ }).first().fill("20000");
  await prior.getByRole("checkbox").check();
  await prior.getByRole("button", { name: "Save prior YTD usage", exact: true }).click();
  await expect(prior.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Contribution capacity" })).toContainText("4500");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const promise = page.waitForEvent("download"); await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await promise, restored = importPersonalModelJson(await readFile((await download.path())!, "utf8"));
  expect(getPayrollContributionPlans(restored)).toHaveLength(1);
  expect(getPersonalPurchasePlans(restored)).toEqual([]);
  expect(getHistoricalContributionScopes(restored)).toMatchObject([{ investmentId: GOLDEN_HOUSEHOLD_IDS.brokerageInvestment }]);
  expect(getContributionCapacities(restored).find(row => row.accountId === GOLDEN_HOUSEHOLD_IDS.retirementAccount && row.bucketIdentity.includes("401k_additions:employer-b"))).toMatchObject({ openingUsage: "0", remaining: "72000" });
});

test("D1 saves an authored brokerage purchase in the canonical export", async ({ page }) => {
  page.setDefaultTimeout(5_000);
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await openContributions(page);
  await page.getByLabel("Purchase investment", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.brokerageInvestment);
  await page.getByLabel("Purchase funding account", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.savings);
  await page.getByLabel("Purchase amount", { exact: true }).fill("125");
  await page.getByLabel("Purchase start date", { exact: true }).fill("2026-02-10");
  await page.getByLabel("Purchase frequency", { exact: true }).selectOption("monthly");
  await page.getByRole("button", { name: "Save investment purchase", exact: true }).click();
  await expect(page.getByText(/Saved purchase:.*125.*monthly/)).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await downloadPromise;
  const restored = importPersonalModelJson(await readFile((await download.path())!, "utf8"));
  expect(getPersonalPurchasePlans(restored)).toMatchObject([{ investmentId: GOLDEN_HOUSEHOLD_IDS.brokerageInvestment, sourceCashAccountId: GOLDEN_HOUSEHOLD_IDS.savings, amount: "125", schedule: { kind: "utc_monthly", anchor: "2026-02-10", invalidDayPolicy: "skip" } }]);
});

test("D1 normal payroll authoring preserves allocations and shared limit identities", async ({ page }) => {
  page.setDefaultTimeout(5_000);
  await loadExample(page); await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await openContributions(page);
  const form = page.getByRole("region", { name: "Saved payroll contributions" });
  await form.getByLabel("Payroll destination", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.retirementInvestment);
  await form.getByLabel("Payroll salary", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.income);
  await form.getByLabel("Payroll contribution rate", { exact: true }).fill("5");
  await form.getByLabel("Employer / plan group", { exact: true }).fill("example-sponsor");
  await editAnnualFact(page, form, "Annual pay eligible for this plan", "120000");
  await openAuthoringSections(page);
  await form.getByLabel("Opening unvested employer units", { exact: true }).fill("100");
  await form.getByRole("button", { name: "Save payroll contribution", exact: true }).click();
  await expect(form.getByText(/Saved payroll: traditional 401k/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Contribution capacity" })).toContainText("24500");
  const priorUsage = page.getByRole("region", { name: "Prior year-to-date contributions" });
  await priorUsage.getByLabel("YTD forecast boundary", { exact: true }).fill("2026-07-01");
  await priorUsage.getByRole("textbox", { name: /traditional 401k · 2026 prior YTD total$/ }).fill("10000");
  await priorUsage.getByRole("textbox", { name: /traditional 401k · 2026 prior YTD amount excluding catch-up$/ }).fill("10000");
  await priorUsage.getByRole("checkbox").check();
  await priorUsage.getByRole("button", { name: "Save prior YTD usage", exact: true }).click();
  await expect(page.getByRole("region", { name: "Contribution capacity" })).toContainText("14500");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const promise = page.waitForEvent("download"); await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await promise, restored = importPersonalModelJson(await readFile((await download.path())!, "utf8"));
  const plans = getPayrollContributionPlans(restored);
  expect(plans).toMatchObject([{ incomeId: GOLDEN_HOUSEHOLD_IDS.income, allocation: { positionId: GOLDEN_HOUSEHOLD_IDS.retirementInvestment, calculation: { kind: "percent", rate: "0.05" }, policy: { character: "traditional_401k", excessPolicy: "reject" } } }]);
  expect(plans[0]!.allocation.policy.limits.some(binding => binding.bucketKey === "401k_additions:example-sponsor")).toBe(true);
  expect(getPayrollOpeningUnvestedUnits(restored, GOLDEN_HOUSEHOLD_IDS.retirementInvestment)).toBe("100");
  expect(getOpeningContributionUsage(restored)).toMatchObject({ asOf: "2026-07-01", allPriorUsageKnown: true, entries: expect.arrayContaining([{ id: expect.any(String), investmentId: GOLDEN_HOUSEHOLD_IDS.retirementInvestment, character: "traditional_401k", amount: "10000", ordinaryAmount: "10000" }]) });
});

test("D1 normal IRA authoring saves annual facts and explicit auto-cap", async ({ page }) => {
  page.setDefaultTimeout(5_000);
  const original = createGoldenHouseholdDraft();
  const object = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
  const draft = { ...original, objects: { ...original.objects, Account: original.objects.Account!.map(value => object(value) && value.account_id === GOLDEN_HOUSEHOLD_IDS.brokerageAccount ? { ...value, account_type: "roth_ira", tax_treatment: "tax_free" } : value) } };
  await importDraft(page, draft); await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page); await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await openContributions(page);
  const form = page.getByRole("region", { name: "Saved investment purchases" });
  await form.getByLabel("Purchase investment", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.brokerageInvestment);
  await form.getByLabel("Purchase funding account", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.savings);
  await form.getByLabel("Purchase amount", { exact: true }).fill("8000"); await form.getByLabel("Purchase start date", { exact: true }).fill("2026-02-10");
  await form.getByLabel("Purchase frequency", { exact: true }).selectOption("once");
  await editAnnualFact(page, form, "Annual earned pay", "120000");
  await editAnnualFact(page, form, "Annual household filing status", "single", true);
  await editAnnualFact(page, form, "Income for Roth IRA eligibility", "120000"); await form.getByLabel("Excess contribution policy", { exact: true }).selectOption("auto_cap");
  await form.getByRole("button", { name: "Save investment purchase", exact: true }).click(); await expect(form.getByText(/Saved purchase:.*8000.*one time/)).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click(); await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const promise = page.waitForEvent("download"); await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const download = await promise, restored = importPersonalModelJson(await readFile((await download.path())!, "utf8"));
  expect(getPersonalPurchasePlans(restored)).toMatchObject([{ amount: "8000", contribution: { character: "roth_ira", excessPolicy: "auto_cap", facts: { ageAtYearEnd: 36 } } }]);
});

test("R4 UAT groups cash separately from investment account wrappers and holdings", async ({ page }) => {
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Cash & bank accounts", exact: true }).click();
  await expect(page.getByRole("button", { name: /Everyday checking/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Workplace retirement|brokerage|RETIREMENT-DEMO|BROKERAGE-DEMO/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
  const retirementAccount = page.locator(".object-card").filter({ has: page.locator("strong").filter({ hasText: /^Workplace retirement$/ }) });
  await expect(retirementAccount.getByRole("button", { name: "Edit account Workplace retirement", exact: true })).toBeVisible();
  await expect(page.locator("button.card-main").filter({ hasText: /RETIREMENT-DEMO/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Everyday checking/ })).toHaveCount(0);
  await expect(page.getByText(/Select an account to review its holdings/)).toBeVisible();
  await page.getByRole("button", { name: "Property & other assets", exact: true }).click();
  await expect(page.getByRole("button", { name: /Example home/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /RETIREMENT-DEMO/ })).toHaveCount(0);
});

test("R4 UAT baseline projected return edits the linked assumption and reruns the household forecast", async ({ page }) => {
  await loadExample(page);
  await useShortHorizon(page);
  const status = page.getByRole("status", { name: "Household forecast status" });
  await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
  const before = await status.getAttribute("data-request-id");
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
  const control = page.getByRole("region", { name: "Projected return for RETIREMENT-DEMO" });
  await control.getByLabel("Projected annual return", { exact: true }).fill("8");
  await expect(control).toContainText("8%");
  await control.getByRole("button", { name: "Apply projected return" }).click();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
  await expect(status).not.toHaveAttribute("data-request-id", before!);
  await page.getByRole("button", { name: "Assumptions", exact: true }).click();
  const assumptionName = createGoldenHouseholdDraft().objects.Assumption!.find((item: any) => item.assumption_id === GOLDEN_HOUSEHOLD_IDS.retirementReturnAssumption) as any;
  await page.getByRole("button", { name: new RegExp(String(assumptionName.name)) }).click();
  await expect(page.getByRole("dialog", { name: "Edit Assumption" }).getByLabel("Annual assumption rate", { exact: true })).toHaveValue("8");
});

test("U1 linked return guards agree across Plan, holding and comparison routes", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await loadExample(page);
  await useShortHorizon(page);
  const assumption = createGoldenHouseholdDraft().objects.Assumption!.find((item: any) => item.assumption_id === GOLDEN_HOUSEHOLD_IDS.retirementReturnAssumption) as any;
  const editAssumption = async () => {
    await page.getByRole("button", { name: "Planning", exact: true }).click();
    await page.getByRole("button", { name: "Assumptions", exact: true }).click();
    await page.locator("button.card-main").filter({ hasText: String(assumption.name) }).click();
  };
  await editAssumption();
  const editor = page.getByRole("dialog", { name: "Edit Assumption" });
  const rate = editor.getByLabel("Annual assumption rate", { exact: true });
  const initial = await rate.inputValue();
  await rate.fill("-150");
  await expect(rate).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toContainText("Returns below a total loss are unsupported");
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await editor.getByRole("button", { name: "Continue editing", exact: true }).click();
  await expect(rate).toHaveValue("-150");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await editAssumption();
  await expect(rate).toHaveValue(initial);
  await openEditorFinancialDetails(editor);
  const unit = editor.getByLabel("Unit", { exact: true });
  await unit.fill("nominal annual rate");
  await expect(unit).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await unit.fill("effective annual rate");
  const category = editor.getByLabel("Assumption category", { exact: true });
  await category.selectOption("inflation");
  await expect(category).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await category.selectOption("market_return");
  await rate.fill("-100");
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editAssumption();
  await expect(rate).toHaveValue("-100");
  await rate.fill("-20");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
  const holding = page.getByRole("region", { name: "Projected return for RETIREMENT-DEMO" });
  const holdingRate = holding.getByLabel("Projected annual return", { exact: true });
  await expect(holdingRate).toHaveValue("-20");
  await holdingRate.fill("-100.0000000000000001");
  await expect(holdingRate).toHaveAttribute("aria-invalid", "true");
  await expect(holding.getByRole("button", { name: "Apply projected return", exact: true })).toBeDisabled();
  await holdingRate.fill("-100");
  await expect(holding.getByRole("button", { name: "Apply projected return", exact: true })).toBeEnabled();
  await holding.getByRole("button", { name: "Apply projected return", exact: true }).click();
  await holdingRate.fill("-10");
  await holding.getByRole("button", { name: "Apply projected return", exact: true }).click();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await showHouseholdDetails(page);
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible();
  // Golden has an independent tax limitation; the financial forecast stays usable.
  await expect(page.getByRole("status", { name: "Household forecast status" })).toHaveAttribute("data-lifecycle", "incomplete");
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Investment target", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.retirementInvestment);
  await page.getByLabel("Annual growth / return", { exact: true }).fill("-150");
  await expect(page.getByRole("button", { name: "Compare investment return", exact: true })).toBeDisabled();
  await page.getByLabel("Annual growth / return", { exact: true }).fill("-20");
  await expect(page.getByRole("button", { name: "Compare investment return", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Canonical model saved to this browser/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await editAssumption();
  await expect(rate).toHaveValue("-10");
  expect(errors).toEqual([]);
});

test("R4 UAT diagnostics explain monthly-event limits and retirement remediation without raw codes", async () => {
  const draft = createGoldenHouseholdDraft();
  const monthly = forecastDiagnosticMessage({ code: "MONTHLY_FLOW_EVENT_SEMANTICS_UNSUPPORTED", entityId: GOLDEN_HOUSEHOLD_IDS.income }, draft);
  expect(monthly).toContain("Supported future scheduled retirement events preserve current income");
  expect(monthly).toContain("other event behavior requires a separate financial capability");
  expect(monthly).not.toContain("MONTHLY_FLOW_EVENT_SEMANTICS_UNSUPPORTED");
  const retirement = forecastDiagnosticMessage({ code: "RETIREMENT_BINDING_MISMATCH", entityId: GOLDEN_HOUSEHOLD_IDS.retirementEvent }, draft);
  expect(retirement).toContain("Planned retirement");
  expect(retirement).toContain("2035-01-01");
  expect(retirement).toContain("Plan → What If? → Retire earlier/later");
  expect(retirement).toContain("Baseline retirement date");
  expect(retirement).not.toContain("RETIREMENT_BINDING_MISMATCH");
});

test("D1-A Golden Household has no spurious retirement-event warning", async ({ page }) => {
  await loadExample(page);
  const check = page.getByRole("region", { name: "What these numbers include", exact: true });
  const coverage = check.getByText("How this is calculated / data coverage", { exact: true });
  await expect(coverage.locator("..")).not.toHaveAttribute("open");
  await coverage.click();
  await expect(check.getByText("Current-position sources are supported.", { exact: true })).toBeVisible();
  await expect(check).not.toContainText("MONTHLY_FLOW_EVENT_SEMANTICS_UNSUPPORTED");
  await expect(check.locator("[data-diagnostic-root]")).toHaveCount(0);
  await expect(check.getByText("Technical diagnostic details", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your finances today", exact: true }).getByRole("article", { name: "Net worth", exact: true }).locator(".calm-metric-value")).toContainText("309330.29");
});

test("R4 UAT retirement comparison refreshes a stale session date from its recorded event", async ({ page }) => {
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByLabel("Baseline retirement date", { exact: true }).fill("2034-01-01");
  await page.getByRole("button", { name: "Apply retirement binding" }).click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await expect(page.getByText(/Current planned retirement date:/)).toContainText("2035-01-01");
  await page.getByLabel("New retirement date", { exact: true }).fill("2026-02-01");
  await page.getByRole("button", { name: "Compare retirement date" }).click();
  await showHouseholdDetails(page, "comparison");
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Household comparison status" })).not.toContainText("RETIREMENT_BINDING_MISMATCH");
});

test("R4 UAT creates asset facts deliberately and preserves them as read-only", async ({ page }) => {
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Property & other assets", exact: true }).click();
  await expect(page.getByText(/Use Investments & retirement for securities/)).toBeVisible();
  const before = await page.locator(".object-card").count();
  await page.getByRole("button", { name: "+ Add Asset", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Create Asset" });
  await editor.getByLabel("Name", { exact: true }).fill("Family vehicle");
  await editor.getByLabel("Asset type", { exact: true }).selectOption("vehicle");
  await expect(editor.getByLabel("Asset type", { exact: true }).locator('option[value="cash"], option[value="investment"]')).toHaveCount(0);
  await editor.getByLabel("Owner", { exact: true }).selectOption(GOLDEN_HOUSEHOLD_IDS.household);
  await openEditorFinancialDetails(editor);
  await editor.getByLabel("Acquisition date", { exact: true }).fill("2026-01-01");
  await editor.getByLabel("Acquisition cost", { exact: true }).fill("25000.00");
  // Creation edits have not added an incomplete record to the canonical model.
  await expect(page.locator(".object-card")).toHaveCount(before);
  await editor.getByRole("button", { name: "Create Asset", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const card = page.getByRole("button", { name: /Family vehicle/ });
  await expect(card).toContainText("vehicle");
  await expect(card).toContainText("25,000.00 USD");
  await card.click();
  const saved = page.getByRole("dialog", { name: "Edit Asset" });
  await openEditorFinancialDetails(saved);
  await expect(saved.getByRole("group", { name: "Asset type", exact: true })).toContainText("vehicle");
  await expect(saved.getByRole("group", { name: "Acquisition cost", exact: true })).toContainText("25,000.00 USD");
  await expect(saved.locator('input[aria-label="Acquisition cost"], select[aria-label="Asset type"], input[aria-label="Acquisition date"]')).toHaveCount(0);
  await saved.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "+ Add Asset", exact: true }).click();
  await page.getByRole("dialog", { name: "Create Asset" }).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".object-card")).toHaveCount(before + 1);
});

test("R4 UAT immutable account, income, and debt facts are not fake editable controls", async ({ page }) => {
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.getByText(/Account totals include linked holdings/)).toBeVisible();
  await expect(page.getByText(/Recurring retirement contributions are not currently authorable/)).toHaveCount(0);
  await page.getByRole("button", { name: /Everyday checking/ }).click();
  let editor = page.getByRole("dialog", { name: "Edit Account" });
  await openEditorFinancialDetails(editor);
  await expect(editor.getByRole("group", { name: "Account type", exact: true })).toContainText("checking");
  await expect(editor.getByRole("group", { name: "Cash balance", exact: true })).toContainText("20,000.00 USD");
  await expect(editor.locator('input[aria-label="Cash balance"], input[aria-label="Currency"], input[aria-label="opening date"], select[aria-label="Account type"]')).toHaveCount(0);
  await editor.getByText("Technical model details", { exact: true }).click();
  await expect(editor.locator('select[aria-label="Tax treatment"]')).toHaveCount(0);
  await editor.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  editor = page.getByRole("dialog", { name: "Edit Income" });
  await openEditorFinancialDetails(editor);
  await expect(editor.getByRole("group", { name: "Income type", exact: true })).toContainText("salary");
  await expect(editor.locator('select[aria-label="Income type"], input[aria-label="Start"]')).toHaveCount(0);
  await editor.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await page.getByRole("button", { name: /Example mortgage/ }).click();
  editor = page.getByRole("dialog", { name: "Edit Liability" });
  await openEditorFinancialDetails(editor);
  await expect(editor.getByRole("group", { name: "Original principal", exact: true })).toContainText("240,000.00 USD");
  await expect(editor.locator('select[aria-label="liability type"], input[aria-label="Original principal"], input[aria-label="Origination"]')).toHaveCount(0);
});

test("R4 UAT normal investment and spending editors cannot author known unsupported inputs", async ({ page }) => {
  await loadExample(page);
  await useShortHorizon(page);
  const status = page.getByRole("status", { name: "Household forecast status" });
  await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
  const request = await status.getAttribute("data-request-id");
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
  await page.locator("button.card-main").filter({ hasText: /RETIREMENT-DEMO/ }).click();
  const editor = page.getByRole("dialog", { name: "Edit Investment" });
  await openEditorFinancialDetails(editor);
  await editor.getByText("Technical model details", { exact: true }).click();
  await expect(editor.locator('input[aria-label="Expected return"], input[aria-label="Volatility"]')).toHaveCount(0);
  await expect(editor.getByRole("group", { name: "Expected return", exact: true })).toContainText("Change investment returns");
  await expect(editor).toContainText("Manage contributions from the account");
  await editor.getByRole("button", { name: "Close editor" }).click();
  await expect(status).toHaveAttribute("data-request-id", request!);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Spending", exact: true }).click();
  await page.getByRole("button", { name: /Living costs/ }).click();
  const funding = page.getByRole("dialog", { name: "Edit Expense" }).getByLabel("Funding account", { exact: true });
  await expect(funding).toContainText("Everyday checking");
  await expect(funding).toContainText("Emergency savings");
  await expect(funding.locator(`option[value="${GOLDEN_HOUSEHOLD_IDS.retirementAccount}"], option[value="${GOLDEN_HOUSEHOLD_IDS.brokerageAccount}"]`)).toHaveCount(0);
});

for (const [field, value, code, message] of [
  ["expected_return", "0.08", "INVESTMENT_EXPECTED_RETURN_UNSUPPORTED", "stored direct Expected return"],
  ["volatility", "0.10", "INVESTMENT_STOCHASTIC_RETURN_UNSUPPORTED", "future probabilistic forecasting"],
] as const) {
  test(`R4 UAT preserves imported ${field}, explains its blocker, and clears only explicitly`, async ({ page }) => {
    await importDraft(page, patchPersonalObject(createGoldenHouseholdDraft(), "Investment", GOLDEN_HOUSEHOLD_IDS.retirementInvestment, { [field]: value }));
    await useShortHorizon(page);
    await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
    await openPlanDetails(page);
    const standalone = page.getByRole("region", { name: "Standalone forecast drill-down" });
    await standalone.getByLabel("Forecast scope", { exact: true }).selectOption("investments");
    await standalone.getByLabel(/^(Investment owner|Debt owner)$/).selectOption({ label: "Taylor Example" });
    await standalone.getByRole("button", { name: "Run investments forecast" }).click();
    await expect(standalone.locator("[data-diagnostic-root]").getByText(new RegExp(message))).toBeVisible();
    expect(await standalone.innerText()).not.toMatch(rawUuid);
    expect(await standalone.innerText()).not.toMatch(/rate-basis contract|VS3|INVESTMENT_.*UNSUPPORTED/);
    await standalone.getByText("Technical diagnostic details", { exact: true }).click();
    await expect(standalone.locator("pre")).toContainText(code);
    await page.getByRole("button", { name: "Investing", exact: true }).click();
    await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  await openReturnDetails(page);
    await page.locator("button.card-main").filter({ hasText: /RETIREMENT-DEMO/ }).click();
    const editor = page.getByRole("dialog", { name: "Edit Investment" });
  await openEditorFinancialDetails(editor);
    await editor.getByText("Technical model details", { exact: true }).click();
    const label = field === "expected_return" ? "Expected return" : "Volatility";
    await expect(editor.getByRole("group", { name: label, exact: true })).toContainText(field === "expected_return" ? "8%" : "10%");
    await expect(editor.locator(`input[aria-label="${label}"]`)).toHaveCount(0);
    await editor.getByRole("button", { name: `Clear stored ${label}`, exact: true }).click();
    await expect(editor.getByRole("group", { name: label, exact: true })).toContainText("Not set");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
    await openPlanDetails(page);
    await standalone.getByRole("button", { name: "Run investments forecast" }).click();
    await expect(standalone.getByRole("button", { name: "Show investment forecast details" })).toBeVisible();
  });
}

test("R4 UAT preserves incompatible expense funding with actionable diagnostics", async ({ page }) => {
  await importDraft(page, patchPersonalObject(createGoldenHouseholdDraft(), "Expense", GOLDEN_HOUSEHOLD_IDS.expense, {
    payment_account_id: GOLDEN_HOUSEHOLD_IDS.retirementAccount,
  }));
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  const standalone = page.getByRole("region", { name: "Standalone forecast drill-down" });
  await standalone.getByRole("button", { name: "Run cash flow forecast" }).click();
  await expect(standalone.locator("[data-diagnostic-root]").getByText(/Living costs uses Workplace retirement/)).toBeVisible();
  await expect(standalone.locator("[data-diagnostic-root]")).toContainText("checking, savings, or cash");
  expect(await standalone.innerText()).not.toMatch(rawUuid);
  expect(await standalone.innerText()).not.toMatch(/valid non-cash payment Account|PAYMENT_ACCOUNT_TYPE_UNSUPPORTED/);
  await standalone.getByText("Technical diagnostic details", { exact: true }).click();
  await expect(standalone.locator("pre")).toContainText("PAYMENT_ACCOUNT_TYPE_UNSUPPORTED");
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Spending", exact: true }).click();
  await page.getByRole("button", { name: /Living costs/ }).click();
  const editor = page.getByRole("dialog", { name: "Edit Expense" });
  await expect(editor.getByRole("note")).toContainText("Stored funding: Workplace retirement");
  await expect(editor.getByRole("note")).toContainText("preserved until you choose");
  await editor.getByText("Entity IDs", { exact: true }).click();
  await expect(editor.locator("dd").filter({ hasText: GOLDEN_HOUSEHOLD_IDS.retirementAccount })).toBeVisible();
  const funding = editor.getByLabel("Funding account", { exact: true });
  await expect(funding.locator(`option[value="${GOLDEN_HOUSEHOLD_IDS.retirementAccount}"]`)).toHaveCount(0);
  await funding.selectOption(GOLDEN_HOUSEHOLD_IDS.checking);
  await expect(editor.getByRole("note")).toHaveCount(0);
});

test("R4 current plan shows setup and opens technical details without recalculation", async ({ page }) => {
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Planning", exact: true }).click();
  const status = page.getByRole("status", { name: "Household forecast status" });
  await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
  await expect(page.getByRole("figure", { name: "Household financial outlook chart" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Household execution configuration" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Standalone forecast drill-down" })).toHaveCount(0);
  const request = await status.getAttribute("data-request-id");
  await openPlanDetails(page);
  await expect(page.getByRole("region", { name: "Household execution configuration" })).toContainText("Income receiving account: Everyday checking");
  await expect(page.getByLabel("Income receiving account", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Forecast scope", { exact: true })).toBeVisible();
  await expect(status).toHaveAttribute("data-request-id", request!);
  expect(await page.locator("#main-content").innerText()).not.toMatch(rawUuid);
});

test("R4 editor uses friendly financial identity and distinct expert/technical disclosure", async ({ page }) => {
  test.setTimeout(60_000);
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  const card = page.locator(".object-card").filter({ hasText: "Example salary" });
  await expect(card.locator("strong")).toHaveText("Example salary");
  await expect(card.locator("small")).toContainText("Taylor Example");
  await expect(card.locator("small")).toContainText("monthly");
  expect(await card.innerText()).not.toMatch(rawUuid);
  expect((await card.innerText()).match(/Example salary/g)).toHaveLength(1);
  const opener = card.getByRole("button", { name: /Example salary/ });
  await opener.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit Income" });
  await expect(editor.getByLabel("Source / name", { exact: true })).toBeFocused();
  await openEditorFinancialDetails(editor);
  await expect(editor.getByLabel("Owner", { exact: true })).toContainText("Taylor Example");
  await expect(editor.getByLabel("Amount", { exact: true })).toHaveValue("9000.00");
  expect(await editor.innerText()).not.toMatch(rawUuid);
  await expect(editor.getByText("Additional financial details", { exact: true })).toBeVisible();
  const expert = editor.getByText("Technical model details", { exact: true });
  await expert.focus();
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("region", { name: "Managed model references" })).toBeVisible();
  await expect(editor.getByRole("region", { name: "Managed model references" })).toContainText("Planned retirement");
  await expect(editor.getByRole("region", { name: "Managed model references" }).locator("input, select")).toHaveCount(0);
  await expect(editor.getByLabel("growth model id", { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("related event id", { exact: true })).toHaveCount(0);
  expect(await editor.innerText()).not.toMatch(rawUuid);
  const technical = editor.getByText("Entity IDs", { exact: true });
  await technical.focus();
  await page.keyboard.press("Enter");
  expect(await editor.innerText()).toMatch(rawUuid);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("R4 empty relationship collections show actionable state instead of a Choose-only control", async ({ page }) => {
  const draft = addPersonalObject(createEmptyPersonalDraft("a4000000-0000-4000-8000-000000000001"), "Household",
    "a4000000-0000-4000-8000-000000000002", {
      name: "Household without people", formation_date: "2020-01-01", primary_jurisdiction: "US-NY", members: [],
    });
  await importDraft(page, draft);
  await page.getByRole("button", { name: "Household & People", exact: true }).click();
  await page.getByRole("button", { name: /Household without people/ }).click();
  const editor = page.getByRole("dialog", { name: "Edit Household" });
  await openEditorFinancialDetails(editor);
  await expect(editor.getByRole("note")).toContainText("No people available");
  await expect(editor.getByLabel("members", { exact: true })).toHaveCount(0);
  await editor.getByText("Technical model details", { exact: true }).click();
  expect(await editor.locator("select").evaluateAll((controls) => controls.every((control) =>
    (control as HTMLSelectElement).options.length > 1))).toBe(true);
});

// Separate viewport assertions so a mobile failure cannot hide desktop
// keyboard/repair regressions; each scenario starts from a fresh example.
for (const width of [390, 1440]) {
  test(`R4 responsive status, chart and keyboard editor controls at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await loadExample(page);
    await useShortHorizon(page);
    await page.setViewportSize({ width, height: 900 });
    await clickFinancialDestination(page, "Overview");
    const status = page.getByRole("status", { name: "Household forecast status" });
    await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
    await expect(status).toContainText(/Ready|Partially modeled/);
    await expect(page.getByText(/edits stay in memory until saved/)).toBeVisible();
    const chart = page.getByRole("figure", { name: "Household financial outlook chart" });
    await expect(chart).toBeVisible();
    await expect(chart).toContainText("USD");
    await expect(chart).toContainText("Forecast, not account history");
    expect(await page.locator("#main-content").innerText()).not.toMatch(rawUuid);
    const request = await status.getAttribute("data-request-id");
    const plot = chart.locator('[role="application"]');
    await plot.focus();
    await page.keyboard.press("ArrowRight");
    await expect(chart.locator(".chart-readout")).toBeVisible();
    await expect(chart.locator(".chart-readout")).toContainText("Annual modeled period [start, end)");
    await expect(chart.locator(".chart-readout")).toContainText("Projected 2026-01-01 → 2026-04-01 (exclusive) · partial year, 3 months");
    await expect(chart.locator(".chart-readout dd")).toHaveText(
      await chart.getByRole("status", { name: "Assets, liabilities and net worth exact selected period", exact: true }).locator("dd").allTextContents(),
    );
    await expect(status).toHaveAttribute("data-request-id", request!);
    const reveal = page.getByRole("button", { name: "Show forecast details", exact: true });
    await reveal.focus(); await page.keyboard.press("Enter");
    const table = page.getByRole("table", { name: "Reconciled household forecast" });
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await expect(status).toHaveAttribute("data-request-id", request!);
    await page.getByRole("button", { name: "Cash", exact: true }).click();
    await page.getByRole("button", { name: "Income", exact: true }).click();
    const opener = page.getByRole("button", { name: /Example salary/ });
    await opener.focus(); await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Income" });
    await expect(editor.getByLabel("Source / name", { exact: true })).toBeFocused();
  await openEditorFinancialDetails(editor);
    await expect(editor.getByLabel("Amount", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "Close editor" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(editor.getByText("Entity IDs", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(editor.getByRole("button", { name: "Close editor" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    // A requested source repair must win over normal Source/name entry focus.
    await opener.click();
    await editor.getByLabel("Frequency", { exact: true }).selectOption("weekly");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(status).toHaveAttribute("data-lifecycle", "unsupported");
    await expect(status.locator(".forecast-primary-guidance")).toContainText("schedule this monthly forecast cannot execute");
    await expect(status.locator(".forecast-guidance")).not.toHaveAttribute("open");
    const repair = status.locator(".forecast-primary-guidance").getByRole("button", { name: "Review Frequency", exact: true });
    await repair.click();
    await expect(editor.getByLabel("Frequency", { exact: true })).toBeFocused();
    await expect(editor.getByLabel("Frequency", { exact: true })).toBeVisible();
    await expect(editor.locator("details").filter({ hasText: "Additional financial details" })).not.toHaveAttribute("open");
    await expect(editor.getByLabel("Source / name", { exact: true })).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(repair).toBeFocused();
    await repair.click();
    await expect(editor.getByLabel("Frequency", { exact: true })).toBeFocused();
    await editor.getByLabel("Frequency", { exact: true }).selectOption("monthly");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(status).toHaveAttribute("data-lifecycle", /^(completed|incomplete)$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("R2 real Worker baseline stays responsive, retains stale results and accepts only the latest request", async ({ page }) => {
  test.setTimeout(120_000);
  // Gate delivery, not execution: every financial result still comes from the real bundled Worker.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const control = {
      queue: [] as { requestId: number; fingerprint: string; deliver: () => void }[],
      requests: [] as { requestId: number; operation: string }[],
      errorNext: false,
    };
    (window as any).__r2Worker = control;
    class GatedWorker {
      native: Worker;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: { preventDefault(): void }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor(url: string | URL, options?: WorkerOptions) {
        this.native = new NativeWorker(url, options);
        this.native.onmessage = (event) => control.queue.push({ requestId: event.data.requestId, fingerprint: event.data.fingerprint,
          deliver: () => this.onmessage?.(event) });
        this.native.onerror = (event) => this.onerror?.(event);
        this.native.onmessageerror = () => this.onmessageerror?.();
      }
      postMessage(message: { requestId: number; operation: string }) {
        control.requests.push({ requestId: message.requestId, operation: message.operation });
        if (control.errorNext) {
          control.errorNext = false;
          queueMicrotask(() => this.onerror?.({ preventDefault() {} }));
        } else this.native.postMessage(message);
      }
      terminate() { this.native.terminate(); }
    }
    window.Worker = GatedWorker as unknown as typeof Worker;
  });
  const status = page.getByRole("status", { name: "Household forecast status" });
  const waitQueued = async () => page.waitForFunction(() => {
    const status = document.querySelector('[aria-label="Household forecast status"]') as HTMLElement | null;
    return (window as any).__r2Worker.queue.some((item: any) => String(item.requestId) === status?.dataset.requestId && item.fingerprint === status?.dataset.fingerprint);
  }, undefined, { timeout: 30_000 });
  const releaseCurrent = async () => page.evaluate(() => {
    const status = document.querySelector('[aria-label="Household forecast status"]') as HTMLElement;
    const control = (window as any).__r2Worker;
    const index = control.queue.findIndex((item: any) => String(item.requestId) === status.dataset.requestId && item.fingerprint === status.dataset.fingerprint);
    control.queue.splice(index, 1)[0].deliver();
  });
  await loadExample(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-02-01");
  await expect(status).toHaveAttribute("data-lifecycle", "running");
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.locator(".subnav").getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do I own and owe?" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Household current summary" }).locator("dl > div").filter({ has: page.getByText("Net worth", { exact: true }) })).toContainText("309330.29");
  await waitQueued();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toHaveCount(0);
  await releaseCurrent();
  await expect(status).toHaveAttribute("data-lifecycle", "incomplete");
  await expect(status).toContainText("Partially modeled");
  await expect(page.getByRole("button", { name: "Show forecast details" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toHaveCount(0);
  await showHouseholdDetails(page);
  const table = page.getByRole("table", { name: "Reconciled household forecast" });
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("code")).toHaveCount(0);
  const beforeDrillDown = await page.evaluate(() => (window as any).__r2Worker.requests.length);
  await table.getByText("Explain", { exact: true }).click();
  await expect(table.getByText("Source records carried by this result:", { exact: false })).toBeVisible();
  await expect(table.locator("code")).not.toBeVisible();
  await table.getByText("Technical trace details", { exact: true }).click();
  await expect(table.locator("code")).toContainText("compiler:canonical:Income");
  await page.getByRole("button", { name: "Hide forecast details" }).click();
  await showHouseholdDetails(page);
  await table.getByText("Explain", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__r2Worker.requests.length)).toBe(beforeDrillDown);

  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-03-01");
  await expect(status).toHaveAttribute("data-lifecycle", "stale");
  await expect(status).toContainText("Old result");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true }).click();
  await expectOverviewRange(page, "2026-02-01");
  await waitQueued();
  const superseded = await status.getAttribute("data-request-id");
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  await expect(status).not.toHaveAttribute("data-request-id", superseded!);
  await page.evaluate((requestId) => {
    const queue = (window as any).__r2Worker.queue;
    queue.splice(queue.findIndex((item: any) => String(item.requestId) === requestId), 1)[0].deliver();
  }, superseded);
  await expect(status).toHaveAttribute("data-lifecycle", "stale");
  await expect(status).toHaveAttribute("data-pending", "true");
  await waitQueued(); await releaseCurrent();
  await expect(status).toHaveAttribute("data-lifecycle", "incomplete");
  await expectOverviewRange(page, "2026-03-01");
  await showHouseholdDetails(page);
  await expect(table.locator("tbody tr")).toHaveCount(2);

  await page.evaluate(() => { (window as any).__r2Worker.errorNext = true; });
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-04-01");
  await expect(status).toHaveAttribute("data-lifecycle", "error");
  await expect(status).toContainText("Old result");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true }).click();
  await expectOverviewRange(page, "2026-03-01");
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  // Opening account balances are immutable; exercise a supported economic edit.
  await page.getByLabel("Amount", { exact: true }).fill("10000.00");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10000.00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(status).toHaveAttribute("data-lifecycle", "stale");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true }).click();
  // A future income amount changes the forecast, not opening net worth.
  await expect(page.getByRole("region", { name: "Your finances today", exact: true }).getByRole("article", { name: "Net worth", exact: true }).locator(".calm-metric-value")).toContainText("309330.29");
  await expectOverviewRange(page, "2026-03-01");
  await waitQueued(); await releaseCurrent();
  await expect(status).toHaveAttribute("data-lifecycle", "incomplete");
  await expectOverviewRange(page, "2026-04-01");
});

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
  ).toContainText("OverviewCashInvestingReal EstateOther AssetsDebtPlanningMore");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await expect(page.getByLabel("Simulation end", { exact: true })).toHaveValue("2036-01-01");
});

test("Technical diagnostics exposes in-memory performance diagnostics", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-02-01");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true }).click();
  await showHouseholdDetails(page, "baseline");
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Technical diagnostics", exact: true }).click();
  const diagnostics = page.getByRole("table", { name: "Performance diagnostics" });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.getByRole("row", { name: /forecast\.total/ })).not.toContainText("N/A");
  await expect(diagnostics.getByRole("row", { name: /forecast\.total/ })).toContainText("browser_worker");
  await expect(diagnostics.getByRole("row", { name: /forecast\.total/ })).toContainText("incomplete");
  await expect(diagnostics.getByRole("row", { name: /forecast\.total/ })).toContainText("modelCounts");
  await expect(diagnostics.getByRole("row", { name: /transport\.serialization/ })).toContainText("not_measured");
  await expect(diagnostics.getByRole("row", { name: /transport\.serialization/ })).toContainText("N/A");
  const uiRows = diagnostics.getByRole("row").filter({ hasText: /ui\.(react_commit|chart_render|explanation_resolution)/ });
  const previousUiRecords = await uiRows.allTextContents();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Technical diagnostics", exact: true }).click();
  expect(previousUiRecords.length).toBe(3);
  await expect(diagnostics.getByRole("row", { name: /ui\.explanation_resolution/ })).toContainText("N/A");
  await expect(page.getByText(/No telemetry is persisted or transmitted/)).toBeVisible();
  await expect(page.getByText(/server\/cloud is not implemented and not measured/)).toBeVisible();
});

test("Golden household runs, compares, explains, and distinguishes modeled liquidity stress", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  const forecast = page.getByRole("table", {
    name: "Reconciled household forecast",
  });
  await showHouseholdDetails(page, "baseline", 60_000);
  await expect(forecast).toBeVisible({ timeout: 60_000 });
  // The Golden model lacks authoritative tax facts; its complete economic horizon remains inspectable.
  await expect(page.getByRole("status", { name: "Household forecast status" })).toHaveAttribute("data-lifecycle", "incomplete");
  await expectOverviewRange(page, "2036-01-01");
  await expect(forecast.locator("tbody tr")).toHaveCount(24);
  const requestBeforePaging = await page.getByRole("status", { name: "Household forecast status" }).getAttribute("data-request-id");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(forecast.locator("tbody tr")).toHaveCount(24);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.getByRole("status", { name: "Household forecast status" })).toHaveAttribute("data-request-id", requestBeforePaging!);
  await forecast.getByText("Explain").first().click();
  await forecast.getByText("Expert calculation details", { exact: true }).first().click();
  await forecast.getByText("Technical trace details", { exact: true }).first().click();
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

  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.locator(".subnav").getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Household current summary" }).locator("dl > div").filter({ has: page.getByText("Net worth", { exact: true }) })).toContainText("309330.29");
  await expect(page.getByText("535000", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2027-01-01");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Investment target", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare investment return" }).click();
  const lower = page.getByRole("table", { name: "What-if alternative household comparison" });
  await showHouseholdDetails(page, "comparison", 30_000);
  await expect(lower).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/investment return/).first()).toBeVisible();
  await lower.getByText("Explain").last().click();
  await lower.getByText("Technical trace details", { exact: true }).last().click();
  await expect(lower.locator("code").last()).not.toBeEmpty();

  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await expect(page.getByLabel("Retirement plan", { exact: true })).toHaveValue(GOLDEN_HOUSEHOLD_IDS.income);
  await expect(page.getByText(/Current planned retirement date:/)).toContainText("2035-01-01");
  await page.getByLabel("New retirement date", { exact: true }).fill("2026-02-01");
  await page.getByRole("button", { name: "Compare retirement date" }).click();
  const retirement = page.getByRole("table", {
    name: "What-if alternative household comparison",
  });
  await showHouseholdDetails(page, "comparison", 30_000);
  await expect(retirement).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/retirement date/i).first()).toBeVisible();
  await expect(
    page.getByText("Financial outcome · Modeled liquidity stress"),
  ).toBeVisible();
  await retirement.getByText("Explain").last().click();
  await retirement.getByText("Technical trace details", { exact: true }).last().click();
  await expect(retirement.locator("code").last()).not.toBeEmpty();
});

test("session settings drive horizons and block invalid run ordering", async ({
  page,
}) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByText("Forecast clock & conventions", { exact: true }).click();
  const clock = page.locator('[data-authoring-scope="forecast-dates"]');
  await clock.getByLabel("As of", { exact: true }).fill("2026-02-01");
  await clock.getByLabel("Data cutoff", { exact: true }).fill("2026-02-01");
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-04-01");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: /Run cash flow forecast/ }).click();
  await page.getByRole("button", { name: "Show cash-flow forecast details", exact: true }).click();
  await expect(page.getByText("As of 2026-02-01T00:00:00.000Z")).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Detailed cash-flow forecast" })
      .locator("tbody tr"),
  ).toHaveCount(3);

  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-01-01");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: /Run cash flow forecast/ }).click();
  await expect(
    page.getByText("Simulation start must be before simulation end.").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review forecast dates", exact: true }).click();
  await expect(page.getByLabel("Simulation end", { exact: true })).toBeFocused();
  await page.getByLabel("Simulation end", { exact: true }).fill("2026-04-01");
  await expect(page.getByText("Simulation start must be before simulation end.", { exact: true })).toHaveCount(0);
});

test("Money cash-flow run uses its explicit scope after Plan selects investments", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByLabel("Forecast scope", { exact: true }).selectOption("investments");
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Cash Flow", exact: true }).click();
  await page.getByRole("button", { name: "Run cash-flow forecast" }).click();
  await showHouseholdDetails(page, "baseline");
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
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  await page.getByLabel("Source / name", { exact: true }).fill("Updated example salary");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Updated example salary/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Spending", exact: true }).click();
  await page.getByRole("button", { name: /Living costs/ }).click();
  await page.getByLabel("Amount", { exact: true }).fill("20000.00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Cash Flow", exact: true }).click();
  await page.getByRole("button", { name: "Run cash-flow forecast" }).click();
  await expect(
    page.getByText("Financial outcome · Modeled liquidity stress"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No observed history loaded")).toBeVisible();
  await showHouseholdDetails(page, "baseline");
  await expect(
    page.getByRole("table", { name: "Reconciled household forecast" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await page.locator(".subnav").getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What do I own and owe?" }),
  ).toBeVisible();
  await clickFinancialDestination(page, "Debt");
  await expect(
    page.getByRole("button", { name: /Example mortgage/ }),
  ).toBeVisible();
});

test("Debt runs the explicitly configured mortgage surface without classifying funding stress as partial coverage", async ({
  page,
}) => {
  // Opening balance is a creation-time fact: prepare low cash in the fixture,
  // rather than asking the normal editor to overwrite an immutable value.
  const golden = createGoldenHouseholdDraft();
  await importDraft(page, { ...golden, objects: { ...golden.objects,
    Account: (golden.objects.Account ?? []).map((value) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? { ...value, ...(String((value as { account_id?: string }).account_id) === GOLDEN_HOUSEHOLD_IDS.checking ? { opening_balance: "100" } : {}) }
        : value),
  } });
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await page
    .getByLabel(/^(Investment owner|Debt owner)$/)
    .selectOption({ label: "Taylor Example" });
  await page.getByLabel("First monthly payment", { exact: true }).fill("2022-02-01");
  await page.getByLabel("Number of monthly payments", { exact: true }).fill("360");
  await page
    .getByLabel("Mortgage payment account", { exact: true })
    .selectOption({ label: "Everyday checking" });
  await page.getByLabel("Same-day mortgage order", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Run liability forecast" }).click();
  await page.getByRole("button", { name: "Show debt forecast details", exact: true }).click();
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
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await page
    .getByLabel(/^(Investment owner|Debt owner)$/)
    .selectOption({ label: "Taylor Example" });
  await page.getByLabel("First monthly payment", { exact: true }).fill("2022-02-01");
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
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await expect(page.getByLabel(/^(Investment owner|Debt owner)$/)).toHaveValue("");
  await expect(page.getByLabel("First monthly payment", { exact: true })).toHaveValue("");
});

test("Investments execute only after explicit owner selection and owner state clears on import", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  const standalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await standalone.getByLabel("Forecast scope", { exact: true }).selectOption("investments");
  await standalone
    .getByLabel(/^(Investment owner|Debt owner)$/)
    .selectOption({ label: "Taylor Example" });
  await standalone
    .getByRole("button", { name: "Run investments forecast" })
    .click();
  await standalone.getByRole("button", { name: "Show investment forecast details", exact: true }).click();
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
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  const restoredStandalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await restoredStandalone
    .getByLabel("Forecast scope", { exact: true })
    .selectOption("investments");
  await expect(restoredStandalone.getByLabel(/^(Investment owner|Debt owner)$/)).toHaveValue("");
});

test("model portability and deterministic what-if comparison stay explicit", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(5_000);
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
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
  await page.getByLabel("Annual growth / return", { exact: true }).fill("5");
  await page.getByLabel("Income target", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await showHouseholdDetails(page, "comparison");
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toBeVisible();
  await expect(page.getByText(/income growth/)).toBeVisible();
  await page.getByText("Explain").first().click();
  await page.getByText("Technical trace details", { exact: true }).first().click();
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
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page
    .getByRole("button", { name: "Compare Plans", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Household comparison status" }),
  ).toHaveAttribute("data-lifecycle", "idle");
  await expect(page.getByRole("status", { name: "Household comparison status" })).toContainText("Run a new comparison");
  await expect(page.getByRole("button", { name: /Show .* comparison details/ })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toHaveCount(0);
});

test("What If executes retirement without mutating the baseline binding", async ({
  page,
}) => {
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  const baselineDate = await page.getByLabel("Baseline retirement date", { exact: true }).inputValue();
  await expect(page.getByLabel("Baseline retirement income", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("Baseline canonical retirement event", { exact: true })).toHaveValue(
    /.+/,
  );
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await expect(page.getByLabel("Retirement plan", { exact: true })).toHaveValue(GOLDEN_HOUSEHOLD_IDS.income);
  await expect(page.getByText(/Current planned retirement date:/)).toContainText("2035-01-01");
  await page.getByLabel("New retirement date", { exact: true }).fill("2026-02-01");
  await page.getByRole("button", { name: "Compare retirement date" }).click();
  await showHouseholdDetails(page, "comparison");
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toBeVisible();
  await expect(page.getByText(/retirement date/i)).toBeVisible();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await expect(page.getByLabel("Baseline retirement income", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("Baseline canonical retirement event", { exact: true })).toHaveValue(
    /.+/,
  );
  await expect(page.getByLabel("Baseline retirement date", { exact: true })).toHaveValue(
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
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await page.getByLabel("Simulation end", { exact: true }).fill("2027-01-01");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  const configuration = page.getByRole("region", {
    name: "Household execution configuration",
  });
  await configureOwnedFunding(page);
  await configureTaxSettlement(page);
  await configuration
    .getByRole("button", { name: "Apply setup & run forecast" })
    .click();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Investment target", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Annual growth / return", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Compare investment return" }).click();
  await showHouseholdDetails(page, "comparison");
  await expect(
    page.getByRole("table", { name: "What-if alternative household comparison" }),
  ).toBeVisible();
  await expect(page.getByText(/investment return/i)).toBeVisible();
});

test("What If executes explicit liability extra principal", async ({
  page,
}) => {
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Liability target", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Extra principal amount", { exact: true }).fill("not-money");
  await expect(
    page.getByText("Enter an exact decimal amount, such as 100.00."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compare extra principal" }),
  ).toBeDisabled();
  await page.getByLabel("Extra principal amount", { exact: true }).fill("100.00");
  await page.getByLabel("Extra principal date", { exact: true }).fill("2026-02-01");
  await page
    .getByLabel("Extra principal funding account", { exact: true })
    .selectOption({ label: "Everyday checking" });
  await page.getByRole("button", { name: "Compare extra principal" }).click();
  await showHouseholdDetails(page, "comparison");
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
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page
    .getByLabel("Funding account to add", { exact: true })
    .selectOption({ label: "Everyday checking" });
  await page.getByRole("button", { name: "Add funding source" }).click();
  await page
    .getByLabel("Funding account to add", { exact: true })
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
  test.setTimeout(120_000);
  page.setDefaultTimeout(5_000);
  await loadExample(page);
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: /Example salary/ }).click();
  await page.getByLabel("Source / name", { exact: true }).fill("Recognizable saved salary");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();

  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await page
    .getByLabel(/^(Investment owner|Debt owner)$/)
    .selectOption({ label: "Taylor Example" });
  await page.getByLabel("First monthly payment", { exact: true }).fill("2022-02-01");
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  const standalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await standalone.getByLabel("Forecast scope", { exact: true }).selectOption("investments");
  await standalone
    .getByLabel(/^(Investment owner|Debt owner)$/)
    .selectOption({ label: "Taylor Example" });
  await standalone
    .getByRole("button", { name: "Run investments forecast" })
    .click();
  await standalone.getByRole("button", { name: "Show investment forecast details", exact: true }).click();
  await expect(
    standalone.getByRole("table", { name: "Detailed investment forecast" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Income target", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await showHouseholdDetails(page, "comparison");
  await expect(
    page.getByRole("table", { name: "What-if alternative household comparison" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Canonical model saved to this browser"),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Load saved model" }).click();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Recognizable saved salary/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  const restoredStandalone = page.getByRole("region", {
    name: "Standalone forecast drill-down",
  });
  await restoredStandalone
    .getByLabel("Forecast scope", { exact: true })
    .selectOption("investments");
  await expect(restoredStandalone.getByLabel(/^(Investment owner|Debt owner)$/)).toHaveValue("");
  await expect(
    restoredStandalone.getByRole("table", { name: "Detailed investment forecast" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Compare Plans", exact: true })
    .click();
  await expect(
    page.getByText("No executable comparison is available yet."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Investing", exact: true }).click();
  await clickFinancialDestination(page, "Debt");
  await expect(page.getByLabel(/^(Investment owner|Debt owner)$/)).toHaveValue("");
  await expect(page.getByLabel("First monthly payment", { exact: true })).toHaveValue("");
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
  await useShortHorizon(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Major asset owner", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Major asset name", { exact: true }).fill("Scenario home");
  await page.getByLabel("Major asset value", { exact: true }).fill("400000");
  await page.getByLabel("Major debt amount", { exact: true }).fill("300000");
  await page.getByLabel("Major debt annual rate", { exact: true }).fill("5");
  await page.getByLabel("Major debt payment anchor", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Major debt total payments", { exact: true }).fill("360");
  await page.getByLabel("Major debt funding account", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Major debt settlement priority", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Compare major asset/debt" }).click();
  await expect(page.getByText("Declared difference: major asset debt addition")).toBeVisible({ timeout: 60_000 });
  await showHouseholdDetails(page, "comparison");
  await expect(page.getByRole("table", { name: "Add major asset financed by fixed debt at projection start household comparison" })).toBeVisible();
});

test("PR21 closeout: configure save reload reconfigure", async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(5_000);
  await loadExample(page);
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await configureTaxSettlement(page);
  await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
  await showHouseholdDetails(page, "baseline", 60_000);
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "What If?", exact: true }).click();
  await page.getByLabel("Income target", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Compare income growth" }).click();
  await showHouseholdDetails(page, "comparison", 60_000);
  await expect(page.getByRole("table", { name: "What-if alternative household comparison" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Load saved model" }).click();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await openAuthoringSections(page);
  await openPlanDetails(page);
  await page.getByRole("button", { name: "Current Plan", exact: true }).click();
  await openAuthoringSections(page);
  await expect((await openIncomeOwner(page)).getByLabel("Income receiving account", { exact: true })).toHaveValue("");
  await returnToCurrentPlan(page);
  await openPlanDetails(page);
  await expect(page.getByLabel("Baseline retirement income", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Baseline canonical retirement event", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("table", { name: "Reconciled household forecast" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "What-if alternative household comparison" }),
  ).toHaveCount(0);
  const configuration = page.getByRole("region", {
    name: "Household execution configuration",
  });
  await configureOwnedFunding(page);
  await openPlanDetails(page);
  await configuration
    .getByLabel("Baseline retirement income", { exact: true })
    .selectOption({ label: "Example salary" });
  await configuration
    .getByLabel("Baseline canonical retirement event", { exact: true })
    .selectOption({ label: "Planned retirement" });
  await expect(configuration.getByLabel("Baseline retirement date", { exact: true })).toHaveValue(
    "2035-01-01",
  );
  await configuration
    .getByRole("button", { name: "Apply retirement binding" })
    .click();
  await configureTaxSettlement(page);
  await configuration
    .getByRole("button", { name: "Apply setup & run forecast" })
    .click();
  await expect(
    page.getByText(/Household execution configuration is missing/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Update forecast", exact: true }).click();
  await showHouseholdDetails(page, "baseline", 60_000);
  await expect(page.getByRole("table", { name: "Reconciled household forecast" })).toBeVisible({ timeout: 60_000 });
});
