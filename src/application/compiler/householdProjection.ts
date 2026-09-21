import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { canonicalSerialize } from "../../simulation/run.js";
import { reconcileHouseholdOpeningState, reconcileHouseholdPrimitiveState } from "../../simulation/householdProjection.js";
import { buildHouseholdScheduledPlan, type HouseholdContentionPolicy } from "../../simulation/intraperiodScheduler.js";
import { compileCashFlow, type CashFlowCompilerRequest, type CashFlowScenarioBindings, type CompiledCashFlow } from "./cashFlow.js";
import { compileInvestments, type InvestmentCompilerRequest, type CompiledInvestments } from "./investments.js";
import { compileLiabilities, type LiabilityCompilerRequest, type CompiledLiabilities } from "./liabilities.js";
import type { CapabilityDiagnostic, CompileResult } from "./types.js";
import { Currency, money, type Money } from "../../values/index.js";
import { capability, EXACT_DECIMAL, ASSET_TYPES, ASSET_VALUATION_METHODS, canonicalId, objects, preflightCanonicalCollections, resolveHouseholdScope, resolveOwnerScope, UUID, utcDate, type CanonicalObject, type HouseholdScope } from "./shared.js";

/** Application boundary for the one reconciled PR20 execution input. */
export interface HouseholdProjectionCompilerRequest {
  readonly cashFlow?: CashFlowCompilerRequest;
  readonly investments?: InvestmentCompilerRequest;
  readonly liabilities?: LiabilityCompilerRequest;
  /** Required only when runtime execution discovers material contention. */
  readonly contentionPolicy?: HouseholdContentionPolicy;
}

export interface CompiledStandaloneAsset {
  readonly id: string;
  readonly value: Money;
}

export interface CompiledHouseholdProjection {
  readonly cashFlowInput?: CompiledCashFlow["input"];
  readonly investmentInput?: CompiledInvestments["input"];
  readonly liabilityInput?: CompiledLiabilities["input"];
  readonly reconciledOpeningState: CompiledCashFlow["openingState"];
  readonly reconciledPrimitiveState: CompiledInvestments["primitiveState"];
  readonly standaloneAssets: readonly CompiledStandaloneAsset[];
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly contentionPolicy?: HouseholdContentionPolicy;
  readonly diagnostics: readonly CapabilityDiagnostic[];
  /** Binding names are part of the household scenario contract, never request-order slots. */
  readonly scenarioBindings: Readonly<{
    readonly cashFlow?: CashFlowScenarioBindings;
    readonly investments?: CompiledInvestments["scenarioBindings"];
    readonly liabilities?: CompiledLiabilities["scenarioBindings"];
  }>;
}

const invalid = <T>(code: string, message: string): CompileResult<T> => ({ status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code, message, entityType: "household_projection" }]) });
const unsupported = <T>(diagnostics: readonly CapabilityDiagnostic[]): CompileResult<T> => ({ status: "unsupported", diagnostics: Object.freeze([...diagnostics]) });

const domainDiagnostic = (domain: string): CapabilityDiagnostic => capability("HOUSEHOLD_DOMAIN_REQUEST_REQUIRED", `The in-scope ${domain} domain has authored economics but no execution configuration was supplied.`, "household_projection", "Household", undefined, domain);
const activeOwner = (model: PortableModelEnvelope, object: CanonicalObject, scope: HouseholdScope, type: string, id: string): boolean => {
  const result = resolveOwnerScope(model, object.owner_id, scope, type, id);
  return result.status === "compiled" && result.value === "in_scope";
};

