import type { AccountingTransaction } from "../accounting/index.js";
import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
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
  createAuthoritativeIdentityRegistry,
  validateAuthoritativeState,
  type AuthoritativeState,
} from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { Money } from "../values/index.js";
import { deriveHouseholdClosingMetrics } from "./householdProjection.js";
import {
  buildHouseholdScheduledPlan,
  type HouseholdContentionPolicy,
  type HouseholdWorkDescriptor,
} from "./intraperiodScheduler.js";
import {
  executePreparedVerticalSlice2Occurrence,
  prepareVerticalSlice2Period,
  type PreparedVerticalSlice2Occurrence,
  type PreparedVerticalSlice2Period,
} from "./verticalSlice2.js";
import {
  executePreparedVerticalSlice3Operation,
  prepareVerticalSlice3Period,
  type PreparedVerticalSlice3Operation,
  type PreparedVerticalSlice3Period,
} from "./verticalSlice3.js";
import {
  executePreparedVerticalSlice4Operation,
  prepareVerticalSlice4Period,
  type PreparedVerticalSlice4Operation,
  type PreparedVerticalSlice4Period,
} from "./verticalSlice4.js";
import {
  assertPrimitiveRuntimeStateConsistent,
  createPrimitiveRuntimeStateStore,
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
  readonly cashFlowInput?: VerticalSlice2Input | undefined;
  readonly investmentInput?: VerticalSlice3Input | undefined;
  readonly liabilityInput?: VerticalSlice4Input | undefined;
  readonly reconciledOpeningState: AuthoritativeState;
  readonly reconciledPrimitiveState: PrimitiveRuntimeStateStore;
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly contentionPolicy?: HouseholdContentionPolicy;
  readonly scenarioBindings: unknown;
  readonly standaloneAssets?: readonly { readonly value: Money }[];
}
export interface CompiledHouseholdProjectionRunInput {
  readonly runContext: RunContext;
  readonly compiled: ExecutableHouseholdProjection;
}
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
): AuthoritativeState =>
  cloneAuthoritativeState({
    ...state,
    identities: createAuthoritativeIdentityRegistry({
      postedTransactionIds: [...state.identities.postedTransactionIds, ...prepared.state.identities.postedTransactionIds],
      recognitionIds: [...state.identities.recognitionIds, ...prepared.state.identities.recognitionIds],
      settlementIds: [...state.identities.settlementIds, ...prepared.state.identities.settlementIds],
      generatedOccurrenceKeys: [...state.identities.generatedOccurrenceKeys, ...prepared.state.identities.generatedOccurrenceKeys],
      externalIdempotencyKeys: [...state.identities.externalIdempotencyKeys, ...prepared.state.identities.externalIdempotencyKeys],
    }),
  });

type InstantExecution = {
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly cashPeriods: readonly VerticalSlice2PeriodResult[];
  readonly investmentPeriods: readonly HouseholdInvestmentOperationResult[];
  readonly liabilityPeriods: readonly VerticalSlice4PeriodResult[];
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

const linearizations = (
  items: readonly HouseholdWorkDescriptor[],
  edges: readonly { readonly before: string; readonly after: string }[],
): readonly (readonly HouseholdWorkDescriptor[])[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: HouseholdWorkDescriptor[][] = [];
  const visit = (
    remaining: Set<string>,
    ordered: HouseholdWorkDescriptor[],
  ): void => {
    if (remaining.size === 0) {
      result.push(ordered);
      return;
    }
    const ready = [...remaining]
      .filter((id) =>
        edges
          .filter((edge) => edge.after === id && remaining.has(edge.before))
          .every((edge) => !remaining.has(edge.before)),
      )
      .sort();
    for (const id of ready) {
      const next = new Set(remaining);
      next.delete(id);
      visit(next, [...ordered, byId.get(id)!]);
    }
  };
  visit(new Set(items.map((item) => item.id)), []);
  return Object.freeze(result.map((order) => Object.freeze(order)));
};

const outcomeSignature = (execution: InstantExecution): string =>
  canonicalSerialize({
    state: execution.state,
    primitiveState: execution.primitiveState,
    transactions: [
      ...execution.cashPeriods,
      ...execution.investmentPeriods,
      ...execution.liabilityPeriods,
    ]
      .flatMap((period) => period.transactions)
      .map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        date: transaction.date,
        legs: transaction.legs,
      })),
    constraints: [...execution.cashPeriods, ...execution.liabilityPeriods]
      .flatMap((period) => period.constraintOutcomes)
      .map((outcome) => outcome),
    shortfalls: [
      ...execution.cashPeriods.flatMap((period) => period.liquidityShortfalls),
      ...execution.liabilityPeriods.flatMap(
        (period) => period.liquidityShortfalls,
      ),
    ] as readonly unknown[],
  });

