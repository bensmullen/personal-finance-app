import type { AccountingTransaction } from "../accounting/index.js";
import { DependencyGraph } from "../dependencies/index.js";
import {
  ValidationError,
  failValidation,
  issueCodes,
  validationIssue,
  type ValidationIssue,
} from "../diagnostics/index.js";
import type { GeneratedOccurrenceKey } from "../identity/index.js";
import type { CalculationTraceRef } from "../lineage/index.js";
import { isObservedFact } from "../model/provenance.js";
import {
  evaluatePrimitive,
  initialEventModificationPrimitiveState,
  initialEventTerminationPrimitiveState,
  initialEventTriggerPrimitiveState,
  initialCompoundingPrimitiveState,
  initialMarkToMarketPrimitiveState,
  initialOneTimePrimitiveState,
  primitiveEvaluationContext,
  type ImplementedPrimitiveEvaluationRequest,
  type OneTimePrimitiveState,
  type EventModificationPrimitiveState,
  type EventTerminationPrimitiveState,
  type EventTriggerPrimitiveState,
  type CompoundingPrimitiveState,
  type MarkToMarketPrimitiveState,
  type PrimitiveEvaluationContext,
} from "../primitives/index.js";
import { createSemanticEffect, type SemanticEffect } from "../semantics/effect.js";
import {
  applyAccountingTransactionAtomically,
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  registerAuthoritativeIdentity,
  validateAuthoritativeState,
  type AuthoritativeState,
} from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { inPeriod, type Instant, type Period } from "../time/index.js";
import { Money } from "../values/index.js";
import type { RunContext } from "./run.js";
import { assertObservedFactWithinDataCutoff, assertRunContext } from "./run.js";

type BindPrimitiveRuntime<T> = T extends ImplementedPrimitiveEvaluationRequest
  ? Omit<T, "context" | "priorState"> & {
      readonly context: Omit<PrimitiveEvaluationContext, "period">;
    }
  : never;

export type PeriodPrimitiveRequest = BindPrimitiveRuntime<ImplementedPrimitiveEvaluationRequest>;

export type PrimitiveRuntimeStateEntry =
  | { readonly primitiveId: "P02"; readonly state: OneTimePrimitiveState }
  | { readonly primitiveId: "P23"; readonly state: CompoundingPrimitiveState }
  | { readonly primitiveId: "P26"; readonly state: MarkToMarketPrimitiveState }
  | { readonly primitiveId: "P27"; readonly state: EventTriggerPrimitiveState }
  | { readonly primitiveId: "P29"; readonly state: EventModificationPrimitiveState }
  | { readonly primitiveId: "P30"; readonly state: EventTerminationPrimitiveState };

export type PrimitiveRuntimeStateStore = Readonly<Record<string, PrimitiveRuntimeStateEntry>>;

export const createPrimitiveRuntimeStateStore = (
  entries: PrimitiveRuntimeStateStore = {},
): PrimitiveRuntimeStateStore => Object.freeze(Object.fromEntries(
  Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => {
    const valid = (() => {
      switch (entry.primitiveId) {
        case "P02": return (entry.state.executed === true || entry.state.executed === false)
          && entry.state.executed === (entry.state.occurrenceId !== undefined);
        case "P23": return Number.isSafeInteger(entry.state.evaluations) && entry.state.evaluations >= 0
          && (entry.state.evaluations === 0) === (entry.state.lastClosingValue === undefined)
          && (entry.state.lastClosingValue === undefined || (entry.state.lastClosingValue instanceof Money && !entry.state.lastClosingValue.isNegative()));
        case "P26": return Number.isSafeInteger(entry.state.evaluations) && entry.state.evaluations >= 0
          && (entry.state.evaluations === 0) === (entry.state.lastMarketValue === undefined)
          && (entry.state.lastMarketValue === undefined || (entry.state.lastMarketValue instanceof Money && !entry.state.lastMarketValue.isNegative()));
        case "P27": return (entry.state.activated === true || entry.state.activated === false)
          && entry.state.activated === (entry.state.occurrenceId !== undefined);
        case "P29": return (entry.state.applied === true || entry.state.applied === false)
          && (entry.state.reverted === true || entry.state.reverted === false)
          && (!entry.state.reverted || entry.state.applied)
          && entry.state.applied === (entry.state.applicationOccurrenceId !== undefined)
          && entry.state.reverted === (entry.state.reversionOccurrenceId !== undefined);
        case "P30": return (entry.state.terminated === true || entry.state.terminated === false)
          && entry.state.terminated === (entry.state.occurrenceId !== undefined);
      }
    })();
    if (!valid) {
      failValidation({
        severity: "error",
        code: issueCodes.primitiveRuntimeStateInvalid,
        message: `Invalid committed primitive runtime state for ${key}`,
        entityType: "primitive_runtime_state",
        entityId: key,
      });
    }
    return [key, Object.freeze({ primitiveId: entry.primitiveId, state: Object.freeze({ ...entry.state }) }) as PrimitiveRuntimeStateEntry];
  }),
));

