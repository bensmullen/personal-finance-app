import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createGoldenHouseholdDraft, exportPersonalModelJson, importPersonalModelJson, type JsonObject } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { compileDomainMechanics } from "../src/application/compiler/domainMechanics.js";
import { holdingDomainActivities } from "../src/application/investmentActivity.js";

const id = (n: number) => `ab940002-0000-4000-8000-${String(n).padStart(12, "0")}`;
const activity = async (page: Page, holdingId: string) => {
  for (const summary of await page.locator(".account-holdings > summary").all()) if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  const panel = page.locator(`[data-source-holding="${holdingId}"]`);
  const section = panel.locator("xpath=ancestor::details[1]");
  if (await section.getAttribute("open") === null) await section.locator(":scope > summary").click();
  return panel;
};

test("U1 source-holding activity owns distributions, exercise and linked retirement transfers", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const original = createGoldenHouseholdDraft();
  const draft = { ...original, objects: { ...original.objects,
    Account: [...original.objects.Account!, ...[[id(1), "traditional_ira", "Traditional rollover IRA"], [id(2), "roth_ira", "Roth rollover IRA"], [id(3), "roth_401k", "Roth plan compartment"]].map(([account_id, account_type, name]) => ({ account_id: account_id!, account_type: account_type!, name: name!, owner_id: ids.person, currency: "USD", opening_date: "2020-01-01", opening_balance: "0" }))],
    Investment: [...(original.objects.Investment as readonly JsonObject[]).map(item => ({ ...item, acquisition_date: "2024-01-01", cost_basis: item.market_value!, after_tax_basis: item.investment_id === ids.retirementInvestment ? "20000" : "0", ...(item.investment_id === ids.brokerageInvestment ? { investment_type: "equity" } : {}) })),
      ...[[id(4), id(1), "Traditional rollover fund"], [id(5), id(2), "Roth rollover fund"], [id(6), id(3), "Roth plan fund"]].map(([investment_id, account_id, name]) => ({ investment_id: investment_id!, account_id: account_id!, name: name!, owner_id: ids.person, investment_type: "fund", currency: "USD", quantity: "0", price: "100", market_value: "0", cost_basis: "0", after_tax_basis: "0" })),
      { investment_id: id(7), account_id: ids.brokerageAccount, name: "Listed long call", investment_type: "option", instrument_subtype: "long_equity_call", owner_id: ids.person, currency: "USD", quantity: "2", price: "5", market_value: "10", cost_basis: "10", acquisition_date: "2024-01-01", strike_price: "50", contract_multiplier: 100, expiration_date: "2026-12-31", underlying_investment_id: ids.brokerageInvestment },
    ],
  } };
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-activity.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(draft)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await page.getByRole("button", { name: "Net Worth", exact: true }).click();
  await page.getByRole("button", { name: "Investments & retirement", exact: true }).click();
  const stock = await activity(page, ids.brokerageInvestment);
  await expect(stock.getByLabel("Source / target holding", { exact: true })).toBeDisabled();
  await expect(stock.getByLabel("Domain operation", { exact: true }).locator('option[value="call_exercise"]')).toHaveCount(0);
  for (const [kind, date, amount] of [["ordinary_dividend", "2026-01-05", "20"], ["qualified_dividend", "2026-01-06", "10"], ["reinvest_dividend", "2026-01-07", "100"], ["sale", "2026-01-08", "550"]]) {
    await stock.getByLabel("Domain operation", { exact: true }).selectOption(kind!);
    await stock.getByLabel("Operation date", { exact: true }).fill(date!);
    await stock.getByLabel("Operation cash amount", { exact: true }).fill(amount!);
    if (kind === "reinvest_dividend") {
      await stock.getByLabel("Units / call contracts", { exact: true }).fill("1");
      await stock.getByLabel("Reinvested dividend character", { exact: true }).selectOption("qualified");
    }
    if (kind === "sale") {
      await stock.getByLabel("Units / call contracts", { exact: true }).fill("5");
      await stock.getByLabel("Specific opening lot (optional)", { exact: true }).selectOption(`${ids.brokerageInvestment}:opening`);
    }
    await stock.getByRole("button", { name: "Save domain operation", exact: true }).click();
    await expect(stock.getByRole("status")).toContainText("Operation saved");
  }
  const call = await activity(page, id(7));
  await call.getByLabel("Domain operation", { exact: true }).selectOption("call_exercise");
  await call.getByLabel("Operation date", { exact: true }).fill("2026-01-09");
  await call.getByLabel("Units / call contracts", { exact: true }).fill("1");
  await expect(call.getByLabel("Operation cash amount", { exact: true })).toHaveValue("5000");
  await expect(call.getByLabel("Operation cash amount", { exact: true })).toHaveAttribute("readonly", "");
  await call.getByLabel("Purchase / exercise funding account", { exact: true }).selectOption(ids.checking);
  await call.getByRole("button", { name: "Save domain operation", exact: true }).click();
  const workplace = await activity(page, ids.retirementInvestment);
  for (const [kind, date] of [["conversion", "2026-01-10"], ["direct_rollover", "2026-01-11"], ["mixed_rollover", "2026-01-12"], ["indirect_distribution", "2026-01-13"], ["indirect_deposit", "2026-01-14"]]) {
    await workplace.getByLabel("Domain operation", { exact: true }).selectOption(kind!);
    await workplace.getByLabel("Operation date", { exact: true }).fill(date!);
    await workplace.getByLabel("Operation cash amount", { exact: true }).fill("1000");
    await workplace.getByLabel("Confirm eligibility and destination acceptance", { exact: true }).check();
    if (kind !== "indirect_distribution") {
      const destinations = workplace.getByLabel("Retirement destination holding", { exact: true });
      await expect(destinations.locator(`option[value="${ids.retirementInvestment}"]`)).toHaveCount(0);
      await expect(destinations.locator(`option[value="${ids.brokerageInvestment}"]`)).toHaveCount(0);
      await destinations.selectOption(kind === "conversion" ? id(6) : id(4));
    }
    await expect(workplace.getByLabel("After-tax Roth IRA destination", { exact: true })).toHaveCount(kind === "mixed_rollover" ? 1 : 0);
    if (kind === "conversion") await workplace.getByLabel("Confirm source and Roth destination share one employer plan", { exact: true }).check();
    if (kind === "mixed_rollover") await workplace.getByLabel("After-tax Roth IRA destination", { exact: true }).selectOption(id(5));
    if (kind === "indirect_distribution") await workplace.getByLabel("Received proceeds account", { exact: true }).selectOption(ids.checking);
    if (kind === "indirect_deposit") {
      await workplace.getByLabel("Original participant distribution", { exact: true }).selectOption({ index: 1 });
      await workplace.getByLabel("Withholding replacement cash", { exact: true }).fill("200");
      await workplace.getByLabel("Replacement funding account", { exact: true }).selectOption(ids.checking);
    }
    await workplace.getByRole("button", { name: "Save domain operation", exact: true }).click();
    await expect(workplace.getByRole("status")).toContainText("Operation saved");
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const control = workplace.getByLabel("Original participant distribution", { exact: true });
    await control.focus(); await expect(control).toBeFocused();
    const box = await control.boundingBox(); expect(box!.width).toBeGreaterThan(120); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`holding-activity-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload(); await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click(); await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const restored = importPersonalModelJson(await readFile((await (await pending).path())!, "utf8"));
  expect(restored.objects.Income).toEqual(original.objects.Income);
  expect(restored.objects.Expense).toEqual(original.objects.Expense);
  expect(restored.objects.Transaction).toEqual(original.objects.Transaction);
  expect(holdingDomainActivities(restored, ids.brokerageInvestment).map(row => row.terms.kind)).toEqual(["ordinary_dividend", "qualified_dividend", "reinvest_dividend", "sale"]);
  const rollovers = holdingDomainActivities(restored, ids.retirementInvestment);
  expect(rollovers.map(row => row.terms.kind)).toEqual(["conversion", "direct_rollover", "mixed_rollover", "indirect_distribution", "indirect_deposit"]);
  expect(rollovers[4]!.terms.linkedOperationId).toBe(rollovers[3]!.event.event_id);
  expect(holdingDomainActivities(restored, id(7))[0]?.terms).toMatchObject({ kind: "call_exercise", amount: "5000", quantity: "1" });
  const compiled = compileDomainMechanics(restored, { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2026-02-01", executionOwnerId: ids.person });
  expect(compiled.status, JSON.stringify(compiled)).toBe("compiled");
  if (compiled.status !== "compiled") throw new Error("authored activity must compile");
  expect(compiled.value.input.operations.filter(item => item.kind === "reinvest_dividend")).toHaveLength(1);
  expect(errors).toEqual([]);
});
