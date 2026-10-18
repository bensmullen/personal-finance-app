import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";

/**
 * Manual, external-to-Codex UX evidence. Intentionally skipped in ordinary CI.
 * Use the dedicated workflow_dispatch on the branch/head being reviewed.
 * Never load a real/imported/user-saved household; fresh context + synthetic example only.
 */
const navigate = async (page: Page, area: string, section: string) => {
  await navigateOwner(page, area, section);
};

test("synthetic account, income and forecast UX at desktop and narrow viewport", async ({ page }, testInfo: TestInfo) => {
  test.skip(process.env.PFM_UX_EVIDENCE !== "1", "Only run via the manually triggered UX evidence workflow.");
  test.setTimeout(180_000);
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

    await navigate(page, "Overview", "How am I doing?");
    await capture("01-overview-synthetic-current-app", width);
    const revision = process.env.GITHUB_SHA?.slice(0, 12).replace(/[^a-f0-9]/gi, "") || "revision-unrecorded";
    const productionName = `overview-production-first-screen-${width}-${revision}.png`;
    const referenceName = `overview-calm-reference-barlow-fictional-${width}-${revision}.png`;
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
    } finally { await reference.close(); }
    const comparisonPath = testInfo.outputPath(`overview-comparison-${width}-${revision}.html`);
    await writeFile(comparisonPath, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Overview Calm review ${width}</title><style>body{font:16px system-ui;margin:24px}main{display:flex;align-items:start;gap:24px}figure{margin:0;min-width:0;flex:1}img{width:100%;border:1px solid #aaa}figcaption{margin:12px 0;line-height:1.5}</style><h1>Overview · ${width} × ${height} · ${revision}</h1><p>Visual review pending. Different synthetic examples: compare hierarchy, disclosures and presentation, not monetary values. Production status: ${await page.getByRole("status", { name: "Household forecast status", exact: true }).getAttribute("data-lifecycle")}.</p><main><figure><figcaption>Production: current application synthetic example at this checkout revision.</figcaption><img alt="Production Overview first screen" src="${productionName}"></figure><figure><figcaption>Approved Calm reference: fictional Barlow household from the checked-in prototype at the same revision. H04/H08 production fixture parity is not established.</figcaption><img alt="Approved Calm Overview first screen" src="${referenceName}"></figure></main></html>`);
    await testInfo.attach(`overview-comparison-${width}-${revision}`, { path: comparisonPath, contentType: "text/html" });

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
      await capture(`07-${label.toLowerCase().replaceAll(" ", "-")}`, width);
    }
  }

  expect(consoleErrors, "No unexpected browser exceptions during synthetic review").toEqual([]);
});
