import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import type {
  LiquidityShortfall,
  AllOrNothingLiquidityShortfall,
} from "../funding/index.js";
import type { PortableModelEnvelope } from "../model/modelVersion.js";
import {
  scenarioId as makeScenarioId,
  type ScenarioId,
} from "../model/scenario.js";
import {
  applyVerticalSlice2Scenario,
  applyVerticalSlice3Scenario,
  applyVerticalSlice4Scenario,
  deriveAppliedRuleDifferences,
  deriveRelatedScenarioDifferenceIds,
  deriveScenarioConfigurationDifferences,
  resolveScenario,
  type ExecutableScenario,
  type ResolvedScenario,
  type ScenarioConfigurationDifference,
} from "../simulation/scenario.js";
import {
  runCompiledHouseholdProjection,
  type CompiledHouseholdProjectionRunResult,
  type ExecutableHouseholdProjection,
} from "../simulation/householdExecution.js";
import {
  canonicalSerialize,
  createRunContext,
  runId,
  scenarioId,
} from "../simulation/run.js";
import type { CalculationTraceRef } from "../lineage/index.js";
import { instant } from "../time/index.js";
import { Currency, Money } from "../values/index.js";
import {
  compileHouseholdProjection,
  type CompiledHouseholdProjection,
  type HouseholdProjectionCompilerRequest,
} from "./compiler/householdProjection.js";
import type { CapabilityDiagnostic } from "./compiler/types.js";

export interface HouseholdForecastRequest {
  readonly compiler: HouseholdProjectionCompilerRequest;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly runIdentity: string;
}
export interface HouseholdMoneyReadModel {
  readonly amount: string;
  readonly currency: string;
}
export interface HouseholdDebtBalance {
  readonly loanId: string;
  readonly principal: HouseholdMoneyReadModel;
  readonly outstandingInterest: HouseholdMoneyReadModel;
}
export type HouseholdLiquidityShortfallReadModel =
  | {
      readonly kind: "proposal";
      readonly origin?:
        | "cash_flow"
        | "required_debt_service"
        | "extra_principal";
      readonly proposalId: string;
      readonly claimId: string;
      readonly fundingPolicyId: string;
      readonly requestedAmount: HouseholdMoneyReadModel;
      readonly fundedAmount: HouseholdMoneyReadModel;
      readonly shortfallAmount: HouseholdMoneyReadModel;
      readonly evaluatedAt: string;
    }
  | {
      readonly kind: "all_or_nothing_group";
      readonly origin?: "required_debt_service" | "extra_principal";
      readonly constraintId: string;
      readonly proposalIds: readonly string[];
      readonly claimIds: readonly string[];
      readonly fundingPolicyId: string;
      readonly requestedAmount: HouseholdMoneyReadModel;
      readonly fundedAmount: HouseholdMoneyReadModel;
      readonly shortfallAmount: HouseholdMoneyReadModel;
      readonly evaluatedAt: string;
    };
export interface HouseholdForecastPoint {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly cash: HouseholdMoneyReadModel;
  readonly investmentValue: HouseholdMoneyReadModel;
  readonly assets: HouseholdMoneyReadModel;
  readonly totalAssets: HouseholdMoneyReadModel;
  readonly liabilities: HouseholdMoneyReadModel;
  readonly totalLiabilities: HouseholdMoneyReadModel;
  readonly netWorth: HouseholdMoneyReadModel;
  readonly debtPrincipalReduction: HouseholdMoneyReadModel;
  readonly debtBalances: readonly HouseholdDebtBalance[];
  readonly liquidityShortfalls: readonly HouseholdLiquidityShortfallReadModel[];
  readonly traceIds: readonly string[];
}
export interface HouseholdForecastBoundaries {
  readonly requestedHorizon: { readonly start: string; readonly end: string };
  readonly reachedThrough?: string;
  readonly stoppedAt?: string;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly actualForecastBoundary: string;
}
export type PersonalHouseholdForecastReadModel =
  | {
      readonly scope: "household";
      readonly status: "unavailable";
      readonly message: string;
      readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
    }
  | ({
      readonly scope: "household";
      readonly status: "completed" | "incomplete";
      readonly points: readonly HouseholdForecastPoint[];
      readonly liquidityShortfalls: readonly HouseholdLiquidityShortfallReadModel[];
      readonly debtPayoffs: readonly {
        readonly loanId: string;
        readonly scheduledAt: string;
      }[];
      readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
    } & HouseholdForecastBoundaries);

