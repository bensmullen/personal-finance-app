import { domainId } from "../../identity/index.js";
import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { applyGeometricGrowth } from "../../primitives/index.js";
import { deriveCurrentPositionTotals } from "../../statements/index.js";
import { utcCalendarMonthDifference } from "../../time/index.js";
import { positionMarketValue } from "../../valuation/index.js";
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
  UUID,
  canonicalId,
  capability,
  issue,
  inspectAccountBalanceBehavior,
  monthAnchorDay,
  objects,
  ownerInScope,
  preflightCanonicalCollections,
  resolveHouseholdScope,
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
    if (typeof account.owner_id !== "string" || !UUID.test(account.owner_id))
      return invalidResult(
        "OWNER_REFERENCE_INVALID",
        `Account ${id} owner_id must be a UUID.`,
        "Account",
        id,
        "owner_id",
      );
    if (!ownerInScope(account.owner_id, scope)) {
      accountStatus.set(id, "out_of_scope");
      continue;
    }
    const balanceBehavior = inspectAccountBalanceBehavior(model, account);
    if (balanceBehavior.status !== "compiled") return balanceBehavior;
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
      account.closing_date === undefined
        ? undefined
        : utcDate(account.closing_date);
    if (account.closing_date !== undefined && !closing)
      return invalidResult(
        "DATE_INVALID",
        `Account ${id} closing_date is invalid.`,
        "Account",
        id,
        "closing_date",
      );
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
    if (balanceBehavior.value.hasAuthoredBehavior) {
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
    if (
      typeof liability.owner_id !== "string" ||
      !UUID.test(liability.owner_id)
    )
      return invalidResult(
        "OWNER_REFERENCE_INVALID",
        `Liability ${id} owner_id must be a UUID.`,
        "Liability",
        id,
        "owner_id",
      );
    if (!ownerInScope(liability.owner_id, scope)) continue;
    const explicitCurrency =
      liability.current_balance_currency ?? liability.currency;
    const balance = exactMoney(liability, "current_balance", currency);
    if (!balance || balance.isNegative())
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Liability ${id} current_balance must be a non-negative exact decimal.`,
        "Liability",
        id,
        "current_balance",
      );
    if (
      typeof explicitCurrency === "string" &&
      explicitCurrency !== currency.code &&
      !balance.amount.isZero()
    ) {
      liabilitiesComplete = false;
      diagnostics.push(
        diagnostic(
          "FX_UNSUPPORTED",
          `Liability ${id} uses ${explicitCurrency}; PR 15 does not perform FX.`,
          "liabilities",
          "Liability",
          id,
          "currency",
        ),
      );
      continue;
    }
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
    if (investment.asset_id !== undefined) {
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
      if (!ownerInScope(linkedAsset.owner_id, scope))
        return invalidResult(
          "INVESTMENT_ASSET_SCOPE_INVALID",
          `Investment ${id} references an Asset outside the selected Household.`,
          "Investment",
          id,
          "asset_id",
        );
      linkedAssetIds.add(assetRef);
    }
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
    if (accountsById.get(accountRef)!.currency !== currency.code) {
      assetsComplete = false;
      diagnostics.push(
        diagnostic(
          "FX_UNSUPPORTED",
          `Investment ${id} is held in a non-base-currency Account.`,
          "assets",
          "Investment",
          id,
          "account_id",
        ),
      );
      continue;
    }
    const priceField = classifyExactMoney(investment, "price", currency);
    if (
      priceField.kind === "invalid" ||
      (priceField.kind === "value" && priceField.value.isNegative())
    )
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Investment ${id} price must be a non-negative exact decimal when present.`,
        "Investment",
        id,
        "price",
      );
    if (priceField.kind === "missing") {
      assetsComplete = false;
      diagnostics.push(
        diagnostic(
          "INVESTMENT_PRICE_UNAVAILABLE",
          `Investment ${id} has positive quantity but no usable exact current price.`,
          "assets",
          "Investment",
          id,
          "price",
        ),
      );
      continue;
    }
    const price = priceField.value;
    nonCashAssets.push(
      positionMarketValue({
        id: domainId("position", id),
        accountId: domainId("account", accountRef),
        quantity: qty,
        price,
        carryingValue: Money.zero(currency),
      }),
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
    if (typeof asset.owner_id !== "string" || !UUID.test(asset.owner_id))
      return invalidResult(
        "OWNER_REFERENCE_INVALID",
        `Asset ${id} owner_id must be a UUID.`,
        "Asset",
        id,
        "owner_id",
      );
    if (!ownerInScope(asset.owner_id, scope)) continue;
    if (linkedAssetIds.has(id)) continue;
    if (asset.account_id !== undefined) {
      const accountRef = canonicalId(asset, "account_id");
      if (!accountRef || !accountsById.has(accountRef))
        return invalidResult(
          "ASSET_ACCOUNT_REFERENCE_INVALID",
          `Asset ${id} account_id does not resolve to an Account.`,
          "Asset",
          id,
          "account_id",
        );
      if (!ownerInScope(accountsById.get(accountRef)!.owner_id, scope))
        return invalidResult(
          "ASSET_ACCOUNT_SCOPE_INVALID",
          `Asset ${id} references an Account outside the selected Household.`,
          "Asset",
          id,
          "account_id",
        );
    }
    if (asset.asset_type === "cash" || asset.account_id !== undefined) {
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
    if (asset.acquisition_date !== undefined) {
      const acquired = utcDate(asset.acquisition_date);
      if (!acquired)
        return invalidResult(
          "DATE_INVALID",
          `Asset ${id} acquisition_date is invalid.`,
          "Asset",
          id,
          "acquisition_date",
        );
      if (acquired > asOf) continue;
    }
    if (asset.sale_date !== undefined) {
      const sold = utcDate(asset.sale_date);
      if (!sold)
        return invalidResult(
          "DATE_INVALID",
          `Asset ${id} sale_date is invalid.`,
          "Asset",
          id,
          "sale_date",
        );
      if (sold <= asOf) {
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
    }
    if (
      asset.valuation_method !== "cost" ||
      asset.appreciation_model_id !== undefined ||
      asset.depreciation_model_id !== undefined
    ) {
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
      if (typeof stream.owner_id !== "string" || !UUID.test(stream.owner_id))
        return invalidResult(
          "OWNER_REFERENCE_INVALID",
          `${type} ${id} owner_id must be a UUID.`,
          type,
          id,
          "owner_id",
        );
      if (!ownerInScope(stream.owner_id, scope)) continue;
      for (const field of type === "Income"
        ? (["probability_model_id", "related_event_id"] as const)
        : (["event_trigger_id"] as const)) {
        const raw = stream[field];
        if (raw === undefined || raw === null || raw === "") continue;
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
        stream.end_date === undefined ? undefined : utcDate(stream.end_date);
      if (!start || (stream.end_date !== undefined && !end))
        return invalidResult(
          "DATE_INVALID",
          `${type} ${id} has invalid dates.`,
          type,
          id,
          "start_date",
        );
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
      if (rawGrowth === undefined || rawGrowth === null || rawGrowth === "") {
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
      const asOfDate = new Date(Date.parse(asOf));
      let year = asOfDate.getUTCFullYear();
      let month = asOfDate.getUTCMonth();
      if (asOfDate.getUTCDate() < monthAnchorDay(start)) {
        month -= 1;
        if (month < 0) {
          month = 11;
          year -= 1;
        }
      }
      const latest = utcDate(
        new Date(Date.UTC(year, month, monthAnchorDay(start)))
          .toISOString()
          .slice(0, 10),
      )!;
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
