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
import type { Instant } from "../../time/index.js";
import { Currency, Rate, money, rateConvention } from "../../values/index.js";
import type { VerticalSlice2Input } from "../../simulation/verticalSlice2.js";
import {
  EXACT_DECIMAL,
  UUID,
  canonicalId,
  capability,
  monthAnchorDay,
  monthlyOccurrences,
  nextUtcDate,
  objects,
  ownerInScope,
  resolveHouseholdScope,
  utcDate,
  issue,
  type CanonicalObject,
} from "./shared.js";
import type { CompileResult } from "./types.js";

export type SameInstantCashFlowOrder =
  | "income_before_expense"
  | "expense_before_income";

export interface CashFlowCompilerRequest {
  readonly baseCurrency: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly sameInstantCashFlowOrder: SameInstantCashFlowOrder;
}

export interface CompiledCashFlow {
  readonly input: VerticalSlice2Input;
  readonly openingState: AuthoritativeState;
  readonly scenarioIdentity: string;
}

const SYNTHETIC_SCENARIO = "f15c0000-0000-4000-8000-000000000001";
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

export interface SelectedScenario {
  readonly id: string;
  readonly object?: CanonicalObject;
}

export const selectScenario = (
  model: PortableModelEnvelope,
): CompileResult<SelectedScenario> => {
  const scenarios = objects(model, "Scenario");
  if (scenarios.length === 0)
    return {
      status: "compiled",
      value: Object.freeze({ id: SYNTHETIC_SCENARIO }),
      diagnostics: Object.freeze([]),
    };
  const scenarioIds = new Set<string>();
  for (const scenario of scenarios) {
    const id = canonicalId(scenario, "scenario_id");
    if (!id)
      return invalidResult(
        "CANONICAL_ID_INVALID",
        "Scenario scenario_id must be a valid UUID.",
        "Scenario",
        undefined,
        "scenario_id",
      );
    if (scenarioIds.has(id))
      return invalidResult(
        "DUPLICATE_EXECUTABLE_IDENTITY",
        `Duplicate Scenario identity ${id}.`,
        "Scenario",
        id,
        "scenario_id",
      );
    scenarioIds.add(id);
  }
  const eligible = scenarios.filter(
    (scenario) =>
      scenario.enabled === true &&
      scenario.stochastic === false &&
      scenario.timestep === "monthly" &&
      scenario.simulation_count === 1,
  );
  if (eligible.length !== 1)
    return unsupportedResult(
      "SCENARIO_SELECTION_AMBIGUOUS",
      `Cash-flow compilation requires exactly one enabled deterministic monthly single-realization Scenario; found ${eligible.length}.`,
      "Scenario",
    );
  const selected = eligible[0]!;
  const id = canonicalId(selected, "scenario_id")!;
  if (selected.event_ids !== undefined && !Array.isArray(selected.event_ids))
    return invalidResult(
      "SCENARIO_EVENT_REFERENCES_INVALID",
      `Scenario ${id} event_ids must be an array.`,
      "Scenario",
      id,
      "event_ids",
    );
  if (Array.isArray(selected.event_ids) && selected.event_ids.length > 0) {
    for (const eventId of selected.event_ids) {
      if (typeof eventId !== "string" || !UUID.test(eventId))
        return invalidResult(
          "SCENARIO_EVENT_REFERENCE_INVALID",
          `Scenario ${id} contains a malformed event reference.`,
          "Scenario",
          id,
          "event_ids",
        );
      if (
        !objects(model, "Event").some(
          (event) => canonicalId(event, "event_id") === eventId.toLowerCase(),
        )
      )
        return invalidResult(
          "SCENARIO_EVENT_REFERENCE_NOT_FOUND",
          `Scenario ${id} event ${eventId} does not resolve.`,
          "Scenario",
          id,
          "event_ids",
          [eventId.toLowerCase()],
        );
    }
    return unsupportedResult(
      "SCENARIO_EVENTS_UNSUPPORTED",
      `Scenario ${id} contains authored events whose operation semantics are not executable in PR 15.`,
      "Scenario",
      id,
      "event_ids",
    );
  }
  if (
    selected.assumption_ids !== undefined &&
    !Array.isArray(selected.assumption_ids)
  )
    return invalidResult(
      "SCENARIO_ASSUMPTION_REFERENCES_INVALID",
      `Scenario ${id} assumption_ids must be an array.`,
      "Scenario",
      id,
      "assumption_ids",
    );
  for (const assumptionId of (selected.assumption_ids ??
    []) as readonly unknown[]) {
    if (typeof assumptionId !== "string" || !UUID.test(assumptionId))
      return invalidResult(
        "SCENARIO_ASSUMPTION_REFERENCE_INVALID",
        `Scenario ${id} contains a malformed Assumption reference.`,
        "Scenario",
        id,
        "assumption_ids",
      );
    if (
      !objects(model, "Assumption").some(
        (assumption) =>
          canonicalId(assumption, "assumption_id") ===
          assumptionId.toLowerCase(),
      )
    )
      return invalidResult(
        "SCENARIO_ASSUMPTION_REFERENCE_NOT_FOUND",
        `Scenario ${id} Assumption ${assumptionId} does not resolve.`,
        "Scenario",
        id,
        "assumption_ids",
        [assumptionId.toLowerCase()],
      );
  }
  return {
    status: "compiled",
    value: Object.freeze({ id, object: selected }),
    diagnostics: Object.freeze([]),
  };
};

