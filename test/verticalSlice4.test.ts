import { describe, expect, it } from "vitest";
import { assertBalanced } from "../src/accounting/index.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Rate, RoundingPolicy, USD, money, rateConvention, sumMoney } from "../src/values/index.js";
import { runVerticalSlice4, type FixedAmortizingLoan, type VerticalSlice4Input } from "../src/verticalSlice4.js";

const ids = {
  household: domainId("household", "62000000-0000-4000-8000-000000000001"), owner: domainId("person", "62000000-0000-4000-8000-000000000002"), cash: domainId("account", "62000000-0000-4000-8000-000000000003"), principal: domainId("liability", "62000000-0000-4000-8000-000000000004"), interest: domainId("liability", "62000000-0000-4000-8000-000000000005"), loan: domainId("loan-contract", "62000000-0000-4000-8000-000000000006"),
};
const primitive = (n: number) => domainId("primitive-instance", `63000000-0000-4000-8000-${n.toString().padStart(12, "0")}`);
const start = instant("2026-01-01T00:00:00.000Z");
const paymentAt = instant("2026-01-15T00:00:00.000Z");
const rounding = RoundingPolicy.currency(2, "half_up");
const annual = (value: string) => Rate.fromDecimal(value, rateConvention.nominalAnnual(12));
const policy = () => createFundingPolicy({ id: fundingPolicyId("policy:vs4:checking"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
const contextAt = (simulationStart: ReturnType<typeof instant>, months: number, suffix = "1") => { const periods = utcMonthlyPeriods(simulationStart, months); return createRunContext({ runId: runId(`64000000-0000-4000-8000-${suffix.padStart(12, "0")}`), scenarioId: scenarioId("64000000-0000-4000-8000-000000000002"), asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart, simulationEnd: periods[periods.length - 1]!.end, baseCurrency: USD }); };
const context = (months: number, suffix = "1") => contextAt(start, months, suffix);
const opening = (principal: string, cash: string) => createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, ownerId: ids.owner, kind: "checking", cash: money(cash) } }, liabilities: { [ids.principal]: { id: ids.principal, balance: money(principal) }, [ids.interest]: { id: ids.interest, balance: money("0") } } });
const loan = (principal = "300000", rate = "0.06", term = 360, extras: FixedAmortizingLoan["extraPrincipalPayments"] = []): FixedAmortizingLoan => ({ id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.principal, interestPayableLiabilityId: ids.interest, originalPrincipal: money(principal), annualRate: annual(rate), totalPayments: term, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: paymentAt, invalidDayPolicy: "skip" }, fundingPolicy: policy(), settlementPriority: 1, extraPrincipalPayments: extras, postingRounding: rounding, primitiveIds: { schedule: primitive(1), amortization: primitive(2), accrual: primitive(3) } });
const input = (item: FixedAmortizingLoan): VerticalSlice4Input => ({ householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [item] });

