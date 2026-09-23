import { createFundingPolicy, fundingPolicyId } from "../../funding/index.js";
import { domainId } from "../../identity/index.js";
import {
  calculationTraceId,
  calculationTraceRef,
} from "../../lineage/index.js";
import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import {
  createAuthoritativeState,
  type AuthoritativeState,
} from "../../state/index.js";
import { utcMonthlyHorizonMonths, type Instant } from "../../time/index.js";
import { Currency, Rate, money, rateConvention } from "../../values/index.js";
import type { VerticalSlice2Input } from "../../simulation/verticalSlice2.js";
import {
  assertGeometricGrowthRate,
  isPrimitiveId,
} from "../../primitives/index.js";
import {
  EXACT_DECIMAL,
  ASSUMPTION_CATEGORIES,
  PAYMENT_FREQUENCIES,
  UUID,
  canonicalId,
  capability,
  monthAnchorDay,
  monthlyOccurrences,
  nextUtcDate,
  objects,
  ownerInScope,
  preflightCanonicalCollections,
  resolveHouseholdScope,
  resolveOwnerScope,
  utcDate,
  issue,
  inspectAccountBalanceBehavior,
  generatedCompilerIds,
  type CanonicalObject,
} from "./shared.js";
import type { CompileResult } from "./types.js";
import { selectScenario, type SelectedScenario } from "./scenarioSelection.js";

export type SameInstantCashFlowOrder =
  | "income_before_expense"
  | "expense_before_income";

export interface CashFlowCompilerRequest {
  readonly baseCurrency: string;
  readonly asOf?: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly sameInstantCashFlowOrder: SameInstantCashFlowOrder;
  /** Required when more than one in-scope cash Account exists. Never inferred. */
  readonly executionAccountId?: string;
  readonly months?: number;
  readonly scenarioId?: string;
  readonly retirementBindings?: readonly RetirementTerminationBinding[];
}

export interface RetirementTerminationBinding {
  readonly incomeId: string;
  readonly terminationEventId: string;
  readonly baselineDate: string;
  readonly canonicalEventId?: string;
}
export interface CashFlowScenarioBindings {
  readonly incomeIds: Readonly<Record<string, string>>;
  readonly expenseIds: Readonly<Record<string, string>>;
  readonly accountIds: Readonly<Record<string, string>>;
  readonly retirementEvents: Readonly<
    Record<
      string,
      Readonly<{ incomeId: string; eventId: string; baselineDate: string }>
    >
  >;
}

export interface CompiledCashFlow {
  readonly input: VerticalSlice2Input;
  readonly openingState: AuthoritativeState;
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly scenarioBindings: CashFlowScenarioBindings;
}

const GENERATED_PREFIX = "f15c0000-0000-4000-8001-";
const CASH_TYPES = new Set(["cash", "checking", "savings"]);

const invalidResult = (
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): Extract<CompileResult<never>, { readonly status: "invalid_model" }> => ({
  status: "invalid_model",
  diagnostics: Object.freeze([
    issue(code, message, entityType, entityId, fieldPath, relatedIds),
  ]),
});

const unsupportedResult = (
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): Extract<CompileResult<never>, { readonly status: "unsupported" }> => ({
  status: "unsupported",
  diagnostics: Object.freeze([
    capability(
      code,
      message,
      "cash_flow_forecast",
      entityType,
      entityId,
      fieldPath,
      relatedIds,
    ),
  ]),
});

export interface GrowthBinding {
  readonly rate: Rate;
  readonly primitiveId?: string;
  readonly assumptionId?: string;
}

