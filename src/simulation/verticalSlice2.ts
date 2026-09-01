import {
  accountingTransactionId,
  createAccountingLeg,
  createAccountingTransaction,
  type AccountingLegDraft,
  type AccountingTransaction,
} from "../accounting/index.js";
import { ValidationError, failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { isAcceptedFundingResolution, resolveFunding, type ConstraintOutcome, type FundingPolicy, type LiquidityShortfall } from "../funding/index.js";
import { domainId, type DomainId, type GeneratedOccurrenceKey } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type ModelGeneratedFactProvenance } from "../model/provenance.js";
import { evaluatePrimitive, primitiveEvaluationContext, type PrimitivePeriodFlow } from "../primitives/index.js";
import {
  applySettlement,
  claimId,
  createObligation,
  createRecognitionFact,
  createSemanticEffect,
  createSettlement,
  createSettlementProposal,
  recognitionId,
  semanticEffectId,
  settlementId,
  settlementProposalId,
  type Obligation,
  type RecognitionFact,
  type SemanticEffect,
  type Settlement,
  type SettlementProposal,
} from "../semantics/index.js";
import {
  applyAccountingTransactionAtomically,
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  registerAuthoritativeIdentity,
  type AuthoritativeState,
} from "../state/index.js";
import {
  civilDate,
  subtractMilliseconds,
  utcCalendarMonthDifference,
  utcMonthDifference,
  utcMonthlyPeriods,
  type Instant,
  type Period,
} from "../time/index.js";
import {
  DecimalAmount,
  Money,
  RateBasis,
  RoundingPolicy,
  decimal,
  sumMoney,
  type Currency,
  type Rate,
} from "../values/index.js";
import {
  assertRunContext,
  createInputFingerprint,
  createRunMetadata,
  type RunContext,
  type RunMetadata,
} from "./run.js";
import {
  createPrimitiveRuntimeStateStore,
  runPeriod,
  type PeriodWork,
  type PrimitiveRuntimeStateStore,
} from "./period.js";

export type HouseholdId = DomainId<"household">;
export type PersonId = DomainId<"person">;
export type AccountId = DomainId<"account">;
export type LiabilityId = DomainId<"liability">;
export type IncomeId = DomainId<"income">;
export type ExpenseId = DomainId<"expense">;
export type EventId = DomainId<"event">;
export type PrimitiveInstanceId = DomainId<"primitive-instance">;

export interface ScheduledCashFlowEvent {
  readonly id: EventId;
  readonly targetId: IncomeId | ExpenseId;
  readonly kind: "activation" | "termination";
  readonly effectiveAt: Instant;
}

interface MonthlyStreamBase<Id extends IncomeId | ExpenseId> {
  readonly id: Id;
  readonly ownerId: PersonId | HouseholdId;
  readonly baseMonthlyAmount: Money;
  readonly start: Instant;
  readonly end?: Instant;
  readonly recurrence: {
    readonly kind: "utc_monthly";
    readonly anchor: Instant;
    readonly invalidDayPolicy: "skip";
  };
  readonly activationEventId?: EventId;
  readonly terminationEventId?: EventId;
}

export interface RecurringIncomeStream extends MonthlyStreamBase<IncomeId> {
  readonly depositAccountId: AccountId;
  readonly growthRate: Rate;
  readonly growthBaseAt: Instant;
  readonly primitiveIds: {
    readonly growth: PrimitiveInstanceId;
    readonly recurrence: PrimitiveInstanceId;
    readonly activation?: PrimitiveInstanceId;
    readonly termination?: PrimitiveInstanceId;
  };
}

export interface RecurringExpenseStream extends MonthlyStreamBase<ExpenseId> {
  readonly paymentAccountId: AccountId;
  readonly payableLiabilityId: LiabilityId;
  readonly fundingPolicy: FundingPolicy;
  /** Required to break same-instant expense settlement competition deterministically. */
  readonly settlementPriority?: number;
  readonly inflationRate: Rate;
  readonly inflationBaseAt: Instant;
  readonly primitiveIds: {
    readonly indexGrowth: PrimitiveInstanceId;
    readonly inflationLink: PrimitiveInstanceId;
    readonly recurrence: PrimitiveInstanceId;
    readonly activation?: PrimitiveInstanceId;
    readonly termination?: PrimitiveInstanceId;
  };
}

export interface VerticalSlice2Input {
  readonly householdId: HouseholdId;
  readonly ownerId: PersonId;
  readonly cashAccountId: AccountId;
  readonly expensePayableLiabilityId: LiabilityId;
  readonly baseCurrency: Currency;
  readonly incomes: readonly RecurringIncomeStream[];
  readonly expenses: readonly RecurringExpenseStream[];
  readonly events: readonly ScheduledCashFlowEvent[];
  /** Required when income and expense compete at the same occurrence instant. */
  readonly sameInstantCashFlowOrder?: "income_before_expense" | "expense_before_income";
}

