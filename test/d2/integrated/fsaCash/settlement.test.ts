import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, cloneAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel, replayHouseholdForecastWindow, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { attachFsaCash, createFsaCashParticipant, FsaCashIncomplete, registerFsaCashSourceProvider, type FsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/index.js";
import { originalRegistration, originalTransaction, qualifyFsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/source.js";
import { evaluateFsa, fsaScopeId, type FsaReceipt } from "../../../../src/simulation/d2/health/fsa/index.js";
import { bindFsaYearChain, fsaYearChainFingerprint, type FsaYearChainRequest } from "../../../../src/simulation/d2/health/fsa/yearChain/index.js";
import { at, evidence, fixture, ids, input, provenance, source } from "./scenario.js";

// The real adapter re-evaluates these raw fixed synthetic sources. No shared receipt mock authority.
const store = new Map<string, FsaCashSource>();
registerFsaCashSourceProvider({ lookup: id => store.get(id) });
beforeEach(() => store.clear());
const admit = (s: FsaCashSource) => { store.set(s.sourceId, s); return s; };
const execute = (s = admit(source()), f = fixture()) => runHouseholdKernel({ kernel: attachFsaCash(f.kernel, input(s)), runContext: f.context, resultTier: "detail" });
const receipt = (s: FsaCashSource, patch: Partial<FsaReceipt>): FsaCashSource => {
  const request = { ...s.request, receipts: [{ ...s.request.receipts[0]!, ...patch }] };
  return { ...s, request, provenance: provenance(request) };
};
const reject = (s: FsaCashSource, f = fixture()) => {
  admit(s); const before = canonicalSerialize(f.state), out = execute(s, f);
  expect(out.periods.length).toBeLessThan(2);
  expect(out.status).toBe("incomplete");
  expect(out.diagnostics.some(d => d.severity === "error")).toBe(true);
  expect(canonicalSerialize(f.state)).toBe(before);
  // A rejected reimbursement never creates a settled receipt, even when an
  // independently valid medical payment was already committed in an earlier
  // successful period. A failed *period* rolls back; prior periods do not.
  expect(Object.keys(out.state.d2SettlementReceipts ?? {}).sort())
    .toEqual(Object.keys(f.state.d2SettlementReceipts ?? {}).sort());
  const succeeded = out.periods.flatMap(p => p.transactions);
  expect(succeeded.every(tx => tx.type === "fsa_medical_expense_payment")).toBe(true);
  expect(Object.keys(out.state.d2PostedTransactions ?? {}).sort()).toEqual(
    [...new Set([...Object.keys(f.state.d2PostedTransactions ?? {}), ...succeeded.map(tx => tx.id)])].sort());
  for (const tx of succeeded) {
    expect(out.state.d2PostedTransactions?.[tx.id]?.transaction).toEqual(tx);
    expect(out.state.d2PostedTransactions?.[tx.id]?.registration.role).toBe("original");
  }
  const expectedBank = succeeded.reduce((cash, tx) => {
    const leg = tx.legs.find(l => l.type === "cash" && l.accountId === ids.bank);
    expect(leg?.posting).toBe("credit");
    return cash.minus(leg!.amount);
  }, f.state.accounts[ids.bank]!.cash);
  expect(out.state.accounts[ids.bank]!.cash.equals(expectedBank)).toBe(true);
  return out;
};

describe("#202 independently source-qualified FSA physical cash", () => {
  it.each(["1000", "500"])("pays expense in January and actual $%s deposit in February without earned income", amount => {
    const s = admit(source("one", amount)), f = fixture(), before = canonicalSerialize({ s, state: f.state });
    const out = execute(s, f);
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(2);
    expect(out.periods[0]!.cash.equals(money("500"))).toBe(true);
    expect(out.periods[1]!.cash.equals(money(amount).plus(money("500")))).toBe(true);
    expect(out.periods.map(p => p.transactions.length)).toEqual([1, 1]);
    expect(out.periods.every(p => p.statements.income.isZero())).toBe(true);
    expect(out.periods[0]!.statements.expenses.equals(money("1000"))).toBe(true);
    expect(out.periods[1]!.statements.expenses.equals(money(amount).negated())).toBe(true);
    const archive = Object.values(out.state.d2PostedTransactions!);
    expect(archive).toHaveLength(2);
    expect(archive.find(p => p.registration.role === "original")!.transaction.date).toBe(s.original.paidAt);
    expect(out.state.identities.postedTransactionIds).toHaveLength(2);
    expect(out.state.positions).toEqual({}); expect(out.state.obligations).toEqual({});
    expect(out.state.identities.settlementIds).toHaveLength(1);
    expect(evaluateFsa(s.request).entitlement!.employeePayrollToDate.isZero()).toBe(true);
    expect(out.outputCapabilities?.fsaPayrollTax?.status).toBe("incomplete");
    if (amount === "1000") expect(out.outputCapabilities?.fsaCashSettlement?.status).toBe("complete");
    if (amount === "500") {
      expect(out.outputCapabilities?.fsaCashSettlement?.status).toBe("incomplete");
      expect(out.diagnostics.some(d => d.code === "entitlement_installment_port_required")).toBe(true);
      const result = applyD2SettlementAtomically(out.state, qualifyFsaCashSource(s, f.context), f.context);
      expect(result).toMatchObject({ status: "already_committed", remainingReimbursement: {
        reason: "entitlement_installment_port_required", unreimbursedExpense: money("500") } });
    }
    expect(canonicalSerialize({ s, state: f.state })).toBe(before);
  });

  it("does not label an unpaid future plan deposit as complete after medical cash is spent", () => {
    const s = admit(source()), out = execute(s, fixture(1));
    expect(out.periods).toHaveLength(1);
    expect(out.outputCapabilities?.fsaCashSettlement?.status).toBe("incomplete");
    expect(out.diagnostics.some(d => d.code === "FSA_REIMBURSEMENT_PENDING")).toBe(true);
    expect(out.state.d2SettlementReceipts).toBeUndefined();
  });
  it("commits the earlier original without requiring future reimbursement approval", () => {
    const base = source(), s = admit({ ...base, deposit: { ...base.deposit, status: "pending" } });
    const jan = execute(s, fixture(1));
    expect(jan.periods).toHaveLength(1);
    expect(jan.state.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
    expect(Object.values(jan.state.d2PostedTransactions!)[0]!.registration.role).toBe("original");
    expect(jan.state.d2SettlementReceipts).toBeUndefined();
  });

  it.each(["0", "1000.01", "2000.01"])("rejects illegal approval %s", amount => { reject(source("excess", amount)); });
  it.each(["declined", "pending"] as const)("documentary settled flag cannot authorize a %s BANK deposit", status => {
    const s = source(); reject({ ...s, deposit: { ...s.deposit, status } });
  });
  it("requires actual paid originals and independently confirmed deposits", () => {
    const s = source(); reject(receipt(s, { payment: { status: "unpaid" } }));
    reject({ ...s, deposit: { ...s.deposit, paymentApprovalId: "" } });
    reject({ ...s, original: { ...s.original, approvalId: "" } });
    reject(receipt(s, { reimbursement: { status: "not_adjudicated" } }));
  });
  it.each(["payeeId", "planId", "planYearId", "memberId"] as const)("rejects changed %s", field => {
    const s = source(); reject(receipt(s, { [field]: "changed" }));
  });
  it("rejects wrong BANK/owner and a mismatched independently sourced amount", () => {
    const s = source();
    reject({ ...s, deposit: { ...s.deposit, ownerId: ids.other } });
    reject({ ...s, deposit: { ...s.deposit, bankAccountId: ids.other as unknown as typeof ids.bank } });
    reject({ ...s, deposit: { ...s.deposit, amount: money("999") } });
    const f = fixture(), state = cloneAuthoritativeState(f.state);
    state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, ownerId: ids.other };
    reject(s, fixture(2, state));
  });
  it("does not fund the original with its later reimbursement", () => {
    const s = source(), state = cloneAuthoritativeState(fixture().state);
    state.accounts[ids.bank]!.cash = money("500");
    const out = reject({ ...s, original: { ...s.original, bankCashBefore: money("500") } }, fixture(2, state));
    expect(out.periods).toEqual([]); expect(out.state).toEqual(state);
  });
  it("requires exact source-owner timestamps rather than civil dates or publication text", () => {
    const s = source();
    for (const knownAt of ["2025-01-02", at("2026-03-01")] as const) {
      const bad = { ...s, provenance: s.provenance.map((p, n) => n ? p : { ...p, knownAt: knownAt as typeof p.knownAt }) };
      reject(bad);
    }
    reject({ ...s, provenance: s.provenance.slice(1) });
    reject({ ...s, provenance: [...s.provenance, s.provenance[0]!] });
    const missing = { ...s, provenance: s.provenance.map(p => ({ ...p, publishedAt: undefined })) } as unknown as FsaCashSource;
    reject(missing);
  });
  it("refuses a BANK deposit reported posted before its actual settlement", () => {
    const s = source();
    reject({ ...s, deposit: { ...s.deposit,
      publishedAt: at("2025-01-01"), knownAt: at("2025-01-02") } });
    reject({ ...s, deposit: { ...s.deposit,
      publishedAt: at("2026-02-15"), knownAt: at("2026-02-14") } });
  });
  it("declines future legal eligibility and sources beyond the run cutoff", () => {
    const s = source(), f = fixture();
    reject(s, { ...f, context: { ...f.context, dataCutoff: at("2024-12-31") } });
    const request = { ...s.request, plan: { ...s.request.plan, law: { ...s.request.plan.law!,
      evidence: { ...s.request.plan.law!.evidence, projectionStatus: "explicit_projected" as const } } } };
    reject({ ...s, request, provenance: provenance(request) });
  });
  it("does not requalify a legacy posted ID without an actual archived original", () => {
    const s = admit(source()), state = cloneAuthoritativeState(fixture().state);
    applyAccountingTransactionAtomically(state, originalTransaction(s));
    const out = reject(s, fixture(1, state, "2026-02"));
    expect(out.diagnostics.map(d => d.code)).toContain("original_journal_unavailable");
    expect(out.state).toEqual(state);
  });
  it("accepts a canonical original already committed at its payment date", () => {
    const s = admit(source()), state = cloneAuthoritativeState(fixture().state);
    applyAccountingTransactionAtomically(state, originalTransaction(s), originalRegistration(s));
    const out = execute(s, fixture(1, state, "2026-02"));
    expect(out.periods).toHaveLength(1); expect(out.periods[0]!.transactions).toHaveLength(1);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("1500"))).toBe(true);
  });
  it("replays committed history once and refuses changed source or a second installment", () => {
    const s = admit(source("one", "500")), first = execute(s);
    const repeated = execute(s, fixture(2, first.state));
    expect(repeated.periods).toHaveLength(2);
    expect(repeated.periods.every(p => p.transactions.length === 0)).toBe(true);
    expect(repeated.state).toEqual(first.state);
    const changed = { ...s, version: "amended" }; admit(changed);
    const attached = input(s);
    expect(() => createFsaCashParticipant(attached)).toThrow(FsaCashIncomplete);
    admit(s);
    const second = source("installment", "500");
    const alias = { ...second, request: s.request, original: s.original };
    reject(alias, fixture(2, first.state));
  });
  it("refuses a receipt tampered after qualification despite a copied source fingerprint", () => {
    const s = admit(source()), f = fixture(), state = cloneAuthoritativeState(f.state);
    applyAccountingTransactionAtomically(state, originalTransaction(s), originalRegistration(s));
    const r = qualifyFsaCashSource(s, f.context), before = canonicalSerialize(state);
    expect(() => applyD2SettlementAtomically(state, { ...r, amount: money("999") }, f.context)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("requires canonical receipts for historical settled claims and complete source usage", () => {
    const s = source(), older = source("older", "500", "2026-01-02", "2026-01-03");
    const request = { ...s.request, receipts: [older.request.receipts[0]!, s.request.receipts[0]!] };
    const out = reject({ ...s, request, provenance: provenance(request) });
    expect(out.diagnostics.map(d => d.code)).toContain("posted_journal_unavailable");
  });
  it("does not post payroll intents or give a second wage/tax benefit; conflicting payroll fails eligibility", () => {
    const s = source(), p = s.request.plan;
    const payroll = { householdId: p.householdId, personId: p.personId, employerId: p.employerId, planId: p.planId, planYearId: p.planYearId,
      contributionId: "payroll", effectiveAt: civilDate("2026-01-15"), sourceAccountId: ids.bank, contributionSource: "employee_salary_reduction" as const,
      amount: money("50"), status: "pending" as const, postingRef: null, evidence: evidence("health_fsa_payroll", "payroll") };
    const request = { ...s.request, payroll: [payroll] };
    const good = admit({ ...s, request, provenance: provenance(request) }), out = execute(good);
    expect(out.periods).toHaveLength(2); expect(out.state.identities.postedTransactionIds).toHaveLength(2);
    expect(out.periods.every(p => p.statements.income.isZero())).toBe(true);
    const conflicting = { ...request, payroll: [payroll, { ...payroll, amount: money("51") }] };
    reject({ ...s, request: conflicting, provenance: provenance(conflicting) });
  });
  it("uses the unchanged owner for prior-year grace, runout and unsupported carryover", () => {
    const base = source("grace", "1000", "2027-02-10", "2027-03-10");
    const request = { ...base.request, plan: { ...base.request.plan,
      yearEnd: { kind: "grace_period" as const, incurredEndExclusive: civilDate("2027-03-16") } } };
    const s = admit({ ...base, request, provenance: provenance(request) });
    expect(execute(s, fixture(2, undefined, "2027-02")).periods).toHaveLength(2);
    const outside = { ...request, plan: { ...request.plan, yearEnd: { kind: "forfeiture" as const } } };
    reject({ ...s, request: outside, provenance: provenance(outside) }, fixture(2, undefined, "2027-02"));
    const late = receipt(s, { submittedAt: civilDate("2027-04-01") });
    reject(late, fixture(2, undefined, "2027-02"));
    const forged = { ...s.request, priorCarryover: {} } as unknown as typeof s.request;
    reject({ ...s, request: forged }, fixture(2, undefined, "2027-02"));
  });
  it("delegates year-chain eligibility while applying zero carryover", () => {
    const base = source(), prior = { ...base.request, receipts: [], evaluatedAt: civilDate("2027-01-01"), historyThrough: civilDate("2027-01-01") };
    const plan = { ...prior.plan, planYearId: "2027", period: { start: civilDate("2027-01-01"), endExclusive: civilDate("2028-01-01") },
      coverage: { start: civilDate("2027-01-01"), endExclusive: civilDate("2028-01-01") }, submitEndExclusive: civilDate("2028-04-01") };
    const scope = fsaScopeId(plan);
    const successor = { ...prior, plan: { ...plan, planEvidence: evidence("health_fsa_plan", scope),
      law: { ...plan.law!, planYearId: "2027", evidence: evidence("health_fsa_law", "2027") },
      members: [{ memberId: ids.person, coverage: plan.coverage, evidence: evidence("health_fsa_member", [scope, ids.person].map(encodeURIComponent).join("/")) }] },
      historyEvidence: evidence("health_fsa_complete_history", scope) };
    const chain: FsaYearChainRequest = { prior, successor, transferId: "chain", carryoverLaw: null, externalCloseout: null,
      competingTransfers: [], expectedInputs: { prior: fsaYearChainFingerprint(prior), successor: fsaYearChainFingerprint(successor) },
      calendar: { prior: evidence("health_fsa_calendar", fsaScopeId(prior.plan)), successor: evidence("health_fsa_calendar", scope) } };
    expect(bindFsaYearChain(chain).appliedCarryover.isZero()).toBe(true);
    const s = admit({ ...base, request: prior, yearChain: chain, provenance: provenance({ prior, chain }) });
    expect(() => qualifyFsaCashSource(s, fixture().context)).toThrow(FsaCashIncomplete);
    expect(bindFsaYearChain(chain).appliedCarryover.isZero()).toBe(true);
  });

  it("rejects unordered same-time BANK work across members and admits an actual signed sequence", () => {
    const a0 = source("a"), b0 = source("b"), member = ids.other;
    const plan = { ...a0.request.plan, members: [...a0.request.plan.members, { memberId: member,
      coverage: a0.request.plan.coverage, evidence: evidence("health_fsa_member", [fsaScopeId(a0.request.plan), member].map(encodeURIComponent).join("/")) }] };
    const request = { ...a0.request, plan, receipts: [a0.request.receipts[0]!, { ...b0.request.receipts[0]!, memberId: member }] };
    const a = { ...a0, request, provenance: provenance(request), original: { ...a0.original, bankCashBefore: money("2500") } };
    const b = { ...b0, request, provenance: provenance(request), original: { ...b0.original, memberId: member } };
    const state = cloneAuthoritativeState(fixture().state); state.accounts[ids.bank]!.cash = money("2500");
    admit(a); admit(b); const f = fixture(2, state);
    const unordered = runHouseholdKernel({ kernel: attachFsaCash(f.kernel, input(a, b)), runContext: f.context, resultTier: "detail" });
    expect(unordered.periods).toEqual([]); expect(unordered.state).toEqual(state);
    const signed = (s: FsaCashSource, position: number, cash: string): FsaCashSource => ({ ...s,
      original: { ...s.original, executionOrder: { sequenceId: "medical-bank-signed", position } },
      deposit: { ...s.deposit, bankCashBefore: money(cash), executionOrder: { sequenceId: "plan-bank-signed", position } } });
    const aa = admit(signed(a, 1, "500")), bb = admit(signed(b, 2, "1500"));
    const ordered = runHouseholdKernel({ kernel: attachFsaCash(f.kernel, input(bb, aa)), runContext: f.context, resultTier: "detail" });
    expect(ordered.periods, JSON.stringify(ordered.diagnostics)).toHaveLength(2);
    expect(ordered.state.accounts[ids.bank]!.cash.equals(money("2500"))).toBe(true);
    expect(ordered.state.identities.postedTransactionIds).toHaveLength(4);
  });
  it.each(["1000", "500"])("admits signed same-instant expense then $%s deposit with independent original funding", amount => {
    const base = source("same", amount, "2026-01-10", "2026-01-10");
    const s = admit({ ...base,
      original: { ...base.original, executionOrder: { sequenceId: "actual-bank-sequence", position: 1 } },
      deposit: { ...base.deposit, executionOrder: { sequenceId: "actual-bank-sequence", position: 2 } } });
    const out = execute(s, fixture(1));
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    // Period reporting has the established (date, transaction ID) canonical sort;
    // actual source-signed execution order is proven by writer archive insertion.
    expect(out.periods[0]!.transactions.map(tx => tx.type)).toEqual(["fsa_expense_reimbursement", "fsa_medical_expense_payment"]);
    // Canonical archive enumeration is sorted by ID rather than posting time.
    // Both exact signed postings must exist; settlement BANK opening can match
    // only after the funded original has actually executed.
    expect(out.state.d2PostedTransactions?.[originalTransaction(s).id]?.registration.role).toBe("original");
    expect(out.state.d2PostedTransactions?.[qualifyFsaCashSource(s, fixture(1).context).paymentTransaction.id]?.registration.role).toBe("settlement");
    expect(out.state.accounts[ids.bank]!.cash.equals(money("500").plus(money(amount)))).toBe(true);
    expect(Object.values(out.state.d2PostedTransactions ?? {})).toHaveLength(2);
    const state = cloneAuthoritativeState(fixture().state); state.accounts[ids.bank]!.cash = money("500");
    const unfunded = { ...s, original: { ...s.original, bankCashBefore: money("500") } };
    expect(reject(unfunded, fixture(1, state)).periods).toEqual([]);
  });
  it("rejects a competing payroll BANK event regardless of participant iteration order", () => {
    const base = source("same", "1000", "2026-01-10", "2026-01-10");
    const s = admit({ ...base,
      original: { ...base.original, executionOrder: { sequenceId: "actual-bank-sequence", position: 1 } },
      deposit: { ...base.deposit, executionOrder: { sequenceId: "actual-bank-sequence", position: 2 } } });
    // Establish that this source can execute by itself; only the competing participant is unsupported.
    expect(execute(s, fixture(1)).periods).toHaveLength(1);
    const payroll: HouseholdKernelParticipant = { id: "synthetic-payroll", version: "v1", economicInputs: {}, prepare: () => ({ id: "synthetic-payroll", operations: [{
      descriptor: { id: "paycheck", domain: "cash_flow", sequencingInstant: s.original.paidAt, dependsOn: [], traceRefs: [],
        resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "produce" }] }, execute: candidate => ({ ...candidate, facts: {} }),
    }] }) };
    for (const participants of [[payroll, createFsaCashParticipant(input(s))], [createFsaCashParticipant(input(s)), payroll]]) {
      const f = fixture(1), out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(f.kernel, { participants }), runContext: f.context, resultTier: "detail" });
      expect(out.periods).toEqual([]); expect(out.state).toEqual(f.state);
    }
  });
  it("rolls back original, archive, funding and identities when a later operation in the same period fails", () => {
    const s = admit(source("one", "1000", "2026-01-10", "2026-01-20")), f = fixture(1);
    const failure: HouseholdKernelParticipant = { id: "late-failure", version: "v1", economicInputs: {}, prepare: () => ({ id: "late-failure", operations: [{
      descriptor: { id: "fail", domain: "synthetic", sequencingInstant: at("2026-01-25"), dependsOn: [], resourceAccesses: [], traceRefs: [] },
      execute: () => { throw new FsaCashIncomplete("source_unavailable", "Late synthetic failure"); },
    }] }) };
    const kernel = applyHouseholdExecutionOverlay(attachFsaCash(f.kernel, input(s)), { participants: [createFsaCashParticipant(input(s)), failure] });
    const out = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(out.periods).toEqual([]); expect(out.state).toEqual(f.state);
    expect(out.state.identities.postedTransactionIds).toEqual([]);
    expect(out.state.d2PostedTransactions).toBeUndefined(); expect(out.state.d2SettlementReceipts).toBeUndefined();
  });

  it.each([13, 25])("preserves %s-month detail/summary and fresh-process portable source re-derivation", months => {
    const s = admit(source()), f = fixture(months), kernel = attachFsaCash(f.kernel, input(s));
    expect(attachFsaCash(kernel, input(s))).toBe(kernel);
    const summary = runHouseholdKernel({ kernel, runContext: f.context });
    const detail = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(detail.periods, JSON.stringify(detail.diagnostics)).toHaveLength(months);
    expect(summary.periods).toHaveLength(months); expect(summary.state).toEqual(detail.state);
    expect(detail.state.identities.postedTransactionIds).toHaveLength(2);
    const artifact = createPortableHouseholdReplayArtifact(summary), selected = detail.periods.at(-1)!.period;
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    const replay = replayHouseholdForecastWindow(restored, selected);
    expect(replay.state).toEqual(detail.state); expect(replay.periods).toEqual(detail.periods.slice(-1));
    const dir = mkdtempSync(join(tmpdir(), "pfm-fsa-cash-"));
    try {
      const payload = join(dir, "payload.json"); writeFileSync(payload, JSON.stringify({ artifact, selected }));
      for (const mode of ["available", "missing", "amended"] as const) {
        const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, PFM_FSA_CASH_PAYLOAD: payload, PFM_FSA_CASH_SOURCE: mode } });
        expect(worker.status, worker.stderr).toBe(0);
        if (mode === "available") expect(JSON.parse(worker.stdout)).toEqual({ state: canonicalSerialize(replay.state), periods: canonicalSerialize(replay.periods) });
        else expect(JSON.parse(worker.stdout)).toEqual({ rejected: true });
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
    store.delete(s.sourceId);
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
  }, 60_000);
});
