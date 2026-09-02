import { describe, expect, it } from "vitest";
import { domainId } from "../src/identity/index.js";
import { evaluatePrimitive, initialAccrualPrimitiveState, initialAmortizationPrimitiveState, type PrimitiveEvaluationContext } from "../src/primitives/index.js";
import { instant, period, utcMonth } from "../src/time/index.js";
import { Rate, RoundingPolicy, money, rateConvention } from "../src/values/index.js";

const annual = (value: string) => Rate.fromDecimal(value, rateConvention.nominalAnnual(12));
const rounding = RoundingPolicy.currency(2, "half_up");
const context = (): PrimitiveEvaluationContext => ({
  period: utcMonth(2026, 1), evaluationInstant: instant("2026-01-15T00:00:00.000Z"),
  scenarioId: domainId("scenario", "61000000-0000-4000-8000-000000000001"),
  primitiveInstanceId: domainId("primitive-instance", "61000000-0000-4000-8000-000000000002"),
  economicTargetId: domainId("liability", "61000000-0000-4000-8000-000000000003"), semanticEffectType: "liability-test",
});

describe("P22 amortization", () => {
  it("uses the fixed-rate formula and preserves the contractual payment", () => {
    const first = evaluatePrimitive({ primitiveId: "P22", input: { openingPrincipal: money("300000"), currentInterest: money("1500") }, parameters: { originalPrincipal: money("300000"), annualRate: annual("0.06"), totalPayments: 360, postingRounding: rounding }, priorState: initialAmortizationPrimitiveState(), context: context() });
    expect(first.output.contractualPayment.equals(money("1798.65"))).toBe(true);
    expect(first.output.scheduledPrincipalProposed.equals(money("298.65"))).toBe(true);
    expect(first.output.projectedPrincipalAfterProposedPayment.equals(money("299701.35"))).toBe(true);
    const secondInterest = money("1498.51");
    const second = evaluatePrimitive({ primitiveId: "P22", input: { openingPrincipal: money("299701.35"), currentInterest: secondInterest, extraPrincipal: money("100") }, parameters: { originalPrincipal: money("300000"), annualRate: annual("0.06"), totalPayments: 360, postingRounding: rounding }, priorState: first.nextState, context: context() });
    expect(second.output.contractualPayment.equals(first.output.contractualPayment)).toBe(true);
    expect(second.output.extraPrincipalProposed.equals(money("100"))).toBe(true);
  });

  it("handles zero rate and adjusts the final rounded payment to exact payoff", () => {
    let state = initialAmortizationPrimitiveState(); let balance = money("10000");
    for (let index = 0; index < 12; index += 1) { const result = evaluatePrimitive({ primitiveId: "P22", input: { openingPrincipal: balance, currentInterest: money("0") }, parameters: { originalPrincipal: money("10000"), annualRate: annual("0"), totalPayments: 12, postingRounding: rounding }, priorState: state, context: context() }); if (index === 0) expect(result.output.contractualPayment.equals(money("833.33"))).toBe(true); balance = result.output.projectedPrincipalAfterProposedPayment; state = result.nextState; }
    expect(balance.equals(money("0"))).toBe(true);
  });

  it("caps principal at payoff and rejects unsupported rate conventions", () => {
    const capped = evaluatePrimitive({ primitiveId: "P22", input: { openingPrincipal: money("10"), currentInterest: money("0.05"), extraPrincipal: money("1000") }, parameters: { originalPrincipal: money("300000"), annualRate: annual("0.06"), totalPayments: 360, postingRounding: rounding }, priorState: initialAmortizationPrimitiveState(), context: context() });
    expect(capped.output.projectedPrincipalAfterProposedPayment.equals(money("0"))).toBe(true);
    expect(capped.output.principalReductionProposed.equals(money("10"))).toBe(true);
    const unsupported = Rate.fromDecimal("0.06", rateConvention.effectiveAnnual());
    expect(() => evaluatePrimitive({ primitiveId: "P22", input: { openingPrincipal: money("100"), currentInterest: money("0.5") }, parameters: { originalPrincipal: money("100"), annualRate: unsupported, totalPayments: 12, postingRounding: rounding }, priorState: initialAmortizationPrimitiveState(), context: context() })).toThrow(/nominal-annual monthly/);
  });

  it("rejects an evaluation after the contractual payment count", () => {
    const finalState = { evaluations: 1, contractualPayment: money("100"), originalPrincipal: money("100"), totalPayments: 1 };
    expect(() => evaluatePrimitive({ primitiveId: "P22", input: { openingPrincipal: money("100"), currentInterest: money("0") }, parameters: { originalPrincipal: money("100"), annualRate: annual("0"), totalPayments: 1, postingRounding: rounding }, priorState: finalState, context: context() })).toThrow(/cannot evaluate beyond/);
    expect(() => evaluatePrimitive({ primitiveId: "P22", input: { openingPrincipal: money("100"), currentInterest: money("0") }, parameters: { originalPrincipal: money("100"), annualRate: annual("0"), totalPayments: 1, postingRounding: rounding }, priorState: { ...finalState, evaluations: 2 }, context: context() })).toThrow(/cannot evaluate beyond/);
  });
});

