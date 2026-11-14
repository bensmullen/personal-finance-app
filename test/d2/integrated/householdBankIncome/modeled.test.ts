import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileCashFlow } from "../../../../src/application/compiler/cashFlow.js";
import { authorPayrollWithholding } from "../../../../src/application/compiler/payrollWithholding.js";
import { compileHouseholdProjection } from "../../../../src/application/compiler/householdProjection.js";
import { compileHouseholdKernelForRun, runPersonalHouseholdForecast, restoreHouseholdForecastEvidence, resolveHouseholdExplanation, comparePersonalHouseholdScenarios } from "../../../../src/application/householdProjection.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../../../../src/application/goldenHousehold.js";
import { patchPersonalObject } from "../../../../src/application/personalMvp.js";
import { inspectMonthlyMoney } from "../../../../src/application/monthlyMoney.js";
import { householdEvidenceProof, inspectMortgageWindow, boundedEvidencePoints, restoreHouseholdEvidencePoints } from "../../../../src/application/mortgageChartData.js";
import { runVerticalSlice2, executeVerticalSlice2PeriodCandidate } from "../../../../src/simulation/verticalSlice2.js";
import { runVerticalSlice2 as runReferenceCashFlow } from "../../../../src/simulation/r3/referenceVerticalSlice2.js";
import { runHouseholdKernel, replayHouseholdForecastWindow, householdReplayCheckpointSelection } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize, createInputFingerprint, runId, scenarioId } from "../../../../src/simulation/run.js";
import { assumptionId } from "../../../../src/model/index.js";
import type { ExecutableScenario } from "../../../../src/simulation/scenario.js";
import { Rate, rateConvention } from "../../../../src/values/index.js";
import type { PortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { deriveStatements } from "../../../../src/statements/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { modeledContext, modeledId, modeledRequest, modeledSource, rebindModeledBank } from "./modeledScenario.js";

function standalone(model = modeledSource()) {
  const request = modeledRequest();
  const compiled = compileCashFlow(model, request.compiler.cashFlow);
  if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled));
  return compiled.value;
}
function forecast(model = modeledSource(), months = 1) {
  const result = runPersonalHouseholdForecast(model, modeledRequest(months));
  if (result.status === "unavailable") throw new Error(JSON.stringify(result));
  return result;
}
describe("authenticated modeled salary at a shared bank", () => {
  it("admits a canonical pension without granting elected payroll authority", () => {
    const model = patchPersonalObject(modeledSource(), "Income", ids.income, { income_type: "pension" });
    const compiled = standalone(model);
    const context = modeledContext();
    const result = runVerticalSlice2({ ...compiled, runContext: context, months: 1 });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.recurringIncomeRecognized).toEqual(money("9000"));
    expect(result.periods[0]!.transactions.filter(tx => tx.type === "income")).toHaveLength(1);
    expect(result.periods[0]!.transactions.some(tx => tx.type === "payroll_income")).toBe(false);

    const { modeledPayroll: _source, ...unsigned } = compiled.input.incomes[0]!;
    const input = { ...compiled.input, incomes: [{ ...unsigned, incomeType: "pension" }] };
    const rejected = runVerticalSlice2({ ...compiled, input, runContext: context, months: 1 });
    expect(rejected.status).toBe("incomplete");
    expect(rejected.diagnostics.some(issue => issue.message.includes("INCOME_REQUIRES_QUALIFIED_ORIGINAL"))).toBe(true);
    expect(rejected.state.accounts).toEqual(compiled.openingState.accounts);
  });
  it.each([false, true])("retains standalone compiler journals with election=%s", elected => {
    const compiled = standalone(modeledSource(elected));
    const result = runVerticalSlice2({ ...compiled, runContext: modeledContext(), months: 1 });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    const income = result.periods[0]!.transactions.filter(tx => ["income", "payroll_income"].includes(tx.type));
    expect(income).toHaveLength(1);
    expect(income[0]!.type).toBe(elected ? "payroll_income" : "income");
    expect(income[0]!.legs.find(leg => leg.type === "income")!.amount.equals(money("9000"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions ?? {})).toHaveLength(0);
  });
  it.each([
    { elected: false, family: false, householdBank: false },
    { elected: true, family: false, householdBank: true },
    { elected: true, family: true, householdBank: false },
    { elected: true, family: true, householdBank: true },
  ])("posts matching canonical journals in the independent reference for %j", ({ elected, family, householdBank }) => {
    const original = modeledSource(elected, family);
    const compiled = standalone(householdBank ? rebindModeledBank(original, ids.household) : original);
    const request = { ...compiled, runContext: modeledContext(), months: 1 };
    const actual = runVerticalSlice2(request);
    const reference = runReferenceCashFlow(request);
    expect(actual.status, JSON.stringify(actual.diagnostics)).toBe("completed");
    expect(reference.status, JSON.stringify(reference.diagnostics)).toBe("completed");
    const income = reference.periods[0]!.transactions.filter(tx => tx.type === (elected ? "payroll_income" : "income"));
    expect(income).toHaveLength(family ? 2 : 1);
    expect(reference.periods[0]!.recurringIncomeRecognized).toEqual(money(family ? "18000" : "9000"));
    expect(reference.periods[0]!.transactions).toEqual(actual.periods[0]!.transactions);
    expect(reference.periods[0]!.recognitions).toEqual(actual.periods[0]!.recognitions);
    expect(reference.periods[0]!.payrollWithholding).toEqual(actual.periods[0]!.payrollWithholding);
    expect(canonicalSerialize(reference.state)).toBe(canonicalSerialize(actual.state));
    expect(reference.primitiveState).toEqual(actual.primitiveState);
  });
  it("retains both spouses' original HSA signed economics without editing the D1 regression", () => {
    const compiled = standalone(modeledSource(true, true));
    const result = runVerticalSlice2({ ...compiled, runContext: modeledContext(), months: 1 });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.state.accounts[ids.checking]!.cash.amount.toString()).toBe("22450");
    expect(Object.values(result.state.contributions!).reduce((sum, entry) => sum.plus(entry.amount), money("0")).amount.toString()).toBe("10750");
    const statements = deriveStatements(result.state, result.periods[0]!.transactions, USD);
    expect(statements.income.amount.toString()).toBe("18000");
    expect(statements.expenses.amount.toString()).toBe("4800");
  });
  it.each([
    { kind: "fixed" as const, amount: "900" },
    { kind: "percent_gross" as const, rate: "0.1" },
  ])("posts matching paid-tax credits for %j withholding", calculation => {
    const model = authorPayrollWithholding(modeledSource(), {
      id: modeledId(880), incomeId: ids.income, ownerId: ids.person,
      employerId: "Example salary", depositAccountId: ids.checking,
      jurisdiction: "US:FEDERAL", effectiveDate: "2026-01-01",
      provenance: "Explicit synthetic employer election", userConfirmed: true, calculation,
    });
    const request = { ...standalone(model), runContext: modeledContext(), months: 1 };
    const actual = runVerticalSlice2(request);
    const reference = runReferenceCashFlow(request);
    expect(actual.status).toBe("completed");
    expect(reference.status).toBe("completed");
    const paycheck = reference.periods[0]!.transactions.find(tx => tx.type === "payroll_income");
    expect(paycheck?.legs.find(leg => leg.type === "asset")?.amount).toEqual(money("900"));
    expect(paycheck?.legs.find(leg => leg.type === "cash")?.amount).toEqual(money("8100"));
    expect(reference.periods[0]!.transactions).toEqual(actual.periods[0]!.transactions);
    expect(reference.periods[0]!.payrollWithholding).toEqual(actual.periods[0]!.payrollWithholding);
    expect(canonicalSerialize(reference.state)).toBe(canonicalSerialize(actual.state));
  });
  it("qualifies Person and Household bank routes for family HSA salary", () => {
    const personal = standalone(modeledSource(true, true));
    expect(personal.input.incomes.every(stream => stream.modeledPayroll !== undefined)).toBe(true);
    const household = standalone(rebindModeledBank(modeledSource(true, true), ids.household));
    expect(household.input.incomes.every(stream => stream.modeledPayroll !== undefined)).toBe(true);
  });
  it("rejects a different run at the cash posting boundary", () => {
    const model = rebindModeledBank(modeledSource(), ids.person);
    const context = modeledContext();
    const compiled = compileHouseholdKernelForRun(model, modeledRequest().compiler, context);
    if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled.diagnostics));
    const { kernel } = compiled.value;
    const original = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
    expect(original.periods.flatMap(period => period.transactions).find(tx => tx.type === "income")
      ?.legs.find(leg => leg.type === "income")?.amount.equals(money("9000"))).toBe(true);
    const changed = runHouseholdKernel({ kernel, runContext: { ...context, runId: runId(modeledId(99)) }, resultTier: "detail" });
    expect(changed.diagnostics.some(issue => issue.message.includes("MODELED_PAYROLL_NOT_ADMITTED"))).toBe(true);
    expect(changed.periods).toHaveLength(0);
  });
  it("requires the exact issued reference object and household-owned bank", () => {
    const compiled = standalone(), stream = compiled.input.incomes[0]!;
    const clone = { ...stream, modeledPayroll: { ...stream.modeledPayroll! } };
    const forgery = runVerticalSlice2({ ...compiled, input: { ...compiled.input, incomes: [clone] }, runContext: modeledContext(), months: 1 });
    expect(forgery.status).toBe("incomplete");
    expect(forgery.diagnostics.some(d => d.message.includes("MODELED_PAYROLL_NOT_ADMITTED"))).toBe(true);
    const bank = compiled.openingState.accounts[ids.checking]!;
    const changedState = { ...compiled.openingState, accounts: { ...compiled.openingState.accounts,
      [ids.checking]: { ...bank, ownerId: compiled.input.ownerId } } };
    const changedBank = runVerticalSlice2({ input: compiled.input, openingState: changedState, runContext: modeledContext(), months: 1 });
    expect(changedBank.status).toBe("incomplete");
    expect(changedBank.diagnostics.some(d => d.message.includes("MODELED_PAYROLL_NOT_ADMITTED"))).toBe(true);
  });
  it("qualifies a context-free compilation only within its authored boundaries", () => {
    const compiled = standalone();
    const context = modeledContext();
    for (const changed of [
      { ...context, scenarioId: scenarioId(modeledId(99)) },
      { ...context, simulationEnd: modeledContext(2).simulationEnd },
      { ...context, asOf: "2026-01-02T00:00:00.000Z" as typeof context.asOf },
    ]) {
      expect(() => executeVerticalSlice2PeriodCandidate(
        { ...compiled, runContext: changed },
        { start: context.simulationStart, end: context.simulationEnd }, compiled.openingState, {},
      )).toThrow("MODELED_PAYROLL_NOT_ADMITTED");
    }
    for (const actual of [context, { ...context, runId: runId(modeledId(99)) }]) {
      const result = runVerticalSlice2({ ...compiled, runContext: actual, months: 1 });
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
      expect(result.periods[0]!.recurringIncomeRecognized).toEqual(money("9000"));
    }
  });
  it("keeps an independently owned salary reference live across many compiles", () => {
    const original = standalone();
    for (let n = 0; n < 32; n++) {
      const changed = patchPersonalObject(modeledSource(), "Income", ids.income, { amount: String(9001 + n) });
      expect(standalone(changed).input.incomes[0]!.modeledPayroll).toBeDefined();
    }
    const result = runVerticalSlice2({ ...original, runContext: modeledContext(), months: 1 });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
  });
  it.each(["amount", "schedule", "member", "bank", "marker", "missing"])("rejects changed %s before committing anything", kind => {
    const compiled = standalone(), stream = compiled.input.incomes[0]!, before = canonicalSerialize(compiled.openingState);
    const changed = kind === "amount" ? { ...stream, baseMonthlyAmount: money("1") }
      : kind === "schedule" ? { ...stream, recurrence: { ...stream.recurrence, anchor: modeledContext().simulationStart } }
      : kind === "member" ? { ...stream, ownerId: modeledId(90) as typeof stream.ownerId }
      : kind === "bank" ? { ...stream, depositAccountId: ids.savings as typeof stream.depositAccountId }
      : kind === "marker" ? { ...stream, modeledPayroll: { ...stream.modeledPayroll!, key: "sha256:forged" } }
      : { ...stream, modeledPayroll: undefined };
    const { modeledPayroll: removed, ...without } = changed;
    const input = { ...compiled.input, incomes: [kind === "missing" ? without : changed as typeof stream] };
    expect(() => executeVerticalSlice2PeriodCandidate({ input, openingState: compiled.openingState, runContext: modeledContext() },
      { start: modeledContext().simulationStart, end: modeledContext().simulationEnd }, compiled.openingState, {})).toThrow();
    expect(canonicalSerialize(compiled.openingState)).toBe(before);
  });
  it.each([false, true])("rejects a copied modeled source before an inactive period can commit, elected=%s", elected => {
    const compiled = standalone(patchPersonalObject(modeledSource(elected), "Income", ids.income, {
      start_date: "2026-02-01", related_event_id: null,
    }));
    const input = { ...compiled.input, incomes: compiled.input.incomes.map(stream => ({
      ...stream, modeledPayroll: { ...stream.modeledPayroll! },
    })) };
    const request = { ...compiled, input, runContext: modeledContext(), months: 1 };
    for (const execute of [runVerticalSlice2, runReferenceCashFlow]) {
      const result = execute(request);
      expect(result.status).toBe("incomplete");
      expect(result.periods).toEqual([]);
      expect(result.diagnostics.some(issue => issue.message.includes("MODELED_PAYROLL_NOT_ADMITTED"))).toBe(true);
      expect(result.state).toEqual(compiled.openingState);
    }
  });
  it.each([false, true])("requalifies compiler reconstruction, exported detail and app readers with election=%s", elected => {
    const model = modeledSource(elected), request = modeledRequest(), compiled = compileHouseholdProjection(model, request.compiler);
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled));
    const summary = runHouseholdKernel({ kernel: compiled.value.executionKernel!, runContext: modeledContext() });
    // The Golden Household deliberately lacks verified tax residence, full
    // withholding and settlement facts. Do not convert this into an invented
    // tax-complete forecast merely to satisfy the modeled salary test.
    expect(summary.status, JSON.stringify(summary.diagnostics)).toBe("incomplete");
    expect(summary.diagnostics.some(d => "category" in d && d.category === "wage_gross_to_net_withholding")).toBe(true);
    const read = forecast(model), artifact = structuredClone(householdEvidenceProof(read.points)!);
    const restored = restoreHouseholdForecastEvidence(artifact, model);
    const detail = replayHouseholdForecastWindow(restored, restored.periods[0]!.period);
    expect(detail.periods[0]!.cash.amount.toString()).toBe(read.points[0]!.cash.amount);
    expect(() => inspectMonthlyMoney(read.points[0]!, model)).not.toThrow();
    expect(() => inspectMortgageWindow(read.points, ids.mortgage, undefined, model)).not.toThrow();
    expect(() => resolveHouseholdExplanation(model, read.points[0]!.traceRefs)).not.toThrow();
    const selection = { operation: "monthly_evidence" as const, startIndex: 0, liabilityId: ids.mortgage };
    const bounded = boundedEvidencePoints(read, selection);
    // This API expects the *selected replay trace anchor*, not the raw run
    // inputFingerprint (the latter is independently checked inside restore).
    const traceId = bounded.points[0]!.traceRefs.find(ref => ref.replayArtifact !== undefined)!.traceId;
    expect(restoreHouseholdEvidencePoints(bounded.basis, selection, bounded.points, traceId, read.diagnosticCatalogs, undefined, model)).toHaveLength(1);
    for (const proof of [householdEvidenceProof(read.points)!, artifact]) {
      expect(() => restoreHouseholdForecastEvidence(proof)).toThrow(/BASIS_MISMATCH/);
      expect(() => restoreHouseholdForecastEvidence(proof, patchPersonalObject(model, "Income", ids.income, { amount: "9001" }))).toThrow(/BASIS_MISMATCH/);
      expect(() => restoreHouseholdForecastEvidence(proof, rebindModeledBank(model, ids.person))).toThrow(/BASIS_MISMATCH/);
    }
    for (const [from, to] of [["canonical-forecast/v1", "forged-forecast/v1"],
      ["modeled-payroll-replay/v1", "modeled-payroll-replay/v2"], [request.runIdentity, modeledId(99)]]) {
      const encoded = artifact.encoded.replaceAll(from!, to!);
      const forged = { ...artifact, encoded, integrity: createInputFingerprint({ runContext: restored.replay.runContext, openingState: encoded }) };
      expect(() => restoreHouseholdForecastEvidence(forged, model)).toThrow(/BASIS_MISMATCH/);
    }
    const changed = patchPersonalObject(model, "Income", ids.income, { amount: "9001" });
    expect(() => inspectMonthlyMoney(read.points[0]!, changed)).toThrow(/BASIS_MISMATCH/);
    expect(() => inspectMortgageWindow(read.points, ids.mortgage, undefined, changed)).toThrow(/BASIS_MISMATCH/);
    expect(() => resolveHouseholdExplanation(changed, read.points[0]!.traceRefs)).toThrow(/BASIS_MISMATCH/);
  });
  it("requires independent model requalification in a fresh process", () => {
    const model = modeledSource(true), read = forecast(model), artifact = householdEvidenceProof(read.points)!;
    const directory = mkdtempSync(join(tmpdir(), "pfm-modeled-wage-")), path = join(directory, "synthetic.json");
    try {
      writeFileSync(path, JSON.stringify({ artifact, model }));
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./modeledWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 10_000,
        env: { ...process.env, PFM_MODELED_PAYROLL_PAYLOAD: path } });
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ cash: read.points[0]!.cash.amount, missingRejected: true, changedRejected: true });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("requalifies actual scenario growth and projected annual-policy reconstruction", () => {
    const model = modeledSource(true), base = modeledRequest(2), context = modeledContext(2);
    const request = { ...base, compiler: { ...base.compiler, forecastLawPolicy: "projected_current_law" as const } };
    const root = scenarioId(ids.rootScenario), leaf = scenarioId(modeledId(70));
    const common = { horizon: { start: context.simulationStart, end: context.simulationEnd }, timestep: "monthly" as const,
      enabled: true, stochastic: false, simulationCount: 1 };
    const scenarios: readonly ExecutableScenario[] = [
      { ...common, scenarioId: root, name: "Root", changes: [] },
      { ...common, scenarioId: leaf, baseScenarioId: root, name: "Growth", changes: [{ kind: "income_growth",
        incomeId: ids.income as never, rate: Rate.fromDecimal("0.1", rateConvention.effectiveAnnual()), assumptionId: assumptionId(modeledId(71)) }] },
    ];
    const read = comparePersonalHouseholdScenarios({ scenarios, baselineScenarioId: root,
      baseline: { name: "Root", model, request }, alternatives: [{ name: "Growth", model,
        request: { ...request, runIdentity: modeledId(72) }, scenarioId: leaf }] });
    expect(read.status, JSON.stringify(read)).not.toBe("unavailable");
    const points = read.alternatives[0]!.points.map(row => row.alternative);
    expect(points).toHaveLength(2);
    const restored = restoreHouseholdForecastEvidence(structuredClone(householdEvidenceProof(points)!), model);
    expect(replayHouseholdForecastWindow(restored, restored.periods[1]!.period).periods[0]!.cash.amount.toString()).toBe(points[1]!.cash.amount);
    expect(() => inspectMonthlyMoney(points[1]!, model)).not.toThrow();
  });
  it("rejects reordered or duplicated manifests after independently compiling both spouses", () => {
    // No unapproved spouse-owned VS3 return stream may be relabeled as the
    // primary execution Person. Preserve the two real HSA positions/payroll
    // allocations but omit a return model not under test in this manifest case.
    const source = rebindModeledBank(modeledSource(true, true), ids.household);
    const model = patchPersonalObject(source, "Investment", ids.brokerageInvestment, { return_model_id: null });
    const read = forecast(model);
    const original = householdEvidenceProof(read.points)!, context = modeledContext();
    expect(original, JSON.stringify({ status: read.status, points: read.points.length, diagnostics: read.diagnostics })).toBeDefined();
    const restored = restoreHouseholdForecastEvidence(structuredClone(original), model);
    expect(restored.replay.kernel.cash!.input.incomes.every(stream => stream.modeledPayroll !== undefined)).toBe(true);
    for (const duplicate of [false, true]) {
      const root: unknown = JSON.parse(original.encoded), definitions = new Map<number, unknown>();
      const visit = (value: unknown, action: (wire: { kind: string; value: unknown }) => void): void => {
        if (Array.isArray(value)) { for (const item of value) visit(item, action); return; }
        if (value === null || typeof value !== "object") return;
        const wire = value as { kind: string; value: unknown }; action(wire); visit(wire.value, action);
      };
      visit(root, wire => { if (wire.kind === "definition") { const pair = wire.value as [number, unknown]; definitions.set(pair[0], pair[1]); } });
      const unwrap = (value: unknown): { kind: string; value: unknown } => {
        const wire = value as { kind: string; value: unknown };
        return wire.kind === "definition" ? unwrap((wire.value as [number, unknown])[1])
          : wire.kind === "reference" ? unwrap(definitions.get(wire.value as number)) : wire;
      };
      let changed = false;
      visit(root, wire => {
        if (wire.kind !== "record") return;
        const entries = wire.value as [string, unknown][];
        const entry = entries.find(([key]) => key === "manifest");
        if (!entry) return;
        const manifest = unwrap(entry[1]).value as unknown[];
        expect(manifest).toHaveLength(2);
        if (duplicate) manifest.push(manifest[1]); else manifest.reverse();
        changed = true;
      });
      expect(changed).toBe(true);
      const encoded = JSON.stringify(root), artifact: PortableHouseholdReplayArtifact = { ...original, encoded,
        integrity: createInputFingerprint({ runContext: context, openingState: encoded }) };
      expect(() => restoreHouseholdForecastEvidence(artifact, model)).toThrow(/BASIS_MISMATCH/);
    }
  });
  it("keeps the model basis bounded and reproduces the terminal month beyond sparse checkpoints", () => {
    const model = modeledSource();
    const rows = [1, 12, 24, 25].map(months => {
      const read = forecast(model, months), proof = householdEvidenceProof(read.points)!;
      const artifact = structuredClone(proof);
      const restored = restoreHouseholdForecastEvidence(artifact, model);
      expect(restored.periods).toHaveLength(months);
      expect(householdReplayCheckpointSelection(restored).checkpointCount).toBe(months < 24 ? 0 : months === 24 ? 1 : 2);
      const selected = restored.periods.at(-1)!.period;
      const expected = replayHouseholdForecastWindow(restoreHouseholdForecastEvidence(proof, model), selected);
      expect(replayHouseholdForecastWindow(restored, selected)).toEqual(expected);
      expect(replayHouseholdForecastWindow(restoreHouseholdForecastEvidence(artifact, model), selected)).toEqual(expected);
      expect((artifact.encoded.match(/canonical-forecast\/v1/g) ?? [])).toHaveLength(1);
      expect(artifact.encoded).not.toContain("Everyday checking");
      return artifact.encoded.length;
    });
    expect(rows[2]!).toBeLessThan(rows[1]! * 3);
  });
});
