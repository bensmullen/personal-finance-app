import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import { cloneAuthoritativeState, validateAuthoritativeState, type AuthoritativeState } from "../state/index.js";
import type { Instant, Period } from "../time/index.js";
import { assertPrimitiveRuntimeStateConsistent, createPrimitiveRuntimeStateStore, type PrimitiveRuntimeStateStore } from "./period.js";
import { assertRunContext, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";
import { buildHouseholdScheduledPlan, type HouseholdContentionPolicy, type HouseholdPlanDependency, type HouseholdScheduledPlan, type HouseholdWorkDescriptor } from "./intraperiodScheduler.js";
import { createHouseholdProjectionFingerprint } from "./householdProjection.js";

/** Executable mechanics are intentionally separate from household descriptors. */
export type HouseholdWorkExecutor = (input: {
  readonly descriptor: HouseholdWorkDescriptor;
  readonly period: Period;
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
}) => void | { readonly primitiveState?: PrimitiveRuntimeStateStore };

export interface HouseholdPeriodPlan {
  readonly period: Period;
  readonly descriptors: readonly HouseholdWorkDescriptor[];
  readonly executors: Readonly<Record<string, HouseholdWorkExecutor>>;
}

export interface HouseholdCommittedPeriod {
  readonly period: Period;
  readonly executedWorkIds: readonly string[];
  /** Includes explicit and policy-derived precedence used for this atomic commit. */
  readonly orderingLineage: readonly HouseholdPlanDependency[];
}

export type HouseholdProjectionRunResult =
  | { readonly status: "invalid_model"; readonly diagnostics: readonly ValidationIssue[]; readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore }
  | { readonly status: "incomplete"; readonly runMetadata: RunMetadata; readonly requestedHorizon: Period; readonly stoppedAt: Instant; readonly reachedThrough?: Instant; readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly periods: readonly HouseholdCommittedPeriod[]; readonly diagnostics: readonly ValidationIssue[] }
  | { readonly status: "completed"; readonly runMetadata: RunMetadata; readonly requestedHorizon: Period; readonly reachedThrough: Instant; readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly periods: readonly HouseholdCommittedPeriod[]; readonly diagnostics: readonly ValidationIssue[] };

const invalid = (state: AuthoritativeState, primitiveState: PrimitiveRuntimeStateStore, diagnostics: readonly ValidationIssue[]): HouseholdProjectionRunResult => ({ status: "invalid_model", state, primitiveState, diagnostics: Object.freeze([...diagnostics]) });
const periodIssue = (code: string, message: string, ids: readonly string[] = []): ValidationIssue => ({ severity: "error", code, message, entityType: "household_projection", relatedIds: Object.freeze([...ids].sort()) });

const orderedAtInstant = (plan: HouseholdScheduledPlan, at: Instant): readonly HouseholdWorkDescriptor[] => {
  const remaining = new Map(plan.descriptors.filter((descriptor) => descriptor.sequencingInstant === at).map((descriptor) => [descriptor.id, descriptor]));
  const executed = new Set(plan.descriptors.filter((descriptor) => descriptor.sequencingInstant < at).map((descriptor) => descriptor.id));
  const ordered: HouseholdWorkDescriptor[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((descriptor) => plan.dependencies.filter((edge) => edge.after === descriptor.id).every((edge) => executed.has(edge.before))).sort((left, right) => left.id.localeCompare(right.id));
    if (ready.length === 0) throw new ValidationError(periodIssue("HOUSEHOLD_WORK_CYCLE", "No dependency-ready household work remains at this sequencing instant.", [...remaining.keys()]));
    for (const descriptor of ready) { remaining.delete(descriptor.id); executed.add(descriptor.id); ordered.push(descriptor); }
  }
  return Object.freeze(ordered);
};

/**
 * One RunContext, one candidate state/runtime pair per period, and one commit
 * boundary. All plans are preflighted before meaningful execution begins.
 */
export const runHouseholdProjection = (input: {
  readonly runContext: RunContext;
  readonly openingState: AuthoritativeState;
  readonly primitiveState?: PrimitiveRuntimeStateStore;
  readonly contentionPolicy?: HouseholdContentionPolicy;
  readonly periodPlans: readonly HouseholdPeriodPlan[];
  readonly scenario?: unknown;
  readonly executableInputs?: unknown;
  readonly standaloneAssets?: unknown;
}): HouseholdProjectionRunResult => {
  const openingState = cloneAuthoritativeState(input.openingState);
  const openingPrimitiveState = createPrimitiveRuntimeStateStore(input.primitiveState);
  try {
    assertRunContext(input.runContext);
    validateAuthoritativeState(openingState);
    assertPrimitiveRuntimeStateConsistent(openingPrimitiveState, openingState);
  } catch (error) {
    if (error instanceof ValidationError) return invalid(openingState, openingPrimitiveState, error.issues);
    throw error;
  }
  const sortedPlans = [...input.periodPlans].sort((left, right) => left.period.start.localeCompare(right.period.start));
  if (sortedPlans.length === 0 || sortedPlans[0]!.period.start !== input.runContext.simulationStart || sortedPlans[sortedPlans.length - 1]!.period.end !== input.runContext.simulationEnd || sortedPlans.some((plan, index) => plan.period.start >= plan.period.end || (index > 0 && sortedPlans[index - 1]!.period.end !== plan.period.start))) return invalid(openingState, openingPrimitiveState, [periodIssue("HOUSEHOLD_PERIOD_PLAN_INVALID", "Household period plans must be contiguous and exactly cover the run horizon.")]);
  const preflight: { readonly source: HouseholdPeriodPlan; readonly plan: HouseholdScheduledPlan }[] = [];
  for (const source of sortedPlans) {
    const compiled = buildHouseholdScheduledPlan(source.descriptors, input.contentionPolicy);
    if (compiled.status === "invalid_model") return invalid(openingState, openingPrimitiveState, compiled.diagnostics);
    const missing = compiled.value.descriptors.filter((descriptor) => source.executors[descriptor.id] === undefined);
    if (missing.length > 0) return invalid(openingState, openingPrimitiveState, [periodIssue("HOUSEHOLD_EXECUTOR_MISSING", "A household work descriptor has no executable mechanic.", missing.map((descriptor) => descriptor.id))]);
    preflight.push({ source, plan: compiled.value });
  }
  const requestedHorizon: Period = Object.freeze({ start: sortedPlans[0]!.period.start, end: sortedPlans[sortedPlans.length - 1]!.period.end });
  const runMetadata = createRunMetadata(input.runContext, createHouseholdProjectionFingerprint({ runContext: input.runContext, openingState, primitiveState: openingPrimitiveState, descriptors: preflight.flatMap((item) => item.plan.descriptors), ...(input.contentionPolicy === undefined ? {} : { contentionPolicy: input.contentionPolicy }), scenario: input.scenario, executableInputs: input.executableInputs, standaloneAssets: input.standaloneAssets }));
  let state = openingState; let primitiveState = openingPrimitiveState; const committed: HouseholdCommittedPeriod[] = []; const diagnostics: ValidationIssue[] = [];
  for (const { source, plan } of preflight) {
    const candidateState = cloneAuthoritativeState(state); let candidatePrimitiveState = createPrimitiveRuntimeStateStore(primitiveState); const executedWorkIds: string[] = [];
    try {
      for (const at of [...new Set(plan.descriptors.map((descriptor) => descriptor.sequencingInstant))].sort()) for (const descriptor of orderedAtInstant(plan, at)) {
        const outcome = source.executors[descriptor.id]!({ descriptor, period: source.period, state: candidateState, primitiveState: candidatePrimitiveState });
        if (outcome?.primitiveState !== undefined) candidatePrimitiveState = createPrimitiveRuntimeStateStore(outcome.primitiveState);
        executedWorkIds.push(descriptor.id);
      }
      validateAuthoritativeState(candidateState);
      candidatePrimitiveState = createPrimitiveRuntimeStateStore(candidatePrimitiveState);
      assertPrimitiveRuntimeStateConsistent(candidatePrimitiveState, candidateState);
      state = candidateState; primitiveState = candidatePrimitiveState;
      committed.push(Object.freeze({
        period: Object.freeze({ ...source.period }),
        executedWorkIds: Object.freeze(executedWorkIds),
        orderingLineage: Object.freeze(plan.dependencies.map((edge) => Object.freeze({ ...edge }))),
      }));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const issues = error.issues;
      diagnostics.push(...issues);
      return Object.freeze({ status: "incomplete", runMetadata, requestedHorizon, stoppedAt: source.period.start, ...(committed.length === 0 ? {} : { reachedThrough: committed[committed.length - 1]!.period.end }), state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics) });
    }
  }
  return Object.freeze({ status: "completed", runMetadata, requestedHorizon, reachedThrough: requestedHorizon.end, state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics) });
};
