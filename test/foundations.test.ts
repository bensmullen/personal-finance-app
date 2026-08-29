import { describe, expect, it } from "vitest";
import { domainId, generatedOccurrenceKey, idempotencyKey, uuid } from "../src/identity.js";
import { civilDate, inPeriod, instant, month } from "../src/time.js";
import {
  Currency,
  Quantity,
  Rate,
  RateBasis,
  RoundingPolicy,
  SHARE,
  USD,
  Unit,
  decimal,
  money,
} from "../src/values.js";

describe("canonical exact values", () => {
  it("preserves exact arbitrary-scale decimal vectors without binary floating point", () => {
    expect(decimal("9007199254740993.123456789").plus(decimal("0.000000001")).toString())
      .toBe("9007199254740993.12345679");
    expect(decimal("1.005").round(new RoundingPolicy(2, "half_up")).toFixed(new RoundingPolicy(2, "half_up")))
      .toBe("1.01");
    expect(decimal("1.005").round(new RoundingPolicy(2, "half_even")).toFixed(new RoundingPolicy(2, "half_even")))
      .toBe("1.00");
    expect(decimal("-1.005").round(new RoundingPolicy(2, "half_up")).toString()).toBe("-1.01");
  });

  it("serializes money and rates with decimal strings and explicit metadata", () => {
    expect(JSON.stringify(money("12345.6700"))).toBe('{"amount":"12345.67","currency":"USD"}');
    expect(JSON.stringify(Rate.fromPercentage("6.25", RateBasis.NominalAnnual)))
      .toBe('{"value":"0.0625","basis":"nominal_annual"}');
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
    const january = month(2026, 1);
    expect(inPeriod(instant("2026-01-01T00:00:00.000Z"), january)).toBe(true);
    expect(inPeriod(instant("2026-02-01T00:00:00.000Z"), january)).toBe(false);
  });
});

describe("canonical identity", () => {
  it("produces stable generated-occurrence and import-idempotency vectors", () => {
    const scenarioId = domainId("scenario", "11111111-1111-4111-8111-111111111111");
    const primitiveInstanceId = domainId("primitive-instance", "22222222-2222-4222-8222-222222222222");
    const economicTargetId = uuid("33333333-3333-4333-8333-333333333333");
    const key = generatedOccurrenceKey({
      scenarioId,
      primitiveInstanceId,
      scheduledAt: instant("2026-01-31T12:00:00.000Z"),
      semanticEffectType: "recognition",
      economicTargetId,
    });
    expect(key).toBe(
      "occurrence:v1:36:11111111-1111-4111-8111-111111111111:36:22222222-2222-4222-8222-222222222222:24:2026-01-31T12:00:00.000Z:11:recognition:36:33333333-3333-4333-8333-333333333333",
    );
    expect(idempotencyKey("bank", "abc:123")).toBe("idempotency:v1:4:bank:7:abc:123");
  });
});
