import { describe, expect, it } from "vitest";
import { normalizePersonalInput } from "../ui/forecast/PersonalInputNormalizer.js";
import { percentageToRate } from "../ui/entityPresentation.js";

describe("U1B exact, explicit normalization previews", () => {
  it("accepts unambiguous grouped cents and preserves large exact amounts", () => {
    expect(normalizePersonalInput(" $9,007,199,254,740,993.01 ", "money", "USD")).toMatchObject({ ok: true, canonical: "9007199254740993.01", unit: "USD" });
  });
  it("preserves percentage points and existing scaled-rate conversion", () => {
    const result = normalizePersonalInput(" 5.2500% ", "percent");
    expect(result).toMatchObject({ ok: true, canonical: "5.2500" });
    if (result.ok) expect(percentageToRate(result.canonical)).toBe("0.0525");
  });
  it.each(["1,23", "1.234,56", "$€100", "USD EUR 100", "1e3", "1.001", "1 000,00", "01.00"])('rejects ambiguous/overprecision money "%s"', text => {
    expect(normalizePersonalInput(text, "money", "USD").ok).toBe(false);
  });
  it("requires a matching known currency", () => {
    expect(normalizePersonalInput("€100", "money", "USD").ok).toBe(false);
    expect(normalizePersonalInput("$100", "money").ok).toBe(false);
  });
  it("accepts explicit months and unambiguous full dates without inventing a day", () => {
    expect(normalizePersonalInput("June 2026", "month")).toMatchObject({ canonical: "2026-06" });
    expect(normalizePersonalInput("06/2026", "month")).toMatchObject({ canonical: "2026-06" });
    expect(normalizePersonalInput("31/12/2026", "date")).toMatchObject({ canonical: "2026-12-31" });
    expect(normalizePersonalInput("12/31/2026", "date")).toMatchObject({ canonical: "2026-12-31" });
    expect(normalizePersonalInput("03/04/2026", "date").ok).toBe(false);
    expect(normalizePersonalInput("2026-02-29", "date").ok).toBe(false);
    expect(normalizePersonalInput("June 2026", "date").ok).toBe(false);
  });
});
