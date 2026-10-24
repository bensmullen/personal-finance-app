import { describe, expect, it } from "vitest";
import { applyD2HelocOriginalAtomically, applyD2SettlementAtomically, cloneAuthoritativeState, createAuthoritativeState,
  requalifyD2SettlementReceiptHistory, d2PostedTransactionArchiveDelta } from "../../../../src/state/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { deriveStatements } from "../../../../src/statements/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { admitted, authorityStatus, context, ids, opening, sources, original, reconstruct } from "./scenario.js";

describe("P1 canonical HELOC original/settlement archive", () => {
  it("regenerates B1 computed interest rather than treating an issuer tag as proof", () => {
    const raw = original("computed"), r = raw.request;
    const { issuerQuote: _quote, ...terms } = r.terms!;
    const request = { ...r, terms: { ...terms, method: "b1_daily_simple" as const, allocation: null }, line: { ...r.line,
      rate: { source: r.line.source, indexId: "synthetic-index", spreadPpm: 20000n, lookbackDays: 2, resetIntervalDays: 365,
        priorResetAt: r.line.period.start, priorRatePpm: 60000n, nextResetOrdinal: 1, roundingIncrementPpm: 1000n, rounding: "half_up" as const,
        initialCapPpm: 20000n, recurringCapPpm: 10000n, lifetimeFloorPpm: 30000n, lifetimeCeilingPpm: 120000n,
        legalMaximum: null, resets: [], observations: [] } } };
    const source = { ...raw, request }; sources.set("computed", source);
    const receipt = reconstruct("computed", source)!;
    expect(receipt.interest.equals(money("5.10"))).toBe(true);
    expect(applyD2SettlementAtomically(opening(), receipt, context).status).toBe("committed");
  });
  it("settles a fully sourced final balloon fee as expense and never as principal", () => {
    const raw = original("balloon"), r = raw.request, t = r.terms!, q = t.issuerQuote!;
    const phase = { ...t.phase, kind: "balloon" as const, endExclusive: r.line.period.endExclusive }, total = money("1007.10");
    const source = { ...raw, bankOpening: money("2000"), feeNature: "documented_service_expense" as const,
      bankDebit: { ...raw.bankDebit, amount: total }, request: { ...r,
        line: { ...r.line, maturityAt: phase.endExclusive, phases: [r.line.phases[0]!, phase] },
        terms: { ...t, phase, total, closingPrincipal: money("0"), allocation: { ...t.allocation!, principal: money("1000") },
          issuerQuote: { ...q, principal: money("1000"), closingPrincipal: money("0"), fees: money("2"), total },
          finalQuote: { source: t.source, dueAt: t.dueAt, principal: money("1000"), interest: money("5.10"), fee: { amount: money("2"), source: t.source } } },
        payment: { ...r.payment, amount: total, funding: { ...r.payment.funding!, amount: total } } } };
    sources.set("balloon", source);
    const receipt = reconstruct("balloon", source)!, state = opening(); state.accounts[ids.bank]!.cash = money("2000");
    expect(applyD2SettlementAtomically(state, receipt, context).status).toBe("committed");
    expect(state.accounts[ids.bank]!.cash.equals(money("992.90"))).toBe(true);
    expect(state.liabilities[ids.principal]!.balance.isZero()).toBe(true);
    expect(receipt.originalTransaction.legs[0]!.amount.equals(money("7.10"))).toBe(true);
  });
  it("reduces principal separately from recognized interest and actual BANK gross", () => {
    const receipt = admitted(), state = opening();
    expect(applyD2SettlementAtomically(state, receipt, context).status).toBe("committed");
    expect(state.accounts[ids.bank]!.cash.equals(money("394.90"))).toBe(true);
    expect(state.liabilities[ids.principal]!.balance.equals(money("900"))).toBe(true);
    expect(state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    const statements = deriveStatements(state, [receipt.originalTransaction, receipt.paymentTransaction], USD);
    expect(statements.netWorth.equals(money("-505.10"))).toBe(true);
    const before = canonicalSerialize(state);
    expect(applyD2SettlementAtomically(state, receipt, context).status).toBe("already_committed");
    expect(canonicalSerialize(state)).toBe(before);
    requalifyD2SettlementReceiptHistory(createAuthoritativeState(state), context);
    const delta = d2PostedTransactionArchiveDelta(state, opening());
    expect(Object.keys(delta.set)).toHaveLength(2);
  });
  it("supports one authentic zero-charge principal journal without a phantom original expense", () => {
    const receipt = admitted("zero", "0"), state = opening();
    expect(receipt.originalTransaction).toBe(receipt.paymentTransaction);
    expect(applyD2SettlementAtomically(state, receipt, context).status).toBe("committed");
    expect(Object.keys(state.d2PostedTransactions!)).toHaveLength(1);
    expect(receipt.paymentTransaction.legs.some(l => l.type === "expense")).toBe(false);
    expect(state.accounts[ids.bank]!.cash.equals(money("400"))).toBe(true);
    expect(state.liabilities[ids.principal]!.balance.equals(money("900"))).toBe(true);
    requalifyD2SettlementReceiptHistory(createAuthoritativeState(state), context);
    expect(applyD2SettlementAtomically(state, receipt, context).status).toBe("already_committed");
  });
  it("pairs an earlier actually archived charge with exactly one later settlement", () => {
    const receipt = admitted("paired"), state = opening();
    expect(applyD2HelocOriginalAtomically(state, receipt, context).status).toBe("qualified");
    expect(state.liabilities[ids.principal]!.balance.equals(money("1000"))).toBe(true);
    expect(state.liabilities[ids.charges]!.balance.equals(money("5.10"))).toBe(true);
    expect(applyD2SettlementAtomically(state, receipt, context).status).toBe("committed");
    expect(state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
  });
  it("re-evaluates the independent original B1 request and actual debit on cold restore", () => {
    const receipt = admitted("restore"), state = opening();
    applyD2SettlementAtomically(state, receipt, context);
    const original = sources.get("restore")!, t = original.request.terms!, q = t.issuerQuote!;
    sources.set("restore", { ...original, bankDebit: { ...original.bankDebit, authenticated: false },
      request: { ...original.request, payment: { ...original.request.payment, status: "settled" } } });
    expect(() => requalifyD2SettlementReceiptHistory(createAuthoritativeState(state), context)).toThrow("SOURCE_INCOMPLETE");
    sources.set("restore", original);
    sources.set("restore", { ...original, request: { ...original.request, terms: { ...t, issuerQuote: { ...q,
      source: { ...q.source, sourcePublication: "altered original publisher text" } } } } });
    expect(() => requalifyD2SettlementReceiptHistory(state, context)).toThrow("differs");
    sources.set("restore", original);
    sources.set("restore", { ...original, request: { ...original.request, terms: { ...t, issuerQuote: { ...q, interest: money("5.11") } } } });
    expect(() => requalifyD2SettlementReceiptHistory(state, context)).toThrow("SOURCE_INCOMPLETE");
    sources.set("restore", original);
    authorityStatus.available = false;
    try { expect(() => requalifyD2SettlementReceiptHistory(state, context)).toThrow("SOURCE_INCOMPLETE"); }
    finally { authorityStatus.available = true; }
    requalifyD2SettlementReceiptHistory(state, context);
    expect(state.accounts[ids.bank]!.cash.equals(money("394.90"))).toBe(true);
  });
  it("rejects stale balances, changed identity, unsigned fees and renamed approvals atomically", () => {
    const receipt = admitted("reject"), state = opening(), before = canonicalSerialize(state);
    expect(() => applyD2SettlementAtomically(state, { ...receipt, operationId: "renamed" }, context)).toThrow("differs");
    expect(() => applyD2SettlementAtomically(state, { ...receipt, feeNature: "unsupported" as typeof receipt.feeNature }, context)).toThrow();
    const stale = cloneAuthoritativeState(state); stale.liabilities[ids.principal]!.balance = money("999");
    expect(() => applyD2SettlementAtomically(stale, receipt, context)).toThrow("principal opening");
    const unfunded = cloneAuthoritativeState(state); unfunded.accounts[ids.bank]!.cash = money("1");
    expect(() => applyD2SettlementAtomically(unfunded, receipt, context)).toThrow("BANK opening");
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("keeps 1/12/120 monthly proofs bounded and validates unchanged hot-path archives without source rescans", () => {
    const sizes = [1, 12, 120].map(n => canonicalSerialize(Array.from({ length: n }, (_, i) => {
      const raw = original(`monthly:${i}`, "5.10", i);
      return reconstruct(`monthly:${i}`, raw)!;
    })).length);
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[0]! * 130);
    const receipt = admitted("hot"), state = opening(); authorityStatus.calls = 0;
    applyD2SettlementAtomically(state, receipt, context);
    expect(authorityStatus.calls).toBe(2);
    let previous = state;
    for (let i = 0; i < 120; i++) {
      const clone = cloneAuthoritativeState(previous);
      expect(Object.keys(d2PostedTransactionArchiveDelta(clone, previous).set)).toHaveLength(0);
      previous = clone;
    }
    expect(authorityStatus.calls).toBe(2);
  });
});
