import type { AccountingTransaction } from "../accounting/index.js";
import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import type { ConstraintOutcome, LiquidityShortfall } from "../funding/index.js";
import { calculationTraceId, calculationTraceRef, mergeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
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

type InstantExecution = {
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly cashPeriods: readonly VerticalSlice2PeriodResult[];
  readonly investmentPeriods: readonly VerticalSlice3PeriodResult[];
  readonly liabilityPeriods: readonly VerticalSlice4PeriodResult[];
};

const contentionTrace = (policy: HouseholdContentionPolicy, at: Instant): CalculationTraceRef =>
  calculationTraceRef(calculationTraceId(`household:contention-policy:${policy.id}:v${policy.version}:${at}`));

const resourceIds = (descriptors: readonly HouseholdWorkDescriptor[]): readonly string[] =>
  [...new Set(descriptors.flatMap((descriptor) => descriptor.resourceAccesses.map((access) => String(access.accountId))))].sort();

const hasSharedConsumedResource = (left: HouseholdWorkDescriptor, right: HouseholdWorkDescriptor): boolean =>
  left.domain !== right.domain
  && left.resourceAccesses.some((access) => right.resourceAccesses.some((other) => access.accountId === other.accountId && (access.mode === "consume" || other.mode === "consume")));

const edgeExists = (edges: readonly { readonly before: string; readonly after: string }[], before: string, after: string): boolean =>
  edges.some((edge) => edge.before === before && edge.after === after);

const reaches = (edges: readonly { readonly before: string; readonly after: string }[], from: string, to: string): boolean => {
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.before, [...(next.get(edge.before) ?? []), edge.after]);
  const pending = [...(next.get(from) ?? [])]; const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current); pending.push(...(next.get(current) ?? []));
  }
  return false;
};

const policyPrecedes = (policy: HouseholdContentionPolicy, before: HouseholdWorkDescriptor, after: HouseholdWorkDescriptor): boolean =>
  before.operationClass !== undefined && after.operationClass !== undefined
  && reaches(policy.rules.map((rule) => ({ before: rule.before, after: rule.after })), before.operationClass, after.operationClass);

const linearizations = (items: readonly HouseholdWorkDescriptor[], edges: readonly { readonly before: string; readonly after: string }[]): readonly (readonly HouseholdWorkDescriptor[])[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: HouseholdWorkDescriptor[][] = [];
  const visit = (remaining: Set<string>, ordered: HouseholdWorkDescriptor[]): void => {
    if (remaining.size === 0) { result.push(ordered); return; }
    const ready = [...remaining].filter((id) => edges.filter((edge) => edge.after === id && remaining.has(edge.before)).every((edge) => !remaining.has(edge.before))).sort();
    for (const id of ready) { const next = new Set(remaining); next.delete(id); visit(next, [...ordered, byId.get(id)!]); }
  };
  visit(new Set(items.map((item) => item.id)), []);
  return Object.freeze(result.map((order) => Object.freeze(order)));
};

