import { describe, expect, expectTypeOf, it } from "vitest";
import type { SimulationState } from "../src/kernel.js";
import type { SliceState } from "../src/verticalSlice1.js";
import {
  accountingTransactionId,
  createAccountingLeg,
  createAccountingTransaction,
} from "../src/accounting.js";
import { ValidationError, issueCodes } from "../src/diagnostics.js";
import { domainId, generatedOccurrenceKey, idempotencyKey } from "../src/identity.js";
import { recognitionId, settlementId } from "../src/semantics.js";
import {
  applyAccountingTransactionAtomically,
  cloneAuthoritativeState,
  createAuthoritativeState,
  registerAuthoritativeIdentity,
  serializeAuthoritativeIdentityRegistry,
} from "../src/state.js";
import { instant } from "../src/time.js";
import { Quantity, SHARE, money } from "../src/values.js";

const ACCOUNT = domainId("account", "10000000-0000-4000-8000-000000000001");
const POSITION = domainId("position", "10000000-0000-4000-8000-000000000002");
const LIABILITY = domainId("liability", "10000000-0000-4000-8000-000000000003");
const SCENARIO = domainId("scenario", "10000000-0000-4000-8000-000000000004");
const PRIMITIVE = domainId("primitive-instance", "10000000-0000-4000-8000-000000000005");
const AT = instant("2026-01-15T00:00:00.000Z");

const state = () => createAuthoritativeState({
  accounts: { [ACCOUNT]: { id: ACCOUNT, kind: "checking", cash: money("5") } },
  positions: {
    [POSITION]: {
      id: POSITION,
      accountId: ACCOUNT,
      quantity: Quantity.parse("1", SHARE),
      price: money("5"),
      carryingValue: money("5"),
    },
  },
  liabilities: { [LIABILITY]: { id: LIABILITY, balance: money("5") } },
});

const transaction = (id: string, legs: Parameters<typeof createAccountingLeg>[0][]) =>
  createAccountingTransaction({
    id: accountingTransactionId(id),
    type: "test",
    date: AT,
    legs: legs.map(createAccountingLeg),
  });

const validationCode = (operation: () => unknown): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error("Expected ValidationError");
};

describe("authoritative state and atomic posting", () => {
  it("is the one shared state contract consumed by kernel and Vertical Slice 1", () => {
    expectTypeOf<SimulationState>().toEqualTypeOf<SliceState>();
  });

  it("commits every leg of a valid transaction and records its identity", () => {
    const working = state();
    const tx = transaction("tx:income", [
      { posting: "debit", type: "cash", amount: money("10"), accountId: ACCOUNT, cashFlowClass: "operating" },
      { posting: "credit", type: "income", amount: money("10") },
    ]);
    applyAccountingTransactionAtomically(working, tx);
    expect(working.accounts[ACCOUNT]!.cash.equals(money("15"))).toBe(true);
    expect(working.identities.postedTransactionIds).toEqual([tx.id]);
  });

  it("accepts economically identical same-account legs in either order with identical state", () => {
    const creditFirst = transaction("tx:credit-first", [
      { posting: "credit", type: "cash", amount: money("10"), accountId: ACCOUNT, cashFlowClass: "non_cash" },
      { posting: "debit", type: "cash", amount: money("10"), accountId: ACCOUNT, cashFlowClass: "non_cash" },
    ]);
    const debitFirst = transaction("tx:debit-first", [...creditFirst.legs].reverse());
    const left = state();
    const right = state();
    applyAccountingTransactionAtomically(left, creditFirst);
    applyAccountingTransactionAtomically(right, debitFirst);
    expect(left.accounts[ACCOUNT]!.cash.equals(right.accounts[ACCOUNT]!.cash)).toBe(true);
    expect(left.accounts[ACCOUNT]!.cash.equals(money("5"))).toBe(true);
  });

  it("rejects negative final cash without committing any candidate leg", () => {
    const working = state();
    const before = JSON.stringify(working);
    const tx = transaction("tx:negative-cash", [
      { posting: "debit", type: "expense", amount: money("10") },
      { posting: "credit", type: "cash", amount: money("10"), accountId: ACCOUNT, cashFlowClass: "operating" },
    ]);
    expect(validationCode(() => applyAccountingTransactionAtomically(working, tx))).toBe(issueCodes.negativeCashInvariant);
    expect(JSON.stringify(working)).toBe(before);
  });

  it("rejects negative liability and position candidates without changing state", () => {
    const liabilityState = state();
    const liabilityBefore = JSON.stringify(liabilityState);
    const liabilityTx = transaction("tx:negative-liability", [
      { posting: "debit", type: "liability", amount: money("10"), entityId: LIABILITY },
      { posting: "credit", type: "income", amount: money("10") },
    ]);
    expect(validationCode(() => applyAccountingTransactionAtomically(liabilityState, liabilityTx))).toBe(issueCodes.negativeLiabilityInvariant);
    expect(JSON.stringify(liabilityState)).toBe(liabilityBefore);

    const positionState = state();
    const positionBefore = JSON.stringify(positionState);
    const positionTx = transaction("tx:negative-position", [
      { posting: "credit", type: "asset", amount: money("10"), entityId: POSITION, quantity: Quantity.parse("2", SHARE) },
      { posting: "debit", type: "expense", amount: money("10") },
    ]);
    expect(validationCode(() => applyAccountingTransactionAtomically(positionState, positionTx))).toBe(issueCodes.negativePositionInvariant);
    expect(JSON.stringify(positionState)).toBe(positionBefore);
  });

  it("rejects a posted transaction again after authoritative state rollover", () => {
    const tx = transaction("tx:rollover", [
      { posting: "debit", type: "cash", amount: money("1"), accountId: ACCOUNT, cashFlowClass: "operating" },
      { posting: "credit", type: "income", amount: money("1") },
    ]);
    const first = state();
    applyAccountingTransactionAtomically(first, tx);
    const rolled = cloneAuthoritativeState(first);
    const before = JSON.stringify(rolled);
    expect(validationCode(() => applyAccountingTransactionAtomically(rolled, tx))).toBe(issueCodes.duplicateTransaction);
    expect(JSON.stringify(rolled)).toBe(before);
  });
});

