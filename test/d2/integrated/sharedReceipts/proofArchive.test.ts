import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { ValidationError } from "../../../../src/diagnostics/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { runHouseholdKernel, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, authoritativeStateChangesSince,
  cloneAuthoritativeState, createAuthoritativeState, createIndexedExecutionState, d2PostedTransactionArchiveDelta,
  d2SettlementPostingRegistration, validateAuthoritativeState } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { laterReceipt } from "./laterParticipant.js";
import { replayFixture } from "./replayScenario.js";
import { admit, availability, card, context, fsa, ids, independentSources, registerMockAuthorities, state } from "./scenario.js";

registerMockAuthorities();
beforeEach(() => { independentSources.clear(); availability.source = true; availability.calls = 0; availability.failAt = 0; });

describe("#149 canonical posting-time proof archive", () => {
  it("archives an unmatched original at actual posting, before any payment or settlement receipt", () => {
    const r = fsa(), s = createIndexedExecutionState(state("1500")), opening = cloneAuthoritativeState(s);
    const registration = { ...d2SettlementPostingRegistration(r, "original"), operationId: "original-paid-expense-operation" };
    applyAccountingTransactionAtomically(s, r.originalTransaction, registration);
    expect(s.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
    expect(s.d2SettlementReceipts).toBeUndefined();
    expect(s.d2PostedTransactions![r.originalTransaction.id]).toEqual({ schemaVersion: "d2-shared/posted-transaction/v1",
      writer: "applyAccountingTransactionAtomically/v1", registration, transaction: r.originalTransaction });
    const delta = authoritativeStateChangesSince(s, opening, (a, b) => canonicalSerialize(a) === canonicalSerialize(b));
    expect(delta).toMatchObject({ d2PostedTransactions: { present: true, changes: [{ kind: "set", key: r.originalTransaction.id }] } });
    const restored = createAuthoritativeState(s);
    expect(applyD2SettlementAtomically(restored, admit(r), context).status).toBe("committed");
    expect(restored.accounts[ids.bank]!.cash.equals(money("1500"))).toBe(true);
    expect(Object.keys(restored.d2PostedTransactions!)).toHaveLength(2);
    expect(restored.identities.postedTransactionIds).toHaveLength(2);
  });

  it("never backfills a legacy posted ID even when the source qualifies and the receipt has exact journal bytes", () => {
    const r = admit(fsa()), s = state("1500");
    applyAccountingTransactionAtomically(s, r.originalTransaction);
    expect(s.d2PostedTransactions).toBeUndefined();
    const before = canonicalSerialize(s);
    expect(applyD2SettlementAtomically(s, r, context)).toEqual({ status: "incomplete", reason: "original_journal_unavailable" });
    expect(() => applyAccountingTransactionAtomically(s, r.originalTransaction, d2SettlementPostingRegistration(r, "original"))).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it.each(["0", "9007199254740993.01"])("preserves exact legitimate original magnitude %s without opting other postings into the archive", amount => {
    const r = fsa(`exact:${amount}`), value = money(amount), s = state(amount);
    const tx = createAccountingTransaction({ ...r.originalTransaction, legs: [
      createAccountingLeg({ type: "expense", posting: "debit", amount: value }),
      createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount: value, cashFlowClass: "operating" }),
    ] });
    applyAccountingTransactionAtomically(s, tx, d2SettlementPostingRegistration(r, "original"));
    expect(s.accounts[ids.bank]!.cash.equals(money("0"))).toBe(true);
    expect(s.d2PostedTransactions![tx.id]!.transaction.legs[0]!.amount.equals(value)).toBe(true);
    const ordinary = createAccountingTransaction({ id: accountingTransactionId("unregistered-income"), type: "ordinary", date: tx.date,
      legs: [createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.bank, amount: money("10"), cashFlowClass: "operating" }),
        createAccountingLeg({ type: "income", posting: "credit", amount: money("10") })] });
    applyAccountingTransactionAtomically(s, ordinary);
    expect(Object.keys(s.d2PostedTransactions!)).toHaveLength(1);
    expect(s.identities.postedTransactionIds).toHaveLength(2);
  });

  it("rolls back archive, commit markers and balances when original funding or registered signed shape fails", () => {
    const r = fsa(), s = state("500"), before = canonicalSerialize(s);
    expect(() => applyAccountingTransactionAtomically(s, r.originalTransaction, d2SettlementPostingRegistration(r, "original"))).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
    const wrongRole = d2SettlementPostingRegistration(r, "settlement");
    expect(() => applyAccountingTransactionAtomically(s, r.originalTransaction, wrongRole)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("protects immutable content, orphan commitment IDs, ownership and sparse history", () => {
    const r = admit(card()), s = createIndexedExecutionState(state());
    applyD2SettlementAtomically(s, r, context);
    const proof = s.d2PostedTransactions![r.originalTransaction.id]!;
    expect(Object.isFrozen(proof.transaction.legs)).toBe(true);
    expect(Object.isFrozen(proof.registration)).toBe(true);
    expect(() => { delete s.d2PostedTransactions![r.originalTransaction.id]; }).toThrow();
    expect(() => { s.d2PostedTransactions![r.originalTransaction.id] = { ...proof, writer: "applyAccountingTransactionAtomically/v1",
      transaction: createAccountingTransaction({ ...proof.transaction, type: "changed" }) }; }).toThrow();
    expect(() => { s.d2PostedTransactions![accountingTransactionId("forged-append")] = { ...proof,
      transaction: createAccountingTransaction({ ...proof.transaction, id: accountingTransactionId("forged-append") }) }; }).toThrow("Only the canonical accounting writer");
    expect(() => createAuthoritativeState({ ...s, d2PostedTransactions: {} })).toThrow();
    expect(() => createAuthoritativeState({ ...s, identities: { ...s.identities, postedTransactionIds: [] } })).toThrow();
    expect(() => createAuthoritativeState({ ...s, accounts: { [ids.bank]: { ...s.accounts[ids.bank]!,
      ownerId: domainId("person", "149a0000-0000-4000-8000-000000000009") } } })).toThrow();
    const copy = cloneAuthoritativeState(s);
    delete copy.d2PostedTransactions;
    expect(() => validateAuthoritativeState(copy)).toThrow();
    const unchanged = cloneAuthoritativeState(s);
    expect(d2PostedTransactionArchiveDelta(unchanged, s)).toEqual({ present: true, set: {}, remove: [] });
    expect(canonicalSerialize(unchanged)).toBe(canonicalSerialize(s));
  });

  it("refuses source reuse and plan rebinding while retaining the original unmatched posting", () => {
    const r = fsa("first-registered"), s = state("2500");
    applyAccountingTransactionAtomically(s, r.originalTransaction, d2SettlementPostingRegistration(r, "original"));
    const next = fsa("second-registered"), registration = d2SettlementPostingRegistration(r, "original");
    const before = canonicalSerialize(s);
    expect(() => applyAccountingTransactionAtomically(s, next.originalTransaction, registration)).toThrow("posting reused");
    expect(canonicalSerialize(s)).toBe(before);
    if (registration.kind !== "fsa_paid_reimbursement") throw new Error("Expected FSA fixture");
    expect(() => applyAccountingTransactionAtomically(s, next.originalTransaction, { ...registration, planId: "other-plan" })).toThrow("source rebound");
    expect(canonicalSerialize(s)).toBe(before);
  });

  it.each(["2026-02-11T00:00:00.000Z", "2026-03-16T00:00:00.000Z"])(
    "discards all staged postings if a later same-period operation fails at %s in detail and summary", atText => {
    for (const tier of ["summary", "detail"] as const) {
      const r = admit(laterReceipt()), f = replayFixture(false, 13, false, true), at = instant(atText);
      const failure: HouseholdKernelParticipant = { id: "later_failure", version: "1", economicInputs: at,
        prepare: (_context, period) => ({ id: "later_failure", operations: at >= period.start && at < period.end ? [{
          descriptor: { id: "fail-after-canonical-posting", domain: "later_failure", sequencingInstant: at,
            dependsOn: [], resourceAccesses: [], traceRefs: [] },
          execute: () => { throw new ValidationError({ severity: "error", code: "SYNTHETIC_LATE_FAILURE", message: "Rejected period", entityType: "test" }); },
        }] : [] }) };
      const request = { kernel: f.kernel, runContext: f.runContext, participants: [failure] };
      const result = tier === "detail" ? runHouseholdKernel({ ...request, resultTier: "detail" }) : runHouseholdKernel(request);
      const failedFirst = atText.startsWith("2026-02");
      expect(result.periods).toHaveLength(failedFirst ? 0 : 1);
      expect(result.state.d2SettlementReceipts).toBeUndefined();
      expect(result.state.identities.postedTransactionIds).toHaveLength(failedFirst ? 0 : 1);
      expect(Object.keys(result.state.d2PostedTransactions ?? {})).toEqual(failedFirst ? [] : [r.originalTransaction.id]);
      expect(result.state.accounts[ids.bank]!.cash.equals(money(failedFirst ? "1500" : "500"))).toBe(true);
      expect(f.opening.d2PostedTransactions).toBeUndefined();
      expect(f.opening.identities.postedTransactionIds).toHaveLength(0);
    }
  });

  it("keeps only the prior period original when late payment-source requalification fails", () => {
    admit(laterReceipt()); availability.failAt = 2;
    const f = replayFixture(false, 13, false, true), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.runContext });
    expect(result.periods).toHaveLength(1);
    expect(Object.keys(result.state.d2PostedTransactions!)).toHaveLength(1);
    expect(result.state.identities.postedTransactionIds).toHaveLength(1);
    expect(result.state.d2SettlementReceipts).toBeUndefined();
    expect(result.state.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
  });

  it("discards preview postings and receipts when same-instant participant work has no authenticated order", () => {
    for (const tier of ["summary", "detail"] as const) {
      const participants: HouseholdKernelParticipant[] = ["a", "b"].map(id => {
        const base = fsa(`competing:${id}`), at = instant("2026-02-15T00:00:00.000Z");
        const receipt = admit({ ...base, effectiveAt: at,
          originalTransaction: createAccountingTransaction({ ...base.originalTransaction, date: at }),
          paymentTransaction: createAccountingTransaction({ ...base.paymentTransaction, date: at }) });
        return { id, version: "1", economicInputs: receipt.source,
          prepare: (context, period) => ({ id, operations: at < period.start || at >= period.end ? [] : [{
            descriptor: { id: receipt.operationId, domain: id, sequencingInstant: at, dependsOn: [], traceRefs: [],
              resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }] },
            execute: opening => {
              const result = applyD2SettlementAtomically(opening.state, receipt, context);
              if (result.status !== "committed") throw new Error("Expected individually qualified receipt");
              return { ...opening, facts: { transactions: [receipt.originalTransaction, receipt.paymentTransaction] } };
            },
          }] }) };
      });
      const f = replayFixture(false), request = { kernel: f.kernel, runContext: f.runContext, participants };
      const result = tier === "detail" ? runHouseholdKernel({ ...request, resultTier: "detail" }) : runHouseholdKernel(request);
      expect(result.periods).toHaveLength(0);
      expect(result.state.d2PostedTransactions).toBeUndefined();
      expect(result.state.d2SettlementReceipts).toBeUndefined();
      expect(result.state.identities.postedTransactionIds).toHaveLength(0);
      expect(result.state.accounts[ids.bank]!.cash.equals(money("1500"))).toBe(true);
      expect(f.opening.d2PostedTransactions).toBeUndefined();
    }
  });
});
