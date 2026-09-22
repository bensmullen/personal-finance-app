import {
  accountingTransactionId,
  createAccountingLeg,
  createAccountingTransaction,
  type AccountingLegDraft,
  type AccountingTransaction,
} from "../accounting/index.js";
import { ValidationError, failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { isAcceptedFundingResolution, resolveFunding, type ConstraintOutcome, type FundingPolicy, type LiquidityShortfall } from "../funding/index.js";
import { domainId, generatedOccurrenceKey, type DomainId, type GeneratedOccurrenceKey } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs, mergeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
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
import type { HouseholdWorkDescriptor } from "./intraperiodScheduler.js";

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
  readonly sourceTraceRefs?: readonly CalculationTraceRef[];
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
  readonly sourceTraceRefs?: readonly CalculationTraceRef[];
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
      const traceRefs = mergeTraceRefs(traces(`event:${activation.id}`, `event-activation:${stream.id}`), activation.sourceTraceRefs, stream.sourceTraceRefs)!;
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
      const traceRefs = mergeTraceRefs(traces(`event:${termination.id}`, `event-termination:${stream.id}`), termination.sourceTraceRefs, stream.sourceTraceRefs)!;
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
  input: VerticalSlice2Input,
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
    traceRefs: mergeTraceRefs(
      activationAllowed && activation !== undefined ? traces(`event:${stream.activationEventId}`, `event-activation:${stream.id}`) : undefined,
      termination === undefined ? undefined : traces(`event:${stream.terminationEventId}`, `event-termination:${stream.id}`),
      eventFor(input, stream.activationEventId)?.sourceTraceRefs,
      eventFor(input, stream.terminationEventId)?.sourceTraceRefs,
      stream.sourceTraceRefs,
    ) ?? Object.freeze([]),
  });
};

/**
 * The household scheduler sees only this serializable description.  The
 * occurrence's executable behavior stays in this module and is deliberately
 * not part of the descriptor or the household fingerprint.
 */
export interface PreparedVerticalSlice2Occurrence {
  readonly descriptor: HouseholdWorkDescriptor;
  readonly streamId: IncomeId | ExpenseId;
  readonly scheduledAt: Instant;
}

export interface PreparedVerticalSlice2Period {
  readonly period: Period;
  /** Candidate state after event/primitive preparation and before cash-flow work. */
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  /** Event runtime is precomputed for eligibility but commits only at this frontier. */
  readonly primitiveStateFrontier: Instant;
  readonly descriptors: readonly HouseholdWorkDescriptor[];
  readonly occurrences: readonly PreparedVerticalSlice2Occurrence[];
  readonly diagnostics: readonly ValidationIssue[];
  readonly traceRefs: readonly CalculationTraceRef[];
}

const householdDescriptor = (value: Omit<HouseholdWorkDescriptor, "dependsOn" | "traceRefs"> & { readonly dependsOn?: readonly string[] }): HouseholdWorkDescriptor =>
  Object.freeze({ ...value, dependsOn: Object.freeze([...(value.dependsOn ?? [])].sort()), traceRefs: Object.freeze([]) });

const occurrenceDescriptor = (
  context: RunContext,
  stream: RecurringIncomeStream | RecurringExpenseStream,
  scheduledAt: Instant,
): PreparedVerticalSlice2Occurrence => {
  const income = "depositAccountId" in stream;
  const occurrenceIdentity = generatedOccurrenceKey({
    scenarioId: context.scenarioId,
    primitiveInstanceId: stream.primitiveIds.recurrence,
    scheduledAt,
    semanticEffectType: income ? "income-recognition" : "expense-recognition",
    economicTargetId: stream.id,
  });
  const descriptor = householdDescriptor({
    id: `${income ? "cash-income" : "cash-expense"}:${stream.id}:${occurrenceIdentity}`,
    domain: "cash_flow",
    operationClass: income ? "cash_income_settlement" : "cash_expense_settlement",
    sequencingInstant: scheduledAt,
    resourceAccesses: income
      ? [{ kind: "account_cash", accountId: stream.depositAccountId, mode: "produce" }]
      : stream.fundingPolicy.orderedSources.map((source) => ({ kind: "account_cash" as const, accountId: source.accountId, mode: "consume" as const })),
    primitiveInstanceId: stream.primitiveIds.recurrence,
    occurrenceIdentity,
  });
  return Object.freeze({ descriptor, streamId: stream.id, scheduledAt });
};

