import type { AccountingTransaction } from "../accounting/index.js";
import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import type { ConstraintOutcome, LiquidityShortfall } from "../funding/index.js";
import { mergeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { assertAuthoritativeStateCurrency, cloneAuthoritativeState, validateAuthoritativeState, type AuthoritativeState } from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { Money } from "../values/index.js";
import { deriveHouseholdClosingMetrics } from "./householdProjection.js";
import { buildHouseholdScheduledPlan, type HouseholdContentionPolicy, type HouseholdWorkDescriptor } from "./intraperiodScheduler.js";
import { describeVerticalSlice2PeriodWork, describeVerticalSlice3PeriodWork, describeVerticalSlice4PeriodWork } from "./householdWorkPlan.js";
import { assertPrimitiveRuntimeStateConsistent, createPrimitiveRuntimeStateStore, type PrimitiveRuntimeStateStore } from "./period.js";
import { assertRunContext, canonicalSerialize, createInputFingerprint, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";
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
  readonly standaloneAssets?: readonly { readonly value: Money }[];
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
  const descriptorsFor = (period: Period): readonly HouseholdWorkDescriptor[] => [
    ...(compiled.cashFlowInput === undefined ? [] : describeVerticalSlice2PeriodWork(runContext, compiled.cashFlowInput, period)),
    ...(compiled.investmentInput === undefined ? [] : describeVerticalSlice3PeriodWork(runContext, compiled.investmentInput, period)),
    ...(compiled.liabilityInput === undefined || compiled.liabilityInput.loans.some((loan) => loan.paymentSchedule === undefined) ? [] : describeVerticalSlice4PeriodWork(runContext, compiled.liabilityInput, period)),
  ];
  const runDescriptors = periods.flatMap(descriptorsFor);
  const byId = <T extends { readonly id: string }>(items: readonly T[] | undefined): readonly T[] => Object.freeze([...(items ?? [])].sort((left, right) => left.id.localeCompare(right.id)));
  const canonicalInputs = {
    cashFlowInput: compiled.cashFlowInput === undefined ? undefined : { ...compiled.cashFlowInput, incomes: byId(compiled.cashFlowInput.incomes), expenses: byId(compiled.cashFlowInput.expenses), events: byId(compiled.cashFlowInput.events) },
    investmentInput: compiled.investmentInput === undefined ? undefined : { ...compiled.investmentInput, transfers: byId(compiled.investmentInput.transfers), purchases: byId(compiled.investmentInput.purchases), fees: byId(compiled.investmentInput.fees), returns: [...compiled.investmentInput.returns].sort((left, right) => left.targetPositionId.localeCompare(right.targetPositionId)) },
    liabilityInput: compiled.liabilityInput === undefined ? undefined : { ...compiled.liabilityInput, loans: [...compiled.liabilityInput.loans].sort((left, right) => left.id.localeCompare(right.id)).map((loan) => ({ ...loan, extraPrincipalPayments: byId(loan.extraPrincipalPayments) })) },
    scenarioBindings: compiled.scenarioBindings,
    standaloneAssets: compiled.standaloneAssets ?? [],
  };
  const fingerprint = createInputFingerprint({ runContext, openingState: state, primitiveState, model: canonicalInputs, executionPlan: { months: compiled.executionMonths, descriptors: [...runDescriptors].sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right))), contentionPolicy: compiled.contentionPolicy } });
  const runMetadata = createRunMetadata(runContext, fingerprint);
  const committed: HouseholdProjectionPeriodResult[] = [];
  const diagnostics: ValidationIssue[] = [];
  for (const period of periods) try {
    let candidateState = cloneAuthoritativeState(state);
    let candidatePrimitiveState = createPrimitiveRuntimeStateStore(primitiveState);
    let cashFlow: VerticalSlice2PeriodResult | undefined; let investments: VerticalSlice3PeriodResult | undefined; let liability: VerticalSlice4PeriodResult | undefined;
    const cashPeriods: VerticalSlice2PeriodResult[] = []; const investmentPeriods: VerticalSlice3PeriodResult[] = []; const liabilityPeriods: VerticalSlice4PeriodResult[] = [];
    const descriptors = descriptorsFor(period);
    if (compiled.liabilityInput?.loans.some((loan) => loan.paymentSchedule === undefined)) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_INPUT_INVALID", message: "Every liability loan must provide a payment schedule.", entityType: "household_projection" });
    if (descriptors.some((item) => item.sequencingInstant < period.start || item.sequencingInstant >= period.end)) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_WORK_OUTSIDE_PERIOD", message: "Household work must be sequenced inside its canonical period.", entityType: "household_projection", relatedIds: descriptors.filter((item) => item.sequencingInstant < period.start || item.sequencingInstant >= period.end).map((item) => item.id) });
    const scheduled = buildHouseholdScheduledPlan(descriptors, compiled.contentionPolicy);
    if (scheduled.status === "invalid_model") throw new ValidationError(scheduled.diagnostics);
    const idsAt = (at: Instant) => new Set(scheduled.value.descriptors.filter((item) => item.sequencingInstant === at).map((item) => item.id));
    for (const at of [...new Set(scheduled.value.descriptors.map((item) => item.sequencingInstant))]) {
      const sameInstant = scheduled.value.descriptors.filter((item) => item.sequencingInstant === at);
      for (let left = 0; left < sameInstant.length; left += 1) for (let right = left + 1; right < sameInstant.length; right += 1) {
        const a = sameInstant[left]!; const b = sameInstant[right]!;
        if (a.domain === b.domain || !a.resourceAccesses.some((access) => b.resourceAccesses.some((other) => access.accountId === other.accountId && (access.mode === "consume" || other.mode === "consume")))) continue;
        const explicitlyOrdered = scheduled.value.dependencies.some((edge) => (edge.before === a.id && edge.after === b.id) || (edge.before === b.id && edge.after === a.id));
        if (!explicitlyOrdered) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_CONTENTION_UNRESOLVED", message: "Same-instant cross-domain cash contention requires explicit precedence; module order is not economic precedence.", entityType: "household_projection", relatedIds: [a.id, b.id] });
      }
    }
    const cashAt = (at: Instant): VerticalSlice2Input | undefined => {
      if (compiled.cashFlowInput === undefined) return undefined;
      const ids = idsAt(at);
      return { ...compiled.cashFlowInput, incomes: compiled.cashFlowInput.incomes.filter((item) => [...ids].some((id) => id.startsWith(`cash-income:${item.id}:`))), expenses: compiled.cashFlowInput.expenses.filter((item) => [...ids].some((id) => id.startsWith(`cash-expense:${item.id}:`))), events: [] };
    };
    const investmentAt = (at: Instant): VerticalSlice3Input | undefined => {
      if (compiled.investmentInput === undefined) return undefined;
      const ids = idsAt(at);
      return { ...compiled.investmentInput, returns: compiled.investmentInput.returns.filter((item) => [...ids].some((id) => id.startsWith(`investment-valuation:${item.targetPositionId}:`))), transfers: compiled.investmentInput.transfers.filter((item) => [...ids].some((id) => id.startsWith(`investment-transfer:${item.id}:`))), purchases: compiled.investmentInput.purchases.filter((item) => [...ids].some((id) => id.startsWith(`investment-purchase:${item.id}:`))), fees: (compiled.investmentInput.fees ?? []).filter((item) => [...ids].some((id) => id.startsWith(`investment-fee:${item.id}:`))) };
    };
    const liabilityAt = (at: Instant): VerticalSlice4Input | undefined => {
      if (compiled.liabilityInput === undefined) return undefined;
      const ids = idsAt(at);
      return { ...compiled.liabilityInput, loans: compiled.liabilityInput.loans.filter((item) => [...ids].some((id) => id.startsWith(`liability-required:${item.id}:`) || id.includes(`:${item.id}:`) || (item.extraPrincipalPayments ?? []).some((extra) => id.startsWith(`liability-extra:${extra.id}:`)))) };
    };
    for (const at of [...new Set(scheduled.value.descriptors.map((item) => item.sequencingInstant))].sort()) {
      const periodContext = Object.freeze({ ...runContext, simulationStart: period.start, simulationEnd: period.end });
      const cashInput = cashAt(at); if (cashInput !== undefined && (cashInput.incomes.length > 0 || cashInput.expenses.length > 0)) { const candidate = executeVerticalSlice2PeriodCandidate({ runContext: periodContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: cashInput } as VerticalSlice2RunInput, period, candidateState, candidatePrimitiveState); candidateState = candidate.state; candidatePrimitiveState = candidate.primitiveState; cashFlow = candidate.period; cashPeriods.push(candidate.period); }
      const investmentInput = investmentAt(at); if (investmentInput !== undefined && (investmentInput.returns.length > 0 || investmentInput.transfers.length > 0 || investmentInput.purchases.length > 0 || (investmentInput.fees?.length ?? 0) > 0)) { const candidate = executeVerticalSlice3PeriodCandidate({ runContext: periodContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: investmentInput } as VerticalSlice3RunInput, period, candidateState, candidatePrimitiveState); candidateState = candidate.state; candidatePrimitiveState = candidate.primitiveState; investments = candidate.period; investmentPeriods.push(candidate.period); }
      const liabilityInput = liabilityAt(at); if (liabilityInput !== undefined && liabilityInput.loans.length > 0) { const candidate = executeVerticalSlice4PeriodCandidate({ runContext: periodContext, openingState: candidateState, primitiveState: candidatePrimitiveState, input: liabilityInput } as VerticalSlice4RunInput, period, candidateState, candidatePrimitiveState); candidateState = candidate.state; candidatePrimitiveState = candidate.primitiveState; liability = candidate.period; liabilityPeriods.push(candidate.period); }
    }
    validateAuthoritativeState(candidateState); assertAuthoritativeStateCurrency(candidateState, runContext.baseCurrency); assertPrimitiveRuntimeStateConsistent(candidatePrimitiveState, candidateState);
    const transactions = Object.freeze([...cashPeriods.flatMap((item) => item.transactions), ...investmentPeriods.flatMap((item) => item.transactions), ...liabilityPeriods.flatMap((item) => item.transactions)].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)));
    const statements = deriveStatements(candidateState, transactions, runContext.baseCurrency);
    const metrics = deriveHouseholdClosingMetrics(candidateState, runContext.baseCurrency, compiled.standaloneAssets);
    const periodResult: HouseholdProjectionPeriodResult = Object.freeze({ period: Object.freeze({ ...period }), statements, cash: metrics.cash, investmentValue: metrics.investmentValue, assets: metrics.totalAssets, liabilities: metrics.totalLiabilities, netWorth: metrics.netWorth, transactions,
      constraintOutcomes: Object.freeze([...cashPeriods.flatMap((item) => item.constraintOutcomes), ...liabilityPeriods.flatMap((item) => item.constraintOutcomes)]),
      liquidityShortfalls: Object.freeze([...cashPeriods.flatMap((item) => item.liquidityShortfalls), ...liabilityPeriods.flatMap((item) => item.liquidityShortfalls)]),
      traceRefs: mergeTraceRefs(...cashPeriods.map((item) => item.traceRefs), ...investmentPeriods.map((item) => item.traceRefs), ...liabilityPeriods.map((item) => item.traceRefs)) ?? Object.freeze([]),
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
