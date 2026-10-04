import {
  assertBalanced,
  type AccountingTransaction,
  type AccountingTransactionId,
  type AccountId,
  type LiabilityId,
  type PositionId,
} from "../accounting/index.js";
import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { DomainId, GeneratedOccurrenceKey, IdempotencyKey } from "../identity/index.js";
import { normalizeClaimLifecycle, type ObligationOrRight } from "../semantics/claim.js";
import type { RecognitionId, SettlementId } from "../semantics/identity.js";
import { createRecognitionFact as createRecognitionFactWithHistory, type RecognitionFactDraft, type RecognitionFact } from "../semantics/recognition.js";
import type { Currency, Money, Quantity, Rate } from "../values/index.js";

interface IndexNode<T> {
  readonly key: string;
  readonly value: T;
  readonly left: IndexNode<T> | undefined;
  readonly right: IndexNode<T> | undefined;
  readonly height: number;
  readonly size: number;
}
const indexHeight = <T>(node: IndexNode<T> | undefined): number => node?.height ?? 0;
const indexSize = <T>(node: IndexNode<T> | undefined): number => node?.size ?? 0;
const indexNode = <T>(key: string, value: T, left?: IndexNode<T>, right?: IndexNode<T>): IndexNode<T> =>
  ({ key, value, left, right, height: 1 + Math.max(indexHeight(left), indexHeight(right)), size: 1 + indexSize(left) + indexSize(right) });
const indexRotateLeft = <T>(node: IndexNode<T>): IndexNode<T> => {
  const right = node.right!;
  return indexNode(right.key, right.value, indexNode(node.key, node.value, node.left, right.left), right.right);
};
const indexRotateRight = <T>(node: IndexNode<T>): IndexNode<T> => {
  const left = node.left!;
  return indexNode(left.key, left.value, left.left, indexNode(node.key, node.value, left.right, node.right));
};
const indexBalance = <T>(node: IndexNode<T>): IndexNode<T> => {
  const difference = indexHeight(node.left) - indexHeight(node.right);
  if (difference > 1) {
    const left = node.left!;
    return indexRotateRight(indexHeight(left.left) >= indexHeight(left.right) ? node
      : indexNode(node.key, node.value, indexRotateLeft(left), node.right));
  }
  if (difference < -1) {
    const right = node.right!;
    return indexRotateLeft(indexHeight(right.right) >= indexHeight(right.left) ? node
      : indexNode(node.key, node.value, node.left, indexRotateRight(right)));
  }
  return node;
};

