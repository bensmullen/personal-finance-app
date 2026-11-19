import { describe, expect, it } from "vitest";
import { isOwnedHouseholdCallbackParticipant, registerHouseholdCallbackOwner } from "../../../../../src/state/index.js";
import { applyHouseholdExecutionOverlay, observeHouseholdForecastSources, runHouseholdForecastSummary,
  type HouseholdKernelParticipant } from "../../../../../src/simulation/householdExecution.js";
import { portableHouseholdParticipant, restoreHouseholdParticipant } from "../../../../../src/simulation/r3/participantCodec.js";
import "../../../../../src/simulation/tax/replayCodec.js";
import { createHouseholdTaxParticipant } from "../../../../../src/simulation/tax/participant.js";
import { money } from "../../../../../src/values/index.js";
import { taxHouseholdFixture, taxHouseholdIds } from "../../../../fixtures/t1aTaxHouseholds.js";
import { attachMedicareBank } from "../../../../../src/simulation/d2/integration/medicareBank/index.js";
import { createHelocDrawParticipant } from "../../../../../src/simulation/d2/integration/helocDraws/index.js";
import { createRetirementCashParticipant } from "../../../../../src/simulation/d2/integration/retirementCash/index.js";
import { fixture as medicareFixture, input as medicareInput } from "../../medicareBank/scenario.js";
import { fixture as retirementFixture, input as retirementInput } from "../../retirementCash/scenario.js";
import { funded } from "../../retirementCash/fundedScenario.js";
import { fixture as premiumFixture, install as installPremiumSources } from "../../householdBankCardAftertax/scenario.js";

installPremiumSources();

function check(participant: HouseholdKernelParticipant): void {
  expect(Object.isFrozen(participant)).toBe(true);
  expect(isOwnedHouseholdCallbackParticipant(participant)).toBe(true);
  // Even an exact callback/configuration copy is outside the factory WeakSet.
  expect(isOwnedHouseholdCallbackParticipant(Object.freeze({ ...participant }))).toBe(false);
  expect(isOwnedHouseholdCallbackParticipant(Object.freeze({ ...participant,
    prepare: () => ({ id: participant.id, operations: [] }), observe: (_d, _f, runtime) => runtime,
  } satisfies HouseholdKernelParticipant))).toBe(false);
  const restored = restoreHouseholdParticipant(portableHouseholdParticipant(participant));
  expect(restored).not.toBe(participant);
  expect(isOwnedHouseholdCallbackParticipant(restored)).toBe(true);
  expect(isOwnedHouseholdCallbackParticipant({ ...restored })).toBe(false);
}

describe("built-in callback object ownership", () => {
  it("owns direct and restored Medicare and aftertax guards, including inactive guards", () => {
    const f = medicareFixture(2);
    const attached = attachMedicareBank(medicareInput(undefined, f.kernel));
    const guard = attached.kernel.executable.participants!.find(p => p.portableCodec === "d2-medicare-bank/v1")!;
    check(guard);
    const premiums = premiumFixture({ card: false, premium: true });
    check(premiums.kernel.executable.participants!.find(p => p.portableCodec === "d2-aftertax-source/v1")!);
  });

  it("owns only exact direct and restored draw-factory outputs", () => {
    const { householdId } = retirementInput().withdrawals;
    const personId = retirementInput().members[0]!.personId;
    check(createHelocDrawParticipant({ householdId, personId, quotes: [] }));
  });

  it("owns retirement inline v1, historical schedule v2 and referenced v3 outputs", () => {
    const f = retirementFixture();
    check(createRetirementCashParticipant(retirementInput(f)));
    const plan = funded(f, "348-ownership"), horizon = plan.reference.horizon;
    const historical = { id: "d2_retirement_cash", version: "funded-account-rmd/v2", codec: "d2-retirement-cash/v2",
      economicInputs: { plans: [plan.cash], annualSource: plan.reference, horizon } };
    check(restoreHouseholdParticipant(historical));
    check(restoreHouseholdParticipant({ id: "d2_retirement_cash", version: "funded-account-rmd/v1",
      codec: "d2-retirement-cash/v1", economicInputs: plan.cash }));
    check(createRetirementCashParticipant(plan.cash));
  });

  it("owns direct and restored v1 and v2 tax factories by object identity", () => {
    const { input, kernel } = taxHouseholdFixture();
    const v1 = kernel.executable.participants![0]!;
    const { filingStatus: _fixedStatus, ...annualInput } = input;
    const v2 = createHouseholdTaxParticipant({ ...annualInput, filingStatuses: {
      "2024": { status: "known", taxYear: "2024", householdId: String(input.ownerId), value: "single", sources: [] },
    } });
    for (const [participant, codec] of [[v1, "household-tax/v1"], [v2, "household-tax/v2"]] as const) {
      expect(participant.portableCodec).toBe(codec);
      expect(isOwnedHouseholdCallbackParticipant({ id: participant.id, portableCodec: codec })).toBe(false);
      check(participant);
    }
  });

  it.each([false, true])("keeps no-election wages with an independent employer=%s", employerOriginal => {
    const { kernel, context, original } = taxHouseholdFixture({ employerOriginal, amount: "1000" });
    if (original) original.source.mode = "available";
    try {
      const forecast = runHouseholdForecastSummary({ kernel, runContext: context });
      expect(forecast.periods).toHaveLength(1);
      expect(forecast.state.accounts[taxHouseholdIds.cash]!.cash).toEqual(money("1000"));
      expect(Object.keys(forecast.state.d2PostedTransactions ?? {})).toHaveLength(employerOriginal ? 1 : 0);
      if (original) {
        original.source.mode = "withdrawn";
        expect(() => observeHouseholdForecastSources(forecast)).toThrow();
      }
    } finally {
      if (original) original.source.mode = "available";
    }
  });

  it("reobserves a signed wage before a lookalike tax prepare callback", () => {
    const { kernel, context, original } = taxHouseholdFixture({ employerOriginal: true });
    const tax = kernel.executable.participants![0]!;
    original!.source.mode = "available";
    let prepared = false;
    const fake: HouseholdKernelParticipant = { ...tax, prepare: (...args) => {
      prepared = true;
      return tax.prepare(...args);
    } };
    const completed = runHouseholdForecastSummary({ kernel, runContext: context });
    const reusingOpening = applyHouseholdExecutionOverlay(kernel, { reconciledOpeningState: completed.state, participants: [fake] });
    original!.source.mode = "withdrawn";
    try {
      expect(() => runHouseholdForecastSummary({ kernel: reusingOpening, runContext: context })).toThrow();
      expect(prepared).toBe(false);
    } finally {
      original!.source.mode = "available";
    }
  });

  it("rejects replacement predicates and never grants ownership from an ID", () => {
    for (const owner of ["medicare_bank", "aftertax_premiums", "retirement_cash", "heloc_draws", "tax"] as const)
      expect(() => registerHouseholdCallbackOwner(owner, () => true)).toThrow(/HOUSEHOLD_CALLBACK_OWNER/);
    expect(isOwnedHouseholdCallbackParticipant({ id: "d2_retirement_cash", portableCodec: "d2-retirement-cash/v3" })).toBe(false);
  });
});
