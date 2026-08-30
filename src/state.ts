import {
  assertBalanced,
  type AccountingTransaction,
  type AccountingTransactionId,
  type AccountId,
  type LiabilityId,
  type PositionId,
} from "./accounting.js";
import { failValidation, issueCodes } from "./diagnostics.js";
import type { DomainId, GeneratedOccurrenceKey, IdempotencyKey } from "./identity.js";
import { normalizeClaimLifecycle, type RecognitionId, type SettlementId, type Obligation } from "./semantics.js";
import type { Currency, Money, Quantity, Rate } from "./values.js";

export type AccountKind = "checking" | "savings" | "cash" | "brokerage" | "retirement" | "other";

export interface AccountState {
  readonly id: AccountId;
  readonly kind: AccountKind;
  readonly ownerId?: DomainId<string>;
  cash: Money;
}

export interface PositionState {
  readonly id: PositionId;
  readonly accountId: AccountId;
  quantity: Quantity;
  readonly price: Money;
  carryingValue: Money;
}

export interface LiabilityState {
  readonly id: LiabilityId;
  balance: Money;
  readonly rate?: Rate;
}

export interface AuthoritativeIdentityRegistry {
  readonly postedTransactionIds: readonly AccountingTransactionId[];
  readonly recognitionIds: readonly RecognitionId[];
  readonly settlementIds: readonly SettlementId[];
  readonly generatedOccurrenceKeys: readonly GeneratedOccurrenceKey[];
  readonly externalIdempotencyKeys: readonly IdempotencyKey[];
}

export interface AuthoritativeState {
  accounts: Record<string, AccountState>;
  positions: Record<string, PositionState>;
  liabilities: Record<string, LiabilityState>;
  obligations: Record<string, Obligation>;
  identities: AuthoritativeIdentityRegistry;
}

export interface AuthoritativeStateDraft {
  readonly accounts?: Record<string, AccountState>;
  readonly positions?: Record<string, PositionState>;
  readonly liabilities?: Record<string, LiabilityState>;
  readonly obligations?: Record<string, Obligation>;
  readonly identities?: Partial<AuthoritativeIdentityRegistry>;
}

const stableUnique = <T extends string>(values: readonly T[] | undefined): T[] =>
  [...new Set(values ?? [])].sort() as T[];

export const createAuthoritativeIdentityRegistry = (
  draft: Partial<AuthoritativeIdentityRegistry> = {},
): AuthoritativeIdentityRegistry => ({
  postedTransactionIds: Object.freeze(stableUnique(draft.postedTransactionIds)),
  recognitionIds: Object.freeze(stableUnique(draft.recognitionIds)),
  settlementIds: Object.freeze(stableUnique(draft.settlementIds)),
  generatedOccurrenceKeys: Object.freeze(stableUnique(draft.generatedOccurrenceKeys)),
  externalIdempotencyKeys: Object.freeze(stableUnique(draft.externalIdempotencyKeys)),
});

export const createAuthoritativeState = (draft: AuthoritativeStateDraft = {}): AuthoritativeState => {
  const state: AuthoritativeState = {
    accounts: Object.fromEntries(Object.entries(draft.accounts ?? {}).map(([key, value]) => [key, { ...value }])),
    positions: Object.fromEntries(Object.entries(draft.positions ?? {}).map(([key, value]) => [key, { ...value }])),
    liabilities: Object.fromEntries(Object.entries(draft.liabilities ?? {}).map(([key, value]) => [key, { ...value }])),
    obligations: Object.fromEntries(Object.entries(draft.obligations ?? {}).map(([key, value]) => {
      const normalized = normalizeClaimLifecycle(value);
      if (normalized.kind !== "obligation") {
        failValidation({ severity: "error", code: issueCodes.claimInvariantInvalid, message: `Authoritative obligation ${normalized.id} must have kind obligation`, entityType: "claim", entityId: normalized.id, fieldPath: `obligations.${key}.kind` });
      }
      return [key, normalized as Obligation];
    })),
    identities: createAuthoritativeIdentityRegistry(draft.identities),
  };
  reconcileClaimIdentityHistory(state);
  validateAuthoritativeState(state);
  return state;
};

export const cloneAuthoritativeState = (state: AuthoritativeState): AuthoritativeState =>
  createAuthoritativeState(state);

type IdentityKind = keyof AuthoritativeIdentityRegistry;

const duplicateCode = (kind: IdentityKind): string => {
  switch (kind) {
    case "postedTransactionIds": return issueCodes.duplicateTransaction;
    case "recognitionIds": return issueCodes.duplicateRecognition;
    case "settlementIds": return issueCodes.duplicateSettlement;
    case "generatedOccurrenceKeys": return issueCodes.duplicateGeneratedOccurrence;
    case "externalIdempotencyKeys": return issueCodes.duplicateExternalIdempotencyKey;
  }
};

