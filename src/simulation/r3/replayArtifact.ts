import { Currency, DecimalAmount, Money, Percentage, Quantity, Rate, Ratio, RoundingPolicy, Unit, type RateConvention, type RoundingMode } from "../../values/index.js";
import type { HouseholdForecastSummaryResult, ExecutableHouseholdProjection } from "../householdExecution.js";
import type { RunContext, RunMetadata } from "../run.js";
import type { HouseholdForecastSummaryPeriod } from "./forecastSummary.js";
import { compileHouseholdKernel } from "./compiledHousehold.js";

type Wire = null | boolean | number | string | { readonly kind: string; readonly value: unknown };
const encode = (value: unknown): Wire => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Money) return { kind: "money", value: [value.amount.toString(), value.currency.code] };
  if (value instanceof DecimalAmount) return { kind: "decimal", value: value.toString() };
  if (value instanceof Currency) return { kind: "currency", value: value.code };
  if (value instanceof Unit) return { kind: "unit", value: value.code };
  if (value instanceof Quantity) return { kind: "quantity", value: [value.amount.toString(), value.unit.code] };
  if (value instanceof Rate) return { kind: "rate", value: [value.value.toString(), encode(value.convention)] };
  if (value instanceof Ratio) return { kind: "ratio", value: value.value.toString() };
  if (value instanceof Percentage) return { kind: "percentage", value: value.value.toString() };
  if (value instanceof RoundingPolicy) return { kind: "rounding", value: [value.scale, value.mode] };
  if (Array.isArray(value)) return { kind: "array", value: value.map(encode) };
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
    return { kind: "record", value: Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encode(item)]) };
  throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: non-portable execution input");
};
const decode = (wire: Wire): unknown => {
  if (wire === null || typeof wire !== "object") return wire;
  const value = wire.value;
  const pair = value as [string, string];
  switch (wire.kind) {
    case "money": return Money.parse(pair[0], Currency.of(pair[1]));
    case "decimal": return DecimalAmount.parse(value as string);
    case "currency": return Currency.of(value as string);
    case "unit": return Unit.of(value as string);
    case "quantity": return Quantity.parse(pair[0], Unit.of(pair[1]));
    case "rate": { const rate = value as [string, Wire]; return Rate.fromDecimal(rate[0], decode(rate[1]) as RateConvention); }
    case "ratio": return Ratio.parse(value as string);
    case "percentage": return Percentage.parse(value as string);
    case "rounding": { const policy = value as [number, RoundingMode]; return new RoundingPolicy(policy[0], policy[1]); }
    case "array": return Object.freeze((value as Wire[]).map(decode));
    case "record": return Object.freeze(Object.fromEntries((value as [string, Wire][]).map(([key, item]) => [key, decode(item)])));
    default: throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: unknown value representation");
  }
};

export interface PortableHouseholdReplayArtifact { readonly version: "household-replay/v1"; readonly encoded: string; }
/** One shared opening/configuration artifact per forecast; never a detailed history warehouse. */
export const createPortableHouseholdReplayArtifact = (forecast: HouseholdForecastSummaryResult): PortableHouseholdReplayArtifact => {
  const { executionKernel: _kernel, ...executable } = forecast.replay.kernel.executable;
  return Object.freeze({ version: "household-replay/v1", encoded: JSON.stringify(encode({ executable,
    runContext: forecast.replay.runContext, runMetadata: forecast.runMetadata, periods: forecast.periods })) });
};
export const restorePortableHouseholdReplayArtifact = (artifact: unknown): Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods"> => {
  const supplied = artifact as PortableHouseholdReplayArtifact | undefined;
  if (supplied?.version !== "household-replay/v1" || typeof supplied.encoded !== "string")
    throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNAVAILABLE: original execution artifacts are required");
  const restored = decode(JSON.parse(supplied.encoded) as Wire) as {
    executable: ExecutableHouseholdProjection; runContext: RunContext; runMetadata: RunMetadata; periods: readonly HouseholdForecastSummaryPeriod[];
  };
  const kernel = compileHouseholdKernel(restored.executable, restored.runContext.simulationStart);
  return Object.freeze({ runMetadata: restored.runMetadata, periods: restored.periods,
    replay: Object.freeze({ kernel, runContext: restored.runContext }) });
};
