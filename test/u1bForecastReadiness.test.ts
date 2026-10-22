import { describe, expect, it } from "vitest";
import { createFlagshipHouseholdDraft, createGoldenHouseholdDraft, exportPersonalModelJson, importPersonalModelJson, type JsonObject, type PersonalDraft } from "../src/application/personalMvp.js";
import { age90Horizon, birthdayAtAge, retirementProposals, resolveForecastReadiness } from "../src/application/forecastReadiness.js";
import { createGoldenExampleConfiguration, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { createHouseholdForecastRequest, runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { baselineResultMatchesRequest, calculationFingerprint } from "../src/application/interactiveForecast.js";
import { EvidenceController, ForecastController, type EvidenceWorkerPort, type ForecastWorkerPort } from "../ui/forecast/controller.js";
import type { EvidenceWorkerRequest, EvidenceWorkerResponse, ForecastWorkerRequest } from "../ui/forecast/protocol.js";
import { executeForecastWorkerRequest } from "../ui/forecast/execute.js";
import { cashComparison, inspectMonthlyMoney } from "../src/application/monthlyMoney.js";
import { inspectMortgageWindow } from "../src/application/mortgageChartData.js";
import type { HouseholdForecastRequest, PersonalHouseholdForecastReadModel } from "../src/application/householdProjection.js";
import { acceptRetirementProposal, acceptPlanningStarters } from "../src/application/forecastSetup.js";
import { diagnosticSummary } from "../ui/authoring/diagnosticSummary.js";

const withDob = (dob: string): PersonalDraft => {
  const model = createGoldenHouseholdDraft();
  return { ...model, objects: { ...model.objects, Person: (model.objects.Person as readonly JsonObject[]).map(person => ({ ...person, date_of_birth: dob })) } };
};

// Transport-only fixtures: no amounts or replay are synthesized. The real
// engine regression below separately requires the actual two monthly results.
const transportResult = (request: HouseholdForecastRequest, status: "completed" | "incomplete" = "completed", count = request.compiler.cashFlow!.months!): PersonalHouseholdForecastReadModel => {
  const start = `${request.compiler.cashFlow!.simulationStart}T00:00:00.000Z`;
  const at = (offset: number) => { const date = new Date(start); date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString(); };
  return { scope: "household", status, asOf: `${request.asOf}T00:00:00.000Z`, dataCutoff: `${request.dataCutoff}T00:00:00.000Z`,
    requestedHorizon: { start, end: `${request.compiler.cashFlow!.simulationEnd}T00:00:00.000Z` },
    reachedThrough: at(count), points: Array.from({ length: count }, (_, index) => ({ periodStart: at(index), periodEnd: at(index + 1) })),
  } as unknown as PersonalHouseholdForecastReadModel;
};

describe("U1B request and period pairing", () => {
  it("rejects wrong windows, missing completed periods and gaps while preserving truthful zero-period incomplete", () => {
    const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: "2026-03-01" }, ids.model);
    const good = transportResult(request);
    expect(baselineResultMatchesRequest(good, request)).toBe(true);
    expect(baselineResultMatchesRequest(transportResult(request, "completed", 0), request)).toBe(false);
    expect(baselineResultMatchesRequest(transportResult(request, "incomplete", 0), request)).toBe(true);
    if (good.status === "unavailable") throw new Error("Expected transport fixture");
    expect(baselineResultMatchesRequest({ ...good, points: good.points.slice(1) }, request)).toBe(false);
    expect(baselineResultMatchesRequest({ ...good, requestedHorizon: { ...good.requestedHorizon, end: "2080-02-01T00:00:00.000Z" } }, request)).toBe(false);
  });
  it("keeps the latest short request paired through supersession, cache hits, invalidation and retry", () => {
    const workers: (ForecastWorkerPort & { request?: ForecastWorkerRequest })[] = [];
    const controller = new ForecastController(() => {
      const worker: ForecastWorkerPort & { request?: ForecastWorkerRequest } = {
        onmessage: null, onerror: null, onmessageerror: null, terminate() {}, postMessage(message) { this.request = message; },
      };
      workers.push(worker); return worker;
    }, { set: () => { throw new Error("Immediate submissions expected"); }, clear: () => {} }, () => {}, () => {});
    const model = createFlagshipHouseholdDraft();
    const submit = (end: string) => {
      const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: end }, ids.model);
      return { operation: "baseline_forecast" as const, model, request, fingerprint: calculationFingerprint("baseline_forecast", model, request),
        performanceContext: { runId: request.runIdentity, dataClassification: "synthetic" as const, modelCounts: {}, executionLocation: "browser_worker" as const, cacheState: "miss" as const } };
    };
    const deliver = (index: number, result = transportResult(workers[index]!.request!.request)) => {
      const message = workers[index]!.request!;
      workers[index]!.onmessage?.({ data: { operation: message.operation, requestId: message.requestId, fingerprint: message.fingerprint, outcome: "result", result, records: [] } });
    };
    const long = submit("2080-02-01"), short = submit("2026-03-01");
    controller.submit(long, true); controller.submit(short, true);
    deliver(0);
    expect(controller.state.pending).toBe(true);
    const good = transportResult(short.request);
    deliver(1, good);
    expect(controller.state).toMatchObject({ lastGoodResult: good, resultRequest: short.request, cacheState: "miss", resultFingerprint: short.fingerprint });
    controller.submit(short, true);
    expect(workers).toHaveLength(2);
    expect(controller.state).toMatchObject({ lastGoodResult: good, cacheState: "hit", pending: false });
    controller.submit(long, true);
    expect(controller.state.latestResult).toBeUndefined();
    controller.invalidate(); deliver(2);
    expect(controller.state).toMatchObject({ lastGoodResult: good, stale: true, pending: false });
    controller.submit(long, true);
    deliver(3, transportResult(short.request));
    expect(controller.state).toMatchObject({ lifecycle: "error", lastGoodResult: good, stale: true });
    controller.submit(short, true);
    expect(controller.state).toMatchObject({ lifecycle: "completed", cacheState: "hit", resultRequest: short.request });
    controller.reset(); controller.submit(short, true);
    expect(workers).toHaveLength(5);
    expect(controller.state.lastGoodResult).toBeUndefined();
    controller.dispose();
  });
});