export interface VerticalSlice2RunInput {
  readonly runContext: RunContext;
  readonly openingState: AuthoritativeState;
  readonly input: VerticalSlice2Input;
  readonly months?: number;
  readonly primitiveState?: PrimitiveRuntimeStateStore;
}

export interface ProjectedCashFlowOccurrence {
  readonly streamId: IncomeId | ExpenseId;
  readonly occurrenceId: GeneratedOccurrenceKey;
  readonly scheduledAt: Instant;
  readonly amount: Money;
  readonly provenance: ModelGeneratedFactProvenance;
  readonly traceRefs: readonly CalculationTraceRef[];
}

export interface VerticalSlice2PeriodResult {
  readonly period: Period;
  readonly recurringIncomeRecognized: Money;
  readonly recurringExpenseRecognized: Money;
  readonly expenseCashSettlement: Money;
  readonly endingCash: Money;
  readonly outstandingExpenseObligations: Money;
  readonly incomeOccurrences: readonly ProjectedCashFlowOccurrence[];
  readonly expenseOccurrences: readonly ProjectedCashFlowOccurrence[];
  readonly recognitions: readonly RecognitionFact[];
  readonly settlementProposals: readonly SettlementProposal[];
  readonly settlements: readonly Settlement[];
  readonly effects: readonly SemanticEffect[];
  readonly transactions: readonly AccountingTransaction[];
  readonly constraintOutcomes: readonly ConstraintOutcome[];
  readonly liquidityShortfalls: readonly LiquidityShortfall[];
  readonly diagnostics: readonly ValidationIssue[];
  readonly traceRefs: readonly CalculationTraceRef[];
}

export interface VerticalSlice2RunResult {
  readonly status: "completed" | "incomplete";
  readonly runMetadata: RunMetadata;
  readonly requestedHorizon: Period;
  readonly reachedThrough?: Instant;
  readonly stoppedAt?: Instant;
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly periods: readonly VerticalSlice2PeriodResult[];
  readonly diagnostics: readonly ValidationIssue[];
  readonly displayInputs: {
    readonly asOf: Instant;
    readonly dataCutoff: Instant;
    readonly generatedForecastFactKind: "model_generated";
  };
}

const invalidInput = (message: string, fieldPath: string, code: string = issueCodes.verticalSlice2InputInvalid): never => failValidation({
  severity: "error",
  code,
  message,
  entityType: "vertical_slice_2",
  fieldPath,
});

const trace = (value: string): CalculationTraceRef => calculationTraceRef(calculationTraceId(`vs2:${value}`));
const traces = (...values: string[]): readonly CalculationTraceRef[] => freezeTraceRefs(values.map(trace))!;
const postingPolicy = (currency: Currency): RoundingPolicy => RoundingPolicy.currency(currency.minorUnitScale, "half_up");
const postedMoney = (value: Money, currency: Currency): Money => new Money(value.amount.round(postingPolicy(currency)), currency);

const transaction = (
  id: string,
  date: Instant,
  type: string,
  legs: readonly AccountingLegDraft[],
  traceRefs: readonly CalculationTraceRef[],
): AccountingTransaction => createAccountingTransaction({
  id: accountingTransactionId(id),
  date,
  type,
  legs: legs.map((leg) => createAccountingLeg({ ...leg, traceRefs: leg.traceRefs ?? traceRefs })),
  traceRefs,
});

const allStableIds = (input: VerticalSlice2Input): readonly string[] => [
  input.householdId,
  input.ownerId,
  input.cashAccountId,
  input.expensePayableLiabilityId,
  ...input.events.flatMap((event) => [event.id]),
  ...input.incomes.flatMap((stream) => [stream.id, ...Object.values(stream.primitiveIds).filter((id): id is PrimitiveInstanceId => id !== undefined)]),
  ...input.expenses.flatMap((stream) => [stream.id, ...Object.values(stream.primitiveIds).filter((id): id is PrimitiveInstanceId => id !== undefined)]),
];

