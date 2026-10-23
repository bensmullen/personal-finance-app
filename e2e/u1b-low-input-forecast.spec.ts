import { expect, test, type Page } from "@playwright/test";
import type { ForecastWorkerResponse } from "../src/application/interactiveForecast.js";
import type { PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import { createFlagshipHouseholdDraft, exportPersonalModelJson, importPersonalModelJson, type JsonObject, type PersonalDraft } from "../src/application/personalMvp.js";
import { readFile } from "node:fs/promises";
import { selectForecastChartData } from "../src/application/forecastChartData.js";
import { formatExactMoney } from "../ui/entityPresentation.js";
import { inspectMortgageWindow, householdEvidenceProof, householdEvidenceSelectionMeasurements, type ReplayRestoreMeasurement } from "../src/application/mortgageChartData.js";
import { inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import { GOLDEN_HOUSEHOLD_IDS } from "../src/application/goldenHousehold.js";
import { clickFinancialDestination, navigateOwner } from "./navigation.js";
import type { EvidenceWorkerResponse } from "../ui/forecast/protocol.js";

const status = (page: Page) => page.getByRole("status", { name: "Household forecast status", exact: true });
// The runner owns this bounded buffer, so a crashed renderer cannot erase the
// last completed phase. Accept only enumerated metadata and numeric counters.
const survivingEvidence = new WeakMap<Page, Record<string, string | number>[]>();
const telemetryStrings = new Set(["controller", "worker", "page", "crash", "closed", "created", "posted", "settled", "rendered", "ignored", "mismatched", "error", "timeout",
  "monthly_evidence", "mortgage_evidence", "progress", "result", "received", "source_bound", "restored", "projected",
  "restore_started", "decoded", "integrity_validated", "participants_restored", "source_requalified", "kernel_compiled", "checkpoints_validated", "restore_warm",
  "catalog_validation_started", "catalog_validated", "qualification_started", "qualification_validated", "replay_started", "replay_executed", "replay_verified", "replay_cached",
  "retained_source", "transported_source", "missing_source", "cold", "warm"]);
function safeEvidenceTelemetry(value: unknown): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  if (!value || typeof value !== "object") return safe;
  const record = value as Record<string, unknown>;
  for (const key of ["surface", "operation", "phase", "outcome", "ownership", "cache"])
    if (typeof record[key] === "string" && telemetryStrings.has(record[key])) safe[key] = record[key];
  if (typeof record.sourceIdentityMatched === "boolean") safe.sourceIdentityMatched = record.sourceIdentityMatched ? 1 : 0;
  for (const key of ["workerId", "requestId", "startIndex", "elapsedMs", "pointCount", "durationMs", "roundtripMs", "mainHeapBytes"])
    if (typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0) safe[key] = record[key];
  const measurements = record.measurements as EvidenceWorkerResponse["measurements"];
  if (measurements && typeof measurements === "object") {
    for (const key of ["selectedMonths", "checkpointCount", "retainedCheckpointStates", "selectedCheckpointIndex", "replayPrefixMonths", "restoreAndSourceValidationMs", "replayAndProjectionMs", "workerHeapAfterBytes"] as const) {
      const number = measurements[key];
      if (typeof number === "number" && Number.isFinite(number) && number >= -1) safe[key] = number;
    }
    const restore = measurements.restore;
    if (restore && typeof restore === "object") {
      if (restore.cache === "cold" || restore.cache === "warm") safe.cache = restore.cache;
      for (const key of ["totalMs", "decodeMs", "integrityValidationMs", "participantRestoreMs", "sourceRequalificationMs", "kernelCompileMs", "checkpointRestoreValidationMs", "checkpointSizeMeasurementMs", "checkpointCount", "materializedCheckpointStates", "serializedCheckpointBytes", "heapBeforeBytes", "heapAfterBytes", "peakSampledHeapBytes"] as const) {
        const number = restore[key];
        if (typeof number === "number" && Number.isFinite(number) && number >= 0) safe[`restore.${key}`] = number;
      }
    }
  }
  return safe;
}
test.afterEach(async ({ page }, info) => {
  const records = survivingEvidence.get(page);
  if (records) await info.attach("surviving-evidence-phases", { body: JSON.stringify(records), contentType: "application/json" });
});
type ObservedWindow = typeof window & {
  __u1bRecordPhase: (record: unknown) => Promise<void>;
  __u1bResults: ForecastWorkerResponse[];
  __u1bEvidence: { workerId: number; operation: string; requestId: number; fingerprint: string; startIndex: number; outcome: string; phase?: string; durationMs?: number; roundtripMs?: number; measurements?: EvidenceWorkerResponse["measurements"] }[];
  __u1bTransport: { workerId: number; phase: "posted" | "terminated"; operation?: string; requestId?: number; startIndex?: number; proofSent?: boolean }[];
  __u1bLongTasks: number[];
  __u1bMortgage?: import("../src/application/mortgageChartData.js").MortgageWindow;
  __u1bFebruary?: ReturnType<typeof inspectMonthlyMoney>;
};
async function observe(page: Page) {
  const records: Record<string, string | number>[] = [];
  survivingEvidence.set(page, records);
  const retain = (value: unknown) => {
    records.push({ ...safeEvidenceTelemetry(value), runnerAtMs: Date.now() });
    if (records.length > 256) records.shift();
  };
  await page.exposeBinding("__u1bRecordPhase", (_source, value: unknown) => retain(value));
  page.on("crash", () => retain({ surface: "page", phase: "crash" }));
  page.on("close", () => retain({ surface: "page", phase: "closed" }));
  await page.addInitScript(() => {
    const observed = window as ObservedWindow;
    const emit = (record: object) => { void observed.__u1bRecordPhase(record).catch(() => {}); };
    window.addEventListener("pfm-evidence-phase", event => {
      const mainHeapBytes = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
      emit({ ...(event as CustomEvent).detail, surface: "controller", mainHeapBytes });
    });
    observed.__u1bResults = [];
    observed.__u1bEvidence = [];
    observed.__u1bTransport = [];
    observed.__u1bLongTasks = [];
    const NativeWorker = window.Worker;
    let nextWorkerId = 0;
    window.Worker = class extends NativeWorker {
      readonly observerId = ++nextWorkerId;
      readonly posted = new Map<string, number>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent<ForecastWorkerResponse | EvidenceWorkerResponse>) => {
          const response = event.data;
          if (response.operation === "baseline_forecast" && response.outcome === "result") observed.__u1bResults.push(response);
          if (response.operation === "monthly_evidence" || response.operation === "mortgage_evidence") {
            if (response.operation === "mortgage_evidence" && response.outcome === "result" && response.window) observed.__u1bMortgage = response.window;
            if (response.operation === "monthly_evidence" && response.startIndex === 1 && response.outcome === "result" && response.detail) observed.__u1bFebruary = response.detail;
            const { operation, requestId, fingerprint, startIndex, outcome, durationMs } = response;
            const started = this.posted.get(`${operation}:${requestId}`);
            emit({ surface: "worker", workerId: this.observerId, operation, requestId, startIndex, outcome, durationMs,
              phase: response.outcome === "progress" ? response.phase : undefined, ownership: response.ownership,
              sourceIdentityMatched: response.sourceIdentityMatched,
              measurements: response.measurements, roundtripMs: started === undefined ? undefined : performance.now() - started });
            // Keep the original navigation history bounded independently of
            // the finer phase stream retained by the runner above.
            if (response.outcome !== "progress" || ["received", "restored", "projected"].includes(response.phase))
              observed.__u1bEvidence = [...observed.__u1bEvidence.slice(-63), { workerId: this.observerId, operation, requestId, fingerprint, startIndex, outcome,
              ...(response.outcome === "progress" ? { phase: response.phase } : {}), ...(durationMs === undefined ? {} : { durationMs }),
              ...(response.measurements === undefined ? {} : { measurements: response.measurements }),
              ...(started === undefined ? {} : { roundtripMs: performance.now() - started }) }];
          }
        });
      }
      override postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        const request = message as { operation: string; requestId: number; startIndex?: number; source?: { basis?: unknown } };
        this.posted.set(`${request.operation}:${request.requestId}`, performance.now());
        observed.__u1bTransport = [...observed.__u1bTransport.slice(-63), { workerId: this.observerId, phase: "posted", operation: request.operation, requestId: request.requestId,
          ...(request.startIndex === undefined ? {} : { startIndex: request.startIndex, proofSent: request.source?.basis !== undefined }) }];
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      override terminate() {
        observed.__u1bTransport = [...observed.__u1bTransport.slice(-63), { workerId: this.observerId, phase: "terminated" }];
        super.terminate();
      }
    };
  });
}
async function actual(page: Page) {
  const fingerprint = await status(page).getAttribute("data-fingerprint");
  // Snapshot the EXACT committed 649 monthly readouts without copying the
  // entire heavyweight per-month diagnostic/lineage graphs across Playwright.
  // Keep original immutable replay anchors, fingerprints and all chart money:
  // the test still independently replays first/middle/final paid mortgage flows.
  // The full worker result caused a 323 MiB Playwright trace transfer:
  // 304.7 MiB was top-level diagnostics. Project exactly the predicate that
  // the test checks, without dropping any matching diagnostic or relaxing it.
  const result = await page.evaluate(fingerprint => {
    const response = [...(window as ObservedWindow).__u1bResults].reverse().find(item => item.fingerprint === fingerprint && item.outcome === "result");
    if (response?.outcome !== "result" || !("points" in response.result)) return undefined;
    const forecast = response.result as PersonalHouseholdForecastReadModel;
    return {
      ...forecast,
      // Preserve the exact withholding-coverage assertion without serializing
      // 649 months of unrelated diagnostics into Playwright and the renderer.
      diagnostics: forecast.diagnostics.filter(item => "category" in item && item.category === "wage_gross_to_net_withholding"),
      points: forecast.points.map(point => {
      const replay = point.traceRefs.find(ref => ref.replayArtifact !== undefined);
      if (!replay) throw new Error("Committed forecast point lacks original replay source");
      return {
        periodStart: point.periodStart, periodEnd: point.periodEnd,
        cash: point.cash, investmentValue: point.investmentValue,
        totalAssets: point.totalAssets, totalLiabilities: point.totalLiabilities,
        netWorth: point.netWorth, debtBalances: point.debtBalances, statementIncome: point.statementIncome,
        statementExpenses: point.statementExpenses,
        outputCapabilities: point.outputCapabilities, traceIds: point.traceIds,
        traceRefs: [replay],
      };
    }) } as PersonalHouseholdForecastReadModel;
  }, fingerprint);
  if (!result || result.status === "unavailable") throw new Error("No actual supported current worker result");
  return result;
}
async function start(page: Page) {
  await observe(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Use synthetic example", exact: true }).click();
}
async function importModel(page: Page, model: PersonalDraft) {
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "u1b-synthetic.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(model)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`one click produces real retirement-planning coverage and financial readouts at ${width}px`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await start(page);
    await expect(page.getByRole("heading", { name: "Know where you stand.", exact: true })).toBeVisible();
    await expect(status(page)).toHaveAttribute("data-lifecycle", "completed", { timeout: 150_000 });
    const result = await actual(page);
    const payloadEvidence = await page.evaluate(() => {
      const response = (window as ObservedWindow).__u1bResults.at(-1);
      const records = response?.records.filter(record => record.resources?.structuralCounters?.forecastPointCount !== undefined) ?? [];
      const mainHeapBytes = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      return { records, ...(mainHeapBytes === undefined ? {} : { mainHeapBytes }) };
    });
    const counters = payloadEvidence.records[0]?.resources?.structuralCounters;
    expect(counters?.forecastPointCount).toBe(649);
    expect(counters?.projectedLawWarningCount).toBe(1254);
    expect(counters?.uniqueCatalogCount).toBe(1);
    expect(counters!.diagnosticBytesAfter).toBeLessThan(counters!.diagnosticBytesBefore! / 20);
    await info.attach(`flagship-${width}-portable-serialization-counters`, { body: JSON.stringify(payloadEvidence), contentType: "application/json" });
    const referenceRestores: ReplayRestoreMeasurement[] = [];
    const referenceObserver = { now: () => performance.now(), includeCheckpointBytes: true,
      record: (measurement: ReplayRestoreMeasurement) => { referenceRestores.push(measurement); } };
    const referenceWindows: { startIndex: number; durationMs: number; selectedMonths: number; checkpointCount: number; selectedCheckpointIndex: number; replayPrefixMonths: number }[] = [];
    expect(result.status).toBe("completed");
    expect(result.requestedHorizon.start.slice(0, 10)).toBe("2026-01-01");
    expect(result.requestedHorizon.end.slice(0, 10)).toBe("2080-02-01");
    expect(result.reachedThrough?.slice(0, 10)).toBe("2080-02-01");
    expect(result.points).toHaveLength(649);
    expect(result.openingSnapshot.cash.amount).toBe("4015000");
    expect(result.openingSnapshot.netWorth.amount).toBe("4289330.29");
    expect(result.points[0]!.cash.amount).toBe("4007874.71");
    expect(result.points[0]!.statementIncome.amount).toBe("0");
    expect(result.points[6]!.statementIncome.amount).not.toBe("0");
    expect(result.retirementMilestones).toContainEqual(expect.objectContaining({ date: "2055-01-01" }));
    const working = result.points.find(point => point.periodStart.startsWith("2054-12"))!;
    const retired = result.points.find(point => point.periodStart.startsWith("2055-01"))!;
    expect(working.statementIncome.amount).not.toBe("0");
    expect(retired.statementIncome.amount).toBe("0");
    expect(retired.investmentValue.amount).not.toBe(result.points[0]!.investmentValue.amount);
    expect(result.diagnostics.some(item => "category" in item && item.category === "wage_gross_to_net_withholding")).toBe(false);
    const charts = page.locator(".financial-charts");
    await expect(charts).toHaveAttribute("data-supported-months", "649");
    await page.screenshot({ path: info.outputPath(`flagship-first-screen-${width}.png`), fullPage: false });
    const chart = page.getByRole("figure", { name: "Household financial outlook chart", exact: true });
    await chart.locator(".chart-control-details > summary").click();
    const annual = selectForecastChartData(result, { granularity: "annual" });
    const selected = annual.points.find(point => point.periodStart.startsWith("2055-01"))!;
    await chart.getByLabel("Selected projected period", { exact: true }).selectOption(selected.periodStart);
    await expect(chart.locator(".chart-selected")).toContainText(formatExactMoney(selected.metrics.netWorth.amount!, selected.metrics.netWorth.currency));
    await expect(page.getByRole("region", { name: "Requested and modeled coverage" })).toContainText("2080-02-01");
    await info.attach(`flagship-${width}-coverage`, { body: JSON.stringify({ status: result.status, requested: result.requestedHorizon, reachedThrough: result.reachedThrough, opening: result.openingSnapshot, retirement: result.retirementMilestones, selectedYear: selected }), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath(`flagship-${width}.png`), fullPage: true });
    // Instrument the actual route transition, after the 649-month result has
    // committed. Retain only bounded durations and request/source identities.
    await page.evaluate(() => {
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        new PerformanceObserver(list => {
          const target = window as ObservedWindow;
          target.__u1bLongTasks = [...target.__u1bLongTasks, ...list.getEntries().map(entry => entry.duration)].slice(-32);
        }).observe({ entryTypes: ["longtask"] });
      }
    });
    const requestId = await status(page).getAttribute("data-request-id");
    const fingerprint = await status(page).getAttribute("data-fingerprint");
    const cashStarted = Date.now();
    await clickFinancialDestination(page, "Cash");
    const cash = page.getByRole("figure", { name: "Total modeled cash (including cash in investment accounts)", exact: true });
    const statements = page.getByRole("figure", { name: "Modeled statement income versus expenses", exact: true });
    await expect(cash).toBeVisible();
    await expect(statements).toBeVisible();
    expect(Date.now() - cashStarted).toBeLessThan(10_000);
    const paycheck = page.getByRole("region", { name: "Your Paycheck", exact: true });
    await paycheck.getByLabel("paycheck forecast month", { exact: true }).selectOption("2026-02");
    await expect(paycheck.getByRole("button", { name: "Example salary", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as ObservedWindow).__u1bFebruary)).toEqual(inspectMonthlyMoney(result.points[1]!, createFlagshipHouseholdDraft(), referenceObserver));
    await cash.getByLabel("Selected projected period", { exact: true }).selectOption(selected.periodStart);
    await expect(cash.locator(".chart-selected dd").first()).toContainText(formatExactMoney(selected.metrics.totalModeledCash.amount!, selected.metrics.totalModeledCash.currency));
    // Read actual modeled pay both before and after the accepted retirement,
    // rather than treating chart presence as financial acceptance.
    await statements.getByLabel("Monthly range starting", { exact: true }).selectOption(working.periodStart);
    for (const point of [working, retired]) {
      await statements.getByLabel("Selected projected period", { exact: true }).selectOption(point.periodStart);
      await expect(statements.locator(".chart-selected dd")).toHaveText([
        formatExactMoney(point.statementIncome.amount, point.statementIncome.currency),
        formatExactMoney(point.statementExpenses.amount, point.statementExpenses.currency),
      ]);
    }
    const debtStarted = Date.now();
    await clickFinancialDestination(page, "Debt");
    const liabilities = page.getByRole("figure", { name: "Modeled household liability balances", exact: true });
    await expect(liabilities).toBeVisible();
    expect(Date.now() - debtStarted).toBeLessThan(10_000);
    await page.getByLabel("Selected liability month", { exact: true }).selectOption(result.points[0]!.periodStart);
    await expect(liabilities.getByRole("status")).toContainText(formatExactMoney(result.points[0]!.totalLiabilities.amount, result.points[0]!.totalLiabilities.currency));
    const mortgage = page.getByRole("figure", { name: "Example mortgage monthly cash paid", exact: true });
    await expect(mortgage).toBeVisible({ timeout: 30_000 });
    const paid = inspectMortgageWindow(result.points.slice(0, 12), GOLDEN_HOUSEHOLD_IDS.mortgage, referenceObserver).rows[0]!;
    await expect(mortgage.getByRole("status")).toHaveText(`2026-01 · Interest paid ${formatExactMoney(paid.interestPaid, paid.currency)} · Scheduled principal paid ${formatExactMoney(paid.scheduledPrincipalPaid, paid.currency)} · Extra principal paid ${formatExactMoney(paid.extraPrincipalPaid, paid.currency)}`);
    // Real 649-point source: first, middle and final partial windows preserve
    // all paid/funding/principal and trace IDs, not just chart presence.
    for (const startIndex of [0, 324, 648]) {
      if (startIndex) {
        await page.getByLabel("Liability window starting", { exact: true }).selectOption(result.points[startIndex]!.periodStart);
      }
      // Do not run a second independent detailed replay concurrently with
      // the browser worker: two expensive checkpoint restorations compete for
      // CI memory at the age-90 middle window. Await the actual sourced worker
      // result first, then independently verify every paid amount and identity.
      const selectedStart = result.points[startIndex]!.periodStart;
      try {
        await expect.poll(() => page.evaluate(() => (window as ObservedWindow).__u1bMortgage?.start),
          { timeout: 25_000 }).toBe(selectedStart);
      } finally {
        const phases = await page.evaluate(() => ({ transport: (window as ObservedWindow).__u1bTransport, evidence: (window as ObservedWindow).__u1bEvidence }))
          .catch(error => ({ browserUnavailable: String(error) }));
        await info.attach(`flagship-${width}-window-${startIndex}-phases`, { body: JSON.stringify(phases), contentType: "application/json" });
      }
      const actualWindow = await page.evaluate(() => (window as ObservedWindow).__u1bMortgage);
      const selectedPoints = result.points.slice(startIndex, startIndex + 12), referenceStarted = performance.now();
      const expected = inspectMortgageWindow(selectedPoints, GOLDEN_HOUSEHOLD_IDS.mortgage, referenceObserver);
      referenceWindows.push({ durationMs: performance.now() - referenceStarted,
        ...householdEvidenceSelectionMeasurements(householdEvidenceProof(result.points)!, { operation: "mortgage_evidence", startIndex, liabilityId: GOLDEN_HOUSEHOLD_IDS.mortgage }, selectedPoints.length) });
      expect(actualWindow).toEqual(expected);
    }
    expect(referenceRestores[0]).toEqual(expect.objectContaining({ cache: "cold", checkpointCount: 54, materializedCheckpointStates: 54 }));
    expect(referenceRestores[0]!.serializedCheckpointBytes).toBeGreaterThan(0);
    expect(referenceRestores.slice(1).every(item => item.cache === "warm" && item.materializedCheckpointStates === 0)).toBe(true);
    await info.attach(`flagship-${width}-independent-checkpoints`, { body: JSON.stringify({ referenceRestores, referenceWindows }), contentType: "application/json" });
    await page.getByLabel("Liability window starting", { exact: true }).selectOption(result.points[0]!.periodStart);
    // A second transition verifies responsive navigation and retained month
    // selection after both evidence projections, without another forecast.
    const returnStarted = Date.now();
    await clickFinancialDestination(page, "Cash");
    await expect(cash).toBeVisible();
    expect(Date.now() - returnStarted).toBeLessThan(10_000);
    await expect(paycheck.getByLabel("paycheck forecast month", { exact: true })).toHaveValue("2026-02");
    await expect(paycheck).toHaveAttribute("data-evidence-state", "incomplete");
    const comparison = paycheck.getByRole("figure", { name: "Where modeled income goes comparison", exact: true });
    await expect(comparison).toContainText("Zero modeled income");
    const february = inspectMonthlyMoney(result.points[1]!);
    await expect(paycheck.locator(".cash-excess")).toContainText(formatExactMoney(february.additionalFunding, february.currency));
    await expect(status(page)).toHaveAttribute("data-request-id", requestId!);
    await expect(status(page)).toHaveAttribute("data-fingerprint", fingerprint!);
    await expect(status(page)).toHaveAttribute("data-lifecycle", "completed");
    const navigationEvidence = await page.evaluate(() => ({
      baselineResponses: (window as ObservedWindow).__u1bResults.length,
      evidence: (window as ObservedWindow).__u1bEvidence,
      transport: (window as ObservedWindow).__u1bTransport,
      longTasksMs: (window as ObservedWindow).__u1bLongTasks,
    }));
    expect(navigationEvidence.baselineResponses).toBe(1);
    expect(navigationEvidence.evidence).toContainEqual(expect.objectContaining({ operation: "mortgage_evidence", startIndex: 0, outcome: "result" }));
    for (const startIndex of [0, 324, 648]) expect(navigationEvidence.evidence).toContainEqual(expect.objectContaining({ operation: "mortgage_evidence", startIndex, outcome: "result" }));
    expect(navigationEvidence.evidence).toContainEqual(expect.objectContaining({ operation: "monthly_evidence", startIndex: 1, outcome: "result" }));
    const survived = survivingEvidence.get(page)!;
    for (const startIndex of [0, 324, 648]) {
      expect(survived).toContainEqual(expect.objectContaining({ surface: "worker", operation: "mortgage_evidence", startIndex, phase: "replay_verified", ownership: "retained_source" }));
      expect(survived).toContainEqual(expect.objectContaining({ surface: "controller", operation: "mortgage_evidence", startIndex, phase: "rendered" }));
    }
    const baselineWorker = navigationEvidence.transport.find(item => item.operation === "baseline_forecast")!.workerId;
    expect(navigationEvidence.transport.filter(item => item.startIndex !== undefined).every(item => item.workerId === baselineWorker && !item.proofSent)).toBe(true);
    expect(navigationEvidence.transport.filter(item => item.phase === "terminated" && item.workerId === baselineWorker)).toHaveLength(0);
    await info.attach(`flagship-${width}-navigation`, { body: JSON.stringify(navigationEvidence), contentType: "application/json" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("saved flagship recovers durable requested dates and paycheck bank without reauthorizing session choices", async ({ page }) => {
  test.setTimeout(60_000);
  await start(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Load saved model", exact: true }).click();
  await expect(status(page)).toHaveAttribute("data-lifecycle", "idle");
  await navigateOwner(page, "Plan", "Current Plan");
  await expect(page.getByLabel("Simulation end", { exact: true })).toHaveValue("2080-02-01");
  await expect(page.locator('[data-repair="lawScenario"]')).not.toBeChecked();
  await expect(page.getByLabel("Investment owner", { exact: true })).toHaveValue("");
  await navigateOwner(page, "Money", "Income");
  await expect(page.getByLabel("Income receiving account", { exact: true })).toHaveValue("90000000-0000-4000-8000-000000000004");
  await expect(page.getByRole("region", { name: "Source-bound paycheck withholding" })).toContainText("Explicit synthetic monthly paycheck election");
});

test("normalization previews exact currency input without silently committing ambiguous input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const input = page.getByLabel("Monthly income", { exact: true });
  await input.fill(" $6,000.25 ");
  await expect(input).toHaveValue(" $6,000.25 ");
  await expect(page.getByText("Preview: 6000.25 USD.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Use normalized value", exact: true }).click();
  await expect(input).toHaveValue("6000.25");
  await input.fill("1,23");
  await expect(page.getByRole("button", { name: "Use normalized value", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(input).toBeVisible();
});

test("imported non-unique banks need human choice and retain source facts", async ({ page }) => {
  const model = createFlagshipHouseholdDraft();
  const imported = { ...model, objects: { ...model.objects, PrimitiveInstance: (model.objects.PrimitiveInstance as readonly JsonObject[]).filter(primitive => !(typeof primitive.parameters === "object" && primitive.parameters !== null && !Array.isArray(primitive.parameters) && primitive.parameters.adapter === "payroll-withholding/v1")) } };
  await start(page);
  await navigateOwner(page, "Settings", "Import / Export");
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-no-paycheck-election.json", mimeType: "application/json", buffer: Buffer.from(exportPersonalModelJson(imported)) });
  await page.getByRole("button", { name: "Import into session", exact: true }).click();
  await navigateOwner(page, "Money", "Income");
  const bank = page.getByLabel("Income receiving account", { exact: true });
  await expect(bank).toHaveValue("");
  await expect(bank.locator("option")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Accept named receiving bank/ })).toHaveCount(0);
  await expect(status(page)).toHaveAttribute("data-lifecycle", "idle");
});

test("sourced young adult gets an editable horizon beyond forty years and a declinable retirement proposal", async ({ page }) => {
  const model = createFlagshipHouseholdDraft();
  const young: PersonalDraft = { ...model, objects: { ...model.objects,
    Person: (model.objects.Person as readonly JsonObject[]).map(person => ({ ...person, date_of_birth: "2008-01-01" })),
    Income: (model.objects.Income as readonly JsonObject[]).map(income => ({ ...income, related_event_id: null })),
    Event: [], Scenario: (model.objects.Scenario as readonly JsonObject[]).map(plan => ({ ...plan, event_ids: [] })),
  } };
  await start(page); await importModel(page, young);
  await navigateOwner(page, "Plan", "Current Plan");
  await page.getByText("Forecast clock & conventions", { exact: true }).click();
  // Scope to the editable Current Plan owner; the technical standalone drill-down
  // intentionally also contains a read-only "As of" display.
  await page.locator('[data-financial-field="asOf"] input[type="date"]').fill("2026-08-01");
  await navigateOwner(page, "Plan", "Current Plan");
  const target = page.getByRole("region", { name: "Age-oriented forecast target", exact: true });
  await expect(target).toContainText("2098-02-01");
  await expect(page.getByLabel("Simulation end", { exact: true })).toHaveValue("2080-02-01");
  await target.getByRole("button", { name: "Apply requested age target", exact: true }).click();
  await expect(page.getByLabel("Simulation end", { exact: true })).toHaveValue("2098-02-01");
  await navigateOwner(page, "Plan", "Life Events");
  const retirement = page.getByRole("region", { name: "Taylor retirement proposal", exact: true });
  await expect(retirement).toContainText("2073-01-01");
  await retirement.getByRole("button", { name: "Dismiss Taylor's retirement proposal", exact: true }).click();
  await expect(page.getByText("Taylor's age-65 retirement suggestion dismissed for this session.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Review suggestion", exact: true }).click();
  await page.getByRole("region", { name: "Taylor retirement proposal", exact: true }).getByRole("button", { name: "Accept Taylor's retirement proposal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Taylor retirement proposal", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Planned retirement date", { exact: true })).toHaveValue("2073-01-01");
  await expect(status(page)).toHaveAttribute("data-lifecycle", "idle");
});

test("new plans accept one coherent editable starter set without inventing balances or benefits", async ({ page }) => {
  await page.goto("/");
  for (const [label, value] of [["Household name", "Source-backed starter"], ["Monthly income", "6000"], ["Opening cash balance", "5000"], ["Asset cost basis", "0"], ["Current debt", "0"], ["Monthly spending", "3000"]]) {
    const field = page.getByLabel(label!, { exact: true });
    if (label !== "Household name") await expect(field).toHaveValue("");
    await field.fill(value!); await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByLabel("Projection horizon (years)", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await navigateOwner(page, "Plan", "Assumptions");
  const starters = page.getByRole("region", { name: "Optional planning starting points", exact: true });
  await starters.getByLabel("Nominal expense growth", { exact: true }).fill("3.25");
  await starters.getByRole("button", { name: "Dismiss generic portfolio return", exact: true }).click();
  await starters.getByRole("button", { name: "Apply accepted starting points", exact: true }).click();
  await expect(starters).toHaveCount(0);
  await navigateOwner(page, "Settings", "Import / Export");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current model", exact: true }).click();
  const model = importPersonalModelJson(await readFile((await (await downloading).path())!, "utf8"));
  expect(model.objects.Assumption).toEqual(expect.arrayContaining([expect.objectContaining({ category: "inflation", value: "0.0325" }), expect.objectContaining({ category: "salary_growth", value: "0.03" }), expect.objectContaining({ name: "Essential-expense reserve goal", value: "6" })]));
  expect((model.objects.Assumption as readonly JsonObject[]).some(item => item.category === "market_return")).toBe(false);
  expect(model.objects.Transaction ?? []).toHaveLength(0);
  expect(model.objects.Event ?? []).toHaveLength(0);
  expect((model.objects.Account![0] as JsonObject).opening_balance).toBe("5000");
});