describe("P24 accrual", () => {
  it("accrues exact monthly interest from opening principal without capitalization", () => {
    const result = evaluatePrimitive({ primitiveId: "P24", input: { balance: money("300000"), rate: annual("0.06") }, parameters: { temporal: { measurement: "occurrence_based", contractualPeriod: "monthly", rateBasis: "nominal_annual_12", calendar: "utc", stubPeriodPolicy: "reject", dayCountConvention: "none", capitalization: "none" }, postingRounding: rounding }, priorState: initialAccrualPrimitiveState(), context: context() });
    expect(result.output.accruedAmount.equals(money("1500"))).toBe(true);
    expect(result.output.capitalizedAmount.equals(money("0"))).toBe(true);
    expect(result.output.baseBalance.equals(money("300000"))).toBe(true);
    expect(result.effects).toEqual([]);
  });

  it("returns zero accrual for zero balance", () => {
    const result = evaluatePrimitive({ primitiveId: "P24", input: { balance: money("0"), rate: annual("0.06") }, parameters: { temporal: { measurement: "occurrence_based", contractualPeriod: "monthly", rateBasis: "nominal_annual_12", calendar: "utc", stubPeriodPolicy: "reject", dayCountConvention: "none", capitalization: "none" }, postingRounding: rounding }, priorState: initialAccrualPrimitiveState(), context: context() });
    expect(result.output.accruedAmount.equals(money("0"))).toBe(true);
  });

  it("rejects stub periods instead of inferring proration or day count", () => {
    const stubContext = { ...context(), period: period(instant("2026-01-01T00:00:00.000Z"), instant("2026-01-20T00:00:00.000Z")) };
    expect(() => evaluatePrimitive({ primitiveId: "P24", input: { balance: money("300000"), rate: annual("0.06") }, parameters: { temporal: { measurement: "occurrence_based", contractualPeriod: "monthly", rateBasis: "nominal_annual_12", calendar: "utc", stubPeriodPolicy: "reject", dayCountConvention: "none", capitalization: "none" }, postingRounding: rounding }, priorState: initialAccrualPrimitiveState(), context: stubContext })).toThrow(/stub or partial periods/);
  });

  it("rejects noncanonical temporal measurement modes", () => {
    const temporal = { measurement: "period_based" as unknown as "occurrence_based", contractualPeriod: "monthly" as const, rateBasis: "nominal_annual_12" as const, calendar: "utc" as const, stubPeriodPolicy: "reject" as const, dayCountConvention: "none" as const, capitalization: "none" as const };
    expect(() => evaluatePrimitive({ primitiveId: "P24", input: { balance: money("100"), rate: annual("0.06") }, parameters: { temporal, postingRounding: rounding }, priorState: initialAccrualPrimitiveState(), context: context() })).toThrow(/occurrence-based/);
  });
});
