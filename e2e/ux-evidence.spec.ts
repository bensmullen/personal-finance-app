import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";
import { addPersonalObject, createEmptyPersonalDraft, exportPersonalModelJson } from "../src/application/personalMvp.js";

/**
 * Manual, external-to-Codex UX evidence. Intentionally skipped in ordinary CI.
 * Use the dedicated workflow_dispatch on the branch/head being reviewed.
 * Never load a real/imported/user-saved household; fresh context + synthetic example only.
 */
const navigate = async (page: Page, area: string, section: string) => {
  await navigateOwner(page, area, section);
};

// Source inventory, not a visual acceptance claim. Attach alongside actual renders.
const screenRegions = [
  ["head() / .head / .head-cta", "CalmPageHeader / .calm-page-header", "Matched structure and approved headline; 44px actions adapt prototype touch sizes."],
  [".sidebar / .navbtn / .mobileNav", "Primary navigation / .calm-shell", "235px teal sidebar and mobile More; seven existing financial destinations retained."],
  [".topbar", "topbar / .calm-storage / household-summary", "Adapted for real manual Save/Export, storage privacy and source as-of; no fictional persona picker."],
  ["overview() / .primary-viz", "Overview / .calm-outlook / HouseholdChart", "Real V1 SVG from selector; no-forecast state has no fictional path. Review footprint at both widths."],
  [".metrics / .metric", "CalmMetric / .calm-metrics", "Three exact current source values; mobile two columns then full-width net worth. Scope differs from fictional sample."],
  [".grid2 / .panel / .item", "calm-lower-grid / CalmPanel / calm-questions", "Three question-led existing routes; coverage and current-position details collapsed."],
  ["headerStatus() / .statusbox", "ForecastStatus / calm-blocker", "Adapted to true partial, stale, pending, error and setup state; one priority correction."],
  ["graph-frame / chart-table", "FinancialChart / chart-control-details / HouseholdForecastVisual supporting content", "Existing chart economics and keyboard graph retained; controls, exact values, source dates and supporting results disclosed."],
];

async function recordState(page: Page, info: TestInfo, scenario: string) {
  const status = page.getByRole("status", { name: "Household forecast status", exact: true });
  const charts = page.locator(".financial-charts").first();
  const correction = page.getByRole("alert", { name: "Priority correction", exact: true });
  const state = {
    scenario, revision: process.env.GITHUB_SHA ?? "unrecorded", url: page.url(),
    route: await page.locator('nav[aria-label="Primary navigation"] [aria-current="page"]').textContent(),
    lifecycle: await status.getAttribute("data-lifecycle"), pending: await status.getAttribute("data-pending"),
    chartData: await charts.count() ? await charts.getAttribute("data-chart-status") : "no forecast chart data",
    supportedMonths: await charts.count() ? await charts.getAttribute("data-supported-months") : null,
    unavailableReason: await charts.count() ? await charts.getAttribute("data-unavailable-reason") : await correction.count() ? await correction.textContent() : await status.textContent(),
    svgPresent: await page.locator(".calm-outlook svg.recharts-surface").count() > 0,
    priorityCorrection: await correction.count() ? await correction.textContent() : null,
    repair: await correction.count() ? await correction.getByRole("button").textContent() : "Review forecast status / Update forecast",
    regions: screenRegions.map(([prototype, production, reason]) => ({ prototype, production, disposition: reason.startsWith("Adapted") ? "intentionally adapted" : "implemented; visual match pending review", reason })),
    reviewRequired: "PM must review geometry, density, typography, navigation, default and expanded disclosure, plain copy and comprehension. Code inventory is not visual signoff.",
  };
  await info.attach(`${scenario}-source-and-state-inventory`, { body: JSON.stringify(state, null, 2), contentType: "application/json" });
}