const outcomeSignature = (execution: InstantExecution): string => canonicalSerialize({
  state: execution.state,
  primitiveState: execution.primitiveState,
  transactions: [...execution.cashPeriods, ...execution.investmentPeriods, ...execution.liabilityPeriods].flatMap((period) => period.transactions).map((transaction) => ({ id: transaction.id, type: transaction.type, date: transaction.date, legs: transaction.legs })),
  constraints: [...execution.cashPeriods, ...execution.liabilityPeriods].flatMap((period) => period.constraintOutcomes).map((outcome) => outcome),
  shortfalls: [...execution.cashPeriods.flatMap((period) => period.liquidityShortfalls), ...execution.liabilityPeriods.flatMap((period) => period.liquidityShortfalls)] as readonly unknown[],
});

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
    const cashAt = (_at: Instant, ids: ReadonlySet<string>): VerticalSlice2Input | undefined => {
      if (compiled.cashFlowInput === undefined) return undefined;
      return { ...compiled.cashFlowInput, incomes: compiled.cashFlowInput.incomes.filter((item) => [...ids].some((id) => id.startsWith(`cash-income:${item.id}:`))), expenses: compiled.cashFlowInput.expenses.filter((item) => [...ids].some((id) => id.startsWith(`cash-expense:${item.id}:`))), events: [] };
    };
    const investmentAt = (_at: Instant, ids: ReadonlySet<string>): VerticalSlice3Input | undefined => {
      if (compiled.investmentInput === undefined) return undefined;
      return { ...compiled.investmentInput, returns: compiled.investmentInput.returns.filter((item) => [...ids].some((id) => id.startsWith(`investment-valuation:${item.targetPositionId}:`))), transfers: compiled.investmentInput.transfers.filter((item) => [...ids].some((id) => id.startsWith(`investment-transfer:${item.id}:`))), purchases: compiled.investmentInput.purchases.filter((item) => [...ids].some((id) => id.startsWith(`investment-purchase:${item.id}:`))), fees: (compiled.investmentInput.fees ?? []).filter((item) => [...ids].some((id) => id.startsWith(`investment-fee:${item.id}:`))) };
    };
    const liabilityAt = (_at: Instant, ids: ReadonlySet<string>): VerticalSlice4Input | undefined => {
      if (compiled.liabilityInput === undefined) return undefined;
      return { ...compiled.liabilityInput, loans: compiled.liabilityInput.loans.filter((item) => [...ids].some((id) => id.startsWith(`liability-required:${item.id}:`) || id.includes(`:${item.id}:`) || (item.extraPrincipalPayments ?? []).some((extra) => id.startsWith(`liability-extra:${extra.id}:`)))) };
    };
    const executeAt = (at: Instant, order: readonly HouseholdWorkDescriptor[], opening: AuthoritativeState, openingPrimitiveState: PrimitiveRuntimeStateStore): InstantExecution => {
      let nextState = cloneAuthoritativeState(opening); let nextPrimitiveState = createPrimitiveRuntimeStateStore(openingPrimitiveState);
      const cashResults: VerticalSlice2PeriodResult[] = []; const investmentResults: VerticalSlice3PeriodResult[] = []; const liabilityResults: VerticalSlice4PeriodResult[] = [];
      const periodContext = Object.freeze({ ...runContext, simulationStart: period.start, simulationEnd: period.end });
      for (const descriptor of order) {
        const ids = new Set([descriptor.id]);
        const cashInput = cashAt(at, ids);
        if (cashInput !== undefined && (cashInput.incomes.length > 0 || cashInput.expenses.length > 0)) {
          const candidate = executeVerticalSlice2PeriodCandidate({ runContext: periodContext, openingState: nextState, primitiveState: nextPrimitiveState, input: cashInput } as VerticalSlice2RunInput, period, nextState, nextPrimitiveState);
          nextState = candidate.state; nextPrimitiveState = candidate.primitiveState; cashResults.push(candidate.period);
        }
        const investmentInput = investmentAt(at, ids);
        if (investmentInput !== undefined && (investmentInput.returns.length > 0 || investmentInput.transfers.length > 0 || investmentInput.purchases.length > 0 || (investmentInput.fees?.length ?? 0) > 0)) {
          const candidate = executeVerticalSlice3PeriodCandidate({ runContext: periodContext, openingState: nextState, primitiveState: nextPrimitiveState, input: investmentInput } as VerticalSlice3RunInput, period, nextState, nextPrimitiveState);
          nextState = candidate.state; nextPrimitiveState = candidate.primitiveState; investmentResults.push(candidate.period);
        }
        const liabilityInput = liabilityAt(at, ids);
        if (liabilityInput !== undefined && liabilityInput.loans.length > 0) {
          const candidate = executeVerticalSlice4PeriodCandidate({ runContext: periodContext, openingState: nextState, primitiveState: nextPrimitiveState, input: liabilityInput } as VerticalSlice4RunInput, period, nextState, nextPrimitiveState);
          nextState = candidate.state; nextPrimitiveState = candidate.primitiveState; liabilityResults.push(candidate.period);
        }
      }
      return Object.freeze({ state: nextState, primitiveState: nextPrimitiveState, cashPeriods: Object.freeze(cashResults), investmentPeriods: Object.freeze(investmentResults), liabilityPeriods: Object.freeze(liabilityResults) });
    };
    const allAt = [...new Set(scheduled.value.descriptors.map((item) => item.sequencingInstant))].sort();
    const periodTraceRefs: CalculationTraceRef[] = [];
    for (const at of allAt) {
      const sameInstant = scheduled.value.descriptors.filter((item) => item.sequencingInstant === at);
      const explicitEdges = scheduled.value.dependencies.map((edge) => ({ before: edge.before, after: edge.after }));
      const contenders = sameInstant.filter((item) => sameInstant.some((other) => item.id !== other.id && hasSharedConsumedResource(item, other) && !reaches(explicitEdges, item.id, other.id) && !reaches(explicitEdges, other.id, item.id)));
      const component = (seed: HouseholdWorkDescriptor): readonly HouseholdWorkDescriptor[] => {
        const members = new Set([seed.id]); let changed = true;
        while (changed) { changed = false; for (const item of contenders) if (!members.has(item.id) && [...members].some((id) => hasSharedConsumedResource(item, sameInstant.find((candidate) => candidate.id === id)!))) { members.add(item.id); changed = true; } }
        return Object.freeze(sameInstant.filter((item) => members.has(item.id)));
      };
      const components: HouseholdWorkDescriptor[][] = []; const assigned = new Set<string>();
      for (const contender of contenders) if (!assigned.has(contender.id)) { const group = component(contender); group.forEach((item) => assigned.add(item.id)); components.push([...group]); }
      const resolvedEdges = [...explicitEdges];
      for (const group of components) {
        const groupEdges = resolvedEdges.filter((edge) => group.some((item) => item.id === edge.before) && group.some((item) => item.id === edge.after));
        const candidates = linearizations(group, groupEdges);
        const previews = candidates.map((candidate) => executeAt(at, [...candidate, ...sameInstant.filter((item) => !group.some((member) => member.id === item.id)).sort((left, right) => left.id.localeCompare(right.id))], candidateState, candidatePrimitiveState));
        const signatures = [...new Set(previews.map(outcomeSignature))];
        if (signatures.length > 1) {
          const policy = scheduled.value.policy;
          const policyEdges = policy === undefined ? [] : group.flatMap((before) => group.filter((after) => before.id !== after.id && policyPrecedes(policy, before, after)).map((after) => ({ before: before.id, after: after.id })));
          const constrained = linearizations(group, [...groupEdges, ...policyEdges]);
          const constrainedPreviews = constrained.map((candidate) => executeAt(at, [...candidate, ...sameInstant.filter((item) => !group.some((member) => member.id === item.id)).sort((left, right) => left.id.localeCompare(right.id))], candidateState, candidatePrimitiveState));
          if (policy === undefined || new Set(constrainedPreviews.map(outcomeSignature)).size > 1) {
            const policyText = policy === undefined ? "none" : `${policy.id}/v${policy.version}`;
            throw new ValidationError({ severity: "error", code: "HOUSEHOLD_CONTENTION_UNRESOLVED", message: `Material household contention at ${at}; policy=${policyText}; contenders=${group.map((item) => item.id).sort().join(",")}; resources=${resourceIds(group).join(",")}`, entityType: "household_projection", relatedIds: [...group.map((item) => item.id), ...resourceIds(group), ...(policy === undefined ? [] : [policy.id])] });
          }
          for (const edge of policyEdges) if (!edgeExists(resolvedEdges, edge.before, edge.after)) resolvedEdges.push({ ...edge });
          periodTraceRefs.push(contentionTrace(policy!, at));
          const chosen = constrained[0]!;
          for (let index = 0; index < chosen.length - 1; index += 1) resolvedEdges.push({ before: chosen[index]!.id, after: chosen[index + 1]!.id });
        }
      }
      const finalOrder = linearizations(sameInstant, resolvedEdges.filter((edge) => sameInstant.some((item) => item.id === edge.before) && sameInstant.some((item) => item.id === edge.after)))[0];
      if (finalOrder === undefined) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_WORK_CYCLE", message: `No dependency-valid ordering exists at ${at}.`, entityType: "household_projection", relatedIds: sameInstant.map((item) => item.id) });
      const executed = executeAt(at, finalOrder, candidateState, candidatePrimitiveState);
      candidateState = executed.state; candidatePrimitiveState = executed.primitiveState;
      cashPeriods.push(...executed.cashPeriods); investmentPeriods.push(...executed.investmentPeriods); liabilityPeriods.push(...executed.liabilityPeriods);
      cashFlow = cashPeriods[cashPeriods.length - 1]; investments = investmentPeriods[investmentPeriods.length - 1]; liability = liabilityPeriods[liabilityPeriods.length - 1];
    }
    validateAuthoritativeState(candidateState); assertAuthoritativeStateCurrency(candidateState, runContext.baseCurrency); assertPrimitiveRuntimeStateConsistent(candidatePrimitiveState, candidateState);
    const transactions = Object.freeze([...cashPeriods.flatMap((item) => item.transactions), ...investmentPeriods.flatMap((item) => item.transactions), ...liabilityPeriods.flatMap((item) => item.transactions)].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)));
    const statements = deriveStatements(candidateState, transactions, runContext.baseCurrency);
    const metrics = deriveHouseholdClosingMetrics(candidateState, runContext.baseCurrency, compiled.standaloneAssets);
    const periodResult: HouseholdProjectionPeriodResult = Object.freeze({ period: Object.freeze({ ...period }), statements, cash: metrics.cash, investmentValue: metrics.investmentValue, assets: metrics.totalAssets, liabilities: metrics.totalLiabilities, netWorth: metrics.netWorth, transactions,
      constraintOutcomes: Object.freeze([...cashPeriods.flatMap((item) => item.constraintOutcomes), ...liabilityPeriods.flatMap((item) => item.constraintOutcomes)]),
      liquidityShortfalls: Object.freeze([...cashPeriods.flatMap((item) => item.liquidityShortfalls), ...liabilityPeriods.flatMap((item) => item.liquidityShortfalls)]),
      traceRefs: mergeTraceRefs(periodTraceRefs, ...cashPeriods.map((item) => item.traceRefs), ...investmentPeriods.map((item) => item.traceRefs), ...liabilityPeriods.map((item) => item.traceRefs)) ?? Object.freeze([]),
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