const identityLabel = (kind: IdentityKind): string => {
  switch (kind) {
    case "postedTransactionIds": return "transaction";
    case "recognitionIds": return "recognition";
    case "settlementIds": return "settlement";
    case "generatedOccurrenceKeys": return "generated occurrence";
    case "externalIdempotencyKeys": return "external idempotency key";
  }
};

export const registerAuthoritativeIdentity = <Kind extends IdentityKind>(
  registry: AuthoritativeIdentityRegistry,
  kind: Kind,
  identity: AuthoritativeIdentityRegistry[Kind][number],
): void => {
  const values = [...registry[kind]] as string[];
  if (values.includes(identity)) {
    failValidation({
      severity: "error",
      code: duplicateCode(kind),
      message: `Duplicate ${identityLabel(kind)} ${identity}`,
      entityType: "authoritative_identity",
      entityId: identity,
      fieldPath: kind,
    });
  }
  values.push(identity);
  values.sort();
  Object.assign(registry, { [kind]: Object.freeze(values) });
};

const stateTargetMissing = (transaction: AccountingTransaction, targetType: string, targetId: string): never =>
  failValidation({
    severity: "error",
    code: issueCodes.stateTargetNotFound,
    message: `Unknown ${targetType} ${targetId} in transaction ${transaction.id}`,
    entityType: targetType,
    entityId: targetId,
    relatedIds: [transaction.id],
  });

export const validateAuthoritativeState = (state: AuthoritativeState, transactionId?: string): void => {
  const validateRecordIdentity = (collection: string, entityType: string, key: string, id: string): void => {
    if (key !== id) {
      failValidation({
        severity: "error",
        code: issueCodes.stateEntityIdentityMismatch,
        message: `${entityType} record key ${key} does not match contained id ${id}`,
        entityType,
        entityId: id,
        fieldPath: `${collection}.${key}.id`,
        relatedIds: [key, id],
      });
    }
  };
  for (const [key, account] of Object.entries(state.accounts)) validateRecordIdentity("accounts", "account", key, account.id);
  for (const [key, position] of Object.entries(state.positions)) {
    validateRecordIdentity("positions", "position", key, position.id);
    if (state.accounts[position.accountId] === undefined) {
      failValidation({
        severity: "error",
        code: issueCodes.stateTargetNotFound,
        message: `Position ${position.id} references missing account ${position.accountId}`,
        entityType: "position",
        entityId: position.id,
        fieldPath: `positions.${key}.accountId`,
        relatedIds: [position.accountId],
      });
    }
  }
  for (const [key, liability] of Object.entries(state.liabilities)) validateRecordIdentity("liabilities", "liability", key, liability.id);
  for (const [key, obligation] of Object.entries(state.obligations)) validateRecordIdentity("obligations", "obligation", key, obligation.id);
  for (const account of Object.values(state.accounts)) {
    if (account.cash.isNegative()) {
      failValidation({
        severity: "error",
        code: issueCodes.negativeCashInvariant,
        message: `Accepted transaction ${transactionId ?? "state transition"} creates prohibited negative cash in ${account.id}`,
        entityType: "account",
        entityId: account.id,
        ...(transactionId === undefined ? {} : { relatedIds: [transactionId] }),
      });
    }
  }
  for (const liability of Object.values(state.liabilities)) {
    if (liability.balance.isNegative()) {
      failValidation({
        severity: "error",
        code: issueCodes.negativeLiabilityInvariant,
        message: `Accepted transaction ${transactionId ?? "state transition"} creates a negative liability balance in ${liability.id}`,
        entityType: "liability",
        entityId: liability.id,
        ...(transactionId === undefined ? {} : { relatedIds: [transactionId] }),
      });
    }
  }
  for (const position of Object.values(state.positions)) {
    if (position.quantity.isNegative() || position.carryingValue.isNegative()) {
      failValidation({
        severity: "error",
        code: issueCodes.negativePositionInvariant,
        message: `Accepted transaction ${transactionId ?? "state transition"} creates a negative position balance in ${position.id}`,
        entityType: "position",
        entityId: position.id,
        ...(transactionId === undefined ? {} : { relatedIds: [transactionId] }),
      });
    }
  }
};