const moneyDto = (value: Money): HouseholdMoneyReadModel =>
  Object.freeze({
    amount: value.amount.toString(),
    currency: value.currency.code,
  });
const boundary = (request: HouseholdProjectionCompilerRequest) =>
  request.investments ?? request.liabilities ?? request.cashFlow;
const shortfallDto = (
  value:
    | LiquidityShortfall
    | (AllOrNothingLiquidityShortfall & {
        readonly origin?: "required_debt_service" | "extra_principal";
      }),
): HouseholdLiquidityShortfallReadModel => {
  if ("constraintId" in value)
    return Object.freeze({
      kind: "all_or_nothing_group",
      ...("origin" in value ? { origin: value.origin } : {}),
      constraintId: String(value.constraintId),
      proposalIds: Object.freeze(value.proposalIds.map(String)),
      claimIds: Object.freeze(value.claimIds.map(String)),
      fundingPolicyId: String(value.fundingPolicyId),
      requestedAmount: moneyDto(value.requestedAmount),
      fundedAmount: moneyDto(value.fundedAmount),
      shortfallAmount: moneyDto(value.shortfallAmount),
      evaluatedAt: value.evaluatedAt,
    });
  return Object.freeze({
    kind: "proposal",
    ...("origin" in value && typeof value.origin === "string"
      ? {
          origin: value.origin as
            | "cash_flow"
            | "required_debt_service"
            | "extra_principal",
        }
      : {}),
    proposalId: String(value.proposalId),
    claimId: String(value.claimId),
    fundingPolicyId: String(value.fundingPolicyId),
    requestedAmount: moneyDto(value.requestedAmount),
    fundedAmount: moneyDto(value.fundedAmount),
    shortfallAmount: moneyDto(value.shortfallAmount),
    evaluatedAt: value.evaluatedAt,
  });
};
const scenarioKinds = {
  cash: new Set([
    "income_growth",
    "expense_inflation",
    "retirement_date",
    "expense_funding_policy",
  ]),
  investments: new Set([
    "income_growth",
    "expense_inflation",
    "retirement_date",
    "expense_funding_policy",
    "investment_return",
    "investment_purchase",
    "fee_rule_binding",
  ]),
  liabilities: new Set(["loan_funding_policy", "extra_principal_payment"]),
} as const;
const filteredScenario = (
  resolved: ResolvedScenario,
  kinds: ReadonlySet<string>,
): ResolvedScenario => {
  const keep = (change: { readonly kind: string }) => kinds.has(change.kind);
  return Object.freeze({
    ...resolved,
    layers: Object.freeze(
      resolved.layers.map((layer) =>
        Object.freeze({
          ...layer,
          changes: Object.freeze(layer.changes.filter(keep)),
        }),
      ),
    ),
    effectiveChanges: Object.freeze(
      Object.fromEntries(
        Object.entries(resolved.effectiveChanges).filter(([, value]) =>
          keep(value.change),
        ),
      ),
    ),
    terminalChanges: Object.freeze(
      Object.fromEntries(
        Object.entries(resolved.terminalChanges).filter(([, value]) =>
          keep(value.change),
        ),
      ),
    ),
  });
};

