import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { domainId } from "../../../../src/identity/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../src/funding/index.js";
import { compileHouseholdKernel, replayHouseholdForecastWindow, runCompiledHouseholdProjection, runHouseholdForecastSummary } from "../../../../src/simulation/householdExecution.js";
import { runCompiledHouseholdProjection as referenceHousehold } from "../../../../src/simulation/r3/referenceHouseholdExecution.js";
import { runVerticalSlice4 as referenceVs4 } from "../../../../src/simulation/r3/referenceVerticalSlice4.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { expandedWire, replaceWireField, wireField, wireItems } from "../sharedReceipts/wireFixture.js";

import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { runVerticalSlice4 } from "../../../../src/simulation/verticalSlice4.js";
import { ids } from "../householdBankAuthority/scenario.js";
import { control, fixture, interest, principal, reset, start } from "./scenario.js";

afterEach(reset);

const expandFixedLoanArtifact = (encoded: string) => expandedWire(JSON.stringify(JSON.parse(encoded, (_name, value: unknown) => {
  if (value === null || typeof value !== "object" || Object.keys(value).length !== 1) return value;
  if ("d" in value) return { kind: "definition", value: value.d };
  if ("r" in value) return { kind: "reference", value: value.r };
  if ("t" in value && Array.isArray(value.t)) return { kind: value.t[0], value: value.t[1] };
  return value;
})));

