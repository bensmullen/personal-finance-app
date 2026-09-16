import { domainId } from "../../identity/index.js";
import {
  calculationTraceId,
  calculationTraceRef,
} from "../../lineage/index.js";
import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import {
  createPrimitiveRuntimeStateStore,
  type PrimitiveRuntimeStateStore,
} from "../../simulation/period.js";
import type {
  InvestmentSchedule,
  VerticalSlice3Input,
} from "../../simulation/verticalSlice3.js";
import {
  createAuthoritativeState,
  type AccountKind,
  type AuthoritativeState,
} from "../../state/index.js";
import {
  utcMonthlyHorizonMonths,
  utcMonthlyOccurrences,
  type Instant,
} from "../../time/index.js";
import {
  Currency,
  Quantity,
  Rate,
  RoundingPolicy,
  SHARE,
  money,
  rateConvention,
} from "../../values/index.js";
import {
  ASSUMPTION_CATEGORIES,
  EXACT_DECIMAL,
  UUID,
  canonicalId,
  capability,
  generatedCompilerIds,
  inspectAccountBalanceBehavior,
  issue,
  objects,
  preflightCanonicalCollections,
  resolveHouseholdScope,
  utcDate,
  validateGenericPrimitiveInstance,
  type CanonicalObject,
} from "./shared.js";
import { selectScenario } from "./cashFlow.js";
import type { CompileResult } from "./types.js";

export type InvestmentOperationSchedule =
  | { readonly kind: "explicit_dates"; readonly dates: readonly string[] }
  | {
      readonly kind: "utc_monthly";
      readonly anchor: string;
      readonly invalidDayPolicy: "skip";
    };

export interface InvestmentTransferExecutionInstruction {
  readonly id: string;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly amount: string;
  readonly schedule: InvestmentOperationSchedule;
  readonly order: number;
}

export interface InvestmentPurchaseExecutionInstruction {
  readonly id: string;
  readonly investmentId: string;
  readonly sourceCashAccountId: string;
  readonly amount: string;
  readonly schedule: InvestmentOperationSchedule;
  readonly order: number;
  readonly quantityRounding: {
    readonly scale: number;
    readonly mode: "half_even";
  };
}

export interface InvestmentCompilerRequest {
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly months?: number;
  readonly executionOwnerId: string;
  readonly transferInstructions: readonly InvestmentTransferExecutionInstruction[];
  readonly purchaseInstructions: readonly InvestmentPurchaseExecutionInstruction[];
}

export interface CompiledInvestments {
  readonly input: VerticalSlice3Input;
  readonly openingState: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
}

const GENERATED_PREFIX = "f17c0000-0000-4000-8001-";
const CAPABILITY = "investment_forecast";
const ACCOUNT_TYPES = new Set([
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
]);
const EXECUTABLE_ACCOUNT_KINDS: Readonly<Record<string, AccountKind>> =
  Object.freeze({
    checking: "checking",
    savings: "savings",
    cash: "cash",
    taxable_brokerage: "brokerage",
    traditional_401k: "retirement",
    roth_401k: "retirement",
    traditional_ira: "retirement",
    roth_ira: "retirement",
    "403b": "retirement",
    "457b": "retirement",
    sep_ira: "retirement",
    simple_ira: "retirement",
    hsa_investment: "other",
    "529": "other",
  });
const FUNDING_TYPES = new Set(["checking", "savings", "cash"]);
const INVESTMENT_TYPES = new Set([
  "equity",
  "bond",
  "fund",
  "cash",
  "real_estate",
  "option",
  "commodity",
  "crypto",
  "other",
]);
const TAX_TREATMENTS = new Set([
  "taxable",
  "tax_deferred",
  "tax_free",
  "mixed",
  "inherited",
]);
const LIQUIDITY_CLASSES = new Set([
  "liquid",
  "semi_liquid",
  "illiquid",
  "restricted",
]);
const DISTRIBUTION_TYPES = new Set([
  "normal",
  "lognormal",
  "uniform",
  "triangular",
  "discrete",
  "empirical",
  "mixture",
  "custom",
]);
const ASSUMPTION_SOURCES = new Set(["user", "historical", "external", "model"]);

