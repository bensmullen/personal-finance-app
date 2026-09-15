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
  objects,
  ownerInScope,
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
    if (!ownerInScope(account.owner_id, scope)) continue;
    const opening = utcDate(account.opening_date);
    if (!opening)
      return invalidResult(
        "DATE_INVALID",
        `Account ${id} opening_date is invalid.`,
        "Account",
        id,
        "opening_date",
      );
    if (opening > asOf) continue;
    if (account.closing_date !== undefined) {
      const closing = utcDate(account.closing_date);
      if (!closing)
        return invalidResult(
          "DATE_INVALID",
          `Account ${id} closing_date is invalid.`,
          "Account",
          id,
          "closing_date",
        );
      if (closing <= asOf) {
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
    const balance = exactMoney(account, "opening_balance", currency);
    if (!balance || balance.isNegative())
      return invalidResult(
        "DOMAIN_VALUE_INVALID",
        `Account ${id} opening_balance must be a non-negative exact decimal.`,
        "Account",
        id,
        "opening_balance",
      );
    const transactionIds = account.transaction_ids;
    if (transactionIds !== undefined && !Array.isArray(transactionIds))
      return invalidResult(
        "TRANSACTION_REFERENCES_INVALID",
        `Account ${id} transaction_ids must be an array.`,
        "Account",
        id,
        "transaction_ids",
      );
    for (const raw of (transactionIds ?? []) as readonly unknown[]) {
      if (typeof raw !== "string" || !UUID.test(raw))
        return invalidResult(
          "TRANSACTION_REFERENCE_INVALID",
          `Account ${id} has a malformed transaction reference.`,
          "Account",
          id,
          "transaction_ids",
        );
      if (
        !objects(model, "Transaction").some(
          (value) => canonicalId(value, "transaction_id") === raw.toLowerCase(),
        )
      )
        return invalidResult(
          "TRANSACTION_REFERENCE_NOT_FOUND",
          `Account ${id} transaction ${raw} does not resolve.`,
          "Account",
          id,
          "transaction_ids",
        );
    }
    const affected = objects(model, "Transaction").some((transaction) =>
      [
        transaction.account_id,
        transaction.from_account_id,
        transaction.to_account_id,
      ].includes(id),
    );
    if (
      (transactionIds?.length ?? 0) > 0 ||
      affected ||
      account.return_model_id !== undefined
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
    if (!ownerInScope(accountsById.get(accountRef)!.owner_id, scope)) continue;
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
    const price = exactMoney(investment, "price", currency);
    if (!price || price.isNegative() || price.amount.isZero()) {
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
    const cost = exactMoney(asset, "acquisition_cost", currency);
    if (!cost || cost.isNegative()) {
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
    nonCashAssets.push(cost);
  }

  const scenario = selectScenario(model);
  if (scenario.status === "invalid_model") return scenario;
  let monthlyIncome: Money | undefined;
  let monthlySpending: Money | undefined;
  if (scenario.status === "unsupported") {
    diagnostics.push(
      ...scenario.diagnostics.map((value) => ({
        ...value,
        capability: "monthly_cash_flow",
      })),
    );
  } else {
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
        if (
          (type === "Income" &&
            (stream.probability_model_id !== undefined ||
              stream.related_event_id !== undefined)) ||
          (type === "Expense" && stream.event_trigger_id !== undefined)
        )
          return {
            status: "unsupported",
            diagnostics: Object.freeze([
              diagnostic(
                "MONTHLY_FLOW_EVENT_SEMANTICS_UNSUPPORTED",
                `${type} ${id} has unresolved probability or event semantics.`,
                type === "Income" ? "monthly_income" : "monthly_spending",
                type,
                id,
              ),
            ]),
          };
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
        const growth = resolveGrowth(model, stream, type, scenario.value);
        if (growth.status !== "compiled") return growth;
        const months = utcCalendarMonthDifference(start, asOf);
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
            error instanceof Error
              ? error.message
              : `${type} growth is invalid.`,
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
  }

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
