import { Currency, DecimalAmount, Money, Percentage, Quantity, Rate, Ratio, RoundingPolicy, Unit, type RateConvention, type RoundingMode } from "../../values/index.js";
import { exportHouseholdReplayCheckpointRoots, registerHouseholdReplayCheckpoints, householdReplayCheckpointSelection, type HouseholdReplayCheckpoint, type HouseholdForecastSummaryResult, type ExecutableHouseholdProjection } from "../householdExecution.js";
import { assertD2PostedTransactionHistoryPreserved, assertD2SettlementReceiptHistoryPreserved, createAuthoritativeState,
  authoritativeCheckpointDelta, restoreAuthoritativeCheckpointDelta, requalifyD2SettlementReceiptHistory,
  assertSsaMedicarePaymentHistoryPreserved,
  assertRetirementDistributionHistoryPreserved, requalifyRetirementDistributionHistory,
  type AuthoritativeCheckpointDelta, type AuthoritativeState } from "../../state/index.js";
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
import { validateSsaMedicareSourceHistory } from "../d2/integration/ssaMedicare/index.js";

type Wire = null | boolean | number | string | { readonly kind: string; readonly value: unknown };
interface EncodingGraph { readonly identities: Map<object, Wire>; readonly content: Map<string, Wire>; readonly active: Set<object>; encodedValues: number }
const encode = (value: unknown, graph?: EncodingGraph): Wire => {
  if (graph !== undefined) graph.encodedValues++;
  if (graph === undefined || value === null || typeof value !== "object") return encodeValue(value, graph);
  const existing = graph.identities.get(value);
  if (existing !== undefined) return existing;
  if (graph.active.has(value)) throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: cyclic execution input");
  graph.active.add(value);
  const payload = encodeValue(value, graph);
  graph.active.delete(value);
  // Every nested definition already has an exact graph ID. A content key
  // must compare those child IDs, not serialize their entire definitions again:
  // a growing history otherwise copies every prior month into every ancestor
  // key, retaining quadratic/cubic intermediate strings in graph.content.
  // Graph IDs are unique within this artifact, so reference-key equality is
  // still exact (and content deduplication remains deterministic).
  const key = JSON.stringify(payload, (_field, nested: unknown) => {
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested) &&
        "kind" in nested && nested.kind === "definition" &&
        "value" in nested && Array.isArray(nested.value) &&
        typeof nested.value[0] === "number") {
      return { kind: "reference", value: nested.value[0] };
    }
    return nested;
  }), shared = graph.content.get(key);
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
    case "record": {
      const entries = value as [string, Wire][];
      if (new Set(entries.map(([key]) => key)).size !== entries.length)
        throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: duplicate record key");
      return Object.freeze(Object.fromEntries(entries.map(([key, item]) => [key, decode(item, references)])));
    }
    default: throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: unknown value representation");
  }
};

interface CheckpointDelta extends Omit<HouseholdReplayCheckpoint, "state">, AuthoritativeCheckpointDelta {}
/** Sparse state changes, never transaction history or repeated identity prefixes. */
const checkpointDeltas = (checkpoints: readonly HouseholdReplayCheckpoint[], observe?: (visited: number, changed: number) => void,
  observeEquality?: () => void): readonly CheckpointDelta[] => {
  let before = createAuthoritativeState();
  return checkpoints.map(({ state, ...checkpoint }) => {
    const delta = authoritativeCheckpointDelta(state, before, (a, b) => {
      observeEquality?.(); return JSON.stringify(encode(a)) === JSON.stringify(encode(b));
    }, observe);
    before = state;
    return { ...checkpoint, ...delta };
  });
};
const restoreCheckpointDeltas = (deltas: readonly CheckpointDelta[], opening: AuthoritativeState,
  observe?: (visited: number, changed: number) => void): readonly HouseholdReplayCheckpoint[] => {
  if (!Array.isArray(deltas)) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: checkpoint data missing");
  let before = createAuthoritativeState();
  let receiptHistory = opening;
  const checkpoints = deltas.map(({ records, identities, ...checkpoint }) => {
    if (!records || !identities) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: malformed checkpoint");
    before = restoreAuthoritativeCheckpointDelta(before, { records, identities }, observe);
    assertD2PostedTransactionHistoryPreserved(receiptHistory, before);
    assertD2SettlementReceiptHistoryPreserved(receiptHistory, before);
    assertRetirementDistributionHistoryPreserved(receiptHistory, before);
    assertSsaMedicarePaymentHistoryPreserved(receiptHistory, before);
    receiptHistory = before;
    return { ...checkpoint, state: before };
  });
  return checkpoints;
};