const validateInput = (request: VerticalSlice2RunInput, periods: readonly Period[], allowPartialHorizon = false): void => {
  const { input, openingState, runContext } = request;
  assertRunContext(runContext);
  if (!input.baseCurrency.equals(runContext.baseCurrency)) invalidInput("Slice base currency must match the run context", "input.baseCurrency");
  if (input.sameInstantCashFlowOrder !== undefined
    && input.sameInstantCashFlowOrder !== "income_before_expense"
    && input.sameInstantCashFlowOrder !== "expense_before_income") {
    invalidInput("sameInstantCashFlowOrder is invalid", "input.sameInstantCashFlowOrder");
  }
  assertAuthoritativeStateCurrency(openingState, input.baseCurrency);
  if (openingState.accounts[input.cashAccountId] === undefined) invalidInput("Required household cash account is missing", "input.cashAccountId");
  if (openingState.liabilities[input.expensePayableLiabilityId] === undefined) invalidInput("Required expense payable liability is missing", "input.expensePayableLiabilityId");
  if (!allowPartialHorizon && (periods[0]!.start !== runContext.simulationStart || periods[periods.length - 1]!.end !== runContext.simulationEnd)) {
    invalidInput("Monthly period plan must exactly cover the run horizon", "runContext.simulationEnd");
  }
  const ids = allStableIds(input);
  if (new Set(ids).size !== ids.length) invalidInput("Stable identities must be unique", "input", issueCodes.duplicateStableIdentity);
  const events = new Map(input.events.map((event) => [event.id, event]));
  for (const event of input.events) {
    if (event.effectiveAt < runContext.simulationStart) invalidInput("Past-effective VS2 events are unsupported in this milestone", `events.${event.id}.effectiveAt`, issueCodes.verticalSlice2EventReferenceInvalid);
  }
  const streams = [...input.incomes, ...input.expenses];
  for (const stream of streams) {
    if (!stream.baseMonthlyAmount.currency.equals(input.baseCurrency) || stream.baseMonthlyAmount.isNegative()) invalidInput(`Stream ${stream.id} amount is invalid`, `streams.${stream.id}.baseMonthlyAmount`);
    if (stream.start >= (stream.end ?? runContext.simulationEnd) || stream.recurrence.kind !== "utc_monthly" || stream.recurrence.invalidDayPolicy !== "skip") invalidInput(`Stream ${stream.id} temporal configuration is invalid`, `streams.${stream.id}`);
    for (const [reference, expectedKind, primitiveId] of [
      [stream.activationEventId, "activation", stream.primitiveIds.activation],
      [stream.terminationEventId, "termination", stream.primitiveIds.termination],
    ] as const) {
      if (reference === undefined) {
        if (primitiveId !== undefined) invalidInput(`Stream ${stream.id} has an event primitive without an event`, `streams.${stream.id}.primitiveIds`);
        continue;
      }
      const event = events.get(reference);
      if (event === undefined || event.targetId !== stream.id || event.kind !== expectedKind || primitiveId === undefined) {
        invalidInput(`Stream ${stream.id} has an invalid ${expectedKind} event reference`, `streams.${stream.id}.${expectedKind}EventId`, issueCodes.verticalSlice2EventReferenceInvalid);
      }
    }
  }
  for (const income of input.incomes) {
    if (openingState.accounts[income.depositAccountId] === undefined) invalidInput(`Income ${income.id} deposit account is missing`, `incomes.${income.id}.depositAccountId`);
    if (income.growthRate.convention.basis !== RateBasis.EffectiveAnnual && income.growthRate.convention.basis !== RateBasis.Periodic) invalidInput(`Income ${income.id} growth basis is unsupported`, `incomes.${income.id}.growthRate`);
    if (income.growthRate.convention.basis === RateBasis.Periodic && (income.growthRate.convention.period.unit !== "calendar_month" || income.growthRate.convention.period.count.toString() !== "1")) invalidInput(`Income ${income.id} periodic growth must be exactly one calendar month`, `incomes.${income.id}.growthRate`, issueCodes.primitiveParametersInvalid);
    try { utcMonthDifference(income.growthBaseAt, income.recurrence.anchor); } catch { invalidInput(`Income ${income.id} growth base must align with its monthly recurrence`, `incomes.${income.id}.growthBaseAt`); }
  }
  for (const expense of input.expenses) {
    if (openingState.accounts[expense.paymentAccountId] === undefined) invalidInput(`Expense ${expense.id} payment account is missing`, `expenses.${expense.id}.paymentAccountId`);
    if (openingState.liabilities[expense.payableLiabilityId] === undefined) invalidInput(`Expense ${expense.id} payable target is missing`, `expenses.${expense.id}.payableLiabilityId`);
    if (expense.inflationRate.convention.basis !== RateBasis.EffectiveAnnual && expense.inflationRate.convention.basis !== RateBasis.Periodic) invalidInput(`Expense ${expense.id} inflation basis is unsupported`, `expenses.${expense.id}.inflationRate`);
    if (expense.inflationRate.convention.basis === RateBasis.Periodic && (expense.inflationRate.convention.period.unit !== "calendar_month" || expense.inflationRate.convention.period.count.toString() !== "1")) invalidInput(`Expense ${expense.id} periodic inflation must be exactly one calendar month`, `expenses.${expense.id}.inflationRate`, issueCodes.primitiveParametersInvalid);
    if (expense.settlementPriority !== undefined && (!Number.isSafeInteger(expense.settlementPriority) || expense.settlementPriority < 0)) invalidInput(`Expense ${expense.id} settlement priority must be a non-negative safe integer`, `expenses.${expense.id}.settlementPriority`);
    try { utcMonthDifference(expense.inflationBaseAt, expense.recurrence.anchor); } catch { invalidInput(`Expense ${expense.id} inflation base must align with its monthly recurrence`, `expenses.${expense.id}.inflationBaseAt`); }
    for (const source of expense.fundingPolicy.orderedSources) {
      if (openingState.accounts[source.accountId] === undefined) invalidInput(`Expense ${expense.id} funding source is missing`, `expenses.${expense.id}.fundingPolicy.orderedSources`);
    }
  }
}