/** The authoritative PR20 execution path: one state/runtime stream and one commit per month. */
export const runCompiledHouseholdProjection = (
  request: CompiledHouseholdProjectionRunInput,
): CompiledHouseholdProjectionRunResult => {
  const { runContext, compiled } = request;
  assertRunContext(runContext);
  if (String(runContext.scenarioId) !== compiled.scenarioIdentity)
    throw new ValidationError({
      severity: "error",
      code: "HOUSEHOLD_SCENARIO_MISMATCH",
      message:
        "Compiled scenario identity must equal the run context scenario.",
      entityType: "household_projection",
    });
  const periods = utcMonthlyPeriods(
    runContext.simulationStart,
    compiled.executionMonths,
  );
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
  let state = cloneAuthoritativeState(compiled.reconciledOpeningState);
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
    return Object.freeze({
      cash,
      investments,
      liabilities,
      descriptors: Object.freeze([
        ...(cash?.descriptors ?? []),
        ...(investments?.descriptors ?? []),
        ...(liabilities?.descriptors ?? []),
      ]),
    });
  };
  // The executable inputs and the prepared descriptors are fingerprinted as
  // part of the run. Preparation is state-sensitive, so it belongs inside the
  // period transaction and must never fail before rollback is established.
  let runDescriptors: readonly HouseholdWorkDescriptor[] = [];
  try {
    if (periods[0] !== undefined)
      runDescriptors = preparePeriod(
        periods[0],
        state,
        primitiveState,
      ).descriptors;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }
  const byId = <T extends { readonly id: string }>(
    items: readonly T[] | undefined,
  ): readonly T[] =>
    Object.freeze(
      [...(items ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    );
  const canonicalInputs = {
    cashFlowInput:
      compiled.cashFlowInput === undefined
        ? undefined
        : {
            ...compiled.cashFlowInput,
            incomes: byId(compiled.cashFlowInput.incomes),
            expenses: byId(compiled.cashFlowInput.expenses),
            events: byId(compiled.cashFlowInput.events),
          },
    investmentInput:
      compiled.investmentInput === undefined
        ? undefined
        : {
            ...compiled.investmentInput,
            transfers: byId(compiled.investmentInput.transfers),
            purchases: byId(compiled.investmentInput.purchases),
            fees: byId(compiled.investmentInput.fees),
            returns: [...compiled.investmentInput.returns].sort((left, right) =>
              left.targetPositionId.localeCompare(right.targetPositionId),
            ),
          },
    liabilityInput:
      compiled.liabilityInput === undefined
        ? undefined
        : {
            ...compiled.liabilityInput,
            loans: [...compiled.liabilityInput.loans]
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((loan) => ({
                ...loan,
                extraPrincipalPayments: byId(loan.extraPrincipalPayments),
              })),
          },
    scenarioBindings: compiled.scenarioBindings,
    standaloneAssets: compiled.standaloneAssets ?? [],
  };
  const fingerprint = createInputFingerprint({
    runContext,
    openingState: state,
    primitiveState,
    model: canonicalInputs,
    executionPlan: {
      months: compiled.executionMonths,
      descriptors: [...runDescriptors].sort((left, right) =>
        canonicalSerialize(left).localeCompare(canonicalSerialize(right)),
      ),
      contentionPolicy: compiled.contentionPolicy,
    },
  });
  const runMetadata = createRunMetadata(runContext, fingerprint);
  const committed: HouseholdProjectionPeriodResult[] = [];
  const diagnostics: ValidationIssue[] = [];
  for (const period of periods)
    try {
      let candidateState = cloneAuthoritativeState(state);
      let candidatePrimitiveState =
        createPrimitiveRuntimeStateStore(primitiveState);
      let liability: VerticalSlice4PeriodResult | undefined;
      const cashPeriods: VerticalSlice2PeriodResult[] = [];
      const investmentPeriods: HouseholdInvestmentOperationResult[] = [];
      const liabilityPeriods: VerticalSlice4PeriodResult[] = [];
      const prepared = preparePeriod(
        period,
        candidateState,
        candidatePrimitiveState,
      );
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
      const scheduled = buildHouseholdScheduledPlan(
        descriptors,
        compiled.contentionPolicy,
      );
      if (scheduled.status === "invalid_model")
        throw new ValidationError(scheduled.diagnostics);
      const executeAt = (
        at: Instant,
        order: readonly HouseholdWorkDescriptor[],
        opening: AuthoritativeState,
        openingPrimitiveState: PrimitiveRuntimeStateStore,
      ): InstantExecution => {
        let nextState = cloneAuthoritativeState(opening);
        let nextPrimitiveState = createPrimitiveRuntimeStateStore(
          openingPrimitiveState,
        );
        const cashResults: VerticalSlice2PeriodResult[] = [];
        const investmentResults: HouseholdInvestmentOperationResult[] = [];
        const liabilityResults: VerticalSlice4PeriodResult[] = [];
        const periodContext = Object.freeze({
          ...runContext,
          simulationStart: period.start,
          simulationEnd: period.end,
        });
        const requiredStatuses = new Map<string, string>();
        for (const descriptor of order) {
          const occurrence = prepared.cash?.occurrences.find(
            (item) => item.descriptor.id === descriptor.id,
          );
          if (occurrence !== undefined) {
            const result = executePreparedVerticalSlice2Occurrence(
              prepared.cash!,
              occurrence,
              nextState,
              nextPrimitiveState,
              compiled.cashFlowInput!,
              periodContext,
            );
            nextState = result.state;
            nextPrimitiveState = result.primitiveState;
            cashResults.push(result.period);
            continue;
          }
          const investment = prepared.investments?.operations.find(
            (item) => item.descriptor.id === descriptor.id,
          );
          if (investment !== undefined) {
            const result = executePreparedVerticalSlice3Operation(
              prepared.investments!,
              investment,
              nextState,
              nextPrimitiveState,
              compiled.investmentInput!,
              periodContext,
            );
            nextState = result.state;
            nextPrimitiveState = result.primitiveState;
            investmentResults.push(Object.freeze({
              transactions: result.transactions,
              contributionPrincipal: result.contributionPrincipal,
              fees: result.fees,
              unrealizedGain: result.unrealizedGain,
              traceRefs: mergeTraceRefs(result.effects.flatMap((effect) => effect.traceRefs ?? [])) ?? Object.freeze([]),
            }));
            continue;
          }
          const liability = prepared.liabilities?.operations.find(
            (item) => item.descriptor.id === descriptor.id,
          );
          if (liability !== undefined) {
            if (liability.kind === "extra_principal") {
              const required = prepared.liabilities!.operations.find(
                (item) =>
                  item.kind === "required_service" &&
                  item.loan.id === liability.loan.id &&
                  item.scheduledAt === liability.scheduledAt,
              );
              if (
                required !== undefined &&
                requiredStatuses.get(required.descriptor.id) !==
                  "fully_satisfied"
              )
                continue;
            }
            const result = executePreparedVerticalSlice4Operation(
              prepared.liabilities!,
              liability,
              nextState,
              nextPrimitiveState,
              compiled.liabilityInput!,
              periodContext,
            );
            nextState = result.state;
            nextPrimitiveState = result.primitiveState;
            if (
              liability.kind === "required_service" &&
              result.period !== undefined
            ) {
              const liabilityResult = result.period.liabilities[0];
              if (liabilityResult !== undefined)
                requiredStatuses.set(
                  descriptor.id,
                  liabilityResult.scheduledFundingStatus,
                );
              liabilityResults.push(result.period);
            }
          }
        }
        return Object.freeze({
          state: nextState,
          primitiveState: nextPrimitiveState,
          cashPeriods: Object.freeze(cashResults),
          investmentPeriods: Object.freeze(investmentResults),
          liabilityPeriods: Object.freeze(liabilityResults),
        });
      };
      const allAt = [
        ...new Set(
          scheduled.value.descriptors.map((item) => item.sequencingInstant),
        ),
      ].sort();
      const periodTraceRefs: CalculationTraceRef[] = [
        ...(prepared.cash?.traceRefs ?? []),
        ...(prepared.investments?.traceRefs ?? []),
        ...(prepared.liabilities?.traceRefs ?? []),
      ];
      let eventRuntimeCommitted = prepared.cash === undefined;
      for (const at of allAt) {
        if (
          !eventRuntimeCommitted &&
          at >= prepared.cash!.primitiveStateFrontier
        ) {
          candidatePrimitiveState = createPrimitiveRuntimeStateStore(
            {
              ...candidatePrimitiveState,
              ...prepared.cash!.eventPrimitiveTransition,
            },
          );
          candidateState = mergeEventPreparationIdentities(candidateState, prepared.cash!);
          eventRuntimeCommitted = true;
        }
        const sameInstant = scheduled.value.descriptors.filter(
          (item) => item.sequencingInstant === at,
        );
        const explicitEdges = scheduled.value.dependencies.map((edge) => ({
          before: edge.before,
          after: edge.after,
        }));
        const contenders = sameInstant.filter((item) =>
          sameInstant.some(
            (other) =>
              item.id !== other.id &&
              hasSharedConsumedResource(item, other) &&
              !reaches(explicitEdges, item.id, other.id) &&
              !reaches(explicitEdges, other.id, item.id),
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
                    sameInstant.find((candidate) => candidate.id === id)!,
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
          const candidates = linearizations(group, groupEdges);
          const previews = candidates.map((candidate) =>
            executeAt(
              at,
              [
                ...candidate,
                ...sameInstant
                  .filter(
                    (item) => !group.some((member) => member.id === item.id),
                  )
                  .sort((left, right) => left.id.localeCompare(right.id)),
              ],
              candidateState,
              candidatePrimitiveState,
            ),
          );
          const signatures = [...new Set(previews.map(outcomeSignature))];
          if (signatures.length > 1) {
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
            const constrained = linearizations(group, [
              ...groupEdges,
              ...policyEdges,
            ]);
            if (constrained.length === 0)
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
            const constrainedPreviews = constrained.map((candidate) =>
              executeAt(
                at,
                [
                  ...candidate,
                  ...sameInstant
                    .filter(
                      (item) => !group.some((member) => member.id === item.id),
                    )
                    .sort((left, right) => left.id.localeCompare(right.id)),
                ],
                candidateState,
                candidatePrimitiveState,
              ),
            );
            if (
              policy === undefined ||
              new Set(constrainedPreviews.map(outcomeSignature)).size > 1
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
            const chosen = constrained[0]!;
            for (let index = 0; index < chosen.length - 1; index += 1)
              resolvedEdges.push({
                before: chosen[index]!.id,
                after: chosen[index + 1]!.id,
              });
          }
        }
        const finalOrder = linearizations(
          sameInstant,
          resolvedEdges.filter(
            (edge) =>
              sameInstant.some((item) => item.id === edge.before) &&
              sameInstant.some((item) => item.id === edge.after),
          ),
        )[0];
        if (finalOrder === undefined)
          throw new ValidationError({
            severity: "error",
            code: "HOUSEHOLD_WORK_CYCLE",
            message: `No dependency-valid ordering exists at ${at}.`,
            entityType: "household_projection",
            relatedIds: sameInstant.map((item) => item.id),
          });
        const executed = executeAt(
          at,
          finalOrder,
          candidateState,
          candidatePrimitiveState,
        );
        candidateState = executed.state;
        candidatePrimitiveState = executed.primitiveState;
        cashPeriods.push(...executed.cashPeriods);
        investmentPeriods.push(...executed.investmentPeriods);
        liabilityPeriods.push(...executed.liabilityPeriods);
        liability = liabilityPeriods[liabilityPeriods.length - 1];
      }
      if (!eventRuntimeCommitted) {
        candidatePrimitiveState = createPrimitiveRuntimeStateStore(
          {
            ...candidatePrimitiveState,
            ...prepared.cash!.eventPrimitiveTransition,
          },
        );
        candidateState = mergeEventPreparationIdentities(candidateState, prepared.cash!);
      }
      if (liabilityPeriods.length > 0) {
        const zero = Money.zero(runContext.baseCurrency);
        const rawLiabilities = liabilityPeriods.flatMap(
          (item) => item.liabilities,
        );
        const consolidatedLiabilities = rawLiabilities.map((item, index) => {
          const lastForLoan =
            rawLiabilities
              .map((candidate, candidateIndex) =>
                candidate.loanId === item.loanId ? candidateIndex : -1,
              )
              .filter((candidateIndex) => candidateIndex >= 0)
              .pop() === index;
          if (!lastForLoan || compiled.liabilityInput === undefined)
            return item;
          const loan = compiled.liabilityInput.loans.find(
            (candidate) => candidate.id === item.loanId,
          );
          if (loan === undefined) return item;
          const opening =
            state.liabilities[loan.principalLiabilityId]?.balance ?? zero;
          const closing =
            candidateState.liabilities[loan.principalLiabilityId]?.balance ??
            zero;
          const extraPaid = opening
            .minus(closing)
            .minus(
              rawLiabilities
                .filter((candidate) => candidate.loanId === item.loanId)
                .reduce(
                  (total, candidate) =>
                    total.plus(candidate.scheduledPrincipalPaid),
                  zero,
                ),
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
        const principalIds = new Set(
          compiled.liabilityInput?.loans.map(
            (loan) => loan.principalLiabilityId,
          ) ?? [],
        );
        const interestIds = new Set(
          compiled.liabilityInput?.loans.map(
            (loan) => loan.interestPayableLiabilityId,
          ) ?? [],
        );
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
      validateAuthoritativeState(candidateState);
      assertAuthoritativeStateCurrency(candidateState, runContext.baseCurrency);
      assertPrimitiveRuntimeStateConsistent(
        candidatePrimitiveState,
        candidateState,
      );
      const transactions = Object.freeze(
        [
          ...cashPeriods.flatMap((item) => item.transactions),
          ...investmentPeriods.flatMap((item) => item.transactions),
          ...liabilityPeriods.flatMap((item) => item.transactions),
        ].sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.id.localeCompare(right.id),
        ),
      );
      const statements = deriveStatements(
        candidateState,
        transactions,
        runContext.baseCurrency,
      );
      const metrics = deriveHouseholdClosingMetrics(
        candidateState,
        runContext.baseCurrency,
        compiled.standaloneAssets,
      );
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
      const periodResult: HouseholdProjectionPeriodResult = Object.freeze({
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
        ]),
        liquidityShortfalls: Object.freeze([
          ...cashPeriods.flatMap((item) => item.liquidityShortfalls),
          ...liabilityPeriods.flatMap((item) => item.liquidityShortfalls),
        ]),
        traceRefs:
          mergeTraceRefs(
            periodTraceRefs,
            ...cashPeriods.map((item) => item.traceRefs),
            ...investmentPeriods.map((item) => item.traceRefs),
            ...liabilityPeriods.map((item) => item.traceRefs),
          ) ?? Object.freeze([]),
        ...(cashFlow === undefined ? {} : { cashFlow }),
        ...(investments === undefined ? {} : { investments }),
        ...(liability === undefined ? {} : { liability }),
      });
      diagnostics.push(
        ...(prepared.cash?.diagnostics ?? []),
        ...cashPeriods.flatMap((item) => item.diagnostics),
        ...liabilityPeriods.flatMap((item) => item.diagnostics),
      );
      state = candidateState;
      primitiveState = candidatePrimitiveState;
      committed.push(periodResult);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      diagnostics.push(...error.issues);
      return Object.freeze({
        status: "incomplete",
        runMetadata,
        requestedHorizon,
        stoppedAt: period.start,
        ...(committed.length === 0
          ? {}
          : { reachedThrough: committed[committed.length - 1]!.period.end }),
        state,
        primitiveState,
        periods: Object.freeze(committed),
        diagnostics: Object.freeze(diagnostics),
        displayInputs: display(runContext),
      });
    }
  return Object.freeze({
    status: "completed",
    runMetadata,
    requestedHorizon,
    reachedThrough: requestedHorizon.end,
    state,
    primitiveState,
    periods: Object.freeze(committed),
    diagnostics: Object.freeze(diagnostics),
    displayInputs: display(runContext),
  });
};
