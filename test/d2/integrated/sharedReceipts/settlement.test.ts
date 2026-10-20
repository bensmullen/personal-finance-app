import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, assertAuthoritativeStateCurrency,
  authoritativeStateChangesSince, cloneAuthoritativeState, createAuthoritativeState, createIndexedExecutionState,
  d2SettlementPostingRegistration, d2SettlementSourceFingerprint, requalifyD2SettlementReceiptHistory, validateAuthoritativeState,
  type D2CardSettlementReceipt, type D2FsaSettlementReceipt, type D2SettlementReceipt } from "../../../../src/state/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { Currency, money } from "../../../../src/values/index.js";
import { admit, availability, card, context, fsa, ids, independentSources, registerMockAuthorities, state } from "./scenario.js";

registerMockAuthorities();
beforeEach(() => {
  independentSources.clear();
  availability.source = true; availability.calls = 0; availability.failAt = 0;
});
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
const unchanged = (r: D2SettlementReceipt, cash = r.kind === "fsa_paid_reimbursement" ? "1500" : "500") => {
  const s = createIndexedExecutionState(state(cash)), before = canonicalSerialize(s);
  try { const result = applyD2SettlementAtomically(s, r, context); expect(result.status).toBe("incomplete"); }
  catch (error) { expect(error).toBeInstanceOf(Error); }
  expect(canonicalSerialize(s)).toBe(before);
};