export const assertPrimitiveRuntimeStateConsistent = (
  store: PrimitiveRuntimeStateStore,
  financialState: AuthoritativeState,
): void => {
  for (const [key, entry] of Object.entries(store)) {
    if (entry.primitiveId === "P23" || entry.primitiveId === "P26") continue;
    const occurrenceIds = entry.primitiveId === "P29"
      ? [entry.state.applicationOccurrenceId, entry.state.reversionOccurrenceId].filter((value): value is GeneratedOccurrenceKey => value !== undefined)
      : [entry.state.occurrenceId].filter((value): value is GeneratedOccurrenceKey => value !== undefined);
    if (occurrenceIds.some((occurrenceId) => !financialState.identities.generatedOccurrenceKeys.includes(occurrenceId))) {
      failValidation({
        severity: "error",
        code: issueCodes.primitiveRuntimeStateInvalid,
        message: `Committed primitive ${key} is missing its authoritative generated occurrence identity`,
        entityType: "primitive_runtime_state",
        entityId: key,
        fieldPath: "state",
      });
    }
  }
};

interface PeriodWorkBase {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly lag?: number;
}

export interface SemanticPeriodWork extends PeriodWorkBase {
  readonly kind: "semantic";
  readonly at: Instant;
  readonly effect: SemanticEffect;
  readonly transaction: AccountingTransaction;
}

export interface PrimitivePeriodWork extends PeriodWorkBase {
  readonly kind: "primitive";
  readonly request: PeriodPrimitiveRequest;
}

export interface DiagnosticPeriodWork extends PeriodWorkBase {
  readonly kind: "diagnostic";
  readonly diagnostics: readonly ValidationIssue[];
}

export type PeriodWork = SemanticPeriodWork | PrimitivePeriodWork | DiagnosticPeriodWork;

