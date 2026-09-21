import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { canonicalSerialize } from "../../simulation/run.js";
import { reconcileHouseholdOpeningState, reconcileHouseholdPrimitiveState } from "../../simulation/householdProjection.js";
import { buildHouseholdScheduledPlan, type HouseholdContentionPolicy } from "../../simulation/intraperiodScheduler.js";
import { compileCashFlow, type CashFlowCompilerRequest, type CashFlowScenarioBindings, type CompiledCashFlow } from "./cashFlow.js";
import { compileInvestments, type InvestmentCompilerRequest, type CompiledInvestments } from "./investments.js";
import { compileLiabilities, type LiabilityCompilerRequest, type CompiledLiabilities } from "./liabilities.js";
import type { CapabilityDiagnostic, CompileResult } from "./types.js";

/** Application boundary for the one reconciled PR20 execution input. */
export interface HouseholdProjectionCompilerRequest {
  readonly cashFlow?: CashFlowCompilerRequest;
  readonly investments?: InvestmentCompilerRequest;
  readonly liabilities?: LiabilityCompilerRequest;
  /** Mandatory even if the household has no current cross-domain contention. */
  readonly contentionPolicy: HouseholdContentionPolicy;
}

export interface CompiledHouseholdProjection {
  readonly cashFlowInput?: CompiledCashFlow["input"];
  readonly investmentInput?: CompiledInvestments["input"];
  readonly liabilityInput?: CompiledLiabilities["input"];
  readonly reconciledOpeningState: CompiledCashFlow["openingState"];
  readonly reconciledPrimitiveState: CompiledInvestments["primitiveState"];
  readonly standaloneAssets: readonly never[];
  readonly scenarioIdentity: string;
  readonly executionMonths: number;
  readonly contentionPolicy: HouseholdContentionPolicy;
  /** Binding names are part of the household scenario contract, never request-order slots. */
  readonly scenarioBindings: Readonly<{
    readonly cashFlow?: CashFlowScenarioBindings;
    readonly investments?: CompiledInvestments["scenarioBindings"];
    readonly liabilities?: CompiledLiabilities["scenarioBindings"];
  }>;
}

const invalid = <T>(code: string, message: string): CompileResult<T> => ({ status: "invalid_model", diagnostics: Object.freeze([{ severity: "error", code, message, entityType: "household_projection" }]) });
const unsupported = <T>(diagnostics: readonly CapabilityDiagnostic[]): CompileResult<T> => ({ status: "unsupported", diagnostics: Object.freeze([...diagnostics]) });

/**
 * Compiles participating slices independently only up to their executable
 * inputs, then reconciles their partial state. It deliberately does not run or
 * aggregate a vertical slice.
 */
export const compileHouseholdProjection = (model: PortableModelEnvelope, request: HouseholdProjectionCompilerRequest): CompileResult<CompiledHouseholdProjection> => {
  if (request.contentionPolicy === undefined) return invalid("HOUSEHOLD_CONTENTION_POLICY_INVALID", "Household projections require an explicit contention policy.");
  // Policy syntax is a pre-execution semantic input. Validate it even when a
  // particular horizon has no contending work yet; runtime planning adds the
  // descriptor-specific ambiguity checks later.
  const policyValidation = buildHouseholdScheduledPlan([], request.contentionPolicy);
  if (policyValidation.status === "invalid_model") return policyValidation;
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
  if (scenarios.size !== 1 || horizons.size !== 1 || currencies.size !== 1 || households.size !== 1) return invalid("HOUSEHOLD_COMPILER_DISAGREEMENT", "Participating compilers must agree on Household, currency, scenario, and horizon.");
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
    standaloneAssets: Object.freeze([]),
    scenarioIdentity: compiled[0]!.scenarioIdentity,
    executionMonths: compiled[0]!.executionMonths,
    contentionPolicy: Object.freeze({ ...request.contentionPolicy, rules: Object.freeze([...request.contentionPolicy.rules].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)))) }),
    scenarioBindings: bindings,
  }) };
};
