import { describe, expect, it } from "vitest";
import { domainId } from "../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../src/lineage/index.js";
import {
  evaluatePrimitive,
  initialCompoundingPrimitiveState,
  initialMarkToMarketPrimitiveState,
  type PrimitiveEvaluationContext,
} from "../src/primitives/index.js";
import { instant, utcMonth } from "../src/time/index.js";
import { Quantity, Rate, RoundingPolicy, SHARE, USD, Unit, money, rateConvention, ratePeriod } from "../src/values/index.js";

const trace = calculationTraceRef(calculationTraceId("trace:investment-primitives"));
const context = (): PrimitiveEvaluationContext => ({
  period: utcMonth(2026, 1),
  evaluationInstant: instant("2026-01-31T23:59:59.999Z"),
  scenarioId: domainId("scenario", "10000000-0000-4000-8000-000000000001"),
  primitiveInstanceId: domainId("primitive-instance", "10000000-0000-4000-8000-000000000002"),
  economicTargetId: domainId("position", "10000000-0000-4000-8000-000000000003"),
  semanticEffectType: "investment-test",
  traceRefs: [trace],
});
const monthly = Rate.fromDecimal("0.01", rateConvention.periodic(ratePeriod("1", "calendar_month")));
const rounding = RoundingPolicy.currency(2, "half_up");

describe("P23 compounding", () => {
  it("compounds deterministically while keeping contributions separate", () => {
    const request = (baseValue: ReturnType<typeof money>, priorState = initialCompoundingPrimitiveState()) => evaluatePrimitive({
      primitiveId: "P23",
      input: { baseValue, rate: monthly, contribution: money("10") },
      parameters: { returnBasis: { kind: "periodic", period: ratePeriod("1", "calendar_month") }, cashFlowTiming: "end_of_period" as const, postingRounding: rounding },
      priorState,
      context: context(),
    });
    const first = request(money("100"));
    expect(first.output.returnAmount.equals(money("1"))).toBe(true);
    expect(first.output.closingValue.equals(money("111"))).toBe(true);
    expect(first.output.contribution.equals(money("10"))).toBe(true);
    expect(first.effects).toEqual([]);
    expect(first.traceRefs).toEqual([trace]);
    const second = request(first.output.closingValue, first.nextState);
    expect(second.output.closingValue.equals(money("122.11"))).toBe(true);
    expect(second.nextState.evaluations).toBe(2);
    expect(request(money("100")).output).toEqual(first.output);
  });

  it("distinguishes beginning and end cash-flow timing and supports exact annual conversion", () => {
    const annual = Rate.fromDecimal("0.21", rateConvention.effectiveAnnual());
    const result = evaluatePrimitive({
      primitiveId: "P23",
      input: { baseValue: money("100"), rate: annual, contribution: money("100") },
      parameters: { returnBasis: { kind: "effective_annual", yearFraction: { numerator: 1, denominator: 2 }, calculationRounding: new RoundingPolicy(12, "half_even") }, cashFlowTiming: "beginning_of_period", postingRounding: rounding },
      priorState: initialCompoundingPrimitiveState(),
      context: context(),
    });
    expect(result.output.effectivePeriodReturn.toString()).toBe("0.1");
    expect(result.output.returnAmount.equals(money("20"))).toBe(true);
    expect(result.output.closingValue.equals(money("220"))).toBe(true);
  });

  it("requires a continued base value after the first evaluation", () => {
    const first = evaluatePrimitive({ primitiveId: "P23", input: { baseValue: money("100"), rate: monthly }, parameters: { returnBasis: { kind: "periodic", period: ratePeriod("1", "calendar_month") }, cashFlowTiming: "end_of_period", postingRounding: rounding }, priorState: initialCompoundingPrimitiveState(), context: context() });
    expect(() => evaluatePrimitive({ primitiveId: "P23", input: { baseValue: money("100"), rate: monthly }, parameters: { returnBasis: { kind: "periodic", period: ratePeriod("1", "calendar_month") }, cashFlowTiming: "end_of_period", postingRounding: rounding }, priorState: first.nextState, context: context() })).toThrow(/continue/);
  });
});

describe("P26 mark_to_market", () => {
  it("uses typed quantity times price with no cash or accounting effect", () => {
    const result = evaluatePrimitive({
      primitiveId: "P26",
      input: { quantity: Quantity.parse("12.5", SHARE), price: money("8") },
      parameters: { expectedUnit: SHARE, expectedCurrency: USD },
      priorState: initialMarkToMarketPrimitiveState(),
      context: context(),
    });
    expect(result.output.marketValue.equals(money("100"))).toBe(true);
    expect(result.effects).toEqual([]);
    expect(result.nextState).toMatchObject({ evaluations: 1, lastMarketValue: money("100") });
    expect(result.traceRefs).toEqual([trace]);
  });

  it("rejects a declared unit mismatch", () => {
    expect(() => evaluatePrimitive({
      primitiveId: "P26",
      input: { quantity: Quantity.parse("1", SHARE), price: money("1") },
      parameters: { expectedUnit: Unit.of("bond"), expectedCurrency: USD },
      priorState: initialMarkToMarketPrimitiveState(),
      context: context(),
    })).toThrow(/unit/);
  });

  it("permits changed authoritative quantity between valuation histories", () => {
    const first = evaluatePrimitive({ primitiveId: "P26", input: { quantity: Quantity.parse("1", SHARE), price: money("10") }, parameters: { expectedUnit: SHARE, expectedCurrency: USD }, priorState: initialMarkToMarketPrimitiveState(), context: context() });
    const second = evaluatePrimitive({ primitiveId: "P26", input: { quantity: Quantity.parse("2", SHARE), price: money("10") }, parameters: { expectedUnit: SHARE, expectedCurrency: USD }, priorState: first.nextState, context: context() });
    expect(second.output.marketValue.equals(money("20"))).toBe(true);
  });
});
