import { Currency, DecimalAmount, Money, Percentage, Quantity, Rate, Ratio, RoundingPolicy, Unit, type RateConvention, type RoundingMode } from "../../values/index.js";
import { observeHouseholdForecastSources, assertHouseholdReplayRegenerates, exportHouseholdReplayCheckpointRoots, registerHouseholdReplayCheckpoints, registerRestoredReplayAdmission, householdReplayCheckpointSelection, householdReplayTerminalRoot, type HouseholdReplayCheckpoint, type HouseholdForecastSummaryResult, type ExecutableHouseholdProjection } from "../householdExecution.js";
import { assertD2PostedTransactionHistoryPreserved, assertD2SettlementReceiptHistoryPreserved, createAuthoritativeState, observeAuthoritativeSourceHistory,
  authoritativeCheckpointDelta, restoreAuthoritativeCheckpointDelta,
  assertSsaMedicarePaymentHistoryPreserved,
  assertRetirementDistributionHistoryPreserved,
  type AuthoritativeCheckpointDelta, type AuthoritativeState } from "../../state/index.js";
import { canonicalSerialize, createInputFingerprint } from "../run.js";
import { TaxEconomicLedger } from "../tax/economics.js";
import { TaxDiagnosticLedger } from "../tax/diagnostics.js";
import type { RecognizedTaxEconomics, TaxCapabilityDiagnostic } from "../tax/contracts.js";
import type { RunContext, RunMetadata } from "../run.js";
import type { HouseholdForecastSummaryPeriod } from "./forecastSummary.js";
import { compileHouseholdKernel } from "./compiledHousehold.js";
import { householdExecutionMetrics } from "./metrics.js";
import type { Instant } from "../../time/index.js";
import { portableHouseholdParticipant, restoreHouseholdParticipant, type PortableHouseholdParticipant } from "./participantCodec.js";
// Composition boundary: domain codecs register factories; replay dispatch stays generic.
import "../tax/replayCodec.js";
import "../workplaceEvents.js";
import "../domainMechanics.js";
import "../mortgageLifecycle.js";
import { validateSsaMedicareReplayHistory } from "../d2/integration/ssaMedicare/index.js";
import { captureFixedLoanReplayObservations } from "../d2/integration/fixedLoanOriginalBridge/observation.js";
import { ownsFsaCashParticipant } from "../d2/integration/fsaCash/index.js";
import { ownsCardBankParticipant } from "../d2/integration/cardBank/index.js";
import { ownsHelocServicingParticipant } from "../d2/integration/helocServicing/index.js";

/** One bounded application proposal per run. Its encoded digest is not trust. */
export interface ModeledPayrollReplayBasis {
  readonly version: "modeled-payroll-replay/v1";
  readonly issuer: string;
  readonly payload: unknown;
}
type ModelRequalifier = (basis: ModeledPayrollReplayBasis, executable: ExecutableHouseholdProjection,
  context: RunContext, independentSource: unknown) => ExecutableHouseholdProjection;
const modelRequalifiers = new Map<string, ModelRequalifier>();
export function registerModeledPayrollReplayAuthority(issuer: "application-household/v1", requalify: ModelRequalifier): void {
  if (issuer !== "application-household/v1" || modelRequalifiers.has(issuer)) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: duplicate or unsupported model issuer");
  modelRequalifiers.set(issuer, requalify);
}
function qualifyModelBasis(basis: ModeledPayrollReplayBasis | undefined, executable: ExecutableHouseholdProjection,
  context: RunContext, independentSource: unknown): ExecutableHouseholdProjection {
  const modeled = executable.cashFlowInput?.incomes.some(stream => stream.modeledPayroll !== undefined);
  if (!basis && !modeled) return executable;
  const authority = basis?.version === "modeled-payroll-replay/v1" ? modelRequalifiers.get(basis.issuer) : undefined;
  if (!basis || !modeled || !authority || independentSource === undefined)
    throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: independent authored model is required");
  if (canonicalSerialize(basis).length > 262144)
    throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: model proposal exceeds bounded replay extension");
  return authority(basis, executable, context, independentSource);
}

