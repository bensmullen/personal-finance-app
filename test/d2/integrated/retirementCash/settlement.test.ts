import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { domainId, idempotencyKey } from "../../../../src/identity/index.js";
import { createAuthoritativeState, cloneAuthoritativeState } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { money, Rate, rateConvention, USD } from "../../../../src/values/index.js";
import { attachRetirementCash, type RetirementCashInput } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { evaluateWithdrawalRmd } from "../../../../src/simulation/d2/retirement/withdrawalRmd/index.js";
import type { WithdrawalCash, WithdrawalRequest } from "../../../../src/simulation/d2/retirement/withdrawals/index.js";
import { applyHouseholdExecutionOverlay, exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow,
  runHouseholdKernel, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";
import { d, fixture, ids, input, rmdInput, source, uuid } from "./scenario.js";

const execute = (i = input(), f = fixture()) => runHouseholdKernel({ kernel: attachRetirementCash(f.kernel, i).kernel,
  runContext: f.context, resultTier: "detail" });
const request = (i: RetirementCashInput, patch: Partial<WithdrawalRequest>): RetirementCashInput => ({ ...i,
  withdrawals: { ...i.withdrawals, requests: [{ ...i.withdrawals.requests[0]!, ...patch }] } });
const cash = (i: RetirementCashInput, patch: Partial<WithdrawalCash>): RetirementCashInput => ({ ...i,
  withdrawals: { ...i.withdrawals, cash: [{ ...i.withdrawals.cash[0]!, ...patch }] } });
const reject = (i: RetirementCashInput, code?: string, f = fixture()) => {
  const before = canonicalSerialize({ state: f.state, i });
  const out = execute(i, f);
  expect(out.status).toBe("incomplete");
  expect(out.periods).toEqual([]);
  expect(out.state).toEqual(f.state);
  if (code) expect(out.diagnostics.map(x => x.code)).toContain(code);
  expect(canonicalSerialize({ state: f.state, i })).toBe(before);
};

describe("#149 source-qualified cash-only retirement execution", () => {
  it("posts exact opposing CASH legs and preserves household net worth and immutable inputs", () => {
    const f = fixture(), i = input(f), before = canonicalSerialize({ state: f.state, i });
    const attachment = attachRetirementCash(f.kernel, i), out = execute(i, f), p = out.periods[0]!;
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.state.accounts[ids.ira]!.cash.equals(money("500"))).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    expect([p.cash, p.netWorth].map(m => m.amount.toString())).toEqual(["1200", "1200"]);
    expect([p.statements.income, p.statements.expenses, p.statements.gains, p.statements.investingCashFlow].every(m => m.isZero())).toBe(true);
    expect(p.transactions).toHaveLength(1);
    const tx = p.transactions[0]!;
    expect(tx.id).toBe(accountingTransactionId("withdraw:one"));
    expect(tx.legs.map(l => [l.type, l.posting, l.amount.toJSON()])).toEqual([
      ["cash", "debit", money("500").toJSON()], ["cash", "credit", money("500").toJSON()],
    ]);
    expect(tx.legs.every(l => l.type === "cash" && l.cashFlowClass === "investing")).toBe(true);
    expect(tx.legs.map(l => l.type === "cash" ? l.accountId : null)).toEqual([ids.bank, ids.ira]);
    expect(out.state.identities.postedTransactionIds).toEqual([tx.id]);
    expect(out.state.identities.recognitionIds).toEqual([]);
    expect(out.state.identities.settlementIds).toEqual([]);
    expect(out.state.obligations).toEqual({});
    expect(out.outputCapabilities?.retirementCashTransfer?.status).toBe("complete");
    expect(out.outputCapabilities?.retirementTax?.status).toBe("incomplete");
    expect(out.outputCapabilities?.rmdSatisfaction?.status).toBe("incomplete");
    expect(out.diagnostics.map(x => x.code)).toContain("RETIREMENT_RMD_HISTORY_UNAVAILABLE");
    expect(attachment.rmdSatisfaction).toBe("not_applied");
    expect(attachment.conditionalRmd).toBeNull();
    expect(attachment.diagnostics.map(x => x.affectedOutput)).toEqual(["retirement_tax", "rmd_satisfaction"]);
    expect(out.status).toBe("incomplete");
    expect(canonicalSerialize({ state: f.state, i })).toBe(before);
    const summary = runHouseholdKernel({ kernel: attachment.kernel, runContext: f.context });
    expect(summary.periods).toHaveLength(1);
    expect(summary.state).toEqual(out.state);
    expect(summary.periods[0]!.statements).toEqual(p.statements);
    expect(summary.outputCapabilities).toEqual(out.outputCapabilities);
  });

  it("retains allocations only as conditional evidence and declines historical satisfaction without losing cash", () => {
    const raw = rmdInput(), binding = evaluateWithdrawalRmd(raw);
    expect(binding.bundle).not.toBeNull();
    const bundle = binding.bundle!;
    const i = { ...input(), withdrawals: raw.withdrawals, rmd: { input: raw, bundle } };
    const before = canonicalSerialize(i), attached = attachRetirementCash(fixture().kernel, i);
    expect(attached.conditionalRmd?.committed).toBe(false);
    expect(attached.conditionalRmd?.postable).toBe(false);
    expect(attached.conditionalRmd?.rmd.obligations[0]!.satisfied.isZero()).toBe(true);
    expect(attached.conditionalRmd?.bundle?.obligations[0]!.proposedOnTime.equals(money("500"))).toBe(true);
    expect(execute(i).periods).toHaveLength(1);
    const w = raw.withdrawals.requests[0]!;
    const historical = { ...i, rmd: { bundle, input: { ...raw, rmd: { ...raw.rmd, distributions: [{
      transactionId: "unverifiable-posted-id", at: w.effectiveAt, personId: w.personId, payerOwnerId: w.personId,
      accountId: w.sourceAccountId, kind: "ordinary" as const, authorized: true, funding: "posted_funded" as const,
      usageRegister: "verified_complete" as const, gross: money("500"), source: raw.rmd.requests[0]!.accounts[0]!.source,
      allocations: [{ id: "historical-allocation", obligationId: bundle.obligations[0]!.obligationId, satisfiesRmdYear: 2026, amount: money("500"), historical: true }],
    }] } } } };
    const declined = attachRetirementCash(fixture().kernel, historical), result = execute(historical);
    expect(declined.conditionalRmd).toBeNull();
    expect(declined.rmdSatisfaction).toBe("not_applied");
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    expect(result.outputCapabilities?.rmdSatisfaction?.status).toBe("incomplete");
    expect(canonicalSerialize(i)).toBe(before);
  });

  it("fails insufficient actual cash, stale balances and omitted reservations atomically", () => {
    const i = input(), f = fixture(), state = cloneAuthoritativeState(f.state);
    state.accounts[ids.ira]!.cash = money("400");
    reject(i, "RETIREMENT_STALE_BALANCE", fixture(1, state));
    reject({ ...i, confirmations: i.confirmations.map(q => ({ ...q, bankCashBefore: money("201") })) }, "RETIREMENT_STALE_BALANCE");
    const a = i.withdrawals.cash[0]!;
    const { liquidity: _liquidity, ...withoutLiquidity } = a;
    reject({ ...i, withdrawals: { ...i.withdrawals, cash: [withoutLiquidity] } }, "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    const reserved = cash(i, { liquidity: { ...a.liquidity!, available: money("900") } });
    reject(reserved, "RETIREMENT_LIQUIDITY_INVALID");
    const funded = { ...reserved, confirmations: reserved.confirmations.map(q => ({ ...q, reservations: [
      { id: "external-reservation", amount: money("100"), source: source("external-reservation") },
    ] })) };
    expect(execute(funded).periods).toHaveLength(1);
    reject({ ...funded, confirmations: funded.confirmations.map(q => ({ ...q, reservations: q.reservations.map(r => ({ ...r,
      source: { ...r.source, projectionStatus: "unavailable" as const } })) })) }, "RETIREMENT_SOURCE_UNAVAILABLE");
    reject(request(i, { grossAmount: money("1000.01") }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
  });

  it.each(["source_kind", "bank_kind", "source_owner", "bank_owner", "missing_bank"])("rejects authoritative %s", kind => {
    const f = fixture(), state = cloneAuthoritativeState(f.state);
    if (kind === "source_kind") state.accounts[ids.ira] = { ...state.accounts[ids.ira]!, kind: "brokerage" };
    if (kind === "bank_kind") state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, kind: "retirement" };
    if (kind === "source_owner") state.accounts[ids.ira] = { ...state.accounts[ids.ira]!, ownerId: ids.other };
    if (kind === "bank_owner") state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, ownerId: ids.other };
    if (kind === "missing_bank") delete state.accounts[ids.bank];
    reject(input(), "RETIREMENT_RESOURCE_INVALID", fixture(1, state));
  });

  it("declines unknown/nonzero withholding, changed source version and nonfuture chronology violations", () => {
    const i = input(), w = i.withdrawals.requests[0]!, withholding = w.withholding!;
    reject(request(i, { withholding: { ...withholding, completeness: "unknown" } }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject(request(i, { withholding: { ...withholding, instructions: [] } }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject(request(i, { withholding: { ...withholding, instructions: withholding.instructions.map(x => ({ ...x, amount: money("1") })) } }), "RETIREMENT_WITHHOLDING_UNSUPPORTED");
    const a = i.withdrawals.cash[0]!;
    for (const projectionStatus of ["explicit_projected", "unavailable"] as const)
      reject(cash(i, { eligibilitySource: { ...a.eligibilitySource, projectionStatus } }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject(cash(i, { eligibilitySource: { ...a.eligibilitySource, publishedAt: d("2026-06-16") } }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject({ ...i, withdrawals: { ...i.withdrawals, knownAt: d("2026-06-29") } }, "RETIREMENT_SOURCE_UNAVAILABLE");
    reject({ ...i, confirmations: i.confirmations.map(q => ({ ...q, source: { ...q.source, asOf: d("2026-06-16") } })) }, "RETIREMENT_SOURCE_UNAVAILABLE");
    reject({ ...i, confirmations: i.confirmations.map(q => ({ ...q, bankSource: { ...q.source, version: "changed" } })) }, "RETIREMENT_SOURCE_CHANGED");
    reject(request(i, { bank: { ...w.bank, householdId: uuid(999) } }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject(request(i, { bank: { ...w.bank, id: uuid(999) } }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject({ ...i, confirmations: i.confirmations.map(q => ({ ...q, period: { ...q.period, end: instant("2026-08-01T00:00:00.000Z") } })) }, "RETIREMENT_SOURCE_UNAVAILABLE");
  });

  it("gates unsupported account character, transaction kinds and unverified workplace permission", () => {
    const i = input();
    for (const taxBucket of ["roth", "aftertax", "mixed"] as const)
      reject(request(cash(i, { taxBucket }), { taxBucket }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject(cash(i, { beneficiaryId: ids.other }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    for (const kind of ["in_kind", "rollover", "conversion", "qcd", "inherited"] as const)
      reject(request(i, { kind }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject(cash(i, { unsupportedRules: ["unsupported statutory exception"] }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject(cash(i, { instrumentFamily: "workplace_plan" }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    for (const instrumentFamily of ["traditional_ira", "sep_ira", "simple_ira", "workplace_plan"] as const) {
      const admitted = cash(i, { instrumentFamily, ...(instrumentFamily === "workplace_plan" ? {
        planTerms: { planId: "employer-plan", permission: "ordinary_cash_distribution", source: source("employer-plan") },
      } : {}) });
      expect(execute(admitted).periods).toHaveLength(1);
    }
    const a = i.withdrawals.cash[0]!;
    reject(cash(i, { liquidity: { ...a.liquidity!, contention: "unknown" } }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
  });

  it("requires unused authorizations and unchanged receipts; identical reattachment and posted replay do nothing", () => {
    const f = fixture(), i = input(f), attached = attachRetirementCash(f.kernel, i);
    expect(attachRetirementCash(attached.kernel, i).kernel).toBe(attached.kernel);
    const changed = { ...i, confirmations: i.confirmations.map(q => ({ ...q, source: { ...q.source, version: "v2" } })) };
    expect(() => attachRetirementCash(attached.kernel, changed)).toThrow();
    const first = execute(i, f), replay = execute(i, fixture(1, first.state));
    expect(replay.periods).toHaveLength(1);
    expect(replay.periods[0]!.transactions).toEqual([]);
    expect(replay.state).toEqual(first.state);
    reject(changed, "RETIREMENT_STALE_OR_DUPLICATE", fixture(1, first.state));
    const w = i.withdrawals.requests[0]!;
    const changedAmount = request(i, { grossAmount: money("400"), authorization: { ...w.authorization!, grossAmount: money("400") } });
    reject(changedAmount, "RETIREMENT_STALE_OR_DUPLICATE", fixture(1, first.state));
    const changedAuth = request(i, { authorization: { ...w.authorization!, id: "new-authorization", source: source("new-authorization") } });
    reject(changedAuth, "RETIREMENT_STALE_OR_DUPLICATE", fixture(1, first.state));
    reject({ ...i, withdrawals: { ...i.withdrawals, usage: { ...i.withdrawals.usage, authorizationIds: [w.authorization!.id] } } }, "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject({ ...i, withdrawals: { ...i.withdrawals, usage: { ...i.withdrawals.usage, operationIds: [w.operationId] } } }, "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    reject({ ...i, withdrawals: { ...i.withdrawals, usage: { ...i.withdrawals.usage, withdrawalIds: [w.withdrawalId] } } }, "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    const state = createAuthoritativeState({ ...f.state, identities: { ...f.state.identities,
      externalIdempotencyKeys: [idempotencyKey("d2:authorization", w.authorization!.id)] } });
    reject(i, "RETIREMENT_STALE_OR_DUPLICATE", fixture(1, state));
  });

  it("rejects unordered cash claims in either input order; a sourced order produces the same result", () => {
    const first = input(), second = input(fixture(), "two");
    const pair: RetirementCashInput = { ...first, withdrawals: { ...first.withdrawals,
      requests: [...first.withdrawals.requests, ...second.withdrawals.requests] },
      confirmations: [...first.confirmations, ...second.confirmations] };
    reject(pair, "HOUSEHOLD_CONTENTION_UNRESOLVED");
    const reverse = (i: RetirementCashInput): RetirementCashInput => ({ ...i, withdrawals: { ...i.withdrawals,
      requests: [...i.withdrawals.requests].reverse() }, confirmations: [...i.confirmations].reverse() });
    reject(reverse(pair), "HOUSEHOLD_CONTENTION_UNRESOLVED");
    const ordered = { ...pair, confirmations: pair.confirmations.map((q, n) => n === 0 ? q : { ...q,
      sourceCashBefore: money("500"), bankCashBefore: money("700"), ordering: { ...q.ordering, after: ["withdraw:one"] } }) };
    const out = execute(ordered), reversed = execute(reverse(ordered));
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.state.accounts[ids.ira]!.cash.isZero()).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("1200"))).toBe(true);
    expect(reversed.state).toEqual(out.state);
    expect(reversed.periods[0]!.transactions).toEqual(out.periods[0]!.transactions);
    const attached = attachRetirementCash(fixture().kernel, ordered);
    expect(attachRetirementCash(attached.kernel, reverse(ordered)).kernel).toBe(attached.kernel);
    const replay = execute(ordered, fixture(1, out.state));
    expect(replay.state).toEqual(out.state);
    expect(replay.periods[0]!.transactions).toEqual([]);
  });

  it("rolls back an earlier successful withdrawal when a later event has stale bank cash", () => {
    const first = input(), second = input(fixture(), "two");
    const i = { ...first, withdrawals: { ...first.withdrawals, requests: [...first.withdrawals.requests, ...second.withdrawals.requests] },
      confirmations: [...first.confirmations, { ...second.confirmations[0]!, sourceCashBefore: money("500"), bankCashBefore: money("701"),
        ordering: { ...second.confirmations[0]!.ordering, after: ["withdraw:one"] } }] };
    reject(i, "RETIREMENT_STALE_BALANCE");
  });

  it("rejects same-instant BANK work from another participant without an authenticated shared order", () => {
    const f = fixture(), i = input(f), attached = attachRetirementCash(f.kernel, i);
    const contender: HouseholdKernelParticipant = { id: "other-bank-work", version: "1", economicInputs: {},
      prepare: () => ({ id: "other-bank-work", operations: [{ descriptor: { id: "other-bank-work", domain: "cash_flow",
        operationClass: "cash_income_settlement", sequencingInstant: instant("2026-06-15T00:00:00.000Z"), dependsOn: [],
        resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "produce" }], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: {} }) }] }) };
    for (const participants of [[...attached.kernel.executable.participants!, contender], [contender, ...attached.kernel.executable.participants!]]) {
      const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(attached.kernel, { participants }), runContext: f.context, resultTier: "detail" });
      expect(out.periods).toEqual([]);
      expect(out.state).toEqual(f.state);
      expect(out.diagnostics.map(x => x.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
    }
  });

  it("rejects built-in same-day BANK deposits before cash can post", () => {
    // VS2 requires a real, existing expense-payable liability even with no
    // expenses; omitting it fails VS2 input validation before contention runs.
    const payable = domainId("liability", uuid(40));
    const opening = createAuthoritativeState({ ...fixture().state, liabilities: {
      [payable]: { id: payable, balance: money("0") },
    } });
    const f = fixture(1, opening), i = input(f), attached = attachRetirementCash(f.kernel, i);
    // A real VS2 income stream exposes its CASH resource to prepare(), rather
    // than relying on participant observer order to establish contention.
    const payday = instant("2026-06-15T00:00:00.000Z");
    const kernel = applyHouseholdExecutionOverlay(attached.kernel, { cashFlowInput: {
      householdId: ids.household, ownerId: ids.person, cashAccountId: ids.bank,
      expensePayableLiabilityId: domainId("liability", uuid(40)), baseCurrency: USD, expenses: [], events: [],
      incomes: [{ id: domainId("income", uuid(41)), ownerId: ids.person, baseMonthlyAmount: money("100"), start: payday,
        recurrence: { kind: "utc_monthly", anchor: payday, invalidDayPolicy: "skip" }, depositAccountId: ids.bank,
        growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: payday,
        primitiveIds: { growth: domainId("primitive-instance", uuid(42)), recurrence: domainId("primitive-instance", uuid(43)) } }],
    } });
    const out = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(out.periods).toEqual([]);
    expect(out.state).toEqual(f.state);
    expect(out.diagnostics.map(x => x.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
  });

  it("isolates two people and calendar years without sharing cash or consuming annual RMD capacity", () => {
    const bank2 = domainId("account", uuid(20)), ira2 = domainId("account", uuid(21)), f = fixture();
    const state = createAuthoritativeState({ ...f.state, accounts: { ...f.state.accounts,
      [bank2]: { id: bank2, ownerId: ids.other, kind: "checking", cash: money("200") },
      [ira2]: { id: ira2, ownerId: ids.other, kind: "retirement", cash: money("1000") } } });
    const f2 = fixture(1, state), a = input(f2), b = input(f2, "other-person", ids.other, ira2, bank2);
    const both = { ...a, withdrawals: { ...a.withdrawals, cash: [...a.withdrawals.cash, ...b.withdrawals.cash], requests: [...a.withdrawals.requests, ...b.withdrawals.requests] },
      members: [...a.members, ...b.members], confirmations: [...a.confirmations, ...b.confirmations] };
    const out = execute(both, f2);
    expect(out.periods).toHaveLength(1);
    expect([ids.bank, bank2].every(id => out.state.accounts[id]!.cash.equals(money("700")))).toBe(true);
    const next = fixture(1, undefined, "2027-06"), later = input(next, "next-year");
    expect(execute(later, next).periods).toHaveLength(1);
    reject({ ...later, confirmations: a.confirmations }, "RETIREMENT_IDENTITY_INVALID", next);
    reject(request(a, { personId: ids.other }), "RETIREMENT_AUTHORIZATION_INCOMPLETE");
    expect(out.outputCapabilities?.rmdSatisfaction?.status).toBe("incomplete");
  });

  it("restores 13-month portable checkpoints in a fresh process without duplicate posting", () => {
    const f = fixture(13), kernel = attachRetirementCash(f.kernel, input(f)).kernel;
    const summary = runHouseholdKernel({ kernel, runContext: f.context });
    const detail = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(13);
    expect(summary.state).toEqual(detail.state);
    expect(summary.state.identities.postedTransactionIds).toEqual([accountingTransactionId("withdraw:one")]);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(exportHouseholdReplayCheckpoints(restored)).toEqual(exportHouseholdReplayCheckpoints(summary));
    const selected = detail.periods.at(-1)!.period, replay = replayHouseholdForecastWindow(restored, selected);
    expect(replay.state).toEqual(detail.state);
    expect(replay.periods).toEqual(detail.periods.slice(-1));
    expect(replay.periods[0]!.transactions).toEqual([]);
    const directory = mkdtempSync(join(tmpdir(), "pfm-retirement-cash-"));
    try {
      const payload = join(directory, "payload.json");
      writeFileSync(payload, JSON.stringify({ artifact, selected }), "utf8");
      const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
        env: { ...process.env, PFM_RETIREMENT_CASH_TEST_PAYLOAD: payload }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      });
      expect(worker.status, worker.stderr).toBe(0);
      expect(JSON.parse(worker.stdout)).toEqual({ state: canonicalSerialize(replay.state), periods: canonicalSerialize(replay.periods) });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("keeps the original D2 preparation catalog conditional", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    expect(catalog.cases).toHaveLength(55);
    expect(catalog.cases.every(c => c.expected.integratedRuntimeEvidence === false)).toBe(true);
  });
});
