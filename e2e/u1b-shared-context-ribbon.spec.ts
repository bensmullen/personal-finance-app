import { expect, test, type Page } from "@playwright/test";
import { createGoldenHouseholdDraft, exportPersonalModelJson, type PersonalDraft } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner, expectForecastWindow } from "./navigation.js";

// Only the holistic journey needs the flagship's 649-month worker setup.
// Independent cases use one-year guided setup followed by unexecuted imports.
async function openBoundedSession(page: Page, draft = createGoldenHouseholdDraft()) {
  await page.goto("/");
  for (const [label, value] of [["Household name", "Ribbon workspace"], ["Monthly income", "0"], ["Opening cash balance", "0"], ["Asset cost basis", "0"], ["Current debt", "0"], ["Monthly spending", "0"]] as const) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByLabel("Projection horizon (years)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "context-synthetic.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(draft)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await expect(page.getByRole("status", { name: "Household forecast status", exact: true })).toHaveAttribute("data-lifecycle", "idle");
  await clickFinancialDestination(page, "Overview");
}

const ribbonFor = (page: Page) => page.getByRole("region", { name: "Household & status", exact: true });
const statusFor = (page: Page) => page.getByRole("status", { name: "Household forecast status", exact: true });
// Main's padding is a unique, non-header outside target on every destination,
// including pages with several owner-editor h1s.
const clickOutside = (page: Page) => page.locator("#main-content").click({ position: { x: 4, y: 4 } });

test("shared context holistic forecast, navigation and person-owner journey", async ({ page }) => {
  const width = 1440;
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  const ribbon = page.getByRole("region", { name: "Household & status", exact: true });
  const status = page.getByRole("status", { name: "Household forecast status", exact: true });
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-lifecycle", "completed");
  await expectForecastWindow(page, "2026-01-01", "2080-02-01", 649);
  const request = await status.getAttribute("data-request-id");
  const fingerprint = await status.getAttribute("data-fingerprint");
  for (const destination of ["Overview", "Cash", "Investing", "Real Estate", "Other Assets", "Debt", "Planning"]) {
    await clickFinancialDestination(page, destination);
    await expect(ribbon).toHaveCount(1);
    await expect(ribbon).toBeVisible();
    await expect(status).toHaveCount(1);
    await expect(ribbon).toContainText("Household forecast");
    await expect(page.locator("#main-content .household-summary, #main-content > .forecast-status, #main-content > .forecast-coverage")).toHaveCount(0);
  }
  const people = ribbon.locator(".context-people");
  const trigger = people.locator(":scope > summary");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(people).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(people).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await clickOutside(page);
  await expect(people).not.toHaveAttribute("open");
  for (let visit = 0; visit < 2; visit++) {
    await trigger.click();
    await people.getByRole("button", { name: "Taylor Example", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Person", exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.locator("form input:focus")).toHaveCount(1);
    await expect(page.locator(".subnav").getByRole("button", { name: "Household & People", exact: true })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(status).toHaveAttribute("data-request-id", request!);
    await expect(status).toHaveAttribute("data-fingerprint", fingerprint!);
  }
  const forecastDetails = status.locator(".context-disclosure");
  await forecastDetails.locator(":scope > summary").click();
  await expect(forecastDetails).toContainText("Requested coverage is not computed coverage");
  await expect(forecastDetails).toContainText("data cutoff 2026-01-01");
  await page.keyboard.press("Escape");
  await expect(forecastDetails).not.toHaveAttribute("open");
  // Match the established enlarged-text QA mechanism; retain touch-size bounds.
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await expect(ribbon.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  for (const control of [trigger, status.locator(".context-disclosure > summary"), ribbon.getByRole("button", { name: "Save", exact: true })]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) {
  test.describe(`bounded ribbon at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test("identity menu supports keyboard, Escape and outside dismissal", async ({ page }) => {
      await openBoundedSession(page);
      const people = ribbonFor(page).locator(".context-people");
      const trigger = people.locator(":scope > summary");
      await expect(trigger).toContainText("Example household");
      await expect(people).not.toHaveAttribute("open");
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(people.getByRole("button", { name: "Taylor Example", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(people).not.toHaveAttribute("open");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await clickOutside(page);
      await expect(people).not.toHaveAttribute("open");
    });

    test("all financial destinations retain exactly one shared context", async ({ page }) => {
      await openBoundedSession(page);
      for (const destination of ["Overview", "Cash", "Investing", "Real Estate", "Other Assets", "Debt", "Planning"]) {
        await clickFinancialDestination(page, destination);
        await expect(ribbonFor(page)).toHaveCount(1);
        await expect(ribbonFor(page)).toBeVisible();
        await expect(statusFor(page)).toHaveCount(1);
        await expect(page.locator("#main-content .household-summary, #main-content > .forecast-status, #main-content > .forecast-coverage")).toHaveCount(0);
      }
    });

    test("person owner focuses the existing editor and restores its opener", async ({ page }) => {
      await openBoundedSession(page);
      const status = statusFor(page);
      const request = await status.getAttribute("data-request-id");
      const fingerprint = await status.getAttribute("data-fingerprint");
      const people = ribbonFor(page).locator(".context-people");
      const trigger = people.locator(":scope > summary");
      for (let visit = 0; visit < 2; visit++) {
        await trigger.click();
        await people.getByRole("button", { name: "Taylor Example", exact: true }).click();
        const editor = page.getByRole("dialog", { name: "Edit Person", exact: true });
        await expect(editor).toBeVisible();
        await expect(editor.locator("form input:focus")).toHaveCount(1);
        await expect(page.locator(".subnav").getByRole("button", { name: "Household & People", exact: true })).toHaveAttribute("aria-current", "page");
        await page.keyboard.press("Escape");
        await expect(editor).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(await status.getAttribute("data-request-id")).toBe(request);
        expect(await status.getAttribute("data-fingerprint")).toBe(fingerprint);
        await expect(status).toHaveAttribute("data-lifecycle", "idle");
      }
    });

    test("forecast disclosure distinguishes requested coverage from imported setup", async ({ page }) => {
      const draft = createGoldenHouseholdDraft();
      await openBoundedSession(page, draft);
      const status = statusFor(page);
      const details = status.locator(".context-disclosure");
      await expect(status).toContainText("Forecast: Needs setup");
      await expect(details).not.toHaveAttribute("open");
      await details.locator(":scope > summary").click();
      await expect(details).toContainText("Requested coverage is not computed coverage");
      await expect(details).toContainText("No supported forecast is available yet.");
      await expect(details).toContainText("data cutoff 2026-01-01");
      const plan = draft.objects.Scenario![0]!;
      await expect(details.locator(".forecast-coverage")).toHaveAttribute("data-requested-end", String(plan.end_date));
      await page.keyboard.press("Escape");
      await expect(details).not.toHaveAttribute("open");
      await expect(details.locator(":scope > summary")).toBeFocused();
    });

    test("manual save cue is visible and privacy details expand independently", async ({ page }) => {
      await openBoundedSession(page);
      const ribbon = ribbonFor(page);
      await expect(ribbon.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      await expect(ribbon.locator(".context-save-cue")).toBeVisible();
      await expect(ribbon.locator(".context-save-cue")).toContainText("Forecasts do not save.");
      const privacy = ribbon.locator(".context-storage");
      await expect(privacy).not.toHaveAttribute("open");
      await privacy.locator(":scope > summary").click();
      await expect(privacy.getByText("Save or export explicitly to keep changes. Completing a forecast does not save your model.", { exact: true })).toBeVisible();
      await expect(privacy).toContainText("without encryption");
      await page.keyboard.press("Escape");
      await expect(privacy).not.toHaveAttribute("open");
      await expect(ribbon.locator(".context-save-cue")).toBeVisible();
    });

    test("enlarged text keeps controls and disclosures in bounds", async ({ page }) => {
      await openBoundedSession(page);
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      const ribbon = ribbonFor(page);
      for (const control of await ribbon.locator(".context-disclosure > summary, .context-save").all()) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      const people = ribbon.locator(".context-people");
      await people.locator(":scope > summary").click();
      await people.getByRole("button", { name: "Taylor Example", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Edit Person", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}

for (const enlarged of [false, true]) test(`mobile More destinations and dismissal${enlarged ? " with 200% text" : ""}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoundedSession(page);
  if (enlarged) await page.addStyleTag({ content: "html { font-size: 200%; }" });
  for (const destination of ["Real Estate", "Other Assets", "Debt"]) await clickFinancialDestination(page, destination);
  const more = page.getByRole("button", { name: "More", exact: true });
  const menu = page.getByRole("navigation", { name: "More destinations", exact: true });
  await more.click();
  await expect(menu.getByRole("button", { name: "Real Estate", exact: true })).toBeFocused();
  const menuBox = await menu.boundingBox();
  const navBox = await page.getByRole("navigation", { name: "Primary navigation", exact: true }).boundingBox();
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(navBox!.y);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  // The top brand remains outside the bounded bottom menu, even at 200% text.
  await page.locator(".topbar .brand").click();
  await expect(menu).toHaveCount(0);
  const people = ribbonFor(page).locator(".context-people");
  await people.locator(":scope > summary").click();
  await expect(people.getByRole("button", { name: "Taylor Example", exact: true })).toBeVisible();
  await more.click();
  await expect(people).not.toHaveAttribute("open");
  await menu.getByRole("button", { name: "Real Estate", exact: true }).click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const memberDraft = createGoldenHouseholdDraft();
const recordedPerson = memberDraft.objects.Person![0]!;
for (const { name, members, labels } of [
  { name: "missing members", members: [], labels: [] },
  { name: "one member", members: [recordedPerson], labels: ["Taylor Example"] },
  { name: "duplicate members", members: [recordedPerson, { ...recordedPerson, person_id: "94000000-0000-4000-8000-000000000244" }], labels: ["Taylor Example · member 1 · born 1990-01-01", "Taylor Example · member 2 · born 1990-01-01"] },
  { name: "unnamed member", members: [{ ...recordedPerson, first_name: "", last_name: "" }], labels: ["Unnamed person"] },
]) test(`imported ${name} retain canonical identity and setup state`, async ({ page }) => {
  const imported: PersonalDraft = { ...memberDraft, objects: { ...memberDraft.objects, Person: members } };
  await openBoundedSession(page, imported);
  const people = ribbonFor(page).locator(".context-people");
  const trigger = people.locator(":scope > summary");
  await trigger.click();
  if (!members.length) await expect(people.getByText("No people recorded.", { exact: true })).toBeVisible();
  else for (const [index, label] of labels.entries()) {
    if (index) await trigger.click();
    await people.getByRole("button", { name: label, exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Person", exact: true });
    await expect(editor).toBeVisible();
    await editor.locator("summary").filter({ hasText: /^Entity IDs$/ }).click();
    await expect(editor.getByText(String(members[index]!.person_id), { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(statusFor(page)).toHaveAttribute("data-lifecycle", "idle");
});
