import { Currency, DecimalAmount, Money, Percentage, Quantity, Rate, Ratio, RoundingPolicy, Unit, type RateConvention, type RoundingMode } from "../../values/index.js";
import { exportHouseholdReplayCheckpoints, registerHouseholdReplayCheckpoints, type HouseholdReplayCheckpoint, type HouseholdForecastSummaryResult, type ExecutableHouseholdProjection } from "../householdExecution.js";
import { createAuthoritativeState, type AuthoritativeState } from "../../state/index.js";
import { createInputFingerprint } from "../run.js";
import { TaxEconomicLedger } from "../tax/economics.js";
import { TaxDiagnosticLedger } from "../tax/diagnostics.js";
import type { RecognizedTaxEconomics, TaxCapabilityDiagnostic } from "../tax/contracts.js";
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
  if (value instanceof TaxEconomicLedger) return { kind: "tax_economics", value: encode([...value], graph) };
  if (value instanceof TaxDiagnosticLedger) return { kind: "tax_diagnostics", value: encode([...value], graph) };
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
    case "tax_economics": return TaxEconomicLedger.empty().with(decode(value as Wire, references) as readonly RecognizedTaxEconomics[]);
    case "tax_diagnostics": return TaxDiagnosticLedger.empty().with(decode(value as Wire, references) as readonly TaxCapabilityDiagnostic[]);
    case "array": return Object.freeze((value as Wire[]).map(item => decode(item, references)));
    case "record": return Object.freeze(Object.fromEntries((value as [string, Wire][]).map(([key, item]) => [key, decode(item, references)])));
    default: throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: unknown value representation");
  }
};

type StateRecords = Omit<AuthoritativeState, "identities">;
interface CheckpointDelta extends Omit<HouseholdReplayCheckpoint, "state"> {
  readonly records: Readonly<Record<string, { readonly present?: boolean; readonly set: Readonly<Record<string, unknown>>; readonly remove: readonly string[] }>>;
  readonly identities: Readonly<Record<string, { readonly add: readonly string[]; readonly remove: readonly string[] }>>;
}
const recordKeys = ["accounts", "positions", "liabilities", "obligations", "contributions", "contingentPositions"] as const;
/** Sparse state changes, never transaction history or repeated identity prefixes. */
const checkpointDeltas = (checkpoints: readonly HouseholdReplayCheckpoint[]): readonly CheckpointDelta[] => {
  let before = createAuthoritativeState();
  return checkpoints.map(({ state, ...checkpoint }) => {
    const records = Object.fromEntries(recordKeys.map(key => {
      const prior: Record<string, unknown> = before[key] ?? {}, next: Record<string, unknown> = state[key] ?? {};
      return [key, { present: state[key] !== undefined, set: Object.fromEntries(Object.entries(next).filter(([id, value]) =>
        JSON.stringify(encode(value)) !== JSON.stringify(encode(prior[id] ?? null)))),
      remove: Object.keys(prior).filter(id => !(id in next)) }];
    }));
    const identityEntries = Object.entries(state.identities) as [keyof AuthoritativeState["identities"], readonly string[]][];
    const identities = Object.fromEntries(identityEntries.map(([key, next]) => {
      const prior = before.identities[key as keyof typeof before.identities];
      const oldIds = new Set<string>(prior), newIds = new Set<string>(next);
      return [key, { add: next.filter(id => !oldIds.has(id)), remove: prior.filter(id => !newIds.has(id)) }];
    }));
    before = state;
    return { ...checkpoint, records, identities };
  });
};
const restoreCheckpointDeltas = (deltas: readonly CheckpointDelta[]): readonly HouseholdReplayCheckpoint[] => {
  if (!Array.isArray(deltas)) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: checkpoint data missing");
  let before = createAuthoritativeState();
  return deltas.map(({ records, identities, ...checkpoint }) => {
    if (!records || !identities) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: malformed checkpoint");
    const stateRecords = Object.fromEntries(recordKeys.flatMap(key => {
      const change = records[key];
      if (!change || !Array.isArray(change.remove) || change.remove.some(id => typeof id !== "string") ||
        new Set(change.remove).size !== change.remove.length || !change.set || typeof change.set !== "object" || Array.isArray(change.set) ||
        change.present !== undefined && typeof change.present !== "boolean") throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: malformed state delta");
      const next = { ...before[key], ...change.set };
      for (const id of change.remove) {
        if (!(id in (before[key] ?? {})) || id in change.set) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: invalid state removal");
        delete next[id];
      }
      // Absent optional state is distinct from an explicitly empty record in
      // canonical replay. Older v3 deltas lacked this bit and retain their
      // previous representation; v1/v2 continue to use opening replay.
      if (change.present === false) {
        if (key !== "contributions" && key !== "contingentPositions" || Object.keys(next).length !== 0)
          throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: invalid absent state record");
        return [];
      }
      return [[key, next]];
    })) as StateRecords;
    const nextIds = Object.fromEntries(Object.entries(before.identities).map(([key, prior]) => {
      const change = identities[key];
      if (!change || !Array.isArray(change.add) || !Array.isArray(change.remove) ||
        [...change.add, ...change.remove].some(id => typeof id !== "string")) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: malformed identities");
      const next = new Set<string>(prior);
      for (const id of change.remove) if (!next.delete(id)) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: missing identity");
      for (const id of change.add) {
        if (next.has(id)) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: duplicate identity");
        next.add(id);
      }
      return [key, [...next].sort()];
    })) as unknown as AuthoritativeState["identities"];
    before = createAuthoritativeState({ ...stateRecords, identities: nextIds });
    return { ...checkpoint, state: before };
  });
};

