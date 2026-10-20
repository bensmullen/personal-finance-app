import {
  assertBalanced,
  accountingTransactionId, createAccountingLeg, createAccountingTransaction,
  type AccountingTransaction,
  type AccountingTransactionId,
  type AccountId,
  type LiabilityId,
  type PositionId,
} from "../accounting/index.js";
import { failValidation, issueCodes } from "../diagnostics/index.js";
import { idempotencyKey, type DomainId, type GeneratedOccurrenceKey, type IdempotencyKey } from "../identity/index.js";
import { assertClaimInvariant, normalizeExecutionClaim, materializeClaimLifecycle, settlementIdentityAppendsSince, type SettlementHistoryMeter, type ObligationOrRight } from "../semantics/claim.js";
import { prepareSsaMedicareDeductionProposals, type SsaPayableEvidence, type SsaDeductionRequest } from "../semantics/settlement.js";
import type { ClaimId, RecognitionId, SettlementId } from "../semantics/identity.js";
import type { CalculationTraceId } from "../lineage/index.js";
import { createRecognitionFact as createRecognitionFactWithHistory, type RecognitionFactDraft, type RecognitionFact } from "../semantics/recognition.js";
import { Money, Quantity, decimal, type Currency, type Rate } from "../values/index.js";
import { instant, type Instant } from "../time/index.js";

/** Source-owner lookup addresses; neither these values nor their fingerprint
 * authenticate the external source. Domain owners must independently qualify. */
interface D2SourceBinding {
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly ruleVersion: string;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly householdId: DomainId<"household">;
  readonly personId: DomainId<"person">;
  readonly sourceApprovalId: string;
  readonly paymentApprovalId: string;
  /** Source-authenticated order for operations sharing an economic instant and
   * resource. Balance observations and callback/array order are not witnesses. */
  readonly executionOrder?: { readonly sequenceId: string; readonly position: number };
}
export interface D2FsaSourceBinding extends D2SourceBinding {
  readonly kind: "fsa_paid_reimbursement";
  readonly planId: string;
  readonly planYearId: string;
  readonly memberId: string;
  readonly payeeId: string;
  readonly medicalReceiptId: string;
  readonly expensePaymentId: string;
  readonly incurredAt: Instant;
  readonly entitlementConsumptionId: string;
}
export interface D2CardSourceBinding extends D2SourceBinding {
  readonly kind: "card_interest_payment";
  readonly issuerId: string;
  readonly statementId: string;
  readonly chargeId: string;
  readonly quoteId: string;
  readonly minimum: Money;
}
interface D2ReceiptBase {
  readonly schemaVersion: "d2-shared/settlement-receipt/v1";
  readonly id: string;
  readonly operationId: string;
  readonly authorizationId: string;
  readonly claimId: ClaimId;
  readonly paymentId: string;
  readonly recognitionId: RecognitionId;
  readonly settlementId: SettlementId;
  readonly effectiveAt: Instant;
  readonly bankAccountId: AccountId;
  readonly bankCashBefore: Money;
  readonly amount: Money;
  readonly traceIds: readonly CalculationTraceId[];
  /** Canonical evidence content, never a cryptographic authentication claim. */
  readonly sourceEvidenceFingerprint: string;
  /** Original immutable itemized magnitudes AND posting signs. */
  readonly originalTransaction: AccountingTransaction;
  readonly paymentTransaction: AccountingTransaction;
}
export interface D2FsaSettlementReceipt extends D2ReceiptBase {
  readonly kind: "fsa_paid_reimbursement";
  readonly source: D2FsaSourceBinding;
  readonly eligibleExpense: Money;
  readonly entitlementConsumed: Money;
}
export interface D2CardSettlementReceipt extends D2ReceiptBase {
  readonly kind: "card_interest_payment";
  readonly source: D2CardSourceBinding;
  readonly liabilityId: LiabilityId;
  readonly liabilityBefore: Money;
  readonly postedInterest: Money;
  readonly postedFee: Money;
  readonly interestAllocation: Money;
  readonly principalAllocation: Money;
  readonly feeAllocation: Money;
}
export type D2SettlementReceipt = D2FsaSettlementReceipt | D2CardSettlementReceipt;
/** Structural subset of RunContext; state cannot depend on simulation. */
export interface D2SettlementSourceContext { readonly asOf: Instant; readonly dataCutoff: Instant; }
export type D2SourceQualification = { readonly status: "qualified"; readonly receipt: D2SettlementReceipt }
  | { readonly status: "incomplete"; readonly reason: "source_unavailable" | "source_not_qualified" | "original_journal_unavailable" | "posted_journal_unavailable" };
export interface D2SettlementSourceAuthority {
  /** Re-evaluate independent plan/issuer, ownership, approvals and paid evidence.
   * Returning the caller's record or hash does not implement this contract. */
  readonly qualify: (binding: D2FsaSourceBinding | D2CardSourceBinding, context: D2SettlementSourceContext) => D2SourceQualification;
  /** Independently look up ACTUAL canonical journals for prior originals and
   * restored history. An identity inventory or receipt copy is insufficient.
   * Registration does not archive successful postings. A production owner must
   * recover committed journal output from an independent durable source; the
   * summary sink and portable receipt are not such a source. Until that seam
   * exists, restored funded history remains explicitly incomplete. */
  readonly postedTransaction: (id: AccountingTransactionId, context: D2SettlementSourceContext) => AccountingTransaction | undefined;
}
const d2SourceAuthorities = new Map<D2SettlementReceipt["kind"], D2SettlementSourceAuthority>();
/** Composition-root port, not a replaceable per-transition validator. */
export const registerD2SettlementSourceAuthority = (kind: D2SettlementReceipt["kind"], authority: D2SettlementSourceAuthority): void => {
  if (d2SourceAuthorities.has(kind)) throw new Error("D2_SETTLEMENT_SOURCE_AUTHORITY_DUPLICATE");
  d2SourceAuthorities.set(kind, Object.freeze({ ...authority }));
};

/** Source-specific same-event journal evidence, not a second cash ledger.
 * Domain admission re-evaluates sourceInputs through A1/C2. Portable integrity
 * detects changes; neither this record nor an artifact authenticates publishers.
 */
export interface SsaMedicarePaymentInput {
  readonly payable: SsaPayableEvidence;
  readonly right: ObligationOrRight;
  readonly requests: readonly SsaDeductionRequest[];
  readonly bankAccountId: AccountId;
  readonly bankCashBefore: Money;
  readonly rightSettlementId: SettlementId;
  readonly sourceInputs: unknown;
}
export interface SsaMedicarePaymentRecord extends SsaMedicarePaymentInput {
  readonly version: "ssa-medicare-payment/v1";
  readonly id: string;
  readonly netBank: Money;
  readonly transaction: AccountingTransaction;
  readonly recognitions: readonly RecognitionFact[];
}
// Inward-facing source port: state owns atomic accounting, while the sole
// opt-in adapter owns A1/C2 re-evaluation. Imported receipts fail closed until
// the source owner is available. No caller-provided receipt or callback is
// accepted by the transition itself, and registration cannot be replaced.
let ssaMedicareSourceAuthority: ((inputs: unknown) => SsaMedicarePaymentInput) | undefined;
export const registerSsaMedicareSourceAuthority = (qualify: (inputs: unknown) => SsaMedicarePaymentInput): void => {
  if (ssaMedicareSourceAuthority !== undefined) throw new Error("SSA_MEDICARE_SOURCE_AUTHORITY_DUPLICATE");
  ssaMedicareSourceAuthority = qualify;
};
const paymentKey = (p: SsaPayableEvidence): string => JSON.stringify([p.householdId, p.recipientId, p.paymentId]);
// Exact structural equality also survives independent portable restoration.
const paymentValue = (value: unknown): string => {
  const plain = (v: unknown): unknown => typeof v === "bigint" ? ["bigint", v.toString()]
    : v instanceof Money ? ["USD-money", v.currency.code, v.amount.toString()]
    : Array.isArray(v) ? v.map(plain) : v !== null && typeof v === "object"
      ? "toJSON" in v && typeof v.toJSON === "function" ? plain(v.toJSON())
        : Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, plain(x)])) : v;
  return JSON.stringify(plain(value));
};
const freezePayment = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(freezePayment)) as T;
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freezePayment(x)]))) as T;
};
const paymentInvalid = (message: string): never => failValidation({ severity: "error", code: "SSA_MEDICARE_PAYMENT_INVALID",
  entityType: "ssa_medicare_payment", message });
