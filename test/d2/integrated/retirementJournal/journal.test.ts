import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { idempotencyKey } from "../../../../src/identity/index.js";
import { applyAccountingTransactionAtomically, applyRetirementDistributionAtomically, assertAuthoritativeStateCurrency,
  authoritativeStateChangesSince, cloneAuthoritativeState, createAuthoritativeState, createIndexedExecutionState,
  requalifyRetirementDistributionHistory, validateAuthoritativeState, type RetirementDistributionRecord } from "../../../../src/state/index.js";
import { retirementDistributionSourceFingerprint } from "../../../../src/state/index.js";
import { evaluateWithdrawalRmd } from "../../../../src/simulation/d2/retirement/withdrawalRmd/index.js";
import { fixture as cashFixture, input as cashInput, rmdInput, ids as cashIds } from "../retirementCash/scenario.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { Currency, money, USD } from "../../../../src/values/index.js";
import { admit, availability, context, distribution, ids, registerAuthority, sources, state } from "./scenario.js";

beforeAll(registerAuthority);
beforeEach(() => { sources.clear(); availability.enabled = true; availability.calls = 0; availability.failAt = 0; });

describe("J1 canonical retirement evidence (PM #204; PFA-DET-017 / PFA-TAX-015)", () => {
  it("keeps empty J1 evidence cheap without accepting orphan commitment IDs", () => {
    for (const indexed of [false, true]) {
      const original = createAuthoritativeState();
      const state = indexed ? createIndexedExecutionState(original) : original;
      validateAuthoritativeState(state);
      // Unrelated household payments must not acquire a retirement journal.
      expect(state.retirementDistributionAllocations).toBeUndefined();
      expect(state.d2PostedTransactions).toBeUndefined();
      // The same orphan check remains authoritative for cold and indexed state.
      const id = idempotencyKey("retirement-j1:record", "missing");
      state.identities.externalIdempotencyKeys = Object.freeze([...state.identities.externalIdempotencyKeys, id].sort());
      expect(() => validateAuthoritativeState(state)).toThrow();
    }
  });
  it("leaves the actual A4 $700 obligation unsatisfied after a writer-posted $500 and structural allocation", () => {
    const f = cashFixture(), raw = rmdInput(cashInput(f)), evaluated = evaluateWithdrawalRmd(raw);
    const candidate = evaluated.withdrawals.candidates[0]!, allocation = evaluated.bundle!.allocations[0]!;
    const base = distribution(true), source = { ...base.source, householdId: cashIds.household, personId: cashIds.person };
    const d: RetirementDistributionRecord = { ...base, householdId: cashIds.household, personId: cashIds.person,
      sourceAccountId: cashIds.ira, destinationAccountId: cashIds.bank, operationId: candidate.operationId,
      withdrawalId: candidate.claimId, authorizationId: candidate.authorizationId,
      effectiveAt: instant(`${candidate.effectiveAt}T00:00:00.000Z`), source,
      sourceEvidenceFingerprint: retirementDistributionSourceFingerprint(source),
      allocations: [{ ...base.allocations[0]!, allocationId: allocation.allocationId, approvalId: allocation.approval!.id,
        obligationId: allocation.rmdObligationId, sourceAccountId: cashIds.ira,
        obligation: { personId: cashIds.person, accountId: cashIds.ira, taxYear: 2026, ruleSnapshotId: allocation.ruleSnapshotId, required: money("700") } }] };
    applyRetirementDistributionAtomically(f.state, admit(d), f.context);
    const after = evaluateWithdrawalRmd(raw);
    expect(f.state.accounts[cashIds.bank]!.cash.equals(money("700"))).toBe(true);
    expect(after.rmd.obligations[0]!.satisfied.isZero()).toBe(true);
    expect(after.rmd.obligations[0]!.remaining.equals(money("700"))).toBe(true);
    expect(after.bundle!.obligations[0]!.remainingRequested.equals(money("200"))).toBe(true);
    expect(after.rmdSatisfaction).toBe("not_applied");
    expect(after.withdrawals.candidates[0]!.incrementalEconomicIncome.isZero()).toBe(true);
  });
  it.each([false, true])("posts a balanced $500 internal transfer with structural allocation=%s and zero RMD credit", rows => {
    const opening = createIndexedExecutionState(state()), d = admit(distribution(rows));
    const before = cloneAuthoritativeState(opening);
    expect(applyRetirementDistributionAtomically(opening, d, context).status).toBe("qualified");
    expect(opening.accounts[ids.source]!.cash.equals(money("500"))).toBe(true);
    expect(opening.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    expect(opening.accounts[ids.source]!.cash.plus(opening.accounts[ids.bank]!.cash).equals(money("1200"))).toBe(true);
    const proof = opening.d2PostedTransactions![d.transactionId]!;
    expect(proof.transaction.legs.map(l => [l.type, l.posting, l.amount.amount.toString()])).toEqual([
      ["cash", "debit", "500"], ["cash", "credit", "500"],
    ]);
    expect(opening.identities.recognitionIds).toHaveLength(0);
    expect(opening.identities.settlementIds).toHaveLength(0);
    expect(Object.keys(opening.obligations)).toHaveLength(0);
    expect(opening.retirementDistributionAllocations![d.transactionId]!.rmdSatisfaction).toBe("not_applied");
    expect(opening.retirementDistributionAllocations![d.transactionId]!.tax).toBe("incomplete");
    // Sourced arithmetic oracle: only J2 could apply $500 to $700 and leave $200.
    // J1 does not pass structural rows to an annual evaluator at all.
    expect(money("700").minus(d.gross).equals(money("200"))).toBe(true);
    expect(canonicalSerialize(authoritativeStateChangesSince(opening, before, (a, b) => canonicalSerialize(a) === canonicalSerialize(b))))
      .toContain("retirementDistributionAllocations");
    assertAuthoritativeStateCurrency(opening, USD);
    expect(() => assertAuthoritativeStateCurrency(opening, Currency.of("EUR"))).toThrow();
    expect(canonicalSerialize(createAuthoritativeState(opening))).toBe(canonicalSerialize(opening));
  });

  it("a $700 proposal or posted ID alone creates no journal or RMD satisfaction", () => {
    const opening = state();
    availability.enabled = false;
    expect(applyRetirementDistributionAtomically(opening, distribution(), context).status).toBe("incomplete");
    expect(opening.retirementDistributionAllocations).toBeUndefined();
    expect(opening.accounts[ids.source]!.cash.equals(money("1000"))).toBe(true);
    const d = distribution();
    expect(() => createAuthoritativeState({ ...opening, identities: { postedTransactionIds: [d.transactionId] },
      retirementDistributionAllocations: { [d.transactionId]: d } })).toThrow();
  });

  it.each([
    (d: RetirementDistributionRecord) => ({ ...d, gross: money("501") }),
    (d: RetirementDistributionRecord) => ({ ...d, netBank: money("499") }),
    (d: RetirementDistributionRecord) => ({ ...d, withholding: money("1") }),
    (d: RetirementDistributionRecord) => ({ ...d, gross: money("500.001") }),
    (d: RetirementDistributionRecord) => ({ ...d, gross: money("-500") }),
    (d: RetirementDistributionRecord) => ({ ...d, taxYear: 2027 }),
    (d: RetirementDistributionRecord) => ({ ...d, sourceAccountId: ids.bank }),
    (d: RetirementDistributionRecord) => ({ ...d, sourceEvidenceFingerprint: "forged" }),
    (d: RetirementDistributionRecord) => ({ ...d, source: { ...d.source, sourceVersion: "changed" } }),
    (d: RetirementDistributionRecord) => ({ ...d, allocations: [{ ...d.allocations[0]!, amount: money("501") }] }),
    (d: RetirementDistributionRecord) => ({ ...d, allocations: [{ ...d.allocations[0]!, amount: money("-1") }] }),
    (d: RetirementDistributionRecord) => ({ ...d, allocations: [{ ...d.allocations[0]!, amount: money("1.001") }] }),
    (d: RetirementDistributionRecord) => ({ ...d, allocations: [{ ...d.allocations[0]!, obligationId: "not-an-exact-obligation" }] }),
    (d: RetirementDistributionRecord) => ({ ...d, allocations: [{ ...d.allocations[0]!, satisfiesRmdYear: 2025 }] }),
  ])("rejects changed evidence with complete rollback %#", change => {
    const opening = state(), d = admit(distribution(true)), before = canonicalSerialize(opening);
    expect(() => applyRetirementDistributionAtomically(opening, change(d), context)).toThrow();
    expect(canonicalSerialize(opening)).toBe(before);
  });

  it.each(["rollover", "roth", "inherited"] as const)("refuses unsupported %s evidence", mode => {
    const d = distribution();
    const changed = { ...d, ...(mode === "rollover" ? { distributionKind: "rollover" }
      : mode === "roth" ? { instrumentFamily: "roth_ira", taxBucket: "roth" } : { beneficiaryId: ids.person }) } as unknown as RetirementDistributionRecord;
    const opening = state();
    expect(() => applyRetirementDistributionAtomically(opening, changed, context)).toThrow();
    expect(opening.identities.postedTransactionIds).toHaveLength(0);
  });

  it.each(["source", "bank", "owner", "funding", "late-source"] as const)("rolls back a failed %s posting", mode => {
    const opening = state(), d = admit(distribution());
    if (mode === "source") delete opening.accounts[ids.source];
    if (mode === "bank") delete opening.accounts[ids.bank];
    if (mode === "owner") opening.accounts[ids.bank] = { ...opening.accounts[ids.bank]!, ownerId: ids.household };
    if (mode === "funding") opening.accounts[ids.source]!.cash = money("100");
    if (mode === "late-source") availability.failAt = 2;
    const before = canonicalSerialize(opening);
    if (mode === "late-source") expect(applyRetirementDistributionAtomically(opening, d, context).status).toBe("incomplete");
    else expect(() => applyRetirementDistributionAtomically(opening, d, context)).toThrow();
    expect(canonicalSerialize(opening)).toBe(before);
  });

  it("rejects duplicate transactions and approval reuse across years", () => {
    const opening = state(), d = admit(distribution(true));
    applyRetirementDistributionAtomically(opening, d, context);
    const before = canonicalSerialize(opening);
    expect(() => applyRetirementDistributionAtomically(opening, d, context)).toThrow();
    const second = distribution(true, "second", 2027);
    admit({ ...second, allocations: [{ ...second.allocations[0]!, approvalId: d.allocations[0]!.approvalId }] });
    expect(() => applyRetirementDistributionAtomically(opening, sources.get(second.source.sourceId)!, context)).toThrow();
    expect(canonicalSerialize(opening)).toBe(before);
  });

  it("preserves immutable records and cannot backfill a preexisting cash-only posting", () => {
    const opening = state(), d = admit(distribution());
    const tx = createAccountingTransaction({ id: d.transactionId, date: d.effectiveAt, type: "retirement_cash_transfer", legs: [
      createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.bank, amount: money("500"), cashFlowClass: "investing" }),
      createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.source, amount: money("500"), cashFlowClass: "investing" }),
    ] });
    applyAccountingTransactionAtomically(opening, tx);
    expect(() => applyRetirementDistributionAtomically(opening, d, context)).toThrow();
    expect(opening.retirementDistributionAllocations).toBeUndefined();
    const fresh = state(); applyRetirementDistributionAtomically(fresh, d, context);
    expect(() => { delete fresh.retirementDistributionAllocations![d.transactionId]; }).toThrow();
    expect(() => { fresh.retirementDistributionAllocations![d.transactionId] = { ...d, taxYear: 2027 }; }).toThrow();
    expect(Object.isFrozen(fresh.retirementDistributionAllocations![d.transactionId]!.source)).toBe(true);
    const candidate = cloneAuthoritativeState(fresh); delete candidate.retirementDistributionAllocations;
    expect(() => validateAuthoritativeState(candidate)).toThrow();
    const orphan = { ...fresh, d2PostedTransactions: {} };
    expect(() => createAuthoritativeState(orphan)).toThrow();
    const altered = { ...fresh, retirementDistributionAllocations: { [d.transactionId]: { ...d, sourceEvidenceFingerprint: "tamper" } } };
    expect(() => createAuthoritativeState(altered)).toThrow();
    sources.set(d.source.sourceId, { ...d, traceIds: [] });
    expect(() => requalifyRetirementDistributionHistory(fresh, context)).toThrow();
  });

  it("a later failed period discards its earlier successful distribution candidate", () => {
    const committed = createIndexedExecutionState(state()), candidate = cloneAuthoritativeState(committed);
    applyRetirementDistributionAtomically(candidate, admit(distribution()), context);
    expect(() => applyAccountingTransactionAtomically(candidate, createAccountingTransaction({
      id: accountingTransactionId("later-failure"), date: instant("2026-01-16T00:00:00.000Z"), type: "bad-transfer", legs: [
        createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount: money("900"), cashFlowClass: "investing" }),
        createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.source, amount: money("900"), cashFlowClass: "investing" }),
      ],
    }))).toThrow();
    expect(committed.retirementDistributionAllocations).toBeUndefined();
    expect(committed.d2PostedTransactions).toBeUndefined();
    expect(committed.identities.postedTransactionIds).toHaveLength(0);
    expect(committed.accounts[ids.bank]!.cash.equals(money("200"))).toBe(true);
  });
});