export interface PortableHouseholdReplayArtifact { readonly version: "household-replay/v1" | "household-replay/v2" | "household-replay/v3"; readonly encoded: string; readonly integrity?: string; }
/** One shared opening/configuration artifact per forecast; never a detailed history warehouse. */
export const createPortableHouseholdReplayArtifact = (forecast: HouseholdForecastSummaryResult): PortableHouseholdReplayArtifact => {
  const { executionKernel: _kernel, participants, ...base } = forecast.replay.kernel.executable;
  const executable = { ...base, ...(participants === undefined ? {} : { participants: participants.map(portableHouseholdParticipant) }) };
  const graph: EncodingGraph = { identities: new Map<object, Wire>(), content: new Map<string, Wire>(), active: new Set<object>() };
  const encoded = JSON.stringify(encode({ executable, runContext: forecast.replay.runContext,
    runMetadata: forecast.runMetadata, periods: forecast.periods,
    checkpoints: checkpointDeltas(exportHouseholdReplayCheckpoints(forecast)) }, graph));
  // Change detection, like the run fingerprint; this is not authentication.
  const integrity = createInputFingerprint({ runContext: forecast.replay.runContext, openingState: encoded });
  return Object.freeze({ version: "household-replay/v3", encoded, integrity });
};
const restorePortableArtifact = (artifact: unknown): Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods"> => {
  const supplied = artifact as PortableHouseholdReplayArtifact | undefined;
  if ((supplied?.version !== "household-replay/v1" && supplied?.version !== "household-replay/v2" && supplied?.version !== "household-replay/v3") || typeof supplied.encoded !== "string")
    throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNAVAILABLE: original execution artifacts are required");
  const restored = decode(JSON.parse(supplied.encoded) as Wire) as {
    executable: Omit<ExecutableHouseholdProjection, "participants"> & { readonly participants?: readonly PortableHouseholdParticipant[] }; runContext: RunContext; runMetadata: RunMetadata; periods: readonly HouseholdForecastSummaryPeriod[]; checkpoints?: readonly CheckpointDelta[];
  };
  if (supplied.version === "household-replay/v3" && supplied.integrity !== createInputFingerprint({ runContext: restored.runContext, openingState: supplied.encoded }))
    throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: portable artifact changed");
  const { participants, ...base } = restored.executable;
  const executable = { ...base, ...(participants === undefined ? {} : { participants: participants.map(restoreHouseholdParticipant) }) };
  const kernel = compileHouseholdKernel(executable, restored.runContext.simulationStart);
  const forecast = Object.freeze({ runMetadata: restored.runMetadata, periods: restored.periods,
    replay: Object.freeze({ kernel, runContext: restored.runContext }) });
  if (supplied.version === "household-replay/v3") registerHouseholdReplayCheckpoints(forecast, restoreCheckpointDeltas(restored.checkpoints!));
  return forecast;
};

export const restorePortableHouseholdReplayArtifact = (artifact: unknown): Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods"> => {
  try { return restorePortableArtifact(artifact); }
  catch (error) {
    if ((artifact as PortableHouseholdReplayArtifact | null)?.version === "household-replay/v3")
      throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: portable checkpoint evidence is invalid or unavailable", { cause: error });
    throw error;
  }
};
