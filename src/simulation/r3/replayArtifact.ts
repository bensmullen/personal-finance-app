import { Currency, DecimalAmount, Money, Percentage, Quantity, Rate, Ratio, RoundingPolicy, Unit, type RateConvention, type RoundingMode } from "../../values/index.js";
import type { HouseholdForecastSummaryResult, ExecutableHouseholdProjection } from "../householdExecution.js";
import type { RunContext, RunMetadata } from "../run.js";
import type { HouseholdForecastSummaryPeriod } from "./forecastSummary.js";
import { compileHouseholdKernel } from "./compiledHousehold.js";
import { portableHouseholdParticipant, restoreHouseholdParticipant, type PortableHouseholdParticipant } from "./participantCodec.js";
// Composition boundary: domain codecs register factories; replay dispatch stays generic.
import "../tax/replayCodec.js";
import "../workplaceEvents.js";
import "../domainMechanics.js";
import "../mortgageLifecycle.js";

type Wire = null | boolean | number | string | { readonly kind: string; readonly value: unknown };
interface EncodingGraph { readonly identities: Map<object, Wire>; readonly content: Map<string, Wire>; readonly active: Set<object> }
const encode = (value: unknown, graph?: EncodingGraph): Wire => {
  if (graph === undefined || value === null || typeof value !== "object") return encodeValue(value, graph);
  const existing = graph.identities.get(value);
  if (existing !== undefined) return existing;
  if (graph.active.has(value)) throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: cyclic execution input");
  graph.active.add(value);
  const payload = encodeValue(value, graph);
  graph.active.delete(value);
  const key = JSON.stringify(payload), shared = graph.content.get(key);
  if (shared !== undefined) { graph.identities.set(value, shared); return shared; }
  const id = graph.content.size, reference = { kind: "reference", value: id };
  graph.content.set(key, reference); graph.identities.set(value, reference);
  return { kind: "definition", value: [id, payload] };
};
const encodeValue = (value: unknown, graph?: EncodingGraph): Wire => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Money) return { kind: "money", value: [value.amount.toString(), value.currency.code] };
  if (value instanceof DecimalAmount) return { kind: "decimal", value: value.toString() };
  if (value instanceof Currency) return { kind: "currency", value: value.code };
  if (value instanceof Unit) return { kind: "unit", value: value.code };
  if (value instanceof Quantity) return { kind: "quantity", value: [value.amount.toString(), value.unit.code] };
  if (value instanceof Rate) return { kind: "rate", value: [value.value.toString(), encode(value.convention, graph)] };
  if (value instanceof Ratio) return { kind: "ratio", value: value.value.toString() };
  if (value instanceof Percentage) return { kind: "percentage", value: value.value.toString() };
  if (value instanceof RoundingPolicy) return { kind: "rounding", value: [value.scale, value.mode] };
  if (Array.isArray(value)) return { kind: "array", value: value.map(item => encode(item, graph)) };
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
    return { kind: "record", value: Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encode(item, graph)]) };
  throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: non-portable execution input");
};
const decode = (wire: Wire, references = new Map<number, unknown>()): unknown => {
  if (wire === null || typeof wire !== "object") return wire;
  const value = wire.value;
  const pair = value as [string, string];
  switch (wire.kind) {
    case "definition": {
      const [id, payload] = value as [number, Wire];
      if (!Number.isSafeInteger(id) || id < 0 || references.has(id)) throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: invalid shared definition");
      const restored = decode(payload, references); references.set(id, restored); return restored;
    }
    case "reference": {
      if (typeof value !== "number" || !references.has(value)) throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: missing shared definition");
      return references.get(value);
    }
    case "money": return Money.parse(pair[0], Currency.of(pair[1]));
    case "decimal": return DecimalAmount.parse(value as string);
    case "currency": return Currency.of(value as string);
    case "unit": return Unit.of(value as string);
    case "quantity": return Quantity.parse(pair[0], Unit.of(pair[1]));
    case "rate": { const rate = value as [string, Wire]; return Rate.fromDecimal(rate[0], decode(rate[1], references) as RateConvention); }
    case "ratio": return Ratio.parse(value as string);
    case "percentage": return Percentage.parse(value as string);
    case "rounding": { const policy = value as [number, RoundingMode]; return new RoundingPolicy(policy[0], policy[1]); }
    case "array": return Object.freeze((value as Wire[]).map(item => decode(item, references)));
    case "record": return Object.freeze(Object.fromEntries((value as [string, Wire][]).map(([key, item]) => [key, decode(item, references)])));
    default: throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: unknown value representation");
  }
};

export interface PortableHouseholdReplayArtifact { readonly version: "household-replay/v1" | "household-replay/v2"; readonly encoded: string; }
/** One shared opening/configuration artifact per forecast; never a detailed history warehouse. */
export const createPortableHouseholdReplayArtifact = (forecast: HouseholdForecastSummaryResult): PortableHouseholdReplayArtifact => {
  const { executionKernel: _kernel, participants, ...base } = forecast.replay.kernel.executable;
  const executable = { ...base, ...(participants === undefined ? {} : { participants: participants.map(portableHouseholdParticipant) }) };
  const graph = participants?.length ? { identities: new Map<object, Wire>(), content: new Map<string, Wire>(), active: new Set<object>() } : undefined;
  return Object.freeze({ version: graph === undefined ? "household-replay/v1" : "household-replay/v2", encoded: JSON.stringify(encode({ executable,
    runContext: forecast.replay.runContext, runMetadata: forecast.runMetadata, periods: forecast.periods }, graph)) });
};
export const restorePortableHouseholdReplayArtifact = (artifact: unknown): Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods"> => {
  const supplied = artifact as PortableHouseholdReplayArtifact | undefined;
  if ((supplied?.version !== "household-replay/v1" && supplied?.version !== "household-replay/v2") || typeof supplied.encoded !== "string")
    throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNAVAILABLE: original execution artifacts are required");
  const restored = decode(JSON.parse(supplied.encoded) as Wire) as {
    executable: Omit<ExecutableHouseholdProjection, "participants"> & { readonly participants?: readonly PortableHouseholdParticipant[] }; runContext: RunContext; runMetadata: RunMetadata; periods: readonly HouseholdForecastSummaryPeriod[];
  };
  const { participants, ...base } = restored.executable;
  const executable = { ...base, ...(participants === undefined ? {} : { participants: participants.map(restoreHouseholdParticipant) }) };
  const kernel = compileHouseholdKernel(executable, restored.runContext.simulationStart);
  return Object.freeze({ runMetadata: restored.runMetadata, periods: restored.periods,
    replay: Object.freeze({ kernel, runContext: restored.runContext }) });
};
