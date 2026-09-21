import type { AccountingTransaction } from "../accounting/index.js";
import type { CompiledHouseholdProjection } from "../application/compiler/householdProjection.js";
import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import type { ConstraintOutcome, LiquidityShortfall } from "../funding/index.js";
import { mergeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { cloneAuthoritativeState, assertAuthoritativeStateCurrency, validateAuthoritativeState, type AuthoritativeState } from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { totalPositionMarketValue } from "../valuation/index.js";
import { Money, sumMoney } from "../values/index.js";
import { createPrimitiveRuntimeStateStore, type PrimitiveRuntimeStateStore } from "./period.js";
import { assertRunContext, createInputFingerprint, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";
import { executeVerticalSlice2PeriodCandidate, type VerticalSlice2PeriodResult, type VerticalSlice2RunInput } from "./verticalSlice2.js";
import { executeVerticalSlice3PeriodCandidate, type VerticalSlice3PeriodResult, type VerticalSlice3RunInput } from "./verticalSlice3.js";
import { executeVerticalSlice4PeriodCandidate, type VerticalSlice4ConstraintOutcome, type VerticalSlice4LiquidityShortfall, type VerticalSlice4PeriodResult, type VerticalSlice4RunInput } from "./verticalSlice4.js";

export interface HouseholdProjectionRunInput {
  readonly runContext: RunContext;
  readonly compiled: CompiledHouseholdProjection;
}

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
  readonly cashFlow: VerticalSlice2PeriodResult;
  readonly investments: VerticalSlice3PeriodResult;
  readonly liability: VerticalSlice4PeriodResult;
}

export interface HouseholdProjectionRunResult {
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

export const runHouseholdProjection = (request: HouseholdProjectionRunInput): HouseholdProjectionRunResult => {
  assertRunContext(request.runContext);
  const { compiled, runContext } = request;
  if (String(runContext.scenarioId) !== compiled.scenarioIdentity) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_SCENARIO_MISMATCH", message: "Compiled household scenario must match the run context.", entityType: "household_projection" });
  const periods = utcMonthlyPeriods(runContext.simulationStart, compiled.executionMonths);
  const requestedHorizon = Object.freeze({ start: runContext.simulationStart, end: runContext.simulationEnd });
  if (periods.length === 0 || periods[periods.length - 1]!.end !== runContext.simulationEnd) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_HORIZON_MISMATCH", message: "Compiled household months must exactly cover the run horizon.", entityType: "household_projection" });
  assertAuthoritativeStateCurrency(compiled.openingState, runContext.baseCurrency);
  const runMetadata = createRunMetadata(runContext, createInputFingerprint({ runContext, openingState: compiled.openingState, primitiveState: compiled.primitiveState, model: { cashFlowInput: compiled.cashFlowInput, investmentInput: compiled.investmentInput, liabilityInput: compiled.liabilityInput, scenarioIdentity: compiled.scenarioIdentity }, executionPlan: { months: compiled.executionMonths, order: ["cash_flow", "investments", "liabilities"] } }));
  let state = cloneAuthoritativeState(compiled.openingState);
  let primitiveState = createPrimitiveRuntimeStateStore(compiled.primitiveState);
  const committed: HouseholdProjectionPeriodResult[] = [];
  const diagnostics: ValidationIssue[] = [];
  for (const period of periods) try {
    let candidateState = cloneAuthoritativeState(state);
    let candidatePrimitiveState = createPrimitiveRuntimeStateStore(primitiveState);
    const cashFlow = executeVerticalSlice2PeriodCandidate({ runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: compiled.cashFlowInput } as VerticalSlice2RunInput, period, candidateState, candidatePrimitiveState);
    candidateState = cashFlow.state; candidatePrimitiveState = cashFlow.primitiveState;
    const investments = executeVerticalSlice3PeriodCandidate({ runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: compiled.investmentInput } as VerticalSlice3RunInput, period, candidateState, candidatePrimitiveState);
    candidateState = investments.state; candidatePrimitiveState = investments.primitiveState;
    const liability = executeVerticalSlice4PeriodCandidate({ runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: compiled.liabilityInput } as VerticalSlice4RunInput, period, candidateState, candidatePrimitiveState);
    candidateState = liability.state; candidatePrimitiveState = liability.primitiveState;
    validateAuthoritativeState(candidateState); assertAuthoritativeStateCurrency(candidateState, runContext.baseCurrency);
    const transactions = Object.freeze([...cashFlow.period.transactions, ...investments.period.transactions, ...liability.period.transactions]);
    const statements = deriveStatements(candidateState, transactions, runContext.baseCurrency);
    const cash = sumMoney(Object.values(candidateState.accounts).map((account) => account.cash), runContext.baseCurrency);
    const investmentValue = totalPositionMarketValue(Object.values(candidateState.positions), runContext.baseCurrency);
    const traceRefs = mergeTraceRefs(cashFlow.period.traceRefs, investments.period.traceRefs, liability.period.traceRefs)!;
    committed.push(Object.freeze({ period: Object.freeze({ ...period }), statements, cash, investmentValue, assets: statements.assets, liabilities: statements.liabilities, netWorth: statements.netWorth, transactions,
      constraintOutcomes: Object.freeze([...cashFlow.period.constraintOutcomes, ...liability.period.constraintOutcomes]),
      liquidityShortfalls: Object.freeze([...cashFlow.period.liquidityShortfalls, ...liability.period.liquidityShortfalls]), traceRefs,
      cashFlow: cashFlow.period, investments: investments.period, liability: liability.period }));
    diagnostics.push(...cashFlow.period.diagnostics, ...liability.period.diagnostics);
    state = candidateState; primitiveState = candidatePrimitiveState;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    diagnostics.push(...error.issues);
    return Object.freeze({ status: "incomplete", runMetadata, requestedHorizon, stoppedAt: period.start, ...(committed.length === 0 ? {} : { reachedThrough: committed[committed.length - 1]!.period.end }), state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics), displayInputs: Object.freeze({ asOf: runContext.asOf, dataCutoff: runContext.dataCutoff, generatedForecastFactKind: "model_generated" as const }) });
  }
  return Object.freeze({ status: "completed", runMetadata, requestedHorizon, reachedThrough: requestedHorizon.end, state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics), displayInputs: Object.freeze({ asOf: runContext.asOf, dataCutoff: runContext.dataCutoff, generatedForecastFactKind: "model_generated" as const }) });
};
