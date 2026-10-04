import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { DomainId } from "../identity/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import type { Instant } from "../time/index.js";
import type { Money } from "../values/index.js";
import type { ClaimId, RecognitionId, SettlementId } from "./identity.js";

export type ClaimKind = "obligation" | "right";
export type ClaimStatus = "outstanding" | "partially_settled" | "settled";

export type SettlementHistoryMeter = (counts: Readonly<Record<string, number>>) => void;
interface HistoryTree<T> { readonly key: string; readonly value: T; readonly left?: HistoryTree<T>; readonly right?: HistoryTree<T>; readonly height: number; readonly size: number; }
const height = <T>(node: HistoryTree<T> | undefined): number => node?.height ?? 0;
const size = <T>(node: HistoryTree<T> | undefined): number => node?.size ?? 0;
const historyNode = <T>(key: string, value: T, left?: HistoryTree<T>, right?: HistoryTree<T>): HistoryTree<T> =>
  ({ key, value, ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }), height: 1 + Math.max(height(left), height(right)), size: 1 + size(left) + size(right) });
const historyInsert = <T>(root: HistoryTree<T> | undefined, key: string, value: T, visited: () => void): HistoryTree<T> => {
  visited();
  if (root === undefined) return historyNode(key, value);
  if (key === root.key) return historyNode(key, value, root.left, root.right);
  let node = key < root.key ? historyNode(root.key, root.value, historyInsert(root.left, key, value, visited), root.right)
    : historyNode(root.key, root.value, root.left, historyInsert(root.right, key, value, visited));
  if (height(node.left) - height(node.right) > 1) {
    let left = node.left!;
    if (height(left.left) < height(left.right)) { const pivot = left.right!; left = historyNode(pivot.key, pivot.value, historyNode(left.key, left.value, left.left, pivot.left), pivot.right); }
    return historyNode(left.key, left.value, left.left, historyNode(node.key, node.value, left.right, node.right));
  }
  if (height(node.right) - height(node.left) > 1) {
    let right = node.right!;
    if (height(right.right) < height(right.left)) { const pivot = right.left!; right = historyNode(pivot.key, pivot.value, pivot.left, historyNode(right.key, right.value, pivot.right, right.right)); }
    node = historyNode(right.key, right.value, historyNode(node.key, node.value, node.left, right.left), right.right);
  }
  return node;
};
const historyLookup = <T>(root: HistoryTree<T> | undefined, key: string): T | undefined => {
  let node = root;
  while (node !== undefined) { if (key === node.key) return node.value; node = key < node.key ? node.left : node.right; }
  return undefined;
};
const historyAt = <T>(root: HistoryTree<T> | undefined, ordinal: number): T | undefined => {
  let node = root, index = ordinal;
  while (node !== undefined) { const left = size(node.left); if (index === left) return node.value;
    if (index < left) node = node.left; else { index -= left + 1; node = node.right; } }
  return undefined;
};
interface HistoryHead { readonly id: SettlementId; readonly prior?: HistoryHead; readonly length: number; }
interface SettlementHistory { readonly sequence?: HistoryTree<SettlementId>; readonly members?: HistoryTree<number>; readonly head?: HistoryHead; readonly meter?: SettlementHistoryMeter; }
const settlementHistories = new WeakMap<readonly SettlementId[], SettlementHistory>();
const meterHistory = (meter: SettlementHistoryMeter | undefined, counts: Readonly<Record<string, number>>): void => {
  try { meter?.(counts); } catch { /* Diagnostics cannot affect financial execution. */ }
};
const historyView = (history: SettlementHistory): readonly SettlementId[] => {
  const ordinal = (key: PropertyKey): number | undefined => typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) ? Number(key) : undefined;
  const values = function* (node: HistoryTree<SettlementId> | undefined): IterableIterator<SettlementId> {
    if (node === undefined) return;
    yield* values(node.left); yield node.value; yield* values(node.right);
  };
  const view = new Proxy([] as SettlementId[], {
    get: (target, key, receiver) => {
      if (key === "length") return size(history.sequence);
      if (key === Symbol.iterator) return () => values(history.sequence);
      if (key === "includes") return (id: SettlementId, from = 0): boolean => {
        const found = historyLookup(history.members, id);
        const start = from < 0 ? Math.max(size(history.sequence) + Math.trunc(from), 0) : Math.trunc(from) || 0;
        return found !== undefined && found >= start;
      };
      const index = ordinal(key);
      return index === undefined ? Reflect.get(target, key, receiver) : historyAt(history.sequence, index);
    },
    has: (target, key) => { const index = ordinal(key); return index === undefined ? Reflect.has(target, key) : index < size(history.sequence); },
    ownKeys: () => [...Array.from({ length: size(history.sequence) }, (_, index) => String(index)), "length"],
    getOwnPropertyDescriptor: (target, key) => {
      const index = ordinal(key);
      return index === undefined ? Reflect.getOwnPropertyDescriptor(target, key) : index < size(history.sequence)
        ? { configurable: true, enumerable: true, writable: false, value: historyAt(history.sequence, index) } : undefined;
    },
    set: () => false, deleteProperty: () => false, defineProperty: () => false,
  });
  settlementHistories.set(view, history);
  return view;
};
const duplicateHistory = (id: string): never => failValidation({ severity: "error", code: issueCodes.duplicateSettlement,
  message: `Claim ${id} contains a duplicate settlement identity`, entityType: "claim", entityId: id, fieldPath: "settlementIds" });

