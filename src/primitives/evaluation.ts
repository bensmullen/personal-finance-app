import { failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import {
  generatedOccurrenceKey,
  type DomainId,
  type GeneratedOccurrenceKey,
} from "../identity/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type FactProvenance } from "../model/provenance.js";
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
  type Currency,
  decimal,
  decimalNthRoot,
  type Rate,
  type Ratio,
  type RatePeriod,
  type Unit,
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

const evaluation = <Id extends "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P08" | "P13" | "P20" | "P23" | "P26" | "P27" | "P29" | "P30", Output, State, Effect>(
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

export interface EventTriggerPrimitiveState {
  readonly activated: boolean;
  readonly occurrenceId?: GeneratedOccurrenceKey;
  readonly executed?: never;
}

export interface EventModificationPrimitiveState {
  readonly applied: boolean;
  readonly reverted: boolean;
  readonly applicationOccurrenceId?: GeneratedOccurrenceKey;
  readonly reversionOccurrenceId?: GeneratedOccurrenceKey;
  readonly occurrenceId?: never;
  readonly executed?: never;
}

export interface EventTerminationPrimitiveState {
  readonly terminated: boolean;
  readonly occurrenceId?: GeneratedOccurrenceKey;
  readonly executed?: never;
}

export const initialEventTriggerPrimitiveState = (): EventTriggerPrimitiveState => Object.freeze({ activated: false });
export const initialEventModificationPrimitiveState = (): EventModificationPrimitiveState => Object.freeze({ applied: false, reverted: false });
export const initialEventTerminationPrimitiveState = (): EventTerminationPrimitiveState => Object.freeze({ terminated: false });

export interface CompoundingPrimitiveState {
  readonly evaluations: number;
  readonly lastClosingValue?: Money;
  readonly executed?: never;
  readonly occurrenceId?: never;
}

export interface MarkToMarketPrimitiveState {
  readonly evaluations: number;
  readonly lastMarketValue?: Money;
  readonly executed?: never;
  readonly occurrenceId?: never;
}

export const initialCompoundingPrimitiveState = (): CompoundingPrimitiveState => Object.freeze({ evaluations: 0 });
export const initialMarkToMarketPrimitiveState = (): MarkToMarketPrimitiveState => Object.freeze({ evaluations: 0 });

export type CompoundingReturnBasis =
  | { readonly kind: "periodic"; readonly period: RatePeriod }
  | { readonly kind: "effective_annual"; readonly yearFraction: { readonly numerator: number; readonly denominator: number }; readonly calculationRounding: RoundingPolicy }
  | { readonly kind: "nominal_annual"; readonly compoundingPeriods: number; readonly divisionRounding: RoundingPolicy };

export type CompoundingCashFlowTiming = "beginning_of_period" | "end_of_period";

export interface PrimitiveEventOccurrence {
  readonly occurrenceId: GeneratedOccurrenceKey;
  readonly scheduledAt: Instant;
  readonly eventId: DomainId<"event">;
  readonly targetId: string;
  readonly kind: "activation" | "modification" | "reversion" | "termination";
  /** P29 effects retain the authoritative source that caused the replacement. */
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

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
  | { readonly primitiveId: "P20"; readonly input: { readonly taxableBase: Money; readonly resolvedRule: ResolvedProportionalTaxRule }; readonly priorState: null; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P23"; readonly input: { readonly baseValue: Money; readonly rate: Rate; readonly contribution?: Money; readonly withdrawal?: Money }; readonly parameters: { readonly returnBasis: CompoundingReturnBasis; readonly cashFlowTiming: CompoundingCashFlowTiming; readonly postingRounding: RoundingPolicy }; readonly priorState: CompoundingPrimitiveState; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P26"; readonly input: { readonly quantity: Quantity; readonly price: Money }; readonly parameters: { readonly expectedUnit: Unit; readonly expectedCurrency: Currency }; readonly priorState: MarkToMarketPrimitiveState; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P27"; readonly input: { readonly eventId: DomainId<"event"> }; readonly parameters: { readonly effectiveAt: Instant; readonly targetId: string }; readonly priorState: EventTriggerPrimitiveState; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P29"; readonly input: { readonly base: PrimitiveFlowValue; readonly replacement: PrimitiveFlowValue; readonly eventId: DomainId<"event"> }; readonly parameters: { readonly targetId: string; readonly effectiveAt: Instant; readonly precedence: number; readonly endAt?: Instant; readonly provenance: FactProvenance }; readonly priorState: EventModificationPrimitiveState; readonly context: PrimitiveEvaluationContext }
  | { readonly primitiveId: "P30"; readonly input: { readonly base: PrimitiveFlowValue; readonly eventId: DomainId<"event"> }; readonly parameters: { readonly targetId: string; readonly terminationAt: Instant }; readonly priorState: EventTerminationPrimitiveState; readonly context: PrimitiveEvaluationContext };

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

const sameRatePeriod = (left: RatePeriod, right: RatePeriod): boolean =>
  left.unit === right.unit && left.count.equals(right.count);

/** Converts only the explicitly selected deterministic rate convention into an effective period return. */
export const effectiveCompoundingPeriodReturn = (rate: Rate, basis: CompoundingReturnBasis): DecimalAmount => {
  switch (basis.kind) {
    case "periodic":
      if (rate.convention.basis !== RateBasis.Periodic || !sameRatePeriod(rate.convention.period, basis.period)) {
        return invalid(issueCodes.primitiveParametersInvalid, "P23 periodic return basis must exactly match the Rate period", "P23", "parameters.returnBasis");
      }
      return rate.value;
    case "effective_annual": {
      if (rate.convention.basis !== RateBasis.EffectiveAnnual) {
        return invalid(issueCodes.primitiveParametersInvalid, "P23 effective-annual conversion requires an effective annual Rate", "P23", "input.rate.convention");
      }
      const { numerator, denominator } = basis.yearFraction;
      if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
        return invalid(issueCodes.primitiveParametersInvalid, "P23 year fraction must use a non-negative integer numerator and positive integer denominator", "P23", "parameters.returnBasis.yearFraction");
      }
      if (decimal("1").plus(rate.value).isNegative()) {
        return invalid(issueCodes.primitiveInputInvalid, "P23 effective annual rate must not be less than -100%", "P23", "input.rate");
      }
      const factor = decimalNthRoot(decimal("1").plus(rate.value).pow(numerator), denominator, basis.calculationRounding);
      return factor.minus(decimal("1"));
    }
    case "nominal_annual": {
      if (rate.convention.basis !== RateBasis.NominalAnnual) {
        return invalid(issueCodes.primitiveParametersInvalid, "P23 nominal conversion requires a nominal annual Rate", "P23", "input.rate.convention");
      }
      if (!Number.isSafeInteger(basis.compoundingPeriods) || basis.compoundingPeriods <= 0) {
        return invalid(issueCodes.primitiveParametersInvalid, "P23 nominal period count must be a positive integer", "P23", "parameters.returnBasis.compoundingPeriods");
      }
      const periodic = rate.value.dividedBy(decimal(rate.convention.compoundingPeriodsPerYear.toString()), basis.divisionRounding);
      if (decimal("1").plus(periodic).isNegative()) {
        return invalid(issueCodes.primitiveInputInvalid, "P23 nominal periodic factor must not be negative", "P23", "input.rate");
      }
      return decimal("1").plus(periodic).pow(basis.compoundingPeriods).minus(decimal("1"));
    }
  }
};

const assertMoneyCurrency = (value: Money, expected: Money, fieldPath: string): void => {
  if (!value.currency.equals(expected.currency)) invalid(issueCodes.primitiveInputInvalid, "P23 cash flows must use the base-value currency", "P23", fieldPath);
  if (value.isNegative()) invalid(issueCodes.primitiveInputInvalid, "P23 cash flows cannot be negative magnitudes", "P23", fieldPath);
};

const compoundingEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P23" }>) => {
  const { baseValue } = request.input;
  if (baseValue.isNegative()) invalid(issueCodes.primitiveInputInvalid, "P23 base value cannot be negative", "P23", "input.baseValue");
  const contribution = request.input.contribution ?? Money.zero(baseValue.currency);
  const withdrawal = request.input.withdrawal ?? Money.zero(baseValue.currency);
  assertMoneyCurrency(contribution, baseValue, "input.contribution");
  assertMoneyCurrency(withdrawal, baseValue, "input.withdrawal");
  if (!Number.isSafeInteger(request.priorState.evaluations) || request.priorState.evaluations < 0
    || (request.priorState.evaluations === 0) !== (request.priorState.lastClosingValue === undefined)
    || (request.priorState.lastClosingValue !== undefined && (!(request.priorState.lastClosingValue instanceof Money) || request.priorState.lastClosingValue.isNegative()))) {
    invalid(issueCodes.primitiveStateInvalid, "P23 state requires a non-negative evaluation count", "P23", "priorState.evaluations");
  }
  if (request.priorState.evaluations > 0
    && (request.priorState.lastClosingValue === undefined
      || !baseValue.equals(request.priorState.lastClosingValue))) {
    invalid(issueCodes.primitiveStateInvalid, "P23 base value must continue from the prior closing value", "P23", "input.baseValue");
  }
  const effectivePeriodReturn = effectiveCompoundingPeriodReturn(request.input.rate, request.parameters.returnBasis);
  if (decimal("1").plus(effectivePeriodReturn).isNegative()) {
    invalid(issueCodes.primitiveInputInvalid, "P23 effective return must not be less than -100%", "P23", "input.rate");
  }
  const beginningFlow = contribution.minus(withdrawal);
  const returnBase = request.parameters.cashFlowTiming === "beginning_of_period" ? baseValue.plus(beginningFlow) : baseValue;
  if (returnBase.isNegative()) invalid(issueCodes.primitiveInputInvalid, "P23 beginning-of-period withdrawal exceeds available value", "P23", "input.withdrawal");
  const returnAmount = returnBase.times(effectivePeriodReturn).round(request.parameters.postingRounding);
  const closingValue = (request.parameters.cashFlowTiming === "beginning_of_period"
    ? returnBase.plus(returnAmount)
    : baseValue.plus(returnAmount).plus(beginningFlow)).round(request.parameters.postingRounding);
  if (closingValue.isNegative()) invalid(issueCodes.primitiveInputInvalid, "P23 withdrawal creates a negative closing value", "P23", "input.withdrawal");
  const nextState: CompoundingPrimitiveState = Object.freeze({ evaluations: request.priorState.evaluations + 1, lastClosingValue: closingValue });
  return evaluation("P23", Object.freeze({ baseValue, contribution, withdrawal, cashFlowTiming: request.parameters.cashFlowTiming, effectivePeriodReturn, returnAmount, closingValue }), nextState, frozenEmpty, request.context.traceRefs);
};

const markToMarketEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P26" }>) => {
  if (!request.input.quantity.unit.equals(request.parameters.expectedUnit)) invalid(issueCodes.primitiveInputInvalid, "P26 quantity unit does not match the declared unit", "P26", "input.quantity.unit");
  if (!request.input.price.currency.equals(request.parameters.expectedCurrency)) invalid(issueCodes.primitiveInputInvalid, "P26 price currency does not match the declared currency", "P26", "input.price.currency");
  if (request.input.quantity.isNegative() || request.input.price.isNegative()) invalid(issueCodes.primitiveInputInvalid, "P26 quantity and price cannot be negative", "P26", "input");
  // P26 state is valuation history only. Position continuity belongs to
  // AuthoritativeState, so a quantity change between valuations is valid.
  if (!Number.isSafeInteger(request.priorState.evaluations) || request.priorState.evaluations < 0
    || (request.priorState.evaluations === 0) !== (request.priorState.lastMarketValue === undefined)
    || (request.priorState.lastMarketValue !== undefined && (!(request.priorState.lastMarketValue instanceof Money) || request.priorState.lastMarketValue.isNegative() || !request.priorState.lastMarketValue.currency.equals(request.parameters.expectedCurrency)))) invalid(issueCodes.primitiveStateInvalid, "P26 state requires a consistent valuation history in the expected currency", "P26", "priorState");
  const marketValue = request.input.price.times(request.input.quantity.amount);
  const nextState: MarkToMarketPrimitiveState = Object.freeze({ evaluations: request.priorState.evaluations + 1, lastMarketValue: marketValue });
  return evaluation("P26", Object.freeze({ quantity: request.input.quantity, price: request.input.price, marketValue }), nextState, frozenEmpty, request.context.traceRefs);
};

