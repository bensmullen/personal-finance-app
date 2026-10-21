import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { ValidationError } from "../../../../src/diagnostics/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, cloneAuthoritativeState,
  d2SettlementPostingRegistration, registerAuthoritativeIdentity } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createCardBankParticipant, qualifyCardBankSource, type CardBankDocument } from "../../../../src/simulation/d2/integration/cardBank/index.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { continuityDocument, document, fixture, ids, opening, publisher, registerPublisher, sourceId } from "./scenario.js";

registerPublisher();
beforeEach(() => { publisher.read = document; });
const qualified = () => {
  const f = fixture(), q = qualifyCardBankSource(sourceId, f.context);
  if (q.status !== "qualified") throw new Error(q.reason);
  return q.receipt;
};
describe("#203 real issuer-quoted charges and BANK settlement", () => {
  it("posts $20 in January, then debits $200 BANK in February without a second expense", () => {
    const f = fixture(), before = canonicalSerialize(f.state);
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context, resultTier: "detail" });
    expect(result.periods.map(p => p.cash.amount.toString())).toEqual(["500", "300"]);
    expect(result.periods.map(p => p.liabilities.amount.toString())).toEqual(["1020", "820"]);
    expect(result.periods.map(p => p.netWorth.amount.toString())).toEqual(["-520", "-520"]);
    expect(result.periods.map(p => p.transactions.flatMap(tx => tx.legs).filter(l => l.type === "expense").map(l => l.amount.amount.toString()))).toEqual([["20"], []]);
    const r = qualified();
    expect(result.state.d2SettlementReceipts?.[r.id]).toEqual(r);
    expect(r.interestAllocation.equals(money("20"))).toBe(true);
    expect(r.principalAllocation.equals(money("180"))).toBe(true);
    expect(Object.keys(result.state.d2PostedTransactions!)).toHaveLength(2);
    expect(result.periods.flatMap(p => p.transactions).flatMap(tx => tx.legs).some(l => l.type === "income" || l.type === "tax")).toBe(false);
    expect(canonicalSerialize(f.state)).toBe(before);
  });
  it("retains the recognized charge and unpaid minimum if actual BANK cash is insufficient", () => {
    const f = fixture(2, opening("10"));
    const r = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(r.state.accounts[ids.bank]!.cash.equals(money("10"))).toBe(true);
    expect(r.state.liabilities[ids.card]!.balance.equals(money("1020"))).toBe(true);
    expect(r.state.d2SettlementReceipts).toBeUndefined();
    expect(r.state.identities.postedTransactionIds).toEqual([accountingTransactionId("card-charge-january")]);
    expect(r.diagnostics.some(d => d.code === "CARD_BANK_S7_INCOMPLETE")).toBe(true);
  });
  it("does not retrofit a legacy charge ID or later balance into an actual archived journal", () => {
    const state = opening("500", "1020");
    registerAuthoritativeIdentity(state.identities, "postedTransactionIds", accountingTransactionId("card-charge-january"));
    const f = fixture(2, state), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.state.d2SettlementReceipts).toBeUndefined();
    expect(result.state.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
  });
  it("rejects wrong first-posting registration and preserves existing history", () => {
    const r = qualified(), state = opening();
    applyAccountingTransactionAtomically(state, r.originalTransaction, { ...d2SettlementPostingRegistration(r, "original"), operationId: "wrong-operation" });
    const before = canonicalSerialize(state), f = fixture(2, state);
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(0);
    expect(result.diagnostics.some(d => d.code === "CARD_BANK_SOURCE_CONFLICT")).toBe(true);
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("rejects a changed payment, allocation, or receipt even if its hash is copied", () => {
    const r = qualified(), state = opening(), f = fixture();
    expect(() => applyD2SettlementAtomically(state, { ...r, principalAllocation: money("181") }, f.context)).toThrow();
    expect(() => applyD2SettlementAtomically(state, { ...r, amount: money("201") }, f.context)).toThrow();
    expect(canonicalSerialize(state)).toBe(canonicalSerialize(opening()));
  });
  it("does not double-post an exact settled payment", () => {
    const f = fixture(), r = qualified(), state = opening();
    applyD2SettlementAtomically(state, r, f.context);
    const before = canonicalSerialize(state);
    expect(applyD2SettlementAtomically(state, r, f.context).status).toBe("already_committed");
    expect(canonicalSerialize(state)).toBe(before);
  });
  it.each<[string, (d: CardBankDocument) => CardBankDocument]>([
    ["changed signed amount", d => ({ ...d, payment: { ...d.payment, amount: money("201") } })],
    ["wrong fee split", d => ({ ...d, payment: { ...d.payment, allocation: { principal: money("179"), interest: money("20"), fees: money("1") } } })],
    ["wrong issuer", d => ({ ...d, payment: { ...d.payment, issuerId: "other" } })],
    ["wrong owner", d => ({ ...d, payment: { ...d.payment, personId: ids.other } })],
    ["wrong household", d => ({ ...d, payment: { ...d.payment, householdId: ids.other } })],
    ["wrong card", d => ({ ...d, payment: { ...d.payment, cardAccountId: ids.bank } })],
    ["wrong BANK", d => ({ ...d, payment: { ...d.payment, bankAccountId: ids.card } })],
    ["missing trusted instant provenance", d => ({ ...d, provenance: [] })],
    ["duplicate provenance", d => ({ ...d, provenance: [...d.provenance, ...d.provenance] })],
    ["expired quote", d => ({ ...d, payment: { ...d.payment, expiresAt: d.payment.effectiveAt } })],
    ["future authorization", d => ({ ...d, payment: { ...d.payment, authorizedAt: d.payment.expiresAt } })],
    ["future charge publication", d => ({ ...d, provenance: d.provenance.map(w => ({ ...w, knownAt: d.payment.effectiveAt })) })],
    ["future source knowledge", d => ({ ...d, payment: { ...d.payment, knownAt: d.payment.expiresAt } })],
    ["inconsistent cycle proof", d => ({ ...d, continuity: { knownAt: d.request.period.endExclusive, cycles: [] } })],
    ["changed cycle", d => ({ ...d, request: { ...d.request, period: { ...d.request.period, endExclusive: d.request.period.start } } })],
    ["changed interest", d => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c, charges: c.charges.map(x => ({ ...x, amount: money("21") })) })) } })],
    ["unsupported minimum formula", d => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c, minimum: { ...c.minimum, kind: "unsupported_formula" as const } })) } })],
    ["payment after due date", d => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c, dueDate: c.statementDate })) } })],
    ["unsupported future APR", d => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c, interestPolicy: "apr_accrual" as const })) } })],
    ["unverified issuer", d => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c, statementSource: { ...c.statementSource, projectionStatus: "explicit_projected" as const } })) } })],
  ])("returns typed S7 incomplete for %s", (_label, change) => {
    publisher.read = () => change(document());
    const q = qualifyCardBankSource(sourceId, fixture().context);
    expect(q.status).toBe("incomplete");
    if (q.status === "incomplete") expect(q.diagnosticSeam).toBe("S7");
  });
  it("rejects evidence outside the run cutoff and missing independent source authority", () => {
    const f = fixture();
    expect(qualifyCardBankSource(sourceId, { ...f.context, dataCutoff: instant("2026-01-01T00:00:00.000Z") }).status).toBe("incomplete");
    publisher.read = () => undefined;
    expect(qualifyCardBankSource(sourceId, f.context)).toMatchObject({ status: "incomplete", reason: "source_unavailable" });
  });
  it("preserves caller state when a later event fails after charge preparation", () => {
    const f = fixture(2, opening("501")), before = canonicalSerialize(f.state);
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(1);
    expect(result.state.d2SettlementReceipts).toBeUndefined();
    expect(result.state.identities.postedTransactionIds).toHaveLength(1);
    expect(Object.keys(result.state.d2PostedTransactions!)).toEqual([accountingTransactionId("card-charge-january")]);
    expect(canonicalSerialize(f.state)).toBe(before);
  });
  it("rejects BANK ownership conflicts", () => {
    const state = opening();
    state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, ownerId: ids.other };
    const f = fixture(2, state);
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(0);
    expect(result.diagnostics.some(d => d.code === "CARD_BANK_SOURCE_CONFLICT")).toBe(true);
  });
  it("rejects unresolved same-instant external BANK work before mutation", () => {
    const f = fixture(), r = qualified();
    const participant = createCardBankParticipant({ sourceIds: [sourceId] });
    expect(() => participant.prepare(f.context, f.periods[1]!, { state: f.state, primitiveState: createPrimitiveRuntimeStateStore() }, [{
      id: "other-payment", domain: "cash_flow", operationClass: "cash_expense_settlement", sequencingInstant: r.effectiveAt,
      dependsOn: [], resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }], traceRefs: [],
    }])).toThrow();
  });
  it("rejects changed raw issuer dates between preparation and execution", () => {
    const f = fixture(), state = opening(), participant = createCardBankParticipant({ sourceIds: [sourceId] });
    const primitiveState = createPrimitiveRuntimeStateStore();
    const prepared = participant.prepare(f.context, f.periods[0]!, { state, primitiveState });
    publisher.read = () => ({ ...document(), request: { ...document().request, cards: document().request.cards.map(c => ({
      ...c, dueDate: c.payment.effectiveAt,
    })) } });
    const original = prepared.operations.find(o => o.descriptor.id === "card-charge-january")!;
    expect(() => original.execute({ state, primitiveState }, new Map())).toThrow();
    expect(canonicalSerialize(state)).toBe(canonicalSerialize(opening()));
  });
  it("keeps original archive immutable when settlement source changes", () => {
    const r = qualified(), state = cloneAuthoritativeState(opening());
    applyAccountingTransactionAtomically(state, r.originalTransaction, { ...d2SettlementPostingRegistration(r, "original"), operationId: r.originalTransaction.id });
    const before = canonicalSerialize(state);
    publisher.read = () => ({ ...document(), payment: { ...document().payment, amount: money("201") } });
    expect(applyD2SettlementAtomically(state, r, fixture().context).status).toBe("incomplete");
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("keeps already-recognized legacy evidence incomplete without its actual journal", () => {
    publisher.read = () => ({ ...document(), request: { ...document().request,
      cards: document().request.cards.map(c => ({ ...c, charges: c.charges.map(x => ({ ...x, recognition: "already_recognized" as const })) })) } });
    const f = fixture(), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.state.d2PostedTransactions).toBeUndefined();
    expect(result.state.liabilities[ids.card]!.balance.equals(money("1000"))).toBe(true);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
  });
  it("isolates separate owners, BANK accounts and issuer liabilities", () => {
    const bank = domainId("account", "203b0000-0000-4000-8000-000000000001");
    const card = domainId("liability", "203b0000-0000-4000-8000-000000000002");
    const d = document(), c = d.request.cards[0]!, s = { ...c.statementSource, personId: ids.other, cardAccountId: card };
    const second: CardBankDocument = { ...d, sourceId: "second-owner", statementId: "second-statement", quoteId: "second-quote", sourceApprovalId: "second-approval",
      request: { ...d.request, cards: [{ ...c, personId: ids.other, cardAccountId: card, statementId: "second-statement", statementSource: s,
        minimum: { ...c.minimum, source: s }, postingPolicy: { ...c.postingPolicy, source: s }, allocationPolicy: { ...c.allocationPolicy, source: s },
        charges: c.charges.map(x => ({ ...x, source: s, postingId: "second-interest" })),
        payment: { ...c.payment, source: s, payerId: ids.other, sourceAccountId: bank, operationId: "second-payment-op" } }] },
      provenance: d.provenance.map(w => ({ ...w, source: s })), charge: { ...d.charge, evidenceId: "second-interest", postingIds: ["second-interest"], operationId: "second-charge-op" },
      payment: { ...d.payment, personId: ids.other, cardAccountId: card, bankAccountId: bank, approvalId: "second-payment-approval",
        authorizationId: "second-signature", paymentId: "second-payment", settlementId: "second-settlement" } };
    publisher.read = id => id === sourceId ? document() : id === second.sourceId ? second : undefined;
    const state = opening();
    state.accounts[bank] = { id: bank, kind: "savings", ownerId: ids.other, cash: money("500") };
    state.liabilities[card] = { id: card, balance: money("1000") };
    const f = fixture(2, state, [second.sourceId, sourceId]);
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(2);
    for (const id of [bank, ids.bank]) expect(result.state.accounts[id]!.cash.equals(money("300"))).toBe(true);
    for (const id of [card, ids.card]) expect(result.state.liabilities[id]!.balance.equals(money("820"))).toBe(true);
    expect(Object.keys(result.state.d2SettlementReceipts!)).toHaveLength(2);
  });
  it("does not accept two lookup documents that reuse the same issuer quote", () => {
    publisher.read = id => ({ ...document(), sourceId: id });
    const f = fixture(2, opening(), [sourceId, "duplicate"]);
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(0);
    expect(result.state.identities.postedTransactionIds).toHaveLength(0);
  });
  it("rejects an underfunded original liability without inventing its opening principal", () => {
    const f = fixture(2, opening("500", "999")), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(0);
    expect(result.state.identities.postedTransactionIds).toHaveLength(0);
    expect(result.state.d2PostedTransactions).toBeUndefined();
    expect(result.state.liabilities[ids.card]!.balance.equals(money("999"))).toBe(true);
  });
  it("rolls back the complete original event period, including recognition identity, on a later failure", () => {
    const f = fixture();
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context, participants: [{
      id: "later-failure", version: "1", economicInputs: "synthetic-failure",
      prepare: (_context, period) => ({ id: "later-failure", operations: period.start !== f.periods[0]!.start ? [] : [{
        descriptor: { id: "fail-after-charge", domain: "test", sequencingInstant: instant("2026-01-31T18:00:00.000Z"),
          dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: () => { throw new ValidationError({ severity: "error", code: "SYNTHETIC_FAILURE", entityType: "test", message: "Fail after charge" }); },
      }] }),
    }] });
    expect(result.periods).toHaveLength(0);
    expect(canonicalSerialize(result.state)).toBe(canonicalSerialize(f.state));
  });
  it("preserves exact cents in an independently approved changed amount", () => {
    const d = document();
    publisher.read = () => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c,
      payment: { ...c.payment, funding: { kind: "requested" as const, amount: money("200.01") } } })) },
      payment: { ...d.payment, amount: money("200.01"), allocation: { interest: money("20"), principal: money("180.01"), fees: money("0") } } });
    const f = fixture(), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(2);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("299.99"))).toBe(true);
    expect(result.state.liabilities[ids.card]!.balance.equals(money("819.99"))).toBe(true);
  });
  it("settles exactly the issuer minimum with the specific authenticated allocation", () => {
    const d = document();
    publisher.read = () => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c,
      payment: { ...c.payment, funding: { kind: "requested" as const, amount: money("25") } } })) },
      payment: { ...d.payment, amount: money("25"), allocation: { interest: money("20"), principal: money("5"), fees: money("0") } } });
    const f = fixture(), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(2);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("475"))).toBe(true);
    expect(result.state.liabilities[ids.card]!.balance.equals(money("995"))).toBe(true);
    expect(Object.values(result.state.d2SettlementReceipts!)[0]!.amount.equals(money("25"))).toBe(true);
  });
  it("recognizes only authenticated ordinary fees in the approved charge event", () => {
    const d = document(), c = d.request.cards[0]!;
    publisher.read = () => ({ ...d, request: { ...d.request, cards: [{ ...c, statementFees: money("5"), statementTotal: money("1025"),
      charges: [...c.charges, { ...c.charges[0]!, kind: "ordinary_fee" as const, postingId: "issuer-ordinary-fee", sequence: 2, amount: money("5") }] }] },
      charge: { ...d.charge, postingIds: [...d.charge.postingIds, "issuer-ordinary-fee"] },
      payment: { ...d.payment, allocation: { interest: money("20"), fees: money("5"), principal: money("175") } } });
    const f = fixture(), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(2);
    expect(result.periods[0]!.liabilities.equals(money("1025"))).toBe(true);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("300"))).toBe(true);
    expect(result.state.liabilities[ids.card]!.balance.equals(money("825"))).toBe(true);
  });
  it("preserves principal above the JavaScript safe-integer boundary", () => {
    const d = document();
    publisher.read = () => ({ ...d, request: { ...d.request, cards: d.request.cards.map(c => ({ ...c,
      openingPrincipal: money("9007199254740993.13"), statementPrincipal: money("9007199254740993.13"), statementTotal: money("9007199254741013.13") })) } });
    const f = fixture(2, opening("500", "9007199254740993.13")), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(2);
    expect(result.state.liabilities[ids.card]!.balance.equals(money("9007199254740813.13"))).toBe(true);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("300"))).toBe(true);
  });
  it("admits matching C2 proof while still requiring an actual funded BANK debit", () => {
    publisher.read = continuityDocument;
    const f = fixture();
    expect(qualifyCardBankSource(sourceId, f.context).status).toBe("qualified");
    const funded = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(funded.state.accounts[ids.bank]!.cash.equals(money("300"))).toBe(true);
    const low = fixture(2, opening("10")), unpaid = runHouseholdKernel({ kernel: low.kernel, runContext: low.context });
    expect(unpaid.state.accounts[ids.bank]!.cash.equals(money("10"))).toBe(true);
    expect(unpaid.state.d2SettlementReceipts).toBeUndefined();
    expect(unpaid.state.liabilities[ids.card]!.balance.equals(money("1020"))).toBe(true);
  });
  it("rejects changed documentary confirmation without trusting its posted flag", () => {
    const d = continuityDocument();
    publisher.read = () => ({ ...d, continuity: { ...d.continuity!, cycles: d.continuity!.cycles.map((cycle, index) => index !== 0 ? cycle : ({
      ...cycle, registers: cycle.registers.map(r => ({ ...r, boundary: { ...r.boundary, payments: r.boundary.payments.map(p => ({
        ...p, bankConfirmation: { ...p.bankConfirmation!, amount: money("201") },
      })) } })),
    })) } });
    expect(qualifyCardBankSource(sourceId, fixture().context).status).toBe("incomplete");
  });
  it.each([true, false])("uses independent same-instant BANK order, approved=%s", approved => {
    const card = domainId("liability", "203c0000-0000-4000-8000-000000000001");
    const d = document(), c = d.request.cards[0]!, s = { ...c.statementSource, cardAccountId: card };
    const second: CardBankDocument = { ...d, sourceId: "second-card", statementId: "second-statement", quoteId: "second-quote", sourceApprovalId: "second-approval",
      request: { ...d.request, cards: [{ ...c, cardAccountId: card, statementId: "second-statement", statementSource: s,
        minimum: { ...c.minimum, source: s }, postingPolicy: { ...c.postingPolicy, source: s }, allocationPolicy: { ...c.allocationPolicy, source: s },
        charges: c.charges.map(x => ({ ...x, source: s, postingId: "second-interest" })),
        payment: { ...c.payment, source: s, operationId: "a-second-payment-op" } }] },
      provenance: d.provenance.map(w => ({ ...w, source: s })), charge: { ...d.charge, evidenceId: "second-interest", postingIds: ["second-interest"], operationId: "second-charge-op" },
      payment: { ...d.payment, cardAccountId: card, approvalId: "second-payment-approval", bankCashBefore: money("300"),
        authorizationId: "second-signature", paymentId: "second-payment", settlementId: "second-settlement",
        ...(approved ? { executionOrder: { sequenceId: "payer-approved-two-card-order", position: 1 } } : {}) } };
    const first: CardBankDocument = { ...d, payment: { ...d.payment,
      ...(approved ? { executionOrder: { sequenceId: "payer-approved-two-card-order", position: 0 } } : {}) } };
    publisher.read = id => id === sourceId ? first : id === second.sourceId ? second : undefined;
    const state = opening(); state.liabilities[card] = { id: card, balance: money("1000") };
    const f = fixture(2, state, [second.sourceId, sourceId]), result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(approved ? 2 : 1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money(approved ? "100" : "500"))).toBe(true);
    expect(Object.keys(result.state.d2SettlementReceipts ?? {})).toHaveLength(approved ? 2 : 0);
    expect(result.state.liabilities[card]!.balance.equals(money(approved ? "820" : "1020"))).toBe(true);
  });
});