const primitiveContext = (
  request: VerticalSlice2RunInput,
  targetId: IncomeId | ExpenseId,
  primitiveInstanceId: PrimitiveInstanceId,
  at: Instant,
  semanticEffectType: string,
  traceRefs: readonly CalculationTraceRef[],
) => primitiveEvaluationContext({
  period: { start: request.runContext.simulationStart, end: request.runContext.simulationEnd },
  evaluationInstant: at,
  scenarioId: request.runContext.scenarioId,
  primitiveInstanceId,
  economicTargetId: targetId,
  semanticEffectType,
  traceRefs,
});

const growthTimeBasis = (rate: Rate, months: number) => rate.convention.basis === RateBasis.Periodic
  ? { kind: "per_period" as const, periods: months }
  : {
      kind: "effective_annual" as const,
      yearFraction: { numerator: months, denominator: 12 },
      calculationRounding: new RoundingPolicy(18, "half_even"),
    };

const generatedProvenance = (
  primitiveInstanceId: PrimitiveInstanceId,
  at: Instant,
  occurrenceId: GeneratedOccurrenceKey,
): ModelGeneratedFactProvenance => createFactProvenance({
  factKind: "model_generated",
  sourceType: "model",
  sourceId: primitiveInstanceId,
  effectiveAt: at,
  generatedOccurrenceKey: occurrenceId,
}) as ModelGeneratedFactProvenance;

const eventFor = (input: VerticalSlice2Input, id: EventId | undefined): ScheduledCashFlowEvent | undefined =>
  id === undefined ? undefined : input.events.find((event) => event.id === id);

const eventWork = (
  request: VerticalSlice2RunInput,
  targetPeriod: Period,
): readonly PeriodWork[] => {
  const at = subtractMilliseconds(targetPeriod.end, 1);
  const work: PeriodWork[] = [];
  for (const stream of [...request.input.incomes, ...request.input.expenses].sort((a, b) => a.id.localeCompare(b.id))) {
    const activation = eventFor(request.input, stream.activationEventId);
    if (activation !== undefined) {
      const traceRefs = traces(`event:${activation.id}`, `event-activation:${stream.id}`);
      const { period: _period, ...context } = primitiveContext(request, stream.id, stream.primitiveIds.activation!, at, "event", traceRefs);
      work.push({
        id: `event:activation:${stream.id}`,
        kind: "primitive",
        request: {
          primitiveId: "P27",
          input: { eventId: activation.id },
          parameters: { effectiveAt: activation.effectiveAt, targetId: stream.id },
          context,
        },
      });
    }
    const termination = eventFor(request.input, stream.terminationEventId);
    if (termination !== undefined) {
      const traceRefs = traces(`event:${termination.id}`, `event-termination:${stream.id}`);
      const { period: _period, ...context } = primitiveContext(request, stream.id, stream.primitiveIds.termination!, at, "event", traceRefs);
      work.push({
        id: `event:termination:${stream.id}`,
        kind: "primitive",
        request: {
          primitiveId: "P30",
          input: { base: stream.baseMonthlyAmount, eventId: termination.id },
          parameters: { terminationAt: termination.effectiveAt, targetId: stream.id },
          context,
        },
      });
    }
  }
  return Object.freeze(work);
};

/** Uses only committed P27/P30 output, including their half-open edge state. */
const eventRuntimeAllows = (
  stream: MonthlyStreamBase<IncomeId | ExpenseId>,
  outputs: ReadonlyMap<string, unknown>,
  at: Instant,
): { readonly allowed: boolean; readonly traceRefs: readonly CalculationTraceRef[] } => {
  const activation = stream.activationEventId === undefined ? undefined : outputs.get(`event:activation:${stream.id}`) as { active: boolean; activatedNow: boolean; effectiveAt: Instant } | undefined;
  const termination = stream.terminationEventId === undefined ? undefined : outputs.get(`event:termination:${stream.id}`) as { active: boolean; terminatedNow: boolean; terminationAt: Instant } | undefined;
  const activationAllowed = activation === undefined || (activation.active && (!activation.activatedNow || at >= activation.effectiveAt));
  const terminationAllowed = termination === undefined || (termination.active || (termination.terminatedNow && at < termination.terminationAt));
  return Object.freeze({
    allowed: activationAllowed && terminationAllowed,
    traceRefs: activationAllowed && activation !== undefined ? traces(`event:${stream.activationEventId}`, `event-activation:${stream.id}`) : Object.freeze([]),
  });
};

const outstandingExpenses = (state: AuthoritativeState, currency: Currency): Money => sumMoney(
  Object.values(state.obligations).filter((claim) => claim.category === "expense_payable").map((claim) => claim.outstandingAmount),
  currency,
);

