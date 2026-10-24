import { describe, expect, it } from "vitest";
import { compileHouseholdKernel, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../../src/simulation/period.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../../../../../src/simulation/run.js";
import { payrollContributionCandidate } from "../../../../../src/simulation/payrollContributions.js";
import { instant } from "../../../../../src/time/index.js";
import { USD } from "../../../../../src/values/index.js";
import { paycheckFixture, sourceStatus } from "./scenario.js";

describe("P2 portable original payroll evidence", () => {
  it("round-trips the immutable original proof through sparse checkpoints and rejects cold missing authority", () => {
    const f = paycheckFixture("portable");
    const paid = payrollContributionCandidate(f.opening, f.input);
    const context = createRunContext({ ...f.input.healthPremium.context, runId: runId("149c0000-0000-4000-8000-000000000001"),
      scenarioId: scenarioId("149c0000-0000-4000-8000-000000000002"), simulationStart: instant("2024-02-01T00:00:00.000Z"),
      simulationEnd: instant("2025-03-01T00:00:00.000Z"), baseCurrency: USD });
    const kernel = compileHouseholdKernel({ reconciledOpeningState: paid.state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
      executionMonths: 13, scenarioIdentity: context.scenarioId, scenarioBindings: {} }, context.simulationStart);
    const forecast = runHouseholdKernel({ kernel, runContext: context });
    const artifact = createPortableHouseholdReplayArtifact(forecast);
    const selected = forecast.periods.at(-1)!.period;
    for (let n = 0; n < 2; n++) {
      const cold = restorePortableHouseholdReplayArtifact({ ...artifact });
      expect(canonicalSerialize(replayHouseholdForecastWindow(cold, selected).state.d2PostedTransactions)).toBe(canonicalSerialize(paid.state.d2PostedTransactions));
    }
    sourceStatus.available = false;
    try { expect(() => restorePortableHouseholdReplayArtifact({ ...artifact })).toThrow("BASIS_MISMATCH"); }
    finally { sourceStatus.available = true; }
  });
});
