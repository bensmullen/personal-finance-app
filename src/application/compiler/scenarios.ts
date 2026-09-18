import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import {
  assumptionId,
  scenarioEventId,
  scenarioId,
  type ScenarioId,
} from "../../model/scenario.js";
import {
  createFundingPolicy,
  fundingPolicyId,
  type InsufficientFundsBehavior,
} from "../../funding/index.js";
import { domainId } from "../../identity/index.js";
import { instant } from "../../time/index.js";
import { DecimalAmount, Rate } from "../../values/index.js";
import { canonicalSerialize } from "../../simulation/run.js";
import type {
  ExecutableScenario,
  ScenarioChange,
  ScenarioOperation,
} from "../../simulation/scenario.js";
import type { CompiledCashFlow } from "./cashFlow.js";
import {
  compileInvestments,
  type CompiledInvestments,
  type InvestmentCompilerRequest,
  type InvestmentPurchaseExecutionInstruction,
} from "./investments.js";
import {
  compileLiabilities,
  type CompiledLiabilities,
  type ExtraPrincipalExecutionInstruction,
  type LiabilityCompilerRequest,
} from "./liabilities.js";
import {
  capability,
  canonicalId,
  issue,
  objects,
  utcDate,
  UUID,
} from "./shared.js";
import type { CompileResult } from "./types.js";

const invalid = (
  code: string,
  message: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): CompileResult<never> => ({
  status: "invalid_model",
  diagnostics: Object.freeze([
    issue(code, message, "Scenario", entityId, fieldPath, relatedIds),
  ]),
});


export type ScenarioExecutionScope =
  | "cash_flow"
  | "investments"
  | "liabilities";
export interface FundingPolicyIntent {
  readonly id: string;
  readonly orderedAccountIds: readonly string[];
  readonly allowPartial: boolean;
  readonly insufficientFundsBehavior: InsufficientFundsBehavior;
}
type RateIntent = {
  readonly annualRate: string;
  readonly assumptionId?: string;
};
export type ScenarioChangeIntent =
  | ({ readonly kind: "income_growth"; readonly incomeId: string } & RateIntent)
  | ({
      readonly kind: "expense_inflation";
      readonly expenseId: string;
    } & RateIntent)
  | ({
      readonly kind: "investment_return";
      readonly investmentId: string;
    } & RateIntent)
  | {
      readonly kind: "retirement_date";
      readonly incomeId: string;
      readonly targetEventId: string;
      readonly baselineDate: string;
      readonly newDate: string;
      readonly eventId?: string;
    }
  | {
      readonly kind: "investment_purchase";
      readonly operation: ScenarioOperation;
      readonly purchaseId: string;
      readonly investmentId?: string;
      readonly eventId?: string;
      readonly instruction?: InvestmentPurchaseExecutionInstruction;
    }
  | {
      readonly kind: "extra_principal_payment";
      readonly operation: ScenarioOperation;
      readonly liabilityId: string;
      readonly paymentId: string;
      readonly eventId?: string;
      readonly instruction?: ExtraPrincipalExecutionInstruction;
    }
  | {
      readonly kind: "expense_funding_policy";
      readonly expenseId: string;
      readonly policy: FundingPolicyIntent;
      readonly assumptionId?: string;
    }
  | {
      readonly kind: "loan_funding_policy";
      readonly liabilityId: string;
      readonly policy: FundingPolicyIntent;
      readonly assumptionId?: string;
    }
  | {
      readonly kind: "fee_rule_binding";
      readonly feeId: string;
      readonly taxRuleIds: readonly string[];
      readonly assumptionId?: string;
    };

export type ScenarioBaseCompilation =
  | { readonly scope: "cash_flow"; readonly compiled: CompiledCashFlow }
  | {
      readonly scope: "investments";
      readonly compiled: CompiledInvestments;
      readonly compilerRequest?: InvestmentCompilerRequest;
    }
  | {
      readonly scope: "liabilities";
      readonly compiled: CompiledLiabilities;
      readonly compilerRequest?: LiabilityCompilerRequest;
    };

export interface ExecutableScenarioIntent {
  readonly scenarioId: string;
  readonly name: string;
  readonly baseScenarioId?: string;
  readonly changes: readonly ScenarioChangeIntent[];
}