const validatePaymentSources = (input: SsaMedicarePaymentInput): void => {
  if (ssaMedicareSourceAuthority === undefined) paymentInvalid("A1/C2 source owner unavailable for this receipt");
  const qualified = ssaMedicareSourceAuthority!(input.sourceInputs);
  const values = (v: SsaMedicarePaymentInput) => ({ payable: v.payable, right: v.right, requests: v.requests,
    bankAccountId: v.bankAccountId, bankCashBefore: v.bankCashBefore, rightSettlementId: v.rightSettlementId, sourceInputs: v.sourceInputs });
  if (paymentValue(values(input)) !== paymentValue(values(qualified))) paymentInvalid("Payment differs from requalified A1/C2 source authority");
};
const paymentJournal = (input: SsaMedicarePaymentInput): AccountingTransaction => {
  const batch = prepareSsaMedicareDeductionProposals(input.payable, input.right, input.requests);
  return createAccountingTransaction({ id: accountingTransactionId(`ssa-medicare:${input.payable.paymentId}`),
    date: input.payable.paymentAt, type: "ssa_medicare_same_event", legs: [
      ...(batch.conditionalNetPayable.isZero() ? [] : [createAccountingLeg({ type: "cash", posting: "debit",
        accountId: input.bankAccountId, amount: batch.conditionalNetPayable, cashFlowClass: "operating" })]),
      createAccountingLeg({ type: "expense", posting: "debit", amount: batch.deductionAmount }),
      createAccountingLeg({ type: "income", posting: "credit", amount: input.payable.grossPayable }),
    ] });
};

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
  /** Exact changes between shared roots; unchanged subtrees are never scanned. */
  changesSince(before: PersistentStringIndex<T>): {
    readonly changes: readonly { readonly key: string; readonly before: T | undefined; readonly after: T | undefined }[];
    readonly visitedNodes: number;
  } {
    const findNode = (index: PersistentStringIndex<T>, key: string): IndexNode<T> | undefined => {
      let node = index.#root;
      while (node !== undefined && node.key !== key) node = key < node.key ? node.left : node.right;
      return node;
    };
    const changes = new Map<string, { readonly key: string; readonly before: T | undefined; readonly after: T | undefined }>();
    let visitedNodes = 0;
    const visit = (node: IndexNode<T> | undefined, other: PersistentStringIndex<T>, removals: boolean): void => {
      if (node === undefined) return;
      visitedNodes += 1;
      const counterpart = findNode(other, node.key);
      if (counterpart === node) return;
      if (removals) {
        if (counterpart === undefined) changes.set(node.key, { key: node.key, before: node.value, after: undefined });
      } else if (counterpart === undefined || counterpart.value !== node.value) {
        changes.set(node.key, { key: node.key, before: counterpart?.value, after: node.value });
      }
      visit(node.left, other, removals); visit(node.right, other, removals);
    };
    visit(this.#root, before, false);
    visit(before.#root, this, true);
    return { changes: [...changes.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0), visitedNodes };
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

/** Committed statutory usage is independent of account balances and later vesting. */
export interface ContributionState {
  readonly source?: "opening";
  readonly id: string;
  readonly at: Instant;
  readonly personId: string;
  readonly accountId: string;
  readonly character: string;
  readonly amount: Money;
  readonly requested?: Money;
  readonly excess?: Money;
  readonly buckets: readonly { readonly identity: string; readonly amount: Money; readonly annualLimit: Money; readonly ruleIds: readonly string[]; readonly usedBefore?: Money; readonly remainingBefore?: Money; readonly facts?: Readonly<Record<string, string | boolean>> }[];
  readonly eligibleDeduction?: Money;
  readonly incomeId?: string;
  readonly employerBenefit?: { readonly positionId: PositionId; readonly vestedAtContribution: Money; readonly contingentAtContribution: Money };
}
export interface ContingentPositionState {
  readonly positionId: PositionId;
  quantity: Quantity;
  carryingValue: Money;
}
export interface AuthoritativeState {
  accounts: Record<string, AccountState>;
  positions: Record<string, PositionState>;
  liabilities: Record<string, LiabilityState>;
  obligations: Record<string, ObligationOrRight>;
  identities: AuthoritativeIdentityRegistry;
  contributions?: Record<string, ContributionState>;
  contingentPositions?: Record<string, ContingentPositionState>;
  ssaMedicarePayments?: Record<string, SsaMedicarePaymentRecord>;
  d2SettlementReceipts?: Record<string, D2SettlementReceipt>;
}

export interface AuthoritativeStateDraft {
  readonly accounts?: Record<string, AccountState>;
  readonly positions?: Record<string, PositionState>;
  readonly liabilities?: Record<string, LiabilityState>;
  readonly obligations?: Record<string, ObligationOrRight>;
  readonly identities?: Partial<AuthoritativeIdentityRegistry>;
  readonly contributions?: Record<string, ContributionState>;
  readonly contingentPositions?: Record<string, ContingentPositionState>;
  readonly ssaMedicarePayments?: Record<string, SsaMedicarePaymentRecord>;
  readonly d2SettlementReceipts?: Record<string, D2SettlementReceipt>;
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
  readonly pendingSettlementIds: Set<import("../semantics/identity.js").SettlementId>;
  readonly historyMeter?: SettlementHistoryMeter;
}
const executionStateIndexes = new WeakMap<AuthoritativeState, ExecutionStateIndex>();

/**
 * A complete, exact delta against one fixed comparison opening state. Callers
 * supply authoritative value equality; no financial hashing or approximation
 * belongs in the state layer. Explicit tags distinguish deletion from setting
 * an authoritative value. Legacy states
 * without shared indexes retain the complete-state comparison representation.
 */
export const authoritativeStateChangesSince = (
  state: AuthoritativeState, before: AuthoritativeState,
  equal: (left: unknown, right: unknown) => boolean,
  visited?: (nodes: number) => void,
): unknown => {
  const fields = ["accounts", "positions", "liabilities", "obligations"] as const;
  const identities = identityIndexes.get(state.identities);
  const priorIdentities = identityIndexes.get(before.identities);
  if (identities === undefined || priorIdentities === undefined ||
      fields.some(field => !indexedRecords.has(state[field]) || !indexedRecords.has(before[field]))) return state;
  const claimValue = (value: unknown, previous: unknown): unknown => {
    if (previous === undefined) return value;
    const claim = value as ObligationOrRight, base = previous as ObligationOrRight;
    let appended = settlementIdentityAppendsSince(claim.settlementIds, base.settlementIds);
    // Independent cold replacements can have an economically identical prefix.
    // Only that compatibility lane scans it; indexed appends prove sharing.
    if (appended === undefined && claim.settlementIds.length >= base.settlementIds.length &&
        base.settlementIds.every((id, index) => claim.settlementIds[index] === id))
      appended = claim.settlementIds.slice(base.settlementIds.length);
    return appended === undefined ? claim : { ...claim, settlementIds: { kind: "opening_prefix", length: base.settlementIds.length, appended } };
  };
  const changes = <T>(index: PersistentStringIndex<T>, prior: PersistentStringIndex<T>, encode: (value: T, previous: T | undefined) => unknown = value => value) => {
    const delta = index.changesSince(prior);
    visited?.(delta.visitedNodes);
    return delta.changes.flatMap<{ key: string; kind: "delete" } | { key: string; kind: "set"; value: unknown }>(change => {
      if (change.after === undefined) return [{ key: change.key, kind: "delete" as const }];
      const value = encode(change.after, change.before);
      if (change.before !== undefined && equal(encode(change.before, change.before), value)) return [];
      return [{ key: change.key, kind: "set" as const, value }];
    });
  };
  return {
    ...Object.fromEntries(fields.map(field => [field, changes(indexedRecords.get(state[field])!.index, indexedRecords.get(before[field])!.index,
      field === "obligations" ? claimValue : value => value)])),
    identities: Object.fromEntries(identityKinds.map(kind => [kind, changes(identities[kind], priorIdentities[kind])])),
    ...(state.d2SettlementReceipts === undefined && before.d2SettlementReceipts === undefined ? {} : {
      d2SettlementReceipts: { present: state.d2SettlementReceipts !== undefined,
        changes: changes(d2ReceiptIndex(state.d2SettlementReceipts), d2ReceiptIndex(before.d2SettlementReceipts)) } }),
    ...(state.ssaMedicarePayments === undefined && before.ssaMedicarePayments === undefined ? {} : {
      ssaMedicarePayments: { present: state.ssaMedicarePayments !== undefined,
        changes: changes(indexedRecords.get(state.ssaMedicarePayments ?? {})?.index
          ?? new PersistentStringIndex(Object.entries(state.ssaMedicarePayments ?? {})),
        indexedRecords.get(before.ssaMedicarePayments ?? {})?.index
          ?? new PersistentStringIndex(Object.entries(before.ssaMedicarePayments ?? {}))) } }),
  };
};
const claimGroup = (category: string, balanceEntityId?: string): string => `${category}\u0000${balanceEntityId ?? ""}`;

/** Establish indexed execution once at the opening authority boundary. */
export const createIndexedExecutionState = (opening: AuthoritativeState, suppliedHistoryMeter?: SettlementHistoryMeter): AuthoritativeState => {
  const existing = executionStateIndexes.get(opening);
  if (existing === undefined) validateAuthoritativeState(opening);
  const recognitionClaims = existing?.recognitionClaims.fork() ?? new PersistentStringIndex<string>();
  const settlementClaims = existing?.settlementClaims.fork() ?? new PersistentStringIndex<string>();
  const activeClaims = existing?.activeClaims.fork() ?? new PersistentStringIndex<PersistentStringIndex<ObligationOrRight>>();
  const pendingClaimIds = new Set(existing?.pendingClaimIds);
  const pendingSettlementIds = new Set(existing?.pendingSettlementIds);
  const historyMeter = existing?.historyMeter ?? suppliedHistoryMeter;
  const updateClaim = (key: string, previous: ObligationOrRight | undefined, next: ObligationOrRight | undefined): void => {
    pendingClaimIds.add(key);
    const appended = previous === undefined || next === undefined || previous.originatingRecognitionId !== next.originatingRecognitionId
      ? undefined : settlementIdentityAppendsSince(next.settlementIds, previous.settlementIds);
    const monotonic = appended !== undefined;
    if (previous !== undefined) {
      if (!monotonic) {
        recognitionClaims.delete(previous.originatingRecognitionId);
        for (const settlement of previous.settlementIds) settlementClaims.delete(settlement);
      }
      const groupKey = claimGroup(previous.category, previous.balanceEntityId);
      const group = activeClaims.get(groupKey)?.fork();
      if (group !== undefined) { group.delete(key); if (group.size === 0) activeClaims.delete(groupKey); else activeClaims.set(groupKey, group); }
    }
    if (next !== undefined) {
      const owner = recognitionClaims.get(next.originatingRecognitionId);
      if (owner !== undefined && owner !== key) failValidation({ severity: "error", code: issueCodes.duplicateRecognition,
        message: `Recognition ${next.originatingRecognitionId} is claimed by multiple claims`, entityType: "claim",
        entityId: next.id, fieldPath: "originatingRecognitionId", relatedIds: [owner, next.originatingRecognitionId] });
      if (!monotonic) recognitionClaims.set(next.originatingRecognitionId, key);
      for (const settlement of appended ?? next.settlementIds) {
        const settlementOwner = settlementClaims.get(settlement);
        if (settlementOwner !== undefined && settlementOwner !== key) failValidation({ severity: "error", code: issueCodes.duplicateSettlement,
          message: `Settlement ${settlement} is claimed by multiple claims`, entityType: "claim", entityId: next.id,
          fieldPath: "settlementIds", relatedIds: [settlementOwner, settlement] });
        settlementClaims.set(settlement, key);
        pendingSettlementIds.add(settlement);
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
    const next = indexedRecord(previous?.index.fork() ?? new PersistentStringIndex(Object.entries(record).map(([key, value]) =>
      [key, normalize === undefined ? value : normalize(value)] as const)), mutable, changed, normalize);
    if (previous !== undefined) for (const key of previous.dirty) next.dirty.add(key);
    return next.record;
  };
  const state: AuthoritativeState = {
    accounts: makeRecord(opening.accounts, true), positions: makeRecord(opening.positions, true),
    liabilities: makeRecord(opening.liabilities, true), obligations: makeRecord(opening.obligations, false, updateClaim, value => normalizeExecutionClaim(value, historyMeter)),
    identities: indexedIdentityRegistry(opening.identities),
    ...(opening.contributions === undefined ? {} : { contributions: { ...opening.contributions } }),
    ...(opening.contingentPositions === undefined ? {} : { contingentPositions: Object.fromEntries(Object.entries(opening.contingentPositions).map(([key, value]) => [key, { ...value }])) }),
    ...(opening.ssaMedicarePayments === undefined ? {} : { ssaMedicarePayments: makeRecord(opening.ssaMedicarePayments, false, undefined, freezePayment) }),
    ...(opening.d2SettlementReceipts === undefined ? {} : { d2SettlementReceipts: makeRecord(opening.d2SettlementReceipts, false, d2ReceiptWrite, freezePayment) }),
  };
  const receiptHistory = d2ReceiptHistories.get(opening);
  if (receiptHistory !== undefined) d2ReceiptHistories.set(state, receiptHistory);
  if (existing === undefined) for (const [key, claim] of Object.entries(state.obligations)) updateClaim(key, undefined, claim);
  if (existing === undefined) { pendingClaimIds.clear(); pendingSettlementIds.clear(); }
  executionStateIndexes.set(state, { recognitionClaims, settlementClaims, activeClaims, pendingClaimIds, pendingSettlementIds,
    ...(historyMeter === undefined ? {} : { historyMeter }) });
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
    obligations: Object.fromEntries(Object.entries(draft.obligations ?? {}).map(([key, value]) => [key, materializeClaimLifecycle(value)])),
    identities: createAuthoritativeIdentityRegistry(draft.identities),
    ...(draft.contributions === undefined ? {} : { contributions: { ...draft.contributions } }),
    ...(draft.contingentPositions === undefined ? {} : { contingentPositions: Object.fromEntries(Object.entries(draft.contingentPositions).map(([key, value]) => [key, { ...value }])) }),
    ...(draft.ssaMedicarePayments === undefined ? {} : { ssaMedicarePayments: Object.fromEntries(Object.entries(draft.ssaMedicarePayments).map(([key, value]) => [key, freezePayment(value)])) }),
    ...(draft.d2SettlementReceipts === undefined ? {} : { d2SettlementReceipts: indexedRecord(new PersistentStringIndex(
      Object.entries(draft.d2SettlementReceipts).map(([key, value]) => [key, freezePayment(value)] as const)), false, d2ReceiptWrite, freezePayment).record }),
  };
  // Receipt identities must already exist on import; reconciliation must not
  // manufacture missing posting authority for caller-supplied history.
  validateSsaMedicarePayments(state);
  validateD2SettlementReceipts(state);
  reconcileClaimIdentityHistory(state);
  validateAuthoritativeState(state);
  return state;
};

export const cloneAuthoritativeState = (state: AuthoritativeState): AuthoritativeState => {
  validateD2SettlementReceipts(state);
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
  }
  const pendingSettlementIds = executionStateIndexes.get(candidate)!.pendingSettlementIds;
  for (const settlement of pendingSettlementIds) if (!candidate.identities.settlementIds.includes(settlement))
    registerAuthoritativeIdentity(candidate.identities, "settlementIds", settlement);
  pendingSettlementIds.clear();
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
  validateD2SettlementReceipts(state);
  validateSsaMedicarePayments(state);
  for (const [id, entry] of Object.entries(state.contributions ?? {})) {
    const account = state.accounts[entry.accountId];
    if (id !== entry.id || entry.amount.isNegative() || account === undefined || !entry.amount.currency.equals(account.cash.currency) || entry.buckets.some(bucket => bucket.amount.isNegative() || !bucket.amount.currency.equals(entry.amount.currency) || !bucket.annualLimit.currency.equals(entry.amount.currency) || bucket.annualLimit.isNegative() || bucket.amount.compare(entry.amount) > 0) || entry.eligibleDeduction !== undefined && (entry.eligibleDeduction.isNegative() || entry.eligibleDeduction.compare(entry.amount) > 0))
      failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message: "Invalid committed contribution ledger entry", entityType: "contribution", entityId: id });
  }
  for (const [id, entry] of Object.entries(state.contingentPositions ?? {})) {
    const position = state.positions[id];
    if (id !== entry.positionId || !position || !entry.quantity.unit.equals(position.quantity.unit) || !entry.carryingValue.currency.equals(position.price.currency) || entry.quantity.amount.isNegative() || entry.carryingValue.isNegative())
      failValidation({ severity: "error", code: issueCodes.negativePositionInvariant, message: "Invalid contingent workplace position", entityType: "position", entityId: id });
  }
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
  for (const [key, entry] of Object.entries(state.contributions ?? {})) {
    assertCurrency(entry.amount, `contributions.${key}.amount`, "contribution", key);
    if (entry.eligibleDeduction) assertCurrency(entry.eligibleDeduction, `contributions.${key}.eligibleDeduction`, "contribution", key);
    for (const bucket of entry.buckets) { assertCurrency(bucket.amount, `contributions.${key}.bucket.amount`, "contribution", key); assertCurrency(bucket.annualLimit, `contributions.${key}.bucket.annualLimit`, "contribution", key); }
  }
  for (const [key, entry] of Object.entries(state.contingentPositions ?? {})) assertCurrency(entry.carryingValue, `contingentPositions.${key}.carryingValue`, "position", key);
  for (const [key, entry] of Object.entries(state.ssaMedicarePayments ?? {})) {
    assertCurrency(entry.payable.grossPayable, `ssaMedicarePayments.${key}.gross`, "ssa_medicare_payment", key);
    assertCurrency(entry.netBank, `ssaMedicarePayments.${key}.netBank`, "ssa_medicare_payment", key);
  }
  for (const [key, receipt] of Object.entries(state.d2SettlementReceipts ?? {}))
    for (const amount of d2ReceiptAmounts(receipt)) assertCurrency(amount, `d2SettlementReceipts.${key}`, "d2_settlement_receipt", key);
  for (const [key, liability] of Object.entries(state.liabilities)) assertCurrency(liability.balance, `liabilities.${key}.balance`, "liability", liability.id);
  for (const [key, position] of Object.entries(state.positions)) {
    assertCurrency(position.price, `positions.${key}.price`, "position", position.id);
    assertCurrency(position.carryingValue, `positions.${key}.carryingValue`, "position", position.id);
  }
};

const commitCandidate = (target: AuthoritativeState, candidate: AuthoritativeState): void => {
  assertD2SettlementReceiptHistoryPreserved(target, candidate);
  target.accounts = candidate.accounts;
  target.positions = candidate.positions;
  target.liabilities = candidate.liabilities;
  target.obligations = candidate.obligations;
  target.identities = candidate.identities;
  if (candidate.contributions !== undefined) target.contributions = candidate.contributions;
  if (candidate.contingentPositions !== undefined) target.contingentPositions = candidate.contingentPositions;
  if (candidate.ssaMedicarePayments !== undefined) target.ssaMedicarePayments = candidate.ssaMedicarePayments;
  else delete target.ssaMedicarePayments;
  if (candidate.d2SettlementReceipts !== undefined) target.d2SettlementReceipts = candidate.d2SettlementReceipts;
  else delete target.d2SettlementReceipts;
  const receiptHistory = d2ReceiptHistories.get(candidate);
  if (receiptHistory !== undefined) d2ReceiptHistories.set(target, receiptHistory);
  const indexed = executionStateIndexes.get(candidate);
  if (indexed === undefined) executionStateIndexes.delete(target);
  else executionStateIndexes.set(target, indexed);
};

const d2Invalid = (message: string): never => failValidation({ severity: "error", code: "D2_SETTLEMENT_RECEIPT_INVALID",
  entityType: "d2_settlement_receipt", message });
const d2ReceiptWrite = (_key: string, previous: D2SettlementReceipt | undefined, next: D2SettlementReceipt | undefined): void => {
  if (previous !== undefined && (next === undefined || paymentValue(previous) !== paymentValue(next)))
    d2Invalid("Committed receipt cannot be removed or rewritten");
};
const d2ReceiptIndex = (record: Record<string, D2SettlementReceipt> | undefined): PersistentStringIndex<object> =>
  (record === undefined ? undefined : indexedRecords.get(record)?.index)?.fork()
    ?? new PersistentStringIndex<object>(Object.entries(record ?? {}).map(([key, value]) => [key, freezePayment(value)] as const));
interface D2ReceiptHistory {
  readonly index: PersistentStringIndex<object>;
  readonly consumed: PersistentStringIndex<string>;
  readonly eventOrder: PersistentStringIndex<D2SettlementReceipt>;
  readonly banks: PersistentStringIndex<{ readonly personId: string; readonly currency: Currency }>;
  readonly liabilities: PersistentStringIndex<{ readonly currency: Currency; readonly issuerId: string; readonly personId: string; readonly householdId: string }>;
  readonly identities: AuthoritativeIdentityRegistry;
}
const d2ReceiptHistories = new WeakMap<AuthoritativeState, D2ReceiptHistory>();
const admitD2EventOrder = (events: PersistentStringIndex<D2SettlementReceipt>, r: D2SettlementReceipt): void => {
  const order = r.source.executionOrder;
  if (order !== undefined && (!order.sequenceId.trim() || !Number.isSafeInteger(order.position) || order.position < 0))
    d2Invalid("Invalid source execution order");
  const keys = new Set([r.originalTransaction, r.paymentTransaction].flatMap(tx => tx.legs.flatMap(leg =>
    leg.type === "cash" ? [JSON.stringify(["bank", leg.accountId, tx.date])]
      : leg.type === "liability" ? [JSON.stringify(["liability", leg.entityId, tx.date])] : [])));
  for (const key of keys) {
    const prior = events.get(key), before = prior?.source.executionOrder;
    if (prior !== undefined && (before === undefined || order === undefined ||
        before.sequenceId !== order.sequenceId || before.position >= order.position))
      d2Invalid("Same-instant resource use requires independently source-authenticated execution order");
    events.set(key, r);
  }
};
export const assertD2SettlementReceiptHistoryPreserved = (before: AuthoritativeState, after: AuthoritativeState): void => {
  const prior = d2ReceiptHistories.get(before)?.index ?? d2ReceiptIndex(before.d2SettlementReceipts);
  for (const change of d2ReceiptIndex(after.d2SettlementReceipts).changesSince(prior).changes)
    if (change.before !== undefined && (change.after === undefined || paymentValue(change.before) !== paymentValue(change.after)))
      d2Invalid("Committed receipt history is append-only");
};
const d2ReceiptAmounts = (r: D2SettlementReceipt): readonly Money[] => [r.amount, r.bankCashBefore,
  ...r.originalTransaction.legs.map(l => l.amount), ...r.paymentTransaction.legs.map(l => l.amount),
  ...(r.kind === "fsa_paid_reimbursement" ? [r.eligibleExpense, r.entitlementConsumed]
    : [r.liabilityBefore, r.postedInterest, r.postedFee, r.interestAllocation, r.principalAllocation, r.feeAllocation, r.source.minimum])];
/** The exact canonical source evidence value is deliberately transparent. This
 * fingerprint detects binding changes, but confers no publisher authority. */
export const d2SettlementSourceFingerprint = (source: D2FsaSourceBinding | D2CardSourceBinding): string => paymentValue(source);
const d2ConsumptionKeys = (r: D2SettlementReceipt): readonly IdempotencyKey[] => {
  const pairs: readonly (readonly [string, string])[] = [
    ["receipt", r.id], ["operation", r.operationId], ["authorization", r.authorizationId], ["claim", r.claimId],
    ["payment", r.paymentId], ["source-approval", r.source.sourceApprovalId], ["payment-approval", r.source.paymentApprovalId],
    ["transaction", r.originalTransaction.id], ["transaction", r.paymentTransaction.id],
    ["recognition", r.recognitionId], ["settlement", r.settlementId],
    ...(r.kind === "fsa_paid_reimbursement" ? [
      ["medical-receipt", r.source.medicalReceiptId], ["expense-payment", r.source.expensePaymentId],
      ["entitlement-consumption", r.source.entitlementConsumptionId],
    ] as const : [["issuer-charge", JSON.stringify([r.source.issuerId, r.source.chargeId])]] as const),
  ];
  return pairs.map(([kind, value]) => idempotencyKey(`d2-shared:${kind}`, value));
};
const validateD2Receipt = (state: AuthoritativeState, key: string, r: D2SettlementReceipt): void => {
  if (!r || r.schemaVersion !== "d2-shared/settlement-receipt/v1" || key !== r.id ||
      !["fsa_paid_reimbursement", "card_interest_payment"].includes(r.kind) || r.kind !== r.source.kind)
    d2Invalid("Unknown or malformed receipt schema/family");
  const strings = [r.id, r.operationId, r.authorizationId, r.claimId, r.paymentId, r.recognitionId, r.settlementId,
    r.bankAccountId, r.source.sourceId, r.source.sourceVersion, r.source.ruleVersion, r.source.householdId, r.source.personId,
    r.source.sourceApprovalId, r.source.paymentApprovalId, ...r.traceIds,
    ...(r.kind === "fsa_paid_reimbursement" ? [r.source.planId, r.source.planYearId, r.source.memberId, r.source.payeeId,
      r.source.medicalReceiptId, r.source.expensePaymentId, r.source.entitlementConsumptionId]
      : [r.liabilityId, r.source.issuerId, r.source.statementId, r.source.chargeId, r.source.quoteId])];
  if (strings.some(s => typeof s !== "string" || !s.trim()) || r.traceIds.length === 0 ||
      new Set(r.traceIds).size !== r.traceIds.length || r.sourceEvidenceFingerprint !== d2SettlementSourceFingerprint(r.source))
    d2Invalid("Missing identity, approval, trace or exact source fingerprint");
  for (const at of [r.effectiveAt, r.source.publishedAt, r.source.knownAt, r.originalTransaction.date, r.paymentTransaction.date]) instant(at);
  if (r.originalTransaction.date > r.effectiveAt || r.paymentTransaction.date !== r.effectiveAt ||
      r.source.publishedAt > r.source.knownAt || r.source.knownAt > r.effectiveAt || r.originalTransaction.id === r.paymentTransaction.id)
    d2Invalid("Source and economic event ordering mismatch");
  const bank = state.accounts[r.bankAccountId];
  if (!bank || !["checking", "savings"].includes(bank.kind) || bank.ownerId !== r.source.personId)
    d2Invalid("Receipt requires an independently source-bound owned BANK");
  for (const amount of d2ReceiptAmounts(r))
    if (!(amount instanceof Money) || amount.isNegative() || !amount.currency.equals(bank!.cash.currency) ||
        !amount.amount.fitsScale(amount.currency.minorUnitScale)) d2Invalid("Nonnegative exact same-currency money required");
  if (!r.amount.isPositive()) d2Invalid("Zero payment cannot prove paid settlement");
  assertBalanced(r.originalTransaction); assertBalanced(r.paymentTransaction);
  const cash = (posting: "debit" | "credit", amount: Money) => createAccountingLeg({ type: "cash", posting,
    accountId: r.bankAccountId, amount, cashFlowClass: "operating" });
  // Compare economic effects only here; full transaction values (including
  // IDs, dates, order and traces) are compared to independent source authority.
  const effects = (tx: AccountingTransaction) => tx.legs.map(({ traceRefs: _trace, ...leg }) => leg);
  let original: AccountingTransaction["legs"], payment: AccountingTransaction["legs"];
  if (r.kind === "fsa_paid_reimbursement") {
    instant(r.source.incurredAt);
    if (r.source.incurredAt > r.originalTransaction.date || r.amount.compare(r.eligibleExpense) > 0 || !r.entitlementConsumed.equals(r.amount))
      d2Invalid("Reimbursement must not exceed paid eligible expense and must equal entitlement consumption");
    original = [createAccountingLeg({ type: "expense", posting: "debit", amount: r.eligibleExpense }), cash("credit", r.eligibleExpense)];
    // Reimbursement offsets the original expense; it is never fresh wage income.
    payment = [cash("debit", r.amount), createAccountingLeg({ type: "expense", posting: "credit", amount: r.amount })];
  } else {
    const liability = state.liabilities[r.liabilityId];
    if (!liability || !liability.balance.currency.equals(r.amount.currency) ||
        !r.interestAllocation.plus(r.principalAllocation).plus(r.feeAllocation).equals(r.amount) ||
        r.interestAllocation.compare(r.postedInterest) > 0 || r.feeAllocation.compare(r.postedFee) > 0 ||
        r.principalAllocation.compare(r.liabilityBefore) > 0 || r.amount.compare(r.source.minimum) < 0)
      d2Invalid("Missing liability or inconsistent source-approved allocation/minimum");
    const charges = r.postedInterest.plus(r.postedFee);
    if (!charges.isPositive()) d2Invalid("Missing posted issuer charge");
    original = [createAccountingLeg({ type: "expense", posting: "debit", amount: charges }),
      createAccountingLeg({ type: "liability", posting: "credit", entityId: r.liabilityId, amount: charges })];
    payment = [createAccountingLeg({ type: "liability", posting: "debit", entityId: r.liabilityId, amount: r.amount }), cash("credit", r.amount)];
  }
  if (paymentValue(effects(r.originalTransaction)) !== paymentValue(original) || paymentValue(effects(r.paymentTransaction)) !== paymentValue(payment))
    d2Invalid("Original/payment signed economic effects differ from receipt");
};
/** Structural history validation never labels imported external evidence trusted.
 * Persistent snapshots compare only appended receipt/index paths during execution. */
export const validateD2SettlementReceipts = (state: AuthoritativeState): void => {
  const previous = d2ReceiptHistories.get(state), index = d2ReceiptIndex(state.d2SettlementReceipts);
  const delta = index.changesSince(previous?.index ?? new PersistentStringIndex<object>()).changes;
  const consumed = previous?.consumed.fork() ?? new PersistentStringIndex<string>();
  const eventOrder = previous?.eventOrder.fork() ?? new PersistentStringIndex<D2SettlementReceipt>();
  const banks = previous?.banks.fork() ?? new PersistentStringIndex<{ readonly personId: string; readonly currency: Currency }>();
  const liabilities = previous?.liabilities.fork() ?? new PersistentStringIndex<{
    readonly currency: Currency; readonly issuerId: string; readonly personId: string; readonly householdId: string }>();
  const priorIds = previous === undefined ? undefined : identityIndexes.get(previous.identities);
  const nextIds = identityIndexes.get(state.identities);
  const full = previous !== undefined && previous.identities !== state.identities && (priorIds === undefined || nextIds === undefined);
  if ((index.size > 0 || (previous?.index.size ?? 0) > 0) && priorIds !== undefined && nextIds !== undefined)
    for (const kind of identityKinds) for (const change of nextIds[kind].changesSince(priorIds[kind]).changes)
      if (change.before !== undefined && change.after === undefined) d2Invalid("Historical identities cannot be removed");
  // Cold imports may enumerate receipts by ID. Only authenticated source order
  // may establish economic precedence, including across portable checkpoints.
  const orderedDelta = [...delta].sort((a, b) =>
    (state.d2SettlementReceipts?.[a.key]?.source.executionOrder?.position ?? 0) -
    (state.d2SettlementReceipts?.[b.key]?.source.executionOrder?.position ?? 0));
  for (const change of orderedDelta) {
    if (change.before !== undefined && (change.after === undefined || paymentValue(change.before) !== paymentValue(change.after)))
      d2Invalid("Committed receipt cannot be removed or rewritten");
    if (change.before !== undefined) continue;
    const r = state.d2SettlementReceipts?.[change.key] ?? d2Invalid("Missing receipt");
    validateD2Receipt(state, change.key, r);
    admitD2EventOrder(eventOrder, r);
    for (const id of d2ConsumptionKeys(r)) {
      if (consumed.has(id)) d2Invalid("Historical receipt/source/authorization/claim/transaction reused");
      consumed.set(id, r.id);
    }
    const boundBank = banks.get(r.bankAccountId);
    if (boundBank !== undefined && boundBank.personId !== r.source.personId) d2Invalid("BANK ownership binding changed");
    banks.set(r.bankAccountId, { personId: r.source.personId, currency: r.amount.currency });
    if (r.kind === "card_interest_payment") {
      const prior = liabilities.get(r.liabilityId);
      if (prior !== undefined && (prior.issuerId !== r.source.issuerId || prior.personId !== r.source.personId || prior.householdId !== r.source.householdId))
        d2Invalid("Source-bound liability issuer/household/person changed");
      liabilities.set(r.liabilityId, { currency: r.amount.currency, issuerId: r.source.issuerId,
        personId: r.source.personId, householdId: r.source.householdId });
    }
  }
  const checkIds = (r: D2SettlementReceipt): void => {
    if (![r.originalTransaction.id, r.paymentTransaction.id].every(id => state.identities.postedTransactionIds.includes(id)) ||
        !state.identities.recognitionIds.includes(r.recognitionId) || !state.identities.settlementIds.includes(r.settlementId) ||
        d2ConsumptionKeys(r).some(id => !state.identities.externalIdempotencyKeys.includes(id))) d2Invalid("Missing committed receipt identities");
  };
  if (full) for (const r of Object.values(state.d2SettlementReceipts ?? {})) checkIds(r);
  else for (const change of delta) { const r = state.d2SettlementReceipts?.[change.key]; if (r !== undefined) checkIds(r); }
  const changedKeys = (record: object): Iterable<string> => indexedRecords.get(record)?.dirty ?? Object.keys(record);
  for (const key of changedKeys(state.accounts)) {
    const binding = banks.get(key), bank = state.accounts[key];
    if (binding !== undefined && (!bank || bank.ownerId !== binding.personId || !["checking", "savings"].includes(bank.kind) ||
        !bank.cash.currency.equals(binding.currency))) d2Invalid("Historical BANK reference changed");
  }
  for (const key of changedKeys(state.liabilities)) {
    const binding = liabilities.get(key), liability = state.liabilities[key];
    if (binding !== undefined && (!liability || !liability.balance.currency.equals(binding.currency))) d2Invalid("Historical liability reference changed");
  }
  // Cold record replacement can omit referenced resources without a dirty key.
  if (!indexedRecords.has(state.accounts)) {
    for (const [key] of banks.entries()) if (!state.accounts[key]) d2Invalid("Historical BANK removed");
  }
  if (!indexedRecords.has(state.liabilities)) {
    for (const [key] of liabilities.entries()) if (!state.liabilities[key]) d2Invalid("Historical liability removed");
  }
  // A removed optional record must not make historical consumption disappear.
  // Cold imports scan once; indexed execution checks only identity additions.
  const receiptKeyPrefix = idempotencyKey("d2-shared:receipt", "sentinel").slice(0, -"8:sentinel".length);
  const inventory = priorIds !== undefined && nextIds !== undefined
    ? nextIds.externalIdempotencyKeys.changesSince(priorIds.externalIdempotencyKeys).changes.flatMap(c => c.after === undefined ? [] : [c.after])
    : state.identities.externalIdempotencyKeys;
  for (const id of inventory) if (id.startsWith(receiptKeyPrefix) && !consumed.has(id))
    d2Invalid("Receipt inventory exists without its immutable receipt");
  d2ReceiptHistories.set(state, { index, consumed, eventOrder, banks, liabilities, identities: indexedIdentityRegistry(state.identities) });
};
const qualifyD2Receipt = (receipt: D2SettlementReceipt, context: D2SettlementSourceContext): D2SourceQualification => {
  instant(context.asOf); instant(context.dataCutoff);
  if (receipt.source.knownAt > context.dataCutoff || receipt.source.publishedAt > context.asOf)
    return { status: "incomplete", reason: "source_not_qualified" };
  const authority = d2SourceAuthorities.get(receipt.kind);
  if (authority === undefined) return { status: "incomplete", reason: "source_unavailable" };
  const result = authority.qualify(freezePayment(receipt.source), Object.freeze({ ...context }));
  if (result.status === "qualified" && paymentValue(result.receipt) !== paymentValue(receipt))
    d2Invalid("Receipt differs from independently requalified source, approvals or actual signed journals");
  return result;
};
const requalifyD2PostedJournals = (receipt: D2SettlementReceipt, context: D2SettlementSourceContext): boolean => {
  const authority = d2SourceAuthorities.get(receipt.kind);
  if (authority === undefined) return false;
  for (const expected of [receipt.originalTransaction, receipt.paymentTransaction]) {
    const actual = authority.postedTransaction(expected.id, context);
    if (actual === undefined) return false;
    if (paymentValue(actual) !== paymentValue(expected)) d2Invalid("Actual historical journal differs from receipt signed effects");
  }
  return true;
};
/** Portable restore must call this separately from structural state validation.
 * The artifact's integrity fingerprint cannot replace source-owner admission. */
export const requalifyD2SettlementReceiptHistory = (state: AuthoritativeState, context: D2SettlementSourceContext): void => {
  validateD2SettlementReceipts(state);
  for (const receipt of Object.values(state.d2SettlementReceipts ?? {})) {
    const result = qualifyD2Receipt(receipt, context);
    if (result.status === "incomplete") throw new Error(`D2_SETTLEMENT_SOURCE_INCOMPLETE: ${result.reason}`);
    if (!requalifyD2PostedJournals(receipt, context)) throw new Error("D2_SETTLEMENT_SOURCE_INCOMPLETE: posted_journal_unavailable");
  }
};
interface D2RemainingReimbursement {
  readonly remainingReimbursement?: { readonly status: "incomplete";
    readonly reason: "entitlement_installment_port_required"; readonly unreimbursedExpense: Money };
}
const d2RemainingReimbursement = (receipt: D2SettlementReceipt): D2RemainingReimbursement =>
  receipt.kind === "fsa_paid_reimbursement" && receipt.amount.compare(receipt.eligibleExpense) < 0
    ? { remainingReimbursement: { status: "incomplete", reason: "entitlement_installment_port_required",
      unreimbursedExpense: receipt.eligibleExpense.minus(receipt.amount) } } : {};
export type D2SettlementCommitResult = ({ readonly status: "committed" | "already_committed"; readonly receipt: D2SettlementReceipt } & D2RemainingReimbursement)
  | Extract<D2SourceQualification, { readonly status: "incomplete" }>;
/** Only the canonical accounting writer changes economic state. A failed source,
 * journal, funding or late validation leaves all balances and identities intact. */
export const applyD2SettlementAtomically = (state: AuthoritativeState, input: D2SettlementReceipt,
  context: D2SettlementSourceContext): D2SettlementCommitResult => {
  const receipt = freezePayment(input);
  validateD2Receipt(state, receipt.id, receipt);
  const qualification = qualifyD2Receipt(receipt, context);
  if (qualification.status === "incomplete") return qualification;
  validateD2SettlementReceipts(state);
  const existing = state.d2SettlementReceipts?.[receipt.id];
  if (existing !== undefined) {
    if (paymentValue(existing) !== paymentValue(receipt)) d2Invalid("Repeated receipt payload changed");
    if (!requalifyD2PostedJournals(existing, context)) return { status: "incomplete", reason: "posted_journal_unavailable" };
    return { status: "already_committed", receipt: existing, ...d2RemainingReimbursement(existing) };
  }
  const candidate = cloneAuthoritativeState(state);
  const priorPosted = candidate.identities.postedTransactionIds.includes(receipt.originalTransaction.id);
  if (priorPosted) {
    const actual = d2SourceAuthorities.get(receipt.kind)!.postedTransaction(receipt.originalTransaction.id, context);
    if (actual === undefined) return { status: "incomplete", reason: "original_journal_unavailable" };
    if (paymentValue(actual) !== paymentValue(receipt.originalTransaction)) d2Invalid("Prior actual journal differs from signed source proof");
  }
  const bank = candidate.accounts[receipt.bankAccountId]!;
  const expectedCash = priorPosted && receipt.kind === "fsa_paid_reimbursement"
    ? receipt.bankCashBefore.minus(receipt.eligibleExpense) : receipt.bankCashBefore;
  if (!bank.cash.equals(expectedCash)) d2Invalid("Source-bound BANK opening changed or funding contended");
  if (receipt.kind === "card_interest_payment") {
    const expected = priorPosted ? receipt.liabilityBefore.plus(receipt.postedInterest).plus(receipt.postedFee) : receipt.liabilityBefore;
    if (!candidate.liabilities[receipt.liabilityId]!.balance.equals(expected)) d2Invalid("Source-bound liability opening changed");
  }
  // This records only the approved allocation. Partial reimbursement leaves
  // remaining expense outstanding; later installments need a domain-owned
  // entitlement port. Consumption keys deliberately forbid reusing this claim.
  if (candidate.obligations[receipt.claimId]) d2Invalid("Existing claim lifecycle requires its owning domain adapter");
  if (d2ConsumptionKeys(receipt).some(id => candidate.identities.externalIdempotencyKeys.includes(id)))
    d2Invalid("Receipt operation/source/authorization/claim/transaction already consumed");
  if (!priorPosted) applyAccountingTransactionAtomically(candidate, receipt.originalTransaction);
  if (candidate.identities.recognitionIds.includes(receipt.recognitionId)) {
    if (!priorPosted) d2Invalid("Recognition identity already used");
  } else registerAuthoritativeIdentity(candidate.identities, "recognitionIds", receipt.recognitionId);
  applyAccountingTransactionAtomically(candidate, receipt.paymentTransaction);
  registerAuthoritativeIdentity(candidate.identities, "settlementIds", receipt.settlementId);
  for (const id of d2ConsumptionKeys(receipt)) registerAuthoritativeIdentity(candidate.identities, "externalIdempotencyKeys", id);
  const record = candidate.d2SettlementReceipts ?? indexedRecord(new PersistentStringIndex<D2SettlementReceipt>(), false, d2ReceiptWrite, freezePayment).record;
  record[receipt.id] = receipt;
  candidate.d2SettlementReceipts = record;
  validateAuthoritativeState(candidate);
  const late = qualifyD2Receipt(receipt, context);
  if (late.status === "incomplete") return late;
  commitCandidate(state, candidate);
  return { status: "committed", receipt, ...d2RemainingReimbursement(receipt) };
};

const paymentConsumptionKeys = (input: SsaMedicarePaymentInput): readonly IdempotencyKey[] => [
  idempotencyKey("ssa-medicare:payment", input.payable.paymentId),
  idempotencyKey("ssa-medicare:source-binding", paymentValue({ payable: input.payable, right: input.right,
    requests: input.requests, bankAccountId: input.bankAccountId, bankCashBefore: input.bankCashBefore,
    rightSettlementId: input.rightSettlementId, sourceInputs: input.sourceInputs })),
  ...input.requests.flatMap(r => [
    idempotencyKey("ssa-medicare:receipt", r.terms.receiptId),
    idempotencyKey("ssa-medicare:authorization", r.terms.authorizationId),
    idempotencyKey("ssa-medicare:premium", r.terms.premium.evidenceId),
    idempotencyKey("ssa-medicare:part-month", JSON.stringify([r.terms.premium.householdId,
      r.terms.premium.beneficiaryId, r.terms.premium.part, r.terms.premium.periodStart])),
  ]),
];
const paymentClaims = (input: SsaMedicarePaymentInput): readonly ObligationOrRight[] => [input.right, ...input.requests.map(r => r.claim)];
const paymentRecognitions = (input: SsaMedicarePaymentInput): readonly RecognitionFact[] => paymentClaims(input).map(c =>
  createRecognitionFactWithHistory({ id: c.originatingRecognitionId, category: c.kind === "right" ? "ssa_gross_income" : "medicare_expense",
    amount: c.originalAmount, recognizedAt: input.payable.paymentAt }));

const validateSsaMedicarePayments = (state: AuthoritativeState): void => {
  const consumed = new Set<string>(), transactions = new Set<string>(), claimIds = new Set<string>(), settlementIds = new Set<string>();
  for (const [key, record] of Object.entries(state.ssaMedicarePayments ?? {})) {
    if (!record || record.version !== "ssa-medicare-payment/v1" || key !== record.id || key !== paymentKey(record.payable)
      || record.sourceInputs === undefined || !(record.bankCashBefore instanceof Money)
      || record.bankCashBefore.currency.code !== "USD" || !record.bankCashBefore.amount.fitsScale(2) || record.bankCashBefore.isNegative())
      paymentInvalid("Malformed versioned payment receipt");
    validatePaymentSources(record);
    const batch = prepareSsaMedicareDeductionProposals(record.payable, record.right, record.requests);
    const bank = state.accounts[record.bankAccountId];
    const expected = paymentJournal(record);
    if (!bank || !["checking", "savings"].includes(bank.kind) || bank.ownerId !== record.payable.recipientId
      || bank.cash.currency.code !== "USD" || !record.netBank.equals(batch.conditionalNetPayable)
      || paymentValue(record.transaction) !== paymentValue(expected)
      || !state.identities.postedTransactionIds.includes(expected.id) || transactions.has(expected.id)
      || paymentValue(record.recognitions) !== paymentValue(paymentRecognitions(record)))
      paymentInvalid("Receipt must match owned BANK and the actually posted gross/expense/net journal");
    transactions.add(expected.id);
    const claims = paymentClaims(record), ids = [record.rightSettlementId, ...record.requests.map(r => r.draft.id)];
    for (const [index, original] of claims.entries()) {
      const sid = ids[index]!, claim = state.obligations[original.id];
      if (!sid || settlementIds.has(sid) || claimIds.has(original.id)
        || original.recognizedAt !== record.payable.paymentAt || original.settlementIds.length !== 0
        || !original.outstandingAmount.equals(original.originalAmount)
        || !claim || paymentValue(claim) !== paymentValue({ ...original, outstandingAmount: Money.zero(original.originalAmount.currency), settlementIds: [sid] })
        || !state.identities.recognitionIds.includes(original.originatingRecognitionId) || !state.identities.settlementIds.includes(sid))
        paymentInvalid("Independent same-event claims and complete separate settlement histories required");
      // Nullable indexed claims are invalid; keep the invariant's argument total.
      assertClaimInvariant(claim ?? paymentInvalid("Missing committed claim after settlement-history validation"));
      if (index > 0 && !["part_b", "part_d"].includes(record.requests[index - 1]!.terms.premium.part))
        paymentInvalid("Only positive Part B/D same-event obligations are supported");
      settlementIds.add(sid); claimIds.add(original.id);
    }
    for (const id of paymentConsumptionKeys(record)) {
      if (consumed.has(id) || !state.identities.externalIdempotencyKeys.includes(id)) paymentInvalid("Incomplete or duplicate source consumption inventory");
      consumed.add(id);
    }
  }
};

/** Narrowly privileged same-event SSA/Medicare candidate transition. The domain
 * participant must first requalify immutable A1/C2 inputs. This API accepts no
 * purported committed receipt or generic non-bank settlement authority. Every
 * receipt here is generated only after actual canonical journal application.
 */
export const applySsaMedicarePaymentAtomically = (state: AuthoritativeState, input: SsaMedicarePaymentInput): SsaMedicarePaymentRecord => {
  validatePaymentSources(input);
  const candidate = cloneAuthoritativeState(state);
  const key = paymentKey(input.payable);
  if (candidate.ssaMedicarePayments?.[key]) paymentInvalid("Payment already committed; duplicate execution rejected");
  const transaction = paymentJournal(input);
  const claims = paymentClaims(input), ids = [input.rightSettlementId, ...input.requests.map(r => r.draft.id)];
  const bank = candidate.accounts[input.bankAccountId];
  if (!bank || !bank.cash.equals(input.bankCashBefore)) paymentInvalid("BANK balance does not match source-bound event opening");
  for (const [index, original] of claims.entries()) {
    if (candidate.obligations[original.id] || candidate.identities.recognitionIds.includes(original.originatingRecognitionId))
      paymentInvalid("Previously recognized or partially settled claims are unsupported");
    const sid = ids[index]!;
    registerAuthoritativeIdentity(candidate.identities, "recognitionIds", original.originatingRecognitionId);
    registerAuthoritativeIdentity(candidate.identities, "settlementIds", sid);
    const claim = materializeClaimLifecycle({ ...original, outstandingAmount: Money.zero(original.originalAmount.currency), settlementIds: [sid] });
    assertClaimInvariant(claim);
    candidate.obligations[claim.id] = claim;
  }
  for (const id of paymentConsumptionKeys(input)) registerAuthoritativeIdentity(candidate.identities, "externalIdempotencyKeys", id);
  applyAccountingTransactionAtomically(candidate, transaction);
  const record = freezePayment({ ...input, version: "ssa-medicare-payment/v1" as const, id: key,
    netBank: input.payable.grossPayable.minus(input.requests.reduce((sum, r) => sum.plus(r.terms.amount), Money.zero(input.payable.grossPayable.currency))),
    transaction, recognitions: paymentRecognitions(input) });
  candidate.ssaMedicarePayments = { ...candidate.ssaMedicarePayments, [key]: record };
  reconcileClaimIdentityHistory(candidate);
  validateAuthoritativeState(candidate);
  commitCandidate(state, candidate);
  return record;
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
    } else if (leg.type === "contingent") {
      const position = candidate.positions[leg.entityId];
      if (position === undefined) return stateTargetMissing(transaction, "position", leg.entityId);
      const entry = candidate.contingentPositions?.[leg.entityId] ?? { positionId: leg.entityId, quantity: new Quantity(decimal("0"), position.quantity.unit), carryingValue: Money.zero(leg.amount.currency) };
      candidate.contingentPositions = { ...candidate.contingentPositions, [leg.entityId]: {
        ...entry, carryingValue: entry.carryingValue.plus(signedAmount),
        quantity: leg.quantity === undefined ? entry.quantity : leg.posting === "debit" ? entry.quantity.plus(leg.quantity) : entry.quantity.minus(leg.quantity),
      } };
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