/** Deterministic persistent AVL index. Forking shares the root; updates copy only a logarithmic path. */
export class PersistentStringIndex<T> {
  #root: IndexNode<T> | undefined;
  constructor(entries: Iterable<readonly [string, T]> = []) {
    for (const [key, value] of entries) this.set(key, value);
  }
  get size(): number { return indexSize(this.#root); }
  fork(): PersistentStringIndex<T> {
    const next = new PersistentStringIndex<T>();
    next.#root = this.#root;
    return next;
  }
  get(key: string): T | undefined {
    let node = this.#root;
    while (node !== undefined) {
      if (key === node.key) return node.value;
      node = key < node.key ? node.left : node.right;
    }
    return undefined;
  }
  has(key: string): boolean {
    let node = this.#root;
    while (node !== undefined) {
      if (key === node.key) return true;
      node = key < node.key ? node.left : node.right;
    }
    return false;
  }
  set(key: string, value: T): void {
    const insert = (node: IndexNode<T> | undefined): IndexNode<T> => {
      if (node === undefined) return indexNode(key, value);
      if (key === node.key) return indexNode(key, value, node.left, node.right);
      return indexBalance(key < node.key
        ? indexNode(node.key, node.value, insert(node.left), node.right)
        : indexNode(node.key, node.value, node.left, insert(node.right)));
    };
    this.#root = insert(this.#root);
  }
  delete(key: string): void {
    const remove = (node: IndexNode<T> | undefined, target: string): IndexNode<T> | undefined => {
      if (node === undefined) return undefined;
      if (target < node.key) return indexBalance(indexNode(node.key, node.value, remove(node.left, target), node.right));
      if (target > node.key) return indexBalance(indexNode(node.key, node.value, node.left, remove(node.right, target)));
      if (node.left === undefined) return node.right;
      if (node.right === undefined) return node.left;
      let successor = node.right;
      while (successor.left !== undefined) successor = successor.left;
      return indexBalance(indexNode(successor.key, successor.value, node.left, remove(node.right, successor.key)));
    };
    this.#root = remove(this.#root, key);
  }
  at(index: number): readonly [string, T] | undefined {
    if (!Number.isSafeInteger(index) || index < 0) return undefined;
    let node = this.#root;
    let remaining = index;
    while (node !== undefined) {
      const leftSize = indexSize(node.left);
      if (remaining === leftSize) return [node.key, node.value];
      if (remaining < leftSize) node = node.left;
      else { remaining -= leftSize + 1; node = node.right; }
    }
    return undefined;
  }
  *entries(): IterableIterator<readonly [string, T]> {
    const visit = function* (node: IndexNode<T> | undefined): IterableIterator<readonly [string, T]> {
      if (node === undefined) return;
      yield* visit(node.left);
      yield [node.key, node.value];
      yield* visit(node.right);
    };
    yield* visit(this.#root);
  }
}

interface IndexedRecord<T extends object> {
  readonly index: PersistentStringIndex<T>;
  readonly dirty: Set<string>;
  readonly record: Record<string, T>;
}
const indexedRecords = new WeakMap<object, IndexedRecord<object>>();

/** Copy-on-write entity views preserve mutable state APIs without mutating another candidate. */
const indexedRecord = <T extends object>(index: PersistentStringIndex<T>, mutableEntities: boolean,
  changed?: (key: string, previous: T | undefined, next: T | undefined) => void,
  normalize?: (value: T) => T): IndexedRecord<T> => {
  const dirty = new Set<string>();
  const views = new Map<string, T>();
  const entity = (key: string): T | undefined => {
    const value = index.get(key);
    if (value === undefined || !mutableEntities) return value;
    let view = views.get(key);
    if (view === undefined) {
      view = new Proxy({} as T, {
        get: (_target, property) => Reflect.get(index.get(key) ?? {}, property),
        set: (_target, property, replacement) => {
          const next = { ...index.get(key) } as T;
          Reflect.set(next, property, replacement);
          index.set(key, next); dirty.add(key);
          return true;
        },
        ownKeys: () => Reflect.ownKeys(index.get(key) ?? {}),
        getOwnPropertyDescriptor: (_target, property) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(index.get(key) ?? {}, property);
          return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
        },
      });
      views.set(key, view);
    }
    return view;
  };
  const record = new Proxy({} as Record<string, T>, {
    get: (_target, property) => typeof property === "string" && index.has(property) ? entity(property) : undefined,
    set: (_target, property, value: T) => {
      if (typeof property !== "string") return false;
      const next = normalize === undefined ? (mutableEntities ? { ...value } : value) : normalize(value);
      changed?.(property, index.get(property), next);
      index.set(property, next); dirty.add(property); return true;
    },
    deleteProperty: (_target, property) => {
      if (typeof property !== "string") return false;
      changed?.(property, index.get(property), undefined);
      index.delete(property); dirty.add(property); views.delete(property); return true;
    },
    has: (_target, property) => typeof property === "string" && index.has(property),
    ownKeys: () => [...index.entries()].map(([key]) => key),
    getOwnPropertyDescriptor: (_target, property) => typeof property === "string" && index.has(property)
      ? { value: entity(property), writable: true, configurable: true, enumerable: true } : undefined,
  });
  const result = { index, dirty, record };
  indexedRecords.set(record, result as IndexedRecord<object>);
  return result;
};

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
  obligations: Record<string, ObligationOrRight>;
  identities: AuthoritativeIdentityRegistry;
}

export interface AuthoritativeStateDraft {
  readonly accounts?: Record<string, AccountState>;
  readonly positions?: Record<string, PositionState>;
  readonly liabilities?: Record<string, LiabilityState>;
  readonly obligations?: Record<string, ObligationOrRight>;
  readonly identities?: Partial<AuthoritativeIdentityRegistry>;
}

const identityIndexes = new WeakMap<AuthoritativeIdentityRegistry, Record<keyof AuthoritativeIdentityRegistry, PersistentStringIndex<string>>>();
const identityArrays = new WeakMap<object, PersistentStringIndex<string>>();
const identityKinds: readonly (keyof AuthoritativeIdentityRegistry)[] = [
  "postedTransactionIds", "recognitionIds", "settlementIds", "generatedOccurrenceKeys", "externalIdempotencyKeys",
];
const identityArray = <T extends string>(index: PersistentStringIndex<string>): readonly T[] => {
  const ordinal = (property: PropertyKey): number | undefined => typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)
    ? Number(property) : undefined;
  const array = new Proxy([] as T[], {
    get: (target, property, receiver) => {
      if (property === "length") return index.size;
      if (property === "hasIdentity") return (value: string) => index.has(value);
      if (property === "includes") return (value: string, fromIndex = 0) => {
        if (!index.has(value)) return false;
        if (fromIndex === 0) return true;
        return Array.from(index.entries(), ([key]) => key).includes(value, fromIndex);
      };
      if (property === Symbol.iterator) return function* () { for (const [key] of index.entries()) yield key; };
      const position = ordinal(property);
      return position === undefined ? Reflect.get(target, property, receiver) : index.at(position)?.[0];
    },
    has: (target, property) => {
      const position = ordinal(property);
      return position === undefined ? Reflect.has(target, property) : position < index.size;
    },
    set: () => false,
  });
  identityArrays.set(array, index);
  return array;
};
const indexedIdentityRegistry = (source: AuthoritativeIdentityRegistry): AuthoritativeIdentityRegistry => {
  const prior = identityIndexes.get(source);
  const indexes = {} as Record<keyof AuthoritativeIdentityRegistry, PersistentStringIndex<string>>;
  const registry = {} as AuthoritativeIdentityRegistry;
  for (const kind of identityKinds) {
    const index = prior?.[kind].fork() ?? new PersistentStringIndex<string>(source[kind].map(value => [value, value] as const));
    indexes[kind] = index;
    Object.assign(registry, { [kind]: identityArray(index.fork()) });
  }
  identityIndexes.set(registry, indexes);
  return registry;
};

