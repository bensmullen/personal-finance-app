import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { applyAccountingTransactionAtomically, applyHouseholdDomainTransactionAtomically, authoritativeCheckpointDelta,
  createAuthoritativeState, createIndexedExecutionState, restoreAuthoritativeCheckpointDelta,
  requalifyD2SettlementReceiptHistory, validateAuthoritativeState,
  type HouseholdDomainPostingEvidence, type D2PostingRegistration } from "../../../../src/state/index.js";
import { qualifyHouseholdBankRoute, type HouseholdBankOriginal } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { context, control, event, ids, install, opening, reset } from "./scenario.js";

beforeAll(install);
beforeEach(reset);
const commit = (state = opening(), e = event()) => {
  applyHouseholdDomainTransactionAtomically(state, e.transaction, e.evidence);
  return state;
};
const reject = (mutate: (e: ReturnType<typeof event>) => ReturnType<typeof event>) => {
  const state = opening(), before = canonicalSerialize(state), e = mutate(event());
  expect(() => commit(state, e)).toThrow();
  expect(canonicalSerialize(state)).toBe(before);
};
describe("source-controlled household BANK authority and canonical posting", () => {
  it("posts two independently authorized members through one shared balance and one proof per ID", () => {
    const state = commit();
    commit(state, event(1, ids.bob, "debit"));
    expect(state.accounts[ids.bank]!.ownerId).toBe(ids.household);
    expect(state.accounts[ids.bank]!.cash.equals(money("100"))).toBe(true);
    expect(Object.keys(state.d2PostedTransactions!)).toHaveLength(2);
    expect(state.identities.postedTransactionIds).toHaveLength(2);
    const proof = state.d2PostedTransactions![accountingTransactionId("posting:0")]!;
    expect(proof.transaction.type).toBe("synthetic_domain_original");
    expect(Object.isFrozen(proof.registration)).toBe(true);
    const before = canonicalSerialize(state);
    expect(() => commit(state)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("requires the economic original in addition to an authentic bank route", () => {
    reject(e => ({ ...e, evidence: { ...e.evidence, originals: [] } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, originals: e.evidence.originals.map(w => ({ ...w,
      original: { ...w.original, publisherId: "forged-publisher" } })) } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, originals: e.evidence.originals.map(w => ({ ...w,
      original: { ...w.original, revisionId: "amended" } })) } }));
    control.economicChange = () => undefined;
    reject(e => e);
  });
  it("rejects caller-forged route pins and unregistered bank publishers", () => {
    reject(e => ({ ...e, evidence: { ...e.evidence, route: { ...e.evidence.route, digest: "forged" } } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, route: { ...e.evidence.route, publisherId: "forged-bank" } } }));
  });
  it("binds independent source and payer identities, exact journal and actual event/run context", () => {
    reject(e => ({ ...e, evidence: { ...e.evidence, originals: e.evidence.originals.map(w => ({ ...w,
      payer: { kind: "person", id: ids.bob } })) } }));
    reject(e => ({ ...e, transaction: { ...e.transaction, id: accountingTransactionId("forged-id") } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, context: { ...e.evidence.context, runId: "other-run" } } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, context: { ...e.evidence.context, eventId: "other-event" } } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, context: { ...e.evidence.context, personId: ids.bob } } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, context: { ...e.evidence.context, direction: "debit" } } }));
    reject(e => ({ ...e, evidence: { ...e.evidence, context: { ...e.evidence.context,
      dataCutoff: instant("2026-05-01T00:00:00.000Z") } } }));
  });
  it("combines independently requalified wage and payroll-health originals in one unchanged journal", () => {
    const e = event(0, ids.alice, "credit", ["wage", "payroll_health"]), state = commit(opening(), e);
    expect(Object.keys(state.d2PostedTransactions!)).toHaveLength(1);
    expect(state.accounts[ids.bank]!.cash.equals(money("101"))).toBe(true);
    expect(state.d2PostedTransactions![e.transaction.id]!.transaction).toEqual(e.transaction);
    reject(() => ({ ...e, evidence: { ...e.evidence, originals: e.evidence.originals.slice(0, 1) } }));
  });
  it("rejects direct writer bypass, proof backfill and duplicate event/proof IDs without mutation", () => {
    const e = event(), state = opening();
    const registration: D2PostingRegistration = { kind: "household_domain", role: "original", operationId: e.evidence.context.eventId,
      householdId: ids.household, personId: ids.alice, bankAccountId: ids.bank, evidence: e.evidence };
    const before = canonicalSerialize(state);
    expect(() => applyAccountingTransactionAtomically(state, e.transaction, registration)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
    applyAccountingTransactionAtomically(state, e.transaction);
    const posted = canonicalSerialize(state);
    expect(() => commit(state, e)).toThrow();
    expect(canonicalSerialize(state)).toBe(posted);
  });
  it.each(["person", "other-kind", "wrong-household", "wrong-account"])("rejects ineligible state BANK: %s", kind => {
    const state = opening(), bank = state.accounts[ids.bank]!;
    if (kind === "person") Object.assign(bank, { ownerId: ids.alice });
    if (kind === "other-kind") Object.assign(bank, { kind: "brokerage" });
    if (kind === "wrong-household") Object.assign(bank, { ownerId: ids.bob });
    if (kind === "wrong-account") delete state.accounts[ids.bank];
    const before = canonicalSerialize(state);
    expect(() => commit(state)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("refuses historical owner rebinding and unauthorized member withdrawals", () => {
    const state = commit();
    Object.assign(state.accounts[ids.bank]!, { ownerId: ids.alice });
    expect(() => validateAuthoritativeState(state)).toThrow();
    reset();
    const e = event(1, ids.bob, "debit"), clean = opening();
    control.bankChange = h => ({ ...h, originals: h.originals.map<HouseholdBankOriginal>(o => o.kind === "permission" ? { ...o, direction: "credit" } : o) });
    const before = canonicalSerialize(clean);
    expect(() => commit(clean, e)).toThrow();
    expect(canonicalSerialize(clean)).toBe(before);
  });
  it("rejects overdraft against the same actually available balance", () => {
    const state = opening(); state.accounts[ids.bank]!.cash = money("0");
    const before = canonicalSerialize(state);
    expect(() => commit(state, event(1, ids.bob, "debit"))).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it.each(["account", "household", "membership", "permission"] as const)("requires authentic independently scoped %s original", kind => {
    const e = event(), state = opening(), before = canonicalSerialize(state);
    control.bankChange = h => ({ ...h, originals: h.originals.filter(o => o.kind !== kind) });
    expect(() => commit(state, e)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it.each(["revoked", "late", "future", "wrong-member", "person-owner", "wrong-household", "wrong-account", "incomplete"])("rejects source revision or identity mismatch: %s", mode => {
    const e = event(), state = opening(), before = canonicalSerialize(state);
    control.bankChange = h => {
      if (mode === "incomplete") return { ...h, completeThrough: instant("2026-05-01T00:00:00.000Z") };
      return { ...h, originals: h.originals.map<HouseholdBankOriginal>(o => {
        if (mode === "person-owner" && o.kind === "account") return { ...o, owner: { kind: "person", id: ids.alice } };
        if (o.kind !== "membership") return o;
        if (mode === "revoked") return { ...o, status: "revoked" };
        if (mode === "late") return { ...o, knownAt: instant("2026-07-01T00:00:00.000Z") };
        if (mode === "future") return { ...o, effectiveFrom: instant("2026-07-01T00:00:00.000Z") };
        if (mode === "wrong-member") return { ...o, personId: ids.bob };
        if (mode === "wrong-household") return { ...o, householdId: ids.bob };
        if (mode === "wrong-account") return o;
        return o;
      }).map<HouseholdBankOriginal>(o => mode === "wrong-account" && o.kind === "permission" ? { ...o, bankAccountId: ids.bob } : o) };
    };
    expect(() => commit(state, e)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("rejects a known retroactive amendment and excludes unavailable future publications at the real cutoff", () => {
    const c = context(), pin = qualifyHouseholdBankRoute("synthetic-bank", "household-bank", c);
    control.bankChange = h => ({ ...h, originals: [...h.originals, { ...h.originals[2]!, revisionId: "amended/v2",
      publishedAt: instant("2026-05-01T00:00:00.000Z"), knownAt: instant("2026-05-01T00:00:00.000Z"), status: "revoked" }] });
    expect(() => qualifyHouseholdBankRoute("synthetic-bank", "household-bank", c)).toThrow();
    control.bankChange = h => ({ ...h, originals: [...h.originals, { ...h.originals[2]!, revisionId: "future/v2",
      publishedAt: instant("2026-07-01T00:00:00.000Z"), knownAt: instant("2026-07-01T00:00:00.000Z"), status: "revoked" }] });
    expect(qualifyHouseholdBankRoute("synthetic-bank", "household-bank", c)).toEqual(pin);
  });
  it.each(["bank", "economic"])("fails closed on a second independent %s read race before final commit", source => {
    const e = event(), state = opening(), before = canonicalSerialize(state);
    control.bankReads = 0; control.economicReads = 0;
    if (source === "bank") control.bankChange = h => control.bankReads > 1 ? undefined : h;
    else control.economicChange = v => control.economicReads > 1 ? undefined : v;
    expect(() => commit(state, e)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("rechecks source authority after the candidate journal and identities have been prepared", () => {
    const e = event(), state = createIndexedExecutionState(opening()), before = canonicalSerialize(state);
    control.economicReads = 0;
    control.economicChange = v => control.economicReads >= 4 ? undefined : v;
    expect(() => commit(state, e)).toThrow();
    expect(control.economicReads).toBe(4);
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("does not archive unbounded caller fields alongside compact original references", () => {
    reject(e => ({ ...e, evidence: { ...e.evidence, appendix: "synthetic source only ".repeat(1000) } as HouseholdDomainPostingEvidence }));
  });
  it("preserves person-owned legacy proof bytes and rejects an unqualified household substitution", () => {
    const legacy = opening(); Object.assign(legacy.accounts[ids.bank]!, { ownerId: ids.alice });
    const e = event();
    const r: D2PostingRegistration = { kind: "fsa_paid_reimbursement", role: "original", operationId: "medical",
      householdId: ids.household, personId: ids.alice, bankAccountId: ids.bank, planId: "plan", planYearId: "year",
      memberId: "member", payeeId: "payee", medicalReceiptId: "receipt", expensePaymentId: "expense" };
    const tx = event(2, ids.alice, "debit").transaction;
    // Legacy FSA original shape remains expense then cash, exactly as before.
    const original = { ...tx, legs: [...tx.legs].reverse() };
    applyAccountingTransactionAtomically(legacy, original, r);
    const bytes = canonicalSerialize(legacy.d2PostedTransactions);
    expect(canonicalSerialize(createAuthoritativeState(legacy).d2PostedTransactions)).toBe(bytes);
    const household = opening(), before = canonicalSerialize(household);
    expect(() => applyAccountingTransactionAtomically(household, original, r)).toThrow();
    expect(canonicalSerialize(household)).toBe(before);
    expect(e.evidence.route.version).toBe("household-bank-route/v1");
  });
});

describe("portable references, checkpoint delta and bounded event growth", () => {
  it("restores full import and checkpoint delta only with freshly registered independent providers", () => {
    const state = commit(); commit(state, event(1, ids.bob, "debit"));
    const delta = authoritativeCheckpointDelta(state, createAuthoritativeState(), (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    const restored = restoreAuthoritativeCheckpointDelta(createAuthoritativeState(), delta);
    expect(canonicalSerialize(restored)).toBe(canonicalSerialize(state));
    const directory = mkdtempSync(join(tmpdir(), "pfm-household-bank-")), path = join(directory, "synthetic.json");
    try {
      for (const sources of [true, false]) {
        writeFileSync(path, JSON.stringify({ state, delta, sources }));
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 10_000,
          env: { ...process.env, PFM_HOUSEHOLD_BANK_PAYLOAD: path } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(sources ? JSON.parse(JSON.stringify({ imported: state.accounts, restored: state.accounts })) : { rejected: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("re-reads archived economic originals and bank authority after import", () => {
    const state = commit(), imported = createAuthoritativeState(state);
    control.economicChange = () => undefined;
    expect(() => requalifyD2SettlementReceiptHistory(imported, context())).toThrow();
    expect(() => createAuthoritativeState(state)).toThrow();
    delete control.economicChange;
    control.bankChange = () => undefined;
    expect(() => createAuthoritativeState(state)).toThrow();
  });
  it("rejects a second-read economic source race during cold import", () => {
    const state = commit();
    control.economicReads = 0;
    control.economicChange = v => control.economicReads > 1 ? undefined : v;
    expect(() => createAuthoritativeState(state)).toThrow();
  });
  it("rejects missing or substituted archived proof identities and rewritten checkpoint history", () => {
    const state = commit(), e = event();
    expect(() => createAuthoritativeState({ ...state, identities: { ...state.identities, postedTransactionIds: [] } })).toThrow();
    const proof = state.d2PostedTransactions![e.transaction.id]!;
    expect(() => createAuthoritativeState({ ...state, d2PostedTransactions: { [e.transaction.id]: {
      ...proof, registration: { ...proof.registration, personId: ids.bob } } } })).toThrow();
    const delta = authoritativeCheckpointDelta(state, createAuthoritativeState(), (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    expect(() => restoreAuthoritativeCheckpointDelta(state, delta)).toThrow();
  });
  it("keeps 1/12/24 event references linear and reads bounded per append", () => {
    const sizes: number[] = [], reads: number[] = [];
    const state = createIndexedExecutionState(opening());
    for (let n = 0; n < 24; n++) {
      const e = event(n, n % 2 === 0 ? ids.alice : ids.bob), start = control.bankReads + control.economicReads;
      commit(state, e);
      reads.push(control.bankReads + control.economicReads - start);
      if ([0, 11, 23].includes(n)) sizes.push(JSON.stringify(state.d2PostedTransactions).length);
    }
    expect(Math.max(...reads)).toBeLessThanOrEqual(12);
    expect(reads[23]).toBe(reads[11]);
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[1]! * 2.1);
    expect(Object.keys(state.d2PostedTransactions!)).toHaveLength(24);
    const wire = JSON.stringify(state.d2PostedTransactions);
    expect(wire).not.toContain("originals\":[{\"kind\":\"account");
    expect(wire).not.toContain("household-declaration");
    expect(wire).not.toContain("membership");
  });
});