const invalidResult = (
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): Extract<CompileResult<never>, { status: "invalid_model" }> => ({
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
): Extract<CompileResult<never>, { status: "unsupported" }> => ({
  status: "unsupported",
  diagnostics: Object.freeze([
    capability(
      code,
      message,
      CAPABILITY,
      entityType,
      entityId,
      fieldPath,
      relatedIds,
    ),
  ]),
});

const exactMoney = (value: unknown, currency: Currency) => {
  if (typeof value !== "string" || !EXACT_DECIMAL.test(value)) return undefined;
  try {
    return money(value, currency);
  } catch {
    return undefined;
  }
};

const reference = (
  model: PortableModelEnvelope,
  raw: unknown,
  collection: string,
  idField: string,
): string | undefined => {
  if (typeof raw !== "string" || !UUID.test(raw)) return undefined;
  const id = raw.toLowerCase();
  return objects(model, collection).some(
    (item) => canonicalId(item, idField) === id,
  )
    ? id
    : undefined;
};

const schedule = (
  value: InvestmentOperationSchedule,
  entityId: string,
  start: Instant,
  end: Instant,
): CompileResult<InvestmentSchedule> => {
  if (typeof value !== "object" || value === null)
    return invalidResult(
      "INVESTMENT_SCHEDULE_INVALID",
      "Investment operation schedule is required.",
      "InvestmentExecutionInstruction",
      entityId,
      "schedule",
    );
  if (value.kind === "explicit_dates") {
    if (!Array.isArray(value.dates) || value.dates.length === 0)
      return invalidResult(
        "INVESTMENT_SCHEDULE_INVALID",
        "Explicit investment schedules require at least one date.",
        "InvestmentExecutionInstruction",
        entityId,
        "schedule.dates",
      );
    const instants: Instant[] = [];
    const seen = new Set<string>();
    const seenMonths = new Set<string>();
    for (const date of value.dates) {
      const at = utcDate(date);
      if (
        !at ||
        seen.has(at) ||
        seenMonths.has(at.slice(0, 7)) ||
        at < start ||
        at >= end
      )
        return invalidResult(
          "INVESTMENT_SCHEDULE_INVALID",
          "Explicit investment dates must be unique, occur at most once per forecast month, and lie inside the forecast horizon.",
          "InvestmentExecutionInstruction",
          entityId,
          "schedule.dates",
        );
      seen.add(at);
      seenMonths.add(at.slice(0, 7));
      instants.push(at);
    }
    return {
      status: "compiled",
      value: Object.freeze({
        kind: "explicit_instants",
        instants: Object.freeze(instants.sort()),
      }),
      diagnostics: Object.freeze([]),
    };
  }
  if (value.kind === "utc_monthly") {
    const anchor = utcDate(value.anchor);
    if (
      !anchor ||
      value.invalidDayPolicy !== "skip" ||
      anchor.slice(0, 7) !== start.slice(0, 7)
    )
      return invalidResult(
        "INVESTMENT_SCHEDULE_INVALID",
        "Monthly investment anchors must be date-only values in the first forecast calendar month with skip policy.",
        "InvestmentExecutionInstruction",
        entityId,
        "schedule.anchor",
      );
    return {
      status: "compiled",
      value: Object.freeze({
        kind: "utc_monthly",
        anchor,
        invalidDayPolicy: "skip",
      }),
      diagnostics: Object.freeze([]),
    };
  }
  return invalidResult(
    "INVESTMENT_SCHEDULE_INVALID",
    "Investment operation schedule kind is invalid.",
    "InvestmentExecutionInstruction",
    entityId,
    "schedule.kind",
  );
};

const occurrences = (
  value: InvestmentSchedule,
  start: Instant,
  end: Instant,
): readonly Instant[] =>
  value.kind === "explicit_instants"
    ? value.instants
    : utcMonthlyOccurrences(value.anchor, { start, end }, "skip");

export const compileInvestments = (
  model: PortableModelEnvelope,
  request: InvestmentCompilerRequest,
): CompileResult<CompiledInvestments> => {
  const preflight = preflightCanonicalCollections(model, [
    "Household",
    "Person",
    "Account",
    "Investment",
    "Asset",
    "Scenario",
    "PrimitiveInstance",
    "Assumption",
    "Transaction",
    "TaxRule",
  ]);
  if (preflight.status !== "compiled") return preflight;
  const household = resolveHouseholdScope(model);
  if (household.status !== "compiled") return household;

  const asOf = utcDate(request.asOf);
  const start = utcDate(request.simulationStart);
  const end = utcDate(request.simulationEnd);
  if (!asOf || !start || !end || start >= end)
    return invalidResult(
      "FORECAST_HORIZON_INVALID",
      "Investment boundaries must be valid increasing date-only values.",
      "InvestmentCompilerRequest",
      undefined,
      "simulationStart",
    );
  const executionMonths = utcMonthlyHorizonMonths(start, end);
  if (executionMonths === undefined)
    return invalidResult(
      "FORECAST_HORIZON_MONTHLY_INVALID",
      "Investment boundaries must form an exact UTC calendar-month horizon.",
      "InvestmentCompilerRequest",
      undefined,
      "simulationStart",
    );
  if (request.months !== undefined && request.months !== executionMonths)
    return invalidResult(
      "FORECAST_MONTHS_MISMATCH",
      `Forecast months ${request.months} must equal ${executionMonths}.`,
      "InvestmentCompilerRequest",
      undefined,
      "months",
    );
  if (asOf !== start)
    return unsupportedResult(
      "INVESTMENT_OPENING_BOUNDARY_UNSUPPORTED",
      "Investment execution requires simulationStart to equal asOf because portable positions cannot be rolled across an unobserved boundary.",
      "InvestmentCompilerRequest",
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
      "InvestmentCompilerRequest",
      undefined,
      "baseCurrency",
    );
  }
  if (
    typeof request.executionOwnerId !== "string" ||
    !UUID.test(request.executionOwnerId)
  )
    return invalidResult(
      "EXECUTION_OWNER_INVALID",
      "executionOwnerId must be a Person UUID.",
      "InvestmentCompilerRequest",
      undefined,
      "executionOwnerId",
    );
  const ownerId = request.executionOwnerId.toLowerCase();
  if (!household.value.memberIds.includes(ownerId))
    return invalidResult(
      "EXECUTION_OWNER_NOT_HOUSEHOLD_MEMBER",
      "executionOwnerId must identify a Person member of the selected Household.",
      "InvestmentCompilerRequest",
      ownerId,
      "executionOwnerId",
    );

  const accounts = new Map(
    objects(model, "Account").map((item) => [
      canonicalId(item, "account_id")!,
      item,
    ]),
  );
  const investments = new Map(
    objects(model, "Investment").map((item) => [
      canonicalId(item, "investment_id")!,
      item,
    ]),
  );
  const taxRules = new Set(
    objects(model, "TaxRule").map((item) => canonicalId(item, "tax_rule_id")!),
  );
  const assets = new Set(
    objects(model, "Asset").map((item) => canonicalId(item, "asset_id")!),
  );

  // Structural/referential validation precedes every capability decision.
  for (const [id, account] of accounts) {
    if (!ACCOUNT_TYPES.has(String(account.account_type)))
      return invalidResult(
        "ACCOUNT_TYPE_INVALID",
        `Account ${id} account_type is not canonical.`,
        "Account",
        id,
        "account_type",
      );
    if (
      typeof account.owner_id !== "string" ||
      !UUID.test(account.owner_id) ||
      ![
        ...household.value.peopleById.keys(),
        household.value.householdId,
      ].includes(account.owner_id.toLowerCase())
    )
      return invalidResult(
        "OWNER_REFERENCE_INVALID",
        `Account ${id} owner_id must resolve to the selected Household or a Person.`,
        "Account",
        id,
        "owner_id",
      );
    if (typeof account.currency !== "string")
      return invalidResult(
        "ACCOUNT_CURRENCY_INVALID",
        `Account ${id} currency must be an ISO currency code.`,
        "Account",
        id,
        "currency",
      );
    try {
      Currency.of(account.currency);
    } catch {
      return invalidResult(
        "ACCOUNT_CURRENCY_INVALID",
        `Account ${id} currency is invalid.`,
        "Account",
        id,
        "currency",
      );
    }
    const opening = utcDate(account.opening_date);
    const closing =
      account.closing_date === undefined || account.closing_date === null
        ? undefined
        : utcDate(account.closing_date);
    if (
      !opening ||
      (account.closing_date !== undefined &&
        account.closing_date !== null &&
        !closing) ||
      (closing && closing < opening)
    )
      return invalidResult(
        "ACCOUNT_DATE_INVALID",
        `Account ${id} opening/closing dates are invalid.`,
        "Account",
        id,
        "opening_date",
      );
    const balance = exactMoney(
      account.opening_balance,
      Currency.of(account.currency),
    );
    if (!balance || balance.isNegative())
      return invalidResult(
        "ACCOUNT_OPENING_BALANCE_INVALID",
        `Account ${id} opening_balance must be nonnegative exact Money.`,
        "Account",
        id,
        "opening_balance",
      );
    if (
      account.tax_treatment !== undefined &&
      !TAX_TREATMENTS.has(String(account.tax_treatment))
    )
      return invalidResult(
        "ACCOUNT_TAX_TREATMENT_INVALID",
        `Account ${id} tax_treatment is not canonical.`,
        "Account",
        id,
        "tax_treatment",
      );
    if (!LIQUIDITY_CLASSES.has(String(account.liquidity_class)))
      return invalidResult(
        "ACCOUNT_LIQUIDITY_CLASS_INVALID",
        `Account ${id} liquidity_class is not canonical.`,
        "Account",
        id,
        "liquidity_class",
      );
    for (const field of [
      "fee_rule_id",
      "contribution_limit_rule_id",
    ] as const) {
      const raw = account[field];
      if (raw === undefined || raw === null) continue;
      if (
        typeof raw !== "string" ||
        !UUID.test(raw) ||
        !taxRules.has(raw.toLowerCase())
      )
        return invalidResult(
          "ACCOUNT_TAX_RULE_REFERENCE_INVALID",
          `Account ${id} ${field} must resolve to TaxRule.`,
          "Account",
          id,
          field,
        );
    }
    if (
      account.withdrawal_rule_ids !== undefined &&
      account.withdrawal_rule_ids !== null &&
      !Array.isArray(account.withdrawal_rule_ids)
    )
      return invalidResult(
        "ACCOUNT_TAX_RULE_REFERENCE_INVALID",
        `Account ${id} withdrawal_rule_ids must be an array.`,
        "Account",
        id,
        "withdrawal_rule_ids",
      );
    const seenRules = new Set<string>();
    for (const raw of (account.withdrawal_rule_ids ??
      []) as readonly unknown[]) {
      if (
        typeof raw !== "string" ||
        !UUID.test(raw) ||
        !taxRules.has(raw.toLowerCase()) ||
        seenRules.has(raw.toLowerCase())
      )
        return invalidResult(
          "ACCOUNT_TAX_RULE_REFERENCE_INVALID",
          `Account ${id} withdrawal_rule_ids must contain unique TaxRule references.`,
          "Account",
          id,
          "withdrawal_rule_ids",
        );
      seenRules.add(raw.toLowerCase());
    }
  }
  for (const [id, investment] of investments) {
    if (!INVESTMENT_TYPES.has(String(investment.investment_type)))
      return invalidResult(
        "INVESTMENT_TYPE_INVALID",
        `Investment ${id} investment_type is not canonical.`,
        "Investment",
        id,
        "investment_type",
      );
    const accountId = reference(
      model,
      investment.account_id,
      "Account",
      "account_id",
    );
    if (!accountId)
      return invalidResult(
        "INVESTMENT_ACCOUNT_REFERENCE_INVALID",
        `Investment ${id} account_id must resolve to Account.`,
        "Investment",
        id,
        "account_id",
      );
    if (
      investment.asset_id !== undefined &&
      investment.asset_id !== null &&
      (typeof investment.asset_id !== "string" ||
        !UUID.test(investment.asset_id) ||
        !assets.has(investment.asset_id.toLowerCase()))
    )
      return invalidResult(
        "INVESTMENT_ASSET_REFERENCE_INVALID",
        `Investment ${id} asset_id must resolve to Asset.`,
        "Investment",
        id,
        "asset_id",
      );
    if (
      typeof investment.quantity !== "string" ||
      !EXACT_DECIMAL.test(investment.quantity)
    )
      return invalidResult(
        "INVESTMENT_QUANTITY_INVALID",
        `Investment ${id} quantity must be an exact decimal string.`,
        "Investment",
        id,
        "quantity",
      );
    let quantity: Quantity;
    try {
      quantity = Quantity.parse(investment.quantity, SHARE);
    } catch {
      return invalidResult(
        "INVESTMENT_QUANTITY_INVALID",
        `Investment ${id} quantity is invalid.`,
        "Investment",
        id,
        "quantity",
      );
    }
    if (quantity.isNegative())
      return invalidResult(
        "INVESTMENT_QUANTITY_INVALID",
        `Investment ${id} quantity cannot be negative.`,
        "Investment",
        id,
        "quantity",
      );
    for (const field of ["price", "market_value"] as const) {
      if (investment[field] === undefined || investment[field] === null)
        continue;
      const value = exactMoney(investment[field], currency);
      if (!value || value.isNegative())
        return invalidResult(
          "INVESTMENT_VALUE_INVALID",
          `Investment ${id} ${field} must be nonnegative exact Money.`,
          "Investment",
          id,
          field,
        );
    }
    const accountCurrency = Currency.of(
      String(accounts.get(accountId)!.currency),
    );
    const openingPrice =
      investment.price === undefined || investment.price === null
        ? quantity.amount.isZero()
          ? money("0", accountCurrency)
          : undefined
        : exactMoney(investment.price, accountCurrency);
    if (!openingPrice)
      return invalidResult(
        "INVESTMENT_PRICE_REQUIRED",
        `Investment ${id} with nonzero quantity requires an exact opening price.`,
        "Investment",
        id,
        "price",
      );
    const derivedMarketValue = openingPrice.times(quantity.amount);
    const authoredMarketValue =
      investment.market_value === undefined || investment.market_value === null
        ? derivedMarketValue
        : exactMoney(investment.market_value, accountCurrency)!;
    if (!authoredMarketValue.equals(derivedMarketValue))
      return invalidResult(
        "INVESTMENT_MARKET_VALUE_INCONSISTENT",
        `Investment ${id} market_value must equal quantity times price exactly.`,
        "Investment",
        id,
        "market_value",
      );
    for (const field of ["expected_return", "volatility"] as const)
      if (
        investment[field] !== undefined &&
        investment[field] !== null &&
        (typeof investment[field] !== "string" ||
          !EXACT_DECIMAL.test(investment[field]))
      )
        return invalidResult(
          "INVESTMENT_RATE_INVALID",
          `Investment ${id} ${field} must be an exact decimal.`,
          "Investment",
          id,
          field,
        );
    if (
      investment.tax_treatment !== undefined &&
      !TAX_TREATMENTS.has(String(investment.tax_treatment))
    )
      return invalidResult(
        "INVESTMENT_TAX_TREATMENT_INVALID",
        `Investment ${id} tax_treatment is not canonical.`,
        "Investment",
        id,
        "tax_treatment",
      );
    for (const field of ["contribution_model_id", "return_model_id"] as const) {
      const raw = investment[field];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== "string" || !UUID.test(raw))
        return invalidResult(
          "INVESTMENT_PRIMITIVE_REFERENCE_INVALID",
          `Investment ${id} ${field} must be a UUID.`,
          "Investment",
          id,
          field,
        );
      const checked = validateGenericPrimitiveInstance(
        model,
        raw.toLowerCase(),
        "Investment",
        id,
        field,
      );
      if (checked.status !== "compiled") return checked;
    }
    if (
      investment.rebalancing_rule_id !== undefined &&
      investment.rebalancing_rule_id !== null &&
      (typeof investment.rebalancing_rule_id !== "string" ||
        !UUID.test(investment.rebalancing_rule_id))
    )
      return invalidResult(
        "INVESTMENT_REBALANCING_RULE_INVALID",
        `Investment ${id} rebalancing_rule_id must be a UUID.`,
        "Investment",
        id,
        "rebalancing_rule_id",
      );
  }
  for (const assumption of objects(model, "Assumption")) {
    const id = canonicalId(assumption, "assumption_id")!;
    if (!ASSUMPTION_CATEGORIES.includes(assumption.category as never))
      return invalidResult(
        "ASSUMPTION_CATEGORY_INVALID",
        `Assumption ${id} category is not canonical.`,
        "Assumption",
        id,
        "category",
      );
    if (
      typeof assumption.value !== "string" ||
      !EXACT_DECIMAL.test(assumption.value)
    )
      return invalidResult(
        "ASSUMPTION_VALUE_INVALID",
        `Assumption ${id} value must be an exact decimal.`,
        "Assumption",
        id,
        "value",
      );
    if (typeof assumption.unit !== "string" || assumption.unit.length === 0)
      return invalidResult(
        "ASSUMPTION_UNIT_INVALID",
        `Assumption ${id} unit must be a nonempty string.`,
        "Assumption",
        id,
        "unit",
      );
    if (!ASSUMPTION_SOURCES.has(String(assumption.source)))
      return invalidResult(
        "ASSUMPTION_SOURCE_INVALID",
        `Assumption ${id} source is not canonical.`,
        "Assumption",
        id,
        "source",
      );
    if (
      assumption.distribution_type !== undefined &&
      assumption.distribution_type !== null &&
      !DISTRIBUTION_TYPES.has(String(assumption.distribution_type))
    )
      return invalidResult(
        "ASSUMPTION_DISTRIBUTION_INVALID",
        `Assumption ${id} distribution_type is not canonical.`,
        "Assumption",
        id,
        "distribution_type",
      );
    if (
      assumption.confidence !== undefined &&
      assumption.confidence !== null &&
      (typeof assumption.confidence !== "string" ||
        !EXACT_DECIMAL.test(assumption.confidence))
    )
      return invalidResult(
        "ASSUMPTION_CONFIDENCE_INVALID",
        `Assumption ${id} confidence must be an exact decimal.`,
        "Assumption",
        id,
        "confidence",
      );
    for (const field of ["start_date", "end_date"] as const)
      if (
        assumption[field] !== undefined &&
        assumption[field] !== null &&
        !utcDate(assumption[field])
      )
        return invalidResult(
          "ASSUMPTION_DATE_INVALID",
          `Assumption ${id} ${field} must be date-only.`,
          "Assumption",
          id,
          field,
        );
    if (
      assumption.distribution_parameters !== undefined &&
      assumption.distribution_parameters !== null &&
      (typeof assumption.distribution_parameters !== "object" ||
        Array.isArray(assumption.distribution_parameters))
    )
      return invalidResult(
        "ASSUMPTION_DISTRIBUTION_INVALID",
        `Assumption ${id} distribution_parameters must be an object.`,
        "Assumption",
        id,
        "distribution_parameters",
      );
    const assumptionScenarioId =
      typeof assumption.scenario_id === "string" &&
      UUID.test(assumption.scenario_id)
        ? assumption.scenario_id.toLowerCase()
        : undefined;
    if (
      !assumptionScenarioId ||
      !objects(model, "Scenario").some(
        (item) => canonicalId(item, "scenario_id") === assumptionScenarioId,
      )
    )
      return invalidResult(
        "ASSUMPTION_SCENARIO_REFERENCE_INVALID",
        `Assumption ${id} scenario_id must resolve.`,
        "Assumption",
        id,
        "scenario_id",
      );
  }
  for (const primitive of objects(model, "PrimitiveInstance")) {
    const id = canonicalId(primitive, "primitive_instance_id")!;
    const checked = validateGenericPrimitiveInstance(
      model,
      id,
      "PrimitiveInstance",
      id,
      "primitive_instance_id",
    );
    if (checked.status !== "compiled") return checked;
  }

  const allInstructions = [
    ...request.transferInstructions.map((item) => ({
      type: "transfer" as const,
      item,
    })),
    ...request.purchaseInstructions.map((item) => ({
      type: "purchase" as const,
      item,
    })),
  ];
  const instructionIds = new Set<string>();
  const authoredIds = new Set<string>();
  for (const collection of Object.values(model.objects))
    for (const value of collection)
      if (typeof value === "object" && value !== null && !Array.isArray(value))
        for (const [field, raw] of Object.entries(value))
          if (
            field.endsWith("_id") &&
            typeof raw === "string" &&
            UUID.test(raw)
          )
            authoredIds.add(raw.toLowerCase());
  const compiledSchedules = new Map<string, InvestmentSchedule>();
  for (const { item } of allInstructions) {
    if (
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      instructionIds.has(item.id.toLowerCase())
    )
      return invalidResult(
        "INVESTMENT_INSTRUCTION_ID_INVALID",
        "Investment instruction IDs must be globally unique UUIDs.",
        "InvestmentExecutionInstruction",
        undefined,
        "id",
      );
    const id = item.id.toLowerCase();
    if (authoredIds.has(id))
      return invalidResult(
        "INVESTMENT_INSTRUCTION_ID_COLLISION",
        `Investment instruction ${id} collides with an authored canonical identity.`,
        "InvestmentExecutionInstruction",
        id,
        "id",
        [id],
      );
    instructionIds.add(id);
    if (!Number.isSafeInteger(item.order) || item.order < 0)
      return invalidResult(
        "INVESTMENT_OPERATION_ORDER_INVALID",
        `Investment instruction ${id} order must be a nonnegative safe integer.`,
        "InvestmentExecutionInstruction",
        id,
        "order",
      );
    const amount = exactMoney(item.amount, currency);
    if (
      !amount ||
      !amount.isPositive() ||
      !amount.amount.fitsScale(currency.minorUnitScale)
    )
      return invalidResult(
        "INVESTMENT_OPERATION_AMOUNT_INVALID",
        `Investment instruction ${id} amount must be positive base-currency Money at settlement precision.`,
        "InvestmentExecutionInstruction",
        id,
        "amount",
      );
    const parsed = schedule(item.schedule, id, start, end);
    if (parsed.status !== "compiled") return parsed;
    compiledSchedules.set(id, parsed.value);
  }

  const scenario = selectScenario(model, {
    capabilityName: CAPABILITY,
    executionLabel: "Investment",
  });
  if (scenario.status !== "compiled") return scenario;

  const referencedAccountIds = new Set<string>();
  for (const { type, item } of allInstructions) {
    if (type === "transfer") {
      for (const [field, raw] of [
        ["sourceAccountId", item.sourceAccountId],
        ["destinationAccountId", item.destinationAccountId],
      ] as const) {
        if (
          typeof raw !== "string" ||
          !UUID.test(raw) ||
          !accounts.has(raw.toLowerCase())
        )
          return invalidResult(
            "INVESTMENT_ACCOUNT_REFERENCE_INVALID",
            `Transfer ${item.id} ${field} must resolve to Account.`,
            "InvestmentTransferExecutionInstruction",
            item.id,
            field,
          );
        referencedAccountIds.add(raw.toLowerCase());
      }
      if (
        item.sourceAccountId.toLowerCase() ===
        item.destinationAccountId.toLowerCase()
      )
        return invalidResult(
          "INVESTMENT_TRANSFER_ENDPOINT_INVALID",
          `Transfer ${item.id} endpoints must differ.`,
          "InvestmentTransferExecutionInstruction",
          item.id,
          "destinationAccountId",
        );
    } else {
      if (
        typeof item.investmentId !== "string" ||
        !UUID.test(item.investmentId) ||
        !investments.has(item.investmentId.toLowerCase())
      )
        return invalidResult(
          "INVESTMENT_PURCHASE_TARGET_INVALID",
          `Purchase ${item.id} investmentId must resolve to Investment.`,
          "InvestmentPurchaseExecutionInstruction",
          item.id,
          "investmentId",
        );
      if (
        typeof item.sourceCashAccountId !== "string" ||
        !UUID.test(item.sourceCashAccountId) ||
        !accounts.has(item.sourceCashAccountId.toLowerCase())
      )
        return invalidResult(
          "INVESTMENT_ACCOUNT_REFERENCE_INVALID",
          `Purchase ${item.id} sourceCashAccountId must resolve to Account.`,
          "InvestmentPurchaseExecutionInstruction",
          item.id,
          "sourceCashAccountId",
        );
      referencedAccountIds.add(item.sourceCashAccountId.toLowerCase());
      referencedAccountIds.add(
        String(
          investments.get(item.investmentId.toLowerCase())!.account_id,
        ).toLowerCase(),
      );
      if (
        !item.quantityRounding ||
        !Number.isSafeInteger(item.quantityRounding.scale) ||
        item.quantityRounding.scale < 0 ||
        item.quantityRounding.mode !== "half_even"
      )
        return invalidResult(
          "INVESTMENT_QUANTITY_ROUNDING_INVALID",
          `Purchase ${item.id} quantityRounding is invalid.`,
          "InvestmentPurchaseExecutionInstruction",
          item.id,
          "quantityRounding",
        );
      try {
        new RoundingPolicy(
          item.quantityRounding.scale,
          item.quantityRounding.mode,
        );
      } catch {
        return invalidResult(
          "INVESTMENT_QUANTITY_ROUNDING_INVALID",
          `Purchase ${item.id} quantityRounding is invalid.`,
          "InvestmentPurchaseExecutionInstruction",
          item.id,
          "quantityRounding",
        );
      }
    }
  }

  const inScopeInvestmentIds = new Set<string>();
  for (const [id, investment] of investments) {
    const account = accounts.get(String(investment.account_id).toLowerCase())!;
    const accountOwner = String(account.owner_id).toLowerCase();
    if (accountOwner === ownerId) inScopeInvestmentIds.add(id);
    else if (accountOwner === household.value.householdId)
      return unsupportedResult(
        "HOUSEHOLD_OWNED_INVESTMENT_ACCOUNT_UNSUPPORTED",
        `Investment ${id} is held in a Household-owned account and cannot be reassigned to the execution Person.`,
        "Investment",
        id,
        "account_id",
      );
  }
  for (const id of inScopeInvestmentIds)
    referencedAccountIds.add(
      String(investments.get(id)!.account_id).toLowerCase(),
    );

  const accountStates: AuthoritativeState["accounts"] = {};
  for (const id of [...referencedAccountIds].sort()) {
    const account = accounts.get(id)!;
    if (String(account.owner_id).toLowerCase() !== ownerId)
      return unsupportedResult(
        "INVESTMENT_ACCOUNT_OWNER_UNSUPPORTED",
        `Participating Account ${id} must be owned by executionOwnerId.`,
        "Account",
        id,
        "owner_id",
      );
    const kind = EXECUTABLE_ACCOUNT_KINDS[String(account.account_type)];
    if (!kind)
      return unsupportedResult(
        "INVESTMENT_ACCOUNT_TYPE_UNSUPPORTED",
        `Account ${id} type ${String(account.account_type)} is not executable by VS3.`,
        "Account",
        id,
        "account_type",
      );
    if (account.currency !== currency.code)
      return unsupportedResult(
        "INVESTMENT_FX_UNSUPPORTED",
        `Participating Account ${id} does not use base currency ${currency.code}.`,
        "Account",
        id,
        "currency",
      );
    const opening = utcDate(account.opening_date)!;
    const closing =
      account.closing_date === undefined || account.closing_date === null
        ? undefined
        : utcDate(account.closing_date)!;
    if (opening > start || (closing !== undefined && closing < end))
      return unsupportedResult(
        "INVESTMENT_ACCOUNT_HORIZON_UNSUPPORTED",
        `Participating Account ${id} is not open for the full forecast horizon.`,
        "Account",
        id,
        "opening_date",
      );
    const behavior = inspectAccountBalanceBehavior(model, account);
    if (behavior.status === "invalid_model") return behavior;
    if (
      behavior.status === "unsupported" ||
      behavior.value.hasAuthoredBehavior ||
      behavior.value.historyCompletenessUnknown
    )
      return unsupportedResult(
        "ACCOUNT_OPENING_CASH_UNSUPPORTED",
        `Account ${id} opening cash cannot be established without replaying authored or unknown history.`,
        "Account",
        id,
        "opening_balance",
      );
    if (account.fee_rule_id !== undefined && account.fee_rule_id !== null)
      return unsupportedResult(
        "ACCOUNT_FEE_RULE_UNSUPPORTED",
        `Account ${id} fee_rule_id lacks a complete executable VS3 fee contract.`,
        "Account",
        id,
        "fee_rule_id",
      );
    accountStates[id] = {
      id: domainId("account", id),
      ownerId: domainId("person", ownerId),
      kind,
      cash: exactMoney(account.opening_balance, currency)!,
    };
  }

  const purchaseTargets = new Set(
    request.purchaseInstructions.map((item) => item.investmentId.toLowerCase()),
  );
  const positions: AuthoritativeState["positions"] = {};
  const returns: VerticalSlice3Input["returns"][number][] = [];
  const slots: string[] = [];
  for (const id of [...inScopeInvestmentIds].sort()) {
    const investment = investments.get(id)!;
    if (
      investment.expected_return !== undefined &&
      investment.expected_return !== null
    )
      return unsupportedResult(
        "INVESTMENT_EXPECTED_RETURN_UNSUPPORTED",
        `Investment ${id} expected_return has no executable rate-basis contract.`,
        "Investment",
        id,
        "expected_return",
      );
    if (investment.volatility !== undefined && investment.volatility !== null)
      return unsupportedResult(
        "INVESTMENT_STOCHASTIC_RETURN_UNSUPPORTED",
        `Investment ${id} volatility is outside deterministic VS3 execution.`,
        "Investment",
        id,
        "volatility",
      );
    if (
      investment.contribution_model_id !== undefined &&
      investment.contribution_model_id !== null
    )
      return unsupportedResult(
        "INVESTMENT_CONTRIBUTION_MODEL_UNSUPPORTED",
        `Investment ${id} contribution_model_id lacks explicit funding, schedule, amount, and order semantics.`,
        "Investment",
        id,
        "contribution_model_id",
      );
    if (
      investment.rebalancing_rule_id !== undefined &&
      investment.rebalancing_rule_id !== null
    )
      return unsupportedResult(
        "INVESTMENT_REBALANCING_RULE_UNSUPPORTED",
        `Investment ${id} rebalancing_rule_id is not executable by this milestone.`,
        "Investment",
        id,
        "rebalancing_rule_id",
      );
    if (
      investment.investment_type !== "equity" &&
      investment.investment_type !== "fund"
    )
      return unsupportedResult(
        "INVESTMENT_TYPE_UNSUPPORTED",
        `Investment ${id} type ${String(investment.investment_type)} cannot be mapped safely to share-denominated VS3 positions.`,
        "Investment",
        id,
        "investment_type",
      );
    const quantity = Quantity.parse(String(investment.quantity), SHARE);
    const accountId = String(investment.account_id).toLowerCase();
    const price =
      investment.price === undefined || investment.price === null
        ? quantity.amount.isZero()
          ? money("0", currency)
          : undefined
        : exactMoney(investment.price, currency);
    if (!price)
      return invalidResult(
        "INVESTMENT_PRICE_REQUIRED",
        `Investment ${id} with nonzero quantity requires an exact opening price.`,
        "Investment",
        id,
        "price",
      );
    const derivedValue = price.times(quantity.amount);
    const marketValue =
      investment.market_value === undefined || investment.market_value === null
        ? derivedValue
        : exactMoney(investment.market_value, currency)!;
    if (!marketValue.equals(derivedValue))
      return invalidResult(
        "INVESTMENT_MARKET_VALUE_INCONSISTENT",
        `Investment ${id} market_value must equal quantity times price exactly.`,
        "Investment",
        id,
        "market_value",
      );
    if (purchaseTargets.has(id) && !price.isPositive())
      return unsupportedResult(
        "INVESTMENT_PURCHASE_PRICE_UNSUPPORTED",
        `Purchase target Investment ${id} must have a strictly positive opening price.`,
        "Investment",
        id,
        "price",
      );
    const positionId = domainId("position", id);
    positions[positionId] = {
      id: positionId,
      accountId: domainId("account", accountId),
      quantity,
      price,
      carryingValue: marketValue,
    };
    if (
      investment.return_model_id !== undefined &&
      investment.return_model_id !== null
    )
      slots.push(`Investment:${id}:mark-to-market`);
    else if (purchaseTargets.has(id))
      return unsupportedResult(
        "INVESTMENT_PURCHASE_RETURN_MODEL_REQUIRED",
        `Purchase target Investment ${id} requires an executable return_model_id.`,
        "Investment",
        id,
        "return_model_id",
      );
  }
  for (const item of request.transferInstructions)
    slots.push(`Transfer:${item.id.toLowerCase()}:schedule`);
  for (const item of request.purchaseInstructions)
    slots.push(`Purchase:${item.id.toLowerCase()}:schedule`);
  const ids = generatedCompilerIds(model, slots, GENERATED_PREFIX, [
    ...instructionIds,
  ]);
  if (ids.status !== "compiled") return ids;

  for (const id of [...inScopeInvestmentIds].sort()) {
    const investment = investments.get(id)!;
    if (
      investment.return_model_id === undefined ||
      investment.return_model_id === null
    )
      continue;
    const primitiveId = String(investment.return_model_id).toLowerCase();
    const primitive = objects(model, "PrimitiveInstance").find(
      (item) => canonicalId(item, "primitive_instance_id") === primitiveId,
    )!;
    if (
      !primitive.enabled ||
      primitive.primitive_id !== "P23" ||
      String(primitive.scenario_id).toLowerCase() !== scenario.value.id ||
      primitive.start_date != null ||
      primitive.end_date != null ||
      Object.keys((primitive.parameters ?? {}) as object).length !== 0
    )
      return unsupportedResult(
        "INVESTMENT_RETURN_MODEL_UNSUPPORTED",
        `Investment ${id} return_model_id must be an unbounded enabled P23 in the selected Scenario with empty parameters.`,
        "Investment",
        id,
        "return_model_id",
        [primitiveId],
      );
    const bindings = primitive.input_bindings as Readonly<
      Record<string, unknown>
    >;
    if (
      Object.keys(bindings).length !== 1 ||
      typeof bindings.rate !== "string" ||
      !UUID.test(bindings.rate)
    )
      return unsupportedResult(
        "INVESTMENT_RETURN_BINDING_UNSUPPORTED",
        `Investment ${id} P23 must bind exactly rate to an Assumption UUID.`,
        "PrimitiveInstance",
        primitiveId,
        "input_bindings",
      );
    const assumptionId = bindings.rate.toLowerCase();
    const assumption = objects(model, "Assumption").find(
      (item) => canonicalId(item, "assumption_id") === assumptionId,
    );
    if (!assumption)
      return invalidResult(
        "ASSUMPTION_REFERENCE_NOT_FOUND",
        `PrimitiveInstance ${primitiveId} rate binding does not resolve to Assumption.`,
        "PrimitiveInstance",
        primitiveId,
        "input_bindings.rate",
        [assumptionId],
      );
    const listed =
      Array.isArray(scenario.value.object?.assumption_ids) &&
      (scenario.value.object!.assumption_ids as readonly unknown[]).some(
        (value) =>
          typeof value === "string" && value.toLowerCase() === assumptionId,
      );
    if (
      String(assumption.scenario_id).toLowerCase() !== scenario.value.id ||
      !listed
    )
      return invalidResult(
        "ASSUMPTION_SCENARIO_BINDING_INVALID",
        `Assumption ${assumptionId} must belong to and be listed by the selected Scenario.`,
        "Assumption",
        assumptionId,
        "scenario_id",
      );
    if (
      assumption.category !== "market_return" ||
      assumption.unit !== "effective annual rate" ||
      assumption.start_date != null ||
      assumption.end_date != null ||
      assumption.distribution_type != null ||
      assumption.distribution_parameters != null ||
      assumption.correlation_group != null
    )
      return unsupportedResult(
        "INVESTMENT_RETURN_ASSUMPTION_UNSUPPORTED",
        `Assumption ${assumptionId} must be an unbounded deterministic market_return in effective annual rate units.`,
        "Assumption",
        assumptionId,
      );
    let rate: Rate;
    try {
      rate = Rate.fromDecimal(
        String(assumption.value),
        rateConvention.effectiveAnnual(),
      );
    } catch {
      return invalidResult(
        "ASSUMPTION_VALUE_INVALID",
        `Assumption ${assumptionId} value is invalid.`,
        "Assumption",
        assumptionId,
        "value",
      );
    }
    const accountId = String(investment.account_id).toLowerCase();
    returns.push(
      Object.freeze({
        targetPositionId: domainId("position", id),
        accountId: domainId("account", accountId),
        rate,
        returnBasis: Object.freeze({
          kind: "effective_annual" as const,
          yearFraction: Object.freeze({ numerator: 1, denominator: 12 }),
          calculationRounding: new RoundingPolicy(18, "half_even"),
        }),
        timing: "end_of_period_on_opening_quantity",
        priceRounding: RoundingPolicy.currency(
          currency.minorUnitScale,
          "half_up",
        ),
        primitiveIds: Object.freeze({
          compounding: domainId("primitive-instance", primitiveId),
          markToMarket: domainId(
            "primitive-instance",
            ids.value.get(`Investment:${id}:mark-to-market`)!,
          ),
        }),
        sourceTraceRefs: Object.freeze([
          calculationTraceRef(
            calculationTraceId(`compiler:canonical:Investment:${id}`),
            undefined,
            [domainId("assumption", assumptionId)],
          ),
          calculationTraceRef(
            calculationTraceId(
              `compiler:canonical:PrimitiveInstance:${primitiveId}`,
            ),
            undefined,
            [domainId("assumption", assumptionId)],
          ),
        ]),
      }),
    );
  }

  const transfers: VerticalSlice3Input["transfers"][number][] =
    request.transferInstructions.map((item) => {
      const id = item.id.toLowerCase();
      return Object.freeze({
        id: domainId("transfer", id),
        sourceAccountId: domainId(
          "account",
          item.sourceAccountId.toLowerCase(),
        ),
        destinationAccountId: domainId(
          "account",
          item.destinationAccountId.toLowerCase(),
        ),
        amount: exactMoney(item.amount, currency)!,
        eligibilitySchedule: compiledSchedules.get(id)!,
        executionTiming: "end_of_period" as const,
        order: item.order,
        schedulePrimitiveId: domainId(
          "primitive-instance",
          ids.value.get(`Transfer:${id}:schedule`)!,
        ),
      });
    });
  const purchases: VerticalSlice3Input["purchases"][number][] = [];
  for (const item of request.purchaseInstructions) {
    const id = item.id.toLowerCase();
    const investmentId = item.investmentId.toLowerCase();
    if (!inScopeInvestmentIds.has(investmentId))
      return unsupportedResult(
        "INVESTMENT_PURCHASE_OUT_OF_SCOPE",
        `Purchase ${id} targets an Investment outside executionOwnerId scope.`,
        "InvestmentPurchaseExecutionInstruction",
        id,
        "investmentId",
      );
    const investment = investments.get(investmentId)!;
    const accountId = String(investment.account_id).toLowerCase();
    const account = accounts.get(accountId)!;
    if (
      account.contribution_limit_rule_id !== undefined &&
      account.contribution_limit_rule_id !== null
    )
      return unsupportedResult(
        "ACCOUNT_CONTRIBUTION_LIMIT_UNSUPPORTED",
        `Purchase ${id} cannot bypass Account ${accountId} contribution_limit_rule_id.`,
        "Account",
        accountId,
        "contribution_limit_rule_id",
      );
    const sourceId = item.sourceCashAccountId.toLowerCase();
    if (!FUNDING_TYPES.has(String(accounts.get(sourceId)!.account_type)))
      return unsupportedResult(
        "INVESTMENT_PURCHASE_FUNDING_ACCOUNT_UNSUPPORTED",
        `Purchase ${id} source must be checking, savings, or cash.`,
        "InvestmentPurchaseExecutionInstruction",
        id,
        "sourceCashAccountId",
      );
    purchases.push(
      Object.freeze({
        id: domainId("investment-purchase", id),
        sourceCashAccountId: domainId("account", sourceId),
        destinationAccountId: domainId("account", accountId),
        targetPositionId: domainId("position", investmentId),
        amount: exactMoney(item.amount, currency)!,
        eligibilitySchedule: compiledSchedules.get(id)!,
        executionTiming: "end_of_period" as const,
        order: item.order,
        quantityRounding: new RoundingPolicy(
          item.quantityRounding.scale,
          "half_even",
        ),
        schedulePrimitiveId: domainId(
          "primitive-instance",
          ids.value.get(`Purchase:${id}:schedule`)!,
        ),
      }),
    );
  }

  const operationTargets = [
    ...transfers.map((item) => ({
      id: item.id,
      order: item.order,
      schedule: item.eligibilitySchedule,
      targets: [
        `account:${item.sourceAccountId}`,
        `account:${item.destinationAccountId}`,
      ],
    })),
    ...purchases.map((item) => ({
      id: item.id,
      order: item.order,
      schedule: item.eligibilitySchedule,
      targets: [
        `account:${item.sourceCashAccountId}`,
        `account:${item.destinationAccountId}`,
        `position:${item.targetPositionId}`,
      ],
    })),
  ];
  const groups = new Map<string, typeof operationTargets>();
  for (const item of operationTargets)
    for (const at of occurrences(item.schedule, start, end))
      for (const target of item.targets)
        groups.set(`${at.slice(0, 7)}:${target}`, [
          ...(groups.get(`${at.slice(0, 7)}:${target}`) ?? []),
          item,
        ]);
  for (const group of groups.values()) {
    const byOrder = new Set<number>();
    for (const item of group) {
      if (byOrder.has(item.order))
        return invalidResult(
          "INVESTMENT_OPERATION_ORDER_AMBIGUOUS",
          "Operations touching a common Account or Position in the same period require distinct order values.",
          "InvestmentCompilerRequest",
          undefined,
          "order",
          group.map((value) => value.id),
        );
      byOrder.add(item.order);
    }
  }

  return {
    status: "compiled",
    value: Object.freeze({
      input: Object.freeze({
        householdId: domainId("household", household.value.householdId),
        ownerId: domainId("person", ownerId),
        baseCurrency: currency,
        valuationAccountingPolicy: "economic_only",
        ruleCatalog: Object.freeze([]),
        transfers: Object.freeze(
          transfers.sort((a, b) => a.id.localeCompare(b.id)),
        ),
        purchases: Object.freeze(
          purchases.sort((a, b) => a.id.localeCompare(b.id)),
        ),
        fees: Object.freeze([]),
        returns: Object.freeze(
          returns.sort((a, b) =>
            a.targetPositionId.localeCompare(b.targetPositionId),
          ),
        ),
      }),
      openingState: createAuthoritativeState({
        accounts: accountStates,
        positions,
      }),
      primitiveState: createPrimitiveRuntimeStateStore(),
      scenarioIdentity: scenario.value.id,
      executionMonths,
    }),
    diagnostics: Object.freeze([]),
  };
};