type Wire = null | boolean | number | string | { readonly kind: string; readonly value: unknown };
// These are graph tags, never keys from an authoritative record. The record
// encoder puts user keys in entry pairs. Keep the verbose tags readable on
// import for existing artifacts and compact the numerous graph edges on export.
const compactGraphTag = (_key: string, value: unknown): unknown => {
  if (value === null || typeof value !== "object" || !("kind" in value) || !("value" in value)) return value;
  if (value.kind === "reference") return { r: value.value };
  if (value.kind === "definition") return { d: value.value };
  return { t: [value.kind, value.value] };
};
const expandGraphTag = (value: Wire): Wire => {
  if (value === null || typeof value !== "object" || Object.keys(value).length !== 1) return value;
  if ("r" in value) return { kind: "reference", value: value.r };
  if ("d" in value) return { kind: "definition", value: value.d };
  if ("t" in value && Array.isArray(value.t) && value.t.length === 2) return { kind: value.t[0], value: value.t[1] };
  return value;
};
const usesFixedLoanOriginals = (executable: ExecutableHouseholdProjection): boolean =>
  executable.liabilityInput?.loans.some(loan => loan.originalSource !== undefined) === true;

interface EncodingGraph { readonly identities: Map<object, Wire>; readonly content: Map<string, Wire>; readonly active: Set<object>; encodedValues: number }
const graphEdge = (wire: Wire): Wire =>
  typeof wire === "object" && wire !== null && wire.kind === "definition"
    ? { kind: "reference", value: (wire.value as [number, Wire])[0] } : wire;

