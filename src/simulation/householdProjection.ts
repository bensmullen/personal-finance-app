import type { ValidationIssue } from "../diagnostics/index.js";
import { createAuthoritativeIdentityRegistry, createAuthoritativeState, type AuthoritativeIdentityRegistry, type AuthoritativeState } from "../state/index.js";
import { createPrimitiveRuntimeStateStore, type PrimitiveRuntimeStateStore } from "./period.js";
import { canonicalSerialize, createInputFingerprint, type InputFingerprint, type RunContext } from "./run.js";
import { Money, sumMoney, type Currency } from "../values/index.js";
import { positionMarketValue } from "../valuation/index.js";
import { canonicalHouseholdContentionPolicy, canonicalHouseholdWorkPlan, type HouseholdContentionPolicy, type HouseholdWorkDescriptor } from "./intraperiodScheduler.js";

export type HouseholdReconciliationResult<T> =
  | { readonly status: "compiled"; readonly value: T }
  | { readonly status: "invalid_model"; readonly diagnostics: readonly ValidationIssue[] };
const invalid = <T>(code: string, message: string, ids: readonly string[]): HouseholdReconciliationResult<T> => ({ status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code, message, entityType: "household_projection", relatedIds: Object.freeze([...ids].sort()) }]) });

/** Exact, identity-preserving merge; neither slice position nor request order is meaningful. */
export const reconcileHouseholdOpeningState = (states: readonly AuthoritativeState[]): HouseholdReconciliationResult<AuthoritativeState> => {
  const collections: (keyof Pick<AuthoritativeState, "accounts" | "positions" | "liabilities" | "obligations">)[] = ["accounts", "positions", "liabilities", "obligations"];
  const merged: Record<string, Record<string, unknown>> = Object.fromEntries(collections.map((key) => [key, {}]));
  const identities: { [K in keyof AuthoritativeIdentityRegistry]: AuthoritativeIdentityRegistry[K][number][] } = { postedTransactionIds: [], recognitionIds: [], settlementIds: [], generatedOccurrenceKeys: [], externalIdempotencyKeys: [] };
  for (const state of states) {
    for (const collection of collections) for (const [id, value] of Object.entries(state[collection])) {
      const existing = merged[collection]![id];
      if (existing !== undefined && canonicalSerialize(existing) !== canonicalSerialize(value)) return invalid("HOUSEHOLD_OPENING_STATE_CONFLICT", `Conflicting ${collection} entity ${id} across household compilers.`, [id]);
      merged[collection]![id] = value;
    }
    identities.postedTransactionIds.push(...state.identities.postedTransactionIds);
    identities.recognitionIds.push(...state.identities.recognitionIds);
    identities.settlementIds.push(...state.identities.settlementIds);
    identities.generatedOccurrenceKeys.push(...state.identities.generatedOccurrenceKeys);
    identities.externalIdempotencyKeys.push(...state.identities.externalIdempotencyKeys);
  }
  try {
    return { status: "compiled", value: createAuthoritativeState({ accounts: merged.accounts as AuthoritativeState["accounts"], positions: merged.positions as AuthoritativeState["positions"], liabilities: merged.liabilities as AuthoritativeState["liabilities"], obligations: merged.obligations as AuthoritativeState["obligations"], identities: createAuthoritativeIdentityRegistry(identities) }) };
  } catch (error) { return invalid("HOUSEHOLD_OPENING_STATE_INVALID", error instanceof Error ? error.message : "Merged household state is invalid.", []); }
};

export const reconcileHouseholdPrimitiveState = (states: readonly (PrimitiveRuntimeStateStore | undefined)[]): HouseholdReconciliationResult<PrimitiveRuntimeStateStore> => {
  const merged: Record<string, PrimitiveRuntimeStateStore[string]> = {};
  for (const state of states) for (const [id, value] of Object.entries(state ?? {})) {
    if (merged[id] !== undefined && canonicalSerialize(merged[id]) !== canonicalSerialize(value)) return invalid("HOUSEHOLD_PRIMITIVE_STATE_CONFLICT", `Conflicting primitive runtime state ${id} across household compilers.`, [id]);
    merged[id] = value;
  }
  try { return { status: "compiled", value: createPrimitiveRuntimeStateStore(merged) }; }
  catch (error) { return invalid("HOUSEHOLD_PRIMITIVE_STATE_INVALID", error instanceof Error ? error.message : "Merged primitive runtime state is invalid.", []); }
};

/**
 * The sole economic fingerprint input for a reconciled household run. `runId`
 * is deliberately excluded by createInputFingerprint; executable callbacks are
 * absent because descriptors are serializable data only.
 */
export const createHouseholdProjectionFingerprint = (input: {
  readonly runContext: RunContext;
  readonly openingState: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly descriptors: readonly HouseholdWorkDescriptor[];
  readonly contentionPolicy: HouseholdContentionPolicy;
  readonly scenario?: unknown;
  readonly executableInputs?: unknown;
  readonly standaloneAssets?: unknown;
}): InputFingerprint => createInputFingerprint({
  runContext: input.runContext,
  openingState: input.openingState,
  primitiveState: input.primitiveState,
  executionPlan: canonicalHouseholdWorkPlan(input.descriptors, input.contentionPolicy),
  scenario: input.scenario,
  model: input.executableInputs,
  policyInputs: { contentionPolicy: canonicalHouseholdContentionPolicy(input.contentionPolicy), standaloneAssets: input.standaloneAssets ?? [] },
});

export interface HouseholdClosingMetrics { readonly cash: Money; readonly investmentValue: Money; readonly standaloneAssetValue: Money; readonly totalAssets: Money; readonly totalLiabilities: Money; readonly netWorth: Money; }
/** Consolidates the one closing state; account containers are intentionally never added. */
export const deriveHouseholdClosingMetrics = (state: AuthoritativeState, currency: Currency, standaloneAssets: readonly { readonly value: Money }[] = []): HouseholdClosingMetrics => {
  const cash = sumMoney(Object.values(state.accounts).map((item) => item.cash), currency);
  const investmentValue = sumMoney(Object.values(state.positions).map(positionMarketValue), currency);
  const standaloneAssetValue = sumMoney(standaloneAssets.map((item) => item.value), currency);
  const totalAssets = cash.plus(investmentValue).plus(standaloneAssetValue);
  const totalLiabilities = sumMoney(Object.values(state.liabilities).map((item) => item.balance), currency);
  return Object.freeze({ cash, investmentValue, standaloneAssetValue, totalAssets, totalLiabilities, netWorth: totalAssets.minus(totalLiabilities) });
};