const intentScope = (
  kind: ScenarioChangeIntent["kind"],
): ScenarioExecutionScope =>
  (
    [
      "income_growth",
      "expense_inflation",
      "retirement_date",
      "expense_funding_policy",
    ] as const
  ).includes(kind as never)
    ? "cash_flow"
    : (
          [
            "investment_return",
            "investment_purchase",
            "fee_rule_binding",
          ] as const
        ).includes(kind as never)
      ? "investments"
      : "liabilities";

const stableUuid = (namespace: string, value: string): string => {
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const byte of new TextEncoder().encode(`${namespace}:v1:${value}`))
    for (let index = 0; index < words.length; index += 1)
      words[index] =
        Math.imul((words[index]! ^ byte) >>> 0, 0x01000193 + index * 2) >>> 0;
  const hex = words
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("")
    .split("");
  hex[12] = "4";
  hex[16] = (["8", "9", "a", "b"] as const)[Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

const bridgeUnsupported = (
  scope: ScenarioExecutionScope,
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
): CompileResult<never> => ({
  status: "unsupported",
  diagnostics: Object.freeze([
    capability(
      code,
      message,
      `${scope}_scenario_comparison`,
      entityType,
      entityId,
    ),
  ]),
});

const authoredIds = (model: PortableModelEnvelope): Set<string> =>
  new Set(
    Object.values(model.objects).flatMap((collection) =>
      collection.flatMap((entry) =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry)
          ? Object.entries(entry)
              .filter(
                ([key, value]) =>
                  key.endsWith("_id") &&
                  typeof value === "string" &&
                  UUID.test(value),
              )
              .map(([, value]) => String(value).toLowerCase())
          : [],
      ),
    ),
  );

const exact = (value: string): string => DecimalAmount.parse(value).toString();
const uuid = (value: string): string => value.toLowerCase();
const canonicalInstant = (value: string): string => utcDate(value) ?? instant(value);
const semanticIntent = (intent: ScenarioChangeIntent): unknown => {
  switch (intent.kind) {
    case "income_growth": return { kind: intent.kind, incomeId: uuid(intent.incomeId), annualRate: exact(intent.annualRate) };
    case "expense_inflation": return { kind: intent.kind, expenseId: uuid(intent.expenseId), annualRate: exact(intent.annualRate) };
    case "investment_return": return { kind: intent.kind, investmentId: uuid(intent.investmentId), annualRate: exact(intent.annualRate) };
    case "retirement_date": return { kind: intent.kind, incomeId: uuid(intent.incomeId), targetEventId: uuid(intent.targetEventId), baselineDate: utcDate(intent.baselineDate)?.slice(0, 10), newDate: utcDate(intent.newDate)?.slice(0, 10) };
    case "fee_rule_binding": return { kind: intent.kind, feeId: uuid(intent.feeId), taxRuleIds: [...intent.taxRuleIds].map(uuid).sort() };
    case "expense_funding_policy":
    case "loan_funding_policy": return { kind: intent.kind, ...(intent.kind === "expense_funding_policy" ? { expenseId: uuid(intent.expenseId) } : { liabilityId: uuid(intent.liabilityId) }), policy: { id: intent.policy.id, orderedAccountIds: intent.policy.orderedAccountIds.map(uuid), allowPartial: intent.policy.allowPartial, insufficientFundsBehavior: intent.policy.insufficientFundsBehavior } };
    case "investment_purchase": return { kind: intent.kind, operation: intent.operation, purchaseId: uuid(intent.purchaseId), ...(intent.investmentId === undefined ? {} : { investmentId: uuid(intent.investmentId) }), ...(intent.instruction === undefined ? {} : { instruction: { ...intent.instruction, id: uuid(intent.instruction.id), investmentId: uuid(intent.instruction.investmentId), sourceCashAccountId: uuid(intent.instruction.sourceCashAccountId), amount: exact(intent.instruction.amount), schedule: intent.instruction.schedule.kind === "explicit_dates" ? { ...intent.instruction.schedule, dates: intent.instruction.schedule.dates.map(canonicalInstant).sort() } : { ...intent.instruction.schedule, anchor: canonicalInstant(intent.instruction.schedule.anchor) } } }) };
    case "extra_principal_payment": return { kind: intent.kind, operation: intent.operation, liabilityId: uuid(intent.liabilityId), paymentId: uuid(intent.paymentId), ...(intent.instruction === undefined ? {} : { instruction: { ...intent.instruction, id: uuid(intent.instruction.id), scheduledAt: canonicalInstant(intent.instruction.scheduledAt), amount: exact(intent.instruction.amount), ...(intent.instruction.fundingAccountId === undefined ? {} : { fundingAccountId: uuid(intent.instruction.fundingAccountId) }) } }) };
  }
};