/** Preserve recognition validation while passing only the duplicate candidate to its history API. */
export const createIndexedRecognitionFact = (draft: RecognitionFactDraft, history: Iterable<string> = []): RecognitionFact => {
  const index = typeof history === "object" && history !== null ? identityArrays.get(history) : undefined;
  return createRecognitionFactWithHistory(draft, index === undefined ? history : index.has(draft.id) ? [draft.id] : []);
};

interface ExecutionStateIndex {
  readonly recognitionClaims: PersistentStringIndex<string>;
  readonly settlementClaims: PersistentStringIndex<string>;
  readonly activeClaims: PersistentStringIndex<PersistentStringIndex<ObligationOrRight>>;
  readonly pendingClaimIds: Set<string>;
}
const executionStateIndexes = new WeakMap<AuthoritativeState, ExecutionStateIndex>();
const claimGroup = (category: string, balanceEntityId?: string): string => `${category}\u0000${balanceEntityId ?? ""}`;

/** Establish indexed execution once at the opening authority boundary. */
export const createIndexedExecutionState = (opening: AuthoritativeState): AuthoritativeState => {
  const existing = executionStateIndexes.get(opening);
  if (existing === undefined) validateAuthoritativeState(opening);
  const recognitionClaims = existing?.recognitionClaims.fork() ?? new PersistentStringIndex<string>();
  const settlementClaims = existing?.settlementClaims.fork() ?? new PersistentStringIndex<string>();
  const activeClaims = existing?.activeClaims.fork() ?? new PersistentStringIndex<PersistentStringIndex<ObligationOrRight>>();
  const pendingClaimIds = new Set(existing?.pendingClaimIds);
  const updateClaim = (key: string, previous: ObligationOrRight | undefined, next: ObligationOrRight | undefined): void => {
    pendingClaimIds.add(key);
    if (previous !== undefined) {
      recognitionClaims.delete(previous.originatingRecognitionId);
      for (const settlement of previous.settlementIds) settlementClaims.delete(settlement);
      const groupKey = claimGroup(previous.category, previous.balanceEntityId);
      const group = activeClaims.get(groupKey)?.fork();
      if (group !== undefined) { group.delete(key); if (group.size === 0) activeClaims.delete(groupKey); else activeClaims.set(groupKey, group); }
    }
    if (next !== undefined) {
      const owner = recognitionClaims.get(next.originatingRecognitionId);
      if (owner !== undefined && owner !== key) failValidation({ severity: "error", code: issueCodes.duplicateRecognition,
        message: `Recognition ${next.originatingRecognitionId} is claimed by multiple claims`, entityType: "claim",
        entityId: next.id, fieldPath: "originatingRecognitionId", relatedIds: [owner, next.originatingRecognitionId] });
      recognitionClaims.set(next.originatingRecognitionId, key);
      for (const settlement of next.settlementIds) {
        const settlementOwner = settlementClaims.get(settlement);
        if (settlementOwner !== undefined && settlementOwner !== key) failValidation({ severity: "error", code: issueCodes.duplicateSettlement,
          message: `Settlement ${settlement} is claimed by multiple claims`, entityType: "claim", entityId: next.id,
          fieldPath: "settlementIds", relatedIds: [settlementOwner, settlement] });
        settlementClaims.set(settlement, key);
      }
      if (next.outstandingAmount.isPositive()) {
        const groupKey = claimGroup(next.category, next.balanceEntityId);
        const group = activeClaims.get(groupKey)?.fork() ?? new PersistentStringIndex<ObligationOrRight>();
        group.set(key, next); activeClaims.set(groupKey, group);
      }
    }
  };
  const makeRecord = <T extends object>(record: Record<string, T>, mutable: boolean,
    changed?: (key: string, previous: T | undefined, next: T | undefined) => void,
    normalize?: (value: T) => T): Record<string, T> => {
    const previous = indexedRecords.get(record) as IndexedRecord<T> | undefined;
    const next = indexedRecord(previous?.index.fork() ?? new PersistentStringIndex(Object.entries(record)), mutable, changed, normalize);
    if (previous !== undefined) for (const key of previous.dirty) next.dirty.add(key);
    return next.record;
  };
  const state: AuthoritativeState = {
    accounts: makeRecord(opening.accounts, true), positions: makeRecord(opening.positions, true),
    liabilities: makeRecord(opening.liabilities, true), obligations: makeRecord(opening.obligations, false, updateClaim, normalizeClaimLifecycle),
    identities: indexedIdentityRegistry(opening.identities),
  };
  if (existing === undefined) for (const [key, claim] of Object.entries(opening.obligations)) updateClaim(key, undefined, claim);
  if (existing === undefined) pendingClaimIds.clear();
  executionStateIndexes.set(state, { recognitionClaims, settlementClaims, activeClaims, pendingClaimIds });
  return state;
};