export const resolveGrowth = (
  model: PortableModelEnvelope,
  stream: CanonicalObject,
  streamType: "Income" | "Expense",
  selected: SelectedScenario,
): CompileResult<GrowthBinding> => {
  const preflight = preflightCanonicalCollections(model, [
    "Scenario",
    "PrimitiveInstance",
    "Assumption",
  ]);
  if (preflight.status !== "compiled") return preflight;
  const streamId = canonicalId(stream, `${streamType.toLowerCase()}_id`)!;
  const rawGrowth = stream.growth_model_id;
  if (rawGrowth === undefined || rawGrowth === null)
    return {
      status: "compiled",
      value: Object.freeze({
        rate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
      }),
      diagnostics: Object.freeze([]),
    };
  if (typeof rawGrowth !== "string" || !UUID.test(rawGrowth))
    return invalidResult(
      "GROWTH_MODEL_REFERENCE_INVALID",
      `${streamType} ${streamId} growth_model_id must be a UUID.`,
      streamType,
      streamId,
      "growth_model_id",
    );
  const growthId = rawGrowth.toLowerCase();
  const primitives = objects(model, "PrimitiveInstance");
  const duplicatePrimitive = primitives.filter(
    (item) => canonicalId(item, "primitive_instance_id") === growthId,
  );
  if (duplicatePrimitive.length > 1)
    return invalidResult(
      "DUPLICATE_EXECUTABLE_IDENTITY",
      `Duplicate PrimitiveInstance identity ${growthId}.`,
      "PrimitiveInstance",
      growthId,
      "primitive_instance_id",
    );
  const primitive = primitives.find(
    (item) => canonicalId(item, "primitive_instance_id") === growthId,
  );
  if (!primitive)
    return invalidResult(
      "GROWTH_MODEL_REFERENCE_NOT_FOUND",
      `${streamType} ${streamId} growth_model_id does not resolve to a PrimitiveInstance.`,
      streamType,
      streamId,
      "growth_model_id",
      [growthId],
    );
  if (typeof primitive.enabled !== "boolean")
    return invalidResult(
      "GROWTH_PRIMITIVE_ENABLED_INVALID",
      `PrimitiveInstance ${growthId} enabled must be a boolean.`,
      "PrimitiveInstance",
      growthId,
      "enabled",
    );
  const primitiveDisabled = primitive.enabled === false;
  if (
    typeof primitive.primitive_id !== "string" ||
    !isPrimitiveId(primitive.primitive_id)
  )
    return invalidResult(
      "GROWTH_PRIMITIVE_ID_INVALID",
      `PrimitiveInstance ${growthId} primitive_id must identify a registered primitive.`,
      "PrimitiveInstance",
      growthId,
      "primitive_id",
    );
  const primitiveUnsupported = primitive.primitive_id !== "P08";
  if (
    typeof primitive.scenario_id !== "string" ||
    !UUID.test(primitive.scenario_id)
  )
    return invalidResult(
      "GROWTH_SCENARIO_BINDING_INVALID",
      `PrimitiveInstance ${growthId} scenario_id must be a UUID.`,
      "PrimitiveInstance",
      growthId,
      "scenario_id",
    );
  const primitiveScenarioId = primitive.scenario_id.toLowerCase();
  if (
    !objects(model, "Scenario").some(
      (scenario) =>
        canonicalId(scenario, "scenario_id") === primitiveScenarioId,
    )
  )
    return invalidResult(
      "GROWTH_SCENARIO_REFERENCE_NOT_FOUND",
      `PrimitiveInstance ${growthId} scenario_id does not resolve.`,
      "PrimitiveInstance",
      growthId,
      "scenario_id",
      [primitiveScenarioId],
    );
  const primitiveScenarioMismatch = primitiveScenarioId !== selected.id;
  for (const field of ["start_date", "end_date"] as const) {
    const raw = primitive[field];
    if (raw !== undefined && raw !== null && !utcDate(raw))
      return invalidResult(
        "DATE_INVALID",
        `PrimitiveInstance ${growthId} ${field} is invalid.`,
        "PrimitiveInstance",
        growthId,
        field,
      );
  }
  const primitiveBounded =
    (primitive.start_date !== undefined && primitive.start_date !== null) ||
    (primitive.end_date !== undefined && primitive.end_date !== null);
  if (
    primitive.parameters !== undefined &&
    primitive.parameters !== null &&
    (typeof primitive.parameters !== "object" ||
      Array.isArray(primitive.parameters))
  )
    return invalidResult(
      "GROWTH_PARAMETERS_INVALID",
      `P08 PrimitiveInstance ${growthId} parameters must be an object.`,
      "PrimitiveInstance",
      growthId,
      "parameters",
    );
  const primitiveParametersUnsupported =
    primitive.parameters !== undefined &&
    primitive.parameters !== null &&
    Object.keys(primitive.parameters as CanonicalObject).length > 0;
  const bindings = primitive.input_bindings;
  if (
    typeof bindings !== "object" ||
    bindings === null ||
    Array.isArray(bindings)
  )
    return invalidResult(
      "GROWTH_BINDINGS_INVALID",
      `PrimitiveInstance ${growthId} input_bindings must be an object.`,
      "PrimitiveInstance",
      growthId,
      "input_bindings",
    );
  if (primitiveDisabled || primitiveUnsupported)
    return unsupportedResult(
      "GROWTH_PRIMITIVE_UNSUPPORTED",
      `${streamType} ${streamId} requires an enabled P08 growth PrimitiveInstance.`,
      "PrimitiveInstance",
      growthId,
      primitiveDisabled ? "enabled" : "primitive_id",
    );
  const rateRef = (bindings as CanonicalObject).rate;
  if (typeof rateRef !== "string" || !UUID.test(rateRef))
    return invalidResult(
      "GROWTH_RATE_BINDING_INVALID",
      `P08 PrimitiveInstance ${growthId} input_bindings.rate must be an Assumption UUID.`,
      "PrimitiveInstance",
      growthId,
      "input_bindings.rate",
    );
  const primitiveBindingsUnsupported = Object.keys(
    bindings as CanonicalObject,
  ).some((key) => key !== "rate");
  const assumptionId = rateRef.toLowerCase();
  const assumptions = objects(model, "Assumption");
  if (
    assumptions.filter(
      (item) => canonicalId(item, "assumption_id") === assumptionId,
    ).length > 1
  )
    return invalidResult(
      "DUPLICATE_EXECUTABLE_IDENTITY",
      `Duplicate Assumption identity ${assumptionId}.`,
      "Assumption",
      assumptionId,
      "assumption_id",
    );
  const assumption = assumptions.find(
    (item) => canonicalId(item, "assumption_id") === assumptionId,
  );
  if (!assumption)
    return invalidResult(
      "ASSUMPTION_REFERENCE_NOT_FOUND",
      `P08 rate binding ${assumptionId} does not resolve to an Assumption.`,
      "PrimitiveInstance",
      growthId,
      "input_bindings.rate",
      [assumptionId],
    );
  if (
    typeof assumption.scenario_id !== "string" ||
    !UUID.test(assumption.scenario_id)
  )
    return invalidResult(
      "ASSUMPTION_SCENARIO_BINDING_INVALID",
      `Assumption ${assumptionId} scenario_id must be a UUID.`,
      "Assumption",
      assumptionId,
      "scenario_id",
    );
  const assumptionScenarioId = assumption.scenario_id.toLowerCase();
  if (
    !objects(model, "Scenario").some(
      (scenario) =>
        canonicalId(scenario, "scenario_id") === assumptionScenarioId,
    )
  )
    return invalidResult(
      "ASSUMPTION_SCENARIO_REFERENCE_NOT_FOUND",
      `Assumption ${assumptionId} scenario_id does not resolve.`,
      "Assumption",
      assumptionId,
      "scenario_id",
      [assumptionScenarioId],
    );
  const assumptionScenarioMismatch = assumptionScenarioId !== selected.id;
  const assumptionMembershipMissing =
    selected.object !== undefined &&
    !((selected.object.assumption_ids ?? []) as readonly unknown[]).some(
      (value) =>
        typeof value === "string" && value.toLowerCase() === assumptionId,
    );
  const assumptionStart =
    assumption.start_date === undefined || assumption.start_date === null
      ? undefined
      : utcDate(assumption.start_date);
  const assumptionEnd =
    assumption.end_date === undefined || assumption.end_date === null
      ? undefined
      : utcDate(assumption.end_date);
  if (
    (assumption.start_date !== undefined &&
      assumption.start_date !== null &&
      !assumptionStart) ||
    (assumption.end_date !== undefined &&
      assumption.end_date !== null &&
      !assumptionEnd) ||
    (assumptionStart !== undefined &&
      assumptionEnd !== undefined &&
      assumptionEnd < assumptionStart)
  )
    return invalidResult(
      "ASSUMPTION_TEMPORAL_INVALID",
      `Assumption ${assumptionId} has invalid ordered date bounds.`,
      "Assumption",
      assumptionId,
      "start_date",
    );
  const distributionTypes = [
    "normal",
    "lognormal",
    "uniform",
    "triangular",
    "discrete",
    "empirical",
    "mixture",
    "custom",
  ] as const;
  if (
    assumption.distribution_type !== undefined &&
    assumption.distribution_type !== null &&
    (typeof assumption.distribution_type !== "string" ||
      !distributionTypes.includes(assumption.distribution_type as never))
  )
    return invalidResult(
      "ASSUMPTION_DISTRIBUTION_INVALID",
      `Assumption ${assumptionId} distribution_type is not canonical.`,
      "Assumption",
      assumptionId,
      "distribution_type",
    );
  if (
    assumption.distribution_parameters !== undefined &&
    assumption.distribution_parameters !== null &&
    (typeof assumption.distribution_parameters !== "object" ||
      Array.isArray(assumption.distribution_parameters))
  )
    return invalidResult(
      "ASSUMPTION_DISTRIBUTION_PARAMETERS_INVALID",
      `Assumption ${assumptionId} distribution_parameters must be an object.`,
      "Assumption",
      assumptionId,
      "distribution_parameters",
    );
  if (
    assumption.correlation_group !== undefined &&
    assumption.correlation_group !== null &&
    typeof assumption.correlation_group !== "string"
  )
    return invalidResult(
      "ASSUMPTION_CORRELATION_GROUP_INVALID",
      `Assumption ${assumptionId} correlation_group must be a string.`,
      "Assumption",
      assumptionId,
      "correlation_group",
    );
  if (
    typeof assumption.category !== "string" ||
    !ASSUMPTION_CATEGORIES.includes(assumption.category as never)
  )
    return invalidResult(
      "ASSUMPTION_CATEGORY_INVALID",
      `Assumption ${assumptionId} category is not canonical.`,
      "Assumption",
      assumptionId,
      "category",
    );
  if (typeof assumption.unit !== "string")
    return invalidResult(
      "RATE_UNIT_INVALID",
      `Assumption ${assumptionId} unit must be a string.`,
      "Assumption",
      assumptionId,
      "unit",
    );
  if (
    typeof assumption.value !== "string" ||
    !EXACT_DECIMAL.test(assumption.value)
  )
    return invalidResult(
      "EXACT_DECIMAL_INVALID",
      `Assumption ${assumptionId} value must be an exact decimal string.`,
      "Assumption",
      assumptionId,
      "value",
    );
  if (
    assumptionStart !== undefined ||
    assumptionEnd !== undefined ||
    (assumption.distribution_type !== undefined &&
      assumption.distribution_type !== null) ||
    (assumption.distribution_parameters !== undefined &&
      assumption.distribution_parameters !== null) ||
    (assumption.correlation_group !== undefined &&
      assumption.correlation_group !== null)
  )
    return unsupportedResult(
      "STOCHASTIC_OR_BOUNDED_ASSUMPTION_UNSUPPORTED",
      `Assumption ${assumptionId} uses bounded, stochastic, or correlation semantics not supported in PR 15.`,
      "Assumption",
      assumptionId,
    );
  if (assumption.unit !== "effective annual rate")
    return unsupportedResult(
      "RATE_UNIT_UNSUPPORTED",
      `Assumption ${assumptionId} must use unit "effective annual rate".`,
      "Assumption",
      assumptionId,
      "unit",
    );
  const expectedCategory =
    streamType === "Income" ? "salary_growth" : "inflation";
  if (assumption.category !== expectedCategory)
    return unsupportedResult(
      "GROWTH_CATEGORY_UNSUPPORTED",
      `${streamType} ${streamId} requires Assumption category ${expectedCategory}; ${String(assumption.category)} is not equivalent.`,
      "Assumption",
      assumptionId,
      "category",
    );
  try {
    const rate = Rate.fromDecimal(
      assumption.value,
      rateConvention.effectiveAnnual(),
    );
    assertGeometricGrowthRate(rate);
    if (primitiveScenarioMismatch)
      return unsupportedResult(
        "GROWTH_SCENARIO_MISMATCH_UNSUPPORTED",
        `PrimitiveInstance ${growthId} belongs to a different valid Scenario.`,
        "PrimitiveInstance",
        growthId,
        "scenario_id",
        [selected.id, primitiveScenarioId],
      );
    if (primitiveBounded)
      return unsupportedResult(
        "BOUNDED_GROWTH_UNSUPPORTED",
        `Bounded P08 PrimitiveInstance ${growthId} is not supported in PR 15.`,
        "PrimitiveInstance",
        growthId,
      );
    if (primitiveParametersUnsupported)
      return unsupportedResult(
        "GROWTH_PARAMETERS_UNSUPPORTED",
        `P08 PrimitiveInstance ${growthId} must not contain parameters.`,
        "PrimitiveInstance",
        growthId,
        "parameters",
      );
    if (primitiveBindingsUnsupported)
      return unsupportedResult(
        "GROWTH_BINDING_UNSUPPORTED",
        `P08 PrimitiveInstance ${growthId} contains unsupported input bindings.`,
        "PrimitiveInstance",
        growthId,
        "input_bindings",
      );
    if (assumptionScenarioMismatch)
      return unsupportedResult(
        "ASSUMPTION_SCENARIO_MISMATCH_UNSUPPORTED",
        `Assumption ${assumptionId} belongs to a different valid Scenario.`,
        "Assumption",
        assumptionId,
        "scenario_id",
        [selected.id, assumptionScenarioId],
      );
    if (assumptionMembershipMissing)
      return unsupportedResult(
        "SCENARIO_ASSUMPTION_MEMBERSHIP_UNSUPPORTED",
        `Selected Scenario does not list bound Assumption ${assumptionId}.`,
        "Scenario",
        selected.id,
        "assumption_ids",
        [assumptionId],
      );
    return {
      status: "compiled",
      value: Object.freeze({
        rate,
        primitiveId: growthId,
        assumptionId,
      }),
      diagnostics: Object.freeze([]),
    };
  } catch (error) {
    return invalidResult(
      "DOMAIN_VALUE_INVALID",
      error instanceof Error ? error.message : "Growth rate is invalid.",
      "Assumption",
      assumptionId,
      "value",
    );
  }
};

