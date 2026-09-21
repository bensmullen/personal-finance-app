import { ValidationError, validationIssue } from "../../diagnostics/index.js";
import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { canonicalSerialize } from "../../simulation/run.js";
import { createPrimitiveRuntimeStateStore, type PrimitiveRuntimeStateStore } from "../../simulation/period.js";
import type { VerticalSlice2Input } from "../../simulation/verticalSlice2.js";
import type { VerticalSlice3Input } from "../../simulation/verticalSlice3.js";
import type { VerticalSlice4Input } from "../../simulation/verticalSlice4.js";
import { createAuthoritativeState, type AuthoritativeState } from "../../state/index.js";
import { compileCashFlow, type RetirementTerminationBinding, type SameInstantCashFlowOrder } from "./cashFlow.js";
import { compileInvestments, type InvestmentPurchaseExecutionInstruction, type InvestmentTransferExecutionInstruction } from "./investments.js";
import { compileLiabilities, type LiabilityExecutionProfile } from "./liabilities.js";
import type { CapabilityDiagnostic, CompileResult } from "./types.js";

export interface HouseholdProjectionCompilerRequest {
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly months?: number;
  readonly executionOwnerId: string;
  readonly sameInstantCashFlowOrder: SameInstantCashFlowOrder;
  readonly transferInstructions: readonly InvestmentTransferExecutionInstruction[];
  readonly purchaseInstructions: readonly InvestmentPurchaseExecutionInstruction[];
  readonly liabilityExecutionProfiles: readonly LiabilityExecutionProfile[];
  readonly retirementBindings?: readonly RetirementTerminationBinding[];
  readonly scenarioId?: string;
}

export interface CompiledHouseholdProjection {
  readonly cashFlowInput: VerticalSlice2Input;
  readonly investmentInput: VerticalSlice3Input;
  readonly liabilityInput: VerticalSlice4Input;
  readonly openingState: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly diagnostics: readonly CapabilityDiagnostic[];
}

const conflict = (kind: string, id: string): never => {
  throw new ValidationError(validationIssue({
    severity: "error",
    code: "HOUSEHOLD_STATE_RECONCILIATION_CONFLICT",
    message: `Conflicting duplicate ${kind} identity ${id}.`,
    entityType: kind,
    entityId: id,
  }));
};

const mergeEntityMap = <T extends { readonly id: string }>(
  states: readonly AuthoritativeState[],
  key: "accounts" | "positions" | "liabilities" | "obligations",
): Record<string, T> => {
  const merged: Record<string, T> = {};
  for (const state of states) for (const [id, entity] of Object.entries(state[key])) {
    if (id !== entity.id) conflict(key, id);
    const prior = merged[id];
    if (prior !== undefined && canonicalSerialize(prior) !== canonicalSerialize(entity)) conflict(key, id);
    merged[id] = entity as T;
  }
  return merged;
};

/** Deterministically reconciles partial compiler states; duplicates must be identical. */
export const reconcileAuthoritativeStates = (states: readonly AuthoritativeState[]): AuthoritativeState =>
  createAuthoritativeState({
    accounts: mergeEntityMap(states, "accounts"),
    positions: mergeEntityMap(states, "positions"),
    liabilities: mergeEntityMap(states, "liabilities"),
    obligations: mergeEntityMap(states, "obligations"),
    identities: {
      postedTransactionIds: states.flatMap((state) => state.identities.postedTransactionIds),
      recognitionIds: states.flatMap((state) => state.identities.recognitionIds),
      settlementIds: states.flatMap((state) => state.identities.settlementIds),
      generatedOccurrenceKeys: states.flatMap((state) => state.identities.generatedOccurrenceKeys),
      externalIdempotencyKeys: states.flatMap((state) => state.identities.externalIdempotencyKeys),
    },
  });

/** Deterministically reconciles primitive checkpoints; duplicate entries must be identical. */
export const reconcilePrimitiveRuntimeStates = (stores: readonly PrimitiveRuntimeStateStore[]): PrimitiveRuntimeStateStore => {
  const merged: Record<string, PrimitiveRuntimeStateStore[string]> = {};
  for (const store of stores) for (const [id, entry] of Object.entries(store)) {
    const prior = merged[id];
    if (prior !== undefined && canonicalSerialize(prior) !== canonicalSerialize(entry)) conflict("primitive_runtime_state", id);
    merged[id] = entry;
  }
  return createPrimitiveRuntimeStateStore(merged);
};

const invalid = (error: unknown): CompileResult<never> => ({
  status: "invalid_model",
  diagnostics: Object.freeze(error instanceof ValidationError ? [...error.issues] : [validationIssue({
    severity: "error", code: "HOUSEHOLD_PROJECTION_INVALID", message: error instanceof Error ? error.message : "Household projection compilation failed.", entityType: "household_projection",
  })]),
});

export const compileHouseholdProjection = (
  model: PortableModelEnvelope,
  request: HouseholdProjectionCompilerRequest,
): CompileResult<CompiledHouseholdProjection> => {
  const common = { baseCurrency: request.baseCurrency, simulationStart: request.simulationStart, simulationEnd: request.simulationEnd, ...(request.months === undefined ? {} : { months: request.months }), ...(request.scenarioId === undefined ? {} : { scenarioId: request.scenarioId }) };
  const cash = compileCashFlow(model, { ...common, sameInstantCashFlowOrder: request.sameInstantCashFlowOrder, ...(request.retirementBindings === undefined ? {} : { retirementBindings: request.retirementBindings }) });
  if (cash.status !== "compiled") return cash;
  const investments = compileInvestments(model, { ...common, asOf: request.asOf, executionOwnerId: request.executionOwnerId, transferInstructions: request.transferInstructions, purchaseInstructions: request.purchaseInstructions });
  if (investments.status !== "compiled") return investments;
  const liabilities = compileLiabilities(model, { ...common, asOf: request.asOf, executionOwnerId: request.executionOwnerId, executionProfiles: request.liabilityExecutionProfiles });
  if (liabilities.status !== "compiled") return liabilities;
  try {
    const identities = [cash.value.scenarioIdentity, investments.value.scenarioIdentity, liabilities.value.scenarioIdentity];
    const months = [cash.value.executionMonths, investments.value.executionMonths, liabilities.value.executionMonths];
    const currencies = [cash.value.input.baseCurrency, investments.value.input.baseCurrency, liabilities.value.input.baseCurrency];
    if (new Set(identities).size !== 1 || new Set(months).size !== 1 || currencies.some((currency) => !currency.equals(currencies[0]!))) {
      throw new ValidationError(validationIssue({ severity: "error", code: "HOUSEHOLD_EXECUTION_IDENTITY_MISMATCH", message: "Constituent scenario, horizon, and currency identities must agree.", entityType: "household_projection" }));
    }
    const { cashFlowInput: _cashFlowInput, ...investmentOnlyInput } = investments.value.input;
    return { status: "compiled", value: Object.freeze({
      cashFlowInput: cash.value.input,
      investmentInput: Object.freeze(investmentOnlyInput),
      liabilityInput: liabilities.value.input,
      openingState: reconcileAuthoritativeStates([cash.value.openingState, investments.value.openingState, liabilities.value.openingState]),
      primitiveState: reconcilePrimitiveRuntimeStates([investments.value.primitiveState, liabilities.value.primitiveState]),
      scenarioIdentity: identities[0]!, executionMonths: months[0]!, diagnostics: liabilities.value.capabilityDiagnostics,
    }), diagnostics: Object.freeze([]) };
  } catch (error) { return invalid(error); }
};
