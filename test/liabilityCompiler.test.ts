import { describe, expect, it } from "vitest";
import {
  compileLiabilities,
  type LiabilityExecutionProfile,
} from "../src/application/compiler/index.js";
import {
  createSyntheticPersonalDraft,
  runPersonalForecast,
  type PersonalDraft,
} from "../src/application/index.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../src/lineage/index.js";
import { fixedMortgagePayment, fixedMortgagePrincipalAfterPayments } from "../src/rules/index.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import {
  runVerticalSlice4,
  type FixedAmortizingLoan,
  type VerticalSlice4Input,
} from "../src/simulation/verticalSlice4.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant } from "../src/time/index.js";
import { Currency, Rate, RoundingPolicy, money, rateConvention } from "../src/values/index.js";

const ids = {
  household: "90000000-0000-4000-8000-000000000002",
  person: "90000000-0000-4000-8000-000000000003",
  account: "90000000-0000-4000-8000-000000000004",
  liability: "90000000-0000-4000-8000-000000000008",
  scenario: "90000000-0000-4000-8000-000000000011",
};

const profile = (
  changes: Partial<LiabilityExecutionProfile> = {},
): LiabilityExecutionProfile => ({
  liabilityId: ids.liability,
  kind: "vs4_fixed_monthly_fully_amortizing",
  paymentAnchor: "2022-02-01",
  totalPayments: 360,
  fundingAccountId: ids.account,
  settlementPriority: 1,
  openingContractStatus: "current",
  ...changes,
});

const compilerRequest = (
  executionProfiles: readonly LiabilityExecutionProfile[] = [profile()],
) => ({
  baseCurrency: "USD",
  asOf: "2026-01-01",
  simulationStart: "2026-01-01",
  simulationEnd: "2026-04-01",
  months: 3,
  executionOwnerId: ids.person,
  executionProfiles,
});

const mutable = (draft = createSyntheticPersonalDraft()) =>
  structuredClone(draft) as unknown as {
    modelFormatVersion: string;
    financialSpecificationVersion: string;
    modelId: PersonalDraft["modelId"];
    objects: Record<string, Record<string, unknown>[]>;
  };

const modelWith = (change: (draft: ReturnType<typeof mutable>) => void): PersonalDraft => {
  const draft = mutable();
  change(draft);
  return draft as unknown as PersonalDraft;
};

const context = () => createRunContext({
  runId: runId("96000000-0000-4000-8000-000000000001"),
  scenarioId: scenarioId(ids.scenario),
  asOf: instant("2026-01-01T00:00:00.000Z"),
  dataCutoff: instant("2026-01-01T00:00:00.000Z"),
  simulationStart: instant("2026-01-01T00:00:00.000Z"),
  simulationEnd: instant("2026-04-01T00:00:00.000Z"),
  baseCurrency: Currency.of("USD"),
});