export interface PortableHouseholdReplayArtifact { readonly version: "household-replay/v1" | "household-replay/v2" | "household-replay/v3"; readonly encoded: string; readonly integrity?: string; }
export interface ReplayRestoreMeasurement {
  readonly checkpointIndexNodesVisited?: number;
  readonly checkpointRecordChanges?: number;
  readonly checkpointFullStateMaterializations?: number;
  readonly cache: "cold" | "warm";
  readonly totalMs?: number;
  readonly decodeMs?: number;
  readonly integrityValidationMs?: number;
  readonly participantRestoreMs?: number;
  readonly sourceRequalificationMs?: number;
  readonly kernelCompileMs?: number;
  readonly checkpointRestoreValidationMs?: number;
  readonly checkpointDiagnosticKeysComputed?: number;
  readonly checkpointDiagnosticOccurrencesCompared?: number;
  readonly checkpointUniqueCatalogChars?: number;
  readonly checkpointSizeMeasurementMs?: number;
  readonly checkpointCount: number;
  readonly materializedCheckpointStates: number;
  /** Actual encoded checkpoint field, including references to earlier definitions. */
  readonly serializedCheckpointBytes?: number;
  readonly heapBeforeBytes?: number;
  readonly heapAfterBytes?: number;
  /** Maximum of phase-boundary samples, not a guaranteed physical peak. */
  readonly peakSampledHeapBytes?: number;
}
export interface ReplayRestoreObserver {
  readonly now: () => number;
  readonly record: (measurement: ReplayRestoreMeasurement) => void;
  /** Extra serialization is for independent/manual engineering validation only. */
  readonly includeCheckpointBytes?: boolean;
  /** Bounded progress survives a later failure; never receives source contents. */
  readonly phase?: (phase: "restore_started" | "decoded" | "integrity_validated" | "participants_restored" | "source_requalified" | "kernel_compiled" | "checkpoints_validated" | "restore_warm") => void;
}
type RestoreTimings = { -readonly [K in keyof Pick<ReplayRestoreMeasurement, "decodeMs" | "integrityValidationMs" | "participantRestoreMs" | "sourceRequalificationMs" | "kernelCompileMs" | "checkpointRestoreValidationMs" | "checkpointSizeMeasurementMs" | "serializedCheckpointBytes" | "checkpointDiagnosticKeysComputed" | "checkpointDiagnosticOccurrencesCompared" | "checkpointUniqueCatalogChars" | "checkpointIndexNodesVisited" | "checkpointRecordChanges" | "checkpointFullStateMaterializations">]: ReplayRestoreMeasurement[K] };
export interface ReplayExportMeasurement {
  readonly checkpointCount: number;
  readonly checkpointIndexNodesVisited: number;
  readonly checkpointRecordChanges: number;
  readonly checkpointEqualityComparisons: number;
  readonly encodedValues: number;
  readonly encodedBytes: number;
  readonly materializedCheckpointStates: number;
}
const heapSample = (): number | undefined => {
  try {
    const value = (globalThis.performance as Performance & { memory?: { usedJSHeapSize?: number } } | undefined)?.memory?.usedJSHeapSize;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  } catch { return undefined; }
};
const safeNow = (observer?: ReplayRestoreObserver): number | undefined => {
  try { const value = observer?.now(); return value !== undefined && Number.isFinite(value) ? value : undefined; } catch { return undefined; }
};
const elapsed = (before: number | undefined, after: number | undefined): number | undefined =>
  before !== undefined && after !== undefined && after >= before ? after - before : undefined;
