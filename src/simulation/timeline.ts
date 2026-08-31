import { ValidationError, failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import {
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  type AuthoritativeState,
} from "../state/index.js";
import { period, type Period } from "../time/index.js";
import {
  completedRunResult,
  createInputFingerprint,
  createRunMetadata,
  incompleteRunResult,
  invalidModelRunResult,
  type RunContext,
  type SimulationRunResult,
  assertRunContext,
} from "./run.js";
import {
  createPrimitiveRuntimeStateStore,
  assertPeriodWorkPlan,
  assertPrimitiveRuntimeStateConsistent,
  runPeriod,
  type CommittedPeriodResult,
  type PeriodWork,
  type PrimitiveRuntimeStateStore,
} from "./period.js";

export interface TimelinePeriodPlan {
  readonly period: Period;
  readonly work: readonly PeriodWork[];
}

export interface RunTimelineInput {
  readonly runContext: RunContext;
  readonly openingState: AuthoritativeState;
  readonly primitiveState?: PrimitiveRuntimeStateStore;
  readonly periods: readonly TimelinePeriodPlan[];
  readonly model?: unknown;
  readonly scenario?: unknown;
  readonly assumptions?: unknown;
  readonly policyInputs?: unknown;
}

export type TimelineRunResult = SimulationRunResult<CommittedPeriodResult>;

const invalidPlan = (message: string, fieldPath = "periods"): never => failValidation({
  severity: "error",
  code: issueCodes.timelinePeriodPlanInvalid,
  message,
  entityType: "timeline",
  fieldPath,
});

export const assertTimelinePeriodPlan = (
  plans: readonly TimelinePeriodPlan[],
  runContext: RunContext,
): void => {
  if (plans.length === 0) invalidPlan("Timeline requires at least one period");
  if (plans[0]!.period.start !== runContext.simulationStart) invalidPlan("First period must start at simulationStart", "periods.0.period.start");
  for (let index = 0; index < plans.length; index += 1) {
    const current = plans[index]!.period;
    if (current.start >= current.end) invalidPlan(`Period ${index} must be a non-empty half-open interval`, `periods.${index}.period`);
    if (index > 0) {
      const prior = plans[index - 1]!.period;
      if (current.start < prior.start) invalidPlan(`Period ${index} is out of order`, `periods.${index}.period.start`);
      if (current.start < prior.end) invalidPlan(`Period ${index} overlaps its predecessor`, `periods.${index}.period.start`);
      if (current.start > prior.end) invalidPlan(`Gap before period ${index}`, `periods.${index}.period.start`);
    }
  }
  if (plans[plans.length - 1]!.period.end !== runContext.simulationEnd) {
    invalidPlan("Last period must end at simulationEnd", `periods.${plans.length - 1}.period.end`);
  }
  for (const plan of plans) assertPeriodWorkPlan(plan.work, plan.period, runContext);
};

const fingerprintWork = (plans: readonly TimelinePeriodPlan[]) => plans.map((plan) => ({
  period: plan.period,
  work: [...plan.work].map((item) => ({
    ...item,
    ...(item.dependsOn === undefined ? {} : { dependsOn: [...item.dependsOn].sort() }),
  })).sort((left, right) => left.id.localeCompare(right.id)),
}));

/** Executes an explicit contiguous period plan under one deterministic run envelope. */
export const runTimeline = (input: RunTimelineInput): TimelineRunResult => {
  let openingState: AuthoritativeState;
  let primitiveState: PrimitiveRuntimeStateStore;
  let requestedHorizon: Period;
  let metadata: ReturnType<typeof createRunMetadata>;
  try {
    assertRunContext(input.runContext);
    assertTimelinePeriodPlan(input.periods, input.runContext);
    openingState = cloneAuthoritativeState(input.openingState);
    assertAuthoritativeStateCurrency(openingState, input.runContext.baseCurrency);
    primitiveState = createPrimitiveRuntimeStateStore(input.primitiveState);
    assertPrimitiveRuntimeStateConsistent(primitiveState, openingState);
    requestedHorizon = period(input.runContext.simulationStart, input.runContext.simulationEnd);
    const inputFingerprint = createInputFingerprint({
      runContext: input.runContext,
      openingState,
      executionPlan: fingerprintWork(input.periods),
      model: input.model,
      scenario: input.scenario,
      assumptions: input.assumptions,
      policyInputs: input.policyInputs,
    });
    metadata = createRunMetadata(input.runContext, inputFingerprint);
  } catch (error) {
    if (error instanceof ValidationError) return invalidModelRunResult(error.issues);
    throw error;
  }

  const committed: CommittedPeriodResult[] = [];
  let committedState = openingState;
  let committedPrimitiveState = primitiveState;
  for (const plan of input.periods) {
    try {
      const result = runPeriod({
        period: plan.period,
        runContext: input.runContext,
        openingState: committedState,
        primitiveState: committedPrimitiveState,
        work: plan.work,
      });
      committed.push(result);
      committedState = result.closingState;
      committedPrimitiveState = result.primitiveState;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const reason = error.issues.find((issue): issue is ValidationIssue => issue.severity === "error");
      if (reason === undefined) throw error;
      return incompleteRunResult({
        metadata,
        requestedHorizon,
        stoppedAt: plan.period.start,
        ...(committed.length === 0 ? {} : { reachedThrough: committed[committed.length - 1]!.period.end }),
        reason,
        periods: committed,
      });
    }
  }

  return completedRunResult({
    metadata,
    requestedHorizon,
    reachedThrough: requestedHorizon.end,
    periods: committed,
  });
};