const reconcileClaimIdentityHistory = (state: AuthoritativeState): void => {
  const recognitionClaims = new Map<string, string>();
  const settlementClaims = new Map<string, string>();
  const recognitionIds = new Set<string>(state.identities.recognitionIds);
  const settlementIds = new Set<string>(state.identities.settlementIds);
  for (const claim of Object.values(state.obligations)) {
    const priorRecognitionClaim = recognitionClaims.get(claim.originatingRecognitionId);
    if (priorRecognitionClaim !== undefined && priorRecognitionClaim !== claim.id) {
      failValidation({ severity: "error", code: issueCodes.duplicateRecognition, message: `Recognition ${claim.originatingRecognitionId} is claimed by multiple claims`, entityType: "claim", entityId: claim.id, fieldPath: "originatingRecognitionId", relatedIds: [priorRecognitionClaim, claim.originatingRecognitionId] });
    }
    recognitionClaims.set(claim.originatingRecognitionId, claim.id);
    recognitionIds.add(claim.originatingRecognitionId);
    for (const settlementId of claim.settlementIds) {
      const priorSettlementClaim = settlementClaims.get(settlementId);
      if (priorSettlementClaim !== undefined && priorSettlementClaim !== claim.id) {
        failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Settlement ${settlementId} is claimed by multiple claims`, entityType: "claim", entityId: claim.id, fieldPath: "settlementIds", relatedIds: [priorSettlementClaim, settlementId] });
      }
      settlementClaims.set(settlementId, claim.id);
      settlementIds.add(settlementId);
    }
  }
  Object.assign(state.identities, {
    recognitionIds: Object.freeze([...recognitionIds].sort()),
    settlementIds: Object.freeze([...settlementIds].sort()),
  });
};

export const assertAuthoritativeStateCurrency = (state: AuthoritativeState, currency: Currency): void => {
  const assertCurrency = (amount: Money, fieldPath: string, entityType: string, entityId: string): void => {
    if (!amount.currency.equals(currency)) {
      failValidation({
        severity: "error",
        code: issueCodes.runBaseCurrencyMismatch,
        message: `${fieldPath} uses ${amount.currency.code} but run base currency is ${currency.code}`,
        entityType,
        entityId,
        fieldPath,
        relatedIds: [amount.currency.code, currency.code],
      });
    }
  };
  for (const [key, account] of Object.entries(state.accounts)) assertCurrency(account.cash, `accounts.${key}.cash`, "account", account.id);
  for (const [key, liability] of Object.entries(state.liabilities)) assertCurrency(liability.balance, `liabilities.${key}.balance`, "liability", liability.id);
  for (const [key, position] of Object.entries(state.positions)) {
    assertCurrency(position.price, `positions.${key}.price`, "position", position.id);
    assertCurrency(position.carryingValue, `positions.${key}.carryingValue`, "position", position.id);
  }
};

const commitCandidate = (target: AuthoritativeState, candidate: AuthoritativeState): void => {
  target.accounts = candidate.accounts;
  target.positions = candidate.positions;
  target.liabilities = candidate.liabilities;
  target.obligations = candidate.obligations;
  target.identities = candidate.identities;
};

/** Applies a complete accounting transaction to isolated candidate state and commits only after all invariants pass. */
export const applyAccountingTransactionAtomically = (
  state: AuthoritativeState,
  transaction: AccountingTransaction,
): void => {
  assertBalanced(transaction);
  const candidate = cloneAuthoritativeState(state);
  registerAuthoritativeIdentity(candidate.identities, "postedTransactionIds", transaction.id);

  for (const leg of transaction.legs) {
    const signedAmount = leg.posting === "debit" ? leg.amount : leg.amount.negated();
    if (leg.type === "cash") {
      const account = candidate.accounts[leg.accountId];
      if (account === undefined) return stateTargetMissing(transaction, "account", leg.accountId);
      account.cash = account.cash.plus(signedAmount);
    } else if (leg.type === "liability") {
      const liability = candidate.liabilities[leg.entityId];
      if (liability === undefined) return stateTargetMissing(transaction, "liability", leg.entityId);
      liability.balance = liability.balance.minus(signedAmount);
    } else if (leg.type === "asset") {
      const position = candidate.positions[leg.entityId];
      if (position === undefined) return stateTargetMissing(transaction, "position", leg.entityId);
      position.carryingValue = position.carryingValue.plus(signedAmount);
      if (leg.quantity !== undefined) {
        position.quantity = leg.posting === "debit"
          ? position.quantity.plus(leg.quantity)
          : position.quantity.minus(leg.quantity);
      }
    }
  }

  validateAuthoritativeState(candidate, transaction.id);
  commitCandidate(state, candidate);
};

export const serializeAuthoritativeIdentityRegistry = (
  registry: AuthoritativeIdentityRegistry,
): Readonly<Record<IdentityKind, readonly string[]>> => Object.freeze({
  postedTransactionIds: Object.freeze([...registry.postedTransactionIds].sort()),
  recognitionIds: Object.freeze([...registry.recognitionIds].sort()),
  settlementIds: Object.freeze([...registry.settlementIds].sort()),
  generatedOccurrenceKeys: Object.freeze([...registry.generatedOccurrenceKeys].sort()),
  externalIdempotencyKeys: Object.freeze([...registry.externalIdempotencyKeys].sort()),
});