describe("canonical liability compiler", () => {
  it("is financially equivalent to an independently authored direct VS4 mortgage", () => {
    const compiled = compileLiabilities(createSyntheticPersonalDraft(), compilerRequest());
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("fixture did not compile");
    const compiledRun = runVerticalSlice4({
      runContext: context(),
      input: compiled.value.input,
      openingState: compiled.value.openingState,
      primitiveState: compiled.value.primitiveState,
      months: 3,
    });

    const currency = Currency.of("USD");
    const cashId = domainId("account", "96000000-0000-4000-8000-000000000003");
    const principalId = domainId("liability", "96000000-0000-4000-8000-000000000004");
    const interestId = domainId("liability", "96000000-0000-4000-8000-000000000005");
    const loanId = domainId("loan-contract", "96000000-0000-4000-8000-000000000006");
    const scheduleId = domainId("primitive-instance", "96000000-0000-4000-8000-000000000007");
    const amortizationId = domainId("primitive-instance", "96000000-0000-4000-8000-000000000008");
    const accrualId = domainId("primitive-instance", "96000000-0000-4000-8000-000000000009");
    const original = money("240000", currency);
    const annualRate = Rate.fromDecimal("0.0525", rateConvention.nominalAnnual(12));
    const rounding = RoundingPolicy.currency(2, "half_up");
    const directLoan: FixedAmortizingLoan = {
      id: loanId,
      ownerId: domainId("household", ids.household),
      principalLiabilityId: principalId,
      interestPayableLiabilityId: interestId,
      originalPrincipal: original,
      annualRate,
      totalPayments: 360,
      rateType: "fixed",
      paymentFrequency: "monthly",
      interestConvention: "nominal_annual_12",
      amortization: "fully_amortizing",
      paymentResetPolicy: "fixed_no_recast",
      interestCapitalization: "none",
      partialPaymentPolicy: "all_or_nothing",
      paymentSchedule: { kind: "utc_monthly", anchor: instant("2022-02-01T00:00:00.000Z"), invalidDayPolicy: "skip" },
      fundingPolicy: createFundingPolicy({ id: fundingPolicyId("direct"), orderedSources: [{ kind: "cash_account", accountId: cashId }], allowPartial: false, insufficientFundsBehavior: "unfunded" }),
      settlementPriority: 1,
      postingRounding: rounding,
      primitiveIds: { schedule: scheduleId, amortization: amortizationId, accrual: accrualId },
      sourceTraceRefs: [calculationTraceRef(calculationTraceId("direct:liability"))],
    };
    const directInput: VerticalSlice4Input = {
      householdId: domainId("household", ids.household),
      ownerId: domainId("person", ids.person),
      baseCurrency: currency,
      loans: [directLoan],
    };
    const directRun = runVerticalSlice4({
      runContext: context(),
      input: directInput,
      openingState: createAuthoritativeState({
        accounts: { [cashId]: { id: cashId, ownerId: directInput.ownerId, kind: "checking", cash: money("5000", currency) } },
        liabilities: { [principalId]: { id: principalId, balance: fixedMortgagePrincipalAfterPayments(original, annualRate, 360, 47, rounding) }, [interestId]: { id: interestId, balance: money("0", currency) } },
      }),
      primitiveState: createPrimitiveRuntimeStateStore({
        [amortizationId]: { primitiveId: "P22", state: { evaluations: 47, contractualPayment: fixedMortgagePayment(original, annualRate, 360, rounding), originalPrincipal: original, totalPayments: 360 } },
        [accrualId]: { primitiveId: "P24", state: { evaluations: 47 } },
      }),
      months: 3,
    });
    const financials = (result: typeof compiledRun) => result.periods.map((period) => period.liabilities.map((item) => ({
      contractualPayment: item.contractualPayment.amount.toString(),
      interest: item.currentInterest.amount.toString(),
      principal: item.scheduledPrincipalPaid.amount.toString(),
      ending: item.endingPrincipal.amount.toString(),
      funding: item.scheduledFundingStatus,
    })));
    expect(financials(compiledRun)).toEqual(financials(directRun));
  });

  it("seeds resumed P22/P24 progress and preserves canonical trace identity", () => {
    const result = compileLiabilities(createSyntheticPersonalDraft(), compilerRequest());
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    const loan = result.value.input.loans[0]!;
    expect(result.value.primitiveState[loan.primitiveIds.amortization]).toMatchObject({ primitiveId: "P22", state: { evaluations: 47 } });
    expect(result.value.primitiveState[loan.primitiveIds.accrual]).toMatchObject({ primitiveId: "P24", state: { evaluations: 47 } });
    expect(loan.sourceTraceRefs?.map((ref) => ref.traceId)).toContain(`compiler:canonical:Liability:${ids.liability}`);
    expect(runVerticalSlice4({ runContext: context(), input: result.value.input, openingState: result.value.openingState, primitiveState: result.value.primitiveState, months: 3 }).status).toBe("completed");
  });

  it("rejects an opening balance that cannot result from the fixed P22 schedule", () => {
    const result = compileLiabilities(modelWith((draft) => { draft.objects.Liability![0]!.current_balance = "225669.72"; }), compilerRequest());
    expect(result).toMatchObject({ status: "unsupported" });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "LIABILITY_OPENING_HISTORY_UNSUPPORTED" })]));
  });

  it("does not move an active current balance across the observed as-of boundary", () => {
    for (const [simulationStart, simulationEnd] of [["2025-12-01", "2026-03-01"], ["2026-02-01", "2026-05-01"]] as const) {
      const result = compileLiabilities(createSyntheticPersonalDraft(), { ...compilerRequest(), simulationStart, simulationEnd });
      expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "LIABILITY_OPENING_BOUNDARY_UNSUPPORTED" })]));
    }
  });

  it("does not classify a future zero-balance liability as an inactive completed contract", () => {
    const result = compileLiabilities(modelWith((draft) => { draft.objects.Liability![0]!.current_balance = "0"; draft.objects.Liability![0]!.origination_date = "2027-01-01"; }), compilerRequest([]));
    expect(result).toMatchObject({ status: "unsupported" });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "LIABILITY_FUTURE_ORIGINATION_UNSUPPORTED" })]));
  });

  it("accepts case-insensitive inert authored P22, but gates executable authored configuration", () => {
    const primitiveId = "97000000-0000-4000-8000-000000000010";
    const inert = modelWith((draft) => {
      draft.objects.PrimitiveInstance = [{ primitive_instance_id: primitiveId, primitive_id: "P22", scenario_id: ids.scenario.toUpperCase(), enabled: true, input_bindings: {}, parameters: {} }];
      draft.objects.Liability![0]!.amortization_model_id = primitiveId;
    });
    expect(compileLiabilities(inert, compilerRequest()).status).toBe("compiled");
    const configured = modelWith((draft) => {
      draft.objects.PrimitiveInstance = [{ primitive_instance_id: primitiveId, primitive_id: "P22", scenario_id: ids.scenario, enabled: true, input_bindings: { balance: "authored" }, parameters: {} }];
      draft.objects.Liability![0]!.amortization_model_id = primitiveId;
    });
    const result = compileLiabilities(configured, compilerRequest());
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "LIABILITY_AMORTIZATION_CONFIGURATION_UNSUPPORTED" })]));
  });

  it("executes a supported mortgage while individually gating another debt type", () => {
    const secondId = "97000000-0000-4000-8000-000000000001";
    const model = modelWith((draft) => {
      draft.objects.Liability!.push({ ...draft.objects.Liability![0]!, liability_id: secondId, liability_type: "auto", current_balance: "10000", principal: "10000" });
    });
    const result = compileLiabilities(model, compilerRequest([profile(), profile({ liabilityId: secondId, settlementPriority: 2 })]));
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.value.input.loans).toHaveLength(1);
    expect(result.value.capabilityDiagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_TYPE_UNSUPPORTED", entityId: secondId }));
  });

  it("does not infer funding or a profile from the only checking account", () => {
    const result = compileLiabilities(createSyntheticPersonalDraft(), compilerRequest([]));
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_EXECUTION_PROFILE_REQUIRED" }));
  });

  it("passes low explicit cash through to truthful VS4 unfunded outcomes", () => {
    const model = modelWith((draft) => { draft.objects.Account![0]!.opening_balance = "100"; });
    const result = runPersonalForecast(model, {
      scope: "liabilities",
      baseCurrency: "USD",
      asOf: "2026-01-01",
      dataCutoff: "2026-01-01",
      simulationStart: "2026-01-01",
      simulationEnd: "2026-04-01",
      months: 3,
      sameInstantCashFlowOrder: "income_before_expense",
      executionOwnerId: ids.person,
      liabilityExecutionProfiles: [profile()],
    });
    expect(result.status).toBe("completed");
    if (result.scope !== "liabilities" || result.status === "unavailable") throw new Error("expected liability forecast");
    expect(result.liabilityOccurrences[0]).toEqual(expect.objectContaining({ scheduledFundingStatus: "unfunded" }));
    expect(result.shortfalls[0]!.unfunded.exact).not.toBe("0");
    expect(result.shortfalls[0]).toEqual(expect.objectContaining({ origin: "required_debt_service" }));
    expect(result.shortfalls[0]!.diagnostic).toMatch(/required contractual debt service/i);
  });

  it("keeps optional extra-principal shortfalls distinct from contractual debt service", () => {
    const result = runPersonalForecast(createSyntheticPersonalDraft(), {
      scope: "liabilities", baseCurrency: "USD", asOf: "2026-01-01", dataCutoff: "2026-01-01",
      simulationStart: "2026-01-01", simulationEnd: "2026-04-01", months: 3,
      sameInstantCashFlowOrder: "income_before_expense", executionOwnerId: ids.person,
      liabilityExecutionProfiles: [profile({ extraPrincipalPayments: [{ id: "97000000-0000-4000-8000-000000000050", scheduledAt: "2026-01-01", amount: "5000" }] })],
    });
    expect(result.status).toBe("completed");
    if (result.scope !== "liabilities" || result.status === "unavailable") throw new Error("expected liability forecast");
    expect(result.liabilityOccurrences[0]).toEqual(expect.objectContaining({ scheduledFundingStatus: "fully_satisfied", extraFundingStatus: "unfunded" }));
    expect(result.shortfalls).toContainEqual(expect.objectContaining({ origin: "extra_principal", diagnostic: expect.stringMatching(/not a missed contractual payment/i) }));
  });

  it("supports only explicitly scheduled extra principal and gates canonical conditional amounts", () => {
    const extra = profile({ extraPrincipalPayments: [{ id: "97000000-0000-4000-8000-000000000002", scheduledAt: "2026-01-01", amount: "100" }] });
    const compiled = compileLiabilities(createSyntheticPersonalDraft(), compilerRequest([extra]));
    expect(compiled.status).toBe("compiled");
    if (compiled.status === "compiled") {
      const run = runVerticalSlice4({ runContext: context(), input: compiled.value.input, openingState: compiled.value.openingState, primitiveState: compiled.value.primitiveState, months: 3 });
      expect(run.periods[0]!.liabilities[0]!.extraPrincipalPaid.equals(money("100"))).toBe(true);
    }
    const conditional = compileLiabilities(modelWith((draft) => { draft.objects.Liability![0]!.extra_payment = "100"; }), compilerRequest());
    expect(conditional.status).toBe("unsupported");
    if (conditional.status === "unsupported") expect(conditional.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_CONDITIONAL_EXTRA_PAYMENT_UNSUPPORTED" }));
  });

  it("gates maturity mismatch, future origination, and post-maturity servicing", () => {
    const maturity = compileLiabilities(modelWith((draft) => { draft.objects.Liability![0]!.maturity_date = "2052-02-01"; }), compilerRequest());
    expect(maturity.status).toBe("unsupported");
    const future = compileLiabilities(modelWith((draft) => { draft.objects.Liability![0]!.origination_date = "2026-02-01"; }), compilerRequest([profile({ paymentAnchor: "2026-03-01" })]));
    expect(future.status).toBe("unsupported");
    const matured = compileLiabilities(modelWith((draft) => { draft.objects.Liability![0]!.maturity_date = "2023-01-01"; }), compilerRequest([profile({ totalPayments: 12 })]));
    expect(matured.status).toBe("unsupported");
  });

  it("detects shared-funding priority conflicts and remains deterministic under reordering", () => {
    const secondId = "97000000-0000-4000-8000-000000000003";
    const model = modelWith((draft) => {
      draft.objects.Liability!.push({ ...draft.objects.Liability![0]!, liability_id: secondId, principal: "1000", current_balance: "900", maturity_date: "2052-01-01" });
    });
    const conflict = compileLiabilities(model, compilerRequest([profile(), profile({ liabilityId: secondId })]));
    expect(conflict.status).toBe("unsupported");
    const first = compileLiabilities(model, compilerRequest([profile(), profile({ liabilityId: secondId, settlementPriority: 2 })]));
    const reversed = compileLiabilities(modelWith((draft) => {
      draft.objects.Liability!.push({ ...draft.objects.Liability![0]!, liability_id: secondId, principal: "1000", current_balance: "900", maturity_date: "2052-01-01" });
      draft.objects.Liability!.reverse();
    }), compilerRequest([profile({ liabilityId: secondId, settlementPriority: 2 }), profile()]));
    expect(first.status).toBe("compiled");
    expect(reversed.status).toBe("compiled");
    if (first.status === "compiled" && reversed.status === "compiled")
      expect(first.value.input.loans).toEqual(reversed.value.input.loans);
  });

  it("matches VS4 priority parity for extra-only collisions and required-versus-extra sharing", () => {
    const secondId = "97000000-0000-4000-8000-000000000060";
    const secondAccount = "97000000-0000-4000-8000-000000000061";
    const extraAccount = "97000000-0000-4000-8000-000000000062";
    const model = modelWith((draft) => {
      draft.objects.Account!.push(
        { ...draft.objects.Account![0]!, account_id: secondAccount, name: "Second checking" },
        { ...draft.objects.Account![0]!, account_id: extraAccount, name: "Extra checking" },
      );
      draft.objects.Liability!.push({ ...draft.objects.Liability![0]!, liability_id: secondId });
    });
    const aExtra = { id: "97000000-0000-4000-8000-000000000063", scheduledAt: "2026-01-01", amount: "1", fundingAccountId: extraAccount };
    const bExtra = { id: "97000000-0000-4000-8000-000000000064", scheduledAt: "2026-01-01", amount: "1", fundingAccountId: extraAccount };
    const extrasConflict = compileLiabilities(model, compilerRequest([
      profile({ fundingAccountId: ids.account, extraPrincipalPayments: [aExtra] }),
      profile({ liabilityId: secondId, fundingAccountId: secondAccount, extraPrincipalPayments: [bExtra] }),
    ]));
    expect(extrasConflict).toMatchObject({ status: "unsupported" });
    expect(extrasConflict.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_SETTLEMENT_PRIORITY_CONFLICT" }));
    const requiredVsExtra = compileLiabilities(model, compilerRequest([
      profile({ fundingAccountId: extraAccount }),
      profile({ liabilityId: secondId, fundingAccountId: secondAccount, extraPrincipalPayments: [bExtra] }),
    ]));
    expect(requiredVsExtra.status).toBe("compiled");
    if (requiredVsExtra.status === "compiled")
      expect(runVerticalSlice4({ runContext: context(), input: requiredVsExtra.value.input, openingState: requiredVsExtra.value.openingState, primitiveState: requiredVsExtra.value.primitiveState, months: 3 }).status).toBe("completed");
  });

  it("does not capability-gate otherwise equal priorities whose occurrences are outside the requested horizon", () => {
    const secondId = "97000000-0000-4000-8000-000000000070";
    const model = modelWith((draft) => {
      draft.objects.Liability![0]!.current_balance = "240000";
      delete draft.objects.Liability![0]!.maturity_date;
      draft.objects.Account![0]!.opening_date = "2020-01-01";
      draft.objects.Liability!.push({ ...draft.objects.Liability![0]!, liability_id: secondId });
    });
    const result = compileLiabilities(model, {
      ...compilerRequest([profile({ paymentAnchor: "2026-01-01" }), profile({ liabilityId: secondId, paymentAnchor: "2026-01-01" })]),
      asOf: "2025-01-01", simulationStart: "2025-01-01", simulationEnd: "2025-04-01",
    });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "LIABILITY_SETTLEMENT_PRIORITY_CONFLICT" }));
  });

  it("classifies malformed funding records as invalid and valid non-executable funding as unsupported for primary and alternate sources", () => {
    const alternateId = "97000000-0000-4000-8000-000000000071";
    const requestFor = (fundingAccountId: string, alternate = false) => compilerRequest([profile(alternate
      ? { extraPrincipalPayments: [{ id: "97000000-0000-4000-8000-000000000072", scheduledAt: "2026-01-01", amount: "1", fundingAccountId }] }
      : { fundingAccountId })]);
    for (const [field, value] of [["account_type", "bogus"], ["currency", "US"], ["opening_balance", "-1"]] as const) {
      const primary = compileLiabilities(modelWith((draft) => { draft.objects.Account![0]![field] = value; }), requestFor(ids.account));
      expect(primary.status).toBe("invalid_model");
      const alternate = compileLiabilities(modelWith((draft) => { draft.objects.Account!.push({ ...draft.objects.Account![0]!, account_id: alternateId, [field]: value }); }), requestFor(alternateId, true));
      expect(alternate.status).toBe("invalid_model");
    }
    for (const [field, value] of [["account_type", "taxable_brokerage"], ["currency", "EUR"], ["opening_date", "2026-02-01"]] as const) {
      const primary = compileLiabilities(modelWith((draft) => { draft.objects.Account![0]![field] = value; }), requestFor(ids.account));
      expect(primary.status).toBe("unsupported");
      const alternate = compileLiabilities(modelWith((draft) => { draft.objects.Account!.push({ ...draft.objects.Account![0]!, account_id: alternateId, [field]: value }); }), requestFor(alternateId, true));
      expect(alternate.status).toBe("unsupported");
    }
  });

  it("returns a completed empty application result for paid-off debt without invoking VS4", () => {
    const model = modelWith((draft) => { draft.objects.Liability![0]!.current_balance = "0"; });
    const compiled = compileLiabilities(model, compilerRequest([]));
    expect(compiled.status).toBe("compiled");
    if (compiled.status === "compiled") expect(compiled.value.input.loans).toHaveLength(0);
    const result = runPersonalForecast(model, {
      scope: "liabilities",
      baseCurrency: "USD",
      asOf: "2026-01-01",
      dataCutoff: "2026-01-01",
      simulationStart: "2026-01-01",
      simulationEnd: "2026-04-01",
      months: 3,
      sameInstantCashFlowOrder: "income_before_expense",
      executionOwnerId: ids.person,
      liabilityExecutionProfiles: [],
    });
    expect(result).toEqual(expect.objectContaining({ status: "completed", inactiveLiabilityIds: [ids.liability], liabilityOccurrences: [] }));
  });

  it("marks an already-originated paid-off debt inactive before execution-owner capability gates", () => {
    const otherPerson = "97000000-0000-4000-8000-000000000099";
    const model = modelWith((draft) => {
      draft.objects.Person!.push({ ...draft.objects.Person![0]!, person_id: otherPerson, first_name: "Other" });
      draft.objects.Household![0]!.members = [ids.person, otherPerson];
      draft.objects.Liability![0]!.owner_id = otherPerson;
      draft.objects.Liability![0]!.current_balance = "0";
    });
    const result = compileLiabilities(model, compilerRequest([]));
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") {
      expect(result.value.inactiveLiabilityIds).toEqual([ids.liability]);
      expect(result.value.capabilityDiagnostics).not.toContainEqual(expect.objectContaining({ code: "LIABILITY_OWNER_UNSUPPORTED" }));
    }
  });

  it("rejects duplicate executable stable identities before VS4 validation", () => {
    const secondId = "97000000-0000-4000-8000-000000000010";
    const p22Id = "97000000-0000-4000-8000-000000000011";
    const model = modelWith((draft) => {
      draft.objects.PrimitiveInstance = [{ primitive_instance_id: p22Id, primitive_id: "P22", scenario_id: ids.scenario, enabled: true, input_bindings: {}, parameters: {} }];
      draft.objects.Liability![0]!.amortization_model_id = p22Id;
      draft.objects.Liability!.push({ ...draft.objects.Liability![0]!, liability_id: secondId, amortization_model_id: p22Id });
    });
    const result = compileLiabilities(model, compilerRequest([profile(), profile({ liabilityId: secondId, settlementPriority: 2 })]));
    expect(result).toMatchObject({ status: "invalid_model" });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_STABLE_ID_COLLISION" }));
  });

  it("rejects an explicit extra instruction that collides with compiler-owned identity space", () => {
    const result = compileLiabilities(createSyntheticPersonalDraft(), compilerRequest([profile({
      extraPrincipalPayments: [{ id: "f16c0000-0000-4000-8001-000000000001", scheduledAt: "2026-02-01", amount: "1" }],
    })]));
    expect(result).toMatchObject({ status: "invalid_model" });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "GENERATED_ID_COLLISION" }));
  });
});
