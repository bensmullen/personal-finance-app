import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { applyGeometricGrowth } from "../../primitives/index.js";
import { deriveCurrentPositionTotals } from "../../statements/index.js";
import {
  utcCalendarMonthDifference,
  utcLatestMonthlyOccurrenceAtOrBefore,
} from "../../time/index.js";
import {
  Currency,
  Money,
  RoundingPolicy,
  SHARE,
  money,
  quantity,
  sumMoney,
} from "../../values/index.js";
import {
  EXACT_DECIMAL,
  ASSET_TYPES,
  ASSET_VALUATION_METHODS,
  PAYMENT_FREQUENCIES,
  UUID,
  canonicalId,
  capability,
  issue,
  inspectAccountBalanceBehavior,
  monthAnchorDay,
  objects,
  preflightCanonicalCollections,
  resolveOwnerScope,
  resolveHouseholdScope,
  validateGenericPrimitiveInstance,
  utcDate,
  type CanonicalObject,
} from "./shared.js";
import { resolveGrowth, selectScenario } from "./cashFlow.js";
import type { CapabilityDiagnostic, CompileResult } from "./types.js";

export interface CurrentPositionCompilerRequest {
  readonly baseCurrency: string;
  readonly asOf: string;
}

export interface CurrentPositionCompilation {
  readonly cash?: Money;
  readonly assets?: Money;
  readonly liabilities?: Money;
  readonly netWorth?: Money;
  readonly monthlyIncome?: Money;
  readonly monthlySpending?: Money;
  readonly monthlyCashFlow?: Money;
  readonly diagnostics: readonly CapabilityDiagnostic[];
}

const diagnostic = (
  code: string,
  message: string,
  capabilityName: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
): CapabilityDiagnostic =>
  capability(code, message, capabilityName, entityType, entityId, fieldPath);

const exactMoney = (
  object: CanonicalObject,
  field: string,
  currency: Currency,
): Money | undefined => {
  const value = object[field];
  if (typeof value !== "string" || !EXACT_DECIMAL.test(value)) return undefined;
  try {
    return money(value, currency);
  } catch {
    return undefined;
  }
};

type ExactMoneyField =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "value"; readonly value: Money };

const classifyExactMoney = (
  object: CanonicalObject,
  field: string,
  currency: Currency,
): ExactMoneyField => {
  const raw = object[field];
  if (raw === undefined || raw === null || raw === "")
    return { kind: "missing" };
  if (typeof raw !== "string" || !EXACT_DECIMAL.test(raw))
    return { kind: "invalid" };
  try {
    return { kind: "value", value: money(raw, currency) };
  } catch {
    return { kind: "invalid" };
  }
};

const invalidResult = <T>(
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
): CompileResult<T> => ({
  status: "invalid_model",
  diagnostics: Object.freeze([
    issue(code, message, entityType, entityId, fieldPath),
  ]),
});

