import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthoritativeState, authoritativeCheckpointDelta, requalifyD2SettlementReceiptHistory,
  restoreAuthoritativeCheckpointDelta } from "../../../../src/state/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { executeVerticalSlice2PeriodCandidate, runVerticalSlice2, type RecurringExpenseStream } from "../../../../src/simulation/verticalSlice2.js";
import { compileHouseholdKernel, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { Currency, money } from "../../../../src/values/index.js";
import { context, control, ids, input, install, opening, reconstruct, reset, source, start, stream } from "./scenario.js";

beforeAll(install);
beforeEach(reset);
const execute = (expenses = [stream()], cash = "100") => {
  const state = opening(cash);
  return executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input(expenses) },
    utcMonthlyPeriods(start, 1)[0]!, state, {});
};
const kernelFixture = (expenses = [stream()], cash = "100", months = 1) =>
  compileHouseholdKernel({ reconciledOpeningState: opening(cash), reconciledPrimitiveState: {},
    executionMonths: months, scenarioIdentity: context(months).scenarioId, scenarioBindings: {}, cashFlowInput: input(expenses) }, start);
const kernelRun = (expenses = [stream()], cash = "100") =>
  runHouseholdKernel({ kernel: kernelFixture(expenses, cash), runContext: context(), resultTier: "detail" });
const reject = (expenses = [stream()]) => {
  const state = opening(), before = canonicalSerialize(state);
  expect(() => executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input(expenses) },
    utcMonthlyPeriods(start, 1)[0]!, state, {})).toThrow();
  expect(canonicalSerialize(state)).toBe(before);
  const compiled = kernelRun(expenses);
  expect(compiled.status).toBe("incomplete");
  expect(compiled.state.accounts).toEqual(state.accounts);
  expect(Object.keys(compiled.state.obligations)).toEqual([]);
  expect(compiled.state.identities.settlementIds).toEqual([]);
};

