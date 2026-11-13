import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeVerticalSlice2PeriodCandidate } from "../../../../src/simulation/verticalSlice2.js";
import { executeVerticalSlice2PeriodCandidate as executeReferenceCashFlow } from "../../../../src/simulation/r3/referenceVerticalSlice2.js";
import { payrollContributionCandidate } from "../../../../src/simulation/payrollContributions.js";
import { compileHouseholdKernel, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { createAuthoritativeState, authoritativeCheckpointDelta, restoreAuthoritativeCheckpointDelta, requalifyD2SettlementReceiptHistory } from "../../../../src/state/index.js";
import { decimal, money } from "../../../../src/values/index.js";
import { utcMonthlyPeriods } from "../../../../src/time/index.js";
import { bareStream, context, control, document, ids, input, install, opening, reset, start, stream } from "./scenario.js";
import { compileModeledIncomeFixture } from "../../../fixtures/modeledIncome.js";

beforeAll(install);
beforeEach(reset);
const execute = (incomes = [stream()]) => {
  const state = opening();
  return executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input(incomes) },
    utcMonthlyPeriods(start, 1)[0]!, state, {});
};
describe("source-owned household wage posting", () => {
  it("rejects a source-free payroll candidate even without withholding", () => {
    const state = opening(), before = canonicalSerialize(state), original = document();
    expect(() => payrollContributionCandidate(state, {
      id: original.transaction.id, incomeId: original.incomeId, ownerId: ids.alice,
      occurrenceId: original.occurrenceId, at: original.transaction.date,
      gross: original.gross, depositAccountId: ids.bank, allocations: [],
    })).toThrow("HOUSEHOLD_BANK_INCOME_REQUIRES_QUALIFIED_ORIGINAL");
    expect(canonicalSerialize(state)).toBe(before);
  });
  it.each([false, true])("requires fresh publishers on portable state/checkpoint import with elections=%s", payroll => {
    control.payroll = payroll;
    const state = execute().state, delta = authoritativeCheckpointDelta(state, createAuthoritativeState(), (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    const directory = mkdtempSync(join(tmpdir(), "pfm-wage-source-")), path = join(directory, "synthetic.json");
    try {
      for (const sources of [true, false]) {
        writeFileSync(path, JSON.stringify({ state, delta, sources, payroll }));
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 10_000,
          env: { ...process.env, PFM_WAGE_PAYLOAD: path } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(sources ? JSON.parse(JSON.stringify({ imported: state.accounts, restored: state.accounts })) : { rejected: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("authenticates the signed payroll original and posts withholding once", () => {
    control.payroll = true;
    const result = execute(), original = document();
    expect(result.period.transactions).toEqual([original.transaction]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("215.37"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions!)).toHaveLength(1);
    expect(Object.values(result.state.positions)).toHaveLength(1);
    expect(Object.values(result.state.positions)[0]!.carryingValue.equals(money("10"))).toBe(true);
  });
  it.each([false, true])("preserves the person-owned route with elections=%s", payroll => {
    const runContext = context(), original = bareStream();
    const authored = compileModeledIncomeFixture(runContext, 1, {
      householdId: ids.household, personId: ids.alice, accountId: ids.bank, accountType: "checking",
      incomes: [{ id: original.id, type: "salary", amount: "125.37", startDate: "2026-01-15", employer: "Synthetic employer" }],
      withholding: payroll ? [{ id: "27700000-0000-4000-8000-000000000040", incomeId: original.id,
        ownerId: ids.alice, employerId: "Synthetic employer", depositAccountId: ids.bank, jurisdiction: "US:FEDERAL",
        effectiveDate: "2026-01-01", provenance: "Synthetic employer election", userConfirmed: true,
        calculation: { kind: "fixed", amount: "10" } }] : [],
    });
    const state = opening(ids.alice);
    const request = { runContext, openingState: state, input: input([...authored.incomes]) };
    const period = utcMonthlyPeriods(start, 1)[0]!;
    const result = executeVerticalSlice2PeriodCandidate(request, period, state, {});
    const reference = executeReferenceCashFlow(request, period, state, {});
    expect(result.period.transactions).toEqual(reference.period.transactions);
    expect(result.period.transactions.map(tx => tx.type)).toEqual([payroll ? "payroll_income" : "income"]);
    expect(result.period.transactions[0]!.legs.find(leg => leg.type === "income")!.amount).toEqual(money("125.37"));
    expect(result.state.accounts[ids.bank]!.cash.equals(money(payroll ? "215.37" : "225.37"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions ?? {})).toHaveLength(0);
  });
  it("keeps the actual no-election income journal and one canonical proof", () => {
    const result = execute(), original = document();
    expect(result.period.transactions).toEqual([original.transaction]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("225.37"))).toBe(true);
    const proofs = Object.values(result.state.d2PostedTransactions!);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.transaction).toEqual(original.transaction);
    expect(proofs[0]!.registration.personId).toBe(ids.alice);
    expect(canonicalSerialize(proofs)).not.toContain("installments");
  });
  it.each([false, true])("matches native BANK journal and proof in the reference, elected=%s", payroll => {
    control.payroll = payroll;
    const runContext = context(), state = opening();
    const request = { runContext, openingState: state, input: input([stream(1), stream(0)]) };
    const period = utcMonthlyPeriods(start, 1)[0]!;
    const actual = executeVerticalSlice2PeriodCandidate(request, period, state, {});
    const reference = executeReferenceCashFlow(request, period, state, {});
    expect(actual.period.transactions).toHaveLength(2);
    expect(actual.period.transactions).toEqual(reference.period.transactions);
    expect(actual.period.recognitions).toEqual(reference.period.recognitions);
    expect(actual.period.payrollWithholding).toEqual(reference.period.payrollWithholding);
    expect(actual.state.d2PostedTransactions).toEqual(reference.state.d2PostedTransactions);
    expect(canonicalSerialize(actual.state)).toBe(canonicalSerialize(reference.state));
    control.missing = true;
    for (const execute of [executeVerticalSlice2PeriodCandidate, executeReferenceCashFlow]) {
      expect(() => execute(request, period, state, {})).toThrow();
      expect(state.accounts[ids.bank]!.cash).toEqual(money("100"));
      expect(state.d2PostedTransactions).toBeUndefined();
    }
  });
  it("authenticates two Person recipients against one household balance", () => {
    const result = execute([stream(1), stream(0)]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("350.74"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions!).map(p => p.registration.personId).sort()).toEqual([ids.alice, ids.bob].sort());
  });
  describe.each([false, true])("rejected household income with elections=%s", payroll => {
  it.each(["unbound", "wrong-source", "missing", "race", "owner", "gross", "occurrence", "withdrawn", "late", "mismatch", "duplicate"])("rejects %s without changing opening state", kind => {
    control.payroll = payroll;
    const state = opening(), before = canonicalSerialize(state), s = stream();
    if (kind === "missing") control.missing = true;
    if (kind === "race") control.withdrawAt = 2;
    if (kind === "owner") control.rebound = true;
    if (["withdrawn", "late", "mismatch", "duplicate"].includes(kind)) control.revision = kind;
    const { householdWageSource: _source, ...unbound } = s;
    const changed = kind === "unbound" ? unbound
      : kind === "wrong-source" ? { ...s, householdWageSource: stream(1).householdWageSource! }
      : kind === "gross" ? { ...s, baseMonthlyAmount: money("125.38") }
      : kind === "occurrence" ? { ...s, primitiveIds: { ...s.primitiveIds, recurrence: bareStream(1).primitiveIds.recurrence } } : s;
    expect(() => executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input([changed]) },
      utcMonthlyPeriods(start, 1)[0]!, state, {})).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  });
  it("rejects an unqualified withholding change rather than posting a zero substitute", () => {
    control.payroll = true;
    const s = stream(), election = s.payrollWithholding![0]!;
    expect(() => execute([{ ...s, payrollWithholding: [{ ...election, calculation: { kind: "fixed", amount: money("11") } }] }])).toThrow();
  });
  it.each([1, 12, 24])("keeps %i installment proofs compact and restores canonical checkpoints", months => {
    let state = opening(), previous = opening();
    let bytes = 0;
    for (const period of utcMonthlyPeriods(start, months)) {
      state = executeVerticalSlice2PeriodCandidate({ runContext: context(months), openingState: previous, input: input() }, period, previous, {}).state;
      const delta = authoritativeCheckpointDelta(state, previous, (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
      const restored = restoreAuthoritativeCheckpointDelta(previous, delta);
      expect(canonicalSerialize(restored)).toBe(canonicalSerialize(state));
      previous = state;
    }
    requalifyD2SettlementReceiptHistory(state, context(months));
    const proofs = Object.values(state.d2PostedTransactions!);
    expect(proofs).toHaveLength(months);
    bytes = canonicalSerialize(proofs).length;
    expect(bytes).toBeLessThan(months * 7000);
    expect(canonicalSerialize(proofs)).not.toContain("installments");
    expect(state.accounts[ids.bank]!.cash.equals(money("100").plus(money("125.37").times(decimal(String(months)))))).toBe(true);
  });
  it.each([false, true])("requalifies the native wage tail before warm replay, elected=%s", payroll => {
    control.payroll = payroll;
    const runContext = context(25);
    const kernel = compileHouseholdKernel({
      cashFlowInput: input(), executionMonths: 25, scenarioIdentity: runContext.scenarioId, scenarioBindings: {},
      reconciledOpeningState: opening(), reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    }, start);
    const summary = runHouseholdKernel({ kernel, runContext });
    const detail = runHouseholdKernel({ kernel, runContext, resultTier: "detail" });
    expect(summary.status, JSON.stringify(summary.diagnostics)).toBe("completed");
    expect(summary.periods).toHaveLength(25);
    expect(Object.keys(detail.state.d2PostedTransactions ?? {})).toHaveLength(25);
    const artifact = structuredClone(createPortableHouseholdReplayArtifact(summary));
    const restored = restorePortableHouseholdReplayArtifact(artifact);
    const terminal = detail.periods[24]!;
    expect(replayHouseholdForecastWindow(restored, terminal.period).periods).toEqual([terminal]);
    expect(replayHouseholdForecastWindow(restored, terminal.period).state).toEqual(detail.state);
    control.missingMonth = "2028-01";
    const phases: string[] = [];
    expect(() => replayHouseholdForecastWindow(restored, terminal.period, undefined, phase => phases.push(phase))).toThrow();
    expect(phases).not.toContain("replay_started");
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow(/BASIS_MISMATCH/);
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact })).toThrow(/BASIS_MISMATCH/);
  });
});