const compileStandaloneAssets = (model: PortableModelEnvelope, baseCurrency: string, simulationStart: string, simulationEnd: string): CompileResult<readonly CompiledStandaloneAsset[]> => {
  const preflight = preflightCanonicalCollections(model, ["Household", "Person", "Account", "Asset", "Investment", "PrimitiveInstance"]);
  if (preflight.status !== "compiled") return preflight;
  const scopeResult = resolveHouseholdScope(model);
  if (scopeResult.status !== "compiled") return scopeResult;
  for (const type of ["Investment", "Asset"] as const) for (const item of objects(model, type)) {
    const id = canonicalId(item, `${type.toLowerCase()}_id`);
    if (id === undefined) continue;
    const owner = resolveOwnerScope(model, item.owner_id, scopeResult.value, type, id);
    if (owner.status !== "compiled") return owner;
  }
  let currency: Currency;
  try { currency = Currency.of(baseCurrency); } catch (error) { return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "BASE_CURRENCY_INVALID", message: error instanceof Error ? error.message : "Base currency is invalid.", entityType: "household_projection" }]) }; }
  const start = utcDate(simulationStart); const end = utcDate(simulationEnd);
  if (!start || !end || start >= end) return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "HOUSEHOLD_HORIZON_INVALID", message: "Household asset compilation requires an increasing date-only horizon.", entityType: "household_projection" }]) };
  const diagnostics: CapabilityDiagnostic[] = [];
  const accounts = new Set(objects(model, "Account").map((item) => canonicalId(item, "account_id")).filter((id): id is string => id !== undefined));
  const linked = new Set<string>();
  for (const investment of objects(model, "Investment")) {
    const id = canonicalId(investment, "investment_id"); if (!id) continue;
    if (!activeOwner(model, investment, scopeResult.value, "Investment", id)) continue;
    const assetId = canonicalId(investment, "asset_id"); if (assetId) linked.add(assetId);
  }
  const result: CompiledStandaloneAsset[] = [];
  for (const asset of objects(model, "Asset")) {
    const id = canonicalId(asset, "asset_id"); if (!id) continue;
    if (!activeOwner(model, asset, scopeResult.value, "Asset", id)) continue;
    if (linked.has(id)) { diagnostics.push(capability("ASSET_INVESTMENT_OVERLAP_AMBIGUOUS", `Asset ${id} is represented by an Investment and cannot also be counted as a standalone asset.`, "household_projection", "Asset", id)); continue; }
    const accountId = canonicalId(asset, "account_id");
    if (asset.account_id !== undefined && asset.account_id !== null && (!accountId || !accounts.has(accountId))) return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "ASSET_ACCOUNT_REFERENCE_INVALID", message: `Asset ${id} account_id does not resolve to an Account.`, entityType: "Asset", entityId: id, fieldPath: "account_id" }]) };
    if (accountId) {
      const account = objects(model, "Account").find((item) => canonicalId(item, "account_id") === accountId)!;
      const accountOwner = resolveOwnerScope(model, account.owner_id, scopeResult.value, "Account", accountId);
      if (accountOwner.status !== "compiled") return accountOwner;
      if (accountOwner.value !== "in_scope") return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "ASSET_ACCOUNT_SCOPE_INVALID", message: `Asset ${id} references an Account outside the selected Household.`, entityType: "Asset", entityId: id, fieldPath: "account_id" }]) };
      diagnostics.push(capability("ASSET_ACCOUNT_OVERLAP_AMBIGUOUS", `Asset ${id} may overlap an Account economic resource.`, "household_projection", "Asset", id)); continue;
    }
    if (!ASSET_TYPES.includes(asset.asset_type as never)) return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "ASSET_TYPE_INVALID", message: `Asset ${id} asset_type is not canonical.`, entityType: "Asset", entityId: id, fieldPath: "asset_type" }]) };
    const acquired = asset.acquisition_date == null ? undefined : utcDate(asset.acquisition_date);
    const sold = asset.sale_date == null ? undefined : utcDate(asset.sale_date);
    if ((asset.acquisition_date != null && !acquired) || (asset.sale_date != null && !sold)) return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "DATE_INVALID", message: `Asset ${id} has an invalid acquisition or sale date.`, entityType: "Asset", entityId: id }]) };
    if (acquired !== undefined && sold !== undefined && sold < acquired) return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "ASSET_TEMPORAL_INTERVAL_INVALID", message: `Asset ${id} sale_date cannot precede acquisition_date.`, entityType: "Asset", entityId: id }]) };
    if (acquired !== undefined && acquired > start) { diagnostics.push(capability("ASSET_FUTURE_ACQUISITION_UNSUPPORTED", `Asset ${id} requires unsupported acquisition semantics inside the forecast boundary.`, "household_projection", "Asset", id, "acquisition_date")); continue; }
    if (sold !== undefined && sold > start && sold < end) { diagnostics.push(capability("ASSET_HORIZON_SALE_UNSUPPORTED", `Asset ${id} is disposed during the forecast horizon and its proceeds/accounting are unsupported.`, "household_projection", "Asset", id, "sale_date")); continue; }
    if (sold !== undefined && sold <= start) continue;
    if (!ASSET_VALUATION_METHODS.includes(asset.valuation_method as never) || asset.valuation_method !== "cost") { diagnostics.push(capability("ASSET_VALUATION_UNSUPPORTED", `Asset ${id} does not use the supported static cost valuation.`, "household_projection", "Asset", id, "valuation_method")); continue; }
    for (const field of ["appreciation_model_id", "depreciation_model_id"] as const) if (asset[field] != null) { if (typeof asset[field] !== "string" || !UUID.test(asset[field])) return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "ASSET_MODEL_REFERENCE_INVALID", message: `Asset ${id} ${field} must be a UUID.`, entityType: "Asset", entityId: id, fieldPath: field }]) }; diagnostics.push(capability("ASSET_VALUATION_UNSUPPORTED", `Asset ${id} has authored valuation behavior.`, "household_projection", "Asset", id, field)); }
    if (asset.appreciation_model_id != null || asset.depreciation_model_id != null) continue;
    if (asset.asset_type === "cash") { diagnostics.push(capability("ASSET_ACCOUNT_OVERLAP_AMBIGUOUS", `Asset ${id} may overlap cash held in an Account.`, "household_projection", "Asset", id)); continue; }
    const raw = asset.acquisition_cost;
    if (typeof raw !== "string" || !EXACT_DECIMAL.test(raw)) { diagnostics.push(capability("ASSET_COST_UNAVAILABLE", `Asset ${id} lacks a usable exact acquisition_cost.`, "household_projection", "Asset", id, "acquisition_cost")); continue; }
    try { const value = money(raw, currency); if (value.isNegative()) return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "DOMAIN_VALUE_INVALID", message: `Asset ${id} acquisition_cost must be non-negative.`, entityType: "Asset", entityId: id, fieldPath: "acquisition_cost" }]) }; result.push(Object.freeze({ id, value })); } catch { return { status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code: "DOMAIN_VALUE_INVALID", message: `Asset ${id} acquisition_cost is invalid.`, entityType: "Asset", entityId: id, fieldPath: "acquisition_cost" }]) }; }
  }
  return diagnostics.length ? unsupported(diagnostics) : { status: "compiled", value: Object.freeze(result), diagnostics: Object.freeze([]) };
};