export const compileCurrentPosition = (
  model: PortableModelEnvelope,
  request: CurrentPositionCompilerRequest,
): CompileResult<CurrentPositionCompilation> => {
  const preflight = preflightCanonicalCollections(model, [
    "Household",
    "Person",
    "Account",
    "Income",
    "Expense",
    "Transaction",
    "Liability",
    "Asset",
    "Investment",
  ]);
  if (preflight.status !== "compiled") return preflight;
  const scopeResult = resolveHouseholdScope(model);
  if (scopeResult.status !== "compiled") return scopeResult;
  const scope = scopeResult.value;
  const asOf = utcDate(request.asOf);
  if (!asOf)
    return invalidResult(
      "DATE_INVALID",
      "Current-position asOf must be a valid date-only value.",
      "current_position_request",
      undefined,
      "asOf",
    );
  let currency: Currency;
  try {
    currency = Currency.of(request.baseCurrency);
  } catch (error) {
    return invalidResult(
      "BASE_CURRENCY_INVALID",
      error instanceof Error ? error.message : "Base currency is invalid.",
      "current_position_request",
      undefined,
      "baseCurrency",
    );
  }
  const diagnostics: CapabilityDiagnostic[] = [];
  const cashBalances: Money[] = [];
  let cashComplete = true;
  const accountsById = new Map<string, CanonicalObject>();
  const accountStatus = new Map<
    string,
    "out_of_scope" | "future" | "closed" | "current"
  >();
  for (const account of objects(model, "Account")) {
    const id = canonicalId(account, "account_id");
    if (!id)
      return invalidResult(
        "CANONICAL_ID_INVALID",
        "Account account_id must be a valid UUID.",
        "Account",
        undefined,
        "account_id",
      );
    if (accountsById.has(id))
      return invalidResult(
        "DUPLICATE_EXECUTABLE_IDENTITY",
        `Duplicate Account identity ${id}.`,
        "Account",
        id,
        "account_id",
      );
    accountsById.set(id, account);
    const owner = resolveOwnerScope(model, account.owner_id, scope, "Account", id);
    if (owner.status !== "compiled") return owner;
    if (typeof account.currency !== "string" || !/^[A-Z]{3}$/.test(account.currency))
      return invalidResult("ACCOUNT_CURRENCY_INVALID", `Account ${id} currency must be a canonical ISO currency.`, "Account", id, "currency");
    if (owner.value === "out_of_scope") {
      accountStatus.set(id, "out_of_scope");
      continue;
    }
    const balanceBehavior = inspectAccountBalanceBehavior(model, account);
    if (balanceBehavior.status === "invalid_model") return balanceBehavior;
    const opening = utcDate(account.opening_date);
    if (!opening)
      return invalidResult(
        "DATE_INVALID",
        `Account ${id} opening_date is invalid.`,
        "Account",
        id,
        "opening_date",
      );
    const closing =
      account.closing_date === undefined || account.closing_date === null
        ? undefined
        : utcDate(account.closing_date);
    if (account.closing_date !== undefined && account.closing_date !== null && !closing)
      return invalidResult(
        "DATE_INVALID",
        `Account ${id} closing_date is invalid.`,
        "Account",
        id,
        "closing_date",
      );
    if (closing !== undefined && closing < opening)
      return invalidResult("TEMPORAL_INTERVAL_INVALID", `Account ${id} closing_date cannot precede opening_date.`, "Account", id, "closing_date");
    if (opening > asOf) {
      accountStatus.set(id, "future");
      continue;
    }
    if (closing !== undefined) {
      if (closing <= asOf) {
        accountStatus.set(id, "closed");
        cashComplete = false;
        diagnostics.push(
          diagnostic(
            "CLOSED_ACCOUNT_RECONCILIATION_UNSUPPORTED",
            `Account ${id} closed by the as-of date; PR 15 cannot reconcile its disposition.`,
            "cash",
            "Account",
            id,
            "closing_date",
          ),
        );
        continue;
      }
    }
    accountStatus.set(id, "current");
    const balance = exactMoney(account, "opening_balance", currency);
    if (!balance || balance.isNegative())
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Account ${id} opening_balance must be a non-negative exact decimal.`,
        "Account",
        id,
        "opening_balance",
      );
    if (
      balanceBehavior.status === "unsupported" ||
      (balanceBehavior.status === "compiled" && balanceBehavior.value.hasAuthoredBehavior)
    ) {
      cashComplete = false;
      diagnostics.push(
        diagnostic(
          "OPENING_BALANCE_AUTHORITY_UNSUPPORTED",
          `Account ${id} has authored balance-changing behavior PR 15 does not replay.`,
          "cash",
          "Account",
          id,
        ),
      );
      continue;
    }
    if (account.currency !== currency.code) {
      if (!balance.amount.isZero()) {
        cashComplete = false;
        diagnostics.push(
          diagnostic(
            "FX_UNSUPPORTED",
            `Account ${id} uses ${String(account.currency)}; PR 15 does not perform FX.`,
            "cash",
            "Account",
            id,
            "currency",
          ),
        );
      }
      continue;
    }
    cashBalances.push(balance);
  }

  const liabilityBalances: Money[] = [];
  let liabilitiesComplete = true;
  for (const liability of objects(model, "Liability")) {
    const id = canonicalId(liability, "liability_id");
    if (!id)
      return invalidResult(
        "CANONICAL_ID_INVALID",
        "Liability liability_id must be a valid UUID.",
        "Liability",
        undefined,
        "liability_id",
      );
    const owner = resolveOwnerScope(model, liability.owner_id, scope, "Liability", id);
    if (owner.status !== "compiled") return owner;
    if (owner.value === "out_of_scope") continue;
    const origination = utcDate(liability.origination_date);
    if (!origination)
      return invalidResult(
        "DATE_INVALID",
        `Liability ${id} origination_date is required and must be valid.`,
        "Liability",
        id,
        "origination_date",
      );
    if (liability.maturity_date !== undefined && liability.maturity_date !== null) {
      const maturity = utcDate(liability.maturity_date);
      if (!maturity || maturity <= origination)
        return invalidResult(
          "TEMPORAL_INTERVAL_INVALID",
          `Liability ${id} maturity_date must be valid and after origination_date.`,
          "Liability",
          id,
          "maturity_date",
        );
    }
    if (origination > asOf) continue;
    const balance = exactMoney(liability, "current_balance", currency);
    if (!balance || balance.isNegative())
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Liability ${id} current_balance must be a non-negative exact decimal.`,
        "Liability",
        id,
        "current_balance",
      );
    liabilityBalances.push(balance);
  }

  const investments = objects(model, "Investment");
  const linkedAssetIds = new Set<string>();
  const nonCashAssets: Money[] = [];
  let assetsComplete = cashComplete;
  for (const investment of investments) {
    const id = canonicalId(investment, "investment_id");
    if (!id)
      return invalidResult(
        "CANONICAL_ID_INVALID",
        "Investment investment_id must be a valid UUID.",
        "Investment",
        undefined,
        "investment_id",
      );
    const accountRef = canonicalId(investment, "account_id");
    if (!accountRef || !accountsById.has(accountRef))
      return invalidResult(
        "INVESTMENT_ACCOUNT_REFERENCE_INVALID",
        `Investment ${id} account_id does not resolve to an in-model Account.`,
        "Investment",
        id,
        "account_id",
      );
    const holdingStatus = accountStatus.get(accountRef);
    if (holdingStatus === "out_of_scope") continue;
    if (holdingStatus === "future") continue;
    if (holdingStatus === "closed") {
      assetsComplete = false;
      diagnostics.push(
        diagnostic(
          "CLOSED_INVESTMENT_ACCOUNT_UNSUPPORTED",
          `Investment ${id} is held in an Account closed by the as-of date.`,
          "assets",
          "Investment",
          id,
          "account_id",
        ),
      );
      continue;
    }
    if (investment.asset_id !== undefined && investment.asset_id !== null) {
      const assetRef = canonicalId(investment, "asset_id");
      const linkedAsset = assetRef
        ? objects(model, "Asset").find(
            (asset) => canonicalId(asset, "asset_id") === assetRef,
          )
        : undefined;
      if (!assetRef || !linkedAsset)
        return invalidResult(
          "INVESTMENT_ASSET_REFERENCE_INVALID",
          `Investment ${id} asset_id does not resolve to an Asset.`,
          "Investment",
          id,
          "asset_id",
        );
      const linkedOwner = resolveOwnerScope(model, linkedAsset.owner_id, scope, "Asset", assetRef);
      if (linkedOwner.status !== "compiled") return linkedOwner;
      if (linkedOwner.value !== "in_scope")
        return invalidResult(
          "INVESTMENT_ASSET_SCOPE_INVALID",
          `Investment ${id} references an Asset outside the selected Household.`,
          "Investment",
          id,
          "asset_id",
        );
      linkedAssetIds.add(assetRef);
    }
    if (
      typeof investment.quantity !== "string" ||
      !EXACT_DECIMAL.test(investment.quantity)
    )
      return invalidResult(
        "EXACT_DECIMAL_INVALID",
        `Investment ${id} quantity must be an exact decimal string.`,
        "Investment",
        id,
        "quantity",
      );
    const qty = quantity(investment.quantity, SHARE);
    if (qty.isNegative())
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Investment ${id} quantity cannot be negative.`,
        "Investment",
        id,
        "quantity",
      );
    if (qty.amount.isZero()) continue;
    assetsComplete = false;
    diagnostics.push(
      diagnostic(
        "INVESTMENT_CURRENT_VALUATION_UNAVAILABLE",
        `Investment ${id} has positive quantity but no authoritative current valuation in PR 15.`,
        "assets",
        "Investment",
        id,
      ),
    );
  }

  for (const asset of objects(model, "Asset")) {
    const id = canonicalId(asset, "asset_id");
    if (!id)
      return invalidResult(
        "CANONICAL_ID_INVALID",
        "Asset asset_id must be a valid UUID.",
        "Asset",
        undefined,
        "asset_id",
      );
    const owner = resolveOwnerScope(model, asset.owner_id, scope, "Asset", id);
    if (owner.status !== "compiled") return owner;
    if (owner.value === "out_of_scope") continue;
    if (linkedAssetIds.has(id)) continue;
    if (asset.account_id !== undefined && asset.account_id !== null) {
      const accountRef = canonicalId(asset, "account_id");
      if (!accountRef || !accountsById.has(accountRef))
        return invalidResult(
          "ASSET_ACCOUNT_REFERENCE_INVALID",
          `Asset ${id} account_id does not resolve to an Account.`,
          "Asset",
          id,
          "account_id",
        );
      const accountOwner = resolveOwnerScope(model, accountsById.get(accountRef)!.owner_id, scope, "Account", accountRef);
      if (accountOwner.status !== "compiled") return accountOwner;
      if (accountOwner.value !== "in_scope")
        return invalidResult(
          "ASSET_ACCOUNT_SCOPE_INVALID",
          `Asset ${id} references an Account outside the selected Household.`,
          "Asset",
          id,
          "account_id",
        );
    }
    if (!ASSET_TYPES.includes(asset.asset_type as never))
      return invalidResult(
        "ASSET_TYPE_INVALID",
        `Asset ${id} asset_type is not canonical.`,
        "Asset",
        id,
        "asset_type",
      );
    const acquired =
      asset.acquisition_date === undefined || asset.acquisition_date === null
        ? undefined
        : utcDate(asset.acquisition_date);
    const sold =
      asset.sale_date === undefined || asset.sale_date === null
        ? undefined
        : utcDate(asset.sale_date);
    if (asset.acquisition_date !== undefined && asset.acquisition_date !== null) {
      if (!acquired)
        return invalidResult(
          "DATE_INVALID",
          `Asset ${id} acquisition_date is invalid.`,
          "Asset",
          id,
          "acquisition_date",
        );
    }
    if (asset.sale_date !== undefined && asset.sale_date !== null) {
      if (!sold)
        return invalidResult(
          "DATE_INVALID",
          `Asset ${id} sale_date is invalid.`,
          "Asset",
          id,
          "sale_date",
        );
    }
    if (acquired !== undefined && sold !== undefined && sold < acquired)
      return invalidResult(
        "ASSET_TEMPORAL_INTERVAL_INVALID",
        `Asset ${id} sale_date cannot precede acquisition_date.`,
        "Asset",
        id,
        "sale_date",
      );
    if (acquired !== undefined && acquired > asOf) continue;
    if (sold !== undefined && sold <= asOf) {
        assetsComplete = false;
        diagnostics.push(
          diagnostic(
            "ASSET_SALE_RECONCILIATION_UNSUPPORTED",
            `Asset ${id} was sold by the as-of date; sale proceeds are not reconstructed.`,
            "assets",
            "Asset",
            id,
            "sale_date",
          ),
        );
      continue;
    }
    if (!ASSET_VALUATION_METHODS.includes(asset.valuation_method as never))
      return invalidResult("ASSET_VALUATION_METHOD_INVALID", `Asset ${id} valuation_method is not canonical.`, "Asset", id, "valuation_method");
    const hasValuationModel =
      (asset.appreciation_model_id !== undefined && asset.appreciation_model_id !== null) ||
      (asset.depreciation_model_id !== undefined && asset.depreciation_model_id !== null);
    if (hasValuationModel) {
      const valuationPreflight = preflightCanonicalCollections(model, [
        "PrimitiveInstance",
      ]);
      if (valuationPreflight.status !== "compiled") return valuationPreflight;
    }
    let hasAuthoredValuationModel = false;
    for (const field of ["appreciation_model_id", "depreciation_model_id"] as const) {
      const raw = asset[field];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== "string" || !UUID.test(raw))
        return invalidResult("ASSET_MODEL_REFERENCE_INVALID", `Asset ${id} ${field} must be a UUID.`, "Asset", id, field);
      if (!objects(model, "PrimitiveInstance").some((primitive) => canonicalId(primitive, "primitive_instance_id") === raw.toLowerCase()))
        return invalidResult("ASSET_MODEL_REFERENCE_NOT_FOUND", `Asset ${id} ${field} does not resolve.`, "Asset", id, field);
      assetsComplete = false;
      diagnostics.push(diagnostic("ASSET_VALUATION_UNSUPPORTED", `Asset ${id} has authored valuation behavior.`, "assets", "Asset", id, field));
      hasAuthoredValuationModel = true;
    }
    if (hasAuthoredValuationModel) continue;
    if (asset.asset_type === "cash" || (asset.account_id !== undefined && asset.account_id !== null)) {
      assetsComplete = false;
      diagnostics.push(
        diagnostic(
          "ASSET_ACCOUNT_OVERLAP_AMBIGUOUS",
          `Asset ${id} may overlap an Account economic resource.`,
          "assets",
          "Asset",
          id,
        ),
      );
      continue;
    }
    if (asset.valuation_method !== "cost") {
      assetsComplete = false;
      diagnostics.push(
        diagnostic(
          "ASSET_VALUATION_UNSUPPORTED",
          `Asset ${id} lacks the supported static cost valuation.`,
          "assets",
          "Asset",
          id,
          "valuation_method",
        ),
      );
      continue;
    }
    const costField = classifyExactMoney(asset, "acquisition_cost", currency);
    if (
      costField.kind === "invalid" ||
      (costField.kind === "value" && costField.value.isNegative())
    )
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Asset ${id} acquisition_cost must be a non-negative exact decimal when present.`,
        "Asset",
        id,
        "acquisition_cost",
      );
    if (costField.kind === "missing") {
      assetsComplete = false;
      diagnostics.push(
        diagnostic(
          "ASSET_COST_UNAVAILABLE",
          `Asset ${id} lacks a usable exact acquisition_cost.`,
          "assets",
          "Asset",
          id,
          "acquisition_cost",
        ),
      );
      continue;
    }
    nonCashAssets.push(costField.value);
  }

  let monthlyIncome: Money | undefined;
  let monthlySpending: Money | undefined;
  let selectedScenario: ReturnType<typeof selectScenario> | undefined;
  /** Validate every in-scope stream before a valid capability gate can return. */
  const validateCurrentStreams = (type: "Income" | "Expense"): CompileResult<true> => {
    for (const stream of objects(model, type)) {
      const id = canonicalId(stream, `${type.toLowerCase()}_id`)!;
      const owner = resolveOwnerScope(model, stream.owner_id, scope, type, id);
      if (owner.status !== "compiled") return owner;
      if (owner.value === "out_of_scope") continue;
      for (const field of type === "Income" ? ["probability_model_id", "related_event_id"] as const : ["event_trigger_id"] as const) {
        const raw = stream[field];
        if (raw === undefined || raw === null) continue;
        if (typeof raw !== "string" || !UUID.test(raw)) return invalidResult("EVENT_BINDING_INVALID", `${type} ${id} ${field} must be a UUID.`, type, id, field);
        const collection = field === "probability_model_id" ? "PrimitiveInstance" : "Event";
        const idField = field === "probability_model_id" ? "primitive_instance_id" : "event_id";
        const preflight = preflightCanonicalCollections(model, [collection]);
        if (preflight.status !== "compiled") return preflight;
        if (!objects(model, collection).some((candidate) => canonicalId(candidate, idField) === raw.toLowerCase())) return invalidResult("EVENT_BINDING_REFERENCE_NOT_FOUND", `${type} ${id} ${field} does not resolve.`, type, id, field);
      }
      if (!PAYMENT_FREQUENCIES.includes(stream.frequency as never)) return invalidResult("RECURRENCE_INVALID", `${type} ${id} frequency is not canonical.`, type, id, "frequency");
      const start = utcDate(stream.start_date);
      const end = stream.end_date === undefined || stream.end_date === null ? undefined : utcDate(stream.end_date);
      if (!start || (stream.end_date !== undefined && stream.end_date !== null && !end)) return invalidResult("DATE_INVALID", `${type} ${id} has invalid dates.`, type, id, "start_date");
      if (end !== undefined && end < start) return invalidResult("TEMPORAL_INTERVAL_INVALID", `${type} ${id} end_date cannot precede start_date.`, type, id, "end_date");
      const base = exactMoney(stream, "amount", currency);
      if (!base || base.isNegative()) return invalidResult("DOMAIN_VALUE_INVALID", `${type} ${id} amount is invalid.`, type, id, "amount");
      if (stream.growth_model_id !== undefined && stream.growth_model_id !== null) {
        if (typeof stream.growth_model_id !== "string" || !UUID.test(stream.growth_model_id))
          return invalidResult("GROWTH_MODEL_REFERENCE_INVALID", `${type} ${id} growth_model_id must be a UUID.`, type, id, "growth_model_id");
        const genericPrimitive = validateGenericPrimitiveInstance(model, stream.growth_model_id.toLowerCase(), type, id, "growth_model_id");
        if (genericPrimitive.status === "invalid_model") return genericPrimitive;
        selectedScenario ??= selectScenario(model);
        if (selectedScenario.status === "invalid_model") return selectedScenario;
        if (selectedScenario.status === "compiled") {
          const growth = resolveGrowth(model, stream, type, selectedScenario.value);
          if (growth.status === "invalid_model") return growth;
        }
      }
    }
    return { status: "compiled", value: true, diagnostics: Object.freeze([]) };
  };
  const incomeStructural = validateCurrentStreams("Income");
  if (incomeStructural.status !== "compiled") return incomeStructural;
  const expenseStructural = validateCurrentStreams("Expense");
  if (expenseStructural.status !== "compiled") return expenseStructural;
  const aggregate = (type: "Income" | "Expense"): CompileResult<Money> => {
    const values: Money[] = [];
    for (const stream of objects(model, type)) {
      const id = canonicalId(stream, `${type.toLowerCase()}_id`);
      if (!id)
        return invalidResult(
          "CANONICAL_ID_INVALID",
          `${type} identity is invalid.`,
          type,
          undefined,
          `${type.toLowerCase()}_id`,
        );
      const owner = resolveOwnerScope(model, stream.owner_id, scope, type, id);
      if (owner.status !== "compiled") return owner;
      if (owner.value === "out_of_scope") continue;
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
        const referencePreflight = preflightCanonicalCollections(model, [
          collection,
        ]);
        if (referencePreflight.status !== "compiled")
          return referencePreflight;
        if (
          !objects(model, collection).some(
            (candidate) =>
              canonicalId(candidate, idField) === raw.toLowerCase(),
          )
        )
          return invalidResult(
            "EVENT_BINDING_REFERENCE_NOT_FOUND",
            `${type} ${id} ${field} does not resolve.`,
            type,
            id,
            field,
          );
        return {
          status: "unsupported",
          diagnostics: Object.freeze([
            diagnostic(
              "MONTHLY_FLOW_EVENT_SEMANTICS_UNSUPPORTED",
              `${type} ${id} has unresolved probability or event semantics.`,
              type === "Income" ? "monthly_income" : "monthly_spending",
              type,
              id,
              field,
            ),
          ]),
        };
      }
      if (!PAYMENT_FREQUENCIES.includes(stream.frequency as never))
        return invalidResult("RECURRENCE_INVALID", `${type} ${id} frequency is not canonical.`, type, id, "frequency");
      if (stream.frequency !== "monthly")
        return {
          status: "unsupported",
          diagnostics: Object.freeze([
            diagnostic(
              "MONTHLY_FLOW_RECURRENCE_UNSUPPORTED",
              `${type} ${id} is not monthly.`,
              type === "Income" ? "monthly_income" : "monthly_spending",
              type,
              id,
              "frequency",
            ),
          ]),
        };
      const start = utcDate(stream.start_date);
      const end =
        stream.end_date === undefined || stream.end_date === null
          ? undefined
          : utcDate(stream.end_date);
      if (!start || (stream.end_date !== undefined && stream.end_date !== null && !end))
        return invalidResult(
          "DATE_INVALID",
          `${type} ${id} has invalid dates.`,
          type,
          id,
          "start_date",
        );
      if (end !== undefined && end < start)
        return invalidResult("TEMPORAL_INTERVAL_INVALID", `${type} ${id} end_date cannot precede start_date.`, type, id, "end_date");
      if (asOf < start || (end !== undefined && asOf > end)) continue;
      const base = exactMoney(stream, "amount", currency);
      if (!base || base.isNegative())
        return invalidResult(
          "DOMAIN_VALUE_INVALID",
          `${type} ${id} amount is invalid.`,
          type,
          id,
          "amount",
        );
      const rawGrowth = stream.growth_model_id;
      if (rawGrowth === undefined || rawGrowth === null) {
        values.push(base);
        continue;
      }
      if (monthAnchorDay(start) > 28)
        return {
          status: "unsupported",
          diagnostics: Object.freeze([
            diagnostic(
              "MONTHLY_GROWTH_ANCHOR_UNSUPPORTED",
              `${type} ${id} uses an ambiguous monthly growth anchor day.`,
              type === "Income" ? "monthly_income" : "monthly_spending",
              type,
              id,
              "start_date",
            ),
          ]),
        };
      selectedScenario ??= selectScenario(model);
      if (selectedScenario.status === "invalid_model") return selectedScenario;
      if (selectedScenario.status === "unsupported")
        return {
          status: "unsupported",
          diagnostics: Object.freeze(
            selectedScenario.diagnostics.map((value) => ({
              ...value,
              capability:
                type === "Income" ? "monthly_income" : "monthly_spending",
            })),
          ),
        };
      const growth = resolveGrowth(model, stream, type, selectedScenario.value);
      if (growth.status === "invalid_model") return growth;
      if (growth.status === "unsupported")
        return {
          status: "unsupported",
          diagnostics: Object.freeze(
            growth.diagnostics.map((value) => ({
              ...value,
              capability:
                type === "Income" ? "monthly_income" : "monthly_spending",
            })),
          ),
        };
      const latest = utcLatestMonthlyOccurrenceAtOrBefore(start, asOf, "skip");
      if (!latest) continue;
      if (latest < start) continue;
      const months = utcCalendarMonthDifference(start, latest);
      try {
        values.push(
          applyGeometricGrowth(base, growth.value.rate, {
            kind: "effective_annual",
            yearFraction: { numerator: months, denominator: 12 },
            calculationRounding: new RoundingPolicy(18, "half_even"),
          }),
        );
      } catch (error) {
        return invalidResult(
          "DOMAIN_VALUE_INVALID",
          error instanceof Error ? error.message : `${type} growth is invalid.`,
          type,
          id,
          "growth_model_id",
        );
      }
    }
    return {
      status: "compiled",
      value: sumMoney(values, currency),
      diagnostics: Object.freeze([]),
    };
  };
  const incomeResult = aggregate("Income");
  if (incomeResult.status === "invalid_model") return incomeResult;
  if (incomeResult.status === "compiled") monthlyIncome = incomeResult.value;
  else diagnostics.push(...incomeResult.diagnostics);
  const spendingResult = aggregate("Expense");
  if (spendingResult.status === "invalid_model") return spendingResult;
  if (spendingResult.status === "compiled")
    monthlySpending = spendingResult.value;
  else diagnostics.push(...spendingResult.diagnostics);

  const cash = cashComplete ? sumMoney(cashBalances, currency) : undefined;
  const liabilities = liabilitiesComplete
    ? sumMoney(liabilityBalances, currency)
    : undefined;
  const totals =
    cashComplete && assetsComplete
      ? deriveCurrentPositionTotals(
          cashBalances,
          nonCashAssets,
          liabilityBalances,
          currency,
        )
      : undefined;
  const monthlyCashFlow =
    monthlyIncome && monthlySpending
      ? monthlyIncome.minus(monthlySpending)
      : undefined;
  return {
    status: "compiled",
    value: Object.freeze({
      ...(cash ? { cash } : {}),
      ...(totals ? { assets: totals.assets } : {}),
      ...(totals && liabilitiesComplete ? { netWorth: totals.netWorth } : {}),
      ...(liabilities ? { liabilities } : {}),
      ...(monthlyIncome ? { monthlyIncome } : {}),
      ...(monthlySpending ? { monthlySpending } : {}),
      ...(monthlyCashFlow ? { monthlyCashFlow } : {}),
      diagnostics: Object.freeze(diagnostics),
    }),
    diagnostics: Object.freeze([]),
  };
};
