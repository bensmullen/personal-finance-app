import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes, validationIssue } from "../src/diagnostics/index.js";
import { idempotencyKey } from "../src/identity/index.js";
import {
  assertObservedFactWithinDataCutoff,
  canonicalSerialize,
  completedRunResult,
  createInputFingerprint,
  createRunContext,
  createRunMetadata,
  incompleteRunResult,
  invalidModelRunResult,
  runId,
  scenarioId,
} from "../src/simulation/run.js";
import {
  createFactProvenance,
  isModelGeneratedFact,
  isObservedFact,
  type FactProvenance,
} from "../src/model/provenance.js";
import { instant, period } from "../src/time/index.js";
import { money, USD } from "../src/values/index.js";
import { CURRENT_RUN_VERSIONS } from "../src/model/version.js";

const START = instant("2026-01-01T00:00:00.000Z");
const END = instant("2026-02-01T00:00:00.000Z");
const AS_OF = instant("2025-12-31T23:59:59.999Z");
const RUN_A = runId("11111111-1111-4111-8111-111111111111");
const RUN_B = runId("22222222-2222-4222-8222-222222222222");
const SCENARIO_A = scenarioId("33333333-3333-4333-8333-333333333333");
const SCENARIO_B = scenarioId("44444444-4444-4444-8444-444444444444");

const context = (overrides: Partial<Parameters<typeof createRunContext>[0]> = {}) => createRunContext({
  runId: RUN_A,
  scenarioId: SCENARIO_A,
  asOf: AS_OF,
  dataCutoff: AS_OF,
  simulationStart: START,
  simulationEnd: END,
  baseCurrency: USD,
  ...overrides,
});

const validationCode = (operation: () => unknown): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error("Expected ValidationError");
};

describe("run context and deterministic reproduction metadata", () => {
  it("accepts an explicit valid temporal context and rejects invalid boundaries", () => {
    expect(context()).toEqual(expect.objectContaining({
      runId: RUN_A,
      scenarioId: SCENARIO_A,
      asOf: AS_OF,
      dataCutoff: AS_OF,
      simulationStart: START,
      simulationEnd: END,
      versions: CURRENT_RUN_VERSIONS,
    }));
    expect(validationCode(() => context({ simulationEnd: START }))).toBe(issueCodes.invalidRunContext);
    expect(validationCode(() => context({ dataCutoff: START }))).toBe(issueCodes.invalidRunContext);
    expect(validationCode(() => context({ versions: { ...CURRENT_RUN_VERSIONS, modelFormatVersion: CURRENT_RUN_VERSIONS.financialSpecificationVersion } }))).toBe(issueCodes.modelVersionMismatch);
  });

  it("revalidates structurally cloned contexts at public utility boundaries", () => {
    const valid = context();
    const invalidCutoff = { ...valid, dataCutoff: START };
    const invalidVersions = { ...valid, versions: { ...valid.versions, engineVersion: "999.0.0" } };
    const fingerprint = createInputFingerprint({ runContext: valid, openingState: {} });
    expect(validationCode(() => createInputFingerprint({ runContext: invalidCutoff, openingState: {} }))).toBe(issueCodes.invalidRunContext);
    expect(validationCode(() => createRunMetadata(invalidCutoff, fingerprint))).toBe(issueCodes.invalidRunContext);
    expect(validationCode(() => createRunMetadata(invalidVersions, fingerprint))).toBe(issueCodes.modelVersionMismatch);
    expect(validationCode(() => assertObservedFactWithinDataCutoff(createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: "model:boundary", effectiveAt: START }), invalidCutoff))).toBe(issueCodes.invalidRunContext);
  });

  it("canonicalizes object property order while preserving meaningful array order and exact money", () => {
    expect(canonicalSerialize({ z: money("1.20"), a: { b: 2, a: 1 } }))
      .toBe(canonicalSerialize({ a: { a: 1, b: 2 }, z: money("1.2") }));
    expect(canonicalSerialize({ values: ["a", "b"] })).not.toBe(canonicalSerialize({ values: ["b", "a"] }));
  });

  it("has a stable fingerprint vector and ignores object insertion order", () => {
    const input = { runContext: context(), openingState: { cash: money("1.20"), nested: { z: "last", a: "first" } } };
    const reordered = { runContext: context(), openingState: { nested: { a: "first", z: "last" }, cash: money("1.2") } };
    expect(createInputFingerprint(input)).toBe("fnv1a64:v1:dc70dde95f16756b");
    expect(createInputFingerprint(reordered)).toBe(createInputFingerprint(input));
  });

  it("changes for economic, temporal, scenario, and policy changes but not runId alone", () => {
    const fingerprint = (runContext: ReturnType<typeof context>, openingState: unknown, policyInputs?: unknown) =>
      createInputFingerprint({ runContext, openingState, ...(policyInputs === undefined ? {} : { policyInputs }) });
    const baseline = fingerprint(context(), { cash: money("1") }, { funding: "cash-a" });
    expect(fingerprint(context(), { cash: money("2") }, { funding: "cash-a" })).not.toBe(baseline);
    expect(fingerprint(context({ asOf: instant("2025-12-30T00:00:00.000Z"), dataCutoff: instant("2025-12-30T00:00:00.000Z") }), { cash: money("1") }, { funding: "cash-a" })).not.toBe(baseline);
    expect(fingerprint(context({ scenarioId: SCENARIO_B }), { cash: money("1") }, { funding: "cash-a" })).not.toBe(baseline);
    expect(fingerprint(context(), { cash: money("1") }, { funding: "cash-b" })).not.toBe(baseline);
    expect(fingerprint(context({ runId: RUN_B }), { cash: money("1") }, { funding: "cash-a" })).toBe(baseline);
  });

  it("puts all required versions and temporal fields in serializable result metadata", () => {
    const runContext = context();
    const metadata = createRunMetadata(runContext, createInputFingerprint({ runContext, openingState: {} }));
    expect(metadata).toEqual(expect.objectContaining({
      ...CURRENT_RUN_VERSIONS,
      runId: RUN_A,
      scenarioId: SCENARIO_A,
      asOf: AS_OF,
      dataCutoff: AS_OF,
      baseCurrency: "USD",
    }));
    expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
    expect(metadata.financialSpecificationVersion).not.toBe(metadata.modelFormatVersion);
  });
});

