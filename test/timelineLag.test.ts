import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { assertPeriodWorkPlan, type DiagnosticPeriodWork } from "../src/simulation/index.js";

const diagnosticWork = (lag: number): DiagnosticPeriodWork => ({
  kind: "diagnostic",
  id: "diagnostic:lag-validation",
  lag,
  diagnostics: [],
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

describe("period work dependency lag validation", () => {
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid lag %s before dependency execution or fingerprinting",
    (lag) => {
      expect(validationCode(() => assertPeriodWorkPlan([diagnosticWork(lag)])))
        .toBe(issueCodes.timelineWorkInvalid);
    },
  );

  it.each([0, 1, Number.MAX_SAFE_INTEGER])("accepts non-negative safe integer lag %s", (lag) => {
    expect(() => assertPeriodWorkPlan([diagnosticWork(lag)])).not.toThrow();
  });
});