const eventOccurrence = (
  request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P27" | "P29" | "P30" }>,
  scheduledAt: Instant,
  kind: PrimitiveEventOccurrence["kind"],
): PrimitiveEventOccurrence => Object.freeze({
  occurrenceId: generatedOccurrenceKey({
    scenarioId: request.context.scenarioId,
    primitiveInstanceId: request.context.primitiveInstanceId,
    scheduledAt,
    semanticEffectType: `${request.context.semanticEffectType}:${kind}`,
    economicTargetId: request.context.economicTargetId,
  }),
  scheduledAt,
  eventId: request.input.eventId,
  targetId: request.parameters.targetId,
  kind,
  ...(request.primitiveId === "P29" ? { provenance: createFactProvenance(request.parameters.provenance) } : {}),
  ...(request.context.traceRefs === undefined ? {} : { traceRefs: freezeTraceRefs(request.context.traceRefs)! }),
});

const assertEventTarget = (
  request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P27" | "P29" | "P30" }>,
): void => {
  if (request.parameters.targetId.trim().length === 0) invalid(issueCodes.primitiveParametersInvalid, `${request.primitiveId} requires a target identity`, request.primitiveId, "parameters.targetId");
  if (request.parameters.targetId !== request.context.economicTargetId) invalid(issueCodes.primitiveParametersInvalid, `${request.primitiveId} target must match the evaluation context`, request.primitiveId, "parameters.targetId");
};

const eventTriggerEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P27" }>) => {
  assertEventTarget(request);
  const prior = request.priorState;
  if ((prior.activated !== true && prior.activated !== false)
    || (prior.activated && prior.occurrenceId === undefined)
    || (!prior.activated && prior.occurrenceId !== undefined)) {
    invalid(issueCodes.primitiveStateInvalid, "P27 state is inconsistent", "P27", "priorState");
  }
  const activatesNow = !prior.activated
    && request.context.evaluationInstant >= request.parameters.effectiveAt
    && inPeriod(request.parameters.effectiveAt, request.context.period);
  const activation = activatesNow ? eventOccurrence(request, request.parameters.effectiveAt, "activation") : undefined;
  const nextState: EventTriggerPrimitiveState = activation === undefined
    ? Object.freeze({ ...prior })
    : Object.freeze({ activated: true, occurrenceId: activation.occurrenceId });
  return evaluation("P27", Object.freeze({
    eventId: request.input.eventId,
    targetId: request.parameters.targetId,
    effectiveAt: request.parameters.effectiveAt,
    active: nextState.activated,
    activatedNow: activation !== undefined,
    ...(activation === undefined ? {} : { occurrenceId: activation.occurrenceId }),
  }), nextState, activation === undefined ? frozenEmpty : [activation], request.context.traceRefs);
};

const eventModificationEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P29" }>) => {
  assertEventTarget(request);
  assertPrimitiveFlowValuesCompatible(request.input.base, request.input.replacement);
  const { priorState: prior, parameters } = request;
  const provenance = createFactProvenance(parameters.provenance);
  if (!Number.isSafeInteger(parameters.precedence)) invalid(issueCodes.primitiveParametersInvalid, "P29 precedence must be a safe integer", "P29", "parameters.precedence");
  if (parameters.endAt !== undefined && parameters.endAt <= parameters.effectiveAt) invalid(issueCodes.primitiveTemporalConfigurationInvalid, "P29 end must follow its effective instant", "P29", "parameters.endAt");
  if ((prior.applied !== true && prior.applied !== false) || (prior.reverted !== true && prior.reverted !== false)
    || (prior.reverted && !prior.applied)
    || (prior.applied !== (prior.applicationOccurrenceId !== undefined))
    || (prior.reverted !== (prior.reversionOccurrenceId !== undefined))) {
    invalid(issueCodes.primitiveStateInvalid, "P29 state is inconsistent", "P29", "priorState");
  }
  const effects: PrimitiveEventOccurrence[] = [];
  let applied = prior.applied;
  let reverted = prior.reverted;
  let applicationOccurrenceId = prior.applicationOccurrenceId;
  let reversionOccurrenceId = prior.reversionOccurrenceId;
  if (!applied && request.context.evaluationInstant >= parameters.effectiveAt && inPeriod(parameters.effectiveAt, request.context.period)) {
    const effect = eventOccurrence(request, parameters.effectiveAt, "modification");
    effects.push(effect);
    applied = true;
    applicationOccurrenceId = effect.occurrenceId;
  }
  if (parameters.endAt !== undefined && applied && !reverted
    && request.context.evaluationInstant >= parameters.endAt && inPeriod(parameters.endAt, request.context.period)) {
    const effect = eventOccurrence(request, parameters.endAt, "reversion");
    effects.push(effect);
    reverted = true;
    reversionOccurrenceId = effect.occurrenceId;
  }
  const modified = request.context.evaluationInstant >= parameters.effectiveAt
    && (parameters.endAt === undefined || request.context.evaluationInstant < parameters.endAt);
  const nextState: EventModificationPrimitiveState = Object.freeze({
    applied,
    reverted,
    ...(applicationOccurrenceId === undefined ? {} : { applicationOccurrenceId }),
    ...(reversionOccurrenceId === undefined ? {} : { reversionOccurrenceId }),
  });
  return evaluation("P29", Object.freeze({
    value: modified ? request.input.replacement : request.input.base,
    modified,
    targetId: parameters.targetId,
    precedence: parameters.precedence,
    effectiveAt: parameters.effectiveAt,
    provenance,
    ...(parameters.endAt === undefined ? {} : { endAt: parameters.endAt }),
  }), nextState, effects, request.context.traceRefs);
};

