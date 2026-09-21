import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { runHouseholdProjection } from "../simulation/householdProjection.js";
import { createRunContext, runId, scenarioId } from "../simulation/run.js";
import { instant } from "../time/index.js";
import { Currency } from "../values/index.js";
import { compileHouseholdProjection, type HouseholdProjectionCompilerRequest } from "./compiler/householdProjection.js";
import type { CapabilityDiagnostic } from "./compiler/types.js";

export interface HouseholdForecastRequest extends HouseholdProjectionCompilerRequest { readonly dataCutoff: string; readonly runIdentity: string; }
export interface HouseholdForecastPoint {
  readonly periodStart: string; readonly periodEnd: string;
  readonly cash: { readonly amount: string; readonly currency: string };
  readonly investmentValue: { readonly amount: string; readonly currency: string };
  readonly assets: { readonly amount: string; readonly currency: string };
  readonly liabilities: { readonly amount: string; readonly currency: string };
  readonly netWorth: { readonly amount: string; readonly currency: string };
  readonly debtPrincipalReduction: { readonly amount: string; readonly currency: string };
  readonly traceIds: readonly string[];
}
export type HouseholdForecastReadModel =
  | { readonly scope: "household"; readonly status: "unavailable"; readonly message: string; readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[] }
  | { readonly scope: "household"; readonly status: "completed" | "incomplete"; readonly requestedHorizon: { readonly start: string; readonly end: string }; readonly reachedThrough?: string; readonly stoppedAt?: string; readonly asOf: string; readonly dataCutoff: string; readonly points: readonly HouseholdForecastPoint[]; readonly liquidityShortfalls: readonly unknown[]; readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[] };

const amount = (value: { readonly amount: { toString(): string }; readonly currency: { readonly code: string } }) => Object.freeze({ amount: value.amount.toString(), currency: value.currency.code });

/** Dedicated Personal-MVP application seam for the reconciled household scope. */
export const runPersonalHouseholdForecast = (model: PortableModelEnvelope, request: HouseholdForecastRequest): HouseholdForecastReadModel => {
  try {
    const compilation = compileHouseholdProjection(model, request);
    if (compilation.status !== "compiled") return Object.freeze({ scope: "household", status: "unavailable", message: compilation.diagnostics.map((item) => item.message).join("; "), diagnostics: compilation.diagnostics });
    const context = createRunContext({ runId: runId(request.runIdentity), scenarioId: scenarioId(compilation.value.scenarioIdentity), asOf: instant(`${request.asOf}T00:00:00.000Z`), dataCutoff: instant(`${request.dataCutoff}T00:00:00.000Z`), simulationStart: instant(`${request.simulationStart}T00:00:00.000Z`), simulationEnd: instant(`${request.simulationEnd}T00:00:00.000Z`), baseCurrency: Currency.of(request.baseCurrency) });
    const result = runHouseholdProjection({ runContext: context, compiled: compilation.value });
    return Object.freeze({ scope: "household", status: result.status, requestedHorizon: result.requestedHorizon, ...(result.reachedThrough === undefined ? {} : { reachedThrough: result.reachedThrough }), ...(result.stoppedAt === undefined ? {} : { stoppedAt: result.stoppedAt }), asOf: result.displayInputs.asOf, dataCutoff: result.displayInputs.dataCutoff,
      points: Object.freeze(result.periods.map((period) => Object.freeze({ periodStart: period.period.start, periodEnd: period.period.end, cash: amount(period.cash), investmentValue: amount(period.investmentValue), assets: amount(period.assets), liabilities: amount(period.liabilities), netWorth: amount(period.netWorth), debtPrincipalReduction: amount(period.liability.principalReduction), traceIds: Object.freeze(period.traceRefs.map((ref) => ref.traceId).sort()) }))),
      liquidityShortfalls: Object.freeze(result.periods.flatMap((period) => period.liquidityShortfalls)), diagnostics: Object.freeze([...compilation.value.diagnostics, ...result.diagnostics]) });
  } catch (error) {
    const diagnostics = error instanceof ValidationError ? error.issues : Object.freeze([]);
    return Object.freeze({ scope: "household", status: "unavailable", message: error instanceof Error ? error.message : "Household forecast could not be executed.", diagnostics });
  }
};
