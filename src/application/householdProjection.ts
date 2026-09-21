import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { runCompiledHouseholdProjection, type CompiledHouseholdProjectionRunResult } from "../simulation/householdExecution.js";
import { createRunContext, runId, scenarioId } from "../simulation/run.js";
import { instant } from "../time/index.js";
import { Currency, Money } from "../values/index.js";
import { compileHouseholdProjection, type HouseholdProjectionCompilerRequest } from "./compiler/householdProjection.js";
import type { CapabilityDiagnostic } from "./compiler/types.js";

export interface HouseholdForecastRequest {
  readonly compiler: HouseholdProjectionCompilerRequest;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly runIdentity: string;
}
export interface HouseholdMoneyReadModel { readonly amount: string; readonly currency: string; }
export interface HouseholdForecastPoint {
  readonly periodStart: string; readonly periodEnd: string;
  readonly cash: HouseholdMoneyReadModel; readonly investmentValue: HouseholdMoneyReadModel;
  readonly assets: HouseholdMoneyReadModel; readonly liabilities: HouseholdMoneyReadModel; readonly netWorth: HouseholdMoneyReadModel;
  readonly debtPrincipalReduction: HouseholdMoneyReadModel;
  readonly debtBalances: readonly { readonly loanId: string; readonly principal: HouseholdMoneyReadModel; readonly outstandingInterest: HouseholdMoneyReadModel }[];
  readonly liquidityShortfallCount: number; readonly traceIds: readonly string[];
}
export type PersonalHouseholdForecastReadModel =
  | { readonly scope: "household"; readonly status: "unavailable"; readonly message: string; readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[] }
  | { readonly scope: "household"; readonly status: "completed" | "incomplete"; readonly requestedHorizon: { readonly start: string; readonly end: string }; readonly reachedThrough?: string; readonly stoppedAt?: string; readonly asOf: string; readonly dataCutoff: string; readonly points: readonly HouseholdForecastPoint[]; readonly liquidityShortfalls: readonly unknown[]; readonly debtPayoffs: readonly { readonly loanId: string; readonly scheduledAt: string }[]; readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[] };

const moneyDto = (value: Money): HouseholdMoneyReadModel => Object.freeze({ amount: value.amount.toString(), currency: value.currency.code });
const boundary = (request: HouseholdProjectionCompilerRequest) => request.investments ?? request.liabilities ?? request.cashFlow;