const toReadModel = (
  result: CompiledHouseholdProjectionRunResult,
  currency: Money["currency"],
  asOf: string,
  dataCutoff: string,
): PersonalHouseholdForecastReadModel => {
  const paid = new Set<string>();
  const debtPayoffs: { loanId: string; scheduledAt: string }[] = [];
  const points = result.periods.map((period) => {
    const balances = period.liability?.liabilities ?? [];
    for (const item of balances) {
      const loanId = String(item.loanId);
      if (
        item.openingPrincipal.isPositive() &&
        item.endingPrincipal.isZero() &&
        item.outstandingInterest.isZero() &&
        !paid.has(loanId)
      ) {
        paid.add(loanId);
        debtPayoffs.push({ loanId, scheduledAt: item.scheduledAt });
      }
    }
    const liquidityShortfalls = Object.freeze(
      period.liquidityShortfalls.map(shortfallDto),
    );
    return Object.freeze({
      periodStart: period.period.start,
      periodEnd: period.period.end,
      cash: moneyDto(period.cash),
      investmentValue: moneyDto(period.investmentValue),
      assets: moneyDto(period.assets),
      totalAssets: moneyDto(period.assets),
      liabilities: moneyDto(period.liabilities),
      totalLiabilities: moneyDto(period.liabilities),
      netWorth: moneyDto(period.netWorth),
      debtPrincipalReduction: moneyDto(
        period.liability?.principalReduction ?? Money.zero(currency),
      ),
      debtBalances: Object.freeze(
        balances.map((item) =>
          Object.freeze({
            loanId: String(item.loanId),
            principal: moneyDto(item.endingPrincipal),
            outstandingInterest: moneyDto(item.outstandingInterest),
          }),
        ),
      ),
      liquidityShortfalls,
      traceIds: Object.freeze(
        period.traceRefs.map((ref) => ref.traceId).sort(),
      ),
    });
  });
  return Object.freeze({
    scope: "household",
    status: result.status,
    requestedHorizon: result.requestedHorizon,
    ...(result.reachedThrough === undefined
      ? {}
      : { reachedThrough: result.reachedThrough }),
    ...(result.stoppedAt === undefined ? {} : { stoppedAt: result.stoppedAt }),
    asOf,
    dataCutoff,
    simulationStart: result.requestedHorizon.start,
    simulationEnd: result.requestedHorizon.end,
    actualForecastBoundary: asOf,
    points: Object.freeze(points),
    liquidityShortfalls: Object.freeze(
      points.flatMap((point) => point.liquidityShortfalls),
    ),
    debtPayoffs: Object.freeze(debtPayoffs),
    diagnostics: Object.freeze(result.diagnostics),
  });
};

interface ExecutedHousehold {
  readonly compiled: CompiledHouseholdProjection;
  readonly executable: ExecutableHouseholdProjection;
  readonly result: CompiledHouseholdProjectionRunResult;
  readonly read: Extract<
    PersonalHouseholdForecastReadModel,
    { status: "completed" | "incomplete" }
  >;
  readonly context: ReturnType<typeof createRunContext>;
}
const execute = (
  model: PortableModelEnvelope,
  request: HouseholdForecastRequest,
  resolved?: ResolvedScenario,
): {
  readonly compiled?: CompiledHouseholdProjection;
  readonly executable?: ExecutableHouseholdProjection;
  readonly result?: CompiledHouseholdProjectionRunResult;
  readonly read: PersonalHouseholdForecastReadModel;
  readonly context?: ReturnType<typeof createRunContext>;
} => {
  try {
    const selected = boundary(request.compiler);
    if (selected === undefined)
      return {
        read: Object.freeze({
          scope: "household",
          status: "unavailable",
          message: "A household execution boundary is required.",
          diagnostics: Object.freeze([]),
        }),
      };
    const embeddedRoot =
      resolved !== undefined &&
      Array.isArray(model.objects.Scenario) &&
      model.objects.Scenario.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>).scenario_id ===
            String(resolved.rootScenarioId),
      );
    const compiler =
      resolved === undefined || !embeddedRoot
        ? request.compiler
        : Object.freeze({
            ...request.compiler,
            ...(request.compiler.cashFlow === undefined
              ? {}
              : {
                  cashFlow: {
                    ...request.compiler.cashFlow,
                    scenarioId: String(resolved.rootScenarioId),
                  },
                }),
            ...(request.compiler.investments === undefined
              ? {}
              : {
                  investments: {
                    ...request.compiler.investments,
                    scenarioId: String(resolved.rootScenarioId),
                  },
                }),
            ...(request.compiler.liabilities === undefined
              ? {}
              : {
                  liabilities: {
                    ...request.compiler.liabilities,
                    scenarioId: String(resolved.rootScenarioId),
                  },
                }),
          });
    const compiledResult = compileHouseholdProjection(model, compiler);
    if (compiledResult.status !== "compiled")
      return {
        read: Object.freeze({
          scope: "household",
          status: "unavailable",
          message: compiledResult.diagnostics
            .map((item) => item.message)
            .join("; "),
          diagnostics: compiledResult.diagnostics,
        }),
      };
    const compiled = compiledResult.value;
    const template = {
      asOf: instant(`${request.asOf}T00:00:00.000Z`),
      dataCutoff: instant(`${request.dataCutoff}T00:00:00.000Z`),
      simulationStart: instant(`${selected.simulationStart}T00:00:00.000Z`),
      simulationEnd: instant(`${selected.simulationEnd}T00:00:00.000Z`),
      baseCurrency: Currency.of(selected.baseCurrency),
    };
    const executable =
      resolved === undefined
        ? compiled
        : Object.freeze({
            ...compiled,
            cashFlowInput:
              compiled.cashFlowInput === undefined
                ? undefined
                : applyVerticalSlice2Scenario(
                    compiled.cashFlowInput,
                    filteredScenario(resolved, scenarioKinds.cash),
                    template,
                  ),
            investmentInput:
              compiled.investmentInput === undefined
                ? undefined
                : applyVerticalSlice3Scenario(
                    compiled.investmentInput,
                    filteredScenario(resolved, scenarioKinds.investments),
                    template,
                  ),
            liabilityInput:
              compiled.liabilityInput === undefined
                ? undefined
                : applyVerticalSlice4Scenario(
                    compiled.liabilityInput,
                    filteredScenario(resolved, scenarioKinds.liabilities),
                    template,
                  ),
            scenarioIdentity: String(resolved.scenario.scenarioId),
          });
    const compilerAsOf = [
      request.compiler.cashFlow?.asOf,
      request.compiler.investments?.asOf,
      request.compiler.liabilities?.asOf,
    ].filter((value): value is string => value !== undefined);
    if (compilerAsOf.some((value) => value !== request.asOf))
      throw new ValidationError({
        severity: "error",
        code: "HOUSEHOLD_AS_OF_MISMATCH",
        message:
          "Household asOf must match every participating compiler boundary.",
        entityType: "household_projection",
      });
    const context = createRunContext({
      runId: runId(request.runIdentity),
      scenarioId: scenarioId(executable.scenarioIdentity),
      ...template,
    });
    const result = runCompiledHouseholdProjection({
      runContext: context,
      compiled: executable,
    });
    return {
      compiled,
      executable,
      result,
      context,
      read: toReadModel(
        result,
        context.baseCurrency,
        context.asOf,
        context.dataCutoff,
      ),
    };
  } catch (error) {
    const diagnostics =
      error instanceof ValidationError ? error.issues : Object.freeze([]);
    return {
      read: Object.freeze({
        scope: "household",
        status: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Household forecast could not be executed.",
        diagnostics,
      }),
    };
  }
};
export const runPersonalHouseholdForecast = (
  model: PortableModelEnvelope,
  request: HouseholdForecastRequest,
): PersonalHouseholdForecastReadModel => execute(model, request).read;

