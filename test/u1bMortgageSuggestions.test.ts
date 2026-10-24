import { describe, it, expect } from "vitest";
import { mortgagePaymentCount, mortgageFinalPaymentDate, mortgageRemainingSchedule } from "../src/application/compiler/liabilities.js";

describe("U1B compiler-owned loan schedule guidance", () => {
  it("distinguishes a seasoned loan's original count from remaining payments", () => {
    expect(mortgageRemainingSchedule("2022-02-01", "2052-01-01", "2026-01-01")).toEqual({ total: 360, remaining: 313, next: "2026-01-01" });
    expect(mortgageRemainingSchedule("2022-02-01", "2052-01-01", "2052-01-02")).toEqual({ total: 360, remaining: 0 });
  });
  it("reuses skip-invalid-day occurrences, including leap years", () => {
    const final = mortgageFinalPaymentDate("2024-01-31", "3")!;
    expect(final).toBe("2024-05-31");
    expect(mortgagePaymentCount("2024-01-31", final)).toBe("3");
    expect(mortgageRemainingSchedule("2024-01-31", final, "2024-03-01")).toEqual({ total: 3, remaining: 2, next: "2024-03-31" });
  });
  it.each([ ["2026-02-30", "2056-02-01"], ["2026-02-01", "2025-01-01"], ["2026-01-31", "2026-02-28"], ["2026-01-01", "2200-01-01"] ])("rejects contradictory, invalid or non-finite evidence %s/%s", (first, final) => {
    expect(mortgageRemainingSchedule(first, final, "2026-01-01")).toBeUndefined();
  });
});
