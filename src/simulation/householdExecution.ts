import { compileHouseholdKernel, applyHouseholdExecutionOverlay, canonicalDescriptorOrder, type CompiledHouseholdKernel, type HouseholdExecutionOverlay } from "./r3/compiledHousehold.js";
import { indexPreparedOperations, type OperationState, type PreparedOperationParticipant } from "./r3/operations.js";
import { householdDomainParticipants, type HouseholdOperationFacts } from "./r3/domainOperations.js";
import { summarizeHouseholdPeriod, type HouseholdForecastSummaryPeriod } from "./r3/forecastSummary.js";
import { firstDependencyOrder, indexReachability, indexSequencingInstants } from "./r3/ordering.js";
import { compareReachableStates, createReachableStateCounters } from "./r3/reachableStates.js";
import { fundingPoolConservationProof } from "./r3/commutativity.js";
import type { AccountingTransaction } from "../accounting/index.js";
import { ValidationError, createPerformanceSession, type PerformanceObserver, type PerformanceSession, type ValidationIssue } from "../diagnostics/index.js";
import type {
  ConstraintOutcome,
  LiquidityShortfall,
} from "../funding/index.js";
import {
  calculationTraceId,
  calculationTraceRef,
  mergeTraceRefs,
  type CalculationTraceRef,
} from "../lineage/index.js";
import {
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  createIndexedExecutionState,
  createAuthoritativeState,
  registerAuthoritativeIdentity,
  validateAuthoritativeState,
  type AuthoritativeState,
} from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { type Instant, type Period } from "../time/index.js";
import { Money } from "../values/index.js";
import { deriveHouseholdClosingMetrics } from "./householdProjection.js";
import {
  buildHouseholdScheduledPlan,
  type HouseholdContentionPolicy,
  type HouseholdWorkDescriptor,
} from "./intraperiodScheduler.js";
import {
  prepareVerticalSlice2Period,
  type PreparedVerticalSlice2Period,
} from "./verticalSlice2.js";
import {
  prepareVerticalSlice3Period,
  type PreparedVerticalSlice3Period,
} from "./verticalSlice3.js";
import {
  prepareVerticalSlice4Period,
  type PreparedVerticalSlice4Period,
} from "./verticalSlice4.js";
import {
  assertPrimitiveRuntimeStateConsistent,
  createPrimitiveRuntimeStateStore,
  updatePrimitiveRuntimeStateStore,
  materializePrimitiveRuntimeStateStore,
  type PrimitiveRuntimeStateStore,
} from "./period.js";
import {
  assertRunContext,
  canonicalSerialize,
  createInputFingerprint,
  createRunMetadata,
  type RunContext,
  type RunMetadata,
} from "./run.js";
import type {
  VerticalSlice2Input,
  VerticalSlice2PeriodResult,
} from "./verticalSlice2.js";
import type {
  VerticalSlice3Input,
  VerticalSlice3PeriodResult,
} from "./verticalSlice3.js";
import type {
  VerticalSlice4ConstraintOutcome,
  VerticalSlice4Input,
  VerticalSlice4LiquidityShortfall,
  VerticalSlice4PeriodResult,
} from "./verticalSlice4.js";

export interface HouseholdProjectionPeriodResult {
  readonly period: Period;
  readonly statements: Statements;
  readonly cash: Money;
  readonly investmentValue: Money;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly transactions: readonly AccountingTransaction[];
  readonly constraintOutcomes: readonly (
    | ConstraintOutcome
    | VerticalSlice4ConstraintOutcome
  )[];
  readonly liquidityShortfalls: readonly (
    | LiquidityShortfall
    | VerticalSlice4LiquidityShortfall
  )[];
  readonly traceRefs: readonly CalculationTraceRef[];
  readonly cashFlow?: HouseholdCashFlowPeriodSummary;
  readonly investments?: HouseholdInvestmentPeriodSummary;
  readonly liability?: VerticalSlice4PeriodResult;
}

/** Household aggregates are deliberately distinct from standalone slice results. */
export interface HouseholdCashFlowPeriodSummary {
  readonly recurringIncomeRecognized: Money;
  readonly recurringExpenseRecognized: Money;
  readonly expenseCashSettlement: Money;
  readonly endingCash: Money;
  readonly outstandingExpenseObligations: Money;
  readonly transactions: readonly AccountingTransaction[];
  readonly constraintOutcomes: readonly ConstraintOutcome[];
  readonly liquidityShortfalls: readonly LiquidityShortfall[];
  readonly diagnostics: readonly ValidationIssue[];
  readonly traceRefs: readonly CalculationTraceRef[];
}
export interface HouseholdInvestmentPeriodSummary {
  readonly transactions: readonly AccountingTransaction[];
  readonly investmentValue: Money;
  readonly contributionPrincipal: Money;
  readonly fees: Money;
  readonly unrealizedGain: Money;
  readonly traceRefs: readonly CalculationTraceRef[];
}

/** Inward-facing structural execution contract; application compilers satisfy it without an engine-to-application dependency. */
export interface ExecutableHouseholdProjection {
  readonly executionKernel?: CompiledHouseholdKernel;
  readonly cashFlowInput?: VerticalSlice2Input | undefined;
  readonly investmentInput?: VerticalSlice3Input | undefined;
  readonly liabilityInput?: VerticalSlice4Input | undefined;
  readonly reconciledOpeningState: AuthoritativeState;
  readonly reconciledPrimitiveState: PrimitiveRuntimeStateStore;
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly contentionPolicy?: HouseholdContentionPolicy | undefined;
  readonly scenarioBindings: unknown;
  readonly standaloneAssets?: readonly { readonly value: Money }[];
}
export interface CompiledHouseholdProjectionRunInput {
  readonly runContext: RunContext;
  readonly compiled: ExecutableHouseholdProjection;
  readonly participants?: readonly HouseholdKernelParticipant[];
}