export interface PersonalHouseholdScenarioComparisonRequest {
  readonly scenarios?: readonly ExecutableScenario[];
  readonly baselineScenarioId?: ScenarioId;
  readonly baseline: {
    readonly name: string;
    readonly model: PortableModelEnvelope;
    readonly request: HouseholdForecastRequest;
  };
  readonly alternatives: readonly {
    readonly name: string;
    readonly model: PortableModelEnvelope;
    readonly request: HouseholdForecastRequest;
    readonly scenarioId?: ScenarioId;
  }[];
}
export interface HouseholdMetricDelta {
  readonly cash: HouseholdMoneyReadModel;
  readonly investmentValue: HouseholdMoneyReadModel;
  readonly assets: HouseholdMoneyReadModel;
  readonly totalAssets: HouseholdMoneyReadModel;
  readonly liabilities: HouseholdMoneyReadModel;
  readonly totalLiabilities: HouseholdMoneyReadModel;
  readonly netWorth: HouseholdMoneyReadModel;
}
export interface PersonalHouseholdScenarioComparisonReadModel {
  readonly status: "completed" | "incomplete" | "unavailable";
  readonly baselineName: string;
  readonly alternatives: readonly {
    readonly name: string;
    readonly status: "completed" | "incomplete";
    readonly comparedThrough?: string;
    readonly configurationDifferences: readonly ScenarioConfigurationDifference[];
    readonly appliedRuleDifferences: {
      readonly baselineOnly: readonly string[];
      readonly alternativeOnly: readonly string[];
    };
    readonly points: readonly {
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly baseline: HouseholdForecastPoint;
      readonly alternative: HouseholdForecastPoint;
      readonly deltas: HouseholdMetricDelta;
      readonly relatedDifferenceIds: readonly string[];
      readonly traceRefs: readonly CalculationTraceRef[];
    }[];
  }[];
  readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
  readonly message?: string;
}
const scenarioDefinition = (
  id: ScenarioId,
  start: string,
  end: string,
): ExecutableScenario =>
  Object.freeze({
    scenarioId: id,
    name: String(id),
    horizon: Object.freeze({
      start: instant(`${start}T00:00:00.000Z`),
      end: instant(`${end}T00:00:00.000Z`),
    }),
    timestep: "monthly",
    enabled: true,
    stochastic: false,
    simulationCount: 1,
    changes: Object.freeze([]),
  });