const withLocalOrdering = (
  input: VerticalSlice2Input,
  occurrences: readonly PreparedVerticalSlice2Occurrence[],
): readonly PreparedVerticalSlice2Occurrence[] => {
  const byId = new Map(occurrences.map((item) => [item.descriptor.id, item]));
  const descriptors = new Map(occurrences.map((item) => [item.descriptor.id, item.descriptor]));
  for (const instantOccurrences of new Map<Instant, PreparedVerticalSlice2Occurrence[]>(
    occurrences.reduce((map, item) => map.set(item.scheduledAt, [...(map.get(item.scheduledAt) ?? []), item]), new Map()),
  ).values()) {
    const incomes = instantOccurrences.filter((item) => input.incomes.some((stream) => stream.id === item.streamId));
    const expenses = instantOccurrences.filter((item) => input.expenses.some((stream) => stream.id === item.streamId));
    if (incomes.length > 0 && expenses.length > 0 && input.sameInstantCashFlowOrder === undefined) {
      invalidInput("Same-instant income and expense actions require an explicit cash-flow order", "input.sameInstantCashFlowOrder");
    }
    if (expenses.length > 1) {
      const priorities = expenses.map((item) => input.expenses.find((stream) => stream.id === item.streamId)!.settlementPriority);
      if (priorities.some((priority) => priority === undefined) || new Set(priorities).size !== priorities.length) {
        invalidInput("Same-instant expense actions require distinct settlement priorities", "expenses");
      }
    }
    const ordered = [...instantOccurrences].sort((left, right) => {
      const leftIncome = incomes.some((item) => item.descriptor.id === left.descriptor.id);
      const rightIncome = incomes.some((item) => item.descriptor.id === right.descriptor.id);
      if (leftIncome !== rightIncome) {
        const incomeFirst = input.sameInstantCashFlowOrder === "income_before_expense";
        return leftIncome === incomeFirst ? -1 : 1;
      }
      if (!leftIncome && !rightIncome) {
        const leftPriority = input.expenses.find((stream) => stream.id === left.streamId)!.settlementPriority!;
        const rightPriority = input.expenses.find((stream) => stream.id === right.streamId)!.settlementPriority!;
        return leftPriority - rightPriority;
      }
      return left.descriptor.id.localeCompare(right.descriptor.id);
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const current = ordered[index]!;
      const previous = ordered[index - 1]!;
      const currentDescriptor = descriptors.get(current.descriptor.id)!;
      descriptors.set(current.descriptor.id, householdDescriptor({ ...currentDescriptor, dependsOn: [...currentDescriptor.dependsOn, previous.descriptor.id] }));
    }
  }
  return Object.freeze([...byId.values()].map((item) => Object.freeze({ ...item, descriptor: descriptors.get(item.descriptor.id)! })));
};

/** Prepares only currently eligible VS2 occurrence work for one candidate period. */
export const prepareVerticalSlice2Period = (
  runContext: RunContext,
  input: VerticalSlice2Input,
  period: Period,
  currentState: AuthoritativeState,
  currentPrimitiveState: PrimitiveRuntimeStateStore,
): PreparedVerticalSlice2Period => {
  const request: VerticalSlice2RunInput = { runContext, openingState: currentState, input, months: 1, primitiveState: currentPrimitiveState };
  validateInput(request, [period], true);
  const eventResult = runPeriod({ period, runContext, openingState: currentState, primitiveState: currentPrimitiveState, work: eventWork(request, period) });
  const eventOutputs = new Map(eventResult.primitiveOutputs.map((output) => [output.workId, output.output]));
  const occurrences: PreparedVerticalSlice2Occurrence[] = [];
  const streams: readonly (RecurringIncomeStream | RecurringExpenseStream)[] = [...input.incomes, ...input.expenses];
  for (const stream of streams) {
    const scheduleTraces = mergeTraceRefs(traces(`${"depositAccountId" in stream ? "income" : "expense"}:${stream.id}:schedule`), stream.sourceTraceRefs)!;
    const scheduled = evaluatePrimitive({ primitiveId: "P03", input: { amount: stream.baseMonthlyAmount }, parameters: { schedule: stream.recurrence }, priorState: null, context: { ...primitiveContext(request, stream.id, stream.primitiveIds.recurrence, subtractMilliseconds(period.end, 1), "occurrence-preparation", scheduleTraces), period } });
    for (const candidate of scheduled.output.occurrences) {
      const temporal = evaluatePrimitive({ primitiveId: "P04", input: { value: candidate.value }, parameters: { start: stream.start, end: stream.end ?? runContext.simulationEnd }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.recurrence, candidate.scheduledAt, "occurrence-eligibility", scheduleTraces) });
      if (temporal.output.active && eventRuntimeAllows(input, stream, eventOutputs, candidate.scheduledAt).allowed) occurrences.push(occurrenceDescriptor(runContext, stream, candidate.scheduledAt));
    }
  }
  const ordered = withLocalOrdering(input, occurrences);
  return Object.freeze({ period: Object.freeze({ ...period }), state: eventResult.closingState, primitiveState: eventResult.primitiveState, primitiveStateFrontier: subtractMilliseconds(period.end, 1), descriptors: Object.freeze(ordered.map((item) => item.descriptor)), occurrences: ordered, diagnostics: Object.freeze([...eventResult.diagnostics]), traceRefs: mergeTraceRefs(...eventResult.primitiveOutputs.filter((output) => output.effects.length > 0).map((output) => output.traceRefs)) ?? Object.freeze([]) });
};

