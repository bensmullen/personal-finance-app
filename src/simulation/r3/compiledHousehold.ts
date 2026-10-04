import type { ExecutableHouseholdProjection } from "../householdExecution.js";
import { canonicalSerialize } from "../run.js";
import { cloneAuthoritativeState } from "../../state/index.js";
import { createPrimitiveRuntimeStateStore } from "../period.js";
import { utcMonthlyPeriods, type Instant, type Period } from "../../time/index.js";

const configurationSnapshots = new WeakSet<object>();

/** Copy caller configuration; structurally share only snapshots produced by this boundary. */
export const immutableConfiguration = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    if (configurationSnapshots.has(value)) return value;
    if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
      const snapshot = Array.isArray(value) ? Object.freeze(value.map(immutableConfiguration))
        : Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableConfiguration(item)])));
      configurationSnapshots.add(snapshot);
      return snapshot as T;
    }
  }
  return value;
};

interface CashSchedule {
  readonly id: string;
  readonly recurrence: unknown;
  readonly primitiveIds: unknown;
}

const byId = <T extends { readonly id: string }>(items: readonly T[] | undefined): readonly T[] =>
  Object.freeze([...(items ?? [])].sort((a, b) => a.id.localeCompare(b.id)));

const cashDomain = (
  input: NonNullable<ExecutableHouseholdProjection["cashFlowInput"]>,
  previous?: { readonly schedules: readonly CashSchedule[];
    readonly occurrenceInput: (id: string) => NonNullable<ExecutableHouseholdProjection["cashFlowInput"]> | undefined },
) => {
  const snapshot = immutableConfiguration(input);
  const priorSchedules = new Map(previous?.schedules.map(schedule => [schedule.id, schedule]) ?? []);
  const occurrenceInputs = new Map<string, typeof snapshot>();
  for (const stream of snapshot.incomes) {
    const prior = previous?.occurrenceInput(stream.id);
    occurrenceInputs.set(stream.id, prior !== undefined && prior.incomes[0] === stream ? Object.freeze({
      ...snapshot, incomes: prior.incomes, expenses: prior.expenses,
    }) : Object.freeze({ ...snapshot, incomes: Object.freeze([stream]), expenses: Object.freeze([]) }));
  }
  for (const stream of snapshot.expenses) {
    const prior = previous?.occurrenceInput(stream.id);
    occurrenceInputs.set(stream.id, prior !== undefined && prior.expenses[0] === stream ? Object.freeze({
      ...snapshot, incomes: prior.incomes, expenses: prior.expenses,
    }) : Object.freeze({ ...snapshot, incomes: Object.freeze([]), expenses: Object.freeze([stream]) }));
  }
  return Object.freeze({ input: snapshot,
    occurrenceInput: (id: string) => occurrenceInputs.get(id),
    schedules: Object.freeze([...snapshot.incomes, ...snapshot.expenses].map(stream => {
      const prior = priorSchedules.get(stream.id);
      return prior !== undefined && prior.recurrence === stream.recurrence && prior.primitiveIds === stream.primitiveIds
        ? prior : Object.freeze({ id: stream.id, recurrence: stream.recurrence, primitiveIds: stream.primitiveIds });
    })),
    canonical: Object.freeze({
    ...snapshot, incomes: byId(snapshot.incomes), expenses: byId(snapshot.expenses), events: byId(snapshot.events),
  }) });
};
const investmentDomain = (input: NonNullable<ExecutableHouseholdProjection["investmentInput"]>) => {
  const snapshot = immutableConfiguration(input);
  return Object.freeze({ input: snapshot, ruleBindings: snapshot.ruleCatalog,
    instructions: Object.freeze([...snapshot.transfers, ...snapshot.purchases, ...(snapshot.fees ?? [])]),
    canonical: Object.freeze({
    ...snapshot, transfers: byId(snapshot.transfers), purchases: byId(snapshot.purchases), fees: byId(snapshot.fees),
    returns: Object.freeze([...snapshot.returns].sort((a, b) => a.targetPositionId.localeCompare(b.targetPositionId))),
  }) });
};
const liabilityDomain = (input: NonNullable<ExecutableHouseholdProjection["liabilityInput"]>) => {
  const snapshot = immutableConfiguration(input);
  const loans = new Map(snapshot.loans.map(loan => [String(loan.id), loan]));
  return Object.freeze({ input: snapshot, canonical: Object.freeze({
    ...snapshot, loans: Object.freeze(byId(snapshot.loans).map(loan => Object.freeze({
      ...loan, extraPrincipalPayments: byId(loan.extraPrincipalPayments),
    }))),
  }), loan: (id: string) => loans.get(id),
    principalIds: Object.freeze([...new Set(snapshot.loans.map(loan => loan.principalLiabilityId))]),
    interestIds: Object.freeze([...new Set(snapshot.loans.map(loan => loan.interestPayableLiabilityId))]),
  });
};

export interface CompiledHouseholdKernel {
  readonly schemaVersion: "household-kernel-v1";
  readonly horizon: { readonly start: Instant; readonly months: number; readonly periods: readonly Period[] };
  readonly cash: ReturnType<typeof cashDomain> | undefined;
  readonly investments: ReturnType<typeof investmentDomain> | undefined;
  readonly liabilities: ReturnType<typeof liabilityDomain> | undefined;
  readonly executable: ExecutableHouseholdProjection;
  readonly canonicalInputs: unknown;
}

