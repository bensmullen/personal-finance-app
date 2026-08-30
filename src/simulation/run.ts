import { failValidation, issueCodes, validationIssue, type ValidationIssue } from "../diagnostics/index.js";
import { domainId, type DomainId } from "../identity/index.js";
import { isObservedFact, type FactProvenance } from "../model/provenance.js";
import type { Instant, Period } from "../time/index.js";
import { Currency, DecimalAmount, Money, Percentage, Quantity, Rate, Ratio, RoundingPolicy, Unit } from "../values/index.js";
import { CURRENT_RUN_VERSIONS, type RunVersionMetadata } from "../model/version.js";

export type RunId = DomainId<"run">;
export type ScenarioId = DomainId<"scenario">;

export const runId = (value: string): RunId => domainId("run", value);
export const scenarioId = (value: string): ScenarioId => domainId("scenario", value);

export interface RunContext {
  readonly runId: RunId;
  readonly scenarioId: ScenarioId;
  readonly asOf: Instant;
  readonly dataCutoff: Instant;
  readonly simulationStart: Instant;
  readonly simulationEnd: Instant;
  readonly baseCurrency: Currency;
  readonly versions: RunVersionMetadata;
}

export interface RunContextDraft extends Omit<RunContext, "versions"> {
  readonly versions?: RunVersionMetadata;
}

const invalidRunContext = (message: string, fieldPath: string): never => failValidation({
  severity: "error",
  code: issueCodes.invalidRunContext,
  message,
  entityType: "run_context",
  fieldPath,
});

const assertCurrentVersions = (
  versions: RunVersionMetadata,
  entityType: "run_context" | "run_metadata",
  fieldPrefix = "",
): void => {
  for (const key of Object.keys(CURRENT_RUN_VERSIONS) as (keyof RunVersionMetadata)[]) {
    if (versions?.[key] !== CURRENT_RUN_VERSIONS[key]) {
      failValidation({
        severity: "error",
        code: issueCodes.modelVersionMismatch,
        message: `Run ${key} ${String(versions?.[key])} is not supported by this engine; expected ${CURRENT_RUN_VERSIONS[key]}`,
        entityType,
        fieldPath: `${fieldPrefix}${key}`,
      });
    }
  }
};

export const assertRunContext = (context: RunContext): void => {
  if (context.simulationStart >= context.simulationEnd) {
    invalidRunContext("Run simulationStart must precede simulationEnd", "simulationStart");
  }
  if (context.dataCutoff > context.asOf) {
    invalidRunContext("Run dataCutoff must not be later than asOf", "dataCutoff");
  }
  if (!(context.baseCurrency instanceof Currency)) {
    invalidRunContext("Run baseCurrency must be a canonical supported runtime currency", "baseCurrency");
  }
  try {
    const canonical = Currency.of(context.baseCurrency.code);
    if (!canonical.equals(context.baseCurrency) || canonical.minorUnitScale !== context.baseCurrency.minorUnitScale) {
      invalidRunContext("Run baseCurrency must be a canonical supported runtime currency", "baseCurrency");
    }
  } catch {
    invalidRunContext("Run baseCurrency must be a canonical supported runtime currency", "baseCurrency");
  }
  assertCurrentVersions(context.versions, "run_context", "versions.");
};

export const createRunContext = (draft: RunContextDraft): RunContext => {
  const versions = Object.freeze({ ...(draft.versions ?? CURRENT_RUN_VERSIONS) });
  const context = { ...draft, versions } as RunContext;
  assertRunContext(context);
  return Object.freeze(context);
};

export const assertObservedFactWithinDataCutoff = (
  provenance: FactProvenance,
  context: RunContext,
): void => {
  assertRunContext(context);
  if (isObservedFact(provenance) && provenance.observedAt > context.dataCutoff) {
    failValidation({
      severity: "error",
      code: issueCodes.observedFactAfterDataCutoff,
      message: `Observed fact observed at ${provenance.observedAt} exceeds run data cutoff ${context.dataCutoff}`,
      entityType: "provenance",
      fieldPath: "observedAt",
      relatedIds: [provenance.sourceId, context.runId],
    });
  }
};