const addScenario = (
  catalog: readonly ExecutableScenario[] | undefined,
  id: ScenarioId,
  start: string,
  end: string,
): readonly ExecutableScenario[] =>
  catalog === undefined
    ? Object.freeze([scenarioDefinition(id, start, end)])
    : catalog;
const commonBoundary = (
  left: ExecutedHousehold,
  right: ExecutedHousehold,
  leftRoot: ScenarioId,
  rightRoot: ScenarioId,
): void => {
  const a = left.context;
  const b = right.context;
  const household = (item: ExecutedHousehold) =>
    String(
      item.compiled.cashFlowInput?.householdId ??
        item.compiled.investmentInput?.householdId ??
        item.compiled.liabilityInput?.householdId,
    );
  const economic = (item: ExecutedHousehold) => {
    const { scenarioIdentity: _scenarioIdentity, ...base } = item.compiled;
    return canonicalSerialize(base);
  };
  if (
    String(leftRoot) !== String(rightRoot) ||
    a.baseCurrency.code !== b.baseCurrency.code ||
    a.asOf !== b.asOf ||
    a.dataCutoff !== b.dataCutoff ||
    a.simulationStart !== b.simulationStart ||
    a.simulationEnd !== b.simulationEnd ||
    household(left) !== household(right) ||
    economic(left) !== economic(right)
  )
    throw new ValidationError({
      severity: "error",
      code: "HOUSEHOLD_SCENARIO_INCOMPATIBLE",
      message:
        "Compared household scenarios require identical base economics, scope, currency, execution boundaries, opening state, policy, and horizon; only scenario overlays and run identity may differ.",
      entityType: "household_projection",
    });
};