describe("actual VS2 household BANK expenses", () => {
  it("keeps exact recognition and settlement IDs, labels, cents and one settlement proof", () => {
    const result = execute(), original = reconstruct(0, instant("2026-01-15T00:00:00.000Z"));
    expect(result.period.transactions).toEqual([original.recognition, original.settlement]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("74.63"))).toBe(true);
    expect(result.state.liabilities[ids.payable]!.balance.isZero()).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions!)).toHaveLength(1);
    expect(result.state.d2PostedTransactions![original.settlement.id]!.transaction).toEqual(original.settlement);
    expect(result.period.outstandingExpenseObligations.isZero()).toBe(true);
    expect(result.period.settlements).toHaveLength(1);
  });
  it("recognizes an unfunded obligation without cash, settlement identity or proof", () => {
    const result = execute([stream()], "10");
    expect(result.period.transactions.map(t => t.type)).toEqual(["expense_recognition"]);
    expect(result.period.outstandingExpenseObligations.equals(money("25.37"))).toBe(true);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("10"))).toBe(true);
    expect(result.state.liabilities[ids.payable]!.balance.equals(money("25.37"))).toBe(true);
    expect(result.period.constraintOutcomes[0]!.status).toBe("unfunded");
    expect(result.period.liquidityShortfalls).toHaveLength(1);
    expect(result.period.diagnostics.length).toBeGreaterThan(0);
    expect(result.state.identities.settlementIds).toEqual([]);
    expect(Object.keys(result.state.d2PostedTransactions ?? {})).toEqual([]);
  });
  it("authenticates two payers at distinct times on the same BANK balance", () => {
    const result = execute([stream(1), stream(0)]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("49.26"))).toBe(true);
    const proofs = Object.values(result.state.d2PostedTransactions!);
    expect(proofs.map(p => p.registration.personId).sort()).toEqual([ids.alice, ids.bob].sort());
    expect(proofs.map(p => p.transaction.date)).toEqual([instant("2026-01-15T00:00:00.000Z"), instant("2026-01-20T00:00:00.000Z")]);
  });
  it("uses authored same-instant priority and leaves the second claim honestly unpaid", () => {
    control.day = "15";
    const expenses = [stream(1, "15"), stream(0)], result = execute(expenses, "30");
    expect(result.period.constraintOutcomes.map(o => o.status)).toEqual(["fully_satisfied", "unfunded"]);
    expect(Object.values(result.state.d2PostedTransactions!)[0]!.registration.personId).toBe(ids.alice);
    expect(result.period.outstandingExpenseObligations.equals(money("25.37"))).toBe(true);
    reject(expenses.map(s => ({ ...s, settlementPriority: 0 })));
  });
  it.each(["payer", "beneficiary", "publisher", "revision", "digest", "amount", "month", "account", "partial"])("rejects forged stream %s without committing", mode => {
    let s = stream();
    if (mode === "payer") s = { ...s, ownerId: ids.bob };
    if (mode === "beneficiary") s = { ...s, householdExpenseSource: { ...source(), beneficiary: ids.bob } };
    if (["publisher", "revision", "digest"].includes(mode)) s = { ...s, householdExpenseSource: { ...source(), original: {
      ...source().original, ...(mode === "publisher" ? { publisherId: "forged" } : mode === "revision" ? { revisionId: "v2" } : { digest: "forged" }) } } };
    if (mode === "amount") s = { ...s, baseMonthlyAmount: money("25.38") };
    if (mode === "month") s = { ...s, recurrence: { ...s.recurrence, anchor: instant("2026-01-16T00:00:00.000Z") }, inflationBaseAt: instant("2026-01-16T00:00:00.000Z") };
    if (mode === "account") s = { ...s, paymentAccountId: ids.alice as unknown as RecurringExpenseStream["paymentAccountId"] };
    if (mode === "partial") s = { ...s, fundingPolicy: { ...s.fundingPolicy, allowPartial: true } };
    reject([s]);
  });
  it("binds actual household, run, observation boundaries and source currency", () => {
    const state = opening(), base = { runContext: context(), openingState: state, input: input() };
    for (const request of [
      { ...base, input: { ...base.input, householdId: ids.bob as unknown as typeof ids.household } },
      { ...base, runContext: { ...base.runContext, runId: context().scenarioId as unknown as ReturnType<typeof context>["runId"] } },
      { ...base, runContext: { ...base.runContext, dataCutoff: instant("2025-11-01T00:00:00.000Z") } },
      { ...base, runContext: { ...base.runContext, asOf: instant("2025-12-02T00:00:00.000Z") } },
    ]) expect(() => executeVerticalSlice2PeriodCandidate(request, utcMonthlyPeriods(start, 1)[0]!, state, {})).toThrow();
    reject([{ ...stream(), baseMonthlyAmount: money("25.37", Currency.of("EUR")) }]);
  });
  it.each(["claim", "occurrence", "period", "recognition", "settlement"])("requires the source's exact %s", mode => {
    control.economic = v => {
      if (mode === "claim") return { ...v, claimId: "other-claim" };
      if (mode === "occurrence") return { ...v, occurrenceId: "other-occurrence" };
      if (mode === "period") return { ...v, period: { ...v.period, end: instant("2026-01-31T00:00:00.000Z") } };
      if (mode === "recognition") return { ...v, recognition: { ...v.recognition, type: "income" } };
      return { ...v, settlement: { ...v.settlement, type: "expense_recognition" } };
    };
    reject();
  });
  it("diagnoses unavailable publishers without committing any obligation", () => {
    const s = { ...stream(), householdExpenseSource: { ...source(), bank: { ...source().bank, publisherId: "absent-bank" } } };
    reject([s]);
    const result = runVerticalSlice2({ runContext: context(), openingState: opening(), input: input([s]), months: 1 });
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ message: "HOUSEHOLD_EXPENSE_ORIGINAL_NOT_ADMITTED" }));
    expect(Object.keys(result.state.obligations)).toEqual([]);
  });
  it.each(["bank", "economic"])("rechecks %s before retaining an UNFUNDED recognition", publisher => {
    if (publisher === "bank") control.bank = v => control.bankReads > 1 ? undefined : v;
    else control.economic = v => control.reads > 1 ? undefined : v;
    const state = opening("0"), before = canonicalSerialize(state);
    expect(() => executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input() },
      utcMonthlyPeriods(start, 1)[0]!, state, {})).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it.each(["withdrawn", "late", "incomplete", "payer", "bank-revoked", "bank-late", "bank-race", "economic-race"])("fails closed for %s sources", mode => {
    if (mode === "withdrawn") control.economic = () => undefined;
    if (mode === "late") control.economic = v => ({ ...v, checkedAt: instant("2026-01-01T00:00:00.000Z") });
    if (mode === "incomplete") control.economic = v => ({ ...v, completeThrough: instant("2025-11-01T00:00:00.000Z") });
    if (mode === "payer") control.economic = v => ({ ...v, witness: { ...v.witness, payer: { kind: "person", id: ids.bob } } });
    if (mode === "bank-revoked") control.bank = v => ({ ...v, originals: v.originals.map(o => ({ ...o, status: "revoked" })) });
    if (mode === "bank-late") control.bank = v => ({ ...v, originals: v.originals.map(o => ({ ...o, knownAt: instant("2026-01-01T00:00:00.000Z") })) });
    if (mode === "bank-race") control.bank = v => control.bankReads > 1 ? undefined : v;
    if (mode === "economic-race") control.economic = v => control.reads > 1 ? undefined : v;
    reject();
    // Source failure must not turn into an unauthenticated UNFUNDED claim.
    const state = opening("0"), before = canonicalSerialize(state);
    expect(() => executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input() },
      utcMonthlyPeriods(start, 1)[0]!, state, {})).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("keeps legacy Person BANK journals and metadata exactly equal to the qualified economic journals", () => {
    const { householdExpenseSource: _source, ...legacy } = stream();
    const state = opening(); Object.assign(state.accounts[ids.bank]!, { ownerId: ids.alice });
    const result = executeVerticalSlice2PeriodCandidate({ runContext: context(), openingState: state, input: input([legacy]) },
      utcMonthlyPeriods(start, 1)[0]!, state, {}), qualified = execute();
    expect(canonicalSerialize(result.period)).toBe(canonicalSerialize(qualified.period));
    expect(Object.keys(result.state.d2PostedTransactions ?? {})).toEqual([]);
    // Ordinary household streams retain their historical behavior too.
    expect(execute([legacy]).period.transactions).toEqual(result.period.transactions);
  });
  it("stops a cancelled source schedule before recognition and source reads", () => {
    const s = stream(), result = execute([{ ...s, end: instant("2026-01-10T00:00:00.000Z") }]);
    expect(result.period.transactions).toEqual([]);
    expect(control.reads).toBe(0);
  });
});