describe("run completion semantics", () => {
  const metadata = () => {
    const runContext = context();
    return createRunMetadata(runContext, createInputFingerprint({ runContext, openingState: {} }));
  };
  const horizon = period(START, END);

  it("marks completed only when the requested horizon was reached", () => {
    const result = completedRunResult({ metadata: metadata(), requestedHorizon: horizon, reachedThrough: END, periods: [{ constraint: "liquidity_shortfall" }] });
    expect(result.status).toBe("completed");
    expect(result.periods[0]).toEqual({ constraint: "liquidity_shortfall" });
    expect(validationCode(() => completedRunResult({ metadata: metadata(), requestedHorizon: horizon, reachedThrough: START, periods: [] }))).toBe(issueCodes.invalidRunCompletionResult);
  });

  it("keeps incomplete and invalid_model distinct and prevents false horizon completion", () => {
    const reason = validationIssue({ severity: "error", code: "HARD_PERIOD_FAILURE", message: "period failed" });
    const incomplete = incompleteRunResult({ metadata: metadata(), requestedHorizon: horizon, stoppedAt: instant("2026-01-15T00:00:00.000Z"), reachedThrough: START, reason, periods: [{ committed: true }] });
    const invalid = invalidModelRunResult([validationIssue({ severity: "error", code: "INVALID_INPUT", message: "bad model" })]);
    expect(incomplete.status).toBe("incomplete");
    expect(invalid.status).toBe("invalid_model");
    expect(validationCode(() => incompleteRunResult({ metadata: metadata(), requestedHorizon: horizon, stoppedAt: END, reachedThrough: END, reason, periods: [] }))).toBe(issueCodes.invalidRunCompletionResult);
    expect(validationCode(() => invalidModelRunResult([validationIssue({ severity: "warning", code: issueCodes.liquidityShortfall, message: "modeled stress" })]))).toBe(issueCodes.invalidRunCompletionResult);
  });

  it("requires coherent incomplete horizons, progress, and a hard-stop error", () => {
    const reason = validationIssue({ severity: "error", code: "HARD_PERIOD_FAILURE", message: "period failed" });
    const stoppedAt = instant("2026-01-15T00:00:00.000Z");
    expect(validationCode(() => incompleteRunResult({ metadata: metadata(), requestedHorizon: period(START, instant("2026-03-01T00:00:00.000Z")), stoppedAt, reason, periods: [] }))).toBe(issueCodes.invalidRunCompletionResult);
    expect(validationCode(() => incompleteRunResult({ metadata: metadata(), requestedHorizon: horizon, stoppedAt, reachedThrough: instant("2026-01-16T00:00:00.000Z"), reason, periods: [] }))).toBe(issueCodes.invalidRunCompletionResult);
    expect(validationCode(() => incompleteRunResult({ metadata: metadata(), requestedHorizon: horizon, stoppedAt, reachedThrough: instant("2025-12-31T23:59:59.999Z"), reason, periods: [] }))).toBe(issueCodes.invalidRunCompletionResult);
    expect(validationCode(() => incompleteRunResult({ metadata: metadata(), requestedHorizon: horizon, stoppedAt: END, reachedThrough: END, reason, periods: [] }))).toBe(issueCodes.invalidRunCompletionResult);
    expect(validationCode(() => incompleteRunResult({ metadata: metadata(), requestedHorizon: horizon, stoppedAt, reason: validationIssue({ severity: "warning", code: issueCodes.liquidityShortfall, message: "modeled stress" }), periods: [] }))).toBe(issueCodes.invalidRunCompletionResult);
    expect(incompleteRunResult({ metadata: metadata(), requestedHorizon: horizon, stoppedAt, reachedThrough: START, reason, periods: [] }).reason).toEqual(reason);
  });

  it("allows mixed invalid-model diagnostics only when at least one error exists", () => {
    const error = validationIssue({ severity: "error", code: "INVALID_INPUT", message: "bad model" });
    const warning = validationIssue({ severity: "warning", code: issueCodes.liquidityShortfall, message: "also stressed" });
    expect(invalidModelRunResult([error, warning]).issues).toEqual([error, warning]);
    expect(validationCode(() => invalidModelRunResult([warning]))).toBe(issueCodes.invalidRunCompletionResult);
  });

  it("rejects structurally forged run metadata in completion factories", () => {
    const valid = metadata();
    const invalidCutoff = { ...valid, dataCutoff: START };
    const invalidVersions = { ...valid, engineVersion: "999.0.0" };
    const reason = validationIssue({ severity: "error", code: "HARD_PERIOD_FAILURE", message: "period failed" });
    expect(validationCode(() => completedRunResult({ metadata: invalidCutoff, requestedHorizon: horizon, reachedThrough: END, periods: [] }))).toBe(issueCodes.invalidRunContext);
    expect(validationCode(() => completedRunResult({ metadata: invalidVersions, requestedHorizon: horizon, reachedThrough: END, periods: [] }))).toBe(issueCodes.modelVersionMismatch);
    expect(validationCode(() => incompleteRunResult({ metadata: invalidCutoff, requestedHorizon: horizon, stoppedAt: START, reason, periods: [] }))).toBe(issueCodes.invalidRunContext);
    expect(validationCode(() => incompleteRunResult({ metadata: invalidVersions, requestedHorizon: horizon, stoppedAt: START, reason, periods: [] }))).toBe(issueCodes.modelVersionMismatch);
  });
});