export const comparePersonalHouseholdScenarios = (
  request: PersonalHouseholdScenarioComparisonRequest,
): PersonalHouseholdScenarioComparisonReadModel => {
  const first = boundary(request.baseline.request.compiler);
  if (first === undefined)
    return Object.freeze({
      status: "unavailable",
      baselineName: request.baseline.name,
      alternatives: Object.freeze([]),
      diagnostics: Object.freeze([]),
      message: "A household execution boundary is required.",
    });
  const baselineId =
    request.baselineScenarioId ??
    makeScenarioId(
      request.baseline.request.compiler.cashFlow?.scenarioId ??
        request.baseline.request.compiler.investments?.scenarioId ??
        request.baseline.request.compiler.liabilities?.scenarioId ??
        "f15c0000-0000-4000-8000-000000000001",
    );
  const catalog = addScenario(
    request.scenarios,
    baselineId,
    first.simulationStart,
    first.simulationEnd,
  );
  try {
    const baselineResolved = resolveScenario(catalog, baselineId);
    const baseline = execute(
      request.baseline.model,
      request.baseline.request,
      baselineResolved,
    );
    if (
      baseline.result === undefined ||
      baseline.context === undefined ||
      baseline.read.status === "unavailable"
    )
      return Object.freeze({
        status: "unavailable",
        baselineName: request.baseline.name,
        alternatives: Object.freeze([]),
        diagnostics: baseline.read.diagnostics,
        message:
          baseline.read.status === "unavailable"
            ? baseline.read.message
            : "Baseline household projection is unavailable.",
      });
    const alternatives: PersonalHouseholdScenarioComparisonReadModel["alternatives"][number][] =
      [];
    const diagnostics: (ValidationIssue | CapabilityDiagnostic)[] = [
      ...baseline.read.diagnostics,
    ];
    let overall: "completed" | "incomplete" = baseline.result.status;
    for (const item of request.alternatives) {
      const id = item.scenarioId ?? baselineId;
      const resolved = resolveScenario(catalog, id);
      const alternative = execute(item.model, item.request, resolved);
      if (
        alternative.result === undefined ||
        alternative.context === undefined ||
        alternative.read.status === "unavailable"
      )
        return Object.freeze({
          status: "unavailable",
          baselineName: request.baseline.name,
          alternatives: Object.freeze(alternatives),
          diagnostics: Object.freeze([
            ...diagnostics,
            ...alternative.read.diagnostics,
          ]),
          message:
            alternative.read.status === "unavailable"
              ? alternative.read.message
              : `Alternative ${item.name} is unavailable.`,
        });
      commonBoundary(
        baseline as ExecutedHousehold,
        alternative as ExecutedHousehold,
        baselineResolved.rootScenarioId,
        resolved.rootScenarioId,
      );
      const differences = deriveScenarioConfigurationDifferences(
        baselineResolved,
        resolved,
        (baseline as ExecutedHousehold).executable,
        (alternative as ExecutedHousehold).executable,
      );
      const count = Math.min(
        baseline.result.periods.length,
        alternative.result.periods.length,
      );
      const points = Array.from({ length: count }, (_, index) => {
        const left = baseline.result!.periods[index]!;
        const right = alternative.result!.periods[index]!;
        if (
          left.period.start !== right.period.start ||
          left.period.end !== right.period.end
        )
          throw new ValidationError({
            severity: "error",
            code: "HOUSEHOLD_SCENARIO_HORIZON_MISMATCH",
            message: "Household scenario period structures must match.",
            entityType: "household_projection",
          });
        const basePoint = (
          baseline.read as Extract<
            PersonalHouseholdForecastReadModel,
            { status: "completed" | "incomplete" }
          >
        ).points[index]!;
        const alternativePoint = (
          alternative.read as Extract<
            PersonalHouseholdForecastReadModel,
            { status: "completed" | "incomplete" }
          >
        ).points[index]!;
        const deltas = Object.freeze({
          cash: moneyDto(right.cash.minus(left.cash)),
          investmentValue: moneyDto(
            right.investmentValue.minus(left.investmentValue),
          ),
          assets: moneyDto(right.assets.minus(left.assets)),
          totalAssets: moneyDto(right.assets.minus(left.assets)),
          liabilities: moneyDto(right.liabilities.minus(left.liabilities)),
          totalLiabilities: moneyDto(right.liabilities.minus(left.liabilities)),
          netWorth: moneyDto(right.netWorth.minus(left.netWorth)),
        });
        const refs = Object.freeze(
          [
            ...new Map(
              [...left.traceRefs, ...right.traceRefs].map((ref) => [
                ref.traceId,
                ref,
              ]),
            ).values(),
          ].sort((a, b) => a.traceId.localeCompare(b.traceId)),
        );
        return Object.freeze({
          periodStart: left.period.start,
          periodEnd: left.period.end,
          baseline: basePoint,
          alternative: alternativePoint,
          deltas,
          relatedDifferenceIds: deriveRelatedScenarioDifferenceIds(
            differences,
            refs,
            Object.values(deltas).some((delta) => delta.amount !== "0"),
          ),
          traceRefs: refs,
        });
      });
      if (
        alternative.result.status === "incomplete" ||
        baseline.result.status === "incomplete"
      )
        overall = "incomplete";
      diagnostics.push(...alternative.read.diagnostics);
      const baselineRules = [
        ...new Set(
          baseline.result.periods.flatMap((period) =>
            period.traceRefs.flatMap((ref) => ref.ruleIds ?? []),
          ),
        ),
      ].sort();
      const alternativeRules = [
        ...new Set(
          alternative.result.periods.flatMap((period) =>
            period.traceRefs.flatMap((ref) => ref.ruleIds ?? []),
          ),
        ),
      ].sort();
      alternatives.push(
        Object.freeze({
          name: item.name,
          status: alternative.result.status,
          ...(points.length === 0
            ? {}
            : { comparedThrough: points[points.length - 1]!.periodEnd }),
          configurationDifferences: differences,
          appliedRuleDifferences: deriveAppliedRuleDifferences(
            baselineRules,
            alternativeRules,
          ),
          points: Object.freeze(points),
        }),
      );
    }
    return Object.freeze({
      status: overall,
      baselineName: request.baseline.name,
      alternatives: Object.freeze(alternatives),
      diagnostics: Object.freeze(diagnostics),
    });
  } catch (error) {
    const diagnostics =
      error instanceof ValidationError ? error.issues : Object.freeze([]);
    return Object.freeze({
      status: "unavailable",
      baselineName: request.baseline.name,
      alternatives: Object.freeze([]),
      diagnostics,
      message:
        error instanceof Error
          ? error.message
          : "Household scenario comparison could not be executed.",
    });
  }
};