const validateEventReference = (
  model: PortableModelEnvelope,
  stream: CanonicalObject,
  type: "Income" | "Expense",
  retirementBindings: readonly RetirementTerminationBinding[] = [],
): CompileResult<never> | undefined => {
  for (const field of type === "Income"
    ? (["probability_model_id", "related_event_id"] as const)
    : (["event_trigger_id"] as const)) {
    const value = stream[field];
    if (value === undefined || value === null) continue;
    const id = canonicalId(stream, `${type.toLowerCase()}_id`)!;
    if (typeof value !== "string" || !UUID.test(value))
      return invalidResult(
        "EVENT_BINDING_INVALID",
        `${type} ${id} ${field} must be a UUID.`,
        type,
        id,
        field,
      );
    const collection =
      field === "probability_model_id" ? "PrimitiveInstance" : "Event";
    const idField =
      field === "probability_model_id" ? "primitive_instance_id" : "event_id";
    if (
      !objects(model, collection).some(
        (item) => canonicalId(item, idField) === value.toLowerCase(),
      )
    )
      return invalidResult(
        "EVENT_BINDING_REFERENCE_NOT_FOUND",
        `${type} ${id} ${field} does not resolve to ${collection}.`,
        type,
        id,
        field,
        [value.toLowerCase()],
      );
    if (
      field === "related_event_id" &&
      retirementBindings.some(
        (binding) =>
          binding.incomeId.toLowerCase() === id &&
          binding.canonicalEventId?.toLowerCase() === value.toLowerCase(),
      )
    )
      continue;
    return unsupportedResult(
      "EVENT_BINDING_UNSUPPORTED",
      `${type} ${id} has authored ${field} behavior not supported in PR 15.`,
      type,
      id,
      field,
    );
  }
  return undefined;
};

