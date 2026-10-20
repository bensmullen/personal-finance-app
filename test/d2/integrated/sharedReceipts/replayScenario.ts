import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { applyD2SettlementAtomically } from "../../../../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { admit, capturePostedJournals, card, context, fsa, ids, state } from "./scenario.js";

export const loadIndependentReplaySources = () => {
  // These fixed fixtures stand in for an independent source store in each
  // process. No evidence is recovered from the artifact's purported receipts.
  for (let n = 0; n < 13; n++) capturePostedJournals(admit(fsa(`portable-fsa:${n}`)));
  capturePostedJournals(admit({ ...card("portable-card"), bankCashBefore: money("1500") }));
};
export const replayFixture = (withReceipts = true, months = 13, emptyReceipts = false) => {
  const opening = state("1500");
  if (emptyReceipts) opening.d2SettlementReceipts = {};
  if (withReceipts) {
    for (let n = 0; n < 13; n++) {
      const receipt = admit(fsa(`portable-fsa:${n}`));
      applyD2SettlementAtomically(opening, receipt, context); capturePostedJournals(receipt);
    }
    const receipt = admit({ ...card("portable-card"), bankCashBefore: opening.accounts[ids.bank]!.cash });
    applyD2SettlementAtomically(opening, receipt, context);
    capturePostedJournals(receipt);
  }
  const start = instant("2026-02-01T00:00:00.000Z");
  const runContext = createRunContext({ ...context, runId: runId("149b0000-0000-4000-8000-000000000001"),
    scenarioId: scenarioId("149b0000-0000-4000-8000-000000000002"), simulationStart: start,
    simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: runContext.scenarioId, executionMonths: months,
    scenarioBindings: { synthetic: "#149 receipt persistence only; no FSA/card adapter or tax coverage" } }, start);
  return { opening, kernel, runContext };
};