const jsonPrimitive = (value: null | boolean | number | string): string => {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Canonical input cannot contain a non-finite number");
  return JSON.stringify(value);
};

const canonicalValue = (value: unknown, active: Set<object>): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return jsonPrimitive(value);
  }
  if (value === undefined) throw new Error("Canonical input cannot contain undefined array values");
  if (typeof value === "bigint") return `{"$bigint":${JSON.stringify(value.toString())}}`;
  if (typeof value !== "object") throw new Error(`Unsupported canonical input type: ${typeof value}`);

  if (active.has(value)) throw new Error("Canonical input cannot contain cycles");
  active.add(value);
  try {
    if (value instanceof DecimalAmount) return `{"$decimal":${JSON.stringify(value.toString())}}`;
    if (value instanceof Money) return `{"$money":{"amount":${JSON.stringify(value.amount.toString())},"currency":${JSON.stringify(value.currency.code)}}}`;
    if (value instanceof Currency || value instanceof Unit) return canonicalValue(value.toJSON(), active);
    if (value instanceof Ratio || value instanceof Percentage || value instanceof Quantity || value instanceof Rate) {
      return canonicalValue(value.toJSON(), active);
    }
    if (value instanceof RoundingPolicy) return canonicalValue({ mode: value.mode, scale: value.scale }, active);
    if (Array.isArray(value)) return `[${value.map((item) => canonicalValue(item, active)).join(",")}]`;

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key], active)}`).join(",")}}`;
  } finally {
    active.delete(value);
  }
};

/** Canonical JSON-like serialization for deterministic comparison; object keys sort, meaningful arrays do not. */
export const canonicalSerialize = (value: unknown): string => canonicalValue(value, new Set());

const fnv1a64 = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
};

export type InputFingerprint = string & { readonly __inputFingerprint: "InputFingerprint" };

export interface RunFingerprintInput {
  readonly runContext: RunContext;
  readonly openingState: unknown;
  readonly model?: unknown;
  readonly scenario?: unknown;
  readonly assumptions?: unknown;
  readonly policyInputs?: unknown;
}

/** Deterministic reproduction/change fingerprint, not an authentication or tamper-resistance primitive. */
export const createInputFingerprint = (input: RunFingerprintInput): InputFingerprint => {
  assertRunContext(input.runContext);
  const { runId: _runId, ...economicRunContext } = input.runContext;
  const canonical = canonicalSerialize({
    runContext: economicRunContext,
    openingState: input.openingState,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
    ...(input.assumptions === undefined ? {} : { assumptions: input.assumptions }),
    ...(input.policyInputs === undefined ? {} : { policyInputs: input.policyInputs }),
  });
  return `fnv1a64:v1:${fnv1a64(canonical)}` as InputFingerprint;
};

export interface RunMetadata extends RunVersionMetadata {
  readonly runId: RunId;
  readonly scenarioId: ScenarioId;
  readonly asOf: Instant;
  readonly dataCutoff: Instant;
  readonly simulationStart: Instant;
  readonly simulationEnd: Instant;
  readonly baseCurrency: string;
  readonly inputFingerprint: InputFingerprint;
}

export const assertRunMetadata = (metadata: RunMetadata): void => {
  if (metadata.simulationStart >= metadata.simulationEnd) {
    invalidRunContext("Run metadata simulationStart must precede simulationEnd", "simulationStart");
  }
  if (metadata.dataCutoff > metadata.asOf) {
    invalidRunContext("Run metadata dataCutoff must not be later than asOf", "dataCutoff");
  }
  try { Currency.of(metadata.baseCurrency); } catch {
    invalidRunContext("Run metadata baseCurrency must identify a supported currency", "baseCurrency");
  }
  assertCurrentVersions(metadata, "run_metadata");
};