export const activeAuthoritativeClaims = (state: AuthoritativeState, category: string, balanceEntityId?: string): readonly ObligationOrRight[] => {
  const indexed = executionStateIndexes.get(state);
  if (indexed === undefined) return Object.values(state.obligations).filter(claim => claim.category === category
    && (balanceEntityId === undefined || claim.balanceEntityId === balanceEntityId) && claim.outstandingAmount.isPositive());
  if (balanceEntityId !== undefined) return Array.from(indexed.activeClaims.get(claimGroup(category, balanceEntityId))?.entries() ?? [], ([, claim]) => claim);
  const results: ObligationOrRight[] = [];
  for (const [key, group] of indexed.activeClaims.entries()) if (key.startsWith(`${category}\u0000`))
    for (const [, claim] of group.entries()) results.push(claim);
  return results;
};

export const authoritativeClaimHistory = (state: AuthoritativeState): Iterable<ObligationOrRight> & {
  readonly hasClaimIdentity: (claimId: string, recognitionId: string) => boolean;
} => ({
  *[Symbol.iterator]() { yield* Object.values(state.obligations); },
  hasClaimIdentity: (claimId, recognitionId) => state.obligations[claimId] !== undefined ||
    (executionStateIndexes.get(state)?.recognitionClaims.has(recognitionId)
      ?? Object.values(state.obligations).some(claim => claim.originatingRecognitionId === recognitionId)),
});

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
    obligations: Object.fromEntries(Object.entries(draft.obligations ?? {}).map(([key, value]) => [key, normalizeClaimLifecycle(value)])),
    identities: createAuthoritativeIdentityRegistry(draft.identities),
  };
  reconcileClaimIdentityHistory(state);
  validateAuthoritativeState(state);
  return state;
};

