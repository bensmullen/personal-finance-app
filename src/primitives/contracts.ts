import type { ValidationIssue } from "../diagnostics/index.js";
import type { DomainId, GeneratedOccurrenceKey, UUID } from "../identity/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import type { Instant, Period } from "../time/index.js";
import type { DecimalAmount, Money, Quantity, Rate, Ratio } from "../values/index.js";
import type { ImplementedPrimitiveId } from "./catalog.js";

export type PrimitiveValue = DecimalAmount | Money | Quantity | Rate | Ratio;
export type PrimitiveFlowValue = DecimalAmount | Money | Quantity;

export interface PrimitiveEvaluationContext {
  readonly period: Period;
  readonly evaluationInstant: Instant;
  readonly scenarioId: DomainId<"scenario">;
  readonly primitiveInstanceId: DomainId<"primitive-instance">;
  readonly economicTargetId: UUID;
  readonly semanticEffectType: string;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const primitiveEvaluationContext = (
  context: PrimitiveEvaluationContext,
): PrimitiveEvaluationContext => Object.freeze({
  ...context,
  period: Object.freeze({ ...context.period }),
  ...(context.traceRefs === undefined ? {} : { traceRefs: freezeTraceRefs(context.traceRefs)! }),
});

export interface PrimitiveOccurrence<T extends PrimitiveFlowValue> {
  readonly occurrenceId: GeneratedOccurrenceKey;
  readonly scheduledAt: Instant;
  readonly value: T;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface PrimitivePeriodFlow<T extends PrimitiveFlowValue> {
  readonly occurrences: readonly PrimitiveOccurrence<T>[];
  readonly aggregate?: T;
}

export interface PrimitiveEvaluation<
  Id extends ImplementedPrimitiveId,
  Output,
  State,
  Effect = never,
> {
  readonly primitiveId: Id;
  readonly output: Output;
  readonly nextState: State;
  readonly effects: readonly Effect[];
  readonly diagnostics: readonly ValidationIssue[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}