export const createRunMetadata = (context: RunContext, inputFingerprint: InputFingerprint): RunMetadata => {
  assertRunContext(context);
  const metadata: RunMetadata = {
    runId: context.runId,
    scenarioId: context.scenarioId,
    asOf: context.asOf,
    dataCutoff: context.dataCutoff,
    simulationStart: context.simulationStart,
    simulationEnd: context.simulationEnd,
    baseCurrency: context.baseCurrency.code,
    inputFingerprint,
    ...context.versions,
  };
  assertRunMetadata(metadata);
  return Object.freeze(metadata);
};

interface RunResultBase<TPeriodResult> {
  readonly periods: readonly TPeriodResult[];
}

export interface CompletedRunResult<TPeriodResult> extends RunResultBase<TPeriodResult> {
  readonly status: "completed";
  readonly metadata: RunMetadata;
  readonly requestedHorizon: Period;
  readonly reachedThrough: Instant;
}

export interface IncompleteRunResult<TPeriodResult> extends RunResultBase<TPeriodResult> {
  readonly status: "incomplete";
  readonly metadata: RunMetadata;
  readonly requestedHorizon: Period;
  readonly stoppedAt: Instant;
  readonly reachedThrough?: Instant;
  readonly reason: ValidationIssue;
}

export interface InvalidModelRunResult {
  readonly status: "invalid_model";
  readonly periods: readonly never[];
  readonly issues: readonly ValidationIssue[];
}

export type SimulationRunResult<TPeriodResult> =
  | CompletedRunResult<TPeriodResult>
  | IncompleteRunResult<TPeriodResult>
  | InvalidModelRunResult;

const invalidCompletion = (message: string): never => failValidation({
  severity: "error",
  code: issueCodes.invalidRunCompletionResult,
  message,
  entityType: "simulation_run_result",
});

export const completedRunResult = <TPeriodResult>(draft: Omit<CompletedRunResult<TPeriodResult>, "status">): CompletedRunResult<TPeriodResult> => {
  assertRunMetadata(draft.metadata);
  if (draft.requestedHorizon.start !== draft.metadata.simulationStart || draft.requestedHorizon.end !== draft.metadata.simulationEnd) {
    invalidCompletion("Completed result horizon must match run metadata");
  }
  if (draft.reachedThrough !== draft.requestedHorizon.end) {
    invalidCompletion("Completed result must reach the requested horizon end");
  }
  return Object.freeze({ ...draft, status: "completed", periods: Object.freeze([...draft.periods]) });
};

export const incompleteRunResult = <TPeriodResult>(draft: Omit<IncompleteRunResult<TPeriodResult>, "status">): IncompleteRunResult<TPeriodResult> => {
  assertRunMetadata(draft.metadata);
  if (draft.requestedHorizon.start !== draft.metadata.simulationStart || draft.requestedHorizon.end !== draft.metadata.simulationEnd) {
    invalidCompletion("Incomplete result horizon must match run metadata");
  }
  if (draft.stoppedAt < draft.requestedHorizon.start || draft.stoppedAt > draft.requestedHorizon.end) {
    invalidCompletion("Incomplete result stoppedAt must fall within the requested horizon");
  }
  if (draft.reachedThrough !== undefined && (draft.reachedThrough < draft.requestedHorizon.start || draft.reachedThrough >= draft.requestedHorizon.end || draft.reachedThrough > draft.stoppedAt)) {
    invalidCompletion("Incomplete result reachedThrough must be within the horizon, before its end, and no later than stoppedAt");
  }
  if (draft.reason.severity !== "error") {
    invalidCompletion("Incomplete result requires an error-severity hard-stop reason");
  }
  return Object.freeze({ ...draft, reason: validationIssue(draft.reason), status: "incomplete", periods: Object.freeze([...draft.periods]) });
};

export const invalidModelRunResult = (issues: readonly ValidationIssue[]): InvalidModelRunResult => {
  if (!issues.some((issue) => issue.severity === "error")) {
    invalidCompletion("invalid_model requires one or more error diagnostics");
  }
  return Object.freeze({ status: "invalid_model", periods: Object.freeze([]), issues: Object.freeze(issues.map(validationIssue)) });
};