const execute = (model: PortableModelEnvelope, request: HouseholdForecastRequest): { readonly compiled?: ReturnType<typeof compileHouseholdProjection>; readonly result?: CompiledHouseholdProjectionRunResult; readonly read: PersonalHouseholdForecastReadModel } => {
  try {
    if (request.compiler.cashFlow === undefined || request.compiler.investments === undefined || request.compiler.liabilities === undefined) return { read: Object.freeze({ scope: "household", status: "unavailable", message: "Authoritative household forecasts require cash-flow, investment, and liability compiler requests.", diagnostics: Object.freeze([{ code: "HOUSEHOLD_CONSTITUENT_REQUIRED", message: "All three supported household domains must participate explicitly.", capability: "household_projection" }]) }) };
    const compiled = compileHouseholdProjection(model, request.compiler);
    if (compiled.status !== "compiled") return { compiled, read: Object.freeze({ scope: "household", status: "unavailable", message: compiled.diagnostics.map((item) => item.message).join("; "), diagnostics: compiled.diagnostics }) };
    const selected = boundary(request.compiler);
    if (selected === undefined) return { compiled, read: Object.freeze({ scope: "household", status: "unavailable", message: "A household execution boundary is required.", diagnostics: Object.freeze([]) }) };
    const compilerAsOf = [request.compiler.investments?.asOf, request.compiler.liabilities?.asOf].filter((value): value is string => value !== undefined);
    if (compilerAsOf.some((value) => value !== request.asOf)) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_AS_OF_MISMATCH", message: "Household asOf must match every participating compiler boundary.", entityType: "household_projection" });
    const context = createRunContext({ runId: runId(request.runIdentity), scenarioId: scenarioId(compiled.value.scenarioIdentity), asOf: instant(`${request.asOf}T00:00:00.000Z`), dataCutoff: instant(`${request.dataCutoff}T00:00:00.000Z`), simulationStart: instant(`${selected.simulationStart}T00:00:00.000Z`), simulationEnd: instant(`${selected.simulationEnd}T00:00:00.000Z`), baseCurrency: Currency.of(selected.baseCurrency) });
    const result = runCompiledHouseholdProjection({ runContext: context, compiled: compiled.value });
    const debtPayoffs = result.periods.flatMap((period) => (period.liability?.liabilities ?? []).filter((item) => item.endingPrincipal.isZero() && item.outstandingInterest.isZero()).map((item) => ({ loanId: String(item.loanId), scheduledAt: item.scheduledAt })));
    const read: PersonalHouseholdForecastReadModel = Object.freeze({ scope: "household", status: result.status, requestedHorizon: result.requestedHorizon, ...(result.reachedThrough === undefined ? {} : { reachedThrough: result.reachedThrough }), ...(result.stoppedAt === undefined ? {} : { stoppedAt: result.stoppedAt }), asOf: result.displayInputs.asOf, dataCutoff: result.displayInputs.dataCutoff,
      points: Object.freeze(result.periods.map((period) => Object.freeze({ periodStart: period.period.start, periodEnd: period.period.end, cash: moneyDto(period.cash), investmentValue: moneyDto(period.investmentValue), assets: moneyDto(period.assets), liabilities: moneyDto(period.liabilities), netWorth: moneyDto(period.netWorth), debtPrincipalReduction: moneyDto(period.liability?.principalReduction ?? Money.zero(context.baseCurrency)), debtBalances: Object.freeze((period.liability?.liabilities ?? []).map((item) => Object.freeze({ loanId: String(item.loanId), principal: moneyDto(item.endingPrincipal), outstandingInterest: moneyDto(item.outstandingInterest) }))), liquidityShortfallCount: period.liquidityShortfalls.length, traceIds: Object.freeze(period.traceRefs.map((ref) => ref.traceId).sort()) }))),
      liquidityShortfalls: Object.freeze(result.periods.flatMap((period) => period.liquidityShortfalls)), debtPayoffs: Object.freeze(debtPayoffs), diagnostics: Object.freeze([...compiled.value.diagnostics, ...result.diagnostics]) });
    return { compiled, result, read };
  } catch (error) {
    const diagnostics = error instanceof ValidationError ? error.issues : Object.freeze([]);
    return { read: Object.freeze({ scope: "household", status: "unavailable", message: error instanceof Error ? error.message : "Household forecast could not be executed.", diagnostics }) };
  }
};

/** Personal-MVP read-model seam for the reconciled household projection. */
export const runPersonalHouseholdForecast = (model: PortableModelEnvelope, request: HouseholdForecastRequest): PersonalHouseholdForecastReadModel => execute(model, request).read;

export interface PersonalHouseholdScenarioComparisonRequest {
  readonly baseline: { readonly name: string; readonly model: PortableModelEnvelope; readonly request: HouseholdForecastRequest };
  readonly alternatives: readonly { readonly name: string; readonly model: PortableModelEnvelope; readonly request: HouseholdForecastRequest; readonly configurationDifferences?: readonly Readonly<Record<string, unknown>>[] }[];
}
export interface PersonalHouseholdScenarioComparisonReadModel {
  readonly status: "completed" | "incomplete" | "unavailable";
  readonly baselineName: string;
  readonly alternatives: readonly { readonly name: string; readonly status: "completed" | "incomplete"; readonly comparedThrough?: string; readonly configurationDifferences: readonly Readonly<Record<string, unknown>>[]; readonly points: readonly { readonly periodStart: string; readonly periodEnd: string; readonly baseline: HouseholdForecastPoint; readonly alternative: HouseholdForecastPoint; readonly deltas: { readonly cash: HouseholdMoneyReadModel; readonly investmentValue: HouseholdMoneyReadModel; readonly assets: HouseholdMoneyReadModel; readonly liabilities: HouseholdMoneyReadModel; readonly netWorth: HouseholdMoneyReadModel }; readonly traceIds: readonly string[] }[] }[];
  readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
  readonly message?: string;
}

