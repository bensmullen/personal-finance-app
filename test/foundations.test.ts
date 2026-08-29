import { describe, expect, it } from "vitest";
import { domainId, generatedOccurrenceKey, idempotencyKey, uuid } from "../src/identity.js";
import {
  DayCountConvention,
  civilDate,
  durationBetween,
  inPeriod,
  instant,
  utcMonth,
  yearFraction,
} from "../src/time.js";
import {
  Currency,
  Percentage,
  Quantity,
  Rate,
  RoundingPolicy,
  SHARE,
  USD,
  Unit,
  decimal,
  formatMoney,
  money,
  rateConvention,
  ratePeriod,
  type RoundingMode,
} from "../src/values.js";

describe("canonical exact values", () => {
  it("preserves exact arbitrary-scale decimal vectors without binary floating point", () => {
    expect(decimal("9007199254740993.123456789").plus(decimal("0.000000001")).toString())
      .toBe("9007199254740993.12345679");
    expect(decimal("1.005").round(new RoundingPolicy(2, "half_up")).toFixed(new RoundingPolicy(2, "half_up")))
      .toBe("1.01");
    expect(decimal("1.005").round(new RoundingPolicy(2, "half_even")).toFixed(new RoundingPolicy(2, "half_even")))
      .toBe("1.00");
  });

  it.each<[RoundingMode, string, string]>([
    ["half_up", "3", "-3"], ["half_even", "2", "-2"], ["toward_zero", "2", "-2"],
    ["away_from_zero", "3", "-3"], ["floor", "2", "-3"], ["ceiling", "3", "-2"],
  ])("applies %s rounding symmetrically where appropriate", (mode, positive, negative) => {
    const policy = new RoundingPolicy(0, mode);
    expect(decimal("2.5").round(policy).toString()).toBe(positive);
    expect(decimal("-2.5").round(policy).toString()).toBe(negative);
  });

  it("requires an explicit division policy", () => {
    expect(decimal("1").dividedBy(decimal("3"), new RoundingPolicy(8, "half_even")).toString())
      .toBe("0.33333333");
  });

  it("models signed rates with complete convention metadata", () => {
    expect(JSON.stringify(Rate.fromPercentage("-6.25", rateConvention.nominalAnnual(12))))
      .toBe('{"value":"-0.0625","convention":{"basis":"nominal_annual","compoundingPeriodsPerYear":12}}');
    expect(JSON.stringify(Rate.fromDecimal("0.01", rateConvention.periodic(ratePeriod("3", "calendar_month")))))
      .toBe('{"value":"0.01","convention":{"basis":"periodic","period":{"count":"3","unit":"calendar_month"}}}');
    expect(() => rateConvention.nominalAnnual(0)).toThrow(/positive integer compounding frequency/);
    expect(() => ratePeriod("0", "day")).toThrow(/positive/);
  });

  it("converts percentages and basis points exactly at arbitrary scale", () => {
    const convention = rateConvention.effectiveAnnual();
    expect(Percentage.parse("12.345678901234567890123456789").toRatio().value.toString())
      .toBe("0.12345678901234567890123456789");
    expect(Rate.fromBasisPoints("123.45678901234567890123456789", convention).value.toString())
      .toBe("0.012345678901234567890123456789");
  });

  it("uses authoritative metadata for supported currencies", () => {
    expect(Currency.of("JPY").minorUnitScale).toBe(0);
    expect(Currency.of("KWD").minorUnitScale).toBe(3);
    expect(Currency.of("USD").equals(USD)).toBe(true);
    expect(() => Currency.of("ZZZ")).toThrow(/Unsupported currency code/);
  });

  it("makes display rounding explicit", () => {
    expect(formatMoney(money("1.005"), RoundingPolicy.currency(2, "half_even"))).toBe("$1.00");
    expect(formatMoney(money("1.005"), RoundingPolicy.currency(2, "half_up"))).toBe("$1.01");
  });

  it("rejects currency and unit mixing", () => {
    const eur = Currency.of("EUR");
    expect(() => money("1", USD).plus(money("1", eur))).toThrow(/Currency mismatch/);
    expect(() => Quantity.parse("1", SHARE).plus(Quantity.parse("1", Unit.of("bond"))))
      .toThrow(/Unit mismatch/);
  });
});

describe("canonical time", () => {
  it("validates civil dates and keeps periods half-open", () => {
    expect(civilDate("2028-02-29")).toBe("2028-02-29");
    expect(() => civilDate("2027-02-29")).toThrow(/Invalid civil date/);
    expect(() => instant("2026-13-01T00:00:00.000Z")).toThrow(/Invalid UTC instant/);
    const january = utcMonth(2026, 1);
    expect(inPeriod(instant("2026-01-01T00:00:00.000Z"), january)).toBe(true);
    expect(inPeriod(instant("2026-02-01T00:00:00.000Z"), january)).toBe(false);
  });

  it("makes the UTC-only month contract explicit and avoids Date.UTC year coercion", () => {
    expect(utcMonth(2026, 12)).toEqual({ start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });
    expect(() => utcMonth(99, 1)).toThrow(/0100 through 9998/);
  });

  it("represents signed civil-date durations exactly", () => {
    expect(durationBetween(civilDate("2024-02-28"), civilDate("2024-03-01")).toJSON()).toEqual({ days: "2" });
    expect(durationBetween(civilDate("2024-03-01"), civilDate("2024-02-28")).toJSON()).toEqual({ days: "-2" });
  });

  it.each([
    [DayCountConvention.ActualActualISDA, "2024-01-01", "2024-07-01", "0.4972677596"],
    [DayCountConvention.ActualActualISDA, "2023-07-01", "2024-07-01", "1.0013773486"],
    [DayCountConvention.Actual365Fixed, "2024-01-01", "2024-07-01", "0.498630137"],
    [DayCountConvention.Actual360, "2026-01-01", "2026-01-31", "0.0833333333"],
    [DayCountConvention.ThirtyE360, "2026-01-31", "2026-03-31", "0.1666666667"],
  ] as const)("computes %s year-fraction vectors", (convention, start, end, expected) => {
    expect(yearFraction(civilDate(start), civilDate(end), convention, new RoundingPolicy(10, "half_up")).value.toString())
      .toBe(expected);
  });

  it("rejects a reversed year-fraction interval", () => {
    expect(() => yearFraction(civilDate("2026-02-01"), civilDate("2026-01-01"), DayCountConvention.Actual365Fixed, new RoundingPolicy(10, "half_up")))
      .toThrow(/must not precede/);
  });
});

describe("canonical identity", () => {
  it("produces stable generated-occurrence and import-idempotency vectors", () => {
    const scenarioId = domainId("scenario", "11111111-1111-4111-8111-111111111111");
    const primitiveInstanceId = domainId("primitive-instance", "22222222-2222-4222-8222-222222222222");
    const economicTargetId = uuid("33333333-3333-4333-8333-333333333333");
    const key = generatedOccurrenceKey({ scenarioId, primitiveInstanceId, scheduledAt: instant("2026-01-31T12:00:00.000Z"), semanticEffectType: "recognition", economicTargetId });
    expect(key).toBe("occurrence:v1:36:11111111-1111-4111-8111-111111111111:36:22222222-2222-4222-8222-222222222222:24:2026-01-31T12:00:00.000Z:11:recognition:36:33333333-3333-4333-8333-333333333333");
    expect(idempotencyKey("bank", "abc:123")).toBe("idempotency:v1:4:bank:7:abc:123");
  });
});