describe("Vertical Slice 4 liabilities", () => {
  it("fully amortizes the 360-month mortgage with exact accounting and no negative principal", () => {
    const result = runVerticalSlice4({ runContext: context(360), openingState: opening("300000", "700000"), input: input(loan()) });
    expect(result.status).toBe("completed"); expect(result.periods).toHaveLength(360);
    expect(result.periods[0]!.liabilities[0]!.contractualPayment.equals(money("1798.65"))).toBe(true);
    expect(result.periods[0]!.liabilities[0]!.currentInterest.equals(money("1500"))).toBe(true);
    expect(result.periods[0]!.liabilities[0]!.scheduledPrincipalPaid.equals(money("298.65"))).toBe(true);
    expect(result.periods[0]!.liabilities[0]!.endingPrincipal.equals(money("299701.35"))).toBe(true);
    expect(result.periods[11]!.endingPrincipal.equals(money("296316"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("0"))).toBe(true);
    expect(result.state.liabilities[ids.interest]!.balance.equals(money("0"))).toBe(true);
    expect(result.periods.flatMap((period) => period.liabilities).every((item) => !item.endingPrincipal.isNegative())).toBe(true);
    expect(sumMoney(result.periods.map((period) => period.principalReduction)).equals(money("300000"))).toBe(true);
    for (const tx of result.periods.flatMap((period) => period.transactions)) assertBalanced(tx);
    const totalInterest = sumMoney(result.periods.map((period) => period.interestExpense));
    expect(result.state.accounts[ids.cash]!.cash.equals(money("700000").minus(money("300000")).minus(totalInterest))).toBe(true);
    expect(result.periods.every((period) => period.statements.netWorth.equals(period.statements.assets.minus(period.statements.liabilities)))).toBe(true);
  }, 20_000);

  it("pays zero-rate loans exactly across multiple principal and term inputs", () => {
    for (const [principal, term] of [["10000", 12], ["1234.56", 7], ["1", 3]] as const) {
      const result = runVerticalSlice4({ runContext: context(term, `${term}`), openingState: opening(principal, "20000"), input: input(loan(principal, "0", term)) });
      expect(result.status).toBe("completed"); expect(result.state.liabilities[ids.principal]!.balance.equals(money("0"))).toBe(true); expect(result.periods.every((period) => period.interestExpense.isZero())).toBe(true); expect(sumMoney(result.periods.map((period) => period.principalReduction)).equals(money(principal))).toBe(true);
    }
  });

  it("keeps the contractual payment fixed after extra principal and can pay off early", () => {
    const extra = { id: domainId("extra-principal-payment", "65000000-0000-4000-8000-000000000001"), scheduledAt: paymentAt, amount: money("1000000"), fundingPolicy: policy(), primitiveInstanceId: primitive(4) };
    const baseline = runVerticalSlice4({ runContext: context(360, "101"), openingState: opening("300000", "1000000"), input: input(loan()) });
    const accelerated = runVerticalSlice4({ runContext: context(360, "102"), openingState: opening("300000", "1000000"), input: input(loan("300000", "0.06", 360, [extra])) });
    expect(accelerated.status).toBe("completed"); expect(accelerated.state.liabilities[ids.principal]!.balance.equals(money("0"))).toBe(true);
    expect(accelerated.periods[0]!.liabilities[0]!.extraPrincipalPaid.equals(money("299701.35"))).toBe(true);
    expect(accelerated.periods.slice(1).every((period) => period.liabilities.length === 0)).toBe(true);
    expect(accelerated.periods[0]!.liabilities[0]!.contractualPayment.equals(baseline.periods[0]!.liabilities[0]!.contractualPayment)).toBe(true);
    expect(sumMoney(accelerated.periods.map((period) => period.interestExpense)).compare(sumMoney(baseline.periods.map((period) => period.interestExpense))) <= 0).toBe(true);
  }, 20_000);

  it("leaves principal and cash unchanged when scheduled service is unfunded while interest remains explicit", () => {
    const result = runVerticalSlice4({ runContext: context(2, "201"), openingState: opening("300000", "100"), input: input(loan()) });
    expect(result.status).toBe("completed"); expect(result.state.accounts[ids.cash]!.cash.equals(money("100"))).toBe(true); expect(result.state.liabilities[ids.principal]!.balance.equals(money("300000"))).toBe(true); expect(result.state.liabilities[ids.interest]!.balance.equals(money("3000"))).toBe(true);
    expect(result.periods.every((period) => period.liabilities[0]!.scheduledFundingStatus === "unfunded" && period.principalReduction.isZero())).toBe(true);
    expect(result.diagnostics.every((issue) => issue.code !== "contract_default")).toBe(true); expect(result.diagnostics.filter((issue) => issue.code === "LIQUIDITY_SHORTFALL")).toHaveLength(2);
    expect(Object.values(result.state.obligations).filter((claim) => claim.category === "mortgage_interest_payable" && claim.outstandingAmount.isPositive())).toHaveLength(2);
  });

  it("does not undo a funded scheduled payment when separate extra principal is unfunded", () => {
    const extra = { id: domainId("extra-principal-payment", "65000000-0000-4000-8000-000000000002"), scheduledAt: paymentAt, amount: money("1000"), fundingPolicy: policy(), primitiveInstanceId: primitive(5) };
    const result = runVerticalSlice4({ runContext: context(1, "251"), openingState: opening("300000", "2000"), input: input(loan("300000", "0.06", 360, [extra])) });
    const liability = result.periods[0]!.liabilities[0]!;
    expect(liability.scheduledFundingStatus).toBe("fully_satisfied");
    expect(liability.extraFundingStatus).toBe("unfunded");
    expect(liability.scheduledPrincipalPaid.equals(money("298.65"))).toBe(true);
    expect(liability.extraPrincipalPaid.isZero()).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("299701.35"))).toBe(true);
    expect(result.state.accounts[ids.cash]!.cash.equals(money("201.35"))).toBe(true);
    expect(Object.values(result.state.obligations).some((claim) => claim.kind === "obligation" && claim.category === "mortgage_extra_principal_due" && claim.outstandingAmount.isPositive())).toBe(false);
  });

  it("reconciles missed zero-rate principal when liquidity recovers", () => {
    const first = runVerticalSlice4({ runContext: context(1, "401"), openingState: opening("100", "0"), input: input(loan("100", "0", 2)) });
    expect(first.periods[0]!.liabilities[0]!.scheduledFundingStatus).toBe("unfunded");
    expect(first.state.liabilities[ids.principal]!.balance.equals(money("100"))).toBe(true);
    const recoveredOpening = createAuthoritativeState({ ...first.state, accounts: { ...first.state.accounts, [ids.cash]: { ...first.state.accounts[ids.cash]!, cash: money("100") } } });
    const recovered = runVerticalSlice4({ runContext: contextAt(instant("2026-02-01T00:00:00.000Z"), 1, "402"), openingState: recoveredOpening, primitiveState: first.primitiveState, input: input(loan("100", "0", 2)) });
    expect(recovered.status).toBe("completed");
    expect(recovered.state.liabilities[ids.principal]!.balance.isZero()).toBe(true);
    expect(recovered.state.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(Object.values(recovered.state.obligations).filter((claim) => claim.category === "mortgage_principal_due" && claim.outstandingAmount.isPositive())).toHaveLength(0);
    expect(recovered.periods[0]!.settlements.filter((settlement) => settlement.amount.currency.equals(USD)).length).toBe(2);
    expect(recovered.primitiveState[primitive(2)]?.primitiveId).toBe("P22");
    expect(recovered.primitiveState[primitive(2)]?.state).toMatchObject({ evaluations: 2 });
  });

  it("does not infer post-maturity servicing after an unfunded final contractual occurrence", () => {
    const matured = runVerticalSlice4({ runContext: context(1, "411"), openingState: opening("100", "0"), input: input(loan("100", "0.12", 1)) });
    expect(matured.state.liabilities[ids.principal]!.balance.equals(money("100"))).toBe(true);
    expect(matured.state.liabilities[ids.interest]!.balance.equals(money("1"))).toBe(true);
    const continued = runVerticalSlice4({ runContext: contextAt(instant("2026-02-01T00:00:00.000Z"), 1, "412"), openingState: matured.state, primitiveState: matured.primitiveState, input: input(loan("100", "0.12", 1)) });
    expect(continued.status).toBe("incomplete");
    expect(continued.diagnostics.some((issue) => issue.code === "LIABILITY_CONFIGURATION_UNSUPPORTED")).toBe(true);
    expect(continued.periods).toHaveLength(0);
    expect(continued.state.liabilities[ids.principal]!.balance.equals(money("100"))).toBe(true);
    expect(continued.state.liabilities[ids.interest]!.balance.equals(money("1"))).toBe(true);
    expect(continued.primitiveState[primitive(2)]?.state).toMatchObject({ evaluations: 1 });
  });

  it("settles carried interest explicitly when later liquidity recovers", () => {
    const first = runVerticalSlice4({ runContext: context(1, "421"), openingState: opening("100", "0"), input: input(loan("100", "0.12", 2)) });
    expect(first.state.liabilities[ids.interest]!.balance.equals(money("1"))).toBe(true);
    const recoveredOpening = createAuthoritativeState({ ...first.state, accounts: { ...first.state.accounts, [ids.cash]: { ...first.state.accounts[ids.cash]!, cash: money("102") } } });
    const recovered = runVerticalSlice4({ runContext: contextAt(instant("2026-02-01T00:00:00.000Z"), 1, "422"), openingState: recoveredOpening, primitiveState: first.primitiveState, input: input(loan("100", "0.12", 2)) });
    expect(recovered.state.liabilities[ids.principal]!.balance.isZero()).toBe(true);
    expect(recovered.state.liabilities[ids.interest]!.balance.isZero()).toBe(true);
    expect(recovered.state.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(Object.values(recovered.state.obligations).filter((claim) => claim.category === "mortgage_interest_payable" && claim.outstandingAmount.isPositive())).toHaveLength(0);
    expect(recovered.periods[0]!.interestExpense.equals(money("1"))).toBe(true);
  });

  it("reports truthful fundable liquidity for an all-or-nothing shortfall", () => {
    const result = runVerticalSlice4({ runContext: context(1, "431"), openingState: opening("300000", "1700"), input: input(loan()) });
    const outcome = result.periods[0]!.constraintOutcomes[0]!;
    const shortfall = result.periods[0]!.liquidityShortfalls[0]!;
    expect(outcome.status).toBe("unfunded");
    expect(outcome.acceptedAmount.isZero()).toBe(true);
    expect(shortfall.fundedAmount.equals(money("1700"))).toBe(true);
    expect(shortfall.shortfallAmount.equals(money("98.65"))).toBe(true);
    expect("proposalIds" in shortfall).toBe(true);
    if ("proposalIds" in shortfall) { expect(shortfall.proposalIds).toHaveLength(2); expect(shortfall.claimIds).toHaveLength(2); }
    expect(result.state.accounts[ids.cash]!.cash.equals(money("1700"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("300000"))).toBe(true);
  });

  it("keeps future and historical extra instructions valid across chunked runs", () => {
    const extra = { id: domainId("extra-principal-payment", "65000000-0000-4000-8000-000000000009"), scheduledAt: instant("2026-02-15T00:00:00.000Z"), amount: money("1"), fundingPolicy: policy(), primitiveInstanceId: primitive(30) };
    const model = loan("100", "0", 2, [extra]); const january = runVerticalSlice4({ runContext: context(1, "461"), openingState: opening("100", "100"), input: input(model) });
    expect(january.status).toBe("completed");
    const february = runVerticalSlice4({ runContext: contextAt(instant("2026-02-01T00:00:00.000Z"), 1, "462"), openingState: january.state, primitiveState: january.primitiveState, input: input(model) });
    expect(february.status).toBe("completed");
  });

  it("rejects missing primitive history when VS4 claims prove prior execution", () => {
    const first = runVerticalSlice4({ runContext: context(1, "471"), openingState: opening("100", "0"), input: input(loan("100", "0", 2)) });
    expect(() => runVerticalSlice4({ runContext: contextAt(instant("2026-02-01T00:00:00.000Z"), 1, "472"), openingState: first.state, input: input(loan("100", "0", 2)) })).toThrow(/requires compatible P22 runtime state/);
  });

  it("rejects an unrelated economic owner", () => {
    const unrelated = domainId("person", "62000000-0000-4000-8000-000000000099");
    expect(() => runVerticalSlice4({ runContext: context(1, "481"), openingState: opening("100", "100"), input: input({ ...loan("100", "0", 1), ownerId: unrelated }) })).toThrow(/economic-owner scope/);
  });

  it("processes every required same-instant payment before voluntary extra principal", () => {
    const secondPrincipal = domainId("liability", "66000000-0000-4000-8000-000000000001");
    const secondInterest = domainId("liability", "66000000-0000-4000-8000-000000000002");
    const secondLoanId = domainId("loan-contract", "66000000-0000-4000-8000-000000000003");
    const extra = { id: domainId("extra-principal-payment", "65000000-0000-4000-8000-000000000003"), scheduledAt: paymentAt, amount: money("50"), fundingPolicy: policy(), primitiveInstanceId: primitive(20) };
    const firstLoan = { ...loan("100", "0", 2, [extra]), settlementPriority: 2 };
    const secondLoan = { ...loan("50", "0", 1), id: secondLoanId, principalLiabilityId: secondPrincipal, interestPayableLiabilityId: secondInterest, settlementPriority: 1, primitiveIds: { schedule: primitive(21), amortization: primitive(22), accrual: primitive(23) } };
    const state = createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, ownerId: ids.owner, kind: "checking", cash: money("100") } }, liabilities: { [ids.principal]: { id: ids.principal, balance: money("100") }, [ids.interest]: { id: ids.interest, balance: money("0") }, [secondPrincipal]: { id: secondPrincipal, balance: money("50") }, [secondInterest]: { id: secondInterest, balance: money("0") } } });
    const result = runVerticalSlice4({ runContext: context(1, "435"), openingState: state, input: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [firstLoan, secondLoan] } });
    expect(result.state.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("50"))).toBe(true);
    expect(result.state.liabilities[secondPrincipal]!.balance.isZero()).toBe(true);
    const firstResult = result.periods[0]!.liabilities.find((item) => item.loanId === ids.loan)!;
    expect(firstResult.scheduledFundingStatus).toBe("fully_satisfied");
    expect(firstResult.extraFundingStatus).toBe("unfunded");
    expect(firstResult.extraPrincipalPaid.isZero()).toBe(true);
  });

  it("rejects opening principal above original principal and incompatible matured runtime state", () => {
    expect(() => runVerticalSlice4({ runContext: context(1, "441"), openingState: opening("101", "1000"), input: input(loan("100", "0", 2)) })).toThrow(/cannot exceed original principal/);
    const malformedState = {
      [primitive(2)]: { primitiveId: "P22" as const, state: { evaluations: 2, contractualPayment: money("50"), originalPrincipal: money("100"), totalPayments: 2 } },
      [primitive(3)]: { primitiveId: "P24" as const, state: { evaluations: 2, lastAccruedAmount: money("0") } },
    };
    expect(() => runVerticalSlice4({ runContext: context(1, "442"), openingState: opening("100", "1000"), primitiveState: malformedState, input: input(loan("100", "0", 2)) })).toThrow(/Matured principal/);
  });

  it("includes economically meaningful primitive progress in the run fingerprint", () => {
    const missed = runVerticalSlice4({ runContext: context(1, "451"), openingState: opening("100", "0"), input: input(loan("100", "0", 3)) });
    const secondProgress = {
      ...missed.primitiveState,
      [primitive(2)]: { primitiveId: "P22" as const, state: { ...(missed.primitiveState[primitive(2)]!.state as object), evaluations: 2 } },
      [primitive(3)]: { primitiveId: "P24" as const, state: { ...(missed.primitiveState[primitive(3)]!.state as object), evaluations: 2 } },
    };
    const nextContext = contextAt(instant("2026-02-01T00:00:00.000Z"), 1, "452");
    const one = runVerticalSlice4({ runContext: nextContext, openingState: missed.state, primitiveState: missed.primitiveState, input: input(loan("100", "0", 3)) });
    const two = runVerticalSlice4({ runContext: { ...nextContext, runId: runId("64000000-0000-4000-8000-000000000453") }, openingState: missed.state, primitiveState: secondProgress, input: input(loan("100", "0", 3)) });
    expect(one.runMetadata.inputFingerprint).not.toBe(two.runMetadata.inputFingerprint);
  });

  it("rejects replay and preserves the last committed financial and primitive state", () => {
    const first = runVerticalSlice4({ runContext: context(1, "301"), openingState: opening("300000", "10000"), input: input(loan()) });
    const replay = runVerticalSlice4({ runContext: context(1, "302"), openingState: first.state, primitiveState: first.primitiveState, input: input(loan()) });
    expect(replay.status).toBe("incomplete"); expect(replay.periods).toHaveLength(0); expect(replay.state).toEqual(first.state); expect(replay.primitiveState).toEqual(first.primitiveState); expect(replay.diagnostics.some((issue) => issue.code === "DUPLICATE_GENERATED_OCCURRENCE")).toBe(true);
  });
});
