import { failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import {
  generatedOccurrenceKey,
  type DomainId,
  type GeneratedOccurrenceKey,
} from "../identity/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { calculateProportionalTax } from "../rules/index.js";
import {
  inPeriod,
  utcMonthlyOccurrences,
  type CivilDate,
  type Instant,
  type InvalidUtcMonthlyDayPolicy,
} from "../time/index.js";
import {
  DecimalAmount,
  Money,
  Quantity,
  RateBasis,
  RoundingPolicy,
  decimal,
  decimalNthRoot,
  type Rate,
  type Ratio,
} from "../values/index.js";
import {
  requireImplementedPrimitive,
  type RegisteredOnlyPrimitiveId,
} from "./catalog.js";
import type {
  PrimitiveEvaluation,
  PrimitiveEvaluationContext,
  PrimitiveFlowValue,
  PrimitiveOccurrence,
  PrimitivePeriodFlow,
  PrimitiveValue,
} from "./contracts.js";

const frozenEmpty = Object.freeze([]) as readonly never[];
const diagnostics = Object.freeze([]) as readonly ValidationIssue[];

const invalid = (
  code: string,
  message: string,
  primitiveId: string,
  fieldPath?: string,
): never => failValidation({
  severity: "error",
  code,
  message,
  entityType: "primitive",
  entityId: primitiveId,
  ...(fieldPath === undefined ? {} : { fieldPath }),
});

const evaluation = <Id extends "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P08" | "P13" | "P20", Output, State, Effect>(
  primitiveId: Id,
  output: Output,
  nextState: State,
  effects: readonly Effect[],
  traceRefs: readonly CalculationTraceRef[] | undefined,
): PrimitiveEvaluation<Id, Output, State, Effect> => Object.freeze({
  primitiveId,
  output,
  nextState,
  effects: Object.freeze([...effects]),
  diagnostics,
  ...(traceRefs === undefined ? {} : { traceRefs: freezeTraceRefs(traceRefs)! }),
});

const incompatible = (message: string): never => invalid(
  issueCodes.primitiveCompositionIncompatible,
  message,
  "composition",
);

export const assertPrimitiveFlowValuesCompatible = (
  left: PrimitiveFlowValue,
  right: PrimitiveFlowValue,
): void => {
  if (left instanceof Money && right instanceof Money) {
    if (!left.currency.equals(right.currency)) incompatible(`Currency mismatch: ${left.currency.code} and ${right.currency.code}`);
    return;
  }
  if (left instanceof Quantity && right instanceof Quantity) {
    if (!left.unit.equals(right.unit)) incompatible(`Unit mismatch: ${left.unit.code} and ${right.unit.code}`);
    return;
  }
  if (left instanceof DecimalAmount && right instanceof DecimalAmount) return;
  incompatible("Primitive flow value types are incompatible");
};

export const sumPrimitiveFlowValues = <T extends PrimitiveFlowValue>(values: readonly T[]): T | undefined => {
  if (values.length === 0) return undefined;
  const first = values[0]!;
  let result: PrimitiveFlowValue = first;
  for (const value of values.slice(1)) {
    assertPrimitiveFlowValuesCompatible(result, value);
    if (result instanceof Money && value instanceof Money) result = result.plus(value);
    else if (result instanceof Quantity && value instanceof Quantity) result = result.plus(value);
    else if (result instanceof DecimalAmount && value instanceof DecimalAmount) result = result.plus(value);
  }
  return result as T;
};

const scalePrimitiveValue = <T extends PrimitiveFlowValue>(value: T, factor: DecimalAmount): T => {
  if (value instanceof Money) return value.times(factor) as T;
  if (value instanceof Quantity) return new Quantity(value.amount.times(factor), value.unit) as T;
  if (value instanceof DecimalAmount) return value.times(factor) as T;
  return invalid(issueCodes.primitiveInputInvalid, "Unsupported value type for scaling", "composition", "value");
};

const occurrence = <T extends PrimitiveFlowValue>(
  scheduledAt: Instant,
  value: T,
  context: PrimitiveEvaluationContext,
): PrimitiveOccurrence<T> => Object.freeze({
  occurrenceId: generatedOccurrenceKey({
    scenarioId: context.scenarioId,
    primitiveInstanceId: context.primitiveInstanceId,
    scheduledAt,
    semanticEffectType: context.semanticEffectType,
    economicTargetId: context.economicTargetId,
  }),
  scheduledAt,
  value,
  ...(context.traceRefs === undefined ? {} : { traceRefs: freezeTraceRefs(context.traceRefs)! }),
});

const periodFlow = <T extends PrimitiveFlowValue>(
  occurrences: readonly PrimitiveOccurrence<T>[],
): PrimitivePeriodFlow<T> => {
  const frozenOccurrences = Object.freeze([...occurrences]);
  const aggregate = sumPrimitiveFlowValues(frozenOccurrences.map((item) => item.value));
  return Object.freeze({
    occurrences: frozenOccurrences,
    ...(aggregate === undefined ? {} : { aggregate }),
  });
};

export interface OneTimePrimitiveState {
  readonly executed: boolean;
  readonly occurrenceId?: GeneratedOccurrenceKey;
}

export const initialOneTimePrimitiveState = (): OneTimePrimitiveState => Object.freeze({ executed: false });

export type RecurrenceSchedule =
  | { readonly kind: "explicit_instants"; readonly instants: readonly Instant[] }
  | {
      readonly kind: "utc_monthly";
      readonly anchor: Instant;
      readonly invalidDayPolicy: InvalidUtcMonthlyDayPolicy;
    };

export type GrowthCategory = "stock" | "recurring_occurrence_amount" | "series_quantity";

export type GrowthTimeBasis =
  | { readonly kind: "per_period"; readonly periods: number }
  | {
      readonly kind: "effective_annual";
      readonly yearFraction: { readonly numerator: number; readonly denominator: number };
      readonly calculationRounding: RoundingPolicy;
    };

export interface ResolvedProportionalTaxRule {
  readonly id: DomainId<"tax-rule">;
  readonly effectiveRate: Ratio;
  readonly postingRounding: RoundingPolicy;
}

export type ImplementedPrimitiveEvaluationRequest =
  | { readonly primitiveId: "P01"; readonly input: { readonly value: PrimitiveValue }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P02"; readonly input: { readonly value: PrimitiveFlowValue }; readonly parameters: { readonly occurrenceAt: Instant }; readonly priorState: OneTimePrimitiveState; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P03"; readonly input: { readonly amount: PrimitiveFlowValue }; readonly parameters: { readonly schedule: RecurrenceSchedule }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P04"; readonly input: { readonly value: PrimitiveValue }; readonly parameters: { readonly start: Instant; readonly end: Instant }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P05"; readonly input: { readonly value: PrimitiveValue }; readonly parameters: { readonly start: Instant }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P06"; readonly input: { readonly value: PrimitiveValue }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P08"; readonly input: { readonly initial: PrimitiveFlowValue; readonly rate: Rate }; readonly parameters: { readonly category: GrowthCategory; readonly timeBasis: GrowthTimeBasis }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P13"; readonly input: { readonly baseValue: PrimitiveFlowValue; readonly baseIndex: DecimalAmount; readonly currentIndex: DecimalAmount }; readonly parameters: { readonly baseDate: CivilDate; readonly indexIdentity: string; readonly divisionRounding: RoundingPolicy }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P20"; readonly input: { readonly taxableBase: Money; readonly resolvedRule: ResolvedProportionalTaxRule }; readonly priorState: null; readonly context: PrimitiveEvaluationContext };

export type PrimitiveEvaluationRequest =
  | ImplementedPrimitiveEvaluationRequest
  | { readonly primitiveId: RegisteredOnlyPrimitiveId };

const staticEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P01" }>) =>
  evaluation("P01", request.input.value, null, frozenEmpty, request.context.traceRefs);

const oneTimeEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P02" }>) => {
  const { priorState } = request;
  if (priorState.executed !== true && priorState.executed !== false) {
    invalid(issueCodes.primitiveStateInvalid, "P02 state requires an executed flag", "P02", "priorState.executed");
  }
  if (priorState.executed && priorState.occurrenceId === undefined) {
    invalid(issueCodes.primitiveStateInvalid, "Committed P02 state requires its occurrence identity", "P02", "priorState.occurrenceId");
  }
  if (priorState.executed || !inPeriod(request.parameters.occurrenceAt, request.context.period)) {
    const nextState = Object.freeze({ ...priorState });
    return evaluation("P02", periodFlow([]), nextState, frozenEmpty, request.context.traceRefs);
  }
  const item = occurrence(request.parameters.occurrenceAt, request.input.value, request.context);
  const nextState: OneTimePrimitiveState = Object.freeze({ executed: true, occurrenceId: item.occurrenceId });
  return evaluation("P02", periodFlow([item]), nextState, [item], request.context.traceRefs);
};

const recurringEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P03" }>) => {
  const scheduled = request.parameters.schedule.kind === "explicit_instants"
    ? request.parameters.schedule.instants.filter((value) => inPeriod(value, request.context.period))
    : utcMonthlyOccurrences(
        request.parameters.schedule.anchor,
        request.context.period,
        request.parameters.schedule.invalidDayPolicy,
      );
  const ordered = [...scheduled].sort();
  if (new Set(ordered).size !== ordered.length) {
    invalid(issueCodes.primitiveTemporalConfigurationInvalid, "P03 schedule contains duplicate occurrence instants", "P03", "parameters.schedule");
  }
  const occurrences = ordered.map((scheduledAt) => occurrence(scheduledAt, request.input.amount, request.context));
  return evaluation("P03", periodFlow(occurrences), null, occurrences, request.context.traceRefs);
};

const finiteDurationEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P04" }>) => {
  if (request.parameters.start >= request.parameters.end) {
    invalid(issueCodes.primitiveTemporalConfigurationInvalid, "P04 requires start before end", "P04", "parameters");
  }
  const active = request.context.evaluationInstant >= request.parameters.start
    && request.context.evaluationInstant < request.parameters.end;
  const output = Object.freeze({ active, ...(active ? { value: request.input.value } : {}) });
  return evaluation("P04", output, null, frozenEmpty, request.context.traceRefs);
};

const perpetualEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P05" }>) => {
  const active = request.context.evaluationInstant >= request.parameters.start;
  const output = Object.freeze({ active, ...(active ? { value: request.input.value } : {}) });
  return evaluation("P05", output, null, frozenEmpty, request.context.traceRefs);
};

const constantEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P06" }>) =>
  evaluation("P06", Object.freeze({ at: request.context.evaluationInstant, value: request.input.value }), null, frozenEmpty, request.context.traceRefs);

const growthFactor = (
  rate: Rate,
  timeBasis: GrowthTimeBasis,
): DecimalAmount => {
  const base = decimal("1").plus(rate.value);
  if (!base.isPositive()) {
    return invalid(issueCodes.primitiveParametersInvalid, "P08 growth requires 1 + rate to be positive", "P08", "input.rate");
  }
  if (timeBasis.kind === "per_period") {
    if (rate.convention.basis !== RateBasis.Periodic) {
      return invalid(issueCodes.primitiveParametersInvalid, "P08 per-period mode requires a periodic Rate", "P08", "input.rate.convention");
    }
    if (!Number.isSafeInteger(timeBasis.periods) || timeBasis.periods < 0) {
      return invalid(issueCodes.primitiveParametersInvalid, "P08 periods must be a non-negative integer", "P08", "parameters.timeBasis.periods");
    }
    return base.pow(timeBasis.periods);
  }
  if (rate.convention.basis !== RateBasis.EffectiveAnnual) {
    return invalid(issueCodes.primitiveParametersInvalid, "P08 effective-annual mode requires an effective annual Rate", "P08", "input.rate.convention");
  }
  const { numerator, denominator } = timeBasis.yearFraction;
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
    return invalid(issueCodes.primitiveParametersInvalid, "P08 year fraction must use non-negative integer numerator and positive integer denominator", "P08", "parameters.timeBasis.yearFraction");
  }
  return decimalNthRoot(base.pow(numerator), denominator, timeBasis.calculationRounding);
};

const geometricGrowthEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P08" }>) => {
  const factor = growthFactor(request.input.rate, request.parameters.timeBasis);
  const value = scalePrimitiveValue(request.input.initial, factor);
  const timeBasis: GrowthTimeBasis = request.parameters.timeBasis.kind === "per_period"
    ? Object.freeze({ ...request.parameters.timeBasis })
    : Object.freeze({
        ...request.parameters.timeBasis,
        yearFraction: Object.freeze({ ...request.parameters.timeBasis.yearFraction }),
      });
  return evaluation(
    "P08",
    Object.freeze({ value, factor, category: request.parameters.category, timeBasis }),
    null,
    frozenEmpty,
    request.context.traceRefs,
  );
};

const inflationLinkedEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P13" }>) => {
  if (request.parameters.indexIdentity.trim().length === 0) {
    invalid(issueCodes.primitiveParametersInvalid, "P13 requires an explicit index identity", "P13", "parameters.indexIdentity");
  }
  if (!request.input.baseIndex.isPositive()) {
    invalid(issueCodes.primitiveInputInvalid, "P13 base index must be positive and nonzero", "P13", "input.baseIndex");
  }
  if (request.input.currentIndex.isNegative()) {
    invalid(issueCodes.primitiveInputInvalid, "P13 current index cannot be negative", "P13", "input.currentIndex");
  }
  const factor = request.input.currentIndex.dividedBy(request.input.baseIndex, request.parameters.divisionRounding);
  const value = scalePrimitiveValue(request.input.baseValue, factor);
  return evaluation("P13", Object.freeze({
    value,
    factor,
    baseDate: request.parameters.baseDate,
    indexIdentity: request.parameters.indexIdentity,
    baseIndex: request.input.baseIndex,
    currentIndex: request.input.currentIndex,
  }), null, frozenEmpty, request.context.traceRefs);
};

const taxDependentEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P20" }>) => {
  const { resolvedRule } = request.input;
  const tax = (() => {
    try {
      return calculateProportionalTax(request.input.taxableBase, resolvedRule.effectiveRate, resolvedRule.postingRounding);
    } catch (error) {
      return invalid(
        issueCodes.primitiveInputInvalid,
        `P20 proportional tax input is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
        "P20",
        "input",
      );
    }
  })();
  return evaluation("P20", Object.freeze({ tax, ruleId: resolvedRule.id }), null, frozenEmpty, request.context.traceRefs);
};

export function evaluatePrimitive<T extends PrimitiveValue>(request: {
  readonly primitiveId: "P01"; readonly input: { readonly value: T }; readonly priorState: null; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P01", T, null>;
export function evaluatePrimitive<T extends PrimitiveFlowValue>(request: {
  readonly primitiveId: "P02"; readonly input: { readonly value: T }; readonly parameters: { readonly occurrenceAt: Instant };
  readonly priorState: OneTimePrimitiveState; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P02", PrimitivePeriodFlow<T>, OneTimePrimitiveState, PrimitiveOccurrence<T>>;
export function evaluatePrimitive<T extends PrimitiveFlowValue>(request: {
  readonly primitiveId: "P03"; readonly input: { readonly amount: T }; readonly parameters: { readonly schedule: RecurrenceSchedule };
  readonly priorState: null; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P03", PrimitivePeriodFlow<T>, null, PrimitiveOccurrence<T>>;
export function evaluatePrimitive<T extends PrimitiveValue>(request: {
  readonly primitiveId: "P04"; readonly input: { readonly value: T }; readonly parameters: { readonly start: Instant; readonly end: Instant };
  readonly priorState: null; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P04", Readonly<{ readonly active: boolean; readonly value?: T }>, null>;
export function evaluatePrimitive<T extends PrimitiveValue>(request: {
  readonly primitiveId: "P05"; readonly input: { readonly value: T }; readonly parameters: { readonly start: Instant };
  readonly priorState: null; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P05", Readonly<{ readonly active: boolean; readonly value?: T }>, null>;
export function evaluatePrimitive<T extends PrimitiveValue>(request: {
  readonly primitiveId: "P06"; readonly input: { readonly value: T }; readonly priorState: null; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P06", Readonly<{ readonly at: Instant; readonly value: T }>, null>;
export function evaluatePrimitive<T extends PrimitiveFlowValue>(request: {
  readonly primitiveId: "P08"; readonly input: { readonly initial: T; readonly rate: Rate };
  readonly parameters: { readonly category: GrowthCategory; readonly timeBasis: GrowthTimeBasis };
  readonly priorState: null; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P08", Readonly<{ readonly value: T; readonly factor: DecimalAmount; readonly category: GrowthCategory; readonly timeBasis: GrowthTimeBasis }>, null>;
export function evaluatePrimitive<T extends PrimitiveFlowValue>(request: {
  readonly primitiveId: "P13"; readonly input: { readonly baseValue: T; readonly baseIndex: DecimalAmount; readonly currentIndex: DecimalAmount };
  readonly parameters: { readonly baseDate: CivilDate; readonly indexIdentity: string; readonly divisionRounding: RoundingPolicy };
  readonly priorState: null; readonly context: PrimitiveEvaluationContext;
}): PrimitiveEvaluation<"P13", Readonly<{
  readonly value: T; readonly factor: DecimalAmount; readonly baseDate: CivilDate; readonly indexIdentity: string;
  readonly baseIndex: DecimalAmount; readonly currentIndex: DecimalAmount;
}>, null>;
export function evaluatePrimitive(request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P20" }>): ReturnType<typeof taxDependentEvaluation>;
export function evaluatePrimitive(request: { readonly primitiveId: RegisteredOnlyPrimitiveId }): never;
export function evaluatePrimitive(request: PrimitiveEvaluationRequest): PrimitiveEvaluation<
  "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P08" | "P13" | "P20",
  unknown,
  unknown,
  unknown
> {
  requireImplementedPrimitive(request.primitiveId);
  switch (request.primitiveId) {
    case "P01": return staticEvaluation(request);
    case "P02": return oneTimeEvaluation(request);
    case "P03": return recurringEvaluation(request);
    case "P04": return finiteDurationEvaluation(request);
    case "P05": return perpetualEvaluation(request);
    case "P06": return constantEvaluation(request);
    case "P08": return geometricGrowthEvaluation(request);
    case "P13": return inflationLinkedEvaluation(request);
    case "P20": return taxDependentEvaluation(request);
    default: return invalid(
      issueCodes.primitiveNotImplemented,
      `Primitive ${request.primitiveId} is registered but not implemented`,
      request.primitiveId,
    );
  }
}