export { compileHouseholdKernel, applyHouseholdExecutionOverlay } from "./r3/compiledHousehold.js";
export type { CompiledHouseholdKernel, HouseholdExecutionOverlay } from "./r3/compiledHousehold.js";

/** Pure period preparation for future domain participants. No central dispatch changes required. */
export interface HouseholdKernelParticipant {
  readonly id: string;
  readonly version: string;
  readonly economicInputs: unknown;
  readonly prepare: (context: RunContext, period: Period, opening: OperationState) => PreparedOperationParticipant<HouseholdOperationFacts>;
}

/** Explicit reusable boundary for repeated deterministic evaluations. */
export const runHouseholdKernel = (
  request: { readonly kernel: CompiledHouseholdKernel; readonly overlay?: HouseholdExecutionOverlay;
    readonly runContext: RunContext; readonly participants?: readonly HouseholdKernelParticipant[] },
  observer?: PerformanceObserver,
): CompiledHouseholdProjectionRunResult => {
  const kernel = request.overlay === undefined ? request.kernel : applyHouseholdExecutionOverlay(request.kernel, request.overlay);
  return runCompiledHouseholdProjection({
    runContext: request.runContext, compiled: { ...kernel.executable, executionKernel: kernel },
    ...(request.participants === undefined ? {} : { participants: request.participants }),
  }, observer);
};
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
  readonly displayInputs: {
    readonly asOf: Instant;
    readonly dataCutoff: Instant;
    readonly generatedForecastFactKind: "model_generated";
  };
}

const display = (context: RunContext) =>
  Object.freeze({
    asOf: context.asOf,
    dataCutoff: context.dataCutoff,
    generatedForecastFactKind: "model_generated" as const,
  });

const mergeEventPreparationIdentities = (
  state: AuthoritativeState,
  prepared: PreparedVerticalSlice2Period,
): AuthoritativeState => {
  const candidate = cloneAuthoritativeState(state);
  for (const entry of Object.values(prepared.eventPrimitiveTransition)) {
    if (entry.primitiveId !== "P27" && entry.primitiveId !== "P30") continue;
    const occurrence = entry.state.occurrenceId;
    if (occurrence !== undefined && !candidate.identities.generatedOccurrenceKeys.includes(occurrence))
      registerAuthoritativeIdentity(candidate.identities, "generatedOccurrenceKeys", occurrence);
  }
  return candidate;
};

type InstantExecution = {
  readonly requiredStatuses: ReadonlyMap<string, string>;
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly cashPeriods: readonly VerticalSlice2PeriodResult[];
  readonly investmentPeriods: readonly HouseholdInvestmentOperationResult[];
  readonly liabilityPeriods: readonly VerticalSlice4PeriodResult[];
  readonly additionalFacts: readonly HouseholdOperationFacts[];
};

/** Internal operation facts only; never a fabricated standalone VS3 result. */
type HouseholdInvestmentOperationResult = {
  readonly transactions: readonly AccountingTransaction[];
  readonly contributionPrincipal: Money;
  readonly fees: Money;
  readonly unrealizedGain: Money;
  readonly traceRefs: readonly CalculationTraceRef[];
};

type PreparedHouseholdPeriod = {
  readonly descriptors: readonly HouseholdWorkDescriptor[];
  readonly cash: PreparedVerticalSlice2Period | undefined;
  readonly investments: PreparedVerticalSlice3Period | undefined;
  readonly liabilities: PreparedVerticalSlice4Period | undefined;
  readonly operations: ReturnType<typeof indexPreparedOperations<HouseholdOperationFacts>>;
};

const contentionTrace = (
  policy: HouseholdContentionPolicy,
  at: Instant,
): CalculationTraceRef =>
  calculationTraceRef(
    calculationTraceId(
      `household:contention-policy:${policy.id}:v${policy.version}:${at}`,
    ),
  );

const resourceIds = (
  descriptors: readonly HouseholdWorkDescriptor[],
): readonly string[] =>
  [
    ...new Set(
      descriptors.flatMap((descriptor) =>
        descriptor.resourceAccesses.map((access) => String(access.accountId)),
      ),
    ),
  ].sort();

const hasSharedConsumedResource = (
  left: HouseholdWorkDescriptor,
  right: HouseholdWorkDescriptor,
): boolean =>
  left.domain !== right.domain &&
  left.resourceAccesses.some((access) =>
    right.resourceAccesses.some(
      (other) =>
        access.accountId === other.accountId &&
        (access.mode === "consume" || other.mode === "consume"),
    ),
  );

const edgeExists = (
  edges: readonly { readonly before: string; readonly after: string }[],
  before: string,
  after: string,
): boolean =>
  edges.some((edge) => edge.before === before && edge.after === after);

const reaches = (
  edges: readonly { readonly before: string; readonly after: string }[],
  from: string,
  to: string,
): boolean => {
  const next = new Map<string, string[]>();
  for (const edge of edges)
    next.set(edge.before, [...(next.get(edge.before) ?? []), edge.after]);
  const pending = [...(next.get(from) ?? [])];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...(next.get(current) ?? []));
  }
  return false;
};