export const cloneAuthoritativeState = (state: AuthoritativeState): AuthoritativeState => {
  if (!executionStateIndexes.has(state)) return createAuthoritativeState(state);
  if (![state.accounts, state.positions, state.liabilities, state.obligations].every(record => indexedRecords.has(record))
    || !identityIndexes.has(state.identities)) return createIndexedExecutionState(createAuthoritativeState(state));
  const candidate = createIndexedExecutionState(state);
  const pendingClaimIds = executionStateIndexes.get(candidate)!.pendingClaimIds;
  for (const key of pendingClaimIds) {
    const claim = candidate.obligations[key];
    if (claim === undefined) continue;
    if (!candidate.identities.recognitionIds.includes(claim.originatingRecognitionId))
      registerAuthoritativeIdentity(candidate.identities, "recognitionIds", claim.originatingRecognitionId);
    for (const settlement of claim.settlementIds) if (!candidate.identities.settlementIds.includes(settlement))
      registerAuthoritativeIdentity(candidate.identities, "settlementIds", settlement);
  }
  pendingClaimIds.clear();
  validateAuthoritativeState(candidate);
  return candidate;
};

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
  const indexed = identityIndexes.get(registry)?.[kind];
  if (indexed !== undefined) {
    if (indexed.has(identity)) failValidation({ severity: "error", code: duplicateCode(kind),
      message: `Duplicate ${identityLabel(kind)} ${identity}`, entityType: "authoritative_identity", entityId: identity, fieldPath: kind });
    indexed.set(identity, identity);
    Object.assign(registry, { [kind]: identityArray(indexed.fork()) });
    return;
  }
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
  const entries = <T extends object>(record: Record<string, T>, full = false): readonly (readonly [string, T])[] => {
    const indexed = executionStateIndexes.has(state) && !full ? indexedRecords.get(record) : undefined;
    return indexed === undefined ? Object.entries(record)
      : [...indexed.dirty].flatMap(key => record[key] === undefined ? [] : [[key, record[key]!] as const]);
  };
  const accountEntries = entries(state.accounts);
  const accountDeleted = [...(indexedRecords.get(state.accounts)?.dirty ?? [])].some(key => state.accounts[key] === undefined);
  const positionEntries = entries(state.positions, accountDeleted);
  const liabilityEntries = entries(state.liabilities);
  const claimEntries = entries(state.obligations);
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
  for (const [key, account] of accountEntries) validateRecordIdentity("accounts", "account", key, account.id);
  for (const [key, position] of positionEntries) {
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
  for (const [key, liability] of liabilityEntries) validateRecordIdentity("liabilities", "liability", key, liability.id);
  for (const [key, claim] of claimEntries) validateRecordIdentity("obligations", "claim", key, claim.id);
  for (const [, account] of accountEntries) {
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
  for (const [, liability] of liabilityEntries) {
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
  for (const [, position] of positionEntries) {
    if (position.quantity.isNegative() || position.price.isNegative() || position.carryingValue.isNegative()) {
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
  for (const record of [state.accounts, state.positions, state.liabilities, state.obligations]) indexedRecords.get(record)?.dirty.clear();
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
  const indexed = executionStateIndexes.get(candidate);
  if (indexed === undefined) executionStateIndexes.delete(target);
  else executionStateIndexes.set(target, indexed);
};

export interface PositionValuationInput {
  readonly positionId: PositionId;
  readonly price: Money;
  readonly generatedOccurrenceKey: GeneratedOccurrenceKey;
}

/** Returns one isolated valuation candidate; callers need no preceding state clone. */
export const positionValuationCandidate = (
  state: AuthoritativeState,
  input: PositionValuationInput,
): AuthoritativeState => {
  const candidate = cloneAuthoritativeState(state);
  const position = candidate.positions[input.positionId];
  if (position === undefined) {
    failValidation({ severity: "error", code: issueCodes.stateTargetNotFound, message: `Unknown position ${input.positionId} in valuation`, entityType: "position", entityId: input.positionId });
  }
  if (input.price.isNegative()) {
    failValidation({ severity: "error", code: issueCodes.negativePositionInvariant, message: `Valuation creates a negative price in ${input.positionId}`, entityType: "position", entityId: input.positionId, fieldPath: "price" });
  }
  if (!input.price.currency.equals(position.price.currency)) {
    failValidation({ severity: "error", code: issueCodes.runBaseCurrencyMismatch, message: `Valuation currency ${input.price.currency.code} does not match position ${input.positionId}`, entityType: "position", entityId: input.positionId, fieldPath: "price" });
  }
  registerAuthoritativeIdentity(candidate.identities, "generatedOccurrenceKeys", input.generatedOccurrenceKey);
  candidate.positions[input.positionId] = { ...position, price: input.price };
  validateAuthoritativeState(candidate);
  return candidate;
};

/** Commits a non-cash valuation and its generated occurrence identity atomically. */
export const applyPositionValuationAtomically = (state: AuthoritativeState, input: PositionValuationInput): void => {
  commitCandidate(state, positionValuationCandidate(state, input));
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
