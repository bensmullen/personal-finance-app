import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { domainId, uuid } from "../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../src/lineage/index.js";
import {
  assertPrimitiveFlowValuesCompatible,
  evaluatePrimitive,
  getPrimitiveDefinition,
  initialOneTimePrimitiveState,
  initialEventModificationPrimitiveState,
  initialEventTerminationPrimitiveState,
  initialEventTriggerPrimitiveState,
  isPrimitiveId,
  listPrimitiveDefinitions,
  parsePrimitiveId,
  primitiveEvaluationContext,
  type PrimitiveEvaluationContext,
} from "../src/primitives/index.js";
import { civilDate, instant, period, subtractMilliseconds, utcMonth } from "../src/time/index.js";
import {
  Currency,
  Quantity,
  Rate,
  Ratio,
  RoundingPolicy,
  SHARE,
  Unit,
  decimal,
  money,
  rateConvention,
  ratePeriod,
} from "../src/values/index.js";

const scenarioId = domainId("scenario", "11111111-1111-4111-8111-111111111111");
const primitiveInstanceId = domainId("primitive-instance", "22222222-2222-4222-8222-222222222222");
const economicTargetId = uuid("33333333-3333-4333-8333-333333333333");
const traceRef = calculationTraceRef(calculationTraceId("primitive-trace"));

const context = (overrides: Partial<PrimitiveEvaluationContext> = {}): PrimitiveEvaluationContext =>
  primitiveEvaluationContext({
    period: utcMonth(2026, 1),
    evaluationInstant: instant("2026-01-15T00:00:00.000Z"),
    scenarioId,
    primitiveInstanceId,
    economicTargetId,
    semanticEffectType: "recognition",
    traceRefs: [traceRef],
    ...overrides,
  });

const diagnosticCode = (action: () => unknown): string | undefined => {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof ValidationError ? error.issues[0]?.code : undefined;
  }
};

