import { describe, expect, it, vi } from "vitest";
import { authorMortgageRefinance, compileMortgageLifecycle } from "../src/application/compiler/mortgageLifecycle.js";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { prepareVerticalSlice4Period, executePreparedVerticalSlice4Operation, type FixedAmortizingLoan, type VerticalSlice4Input } from "../src/simulation/verticalSlice4.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { money, Rate, rateConvention, RoundingPolicy, USD } from "../src/values/index.js";
import type { OperationState } from "../src/simulation/r3/operations.js";
import { compileHouseholdKernel } from "../src/simulation/r3/compiledHousehold.js";
import { runHouseholdKernel } from "../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../src/simulation/run.js";

const id = (n: number) => `d1b20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const loan: FixedAmortizingLoan = {
  id: domainId("loan-contract", id(1)), ownerId: domainId("person", ids.person), principalLiabilityId: domainId("liability", ids.mortgage), interestPayableLiabilityId: domainId("liability", id(2)), originalPrincipal: money("6000", USD), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 6,
  rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing",
  paymentSchedule: { kind: "utc_monthly", anchor: instant("2026-01-01T00:00:00.000Z"), invalidDayPolicy: "skip" },
  fundingPolicy: createFundingPolicy({ id: fundingPolicyId("d1b-mortgage"), orderedSources: [{ kind: "cash_account", accountId: domainId("account", ids.checking) }], allowPartial: false, insufficientFundsBehavior: "unfunded" }), settlementPriority: 1,
  postingRounding: new RoundingPolicy(2, "half_even"), primitiveIds: { schedule: domainId("primitive-instance", id(3)), amortization: domainId("primitive-instance", id(4)), accrual: domainId("primitive-instance", id(5)) },
};
const slice: VerticalSlice4Input = { householdId: domainId("household", ids.household), ownerId: domainId("person", ids.person), baseCurrency: USD, loans: [loan] };
const context = createRunContext({ runId: runId(id(6)), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-03-01T00:00:00.000Z"), baseCurrency: USD });
const opening = (cash = "10000"): OperationState => ({ state: createAuthoritativeState({ accounts: { [ids.checking]: { id: domainId("account", ids.checking), ownerId: domainId("person", ids.person), kind: "checking", cash: money(cash, USD) } }, liabilities: { [ids.mortgage]: { id: loan.principalLiabilityId, balance: money("6000", USD) }, [id(2)]: { id: loan.interestPayableLiabilityId, balance: money("0", USD) } } }), primitiveState: createPrimitiveRuntimeStateStore() });
const authored = (date = "2026-01-01") => authorMortgageRefinance(createGoldenHouseholdDraft(), { eventId: id(10), effectId: id(11), primitiveId: id(12), liabilityId: ids.mortgage, date, annualRate: "0", totalPayments: 5 });
const compile = (date = "2026-01-01", input = slice) => compileMortgageLifecycle(importPersonalModelJson(exportPersonalModelJson(authored(date))), input, ids.rootScenario, "2026-01-01", "2026-03-01");

describe("D1-B VS4 refinance expected effects", () => {
  it("restores mortgage lifecycle replay in a fresh codec registry without compiler import side effects", async () => {
    const compiled = compile(); if (compiled.status !== "compiled" || !compiled.value) throw new Error("refinance fixture unavailable");
    expect(compiled.value.portableCodec).toBe("mortgage-lifecycle/v1");
    const before = opening();
    const kernel = compileHouseholdKernel({ liabilityInput: slice, reconciledOpeningState: before.state, reconciledPrimitiveState: before.primitiveState, scenarioIdentity: ids.rootScenario, executionMonths: 2, scenarioBindings: {}, participants: [compiled.value] }, context.simulationStart);
    const baseline = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel, runContext: context });
    const artifact = JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(summary)));
    vi.resetModules();
    const freshReplay = await import("../src/simulation/r3/replayArtifact.js");
    const restored = freshReplay.restorePortableHouseholdReplayArtifact(artifact);
    const freshExecution = await import("../src/simulation/householdExecution.js");
    const freshSerialize = (await import("../src/simulation/run.js")).canonicalSerialize;
    const rerun = freshExecution.runHouseholdKernel({ kernel: restored.replay.kernel, runContext: restored.replay.runContext, resultTier: "detail" });
    expect(rerun.status).toBe("completed");
    expect(freshSerialize(rerun.state)).toBe(canonicalSerialize(baseline.state));
    expect(freshSerialize(rerun.primitiveState)).toBe(canonicalSerialize(baseline.primitiveState));
    expect(freshSerialize(rerun.periods)).toBe(canonicalSerialize(baseline.periods));
    expect(freshSerialize(restored.runMetadata)).toBe(canonicalSerialize(summary.runMetadata));
    expect(rerun.state.liabilities[ids.mortgage]!.balance.amount.toString()).toBe("0");
    expect(rerun.periods.map(period => period.netWorth.amount.toString())).toEqual(["4000", "4000"]);
    for (const period of rerun.periods) {
      const checkpoint = freshExecution.replayHouseholdForecastWindow(restored, period.period);
      expect(freshSerialize(checkpoint.periods)).toBe(canonicalSerialize([baseline.periods.find(value => value.period.start === period.period.start)!]));
    }
  });
  it("reports replacement principal and debt service identically in the summary and detailed household paths", () => {
    const compiled = compile(); if (compiled.status !== "compiled" || !compiled.value) throw new Error("refinance fixture unavailable");
    const before = opening();
    const kernel = compileHouseholdKernel({ liabilityInput: slice, reconciledOpeningState: before.state, reconciledPrimitiveState: before.primitiveState, scenarioIdentity: ids.rootScenario, executionMonths: 2, scenarioBindings: {}, participants: [compiled.value] }, context.simulationStart);
    const detailed = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel, runContext: context });
    expect(detailed.status, JSON.stringify(detailed.diagnostics)).toBe("completed"); expect(summary.status, JSON.stringify(summary.diagnostics)).toBe("completed");
    expect(detailed.periods.map(period => [period.cash.amount.toString(), period.netWorth.amount.toString(), period.liability?.principalReduction.amount.toString(), period.liability?.endingPrincipal.amount.toString()])).toEqual([["9000", "4000", "1000", "5000"], ["8000", "4000", "1000", "4000"]]);
    expect(summary.periods.map(period => [period.cash.amount.toString(), period.netWorth.amount.toString(), period.principalReduction?.amount.toString(), period.endingPrincipal?.amount.toString()])).toEqual([["9000", "4000", "1000", "5000"], ["8000", "4000", "1000", "4000"]]);
    expect(detailed.periods[0]?.liability?.liabilities[0]?.extraPrincipalPaid.amount.toString()).toBe("0");
    expect(detailed.periods.map(period => period.statements.expenses.amount.toString())).toEqual(["0", "0"]);
  });
  it("settles old debt service, replaces post-payment 5000 principal, and starts a full-month VS4 schedule", () => {
    const compiled = compile(); expect(compiled.status).toBe("compiled"); if (compiled.status !== "compiled" || !compiled.value) throw new Error("refinance fixture unavailable");
    const before = opening(), january = utcMonthlyPeriods(context.simulationStart, 2)[0]!;
    const prepared = prepareVerticalSlice4Period(context, slice, january, before.state, before.primitiveState), service = prepared.operations[0]!;
    const refinance = compiled.value.prepare(context, january, before, prepared.descriptors).operations[0]!;
    expect(refinance.descriptor.dependsOn).toEqual([service.descriptor.id]);
    const paid = executePreparedVerticalSlice4Operation(prepared, service, before.state, before.primitiveState, slice, context);
    expect(paid.state.accounts[ids.checking]!.cash.amount.toString()).toBe("9000"); expect(paid.state.liabilities[ids.mortgage]!.balance.amount.toString()).toBe("5000");
    expect(paid.period?.interestExpense.amount.toString()).toBe("0"); expect(paid.period?.principalReduction.amount.toString()).toBe("1000");
    const closed = refinance.execute({ state: paid.state, primitiveState: paid.primitiveState }, new Map([[service.descriptor.id, "fully_satisfied"]]));
    expect(closed.state.liabilities[ids.mortgage]!.balance.amount.toString()).toBe("0"); expect(closed.state.accounts[ids.checking]!.cash.amount.toString()).toBe("9000");
    expect(Object.values(closed.state.liabilities).map(item => item.balance.amount.toString()).sort()).toEqual(["0", "0", "0", "5000"]);
    expect(closed.facts.transactions).toHaveLength(1);
    expect(closed.facts.transactions?.[0]?.legs.map(item => [item.type, item.posting, item.amount.amount.toString()])).toEqual([["liability", "debit", "5000"], ["liability", "credit", "5000"]]);
    const february = utcMonthlyPeriods(context.simulationStart, 2)[1]!;
    const replacement = compiled.value.prepare(context, february, closed).operations[0]!;
    expect(replacement.descriptor.sequencingInstant).toBe("2026-02-01T00:00:00.000Z");
    const next = replacement.execute(closed, new Map());
    expect(next.state.accounts[ids.checking]!.cash.amount.toString()).toBe("8000");
    expect(Object.values(next.state.liabilities).reduce((sum, item) => sum.plus(item.balance), money("0", USD)).amount.toString()).toBe("4000");
    expect(next.facts.liability?.interestExpense.amount.toString()).toBe("0"); expect(next.facts.liability?.principalReduction.amount.toString()).toBe("1000");
    // Both periods preserve opening net worth 10000 - 6000 = 4000; refinance creates no cash or second principal.
    expect(next.state.accounts[ids.checking]!.cash.minus(Object.values(next.state.liabilities).reduce((sum, item) => sum.plus(item.balance), money("0", USD))).amount.toString()).toBe("4000");
    expect(before.state.accounts[ids.checking]!.cash.amount.toString()).toBe("10000");
  });
  it("prevents refinance when the old required payment is unfunded", () => {
    const compiled = compile(); if (compiled.status !== "compiled" || !compiled.value) throw new Error("refinance fixture unavailable");
    const before = opening("500"), period = utcMonthlyPeriods(context.simulationStart, 1)[0]!;
    const prepared = prepareVerticalSlice4Period(context, slice, period, before.state, before.primitiveState), service = prepared.operations[0]!;
    const paid = executePreparedVerticalSlice4Operation(prepared, service, before.state, before.primitiveState, slice, context);
    const refinance = compiled.value.prepare(context, period, before, prepared.descriptors).operations[0]!;
    const result = refinance.execute({ state: paid.state, primitiveState: paid.primitiveState }, new Map([[service.descriptor.id, "unfunded"]]));
    expect(result.state.accounts[ids.checking]!.cash.amount.toString()).toBe("500"); expect(result.state.liabilities[ids.mortgage]!.balance.amount.toString()).toBe("6000");
    expect(Object.keys(result.state.liabilities)).toHaveLength(2); expect(result.facts.transactions).toBeUndefined();
  });
  it("gates off-cycle refinance instead of rounding its date", () => {
    const result = compile("2026-01-15"); expect(result.status).toBe("unsupported"); expect(result.diagnostics[0]?.message).toContain("scheduled monthly payment date");
  });
  it("rejects optional extra principal at the refinance occurrence", () => {
    const result = compile("2026-01-01", { ...slice, loans: [{ ...loan, extraPrincipalPayments: [{ id: domainId("extra-principal-payment", id(20)), scheduledAt: instant("2026-01-01T00:00:00.000Z"), amount: money("100", USD), fundingPolicy: loan.fundingPolicy, primitiveInstanceId: domainId("primitive-instance", id(21)) }] }] });
    expect(result.status).toBe("unsupported"); expect(result.diagnostics[0]?.message).toContain("either extra principal or refinance");
  });
  it("preserves ordinary VS4 amortization, extra principal and payoff", () => {
    const before = opening(), input = { ...slice, loans: [{ ...loan, extraPrincipalPayments: [{ id: domainId("extra-principal-payment", id(20)), scheduledAt: instant("2026-01-01T00:00:00.000Z"), amount: money("5000", USD), fundingPolicy: loan.fundingPolicy, primitiveInstanceId: domainId("primitive-instance", id(21)) }] }] };
    const prepared = prepareVerticalSlice4Period(context, input, utcMonthlyPeriods(context.simulationStart, 1)[0]!, before.state, before.primitiveState);
    const required = executePreparedVerticalSlice4Operation(prepared, prepared.operations[0]!, before.state, before.primitiveState, input, context);
    const extra = executePreparedVerticalSlice4Operation(prepared, prepared.operations[1]!, required.state, required.primitiveState, input, context);
    expect(required.state.accounts[ids.checking]!.cash.amount.toString()).toBe("9000"); expect(extra.state.accounts[ids.checking]!.cash.amount.toString()).toBe("4000");
    expect(extra.state.liabilities[ids.mortgage]!.balance.amount.toString()).toBe("0"); expect(extra.transactions[0]?.legs.filter(item => item.type === "liability").map(item => item.amount.amount.toString())).toEqual(["5000"]);
    const next = prepareVerticalSlice4Period(context, input, utcMonthlyPeriods(context.simulationStart, 2)[1]!, extra.state, extra.primitiveState); expect(next.operations).toHaveLength(0);
  });
});
