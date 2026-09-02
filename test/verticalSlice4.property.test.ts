import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { fixedMortgagePayment } from "../src/rules/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Rate, RoundingPolicy, USD, money, rateConvention, sumMoney } from "../src/values/index.js";
import { runVerticalSlice4, type FixedAmortizingLoan } from "../src/verticalSlice4.js";

const ids = {
  household: domainId("household", "67000000-0000-4000-8000-000000000001"),
  owner: domainId("person", "67000000-0000-4000-8000-000000000002"),
  cash: domainId("account", "67000000-0000-4000-8000-000000000003"),
  principal: domainId("liability", "67000000-0000-4000-8000-000000000004"),
  interest: domainId("liability", "67000000-0000-4000-8000-000000000005"),
  loan: domainId("loan-contract", "67000000-0000-4000-8000-000000000006"),
};
const primitive = (n: number) => domainId("primitive-instance", `68000000-0000-4000-8000-${n.toString().padStart(12, "0")}`);
const start = instant("2026-01-01T00:00:00.000Z");
const paymentAt = instant("2026-01-15T00:00:00.000Z");
const rounding = RoundingPolicy.currency(2, "half_up");
const fromCents = (cents: number) => money(`${Math.trunc(cents / 100)}.${(cents % 100).toString().padStart(2, "0")}`);
const context = (months: number) => { const periods = utcMonthlyPeriods(start, months); return createRunContext({ runId: runId("69000000-0000-4000-8000-000000000001"), scenarioId: scenarioId("69000000-0000-4000-8000-000000000002"), asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: periods[periods.length - 1]!.end, baseCurrency: USD }); };
const policy = () => createFundingPolicy({ id: fundingPolicyId("policy:vs4:property"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
const opening = (principal: ReturnType<typeof money>, cash: ReturnType<typeof money>) => createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, ownerId: ids.owner, kind: "checking", cash } }, liabilities: { [ids.principal]: { id: ids.principal, balance: principal }, [ids.interest]: { id: ids.interest, balance: money("0") } } });
const loan = (principal: ReturnType<typeof money>, term: number, extra?: ReturnType<typeof money>): FixedAmortizingLoan => ({
  id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.principal, interestPayableLiabilityId: ids.interest, originalPrincipal: principal,
  annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: term, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing",
  paymentSchedule: { kind: "utc_monthly", anchor: paymentAt, invalidDayPolicy: "skip" }, fundingPolicy: policy(), settlementPriority: 1,
  ...(extra === undefined ? {} : { extraPrincipalPayments: [{ id: domainId("extra-principal-payment", "69000000-0000-4000-8000-000000000003"), scheduledAt: paymentAt, amount: extra, fundingPolicy: policy(), primitiveInstanceId: primitive(4) }] }),
  postingRounding: rounding, primitiveIds: { schedule: primitive(1), amortization: primitive(2), accrual: primitive(3) },
});
const input = (item: FixedAmortizingLoan) => ({ householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [item] });