const zeroFlowValue = <T extends PrimitiveFlowValue>(value: T): T => {
  if (value instanceof Money) return Money.zero(value.currency) as T;
  if (value instanceof Quantity) return new Quantity(DecimalAmount.zero(), value.unit) as T;
  if (value instanceof DecimalAmount) return DecimalAmount.zero() as T;
  return invalid(issueCodes.primitiveInputInvalid, "P30 cannot construct a compatible zero", "P30", "input.base");
};

const eventTerminationEvaluation = (request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P30" }>) => {
  assertEventTarget(request);
  const prior = request.priorState;
  if ((prior.terminated !== true && prior.terminated !== false)
    || (prior.terminated && prior.occurrenceId === undefined)
    || (!prior.terminated && prior.occurrenceId !== undefined)) {
    invalid(issueCodes.primitiveStateInvalid, "P30 state is inconsistent", "P30", "priorState");
  }
  const terminatesNow = !prior.terminated
    && request.context.evaluationInstant >= request.parameters.terminationAt
    && inPeriod(request.parameters.terminationAt, request.context.period);
  const termination = terminatesNow ? eventOccurrence(request, request.parameters.terminationAt, "termination") : undefined;
  const nextState: EventTerminationPrimitiveState = termination === undefined
    ? Object.freeze({ ...prior })
    : Object.freeze({ terminated: true, occurrenceId: termination.occurrenceId });
  const inactive = nextState.terminated || request.context.evaluationInstant >= request.parameters.terminationAt;
  return evaluation("P30", Object.freeze({
    active: !inactive,
    value: inactive ? zeroFlowValue(request.input.base) : request.input.base,
    targetId: request.parameters.targetId,
    terminationAt: request.parameters.terminationAt,
    terminatedNow: termination !== undefined,
  }), nextState, termination === undefined ? frozenEmpty : [termination], request.context.traceRefs);
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
export function evaluatePrimitive(request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P23" }>): ReturnType<typeof compoundingEvaluation>;
export function evaluatePrimitive(request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P26" }>): ReturnType<typeof markToMarketEvaluation>;
export function evaluatePrimitive(request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P27" }>): ReturnType<typeof eventTriggerEvaluation>;
export function evaluatePrimitive(request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P29" }>): ReturnType<typeof eventModificationEvaluation>;
export function evaluatePrimitive(request: Extract<ImplementedPrimitiveEvaluationRequest, { primitiveId: "P30" }>): ReturnType<typeof eventTerminationEvaluation>;
export function evaluatePrimitive(request: { readonly primitiveId: RegisteredOnlyPrimitiveId }): never;
export function evaluatePrimitive(request: PrimitiveEvaluationRequest): PrimitiveEvaluation<
  "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P08" | "P13" | "P20" | "P23" | "P26" | "P27" | "P29" | "P30",
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
    case "P23": return compoundingEvaluation(request);
    case "P26": return markToMarketEvaluation(request);
    case "P27": return eventTriggerEvaluation(request);
    case "P29": return eventModificationEvaluation(request);
    case "P30": return eventTerminationEvaluation(request);
    default: return invalid(
      issueCodes.primitiveNotImplemented,
      `Primitive ${request.primitiveId} is registered but not implemented`,
      request.primitiveId,
    );
  }
}