export interface PrimitivePeriodOutput {
  readonly workId: string;
  readonly primitiveInstanceId: string;
  readonly primitiveId: PeriodPrimitiveRequest["primitiveId"];
  readonly output: unknown;
  readonly effects: readonly unknown[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface CommittedPeriodResult {
  readonly period: Period;
  readonly openingState: AuthoritativeState;
  readonly closingState: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly effects: readonly SemanticEffect[];
  readonly transactions: readonly AccountingTransaction[];
  readonly statements: Statements;
  readonly diagnostics: readonly ValidationIssue[];
  readonly primitiveOutputs: readonly PrimitivePeriodOutput[];
}

export interface RunPeriodInput {
  readonly period: Period;
  readonly runContext: RunContext;
  readonly openingState: AuthoritativeState;
  readonly primitiveState?: PrimitiveRuntimeStateStore;
  readonly work: readonly PeriodWork[];
}

const invalidWork = (message: string, entityId?: string): never => failValidation({
  severity: "error",
  code: issueCodes.timelineWorkInvalid,
  message,
  entityType: "period_work",
  ...(entityId === undefined ? {} : { entityId }),
});

const barrierRank = (work: PeriodWork): number => {
  switch (work.kind) {
    case "primitive": return 0;
    case "semantic": return 1;
    case "diagnostic": return 2;
  }
};

const orderWork = (work: readonly PeriodWork[]): readonly PeriodWork[] => {
  const graph = new DependencyGraph();
  const byId = new Map<string, PeriodWork>();
  for (const item of work) {
    if (item.id.length === 0) invalidWork("Period work requires a stable non-empty id");
    if (item.lag !== undefined && (!Number.isSafeInteger(item.lag) || item.lag < 0)) {
      invalidWork(`Period work ${item.id} lag must be a non-negative safe integer`, item.id);
    }
    if (byId.has(item.id)) invalidWork(`Duplicate period work id ${item.id}`, item.id);
    byId.set(item.id, item);
    graph.addNode(item.id);
  }
  for (const item of work) {
    for (const dependency of item.dependsOn ?? []) {
      if (!byId.has(dependency)) invalidWork(`Unknown dependency ${dependency} for ${item.id}`, item.id);
      if (barrierRank(byId.get(dependency)!) > barrierRank(item)) {
        invalidWork(`Dependency ${dependency} cannot invert the semantic barrier for ${item.id}`, item.id);
      }
      graph.addEdge(dependency, item.id, item.lag ?? 0);
    }
  }
  try {
    graph.topologicalOrder();
    return [0, 1, 2].flatMap((rank) => {
      const barrierWork = [...byId.values()].filter((item) => barrierRank(item) === rank);
      const barrierGraph = new DependencyGraph();
      for (const item of barrierWork) barrierGraph.addNode(item.id);
      for (const item of barrierWork) {
        for (const dependency of item.dependsOn ?? []) {
          const dependencyWork = byId.get(dependency)!;
          if (barrierRank(dependencyWork) === rank) barrierGraph.addEdge(dependency, item.id, item.lag ?? 0);
        }
      }
      return barrierGraph.topologicalOrder().map((id) => byId.get(id)!);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid zero-lag dependency cycle") {
      invalidWork("Period work contains an invalid zero-lag dependency cycle");
    }
    throw error;
  }
};

export const assertPeriodWorkPlan = (
  work: readonly PeriodWork[],
  targetPeriod?: Period,
  runContext?: RunContext,
): void => {
  orderWork(work);
  if (targetPeriod === undefined) return;
  for (const item of work) {
    if (item.kind === "semantic") {
      if (!inPeriod(item.at, targetPeriod)) invalidWork(`Semantic work ${item.id} is outside period`, item.id);
      if (item.transaction.date !== item.at) invalidWork(`Transaction date mismatch for ${item.id}`, item.id);
    }
    if (item.kind === "primitive") {
      if (!inPeriod(item.request.context.evaluationInstant, targetPeriod)) invalidWork(`Primitive work ${item.id} evaluation instant is outside period`, item.id);
      if (runContext !== undefined && item.request.context.scenarioId !== runContext.scenarioId) {
        invalidWork(`Primitive work ${item.id} scenario does not match the run context`, item.id);
      }
    }
  }
};

const registerEffectIdentities = (
  state: AuthoritativeState,
  effect: SemanticEffect,
  runContext: RunContext,
): SemanticEffect => {
  const created = createSemanticEffect(effect);
  if (created.provenance !== undefined) {
    assertObservedFactWithinDataCutoff(created.provenance, runContext);
    if (isObservedFact(created.provenance)) {
      registerAuthoritativeIdentity(state.identities, "externalIdempotencyKeys", created.provenance.idempotencyKey);
    }
  }
  if (created.sourceOccurrenceKey !== undefined) registerAuthoritativeIdentity(state.identities, "generatedOccurrenceKeys", created.sourceOccurrenceKey);
  if (created.recognitionId !== undefined) registerAuthoritativeIdentity(state.identities, "recognitionIds", created.recognitionId);
  if (created.settlementId !== undefined) registerAuthoritativeIdentity(state.identities, "settlementIds", created.settlementId);
  return created;
};

const occurrenceIdOf = (value: unknown): GeneratedOccurrenceKey | undefined => {
  if (typeof value !== "object" || value === null || !("occurrenceId" in value)) return undefined;
  const occurrenceId = value.occurrenceId;
  return typeof occurrenceId === "string" ? occurrenceId as GeneratedOccurrenceKey : undefined;
};

const evaluatePeriodPrimitive = (
  request: PeriodPrimitiveRequest,
  targetPeriod: Period,
  state: PrimitiveRuntimeStateStore,
): {
  readonly result: {
    readonly output: unknown;
    readonly nextState: unknown;
    readonly effects: readonly unknown[];
    readonly diagnostics: readonly ValidationIssue[];
    readonly traceRefs?: readonly CalculationTraceRef[];
  };
  readonly nextStateEntry?: PrimitiveRuntimeStateEntry;
} => {
  const context = primitiveEvaluationContext({ ...request.context, period: targetPeriod });
  switch (request.primitiveId) {
    case "P01": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P02": {
      const key = context.primitiveInstanceId;
      const prior = state[key];
      if (prior !== undefined && prior.primitiveId !== "P02") {
        return failValidation({ severity: "error", code: issueCodes.primitiveRuntimeStateInvalid, message: `Primitive state kind mismatch for ${key}`, entityType: "primitive_runtime_state", entityId: key });
      }
      const result = evaluatePrimitive({ ...request, context, priorState: prior?.state ?? initialOneTimePrimitiveState() });
      return { result, nextStateEntry: { primitiveId: "P02", state: result.nextState } };
    }
    case "P03": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P04": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P05": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P06": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P08": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P13": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P20": return { result: evaluatePrimitive({ ...request, context, priorState: null }) };
    case "P23": {
      const key = context.primitiveInstanceId;
      const prior = state[key];
      if (prior !== undefined && prior.primitiveId !== "P23") return failValidation({ severity: "error", code: issueCodes.primitiveRuntimeStateInvalid, message: `Primitive state kind mismatch for ${key}`, entityType: "primitive_runtime_state", entityId: key });
      const result = evaluatePrimitive({ ...request, context, priorState: prior?.state ?? initialCompoundingPrimitiveState() });
      return { result, nextStateEntry: { primitiveId: "P23", state: result.nextState } };
    }
    case "P26": {
      const key = context.primitiveInstanceId;
      const prior = state[key];
      if (prior !== undefined && prior.primitiveId !== "P26") return failValidation({ severity: "error", code: issueCodes.primitiveRuntimeStateInvalid, message: `Primitive state kind mismatch for ${key}`, entityType: "primitive_runtime_state", entityId: key });
      const result = evaluatePrimitive({ ...request, context, priorState: prior?.state ?? initialMarkToMarketPrimitiveState() });
      return { result, nextStateEntry: { primitiveId: "P26", state: result.nextState } };
    }
    case "P27": {
      const key = context.primitiveInstanceId;
      const prior = state[key];
      if (prior !== undefined && prior.primitiveId !== "P27") return failValidation({ severity: "error", code: issueCodes.primitiveRuntimeStateInvalid, message: `Primitive state kind mismatch for ${key}`, entityType: "primitive_runtime_state", entityId: key });
      const result = evaluatePrimitive({ ...request, context, priorState: prior?.state ?? initialEventTriggerPrimitiveState() });
      return { result, nextStateEntry: { primitiveId: "P27", state: result.nextState } };
    }
    case "P29": {
      const key = context.primitiveInstanceId;
      const prior = state[key];
      if (prior !== undefined && prior.primitiveId !== "P29") return failValidation({ severity: "error", code: issueCodes.primitiveRuntimeStateInvalid, message: `Primitive state kind mismatch for ${key}`, entityType: "primitive_runtime_state", entityId: key });
      const result = evaluatePrimitive({ ...request, context, priorState: prior?.state ?? initialEventModificationPrimitiveState() });
      return { result, nextStateEntry: { primitiveId: "P29", state: result.nextState } };
    }
    case "P30": {
      const key = context.primitiveInstanceId;
      const prior = state[key];
      if (prior !== undefined && prior.primitiveId !== "P30") return failValidation({ severity: "error", code: issueCodes.primitiveRuntimeStateInvalid, message: `Primitive state kind mismatch for ${key}`, entityType: "primitive_runtime_state", entityId: key });
      const result = evaluatePrimitive({ ...request, context, priorState: prior?.state ?? initialEventTerminationPrimitiveState() });
      return { result, nextStateEntry: { primitiveId: "P30", state: result.nextState } };
    }
  }
};

/** Executes one half-open period against private candidate financial and primitive state. */
export const runPeriod = (input: RunPeriodInput): CommittedPeriodResult => {
  assertRunContext(input.runContext);
  if (input.period.start < input.runContext.simulationStart || input.period.end > input.runContext.simulationEnd || input.period.start >= input.period.end) {
    invalidWork("Period must be a non-empty interval within the run horizon");
  }
  assertPeriodWorkPlan(input.work, input.period, input.runContext);
  const openingState = cloneAuthoritativeState(input.openingState);
  const candidateState = cloneAuthoritativeState(input.openingState);
  assertAuthoritativeStateCurrency(candidateState, input.runContext.baseCurrency);
  let candidatePrimitiveState = createPrimitiveRuntimeStateStore(input.primitiveState);
  assertPrimitiveRuntimeStateConsistent(candidatePrimitiveState, candidateState);
  const effects: SemanticEffect[] = [];
  const transactions: AccountingTransaction[] = [];
  const diagnostics: ValidationIssue[] = [];
  const primitiveOutputs: PrimitivePeriodOutput[] = [];

  for (const item of orderWork(input.work)) {
    if (item.kind === "diagnostic") {
      const normalized = item.diagnostics.map(validationIssue);
      diagnostics.push(...normalized);
      const errors = normalized.filter((issue) => issue.severity === "error");
      if (errors.length > 0) throw new ValidationError(errors);
      continue;
    }
    if (item.kind === "primitive") {
      const evaluated = evaluatePeriodPrimitive(item.request, input.period, candidatePrimitiveState);
      const { result } = evaluated;
      diagnostics.push(...result.diagnostics);
      const primitiveErrors = result.diagnostics.filter((issue) => issue.severity === "error");
      if (primitiveErrors.length > 0) throw new ValidationError(primitiveErrors);
      for (const effect of result.effects) {
        const occurrenceId = occurrenceIdOf(effect);
        if (occurrenceId !== undefined) registerAuthoritativeIdentity(candidateState.identities, "generatedOccurrenceKeys", occurrenceId);
      }
      if (evaluated.nextStateEntry !== undefined) {
        candidatePrimitiveState = createPrimitiveRuntimeStateStore({
          ...candidatePrimitiveState,
          [item.request.context.primitiveInstanceId]: evaluated.nextStateEntry,
        });
      }
      primitiveOutputs.push(Object.freeze({
        workId: item.id,
        primitiveInstanceId: item.request.context.primitiveInstanceId,
        primitiveId: item.request.primitiveId,
        output: result.output,
        effects: Object.freeze([...result.effects]),
        ...(result.traceRefs === undefined ? {} : { traceRefs: result.traceRefs }),
      }));
      continue;
    }

    if (!inPeriod(item.at, input.period)) invalidWork(`Semantic work ${item.id} is outside period`, item.id);
    if (item.transaction.date !== item.at) invalidWork(`Transaction date mismatch for ${item.id}`, item.id);
    const effect = registerEffectIdentities(candidateState, item.effect, input.runContext);
    for (const leg of item.transaction.legs) {
      if (!leg.amount.currency.equals(input.runContext.baseCurrency)) {
        failValidation({ severity: "error", code: issueCodes.runBaseCurrencyMismatch, message: `Transaction ${item.transaction.id} leg uses ${leg.amount.currency.code} but run base currency is ${input.runContext.baseCurrency.code}`, entityType: "accounting_transaction", entityId: item.transaction.id, fieldPath: "legs.amount" });
      }
    }
    applyAccountingTransactionAtomically(candidateState, item.transaction);
    effects.push(effect);
    transactions.push(item.transaction);
  }

  validateAuthoritativeState(candidateState);
  return Object.freeze({
    period: Object.freeze({ ...input.period }),
    openingState,
    closingState: candidateState,
    primitiveState: candidatePrimitiveState,
    effects: Object.freeze(effects),
    transactions: Object.freeze(transactions),
    statements: deriveStatements(candidateState, transactions, input.runContext.baseCurrency),
    diagnostics: Object.freeze(diagnostics),
    primitiveOutputs: Object.freeze(primitiveOutputs),
  });
};