describe("Vertical Slice 4 liability properties", () => {
  it("fully reconciles bounded zero-rate amortization including final rounding residue", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 18 }), (principalCents, term) => {
      const principal = fromCents(principalCents);
      const result = runVerticalSlice4({ runContext: context(term), openingState: opening(principal, money("20000")), input: input(loan(principal, term)) });
      const reductions = result.periods.map((period) => period.principalReduction);
      expect(result.state.liabilities[ids.principal]!.balance.isZero()).toBe(true);
      expect(result.periods.every((period) => period.interestExpense.isZero())).toBe(true);
      expect(result.periods.flatMap((period) => period.liabilities).every((item) => !item.endingPrincipal.isNegative())).toBe(true);
      expect(sumMoney(reductions).equals(principal)).toBe(true);
      expect(reductions.every((amount) => amount.compare(principal) <= 0)).toBe(true);
    }), { numRuns: 24, seed: 10_004 });
  });

  it("caps funded early payoff without recasting or generating post-payoff activity", () => {
    fc.assert(fc.property(fc.integer({ min: 100, max: 500_000 }), fc.integer({ min: 2, max: 18 }), fc.integer({ min: 1, max: 750_000 }), (principalCents, term, extraCents) => {
      const principal = fromCents(principalCents); const extra = fromCents(extraCents);
      const result = runVerticalSlice4({ runContext: context(term), openingState: opening(principal, money("20000")), input: input(loan(principal, term, extra)) });
      const activity = result.periods.flatMap((period) => period.liabilities);
      expect(result.state.liabilities[ids.principal]!.balance.isZero()).toBe(true);
      expect(sumMoney(result.periods.map((period) => period.principalReduction)).equals(principal)).toBe(true);
      expect(activity.every((item) => !item.endingPrincipal.isNegative())).toBe(true);
      expect(activity[0]!.extraPrincipalPaid.compare(principal) <= 0).toBe(true);
      expect(activity.every((item) => item.contractualPayment.equals(activity[0]!.contractualPayment))).toBe(true);
      const payoffIndex = result.periods.findIndex((period) => period.endingPrincipal.isZero());
      expect(result.periods.slice(payoffIndex + 1).every((period) => period.liabilities.length === 0 && period.interestExpense.isZero() && period.principalReduction.isZero())).toBe(true);
    }), { numRuns: 20, seed: 10_005 });
  });

  it("keeps true liquidity and debt authority coherent whenever scheduled funding is insufficient", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 179_864 }), (cashCents) => {
      const cash = fromCents(cashCents); const principal = money("300000");
      const item = { ...loan(principal, 360), annualRate: Rate.fromDecimal("0.06", rateConvention.nominalAnnual(12)) };
      const result = runVerticalSlice4({ runContext: context(1), openingState: opening(principal, cash), input: input(item) });
      const outcome = result.periods[0]!.constraintOutcomes[0]!; const shortfall = result.periods[0]!.liquidityShortfalls[0]!;
      expect(outcome.status).toBe("unfunded");
      expect(outcome.acceptedAmount.isZero()).toBe(true);
      expect(result.state.accounts[ids.cash]!.cash.equals(cash)).toBe(true);
      expect(result.state.liabilities[ids.principal]!.balance.equals(principal)).toBe(true);
      expect(result.state.liabilities[ids.interest]!.balance.equals(money("1500"))).toBe(true);
      expect(shortfall.fundedAmount.equals(cash)).toBe(true);
      expect(shortfall.requestedAmount.equals(shortfall.fundedAmount.plus(shortfall.shortfallAmount))).toBe(true);
      expect(result.periods[0]!.constraintOutcomes.every((item) => item.status !== "contract_default" && item.status !== "rejected")).toBe(true);
    }), { numRuns: 24, seed: 10_006 });
  });

  it("never turns an unfunded voluntary extra into borrower debt", () => {
    fc.assert(fc.property(fc.integer({ min: 100, max: 500_000 }), fc.integer({ min: 2, max: 18 }), fc.integer({ min: 1, max: 500_000 }), (principalCents, term, extraCents) => {
      const principal = fromCents(principalCents); const extra = fromCents(extraCents);
      const cash = fixedMortgagePayment(principal, Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), term, rounding);
      const result = runVerticalSlice4({ runContext: context(1), openingState: opening(principal, cash), input: input(loan(principal, term, extra)) });
      const first = result.periods[0]!.liabilities[0]!;
      expect(first.scheduledFundingStatus).toBe("fully_satisfied");
      expect(first.extraFundingStatus).toBe("unfunded");
      expect(first.extraPrincipalPaid.isZero()).toBe(true);
      expect(Object.values(result.state.obligations).some((claim) => claim.kind === "obligation" && claim.category.includes("extra_principal") && claim.outstandingAmount.isPositive())).toBe(false);
    }), { numRuns: 20, seed: 10_007 });
  });
});