async function captureExpandedOverview(page: Page, info: TestInfo, width: number, scenario: string) {
  const summaries = ["Chart controls and exact values", "Forecast range / Data coverage", "Forecast assumptions and supporting details", "How this is calculated / data coverage"];
  for (const title of summaries) {
    const summary = page.getByText(title, { exact: true });
    if (await summary.count()) await summary.click();
  }
  const revision = process.env.GITHUB_SHA?.slice(0, 12) || "revision-unrecorded";
  const path = info.outputPath(`overview-${scenario}-expanded-${width}-${revision}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(`overview-${scenario}-expanded-${width}`, { path, contentType: "image/png" });
  for (const title of [...summaries].reverse()) {
    const summary = page.getByText(title, { exact: true });
    if (await summary.count()) await summary.click();
  }
}

async function captureExpandedReference(page: Page, info: TestInfo, width: number, scenario: string, revision: string) {
  for (const details of await page.locator(".primary-viz details").all()) {
    if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
  const name = `overview-${scenario}-calm-reference-expanded-${width}-${revision}.png`;
  await page.screenshot({ path: info.outputPath(name), fullPage: true, animations: "disabled" });
  await info.attach(name, { path: info.outputPath(name), contentType: "image/png" });
}

test("synthetic H04 opening-only Overview first-screen evidence", async ({ page }, testInfo: TestInfo) => {
  test.skip(process.env.PFM_UX_EVIDENCE !== "1", "Only run via the manually triggered UX evidence workflow.");
  test.setTimeout(120_000);
  const id = (suffix: string) => `b0400000-0000-4000-8000-${suffix.padStart(12, "0")}`;
  let draft = createEmptyPersonalDraft(id("1"));
  draft = addPersonalObject(draft, "Household", id("2"), { name: "Rick Barlow · H04 opening only", members: [id("3")] });
  draft = addPersonalObject(draft, "Person", id("3"), { household_id: id("2"), first_name: "Rick", last_name: "Barlow", date_of_birth: "1981-01-01" });
  draft = addPersonalObject(draft, "Account", id("4"), { name: "H04 checking", account_type: "checking", owner_id: id("3"), currency: "USD", opening_date: "2026-01-01", opening_balance: "1350" });
  draft = addPersonalObject(draft, "Account", id("5"), { name: "H04 savings", account_type: "savings", owner_id: id("3"), currency: "USD", opening_date: "2026-01-01", opening_balance: "2400" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Use synthetic example", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "h04-opening-only.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(draft)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await clickFinancialDestination(page, "Overview");
  await expect(page.getByRole("status", { name: "Household forecast status", exact: true })).toHaveAttribute("data-lifecycle", "idle");
  await recordState(page, testInfo, "h04-opening-only");
  const revision = process.env.GITHUB_SHA?.slice(0, 12).replace(/[^a-f0-9]/gi, "") || "revision-unrecorded";
  for (const width of [1440, 390]) {
    const height = width === 390 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const productionName = `overview-h04-opening-only-first-screen-${width}-${revision}.png`;
    const referenceName = `overview-h04-calm-reference-fictional-${width}-${revision}.png`;
    await page.screenshot({ path: testInfo.outputPath(productionName), animations: "disabled" });
    await testInfo.attach(productionName, { path: testInfo.outputPath(productionName), contentType: "image/png" });
    const reference = await page.context().newPage();
    try {
      await reference.setViewportSize({ width, height });
      await reference.setContent(await readFile("docs/alpha/prototypes/level4-h04-h08-pilot.html", "utf8"));
      await expect(reference.locator("body")).toHaveAttribute("data-theme", "calm");
      await expect(reference.getByRole("heading", { name: "Know where you stand.", exact: true })).toBeVisible();
      await reference.screenshot({ path: testInfo.outputPath(referenceName), animations: "disabled" });
      await testInfo.attach(referenceName, { path: testInfo.outputPath(referenceName), contentType: "image/png" });
      await captureExpandedReference(reference, testInfo, width, "h04", revision);
    } finally { await reference.close(); }
    const report = testInfo.outputPath(`overview-h04-comparison-${width}-${revision}.html`);
    await writeFile(report, `<!doctype html><html lang="en"><meta charset="utf-8"><title>H04 Overview comparison</title><style>body{font:16px system-ui;margin:24px}main{display:flex;gap:24px;align-items:start}figure{margin:0;flex:1;min-width:0}img{width:100%;border:1px solid #aaa}figcaption{margin:12px 0}</style><h1>H04 opening only · ${width} × ${height} · ${revision}</h1><p>Visual review pending. Production has only synthetic opening checking/savings balances and no Current Plan or forecast. The approved reference has fictional values and a trajectory; compare hierarchy and disclosure, not amounts or forecast coverage.</p><main><figure><figcaption>Current application: synthetic H04 opening-only subset, idle forecast.</figcaption><img alt="Production H04 Overview first screen" src="${productionName}"></figure><figure><figcaption>Approved Calm reference: fictional Barlow household.</figcaption><img alt="Approved Calm Overview first screen" src="${referenceName}"></figure></main></html>`);
    await testInfo.attach(`overview-h04-comparison-${width}-${revision}`, { path: report, contentType: "text/html" });
    await captureExpandedOverview(page, testInfo, width, "h04-opening-only");
  }
});

