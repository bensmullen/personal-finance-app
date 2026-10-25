import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createGoldenHouseholdDraft, exportPersonalModelJson, type PersonalDraft } from "../src/application/personalMvp.js";
import { clickFinancialDestination, navigateOwner, expectForecastWindow, saveCurrentModel, showForecastLimitations, showStatusActions as showActions } from "./navigation.js";

// Browser launch options are worker-scoped. Declare them at file scope:
// a test.describe-local launchOptions override aborts all Playwright discovery.
// Other tests do not navigate to the mapped demo hostname.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP pfm-demo.localhost 127.0.0.1", "--no-proxy-server"] } });

// Only the holistic journey needs the flagship's 649-month worker setup.
// Independent cases use one-year guided setup followed by unexecuted imports.
async function openBoundedSession(page: Page, draft = createGoldenHouseholdDraft(), url = "/", originReadiness = "Trusted origin:") {
  await page.goto(url);
  // Public/demo replaces the server's trusted-origin fallback in an effect,
  // proving hydration before the alternate-origin test's first Continue.
  await expect(page.locator(".setup .privacy")).toContainText(originReadiness);
  const fields = [["Household name", "Ribbon workspace"], ["Monthly income", "0"], ["Opening cash balance", "0"], ["Asset cost basis", "0"], ["Current debt", "0"], ["Monthly spending", "0"]] as const;
  for (const [index, [label, value]] of fields.entries()) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator(".setup .eyebrow")).toHaveText(`Guided setup · ${index + 2} of 7`);
  }
  await page.getByLabel("Projection horizon (years)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "context-synthetic.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(draft)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await expect(page.locator('.forecast-status[aria-label="Household forecast status"]')).toHaveAttribute("data-lifecycle", "idle");
  await clickFinancialDestination(page, "Overview");
}

const ribbonFor = (page: Page) => page.getByRole("region", { name: "Household & status", exact: true });
const statusFor = (page: Page) => page.locator('.forecast-status[aria-label="Household forecast status"]');
// Main's padding is a unique, non-header outside target on every destination,
// including pages with several owner-editor h1s.
const actionsFor = (page: Page) => page.locator(".context-actions");
const clickOutside = (page: Page) => page.locator("#main-content").click({ position: { x: 4, y: 4 } });