/**
 * Compiles participating slices independently only up to their executable
 * inputs, then reconciles their partial state. It deliberately does not run or
 * aggregate a vertical slice.
 */
export const compileHouseholdProjection = (model: PortableModelEnvelope, request: HouseholdProjectionCompilerRequest): CompileResult<CompiledHouseholdProjection> => {
  const policyValidation = buildHouseholdScheduledPlan([], request.contentionPolicy);
  if (policyValidation.status === "invalid_model") return policyValidation;
  const scope = resolveHouseholdScope(model);
  if (scope.status !== "compiled") return scope;
  for (const type of ["Income", "Expense", "Investment", "Liability"] as const) for (const item of objects(model, type)) {
    const id = canonicalId(item, `${type.toLowerCase()}_id`);
    if (id === undefined) continue;
    const owner = resolveOwnerScope(model, item.owner_id, scope.value, type, id);
    if (owner.status !== "compiled") return owner;
  }
  if (scope.value.memberIds.length !== 1) return unsupported([capability("HOUSEHOLD_MULTI_MEMBER_UNSUPPORTED", "The existing VS2/VS3/VS4 execution-owner contracts cannot represent every member of this Household.", "household_projection", "Household", scope.value.householdId, "members")]);
  const firstBoundary = request.investments ?? request.liabilities ?? request.cashFlow;
  if (firstBoundary === undefined) return invalid("HOUSEHOLD_PROJECTION_EMPTY", "A household projection requires at least one execution boundary.");
  const inScope = (type: "Income" | "Expense" | "Investment" | "Liability") => objects(model, type).some((item) => { const id = canonicalId(item, `${type.toLowerCase()}_id`); return id !== undefined && activeOwner(model, item, scope.value, type, id); });
  const required: readonly [keyof HouseholdProjectionCompilerRequest, string, boolean][] = [["cashFlow", "cash flow", inScope("Income") || inScope("Expense")], ["investments", "investments", inScope("Investment")], ["liabilities", "liabilities", inScope("Liability")]];
  const missing = required.filter(([key, , applicable]) => applicable && request[key] === undefined).map(([, domain]) => domainDiagnostic(domain));
  if (missing.length) return unsupported(missing);
  const results = [
    request.cashFlow === undefined ? undefined : compileCashFlow(model, request.cashFlow),
    request.investments === undefined ? undefined : compileInvestments(model, request.investments),
    request.liabilities === undefined ? undefined : compileLiabilities(model, request.liabilities),
  ] as const;
  const bad = results.find((result) => result?.status === "invalid_model");
  if (bad?.status === "invalid_model") return bad;
  const unavailable = results.filter((result): result is Extract<typeof result, { readonly status: "unsupported" }> => result?.status === "unsupported");
  if (unavailable.length) return unsupported(unavailable.flatMap((result) => result.diagnostics));
  const [cash, investments, liabilities] = results as readonly [Extract<typeof results[0], { readonly status: "compiled" }> | undefined, Extract<typeof results[1], { readonly status: "compiled" }> | undefined, Extract<typeof results[2], { readonly status: "compiled" }> | undefined];
  if (cash === undefined && investments === undefined && liabilities === undefined) return invalid("HOUSEHOLD_PROJECTION_EMPTY", "A household projection requires at least one participating domain.");
  const compiled = [cash?.value, investments?.value, liabilities?.value].filter((value): value is CompiledCashFlow | CompiledInvestments | CompiledLiabilities => value !== undefined);
  const scenarios = new Set(compiled.map((value) => value.scenarioIdentity));
  const horizons = new Set(compiled.map((value) => value.executionMonths));
  const currencies = new Set(compiled.map((value) => value.input.baseCurrency.code));
  const households = new Set(compiled.map((value) => String(value.input.householdId)));
  const owners = new Set(compiled.map((value) => String(value.input.ownerId)));
  const requests = [request.cashFlow, request.investments, request.liabilities].filter((value): value is CashFlowCompilerRequest | InvestmentCompilerRequest | LiabilityCompilerRequest => value !== undefined);
  const starts = new Set(requests.map((value) => value.simulationStart));
  const ends = new Set(requests.map((value) => value.simulationEnd));
  const asOfs = new Set(requests.flatMap((value) => "asOf" in value && value.asOf !== undefined ? [value.asOf] : []));
  if (liabilities?.value.capabilityDiagnostics.length || false) return unsupported(liabilities.value.capabilityDiagnostics);
  if (scenarios.size !== 1 || horizons.size !== 1 || currencies.size !== 1 || households.size !== 1 || owners.size !== 1 || starts.size !== 1 || ends.size !== 1 || asOfs.size > 1) return invalid("HOUSEHOLD_COMPILER_DISAGREEMENT", "Participating compilers must agree on Household, execution owner, currency, scenario, as-of boundary, and exact horizon.");
  const standalone = compileStandaloneAssets(model, firstBoundary.baseCurrency, firstBoundary.simulationStart, firstBoundary.simulationEnd);
  if (standalone.status !== "compiled") return standalone;
  const opening = reconcileHouseholdOpeningState(compiled.map((value) => value.openingState));
  if (opening.status === "invalid_model") return opening;
  const primitive = reconcileHouseholdPrimitiveState(compiled.map((value) => "primitiveState" in value ? value.primitiveState : undefined));
  if (primitive.status === "invalid_model") return primitive;
  const bindings = Object.freeze({
    ...(cash === undefined ? {} : { cashFlow: cash.value.scenarioBindings }),
    ...(investments === undefined ? {} : { investments: investments.value.scenarioBindings }),
    ...(liabilities === undefined ? {} : { liabilities: liabilities.value.scenarioBindings }),
  });
  return { status: "compiled", diagnostics: Object.freeze([]), value: Object.freeze({
    ...(cash === undefined ? {} : { cashFlowInput: cash.value.input }),
    ...(investments === undefined ? {} : { investmentInput: investments.value.input }),
    ...(liabilities === undefined ? {} : { liabilityInput: liabilities.value.input }),
    reconciledOpeningState: opening.value,
    reconciledPrimitiveState: primitive.value,
    standaloneAssets: Object.freeze([...standalone.value]),
    scenarioIdentity: compiled[0]!.scenarioIdentity,
    executionMonths: compiled[0]!.executionMonths,
    ...(request.contentionPolicy === undefined ? {} : { contentionPolicy: Object.freeze({ ...request.contentionPolicy, rules: Object.freeze([...request.contentionPolicy.rules].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)))) }) }),
    diagnostics: Object.freeze(liabilities?.value.capabilityDiagnostics ?? []),
    scenarioBindings: bindings,
  }) };
};