test("synthetic account, income and forecast UX at desktop and narrow viewport", async ({ page }, testInfo: TestInfo) => {
  test.skip(process.env.PFM_UX_EVIDENCE !== "1", "Only run via the manually triggered UX evidence workflow.");
  test.setTimeout(300_000);
  const consoleErrors: string[] = [];
  page.on("pageerror", error => consoleErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto("/");
  // Fails closed rather than screenshot an existing household or an imported financial model.
  await expect(page.getByRole("button", { name: "Use synthetic example", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  await expect(page.getByRole("status", { name: "Household forecast status" })).toHaveAttribute("data-pending", "false", { timeout: 30_000 });

  const capture = async (label: string, width: number) => {
    const revision = process.env.GITHUB_SHA?.slice(0, 12).replace(/[^a-f0-9]/gi, "") || "revision-unrecorded";
    const path = testInfo.outputPath(`${label}-${width}-${revision}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach(`${label}-${width}`, { path, contentType: "image/png" });
  };

  // Bounded read-only captures, including paired Overview first screens; no source mutation.
  for (const width of [1440, 390]) {
    const height = width === 390 ? 844 : 900;
    await page.setViewportSize({ width, height });

    await clickFinancialDestination(page, "Overview");
    const outlook = page.getByRole("figure", { name: "Household financial outlook chart", exact: true });
    await expect(outlook.locator("svg.recharts-surface")).toBeVisible();
    // The first complete-status SVG line can be empty in a partially modeled
    // forecast. Verify a real drawn line (complete or incomplete), not a shell.
    await expect(outlook.locator('.recharts-line path.recharts-line-curve[d^="M"]').first()).toBeVisible();
    await recordState(page, testInfo, `golden-supported-${width}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture("01-overview-synthetic-current-app", width);
    const revision = process.env.GITHUB_SHA?.slice(0, 12).replace(/[^a-f0-9]/gi, "") || "revision-unrecorded";
    const productionName = `overview-production-first-screen-${width}-${revision}.png`;
    const referenceName = `overview-calm-reference-barlow-fictional-${width}-${revision}.png`;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(productionName), animations: "disabled" });
    await testInfo.attach(productionName, { path: testInfo.outputPath(productionName), contentType: "image/png" });
    // Same approved document and viewport; its fictional Barlow values are NOT
    // a production fixture. No production source data enters the reference page.
    const reference = await page.context().newPage();
    try {
      await reference.setViewportSize({ width, height });
      await reference.setContent(await readFile("docs/alpha/prototypes/level4-h04-h08-pilot.html", "utf8"));
      await expect(reference.locator("body")).toHaveAttribute("data-theme", "calm");
      await expect(reference.getByRole("heading", { name: "Know where you stand.", exact: true })).toBeVisible();
      await reference.screenshot({ path: testInfo.outputPath(referenceName), animations: "disabled" });
      await testInfo.attach(referenceName, { path: testInfo.outputPath(referenceName), contentType: "image/png" });
      await captureExpandedReference(reference, testInfo, width, "golden", revision);
    } finally { await reference.close(); }
    const comparisonPath = testInfo.outputPath(`overview-comparison-${width}-${revision}.html`);
    await writeFile(comparisonPath, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Overview Calm review ${width}</title><style>body{font:16px system-ui;margin:24px}main{display:flex;align-items:start;gap:24px}figure{margin:0;min-width:0;flex:1}img{width:100%;border:1px solid #aaa}figcaption{margin:12px 0;line-height:1.5}</style><h1>Overview · ${width} × ${height} · ${revision}</h1><p>Visual review pending. Different synthetic examples: compare hierarchy, disclosures and presentation, not monetary values. Production status: ${await page.getByRole("status", { name: "Household forecast status", exact: true }).getAttribute("data-lifecycle")}.</p><main><figure><figcaption>Production: current application synthetic example at this checkout revision.</figcaption><img alt="Production Overview first screen" src="${productionName}"></figure><figure><figcaption>Approved Calm reference: fictional Barlow household from the checked-in prototype at the same revision. H04/H08 production fixture parity is not established.</figcaption><img alt="Approved Calm Overview first screen" src="${referenceName}"></figure></main></html>`);
    await testInfo.attach(`overview-comparison-${width}-${revision}`, { path: comparisonPath, contentType: "text/html" });
    await captureExpandedOverview(page, testInfo, width, "golden-supported");

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
    for (const label of ["Cash", "Real Estate", "Other Assets"]) {
      await clickFinancialDestination(page, label);
      if (label === "Cash") {
        await expect(page.getByRole("figure", { name: "Total modeled cash (including cash in investment accounts)", exact: true }).locator("svg.recharts-surface")).toBeVisible();
        await expect(page.getByRole("figure", { name: "Modeled statement income versus expenses", exact: true }).locator("svg.recharts-surface")).toBeVisible();
        await expect(page.getByRole("figure", { name: "Where modeled income goes comparison", exact: true })).toBeVisible();
      }
      if (label === "Real Estate") await expect(page.getByRole("figure", { name: "Example mortgage monthly cash paid", exact: true })).toBeVisible();
      await capture(`07-${label.toLowerCase().replaceAll(" ", "-")}`, width);
    }
  }

  // Diagnose graph absence without inventing mortgage facts or changing source owners.
  await navigateOwner(page, "Settings", "Import / Export");
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const original = await readFile((await (await exported).path())!, "utf8");
  await clickFinancialDestination(page, "Debt");
  const payments = page.getByRole("group", { name: "Example mortgage", exact: true }).getByLabel("Number of monthly payments", { exact: true });
  const debtDetails = payments.locator("xpath=ancestor::details[1]");
  if (await debtDetails.count() && await debtDetails.getAttribute("open") === null) await debtDetails.locator(":scope > summary").click();
  await payments.fill("");
  await clickFinancialDestination(page, "Overview");
  await expect(page.locator(".chart-freshness")).toContainText("Out of date");
  const captureState = async (scenario: string) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await recordState(page, testInfo, `${scenario}-${width}`);
      const revision = process.env.GITHUB_SHA?.slice(0, 12) || "revision-unrecorded";
      const path = testInfo.outputPath(`overview-${scenario}-first-screen-${width}-${revision}.png`);
      await page.screenshot({ path, animations: "disabled" });
      await testInfo.attach(`${scenario}-${width}`, { path, contentType: "image/png" });
    }
  };
  await captureState("mortgage-setup-missing-retained-stale");
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-reopened-source.json", mimeType: "application/json", buffer: Buffer.from(original) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await clickFinancialDestination(page, "Overview");
  await expect(page.locator(".calm-outlook svg")).toHaveCount(0);
  await captureState("import-cleared-session-setup");
  const correction = page.getByRole("alert", { name: "Priority correction", exact: true });
  for (const [problem, field, choice] of [
    ["Income receiving account", "Income receiving account", "Everyday checking"],
    ["Investment owner", "Investment owner", "Taylor Example"],
    ["Debt owner", "Debt owner", "Taylor Example"],
  ]) {
    await expect(correction).toContainText(problem);
    await correction.getByRole("button", { name: "Review setup", exact: true }).click();
    const control = page.getByRole("combobox", { name: field, exact: true });
    await expect(control).toBeFocused();
    await control.selectOption({ label: choice });
    await clickFinancialDestination(page, "Overview");
  }
  await expect(correction).toContainText("Example mortgage: Enter the first monthly payment date.");
  await captureState("mortgage-not-configured-no-forecast");
  await correction.getByRole("button", { name: "Review setup", exact: true }).click();
  await expect(page.getByRole("group", { name: "Example mortgage", exact: true }).getByLabel("First monthly payment", { exact: true })).toBeFocused();

  expect(consoleErrors, "No unexpected browser exceptions during synthetic review").toEqual([]);
});