const lineageId = (
  model: PortableModelEnvelope,
  kind: "assumption" | "event",
  intent: ScenarioChangeIntent,
  supplied?: string,
): CompileResult<string> => {
  if (supplied !== undefined) {
    if (!UUID.test(supplied)) return invalid(
          "SCENARIO_LINEAGE_ID_INVALID",
          `${kind} identity must be a UUID.`,
          supplied,
        );
    const normalized = supplied.toLowerCase();
    return authoredIds(model).has(normalized)
      ? invalid("SCENARIO_LINEAGE_ID_COLLISION", `${kind} identity ${normalized} collides with an authored canonical identity.`, normalized)
      : { status: "compiled", value: normalized, diagnostics: Object.freeze([]) };
  }
  const generated = stableUuid(`runtime-${kind}`, canonicalSerialize(semanticIntent(intent)));
  return authoredIds(model).has(generated)
    ? invalid(
        "GENERATED_ID_COLLISION",
        `Runtime scenario identity ${generated} collides with an authored identity.`,
        generated,
      )
    : { status: "compiled", value: generated, diagnostics: Object.freeze([]) };
};

const validateAssumption = (
  model: PortableModelEnvelope,
  scope: ScenarioExecutionScope,
  selectedScenarioId: string,
  intent: ScenarioChangeIntent,
  id: string | undefined,
  category: string,
  value: string,
): CompileResult<string> => {
  if (id === undefined)
    return lineageId(model, "assumption", intent);
  if (!UUID.test(id))
    return invalid(
      "SCENARIO_ASSUMPTION_BINDING_MISMATCH",
      "Assumption identity must be a UUID.",
      id,
    );
  const normalized = id.toLowerCase();
  const record = objects(model, "Assumption").find(
    (item) => canonicalId(item, "assumption_id") === normalized,
  );
  if (!record)
    return invalid(
      "SCENARIO_ASSUMPTION_BINDING_MISMATCH",
      `Assumption ${normalized} does not resolve.`,
      normalized,
    );
  const scenario = objects(model, "Scenario").find(
    (item) => canonicalId(item, "scenario_id") === selectedScenarioId,
  );
  const listed =
    Array.isArray(scenario?.assumption_ids) &&
    (scenario!.assumption_ids as readonly unknown[]).some(
      (candidate) =>
        typeof candidate === "string" && candidate.toLowerCase() === normalized,
    );
  if (!scenario || !listed || String(record.scenario_id).toLowerCase() !== selectedScenarioId)
    return invalid(
      "SCENARIO_ASSUMPTION_MEMBERSHIP_INVALID",
      `Assumption ${normalized} membership and scenario back-reference must agree.`,
      normalized,
      "scenario_id",
    );
  if (record.category !== category || record.unit !== "effective annual rate")
    return bridgeUnsupported(
      scope,
      "SCENARIO_ASSUMPTION_BINDING_MISMATCH",
      `Assumption ${normalized} is not a ${category} effective annual rate.`,
      "Assumption",
      normalized,
    );
  if (record.start_date != null || record.end_date != null || record.distribution_type != null || record.distribution_parameters != null || record.correlation_group != null)
    return bridgeUnsupported(
      scope,
      "SCENARIO_ASSUMPTION_SEMANTICS_UNSUPPORTED",
      `Assumption ${normalized} must be deterministic and unbounded for this scenario overlay.`,
      "Assumption",
      normalized,
    );
  try {
    if (typeof record.value !== "string" || DecimalAmount.parse(record.value).compare(DecimalAmount.parse(value)) !== 0)
      return bridgeUnsupported(scope, "SCENARIO_ASSUMPTION_BINDING_MISMATCH", `Assumption ${normalized} has a different exact value.`, "Assumption", normalized);
  } catch {
    return invalid("SCENARIO_ASSUMPTION_VALUE_INVALID", `Assumption ${normalized} value must be an exact decimal string.`, normalized, "value");
  }
  return {
    status: "compiled",
    value: normalized,
    diagnostics: Object.freeze([]),
  };
};

