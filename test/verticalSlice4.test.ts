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
const context = (months: number, suffix = "1") => { const periods = utcMonthlyPeriods(start, months); return createRunContext({ runId: runId(`64000000-0000-4000-8000-${suffix.padStart(12, "0")}`), scenarioId: scenarioId("64000000-0000-4000-8000-000000000002"), asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: periods[periods.length - 1]!.end, baseCurrency: USD }); };
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
  });

  it("rejects replay and preserves the last committed financial and primitive state", () => {
    const first = runVerticalSlice4({ runContext: context(1, "301"), openingState: opening("300000", "10000"), input: input(loan()) });
    const replay = runVerticalSlice4({ runContext: context(1, "302"), openingState: first.state, primitiveState: first.primitiveState, input: input(loan()) });
    expect(replay.status).toBe("incomplete"); expect(replay.periods).toHaveLength(0); expect(replay.state).toEqual(first.state); expect(replay.primitiveState).toEqual(first.primitiveState); expect(replay.diagnostics.some((issue) => issue.code === "DUPLICATE_GENERATED_OCCURRENCE")).toBe(true);
  });
});