/** Domain-local replacement. Absent fields retain the corresponding invariant structure. */
export type HouseholdExecutionOverlay = Partial<ExecutableHouseholdProjection>;

const assemble = (
  executable: ExecutableHouseholdProjection,
  horizon: CompiledHouseholdKernel["horizon"],
  cash: CompiledHouseholdKernel["cash"],
  investments: CompiledHouseholdKernel["investments"],
  liabilities: CompiledHouseholdKernel["liabilities"],
): CompiledHouseholdKernel => {
  const { executionKernel: _executionKernel, ...economic } = executable;
  const snapshot = Object.freeze({
    ...economic,
    cashFlowInput: cash?.input, investmentInput: investments?.input, liabilityInput: liabilities?.input,
    scenarioBindings: immutableConfiguration(executable.scenarioBindings),
    standaloneAssets: immutableConfiguration(executable.standaloneAssets ?? []),
    ...(executable.nonInvestmentPositionIds === undefined ? {} : { nonInvestmentPositionIds: immutableConfiguration(executable.nonInvestmentPositionIds) }),
    contentionPolicy: immutableConfiguration(executable.contentionPolicy),
  });
  return Object.freeze({ schemaVersion: "household-kernel-v1", horizon, cash, investments, liabilities,
    executable: snapshot,
    canonicalInputs: Object.freeze({
      cashFlowInput: cash?.canonical, investmentInput: investments?.canonical, liabilityInput: liabilities?.canonical,
      scenarioBindings: snapshot.scenarioBindings, standaloneAssets: snapshot.standaloneAssets,
      ...(snapshot.nonInvestmentPositionIds === undefined ? {} : { nonInvestmentPositionIds: snapshot.nonInvestmentPositionIds }),
    }),
  });
};

/** Reusable engine seam. No browser, sampling, planning, or tax execution assumptions. */
export const compileHouseholdKernel = (
  executable: ExecutableHouseholdProjection, start: Instant,
): CompiledHouseholdKernel => assemble({
  ...executable,
  reconciledOpeningState: immutableConfiguration(cloneAuthoritativeState(executable.reconciledOpeningState)),
  reconciledPrimitiveState: createPrimitiveRuntimeStateStore(executable.reconciledPrimitiveState),
}, Object.freeze({ start, months: executable.executionMonths,
  periods: Object.freeze(utcMonthlyPeriods(start, executable.executionMonths).map(period => Object.freeze({ ...period }))),
}), executable.cashFlowInput === undefined ? undefined : cashDomain(executable.cashFlowInput),
executable.investmentInput === undefined ? undefined : investmentDomain(executable.investmentInput),
executable.liabilityInput === undefined ? undefined : liabilityDomain(executable.liabilityInput));

export const applyHouseholdExecutionOverlay = (
  kernel: CompiledHouseholdKernel, overlay: HouseholdExecutionOverlay,
): CompiledHouseholdKernel => {
  const next = { ...kernel.executable, ...overlay };
  if (next.cashFlowInput === kernel.cash?.input && next.investmentInput === kernel.investments?.input &&
      next.liabilityInput === kernel.liabilities?.input && next.executionMonths === kernel.horizon.months &&
      next.reconciledOpeningState === kernel.executable.reconciledOpeningState &&
      next.reconciledPrimitiveState === kernel.executable.reconciledPrimitiveState &&
      next.scenarioIdentity === kernel.executable.scenarioIdentity &&
      next.scenarioBindings === kernel.executable.scenarioBindings &&
      next.standaloneAssets === kernel.executable.standaloneAssets &&
      next.contentionPolicy === kernel.executable.contentionPolicy &&
      next.participants === kernel.executable.participants &&
      next.nonInvestmentPositionIds === kernel.executable.nonInvestmentPositionIds) return kernel;
  // A different execution length changes the horizon; unrelated domain structure still survives.
  const horizon = next.executionMonths === kernel.horizon.months ? kernel.horizon : Object.freeze({
    start: kernel.horizon.start, months: next.executionMonths,
    periods: Object.freeze(utcMonthlyPeriods(kernel.horizon.start, next.executionMonths).map(period => Object.freeze({ ...period }))),
  });
  return assemble({
    ...next,
    reconciledOpeningState: next.reconciledOpeningState === kernel.executable.reconciledOpeningState
      ? next.reconciledOpeningState : immutableConfiguration(cloneAuthoritativeState(next.reconciledOpeningState)),
    reconciledPrimitiveState: next.reconciledPrimitiveState === kernel.executable.reconciledPrimitiveState
      ? next.reconciledPrimitiveState : createPrimitiveRuntimeStateStore(next.reconciledPrimitiveState),
  }, horizon,
  next.cashFlowInput === kernel.cash?.input ? kernel.cash : next.cashFlowInput === undefined ? undefined : cashDomain(next.cashFlowInput, kernel.cash),
  next.investmentInput === kernel.investments?.input ? kernel.investments : next.investmentInput === undefined ? undefined : investmentDomain(next.investmentInput),
  next.liabilityInput === kernel.liabilities?.input ? kernel.liabilities : next.liabilityInput === undefined ? undefined : liabilityDomain(next.liabilityInput));
};

/** Serialize each member once before comparison; preserve the pre-R3 sort exactly. */
export const canonicalDescriptorOrder = <T>(items: readonly T[]): readonly T[] =>
  items.map(item => ({ item, key: canonicalSerialize(item) }))
    .sort((a, b) => a.key.localeCompare(b.key)).map(entry => entry.item);
