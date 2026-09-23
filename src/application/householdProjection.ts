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
import { mergeTraceRefs } from "../lineage/index.js";
import { instant } from "../time/index.js";
import { Currency, Money } from "../values/index.js";
import {
  compileHouseholdProjection,
  type CompiledHouseholdProjection,
  type HouseholdProjectionCompilerRequest,
} from "./compiler/householdProjection.js";
import type {
  InvestmentPurchaseExecutionInstruction,
  InvestmentTransferExecutionInstruction,
} from "./compiler/investments.js";
import type { LiabilityExecutionProfile } from "./compiler/liabilities.js";
import type { RetirementTerminationBinding } from "./compiler/cashFlow.js";
import type { CapabilityDiagnostic } from "./compiler/types.js";
import {
  compileExecutableScenario,
  type ExecutableScenarioIntent,
  type ScenarioExecutionScope,
} from "./compiler/scenarios.js";
import { deriveHouseholdClosingMetrics } from "../simulation/householdProjection.js";
import { positionMarketValue } from "../valuation/index.js";
import { utcMonthDifference } from "../time/index.js";
import type { HouseholdContentionPolicy } from "../simulation/intraperiodScheduler.js";

export interface PersonalHouseholdSessionExecutionConfiguration {
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly sameInstantCashFlowOrder:
    | "income_before_expense"
    | "expense_before_income";
  readonly cashFlowExecutionAccountId?: string;
  readonly investmentExecutionOwnerId: string;
  readonly investmentTransferInstructions: readonly InvestmentTransferExecutionInstruction[];
  readonly investmentPurchaseInstructions: readonly InvestmentPurchaseExecutionInstruction[];
  readonly liabilityExecutionOwnerId: string;
  readonly liabilityExecutionProfiles: readonly LiabilityExecutionProfile[];
  readonly retirementBindings: readonly RetirementTerminationBinding[];
  readonly selectedRootScenarioId?: string;
  readonly contentionPolicy?: HouseholdContentionPolicy;
}