describe("authoritative identity registry", () => {
  it("rejects recognition, settlement, generated occurrence, and external duplicates", () => {
    const registry = state().identities;
    const occurrence = generatedOccurrenceKey({
      scenarioId: SCENARIO,
      primitiveInstanceId: PRIMITIVE,
      scheduledAt: AT,
      semanticEffectType: "recognition",
      economicTargetId: ACCOUNT,
    });
    const external = idempotencyKey("bank", "external-1");
    registerAuthoritativeIdentity(registry, "recognitionIds", recognitionId("recognition:1"));
    registerAuthoritativeIdentity(registry, "settlementIds", settlementId("settlement:1"));
    registerAuthoritativeIdentity(registry, "generatedOccurrenceKeys", occurrence);
    registerAuthoritativeIdentity(registry, "externalIdempotencyKeys", external);
    expect(validationCode(() => registerAuthoritativeIdentity(registry, "recognitionIds", recognitionId("recognition:1")))).toBe(issueCodes.duplicateRecognition);
    expect(validationCode(() => registerAuthoritativeIdentity(registry, "settlementIds", settlementId("settlement:1")))).toBe(issueCodes.duplicateSettlement);
    expect(validationCode(() => registerAuthoritativeIdentity(registry, "generatedOccurrenceKeys", occurrence))).toBe(issueCodes.duplicateGeneratedOccurrence);
    expect(validationCode(() => registerAuthoritativeIdentity(registry, "externalIdempotencyKeys", external))).toBe(issueCodes.duplicateExternalIdempotencyKey);
  });

  it("clones and serializes every registry deterministically", () => {
    const opening = state();
    registerAuthoritativeIdentity(opening.identities, "recognitionIds", recognitionId("recognition:z"));
    registerAuthoritativeIdentity(opening.identities, "recognitionIds", recognitionId("recognition:a"));
    const cloned = cloneAuthoritativeState(opening);
    registerAuthoritativeIdentity(cloned.identities, "recognitionIds", recognitionId("recognition:new"));
    expect(opening.identities.recognitionIds).not.toContain("recognition:new");
    expect(serializeAuthoritativeIdentityRegistry(opening.identities).recognitionIds)
      .toEqual(["recognition:a", "recognition:z"]);
    expect(JSON.parse(JSON.stringify(opening.identities))).toEqual(expect.objectContaining({
      postedTransactionIds: [],
      generatedOccurrenceKeys: [],
      externalIdempotencyKeys: [],
    }));
  });
});
