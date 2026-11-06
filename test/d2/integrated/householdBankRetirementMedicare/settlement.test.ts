import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { createAuthoritativeState, requalifyD2SettlementReceiptHistory, requalifyRetirementDistributionHistory, registerAuthoritativeIdentity } from "../../../../src/state/index.js";
import { runHouseholdKernel, replayHouseholdForecastWindow, applyHouseholdExecutionOverlay, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { idempotencyKey } from "../../../../src/identity/index.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { attachRetirementCash, evaluateFundedRmdSatisfaction } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { qualifyRetirementRawSource, retirementRawSourceDigest } from "../../../../src/simulation/d2/integration/retirementCash/source.js";
import { attachMedicareBank } from "../../../../src/simulation/d2/integration/medicareBank/index.js";
import { evaluateWithdrawals } from "../../../../src/simulation/d2/retirement/withdrawals/index.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture as personFixture, input as personInput } from "../retirementCash/scenario.js";
import { fixture as personMedicareFixture, input as personMedicareInput } from "../medicareBank/scenario.js";
import { attached, bob, control, expenseOriginal, fixture, ids, install, legacyAccounts, legacyOriginal, premiums, request, reset, retirementOriginal, retirementPlan } from "./scenario.js";

beforeAll(install);
beforeEach(reset);
const execute = (f = attached()) => runHouseholdKernel({ kernel: f.kernel, runContext: f.context, resultTier: "detail" });
const noCommit = (f: ReturnType<typeof attached>) => {
  const before = canonicalSerialize(f.state), result = execute(f);
  expect(result.status, JSON.stringify(result.diagnostics)).toBe("incomplete");
  expect(result.periods).toHaveLength(0);
  expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
  expect(canonicalSerialize(result.state)).toBe(before);
  expect(canonicalSerialize(f.state)).toBe(before);
  return result;
};

describe("source-qualified ordinary retirement transfers", () => {
  it.each([false, true])("posts exact native v2 two-cash-leg proof (RMD reference %s)", rmd => {
    const f = attached({ medicare: false, rmd }), result = execute(f);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    expect(result.outputCapabilities?.retirementTax?.status).toBe("incomplete");
    expect(result.state.accounts[ids.ira]!.cash.equals(money("500"))).toBe(true);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    const records = Object.values(result.state.retirementDistributionAllocations!);
    expect(records).toHaveLength(1);
    const d = records[0]!, proof = result.state.d2PostedTransactions![d.transactionId]!;
    expect(d.version).toBe("retirement-distribution/v2");
    expect([d.personId, d.sourceAccountId, d.destinationAccountId]).toEqual([ids.person, ids.ira, ids.bank]);
    expect([d.rmdSatisfaction, d.tax, d.taxBucket]).toEqual(["not_applied", "incomplete", "pretax"]);
    expect(d.allocations).toHaveLength(rmd ? 1 : 0);
    expect(d.withholding.isZero()).toBe(true);
    expect(proof.registration.kind).toBe("retirement_cash_distribution");
    expect(proof.transaction.type).toBe("retirement_cash_transfer");
    expect(proof.transaction.legs.map(l => [l.type, l.posting, l.type === "cash" ? l.accountId : null, l.amount.amount.toString()]))
      .toEqual([["cash", "debit", ids.bank, "500"], ["cash", "credit", ids.ira, "500"]]);
    expect(result.periods[0]!.statements.income.isZero()).toBe(true);
    expect(result.periods[0]!.statements.expenses.isZero()).toBe(true);
    expect(result.periods[0]!.netWorth.equals(money("1200"))).toBe(true);
    if (rmd) {
      expect(result.outputCapabilities?.rmdSatisfaction?.status).toBe("incomplete");
      const p = retirementPlan(true);
      expect(evaluateFundedRmdSatisfaction(p.fundedRmd!, result.state, f.context, f.context.simulationEnd).annual).toBeNull();
    }
    requalifyRetirementDistributionHistory(result.state, f.context);
    expect(createAuthoritativeState(result.state).accounts).toEqual(result.state.accounts);
  });
  it("keeps the pure evaluator conditional even with household destination evidence", () => {
    const raw = retirementOriginal(), evaluated = evaluateWithdrawals(raw.cash.withdrawals);
    expect(evaluated.coverage).toBe("complete");
    expect([evaluated.committed, evaluated.postable, evaluated.candidates[0]!.postable]).toEqual([false, false, false]);
    const r = raw.cash.withdrawals.requests[0]!;
    expect(evaluateWithdrawals({ ...raw.cash.withdrawals, requests: [{ ...r, bank: { ...r.bank,
      householdDestination: { ...r.bank.householdDestination!, personId: bob } } }] }).coverage).toBe("incomplete");
  });
  it.each([false, true])("rejects original amendment/withdrawal and late availability on both routes (%s)", rmd => {
    const f = attached({ medicare: false, rmd });
    for (const mode of ["withdrawn", "revision", "late", "owner", "plan"] as const) {
      control.retirement = raw => mode === "withdrawn" ? undefined : mode === "revision" ? { ...raw, sourceVersion: "v2" }
        : mode === "late" ? { ...raw, availability: raw.availability.map(a => ({ ...a, knownAt: instant("2027-01-01T00:00:00.000Z") })) }
          : { ...raw, cash: { ...raw.cash, withdrawals: { ...raw.cash.withdrawals,
            cash: raw.cash.withdrawals.cash.map(a => mode === "owner" ? { ...a, ownerId: bob }
              : { ...a, instrumentFamily: "workplace_plan" as const }) } } };
      noCommit(f);
    }
  });
  it("fails closed on nonzero withholding rather than inventing a tax payment", () => {
    const raw = retirementOriginal(), cash = { ...raw.cash, withdrawals: { ...raw.cash.withdrawals,
      requests: raw.cash.withdrawals.requests.map(r => ({ ...r, withholding: { ...r.withholding!,
        instructions: r.withholding!.instructions.map((i, n) => ({ ...i, amount: money(n ? "0" : "1") })) } })) } };
    expect(qualifyRetirementRawSource({ ...raw, cash, binding: { ...raw.binding, withdrawals: cash.withdrawals } },
      cash.withdrawals.requests[0]!.operationId, fixture().context).status).toBe("incomplete");
  });
  it("requires the actual run, cutoff, source ownership, funds and original address", () => {
    const f = attached({ medicare: false });
    noCommit({ ...f, context: { ...f.context, runId: personFixture().context.scenarioId as unknown as typeof f.context.runId } });
    noCommit({ ...f, context: { ...f.context, dataCutoff: instant("2026-06-14T00:00:00.000Z") } });
    const plan = retirementPlan(), { originalSource: _source, ...missing } = plan;
    noCommit({ ...fixture(), kernel: attachRetirementCash(fixture().kernel, missing).kernel });
    for (const altered of [fixture("200", 1, "499.99"), fixture("200", 1, "1000", bob)])
      noCommit({ ...altered, kernel: attachRetirementCash(altered.kernel, plan).kernel });
    const q = plan.confirmations[0]!;
    noCommit({ ...fixture(), kernel: attachRetirementCash(fixture().kernel, { ...plan,
      confirmations: [{ ...q, sourceCashBefore: money("499.99") }] }).kernel });
  });
  it("preserves the direct-person v1 cash route", () => {
    const f = personFixture(), result = runHouseholdKernel({ kernel: attachRetirementCash(f.kernel, personInput(f)).kernel, runContext: f.context, resultTier: "detail" });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    expect(result.state.retirementDistributionAllocations).toBeUndefined();
    expect(result.periods[0]!.transactions[0]!.id).toBe(accountingTransactionId("withdraw:one"));
  });
  it("rejects an already consumed distribution claim without posting or changing cash", () => {
    const f = fixture(), p = retirementPlan();
    registerAuthoritativeIdentity(f.state.identities, "externalIdempotencyKeys", idempotencyKey("d2:retirement-withdrawal", p.withdrawals.requests[0]!.withdrawalId));
    const kernel = attachRetirementCash(applyHouseholdExecutionOverlay(f.kernel, { reconciledOpeningState: f.state }), p).kernel;
    noCommit({ ...f, kernel });
  });
  it.each([false, true])("preserves another person's posted v1 RMD credit beside an imported native household distribution (%s)", rmd => {
    const native = execute(attached({ medicare: false, rmd }));
    expect(native.periods).toHaveLength(1);
    const raw = legacyOriginal(), base = personFixture();
    const opening = createAuthoritativeState({ accounts: {
      [legacyAccounts.ira]: { id: legacyAccounts.ira, ownerId: bob, kind: "retirement", cash: money("1000") },
      [legacyAccounts.bank]: { id: legacyAccounts.bank, ownerId: bob, kind: "checking", cash: money("200") },
    } });
    const reference = { sourceId: raw.sourceId, sourceVersion: raw.sourceVersion, contentDigest: retirementRawSourceDigest(raw),
      horizon: { start: base.context.simulationStart, end: base.context.simulationEnd } };
    const kernel = applyHouseholdExecutionOverlay(base.kernel, { reconciledOpeningState: opening });
    const legacy = execute({ ...base, state: opening, kernel: attachRetirementCash(kernel, { ...raw.cash, fundedRmd: reference }).kernel });
    expect(legacy.periods).toHaveLength(1);
    const identities = Object.fromEntries(Object.entries(native.state.identities).map(([key, values]) =>
      [key, [...new Set([...values, ...legacy.state.identities[key as keyof typeof legacy.state.identities]])]])) as typeof native.state.identities;
    const imported = createAuthoritativeState({ accounts: { ...native.state.accounts, ...legacy.state.accounts }, identities,
      retirementDistributionAllocations: { ...native.state.retirementDistributionAllocations, ...legacy.state.retirementDistributionAllocations },
      d2PostedTransactions: { ...native.state.d2PostedTransactions, ...legacy.state.d2PostedTransactions } });
    const before = canonicalSerialize(imported);
    const annual = evaluateFundedRmdSatisfaction(reference, imported, base.context, base.context.simulationEnd).annual!;
    expect(annual.obligations[0]!.required.equals(money("700"))).toBe(true);
    expect(annual.obligations[0]!.satisfied.equals(money("500"))).toBe(true);
    expect(annual.obligations[0]!.remaining.equals(money("200"))).toBe(true);
    expect(canonicalSerialize(imported)).toBe(before);
    expect(Object.values(imported.retirementDistributionAllocations!).find(d => d.nativeHousehold)!.rmdSatisfaction).toBe("not_applied");
  });
});

describe("separately sourced NON-SSA Medicare VS2 premiums", () => {
  it("recognizes 80 B and 120 D, then settles each exactly once from the one BANK", () => {
    const result = execute(attached({ retirement: false }));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.isZero()).toBe(true);
    expect(result.periods[0]!.transactions).toEqual(premiums().flatMap(b => {
      const original = expenseOriginal("2026-06", b.obligation.part);
      return [original.recognition, original.settlement];
    }));
    expect(Object.values(result.state.d2PostedTransactions!)).toHaveLength(2);
    expect(Object.values(result.state.d2PostedTransactions!).every(p => p.registration.kind === "household_domain"
      && p.registration.personId === bob && p.registration.evidence.originals[0]!.original.family === "medicare")).toBe(true);
    expect(result.periods[0]!.statements.expenses.equals(money("200"))).toBe(true);
  });
  it("retains full recognition and unpaid liability when unfunded, without a settlement", () => {
    const result = execute(attached({ retirement: false, cash: "0" }));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]!.transactions.map(t => t.type)).toEqual(["expense_recognition", "expense_recognition"]);
    expect(result.periods[0]!.cashFlow!.outstandingExpenseObligations.equals(money("200"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions ?? {})).toHaveLength(0);
    expect(result.state.identities.settlementIds).toEqual([]);
  });
  it.each(["withdrawn", "amended", "beneficiary", "payer", "month", "recognition", "settlement", "race"])("rejects %s legal originals atomically", mode => {
    const f = attached({ retirement: false });
    control.expense = v => mode === "withdrawn" || (mode === "race" && control.expenseReads > 1) ? undefined
      : mode === "amended" ? { ...v, witness: { ...v.witness, original: { ...v.witness.original, revisionId: "v2" } } }
        : mode === "beneficiary" ? { ...v, witness: { ...v.witness, beneficiary: ids.person } }
          : mode === "payer" ? { ...v, witness: { ...v.witness, payer: { kind: "person", id: ids.person } } }
            : mode === "month" ? { ...v, period: { ...v.period, end: instant("2026-06-20T00:00:00.000Z") } }
              : mode === "recognition" ? { ...v, recognition: { ...v.recognition, type: "income_recognition" } }
                : mode === "settlement" ? { ...v, settlement: { ...v.settlement, type: "expense_recognition" } } : v;
    noCommit(f);
    noCommit(attached({ retirement: false, cash: "0" }));
  });
  it("rejects wrong source family, unknown plan and changed duplicate attachment", () => {
    const f = fixture(), base = { kernel: f.kernel, request: request(), confirmed: premiums(), asOf: request().premiums.period.start, representations: [] };
    const wrong = attachMedicareBank({ ...base, confirmed: premiums().map(b => ({ ...b,
      householdExpenseSource: { ...b.householdExpenseSource!, original: { ...b.householdExpenseSource!.original, family: "education" } } })) });
    expect(wrong.kernel).toBe(f.kernel);
    const unknown = attachMedicareBank({ ...base, request: { ...base.request, inventories: [] } });
    expect(unknown.kernel).toBe(f.kernel);
    const good = attachMedicareBank(base);
    expect(attachMedicareBank({ ...base, kernel: good.kernel }).kernel).toBe(good.kernel);
    expect(attachMedicareBank({ ...base, kernel: good.kernel, confirmed: premiums().map(b => ({ ...b, settlementPriority: 9 })) }).netCashCoverage).toBe("incomplete");
  });
  it("preserves direct-person Medicare recognition/settlement without native metadata", () => {
    const f = personMedicareFixture(), a = attachMedicareBank(personMedicareInput(undefined, f.kernel));
    const result = runHouseholdKernel({ kernel: a.kernel, runContext: f.context, resultTier: "detail" });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]!.statements.expenses.equals(money("200"))).toBe(true);
    expect(Object.keys(result.state.d2PostedTransactions ?? {})).toHaveLength(0);
  });
});