/** Full validation belongs to this cold import, not subsequent appends. */
export const executionSettlementHistory = (ids: readonly SettlementId[], claimId: string, meter?: SettlementHistoryMeter): readonly SettlementId[] => {
  if (settlementHistories.has(ids)) return ids;
  let history: SettlementHistory = { ...(meter === undefined ? {} : { meter }) };
  for (const id of ids) {
    if (historyLookup(history.members, id) !== undefined) duplicateHistory(claimId);
    const length = size(history.sequence);
    history = { ...history, sequence: historyInsert(history.sequence, String(length).padStart(16, "0"), id, () => {}),
      members: historyInsert(history.members, id, length, () => {}), head: { id, length: length + 1, ...(history.head === undefined ? {} : { prior: history.head }) } };
  }
  meterHistory(meter, { settlementHistoryColdValidations: 1, settlementHistoryColdEntriesVisited: ids.length });
  return historyView(history);
};
export const appendSettlementIdentity = (ids: readonly SettlementId[], id: SettlementId, claimId: string): readonly SettlementId[] => {
  const history = settlementHistories.get(ids);
  if (history === undefined) return Object.freeze([...ids, id]);
  if (historyLookup(history.members, id) !== undefined) duplicateHistory(claimId);
  const length = size(history.sequence); let nodes = 0;
  const next = historyView({ ...history, sequence: historyInsert(history.sequence, String(length).padStart(16, "0"), id, () => { nodes += 1; }),
    members: historyInsert(history.members, id, length, () => { nodes += 1; }), head: { id, length: length + 1, ...(history.head === undefined ? {} : { prior: history.head }) } });
  meterHistory(history.meter, { settlementHistoryAppendNodesVisited: nodes, settlementHistoryAppendEntriesCopied: 0, fullClaimHistoryValidationsDuringHotExecution: 0 });
  return next;
};
/** Undefined identifies a cold replacement; a shared prefix is checked without scanning it. */
export const settlementIdentityAppendsSince = (next: readonly SettlementId[], before: readonly SettlementId[]): readonly SettlementId[] | undefined => {
  if (next === before) return [];
  const current = settlementHistories.get(next), previous = settlementHistories.get(before);
  if (current === undefined || previous === undefined || next.length < before.length) return undefined;
  let head = current.head; const appended: SettlementId[] = [];
  while ((head?.length ?? 0) > before.length) { appended.push(head!.id); head = head!.prior; }
  return head !== previous.head ? undefined : appended.reverse();
};

export const normalizeExecutionClaim = (claim: ObligationOrRight, meter?: SettlementHistoryMeter): ObligationOrRight =>
  normalizeClaimLifecycle({ ...claim, settlementIds: executionSettlementHistory(claim.settlementIds, claim.id, meter) });
export const materializeClaimLifecycle = (claim: ObligationOrRight): ObligationOrRight =>
  normalizeClaimLifecycle({ ...claim, settlementIds: Object.freeze([...claim.settlementIds]) });