describe("compiled kernel, replay and bounded growth", () => {
  it.each(["100", "10"])("executes detail and summary with actual liquidity %s", cash => {
    const direct = execute([stream()], cash), detail = kernelRun([stream()], cash),
      summary = runHouseholdKernel({ kernel: kernelFixture([stream()], cash), runContext: context() });
    expect(detail.status, JSON.stringify(detail.diagnostics)).toBe("completed");
    expect(summary.status, JSON.stringify(summary.diagnostics)).toBe("completed");
    expect(detail.state.accounts).toEqual(direct.state.accounts);
    expect(detail.state.d2PostedTransactions).toEqual(direct.state.d2PostedTransactions);
    expect(summary.state.accounts).toEqual(detail.state.accounts);
    expect(summary.state.d2PostedTransactions).toEqual(detail.state.d2PostedTransactions);
    expect(detail.periods[0]!.transactions).toEqual(direct.period.transactions);
  });
  it("rolls back a compiled-kernel source race", () => {
    control.economic = v => control.reads > 1 ? undefined : v;
    const result = kernelRun();
    expect(result.status).toBe("incomplete");
    expect(result.state.accounts[ids.bank]!.cash.equals(money("100"))).toBe(true);
    expect(Object.keys(result.state.d2PostedTransactions ?? {})).toEqual([]);
    expect(result.state.identities.settlementIds).toEqual([]);
  });
  it("authenticates two compiled members and preserves same-instant funding order", () => {
    const different = kernelRun([stream(1), stream(0)]);
    expect(different.status).toBe("completed");
    expect(different.state.accounts[ids.bank]!.cash.equals(money("49.26"))).toBe(true);
    expect(Object.values(different.state.d2PostedTransactions!)).toHaveLength(2);
    control.day = "15";
    const same = kernelRun([stream(1, "15"), stream(0)], "30");
    expect(same.status).toBe("completed");
    expect(same.periods[0]!.constraintOutcomes.map(o => o.status)).toEqual(["fully_satisfied", "unfunded"]);
    expect(Object.values(same.state.d2PostedTransactions!)[0]!.registration.personId).toBe(ids.alice);
    expect(same.periods[0]!.cashFlow!.outstandingExpenseObligations.equals(money("25.37"))).toBe(true);
  });
  it("requalifies portable full state and checkpoint delta in a fresh process", () => {
    const state = execute().state, delta = authoritativeCheckpointDelta(state, createAuthoritativeState(), (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    expect(canonicalSerialize(restoreAuthoritativeCheckpointDelta(createAuthoritativeState(), delta))).toBe(canonicalSerialize(state));
    const directory = mkdtempSync(join(tmpdir(), "pfm-expense-source-")), path = join(directory, "synthetic.json");
    try {
      for (const sources of [true, false]) {
        writeFileSync(path, JSON.stringify({ state, delta, sources }));
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 10_000,
          env: { ...process.env, PFM_EXPENSE_PAYLOAD: path } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(sources ? JSON.parse(JSON.stringify({ imported: state.accounts, restored: state.accounts })) : { rejected: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
    control.economic = () => undefined;
    expect(() => requalifyD2SettlementReceiptHistory(state, context())).toThrow();
    expect(() => createAuthoritativeState(state)).toThrow();
  });
  it("keeps 1/12/24 settlement proofs linear, bounded and free of publisher catalogs", () => {
    const sizes: number[] = [], reads: number[] = [];
    for (const months of [1, 12, 24]) {
      reset();
      const result = runVerticalSlice2({ runContext: context(months), openingState: opening("1000"), input: input(), months });
      expect(result.status).toBe("completed");
      expect(Object.values(result.state.d2PostedTransactions!)).toHaveLength(months);
      sizes.push(JSON.stringify(result.state.d2PostedTransactions).length);
      reads.push(control.reads / months);
      expect(JSON.stringify(result.state.d2PostedTransactions)).not.toContain("bank-deed");
      expect(JSON.stringify(result.state.d2PostedTransactions)).not.toContain("household-expense-original/v1");
      expect(Object.values(result.state.d2PostedTransactions!).every(p => p.registration.kind === "household_domain" && p.registration.evidence.originals.length === 1)).toBe(true);
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[1]! * 2.1);
    expect(reads[2]).toBe(reads[1]);
    expect(reads[2]!).toBeLessThanOrEqual(8);
  });
});