/** Each scenario is independently compiled and executed as a reconciled household projection. */
export const comparePersonalHouseholdScenarios = (request: PersonalHouseholdScenarioComparisonRequest): PersonalHouseholdScenarioComparisonReadModel => {
  const baseline = execute(request.baseline.model, request.baseline.request);
  if (baseline.result === undefined || baseline.read.status === "unavailable") return Object.freeze({ status: "unavailable", baselineName: request.baseline.name, alternatives: Object.freeze([]), diagnostics: baseline.read.diagnostics, message: baseline.read.status === "unavailable" ? baseline.read.message : "Baseline household projection is unavailable." });
  const alternatives = [] as Array<PersonalHouseholdScenarioComparisonReadModel["alternatives"][number]>;
  const diagnostics: (ValidationIssue | CapabilityDiagnostic)[] = [...baseline.read.diagnostics];
  let complete = baseline.result.status === "completed";
  for (const item of request.alternatives) {
    const alternative = execute(item.model, item.request);
    if (alternative.result === undefined || alternative.read.status === "unavailable") return Object.freeze({ status: "unavailable", baselineName: request.baseline.name, alternatives: Object.freeze(alternatives), diagnostics: Object.freeze([...diagnostics, ...alternative.read.diagnostics]), message: alternative.read.status === "unavailable" ? alternative.read.message : `Alternative ${item.name} is unavailable.` });
    const count = Math.min(baseline.result.periods.length, alternative.result.periods.length);
    const points = Object.freeze(Array.from({ length: count }, (_, index) => {
      const left = baseline.result!.periods[index]!; const right = alternative.result!.periods[index]!;
      if (left.period.start !== right.period.start || left.period.end !== right.period.end) throw new ValidationError({ severity: "error", code: "HOUSEHOLD_SCENARIO_HORIZON_MISMATCH", message: "Household scenario period structures must match.", entityType: "household_projection" });
      return Object.freeze({ periodStart: left.period.start, periodEnd: left.period.end, baseline: (baseline.read as Extract<PersonalHouseholdForecastReadModel, { status: "completed" | "incomplete" }>).points[index]!, alternative: (alternative.read as Extract<PersonalHouseholdForecastReadModel, { status: "completed" | "incomplete" }>).points[index]!, deltas: Object.freeze({ cash: moneyDto(right.cash.minus(left.cash)), investmentValue: moneyDto(right.investmentValue.minus(left.investmentValue)), assets: moneyDto(right.assets.minus(left.assets)), liabilities: moneyDto(right.liabilities.minus(left.liabilities)), netWorth: moneyDto(right.netWorth.minus(left.netWorth)) }), traceIds: Object.freeze([...new Set([...left.traceRefs, ...right.traceRefs].map((ref) => ref.traceId))].sort()) });
    }));
    complete &&= alternative.result.status === "completed";
    diagnostics.push(...alternative.read.diagnostics);
    alternatives.push(Object.freeze({ name: item.name, status: alternative.result.status, ...(count === 0 ? {} : { comparedThrough: points[count - 1]!.periodEnd }), configurationDifferences: Object.freeze([...(item.configurationDifferences ?? [])]), points }));
  }
  return Object.freeze({ status: complete ? "completed" : "incomplete", baselineName: request.baseline.name, alternatives: Object.freeze(alternatives), diagnostics: Object.freeze(diagnostics) });
};