interface VerticalSlice2InternalRunInput extends VerticalSlice2RunInput {
  /** Internal slice composition hook; callers supply an already validated monthly period. */
  readonly targetPeriods?: readonly Period[];
}

const runVerticalSlice2Internal = (request: VerticalSlice2InternalRunInput): VerticalSlice2RunResult => {
  const months = request.months ?? 360;
  const periods = request.targetPeriods ?? utcMonthlyPeriods(request.runContext.simulationStart, months);
  validateInput(request, periods, request.targetPeriods !== undefined);
  const requestedHorizon = Object.freeze({ start: periods[0]!.start, end: periods[periods.length - 1]!.end });
  const runMetadata = createRunMetadata(request.runContext, createInputFingerprint({
    runContext: request.runContext,
    openingState: request.openingState,
    model: request.input,
    assumptions: { months },
  }));
  let committedState = cloneAuthoritativeState(request.openingState);
  let committedPrimitiveState = createPrimitiveRuntimeStateStore(request.primitiveState);
  const committedPeriods: VerticalSlice2PeriodResult[] = [];
  const runDiagnostics: ValidationIssue[] = [];

  for (const targetPeriod of periods) {
    try {
      const eventResult = runPeriod({
        period: targetPeriod,
        runContext: request.runContext,
        openingState: committedState,
        primitiveState: committedPrimitiveState,
        work: eventWork(request, targetPeriod),
      });
      const state = cloneAuthoritativeState(eventResult.closingState);
      const recognitions: RecognitionFact[] = [];
      const proposals: SettlementProposal[] = [];
      const settlements: Settlement[] = [];
      const effects: SemanticEffect[] = [];
      const transactions: AccountingTransaction[] = [];
      const outcomes: ConstraintOutcome[] = [];
      const shortfalls: LiquidityShortfall[] = [];
      const diagnostics: ValidationIssue[] = [...eventResult.diagnostics];
      const incomeOccurrences: ProjectedCashFlowOccurrence[] = [];
      const expenseOccurrences: ProjectedCashFlowOccurrence[] = [];
      const eventOutputs = new Map(eventResult.primitiveOutputs.map((output) => [output.workId, output.output]));
      // A trace for an evaluated no-op event is not causal lineage.
      const periodTraces: CalculationTraceRef[] = eventResult.primitiveOutputs
        .filter((output) => output.effects.length > 0)
        .flatMap((output) => [...(output.traceRefs ?? [])]);
      let recognizedIncome = Money.zero(request.input.baseCurrency);
      let recognizedExpense = Money.zero(request.input.baseCurrency);
      let expenseSettlement = Money.zero(request.input.baseCurrency);

      const applyTransaction = (value: AccountingTransaction): void => {
        applyAccountingTransactionAtomically(state, value);
        transactions.push(value);
      };

      type CashFlowAction = { readonly scheduledAt: Instant; readonly kind: "income" | "expense"; readonly priority: number; readonly id: string; readonly execute: () => void };
      const actions: CashFlowAction[] = [];

      const addIncomeActions = (stream: RecurringIncomeStream): void => {
        // Schedule and temporal eligibility deliberately precede growth: an
        // inactive future schedule must never request a backwards month index.
        const scheduleTraces = traces(`income:${stream.id}:schedule`);
        const scheduled = evaluatePrimitive({ primitiveId: "P03", input: { amount: stream.baseMonthlyAmount }, parameters: { schedule: stream.recurrence }, priorState: null, context: { ...primitiveContext(request, stream.id, stream.primitiveIds.recurrence, subtractMilliseconds(targetPeriod.end, 1), "income-recognition", scheduleTraces), period: targetPeriod } });
        for (const candidate of scheduled.output.occurrences) {
          const temporal = evaluatePrimitive({ primitiveId: "P04", input: { value: candidate.value }, parameters: { start: stream.start, end: stream.end ?? request.runContext.simulationEnd }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.recurrence, candidate.scheduledAt, "income-eligibility", scheduleTraces) });
          const eventEligibility = eventRuntimeAllows(stream, eventOutputs, candidate.scheduledAt);
          if (!temporal.output.active || !eventEligibility.allowed) continue;
          const month = utcCalendarMonthDifference(stream.growthBaseAt, candidate.scheduledAt);
          const baseTraces = traces(`income:${stream.id}:base`, `income:${stream.id}:salary-growth-assumption`, `income:${stream.id}:growth:${month}`);
          const growth = evaluatePrimitive({ primitiveId: "P08", input: { initial: stream.baseMonthlyAmount, rate: stream.growthRate }, parameters: { category: "recurring_occurrence_amount", timeBasis: growthTimeBasis(stream.growthRate, month) }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.growth, candidate.scheduledAt, "income-growth", baseTraces) });
          const recurrenceTraces = [...baseTraces, ...traces(`income:${stream.id}:recurrence`)];
          const recurrence = evaluatePrimitive({ primitiveId: "P03", input: { amount: growth.output.value }, parameters: { schedule: stream.recurrence }, priorState: null, context: { ...primitiveContext(request, stream.id, stream.primitiveIds.recurrence, candidate.scheduledAt, "income-recognition", recurrenceTraces), period: targetPeriod } });
          const occurrence = recurrence.output.occurrences.find((value) => value.scheduledAt === candidate.scheduledAt)!;
          const amount = postedMoney(occurrence.value, request.input.baseCurrency);
          if (!amount.isPositive()) continue;
          const traceRefs = freezeTraceRefs([...recurrenceTraces, ...eventEligibility.traceRefs])!;
          const provenance = generatedProvenance(stream.primitiveIds.recurrence, occurrence.scheduledAt, occurrence.occurrenceId);
          actions.push({ scheduledAt: occurrence.scheduledAt, kind: "income", priority: 0, id: `${stream.id}:${occurrence.occurrenceId}`, execute: () => {
            registerAuthoritativeIdentity(state.identities, "generatedOccurrenceKeys", occurrence.occurrenceId);
            const recognition = createRecognitionFact({ id: recognitionId(`recognition:income:${stream.id}:${occurrence.scheduledAt}`), category: "recurring_income", amount, recognizedAt: occurrence.scheduledAt, sourceOccurrenceKey: occurrence.occurrenceId, provenance, traceRefs }, state.identities.recognitionIds);
            registerAuthoritativeIdentity(state.identities, "recognitionIds", recognition.id);
            recognitions.push(recognition);
            effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${recognition.id}`), kind: "recognition", category: "recurring_income", amount, occurredAt: occurrence.scheduledAt, sourceOccurrenceKey: occurrence.occurrenceId, recognitionId: recognition.id, provenance, traceRefs }));
            applyTransaction(transaction(`tx:${recognition.id}`, occurrence.scheduledAt, "income", [{ posting: "debit", type: "cash", amount, accountId: stream.depositAccountId, cashFlowClass: "operating" }, { posting: "credit", type: "income", amount }], traceRefs));
            recognizedIncome = recognizedIncome.plus(amount);
            incomeOccurrences.push(Object.freeze({ streamId: stream.id, occurrenceId: occurrence.occurrenceId, scheduledAt: occurrence.scheduledAt, amount, provenance, traceRefs }));
            periodTraces.push(...traceRefs);
          }});
        }
      };

      const addExpenseActions = (stream: RecurringExpenseStream): void => {
        const scheduleTraces = traces(`expense:${stream.id}:schedule`);
        const scheduled = evaluatePrimitive({ primitiveId: "P03", input: { amount: stream.baseMonthlyAmount }, parameters: { schedule: stream.recurrence }, priorState: null, context: { ...primitiveContext(request, stream.id, stream.primitiveIds.recurrence, subtractMilliseconds(targetPeriod.end, 1), "expense-recognition", scheduleTraces), period: targetPeriod } });
        for (const candidate of scheduled.output.occurrences) {
          const temporal = evaluatePrimitive({ primitiveId: "P04", input: { value: candidate.value }, parameters: { start: stream.start, end: stream.end ?? request.runContext.simulationEnd }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.recurrence, candidate.scheduledAt, "expense-eligibility", scheduleTraces) });
          const eventEligibility = eventRuntimeAllows(stream, eventOutputs, candidate.scheduledAt);
          if (!temporal.output.active || !eventEligibility.allowed) continue;
          const month = utcCalendarMonthDifference(stream.inflationBaseAt, candidate.scheduledAt);
          const indexTraces = traces(`expense:${stream.id}:base`, `expense:${stream.id}:inflation-assumption`, `expense:${stream.id}:inflation-index:${month}`);
          const baseIndex = decimal("100");
          const indexGrowth = evaluatePrimitive({ primitiveId: "P08", input: { initial: baseIndex, rate: stream.inflationRate }, parameters: { category: "series_quantity", timeBasis: growthTimeBasis(stream.inflationRate, month) }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.indexGrowth, candidate.scheduledAt, "inflation-index", indexTraces) });
          const linkedTraces = [...indexTraces, ...traces(`expense:${stream.id}:inflation-linked`)];
          const linked = evaluatePrimitive({ primitiveId: "P13", input: { baseValue: stream.baseMonthlyAmount, baseIndex, currentIndex: indexGrowth.output.value as DecimalAmount }, parameters: { baseDate: civilDate(stream.inflationBaseAt.slice(0, 10)), indexIdentity: `synthetic-inflation:${stream.id}`, divisionRounding: new RoundingPolicy(18, "half_even") }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.inflationLink, candidate.scheduledAt, "inflation-linked-expense", linkedTraces) });
          const recurrenceTraces = [...linkedTraces, ...traces(`expense:${stream.id}:recurrence`)];
          const recurrence = evaluatePrimitive({ primitiveId: "P03", input: { amount: linked.output.value }, parameters: { schedule: stream.recurrence }, priorState: null, context: { ...primitiveContext(request, stream.id, stream.primitiveIds.recurrence, candidate.scheduledAt, "expense-recognition", recurrenceTraces), period: targetPeriod } });
          const occurrence = recurrence.output.occurrences.find((value) => value.scheduledAt === candidate.scheduledAt)!;
          const amount = postedMoney(occurrence.value, request.input.baseCurrency);
          if (!amount.isPositive()) continue;
          const traceRefs = freezeTraceRefs([...recurrenceTraces, ...eventEligibility.traceRefs])!;
          const provenance = generatedProvenance(stream.primitiveIds.recurrence, occurrence.scheduledAt, occurrence.occurrenceId);
          actions.push({ scheduledAt: occurrence.scheduledAt, kind: "expense", priority: stream.settlementPriority ?? Number.MAX_SAFE_INTEGER, id: `${stream.id}:${occurrence.occurrenceId}`, execute: () => {
            registerAuthoritativeIdentity(state.identities, "generatedOccurrenceKeys", occurrence.occurrenceId);
            const recognition = createRecognitionFact({ id: recognitionId(`recognition:expense:${stream.id}:${occurrence.scheduledAt}`), category: "recurring_expense", amount, recognizedAt: occurrence.scheduledAt, sourceOccurrenceKey: occurrence.occurrenceId, provenance, traceRefs }, state.identities.recognitionIds);
            registerAuthoritativeIdentity(state.identities, "recognitionIds", recognition.id);
            recognitions.push(recognition);
            const obligation = createObligation({ id: claimId(`obligation:${recognition.id}`), category: "expense_payable", originatingRecognitionId: recognition.id, economicOwnerId: stream.ownerId, balanceEntityId: stream.payableLiabilityId, originalAmount: amount, recognizedAt: occurrence.scheduledAt, traceRefs }, Object.values(state.obligations));
            state.obligations[obligation.id] = obligation;
            effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${recognition.id}`), kind: "recognition", category: "recurring_expense", amount, occurredAt: occurrence.scheduledAt, sourceOccurrenceKey: occurrence.occurrenceId, recognitionId: recognition.id, provenance, traceRefs }));
            effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${obligation.id}`), kind: "claim", category: "recurring_expense", amount, occurredAt: occurrence.scheduledAt, sourceOccurrenceKey: occurrence.occurrenceId, recognitionId: recognition.id, claimId: obligation.id, provenance, traceRefs }));
            applyTransaction(transaction(`tx:recognition:${recognition.id}`, occurrence.scheduledAt, "expense_recognition", [{ posting: "debit", type: "expense", amount }, { posting: "credit", type: "liability", amount, entityId: stream.payableLiabilityId }], traceRefs));
            const proposal = createSettlementProposal({ id: settlementProposalId(`proposal:${obligation.id}`), claimId: obligation.id, requestedAmount: amount, requestedAt: occurrence.scheduledAt, fundingPolicyId: stream.fundingPolicy.id, provenance, traceRefs }, obligation);
            proposals.push(proposal);
            const funding = resolveFunding(proposal, obligation, stream.fundingPolicy, Object.fromEntries(Object.entries(state.accounts).map(([id, account]) => [id, account.cash])), occurrence.scheduledAt);
            outcomes.push(funding.outcome); diagnostics.push(...funding.issues);
            if (funding.liquidityShortfall !== undefined) shortfalls.push(funding.liquidityShortfall);
            if (isAcceptedFundingResolution(funding)) {
              const accepted = createSettlement({ id: settlementId(`settlement:${obligation.id}`), settledAt: occurrence.scheduledAt, provenance, traceRefs }, funding, obligation, state.identities.settlementIds);
              registerAuthoritativeIdentity(state.identities, "settlementIds", accepted.id); settlements.push(accepted);
              state.obligations[obligation.id] = applySettlement(obligation, accepted) as Obligation;
              effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${accepted.id}`), kind: "settlement", category: "recurring_expense", amount: accepted.amount, occurredAt: accepted.settledAt, claimId: accepted.claimId, settlementId: accepted.id, provenance, traceRefs }));
              applyTransaction(transaction(`tx:${accepted.id}`, accepted.settledAt, "expense_settlement", [{ posting: "debit", type: "liability", amount: accepted.amount, entityId: stream.payableLiabilityId }, ...accepted.fundingAllocations.map((allocation): AccountingLegDraft => ({ posting: "credit", type: "cash", amount: allocation.amount, accountId: allocation.accountId, cashFlowClass: "operating" }))], traceRefs));
              expenseSettlement = expenseSettlement.plus(accepted.amount);
            }
            recognizedExpense = recognizedExpense.plus(amount);
            expenseOccurrences.push(Object.freeze({ streamId: stream.id, occurrenceId: occurrence.occurrenceId, scheduledAt: occurrence.scheduledAt, amount, provenance, traceRefs }));
            periodTraces.push(...traceRefs);
          }});
        }
      };

      for (const stream of request.input.incomes) addIncomeActions(stream);
      for (const stream of request.input.expenses) addExpenseActions(stream);
      const actionsAt = new Map<Instant, CashFlowAction[]>();
      for (const action of actions) actionsAt.set(action.scheduledAt, [...(actionsAt.get(action.scheduledAt) ?? []), action]);
      for (const sameInstant of actionsAt.values()) {
        const expenses = sameInstant.filter((action) => action.kind === "expense");
        if (expenses.length > 1 && (expenses.some((action) => action.priority === Number.MAX_SAFE_INTEGER) || new Set(expenses.map((action) => action.priority)).size !== expenses.length)) {
          invalidInput("Same-instant expense actions require distinct settlement priorities", "expenses");
        }
        if (sameInstant.some((action) => action.kind === "income") && expenses.length > 0 && request.input.sameInstantCashFlowOrder === undefined) {
          invalidInput("Same-instant income and expense actions require an explicit cash-flow order", "input.sameInstantCashFlowOrder");
        }
      }
      const kindRank = (kind: CashFlowAction["kind"]): number => request.input.sameInstantCashFlowOrder === "expense_before_income"
        ? (kind === "expense" ? 0 : 1)
        : (kind === "income" ? 0 : 1);
      actions.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)
        || kindRank(left.kind) - kindRank(right.kind)
        || (left.kind === "expense" && right.kind === "expense" ? left.priority - right.priority : 0)
        || left.id.localeCompare(right.id));
      for (const action of actions) action.execute();

      const periodResult: VerticalSlice2PeriodResult = Object.freeze({
        period: Object.freeze({ ...targetPeriod }),
        recurringIncomeRecognized: recognizedIncome,
        recurringExpenseRecognized: recognizedExpense,
        expenseCashSettlement: expenseSettlement,
        endingCash: state.accounts[request.input.cashAccountId]!.cash,
        outstandingExpenseObligations: outstandingExpenses(state, request.input.baseCurrency),
        incomeOccurrences: Object.freeze(incomeOccurrences),
        expenseOccurrences: Object.freeze(expenseOccurrences),
        recognitions: Object.freeze(recognitions),
        settlementProposals: Object.freeze(proposals),
        settlements: Object.freeze(settlements),
        effects: Object.freeze(effects),
        transactions: Object.freeze(transactions),
        constraintOutcomes: Object.freeze(outcomes),
        liquidityShortfalls: Object.freeze(shortfalls),
        diagnostics: Object.freeze(diagnostics),
        traceRefs: freezeTraceRefs([...new Map(periodTraces.map((item) => [item.traceId, item])).values()])!,
      });
      committedState = state;
      committedPrimitiveState = eventResult.primitiveState;
      committedPeriods.push(periodResult);
      runDiagnostics.push(...diagnostics);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const diagnostics = [...runDiagnostics, ...error.issues];
      return Object.freeze({
        status: "incomplete",
        runMetadata,
        requestedHorizon,
        stoppedAt: targetPeriod.start,
        ...(committedPeriods.length === 0 ? {} : { reachedThrough: committedPeriods[committedPeriods.length - 1]!.period.end }),
        state: committedState,
        primitiveState: committedPrimitiveState,
        periods: Object.freeze(committedPeriods),
        diagnostics: Object.freeze(diagnostics),
        displayInputs: Object.freeze({ asOf: request.runContext.asOf, dataCutoff: request.runContext.dataCutoff, generatedForecastFactKind: "model_generated" as const }),
      });
    }
  }

  return Object.freeze({
    status: "completed",
    runMetadata,
    requestedHorizon,
    reachedThrough: requestedHorizon.end,
    state: committedState,
    primitiveState: committedPrimitiveState,
    periods: Object.freeze(committedPeriods),
    diagnostics: Object.freeze(runDiagnostics),
    displayInputs: Object.freeze({ asOf: request.runContext.asOf, dataCutoff: request.runContext.dataCutoff, generatedForecastFactKind: "model_generated" as const }),
  });
};

/** Executes one VS2 month on private candidate state for slice composition. */
export const executeVerticalSlice2PeriodCandidate = (
  request: VerticalSlice2RunInput,
  period: Period,
  openingState: AuthoritativeState,
  primitiveState: PrimitiveRuntimeStateStore,
): { readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly period: VerticalSlice2PeriodResult } => {
  const result = runVerticalSlice2Internal({ ...request, openingState, primitiveState, months: 1, targetPeriods: Object.freeze([period]) });
  if (result.status !== "completed" || result.periods[0] === undefined) {
    throw new ValidationError(result.diagnostics);
  }
  return Object.freeze({ state: result.state, primitiveState: result.primitiveState, period: result.periods[0] });
};

/** Runs a deterministic monthly household cash-flow projection (360 months by default). */
export const runVerticalSlice2 = (request: VerticalSlice2RunInput): VerticalSlice2RunResult => runVerticalSlice2Internal(request);

export const createVerticalSlice2PrimitiveId = (value: string): PrimitiveInstanceId => domainId("primitive-instance", value);
