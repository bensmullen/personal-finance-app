import type { LiabilityId } from "../../accounting/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../funding/index.js";
import { domainId } from "../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../lineage/index.js";
import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { fixedMortgagePayment, fixedMortgagePrincipalAfterPayments } from "../../rules/index.js";
import type {
  ExtraPrincipalPayment,
  FixedAmortizingLoan,
  VerticalSlice4Input,
} from "../../simulation/verticalSlice4.js";
import {
  createPrimitiveRuntimeStateStore,
  type PrimitiveRuntimeStateStore,
} from "../../simulation/period.js";
import {
  createAuthoritativeState,
  type AuthoritativeState,
} from "../../state/index.js";
import {
  instant,
  utcMonthlyHorizonMonths,
  utcMonthlyOccurrences,
  utcMonthlyPeriods,
  type Instant,
} from "../../time/index.js";
import {
  Currency,
  Rate,
  RoundingPolicy,
  money,
  rateConvention,
  type Money,
} from "../../values/index.js";
import { selectScenario } from "./scenarioSelection.js";
import {
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
  resolveOwnerScope,
  utcDate,
  validateGenericPrimitiveInstance,
  type CanonicalObject,
} from "./shared.js";
import type { CapabilityDiagnostic, CompileResult } from "./types.js";

export interface ExtraPrincipalExecutionInstruction {
  readonly id: string;
  readonly scheduledAt: string;
  readonly amount: string;
  readonly fundingAccountId?: string;
}

export interface LiabilityExecutionProfile {
  readonly liabilityId: string;
  readonly kind: "vs4_fixed_monthly_fully_amortizing";
  readonly paymentAnchor: string;
  readonly totalPayments: number;
  readonly fundingAccountId: string;
  readonly settlementPriority: number;
  readonly openingContractStatus: "current";
  readonly extraPrincipalPayments?: readonly ExtraPrincipalExecutionInstruction[];
}

export interface LiabilityCompilerRequest {
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly months?: number;
  readonly executionOwnerId: string;
  readonly executionProfiles: readonly LiabilityExecutionProfile[];
  readonly scenarioId?: string;
}

export interface CompiledLiabilities {
  readonly input: VerticalSlice4Input;
  readonly openingState: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly capabilityDiagnostics: readonly CapabilityDiagnostic[];
  readonly inactiveLiabilityIds: readonly string[];
  readonly scenarioBindings: Readonly<{
    loanIds: Readonly<Record<string, string>>;
    extraPrincipalPaymentIds: Readonly<Record<string, string>>;
    accountIds: Readonly<Record<string, string>>;
  }>;
}

const GENERATED_PREFIX = "f16c0000-0000-4000-8001-";
const CASH_TYPES = new Set(["checking", "savings", "cash"]);
const ACCOUNT_TYPES = new Set(["checking", "savings", "cash", "taxable_brokerage", "traditional_401k", "roth_401k", "traditional_ira", "roth_ira", "hsa", "hsa_investment", "529", "403b", "457b", "sep_ira", "simple_ira", "pension", "cash_value_insurance", "other"]);

const invalidResult = <T>(
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): CompileResult<T> => ({
  status: "invalid_model",
  diagnostics: Object.freeze([
    issue(code, message, entityType, entityId, fieldPath, relatedIds),
  ]),
});

const diagnostic = (
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): CapabilityDiagnostic =>
  capability(
    code,
    message,
    "liability_forecast",
    entityType,
    entityId,
    fieldPath,
    relatedIds,
  );

const exactMoney = (
  value: unknown,
  currency: Currency,
): Money | undefined => {
  if (typeof value !== "string" || !EXACT_DECIMAL.test(value)) return undefined;
  try {
    return money(value, currency);
  } catch {
    return undefined;
  }
};

const firstMonth = (anchor: Instant): Instant =>
  instant(`${anchor.slice(0, 8)}01T00:00:00.000Z`);

/** Enumerates the finite contract with the exact VS4 UTC-monthly skip policy. */
const contractualOccurrences = (
  anchor: Instant,
  count: number,
): readonly Instant[] => {
  const result: Instant[] = [];
  let month = firstMonth(anchor);
  while (result.length < count) {
    const period = utcMonthlyPeriods(month, 1)[0]!;
    result.push(...utcMonthlyOccurrences(anchor, period, "skip"));
    month = period.end;
  }
  return Object.freeze(result.slice(0, count));
};

const canonicalReference = (
  model: PortableModelEnvelope,
  raw: unknown,
  collection: string,
  idField: string,
): boolean =>
  typeof raw === "string" &&
  UUID.test(raw) &&
  objects(model, collection).some(
    (candidate) => canonicalId(candidate, idField) === raw.toLowerCase(),
  );