describe("source-qualified fixed loan service", () => {
  it.each(["mortgage", "auto", "student"] as const)("posts %s interest, principal and one-cent extra as separate canonical journals", family => {
    const request = fixture(family, "extra", 2);
    const direct = runVerticalSlice4(request), independent = referenceVs4(request);
    expect(direct.status, JSON.stringify(direct.diagnostics)).toBe("completed");
    expect(independent.status, JSON.stringify(independent.diagnostics)).toBe("completed");
    expect(canonicalSerialize(independent.state)).toBe(canonicalSerialize(direct.state));
    expect(direct.state.accounts[ids.bank]!.cash.equals(money("49.24"))).toBe(true);
    expect(direct.state.liabilities[principal]!.balance.equals(money("50.24"))).toBe(true);
    expect(direct.state.liabilities[interest]!.balance.isZero()).toBe(true);
    expect(direct.periods[0]!.interestExpense.equals(money("1"))).toBe(true);
    expect(direct.periods[0]!.statements.netWorth.equals(money("-1"))).toBe(true);
    expect(Object.values(direct.state.d2PostedTransactions ?? {}).map(proof => proof.transaction.type).sort()).toEqual(
      ["extra_principal", "interest_recognition", "interest_settlement", "principal_payment"].map(kind =>
        `${family === "mortgage" ? family : `${family}_loan`}_${kind}`));
    const detail = runCompiledHouseholdProjection(request), reference = referenceHousehold(request);
    const summary = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(request.compiled, start), runContext: request.runContext });
    for (const result of [detail, reference, summary]) {
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
      expect(canonicalSerialize(result.state)).toBe(canonicalSerialize(direct.state));
    }
    const restored = restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(summary));
    const replay = replayHouseholdForecastWindow(restored, restored.periods[0]!.period);
    expect(canonicalSerialize(replay.state)).toBe(canonicalSerialize(direct.state));
  });

  it("retains interest for expense-first and rejects selected, unprioritized and revoked debit attempts atomically", () => {
    const request = fixture("mortgage", "contention", 1);
    control.permission = "credit";
    for (const run of [runCompiledHouseholdProjection, referenceHousehold]) {
      const execute = (first?: "cash_expense_settlement" | "liability_required_service") => run({ ...request,
        compiled: { ...request.compiled, ...(first ? { contentionPolicy: { id: "test-policy", version: "1",
          rules: [{ before: first, after: first === "cash_expense_settlement" ? "liability_required_service" : "cash_expense_settlement" }] } } : {}) } });
      const expense = execute("cash_expense_settlement");
      expect(expense.status, JSON.stringify(expense.diagnostics)).toBe("completed");
      expect(expense.state.accounts[ids.bank]!.cash.isZero()).toBe(true);
      expect(expense.state.liabilities[principal]!.balance.equals(money("99.01"))).toBe(true);
      expect(expense.state.liabilities[interest]!.balance.equals(money("0.99"))).toBe(true);
      expect(Object.keys(expense.state.d2PostedTransactions ?? {})).toHaveLength(1);
      const loan = execute("liability_required_service"), unresolved = execute();
      expect(loan.diagnostics.map(d => d.code)).toContain("FIXED_LOAN_DEBIT_PERMISSION_DENIED");
      expect(unresolved.diagnostics.map(d => d.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
      expect(canonicalSerialize(loan.state)).toBe(canonicalSerialize(request.openingState));
      expect(canonicalSerialize(unresolved.state)).toBe(canonicalSerialize(request.openingState));
    }
    control.permission = "revoked";
    const revoked = runCompiledHouseholdProjection(request);
    expect(revoked.diagnostics.map(d => d.code)).toContain("HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED");
    expect(canonicalSerialize(revoked.state)).toBe(canonicalSerialize(request.openingState));
  });

  it("rechecks an unfunded lender occurrence that has no committed posting proof", () => {
    const request = fixture("student", "growth", 1);
    const compiled = { ...request.compiled, reconciledOpeningState: createAuthoritativeState({ ...request.openingState,
      accounts: { [ids.bank]: { ...request.openingState.accounts[ids.bank]!, cash: money("0") } },
    }) };
    const summary = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(compiled, start), runContext: request.runContext });
    expect(summary.status, JSON.stringify(summary.diagnostics)).toBe("completed");
    expect(Object.keys(summary.state.d2PostedTransactions ?? {})).toHaveLength(0);
    expect(control.bankReads).toBe(0);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const restored = restorePortableHouseholdReplayArtifact(artifact);
    const selected = restored.periods[0]!.period;
    control.lenderAvailable = false;
    expect(() => replayHouseholdForecastWindow(restored, selected)).toThrow("Lender originals unavailable");
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    expect(control.bankReads).toBe(0);
  });

  it("does not let an expense-first policy suppress a lender race or a cycle", () => {
    const request = fixture("mortgage", "contention", 1);
    for (const run of [runCompiledHouseholdProjection, referenceHousehold]) {
      const expenseFirst = { before: "cash_expense_settlement", after: "liability_required_service" } as const;
      const runWithPolicy = (cyclic: boolean) => run({ ...request, compiled: { ...request.compiled, contentionPolicy: {
        id: "expense-contention-policy", version: "1", rules: cyclic ? [expenseFirst,
          { before: "liability_required_service", after: "investment_transfer" },
          { before: "investment_transfer", after: "cash_expense_settlement" }] : [expenseFirst],
      } } });
      control.permission = "debit";
      control.lenderAvailable = true;
      control.revokeLenderOnBankRead = false;
      expect(runWithPolicy(true).diagnostics.map(d => d.code)).toContain("HOUSEHOLD_CONTENTION_POLICY_CYCLE");
      control.permission = "credit";
      control.revokeLenderOnBankRead = true;
      const race = runWithPolicy(false);
      expect(race.diagnostics.map(d => d.code)).toContain("FIXED_LOAN_ORIGINAL_NOT_ADMITTED");
      expect(canonicalSerialize(race.state)).toBe(canonicalSerialize(request.openingState));
    }
  });

  it("funds required service ahead of a competing expense that leaves zero cash for the extra", () => {
    const request = fixture("mortgage", "extra", 2);
    const cash = fixture("mortgage", "contention", 1).compiled.cashFlowInput!;
    const compiled = { ...request.compiled, cashFlowInput: { ...cash, expenses: [
      { ...cash.expenses[0]!, baseMonthlyAmount: money("49.25") },
    ] }, contentionPolicy: { id: "required-then-expense", version: "1" as const, rules: [
      { before: "liability_required_service", after: "cash_expense_settlement" },
      { before: "cash_expense_settlement", after: "liability_extra_principal" },
    ] } };
    const optimized = runCompiledHouseholdProjection({ ...request, compiled });
    const reference = referenceHousehold({ ...request, compiled });
    const compact = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(compiled, start), runContext: request.runContext });
    for (const result of [optimized, reference, compact]) {
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
      expect(result.state.accounts[ids.bank]!.cash.isZero()).toBe(true);
      expect(result.state.liabilities[principal]!.balance.equals(money("50.25"))).toBe(true);
      expect(Object.keys(result.state.d2PostedTransactions ?? {})).toHaveLength(3);
    }
  });

  it("preserves the earlier committed month when the following original is unavailable", () => {
    const request = fixture("student", "growth", 2, 2);
    control.withheldEvent = instant("2026-02-15T00:00:00.000Z");
    for (const run of [runVerticalSlice4, referenceVs4]) {
      const result = run(request);
      expect(result.status).toBe("incomplete");
      expect(result.periods).toHaveLength(1);
      expect(result.state.accounts[ids.bank]!.cash.equals(money("99"))).toBe(true);
      expect(result.state.liabilities[principal]!.balance.equals(money("1"))).toBe(true);
      expect(Object.keys(result.state.d2PostedTransactions ?? {})).toHaveLength(1);
    }
  });

  it("requalifies warm replay and rejects stripped terminal proofs even if closing money is retained", () => {
    const request = fixture("student", "growth", 13, 13);
    const summary = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(request.compiled, start), runContext: request.runContext });
    expect(summary.status, JSON.stringify(summary.diagnostics)).toBe("completed");
    const artifact = createPortableHouseholdReplayArtifact(summary);
    expect(restorePortableHouseholdReplayArtifact(artifact).periods).toHaveLength(13);
    for (const boundary of ["terminal", "sparse"] as const) {
      const decoded = expandFixedLoanArtifact(artifact.encoded);
      const delta = boundary === "terminal" ? wireField(decoded, "terminalDelta") : wireItems(wireField(decoded, "checkpoints"))[0]!;
      const records = wireField(delta, "records");
      for (const name of ["d2PostedTransactions", "obligations"])
        replaceWireField(wireField(records, name), "set", { kind: "record", value: [] });
      const identities = wireField(delta, "identities");
      for (const name of ["postedTransactionIds", "externalIdempotencyKeys", "generatedOccurrenceKeys", "recognitionIds", "settlementIds"])
        replaceWireField(wireField(identities, name), "add", { kind: "array", value: [] });
      const encoded = JSON.stringify(decoded);
      expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded,
        integrity: createInputFingerprint({ runContext: request.runContext, openingState: encoded }) })).toThrow(
        expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringContaining("fixed loan committed history differs") }) }));
    }
    control.permission = "revoked";
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    control.permission = "debit";
    control.lenderAvailable = false;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  });

  it("rebuilds sparse replay in a fresh publisher process and rejects an absent original publisher", () => {
    const request = fixture("student", "growth", 13, 13);
    const summary = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(request.compiled, start), runContext: request.runContext });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const selected = summary.periods.at(-1)!.period;
    for (const sources of [true, false]) {
      const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { input: JSON.stringify({ artifact, selected, sources }), encoding: "utf8", timeout: 30_000 });
      expect(worker.status, worker.stderr).toBe(0);
      const answer = JSON.parse(worker.stdout);
      if (sources) expect(answer).toEqual({ periods: 1, cash: "87", proofs: 13 });
      else expect(answer).toEqual({ rejected: true });
    }
  }, 65_000);

  it("rejects split BANK funding before permission policy and preserves source-free modeled execution", () => {
    const request = fixture("auto", "extra", 2);
    const loan = request.input.loans[0]!;
    const alternate = domainId("account", "58f21d59-0077-4ee2-8593-000000000066");
    const primary = request.openingState.accounts[ids.bank]!;
    const openingState = createAuthoritativeState({ ...request.openingState, accounts: {
      [ids.bank]: { ...primary, cash: money("25") }, [alternate]: { ...primary, id: alternate, cash: money("75") },
    } });
    const fundingPolicy = createFundingPolicy({ ...loan.fundingPolicy, id: fundingPolicyId("fixed-loan:split-test"),
      orderedSources: [...loan.fundingPolicy.orderedSources, { kind: "cash_account", accountId: alternate }] });
    const sourced = runVerticalSlice4({ ...request, openingState, input: { ...request.input, loans: [{ ...loan, fundingPolicy }] } });
    expect(sourced.status).toBe("incomplete");
    expect(control.bankReads).toBe(0);
    expect(canonicalSerialize(sourced.state)).toBe(canonicalSerialize(openingState));
    const { originalSource: _original, ...modeledLoan } = loan;
    const modeled = runVerticalSlice4({ ...request, input: { ...request.input, loans: [modeledLoan] } });
    expect(modeled.status).toBe("completed");
    expect(modeled.state.d2PostedTransactions).toBeUndefined();
    expect(modeled.state.accounts[ids.bank]!.cash.equals(money("49.24"))).toBe(true);
  });

  it("keeps proof bytes and publisher reads bounded across distinct zero-interest installments", () => {
    for (const [term, months] of [[1, 1], [12, 13], [24, 25]] as const) {
      const request = fixture("auto", "growth", term, months);
      control.lenderReads = 0; control.bankReads = 0;
      const summary = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(request.compiled, start), runContext: request.runContext });
      expect(summary.status, JSON.stringify(summary.diagnostics)).toBe("completed");
      expect(Object.keys(summary.state.d2PostedTransactions ?? {})).toHaveLength(term);
      const commitments = summary.state.identities.externalIdempotencyKeys.filter(key => /d2-shared:posted-proof:71:sha256:[0-9a-f]{64}$/.test(key));
      expect(new Set(commitments).size).toBe(term);
      expect(commitments.every(key => key.length <= 150)).toBe(true);
      expect(control.lenderReads).toBeLessThanOrEqual(8 * term);
      expect(control.bankReads).toBeLessThanOrEqual(8 * term);
      const artifact = createPortableHouseholdReplayArtifact(summary);
      expect(new TextEncoder().encode(artifact.encoded).byteLength).toBeLessThan(16_000 + 9_000 * term);
      const restored = restorePortableHouseholdReplayArtifact(artifact);
      expect(restored.periods).toHaveLength(months);
      control.lenderReads = 0; control.bankReads = 0;
      expect(restorePortableHouseholdReplayArtifact(artifact)).toBe(restored);
      expect(control.lenderReads).toBeLessThanOrEqual(2 * term);
      expect(control.bankReads).toBeLessThanOrEqual(2 * term);
      const end = request.runContext.simulationEnd;
      const replay = replayHouseholdForecastWindow(restored, { start: restored.periods.at(-1)!.period.start, end });
      expect(replay.periods).toHaveLength(1);
    }
  });
});