describe("#149 typed shared settlement foundation (independent mock sources only)", () => {
  it("posts $20 issuer interest, then $200 funded payment; only $20 changes net worth", () => {
    const r = admit(card()), s = createIndexedExecutionState(state());
    const result = applyD2SettlementAtomically(s, r, context);
    expect(result.status).toBe("committed");
    expect(s.accounts[ids.bank]!.cash.equals(money("300"))).toBe(true);
    expect(s.liabilities[ids.liability]!.balance.equals(money("820"))).toBe(true);
    expect(s.accounts[ids.bank]!.cash.minus(s.liabilities[ids.liability]!.balance).equals(money("-520"))).toBe(true);
    expect(r.interestAllocation.plus(r.principalAllocation).equals(money("200"))).toBe(true);
    expect(r.paymentTransaction.legs.some(l => l.type === "expense")).toBe(false);
    expect(s.identities.postedTransactionIds).toHaveLength(2);
    const before = canonicalSerialize(s);
    expect(applyD2SettlementAtomically(s, r, context).status).toBe("already_committed");
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("pays eligible $1000 expense before equal plan deposit, with no wage or entitlement asset", () => {
    const r = admit(fsa()), s = state("1500");
    const paid = cloneAuthoritativeState(s);
    applyAccountingTransactionAtomically(paid, r.originalTransaction, d2SettlementPostingRegistration(r, "original"));
    expect(paid.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
    expect(applyD2SettlementAtomically(paid, r, context).status).toBe("committed");
    expect(paid.accounts[ids.bank]!.cash.equals(money("1500"))).toBe(true);
    expect(paid.identities.postedTransactionIds).toHaveLength(2);
    expect(paid.positions).toEqual({});
    expect(paid.obligations).toEqual({});
    expect([...r.originalTransaction.legs, ...r.paymentTransaction.legs].some(l => l.type === "income" || l.type === "asset")).toBe(false);
    const original = canonicalSerialize(paid);
    expect(applyD2SettlementAtomically(paid, r, context).status).toBe("already_committed");
    expect(canonicalSerialize(paid)).toBe(original);
  });

  it("also applies original expense and reimbursement in one isolated candidate", () => {
    const r = admit(fsa()), s = state("1500");
    expect(applyD2SettlementAtomically(s, r, context).status).toBe("committed");
    expect(s.accounts[ids.bank]!.cash.equals(money("1500"))).toBe(true);
    expect(s.identities.postedTransactionIds).toHaveLength(2);
  });

  it.each(["500", "500.01"])("records only the authenticated $%s partial reimbursement and consumes the claim once", amount => {
    const r = admit(fsa("partial", amount)), s = state("1500");
    applyAccountingTransactionAtomically(s, r.originalTransaction, d2SettlementPostingRegistration(r, "original"));
    expect(s.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
    const result = applyD2SettlementAtomically(s, r, context);
    expect(result.status).toBe("committed");
    if (result.status === "incomplete") throw new Error("Expected authenticated allocation");
    expect(result.remainingReimbursement).toEqual({ status: "incomplete", reason: "entitlement_installment_port_required",
      unreimbursedExpense: money("1000").minus(money(amount)) });
    expect(s.accounts[ids.bank]!.cash.equals(money("500").plus(r.amount))).toBe(true);
    expect(r.eligibleExpense.minus(r.amount).equals(money("1000").minus(money(amount)))).toBe(true);
    expect(s.obligations).toEqual({}); // No claim-wide settled assertion.
    expect(s.positions).toEqual({});
    expect(s.identities.postedTransactionIds).toHaveLength(2);
    const before = canonicalSerialize(s);
    const repeat = applyD2SettlementAtomically(s, r, context);
    expect(repeat).toMatchObject({ status: "already_committed", remainingReimbursement: result.remainingReimbursement });
    expect(() => applyD2SettlementAtomically(s, admit(fsa("partial", "600")), context)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it.each(["0", "1000.01"])("rejects independently approved reimbursement outside the paid expense: %s", amount => {
    unchanged(admit(fsa("out-of-range", amount)));
  });

  it.each(["499.99", "500.01"])("rejects entitlement consumption %s unequal to partial deposit", consumed => {
    unchanged(admit({ ...fsa("partial-consumption", "500"), entitlementConsumed: money(consumed) }));
  });

  it("accepts independently verified prior card recognition without recognizing interest twice", () => {
    const r = admit(card()), s = state();
    applyAccountingTransactionAtomically(s, r.originalTransaction, d2SettlementPostingRegistration(r, "original"));
    expect(s.liabilities[ids.liability]!.balance.equals(money("1020"))).toBe(true);
    expect(applyD2SettlementAtomically(s, r, context).status).toBe("committed");
    expect(s.liabilities[ids.liability]!.balance.equals(money("820"))).toBe(true);
    expect(s.identities.postedTransactionIds).toHaveLength(2);
  });

  it("keeps large original/principal values and exact cents without floating point", () => {
    const base = card("large"), principal = money("9007199254740993.01"), interest = money("0.01");
    const amount = money("200.01"), s = state("9007199254740993.02", principal.amount.toString());
    const r = admit({ ...base, bankCashBefore: s.accounts[ids.bank]!.cash, liabilityBefore: principal,
      amount, postedInterest: interest, interestAllocation: interest, principalAllocation: money("200"),
      originalTransaction: createAccountingTransaction({ ...base.originalTransaction, legs: [
        createAccountingLeg({ type: "expense", posting: "debit", amount: interest }),
        createAccountingLeg({ type: "liability", posting: "credit", entityId: ids.liability, amount: interest }),
      ] }), paymentTransaction: createAccountingTransaction({ ...base.paymentTransaction, legs: [
        createAccountingLeg({ type: "liability", posting: "debit", entityId: ids.liability, amount }),
        createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount, cashFlowClass: "operating" }),
      ] }) });
    expect(applyD2SettlementAtomically(s, r, context).status).toBe("committed");
    expect(s.accounts[ids.bank]!.cash.equals(money("9007199254740793.01"))).toBe(true);
    expect(s.liabilities[ids.liability]!.balance.equals(money("9007199254740793.01"))).toBe(true);
  });

  const cardChanges: readonly [string, (r: D2CardSettlementReceipt) => D2CardSettlementReceipt][] = [
    ["amount", r => ({ ...r, amount: money("201") })],
    ["allocation", r => ({ ...r, interestAllocation: money("19"), principalAllocation: money("181") })],
    ["negative money", r => ({ ...r, feeAllocation: money("-1") })],
    ["missing approval", r => ({ ...r, source: { ...r.source, paymentApprovalId: "" } })],
    ["changed source/version", r => ({ ...r, source: { ...r.source, sourceVersion: "altered" } })],
    ["copied hash with changed issuer", r => ({ ...r, source: { ...r.source, issuerId: "other" } })],
    ["recomputed hash with changed issuer", r => {
      const source = { ...r.source, issuerId: "other" };
      return { ...r, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) };
    }],
    ["cross-person", r => ({ ...r, source: { ...r.source, personId: domainId("person", "149a0000-0000-4000-8000-000000000005") } })],
    ["cross-household", r => ({ ...r, source: { ...r.source, householdId: domainId("household", "149a0000-0000-4000-8000-000000000006") } })],
    ["nonexistent BANK", r => ({ ...r, bankAccountId: domainId("account", "149a0000-0000-4000-8000-000000000007") })],
    ["nonexistent liability", r => ({ ...r, liabilityId: domainId("liability", "149a0000-0000-4000-8000-000000000008") })],
    ["payment before recognition", r => ({ ...r, originalTransaction: createAccountingTransaction({ ...r.originalTransaction, date: instant("2026-01-16T00:00:00.000Z") }) })],
    ["signed payment legs reversed", r => ({ ...r, paymentTransaction: createAccountingTransaction({ ...r.paymentTransaction, legs: [
      createAccountingLeg({ type: "liability", posting: "credit", entityId: ids.liability, amount: r.amount }),
      createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.bank, amount: r.amount, cashFlowClass: "operating" }),
    ] }) })],
    ["payment misclassified as expense", r => ({ ...r, paymentTransaction: createAccountingTransaction({ ...r.paymentTransaction, legs: [
      createAccountingLeg({ type: "expense", posting: "debit", amount: r.amount }),
      createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount: r.amount, cashFlowClass: "operating" }),
    ] }) })],
  ];
  it.each(cardChanges)("rejects %s without any state mutation", (_name, change) => {
    const original = admit(card()); unchanged(change(original));
  });

  const fsaChanges: readonly [string, (r: D2FsaSettlementReceipt) => D2FsaSettlementReceipt][] = [
    ["changed amount without corresponding source or journal", r => ({ ...r, amount: money("999") })],
    ["unconsumed entitlement", r => ({ ...r, entitlementConsumed: money("0") })],
    ["cross-plan", r => { const source = { ...r.source, planId: "different-plan" };
      return { ...r, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) }; }],
    ["expense predates service", r => ({ ...r, source: { ...r.source, incurredAt: instant("2026-01-20T00:00:00.000Z") } })],
    ["missing paid expense ID", r => ({ ...r, source: { ...r.source, expensePaymentId: "" } })],
    ["missing medical receipt", r => ({ ...r, source: { ...r.source, medicalReceiptId: "" } })],
  ];
  it.each(fsaChanges)("rejects FSA %s atomically", (_name, change) => { const r = admit(fsa()); unchanged(change(r)); });

  it("refuses unavailable/unqualified sources, bounced payments and event-unknown sources", () => {
    unchanged(card());
    const r = admit(card()); availability.source = false; unchanged(r);
    availability.source = true;
    const future = { ...r, source: { ...r.source, knownAt: instant("2026-01-02T00:00:00.000Z") } };
    unchanged({ ...future, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(future.source) });
    // A bounced bank confirmation has no independently qualified paid source.
    independentSources.delete(r.source.sourceId); unchanged(r);
  });

  it("rolls back interest recognition, identity reservations and receipts if second journal is unfunded", () => {
    const r = admit({ ...card(), bankCashBefore: money("100") });
    unchanged(r, "100");
  });
  it("does not finance an FSA expense with its later reimbursement", () => {
    const r = admit({ ...fsa(), bankCashBefore: money("500") }); unchanged(r, "500");
  });
  it("rolls back the entire candidate on late source loss", () => {
    const r = admit(card()); availability.failAt = 2; unchanged(r);
  });
  it("requires actual prior journal lookup, not a posted ID or copied source proof", () => {
    const r = admit(fsa()), s = state("1500");
    applyAccountingTransactionAtomically(s, r.originalTransaction);
    const before = canonicalSerialize(s);
    expect(applyD2SettlementAtomically(s, r, context)).toEqual({ status: "incomplete", reason: "original_journal_unavailable" });
    expect(canonicalSerialize(s)).toBe(before);
    const differentlyPosted = state("1500");
    applyAccountingTransactionAtomically(differentlyPosted, createAccountingTransaction({ ...r.originalTransaction, type: "altered-original" }),
      d2SettlementPostingRegistration(r, "original"));
    expect(() => applyD2SettlementAtomically(differentlyPosted, r, context)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it.each(["id", "operationId", "authorizationId", "claimId", "paymentId", "recognitionId", "settlementId"] as const)(
    "rejects reused %s even with a newly qualified source", field => {
      const first = admit(card("first")), s = state(); applyD2SettlementAtomically(s, first, context);
      const next = card("second");
      const changed = admit({ ...next, bankCashBefore: money("300"), liabilityBefore: money("820"), [field]: first[field] });
      const before = canonicalSerialize(s);
      expect(() => applyD2SettlementAtomically(s, changed, context)).toThrow();
      expect(canonicalSerialize(s)).toBe(before);
    });

  it("rejects changed repeated payloads and duplicate expense/charge aliases", () => {
    const r = admit(card()), s = state(); applyD2SettlementAtomically(s, r, context);
    const before = canonicalSerialize(s);
    const changed = admit({ ...r, operationId: "changed" });
    expect(() => applyD2SettlementAtomically(s, changed, context)).toThrow();
    const second = card("alias");
    const source = { ...second.source, chargeId: r.source.chargeId };
    const alias = admit({ ...second, bankCashBefore: money("300"), liabilityBefore: money("820"), source,
      sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) });
    expect(() => applyD2SettlementAtomically(s, alias, context)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("rejects same-day competing work after one committed debit", () => {
    const s = createIndexedExecutionState(state()), a = admit(card("a")), b = admit(card("b"));
    applyD2SettlementAtomically(s, a, context); const before = canonicalSerialize(s);
    expect(() => applyD2SettlementAtomically(s, b, context)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("rejects two valid same-instant receipts even when the second has correct updated openings", () => {
    const s = createIndexedExecutionState(state()), a = admit(card("unordered-a"));
    const b = admit({ ...card("unordered-b"), bankCashBefore: money("300"), liabilityBefore: money("820") });
    expect(applyD2SettlementAtomically(s, a, context).status).toBe("committed");
    const before = canonicalSerialize(s);
    expect(() => applyD2SettlementAtomically(s, b, context)).toThrow("source-authenticated execution order");
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("accepts source-authenticated resource order and preserves it across cold import", () => {
    const orderedCard = (key: string, position: number, cash: string, liability: string) => {
      const base = card(key), source = { ...base.source, executionOrder: { sequenceId: "issuer-bank-approved", position } };
      return { ...base, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source),
        bankCashBefore: money(cash), liabilityBefore: money(liability) };
    };
    const s = state("900"), a = admit(orderedCard("z-first", 1, "900", "1000"));
    const b = admit(orderedCard("a-second", 2, "700", "820"));
    expect(applyD2SettlementAtomically(s, a, context).status).toBe("committed");
    expect(applyD2SettlementAtomically(s, b, context).status).toBe("committed");
    const imported = createAuthoritativeState({ ...s, d2SettlementReceipts: { [b.id]: b, [a.id]: a } });
    expect(imported.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
    expect(imported.liabilities[ids.liability]!.balance.equals(money("640"))).toBe(true);
    const before = canonicalSerialize(imported);
    const c = admit(orderedCard("out-of-order", 1, "500", "640"));
    expect(() => applyD2SettlementAtomically(imported, c, context)).toThrow("source-authenticated execution order");
    expect(canonicalSerialize(imported)).toBe(before);
  });

  it("accepts independently sourced events at distinct economic instants without an artificial sequence", () => {
    const s = state("1500"), first = admit(fsa("earlier"));
    expect(applyD2SettlementAtomically(s, first, context).status).toBe("committed");
    const base = fsa("later"), later = admit({ ...base, effectiveAt: instant("2026-01-17T00:00:00.000Z"),
      originalTransaction: createAccountingTransaction({ ...base.originalTransaction, date: instant("2026-01-16T00:00:00.000Z") }),
      paymentTransaction: createAccountingTransaction({ ...base.paymentTransaction, date: instant("2026-01-17T00:00:00.000Z") }) });
    expect(applyD2SettlementAtomically(s, later, context).status).toBe("committed");
    expect(s.identities.postedTransactionIds).toHaveLength(4);
  });

  it.each(["different-sequence", "reused-position", "forged-witness"] as const)("rejects %s with otherwise valid updated funding", mode => {
    const base = card("ordered-first"), source = { ...base.source,
      executionOrder: { sequenceId: "approved-sequence", position: 1 } };
    const first = admit({ ...base, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) }), s = state();
    expect(applyD2SettlementAtomically(s, first, context).status).toBe("committed");
    const next = card("ordered-second"), nextSource = { ...next.source,
      executionOrder: { sequenceId: mode === "different-sequence" ? "unrelated" : "approved-sequence",
        position: mode === "reused-position" ? 1 : 2 } };
    const second = { ...next, bankCashBefore: money("300"), liabilityBefore: money("820"), source: nextSource,
      sourceEvidenceFingerprint: d2SettlementSourceFingerprint(nextSource) };
    if (mode === "forged-witness") admit({ ...next, bankCashBefore: money("300"), liabilityBefore: money("820") });
    else admit(second);
    const before = canonicalSerialize(s);
    expect(() => applyD2SettlementAtomically(s, second, context)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("rolls back both new journals when late history validation detects cross-issuer liability rebinding", () => {
    const s = createIndexedExecutionState(state()), first = admit(card("issuer-a"));
    applyD2SettlementAtomically(s, first, context);
    const base = card("issuer-b"), source = { ...base.source, issuerId: "different-issuer" };
    const next = admit({ ...base, bankCashBefore: money("300"), liabilityBefore: money("820"), source,
      sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) });
    const before = canonicalSerialize(s);
    expect(() => applyD2SettlementAtomically(s, next, context)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("consumes medical receipt aliases only once across otherwise distinct plan approvals", () => {
    const s = state("1500"), first = admit(fsa("first-medical")); applyD2SettlementAtomically(s, first, context);
    const base = fsa("second-medical"), source = { ...base.source, medicalReceiptId: first.source.medicalReceiptId };
    const next = admit({ ...base, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) });
    const before = canonicalSerialize(s);
    expect(() => applyD2SettlementAtomically(s, next, context)).toThrow();
    expect(canonicalSerialize(s)).toBe(before);
  });

  it("preserves optional absence, clones, sparse deltas, currency and append-only receipt history", () => {
    const opening = createIndexedExecutionState(state()), s = cloneAuthoritativeState(opening), r = admit(card());
    expect(opening.d2SettlementReceipts).toBeUndefined();
    applyD2SettlementAtomically(s, r, context);
    const delta = authoritativeStateChangesSince(s, opening, same);
    expect(delta).toMatchObject({ d2SettlementReceipts: { present: true, changes: [{ key: r.id, kind: "set" }] } });
    expect(authoritativeStateChangesSince(opening, opening, same)).not.toHaveProperty("d2SettlementReceipts");
    expect(canonicalSerialize(cloneAuthoritativeState(s))).toBe(canonicalSerialize(s));
    expect(canonicalSerialize(createAuthoritativeState(s))).toBe(canonicalSerialize(s));
    expect(() => assertAuthoritativeStateCurrency(s, Currency.of("EUR"))).toThrow();
    expect(() => { delete s.d2SettlementReceipts![r.id]; }).toThrow();
    expect(() => { s.d2SettlementReceipts![r.id] = { ...r, operationId: "rewritten" }; }).toThrow();
    expect(Object.isFrozen(s.d2SettlementReceipts![r.id]!.originalTransaction.legs)).toBe(true);
    const clone = cloneAuthoritativeState(s); delete clone.d2SettlementReceipts;
    expect(() => validateAuthoritativeState(clone)).toThrow();
    expect(() => createAuthoritativeState({ ...s, d2SettlementReceipts: {} })).toThrow();
  });

  it("rejects removed/altered imported journals and missing recognition/settlement identities", () => {
    const r = admit(card()), s = state(); applyD2SettlementAtomically(s, r, context);
    for (const identities of [
      { ...s.identities, postedTransactionIds: [r.originalTransaction.id] },
      { ...s.identities, recognitionIds: [] }, { ...s.identities, settlementIds: [] },
      { ...s.identities, externalIdempotencyKeys: [] },
    ]) expect(() => createAuthoritativeState({ ...s, identities })).toThrow();
    const changed = { ...r, paymentTransaction: createAccountingTransaction({ ...r.paymentTransaction, id: accountingTransactionId("unposted") }) };
    expect(() => createAuthoritativeState({ ...s, d2SettlementReceipts: { [r.id]: changed } })).toThrow();
  });

  it("structural import never proves source authenticity; explicit requalification fails closed", () => {
    const r = admit(card()), s = state(); applyD2SettlementAtomically(s, r, context);
    availability.source = false;
    const imported = createAuthoritativeState(s);
    expect(() => requalifyD2SettlementReceiptHistory(imported, context)).toThrow("D2_SETTLEMENT_SOURCE_INCOMPLETE");
    const before = canonicalSerialize(imported);
    expect(applyD2SettlementAtomically(imported, r, context).status).toBe("incomplete");
    expect(canonicalSerialize(imported)).toBe(before);
  });

  it("recovers actual journals from committed state independently of provider qualification", () => {
    const r = admit(card()), s = state(); applyD2SettlementAtomically(s, r, context);
    const imported = createAuthoritativeState(s), before = canonicalSerialize(imported);
    expect(applyD2SettlementAtomically(imported, r, context).status).toBe("already_committed");
    expect(() => requalifyD2SettlementReceiptHistory(imported, context)).not.toThrow();
    const original = imported.d2PostedTransactions![r.paymentTransaction.id]!;
    expect(() => createAuthoritativeState({ ...imported, d2PostedTransactions: { ...imported.d2PostedTransactions,
      [r.paymentTransaction.id]: { ...original, transaction: createAccountingTransaction({ ...r.paymentTransaction, type: "rewritten-payment" }) } } })).toThrow();
    expect(canonicalSerialize(imported)).toBe(before);
  });

  it.each(["BANK", "liability", "owner", "historical-identity"] as const)("rejects removal/rebinding of %s after commit", target => {
    const r = admit(card()), s = createIndexedExecutionState(state()); applyD2SettlementAtomically(s, r, context);
    const copy = cloneAuthoritativeState(s);
    if (target === "BANK") delete copy.accounts[ids.bank];
    else if (target === "liability") delete copy.liabilities[ids.liability];
    else if (target === "owner") copy.accounts[ids.bank] = { ...copy.accounts[ids.bank]!, ownerId: domainId("person", "149a0000-0000-4000-8000-000000000009") };
    else copy.identities = { ...copy.identities, postedTransactionIds: [r.originalTransaction.id] };
    expect(() => validateAuthoritativeState(copy)).toThrow();
  });
});