const policyPrecedes = (
  policy: HouseholdContentionPolicy,
  before: HouseholdWorkDescriptor,
  after: HouseholdWorkDescriptor,
): boolean =>
  before.operationClass !== undefined &&
  after.operationClass !== undefined &&
  reaches(
    policy.rules.map((rule) => ({ before: rule.before, after: rule.after })),
    before.operationClass,
    after.operationClass,
  );

const outcomeSignature = (execution: InstantExecution): string =>
  canonicalSerialize({
    state: execution.state,
    primitiveState: execution.primitiveState,
    transactions: [
      ...execution.additionalFacts,
      ...execution.cashPeriods,
      ...execution.investmentPeriods,
      ...execution.liabilityPeriods,
    ]
      .flatMap((period) => period.transactions ?? [])
      .map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        date: transaction.date,
        legs: transaction.legs,
      })),
    constraints: [...execution.cashPeriods, ...execution.liabilityPeriods, ...execution.additionalFacts]
      .flatMap((period) => period.constraintOutcomes ?? [])
      .map((outcome) => outcome),
    shortfalls: [
      ...execution.additionalFacts.flatMap(facts => facts.liquidityShortfalls ?? []),
      ...execution.cashPeriods.flatMap((period) => period.liquidityShortfalls),
      ...execution.liabilityPeriods.flatMap(
        (period) => period.liquidityShortfalls,
      ),
    ] as readonly unknown[],
  });

