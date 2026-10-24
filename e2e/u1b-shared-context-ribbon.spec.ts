import { expect, test } from "@playwright/test";
import { createGoldenHouseholdDraft, exportPersonalModelJson } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";

for (const width of [1440, 390]) test(`shared context, people owner, focus and enlarged text at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  const ribbon = page.getByRole("region", { name: "Household & status", exact: true });
  const status = page.getByRole("status", { name: "Household forecast status", exact: true });
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
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
  await page.locator("#main-content h1").click();
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

test("imported missing and duplicate members retain canonical identity and setup state", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  const draft = createGoldenHouseholdDraft();
  const person = draft.objects.Person![0] as Record<string, any>;
  for (const members of [[], [person], [person, { ...person, person_id: "94000000-0000-4000-8000-000000000244" }], [{ ...person, first_name: "", last_name: "" }]]) {
    await navigateOwner(page, "Settings", "Import / Export");
    const imported = { ...draft, objects: { ...draft.objects, Person: members } };
    await page.locator('input[type="file"]').setInputFiles({ name: "context-synthetic.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(imported)) });
    await page.getByRole("button", { name: "Import into session", exact: true }).click();
    const status = page.getByRole("status", { name: "Household forecast status", exact: true });
    await expect(status).toHaveAttribute("data-lifecycle", "idle");
    const people = page.locator(".context-people");
    await people.locator(":scope > summary").click();
    if (!members.length) await expect(people).toContainText("No people recorded");
    else {
      const label = members.length === 2 ? "Taylor Example · member 2 · born 1990-01-01" : members[0]!.first_name ? "Taylor Example" : "Unnamed person";
      await people.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Edit Person", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.keyboard.press("Escape");
  }
});