/**
 * Executes one prepared occurrence through the existing VS2 financial path.
 * The filtered input is an internal mechanic, never a caller-supplied
 * executor, so recognition, obligations, funding, settlement, accounting,
 * effects, identities, and traces remain implemented exactly once.
 */
export const executePreparedVerticalSlice2Occurrence = (
  prepared: PreparedVerticalSlice2Period,
  occurrence: PreparedVerticalSlice2Occurrence,
  state: AuthoritativeState,
  primitiveState: PrimitiveRuntimeStateStore,
  input: VerticalSlice2Input,
  runContext: RunContext,
): { readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly period: VerticalSlice2PeriodResult } => {
  const income = input.incomes.find((stream) => stream.id === occurrence.streamId);
  const expense = input.expenses.find((stream) => stream.id === occurrence.streamId);
  if (income === undefined && expense === undefined) invalidInput(`Prepared VS2 occurrence ${occurrence.streamId} is not present in the fingerprinted input`, "input");
  const selected = income ?? expense!;
  const executableStream = income === undefined
    ? (() => {
        const { activationEventId: _activationEventId, terminationEventId: _terminationEventId, primitiveIds, ...rest } = selected as RecurringExpenseStream;
        const { activation: _activation, termination: _termination, ...eventFreePrimitiveIds } = primitiveIds;
        return { ...rest, primitiveIds: eventFreePrimitiveIds } as RecurringExpenseStream;
      })()
    : (() => {
        const { activationEventId: _activationEventId, terminationEventId: _terminationEventId, primitiveIds, ...rest } = selected as RecurringIncomeStream;
        const { activation: _activation, termination: _termination, ...eventFreePrimitiveIds } = primitiveIds;
        return { ...rest, primitiveIds: eventFreePrimitiveIds } as RecurringIncomeStream;
      })();
  const { sameInstantCashFlowOrder: _sameInstantCashFlowOrder, ...inputWithoutMixedOrder } = input;
  const filtered = income === undefined
    ? { ...inputWithoutMixedOrder, incomes: Object.freeze([]), expenses: Object.freeze([executableStream as RecurringExpenseStream]), events: Object.freeze([]) }
    : { ...inputWithoutMixedOrder, incomes: Object.freeze([executableStream as RecurringIncomeStream]), expenses: Object.freeze([]), events: Object.freeze([]) };
  return executeVerticalSlice2PeriodCandidate({ runContext, openingState: state, primitiveState, input: filtered }, prepared.period, state, primitiveState);
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
        const scheduleTraces = mergeTraceRefs(traces(`income:${stream.id}:schedule`), stream.sourceTraceRefs)!;
        const scheduled = evaluatePrimitive({ primitiveId: "P03", input: { amount: stream.baseMonthlyAmount }, parameters: { schedule: stream.recurrence }, priorState: null, context: { ...primitiveContext(request, stream.id, stream.primitiveIds.recurrence, subtractMilliseconds(targetPeriod.end, 1), "income-recognition", scheduleTraces), period: targetPeriod } });
        for (const candidate of scheduled.output.occurrences) {
          const temporal = evaluatePrimitive({ primitiveId: "P04", input: { value: candidate.value }, parameters: { start: stream.start, end: stream.end ?? request.runContext.simulationEnd }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.recurrence, candidate.scheduledAt, "income-eligibility", scheduleTraces) });
          const eventEligibility = eventRuntimeAllows(request.input, stream, eventOutputs, candidate.scheduledAt);
          if (!temporal.output.active || !eventEligibility.allowed) continue;
          const month = utcCalendarMonthDifference(stream.growthBaseAt, candidate.scheduledAt);
          const baseTraces = mergeTraceRefs(traces(`income:${stream.id}:base`, `income:${stream.id}:salary-growth-assumption`, `income:${stream.id}:growth:${month}`), stream.sourceTraceRefs)!;
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
        const scheduleTraces = mergeTraceRefs(traces(`expense:${stream.id}:schedule`), stream.sourceTraceRefs)!;
        const scheduled = evaluatePrimitive({ primitiveId: "P03", input: { amount: stream.baseMonthlyAmount }, parameters: { schedule: stream.recurrence }, priorState: null, context: { ...primitiveContext(request, stream.id, stream.primitiveIds.recurrence, subtractMilliseconds(targetPeriod.end, 1), "expense-recognition", scheduleTraces), period: targetPeriod } });
        for (const candidate of scheduled.output.occurrences) {
          const temporal = evaluatePrimitive({ primitiveId: "P04", input: { value: candidate.value }, parameters: { start: stream.start, end: stream.end ?? request.runContext.simulationEnd }, priorState: null, context: primitiveContext(request, stream.id, stream.primitiveIds.recurrence, candidate.scheduledAt, "expense-eligibility", scheduleTraces) });
          const eventEligibility = eventRuntimeAllows(request.input, stream, eventOutputs, candidate.scheduledAt);
          if (!temporal.output.active || !eventEligibility.allowed) continue;
          const month = utcCalendarMonthDifference(stream.inflationBaseAt, candidate.scheduledAt);
          const indexTraces = mergeTraceRefs(traces(`expense:${stream.id}:base`, `expense:${stream.id}:inflation-assumption`, `expense:${stream.id}:inflation-index:${month}`), stream.sourceTraceRefs)!;
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
        traceRefs: mergeTraceRefs(periodTraces)!,
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

/** Runs VS2 through the same prepared occurrence seam used by household scheduling. */
const runVerticalSlice2Prepared = (request: VerticalSlice2RunInput): VerticalSlice2RunResult => {
  const months = request.months ?? 360;
  const periods = utcMonthlyPeriods(request.runContext.simulationStart, months);
  validateInput(request, periods);
  const requestedHorizon = Object.freeze({ start: periods[0]!.start, end: periods[periods.length - 1]!.end });
  const runMetadata = createRunMetadata(request.runContext, createInputFingerprint({ runContext: request.runContext, openingState: request.openingState, model: request.input, assumptions: { months } }));
  let committedState = cloneAuthoritativeState(request.openingState);
  let committedPrimitiveState = createPrimitiveRuntimeStateStore(request.primitiveState);
  const committedPeriods: VerticalSlice2PeriodResult[] = [];
  const runDiagnostics: ValidationIssue[] = [];
  for (const period of periods) {
    try {
      const prepared = prepareVerticalSlice2Period(request.runContext, request.input, period, committedState, committedPrimitiveState);
      const remaining = new Map(prepared.occurrences.map((occurrence) => [occurrence.descriptor.id, occurrence]));
      const executed = new Set<string>();
      const parts: VerticalSlice2PeriodResult[] = [];
      let state = prepared.state;
      let primitiveState = prepared.primitiveState;
      while (remaining.size > 0) {
        const nextInstant = [...remaining.values()].map((occurrence) => occurrence.scheduledAt).sort()[0]!;
        const ready = [...remaining.values()]
          .filter((occurrence) => occurrence.scheduledAt === nextInstant)
          .filter((occurrence) => occurrence.descriptor.dependsOn.every((dependency) => executed.has(dependency)))
          .sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id));
        if (ready.length === 0) throw new ValidationError([{ severity: "error", code: "HOUSEHOLD_WORK_CYCLE", message: "VS2 occurrence dependencies contain a cycle.", entityType: "vertical_slice_2" }]);
        for (const occurrence of ready) {
          const executedOccurrence = executePreparedVerticalSlice2Occurrence(prepared, occurrence, state, primitiveState, request.input, request.runContext);
          state = executedOccurrence.state;
          primitiveState = executedOccurrence.primitiveState;
          parts.push(executedOccurrence.period);
          remaining.delete(occurrence.descriptor.id);
          executed.add(occurrence.descriptor.id);
        }
      }
      const currency = request.input.baseCurrency;
      const aggregate: VerticalSlice2PeriodResult = Object.freeze({
        period: Object.freeze({ ...period }),
        recurringIncomeRecognized: parts.reduce((total, part) => total.plus(part.recurringIncomeRecognized), Money.zero(currency)),
        recurringExpenseRecognized: parts.reduce((total, part) => total.plus(part.recurringExpenseRecognized), Money.zero(currency)),
        expenseCashSettlement: parts.reduce((total, part) => total.plus(part.expenseCashSettlement), Money.zero(currency)),
        endingCash: state.accounts[request.input.cashAccountId]!.cash,
        outstandingExpenseObligations: outstandingExpenses(state, currency),
        incomeOccurrences: Object.freeze(parts.flatMap((part) => part.incomeOccurrences)),
        expenseOccurrences: Object.freeze(parts.flatMap((part) => part.expenseOccurrences)),
        recognitions: Object.freeze(parts.flatMap((part) => part.recognitions)),
        settlementProposals: Object.freeze(parts.flatMap((part) => part.settlementProposals)),
        settlements: Object.freeze(parts.flatMap((part) => part.settlements)),
        effects: Object.freeze(parts.flatMap((part) => part.effects)),
        transactions: Object.freeze(parts.flatMap((part) => part.transactions)),
        constraintOutcomes: Object.freeze(parts.flatMap((part) => part.constraintOutcomes)),
        liquidityShortfalls: Object.freeze(parts.flatMap((part) => part.liquidityShortfalls)),
        diagnostics: Object.freeze([...prepared.diagnostics, ...parts.flatMap((part) => part.diagnostics)]),
        traceRefs: mergeTraceRefs(prepared.traceRefs, ...parts.map((part) => part.traceRefs))!,
      });
      committedState = state;
      committedPrimitiveState = primitiveState;
      committedPeriods.push(aggregate);
      runDiagnostics.push(...aggregate.diagnostics);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      return Object.freeze({ status: "incomplete", runMetadata, requestedHorizon, stoppedAt: period.start, ...(committedPeriods.length === 0 ? {} : { reachedThrough: committedPeriods[committedPeriods.length - 1]!.period.end }), state: committedState, primitiveState: committedPrimitiveState, periods: Object.freeze(committedPeriods), diagnostics: Object.freeze([...runDiagnostics, ...error.issues]), displayInputs: Object.freeze({ asOf: request.runContext.asOf, dataCutoff: request.runContext.dataCutoff, generatedForecastFactKind: "model_generated" as const }) });
    }
  }
  return Object.freeze({ status: "completed", runMetadata, requestedHorizon, reachedThrough: requestedHorizon.end, state: committedState, primitiveState: committedPrimitiveState, periods: Object.freeze(committedPeriods), diagnostics: Object.freeze(runDiagnostics), displayInputs: Object.freeze({ asOf: request.runContext.asOf, dataCutoff: request.runContext.dataCutoff, generatedForecastFactKind: "model_generated" as const }) });
};

/** Runs a deterministic monthly household cash-flow projection (360 months by default). */
export const runVerticalSlice2 = (request: VerticalSlice2RunInput): VerticalSlice2RunResult =>
  (request.months ?? 360) > 24 ? runVerticalSlice2Internal(request) : runVerticalSlice2Prepared(request);

export const createVerticalSlice2PrimitiveId = (value: string): PrimitiveInstanceId => domainId("primitive-instance", value);