/** The authoritative PR20 execution path: one state/runtime stream and one commit per month. */
const runCompiledHouseholdProjectionInternal = (
  request: CompiledHouseholdProjectionRunInput,
  performance: PerformanceSession,
  periodRetention?: { readonly accept: (period: HouseholdProjectionPeriodResult) => void; readonly retain: (period: Period) => boolean },
): CompiledHouseholdProjectionRunResult => {
  const { runContext } = request;
  assertRunContext(runContext);
  const source = request.compiled;
  if (String(runContext.scenarioId) !== source.scenarioIdentity)
    throw new ValidationError({
      severity: "error", code: "HOUSEHOLD_SCENARIO_MISMATCH",
      message: "Compiled scenario identity must equal the run context scenario.", entityType: "household_projection",
    });
  const reusable = source.executionKernel;
  const kernel = performance.measure("engine.compile_invariants", () => reusable === undefined || reusable.horizon.start !== runContext.simulationStart
    ? compileHouseholdKernel(source, runContext.simulationStart)
    : applyHouseholdExecutionOverlay(reusable, source));
  const compiled = kernel.executable;
  const participants = [...(request.participants ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  if (String(runContext.scenarioId) !== compiled.scenarioIdentity)
    throw new ValidationError({
      severity: "error",
      code: "HOUSEHOLD_SCENARIO_MISMATCH",
      message:
        "Compiled scenario identity must equal the run context scenario.",
      entityType: "household_projection",
    });
  const periods = kernel.horizon.periods;
  if (
    periods.length === 0 ||
    periods[periods.length - 1]!.end !== runContext.simulationEnd
  )
    throw new ValidationError({
      severity: "error",
      code: "HOUSEHOLD_HORIZON_MISMATCH",
      message: "Compiled months must exactly cover the requested horizon.",
      entityType: "household_projection",
    });
  assertAuthoritativeStateCurrency(
    compiled.reconciledOpeningState,
    runContext.baseCurrency,
  );
  let state = createIndexedExecutionState(cloneAuthoritativeState(compiled.reconciledOpeningState));
  let primitiveState = createPrimitiveRuntimeStateStore(
    compiled.reconciledPrimitiveState,
  );
  assertPrimitiveRuntimeStateConsistent(primitiveState, state);
  const requestedHorizon = Object.freeze({
    start: runContext.simulationStart,
    end: runContext.simulationEnd,
  });
  const preparePeriod = (
    period: Period,
    opening: AuthoritativeState,
    openingPrimitiveState: PrimitiveRuntimeStateStore,
  ): PreparedHouseholdPeriod => {
    const cash =
      compiled.cashFlowInput === undefined
        ? undefined
        : prepareVerticalSlice2Period(
            runContext,
            compiled.cashFlowInput,
            period,
            opening,
            openingPrimitiveState,
          );
    // VS2 preparation may establish event eligibility/runtime state; VS3 must receive the
    // complete investment input and the resulting current candidate state.
    const investmentOpening = cash?.state ?? opening;
    const investmentPrimitiveOpening =
      cash?.primitiveState ?? openingPrimitiveState;
    const investments =
      compiled.investmentInput === undefined
        ? undefined
        : prepareVerticalSlice3Period(
            runContext,
            compiled.investmentInput,
            period,
            investmentOpening,
            investmentPrimitiveOpening,
          );
    const liabilities =
      compiled.liabilityInput === undefined ||
      compiled.liabilityInput.loans.length === 0
        ? undefined
        : prepareVerticalSlice4Period(
            runContext,
            compiled.liabilityInput,
            period,
            investmentOpening,
            investmentPrimitiveOpening,
          );
    const periodContext = Object.freeze({ ...runContext, simulationStart: period.start, simulationEnd: period.end });
    const builtins = householdDomainParticipants({ cash, investments, liabilities }, compiled, periodContext, kernel);
    const additional = participants.map(participant => {
      const prepared = participant.prepare(periodContext, period, {
        state: cloneAuthoritativeState(investmentOpening),
        primitiveState: createPrimitiveRuntimeStateStore(investmentPrimitiveOpening),
      });
      if (prepared.id !== participant.id)
        throw new ValidationError({ severity: "error", code: "HOUSEHOLD_PARTICIPANT_MISMATCH",
          message: "Prepared participant identity must match its registration.", entityType: "household_projection" });
      return { id: prepared.id, operations: prepared.operations.map(operation => ({
        ...operation,
        execute: (opening: OperationState, statuses: Map<string, string>) => operation.execute({
          state: cloneAuthoritativeState(opening.state),
          primitiveState: createPrimitiveRuntimeStateStore(opening.primitiveState),
        }, statuses),
      })) };
    });
    const operations = indexPreparedOperations([...builtins, ...additional]);
    return Object.freeze({ cash, investments, liabilities, operations, descriptors: operations.descriptors });
  };
  // The executable inputs and the prepared descriptors are fingerprinted as
  // part of the run. Preparation is state-sensitive, so it belongs inside the
  // period transaction and must never fail before rollback is established.
  let runDescriptors: readonly HouseholdWorkDescriptor[] = [];
  let firstPrepared: PreparedHouseholdPeriod | undefined;
  try {
    if (periods[0] !== undefined)
      firstPrepared = performance.measure("engine.prepare", () => preparePeriod(periods[0]!, state, primitiveState));
    runDescriptors = firstPrepared?.descriptors ?? [];
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }
  const canonicalInputs = kernel.canonicalInputs;
  const fingerprint = performance.measure("engine.fingerprint", () => createInputFingerprint({
    runContext,
    openingState: state,
    primitiveState,
    model: canonicalInputs,
    executionPlan: {
      months: compiled.executionMonths,
      descriptors: canonicalDescriptorOrder(runDescriptors),
      contentionPolicy: compiled.contentionPolicy,
      ...(participants.length === 0 ? {} : { participants: participants.map(({ id, version, economicInputs }) => ({ id, version, economicInputs })) }),
    },
  }));
  const runMetadata = createRunMetadata(runContext, fingerprint);
  const committed: HouseholdProjectionPeriodResult[] = [];
  let reachedThrough: Instant | undefined;
  const diagnostics: ValidationIssue[] = [];
  for (const period of periods)
    try {
      // Domain operations return candidates; keep the previous committed authority for rollback.
      let candidateState = state;
      let candidatePrimitiveState = primitiveState;
      let liability: VerticalSlice4PeriodResult | undefined;
      const cashPeriods: VerticalSlice2PeriodResult[] = [];
      const investmentPeriods: HouseholdInvestmentOperationResult[] = [];
      const liabilityPeriods: VerticalSlice4PeriodResult[] = [];
      const prepared = period === periods[0] && firstPrepared !== undefined ? firstPrepared
        : performance.measure("engine.prepare", () => preparePeriod(period, candidateState, candidatePrimitiveState));
      const descriptors = prepared.descriptors;
      if (
        compiled.liabilityInput?.loans.some(
          (loan) => loan.paymentSchedule === undefined,
        )
      )
        throw new ValidationError({
          severity: "error",
          code: "HOUSEHOLD_INPUT_INVALID",
          message: "Every liability loan must provide a payment schedule.",
          entityType: "household_projection",
        });
      if (
        descriptors.some(
          (item) =>
            item.sequencingInstant < period.start ||
            item.sequencingInstant >= period.end,
        )
      )
        throw new ValidationError({
          severity: "error",
          code: "HOUSEHOLD_WORK_OUTSIDE_PERIOD",
          message:
            "Household work must be sequenced inside its canonical period.",
          entityType: "household_projection",
          relatedIds: descriptors
            .filter(
              (item) =>
                item.sequencingInstant < period.start ||
                item.sequencingInstant >= period.end,
            )
            .map((item) => item.id),
        });
      const scheduled = performance.measure("engine.schedule_contention", () => buildHouseholdScheduledPlan(
        descriptors,
        compiled.contentionPolicy,
      ));
      if (scheduled.status === "invalid_model")
        throw new ValidationError(scheduled.diagnostics);
      const executeAt = (
        at: Instant,
        order: readonly HouseholdWorkDescriptor[],
        opening: AuthoritativeState,
        openingPrimitiveState: PrimitiveRuntimeStateStore,
        prefix?: InstantExecution,
      ): InstantExecution => {
        let nextState = opening;
        let nextPrimitiveState = openingPrimitiveState;
        const cashResults: VerticalSlice2PeriodResult[] = [...(prefix?.cashPeriods ?? [])];
        const investmentResults: HouseholdInvestmentOperationResult[] = [...(prefix?.investmentPeriods ?? [])];
        const liabilityResults: VerticalSlice4PeriodResult[] = [...(prefix?.liabilityPeriods ?? [])];
        const additionalFacts: HouseholdOperationFacts[] = [...(prefix?.additionalFacts ?? [])];
        const requiredStatuses = new Map<string, string>(prefix?.requiredStatuses);
        for (const descriptor of order) {
          const result = prepared.operations.execute(descriptor,
            { state: nextState, primitiveState: nextPrimitiveState }, requiredStatuses);
          nextState = result.state; nextPrimitiveState = result.primitiveState;
          if (result.facts.cash !== undefined) cashResults.push(result.facts.cash);
          if (result.facts.investment !== undefined) investmentResults.push(result.facts.investment);
          if (result.facts.liability !== undefined) liabilityResults.push(result.facts.liability);
          if (result.facts.transactions !== undefined || result.facts.constraintOutcomes !== undefined ||
              result.facts.liquidityShortfalls !== undefined || result.facts.diagnostics !== undefined ||
              result.facts.traceRefs !== undefined) additionalFacts.push(result.facts);
        }
        return Object.freeze({ state: nextState, primitiveState: nextPrimitiveState, requiredStatuses,
          cashPeriods: Object.freeze(cashResults), investmentPeriods: Object.freeze(investmentResults),
          liabilityPeriods: Object.freeze(liabilityResults), additionalFacts: Object.freeze(additionalFacts) });
      };
      const instantGroups = performance.measure("engine.schedule_contention", () => indexSequencingInstants(scheduled.value.descriptors));
      const explicitEdges = scheduled.value.dependencies.map(({ before, after }) => ({ before, after }));
      const explicitReaches = indexReachability(explicitEdges);
      const additionalFacts: HouseholdOperationFacts[] = [];
      const periodTraceRefs: CalculationTraceRef[] = performance.measure("engine.trace_result", () => [
        ...(prepared.cash?.traceRefs ?? []),
        ...(prepared.investments?.traceRefs ?? []),
        ...(prepared.liabilities?.traceRefs ?? []),
      ]);
      let eventRuntimeCommitted = prepared.cash === undefined;
      for (const { at, descriptors: sameInstant } of instantGroups) {
        if (
          !eventRuntimeCommitted &&
          at >= prepared.cash!.primitiveStateFrontier
        ) {
          candidatePrimitiveState = updatePrimitiveRuntimeStateStore(candidatePrimitiveState, prepared.cash!.eventPrimitiveTransition);
          candidateState = mergeEventPreparationIdentities(candidateState, prepared.cash!);
          eventRuntimeCommitted = true;
        }
        const instantById = new Map(sameInstant.map(item => [item.id, item]));
        const contenders = sameInstant.filter((item) =>
          sameInstant.some(
            (other) =>
              item.id !== other.id &&
              hasSharedConsumedResource(item, other) &&
              !explicitReaches(item.id, other.id) &&
              !explicitReaches(other.id, item.id),
          ),
        );
        const component = (
          seed: HouseholdWorkDescriptor,
        ): readonly HouseholdWorkDescriptor[] => {
          const members = new Set([seed.id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const item of contenders)
              if (
                !members.has(item.id) &&
                [...members].some((id) =>
                  hasSharedConsumedResource(
                    item,
                    instantById.get(id)!,
                  ),
                )
              ) {
                members.add(item.id);
                changed = true;
              }
          }
          return Object.freeze(
            sameInstant.filter((item) => members.has(item.id)),
          );
        };
        const components: HouseholdWorkDescriptor[][] = [];
        const assigned = new Set<string>();
        for (const contender of contenders)
          if (!assigned.has(contender.id)) {
            const group = component(contender);
            group.forEach((item) => assigned.add(item.id));
            components.push([...group]);
          }
        const resolvedEdges = [...explicitEdges];
        for (const group of components) {
          const groupEdges = resolvedEdges.filter(
            (edge) =>
              group.some((item) => item.id === edge.before) &&
              group.some((item) => item.id === edge.after),
          );
          const groupIds = new Set(group.map(item => item.id));
          if (fundingPoolConservationProof(group.map(item => prepared.operations.commutativity(item,
            { state: candidateState, primitiveState: candidatePrimitiveState })))) {
            performance.counters({ contentionAnalyticalFundingPoolConservation: 1 });
            continue;
          }
          const remainder = sameInstant.filter(item => !groupIds.has(item.id))
            .sort((left, right) => left.id.localeCompare(right.id));
          const compare = (edges: readonly { readonly before: string; readonly after: string }[]) => {
            const counters = createReachableStateCounters();
            try {
              return compareReachableStates({ items: group, edges,
                opening: executeAt(at, [], candidateState, candidatePrimitiveState),
                advance: (prefix, item) => executeAt(at, [item], cloneAuthoritativeState(prefix.state), prefix.primitiveState, prefix),
                equivalenceKey: prefix => canonicalSerialize({
                  outcome: outcomeSignature(prefix), statuses: [...prefix.requiredStatuses].sort(([a], [b]) => a.localeCompare(b)),
                }),
                terminalSignature: prefix => outcomeSignature(executeAt(at, remainder, prefix.state, prefix.primitiveState, prefix)),
                counters,
              });
            } finally {
              performance.counters({ contentionFallbackInvocations: counters.fallbackInvocations,
                contentionDistinctStates: counters.distinctStates, contentionMergedPrefixes: counters.mergedPrefixes,
                contentionTerminalOutcomes: counters.terminalOutcomes });
              performance.counters({ contentionMaximumAmbiguousComponentSize: counters.maximumComponentSize }, "max");
            }
          };
          const alternatives = performance.measure("engine.schedule_contention", () =>
            compare(groupEdges));
          if (alternatives.differs) {
            const policy = scheduled.value.policy;
            const policyEdges =
              policy === undefined
                ? []
                : group.flatMap((before) =>
                    group
                      .filter(
                        (after) =>
                          before.id !== after.id &&
                          policyPrecedes(policy, before, after),
                      )
                      .map((after) => ({ before: before.id, after: after.id })),
                  );
            const constrained = performance.measure("engine.schedule_contention", () =>
              compare([...groupEdges, ...policyEdges]));
            if (constrained.first === undefined)
              throw new ValidationError({
                severity: "error",
                code: "HOUSEHOLD_CONTENTION_POLICY_CYCLE",
                message: `Policy ${policy?.id ?? "none"}/v${policy?.version ?? "n/a"} creates a cycle at ${at} for contenders ${group
                  .map((item) => item.id)
                  .sort()
                  .join(",")}.`,
                entityType: "household_projection",
                relatedIds: [
                  ...group.map((item) => item.id),
                  ...(policy === undefined ? [] : [policy.id]),
                ],
              });
            if (
              policy === undefined ||
              constrained.differs
            ) {
              const policyText =
                policy === undefined
                  ? "none"
                  : `${policy.id}/v${policy.version}`;
              throw new ValidationError({
                severity: "error",
                code: "HOUSEHOLD_CONTENTION_UNRESOLVED",
                message: `Material household contention at ${at}; policy=${policyText}; contenders=${group
                  .map((item) => item.id)
                  .sort()
                  .join(",")}; resources=${resourceIds(group).join(",")}`,
                entityType: "household_projection",
                relatedIds: [
                  ...group.map((item) => item.id),
                  ...resourceIds(group),
                  ...(policy === undefined ? [] : [policy.id]),
                ],
              });
            }
            for (const edge of policyEdges)
              if (!edgeExists(resolvedEdges, edge.before, edge.after))
                resolvedEdges.push({ ...edge });
            periodTraceRefs.push(contentionTrace(policy!, at));
            const chosen = constrained.first!;
            for (let index = 0; index < chosen.length - 1; index += 1)
              resolvedEdges.push({
                before: chosen[index]!.id,
                after: chosen[index + 1]!.id,
              });
          }
        }
        const finalOrder = performance.measure("engine.schedule_contention", () => firstDependencyOrder(
          sameInstant, resolvedEdges,
        ));
        if (finalOrder === undefined)
          throw new ValidationError({
            severity: "error",
            code: "HOUSEHOLD_WORK_CYCLE",
            message: `No dependency-valid ordering exists at ${at}.`,
            entityType: "household_projection",
            relatedIds: sameInstant.map((item) => item.id),
          });
        const executed = performance.measure("engine.execute", () => executeAt(
          at,
          finalOrder,
          candidateState,
          candidatePrimitiveState,
        ));
        candidateState = executed.state;
        candidatePrimitiveState = executed.primitiveState;
        cashPeriods.push(...executed.cashPeriods);
        investmentPeriods.push(...executed.investmentPeriods);
        liabilityPeriods.push(...executed.liabilityPeriods);
        additionalFacts.push(...executed.additionalFacts);
        liability = liabilityPeriods[liabilityPeriods.length - 1];
      }
      if (!eventRuntimeCommitted) {
        candidatePrimitiveState = updatePrimitiveRuntimeStateStore(candidatePrimitiveState, prepared.cash!.eventPrimitiveTransition);
        candidateState = mergeEventPreparationIdentities(candidateState, prepared.cash!);
      }
      performance.measure("engine.trace_result", () => {
      if (liabilityPeriods.length > 0) {
        const zero = Money.zero(runContext.baseCurrency);
        const rawLiabilities = liabilityPeriods.flatMap(
          (item) => item.liabilities,
        );
        const lastIndexByLoan = new Map<string, number>();
        const scheduledPrincipalByLoan = new Map<string, Money>();
        rawLiabilities.forEach((item, index) => {
          lastIndexByLoan.set(item.loanId, index);
          scheduledPrincipalByLoan.set(item.loanId,
            (scheduledPrincipalByLoan.get(item.loanId) ?? zero).plus(item.scheduledPrincipalPaid));
        });
        const consolidatedLiabilities = rawLiabilities.map((item, index) => {
          const lastForLoan = lastIndexByLoan.get(item.loanId) === index;
          if (!lastForLoan || compiled.liabilityInput === undefined)
            return item;
          const loan = kernel.liabilities?.loan(item.loanId);
          if (loan === undefined) return item;
          const opening =
            state.liabilities[loan.principalLiabilityId]?.balance ?? zero;
          const closing =
            candidateState.liabilities[loan.principalLiabilityId]?.balance ??
            zero;
          const extraPaid = opening
            .minus(closing)
            .minus(
              scheduledPrincipalByLoan.get(item.loanId) ?? zero,
            );
          return Object.freeze({
            ...item,
            endingPrincipal: closing,
            extraPrincipalPaid: extraPaid.isPositive() ? extraPaid : zero,
          });
        });
        const interestExpense = liabilityPeriods.reduce(
          (total, item) => total.plus(item.interestExpense),
          zero,
        );
        const principalIds = kernel.liabilities?.principalIds ?? [];
        const interestIds = kernel.liabilities?.interestIds ?? [];
        const principalBefore = [...principalIds].reduce(
          (total, id) => total.plus(state.liabilities[id]?.balance ?? zero),
          zero,
        );
        const principalAfter = [...principalIds].reduce(
          (total, id) =>
            total.plus(candidateState.liabilities[id]?.balance ?? zero),
          zero,
        );
        const principalReduction = principalBefore.minus(principalAfter);
        const endingPrincipal = principalAfter;
        const outstandingInterest = [...interestIds].reduce(
          (total, id) =>
            total.plus(candidateState.liabilities[id]?.balance ?? zero),
          zero,
        );
        liability = Object.freeze({
          ...liabilityPeriods[liabilityPeriods.length - 1]!,
          liabilities: Object.freeze(consolidatedLiabilities),
          interestExpense,
          principalReduction,
          endingPrincipal,
          outstandingInterest,
          transactions: Object.freeze(
            liabilityPeriods.flatMap((item) => item.transactions),
          ),
          recognitions: Object.freeze(
            liabilityPeriods.flatMap((item) => item.recognitions),
          ),
          settlementProposals: Object.freeze(
            liabilityPeriods.flatMap((item) => item.settlementProposals),
          ),
          settlements: Object.freeze(
            liabilityPeriods.flatMap((item) => item.settlements),
          ),
          effects: Object.freeze(
            liabilityPeriods.flatMap((item) => item.effects),
          ),
          constraintOutcomes: Object.freeze(
            liabilityPeriods.flatMap((item) => item.constraintOutcomes),
          ),
          liquidityShortfalls: Object.freeze(
            liabilityPeriods.flatMap((item) => item.liquidityShortfalls),
          ),
          diagnostics: Object.freeze(
            liabilityPeriods.flatMap((item) => item.diagnostics),
          ),
          traceRefs:
            mergeTraceRefs(...liabilityPeriods.map((item) => item.traceRefs)) ??
            Object.freeze([]),
        });
      }
      });
      validateAuthoritativeState(candidateState);
      assertAuthoritativeStateCurrency(candidateState, runContext.baseCurrency);
      assertPrimitiveRuntimeStateConsistent(
        candidatePrimitiveState,
        candidateState,
      );
      const transactions = performance.measure("engine.trace_result", () => Object.freeze(
        [
          ...cashPeriods.flatMap((item) => item.transactions),
          ...investmentPeriods.flatMap((item) => item.transactions),
          ...liabilityPeriods.flatMap((item) => item.transactions),
          ...additionalFacts.flatMap(facts => facts.transactions ?? []),
        ].sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.id.localeCompare(right.id),
        ),
      ));
      const statements = performance.measure("engine.statements_metrics", () => deriveStatements(
        candidateState,
        transactions,
        runContext.baseCurrency,
      ));
      const metrics = performance.measure("engine.statements_metrics", () => deriveHouseholdClosingMetrics(
        candidateState,
        runContext.baseCurrency,
        compiled.standaloneAssets,
      ));
      const periodResult: HouseholdProjectionPeriodResult = performance.measure("engine.trace_result", () => {
      const cashFlow =
        cashPeriods.length === 0
          ? undefined
          : Object.freeze({
              recurringIncomeRecognized: cashPeriods.reduce(
                (total, item) => total.plus(item.recurringIncomeRecognized),
                Money.zero(runContext.baseCurrency),
              ),
              recurringExpenseRecognized: cashPeriods.reduce(
                (total, item) => total.plus(item.recurringExpenseRecognized),
                Money.zero(runContext.baseCurrency),
              ),
              expenseCashSettlement: cashPeriods.reduce(
                (total, item) => total.plus(item.expenseCashSettlement),
                Money.zero(runContext.baseCurrency),
              ),
              endingCash: metrics.cash,
              outstandingExpenseObligations:
                cashPeriods[cashPeriods.length - 1]!
                  .outstandingExpenseObligations,
              transactions: Object.freeze(
                cashPeriods.flatMap((item) => item.transactions),
              ),
              constraintOutcomes: Object.freeze(
                cashPeriods.flatMap((item) => item.constraintOutcomes),
              ),
              liquidityShortfalls: Object.freeze(
                cashPeriods.flatMap((item) => item.liquidityShortfalls),
              ),
              diagnostics: Object.freeze(
                cashPeriods.flatMap((item) => item.diagnostics),
              ),
              traceRefs:
                mergeTraceRefs(
                  prepared.cash?.traceRefs,
                  ...cashPeriods.map((item) => item.traceRefs),
                ) ?? Object.freeze([]),
            });
      const investments =
        investmentPeriods.length === 0
          ? undefined
          : Object.freeze({
              transactions: Object.freeze(
                investmentPeriods.flatMap((item) => item.transactions),
              ),
              investmentValue: metrics.investmentValue,
              contributionPrincipal: investmentPeriods.reduce(
                (total, item) => total.plus(item.contributionPrincipal),
                Money.zero(runContext.baseCurrency),
              ),
              fees: investmentPeriods.reduce(
                (total, item) => total.plus(item.fees),
                Money.zero(runContext.baseCurrency),
              ),
              unrealizedGain: investmentPeriods.reduce(
                (total, item) => total.plus(item.unrealizedGain),
                Money.zero(runContext.baseCurrency),
              ),
              traceRefs:
                mergeTraceRefs(
                  prepared.investments?.traceRefs,
                  ...investmentPeriods.map((item) => item.traceRefs),
                ) ?? Object.freeze([]),
            });
      return Object.freeze({
        period: Object.freeze({ ...period }),
        statements,
        cash: metrics.cash,
        investmentValue: metrics.investmentValue,
        assets: metrics.totalAssets,
        liabilities: metrics.totalLiabilities,
        netWorth: metrics.netWorth,
        transactions,
        constraintOutcomes: Object.freeze([
          ...cashPeriods.flatMap((item) => item.constraintOutcomes),
          ...liabilityPeriods.flatMap((item) => item.constraintOutcomes),
          ...additionalFacts.flatMap(facts => facts.constraintOutcomes ?? []),
        ]),
        liquidityShortfalls: Object.freeze([
          ...cashPeriods.flatMap((item) => item.liquidityShortfalls),
          ...liabilityPeriods.flatMap((item) => item.liquidityShortfalls),
          ...additionalFacts.flatMap(facts => facts.liquidityShortfalls ?? []),
        ]),
        traceRefs:
          mergeTraceRefs(
            periodTraceRefs,
            ...cashPeriods.map((item) => item.traceRefs),
            ...investmentPeriods.map((item) => item.traceRefs),
            ...liabilityPeriods.map((item) => item.traceRefs),
            ...additionalFacts.map(facts => facts.traceRefs),
          ) ?? Object.freeze([]),
        ...(cashFlow === undefined ? {} : { cashFlow }),
        ...(investments === undefined ? {} : { investments }),
        ...(liability === undefined ? {} : { liability }),
      });
      });
      diagnostics.push(
        ...(prepared.cash?.diagnostics ?? []),
        ...cashPeriods.flatMap((item) => item.diagnostics),
        ...liabilityPeriods.flatMap((item) => item.diagnostics),
        ...additionalFacts.flatMap(facts => facts.diagnostics ?? []),
      );
      state = candidateState;
      primitiveState = candidatePrimitiveState;
      reachedThrough = period.end;
      periodRetention?.accept(periodResult);
      if (periodRetention === undefined || periodRetention.retain(period)) committed.push(periodResult);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      diagnostics.push(...error.issues);
      return performance.measure("engine.trace_result", () => Object.freeze({
        status: "incomplete",
        runMetadata,
        requestedHorizon,
        stoppedAt: period.start,
        ...(reachedThrough === undefined ? {} : { reachedThrough }),
        state: createAuthoritativeState(state),
        primitiveState: materializePrimitiveRuntimeStateStore(primitiveState),
        periods: Object.freeze(committed),
        diagnostics: Object.freeze(diagnostics),
        displayInputs: display(runContext),
      }));
    }
  return performance.measure("engine.trace_result", () => Object.freeze({
    status: "completed",
    runMetadata,
    requestedHorizon,
    reachedThrough: requestedHorizon.end,
    state: createAuthoritativeState(state),
    primitiveState: materializePrimitiveRuntimeStateStore(primitiveState),
    periods: Object.freeze(committed),
    diagnostics: Object.freeze(diagnostics),
    displayInputs: display(runContext),
  }));
};

export const runCompiledHouseholdProjection = (
  request: CompiledHouseholdProjectionRunInput,
  observer?: PerformanceObserver,
): CompiledHouseholdProjectionRunResult => {
  const performance = createPerformanceSession(observer);
  try {
    return runCompiledHouseholdProjectionInternal(request, performance);
  } finally {
    performance.finish();
  }
};

export interface HouseholdForecastSummaryResult extends Omit<CompiledHouseholdProjectionRunResult, "periods"> {
  readonly resultTier: "summary";
  readonly periods: readonly HouseholdForecastSummaryPeriod[];
  /** Immutable opening boundary; no per-period state snapshots are retained for replay. */
  readonly replay: { readonly kernel: CompiledHouseholdKernel; readonly runContext: RunContext };
}

/** Summary retention boundary. Financial evaluation is shared with the detailed adapter. */
export const runHouseholdForecastSummary = (
  request: { readonly kernel: CompiledHouseholdKernel; readonly overlay?: HouseholdExecutionOverlay; readonly runContext: RunContext },
  observer?: PerformanceObserver,
): HouseholdForecastSummaryResult => {
  const kernel = request.overlay === undefined ? request.kernel : applyHouseholdExecutionOverlay(request.kernel, request.overlay);
  const runContext = Object.freeze({ ...request.runContext, versions: Object.freeze({ ...request.runContext.versions }) });
  const performance = createPerformanceSession(observer);
  const summaries: HouseholdForecastSummaryPeriod[] = [];
  try {
    const result = runCompiledHouseholdProjectionInternal({
      compiled: { ...kernel.executable, executionKernel: kernel }, runContext,
    }, performance, {
      accept: period => { summaries.push(summarizeHouseholdPeriod(period)); },
      retain: () => false,
    });
    return Object.freeze({ ...result, resultTier: "summary", periods: Object.freeze(summaries),
      replay: Object.freeze({ kernel, runContext }) });
  } finally {
    performance.finish();
  }
};

/** Regenerate only the selected evidence warehouse from the immutable opening boundary. */
export const replayHouseholdForecastWindow = (
  forecast: HouseholdForecastSummaryResult,
  selectedWindow: Period,
  observer?: PerformanceObserver,
): CompiledHouseholdProjectionRunResult => {
  const { kernel, runContext } = forecast.replay;
  const selected = forecast.periods.filter(period => period.period.start >= selectedWindow.start && period.period.end <= selectedWindow.end);
  if (selectedWindow.start >= selectedWindow.end || selected.length === 0 ||
      selected[0]!.period.start !== selectedWindow.start || selected[selected.length - 1]!.period.end !== selectedWindow.end)
    throw new ValidationError({ severity: "error", code: "HOUSEHOLD_REPLAY_WINDOW_INVALID",
      message: "Replay requires an aligned window of successfully committed forecast periods.", entityType: "household_projection" });
  const performance = createPerformanceSession(observer);
  try {
    const replay = runCompiledHouseholdProjectionInternal({
      compiled: { ...kernel.executable, executionKernel: kernel }, runContext,
    }, performance, { accept: () => {}, retain: period => period.start >= selectedWindow.start && period.end <= selectedWindow.end });
    if (canonicalSerialize(replay.runMetadata) !== canonicalSerialize(forecast.runMetadata) ||
        canonicalSerialize(replay.periods.map(summarizeHouseholdPeriod)) !== canonicalSerialize(selected))
      throw new ValidationError({ severity: "error", code: "HOUSEHOLD_REPLAY_BASIS_MISMATCH",
        message: "Immutable forecast artifacts did not reproduce the displayed forecast exactly.", entityType: "household_projection" });
    return replay;
  } finally {
    performance.finish();
  }
};