export const createHouseholdForecastRequest = (
  configuration: PersonalHouseholdSessionExecutionConfiguration,
  runIdentity: string,
): HouseholdForecastRequest => {
  const months = utcMonthDifference(
    instant(`${configuration.simulationStart}T00:00:00.000Z`),
    instant(`${configuration.simulationEnd}T00:00:00.000Z`),
  );
  const common = {
    baseCurrency: configuration.baseCurrency,
    asOf: configuration.asOf,
    simulationStart: configuration.simulationStart,
    simulationEnd: configuration.simulationEnd,
    months,
    ...(configuration.selectedRootScenarioId === undefined
      ? {}
      : { scenarioId: configuration.selectedRootScenarioId }),
  };
  return Object.freeze({
    asOf: configuration.asOf,
    dataCutoff: configuration.dataCutoff,
    runIdentity,
    compiler: Object.freeze({
      cashFlow: Object.freeze({
        ...common,
        sameInstantCashFlowOrder: configuration.sameInstantCashFlowOrder,
        ...(configuration.cashFlowExecutionAccountId === undefined
          ? {}
          : { executionAccountId: configuration.cashFlowExecutionAccountId }),
        retirementBindings: Object.freeze([
          ...configuration.retirementBindings,
        ]),
      }),
      investments: Object.freeze({
        ...common,
        executionOwnerId: configuration.investmentExecutionOwnerId,
        transferInstructions: Object.freeze([
          ...configuration.investmentTransferInstructions,
        ]),
        purchaseInstructions: Object.freeze([
          ...configuration.investmentPurchaseInstructions,
        ]),
      }),
      liabilities: Object.freeze({
        ...common,
        executionOwnerId: configuration.liabilityExecutionOwnerId,
        executionProfiles: Object.freeze([
          ...configuration.liabilityExecutionProfiles,
        ]),
      }),
      ...(configuration.contentionPolicy === undefined
        ? {}
        : { contentionPolicy: configuration.contentionPolicy }),
    }),
  });
};

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
  readonly statementIncome: HouseholdMoneyReadModel;
  readonly statementExpenses: HouseholdMoneyReadModel;
  readonly gains: HouseholdMoneyReadModel;
  readonly operatingCashFlow: HouseholdMoneyReadModel;
  readonly investingCashFlow: HouseholdMoneyReadModel;
  readonly financingCashFlow: HouseholdMoneyReadModel;
  readonly investmentContributionPrincipal: HouseholdMoneyReadModel;
  readonly fees: HouseholdMoneyReadModel;
  readonly unrealizedGain: HouseholdMoneyReadModel;
  readonly debtBalances: readonly HouseholdDebtBalance[];
  readonly liquidityShortfalls: readonly HouseholdLiquidityShortfallReadModel[];
  readonly traceIds: readonly string[];
  readonly traceRefs: readonly CalculationTraceRef[];
}
export interface HouseholdOpeningSnapshot {
  readonly cash: HouseholdMoneyReadModel;
  readonly investmentValue: HouseholdMoneyReadModel;
  readonly standaloneAssetValue: HouseholdMoneyReadModel;
  readonly totalAssets: HouseholdMoneyReadModel;
  readonly totalLiabilities: HouseholdMoneyReadModel;
  readonly netWorth: HouseholdMoneyReadModel;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly cash: HouseholdMoneyReadModel;
  }[];
  readonly positions: readonly {
    readonly positionId: string;
    readonly accountId: string;
    readonly value: HouseholdMoneyReadModel;
  }[];
  readonly debts: readonly {
    readonly liabilityId: string;
    readonly balance: HouseholdMoneyReadModel;
  }[];
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
      readonly openingSnapshot: HouseholdOpeningSnapshot;
      readonly actualHistoryAvailable: false;
      readonly retirementMilestones: readonly {
        readonly eventId: string;
        readonly incomeId: string;
        readonly date: string;
        readonly label: string;
      }[];
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

export interface HouseholdExplanationReadModel {
  readonly traceRefs: readonly CalculationTraceRef[];
  readonly sources: readonly {
    readonly traceId: string;
    readonly objectType: string;
    readonly objectId: string;
    readonly label: string;
  }[];
  readonly assumptions: readonly {
    readonly assumptionId: string;
    readonly label: string;
    readonly category?: string;
    readonly value?: string;
    readonly unit?: string;
  }[];
  readonly events: readonly {
    readonly eventId: string;
    readonly label: string;
    readonly eventType?: string;
    readonly date?: string;
  }[];
  readonly rules: readonly {
    readonly ruleId: string;
    readonly label: string;
  }[];
  readonly unresolvedTraceIds: readonly string[];
}

const canonicalObject = (
  model: PortableModelEnvelope,
  collection: string,
  idField: string,
  id: string,
): Record<string, unknown> | undefined =>
  (model.objects[collection] ?? []).find(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      String((value as Record<string, unknown>)[idField]).toLowerCase() ===
        id.toLowerCase(),
  ) as Record<string, unknown> | undefined;
const friendlyLabel = (
  value: Record<string, unknown> | undefined,
  fallback: string,
): string => {
  if (value === undefined) return fallback;
  for (const field of ["name", "source", "category", "symbol"])
    if (typeof value[field] === "string" && value[field] !== "")
      return String(value[field]);
  const person = [value.first_name, value.last_name]
    .filter((part) => typeof part === "string" && part !== "")
    .join(" ");
  return person || fallback;
};