export const compileLiabilities = (
  model: PortableModelEnvelope,
  request: LiabilityCompilerRequest,
): CompileResult<CompiledLiabilities> => {
  const preflight = preflightCanonicalCollections(model, [
    "Household",
    "Person",
    "Account",
    "Liability",
    "Scenario",
    "PrimitiveInstance",
    "Assumption",
    "Event",
    "Transaction",
    "TaxRule",
    "Asset",
  ]);
  if (preflight.status !== "compiled") return preflight;
  const scopeResult = resolveHouseholdScope(model);
  if (scopeResult.status !== "compiled") return scopeResult;
  const scope = scopeResult.value;
  const simulationStart = utcDate(request.simulationStart);
  const asOf = utcDate(request.asOf);
  const simulationEnd = utcDate(request.simulationEnd);
  if (!asOf || !simulationStart || !simulationEnd || simulationStart >= simulationEnd)
    return invalidResult(
      "FORECAST_HORIZON_INVALID",
      "Liability simulation boundaries must be valid increasing date-only values.",
      "liability_compiler_request",
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
      "Liability forecast boundaries must form an exact UTC calendar-month horizon.",
      "liability_compiler_request",
      undefined,
      "simulationStart",
    );
  if (request.months !== undefined && request.months !== executionMonths)
    return invalidResult(
      "FORECAST_MONTHS_MISMATCH",
      `Forecast months ${request.months} must equal ${executionMonths}.`,
      "liability_compiler_request",
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
      "liability_compiler_request",
      undefined,
      "baseCurrency",
    );
  }
  if (typeof request.executionOwnerId !== "string" || !UUID.test(request.executionOwnerId))
    return invalidResult(
      "EXECUTION_OWNER_INVALID",
      "executionOwnerId must be a Person UUID.",
      "liability_compiler_request",
      undefined,
      "executionOwnerId",
    );
  const executionOwnerId = request.executionOwnerId.toLowerCase();
  if (!scope.memberIds.includes(executionOwnerId))
    return invalidResult(
      "EXECUTION_OWNER_NOT_HOUSEHOLD_MEMBER",
      "executionOwnerId must identify a Person member of the selected Household.",
      "liability_compiler_request",
      executionOwnerId,
      "executionOwnerId",
    );

  const scenarioResult = selectScenario(model, { capabilityName: "liability_forecast", executionLabel: "Liability", ...(request.scenarioId === undefined ? {} : { scenarioId: request.scenarioId }), simulationStart: request.simulationStart, simulationEnd: request.simulationEnd });
  if (scenarioResult.status !== "compiled") return scenarioResult;
  const selectedScenario = scenarioResult.value;
  const allLiabilities = objects(model, "Liability");
  const liabilityById = new Map(
    allLiabilities.map((value) => [canonicalId(value, "liability_id")!, value]),
  );
  const accounts = objects(model, "Account");
  const accountById = new Map(
    accounts.map((value) => [canonicalId(value, "account_id")!, value]),
  );

  // Structural and referential errors are hard failures, independent of capability order.
  for (const liability of allLiabilities) {
    const id = canonicalId(liability, "liability_id")!;
    const owner = resolveOwnerScope(model, liability.owner_id, scope, "Liability", id);
    if (owner.status !== "compiled") return owner;
    for (const field of ["principal", "current_balance", "interest_rate"] as const) {
      const value = exactMoney(liability[field], currency);
      if (!value)
        return invalidResult(
          field === "interest_rate" ? "LIABILITY_RATE_INVALID" : "LIABILITY_MONEY_INVALID",
          `Liability ${id} ${field} must be an exact decimal string.`,
          "Liability",
          id,
          field,
        );
      if (value.isNegative())
        return invalidResult(
          field === "interest_rate" ? "LIABILITY_RATE_INVALID" : "LIABILITY_MONEY_INVALID",
          `Liability ${id} ${field} cannot be negative.`,
          "Liability",
          id,
          field,
        );
    }
    for (const field of ["scheduled_payment", "minimum_payment", "extra_payment"] as const) {
      if (liability[field] === undefined || liability[field] === null) continue;
      const value = exactMoney(liability[field], currency);
      if (!value || value.isNegative())
        return invalidResult(
          "LIABILITY_MONEY_INVALID",
          `Liability ${id} ${field} must be non-negative exact Money when present.`,
          "Liability",
          id,
          field,
        );
    }
    const originated = utcDate(liability.origination_date);
    if (!originated)
      return invalidResult("LIABILITY_DATE_INVALID", `Liability ${id} origination_date is invalid.`, "Liability", id, "origination_date");
    if (liability.maturity_date !== undefined && liability.maturity_date !== null) {
      const maturity = utcDate(liability.maturity_date);
      if (!maturity)
        return invalidResult("LIABILITY_DATE_INVALID", `Liability ${id} maturity_date is invalid.`, "Liability", id, "maturity_date");
      if (maturity <= originated)
        return invalidResult("LIABILITY_DATE_INVALID", `Liability ${id} maturity_date must follow origination_date.`, "Liability", id, "maturity_date");
    }
    if (!( ["mortgage", "auto", "student", "credit_card", "personal", "heloc", "business", "tax", "other"] as const).includes(liability.liability_type as never))
      return invalidResult("LIABILITY_TYPE_INVALID", `Liability ${id} liability_type is not canonical.`, "Liability", id, "liability_type");
    if (!( ["fixed", "variable", "indexed"] as const).includes(liability.rate_type as never))
      return invalidResult("LIABILITY_RATE_TYPE_INVALID", `Liability ${id} rate_type is not canonical.`, "Liability", id, "rate_type");
    if (!( ["daily", "weekly", "biweekly", "semimonthly", "monthly", "bimonthly", "quarterly", "semiannual", "annual", "irregular"] as const).includes(liability.payment_frequency as never))
      return invalidResult("LIABILITY_PAYMENT_FREQUENCY_INVALID", `Liability ${id} payment_frequency is not canonical.`, "Liability", id, "payment_frequency");
    for (const [field, collection, idField] of [
      ["amortization_model_id", "PrimitiveInstance", "primitive_instance_id"],
      ["fee_rule_id", "TaxRule", "tax_rule_id"],
      ["prepayment_rule_id", "TaxRule", "tax_rule_id"],
      ["collateral_id", "Asset", "asset_id"],
    ] as const) {
      const raw = liability[field];
      if (raw === undefined || raw === null) continue;
      if (!canonicalReference(model, raw, collection, idField))
        return invalidResult(
          "LIABILITY_REFERENCE_INVALID",
          `Liability ${id} ${field} must resolve to ${collection}.`,
          "Liability",
          id,
          field,
          typeof raw === "string" ? [raw] : undefined,
        );
    }
  }

  const profiles = new Map<string, LiabilityExecutionProfile>();
  const globalExtraIds = new Set<string>();
  for (const profile of request.executionProfiles) {
    if (typeof profile.liabilityId !== "string" || !UUID.test(profile.liabilityId))
      return invalidResult("LIABILITY_PROFILE_ID_INVALID", "Execution profile liabilityId must be a UUID.", "LiabilityExecutionProfile", undefined, "liabilityId");
    const id = profile.liabilityId.toLowerCase();
    if (!liabilityById.has(id))
      return invalidResult("LIABILITY_PROFILE_REFERENCE_NOT_FOUND", `Execution profile ${id} does not resolve to a Liability.`, "LiabilityExecutionProfile", id, "liabilityId", [id]);
    if (profiles.has(id))
      return invalidResult("DUPLICATE_LIABILITY_PROFILE", `Liability ${id} has more than one execution profile.`, "LiabilityExecutionProfile", id, "liabilityId");
    if (!utcDate(profile.paymentAnchor))
      return invalidResult("LIABILITY_PROFILE_DATE_INVALID", `Liability ${id} paymentAnchor must be date-only.`, "LiabilityExecutionProfile", id, "paymentAnchor");
    if (!Number.isSafeInteger(profile.totalPayments) || profile.totalPayments <= 0)
      return invalidResult("LIABILITY_PROFILE_TERM_INVALID", `Liability ${id} totalPayments must be a positive safe integer.`, "LiabilityExecutionProfile", id, "totalPayments");
    if (!Number.isSafeInteger(profile.settlementPriority) || profile.settlementPriority < 0)
      return invalidResult("LIABILITY_PROFILE_PRIORITY_INVALID", `Liability ${id} settlementPriority must be a non-negative safe integer.`, "LiabilityExecutionProfile", id, "settlementPriority");
    if (profile.openingContractStatus !== "current")
      return invalidResult("LIABILITY_PROFILE_STATUS_INVALID", `Liability ${id} openingContractStatus must be current.`, "LiabilityExecutionProfile", id, "openingContractStatus");
    if (typeof profile.fundingAccountId !== "string" || !UUID.test(profile.fundingAccountId))
      return invalidResult("LIABILITY_FUNDING_ACCOUNT_INVALID", `Liability ${id} fundingAccountId must be an Account UUID.`, "LiabilityExecutionProfile", id, "fundingAccountId");
    if (!accountById.has(profile.fundingAccountId.toLowerCase()))
      return invalidResult("LIABILITY_FUNDING_ACCOUNT_NOT_FOUND", `Liability ${id} fundingAccountId does not resolve to an Account.`, "LiabilityExecutionProfile", id, "fundingAccountId", [profile.fundingAccountId.toLowerCase()]);
    const seenExtraIds = new Set<string>();
    const seenExtraDates = new Set<string>();
    for (const extra of profile.extraPrincipalPayments ?? []) {
      if (typeof extra.id !== "string" || !UUID.test(extra.id) || seenExtraIds.has(extra.id.toLowerCase()) || globalExtraIds.has(extra.id.toLowerCase()))
        return invalidResult("EXTRA_PRINCIPAL_ID_INVALID", `Liability ${id} extra-principal IDs must be unique UUIDs.`, "LiabilityExecutionProfile", id, "extraPrincipalPayments.id");
      seenExtraIds.add(extra.id.toLowerCase());
      globalExtraIds.add(extra.id.toLowerCase());
      if (!utcDate(extra.scheduledAt) || seenExtraDates.has(extra.scheduledAt))
        return invalidResult("EXTRA_PRINCIPAL_DATE_INVALID", `Liability ${id} extra-principal dates must be valid and unique.`, "LiabilityExecutionProfile", id, "extraPrincipalPayments.scheduledAt");
      seenExtraDates.add(extra.scheduledAt);
      const amount = exactMoney(extra.amount, currency);
      if (!amount || !amount.isPositive() || !amount.amount.fitsScale(currency.minorUnitScale))
        return invalidResult("EXTRA_PRINCIPAL_AMOUNT_INVALID", `Liability ${id} extra principal must be positive Money at settlement precision.`, "LiabilityExecutionProfile", id, "extraPrincipalPayments.amount");
      if (extra.fundingAccountId !== undefined && (!UUID.test(extra.fundingAccountId) || !accountById.has(extra.fundingAccountId.toLowerCase())))
        return invalidResult("LIABILITY_FUNDING_ACCOUNT_INVALID", `Liability ${id} extra-principal funding account must resolve.`, "LiabilityExecutionProfile", id, "extraPrincipalPayments.fundingAccountId");
    }
    profiles.set(id, profile);
  }

  const slots: string[] = [];
  for (const id of liabilityById.keys()) {
    slots.push(`Liability:${id}:loan`, `Liability:${id}:interest`, `Liability:${id}:schedule`, `Liability:${id}:accrual`, `Liability:${id}:funding`);
    const liability = liabilityById.get(id)!;
    if (liability.amortization_model_id === undefined || liability.amortization_model_id === null)
      slots.push(`Liability:${id}:amortization`);
    for (const extra of profiles.get(id)?.extraPrincipalPayments ?? []) {
      const extraId = extra.id.toLowerCase();
      slots.push(`Liability:${id}:extra:${extraId}:primitive`, `Liability:${id}:extra:${extraId}:funding`);
    }
  }
  const idsResult = generatedCompilerIds(model, slots, GENERATED_PREFIX, [...globalExtraIds]);
  if (idsResult.status !== "compiled") return idsResult;
  const generated = idsResult.value;
  const diagnostics: CapabilityDiagnostic[] = [];
  const inactiveLiabilityIds: string[] = [];
  const loans: FixedAmortizingLoan[] = [];
  const accountStates: AuthoritativeState["accounts"] = {};
  const liabilityStates: AuthoritativeState["liabilities"] = {};
  const primitiveEntries: Record<string, PrimitiveRuntimeStateStore[string]> = {};
  const occurrenceSets = new Map<string, Set<string>>();
  const fundingIds = new Map<string, Set<string>>();
  const postingRounding = RoundingPolicy.currency(currency.minorUnitScale, "half_up");

  const gate = (value: CapabilityDiagnostic): void => {
    diagnostics.push(Object.freeze(value));
  };
  // Keep the capability boundary identical for required funding and an
  // alternate extra-principal source. Structural parsing remains at the
  // caller so its field-specific invalid-model diagnostic is retained.
  const fundingCapabilityReasons = (
    account: CanonicalObject,
    owner: "in_scope" | "out_of_scope",
    opening: string,
    closing: string | undefined,
    behavior: ReturnType<typeof inspectAccountBalanceBehavior>,
  ): readonly ("scope" | "type" | "currency" | "opening" | "closing" | "history")[] => Object.freeze([
    ...(owner === "out_of_scope" ? ["scope" as const] : []),
    ...(!CASH_TYPES.has(String(account.account_type)) ? ["type" as const] : []),
    ...(account.currency !== currency.code ? ["currency" as const] : []),
    ...(opening > simulationStart ? ["opening" as const] : []),
    ...(closing !== undefined && closing < simulationEnd ? ["closing" as const] : []),
    ...(behavior.status === "unsupported" || (behavior.status === "compiled" && (behavior.value.hasAuthoredBehavior || behavior.value.historyCompletenessUnknown)) ? ["history" as const] : []),
  ]);

  for (const liability of [...allLiabilities].sort((a, b) =>
    String(a.liability_id).localeCompare(String(b.liability_id)),
  )) {
    const id = canonicalId(liability, "liability_id")!;
    const owner = resolveOwnerScope(model, liability.owner_id, scope, "Liability", id);
    if (owner.status !== "compiled") return owner;
    if (owner.value === "out_of_scope") continue;
    const originalPrincipal = exactMoney(liability.principal, currency)!;
    const currentPrincipal = exactMoney(liability.current_balance, currency)!;
    let supported = true;
    const reject = (value: CapabilityDiagnostic): void => {
      gate(value);
      supported = false;
    };
    const origination = utcDate(liability.origination_date)!;
    if (origination > simulationStart) {
      reject(diagnostic("LIABILITY_FUTURE_ORIGINATION_UNSUPPORTED", `Liability ${id} originates after the forecast opening and requires issuance/new-draw semantics.`, "Liability", id, "origination_date"));
      continue;
    }
    if (currentPrincipal.isZero()) {
      inactiveLiabilityIds.push(id);
      continue;
    }
    const ownerId = String(liability.owner_id).toLowerCase();
    if (ownerId !== scope.householdId && ownerId !== executionOwnerId)
      reject(diagnostic("LIABILITY_OWNER_UNSUPPORTED", `Liability ${id} belongs to a different Household member than executionOwnerId.`, "Liability", id, "owner_id", [executionOwnerId]));
    if (simulationStart !== asOf) {
      gate(diagnostic("LIABILITY_OPENING_BOUNDARY_UNSUPPORTED", `Liability ${id} cannot be rolled between observed as-of ${request.asOf} and simulation opening ${request.simulationStart} in PR 16.`, "Liability", id, "current_balance"));
      continue;
    }
    // Intrinsic capability gates apply only to active, already-originated contracts.
    if (liability.liability_type !== "mortgage")
      reject(diagnostic("LIABILITY_TYPE_UNSUPPORTED", `Liability ${id} type ${String(liability.liability_type)} is not supported by mortgage-specific VS4 accounting.`, "Liability", id, "liability_type"));
    if (liability.rate_type !== "fixed")
      reject(diagnostic("LIABILITY_RATE_STRUCTURE_UNSUPPORTED", `Liability ${id} requires a fixed rate.`, "Liability", id, "rate_type"));
    if (liability.payment_frequency !== "monthly")
      reject(diagnostic("LIABILITY_PAYMENT_FREQUENCY_UNSUPPORTED", `Liability ${id} requires monthly payments.`, "Liability", id, "payment_frequency"));
    if (currentPrincipal.compare(originalPrincipal) > 0)
      reject(diagnostic("LIABILITY_NEW_DRAWS_UNSUPPORTED", `Liability ${id} current balance exceeds original principal.`, "Liability", id, "current_balance"));
    if (liability.fee_rule_id !== undefined && liability.fee_rule_id !== null)
      reject(diagnostic("LIABILITY_FEE_RULE_UNSUPPORTED", `Liability ${id} has an authored fee rule VS4 cannot execute.`, "Liability", id, "fee_rule_id"));
    if (liability.prepayment_rule_id !== undefined && liability.prepayment_rule_id !== null)
      reject(diagnostic("LIABILITY_PREPAYMENT_RULE_UNSUPPORTED", `Liability ${id} has an authored prepayment rule VS4 cannot execute.`, "Liability", id, "prepayment_rule_id"));
    const canonicalExtra = liability.extra_payment === undefined || liability.extra_payment === null
      ? money("0", currency)
      : exactMoney(liability.extra_payment, currency)!;
    if (canonicalExtra.isPositive())
      reject(diagnostic("LIABILITY_CONDITIONAL_EXTRA_PAYMENT_UNSUPPORTED", `Liability ${id} has a nonzero conditional canonical extra_payment without executable timing semantics.`, "Liability", id, "extra_payment"));
    const profile = profiles.get(id);
    if (!profile) {
      if (supported)
        gate(diagnostic("LIABILITY_EXECUTION_PROFILE_REQUIRED", `Liability ${id} requires an explicit execution profile.`, "Liability", id, "executionProfile"));
      continue;
    }
    if (profile.kind !== "vs4_fixed_monthly_fully_amortizing")
      reject(diagnostic("LIABILITY_RATE_CONVENTION_UNSUPPORTED", `Liability ${id} execution profile kind is unsupported.`, "LiabilityExecutionProfile", id, "kind"));
    const anchor = utcDate(profile.paymentAnchor)!;
    if (anchor < origination)
      return invalidResult("LIABILITY_PAYMENT_ANCHOR_INVALID", `Liability ${id} paymentAnchor cannot precede origination_date.`, "LiabilityExecutionProfile", id, "paymentAnchor", [id]);
    const contractOccurrences = contractualOccurrences(anchor, profile.totalPayments);
    occurrenceSets.set(id, new Set(contractOccurrences));
    if (liability.maturity_date !== undefined && liability.maturity_date !== null) {
      const maturity = utcDate(liability.maturity_date)!;
      if (maturity !== contractOccurrences[contractOccurrences.length - 1])
        reject(diagnostic("LIABILITY_MATURITY_SCHEDULE_MISMATCH", `Liability ${id} maturity_date does not equal the final contractual payment occurrence.`, "Liability", id, "maturity_date"));
    }
    const priorOccurrences = contractOccurrences.filter((at) => at < simulationStart).length;
    if (priorOccurrences >= profile.totalPayments)
      reject(diagnostic("LIABILITY_POST_MATURITY_UNSUPPORTED", `Liability ${id} remains positive after all contractual occurrences.`, "Liability", id, "current_balance"));
    if (priorOccurrences === 0 && currentPrincipal.compare(originalPrincipal) < 0)
        reject(diagnostic("LIABILITY_UNEXPLAINED_HISTORY_UNSUPPORTED", `Liability ${id} balance is below original principal before its first contractual payment.`, "Liability", id, "current_balance"));
    const annualRate = Rate.fromDecimal(String(liability.interest_rate), rateConvention.nominalAnnual(12));
    const compatibleOpeningPrincipal = fixedMortgagePrincipalAfterPayments(originalPrincipal, annualRate, profile.totalPayments, priorOccurrences, postingRounding);
    if (currentPrincipal.compare(compatibleOpeningPrincipal) > 0)
      reject(diagnostic("LIABILITY_OPENING_HISTORY_UNSUPPORTED", `Liability ${id} current balance exceeds the fixed no-recast contractual balance at the forecast opening.`, "Liability", id, "current_balance"));
    let amortizationId: string;
    if (liability.amortization_model_id !== undefined && liability.amortization_model_id !== null) {
      amortizationId = String(liability.amortization_model_id).toLowerCase();
      const primitiveResult = validateGenericPrimitiveInstance(model, amortizationId, "Liability", id, "amortization_model_id");
      if (primitiveResult.status !== "compiled") return primitiveResult;
      const primitive = primitiveResult.value;
      if (primitive.enabled !== true)
        reject(diagnostic("LIABILITY_AMORTIZATION_PRIMITIVE_DISABLED", `Liability ${id} amortization PrimitiveInstance is disabled.`, "PrimitiveInstance", amortizationId, "enabled", [id]));
      if (String(primitive.scenario_id).toLowerCase() !== selectedScenario.id)
        reject(diagnostic("LIABILITY_AMORTIZATION_SCENARIO_UNSUPPORTED", `Liability ${id} amortization PrimitiveInstance is outside the selected Scenario.`, "PrimitiveInstance", amortizationId, "scenario_id", [selectedScenario.id]));
      if (primitive.primitive_id !== "P22")
        reject(diagnostic("LIABILITY_AMORTIZATION_PRIMITIVE_UNSUPPORTED", `Liability ${id} amortization PrimitiveInstance must be P22.`, "PrimitiveInstance", amortizationId, "primitive_id"));
      const nonEmpty = (value: unknown): boolean => typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
      if (nonEmpty(primitive.input_bindings) || nonEmpty(primitive.parameters) || primitive.start_date !== undefined || primitive.end_date !== undefined)
        reject(diagnostic("LIABILITY_AMORTIZATION_CONFIGURATION_UNSUPPORTED", `Liability ${id} authored P22 configuration is not inert.`, "PrimitiveInstance", amortizationId, "input_bindings", [id]));
    } else {
      amortizationId = generated.get(`Liability:${id}:amortization`)!;
    }
    const fundingAccountId = profile.fundingAccountId.toLowerCase();
    const fundingAccount = accountById.get(fundingAccountId)!;
    if (!ACCOUNT_TYPES.has(String(fundingAccount.account_type)))
      return invalidResult("ACCOUNT_TYPE_INVALID", `Account ${fundingAccountId} account_type is not canonical.`, "Account", fundingAccountId, "account_type");
    const fundingOwner = resolveOwnerScope(model, fundingAccount.owner_id, scope, "Account", fundingAccountId);
    if (fundingOwner.status !== "compiled") return fundingOwner;
    if (typeof fundingAccount.currency !== "string" || !/^[A-Z]{3}$/.test(fundingAccount.currency))
      return invalidResult("ACCOUNT_CURRENCY_INVALID", `Account ${fundingAccountId} currency is invalid.`, "Account", fundingAccountId, "currency");
    const accountBalance = exactMoney(fundingAccount.opening_balance, currency);
    if (!accountBalance || accountBalance.isNegative())
      return invalidResult("ACCOUNT_BALANCE_INVALID", `Account ${fundingAccountId} opening_balance must be non-negative exact Money.`, "Account", fundingAccountId, "opening_balance");
    const accountOpening = utcDate(fundingAccount.opening_date);
    if (!accountOpening)
      return invalidResult("ACCOUNT_DATE_INVALID", `Account ${fundingAccountId} opening_date is invalid.`, "Account", fundingAccountId, "opening_date");
    if (fundingAccount.closing_date !== undefined && fundingAccount.closing_date !== null) {
      const closing = utcDate(fundingAccount.closing_date);
      if (!closing || closing < accountOpening)
        return invalidResult("ACCOUNT_DATE_INVALID", `Account ${fundingAccountId} closing_date is invalid.`, "Account", fundingAccountId, "closing_date");
    }
    const behavior = inspectAccountBalanceBehavior(model, fundingAccount);
    if (behavior.status === "invalid_model") return behavior;
    for (const reason of fundingCapabilityReasons(fundingAccount, fundingOwner.value, accountOpening, fundingAccount.closing_date === undefined || fundingAccount.closing_date === null ? undefined : utcDate(fundingAccount.closing_date)!, behavior)) {
      const details = reason === "scope" ? ["LIABILITY_FUNDING_ACCOUNT_OUT_OF_SCOPE", "funding Account is outside Household scope.", "owner_id"] as const
        : reason === "type" ? ["LIABILITY_FUNDING_ACCOUNT_TYPE_UNSUPPORTED", "funding Account is not checking, savings, or cash.", "account_type"] as const
        : reason === "currency" ? ["LIABILITY_FUNDING_ACCOUNT_CURRENCY_UNSUPPORTED", "funding Account currency differs from the run.", "currency"] as const
        : reason === "opening" ? ["LIABILITY_FUNDING_ACCOUNT_LIFECYCLE_UNSUPPORTED", "funding Account does not exist at forecast opening.", "opening_date"] as const
        : reason === "closing" ? ["LIABILITY_FUNDING_ACCOUNT_LIFECYCLE_UNSUPPORTED", "funding Account closes inside the forecast horizon.", "closing_date"] as const
        : ["LIABILITY_FUNDING_BALANCE_AUTHORITY_UNSUPPORTED", "funding Account has balance-changing behavior the liability slice cannot replay.", "transaction_ids"] as const;
      reject(diagnostic(details[0], `Liability ${id} ${details[1]}`, "Account", fundingAccountId, details[2], [id]));
    }
    const extras: ExtraPrincipalPayment[] = [];
    for (const extra of profile.extraPrincipalPayments ?? []) {
      const extraId = extra.id.toLowerCase();
      const scheduledAt = utcDate(extra.scheduledAt)!;
      if (!contractOccurrences.includes(scheduledAt)) {
        reject(diagnostic("EXTRA_PRINCIPAL_OCCURRENCE_UNSUPPORTED", `Liability ${id} extra principal does not coincide with a contractual payment occurrence.`, "LiabilityExecutionProfile", id, "extraPrincipalPayments.scheduledAt", [extra.id]));
        continue;
      }
      const extraFundingId = (extra.fundingAccountId ?? profile.fundingAccountId).toLowerCase();
      const extraFundingSources = fundingIds.get(id) ?? new Set<string>();
      extraFundingSources.add(extraFundingId);
      fundingIds.set(id, extraFundingSources);
      const extraAccount = accountById.get(extraFundingId)!;
      if (extraFundingId !== fundingAccountId) {
        if (!ACCOUNT_TYPES.has(String(extraAccount.account_type)))
          return invalidResult("ACCOUNT_TYPE_INVALID", `Account ${extraFundingId} account_type is not canonical.`, "Account", extraFundingId, "account_type", [extra.id]);
        const extraOwner = resolveOwnerScope(model, extraAccount.owner_id, scope, "Account", extraFundingId);
        if (extraOwner.status !== "compiled") return extraOwner;
        const extraOpening = utcDate(extraAccount.opening_date);
        const extraBalance = exactMoney(extraAccount.opening_balance, currency);
        const extraClosing = extraAccount.closing_date === undefined || extraAccount.closing_date === null ? undefined : utcDate(extraAccount.closing_date);
        if (typeof extraAccount.currency !== "string" || !/^[A-Z]{3}$/.test(extraAccount.currency))
          return invalidResult("ACCOUNT_CURRENCY_INVALID", `Account ${extraFundingId} currency is invalid.`, "Account", extraFundingId, "currency", [extra.id]);
        if (!extraOpening || !extraBalance || extraBalance.isNegative() || (extraAccount.closing_date !== undefined && extraAccount.closing_date !== null && (!extraClosing || extraClosing < extraOpening)))
          return invalidResult("LIABILITY_FUNDING_ACCOUNT_INVALID", `Liability ${id} extra-principal funding Account has invalid date or Money fields.`, "Account", extraFundingId, undefined, [extra.id]);
        const extraBehavior = inspectAccountBalanceBehavior(model, extraAccount);
        if (extraBehavior.status === "invalid_model") return extraBehavior;
        if (fundingCapabilityReasons(extraAccount, extraOwner.value, extraOpening, extraClosing, extraBehavior).length > 0)
          reject(diagnostic("LIABILITY_EXTRA_FUNDING_ACCOUNT_UNSUPPORTED", `Liability ${id} extra-principal funding Account is not executable.`, "Account", extraFundingId, undefined, [extra.id]));
        else {
          const extraAccountId = domainId("account", extraFundingId);
          accountStates[extraAccountId] ??= {
            id: extraAccountId,
            kind: String(extraAccount.account_type) as "checking" | "savings" | "cash",
            ownerId: domainId(String(extraAccount.owner_id).toLowerCase() === scope.householdId ? "household" : "person", String(extraAccount.owner_id).toLowerCase()),
            cash: extraBalance,
          };
        }
      }
      const extraPolicy = createFundingPolicy({
        id: fundingPolicyId(`compiler:liability-extra:${generated.get(`Liability:${id}:extra:${extraId}:funding`)!}`),
        orderedSources: [{ kind: "cash_account", accountId: domainId("account", extraFundingId) }],
        allowPartial: false,
        insufficientFundsBehavior: "unfunded",
      });
      extras.push(Object.freeze({
        id: domainId("extra-principal-payment", extraId),
        scheduledAt,
        amount: exactMoney(extra.amount, currency)!,
        fundingPolicy: extraPolicy,
        primitiveInstanceId: domainId("primitive-instance", generated.get(`Liability:${id}:extra:${extraId}:primitive`)!),
        sourceTraceRefs: Object.freeze([calculationTraceRef(calculationTraceId(`compiler:canonical:Liability:${id}:extra:${extraId}`))]),
      }));
    }
    if (!supported) continue;
    const interestId = domainId("liability", generated.get(`Liability:${id}:interest`)!);
    const loanId = domainId("loan-contract", generated.get(`Liability:${id}:loan`)!);
    const scheduleId = domainId("primitive-instance", generated.get(`Liability:${id}:schedule`)!);
    const accrualId = domainId("primitive-instance", generated.get(`Liability:${id}:accrual`)!);
    const principalId = domainId("liability", id) as LiabilityId;
    const policy = createFundingPolicy({
      id: fundingPolicyId(`compiler:liability:${generated.get(`Liability:${id}:funding`)!}`),
      orderedSources: [{ kind: "cash_account", accountId: domainId("account", fundingAccountId) }],
      allowPartial: false,
      insufficientFundsBehavior: "unfunded",
    });
    const primaryFundingSources = fundingIds.get(id) ?? new Set<string>();
    primaryFundingSources.add(fundingAccountId);
    fundingIds.set(id, primaryFundingSources);
    loans.push(Object.freeze({
      id: loanId,
      ownerId: domainId(ownerId === scope.householdId ? "household" : "person", ownerId),
      principalLiabilityId: principalId,
      interestPayableLiabilityId: interestId,
      originalPrincipal,
      annualRate,
      totalPayments: profile.totalPayments,
      rateType: "fixed",
      paymentFrequency: "monthly",
      interestConvention: "nominal_annual_12",
      amortization: "fully_amortizing",
      paymentResetPolicy: "fixed_no_recast",
      interestCapitalization: "none",
      partialPaymentPolicy: "all_or_nothing",
      paymentSchedule: Object.freeze({ kind: "utc_monthly", anchor, invalidDayPolicy: "skip" }),
      fundingPolicy: policy,
      settlementPriority: profile.settlementPriority,
      extraPrincipalPayments: Object.freeze([...extras].sort((left, right) =>
        left.scheduledAt.localeCompare(right.scheduledAt) || left.id.localeCompare(right.id),
      )),
      postingRounding,
      primitiveIds: Object.freeze({ schedule: scheduleId, amortization: domainId("primitive-instance", amortizationId), accrual: accrualId }),
      sourceTraceRefs: Object.freeze([calculationTraceRef(calculationTraceId(`compiler:canonical:Liability:${id}`))]),
    }));
    const accountId = domainId("account", fundingAccountId);
    accountStates[accountId] ??= {
      id: accountId,
      kind: String(fundingAccount.account_type) as "checking" | "savings" | "cash",
      ownerId: domainId(String(fundingAccount.owner_id).toLowerCase() === scope.householdId ? "household" : "person", String(fundingAccount.owner_id).toLowerCase()),
      cash: accountBalance,
    };
    liabilityStates[principalId] = { id: principalId, balance: currentPrincipal };
    liabilityStates[interestId] = { id: interestId, balance: money("0", currency) };
    if (priorOccurrences > 0 || currentPrincipal.compare(originalPrincipal) < 0) {
      primitiveEntries[domainId("primitive-instance", amortizationId)] = {
        primitiveId: "P22",
        state: Object.freeze({
          evaluations: priorOccurrences,
          contractualPayment: fixedMortgagePayment(originalPrincipal, annualRate, profile.totalPayments, postingRounding),
          originalPrincipal,
          totalPayments: profile.totalPayments,
        }),
      };
      primitiveEntries[accrualId] = {
        primitiveId: "P24",
        state: Object.freeze({ evaluations: priorOccurrences }),
      };
    }
  }

  // Ensure compiler success cannot defer stable identity errors to VS4.
  const stableIds = loans.flatMap((loan) => [
    loan.id,
    loan.primitiveIds.schedule,
    loan.primitiveIds.amortization,
    loan.primitiveIds.accrual,
    ...(loan.extraPrincipalPayments ?? []).flatMap((extra) => [extra.id, extra.primitiveInstanceId]),
  ]);
  const duplicateStableId = stableIds.find((id, index) => stableIds.indexOf(id) !== index);
  if (duplicateStableId !== undefined)
    return invalidResult(
      "LIABILITY_STABLE_ID_COLLISION",
      `Compiled liability stable identity ${duplicateStableId} is not globally unique.`,
      "LiabilityExecutionProfile",
      duplicateStableId,
    );

  // Match VS4's narrow, horizon-bound priority rule. Required and voluntary
  // funding are independently ordered; sharing between those categories is valid.
  const conflictedLoanIds = new Set<string>();
  for (let left = 0; left < loans.length; left += 1)
    for (let right = left + 1; right < loans.length; right += 1) {
      const a = loans[left]!;
      const b = loans[right]!;
      const aCanonical = allLiabilities.find((item) => canonicalId(item, "liability_id") === a.principalLiabilityId)!;
      const bCanonical = allLiabilities.find((item) => canonicalId(item, "liability_id") === b.principalLiabilityId)!;
      const aId = canonicalId(aCanonical, "liability_id")!;
      const bId = canonicalId(bCanonical, "liability_id")!;
      if (a.settlementPriority !== b.settlementPriority) continue;
      const insideHorizon = (at: string): boolean => at >= simulationStart && at < simulationEnd;
      const requiredOverlap = [...occurrenceSets.get(aId)!].some((at) =>
        insideHorizon(at) && occurrenceSets.get(bId)!.has(at),
      );
      const requiredConflict = requiredOverlap && a.fundingPolicy.orderedSources.some((source) =>
        b.fundingPolicy.orderedSources.some((other) => other.accountId === source.accountId),
      );
      const extraConflict = (a.extraPrincipalPayments ?? []).some((extra) =>
        insideHorizon(extra.scheduledAt) && (b.extraPrincipalPayments ?? []).some((other) =>
          other.scheduledAt === extra.scheduledAt && extra.fundingPolicy.orderedSources.some((source) =>
            other.fundingPolicy.orderedSources.some((otherSource) => otherSource.accountId === source.accountId),
          ),
        ),
      );
      if (!requiredConflict && !extraConflict) continue;
      gate(diagnostic("LIABILITY_SETTLEMENT_PRIORITY_CONFLICT", `Liabilities ${aId} and ${bId} share funding at the same occurrence with duplicate priority.`, "LiabilityExecutionProfile", aId, "settlementPriority", [bId]));
      gate(diagnostic("LIABILITY_SETTLEMENT_PRIORITY_CONFLICT", `Liabilities ${bId} and ${aId} share funding at the same occurrence with duplicate priority.`, "LiabilityExecutionProfile", bId, "settlementPriority", [aId]));
      conflictedLoanIds.add(a.id);
      conflictedLoanIds.add(b.id);
    }
  const executableLoans = loans.filter((loan) => !conflictedLoanIds.has(loan.id));
  const activeCount = allLiabilities.filter((liability) => {
    const id = canonicalId(liability, "liability_id")!;
    return !inactiveLiabilityIds.includes(id) &&
      (String(liability.owner_id).toLowerCase() === scope.householdId || scope.memberIds.includes(String(liability.owner_id).toLowerCase()));
  }).length;
  if (executableLoans.length === 0 && activeCount > 0)
    return { status: "unsupported", diagnostics: Object.freeze([...diagnostics].sort((a, b) => a.code.localeCompare(b.code) || String(a.entityId).localeCompare(String(b.entityId)))) };

  const input: VerticalSlice4Input = Object.freeze({
    householdId: domainId("household", scope.householdId),
    ownerId: domainId("person", executionOwnerId),
    baseCurrency: currency,
    loans: Object.freeze([...executableLoans].sort((a, b) => a.id.localeCompare(b.id))),
  });
  const retainedLiabilities = new Set<string>(input.loans.flatMap((loan) => [loan.principalLiabilityId, loan.interestPayableLiabilityId]));
  const retainedAccounts = new Set<string>(input.loans.flatMap((loan) => [
    ...loan.fundingPolicy.orderedSources.map((source) => source.accountId),
    ...(loan.extraPrincipalPayments ?? []).flatMap((extra) => extra.fundingPolicy.orderedSources.map((source) => source.accountId)),
  ]));
  const retainedPrimitives = new Set<string>(input.loans.flatMap((loan) => [loan.primitiveIds.amortization, loan.primitiveIds.accrual]));
  const prunedAccounts = Object.fromEntries(Object.entries(accountStates).filter(([id]) => retainedAccounts.has(id)));
  const prunedLiabilities = Object.fromEntries(Object.entries(liabilityStates).filter(([id]) => retainedLiabilities.has(id)));
  const prunedPrimitiveEntries = Object.fromEntries(Object.entries(primitiveEntries).filter(([id]) => retainedPrimitives.has(id)));
  return {
    status: "compiled",
    value: Object.freeze({
      input,
      openingState: createAuthoritativeState({ accounts: prunedAccounts, liabilities: prunedLiabilities }),
      primitiveState: createPrimitiveRuntimeStateStore(prunedPrimitiveEntries),
      scenarioIdentity: selectedScenario.id,
      executionMonths,
      capabilityDiagnostics: Object.freeze([...diagnostics].sort((a, b) => a.code.localeCompare(b.code) || String(a.entityId).localeCompare(String(b.entityId)))),
      inactiveLiabilityIds: Object.freeze([...inactiveLiabilityIds].sort()),
      scenarioBindings: Object.freeze({
        loanIds: Object.freeze(Object.fromEntries(input.loans.map((loan) => [String(loan.principalLiabilityId), String(loan.id)]))),
        extraPrincipalPaymentIds: Object.freeze(Object.fromEntries(input.loans.flatMap((loan) => (loan.extraPrincipalPayments ?? []).map((payment) => [String(payment.id), String(payment.id)])))),
        accountIds: Object.freeze(Object.fromEntries(Object.keys(prunedAccounts).map((id) => [id, id]))),
      }),
    }),
    diagnostics: Object.freeze([]),
  };
};