describe("U1B sourced planning readiness", () => {
  it("executes both requested months when the accepted flagship horizon is shortened", () => {
    const model = createFlagshipHouseholdDraft();
    const configuration = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-03-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(configuration, ids.model));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    if (result.status === "unavailable") throw new Error(result.message);
    expect(result.points, JSON.stringify(result.diagnostics)).toHaveLength(2);
    expect(result.requestedHorizon.end).toBe("2026-03-01T00:00:00.000Z");
    expect(result.reachedThrough).toBe(result.requestedHorizon.end);
    expect(result.points.map(point => point.statementIncome.amount)).toEqual(["0", "0"]);
    const before = JSON.stringify({ model, result });
    const fingerprintBefore = calculationFingerprint("baseline_forecast", model, createHouseholdForecastRequest(configuration, ids.model));
    let tick = 0;
    const clock = { now: () => ++tick };
    const selection = (startIndex: number): EvidenceWorkerRequest => ({ operation: "monthly_evidence", requestId: startIndex + 1, startIndex, liabilityId: "",
      fingerprint: result.points[startIndex]!.traceRefs.find(ref => ref.replayArtifact !== undefined)!.traceId });
    for (const index of [0, 1]) {
      const response = executeForecastWorkerRequest({ ...selection(index), ...(index === 0 ? { source: structuredClone({ forecast: result, model }) } : {}) }, clock);
      expect(response).toMatchObject({ ...selection(index), outcome: "result", durationMs: 1 });
      if (response.outcome !== "result") throw new Error(response.error);
      expect(response.detail).toEqual(inspectMonthlyMoney(result.points[index]!, model));
      expect(cashComparison(response.detail!)?.knownUsesOnly).toBe(true);
      expect(cashComparison(response.detail!)?.drawable).toBe(true);
    }
    const mortgage = executeForecastWorkerRequest({ ...selection(0), operation: "mortgage_evidence", liabilityId: ids.mortgage }, clock);
    expect(mortgage.outcome).toBe("result");
    if (mortgage.outcome === "result") expect(mortgage.window).toEqual(inspectMortgageWindow(result.points, ids.mortgage));
    expect(executeForecastWorkerRequest({ ...selection(0), fingerprint: "wrong-source" }, clock).outcome).toBe("error");
    expect(executeForecastWorkerRequest({ ...selection(0), startIndex: -1 }, clock).outcome).toBe("error");
    const missing = { ...result, points: result.points.map(point => ({ ...point, traceRefs: [] })) };
    expect(executeForecastWorkerRequest({ ...selection(0), source: { forecast: missing, model } }, clock).outcome).toBe("error");
    expect(executeForecastWorkerRequest({ ...selection(0), source: { forecast: result, model } }, { now() { throw new Error("clock"); } }).outcome).toBe("result");
    expect(JSON.stringify({ model, result })).toBe(before);
    expect(calculationFingerprint("baseline_forecast", model, createHouseholdForecastRequest(configuration, ids.model))).toBe(fingerprintBefore);

    const workers: (EvidenceWorkerPort & { messages: EvidenceWorkerRequest[]; stopped: boolean })[] = [];
    const evidence = new EvidenceController({ forecast: result, model }, () => {
      const worker: typeof workers[number] = { onmessage: null, onerror: null, onmessageerror: null, messages: [], stopped: false,
        postMessage(message) { this.messages.push(message); }, terminate() { this.stopped = true; } };
      workers.push(worker); return worker;
    });
    const delivered: EvidenceWorkerResponse[] = [], cancelled: EvidenceWorkerResponse[] = [];
    const stop = evidence.select(selection(0), response => cancelled.push(response));
    evidence.select(selection(0), response => delivered.push(response));
    stop();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.messages).toHaveLength(1);
    const first = executeForecastWorkerRequest(workers[0]!.messages[0]!, clock);
    workers[0]!.onmessage?.({ data: { ...first, fingerprint: "superseded-source" } });
    expect(delivered).toHaveLength(0);
    workers[0]!.onmessage?.({ data: first });
    expect(cancelled).toHaveLength(0);
    expect(delivered).toEqual([first]);
    evidence.select(selection(0), response => delivered.push(response));
    expect(workers[0]!.messages).toHaveLength(1); // exact cache hit
    evidence.select(selection(1), response => delivered.push(response));
    expect(workers[0]!.messages[1]!.source).toBeUndefined(); // one transported basis
    workers[0]!.onerror?.({ preventDefault() {} });
    expect(workers[0]!.stopped).toBe(true);
    expect(delivered.at(-1)?.outcome).toBe("error");
    evidence.select(selection(1), response => delivered.push(response));
    expect(workers).toHaveLength(2);
    expect(workers[1]!.messages[0]!.source).toEqual({ forecast: result, model });
    const pending = executeForecastWorkerRequest(workers[1]!.messages[0]!, clock);
    evidence.dispose();
    const count = delivered.length;
    workers[1]!.onmessage?.({ data: pending });
    expect(delivered).toHaveLength(count);
    expect(workers[1]!.stopped).toBe(true);
  });
  it("keeps the economic consequence of partial payroll, contribution and tax coverage visible", () => {
    const summary = (category: string) => diagnosticSummary({ code: "PFA-TAX-009", entityType: "tax_capability", category, taxYear: "2027" });
    expect(summary("contribution_annual_facts").problem).toContain("Affected contributions are skipped; wages and other household activity continue");
    expect(summary("contribution_annual_facts").remedy).toContain("does not establish personal eligibility");
    expect(summary("wage_gross_to_net_withholding").problem).toContain("Gross earnings do not establish spendable net deposits");
    expect(summary("wage_gross_to_net_withholding").problem).toContain("after-tax cash and net worth remain incomplete");
    expect(summary("payroll_source_unsupported").remedy).toContain("unsupported salary and withholding were not executed");
    for (const category of ["filing_status_year_unknown", "filing_status_conflict", "filing_status", "residence_jurisdiction_periods", "local_residence_jurisdiction"])
      expect(summary(category).problem).toContain("incomplete");
    expect(summary("filing_status_year_unknown").remedy).toContain("Household & People");
    expect(summary("filing_status").remedy).toContain("Import");
  });
  it.each([
    ["2008-01-01", "2098-02-01"], ["1960-06-15", "2050-07-01"], ["1990-01-01", "2080-02-01"],
  ])("includes %s's birthday month without a forty-year clip", (dob, end) => {
    expect(age90Horizon(withDob(dob), [ids.person], "2026-01-01")?.end).toBe(end);
  });
  it("handles leap birthdays, older anchors, missing DOB and explicit multi-adult selection", () => {
    expect(birthdayAtAge("2000-02-29", 65)).toBe("2065-02-28");
    expect(age90Horizon(withDob("1930-01-01"), [ids.person], "2026-01-01")).toBeUndefined();
    expect(age90Horizon(withDob("1930-01-01"), [ids.person], "2026-01-01", 100)?.end).toBe("2030-02-01");
    expect(age90Horizon(withDob(""), [ids.person], "2026-01-01")).toBeUndefined();
    expect(age90Horizon(withDob("2015-01-01"), [ids.person], "2026-01-01")).toBeUndefined();
    const model = withDob("1970-06-01"), other = "90000000-0000-4000-8000-000000000099";
    const two = { ...model, objects: { ...model.objects, Household: (model.objects.Household as readonly JsonObject[]).map(household => ({ ...household, members: [ids.person, other] })), Person: [...model.objects.Person!, { ...(model.objects.Person![0] as JsonObject), person_id: other, date_of_birth: "1990-06-01" }] } };
    expect(age90Horizon(two, [ids.person, other], "2026-01-01")?.end).toBe("2080-07-01");
    expect(age90Horizon(two, [ids.person], "2026-01-01")?.end).toBe("2060-07-01");
  });
  it("preserves inputs, economic fingerprints and accepted choices while resolving sources", () => {
    const model = createFlagshipHouseholdDraft(), config = createGoldenExampleConfiguration();
    expect(age90Horizon(model, [ids.person], config.simulationStart)?.end).toBe(config.simulationEnd);
    expect(birthdayAtAge("1990-01-01", 65)).toBe(config.retirementBindings[0]!.baselineDate);
    const json = exportPersonalModelJson(model), request = createHouseholdForecastRequest(config, ids.model);
    const fingerprint = calculationFingerprint("baseline_forecast", model, request);
    const restored = importPersonalModelJson(json);
    const derived = resolveForecastReadiness(restored, config.asOf);
    expect(derived.find(field => field.key === "cashAccount")).toMatchObject({ classification: "losslessly_derived", value: ids.checking });
    expect(derived.find(field => field.key === "investmentOwner")?.classification).toBe("editable_suggestion_needs_acceptance");
    expect(resolveForecastReadiness(model, config.asOf, config).find(field => field.key === "investmentOwner")).toMatchObject({ classification: "known_canonical", value: ids.person });
    expect(resolveForecastReadiness(model, config.asOf, config).find(field => field.key === "mortgage:" + ids.mortgage + ":schedule")?.reason).toContain("313 remaining of 360");
    expect(exportPersonalModelJson(model)).toBe(json);
    expect(calculationFingerprint("baseline_forecast", model, request)).toBe(fingerprint);
  });
  it("requires a choice among banks and preserves contradictory schedule evidence", () => {
    const model = createGoldenHouseholdDraft();
    expect(resolveForecastReadiness(model, "2026-01-01").find(field => field.key === "cashAccount")).toMatchObject({ classification: "user_decision_required", options: expect.any(Array) });
    const config = createGoldenExampleConfiguration();
    const conflict = { ...config, liabilityExecutionProfiles: config.liabilityExecutionProfiles.map(profile => ({ ...profile, totalPayments: 359 })) };
    expect(resolveForecastReadiness(model, "2026-01-01", conflict).find(field => field.key.endsWith(":schedule"))?.reason).toContain("disagree");
  });
  it("offers age 65 without changing wages, and accepts only in the Life Events adapter", () => {
    const original = createGoldenHouseholdDraft();
    const model = { ...original, objects: { ...original.objects, Income: (original.objects.Income as readonly JsonObject[]).map(income => ({ ...income, related_event_id: null })), Event: [] } };
    const before = exportPersonalModelJson(model);
    expect(retirementProposals(model, "2026-02-01")).toMatchObject([{ personId: ids.person, date: "2055-01-01" }]);
    expect(exportPersonalModelJson(model)).toBe(before);
    expect(() => acceptRetirementProposal(model, ids.person, "2055-01-01", ["90000000-0000-4000-8000-000000000099"])).toThrow("Current Plan");
    expect(retirementProposals(original, "2026-01-01")).toEqual([]);
    expect(retirementProposals({ ...model, objects: { ...model.objects, Person: withDob("1950-01-01").objects.Person! } }, "2026-01-01")).toEqual([]);
  });
  it("does not overwrite existing assumptions or create reserve transactions", () => {
    const model = createGoldenHouseholdDraft(), before = exportPersonalModelJson(model);
    let index = 500;
    const accepted = acceptPlanningStarters(model, { inflation: "0.025", wages: "0.03", portfolio: "0.05", reserveMonths: "6" }, () => `90000000-0000-4000-8000-${String(index++).padStart(12, "0")}`);
    expect(accepted.objects.Income).toEqual(model.objects.Income);
    expect(accepted.objects.Investment).toEqual(model.objects.Investment);
    expect(accepted.objects.Transaction).toEqual(model.objects.Transaction);
    expect((accepted.objects.Assumption as readonly JsonObject[]).filter(item => item.name === "Essential-expense reserve goal")).toMatchObject([{ value: "6" }]);
    expect(exportPersonalModelJson(model)).toBe(before);
  });
  it("executes a bounded genuine net-pay result with exact opening and cash values", () => {
    const model = createFlagshipHouseholdDraft();
    const config = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-09-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(config, ids.model));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    if (result.status === "unavailable") return;
    expect(result.points).toHaveLength(8);
    expect(result.openingSnapshot.netWorth.amount).toBe("4289330.29");
    expect(result.points[0]!.cash.amount).toBe("4007874.71");
    expect(result.points[0]!.statementIncome.amount).toBe("0");
    expect(result.points[6]!.statementIncome.amount).not.toBe("0");
    expect(result.diagnostics.some(issue => "category" in issue && issue.category === "wage_gross_to_net_withholding")).toBe(false);
    expect(result.points[0]!.outputCapabilities?.cash?.status).toBe("complete");
    expect(model.objects.Income).toHaveLength(1);
  }, 30_000);
  it("executes accepted starters with unique source bindings and changed economics without mutating the proposal", () => {
    const fixture = createFlagshipHouseholdDraft();
    // Isolate genuinely unspecified rates while retaining the fixture's explicit
    // dates, payroll elections, ownership and settlement authorizations.
    const model: PersonalDraft = { ...fixture, objects: { ...fixture.objects,
      Assumption: [],
      PrimitiveInstance: (fixture.objects.PrimitiveInstance as readonly JsonObject[]).filter(item => !["P08", "P23"].includes(String(item.primitive_id))),
      Scenario: (fixture.objects.Scenario as readonly JsonObject[]).map(item => ({ ...item, assumption_ids: [] })),
      Income: (fixture.objects.Income as readonly JsonObject[]).map(item => ({ ...item, growth_model_id: null })),
      Expense: (fixture.objects.Expense as readonly JsonObject[]).map(item => ({ ...item, growth_model_id: null })),
      Investment: (fixture.objects.Investment as readonly JsonObject[]).map(item => ({ ...item, return_model_id: null })),
    } };
    const before = exportPersonalModelJson(model);
    const request = createHouseholdForecastRequest({ ...createGoldenExampleConfiguration(), simulationEnd: "2027-09-01", investmentPurchaseInstructions: [] }, ids.model);
    const fingerprint = calculationFingerprint("baseline_forecast", model, request);
    let index = 600;
    const accepted = acceptPlanningStarters(model, { inflation: "0.025", wages: "0.03", portfolio: "0.05", reserveMonths: "6" }, () => `90000000-0000-4000-8000-${String(index++).padStart(12, "0")}`);
    const expenseBindings = (accepted.objects.Expense as readonly JsonObject[]).map(item => item.growth_model_id);
    expect(new Set(expenseBindings).size).toBe(3);
    expect(expenseBindings.every(value => typeof value === "string")).toBe(true);
    expect(calculationFingerprint("baseline_forecast", accepted, request)).not.toBe(fingerprint);
    const baseline = runPersonalHouseholdForecast(model, request);
    const result = runPersonalHouseholdForecast(accepted, request);
    expect(baseline.status, JSON.stringify(baseline.diagnostics)).toBe("completed");
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    if (baseline.status === "unavailable" || result.status === "unavailable") return;
    expect(result.points).toHaveLength(20);
    expect(result.points.at(-1)!.statementIncome.amount).not.toBe(baseline.points.at(-1)!.statementIncome.amount);
    expect(result.points.at(-1)!.investmentValue.amount).not.toBe(baseline.points.at(-1)!.investmentValue.amount);
    expect(result.points.at(-1)!.statementExpenses.amount).not.toBe(baseline.points.at(-1)!.statementExpenses.amount);
    expect(result.points.at(-1)!.cash.amount).not.toBe(baseline.points.at(-1)!.cash.amount);
    expect(accepted.objects.Account).toEqual(model.objects.Account);
    expect(accepted.objects.Transaction).toEqual(model.objects.Transaction);
    expect(accepted.objects.Event).toEqual(model.objects.Event);
    expect(exportPersonalModelJson(model)).toBe(before);
    expect(calculationFingerprint("baseline_forecast", model, request)).toBe(fingerprint);
  }, 30_000);
  it("keeps a missing jurisdiction paycheck binding genuinely incomplete", () => {
    const original = createFlagshipHouseholdDraft();
    const model = { ...original, objects: { ...original.objects, PrimitiveInstance: (original.objects.PrimitiveInstance as readonly JsonObject[]).filter(item => item.primitive_instance_id !== "90000000-0000-4000-8000-000000000112") } };
    const config = { ...createGoldenExampleConfiguration(), simulationEnd: "2026-09-01" };
    const result = runPersonalHouseholdForecast(model, createHouseholdForecastRequest(config, ids.model));
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ category: "wage_gross_to_net_withholding" }));
    if (result.status !== "unavailable") expect(result.points[6]!.outputCapabilities?.cash?.status).toBe("incomplete");
  }, 30_000);
});