/** Resolves only metadata explicitly carried by the result; it does not claim causality. */
export const resolveHouseholdExplanation = (
  model: PortableModelEnvelope,
  refs: readonly CalculationTraceRef[],
): HouseholdExplanationReadModel => {
  const assumptions = new Map<
    string,
    HouseholdExplanationReadModel["assumptions"][number]
  >();
  const events = new Map<
    string,
    HouseholdExplanationReadModel["events"][number]
  >();
  const rules = new Map<
    string,
    HouseholdExplanationReadModel["rules"][number]
  >();
  const sources = new Map<
    string,
    HouseholdExplanationReadModel["sources"][number]
  >();
  const unresolved = new Set<string>();
  for (const ref of refs) {
    for (const id of ref.assumptionIds ?? []) {
      const value = canonicalObject(
        model,
        "Assumption",
        "assumption_id",
        String(id),
      );
      assumptions.set(
        String(id),
        Object.freeze({
          assumptionId: String(id),
          label: friendlyLabel(value, String(id)),
          ...(typeof value?.category === "string"
            ? { category: value.category }
            : {}),
          ...(typeof value?.value === "string" ? { value: value.value } : {}),
          ...(typeof value?.unit === "string" ? { unit: value.unit } : {}),
        }),
      );
    }
    for (const id of ref.eventIds ?? []) {
      const value = canonicalObject(model, "Event", "event_id", String(id));
      events.set(
        String(id),
        Object.freeze({
          eventId: String(id),
          label: friendlyLabel(value, String(id)),
          ...(typeof value?.event_type === "string"
            ? { eventType: value.event_type }
            : {}),
          ...(typeof value?.start_date === "string"
            ? { date: value.start_date }
            : {}),
        }),
      );
    }
    for (const id of ref.ruleIds ?? []) {
      const value = canonicalObject(
        model,
        "TaxRule",
        "tax_rule_id",
        String(id),
      );
      rules.set(
        String(id),
        Object.freeze({
          ruleId: String(id),
          label: friendlyLabel(value, String(id)),
        }),
      );
    }
    const match =
      /^compiler:canonical:(Household|Person|Account|Income|Expense|Asset|Liability|Investment|Assumption|Scenario|Event):([0-9a-f-]{36})(?::.*)?$/i.exec(
        String(ref.traceId),
      );
    if (match !== null) {
      const [, type, id] = match;
      const field = `${type!.toLowerCase()}_id`;
      const value = canonicalObject(model, type!, field, id!);
      if (value !== undefined)
        sources.set(
          String(ref.traceId),
          Object.freeze({
            traceId: String(ref.traceId),
            objectType: type!,
            objectId: id!,
            label: friendlyLabel(value, id!),
          }),
        );
      else unresolved.add(String(ref.traceId));
    } else unresolved.add(String(ref.traceId));
  }
  const ordered = <T extends { readonly [key: string]: unknown }>(
    values: Iterable<T>,
    field: keyof T,
  ) =>
    Object.freeze(
      [...values].sort((a, b) =>
        String(a[field]).localeCompare(String(b[field])),
      ),
    );
  return Object.freeze({
    traceRefs: Object.freeze([...refs]),
    sources: ordered(sources.values(), "traceId"),
    assumptions: ordered(assumptions.values(), "assumptionId"),
    events: ordered(events.values(), "eventId"),
    rules: ordered(rules.values(), "ruleId"),
    unresolvedTraceIds: Object.freeze([...unresolved].sort()),
  });
};
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
  compiled: CompiledHouseholdProjection,
  model: PortableModelEnvelope,
  currency: Money["currency"],
  asOf: string,
  dataCutoff: string,
): PersonalHouseholdForecastReadModel => {
  const opening = deriveHouseholdClosingMetrics(
    compiled.reconciledOpeningState,
    currency,
    compiled.standaloneAssets,
  );
  const openingSnapshot: HouseholdOpeningSnapshot = Object.freeze({
    cash: moneyDto(opening.cash),
    investmentValue: moneyDto(opening.investmentValue),
    standaloneAssetValue: moneyDto(opening.standaloneAssetValue),
    totalAssets: moneyDto(opening.totalAssets),
    totalLiabilities: moneyDto(opening.totalLiabilities),
    netWorth: moneyDto(opening.netWorth),
    accounts: Object.freeze(
      Object.values(compiled.reconciledOpeningState.accounts)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((account) =>
          Object.freeze({
            accountId: String(account.id),
            cash: moneyDto(account.cash),
          }),
        ),
    ),
    positions: Object.freeze(
      Object.values(compiled.reconciledOpeningState.positions)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((position) =>
          Object.freeze({
            positionId: String(position.id),
            accountId: String(position.accountId),
            value: moneyDto(positionMarketValue(position)),
          }),
        ),
    ),
    debts: Object.freeze(
      Object.values(compiled.reconciledOpeningState.liabilities)
        .filter((liability) => liability.balance.isPositive())
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((liability) =>
          Object.freeze({
            liabilityId: String(liability.id),
            balance: moneyDto(liability.balance),
          }),
        ),
    ),
  });
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
      statementIncome: moneyDto(period.statements.income),
      statementExpenses: moneyDto(period.statements.expenses),
      gains: moneyDto(period.statements.gains),
      operatingCashFlow: moneyDto(period.statements.operatingCashFlow),
      investingCashFlow: moneyDto(period.statements.investingCashFlow),
      financingCashFlow: moneyDto(period.statements.financingCashFlow),
      investmentContributionPrincipal: moneyDto(
        period.investments?.contributionPrincipal ?? Money.zero(currency),
      ),
      fees: moneyDto(period.investments?.fees ?? Money.zero(currency)),
      unrealizedGain: moneyDto(
        period.investments?.unrealizedGain ?? Money.zero(currency),
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
      traceRefs: Object.freeze([...period.traceRefs]),
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
    actualHistoryAvailable: false,
    openingSnapshot,
    retirementMilestones: Object.freeze(
      Object.entries(
        compiled.scenarioBindings.cashFlow?.retirementEvents ?? {},
      ).flatMap(([canonicalEventId, binding]) => {
        const event = (model.objects.Event ?? []).find(
          (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            !Array.isArray(candidate) &&
            String((candidate as Record<string, unknown>).event_id) ===
              canonicalEventId,
        ) as Record<string, unknown> | undefined;
        if (event === undefined) return [];
        return [Object.freeze({
          eventId: canonicalEventId,
          incomeId: binding.incomeId,
          date: binding.baselineDate,
          label:
            typeof event?.name === "string" ? event.name : canonicalEventId,
        })];
      }),
    ),
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
        compiled,
        model,
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
    readonly declaredDifference?: "major_asset_debt_addition";
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
  allowDeclaredOpeningVariant = false,
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
    (!allowDeclaredOpeningVariant && economic(left) !== economic(right))
  )
    throw new ValidationError({
      severity: "error",
      code: "HOUSEHOLD_SCENARIO_INCOMPATIBLE",
      message:
        "Compared household scenarios require identical base economics, scope, currency, execution boundaries, opening state, policy, and horizon; only scenario overlays and run identity may differ.",
      entityType: "household_projection",
    });
};

export interface MajorAssetDebtAddition {
  readonly asset: Record<string, unknown>;
  readonly liability: Record<string, unknown>;
  readonly profile: LiabilityExecutionProfile;
}

/** Compares only a declared projection-start asset and its matching fixed debt. */
export const comparePersonalHouseholdMajorAssetDebtAddition = (
  model: PortableModelEnvelope,
  request: HouseholdForecastRequest,
  addition: MajorAssetDebtAddition,
): PersonalHouseholdScenarioComparisonReadModel => {
  const assetId = String(addition.asset.asset_id ?? "");
  const liabilityId = String(addition.liability.liability_id ?? "");
  const reject = (message: string): PersonalHouseholdScenarioComparisonReadModel =>
    Object.freeze({ status: "unavailable", baselineName: "Current plan", alternatives: Object.freeze([]), diagnostics: Object.freeze([]), message });
  if (!assetId || !liabilityId || addition.profile.liabilityId !== liabilityId || String(addition.liability.collateral_id) !== assetId)
    return reject("A major asset/debt alternative requires one declared asset, one collateralized liability, and its matching execution profile.");
  if (addition.asset.acquisition_date !== undefined || addition.asset.current_value === undefined || addition.asset.liquidity_class === undefined || addition.liability.rate_type !== "fixed" || addition.liability.payment_frequency !== "monthly" || addition.liability.maturity_date !== undefined)
    return reject("The opening-state asset/debt alternative must use a static valued asset and fixed monthly debt without an independent maturity date.");
  const assets = [...(model.objects.Asset ?? []), addition.asset as never];
  const liabilities = [...(model.objects.Liability ?? []), addition.liability as never];
  const alternativeModel = Object.freeze({ ...model, objects: Object.freeze({ ...model.objects, Asset: Object.freeze(assets), Liability: Object.freeze(liabilities) }) });
  const liabilitiesRequest = request.compiler.liabilities;
  if (liabilitiesRequest === undefined) return reject("A liability execution boundary is required for the major asset/debt alternative.");
  const alternativeRequest: HouseholdForecastRequest = Object.freeze({
    ...request,
    runIdentity: `${request.runIdentity.slice(0, -1)}9`,
    compiler: Object.freeze({ ...request.compiler, liabilities: Object.freeze({ ...liabilitiesRequest, executionProfiles: Object.freeze([...liabilitiesRequest.executionProfiles, addition.profile]) }) }),
  });
  return compareMajorAssetDebtAddition({
    baseline: { name: "Current plan", model, request },
    alternatives: [{ name: "Add major asset financed by fixed debt at projection start", model: alternativeModel, request: alternativeRequest }],
  });
};

export const comparePersonalHouseholdScenarios = (
  request: PersonalHouseholdScenarioComparisonRequest,
): PersonalHouseholdScenarioComparisonReadModel => {
  return compareHouseholds(request);
};

const compareMajorAssetDebtAddition = (request: PersonalHouseholdScenarioComparisonRequest): PersonalHouseholdScenarioComparisonReadModel =>
  compareHouseholds(request, "major_asset_debt_addition");

const compareHouseholds = (
  request: PersonalHouseholdScenarioComparisonRequest,
  declaredDifference?: "major_asset_debt_addition",
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
        declaredDifference === "major_asset_debt_addition",
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
        // A trace id identifies one calculation source, not one side of a
        // comparison.  Preserve metadata carried by both executions.
        const refs =
          mergeTraceRefs(left.traceRefs, right.traceRefs) ?? Object.freeze([]);
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
          ...(declaredDifference === undefined ? {} : { declaredDifference }),
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

const intentScope = (
  intent: ExecutableScenarioIntent,
): ScenarioExecutionScope | undefined => {
  const scopes = new Set(
    intent.changes.map((change) =>
      (
        [
          "income_growth",
          "expense_inflation",
          "retirement_date",
          "expense_funding_policy",
        ] as const
      ).includes(change.kind as never)
        ? "cash_flow"
        : (
              [
                "investment_return",
                "investment_purchase",
                "fee_rule_binding",
              ] as const
            ).includes(change.kind as never)
          ? "investments"
          : "liabilities",
    ),
  );
  return scopes.size === 1 ? [...scopes][0] : undefined;
};

/** Application-owned bridge from existing scenario intents to reconciled household comparisons. */
export const comparePersonalHouseholdScenarioIntents = (
  model: PortableModelEnvelope,
  baselineRequest: HouseholdForecastRequest,
  intents: readonly ExecutableScenarioIntent[],
): PersonalHouseholdScenarioComparisonReadModel => {
  const compiled = compileHouseholdProjection(model, baselineRequest.compiler);
  const unavailable = (
    diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[],
    message: string,
  ): PersonalHouseholdScenarioComparisonReadModel =>
    Object.freeze({
      status: "unavailable",
      baselineName: "Current plan",
      alternatives: Object.freeze([]),
      diagnostics: Object.freeze([...diagnostics]),
      message,
    });
  if (compiled.status !== "compiled")
    return unavailable(
      compiled.diagnostics,
      compiled.diagnostics.map((item) => item.message).join("; "),
    );
  const selected = boundary(baselineRequest.compiler);
  if (selected === undefined)
    return unavailable([], "A household execution boundary is required.");
  const rootId = makeScenarioId(
    baselineRequest.compiler.cashFlow?.scenarioId ??
      baselineRequest.compiler.investments?.scenarioId ??
      baselineRequest.compiler.liabilities?.scenarioId ??
      compiled.value.scenarioIdentity,
  );
  const root = scenarioDefinition(
    rootId,
    selected.simulationStart,
    selected.simulationEnd,
  );
  const scenarios: ExecutableScenario[] = [root];
  for (const intent of intents) {
    const scope = intentScope(intent);
    if (scope === undefined)
      return unavailable(
        [],
        `Scenario ${intent.name} spans unsupported intent scopes.`,
      );
    const base =
      scope === "cash_flow" && compiled.value.cashFlowInput !== undefined
        ? {
            scope,
            compiled: {
              input: compiled.value.cashFlowInput,
              openingState: compiled.value.reconciledOpeningState,
              scenarioIdentity: compiled.value.scenarioIdentity,
              executionMonths: compiled.value.executionMonths,
              scenarioBindings: compiled.value.scenarioBindings.cashFlow!,
            },
          }
        : scope === "investments" &&
            compiled.value.investmentInput !== undefined
          ? {
              scope,
              compiled: {
                input: compiled.value.investmentInput,
                openingState: compiled.value.reconciledOpeningState,
                primitiveState: compiled.value.reconciledPrimitiveState,
                scenarioIdentity: compiled.value.scenarioIdentity,
                executionMonths: compiled.value.executionMonths,
                scenarioBindings: compiled.value.scenarioBindings.investments!,
              },
              compilerRequest: baselineRequest.compiler.investments,
            }
          : scope === "liabilities" &&
              compiled.value.liabilityInput !== undefined
            ? {
                scope,
                compiled: {
                  input: compiled.value.liabilityInput,
                  openingState: compiled.value.reconciledOpeningState,
                  primitiveState: compiled.value.reconciledPrimitiveState,
                  scenarioIdentity: compiled.value.scenarioIdentity,
                  executionMonths: compiled.value.executionMonths,
                  inactiveLiabilityIds: Object.freeze([]),
                  capabilityDiagnostics: Object.freeze([]),
                  scenarioBindings:
                    compiled.value.scenarioBindings.liabilities!,
                },
                compilerRequest: baselineRequest.compiler.liabilities,
              }
            : undefined;
    if (base === undefined)
      return unavailable(
        [],
        `Scenario ${intent.name} targets an unauthored household domain.`,
      );
    const boundIntent =
      intent.baseScenarioId === undefined
        ? { ...intent, baseScenarioId: rootId }
        : intent;
    const result = compileExecutableScenario(
      model,
      base as never,
      {
        start: `${selected.simulationStart}T00:00:00.000Z`,
        end: `${selected.simulationEnd}T00:00:00.000Z`,
      },
      boundIntent,
    );
    if (result.status !== "compiled")
      return unavailable(
        result.diagnostics,
        result.diagnostics.map((item) => item.message).join("; "),
      );
    scenarios.push(result.value);
  }
  return comparePersonalHouseholdScenarios({
    scenarios: Object.freeze(scenarios),
    baselineScenarioId: rootId,
    baseline: { name: "Current plan", model, request: baselineRequest },
    alternatives: Object.freeze(
      intents.map((intent, index) => ({
        name: intent.name,
        model,
        request: {
          ...baselineRequest,
          runIdentity: `${baselineRequest.runIdentity.slice(0, -12)}${String(index + 31).padStart(12, "0")}`,
        },
        scenarioId: makeScenarioId(intent.scenarioId),
      })),
    ),
  });
};
