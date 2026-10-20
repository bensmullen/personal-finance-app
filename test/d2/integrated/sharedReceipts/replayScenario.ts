import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { applyD2SettlementAtomically, d2SettlementSourceFingerprint, type D2SettlementReceipt } from "../../../../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { admit, capturePostedJournals, card, context, fsa, ids, state } from "./scenario.js";
import { laterParticipant, laterReceipt } from "./laterParticipant.js";

const ordered = (receipt: D2SettlementReceipt, position: number): D2SettlementReceipt => {
  const executionOrder = { sequenceId: "independent-fixture-approved-sequence", position };
  if (receipt.kind === "fsa_paid_reimbursement") {
    const source = { ...receipt.source, executionOrder };
    return { ...receipt, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) };
  }
  const source = { ...receipt.source, executionOrder };
  return { ...receipt, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) };
};

export const loadIndependentReplaySources = () => {
  // These fixed fixtures stand in for an independent source store in each
  // process. No evidence is recovered from the artifact's purported receipts.
  for (let n = 0; n < 13; n++) capturePostedJournals(admit(ordered(fsa(`portable-fsa:${n}`), n)));
  capturePostedJournals(admit(ordered({ ...card("portable-card"), bankCashBefore: money("1500") }, 13)));
  capturePostedJournals(admit(laterReceipt()));
};
export const replayFixture = (withReceipts = true, months = 13, emptyReceipts = false, inHorizon = false) => {
  const opening = state("1500");
  if (emptyReceipts) opening.d2SettlementReceipts = {};
  if (withReceipts) {
    for (let n = 0; n < 13; n++) {
      const receipt = admit(ordered(fsa(`portable-fsa:${n}`), n));
      applyD2SettlementAtomically(opening, receipt, context); capturePostedJournals(receipt);
    }
    const receipt = admit(ordered({ ...card("portable-card"), bankCashBefore: opening.accounts[ids.bank]!.cash }, 13));
    applyD2SettlementAtomically(opening, receipt, context);
    capturePostedJournals(receipt);
  }
  const start = instant("2026-02-01T00:00:00.000Z");
  const runContext = createRunContext({ ...context, runId: runId("149b0000-0000-4000-8000-000000000001"),
    scenarioId: scenarioId("149b0000-0000-4000-8000-000000000002"), simulationStart: start,
    simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    ...(inHorizon ? { participants: [laterParticipant()] } : {}),
    scenarioIdentity: runContext.scenarioId, executionMonths: months,
    scenarioBindings: { synthetic: "#149 receipt persistence only; no FSA/card adapter or tax coverage" } }, start);
  return { opening, kernel, runContext };
};