describe("primitive runtime catalog", () => {
  it("registers exactly the canonical P01-P34 sequence", () => {
    const expected = Array.from({ length: 34 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`);
    expect(listPrimitiveDefinitions().map((entry) => entry.id)).toEqual(expected);
  });

  it("marks exactly the PR 10 primitive set implemented", () => {
    expect(listPrimitiveDefinitions().filter((entry) => entry.implementationStatus === "implemented").map((entry) => entry.id))
      .toEqual(["P01", "P02", "P03", "P04", "P05", "P06", "P08", "P13", "P20", "P22", "P23", "P24", "P26", "P27", "P29", "P30"]);
    expect(listPrimitiveDefinitions().filter((entry) => entry.implementationStatus === "registered_only")).toHaveLength(18);
  });

  it("preserves representative canonical names, classes, state, and randomness", () => {
    expect(getPrimitiveDefinition("P01")).toMatchObject({ name: "static", class: "temporal", stateful: false, randomness: "deterministic" });
    expect(getPrimitiveDefinition("P20")).toMatchObject({ name: "tax_dependent", class: "dependency", stateful: true, randomness: "deterministic" });
    expect(getPrimitiveDefinition("P33")).toMatchObject({ name: "correlated_random_process", class: "event_uncertainty", stateful: true, randomness: "stochastic" });
  });

  it("exposes immutable, deterministic lookup results", () => {
    const entries = listPrimitiveDefinitions();
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(getPrimitiveDefinition("P08")).toBe(getPrimitiveDefinition("P08"));
  });

  it("validates boundary strings before granting primitive identity", () => {
    expect(isPrimitiveId("P34")).toBe(true);
    expect(parsePrimitiveId("P34")).toBe("P34");
    expect(diagnosticCode(() => parsePrimitiveId("P35"))).toBe(issueCodes.primitiveUnknown);
  });

  it("distinguishes registered-only evaluation from unknown identity", () => {
    expect(diagnosticCode(() => evaluatePrimitive({ primitiveId: "P07" }))).toBe(issueCodes.primitiveNotImplemented);
    expect(diagnosticCode(() => getPrimitiveDefinition("P99"))).toBe(issueCodes.primitiveUnknown);
  });
});

describe("scheduled event primitives", () => {
  const eventId = domainId("event", "44444444-4444-4444-8444-444444444444");
  const effectiveAt = instant("2026-01-15T00:00:00.000Z");

  it("P27 edge-triggers once with deterministic retry identity", () => {
    const initial = initialEventTriggerPrimitiveState();
    const request = (priorState: ReturnType<typeof initialEventTriggerPrimitiveState>, evaluationInstant: ReturnType<typeof instant>) => evaluatePrimitive({ primitiveId: "P27", input: { eventId }, parameters: { effectiveAt, targetId: economicTargetId }, priorState, context: context({ evaluationInstant }) });
    expect(request(initial, instant("2026-01-14T23:59:59.999Z")).output).toMatchObject({ active: false, activatedNow: false });
    const first = request(initial, effectiveAt);
    expect(first.output).toMatchObject({ active: true, activatedNow: true });
    expect(request(initial, effectiveAt).effects).toEqual(first.effects);
    expect(request(first.nextState, instant("2026-01-20T00:00:00.000Z")).effects).toEqual([]);
  });

  it("P29 applies and reverts a compatible typed replacement", () => {
    const parameters = { targetId: economicTargetId, effectiveAt, precedence: 10, endAt: instant("2026-01-20T00:00:00.000Z"), provenance: { factKind: "authoritative_input" as const, sourceType: "user" as const, sourceId: "event-rule", effectiveAt } };
    const input = { base: money("100"), replacement: money("125"), eventId };
    const before = evaluatePrimitive({ primitiveId: "P29", input, parameters, priorState: initialEventModificationPrimitiveState(), context: context({ evaluationInstant: instant("2026-01-14T00:00:00.000Z") }) });
    expect((before.output.value as ReturnType<typeof money>).equals(money("100"))).toBe(true);
    const applied = evaluatePrimitive({ primitiveId: "P29", input, parameters, priorState: before.nextState, context: context({ evaluationInstant: effectiveAt }) });
    expect((applied.output.value as ReturnType<typeof money>).equals(money("125"))).toBe(true);
    const reverted = evaluatePrimitive({ primitiveId: "P29", input, parameters, priorState: applied.nextState, context: context({ evaluationInstant: parameters.endAt }) });
    expect((reverted.output.value as ReturnType<typeof money>).equals(money("100"))).toBe(true);
    expect(reverted.nextState).toMatchObject({ applied: true, reverted: true });
    expect([...applied.effects, ...reverted.effects].every((effect) => effect.provenance?.sourceId === "event-rule")).toBe(true);
  });

  it("P30 returns compatible zero at and after termination", () => {
    const parameters = { targetId: economicTargetId, terminationAt: effectiveAt };
    const input = { base: money("50"), eventId };
    const before = evaluatePrimitive({ primitiveId: "P30", input, parameters, priorState: initialEventTerminationPrimitiveState(), context: context({ evaluationInstant: instant("2026-01-14T00:00:00.000Z") }) });
    expect(before.output.active).toBe(true);
    const stopped = evaluatePrimitive({ primitiveId: "P30", input, parameters, priorState: before.nextState, context: context({ evaluationInstant: effectiveAt }) });
    expect(stopped.output.active).toBe(false);
    expect((stopped.output.value as ReturnType<typeof money>).equals(money("0"))).toBe(true);
    const later = evaluatePrimitive({ primitiveId: "P30", input, parameters, priorState: stopped.nextState, context: context({ evaluationInstant: instant("2026-01-25T00:00:00.000Z") }) });
    expect(later.effects).toEqual([]);
  });
});

describe("P01 static and P06 constant", () => {
  it("preserves exact scalar, Money, and Quantity values", () => {
    const scalar = decimal("9007199254740993.000000001");
    const cash = money("123.4567");
    const shares = Quantity.parse("2.125", SHARE);
    expect(evaluatePrimitive({ primitiveId: "P01", input: { value: scalar }, priorState: null, context: context() }).output).toBe(scalar);
    expect(evaluatePrimitive({ primitiveId: "P01", input: { value: cash }, priorState: null, context: context() }).output).toBe(cash);
    expect(evaluatePrimitive({ primitiveId: "P01", input: { value: shares }, priorState: null, context: context() }).output).toBe(shares);
  });

  it("is deterministic and does not mutate input or trace references", () => {
    const input = Object.freeze({ value: money("42") });
    const refs = Object.freeze([traceRef]);
    const runtimeContext = context({ traceRefs: refs });
    const first = evaluatePrimitive({ primitiveId: "P01", input, priorState: null, context: runtimeContext });
    const second = evaluatePrimitive({ primitiveId: "P01", input, priorState: null, context: runtimeContext });
    expect(first.output).toBe(second.output);
    expect(first.traceRefs).toEqual(refs);
    expect(first.traceRefs).not.toBe(refs);
    expect(Object.isFrozen(first)).toBe(true);
    expect(input.value.amount.toString()).toBe("42");
  });

  it("keeps constant as a temporal function distinct from static", () => {
    const runtimeContext = context();
    const result = evaluatePrimitive({ primitiveId: "P06", input: { value: money("10000") }, priorState: null, context: runtimeContext });
    expect(result.output).toEqual({ at: runtimeContext.evaluationInstant, value: money("10000") });
    expect(getPrimitiveDefinition("P01").name).not.toBe(getPrimitiveDefinition("P06").name);
  });
});

describe("P02 one_time", () => {
  const evaluateAt = (occurrenceAt: ReturnType<typeof instant>, priorState = initialOneTimePrimitiveState()) =>
    evaluatePrimitive({
      primitiveId: "P02",
      input: { value: money("250") },
      parameters: { occurrenceAt },
      priorState,
      context: context(),
    });

  it("includes the period start and instant immediately before the end", () => {
    const january = utcMonth(2026, 1);
    expect(evaluateAt(january.start).output.occurrences).toHaveLength(1);
    expect(evaluateAt(subtractMilliseconds(january.end, 1)).output.occurrences).toHaveLength(1);
  });

  it("excludes the half-open period end", () => {
    expect(evaluateAt(utcMonth(2026, 1).end).output.occurrences).toHaveLength(0);
  });

  it("returns explicit execution state without mutating prior state", () => {
    const prior = initialOneTimePrimitiveState();
    const result = evaluateAt(instant("2026-01-20T00:00:00.000Z"), prior);
    expect(prior).toEqual({ executed: false });
    expect(result.nextState.executed).toBe(true);
    expect(result.nextState.occurrenceId).toBe(result.output.occurrences[0]?.occurrenceId);
    expect(Object.isFrozen(result.nextState)).toBe(true);
  });

  it("supports rollback retry and deterministic occurrence identity", () => {
    const prior = initialOneTimePrimitiveState();
    const first = evaluateAt(instant("2026-01-20T00:00:00.000Z"), prior);
    const retried = evaluateAt(instant("2026-01-20T00:00:00.000Z"), prior);
    expect(retried.output.occurrences[0]?.occurrenceId).toBe(first.output.occurrences[0]?.occurrenceId);
  });

  it("suppresses duplicate execution only after returned state is committed", () => {
    const first = evaluateAt(instant("2026-01-20T00:00:00.000Z"));
    expect(evaluateAt(instant("2026-01-20T00:00:00.000Z"), first.nextState).output.occurrences).toHaveLength(0);
  });

  it("rejects malformed committed state", () => {
    expect(diagnosticCode(() => evaluateAt(
      instant("2026-01-20T00:00:00.000Z"),
      { executed: true },
    ))).toBe(issueCodes.primitiveStateInvalid);
  });
});

describe("P03 recurring", () => {
  const monthly = (runtimeContext = context()) => evaluatePrimitive({
    primitiveId: "P03",
    input: { amount: money("10000") },
    parameters: {
      schedule: {
        kind: "utc_monthly",
        anchor: instant("2025-11-15T12:00:00.000Z"),
        invalidDayPolicy: "skip",
      },
    },
    priorState: null,
    context: runtimeContext,
  });

  it("generates exactly one canonical monthly occurrence", () => {
    const result = monthly();
    expect(result.output.occurrences.map((item) => item.scheduledAt)).toEqual(["2026-01-15T12:00:00.000Z"]);
    expect(result.output.aggregate?.amount.toString()).toBe("10000");
  });

  it("aggregates multiple explicit occurrences after assigning identities", () => {
    const result = evaluatePrimitive({
      primitiveId: "P03",
      input: { amount: money("125") },
      parameters: { schedule: { kind: "explicit_instants", instants: [
        instant("2026-01-20T00:00:00.000Z"),
        instant("2026-01-05T00:00:00.000Z"),
        instant("2026-02-01T00:00:00.000Z"),
      ] } },
      priorState: null,
      context: context(),
    });
    expect(result.output.occurrences.map((item) => item.scheduledAt)).toEqual([
      "2026-01-05T00:00:00.000Z",
      "2026-01-20T00:00:00.000Z",
    ]);
    expect(result.output.occurrences.every((item) => item.occurrenceId.length > 0)).toBe(true);
    expect(result.output.aggregate?.amount.toString()).toBe("250");
  });

  it("is deterministic in identity and ordering", () => {
    expect(monthly().output.occurrences).toEqual(monthly().output.occurrences);
  });

  it("changes identity with primitive instance or scenario identity", () => {
    const original = monthly().output.occurrences[0]!.occurrenceId;
    const otherInstance = monthly(context({
      primitiveInstanceId: domainId("primitive-instance", "22222222-2222-4222-8222-222222222223"),
    })).output.occurrences[0]!.occurrenceId;
    const otherScenario = monthly(context({
      scenarioId: domainId("scenario", "11111111-1111-4111-8111-111111111112"),
    })).output.occurrences[0]!.occurrenceId;
    expect(otherInstance).not.toBe(original);
    expect(otherScenario).not.toBe(original);
  });

  it("rejects duplicate explicit occurrence instants", () => {
    const at = instant("2026-01-05T00:00:00.000Z");
    expect(diagnosticCode(() => evaluatePrimitive({
      primitiveId: "P03",
      input: { amount: money("1") },
      parameters: { schedule: { kind: "explicit_instants", instants: [at, at] } },
      priorState: null,
      context: context(),
    }))).toBe(issueCodes.primitiveTemporalConfigurationInvalid);
  });
});

describe("P04 finite_duration and P05 perpetual", () => {
  const at = (evaluationInstant: ReturnType<typeof instant>) => context({ evaluationInstant });
  const start = instant("2026-01-10T00:00:00.000Z");
  const end = instant("2026-01-20T00:00:00.000Z");

  it("uses a start-inclusive, end-exclusive finite interval", () => {
    const evaluateAt = (evaluationInstant: ReturnType<typeof instant>) => evaluatePrimitive({
      primitiveId: "P04",
      input: { value: money("5") },
      parameters: { start, end },
      priorState: null,
      context: at(evaluationInstant),
    }).output.active;
    expect(evaluateAt(start)).toBe(true);
    expect(evaluateAt(subtractMilliseconds(end, 1))).toBe(true);
    expect(evaluateAt(end)).toBe(false);
  });

  it("rejects an invalid finite interval", () => {
    expect(diagnosticCode(() => evaluatePrimitive({
      primitiveId: "P04", input: { value: money("5") }, parameters: { start, end: start }, priorState: null, context: at(start),
    }))).toBe(issueCodes.primitiveTemporalConfigurationInvalid);
  });

  it("keeps perpetual values inactive before start and active at/after start", () => {
    const evaluateAt = (evaluationInstant: ReturnType<typeof instant>) => evaluatePrimitive({
      primitiveId: "P05", input: { value: money("5") }, parameters: { start }, priorState: null, context: at(evaluationInstant),
    }).output.active;
    expect(evaluateAt(instant("2026-01-09T23:59:59.999Z"))).toBe(false);
    expect(evaluateAt(start)).toBe(true);
    expect(evaluateAt(instant("2026-01-31T00:00:00.000Z"))).toBe(true);
  });
});

describe("P08 geometric_growth", () => {
  it("applies exact periodic growth for an explicit period count", () => {
    const result = evaluatePrimitive({
      primitiveId: "P08",
      input: { initial: money("100"), rate: Rate.fromDecimal("0.10", rateConvention.periodic(ratePeriod("1", "calendar_month"))) },
      parameters: { category: "stock", timeBasis: { kind: "per_period", periods: 2 } },
      priorState: null,
      context: context(),
    });
    expect(result.output.value.amount.toString()).toBe("121");
    expect(result.output.factor.toString()).toBe("1.21");
  });

  it("applies effective annual growth over an explicit rational year fraction", () => {
    const result = evaluatePrimitive({
      primitiveId: "P08",
      input: { initial: money("10000"), rate: Rate.fromDecimal("0.12", rateConvention.effectiveAnnual()) },
      parameters: {
        category: "recurring_occurrence_amount",
        timeBasis: {
          kind: "effective_annual",
          yearFraction: { numerator: 1, denominator: 12 },
          calculationRounding: new RoundingPolicy(24, "half_even"),
        },
      },
      priorState: null,
      context: context(),
    });
    expect(result.output.factor.toString()).toMatch(/^1\.00948879293458/);
    expect(result.output.value.amount.toString()).toMatch(/^10094\.8879293458/);
  });

  it("prevents an annual salary rate from being applied in full every month", () => {
    const result = evaluatePrimitive({
      primitiveId: "P08",
      input: { initial: money("10000"), rate: Rate.fromDecimal("0.12", rateConvention.effectiveAnnual()) },
      parameters: { category: "recurring_occurrence_amount", timeBasis: {
        kind: "effective_annual", yearFraction: { numerator: 1, denominator: 12 }, calculationRounding: new RoundingPolicy(20, "half_even"),
      } },
      priorState: null,
      context: context(),
    });
    expect(result.output.value.amount.compare(money("11200").amount)).toBe(-1);
  });

  it("rejects a rate convention that does not match the selected time basis", () => {
    expect(diagnosticCode(() => evaluatePrimitive({
      primitiveId: "P08",
      input: { initial: money("100"), rate: Rate.fromDecimal("0.12", rateConvention.effectiveAnnual()) },
      parameters: { category: "stock", timeBasis: { kind: "per_period", periods: 1 } },
      priorState: null,
      context: context(),
    }))).toBe(issueCodes.primitiveParametersInvalid);
  });
});

describe("P13 inflation_linked", () => {
  const linkage = (baseIndex: string, currentIndex: string) => evaluatePrimitive({
    primitiveId: "P13",
    input: { baseValue: money("4000"), baseIndex: decimal(baseIndex), currentIndex: decimal(currentIndex) },
    parameters: {
      baseDate: civilDate("2025-01-01"),
      indexIdentity: "synthetic-cpi-v1",
      divisionRounding: new RoundingPolicy(24, "half_even"),
    },
    priorState: null,
    context: context(),
  });

  it("links an exact value to explicit base and current indexes", () => {
    const result = linkage("100", "105");
    expect(result.output.value.amount.toString()).toBe("4200");
    expect(result.output.factor.toString()).toBe("1.05");
    expect(result.output).toMatchObject({ baseDate: "2025-01-01", indexIdentity: "synthetic-cpi-v1" });
  });

  it("preserves Quantity units", () => {
    const result = evaluatePrimitive({
      primitiveId: "P13",
      input: { baseValue: Quantity.parse("10", Unit.of("kilowatt_hour")), baseIndex: decimal("200"), currentIndex: decimal("210") },
      parameters: { baseDate: civilDate("2025-01-01"), indexIdentity: "energy-index", divisionRounding: new RoundingPolicy(20, "half_even") },
      priorState: null,
      context: context(),
    });
    expect(result.output.value.toJSON()).toEqual({ amount: "10.5", unit: "kilowatt_hour" });
  });

  it("rejects a zero base index and ambiguous index identity", () => {
    expect(diagnosticCode(() => linkage("0", "105"))).toBe(issueCodes.primitiveInputInvalid);
    expect(diagnosticCode(() => evaluatePrimitive({
      primitiveId: "P13",
      input: { baseValue: money("1"), baseIndex: decimal("1"), currentIndex: decimal("1") },
      parameters: { baseDate: civilDate("2025-01-01"), indexIdentity: " ", divisionRounding: new RoundingPolicy(10, "half_even") },
      priorState: null,
      context: context(),
    }))).toBe(issueCodes.primitiveParametersInvalid);
  });
});

describe("P20 tax_dependent and primitive composition", () => {
  const taxRule = Object.freeze({
    id: domainId("tax-rule", "44444444-4444-4444-8444-444444444444"),
    effectiveRate: Ratio.parse("0.20"),
    postingRounding: RoundingPolicy.currency(2, "half_even"),
  });

  it("reuses the proportional tax rule and reports exact rule identity", () => {
    const result = evaluatePrimitive({
      primitiveId: "P20",
      input: { taxableBase: money("10000"), resolvedRule: taxRule },
      priorState: null,
      context: context(),
    });
    expect(result.output.tax.amount.toString()).toBe("2000");
    expect(result.output.ruleId).toBe(taxRule.id);
    expect(result.effects).toEqual([]);
  });

  it("composes P06 constant into P03 monthly compensation", () => {
    const runtimeContext = context();
    const constant = evaluatePrimitive({ primitiveId: "P06", input: { value: money("10000") }, priorState: null, context: runtimeContext });
    const recurring = evaluatePrimitive({
      primitiveId: "P03",
      input: { amount: constant.output.value as ReturnType<typeof money> },
      parameters: { schedule: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" } },
      priorState: null,
      context: runtimeContext,
    });
    expect(recurring.output.aggregate?.amount.toString()).toBe("10000");
  });

  it("composes P08 growth into P03 and then P20 tax", () => {
    const runtimeContext = context();
    const growth = evaluatePrimitive({
      primitiveId: "P08",
      input: { initial: money("10000"), rate: Rate.fromDecimal("0", rateConvention.periodic(ratePeriod("1", "year"))) },
      parameters: { category: "recurring_occurrence_amount", timeBasis: { kind: "per_period", periods: 1 } },
      priorState: null,
      context: runtimeContext,
    });
    const recurring = evaluatePrimitive({
      primitiveId: "P03",
      input: { amount: growth.output.value },
      parameters: { schedule: { kind: "explicit_instants", instants: [instant("2026-01-15T00:00:00.000Z")] } },
      priorState: null,
      context: runtimeContext,
    });
    const tax = evaluatePrimitive({
      primitiveId: "P20",
      input: { taxableBase: recurring.output.aggregate!, resolvedRule: taxRule },
      priorState: null,
      context: runtimeContext,
    });
    expect(tax.output.tax.amount.toString()).toBe("2000");
  });

  it("rejects incompatible currency, unit, and value-type composition", () => {
    expect(diagnosticCode(() => assertPrimitiveFlowValuesCompatible(money("1"), money("1", Currency.of("EUR")))))
      .toBe(issueCodes.primitiveCompositionIncompatible);
    expect(diagnosticCode(() => assertPrimitiveFlowValuesCompatible(Quantity.parse("1", SHARE), Quantity.parse("1", Unit.of("bond")))))
      .toBe(issueCodes.primitiveCompositionIncompatible);
    expect(diagnosticCode(() => assertPrimitiveFlowValuesCompatible(money("1"), decimal("1"))))
      .toBe(issueCodes.primitiveCompositionIncompatible);
  });

  it("does not mutate unrelated authoritative-like state passed as excess context", () => {
    const accidentalState = Object.freeze({ cash: money("5000"), postedTransactions: Object.freeze([]) });
    const excessContext = Object.freeze({ ...context(), accidentalState }) as PrimitiveEvaluationContext;
    evaluatePrimitive({ primitiveId: "P20", input: { taxableBase: money("10000"), resolvedRule: taxRule }, priorState: null, context: excessContext });
    expect(accidentalState.cash.amount.toString()).toBe("5000");
    expect(accidentalState.postedTransactions).toEqual([]);
  });
});
