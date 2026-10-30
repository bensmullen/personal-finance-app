import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, applyHouseholdDomainTransactionAtomically,
  applyNativeHouseholdOriginalAtomically, applyRetirementDistributionAtomically, applySsaMedicarePaymentAtomically,
  authoritativeCheckpointDelta, createAuthoritativeState, createIndexedExecutionState, d2SettlementPostingRegistration,
  requalifyD2SettlementReceiptHistory, requalifyRetirementDistributionHistory, restoreAuthoritativeCheckpointDelta, validateAuthoritativeState,
  type AuthoritativeState, type D2PostingRegistration, type D2SettlementReceipt } from "../../../../src/state/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { Currency, Money, money } from "../../../../src/values/index.js";
import { attachment, context, control, ids, install, journal, legacy, opening, receipt, reset, retirement, ssa, type Family } from "./scenario.js";

beforeAll(install);
beforeEach(reset);
const start = (family: Family) => createIndexedExecutionState(opening(family === "ssa" ? "2000" : family === "card" ? "500" : "1500"));
function commit(family: Family, state = start(family), n = 0) {
  if (family === "ssa") applySsaMedicarePaymentAtomically(state, ssa(n));
  else if (family === "retirement") expect(applyRetirementDistributionAtomically(state, retirement(n), context).status).toBe("qualified");
  else expect(applyD2SettlementAtomically(state, receipt(family, n), context).status).toBe("committed");
  return state;
}
function unchanged(state: AuthoritativeState, action: () => unknown) {
  const before = canonicalSerialize(state);
  expect(action).toThrow();
  expect(canonicalSerialize(state)).toBe(before);
}

