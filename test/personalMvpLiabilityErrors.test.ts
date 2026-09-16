import { describe, expect, it, vi } from "vitest";

describe("liability forecast engine errors", () => {
  it("preserves structured VS4 ValidationError issues instead of reducing them to a generic message", async () => {
    vi.resetModules();
    const { ValidationError, validationIssue } = await import("../src/diagnostics/index.js");
    const engineIssue = validationIssue({ severity: "error", code: "VS4_TEST_VALIDATION", message: "VS4 rejected the deliberately invalid execution state.", entityType: "vertical_slice_4", entityId: "test-engine-issue" });
    vi.doMock("../src/simulation/verticalSlice4.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/simulation/verticalSlice4.js")>()),
      runVerticalSlice4: () => { throw new ValidationError([engineIssue]); },
    }));
    const { createSyntheticPersonalDraft, runPersonalForecast } = await import("../src/application/index.js");
    const result = runPersonalForecast(createSyntheticPersonalDraft(), {
      scope: "liabilities", baseCurrency: "USD", asOf: "2026-01-01", dataCutoff: "2026-01-01",
      simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3,
      sameInstantCashFlowOrder: "income_before_expense",
      executionOwnerId: "90000000-0000-4000-8000-000000000003",
      liabilityExecutionProfiles: [{
        liabilityId: "90000000-0000-4000-8000-000000000008", kind: "vs4_fixed_monthly_fully_amortizing",
        paymentAnchor: "2022-02-01", totalPayments: 360,
        fundingAccountId: "90000000-0000-4000-8000-000000000004", settlementPriority: 1, openingContractStatus: "current",
      }],
    });
    expect(result.status).toBe("unavailable");
    expect(result.diagnostics).toContainEqual(engineIssue);
    if (result.status === "unavailable") expect(result.message).toContain(engineIssue.message);
  });
});