const fundingPolicy = (
  scope: ScenarioExecutionScope,
  input: FundingPolicyIntent,
  accounts: Readonly<Record<string, string>>,
): CompileResult<ReturnType<typeof createFundingPolicy>> => {
  if (
    input.orderedAccountIds.length === 0 ||
    typeof input.allowPartial !== "boolean"
  )
    return bridgeUnsupported(
      scope,
      "SCENARIO_FUNDING_POLICY_INCOMPLETE",
      "A complete funding policy with ordered sources, partial-funding choice, and insufficient-funds behavior is required.",
    );
  const resolved: string[] = [];
  for (const raw of input.orderedAccountIds) {
    const id = accounts[raw.toLowerCase()];
    if (!id)
      return bridgeUnsupported(
        scope,
        "SCENARIO_TARGET_UNEXECUTABLE",
        `Funding Account ${raw} is outside the compiled scope.`,
        "Account",
        raw,
      );
    resolved.push(id);
  }
  try {
    return {
      status: "compiled",
      value: createFundingPolicy({
        id: fundingPolicyId(input.id),
        orderedSources: resolved.map((id) => ({
          kind: "cash_account" as const,
          accountId: domainId("account", id),
        })),
        allowPartial: input.allowPartial,
        insufficientFundsBehavior: input.insufficientFundsBehavior,
      }),
      diagnostics: Object.freeze([]),
    };
  } catch (error) {
    return invalid(
      "SCENARIO_FUNDING_POLICY_INVALID",
      error instanceof Error ? error.message : "Funding policy is invalid.",
      input.id,
    );
  }
};