export const compileCashFlow = (
  model: PortableModelEnvelope,
  request: CashFlowCompilerRequest,
): CompileResult<CompiledCashFlow> => {
  const preflight = preflightCanonicalCollections(model, [
    "Household",
    "Person",
    "Account",
    "Income",
    "Expense",
    "Scenario",
    "PrimitiveInstance",
    "Assumption",
    "Event",
    "Transaction",
  ]);
  if (preflight.status !== "compiled") return preflight;
  const scopeResult = resolveHouseholdScope(model);
  if (scopeResult.status !== "compiled") return scopeResult;
  const scope = scopeResult.value;
  if (
    request.sameInstantCashFlowOrder !== "income_before_expense" &&
    request.sameInstantCashFlowOrder !== "expense_before_income"
  )
    return invalidResult(
      "CASH_FLOW_ORDER_INVALID",
      "sameInstantCashFlowOrder must be explicitly configured.",
      "forecast_request",
      undefined,
      "sameInstantCashFlowOrder",
    );
  const simulationStart = utcDate(request.simulationStart);
  const simulationEnd = utcDate(request.simulationEnd);
  if (!simulationStart || !simulationEnd || simulationStart >= simulationEnd)
    return invalidResult(
      "FORECAST_HORIZON_INVALID",
      "Forecast simulationStart and simulationEnd must be valid increasing date-only values.",
      "forecast_request",
      undefined,
      "simulationStart",
    );
  const executionMonths = utcMonthlyHorizonMonths(
    simulationStart,
    simulationEnd,
  );
  if (executionMonths === undefined)
    return invalidResult(
      "FORECAST_HORIZON_MONTHLY_INVALID",
      "Forecast boundaries must form an exact UTC calendar-month VS2 horizon.",
      "forecast_request",
      undefined,
      "simulationStart",
    );
  if (request.months !== undefined && request.months !== executionMonths)
    return invalidResult(
      "FORECAST_MONTHS_MISMATCH",
      `Forecast months ${request.months} must equal the boundary-derived month count ${executionMonths}.`,
      "forecast_request",
      undefined,
      "months",
    );
  let currency: Currency;
  try {
    currency = Currency.of(request.baseCurrency);
  } catch (error) {
    return invalidResult(
      "BASE_CURRENCY_INVALID",
      error instanceof Error ? error.message : "Base currency is invalid.",
      "forecast_request",
      undefined,
      "baseCurrency",
    );
  }

  const allAccounts = objects(model, "Account");
  const accountIds = new Set<string>();
  for (const account of allAccounts) {
    const id = canonicalId(account, "account_id");
    if (!id)
      return invalidResult(
        "CANONICAL_ID_INVALID",
        "Account account_id must be a valid UUID.",
        "Account",
        undefined,
        "account_id",
      );
    if (accountIds.has(id))
      return invalidResult(
        "DUPLICATE_EXECUTABLE_IDENTITY",
        `Duplicate Account identity ${id}.`,
        "Account",
        id,
        "account_id",
      );
    accountIds.add(id);
    const owner = resolveOwnerScope(
      model,
      account.owner_id,
      scope,
      "Account",
      id,
    );
    if (owner.status !== "compiled") return owner;
    if (
      !(
        [
          "checking",
          "savings",
          "cash",
          "taxable_brokerage",
          "traditional_401k",
          "roth_401k",
          "traditional_ira",
          "roth_ira",
          "hsa",
          "hsa_investment",
          "529",
          "403b",
          "457b",
          "sep_ira",
          "simple_ira",
          "pension",
          "cash_value_insurance",
          "other",
        ] as const
      ).includes(account.account_type as never)
    )
      return invalidResult(
        "ACCOUNT_TYPE_INVALID",
        `Account ${id} account_type is not canonical.`,
        "Account",
        id,
        "account_type",
      );
  }
  const accounts = allAccounts.filter((account) =>
    ownerInScope(account.owner_id, scope),
  );
  /** Validate executable cash-account structure before ambiguity/FX/timing gates. */
  for (const candidate of accounts.filter((item) =>
    CASH_TYPES.has(String(item.account_type)),
  )) {
    const candidateId = canonicalId(candidate, "account_id")!;
    if (
      typeof candidate.currency !== "string" ||
      !/^[A-Z]{3}$/.test(candidate.currency)
    )
      return invalidResult(
        "ACCOUNT_CURRENCY_INVALID",
        `Account ${candidateId} currency must be a canonical ISO currency.`,
        "Account",
        candidateId,
        "currency",
      );
    if (
      typeof candidate.opening_balance !== "string" ||
      !EXACT_DECIMAL.test(candidate.opening_balance)
    )
      return invalidResult(
        "EXACT_DECIMAL_INVALID",
        `Account ${candidateId} opening_balance must be an exact decimal string.`,
        "Account",
        candidateId,
        "opening_balance",
      );
    try {
      if (money(candidate.opening_balance, currency).isNegative())
        return invalidResult(
          "DOMAIN_VALUE_INVALID",
          `Account ${candidateId} opening_balance must be non-negative.`,
          "Account",
          candidateId,
          "opening_balance",
        );
    } catch {
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Account ${candidateId} opening_balance is invalid.`,
        "Account",
        candidateId,
        "opening_balance",
      );
    }
    const opening = utcDate(candidate.opening_date);
    if (!opening)
      return invalidResult(
        "DATE_INVALID",
        `Account ${candidateId} opening_date must be a valid date-only value.`,
        "Account",
        candidateId,
        "opening_date",
      );
    if (
      candidate.closing_date !== undefined &&
      candidate.closing_date !== null
    ) {
      const closing = utcDate(candidate.closing_date);
      if (!closing)
        return invalidResult(
          "DATE_INVALID",
          `Account ${candidateId} closing_date is invalid.`,
          "Account",
          candidateId,
          "closing_date",
        );
      if (closing < opening)
        return invalidResult(
          "TEMPORAL_INTERVAL_INVALID",
          `Account ${candidateId} closing_date cannot precede opening_date.`,
          "Account",
          candidateId,
          "closing_date",
        );
    }
    const behavior = inspectAccountBalanceBehavior(model, candidate);
    if (behavior.status === "invalid_model") return behavior;
  }
  const allIncomes = objects(model, "Income");
  const allExpenses = objects(model, "Expense");
  /** Generic primitive shape is shared by preflight and P08-specific growth binding. */
  const validateGenericPrimitive = (
    primitiveId: string,
    entityType: "Income" | "Expense",
    entityId: string,
    fieldPath: string,
  ):
    | Extract<CompileResult<never>, { readonly status: "invalid_model" }>
    | undefined => {
    const primitive = objects(model, "PrimitiveInstance").find(
      (item) => canonicalId(item, "primitive_instance_id") === primitiveId,
    );
    if (!primitive)
      return invalidResult(
        "GROWTH_MODEL_REFERENCE_NOT_FOUND",
        `${entityType} ${entityId} ${fieldPath} does not resolve to a PrimitiveInstance.`,
        entityType,
        entityId,
        fieldPath,
        [primitiveId],
      );
    if (typeof primitive.enabled !== "boolean")
      return invalidResult(
        "GROWTH_PRIMITIVE_ENABLED_INVALID",
        `PrimitiveInstance ${primitiveId} enabled must be a boolean.`,
        "PrimitiveInstance",
        primitiveId,
        "enabled",
      );
    if (
      typeof primitive.primitive_id !== "string" ||
      !isPrimitiveId(primitive.primitive_id)
    )
      return invalidResult(
        "GROWTH_PRIMITIVE_ID_INVALID",
        `PrimitiveInstance ${primitiveId} primitive_id must identify a registered primitive.`,
        "PrimitiveInstance",
        primitiveId,
        "primitive_id",
      );
    const primitiveScenario = primitive.scenario_id;
    if (
      typeof primitiveScenario !== "string" ||
      !UUID.test(primitiveScenario) ||
      !objects(model, "Scenario").some(
        (scenario) =>
          canonicalId(scenario, "scenario_id") ===
          primitiveScenario.toLowerCase(),
      )
    )
      return invalidResult(
        "GROWTH_SCENARIO_BINDING_INVALID",
        `PrimitiveInstance ${primitiveId} scenario_id must resolve to a Scenario UUID.`,
        "PrimitiveInstance",
        primitiveId,
        "scenario_id",
      );
    if (
      typeof primitive.input_bindings !== "object" ||
      primitive.input_bindings === null ||
      Array.isArray(primitive.input_bindings)
    )
      return invalidResult(
        "GROWTH_BINDINGS_INVALID",
        `PrimitiveInstance ${primitiveId} input_bindings must be an object.`,
        "PrimitiveInstance",
        primitiveId,
        "input_bindings",
      );
    if (
      primitive.parameters !== undefined &&
      primitive.parameters !== null &&
      (typeof primitive.parameters !== "object" ||
        Array.isArray(primitive.parameters))
    )
      return invalidResult(
        "GROWTH_PARAMETERS_INVALID",
        `PrimitiveInstance ${primitiveId} parameters must be an object.`,
        "PrimitiveInstance",
        primitiveId,
        "parameters",
      );
    for (const dateField of ["start_date", "end_date"] as const)
      if (
        primitive[dateField] !== undefined &&
        primitive[dateField] !== null &&
        !utcDate(primitive[dateField])
      )
        return invalidResult(
          "DATE_INVALID",
          `PrimitiveInstance ${primitiveId} ${dateField} is invalid.`,
          "PrimitiveInstance",
          primitiveId,
          dateField,
        );
    return undefined;
  };
  const preflightStreams = (
    type: "Income" | "Expense",
    streams: readonly CanonicalObject[],
  ):
    | Extract<CompileResult<never>, { readonly status: "invalid_model" }>
    | undefined => {
    for (const stream of streams) {
      const id = canonicalId(stream, `${type.toLowerCase()}_id`)!;
      const owner = resolveOwnerScope(model, stream.owner_id, scope, type, id);
      if (owner.status !== "compiled") {
        if (owner.status === "invalid_model") return owner;
        continue;
      }
      if (owner.value === "out_of_scope") continue;
      if (
        typeof stream.amount !== "string" ||
        !EXACT_DECIMAL.test(stream.amount)
      )
        return invalidResult(
          "EXACT_DECIMAL_INVALID",
          `${type} ${id} amount must be an exact decimal string.`,
          type,
          id,
          "amount",
        );
      try {
        if (money(stream.amount, currency).isNegative())
          return invalidResult(
            "DOMAIN_VALUE_INVALID",
            `${type} ${id} amount cannot be negative.`,
            type,
            id,
            "amount",
          );
      } catch {
        return invalidResult(
          "DOMAIN_VALUE_INVALID",
          `${type} ${id} amount is invalid.`,
          type,
          id,
          "amount",
        );
      }
      if (!PAYMENT_FREQUENCIES.includes(stream.frequency as never))
        return invalidResult(
          "RECURRENCE_INVALID",
          `${type} ${id} frequency is not canonical.`,
          type,
          id,
          "frequency",
        );
      const start = utcDate(stream.start_date);
      const end =
        stream.end_date === undefined || stream.end_date === null
          ? undefined
          : nextUtcDate(
              typeof stream.end_date === "string" ? stream.end_date : "",
            );
      if (
        !start ||
        (stream.end_date !== undefined && stream.end_date !== null && !end)
      )
        return invalidResult(
          "DATE_INVALID",
          `${type} ${id} has invalid dates.`,
          type,
          id,
          "start_date",
        );
      if (end !== undefined && end <= start)
        return invalidResult(
          "TEMPORAL_INTERVAL_INVALID",
          `${type} ${id} inclusive end_date precedes start_date.`,
          type,
          id,
          "end_date",
        );
      const growth = stream.growth_model_id;
      if (growth !== undefined && growth !== null) {
        if (typeof growth !== "string" || !UUID.test(growth))
          return invalidResult(
            "GROWTH_MODEL_REFERENCE_INVALID",
            `${type} ${id} growth_model_id must be a UUID.`,
            type,
            id,
            "growth_model_id",
          );
        const invalidPrimitive = validateGenericPrimitive(
          growth.toLowerCase(),
          type,
          id,
          "growth_model_id",
        );
        if (invalidPrimitive) return invalidPrimitive;
      }
      for (const field of type === "Income"
        ? (["probability_model_id", "related_event_id"] as const)
        : (["event_trigger_id"] as const)) {
        const raw = stream[field];
        if (raw === undefined || raw === null) continue;
        if (typeof raw !== "string" || !UUID.test(raw))
          return invalidResult(
            "EVENT_BINDING_INVALID",
            `${type} ${id} ${field} must be a UUID.`,
            type,
            id,
            field,
          );
        const collection =
          field === "probability_model_id" ? "PrimitiveInstance" : "Event";
        const idField =
          field === "probability_model_id"
            ? "primitive_instance_id"
            : "event_id";
        if (
          !objects(model, collection).some(
            (item) => canonicalId(item, idField) === raw.toLowerCase(),
          )
        )
          return invalidResult(
            "EVENT_BINDING_REFERENCE_NOT_FOUND",
            `${type} ${id} ${field} does not resolve.`,
            type,
            id,
            field,
          );
      }
      if (
        type === "Expense" &&
        stream.payment_account_id !== undefined &&
        stream.payment_account_id !== null
      ) {
        if (
          typeof stream.payment_account_id !== "string" ||
          !UUID.test(stream.payment_account_id) ||
          !accountIds.has(stream.payment_account_id.toLowerCase())
        )
          return invalidResult(
            "PAYMENT_ACCOUNT_REFERENCE_INVALID",
            `Expense ${id} payment_account_id must resolve to an Account UUID.`,
            type,
            id,
            "payment_account_id",
          );
      }
    }
    return undefined;
  };
  const incomePreflight = preflightStreams("Income", allIncomes);
  if (incomePreflight) return incomePreflight;
  const expensePreflight = preflightStreams("Expense", allExpenses);
  if (expensePreflight) return expensePreflight;
  const scenarioResult = selectScenario(model, {
    capabilityName: "cash_flow_forecast",
    executionLabel: "Cash-flow",
    ...(request.scenarioId === undefined
      ? {}
      : { scenarioId: request.scenarioId }),
    simulationStart: request.simulationStart,
    simulationEnd: request.simulationEnd,
  });
  if (scenarioResult.status !== "compiled") return scenarioResult;
  const selected = scenarioResult.value;
  const retirementByIncome = new Map<string, RetirementTerminationBinding>();
  const retirementEventIds = new Set<string>();
  const authoredIdentityIds = new Set(
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
  for (const binding of request.retirementBindings ?? []) {
    const incomeId = binding.incomeId.toLowerCase();
    const eventId = binding.terminationEventId.toLowerCase();
    if (
      !UUID.test(binding.incomeId) ||
      !UUID.test(binding.terminationEventId) ||
      !utcDate(binding.baselineDate)
    )
      return invalidResult(
        "RETIREMENT_BINDING_INVALID",
        "Retirement bindings require UUID income/event identities and a date-only baselineDate.",
        "retirement_binding",
        eventId,
      );
    if (retirementByIncome.has(incomeId) || retirementEventIds.has(eventId))
      return unsupportedResult(
        "RETIREMENT_BINDING_AMBIGUOUS",
        "Each retirement binding must identify one distinct Income and termination event.",
        "retirement_binding",
        eventId,
      );
    if (
      !objects(model, "Income").some(
        (item) => canonicalId(item, "income_id") === incomeId,
      )
    )
      return invalidResult(
        "RETIREMENT_BINDING_INCOME_NOT_FOUND",
        `Retirement binding Income ${incomeId} does not resolve.`,
        "Income",
        incomeId,
      );
    if (authoredIdentityIds.has(eventId))
      return invalidResult(
        "RETIREMENT_BINDING_ID_COLLISION",
        `Runtime termination Event ${eventId} must not collide with an authored canonical identity.`,
        "retirement_binding",
        eventId,
      );
    if (binding.canonicalEventId !== undefined) {
      const canonicalEventId = binding.canonicalEventId.toLowerCase();
      const event = objects(model, "Event").find(
        (item) => canonicalId(item, "event_id") === canonicalEventId,
      );
      if (!event)
        return invalidResult(
          "RETIREMENT_BINDING_EVENT_NOT_FOUND",
          `Retirement Event ${canonicalEventId} does not resolve.`,
          "Event",
          canonicalEventId,
        );
      const listed =
        Array.isArray(selected.object?.event_ids) &&
        (selected.object!.event_ids as readonly unknown[]).some(
          (value) =>
            typeof value === "string" &&
            value.toLowerCase() === canonicalEventId,
        );
      if (
        event.enabled !== true ||
        event.event_type !== "retirement" ||
        event.trigger_type !== "scheduled" ||
        String(event.scenario_id).toLowerCase() !== selected.id ||
        !listed ||
        event.start_date !== binding.baselineDate
      )
        return unsupportedResult(
          "RETIREMENT_BINDING_MISMATCH",
          `Event ${canonicalEventId} is not an enabled scheduled retirement Event in the selected root Scenario at ${binding.baselineDate}.`,
          "Event",
          canonicalEventId,
        );
      if (
        event.probability_model_id != null ||
        event.trigger_condition != null ||
        (Array.isArray(event.effect_ids) && event.effect_ids.length > 0) ||
        (Array.isArray(event.dependencies) && event.dependencies.length > 0) ||
        event.duration_days != null ||
        event.end_date != null ||
        (event.precedence != null && event.precedence !== 0)
      )
        return unsupportedResult(
          "RETIREMENT_BINDING_EVENT_SEMANTICS_UNSUPPORTED",
          `Retirement Event ${canonicalEventId} contains semantics the income-termination binding cannot execute.`,
          "Event",
          canonicalEventId,
        );
    }
    retirementByIncome.set(
      incomeId,
      Object.freeze({ ...binding, incomeId, terminationEventId: eventId }),
    );
    retirementEventIds.add(eventId);
  }
  if (scope.memberIds.length !== 1)
    return unsupportedResult(
      "CASH_FLOW_OWNER_AMBIGUOUS",
      `VS2 cash-flow compilation requires exactly one Household member Person; found ${scope.memberIds.length}.`,
      "Household",
      scope.householdId,
      "members",
    );
  for (const expense of objects(model, "Expense")) {
    const expenseId = canonicalId(expense, "expense_id")!;
    const expenseOwner = resolveOwnerScope(
      model,
      expense.owner_id,
      scope,
      "Expense",
      expenseId,
    );
    if (expenseOwner.status !== "compiled") return expenseOwner;
    if (expenseOwner.value === "out_of_scope") continue;
    const rawPayment = expense.payment_account_id;
    if (rawPayment === undefined || rawPayment === null)
      return unsupportedResult(
        "PAYMENT_ACCOUNT_REQUIRED",
        `Expense ${expenseId} requires an explicit payment_account_id.`,
        "Expense",
        expenseId,
        "payment_account_id",
      );
    if (typeof rawPayment !== "string" || !UUID.test(rawPayment))
      return invalidResult(
        "PAYMENT_ACCOUNT_REFERENCE_INVALID",
        `Expense ${expenseId} payment_account_id must be a UUID.`,
        "Expense",
        expenseId,
        "payment_account_id",
      );
    const paymentId = rawPayment.toLowerCase();
    const paymentAccount = allAccounts.find(
      (candidate) => canonicalId(candidate, "account_id") === paymentId,
    );
    if (!paymentAccount)
      return invalidResult(
        "PAYMENT_ACCOUNT_REFERENCE_INVALID",
        `Expense ${expenseId} payment_account_id must resolve to an in-scope Account.`,
        "Expense",
        expenseId,
        "payment_account_id",
        [paymentId],
      );
    const paymentOwner = resolveOwnerScope(
      model,
      paymentAccount.owner_id,
      scope,
      "Account",
      paymentId,
    );
    if (paymentOwner.status !== "compiled") return paymentOwner;
    if (paymentOwner.value === "out_of_scope")
      return invalidResult(
        "PAYMENT_ACCOUNT_REFERENCE_INVALID",
        `Expense ${expenseId} payment_account_id must resolve to an in-scope Account.`,
        "Expense",
        expenseId,
        "payment_account_id",
        [paymentId],
      );
    if (!CASH_TYPES.has(String(paymentAccount.account_type)))
      return unsupportedResult(
        "PAYMENT_ACCOUNT_TYPE_UNSUPPORTED",
        `Expense ${expenseId} uses a valid non-cash payment Account.`,
        "Expense",
        expenseId,
        "payment_account_id",
        [paymentId],
      );
  }
  const eligibleAccounts = accounts.filter(
    (account) =>
      ownerInScope(account.owner_id, scope) &&
      CASH_TYPES.has(String(account.account_type)),
  );
  const requestedAccountId = request.executionAccountId?.toLowerCase();
  if (requestedAccountId !== undefined && !UUID.test(requestedAccountId))
    return invalidResult(
      "CASH_EXECUTION_ACCOUNT_INVALID",
      "Cash-flow executionAccountId must be a UUID.",
      "CashFlowCompilerRequest",
      undefined,
      "executionAccountId",
    );
  if (eligibleAccounts.length !== 1 && requestedAccountId === undefined)
    return unsupportedResult(
      "CASH_ACCOUNT_AMBIGUOUS",
      `Cash-flow compilation found ${eligibleAccounts.length} eligible in-scope cash Accounts and requires an explicit executionAccountId.`,
      "Account",
      undefined,
      "executionAccountId",
    );
  const account =
    requestedAccountId === undefined
      ? eligibleAccounts[0]
      : eligibleAccounts.find(
          (candidate) =>
            canonicalId(candidate, "account_id") === requestedAccountId,
        );
  if (account === undefined)
    return invalidResult(
      "CASH_EXECUTION_ACCOUNT_NOT_FOUND",
      `Cash-flow execution Account ${requestedAccountId ?? "(missing)"} is not an eligible in-scope cash Account.`,
      "Account",
      requestedAccountId,
      "executionAccountId",
    );
  const accountId = canonicalId(account, "account_id")!;
  if (
    typeof account.currency !== "string" ||
    !/^[A-Z]{3}$/.test(account.currency)
  )
    return invalidResult(
      "ACCOUNT_CURRENCY_INVALID",
      `Account ${accountId} currency must be a canonical ISO currency.`,
      "Account",
      accountId,
      "currency",
    );
  if (account.currency !== currency.code)
    return unsupportedResult(
      "FX_UNSUPPORTED",
      `Account ${accountId} currency does not match base currency ${currency.code}; PR 15 does not perform FX.`,
      "Account",
      accountId,
      "currency",
    );
  if (
    typeof account.opening_balance !== "string" ||
    !EXACT_DECIMAL.test(account.opening_balance)
  )
    return invalidResult(
      "EXACT_DECIMAL_INVALID",
      `Account ${accountId} opening_balance must be an exact decimal string.`,
      "Account",
      accountId,
      "opening_balance",
    );
  const openingDate = utcDate(account.opening_date);
  if (!openingDate)
    return invalidResult(
      "DATE_INVALID",
      `Account ${accountId} opening_date must be a valid date-only value.`,
      "Account",
      accountId,
      "opening_date",
    );
  if (openingDate > simulationStart)
    return unsupportedResult(
      "ACCOUNT_OPENING_TIMING_UNSUPPORTED",
      `Account ${accountId} does not exist at the forecast opening boundary.`,
      "Account",
      accountId,
      "opening_date",
    );
  if (account.closing_date !== undefined && account.closing_date !== null) {
    const closing = utcDate(account.closing_date);
    if (!closing)
      return invalidResult(
        "DATE_INVALID",
        `Account ${accountId} closing_date is invalid.`,
        "Account",
        accountId,
        "closing_date",
      );
    if (closing < openingDate)
      return invalidResult(
        "TEMPORAL_INTERVAL_INVALID",
        `Account ${accountId} closing_date cannot precede opening_date.`,
        "Account",
        accountId,
        "closing_date",
      );
    if (closing < simulationEnd)
      return unsupportedResult(
        "ACCOUNT_CLOSING_TIMING_UNSUPPORTED",
        `Account ${accountId} closes inside the forecast horizon.`,
        "Account",
        accountId,
        "closing_date",
      );
  }
  const balanceBehavior = inspectAccountBalanceBehavior(model, account);
  if (balanceBehavior.status !== "compiled") return balanceBehavior;
  if (balanceBehavior.value.hasAuthoredBehavior)
    return unsupportedResult(
      "OPENING_BALANCE_AUTHORITY_UNSUPPORTED",
      `Account ${accountId} has authored balance-changing behavior PR 15 does not replay.`,
      "Account",
      accountId,
    );

  const incomes = allIncomes.filter((stream) =>
    ownerInScope(stream.owner_id, scope),
  );
  const expenses = allExpenses.filter((stream) =>
    ownerInScope(stream.owner_id, scope),
  );
  for (const incomeId of retirementByIncome.keys())
    if (
      !incomes.some((income) => canonicalId(income, "income_id") === incomeId)
    )
      return unsupportedResult(
        "RETIREMENT_BINDING_TARGET_UNEXECUTABLE",
        `Retirement binding Income ${incomeId} is outside the executable VS2 scope.`,
        "Income",
        incomeId,
      );
  /** Structural validation precedes capability gates so stream order is immaterial. */
  const validateInScopeStreams = (
    type: "Income" | "Expense",
    collection: readonly CanonicalObject[],
  ):
    | Extract<CompileResult<never>, { readonly status: "invalid_model" }>
    | undefined => {
    for (const stream of collection) {
      const id = canonicalId(stream, `${type.toLowerCase()}_id`)!;
      const event = validateEventReference(
        model,
        stream,
        type,
        request.retirementBindings ?? [],
      );
      if (event?.status === "invalid_model") return event;
      if (!PAYMENT_FREQUENCIES.includes(stream.frequency as never))
        return invalidResult(
          "RECURRENCE_INVALID",
          `${type} ${id} frequency is not canonical.`,
          type,
          id,
          "frequency",
        );
      const start = utcDate(stream.start_date);
      if (!start)
        return invalidResult(
          "DATE_INVALID",
          `${type} ${id} start_date is invalid.`,
          type,
          id,
          "start_date",
        );
      if (stream.end_date !== undefined && stream.end_date !== null) {
        const end = nextUtcDate(
          typeof stream.end_date === "string" ? stream.end_date : "",
        );
        if (!end)
          return invalidResult(
            "DATE_INVALID",
            `${type} ${id} end_date is invalid.`,
            type,
            id,
            "end_date",
          );
        if (end <= start)
          return invalidResult(
            "TEMPORAL_INTERVAL_INVALID",
            `${type} ${id} inclusive end_date precedes start_date.`,
            type,
            id,
            "end_date",
          );
      }
      if (
        typeof stream.amount !== "string" ||
        !EXACT_DECIMAL.test(stream.amount)
      )
        return invalidResult(
          "EXACT_DECIMAL_INVALID",
          `${type} ${id} amount must be an exact decimal string.`,
          type,
          id,
          "amount",
        );
      try {
        if (money(stream.amount, currency).isNegative())
          return invalidResult(
            "DOMAIN_VALUE_INVALID",
            `${type} ${id} amount cannot be negative.`,
            type,
            id,
            "amount",
          );
      } catch (error) {
        return invalidResult(
          "DOMAIN_VALUE_INVALID",
          error instanceof Error ? error.message : `${type} amount is invalid.`,
          type,
          id,
          "amount",
        );
      }
      if (
        type === "Expense" &&
        String(stream.payment_account_id).toLowerCase() !== accountId
      )
        return invalidResult(
          "PAYMENT_ACCOUNT_REFERENCE_INVALID",
          `Expense ${id} payment_account_id must resolve to the one executable cash Account.`,
          type,
          id,
          "payment_account_id",
          [accountId],
        );
      const growth = resolveGrowth(model, stream, type, selected);
      if (growth.status === "invalid_model") return growth;
    }
    return undefined;
  };
  const incomeStructural = validateInScopeStreams("Income", incomes);
  if (incomeStructural) return incomeStructural;
  const expenseStructural = validateInScopeStreams("Expense", expenses);
  if (expenseStructural) return expenseStructural;

  const slots: string[] = ["payable"];
  for (const [type, collection, all] of [
    ["Income", incomes, allIncomes],
    ["Expense", expenses, allExpenses],
  ] as const) {
    const seen = new Set<string>();
    for (const stream of all) {
      const id = canonicalId(stream, `${type.toLowerCase()}_id`);
      if (!id)
        return invalidResult(
          "CANONICAL_ID_INVALID",
          `${type} identity must be a UUID.`,
          type,
          undefined,
          `${type.toLowerCase()}_id`,
        );
      if (seen.has(id))
        return invalidResult(
          "DUPLICATE_EXECUTABLE_IDENTITY",
          `Duplicate ${type} identity ${id}.`,
          type,
          id,
          `${type.toLowerCase()}_id`,
        );
      seen.add(id);
      const owner = resolveOwnerScope(model, stream.owner_id, scope, type, id);
      if (owner.status !== "compiled") return owner;
    }
    for (const stream of collection) {
      const idField = `${type.toLowerCase()}_id`;
      const id = canonicalId(stream, idField);
      if (!id)
        return invalidResult(
          "CANONICAL_ID_INVALID",
          `${type} ${idField} must be a valid UUID.`,
          type,
          undefined,
          idField,
        );
      const event = validateEventReference(
        model,
        stream,
        type,
        request.retirementBindings ?? [],
      );
      if (event) return event;
      if (!PAYMENT_FREQUENCIES.includes(stream.frequency as never))
        return invalidResult(
          "RECURRENCE_INVALID",
          `${type} ${id} frequency is not canonical.`,
          type,
          id,
          "frequency",
        );
      if (stream.frequency !== "monthly")
        return unsupportedResult(
          "RECURRENCE_UNSUPPORTED",
          `${type} ${id} frequency ${String(stream.frequency)} is not supported.`,
          type,
          id,
          "frequency",
        );
      const start = utcDate(stream.start_date);
      if (!start)
        return invalidResult(
          "DATE_INVALID",
          `${type} ${id} start_date is invalid.`,
          type,
          id,
          "start_date",
        );
      if (monthAnchorDay(start) > 28)
        return unsupportedResult(
          "MONTHLY_ANCHOR_UNSUPPORTED",
          `${type} ${id} uses monthly anchor day ${monthAnchorDay(start)}; only days 1-28 are supported.`,
          type,
          id,
          "start_date",
        );
      if (stream.end_date !== undefined && stream.end_date !== null) {
        if (
          typeof stream.end_date !== "string" ||
          !nextUtcDate(stream.end_date)
        )
          return invalidResult(
            "DATE_INVALID",
            `${type} ${id} end_date is invalid.`,
            type,
            id,
            "end_date",
          );
        if (nextUtcDate(stream.end_date)! <= start)
          return invalidResult(
            "TEMPORAL_INTERVAL_INVALID",
            `${type} ${id} inclusive end_date precedes start_date.`,
            type,
            id,
            "end_date",
          );
      }
      if (
        typeof stream.amount !== "string" ||
        !EXACT_DECIMAL.test(stream.amount)
      )
        return invalidResult(
          "EXACT_DECIMAL_INVALID",
          `${type} ${id} amount must be an exact decimal string.`,
          type,
          id,
          "amount",
        );
      try {
        if (money(stream.amount, currency).isNegative())
          return invalidResult(
            "DOMAIN_VALUE_INVALID",
            `${type} ${id} amount cannot be negative.`,
            type,
            id,
            "amount",
          );
      } catch (error) {
        return invalidResult(
          "DOMAIN_VALUE_INVALID",
          error instanceof Error ? error.message : `${type} amount is invalid.`,
          type,
          id,
          "amount",
        );
      }
      if (type === "Expense") {
        if (String(stream.payment_account_id).toLowerCase() !== accountId)
          return invalidResult(
            "PAYMENT_ACCOUNT_REFERENCE_INVALID",
            `Expense ${id} payment_account_id must resolve to the one executable cash Account.`,
            type,
            id,
            "payment_account_id",
            [accountId],
          );
      }
      slots.push(`${type}:${id}:recurrence`, `${type}:${id}:zero-growth`);
      if (type === "Income" && retirementByIncome.has(id))
        slots.push(`${type}:${id}:termination`);
      if (type === "Expense") slots.push(`${type}:${id}:inflation-link`);
    }
  }

  const idsResult = generatedCompilerIds(model, slots, GENERATED_PREFIX);
  if (idsResult.status !== "compiled") return idsResult;
  const generated = idsResult.value;
  const payableId = domainId("liability", generated.get("payable")!);
  const funding = createFundingPolicy({
    id: fundingPolicyId(`compiler:explicit-payment-account:${accountId}`),
    orderedSources: [
      { kind: "cash_account", accountId: domainId("account", accountId) },
    ],
    allowPartial: false,
    insufficientFundsBehavior: "unfunded",
  });

  const compiledIncomes: VerticalSlice2Input["incomes"][number][] = [];
  for (const stream of [...incomes].sort((a, b) =>
    String(a.income_id).localeCompare(String(b.income_id)),
  )) {
    const id = canonicalId(stream, "income_id")!;
    const growth = resolveGrowth(model, stream, "Income", selected);
    if (growth.status !== "compiled") return growth;
    const start = utcDate(stream.start_date)!;
    const end =
      typeof stream.end_date === "string"
        ? nextUtcDate(stream.end_date)!
        : undefined;
    const assumptionIds = growth.value.assumptionId
      ? [domainId("assumption", growth.value.assumptionId)]
      : undefined;
    compiledIncomes.push(
      Object.freeze({
        id: domainId("income", id),
        ownerId: domainId(
          stream.owner_id === scope.householdId ? "household" : "person",
          String(stream.owner_id),
        ),
        depositAccountId: domainId("account", accountId),
        baseMonthlyAmount: money(String(stream.amount), currency),
        start,
        ...(end === undefined ? {} : { end }),
        recurrence: Object.freeze({
          kind: "utc_monthly",
          anchor: start,
          invalidDayPolicy: "skip",
        }),
        growthRate: growth.value.rate,
        growthBaseAt: start,
        ...(retirementByIncome.has(id)
          ? {
              terminationEventId: domainId(
                "event",
                retirementByIncome.get(id)!.terminationEventId,
              ),
            }
          : {}),
        primitiveIds: Object.freeze({
          growth: domainId(
            "primitive-instance",
            growth.value.primitiveId ??
              generated.get(`Income:${id}:zero-growth`)!,
          ),
          recurrence: domainId(
            "primitive-instance",
            generated.get(`Income:${id}:recurrence`)!,
          ),
          ...(retirementByIncome.has(id)
            ? {
                termination: domainId(
                  "primitive-instance",
                  generated.get(`Income:${id}:termination`)!,
                ),
              }
            : {}),
        }),
        sourceTraceRefs: Object.freeze([
          calculationTraceRef(
            calculationTraceId(`compiler:canonical:Income:${id}`),
            undefined,
            assumptionIds,
          ),
        ]),
      }),
    );
  }

  const compiledExpenses: VerticalSlice2Input["expenses"][number][] = [];
  const expenseOccurrenceSets = new Map<string, Set<Instant>>();
  for (const stream of [...expenses].sort((a, b) =>
    String(a.expense_id).localeCompare(String(b.expense_id)),
  )) {
    const id = canonicalId(stream, "expense_id")!;
    const growth = resolveGrowth(model, stream, "Expense", selected);
    if (growth.status !== "compiled") return growth;
    const start = utcDate(stream.start_date)!;
    const end =
      typeof stream.end_date === "string"
        ? nextUtcDate(stream.end_date)!
        : undefined;
    expenseOccurrenceSets.set(
      id,
      money(String(stream.amount), currency).amount.isZero()
        ? new Set()
        : new Set(
            monthlyOccurrences(start, end, simulationStart, simulationEnd),
          ),
    );
    const assumptionIds = growth.value.assumptionId
      ? [domainId("assumption", growth.value.assumptionId)]
      : undefined;
    compiledExpenses.push(
      Object.freeze({
        id: domainId("expense", id),
        ownerId: domainId(
          stream.owner_id === scope.householdId ? "household" : "person",
          String(stream.owner_id),
        ),
        paymentAccountId: domainId("account", accountId),
        payableLiabilityId: payableId,
        baseMonthlyAmount: money(String(stream.amount), currency),
        start,
        ...(end === undefined ? {} : { end }),
        recurrence: Object.freeze({
          kind: "utc_monthly",
          anchor: start,
          invalidDayPolicy: "skip",
        }),
        inflationRate: growth.value.rate,
        inflationBaseAt: start,
        fundingPolicy: funding,
        primitiveIds: Object.freeze({
          indexGrowth: domainId(
            "primitive-instance",
            growth.value.primitiveId ??
              generated.get(`Expense:${id}:zero-growth`)!,
          ),
          inflationLink: domainId(
            "primitive-instance",
            generated.get(`Expense:${id}:inflation-link`)!,
          ),
          recurrence: domainId(
            "primitive-instance",
            generated.get(`Expense:${id}:recurrence`)!,
          ),
        }),
        sourceTraceRefs: Object.freeze([
          calculationTraceRef(
            calculationTraceId(`compiler:canonical:Expense:${id}`),
            undefined,
            assumptionIds,
          ),
        ]),
      }),
    );
  }
  const expenseIds = [...expenseOccurrenceSets.keys()].sort();
  for (let left = 0; left < expenseIds.length; left += 1)
    for (let right = left + 1; right < expenseIds.length; right += 1) {
      const leftId = expenseIds[left]!;
      const rightId = expenseIds[right]!;
      if (
        [...expenseOccurrenceSets.get(leftId)!].some((at) =>
          expenseOccurrenceSets.get(rightId)!.has(at),
        )
      )
        return unsupportedResult(
          "SAME_INSTANT_EXPENSE_PRIORITY_UNDEFINED",
          `Expenses ${leftId} and ${rightId} occur at the same instant, but canonical Expense defines no settlement priority.`,
          "Expense",
          leftId,
          "start_date",
          [rightId],
        );
    }

  const executableIds = [
    scope.householdId,
    scope.memberIds[0]!,
    accountId,
    payableId,
    ...compiledIncomes.flatMap((stream) => [
      stream.id,
      ...Object.values(stream.primitiveIds),
    ]),
    ...compiledExpenses.flatMap((stream) => [
      stream.id,
      ...Object.values(stream.primitiveIds),
    ]),
  ];
  if (new Set(executableIds).size !== executableIds.length)
    return invalidResult(
      "DUPLICATE_EXECUTABLE_IDENTITY",
      "The compiled request contains duplicate executable identities.",
      "portable_model",
      undefined,
      "objects",
    );

  try {
    const ownerId = domainId("person", scope.memberIds[0]!);
    const cashAccountId = domainId("account", accountId);
    const retirementEvents = [...retirementByIncome.values()].map((binding) =>
      Object.freeze({
        id: domainId("event", binding.terminationEventId),
        targetId: domainId("income", binding.incomeId),
        kind: "termination" as const,
        effectiveAt: utcDate(binding.baselineDate)!,
        sourceTraceRefs: Object.freeze([
          calculationTraceRef(
            calculationTraceId(
              `compiler:retirement-binding:${binding.terminationEventId}`,
            ),
          ),
        ]),
      }),
    );
    const input: VerticalSlice2Input = Object.freeze({
      householdId: domainId("household", scope.householdId),
      ownerId,
      cashAccountId,
      expensePayableLiabilityId: payableId,
      baseCurrency: currency,
      sameInstantCashFlowOrder: request.sameInstantCashFlowOrder,
      events: Object.freeze(retirementEvents),
      incomes: Object.freeze(compiledIncomes),
      expenses: Object.freeze(compiledExpenses),
    });
    const openingState = createAuthoritativeState({
      accounts: Object.fromEntries(
        eligibleAccounts.map((candidate) => {
          const candidateId = domainId(
            "account",
            canonicalId(candidate, "account_id")!,
          );
          const candidateOwner = String(candidate.owner_id).toLowerCase();
          return [
            candidateId,
            {
              id: candidateId,
              kind: String(candidate.account_type) as
                | "checking"
                | "savings"
                | "cash",
              ownerId: domainId(
                candidateOwner === scope.householdId ? "household" : "person",
                candidateOwner,
              ),
              cash: money(String(candidate.opening_balance), currency),
            },
          ];
        }),
      ),
      liabilities: {
        [payableId]: { id: payableId, balance: money("0", currency) },
      },
    });
    return {
      status: "compiled",
      value: Object.freeze({
        input,
        openingState,
        scenarioIdentity: selected.id,
        executionMonths,
        scenarioBindings: Object.freeze({
          incomeIds: Object.freeze(
            Object.fromEntries(
              compiledIncomes.map((item) => [String(item.id), String(item.id)]),
            ),
          ),
          expenseIds: Object.freeze(
            Object.fromEntries(
              compiledExpenses.map((item) => [
                String(item.id),
                String(item.id),
              ]),
            ),
          ),
          accountIds: Object.freeze({ [accountId]: String(cashAccountId) }),
          retirementEvents: Object.freeze(
            Object.fromEntries(
              retirementEvents.flatMap((item) => {
                const binding = retirementByIncome.get(String(item.targetId))!;
                const value = Object.freeze({
                    incomeId: String(item.targetId),
                    eventId: String(item.id),
                    baselineDate: item.effectiveAt.slice(0, 10),
                  });
                return binding.canonicalEventId === undefined
                  ? [[String(item.id), value]]
                  : [[String(item.id), value], [binding.canonicalEventId.toLowerCase(), value]];
              }),
            ),
          ),
        }),
      }),
      diagnostics: Object.freeze([]),
    };
  } catch (error) {
    return invalidResult(
      "DOMAIN_VALUE_INVALID",
      error instanceof Error
        ? error.message
        : "Executable cash-flow values are invalid.",
      "portable_model",
    );
  }
};