describe("#285 native records retain the sole actual accounting journal", () => {
  it("SSA v3 posts gross right, distinct Medicare expenses and net BANK once, with all claim histories", () => {
    const state = commit("ssa"), records = Object.values(state.ssaMedicarePayments!);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.version).toBe("ssa-medicare-payment/v3");
    expect(record.transaction).toEqual(journal("ssa", 0));
    expect(record.payable.grossPayable.equals(money("1500"))).toBe(true);
    expect(record.requests.map(r => r.claim.originalAmount.amount.toString())).toEqual(["80", "120"]);
    expect(record.recognitions.map(r => r.category)).toEqual(["ssa_gross_income", "medicare_expense", "medicare_expense"]);
    expect(record.netBank.equals(money("1300"))).toBe(true);
    expect(state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    expect(state.identities.postedTransactionIds).toHaveLength(1);
    expect(Object.keys(state.d2PostedTransactions!)).toEqual([record.transaction.id]);
    expect(Object.values(state.obligations)).toHaveLength(3);
    expect(Object.values(state.obligations).every(c => c.outstandingAmount.isZero() && c.settlementIds.length === 1)).toBe(true);
    unchanged(state, () => applySsaMedicarePaymentAtomically(state, ssa()));
    const bad = start("ssa"), input = ssa();
    unchanged(bad, () => applySsaMedicarePaymentAtomically(bad, { ...input, requests: input.requests.slice(0, 1) }));
    unchanged(bad, () => applySsaMedicarePaymentAtomically(bad, { ...input, bankAccountId: ids.ira }));
  });

  it("retirement v2 retains both cash legs, person-owned source, allocations and one-time RMD keys", () => {
    const state = commit("retirement"), d = retirement();
    expect(state.accounts[ids.ira]!.cash.equals(money("19500"))).toBe(true);
    expect(state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(state.d2PostedTransactions![d.transactionId]!.transaction.legs.filter(l => l.type === "cash")).toHaveLength(2);
    expect(state.retirementDistributionAllocations![d.transactionId]).toEqual(d);
    expect(d.allocations).toHaveLength(1);
    expect(d.rmdSatisfaction).toBe("not_applied");
    expect(d.tax).toBe("incomplete");
    expect(state.identities.externalIdempotencyKeys.some(k => k.includes("retirement-j1:allocation"))).toBe(true);
    unchanged(state, () => applyRetirementDistributionAtomically(state, d, context));
    const bad = start("retirement");
    unchanged(bad, () => applyRetirementDistributionAtomically(bad, { ...d, sourceAccountId: ids.bank }, context));
    unchanged(bad, () => applyRetirementDistributionAtomically(bad, { ...d, allocations: [] }, context));
    unchanged(bad, () => applyRetirementDistributionAtomically(bad, { ...d, version: "retirement-distribution/v1" }, context));
    requalifyRetirementDistributionHistory(createAuthoritativeState(state), context);
  });

  it("retains zero-net SSA claims and expense without manufacturing a zero BANK journal leg", () => {
    const state = commit("ssa", start("ssa"), 24), r = Object.values(state.ssaMedicarePayments!)[0]!;
    expect(r.netBank.isZero()).toBe(true);
    expect(r.transaction.legs.some(l => l.type === "cash")).toBe(false);
    expect(state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(Object.values(state.obligations)).toHaveLength(3);
    expect(canonicalSerialize(createAuthoritativeState(state))).toBe(canonicalSerialize(state));
  });

  it.each(["fsa", "card"] as const)("%s original and later settlement retain their actual proof roles and receipt", family => {
    const state = start(family), r = receipt(family), registration = d2SettlementPostingRegistration(r, "original");
    applyNativeHouseholdOriginalAtomically(state, r.originalTransaction, registration, context);
    expect(state.identities.postedTransactionIds).toEqual([r.originalTransaction.id]);
    expect(state.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
    if (family === "card") {
      expect(r.nativeHousehold!.original.cashRole).toBe("nonbank");
      expect(r.nativeHousehold!.original.route).toBeUndefined();
      expect(r.originalTransaction.legs.some(l => l.type === "cash")).toBe(false);
      expect(state.liabilities[ids.liability]!.balance.equals(money("1020"))).toBe(true);
    }
    expect(applyD2SettlementAtomically(state, r, context).status).toBe("committed");
    expect(state.d2SettlementReceipts![r.id]).toEqual(r);
    expect(Object.keys(state.d2PostedTransactions!)).toHaveLength(2);
    expect(state.accounts[ids.bank]!.cash.equals(money(family === "fsa" ? "1500" : "300"))).toBe(true);
    if (family === "card") expect(state.liabilities[ids.liability]!.balance.equals(money("820"))).toBe(true);
    expect([...state.identities.recognitionIds]).toEqual([r.recognitionId]);
    expect([...state.identities.settlementIds]).toEqual([r.settlementId]);
    const before = canonicalSerialize(state);
    expect(applyD2SettlementAtomically(state, r, context).status).toBe("already_committed");
    expect(canonicalSerialize(state)).toBe(before);
    unchanged(state, () => applyD2SettlementAtomically(state, { ...r, amount: money("1") }, context));
  });

  it("two independently authorized members share BANK with native and S1 events without first-member pinning", () => {
    const state = commit("fsa"); commit("fsa", state, 1);
    // The generic event uses an independently reconstructed FSA paid original;
    // it has a distinct native source identity and remains a generic S1 proof.
    const a = attachment("fsa", 2), tx = journal("fsa", 2);
    applyHouseholdDomainTransactionAtomically(state, tx, { version: "household-domain-posting/v1", context: a.context,
      route: a.route!, originals: a.originals });
    expect(state.accounts[ids.bank]!.ownerId).toBe(ids.household);
    expect(Object.keys(state.d2PostedTransactions!)).toHaveLength(5);
    expect(canonicalSerialize(createAuthoritativeState(state))).toBe(canonicalSerialize(state));
    const denied = start("fsa"); control.deniedBob = true;
    unchanged(denied, () => applyD2SettlementAtomically(denied, receipt("fsa", 1), context));
  });
});

describe("source-controlled fail-closed native admission", () => {
  it.each(["ssa", "retirement", "fsa", "card"] as const)("%s authenticates originals before and after staging, including a late race", family => {
    commit(family);
    const lastEconomicRead = control.economicReads;
    const lastNativeRead = control.nativeReads;
    reset();
    const state = start(family); control.economicFailAt = lastEconomicRead;
    unchanged(state, () => commit(family, state));
    expect(control.economicReads).toBe(lastEconomicRead);
    reset(); control.withdrawn = true;
    unchanged(state, () => commit(family, state));
    reset(); control.revoked = true;
    unchanged(state, () => commit(family, state));
    reset(); control.nativeFailAt = lastNativeRead;
    unchanged(state, () => commit(family, state));
    expect(control.nativeReads).toBe(lastNativeRead);
  });

  it.each(["fsa", "card"] as const)("%s rejects forged role/member/source/original and missing or mixed opt-in versions", family => {
    const state = start(family), r = receipt(family), a = r.nativeHousehold!;
    const { nativeHousehold: _native, ...withoutNative } = r;
    const variants: D2SettlementReceipt[] = [
      { ...r, schemaVersion: "d2-shared/settlement-receipt/v1" },
      withoutNative,
      { ...r, nativeHousehold: { ...a, original: a.settlement } },
      { ...r, nativeHousehold: { ...a, settlement: { ...a.settlement, context: { ...a.settlement.context, personId: ids.bob } } } },
      { ...r, nativeHousehold: { ...a, settlement: { ...a.settlement, context: { ...a.settlement.context, bankAccountId: ids.ira } } } },
      { ...r, nativeHousehold: { ...a, settlement: { ...a.settlement, originals: a.settlement.originals.map(w => ({ ...w,
        original: { ...w.original, revisionId: "forged" } })) } } },
    ];
    for (const changed of variants) unchanged(state, () => applyD2SettlementAtomically(state, changed, context));
    const registration = d2SettlementPostingRegistration(r, "original");
    unchanged(state, () => applyAccountingTransactionAtomically(state, r.originalTransaction, registration));
    if (registration.kind === "card_interest_payment") unchanged(state, () => applyNativeHouseholdOriginalAtomically(state,
      r.originalTransaction, { ...registration, issuerId: "forged-issuer" }, context));
    if (registration.kind === "fsa_paid_reimbursement") unchanged(state, () => applyNativeHouseholdOriginalAtomically(state,
      r.originalTransaction, { ...registration, memberId: "forged-member" }, context));
  });

  it("rejects native original proof backfill, conflicting claimant, issuer rebound, cash contention and changed owner", () => {
    const state = start("fsa"), r = receipt("fsa");
    applyAccountingTransactionAtomically(state, r.originalTransaction);
    unchanged(state, () => applyNativeHouseholdOriginalAtomically(state, r.originalTransaction, d2SettlementPostingRegistration(r, "original"), context));
    expect(applyD2SettlementAtomically(state, r, context)).toEqual({ status: "incomplete", reason: "original_journal_unavailable" });
    const contended = start("fsa");
    // Same economic instant, already funded source-owned debit reduces the one BANK.
    const tx = journal("fsa", 2), a = attachment("fsa", 2);
    applyHouseholdDomainTransactionAtomically(contended, tx, { version: "household-domain-posting/v1", context: a.context, route: a.route!, originals: a.originals });
    unchanged(contended, () => applyD2SettlementAtomically(contended, r, context));
    const posted = commit("card"), bytes = canonicalSerialize(posted);
    const otherClaimant = receipt("card", 1);
    unchanged(posted, () => applyNativeHouseholdOriginalAtomically(posted, otherClaimant.originalTransaction,
      d2SettlementPostingRegistration(otherClaimant, "original"), context));
    const proof = posted.d2PostedTransactions![receipt("card").originalTransaction.id]!;
    if (proof.registration.kind !== "card_interest_payment") throw new Error("fixture");
    expect(() => createAuthoritativeState({ ...posted, d2PostedTransactions: { ...posted.d2PostedTransactions,
      [proof.transaction.id]: { ...proof, registration: { ...proof.registration, issuerId: "another-issuer" } } } })).toThrow();
    expect(canonicalSerialize(posted)).toBe(bytes);
    for (const bank of [
      { ...posted.accounts[ids.bank]!, id: ids.ira },
      { ...posted.accounts[ids.bank]!, kind: "savings" as const },
      { ...posted.accounts[ids.bank]!, cash: Money.parse("300", Currency.of("EUR")) },
    ]) expect(() => createAuthoritativeState({ ...posted, accounts: { ...posted.accounts, [ids.bank]: bank } })).toThrow();
    Object.assign(posted.accounts[ids.bank]!, { ownerId: ids.person });
    expect(() => validateAuthoritativeState(posted)).toThrow();
  });

  it.each(["ssa", "retirement", "fsa", "card"] as const)("%s rejects late cutoff, wrong actual run context and source withdrawal on cold import", family => {
    const state = commit(family), before = canonicalSerialize(state);
    const empty = createAuthoritativeState();
    const delta = authoritativeCheckpointDelta(state, empty, (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    control.missingNative = true;
    expect(() => createAuthoritativeState(state)).toThrow();
    expect(() => restoreAuthoritativeCheckpointDelta(empty, delta)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
    reset(); control.nativeFailAt = 2;
    expect(() => createAuthoritativeState(state)).toThrow();
    reset();
    const badContext = { ...context, dataCutoff: instant("2025-01-01T00:00:00.000Z") }, clean = start(family);
    if (family === "retirement") {
      const before = canonicalSerialize(clean);
      expect(applyRetirementDistributionAtomically(clean, retirement(), badContext)).toEqual({ status: "incomplete", reason: "source_not_qualified" });
      expect(canonicalSerialize(clean)).toBe(before);
    } else unchanged(clean, () => {
      if (family === "ssa") return applySsaMedicarePaymentAtomically(clean, { ...ssa(), nativeHousehold: { ...attachment("ssa"), context: { ...attachment("ssa").context, ...badContext } } });
      return applyD2SettlementAtomically(clean, receipt(family), badContext);
    });
  });
});

describe("native portable replay, legacy bytes and bounded source references", () => {
  it.each(["ssa", "retirement", "fsa", "card"] as const)("%s imports and restores checkpoints in a fresh process only after source registration", family => {
    const state = commit(family), empty = createAuthoritativeState();
    const delta = authoritativeCheckpointDelta(state, empty, (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    expect(canonicalSerialize(restoreAuthoritativeCheckpointDelta(empty, delta))).toBe(canonicalSerialize(state));
    const directory = mkdtempSync(join(tmpdir(), "pfm-native-bank-")), path = join(directory, "synthetic.json");
    try {
      for (const sources of [true, false]) {
        writeFileSync(path, JSON.stringify({ state, delta, sources }));
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 15_000,
          env: { ...process.env, PFM_NATIVE_BANK_PAYLOAD: path } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(sources ? { imported: true, checkpoint: true } : { rejected: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("retains historical PERSON BANK D2 proof bytes and rejects a household substitution", () => {
    for (const family of ["fsa", "card"] as const) {
      const state = opening(family === "card" ? "500" : "1500", ids.person), r = legacy.receipt(family);
      applyAccountingTransactionAtomically(state, r.originalTransaction, d2SettlementPostingRegistration(r, "original"));
      const bytes = canonicalSerialize(state.d2PostedTransactions);
      expect(canonicalSerialize(createAuthoritativeState(state).d2PostedTransactions)).toBe(bytes);
      expect(JSON.stringify(state.d2PostedTransactions)).not.toContain("nativeHousehold");
      expect(applyD2SettlementAtomically(state, r, context).status).toBe("committed");
      const legacyBytes = canonicalSerialize(state);
      expect(canonicalSerialize(createAuthoritativeState(state))).toBe(legacyBytes);
      const household = start(family);
      unchanged(household, () => applyAccountingTransactionAtomically(household, r.originalTransaction, d2SettlementPostingRegistration(r, "original")));
    }
    const retirementState = opening("1500", ids.person), d = legacy.retirement();
    expect(applyRetirementDistributionAtomically(retirementState, d, context).status).toBe("qualified");
    expect(retirementState.retirementDistributionAllocations![d.transactionId]!.version).toBe("retirement-distribution/v1");
    const retirementBytes = canonicalSerialize(retirementState);
    expect(canonicalSerialize(createAuthoritativeState(retirementState))).toBe(retirementBytes);
    for (const originalSources of [undefined, { mode: "synthetic-source-originals/v2" }]) {
      const input = legacy.ssa(), state = opening("2000", ids.person);
      const r = applySsaMedicarePaymentAtomically(state, { ...input, sourceInputs: { sourceId: "ssa:0", legacy: true,
        ...(originalSources ? { originalSources } : {}) } });
      expect(r.version).toBe(originalSources ? "ssa-medicare-payment/v2" : "ssa-medicare-payment/v1");
      const bytes = canonicalSerialize(state);
      expect(canonicalSerialize(createAuthoritativeState(state))).toBe(bytes);
      expect(state.d2PostedTransactions).toBeUndefined();
    }
  });

  it.each(["ssa", "retirement", "fsa", "card"] as const)("keeps 1/12/24 %s native events linear with bounded source reads per append", family => {
    const initial = opening(family === "card" ? "20000" : family === "ssa" ? "2000" : "1500");
    if (family === "card") initial.liabilities[ids.liability]!.balance = money("20000");
    const state = createIndexedExecutionState(initial), sizes: number[] = [], reads: number[] = [];
    for (let n = 0; n < 24; n++) {
      const before = control.bankReads + control.economicReads + control.nativeReads;
      commit(family, state, family === "card" ? n + 100 : n);
      reads.push(control.bankReads + control.economicReads + control.nativeReads - before);
      if ([0, 11, 23].includes(n)) sizes.push(JSON.stringify(state).length);
    }
    expect(reads[23]).toBe(reads[11]);
    expect(Math.max(...reads)).toBeLessThan(100);
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[1]! * 2.1);
    expect(Object.keys(state.d2PostedTransactions!)).toHaveLength(family === "fsa" || family === "card" ? 48 : 24);
    const bytes = JSON.stringify(state);
    expect(bytes).not.toContain("membership-roster");
    expect(bytes).not.toContain("original-document-catalog");
    control.withdrawn = true;
    expect(() => requalifyD2SettlementReceiptHistory(state, context)).toThrow();
  });
});