export const compileExecutableScenario = (
  model: PortableModelEnvelope,
  base: ScenarioBaseCompilation,
  horizon: Readonly<{ start: string; end: string }>,
  intent: ExecutableScenarioIntent,
): CompileResult<ExecutableScenario> => {
  if (
    !UUID.test(intent.scenarioId) ||
    (intent.baseScenarioId !== undefined && !UUID.test(intent.baseScenarioId))
  )
    return invalid(
      "SCENARIO_ID_INVALID",
      "Executable scenario identities must be UUIDs.",
      intent.scenarioId,
    );
  const authoredScenario = objects(model, "Scenario").find(
    (item) =>
      canonicalId(item, "scenario_id") === intent.scenarioId.toLowerCase(),
  );
  if (authoredScenario === undefined && authoredIds(model).has(intent.scenarioId.toLowerCase()))
    return invalid(
      "SCENARIO_ID_COLLISION",
      `Runtime Scenario identity ${intent.scenarioId} collides with a non-Scenario authored identity.`,
      intent.scenarioId,
      "scenarioId",
    );
  if (authoredScenario !== undefined) {
    const authoredBase =
      typeof authoredScenario.base_scenario_id === "string"
        ? authoredScenario.base_scenario_id.toLowerCase()
        : undefined;
    if (authoredScenario.enabled !== true)
      return bridgeUnsupported(
        base.scope,
        "SCENARIO_ALTERNATIVE_DISABLED",
        `Scenario ${intent.scenarioId} is disabled.`,
        "Scenario",
        intent.scenarioId,
      );
    if (authoredScenario.stochastic === false && (authoredScenario.simulation_count ?? 1) !== 1)
      return invalid("SCENARIO_DETERMINISTIC_COUNT_INVALID", `Deterministic Scenario ${intent.scenarioId} must have simulation_count 1.`, intent.scenarioId, "simulation_count");
    if (authoredScenario.stochastic === true || (authoredScenario.simulation_count ?? 1) !== 1)
      return bridgeUnsupported(
        base.scope,
        "SCENARIO_STOCHASTIC_UNSUPPORTED",
        `Scenario ${intent.scenarioId} requests unsupported stochastic or multi-realization execution.`,
        "Scenario",
        intent.scenarioId,
      );
    if (
      authoredScenario.timestep !== "monthly" ||
      authoredBase !== intent.baseScenarioId?.toLowerCase()
    )
      return bridgeUnsupported(
        base.scope,
        "SCENARIO_BASE_BINDING_MISMATCH",
        `Scenario ${intent.scenarioId} does not match the requested monthly parent binding.`,
        "Scenario",
        intent.scenarioId,
      );
  }
  const needed = new Set(
    intent.changes.map((change) => intentScope(change.kind)),
  );
  if (needed.size > 1)
    return bridgeUnsupported(
      base.scope,
      "SCENARIO_REQUIRES_RECONCILED_PROJECTION",
      "This alternative spans multiple execution slices and requires the PR 20 reconciled projection.",
    );
  if (needed.size === 1 && !needed.has(base.scope))
    return bridgeUnsupported(
      base.scope,
      "SCENARIO_SCOPE_UNSUPPORTED",
      `The selected ${base.scope} scope cannot execute ${[...needed][0]} changes.`,
    );
  const changes: ScenarioChange[] = [];
  for (const change of intent.changes) {
    if (
      change.kind === "income_growth" ||
      change.kind === "expense_inflation"
    ) {
      if (base.scope !== "cash_flow")
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_SCOPE_UNSUPPORTED",
          `Change ${change.kind} is outside the compiled scope.`,
        );
      const canonicalTarget =
        change.kind === "income_growth" ? change.incomeId : change.expenseId;
      const runtimeTarget =
        change.kind === "income_growth"
          ? base.compiled.scenarioBindings.incomeIds[
              canonicalTarget.toLowerCase()
            ]
          : base.compiled.scenarioBindings.expenseIds[
              canonicalTarget.toLowerCase()
            ];
      if (!runtimeTarget)
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_TARGET_UNEXECUTABLE",
          `Scenario target ${canonicalTarget} is outside the compiled scope.`,
          change.kind === "income_growth" ? "Income" : "Expense",
          canonicalTarget,
        );
      const current =
        change.kind === "income_growth"
          ? base.compiled.input.incomes.find(
              (item) => item.id === runtimeTarget,
            )!.growthRate
          : base.compiled.input.expenses.find(
              (item) => item.id === runtimeTarget,
            )!.inflationRate;
      let rate: Rate;
      try {
        rate = Rate.fromDecimal(change.annualRate, current.convention);
      } catch {
        return invalid(
          "SCENARIO_RATE_INVALID",
          "Replacement annual rate must be an exact decimal string.",
          canonicalTarget,
        );
      }
      const assumption = validateAssumption(
        model,
        base.scope,
        intent.scenarioId.toLowerCase(),
        change,
        change.assumptionId,
        change.kind === "income_growth" ? "salary_growth" : "inflation",
        change.annualRate,
      );
      if (assumption.status !== "compiled") return assumption;
      changes.push(
        change.kind === "income_growth"
          ? {
              kind: change.kind,
              incomeId: domainId("income", runtimeTarget),
              rate,
              assumptionId: assumptionId(assumption.value),
            }
          : {
              kind: change.kind,
              expenseId: domainId("expense", runtimeTarget),
              rate,
              assumptionId: assumptionId(assumption.value),
            },
      );
    } else if (change.kind === "investment_return") {
      if (base.scope !== "investments")
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_SCOPE_UNSUPPORTED",
          "Investment return is outside the compiled scope.",
        );
      const positionId =
        base.compiled.scenarioBindings.positionIds[
          change.investmentId.toLowerCase()
        ];
      if (!positionId)
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_TARGET_UNEXECUTABLE",
          `Investment ${change.investmentId} is outside the compiled scope.`,
          "Investment",
          change.investmentId,
        );
      const current = base.compiled.input.returns.find(
        (item) => item.targetPositionId === positionId,
      )!;
      let rate: Rate;
      try {
        rate = Rate.fromDecimal(change.annualRate, current.rate.convention);
      } catch {
        return invalid(
          "SCENARIO_RATE_INVALID",
          "Replacement annual rate must be an exact decimal string.",
          change.investmentId,
        );
      }
      const assumption = validateAssumption(
        model,
        base.scope,
        intent.scenarioId.toLowerCase(),
        change,
        change.assumptionId,
        "market_return",
        change.annualRate,
      );
      if (assumption.status !== "compiled") return assumption;
      changes.push({
        kind: change.kind,
        positionId: domainId("position", positionId),
        rate,
        assumptionId: assumptionId(assumption.value),
      });
    } else if (change.kind === "retirement_date") {
      if (base.scope !== "cash_flow")
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_SCOPE_UNSUPPORTED",
          "Retirement date is outside the compiled scope.",
        );
      const bound =
        base.compiled.scenarioBindings.retirementEvents[
          change.targetEventId.toLowerCase()
        ];
      if (
        !bound ||
        bound.incomeId !== change.incomeId.toLowerCase() ||
        bound.baselineDate !== change.baselineDate
      )
        return bridgeUnsupported(
          base.scope,
          "RETIREMENT_BINDING_UNAVAILABLE",
          "An explicit matching income-termination binding is required.",
          "Income",
          change.incomeId,
        );
      const event = lineageId(model, "event", change, change.eventId);
      if (event.status !== "compiled") return event;
      if (event.value === bound.eventId)
        return invalid(
          "RETIREMENT_EVENT_IDENTITY_INVALID",
          "The explanatory event identity must differ from the target termination event.",
          event.value,
        );
      try {
        changes.push({
          kind: change.kind,
          targetEventId: domainId("event", bound.eventId),
          effectiveAt: instant(`${change.newDate}T00:00:00.000Z`),
          eventId: scenarioEventId(event.value),
        });
      } catch {
        return invalid(
          "RETIREMENT_DATE_INVALID",
          "Retirement newDate must be a valid date.",
          change.targetEventId,
        );
      }
    } else if (change.kind === "expense_funding_policy") {
      if (base.scope !== "cash_flow")
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_SCOPE_UNSUPPORTED",
          "Expense funding is outside the compiled scope.",
        );
      const expenseId =
        base.compiled.scenarioBindings.expenseIds[
          change.expenseId.toLowerCase()
        ];
      if (!expenseId)
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_TARGET_UNEXECUTABLE",
          `Expense ${change.expenseId} is outside the compiled scope.`,
        );
      const policy = fundingPolicy(
        base.scope,
        change.policy,
        base.compiled.scenarioBindings.accountIds,
      );
      if (policy.status !== "compiled") return policy;
      const lineage = lineageId(
        model,
        "assumption",
        change,
        change.assumptionId,
      );
      if (lineage.status !== "compiled") return lineage;
      changes.push({
        kind: change.kind,
        expenseId: domainId("expense", expenseId),
        fundingPolicy: policy.value,
        assumptionId: assumptionId(lineage.value),
      });
    } else if (change.kind === "loan_funding_policy") {
      if (base.scope !== "liabilities")
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_SCOPE_UNSUPPORTED",
          "Loan funding is outside the compiled scope.",
        );
      const loanId =
        base.compiled.scenarioBindings.loanIds[
          change.liabilityId.toLowerCase()
        ];
      if (!loanId)
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_TARGET_UNEXECUTABLE",
          `Liability ${change.liabilityId} is outside the compiled scope.`,
        );
      const policy = fundingPolicy(
        base.scope,
        change.policy,
        base.compiled.scenarioBindings.accountIds,
      );
      if (policy.status !== "compiled") return policy;
      const lineage = lineageId(
        model,
        "assumption",
        change,
        change.assumptionId,
      );
      if (lineage.status !== "compiled") return lineage;
      changes.push({
        kind: change.kind,
        loanId: domainId("loan-contract", loanId),
        fundingPolicy: policy.value,
        assumptionId: assumptionId(lineage.value),
      });
    } else if (change.kind === "fee_rule_binding") {
      if (base.scope !== "investments")
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_SCOPE_UNSUPPORTED",
          "Fee binding is outside the compiled scope.",
        );
      const feeId =
        base.compiled.scenarioBindings.feeIds[change.feeId.toLowerCase()];
      if (!feeId)
        return bridgeUnsupported(
          base.scope,
          "SCENARIO_FEE_TARGET_UNAVAILABLE",
          "The base investment model does not compile the requested executable fee target.",
          "InvestmentFee",
          change.feeId,
        );
      if (new Set(change.taxRuleIds.map((id) => id.toLowerCase())).size !== change.taxRuleIds.length)
        return invalid("SCENARIO_RULE_BINDING_INVALID", "Fee TaxRule candidate identities must be unique.", change.feeId);
      const lineage = lineageId(
        model,
        "assumption",
        change,
        change.assumptionId,
      );
      if (lineage.status !== "compiled") return lineage;
      try {
        changes.push({
          kind: change.kind,
          feeId: domainId("investment-fee", feeId),
          feeRuleIds: Object.freeze(
            [...change.taxRuleIds].map((id) => domainId("tax-rule", id)).sort(),
          ),
          assumptionId: assumptionId(lineage.value),
        });
      } catch {
        return invalid(
          "SCENARIO_RULE_BINDING_INVALID",
          "Fee TaxRule identities must be UUIDs.",
          change.feeId,
        );
      }
    } else if (
      change.kind === "investment_purchase" ||
      change.kind === "extra_principal_payment"
    ) {
      if (
        (change.operation === "remove" && change.instruction !== undefined) ||
        (change.operation !== "remove" && change.instruction === undefined)
      )
        return invalid(
          "SCENARIO_LIST_PAYLOAD_INVALID",
          `${change.operation} has an invalid replacement payload.`,
          change.kind === "investment_purchase"
            ? change.purchaseId
            : change.paymentId,
        );
      if (change.kind === "investment_purchase") {
        if (base.scope !== "investments")
          return bridgeUnsupported(
            base.scope,
            "SCENARIO_SCOPE_UNSUPPORTED",
            "Investment purchase is outside the compiled scope.",
          );
        const positionId = change.investmentId === undefined ? undefined :
          base.compiled.scenarioBindings.positionIds[change.investmentId.toLowerCase()];
        if (change.operation !== "remove" && !positionId)
          return bridgeUnsupported(
            base.scope,
            "SCENARIO_TARGET_UNEXECUTABLE",
            `Investment ${String(change.investmentId)} is outside the compiled scope.`,
          );
        const existing = base.compiled.input.purchases.find(
          (item) => item.id === change.purchaseId.toLowerCase(),
        );
        let payload;
        if (change.operation !== "remove") {
          if (!base.compilerRequest)
            return bridgeUnsupported(
              base.scope,
              "SCENARIO_PURCHASE_PAYLOAD_UNCOMPILED",
              "Investment purchase conversion requires the explicit base compiler request.",
            );
          const instructions = [
            ...base.compilerRequest.purchaseInstructions.filter(
              (item) =>
                item.id.toLowerCase() !== change.purchaseId.toLowerCase(),
            ),
            change.instruction!,
          ];
          const converted = compileInvestments(model, {
            ...base.compilerRequest,
            purchaseInstructions: instructions,
          });
          if (converted.status !== "compiled") return converted;
          payload = converted.value.input.purchases.find(
            (item) =>
              item.id === change.purchaseId.toLowerCase() &&
              item.targetPositionId === positionId!,
          );
          if (!payload)
            return bridgeUnsupported(
              base.scope,
              "SCENARIO_PURCHASE_PAYLOAD_UNCOMPILED",
              "Investment purchase payload could not be converted by the existing investment compiler.",
            );
          const primitiveId =
            existing?.schedulePrimitiveId ??
            domainId(
              "primitive-instance",
              stableUuid(
                "scenario-purchase-schedule",
                change.purchaseId.toLowerCase(),
              ),
            );
          const occupied = new Set(
            base.compiled.input.purchases.flatMap((item) => [
              String(item.id),
              String(item.schedulePrimitiveId),
            ]),
          );
          if (
            existing === undefined &&
            (occupied.has(primitiveId) || authoredIds(model).has(primitiveId))
          )
            return invalid(
              "GENERATED_ID_COLLISION",
              `Scenario purchase schedule identity ${primitiveId} collides with an existing identity.`,
              primitiveId,
            );
          payload = Object.freeze({
            ...payload,
            schedulePrimitiveId: primitiveId,
          });
        }
        const event = lineageId(model, "event", change, change.eventId);
        if (event.status !== "compiled") return event;
        changes.push({
          kind: change.kind,
          operation: change.operation,
          purchaseId: domainId("investment-purchase", change.purchaseId),
          eventId: scenarioEventId(event.value),
          ...(payload === undefined ? {} : { purchase: payload }),
        });
      } else {
        if (base.scope !== "liabilities")
          return bridgeUnsupported(
            base.scope,
            "SCENARIO_SCOPE_UNSUPPORTED",
            "Extra principal is outside the compiled scope.",
          );
        const loanId =
          base.compiled.scenarioBindings.loanIds[
            change.liabilityId.toLowerCase()
          ];
        if (!loanId)
          return bridgeUnsupported(
            base.scope,
            "SCENARIO_TARGET_UNEXECUTABLE",
            `Liability ${change.liabilityId} is outside the compiled scope.`,
          );
        const loan = base.compiled.input.loans.find(
          (item) => item.id === loanId,
        )!;
        const existing = (loan.extraPrincipalPayments ?? []).find(
          (item) => item.id === change.paymentId.toLowerCase(),
        );
        let payload;
        if (change.operation !== "remove") {
          if (!base.compilerRequest)
            return bridgeUnsupported(
              base.scope,
              "SCENARIO_EXTRA_PRINCIPAL_PAYLOAD_UNCOMPILED",
              "Extra-principal conversion requires the explicit base compiler request.",
            );
          const profiles = base.compilerRequest.executionProfiles.map(
            (profile) =>
              profile.liabilityId.toLowerCase() ===
              change.liabilityId.toLowerCase()
                ? {
                    ...profile,
                    extraPrincipalPayments: [
                      ...(profile.extraPrincipalPayments ?? []).filter(
                        (item) =>
                          item.id.toLowerCase() !==
                          change.paymentId.toLowerCase(),
                      ),
                      change.instruction!,
                    ],
                  }
                : profile,
          );
          const converted = compileLiabilities(model, {
            ...base.compilerRequest,
            executionProfiles: profiles,
          });
          if (converted.status !== "compiled") return converted;
          const convertedLoanId =
            converted.value.scenarioBindings.loanIds[
              change.liabilityId.toLowerCase()
            ]!;
          payload = converted.value.input.loans
            .find((item) => item.id === convertedLoanId)
            ?.extraPrincipalPayments?.find(
              (item) => item.id === change.paymentId.toLowerCase(),
            );
          if (!payload)
            return bridgeUnsupported(
              base.scope,
              "SCENARIO_EXTRA_PRINCIPAL_PAYLOAD_UNCOMPILED",
              "Extra-principal payload could not be converted by the existing liability compiler.",
            );
          const primitiveId =
            existing?.primitiveInstanceId ??
            domainId(
              "primitive-instance",
              stableUuid(
                "scenario-extra-principal",
                change.paymentId.toLowerCase(),
              ),
            );
          const occupied = new Set(
            base.compiled.input.loans.flatMap((item) => [
              String(item.id),
              ...(item.extraPrincipalPayments ?? []).flatMap((payment) => [
                String(payment.id),
                String(payment.primitiveInstanceId),
              ]),
            ]),
          );
          if (
            existing === undefined &&
            (occupied.has(primitiveId) || authoredIds(model).has(primitiveId))
          )
            return invalid(
              "GENERATED_ID_COLLISION",
              `Scenario extra-principal identity ${primitiveId} collides with an existing identity.`,
              primitiveId,
            );
          payload = Object.freeze({
            ...payload,
            primitiveInstanceId: primitiveId,
          });
        }
        const event = lineageId(model, "event", change, change.eventId);
        if (event.status !== "compiled") return event;
        changes.push({
          kind: change.kind,
          operation: change.operation,
          loanId: domainId("loan-contract", loanId),
          paymentId: domainId("extra-principal-payment", change.paymentId),
          eventId: scenarioEventId(event.value),
          ...(payload === undefined ? {} : { payment: payload }),
        });
      }
    }
  }
  return {
    status: "compiled",
    value: Object.freeze({
      scenarioId: scenarioId(intent.scenarioId),
      ...(intent.baseScenarioId === undefined
        ? {}
        : { baseScenarioId: scenarioId(intent.baseScenarioId) }),
      name: intent.name,
      horizon: Object.freeze({
        start: instant(horizon.start),
        end: instant(horizon.end),
      }),
      timestep: "monthly",
      enabled: true,
      stochastic: false,
      simulationCount: 1,
      changes: Object.freeze(changes),
    }),
    diagnostics: Object.freeze([]),
  };
};
