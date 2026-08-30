import { describe, expect, expectTypeOf, it } from "vitest";
import type { SimulationState } from "../src/kernel.js";
import type { SliceState } from "../src/verticalSlice1.js";
import {
  accountingTransactionId,
  createAccountingLeg,
  createAccountingTransaction,
} from "../src/accounting/index.js";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { domainId, generatedOccurrenceKey, idempotencyKey } from "../src/identity/index.js";
import { createObligation } from "../src/semantics/claim.js";
import { claimId, recognitionId, settlementId } from "../src/semantics/identity.js";
import {
  applyAccountingTransactionAtomically,
  cloneAuthoritativeState,
  createAuthoritativeState,
  registerAuthoritativeIdentity,
  serializeAuthoritativeIdentityRegistry,
} from "../src/state/index.js";
import { instant } from "../src/time/index.js";
import { Currency, Quantity, SHARE, money } from "../src/values/index.js";

const ACCOUNT = domainId("account", "10000000-0000-4000-8000-000000000001");
const POSITION = domainId("position", "10000000-0000-4000-8000-000000000002");
const LIABILITY = domainId("liability", "10000000-0000-4000-8000-000000000003");
const OTHER_ACCOUNT = domainId("account", "20000000-0000-4000-8000-000000000001");
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

  it("rejects malformed opening balances, record identities, and orphan positions at creation", () => {
    expect(validationCode(() => createAuthoritativeState({ accounts: { [ACCOUNT]: { id: ACCOUNT, kind: "checking", cash: money("-1") } } }))).toBe(issueCodes.negativeCashInvariant);
    expect(validationCode(() => createAuthoritativeState({ accounts: { [ACCOUNT]: { id: OTHER_ACCOUNT, kind: "checking", cash: money("0") } } }))).toBe(issueCodes.stateEntityIdentityMismatch);
    expect(validationCode(() => createAuthoritativeState({ positions: { [POSITION]: { id: POSITION, accountId: ACCOUNT, quantity: Quantity.parse("1", SHARE), price: money("1"), carryingValue: money("1") } } }))).toBe(issueCodes.stateTargetNotFound);
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

  it("reconciles claim lifecycle history into global recognition and settlement authority", () => {
    const recognition = recognitionId("recognition:historic");
    const settlement = settlementId("settlement:historic");
    const obligation = createObligation({
      id: claimId("obligation:historic"),
      category: "tax",
      originatingRecognitionId: recognition,
      economicOwnerId: ACCOUNT,
      originalAmount: money("5"),
      outstandingAmount: money("4"),
      recognizedAt: AT,
      settlementIds: [settlement],
    });
    const normalized = createAuthoritativeState({ obligations: { [obligation.id]: obligation } });
    expect(normalized.identities.recognitionIds).toContain(recognition);
    expect(normalized.identities.settlementIds).toContain(settlement);
    expect(validationCode(() => registerAuthoritativeIdentity(normalized.identities, "recognitionIds", recognition))).toBe(issueCodes.duplicateRecognition);
    expect(validationCode(() => registerAuthoritativeIdentity(normalized.identities, "settlementIds", settlement))).toBe(issueCodes.duplicateSettlement);
  });

  it("rejects contradictory recognition and settlement history across claims", () => {
    const recognition = recognitionId("recognition:shared");
    const settlement = settlementId("settlement:shared");
    const claim = (id: string, originatingRecognitionId: ReturnType<typeof recognitionId>) => createObligation({
      id: claimId(id),
      category: "tax",
      originatingRecognitionId,
      economicOwnerId: ACCOUNT,
      originalAmount: money("5"),
      recognizedAt: AT,
      settlementIds: [settlement],
    });
    const first = claim("obligation:first", recognition);
    const secondSameRecognition = claim("obligation:second", recognition);
    expect(validationCode(() => createAuthoritativeState({ obligations: { [first.id]: first, [secondSameRecognition.id]: secondSameRecognition } }))).toBe(issueCodes.duplicateRecognition);
    const secondSameSettlement = claim("obligation:third", recognitionId("recognition:other"));
    expect(validationCode(() => createAuthoritativeState({ obligations: { [first.id]: first, [secondSameSettlement.id]: secondSameSettlement } }))).toBe(issueCodes.duplicateSettlement);
  });

  it("revalidates spread-cloned claim lifecycle records and owns their settlement arrays", () => {
    const valid = createObligation({
      id: claimId("obligation:validated"),
      category: "tax",
      originatingRecognitionId: recognitionId("recognition:validated"),
      economicOwnerId: ACCOUNT,
      originalAmount: money("5"),
      outstandingAmount: money("4"),
      recognizedAt: AT,
    });
    expect(createAuthoritativeState({ obligations: { [valid.id]: valid } }).obligations[valid.id]).toEqual(valid);
    expect(validationCode(() => createAuthoritativeState({ obligations: { [valid.id]: { ...valid, outstandingAmount: money("-1") } } }))).toBe(issueCodes.settlementAmountInvalid);
    expect(validationCode(() => createAuthoritativeState({ obligations: { [valid.id]: { ...valid, outstandingAmount: money("6") } } }))).toBe(issueCodes.settlementAmountInvalid);
    expect(validationCode(() => createAuthoritativeState({ obligations: { [valid.id]: { ...valid, outstandingAmount: money("4", Currency.of("EUR")) } } }))).toBe(issueCodes.settlementCurrencyMismatch);
    expect(validationCode(() => createAuthoritativeState({ obligations: { [valid.id]: { ...valid, category: " " } } }))).toBe(issueCodes.claimInvariantInvalid);
    const duplicate = settlementId("settlement:duplicate-within-claim");
    expect(validationCode(() => createAuthoritativeState({ obligations: { [valid.id]: { ...valid, settlementIds: [duplicate, duplicate] } } }))).toBe(issueCodes.duplicateSettlement);

    const callerOwned = [settlementId("settlement:caller-owned")];
    const normalized = createAuthoritativeState({ obligations: { [valid.id]: { ...valid, settlementIds: callerOwned } } });
    callerOwned.push(settlementId("settlement:later-mutation"));
    expect(normalized.obligations[valid.id]?.settlementIds).toEqual(["settlement:caller-owned"]);
    expect(Object.isFrozen(normalized.obligations[valid.id]?.settlementIds)).toBe(true);
  });
});