export interface ClaimBase {
  readonly id: ClaimId;
  readonly kind: ClaimKind;
  readonly category: string;
  readonly originatingRecognitionId: RecognitionId;
  readonly economicOwnerId: DomainId<string>;
  readonly balanceEntityId?: DomainId<string>;
  readonly originalAmount: Money;
  readonly outstandingAmount: Money;
  readonly recognizedAt: Instant;
  readonly dueAt?: Instant;
  readonly settlementIds: readonly SettlementId[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface Obligation extends ClaimBase { readonly kind: "obligation"; }
export interface Right extends ClaimBase { readonly kind: "right"; }
export type ObligationOrRight = Obligation | Right;

export interface ClaimDraft extends Omit<ClaimBase, "outstandingAmount" | "settlementIds" | "traceRefs"> {
  readonly outstandingAmount?: Money;
  readonly settlementIds?: readonly SettlementId[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const assertClaimInvariant = (claim: ObligationOrRight): void => {
  const structural = claim as { readonly id?: string; readonly kind?: unknown };
  if (structural.kind !== "obligation" && structural.kind !== "right") {
    failValidation({ severity: "error", code: issueCodes.claimInvariantInvalid, message: "Claim kind must be obligation or right", entityType: "claim", ...(structural.id === undefined ? {} : { entityId: structural.id }), fieldPath: "kind" });
  }
  if (typeof claim.category !== "string" || claim.category.trim().length === 0) {
    failValidation({ severity: "error", code: issueCodes.claimInvariantInvalid, message: "Claim category cannot be empty", entityType: "claim", entityId: claim.id, fieldPath: "category" });
  }
  if (!claim.originalAmount.isPositive()) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Claim original amount must be positive", entityType: "claim", entityId: claim.id, fieldPath: "originalAmount" });
  }
  if (!claim.originalAmount.currency.equals(claim.outstandingAmount.currency)) {
    failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Claim original and outstanding amounts must use the same currency", entityType: "claim", entityId: claim.id, fieldPath: "outstandingAmount" });
  }
  if (claim.outstandingAmount.isNegative() || claim.outstandingAmount.compare(claim.originalAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Claim outstanding amount must be from zero through the original amount", entityType: "claim", entityId: claim.id, fieldPath: "outstandingAmount" });
  }
  if (!settlementHistories.has(claim.settlementIds) && new Set(claim.settlementIds).size !== claim.settlementIds.length) {
    failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Claim ${claim.id} contains a duplicate settlement identity`, entityType: "claim", entityId: claim.id, fieldPath: "settlementIds" });
  }
};

export const normalizeClaimLifecycle = (claim: ObligationOrRight): ObligationOrRight => {
  assertClaimInvariant(claim);
  const { settlementIds, traceRefs: suppliedTraceRefs, ...rest } = claim;
  const traceRefs = freezeTraceRefs(suppliedTraceRefs);
  return Object.freeze({
    ...rest,
    settlementIds: settlementHistories.has(settlementIds) ? settlementIds : Object.freeze([...settlementIds]),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as ObligationOrRight;
};

export const createClaim = (
  draft: ClaimDraft,
  existingClaims: Iterable<ObligationOrRight> = [],
): ObligationOrRight => {
  const indexed = existingClaims as Iterable<ObligationOrRight> & { readonly hasClaimIdentity?: (id: string, recognitionId: string) => boolean };
  if (indexed.hasClaimIdentity?.(draft.id, draft.originatingRecognitionId)
    ?? [...existingClaims].some((claim) => claim.id === draft.id || claim.originatingRecognitionId === draft.originatingRecognitionId)) {
    failValidation({
      severity: "error",
      code: issueCodes.duplicateRecognition,
      message: `Recognition ${draft.originatingRecognitionId} already created a claim`,
      entityType: "claim",
      entityId: draft.id,
      relatedIds: [draft.originatingRecognitionId],
    });
  }
  const outstandingAmount = draft.outstandingAmount ?? draft.originalAmount;
  const settlementIds = Object.freeze([...(draft.settlementIds ?? [])]);
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return normalizeClaimLifecycle({
    id: draft.id,
    kind: draft.kind,
    category: draft.category,
    originatingRecognitionId: draft.originatingRecognitionId,
    economicOwnerId: draft.economicOwnerId,
    ...(draft.balanceEntityId === undefined ? {} : { balanceEntityId: draft.balanceEntityId }),
    originalAmount: draft.originalAmount,
    outstandingAmount,
    recognizedAt: draft.recognizedAt,
    ...(draft.dueAt === undefined ? {} : { dueAt: draft.dueAt }),
    settlementIds,
    ...(traceRefs === undefined ? {} : { traceRefs }),
  } as ObligationOrRight);
};

export const createObligation = (
  draft: Omit<ClaimDraft, "kind">,
  existingClaims: Iterable<ObligationOrRight> = [],
): Obligation => createClaim({ ...draft, kind: "obligation" }, existingClaims) as Obligation;

export const createRight = (
  draft: Omit<ClaimDraft, "kind">,
  existingClaims: Iterable<ObligationOrRight> = [],
): Right => createClaim({ ...draft, kind: "right" }, existingClaims) as Right;

export const claimStatus = (claim: ObligationOrRight): ClaimStatus => {
  if (claim.outstandingAmount.isZero()) return "settled";
  return claim.outstandingAmount.equals(claim.originalAmount) ? "outstanding" : "partially_settled";
};