/** One shared opening/configuration artifact per forecast; never a detailed history warehouse. */
export const createPortableHouseholdReplayArtifact = (forecast: HouseholdForecastSummaryResult, retainPrivateBasis = false,
  observe?: (measurement: ReplayExportMeasurement) => void): PortableHouseholdReplayArtifact => {
  const { executionKernel: _kernel, participants, ...base } = forecast.replay.kernel.executable;
  const executable = { ...base, ...(participants === undefined ? {} : { participants: participants.map(portableHouseholdParticipant) }) };
  const graph: EncodingGraph = { identities: new Map<object, Wire>(), content: new Map<string, Wire>(), active: new Set<object>(), encodedValues: 0 };
  let visited = 0, changed = 0, comparisons = 0, materialized = 0;
  const work = (nodes: number, rows: number) => { visited += nodes; changed += rows; };
  const checkpoints = checkpointDeltas(exportHouseholdReplayCheckpointRoots(forecast, work, () => { materialized++; }), work, () => { comparisons++; });
  const encoded = JSON.stringify(encode({ executable, runContext: forecast.replay.runContext,
    runMetadata: forecast.runMetadata, periods: forecast.periods,
    checkpoints }, graph));
  // Change detection, like the run fingerprint; this is not authentication.
  const integrity = createInputFingerprint({ runContext: forecast.replay.runContext, openingState: encoded });
  const artifact = Object.freeze({ version: "household-replay/v3" as const, encoded, integrity });
  // The creating worker already owns the exact committed kernel/checkpoints.
  // Retaining that immutable basis avoids decoding/requalifying all 649 months
  // merely to inspect twelve. Transported artifacts still take the full verifier.
  // Only the application reader may retain its private, unexposed execution.
  // Ordinary exported artifacts continue to restore the serialized snapshot.
  if (retainPrivateBasis) restoredArtifacts.set(artifact, { version: artifact.version, encoded, integrity, forecast });
  try { observe?.({ checkpointCount: checkpoints.length, checkpointIndexNodesVisited: visited, checkpointRecordChanges: changed,
    checkpointEqualityComparisons: comparisons, encodedValues: graph.encodedValues, encodedBytes: new TextEncoder().encode(encoded).byteLength,
    materializedCheckpointStates: materialized }); } catch { /* Measurement only. */ }
  return artifact;
};
const restorePortableArtifact = (artifact: unknown, observer?: ReplayRestoreObserver, timings: RestoreTimings = {}, sample: () => void = () => {}): Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods"> => {
  const supplied = artifact as PortableHouseholdReplayArtifact | undefined;
  if ((supplied?.version !== "household-replay/v1" && supplied?.version !== "household-replay/v2" && supplied?.version !== "household-replay/v3") || typeof supplied.encoded !== "string")
    throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNAVAILABLE: original execution artifacts are required");
  const measure = <T>(phase: Exclude<keyof RestoreTimings, "serializedCheckpointBytes">, operation: () => T): T => {
    const before = safeNow(observer);
    try { return operation(); } finally {
      const duration = elapsed(before, safeNow(observer));
      if (duration !== undefined) timings[phase] = (timings[phase] ?? 0) + duration;
      if (observer) sample();
    }
  };
  const wire = measure("decodeMs", () => JSON.parse(supplied.encoded) as Wire);
  const decodeStarted = safeNow(observer);
  const restored = decode(wire) as {
    executable: Omit<ExecutableHouseholdProjection, "participants"> & { readonly participants?: readonly PortableHouseholdParticipant[] }; runContext: RunContext; runMetadata: RunMetadata; periods: readonly HouseholdForecastSummaryPeriod[]; checkpoints?: readonly CheckpointDelta[];
  };
  try { observer?.phase?.("decoded"); } catch { /* Observation is optional. */ }
  const decodeDuration = elapsed(decodeStarted, safeNow(observer));
  if (decodeDuration !== undefined) timings.decodeMs = (timings.decodeMs ?? 0) + decodeDuration;
  if (observer) sample();
  measure("integrityValidationMs", () => {
    if (supplied.version === "household-replay/v3" && supplied.integrity !== createInputFingerprint({ runContext: restored.runContext, openingState: supplied.encoded }))
      throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: portable artifact changed");
  });
  try { observer?.phase?.("integrity_validated"); } catch { /* Observation is optional. */ }
  const { participants, ...base } = restored.executable;
  const executable = measure("participantRestoreMs", () => ({ ...base, ...(participants === undefined ? {} : { participants: participants.map(restoreHouseholdParticipant) }) }));
  try { observer?.phase?.("participants_restored"); } catch { /* Observation is optional. */ }
  const qualify = (state: AuthoritativeState) => {
    measure("sourceRequalificationMs", () => {
      validateSsaMedicareSourceHistory(state, restored.runContext.dataCutoff);
      requalifyD2SettlementReceiptHistory(state, restored.runContext);
      requalifyRetirementDistributionHistory(state, restored.runContext);
    });
    try { observer?.phase?.("source_requalified"); } catch { /* Observation is optional. */ }
  };
  if (supplied.version !== "household-replay/v3") qualify(executable.reconciledOpeningState);
  const kernel = measure("kernelCompileMs", () => compileHouseholdKernel(executable, restored.runContext.simulationStart));
  try { observer?.phase?.("kernel_compiled"); } catch { /* Observation is optional. */ }
  const forecast = Object.freeze({ runMetadata: restored.runMetadata, periods: restored.periods,
    replay: Object.freeze({ kernel, runContext: restored.runContext }) });
  if (supplied.version === "household-replay/v3") {
    const checkpoints = measure("checkpointRestoreValidationMs", () => restoreCheckpointDeltas(restored.checkpoints!, executable.reconciledOpeningState, (nodes, rows) => {
      timings.checkpointIndexNodesVisited = (timings.checkpointIndexNodesVisited ?? 0) + nodes;
      timings.checkpointRecordChanges = (timings.checkpointRecordChanges ?? 0) + rows;
    }));
    // Append-only admission proves that this union contains every inherited
    // and new proof. Independently requalify it once before registration.
    qualify(checkpoints.at(-1)?.state ?? executable.reconciledOpeningState);
    measure("checkpointRestoreValidationMs", () => registerHouseholdReplayCheckpoints(forecast, checkpoints, counts => {
      timings.checkpointDiagnosticKeysComputed = counts.diagnosticKeysComputed;
      timings.checkpointDiagnosticOccurrencesCompared = counts.diagnosticOccurrencesCompared;
      timings.checkpointUniqueCatalogChars = counts.uniqueCatalogChars;
    }, full => { timings.checkpointFullStateMaterializations = (timings.checkpointFullStateMaterializations ?? 0) + (full ? 1 : 0); }));
  }
  try { observer?.phase?.("checkpoints_validated"); } catch { /* Observation is optional. */ }
  if (observer?.includeCheckpointBytes) {
    // Locate the original field in the parsed wire, without re-encoding decoded
    // catalogs or expanded states. Failure of measurement cannot affect restore.
    measure("checkpointSizeMeasurementMs", () => { try {
      const root = typeof wire === "object" && wire !== null && wire.kind === "definition" ? (wire.value as [number, Wire])[1] : wire;
      if (typeof root === "object" && root !== null && root.kind === "record") {
        const checkpoints = (root.value as [string, Wire][]).find(([key]) => key === "checkpoints")?.[1];
        if (checkpoints !== undefined) timings.serializedCheckpointBytes = new TextEncoder().encode(JSON.stringify(checkpoints)).byteLength;
      }
    } catch { /* Measurement is optional. */ } });
  }
  return forecast;
};