const graphContentKey = (wire: Wire): string => {
  if (typeof wire !== "object" || wire === null) return JSON.stringify(wire);
  const { kind, value } = wire;
  // Only container codecs carry nested graph edges. Normalize their immediate
  // children without a recursive JSON replacer or expanding a shared history.
  switch (kind) {
    case "record": return JSON.stringify({ kind, value: (value as [string, Wire][]).map(([key, child]) => [key, graphEdge(child)]) });
    case "array": return JSON.stringify({ kind, value: (value as Wire[]).map(graphEdge) });
    case "rate": {
      const [amount, convention] = value as [string, Wire];
      return JSON.stringify({ kind, value: [amount, graphEdge(convention)] });
    }
    case "tax_economics":
    case "tax_diagnostics": return JSON.stringify({ kind, value: graphEdge(value as Wire) });
    default: return JSON.stringify(wire);
  }
};
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
  const key = graphContentKey(payload), shared = graph.content.get(key);
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
const decode = (wire: Wire, compactGraph: boolean, references = new Map<number, unknown>()): unknown => {
  if (wire === null || typeof wire !== "object") return wire;
  if (compactGraph) wire = expandGraphTag(wire) as Exclude<Wire, null | boolean | number | string>;
  const child = (item: Wire) => decode(item, compactGraph, references);
  const value = wire.value;
  const pair = value as [string, string];
  switch (wire.kind) {
    case "definition": {
      const [id, payload] = value as [number, Wire];
      if (!Number.isSafeInteger(id) || id < 0 || references.has(id)) throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: invalid shared definition");
      const restored = child(payload); references.set(id, restored); return restored;
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
    case "rate": { const rate = value as [string, Wire]; return Rate.fromDecimal(rate[0], child(rate[1]) as RateConvention); }
    case "ratio": return Ratio.parse(value as string);
    case "percentage": return Percentage.parse(value as string);
    case "rounding": { const policy = value as [number, RoundingMode]; return new RoundingPolicy(policy[0], policy[1]); }
    case "tax_economics": return TaxEconomicLedger.empty().with(child(value as Wire) as readonly RecognizedTaxEconomics[]);
    case "tax_diagnostics": return TaxDiagnosticLedger.empty().with(child(value as Wire) as readonly TaxCapabilityDiagnostic[]);
    case "array": return Object.freeze((value as Wire[]).map(child));
    case "record": {
      const entries = value as [string, Wire][];
      if (new Set(entries.map(([key]) => key)).size !== entries.length)
        throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: duplicate record key");
      return Object.freeze(Object.fromEntries(entries.map(([key, item]) => [key, child(item)])));
    }
    default: throw new Error("HOUSEHOLD_REPLAY_ARTIFACT_UNSUPPORTED: unknown value representation");
  }
};

interface CheckpointDelta extends Omit<HouseholdReplayCheckpoint, "state">, AuthoritativeCheckpointDelta {}
const encodeStateDelta = (state: AuthoritativeState, before: AuthoritativeState,
  observe?: (visited: number, changed: number) => void, observeEquality?: () => void): AuthoritativeCheckpointDelta =>
  authoritativeCheckpointDelta(state, before, (a, b) => {
    observeEquality?.();
    return JSON.stringify(encode(a)) === JSON.stringify(encode(b));
  }, observe);

const assertSourceHistoryPreserved = (before: AuthoritativeState, after: AuthoritativeState): void => {
  assertD2PostedTransactionHistoryPreserved(before, after);
  assertD2SettlementReceiptHistoryPreserved(before, after);
  assertRetirementDistributionHistoryPreserved(before, after);
  assertSsaMedicarePaymentHistoryPreserved(before, after);
};

const assertSourceFrontier = (records: AuthoritativeCheckpointDelta["records"], context: RunContext, end: Instant,
  opening?: AuthoritativeState): void => {
  const mismatch = (): never => { throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: invalid committed source frontier"); };
  const rows = <K extends "d2PostedTransactions" | "d2SettlementReceipts" | "ssaMedicarePayments" | "retirementDistributionAllocations">(key: K) =>
    Object.entries(records[key]?.set ?? {}).filter(([id]) => !Object.hasOwn(opening?.[key] ?? {}, id))
      .map(([, row]) => row) as NonNullable<AuthoritativeState[K]>[keyof NonNullable<AuthoritativeState[K]>][];
  for (const proof of rows("d2PostedTransactions")) {
    if (proof.transaction.date >= end) mismatch();
    if (proof.registration.kind === "fixed_loan_original") {
      const event = proof.registration.evidence.context;
      if (event.runId !== context.runId || event.scenarioId !== context.scenarioId || event.asOf !== context.asOf ||
          event.dataCutoff !== context.dataCutoff || event.eventAt < context.simulationStart) mismatch();
    }
    if (proof.registration.kind === "household_domain") {
      const event = proof.registration.evidence.context;
      if (event.runId !== context.runId || event.asOf !== context.asOf || event.dataCutoff !== context.dataCutoff ||
          event.eventAt < context.simulationStart) mismatch();
    }
  }
  for (const receipt of rows("d2SettlementReceipts"))
    if (receipt.originalTransaction.date >= end || receipt.paymentTransaction.date >= end) mismatch();
  for (const payment of rows("ssaMedicarePayments"))
    if (payment.transaction.date >= end) mismatch();
  for (const distribution of rows("retirementDistributionAllocations"))
    if (distribution.effectiveAt >= end) mismatch();
};

/** Sparse state changes, never transaction history or repeated identity prefixes. */
const checkpointDeltas = (checkpoints: readonly HouseholdReplayCheckpoint[], observe?: (visited: number, changed: number) => void,
  observeEquality?: () => void): readonly CheckpointDelta[] => {
  let before = createAuthoritativeState();
  return checkpoints.map(({ state, ...checkpoint }) => {
    const delta = encodeStateDelta(state, before, observe, observeEquality);
    before = state;
    return { ...checkpoint, ...delta };
  });
};
const restoreCheckpointDeltas = (deltas: readonly CheckpointDelta[], opening: AuthoritativeState,
  context: RunContext, observe?: (visited: number, changed: number) => void): readonly HouseholdReplayCheckpoint[] => {
  if (!Array.isArray(deltas)) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: checkpoint data missing");
  let before = createAuthoritativeState();
  let receiptHistory = opening;
  const checkpoints = deltas.map(({ records, identities, ...checkpoint }) => {
    if (!records || !identities) throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: malformed checkpoint");
    before = restoreAuthoritativeCheckpointDelta(before, { records, identities }, observe);
    assertSourceHistoryPreserved(receiptHistory, before);
    // The first delta is relative to an empty state and includes opening
    // history. Check the frontier of newly committed records only.
    assertSourceFrontier(records, context, checkpoint.at, opening);
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
  observe?: (measurement: ReplayExportMeasurement) => void, modeledPayroll?: ModeledPayrollReplayBasis,
  independentSource?: unknown): PortableHouseholdReplayArtifact => {
  qualifyModelBasis(modeledPayroll, forecast.replay.kernel.executable, forecast.replay.runContext, independentSource);
  const { executionKernel: _kernel, participants, ...base } = forecast.replay.kernel.executable;
  const executable = { ...base, ...(participants === undefined ? {} : { participants: participants.map(portableHouseholdParticipant) }) };
  const graph: EncodingGraph = { identities: new Map<object, Wire>(), content: new Map<string, Wire>(), active: new Set<object>(), encodedValues: 0 };
  let visited = 0, changed = 0, comparisons = 0, materialized = 0;
  const work = (nodes: number, rows: number) => { visited += nodes; changed += rows; };
  const roots = exportHouseholdReplayCheckpointRoots(forecast, work, () => { materialized++; });
  const checkpoints = checkpointDeltas(roots, work, () => { comparisons++; });
  const terminal = householdReplayTerminalRoot(forecast);
  const terminalDelta = encodeStateDelta(terminal,
    roots.at(-1)?.state ?? forecast.replay.kernel.executable.reconciledOpeningState, work, () => { comparisons++; });
  const sourcedLoans = usesFixedLoanOriginals(forecast.replay.kernel.executable);
  const wire = encode({ executable, runContext: forecast.replay.runContext,
    runMetadata: forecast.runMetadata, periods: forecast.periods,
    checkpoints, terminalDelta, ...(modeledPayroll === undefined ? {} : { modeledPayroll }) }, graph);
  const encoded = sourcedLoans ? JSON.stringify(wire, compactGraphTag) : JSON.stringify(wire);
  // Change detection, like the run fingerprint; this is not authentication.
  const integrity = createInputFingerprint({ runContext: forecast.replay.runContext, openingState: encoded });
  const artifact = Object.freeze({ version: "household-replay/v3" as const, encoded, integrity });
  // The creating worker already owns the exact committed kernel/checkpoints.
  // Retaining that immutable basis avoids decoding all 649 months merely to
  // inspect twelve. The committed terminal state also covers publications
  // consumed after the last retained replay checkpoint.
  // Only the application reader may retain its private, unexposed execution.
  // Ordinary exported artifacts continue to restore the serialized snapshot.
  if (retainPrivateBasis && !sourcedLoans) restoredArtifacts.set(artifact, {
    version: artifact.version, encoded, integrity, forecast, modeledPayroll,
    sourceHistoryState: terminal, checkpoints: roots,
  });
  try { observe?.({ checkpointCount: checkpoints.length, checkpointIndexNodesVisited: visited, checkpointRecordChanges: changed,
    checkpointEqualityComparisons: comparisons, encodedValues: graph.encodedValues, encodedBytes: new TextEncoder().encode(encoded).byteLength,
    materializedCheckpointStates: materialized }); } catch { /* Measurement only. */ }
  observeHouseholdForecastSources(forecast);
  return artifact;
};
function validateReplaySsaOccurrences(forecast: Pick<HouseholdForecastSummaryResult, "replay" | "periods">,
  state: AuthoritativeState, checkpoints: readonly HouseholdReplayCheckpoint[]): () => void {
  const { kernel, runContext } = forecast.replay;
  return validateSsaMedicareReplayHistory(kernel.executable.participants, kernel.executable.reconciledOpeningState,
    runContext, checkpoints, { state, at: forecast.periods.at(-1)?.period.end ?? runContext.simulationStart }, kernel.executable.cashFlowInput);
}

function admitConfiguredReplayHistory(forecast: Pick<HouseholdForecastSummaryResult, "replay" | "periods" | "runMetadata">,
  state: AuthoritativeState, checkpoints: readonly HouseholdReplayCheckpoint[], verifyFullInventory: boolean): (() => void) | undefined {
  const fixedLoans = usesFixedLoanOriginals(forecast.replay.kernel.executable);
  if (!fixedLoans && !verifyFullInventory) return undefined;
  // Independently regenerate the dated occurrence inventory on cold admission.
  // Warm admissions keep the admitted journal and reobserve its actual sources.
  const regenerate = () => assertHouseholdReplayRegenerates(forecast, state, checkpoints, fixedLoans);
  if (fixedLoans) return captureFixedLoanReplayObservations(regenerate).recheck;
  regenerate();
  return undefined;
}

const restorePortableArtifact = (supplied: PortableHouseholdReplayArtifact | undefined,
  observer?: ReplayRestoreObserver, timings: RestoreTimings = {}, sample: () => void = () => {}, independentSource?: unknown): {
  forecast: Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods">; modeledPayroll?: ModeledPayrollReplayBasis;
  sourceHistoryState: AuthoritativeState;
  checkpoints: readonly HouseholdReplayCheckpoint[];
  recheckSsa: () => void;
  recheckFixedLoans?: (() => void) | undefined;
} => {
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
  const compactGraph = supplied.version === "household-replay/v3" && supplied.encoded.startsWith('{"d":');
  const wire = measure("decodeMs", () => JSON.parse(supplied.encoded) as Wire);
  const decodeStarted = safeNow(observer);
  const restored = decode(wire, compactGraph) as {
    executable: Omit<ExecutableHouseholdProjection, "participants"> & { readonly participants?: readonly PortableHouseholdParticipant[] }; runContext: RunContext; runMetadata: RunMetadata; periods: readonly HouseholdForecastSummaryPeriod[]; checkpoints?: readonly CheckpointDelta[]; modeledPayroll?: ModeledPayrollReplayBasis;
    terminalDelta?: AuthoritativeCheckpointDelta;
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
  if (restored.modeledPayroll !== undefined && supplied.version !== "household-replay/v3")
    throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: modeled payroll requires the v3 extension");
  // Recompile against the separately supplied model before kernel activation or
  // checkpoint registration, even when a matching issuer is already warm.
  // Decoded objects are immutable; attach only independently recompiled model
  // payroll references to a fresh executable before kernel/checkpoint admission.
  const admittedExecutable = qualifyModelBasis(restored.modeledPayroll, executable, restored.runContext, independentSource);
  if (supplied.version !== "household-replay/v3" && usesFixedLoanOriginals(admittedExecutable))
    throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: fixed loan originals require committed checkpoint and terminal history");
  try { observer?.phase?.("participants_restored"); } catch { /* Observation is optional. */ }
  let sourceHistoryState = admittedExecutable.reconciledOpeningState;
  let checkpoints: readonly HouseholdReplayCheckpoint[] = [];
  const kernel = measure("kernelCompileMs", () => compileHouseholdKernel(admittedExecutable, restored.runContext.simulationStart));
  try { observer?.phase?.("kernel_compiled"); } catch { /* Observation is optional. */ }
  const forecast = Object.freeze({ runMetadata: restored.runMetadata, periods: restored.periods,
    replay: Object.freeze({ kernel, runContext: restored.runContext }) });
  if (supplied.version === "household-replay/v3") {
    const observeChanges = (nodes: number, rows: number) => {
      timings.checkpointIndexNodesVisited = (timings.checkpointIndexNodesVisited ?? 0) + nodes;
      timings.checkpointRecordChanges = (timings.checkpointRecordChanges ?? 0) + rows;
    };
    checkpoints = measure("checkpointRestoreValidationMs", () =>
      restoreCheckpointDeltas(restored.checkpoints!, admittedExecutable.reconciledOpeningState, restored.runContext, observeChanges));
    const terminalDelta = restored.terminalDelta;
    if (terminalDelta === undefined)
      throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: terminal source history missing");
    sourceHistoryState = measure("checkpointRestoreValidationMs", () => {
      const boundary = checkpoints.at(-1)?.state ?? sourceHistoryState;
      const terminal = restoreAuthoritativeCheckpointDelta(boundary, terminalDelta, observeChanges);
      assertSourceHistoryPreserved(boundary, terminal);
      const closing = restored.periods.at(-1);
      assertSourceFrontier(terminalDelta.records, restored.runContext, closing?.period.end ?? restored.runContext.simulationStart);
      if (closing !== undefined) {
        const metrics = householdExecutionMetrics(terminal, restored.runContext.baseCurrency, admittedExecutable);
        if (!metrics.cash.equals(closing.cash) || !metrics.investmentValue.equals(closing.investmentValue) ||
            !metrics.totalAssets.equals(closing.assets) || !metrics.totalLiabilities.equals(closing.liabilities) ||
            !metrics.netWorth.equals(closing.netWorth))
          throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: terminal state differs from committed summary");
      }
      return terminal;
    });
  }
  const verifyFullInventory = supplied.version === "household-replay/v3" &&
    (admittedExecutable.participants?.some(participant => ownsFsaCashParticipant(participant) || ownsCardBankParticipant(participant) ||
      ownsHelocServicingParticipant(participant) || participant.portableCodec === "d2-retirement-cash/v3") ?? false);
  const { recheckSsa, recheckFixedLoans } = measure("sourceRequalificationMs", () => {
    const recheckSsa = validateReplaySsaOccurrences(forecast, sourceHistoryState, checkpoints);
    if (observer?.phase !== undefined) observeAuthoritativeSourceHistory(sourceHistoryState, restored.runContext);
    return { recheckSsa, recheckFixedLoans: admitConfiguredReplayHistory(forecast, sourceHistoryState, checkpoints, verifyFullInventory) };
  });
  try { observer?.phase?.("source_requalified"); } catch { /* Observation is optional. */ }
  if (supplied.version === "household-replay/v3") {
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
      const outer = compactGraph ? expandGraphTag(wire) : wire;
      const definition = typeof outer === "object" && outer !== null && outer.kind === "definition" ? (outer.value as [number, Wire])[1] : wire;
      const root = compactGraph ? expandGraphTag(definition) : definition;
      if (typeof root === "object" && root !== null && root.kind === "record") {
        const checkpoints = (root.value as [string, Wire][]).find(([key]) => key === "checkpoints")?.[1];
        if (checkpoints !== undefined)
          timings.serializedCheckpointBytes = new TextEncoder().encode(JSON.stringify(checkpoints)).byteLength;
      }
    } catch { /* Measurement is optional. */ } });
  }
  bindReplayAdmission(forecast, restored.modeledPayroll, sourceHistoryState, independentSource, recheckSsa, recheckFixedLoans);
  return { forecast, sourceHistoryState, checkpoints, recheckSsa, recheckFixedLoans, ...(restored.modeledPayroll === undefined ? {} : { modeledPayroll: restored.modeledPayroll }) };
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
  readonly sourceHistoryState: AuthoritativeState;
  readonly checkpoints: readonly HouseholdReplayCheckpoint[];
  readonly modeledPayroll?: ModeledPayrollReplayBasis | undefined;
  readonly recheckSsa?: () => void;
  readonly recheckFixedLoans?: (() => void) | undefined;
}>();
function bindReplayAdmission(forecast: Pick<HouseholdForecastSummaryResult, "replay" | "periods">, basis: ModeledPayrollReplayBasis | undefined,
  sourceHistoryState: AuthoritativeState, independentSource: unknown, recheckSsa: () => void,
  recheckFixedLoans?: () => void): void {
  const { replay } = forecast;
  const admitModel = () => { qualifyModelBasis(basis, replay.kernel.executable, replay.runContext, independentSource); };
  registerRestoredReplayAdmission(replay, () => {
    recheckSsa();
    recheckFixedLoans?.();
  }, { state: sourceHistoryState, ...(basis === undefined ? {} : { admitModel }) });
}
export const restorePortableHouseholdReplayArtifact = (artifact: unknown, observer?: ReplayRestoreObserver, independentSource?: unknown): Pick<HouseholdForecastSummaryResult, "replay" | "runMetadata" | "periods"> => {
  try { observer?.phase?.("restore_started"); } catch { /* Observation is optional. */ }
  // Cache the same wire values we actually verify, even if an observer
  // changes the caller's transported object during restoration.
  const wire = artifact as PortableHouseholdReplayArtifact | undefined;
  const integrity = wire?.integrity;
  const supplied = wire == null ? undefined : { version: wire.version, encoded: wire.encoded,
    ...(integrity === undefined ? {} : { integrity }) };
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
    const cached = typeof artifact === "object" && artifact !== null ? restoredArtifacts.get(artifact) : undefined;
    if (cached && supplied?.version === cached.version && supplied.encoded === cached.encoded && supplied.integrity === cached.integrity) {
      try { observer?.phase?.("restore_warm"); } catch { /* Observation is optional. */ }
      report("warm", cached.forecast);
      const { kernel, runContext } = cached.forecast.replay;
      qualifyModelBasis(cached.modeledPayroll, kernel.executable, runContext, independentSource);
      const recheckSsa = cached.recheckSsa ?? (() => { validateReplaySsaOccurrences(cached.forecast, cached.sourceHistoryState, cached.checkpoints); });
      recheckSsa();
      cached.recheckFixedLoans?.();
      observeAuthoritativeSourceHistory(cached.sourceHistoryState, runContext);
      bindReplayAdmission(cached.forecast, cached.modeledPayroll, cached.sourceHistoryState, independentSource, recheckSsa, cached.recheckFixedLoans);
      return cached.forecast;
    }
    const timings: RestoreTimings = {};
    const { forecast, modeledPayroll, sourceHistoryState, checkpoints, recheckSsa, recheckFixedLoans } = restorePortableArtifact(supplied, observer, timings, sample, independentSource);
    report("cold", forecast, timings);
    observeHouseholdForecastSources(forecast);
    if (typeof artifact === "object" && artifact !== null && supplied) restoredArtifacts.set(artifact, {
      version: supplied.version, encoded: supplied.encoded, integrity: supplied.integrity, forecast, modeledPayroll, sourceHistoryState, checkpoints, recheckSsa, recheckFixedLoans,
    });
    return forecast;
  }
  catch (error) {
    if (supplied?.version === "household-replay/v3")
      throw new Error("HOUSEHOLD_REPLAY_BASIS_MISMATCH: portable checkpoint evidence is invalid or unavailable", { cause: error });
    throw error;
  }
};
