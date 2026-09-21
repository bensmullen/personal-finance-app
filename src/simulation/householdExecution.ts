import type { AccountingTransaction } from "../accounting/index.js";
import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import type { ConstraintOutcome, LiquidityShortfall } from "../funding/index.js";
import { mergeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { assertAuthoritativeStateCurrency, cloneAuthoritativeState, validateAuthoritativeState, type AuthoritativeState } from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { Money } from "../values/index.js";
import { deriveHouseholdClosingMetrics } from "./householdProjection.js";
import type { HouseholdContentionPolicy } from "./intraperiodScheduler.js";
import { assertPrimitiveRuntimeStateConsistent, createPrimitiveRuntimeStateStore, type PrimitiveRuntimeStateStore } from "./period.js";
import { assertRunContext, createInputFingerprint, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";
import { executeVerticalSlice2PeriodCandidate, type VerticalSlice2Input, type VerticalSlice2PeriodResult, type VerticalSlice2RunInput } from "./verticalSlice2.js";
import { executeVerticalSlice3PeriodCandidate, type VerticalSlice3Input, type VerticalSlice3PeriodResult, type VerticalSlice3RunInput } from "./verticalSlice3.js";
import { executeVerticalSlice4PeriodCandidate, type VerticalSlice4ConstraintOutcome, type VerticalSlice4Input, type VerticalSlice4LiquidityShortfall, type VerticalSlice4PeriodResult, type VerticalSlice4RunInput } from "./verticalSlice4.js";

export interface HouseholdProjectionPeriodResult {
  readonly period: Period;
  readonly statements: Statements;
  readonly cash: Money;
  readonly investmentValue: Money;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly transactions: readonly AccountingTransaction[];
  readonly constraintOutcomes: readonly (ConstraintOutcome | VerticalSlice4ConstraintOutcome)[];
  readonly liquidityShortfalls: readonly (LiquidityShortfall | VerticalSlice4LiquidityShortfall)[];
  readonly traceRefs: readonly CalculationTraceRef[];
  readonly cashFlow?: VerticalSlice2PeriodResult;
  readonly investments?: VerticalSlice3PeriodResult;
  readonly liability?: VerticalSlice4PeriodResult;
}

/** Inward-facing structural execution contract; application compilers satisfy it without an engine-to-application dependency. */
export interface ExecutableHouseholdProjection {
  readonly cashFlowInput?: VerticalSlice2Input;
  readonly investmentInput?: VerticalSlice3Input;
  readonly liabilityInput?: VerticalSlice4Input;
  readonly reconciledOpeningState: AuthoritativeState;
  readonly reconciledPrimitiveState: PrimitiveRuntimeStateStore;
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly contentionPolicy?: HouseholdContentionPolicy;
  readonly scenarioBindings: unknown;
}
export interface CompiledHouseholdProjectionRunInput { readonly runContext: RunContext; readonly compiled: ExecutableHouseholdProjection; }
export interface CompiledHouseholdProjectionRunResult {
  readonly status: "completed" | "incomplete";
  readonly runMetadata: RunMetadata;
  readonly requestedHorizon: Period;
  readonly reachedThrough?: Instant;
  readonly stoppedAt?: Instant;
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly periods: readonly HouseholdProjectionPeriodResult[];
  readonly diagnostics: readonly ValidationIssue[];
  readonly displayInputs: { readonly asOf: Instant; readonly dataCutoff: Instant; readonly generatedForecastFactKind: "model_generated" };
}

const display = (context: RunContext) => Object.freeze({ asOf: context.asOf, dataCutoff: context.dataCutoff, generatedForecastFactKind: "model_generated" as const });

/** The authoritative PR20 execution path: one state/runtime stream and one commit per month. */
export const runCompiledHouseholdProjection = (request: CompiledHouseholdProjectionRunInput): CompiledHouseholdProjectionRunResult => {
  const { runContext, compiled } = request;
  assertRunContext(runContext);
  if (String(runContext.scenarioId) !== compiled.scenarioIdentity) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_SCENARIO_MISMATCH", message: "Compiled scenario identity must equal the run context scenario.", entityType: "household_projection" });
  const periods = utcMonthlyPeriods(runContext.simulationStart, compiled.executionMonths);
  if (periods.length === 0 || periods[periods.length - 1]!.end !== runContext.simulationEnd) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_HORIZON_MISMATCH", message: "Compiled months must exactly cover the requested horizon.", entityType: "household_projection" });
  assertAuthoritativeStateCurrency(compiled.reconciledOpeningState, runContext.baseCurrency);
  let state = cloneAuthoritativeState(compiled.reconciledOpeningState);
  let primitiveState = createPrimitiveRuntimeStateStore(compiled.reconciledPrimitiveState);
  assertPrimitiveRuntimeStateConsistent(primitiveState, state);
  const requestedHorizon = Object.freeze({ start: runContext.simulationStart, end: runContext.simulationEnd });
  const runMetadata = createRunMetadata(runContext, createInputFingerprint({ runContext, openingState: state, primitiveState, model: { cashFlowInput: compiled.cashFlowInput, investmentInput: compiled.investmentInput, liabilityInput: compiled.liabilityInput, scenarioBindings: compiled.scenarioBindings }, executionPlan: { months: compiled.executionMonths, order: ["cash_flow", "investments", "liabilities"], contentionPolicy: compiled.contentionPolicy } }));
  const committed: HouseholdProjectionPeriodResult[] = [];
  const diagnostics: ValidationIssue[] = [];
  for (const period of periods) try {
    let candidateState = cloneAuthoritativeState(state);
    let candidatePrimitiveState = createPrimitiveRuntimeStateStore(primitiveState);
    let cashFlow: VerticalSlice2PeriodResult | undefined;
    let investments: VerticalSlice3PeriodResult | undefined;
    let liability: VerticalSlice4PeriodResult | undefined;
    if (compiled.cashFlowInput !== undefined) {
      const candidate = executeVerticalSlice2PeriodCandidate({ runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: compiled.cashFlowInput } as VerticalSlice2RunInput, period, candidateState, candidatePrimitiveState);
      candidateState = candidate.state; candidatePrimitiveState = candidate.primitiveState; cashFlow = candidate.period;
    }
    if (compiled.investmentInput !== undefined) {
      const candidate = executeVerticalSlice3PeriodCandidate({ runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: compiled.investmentInput } as VerticalSlice3RunInput, period, candidateState, candidatePrimitiveState);
      candidateState = candidate.state; candidatePrimitiveState = candidate.primitiveState; investments = candidate.period;
    }
    if (compiled.liabilityInput !== undefined) {
      const candidate = executeVerticalSlice4PeriodCandidate({ runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: compiled.liabilityInput } as VerticalSlice4RunInput, period, candidateState, candidatePrimitiveState);
      candidateState = candidate.state; candidatePrimitiveState = candidate.primitiveState; liability = candidate.period;
    }
    validateAuthoritativeState(candidateState); assertAuthoritativeStateCurrency(candidateState, runContext.baseCurrency); assertPrimitiveRuntimeStateConsistent(candidatePrimitiveState, candidateState);
    const transactions = Object.freeze([...(cashFlow?.transactions ?? []), ...(investments?.transactions ?? []), ...(liability?.transactions ?? [])]);
    const statements = deriveStatements(candidateState, transactions, runContext.baseCurrency);
    const metrics = deriveHouseholdClosingMetrics(candidateState, runContext.baseCurrency);
    const periodResult: HouseholdProjectionPeriodResult = Object.freeze({ period: Object.freeze({ ...period }), statements, cash: metrics.cash, investmentValue: metrics.investmentValue, assets: metrics.totalAssets, liabilities: metrics.totalLiabilities, netWorth: metrics.netWorth, transactions,
      constraintOutcomes: Object.freeze([...(cashFlow?.constraintOutcomes ?? []), ...(liability?.constraintOutcomes ?? [])]),
      liquidityShortfalls: Object.freeze([...(cashFlow?.liquidityShortfalls ?? []), ...(liability?.liquidityShortfalls ?? [])]),
      traceRefs: mergeTraceRefs(cashFlow?.traceRefs, investments?.traceRefs, liability?.traceRefs) ?? Object.freeze([]),
      ...(cashFlow === undefined ? {} : { cashFlow }), ...(investments === undefined ? {} : { investments }), ...(liability === undefined ? {} : { liability }),
    });
    diagnostics.push(...(cashFlow?.diagnostics ?? []), ...(liability?.diagnostics ?? []));
    state = candidateState; primitiveState = candidatePrimitiveState; committed.push(periodResult);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    diagnostics.push(...error.issues);
    return Object.freeze({ status: "incomplete", runMetadata, requestedHorizon, stoppedAt: period.start, ...(committed.length === 0 ? {} : { reachedThrough: committed[committed.length - 1]!.period.end }), state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics), displayInputs: display(runContext) });
  }
  return Object.freeze({ status: "completed", runMetadata, requestedHorizon, reachedThrough: requestedHorizon.end, state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics), displayInputs: display(runContext) });
};
