import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeVerticalSlice2PeriodCandidate } from "../../../../src/simulation/verticalSlice2.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { createAuthoritativeState, authoritativeCheckpointDelta, restoreAuthoritativeCheckpointDelta, requalifyD2SettlementReceiptHistory } from "../../../../src/state/index.js";
import { decimal, money } from "../../../../src/values/index.js";
import { utcMonthlyPeriods } from "../../../../src/time/index.js";
import { bareStream, context, control, document, ids, input, install, opening, reset, start, stream } from "./scenario.js";

beforeAll(install);
beforeEach(reset);
const execute = (incomes = [stream()]) => {
  const state = opening();
  return executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input(incomes) },
    utcMonthlyPeriods(start, 1)[0]!, state, {});
};
describe("source-owned household wage posting", () => {
  it("requires fresh publishers on portable state/checkpoint import", () => {
    const state = execute().state, delta = authoritativeCheckpointDelta(state, createAuthoritativeState(), (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    const directory = mkdtempSync(join(tmpdir(), "pfm-wage-source-")), path = join(directory, "synthetic.json");
    try {
      for (const sources of [true, false]) {
        writeFileSync(path, JSON.stringify({ state, delta, sources }));
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
    control.payroll = payroll;
    const { householdWageSource: _source, ...personStream } = stream();
    const state = opening(ids.alice);
    const result = executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input([personStream]) },
      utcMonthlyPeriods(start, 1)[0]!, state, {});
    expect(result.period.transactions).toEqual([document().transaction]);
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
  it("authenticates two Person recipients against one household balance", () => {
    const result = execute([stream(1), stream(0)]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("350.74"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions!).map(p => p.registration.personId).sort()).toEqual([ids.alice, ids.bob].sort());
  });
  it.each(["missing", "race", "owner", "gross", "occurrence", "withdrawn", "late", "mismatch", "duplicate"])("rejects %s without changing opening state", kind => {
    const state = opening(), before = canonicalSerialize(state), s = stream();
    if (kind === "missing") control.missing = true;
    if (kind === "race") control.withdrawAt = 2;
    if (kind === "owner") control.rebound = true;
    if (["withdrawn", "late", "mismatch", "duplicate"].includes(kind)) control.revision = kind;
    const changed = kind === "gross" ? { ...s, baseMonthlyAmount: money("125.38") }
      : kind === "occurrence" ? { ...s, primitiveIds: { ...s.primitiveIds, recurrence: bareStream(1).primitiveIds.recurrence } } : s;
    expect(() => executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input([changed]) },
      utcMonthlyPeriods(start, 1)[0]!, state, {})).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
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
});