// A transported result shares one attachment across all months. Revalidating
// every sparse checkpoint on every month/route blocks the browser main thread.
// Weak ownership releases it with the result; exact wire contents guard mutable
// structured-clone inputs and ensure corruption is never hidden by a cache hit.
const restoredArtifacts = new WeakMap<object, {
  readonly version: PortableHouseholdReplayArtifact["version"];
  readonly encoded: string;
  readonly integrity: string | undefined;
  readonly forecast: Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods">;
}>();
export const restorePortableHouseholdReplayArtifact = (artifact: unknown, observer?: ReplayRestoreObserver): Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods"> => {
  try { observer?.phase?.("restore_started"); } catch { /* Observation is optional. */ }
  const before = safeNow(observer), heapBefore = observer ? heapSample() : undefined;
  let peak = heapBefore;
  const sample = () => { const heap = heapSample(); if (heap !== undefined) peak = Math.max(peak ?? 0, heap); };
  const report = (cache: "cold" | "warm", forecast: Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods">, timings: RestoreTimings = {}) => {
    if (!observer) return;
    try {
      sample();
      const duration = elapsed(before, safeNow(observer)), heapAfter = heapSample();
      const { checkpointCount } = householdReplayCheckpointSelection(forecast);
      observer.record(Object.freeze({ cache, ...timings, checkpointCount, materializedCheckpointStates: cache === "cold" ? checkpointCount : 0,
        ...(duration === undefined ? {} : { totalMs: duration }), ...(heapBefore === undefined ? {} : { heapBeforeBytes: heapBefore }),
        ...(heapAfter === undefined ? {} : { heapAfterBytes: heapAfter }), ...(peak === undefined ? {} : { peakSampledHeapBytes: peak }) }));
    } catch { /* Measurement cannot change financial execution. */ }
  };
  try {
    const supplied = artifact as PortableHouseholdReplayArtifact | undefined;
    const cached = typeof artifact === "object" && artifact !== null ? restoredArtifacts.get(artifact) : undefined;
    if (cached && supplied?.version === cached.version && supplied.encoded === cached.encoded && supplied.integrity === cached.integrity) {
      try { observer?.phase?.("restore_warm"); } catch { /* Observation is optional. */ }
      report("warm", cached.forecast); return cached.forecast;
    }
    const timings: RestoreTimings = {};
    const forecast = restorePortableArtifact(artifact, observer, timings, sample);
    if (typeof artifact === "object" && artifact !== null && supplied) restoredArtifacts.set(artifact, {
      version: supplied.version, encoded: supplied.encoded, integrity: supplied.integrity, forecast,
    });
    report("cold", forecast, timings);
    return forecast;
  }
  catch (error) {
    if ((artifact as PortableHouseholdReplayArtifact | null)?.version === "household-replay/v3")
      throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: portable checkpoint evidence is invalid or unavailable", { cause: error });
    throw error;
  }
};