test("shared context holistic forecast, navigation and person-owner journey", async ({ page }) => {
  const width = 1440;
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
  const ribbon = page.getByRole("region", { name: "Household & status", exact: true });
  const status = page.locator('.forecast-status[aria-label="Household forecast status"]');
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-lifecycle", "completed");
  await expect(status.locator(".context-disclosure > summary")).toHaveAccessibleName("Forecast: Ready");
  await expect(status.locator(".status-ready")).toHaveCount(1);
  await expectForecastWindow(page, "2026-01-01", "2080-02-01", 649);
  const headerControls = await ribbon.locator(".context-disclosure > summary").all();
  const headerBoxes = await Promise.all(headerControls.map(control => control.boundingBox()));
  expect(Math.max(...headerBoxes.map(box => box!.y))).toBeLessThan(Math.min(...headerBoxes.map(box => box!.y + box!.height)));
  const request = await status.getAttribute("data-request-id");
  const fingerprint = await status.getAttribute("data-fingerprint");
  for (const destination of ["Overview", "Cash", "Investing", "Real Estate", "Other Assets", "Debt", "Planning"]) {
    await clickFinancialDestination(page, destination);
    await expect(ribbon).toHaveCount(1);
    await expect(ribbon).toBeVisible();
    await expect(status).toHaveCount(1);
    await expect(ribbon.locator(".context-household")).toHaveText("Household");
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
    await people.getByRole("button", { name: "Taylor", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Person", exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.locator("form input:focus")).toHaveCount(1);
    await expect(page.locator(".subnav").getByRole("button", { name: "Household & People", exact: true })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await status.getAttribute("data-request-id")).toBe(request);
    expect(await status.getAttribute("data-fingerprint")).toBe(fingerprint);
  }
  await showActions(page);
  const forecastDetails = status.locator(".context-disclosure");
  await forecastDetails.locator(":scope > summary").click();
  await expect(forecastDetails).toContainText("Requested coverage is not computed coverage");
  await expect(forecastDetails).toContainText("data cutoff 2026-01-01");
  await page.keyboard.press("Escape");
  await expect(forecastDetails).not.toHaveAttribute("open");
  // Match the established enlarged-text QA mechanism; retain touch-size bounds.
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await expect(actionsFor(page).getByRole("button", { name: "Save", exact: true })).toBeVisible();
  for (const control of [trigger, status.locator(".context-disclosure > summary"), actionsFor(page).getByRole("button", { name: "Save", exact: true })]) {
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
      await expect(people.locator(".context-household")).toHaveText("Household");
      await expect(people).not.toHaveAttribute("open");
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(people.getByRole("button", { name: "Taylor", exact: true })).toBeVisible();
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
        await people.getByRole("button", { name: "Taylor", exact: true }).click();
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
      await expect(trigger).toHaveAccessibleName("Person / Household: Taylor");
      await clickFinancialDestination(page, "Overview");
      await expect(people.locator(".context-household")).toHaveText("Household");
      expect(await status.getAttribute("data-request-id")).toBe(request);
      expect(await status.getAttribute("data-fingerprint")).toBe(fingerprint);
    });

    test("forecast disclosure distinguishes requested coverage from imported setup", async ({ page }) => {
      const draft = createGoldenHouseholdDraft();
      await openBoundedSession(page, draft);
      const status = statusFor(page);
      const details = status.locator(".context-disclosure");
      await showActions(page);
      await expect(details.locator(":scope > summary")).toHaveAccessibleName("Forecast: Needs setup");
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

    test("one action area and Settings privacy preserve manual persistence", async ({ page }) => {
      await openBoundedSession(page);
      await showActions(page);
      const actions = actionsFor(page);
      await expect(actions).toHaveCount(1);
      await expect(actions.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      await expect(actions.locator(".context-save-cue")).toHaveCount(0);
      await expect(page.locator(".topbar .context-model, .topbar .context-forecast, .topbar .context-save, .topbar .context-storage")).toHaveCount(0);
      await clickOutside(page);
      await page.getByRole("button", { name: "Privacy & data", exact: true }).click();
      const privacy = page.locator(".calm-disclosure").filter({ has: page.locator("summary", { hasText: /^Storage & privacy$/ }) });
      await privacy.locator(":scope > summary").click();
      await expect(privacy).toContainText("without encryption");
      await expect(privacy).toContainText("Completing a forecast does not save");
    });

    test("partial forecast details preserve navigation access and nested owner Escape", async ({ page }) => {
      const draft = createGoldenHouseholdDraft();
      const salary = draft.objects.Income![0]!;
      // A one-year, salary-only source fixture avoids unrelated mortgage,
      // contribution and annual-tax setup in this disclosure regression.
      const source: PersonalDraft = { ...draft, objects: {
        Household: draft.objects.Household!, Person: draft.objects.Person!.map(person => ({ ...person, residence_jurisdiction_periods: [] })),
        Account: [draft.objects.Account!.find(account => account.account_type === "checking")!],
        Income: [{ ...salary, growth_model_id: null, related_event_id: null, work_service_jurisdiction_allocations: [], frequency: "weekly" }],
        Scenario: [{ ...draft.objects.Scenario![0]!, assumption_ids: [], event_ids: [], end_date: "2027-01-01" }],
      } };
      await openBoundedSession(page, source);
      const actions = await showActions(page);
      await actions.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Canonical model saved to this browser", { exact: true })).toBeVisible();
      await navigateOwner(page, "Money", "Income");
      await page.getByRole("region", { name: "Income deposit routing", exact: true }).getByLabel("Income receiving account", { exact: true }).selectOption({ label: "Everyday checking" });
      await clickFinancialDestination(page, "Debt");
      await page.getByLabel("Debt owner", { exact: true }).selectOption({ label: "Taylor Example" });
      await navigateOwner(page, "Plan", "Current Plan");
      const investments = page.locator(".financial-section > summary").filter({ hasText: "Investments" }).first();
      if (await investments.locator("..").getAttribute("open") === null) await investments.click();
      await page.getByRole("region", { name: "Household execution configuration", exact: true }).getByLabel("Investment owner", { exact: true }).selectOption({ label: "Taylor Example" });
      await page.getByRole("checkbox", { name: "Use projected current-law scenario", exact: true }).check();
      await page.getByRole("button", { name: "Apply setup & run forecast", exact: true }).click();
      const status = statusFor(page);
      await expect(status).toHaveAttribute("data-lifecycle", "incomplete", { timeout: 30_000 });
      await expect(status).toHaveAttribute("data-pending", "false");
      await expect(status.locator(".status-review")).toHaveCount(1);
      const details = status.locator(".context-disclosure");
      const summary = details.locator(":scope > summary");
      if (width === 1440) {
        // Exercise the long real limitation disclosure, with ordinary pointer
        // clicks on destinations that used to be covered by its warning text.
        for (const enlarged of [false, true]) {
          const style = enlarged ? await page.addStyleTag({ content: "html { font-size: 200%; }" }) : undefined;
          for (const destination of ["Investing", "Cash", "Debt"]) {
            await showForecastLimitations(page);
            const panel = (await details.locator(":scope > .context-popover").boundingBox())!;
            const rail = (await page.getByRole("navigation", { name: "Primary navigation", exact: true }).boundingBox())!;
            const header = (await page.locator(".topbar").boundingBox())!;
            expect(panel.x).toBeGreaterThanOrEqual(rail.x + rail.width);
            expect(panel.y).toBeGreaterThanOrEqual(header.y + header.height);
            expect(panel.y + panel.height).toBeLessThanOrEqual(900);
            expect(panel.x + panel.width).toBeLessThanOrEqual(1440);
            await clickFinancialDestination(page, destination);
            await expect(details).not.toHaveAttribute("open");
          }
          if (style) await style.evaluate(element => element.remove());
        }
      }
      await showActions(page);
      await summary.click();
      const repair = details.getByRole("button", { name: "Review Frequency", exact: true });
      const request = await status.getAttribute("data-request-id");
      const fingerprint = await status.getAttribute("data-fingerprint");
      for (let visit = 0; visit < 2; visit++) {
        await repair.click();
        const editor = page.getByRole("dialog", { name: "Edit Income", exact: true });
        const frequency = editor.getByLabel("Frequency", { exact: true });
        await expect(frequency).toBeFocused();
        // Tab and pointer interactions in the owner must leave its source open.
        await page.keyboard.press("Tab");
        await editor.getByLabel("Source / name", { exact: true }).click();
        await editor.getByRole("button", { name: "Close editor", exact: true }).focus();
        await page.keyboard.press("Escape");
        await expect(editor).toHaveCount(0);
        await expect(details).toHaveAttribute("open", "");
        await expect(repair).toBeVisible();
        await expect(repair).toBeFocused();
        expect(await status.getAttribute("data-request-id")).toBe(request);
        expect(await status.getAttribute("data-fingerprint")).toBe(fingerprint);
      }
      await page.keyboard.press("Escape");
      await expect(details).not.toHaveAttribute("open");
      await expect(summary).toBeFocused();
      await clickOutside(page);
      const people = ribbonFor(page).locator(".context-people");
      await people.locator(":scope > summary").click();
      await page.keyboard.press("Escape");
      await expect(people).not.toHaveAttribute("open");
      await expect(people.locator(":scope > summary")).toBeFocused();
      await showActions(page);
      await summary.click();
      await repair.click();
      const editor = page.getByRole("dialog", { name: "Edit Income", exact: true });
      await editor.getByLabel("Frequency", { exact: true }).selectOption("monthly");
      await editor.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(status).not.toHaveAttribute("data-fingerprint", fingerprint!);
      // Canonical editing invalidates the forecast but cannot persist it.
      await navigateOwner(page, "Settings", "Import / Export");
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export saved backup", exact: true }).click();
      const backup = await download;
      expect(await readFile((await backup.path())!, "utf8")).toBe(exportPersonalModelJson(source));
    });

    test("normal header keeps readable actions together and inside the viewport", async ({ page }) => {
      const draft = createGoldenHouseholdDraft();
      await openBoundedSession(page, { ...draft, objects: { ...draft.objects, Household: [{ ...draft.objects.Household![0]!, name: "Taylor · synthetic Philadelphia retirement plan" }] } });
      const ribbon = ribbonFor(page);
      const controls = ribbon.locator(".context-disclosure > summary");
      const boxes = [];
      for (const control of await controls.all()) {
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await control.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
        boxes.push(box);
      }
      if (width === 1440) {
        // Controls must share a horizontal band, rather than pushing Save/privacy
        // to a second row. Allow differing text heights without fixed snapshots.
        expect(Math.max(...boxes.map(box => box.y))).toBeLessThan(Math.min(...boxes.map(box => box.y + box.height)));
        const settings = (await page.locator(".topbar .settings-button").boundingBox())!;
        expect(settings.x).toBeGreaterThanOrEqual(Math.max(...boxes.map(box => box.x + box.width)));
      }
      for (const selector of [".context-people", ".context-plan"]) {
        const menu = ribbon.locator(selector);
        const trigger = menu.locator(":scope > summary");
        await trigger.click();
        const triggerBox = (await trigger.boundingBox())!;
        const popup = (await menu.locator(".context-popover").boundingBox())!;
        expect(Math.abs(popup.y - (triggerBox.y + triggerBox.height))).toBeLessThanOrEqual(2);
        expect(Math.min(Math.abs(popup.x - triggerBox.x), Math.abs(popup.x + popup.width - triggerBox.x - triggerBox.width))).toBeLessThanOrEqual(2);
        expect(popup.x).toBeGreaterThanOrEqual(0);
        expect(popup.x + popup.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test("enlarged text keeps controls and disclosures in bounds", async ({ page }) => {
      await openBoundedSession(page);
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      const ribbon = ribbonFor(page);
      for (const control of await ribbon.locator(".context-disclosure > summary").all()) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      const people = ribbon.locator(".context-people");
      await people.locator(":scope > summary").click();
      await people.getByRole("button", { name: "Taylor", exact: true }).click();
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
  await expect(people.getByRole("button", { name: "Taylor", exact: true })).toBeVisible();
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
  { name: "one member", members: [recordedPerson], labels: ["Taylor"] },
  { name: "duplicate names", members: [recordedPerson, { ...recordedPerson, person_id: "94000000-0000-4000-8000-000000000244" }], labels: [`Taylor Example · ID ${String(recordedPerson.person_id).slice(-8)}`, "Taylor Example · ID 00000244"] },
  { name: "unnamed member", members: [{ ...recordedPerson, first_name: "", last_name: "" }], labels: ["Unnamed person"] },
]) test(`imported ${name} retain canonical identity and setup state`, async ({ page }) => {
  const imported: PersonalDraft = { ...memberDraft, objects: { ...memberDraft.objects, Household: [{ ...memberDraft.objects.Household![0]!, members: members.map(person => person.person_id!) }], Person: members } };
  await openBoundedSession(page, imported);
  const request = await statusFor(page).getAttribute("data-request-id");
  const fingerprint = await statusFor(page).getAttribute("data-fingerprint");
  const people = ribbonFor(page).locator(".context-people");
  const trigger = people.locator(":scope > summary");
  await trigger.click();
  if (!members.length) await expect(people.getByText("No verified household members.", { exact: true })).toBeVisible();
  else for (const [index, label] of labels.entries()) {
    if (index) await trigger.click();
    await people.getByRole("button", { name: label, exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Person", exact: true });
    await expect(editor).toBeVisible();
    await editor.locator("summary").filter({ hasText: /^Entity IDs$/ }).click();
    await expect(editor.getByText(String(members[index]!.person_id), { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(await statusFor(page).getAttribute("data-request-id")).toBe(request);
    expect(await statusFor(page).getAttribute("data-fingerprint")).toBe(fingerprint);
  }
  await page.keyboard.press("Escape");
  await expect(statusFor(page)).toHaveAttribute("data-lifecycle", "idle");
});

for (const width of [1440, 390]) for (const enlarged of [false, true]) {
  test(`compact status/actions retain source meaning and order at ${width}px, enlarged ${enlarged}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openBoundedSession(page);
    if (enlarged) await page.addStyleTag({ content: "html { font-size: 200%; }" });
    const actions = await showActions(page);
    await expect(actions).toHaveCount(1);
    const summaries = actions.locator(".context-disclosure > summary");
    await expect(summaries).toHaveCount(2);
    await expect(summaries.nth(0)).toHaveAccessibleName(/^Model: /);
    await expect(summaries.nth(1)).toHaveAccessibleName("Forecast: Needs setup");
    await expect(summaries.nth(1).locator(".status-idle")).toHaveCount(1);
    await expect(actions.locator(".context-command-buttons > button")).toHaveText(["Update", "Save"]);
    await expect(page.locator(".topbar .context-actions, .topbar .context-save, .topbar .context-forecast")).toHaveCount(0);
    for (const control of [...await summaries.all(), ...await actions.locator(".context-command-buttons > button").all()]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    const modelBox = (await summaries.nth(0).boundingBox())!;
    const forecastBox = (await summaries.nth(1).boundingBox())!;
    const commands = (await actions.locator(".context-command-buttons").boundingBox())!;
    expect(modelBox.y + modelBox.height).toBeLessThanOrEqual(forecastBox.y);
    expect(forecastBox.y + forecastBox.height).toBeLessThanOrEqual(commands.y);
    if (width === 1440) {
      const rail = page.getByRole("navigation", { name: "Primary navigation", exact: true });
      const links = (await rail.locator(".financial-nav-links").boundingBox())!;
      expect(modelBox.y).toBeGreaterThanOrEqual(links.y + links.height);
      expect(commands.y + commands.height).toBeLessThanOrEqual(900);
    } else {
      await expect(page.locator("#mobile-status-actions .context-actions")).toBeVisible();
      await expect(page.locator(".primary-nav .context-actions")).toHaveCount(0);
    }
    await summaries.nth(0).click();
    await expect(actions.locator(".context-model .context-popover")).toContainText("Current position:");
    await expect(actions.locator(".context-model .context-popover")).toContainText("Model readiness is separate from forecast coverage");
    await page.keyboard.press("Escape");
    await expect(summaries.nth(0)).toBeFocused();
    await summaries.nth(1).click();
    await expect(statusFor(page)).toContainText("Requested coverage is not computed coverage");
    await expect(statusFor(page)).toContainText("No observed account history is included");
    await expect(statusFor(page)).toContainText("No supported forecast is available yet");
    await page.keyboard.press("Escape");
    await expect(summaries.nth(1)).toBeFocused();
    // Both header menus must remain anchored with enlarged text too.
    const more = page.getByRole("button", { name: "More", exact: true });
    if (width === 390) await more.click();
    for (const selector of [".context-people", ".context-plan"]) {
      const menu = ribbonFor(page).locator(selector);
      const trigger = menu.locator(":scope > summary");
      await trigger.focus();
      await page.keyboard.press("Space");
      const box = (await trigger.boundingBox())!;
      const popup = (await menu.locator(".context-popover").boundingBox())!;
      expect(Math.abs(popup.y - box.y - box.height)).toBeLessThanOrEqual(2);
      expect(Math.min(Math.abs(popup.x - box.x), Math.abs(popup.x + popup.width - box.x - box.width))).toBeLessThanOrEqual(2);
      expect(popup.x).toBeGreaterThanOrEqual(0);
      expect(popup.x + popup.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("button").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(menu.getByRole("button").last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const kind of ["no root", "multiple roots", "what-if", "disabled root", "duplicate ID", "renamed root"]) {
  test(`plan navigation preserves recorded execution authority: ${kind}`, async ({ page }) => {
    const original = createGoldenHouseholdDraft();
    const root = original.objects.Scenario![0]!;
    const alternative = { ...root, scenario_id: "94000000-0000-4000-8000-000000000246", name: "Alternative plan", base_scenario_id: root.scenario_id! };
    const scenarios = kind === "no root" ? [] : kind === "multiple roots" ? [root, { ...alternative, base_scenario_id: null }]
      : kind === "what-if" ? [root, alternative] : kind === "disabled root" ? [{ ...root, enabled: false }]
      : kind === "duplicate ID" ? [root, root] : [{ ...root, name: "Recorded renamed plan" }];
    const draft = { ...original, objects: { ...original.objects, Scenario: scenarios } };
    await openBoundedSession(page, draft);
    const status = statusFor(page);
    const request = await status.getAttribute("data-request-id");
    const fingerprint = await status.getAttribute("data-fingerprint");
    const menu = ribbonFor(page).locator(".context-plan");
    const trigger = menu.locator(":scope > summary");
    await expect(trigger).toHaveAccessibleName(kind === "no root" || kind === "disabled root" ? "Plan: Plan unavailable"
      : kind === "multiple roots" || kind === "duplicate ID" ? "Plan: Choose plan"
      : kind === "renamed root" ? "Plan: Recorded renamed plan (saved)" : /^Plan: .+ \(saved\)$/);
    for (const section of ["Compare Plans", "Current Plan"]) {
      await trigger.click();
      await menu.getByRole("button", { name: section, exact: true }).click();
      await expect(page.locator(".subnav").getByRole("button", { name: section, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(trigger).toBeFocused();
      expect(await status.getAttribute("data-request-id")).toBe(request);
      expect(await status.getAttribute("data-fingerprint")).toBe(fingerprint);
      await expect(status).toHaveAttribute("data-lifecycle", "idle");
    }
    await navigateOwner(page, "Settings", "Import / Export");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export current model", exact: true }).click();
    const exported = await download;
    expect(await readFile((await exported.path())!, "utf8")).toBe(exportPersonalModelJson(draft));
  });
}

for (const enlarged of [false, true]) test(`mobile manual Save through More persists the exact imported model, enlarged ${enlarged}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const draft = createGoldenHouseholdDraft();
  await openBoundedSession(page, draft);
  if (enlarged) await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await clickFinancialDestination(page, "Investing");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeHidden();
  await saveCurrentModel(page);
  await expect(page.getByRole("button", { name: "More", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".context-actions")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await navigateOwner(page, "Settings", "Import / Export");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const exported = await download;
  expect(await readFile((await exported.path())!, "utf8")).toBe(exportPersonalModelJson(draft));
});

test.describe("reachable public/demo origin", () => {
  // A real alternate HTTP origin reaches the same Next server for HTML,
  // assets, Workers and HMR. Retain the runner's trace/screenshot fixtures.
  test.use({ viewport: { width: 1440, height: 900 } });
  test("public/demo mode offers Export and accurate privacy instead of Save", async ({ page, baseURL }) => {
    const demo = new URL(baseURL!);
    demo.hostname = "pfm-demo.invalid";
    const draft = createGoldenHouseholdDraft();
    await openBoundedSession(page, draft, demo.href, "Public/demo origin:");
    expect(new URL(page.url()).origin).toBe(demo.origin);
    const actions = await showActions(page);
    await expect(actions.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(actions.getByRole("button", { name: "Export", exact: true })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
    const download = page.waitForEvent("download");
    await actions.getByRole("button", { name: "Export", exact: true }).click();
    const exported = await download;
    expect(await readFile((await exported.path())!, "utf8")).toBe(exportPersonalModelJson(draft));
    await navigateOwner(page, "Settings", "Import / Export");
    await expect(page.getByText("Public/demo origin", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save to this browser", exact: true })).toHaveCount(0);
    const privacy = page.locator(".calm-disclosure").filter({ has: page.locator("summary", { hasText: /^Storage & privacy$/ }) });
    await privacy.locator(":scope > summary").click();
    await expect(privacy).toContainText("does not store personal models");
    await expect(privacy).toContainText("Do not enter real personal financial information");
    expect(await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).not.toContain("personal-finance-app");
    await page.reload();
    await expect(page.locator(".setup .privacy")).toContainText("Public/demo origin:");
    await expect(page.getByRole("button", { name: "Load saved model", exact: true })).toHaveCount(0);
  });
});

for (const kind of ["unlinked person", "foreign pointer", "missing referenced person", "wrong household ID", "missing household link", "duplicate person ID", "missing person ID", "multiple households"]) test(`inconsistent ${kind} offers the canonical correction without false member links`, async ({ page }) => {
  const household = memberDraft.objects.Household![0]!;
  const extraId = "94000000-0000-4000-8000-000000000245";
  let imported: PersonalDraft = { ...memberDraft, objects: { ...memberDraft.objects } };
  switch (kind) {
    case "unlinked person": imported = { ...imported, objects: { ...imported.objects, Person: [recordedPerson, { ...recordedPerson, person_id: extraId }] } }; break;
    case "foreign pointer": imported = { ...imported, objects: { ...imported.objects, Person: [{ ...recordedPerson, household_id: extraId }] } }; break;
    case "missing referenced person": imported = { ...imported, objects: { ...imported.objects, Person: [] } }; break;
    case "wrong household ID": imported = { ...imported, objects: { ...imported.objects, Household: [{ ...household, household_id: extraId }] } }; break;
    case "missing household link": imported = { ...imported, objects: { ...imported.objects, Person: [{ ...recordedPerson, household_id: null }] } }; break;
    case "duplicate person ID": imported = { ...imported, objects: { ...imported.objects, Person: [recordedPerson, recordedPerson] } }; break;
    case "missing person ID": imported = { ...imported, objects: { ...imported.objects, Person: [{ ...recordedPerson, person_id: null }] } }; break;
    case "multiple households": imported = { ...imported, objects: { ...imported.objects, Household: [household, { ...household, household_id: extraId, name: "Other household" }] } }; break;
  }
  await openBoundedSession(page, imported);
  const ribbon = ribbonFor(page);
  await expect(ribbon.locator(".context-household")).toHaveText("Household");
  await expect(actionsFor(page).locator(".context-model > summary")).toHaveAccessibleName(/Model: Needs review|Model: Unavailable/);
  const people = ribbon.locator(".context-people");
  await people.locator(":scope > summary").click();
  await expect(people.getByRole("status")).toContainText("Needs review");
  await expect(people.getByRole("button")).toHaveCount(2);
  await people.getByRole("button", { name: "Add / edit household & people", exact: true }).click();
  await expect(page.locator(".subnav").getByRole("button", { name: "Household & People", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(statusFor(page)).toHaveAttribute("data-lifecycle", "idle");
});