const generatedIds = (
  model: PortableModelEnvelope,
  slots: readonly string[],
): CompileResult<ReadonlyMap<string, string>> => {
  const authored = new Set<string>();
  for (const collection of Object.values(model.objects))
    for (const value of collection) {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        continue;
      for (const [field, raw] of Object.entries(value))
        if (field.endsWith("_id") && typeof raw === "string" && UUID.test(raw))
          authored.add(raw.toLowerCase());
    }
  const result = new Map<string, string>();
  [...new Set(slots)].sort().forEach((slot, index) => {
    result.set(
      slot,
      `${GENERATED_PREFIX}${String(index + 1).padStart(12, "0")}`,
    );
  });
  const collision = [...result.values()].find((id) => authored.has(id));
  if (collision)
    return invalidResult(
      "GENERATED_ID_COLLISION",
      `Compiler-owned identity ${collision} collides with an authored identity.`,
      "portable_model",
      undefined,
      "objects",
      [collision],
    );
  return { status: "compiled", value: result, diagnostics: Object.freeze([]) };
};

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
  const streamId = canonicalId(stream, `${streamType.toLowerCase()}_id`)!;
  const rawGrowth = stream.growth_model_id;
  if (rawGrowth === undefined || rawGrowth === null || rawGrowth === "")
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
  if (primitive.enabled !== true || primitive.primitive_id !== "P08")
    return unsupportedResult(
      "GROWTH_PRIMITIVE_UNSUPPORTED",
      `${streamType} ${streamId} requires an enabled P08 growth PrimitiveInstance.`,
      "PrimitiveInstance",
      growthId,
      "primitive_id",
    );
  if (
    typeof primitive.scenario_id !== "string" ||
    primitive.scenario_id.toLowerCase() !== selected.id
  )
    return invalidResult(
      "GROWTH_SCENARIO_BINDING_INVALID",
      `PrimitiveInstance ${growthId} does not belong to the selected Scenario.`,
      "PrimitiveInstance",
      growthId,
      "scenario_id",
      [selected.id],
    );
  if (primitive.start_date !== undefined || primitive.end_date !== undefined)
    return unsupportedResult(
      "BOUNDED_GROWTH_UNSUPPORTED",
      `Bounded P08 PrimitiveInstance ${growthId} is not supported in PR 15.`,
      "PrimitiveInstance",
      growthId,
    );
  if (
    primitive.parameters !== undefined &&
    (typeof primitive.parameters !== "object" ||
      primitive.parameters === null ||
      Array.isArray(primitive.parameters) ||
      Object.keys(primitive.parameters).length > 0)
  )
    return unsupportedResult(
      "GROWTH_PARAMETERS_UNSUPPORTED",
      `P08 PrimitiveInstance ${growthId} must not contain parameters.`,
      "PrimitiveInstance",
      growthId,
      "parameters",
    );
  const bindings = primitive.input_bindings;
  const rateRef =
    typeof bindings === "object" &&
    bindings !== null &&
    !Array.isArray(bindings)
      ? (bindings as CanonicalObject).rate
      : undefined;
  if (typeof rateRef !== "string" || !UUID.test(rateRef))
    return invalidResult(
      "GROWTH_RATE_BINDING_INVALID",
      `P08 PrimitiveInstance ${growthId} input_bindings.rate must be an Assumption UUID.`,
      "PrimitiveInstance",
      growthId,
      "input_bindings.rate",
    );
  if (Object.keys(bindings as CanonicalObject).some((key) => key !== "rate"))
    return unsupportedResult(
      "GROWTH_BINDING_UNSUPPORTED",
      `P08 PrimitiveInstance ${growthId} contains unsupported input bindings.`,
      "PrimitiveInstance",
      growthId,
      "input_bindings",
    );
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
    assumption.scenario_id.toLowerCase() !== selected.id
  )
    return invalidResult(
      "ASSUMPTION_SCENARIO_BINDING_INVALID",
      `Assumption ${assumptionId} does not belong to the selected Scenario.`,
      "Assumption",
      assumptionId,
      "scenario_id",
      [selected.id],
    );
  if (
    selected.object &&
    Array.isArray(selected.object.assumption_ids) &&
    !selected.object.assumption_ids.some(
      (value) =>
        typeof value === "string" && value.toLowerCase() === assumptionId,
    )
  )
    return invalidResult(
      "SCENARIO_ASSUMPTION_MEMBERSHIP_INVALID",
      `Selected Scenario does not list bound Assumption ${assumptionId}.`,
      "Scenario",
      selected.id,
      "assumption_ids",
      [assumptionId],
    );
  if (
    assumption.start_date !== undefined ||
    assumption.end_date !== undefined ||
    assumption.distribution_type !== undefined ||
    assumption.distribution_parameters !== undefined ||
    assumption.correlation_group !== undefined
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
  try {
    return {
      status: "compiled",
      value: Object.freeze({
        rate: Rate.fromDecimal(
          assumption.value,
          rateConvention.effectiveAnnual(),
        ),
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
): CompileResult<never> | undefined => {
  for (const field of type === "Income"
    ? (["probability_model_id", "related_event_id"] as const)
    : (["event_trigger_id"] as const)) {
    const value = stream[field];
    if (value === undefined || value === null || value === "") continue;
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
  if (scope.memberIds.length !== 1)
    return unsupportedResult(
      "CASH_FLOW_OWNER_AMBIGUOUS",
      `VS2 cash-flow compilation requires exactly one Household member Person; found ${scope.memberIds.length}.`,
      "Household",
      scope.householdId,
      "members",
    );
  const scenarioResult = selectScenario(model);
  if (scenarioResult.status !== "compiled") return scenarioResult;
  const selected = scenarioResult.value;
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
    if (typeof account.owner_id !== "string" || !UUID.test(account.owner_id))
      return invalidResult(
        "OWNER_REFERENCE_INVALID",
        `Account ${id} owner_id must be a UUID.`,
        "Account",
        id,
        "owner_id",
      );
  }
  const accounts = allAccounts.filter((account) =>
    ownerInScope(account.owner_id, scope),
  );
  const eligibleAccounts = accounts.filter(
    (account) =>
      ownerInScope(account.owner_id, scope) &&
      CASH_TYPES.has(String(account.account_type)),
  );
  if (eligibleAccounts.length !== 1)
    return unsupportedResult(
      "CASH_ACCOUNT_AMBIGUOUS",
      `Cash-flow compilation requires exactly one eligible in-scope cash Account; found ${eligibleAccounts.length}.`,
      "Account",
    );
  const account = eligibleAccounts[0]!;
  const accountId = canonicalId(account, "account_id")!;
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
  if (account.closing_date !== undefined) {
    const closing = utcDate(account.closing_date);
    if (!closing)
      return invalidResult(
        "DATE_INVALID",
        `Account ${accountId} closing_date is invalid.`,
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
  const transactionIds = account.transaction_ids;
  if (transactionIds !== undefined && !Array.isArray(transactionIds))
    return invalidResult(
      "TRANSACTION_REFERENCES_INVALID",
      `Account ${accountId} transaction_ids must be an array.`,
      "Account",
      accountId,
      "transaction_ids",
    );
  for (const value of (transactionIds ?? []) as readonly unknown[]) {
    if (typeof value !== "string" || !UUID.test(value))
      return invalidResult(
        "TRANSACTION_REFERENCE_INVALID",
        `Account ${accountId} has a malformed transaction reference.`,
        "Account",
        accountId,
        "transaction_ids",
      );
    if (
      !objects(model, "Transaction").some(
        (item) => canonicalId(item, "transaction_id") === value.toLowerCase(),
      )
    )
      return invalidResult(
        "TRANSACTION_REFERENCE_NOT_FOUND",
        `Account ${accountId} transaction ${value} does not resolve.`,
        "Account",
        accountId,
        "transaction_ids",
        [value.toLowerCase()],
      );
  }
  const affectingTransactions = objects(model, "Transaction").filter(
    (transaction) =>
      [
        transaction.account_id,
        transaction.from_account_id,
        transaction.to_account_id,
      ].includes(accountId),
  );
  if (account.return_model_id !== undefined) {
    if (
      typeof account.return_model_id !== "string" ||
      !UUID.test(account.return_model_id)
    )
      return invalidResult(
        "RETURN_MODEL_REFERENCE_INVALID",
        `Account ${accountId} return_model_id must be a UUID.`,
        "Account",
        accountId,
        "return_model_id",
      );
    if (
      !objects(model, "PrimitiveInstance").some(
        (primitive) =>
          canonicalId(primitive, "primitive_instance_id") ===
          String(account.return_model_id).toLowerCase(),
      )
    )
      return invalidResult(
        "RETURN_MODEL_REFERENCE_NOT_FOUND",
        `Account ${accountId} return_model_id does not resolve.`,
        "Account",
        accountId,
        "return_model_id",
      );
  }
  if (
    (transactionIds?.length ?? 0) > 0 ||
    affectingTransactions.length > 0 ||
    account.return_model_id !== undefined
  )
    return unsupportedResult(
      "OPENING_BALANCE_AUTHORITY_UNSUPPORTED",
      `Account ${accountId} has authored balance-changing behavior PR 15 does not replay.`,
      "Account",
      accountId,
    );

  const allIncomes = objects(model, "Income");
  const allExpenses = objects(model, "Expense");
  const incomes = allIncomes.filter((stream) =>
    ownerInScope(stream.owner_id, scope),
  );
  const expenses = allExpenses.filter((stream) =>
    ownerInScope(stream.owner_id, scope),
  );
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
      if (typeof stream.owner_id !== "string" || !UUID.test(stream.owner_id))
        return invalidResult(
          "OWNER_REFERENCE_INVALID",
          `${type} ${id} owner_id must be a UUID.`,
          type,
          id,
          "owner_id",
        );
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
      const event = validateEventReference(model, stream, type);
      if (event) return event;
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
      if (stream.end_date !== undefined) {
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
        if (stream.payment_account_id === undefined)
          return invalidResult(
            "PAYMENT_ACCOUNT_REQUIRED",
            `Expense ${id} requires payment_account_id.`,
            type,
            id,
            "payment_account_id",
          );
        if (
          typeof stream.payment_account_id !== "string" ||
          stream.payment_account_id.toLowerCase() !== accountId
        )
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
      if (type === "Expense") slots.push(`${type}:${id}:inflation-link`);
    }
  }

  const idsResult = generatedIds(model, slots);
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
      new Set(monthlyOccurrences(start, end, simulationStart, simulationEnd)),
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
    const input: VerticalSlice2Input = Object.freeze({
      householdId: domainId("household", scope.householdId),
      ownerId,
      cashAccountId,
      expensePayableLiabilityId: payableId,
      baseCurrency: currency,
      sameInstantCashFlowOrder: request.sameInstantCashFlowOrder,
      events: Object.freeze([]),
      incomes: Object.freeze(compiledIncomes),
      expenses: Object.freeze(compiledExpenses),
    });
    const openingState = createAuthoritativeState({
      accounts: {
        [cashAccountId]: {
          id: cashAccountId,
          kind: String(account.account_type) as "checking" | "savings" | "cash",
          ownerId,
          cash: money(String(account.opening_balance), currency),
        },
      },
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