describe("fact provenance and actual/forecast boundary", () => {
  const observed = () => createFactProvenance({
    factKind: "observed",
    sourceType: "financial_institution",
    sourceId: "institution:synthetic",
    observedAt: AS_OF,
    importedAt: START,
    effectiveAt: AS_OF,
    originalExternalId: "synthetic-transaction-1",
    idempotencyKey: idempotencyKey("institution:synthetic", "synthetic-transaction-1"),
  });

  it("distinguishes observed, user-entered, and model-generated facts after serialization", () => {
    const user = createFactProvenance({ factKind: "authoritative_input", sourceType: "user", sourceId: "user:fixture", effectiveAt: START });
    const model = createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: "primitive:fixture", effectiveAt: START });
    expect(isObservedFact(observed())).toBe(true);
    expect(isModelGeneratedFact(model)).toBe(true);
    expect(user.factKind).toBe("authoritative_input");
    expect(JSON.parse(JSON.stringify([observed(), user, model])).map((item: FactProvenance) => item.factKind))
      .toEqual(["observed", "authoritative_input", "model_generated"]);
  });

  it("preserves external identity and rejects invalid source combinations", () => {
    const copied = JSON.parse(JSON.stringify(observed()));
    expect(copied).toEqual(expect.objectContaining({
      originalExternalId: "synthetic-transaction-1",
      idempotencyKey: idempotencyKey("institution:synthetic", "synthetic-transaction-1"),
    }));
    expect(validationCode(() => createFactProvenance({ factKind: "observed", sourceType: "user", sourceId: "bad", observedAt: AS_OF, effectiveAt: AS_OF, originalExternalId: "x", idempotencyKey: idempotencyKey("bad", "x") } as never))).toBe(issueCodes.invalidProvenance);
  });

  it("uses observation availability, not economic timing, for dataCutoff", () => {
    const lateObserved = createFactProvenance({ ...observed(), observedAt: START, effectiveAt: AS_OF } as FactProvenance);
    expect(validationCode(() => assertObservedFactWithinDataCutoff(lateObserved, context()))).toBe(issueCodes.observedFactAfterDataCutoff);
    const knownFutureEffective = createFactProvenance({ ...observed(), observedAt: AS_OF, effectiveAt: START } as FactProvenance);
    expect(() => assertObservedFactWithinDataCutoff(knownFutureEffective, context())).not.toThrow();
    const modeled = createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: "model:1", effectiveAt: instant("2027-01-01T00:00:00.000Z") });
    expect(() => assertObservedFactWithinDataCutoff(modeled, context())).not.toThrow();
    expect(modeled.factKind).toBe("model_generated");
  });
});