describe("two members sharing BANK, replay and references", () => {
  it.each([false, true])("combines original retirement and Medicare journals with one exact balance (%s)", rmd => {
    const f = attached({ rmd }), result = execute(f);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    expect(result.state.accounts[ids.ira]!.cash.equals(money("500"))).toBe(true);
    expect(Object.keys(result.state.accounts)).toHaveLength(2);
    expect(result.periods[0]!.transactions.map(t => t.type)).toEqual([
      "expense_recognition", "expense_settlement", "expense_recognition", "expense_settlement", "retirement_cash_transfer"]);
    expect(result.periods[0]!.netWorth.equals(money("1200"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions!).map(p => p.registration.personId).sort()).toEqual([bob, bob, ids.person].sort());
    const summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    const replayed = replayHouseholdForecastWindow(restored, result.periods[0]!.period);
    expect(canonicalSerialize(replayed.state)).toBe(canonicalSerialize(result.state));
    requalifyRetirementDistributionHistory(result.state, f.context);
    requalifyD2SettlementReceiptHistory(result.state, f.context);
    const directory = mkdtempSync(join(tmpdir(), "pfm-stage-c-")), path = join(directory, "synthetic.json");
    try {
      for (const sources of [true, false]) {
        writeFileSync(path, JSON.stringify({ artifact, selected: result.periods[0]!.period, sources }));
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 10_000,
          env: { ...process.env, PFM_STAGE_C_PAYLOAD: path } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(sources ? { bank: "700", ira: "500" } : { rejected: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it.each(["revoked", "unrelated", "late", "amended", "race"])("rechecks %s BANK facts for both products", mode => {
    for (const retirement of [true, false]) {
      reset();
      const f = attached({ retirement, medicare: !retirement });
      control.bank = v => mode === "race" && control.bankReads > 1 ? undefined : { ...v, originals: v.originals.map(o =>
        mode === "revoked" ? { ...o, status: "revoked" } : mode === "late" ? { ...o, knownAt: instant("2027-01-01T00:00:00.000Z") }
          : mode === "amended" && o.kind === "account" ? { ...o, accountKind: "savings" }
            : mode === "unrelated" && o.kind === "membership" ? { ...o, personId: domainOther } : o) };
      noCommit(f);
    }
  });
  it.each([true, false])("rejects unrelated same-date BANK work for product retirement=%s", retirement => {
    const f = attached({ retirement, medicare: !retirement });
    const other: HouseholdKernelParticipant = { id: "unrelated-bank-work", version: "synthetic/v1", economicInputs: {},
      prepare: () => ({ id: "unrelated-bank-work", operations: [{ descriptor: { id: "unrelated-bank-work", domain: "cash_flow",
        operationClass: "cash_flow:unrelated", sequencingInstant: instant(retirement ? "2026-06-15T00:00:00.000Z" : "2026-06-01T00:00:00.000Z"),
        dependsOn: [], resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }], traceRefs: [] }, execute: candidate => ({ ...candidate, facts: {} }) }] }) };
    noCommit({ ...f, kernel: applyHouseholdExecutionOverlay(f.kernel, { participants: [...(f.kernel.executable.participants ?? []), other] }) });
  });
  it("rejects overlapping integrated SSA Medicare collection later in the same member month", () => {
    const f = attached({ retirement: false });
    const other: HouseholdKernelParticipant = { id: "synthetic-ssa", version: "synthetic/v1", economicInputs: {},
      prepare: () => ({ id: "synthetic-ssa", operations: [{ descriptor: {
        id: `ssa-medicare:${JSON.stringify(["d2-quoted-benefit/v1", ids.household, "synthetic-installment", bob])}`,
        domain: "cash_flow", operationClass: "cash_flow:ssa_medicare", sequencingInstant: instant("2026-06-10T00:00:00.000Z"),
        dependsOn: [], resourceAccesses: [], traceRefs: [] }, execute: candidate => ({ ...candidate, facts: {} }) }] }) };
    noCommit({ ...f, kernel: applyHouseholdExecutionOverlay(f.kernel, { participants: [...(f.kernel.executable.participants ?? []), other] }) });
  });
  it("keeps 1/12/24 actual Medicare source references, journals and reads bounded", () => {
    const sizes: number[] = [];
    for (const months of [1, 12, 24]) {
      reset();
      const f = fixture("10000", months);
      let kernel = f.kernel;
      for (let n = 0; n < months; n++) {
        const month = new Date(Date.UTC(2026, 5 + n, 1)).toISOString().slice(0, 7), r = request(month);
        const a = attachMedicareBank({ kernel, request: r, confirmed: premiums(month), asOf: r.premiums.period.start, representations: [] });
        expect(a.netCashCoverage, JSON.stringify(a.diagnostics)).toBe("complete");
        kernel = a.kernel;
      }
      const result = execute({ ...f, kernel });
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("incomplete");
      expect(result.periods).toHaveLength(months);
      expect(Object.values(result.state.d2PostedTransactions!)).toHaveLength(months * 2);
      expect(result.state.accounts[ids.bank]!.cash.equals(money((10000n - 200n * BigInt(months)).toString()))).toBe(true);
      const encoded = JSON.stringify(result.state.d2PostedTransactions);
      expect(encoded).not.toContain("household-expense-original/v1");
      expect(encoded).not.toContain("sourcePublication");
      sizes.push(encoded.length);
      expect(control.expenseReads).toBeLessThanOrEqual(months * 32);
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[1]! * 2.1);
  });
});
const domainOther = personFixture().context.scenarioId as unknown as typeof bob;
