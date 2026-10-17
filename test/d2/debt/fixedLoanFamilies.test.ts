import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertBalanced } from "../../../src/accounting/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../src/funding/index.js";
import { domainId } from "../../../src/identity/index.js";
import { createRunContext, runId, scenarioId } from "../../../src/simulation/run.js";
import {
  executePreparedVerticalSlice4Operation, executeVerticalSlice4PeriodCandidate, prepareVerticalSlice4Period, runVerticalSlice4,
  type FixedAmortizingLoan, type VerticalSlice4Input,
} from "../../../src/simulation/verticalSlice4.js";
import { createAuthoritativeState } from "../../../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../../../src/time/index.js";
import { Rate, RoundingPolicy, USD, money, rateConvention, sumMoney } from "../../../src/values/index.js";
import { catalogSchema } from "../../fixtures/d2/schema.js";

const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const owner = domainId("person", "71000000-0000-4000-8000-000000000001");
const household = domainId("household", "71000000-0000-4000-8000-000000000002");
const cashId = domainId("account", "71000000-0000-4000-8000-000000000003");
const uuid = (n: number) => `72000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const start = instant("2026-01-01T00:00:00.000Z");
const at = instant("2026-01-15T00:00:00.000Z");
const policy = createFundingPolicy({ id: fundingPolicyId("d2:fixed:cash"), orderedSources: [{ kind: "cash_account", accountId: cashId }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
const context = (months = 1) => createRunContext({ runId: runId(uuid(90)), scenarioId: scenarioId(uuid(91)), asOf: start, dataCutoff: start, simulationStart: start, simulationEnd: utcMonthlyPeriods(start, months)[months - 1]!.end, baseCurrency: USD });
const fromCents = (cents: string) => {
  const negative = cents.startsWith("-");
  const digits = (negative ? cents.slice(1) : cents).padStart(3, "0");
  return money(`${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`);
};
const loan = (family: FixedAmortizingLoan["debtFamily"], principal = "1000", rate = "0", term = 2, n = 1): FixedAmortizingLoan => ({
  ...(family === undefined ? {} : { debtFamily: family }),
  id: domainId("loan-contract", uuid(n * 10)), ownerId: owner,
  principalLiabilityId: domainId("liability", uuid(n * 10 + 1)), interestPayableLiabilityId: domainId("liability", uuid(n * 10 + 2)),
  originalPrincipal: money(principal), annualRate: Rate.fromDecimal(rate, rateConvention.nominalAnnual(12)), totalPayments: term,
  rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing",
  paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing",
  paymentSchedule: { kind: "utc_monthly", anchor: at, invalidDayPolicy: "skip" }, fundingPolicy: policy, settlementPriority: n,
  postingRounding: RoundingPolicy.currency(2, "half_up"),
  primitiveIds: { schedule: domainId("primitive-instance", uuid(n * 10 + 3)), amortization: domainId("primitive-instance", uuid(n * 10 + 4)), accrual: domainId("primitive-instance", uuid(n * 10 + 5)) },
});
const withExtra = (item: FixedAmortizingLoan, amount = "500"): FixedAmortizingLoan => ({ ...item, extraPrincipalPayments: [{ id: domainId("extra-principal-payment", uuid(80)), scheduledAt: at, amount: money(amount), fundingPolicy: policy, primitiveInstanceId: domainId("primitive-instance", uuid(81)) }] });
const input = (loans: readonly FixedAmortizingLoan[]): VerticalSlice4Input => ({ householdId: household, ownerId: owner, baseCurrency: USD, loans });
const opening = (loans: readonly FixedAmortizingLoan[], cash = "2000") => createAuthoritativeState({
  accounts: { [cashId]: { id: cashId, ownerId: owner, kind: "checking", cash: money(cash) } },
  liabilities: Object.fromEntries(loans.flatMap(item => [
    [item.principalLiabilityId, { id: item.principalLiabilityId, balance: item.originalPrincipal }],
    [item.interestPayableLiabilityId, { id: item.interestPayableLiabilityId, balance: money("0") }],
  ])),
});
const run = (loans: readonly FixedAmortizingLoan[], cash = "2000", months = 1) => runVerticalSlice4({ runContext: context(months), openingState: opening(loans, cash), input: input(loans) });

describe("D2 shared fixed-loan classification (no canonical admission or tax claim)", () => {
  it.each(["auto_zero_rate", "student_standard", "auto_final_interest", "consumer_extra_payoff"])("posts the independently supplied %s economic facts exactly", id => {
    const fixture = catalog.cases.find(item => item.id === id)!;
    const amounts = fixture.input.amounts;
    const terms = fixture.input.terms;
    const effects = fixture.expected.effects!;
    let item = loan(fixture.family === "student_loan" ? "student" : "auto", fromCents(amounts.principalCents!).amount.toString(), terms.annualRate!, Number(terms.remainingPayments));
    if (amounts.extraCents !== undefined) item = withExtra(item, fromCents(amounts.extraCents).amount.toString());
    const state = opening([item], fromCents(amounts.cashCents!).amount.toString());
    const before = JSON.stringify(state);
    const request = { runContext: context(), openingState: state, input: input([item]) };
    const result = runVerticalSlice4(request);
    expect(result.status).toBe("completed");
    const period = result.periods[0]!;
    expect(period.principalReduction.equals(fromCents(effects.facts.principalPaidCents!))).toBe(true);
    expect(period.interestExpense.equals(fromCents(effects.facts.interestPaidCents!))).toBe(true);
    expect(result.state.accounts[cashId]!.cash.equals(fromCents(effects.closingCents.cash!))).toBe(true);
    expect(result.state.liabilities[item.principalLiabilityId]!.balance.equals(fromCents(effects.closingCents.principal!))).toBe(true);
    expect(result.state.liabilities[item.interestPayableLiabilityId]!.balance.isZero()).toBe(true);
    expect(result.state.accounts[cashId]!.cash.minus(state.accounts[cashId]!.cash).equals(fromCents(effects.cashDeltaCents))).toBe(true);
    expect(period.statements.netWorth.minus(state.accounts[cashId]!.cash.minus(item.originalPrincipal)).equals(fromCents(effects.netWorthDeltaCents))).toBe(true);
    for (const tx of period.transactions) assertBalanced(tx);
    expect(JSON.stringify(state)).toBe(before);
    expect(runVerticalSlice4(request)).toEqual(result);
    // Conditional fixture accounting is not evidence of compiler/product support.
    expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
    expect(fixture.expected.capability).toBe("not_yet_executable");
  });

  it("preserves all default versus explicit mortgage outputs, identities and fingerprints", () => {
    const legacy = withExtra(loan(undefined, "1000.01", "0.031", 7), "10");
    const implicit = run([legacy], "3000", 7);
    expect(implicit.status).toBe("completed");
    expect(run([{ ...legacy, debtFamily: "mortgage" }], "3000", 7)).toEqual(implicit);
    const first = implicit.periods[0]!;
    expect(first.recognitions.map(item => item.category)).toContain("mortgage_interest_expense");
    expect(first.transactions.map(item => item.type)).toEqual(["mortgage_interest_recognition", "mortgage_interest_settlement", "mortgage_principal_payment", "mortgage_extra_principal"]);
    expect(first.recognitions[0]!.id).toBe(`recognition:mortgage-interest:${legacy.id}:${at}`);
  });

  it.each(["auto", "student"] as const)("keeps %s categories and trace evidence isolated through interest and extra payoff", family => {
    const item = withExtra(loan(family, "1000", "0.12", 2), "1000");
    const result = run([item]);
    expect(result.status).toBe("completed");
    const period = result.periods[0]!;
    const prefix = `${family}_loan_`;
    expect(period.recognitions.every(fact => fact.category.startsWith(prefix))).toBe(true);
    expect(period.effects.every(effect => effect.category.startsWith(prefix))).toBe(true);
    expect(Object.values(result.state.obligations).every(claim => claim.category.startsWith(prefix))).toBe(true);
    expect(period.transactions.every(tx => tx.type.startsWith(prefix))).toBe(true);
    expect(JSON.stringify(period)).not.toContain("mortgage");
    expect(period.liabilities[0]!.extraPrincipalPaid.isPositive()).toBe(true);
    expect(result.state.liabilities[item.principalLiabilityId]!.balance.isZero()).toBe(true);
    const replay = runVerticalSlice4({ runContext: context(), openingState: result.state, primitiveState: result.primitiveState, input: input([item]) });
    expect(replay.state).toEqual(result.state);
    expect(replay.primitiveState).toEqual(result.primitiveState);
    expect(replay.periods.flatMap(p => p.transactions)).toHaveLength(0);
  });

  it.each(["auto", "student"] as const)("rounds %s interest and the final cent without residual principal", family => {
    const item = loan(family, "1.01", "0.12", 2);
    const result = run([item], "2", 2);
    expect(result.status).toBe("completed");
    expect(result.periods.map(p => p.liabilities[0]!.scheduledPrincipalPaid.amount.toString())).toEqual(["0.5", "0.51"]);
    expect(sumMoney(result.periods.map(p => p.interestExpense)).equals(money("0.02"))).toBe(true);
    expect(result.state.accounts[cashId]!.cash.equals(money("0.97"))).toBe(true);
    expect(result.state.liabilities[item.principalLiabilityId]!.balance.isZero()).toBe(true);
    expect(result.periods[1]!.statements.netWorth.equals(money("0.97"))).toBe(true);
  });

  it.each(["auto", "student"] as const)("posts the same funded %s service through household prepared operations", family => {
    const item = withExtra(loan(family, "1000", "0.12", 2), "1000");
    const state = opening([item]);
    const before = JSON.stringify(state);
    const request = { runContext: context(), openingState: state, input: input([item]) };
    const standalone = runVerticalSlice4(request);
    const prepared = executeVerticalSlice4PeriodCandidate(request, utcMonthlyPeriods(start, 1)[0]!, state, {});
    expect(prepared.state).toEqual(standalone.state);
    expect(prepared.primitiveState).toEqual(standalone.primitiveState);
    expect(prepared.period.transactions).toEqual(standalone.periods[0]!.transactions);
    expect(prepared.period.recognitions).toEqual(standalone.periods[0]!.recognitions);
    expect(prepared.period.effects).toEqual(standalone.periods[0]!.effects);
    expect(JSON.stringify(prepared.period)).not.toContain("mortgage");
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each(["auto", "student"] as const)("retains funded %s required service when the extra is unaffordable", family => {
    const item = withExtra(loan(family), "1000");
    const result = run([item], "600");
    const liability = result.periods[0]!.liabilities[0]!;
    expect(liability.scheduledFundingStatus).toBe("fully_satisfied");
    expect(liability.extraFundingStatus).toBe("unfunded");
    expect(liability.scheduledPrincipalPaid.equals(money("500"))).toBe(true);
    expect(liability.extraPrincipalPaid.isZero()).toBe(true);
    expect(result.state.accounts[cashId]!.cash.equals(money("100"))).toBe(true);
    expect(result.state.liabilities[item.principalLiabilityId]!.balance.equals(money("500"))).toBe(true);
    expect(result.periods[0]!.liquidityShortfalls[0]!.origin).toBe("extra_principal");
    expect(Object.values(result.state.obligations).every(claim => claim.outstandingAmount.isZero())).toBe(true);
  });

  it.each(["auto", "student"] as const)("cannot bypass unfunded %s required service with an affordable extra", family => {
    const item = withExtra(loan(family, "1000", "0.12", 2), "10");
    const state = opening([item], "100");
    const result = run([item], "100");
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.liabilities[0]!.scheduledFundingStatus).toBe("unfunded");
    expect(result.periods[0]!.liabilities[0]!.extraPrincipalPaid.isZero()).toBe(true);
    expect(result.state.accounts[cashId]!.cash.equals(money("100"))).toBe(true);
    expect(result.state.liabilities[item.principalLiabilityId]!.balance.equals(money("1000"))).toBe(true);
    expect(result.state.liabilities[item.interestPayableLiabilityId]!.balance.equals(money("10"))).toBe(true);
    expect(result.periods[0]!.statements.netWorth.equals(money("-910"))).toBe(true);
    expect(result.periods[0]!.liquidityShortfalls[0]!.origin).toBe("required_debt_service");
    const prepared = prepareVerticalSlice4Period(context(), input([item]), utcMonthlyPeriods(start, 1)[0]!, state, {});
    const extra = prepared.operations.find(op => op.kind === "extra_principal")!;
    const premature = executePreparedVerticalSlice4Operation(prepared, extra, state, {}, input([item]), context());
    expect(premature.state).toEqual(state);
    expect(premature.transactions).toHaveLength(0);
    const afterUnfunded = executePreparedVerticalSlice4Operation(prepared, extra, result.state, result.primitiveState, input([item]), context());
    expect(afterUnfunded.state).toEqual(result.state);
    expect(afterUnfunded.transactions).toHaveLength(0);
  });

  it("uses explicit shared-cash priorities across all families independent of input ordering", () => {
    const items = [loan("mortgage", "1000", "0", 2, 1), loan("auto", "1000", "0", 2, 2), loan("student", "1000", "0", 2, 3)];
    const result = run(items, "1000");
    expect(result.status).toBe("completed");
    expect(run([...items].reverse(), "1000")).toEqual(result);
    expect(result.state.liabilities[items[0]!.principalLiabilityId]!.balance.equals(money("1000"))).toBe(true);
    for (const item of items.slice(1)) expect(result.state.liabilities[item.principalLiabilityId]!.balance.equals(money("500"))).toBe(true);
    expect(result.state.accounts[cashId]!.cash.isZero()).toBe(true);
    expect(() => run(items.map(item => ({ ...item, settlementPriority: 1 })))).toThrow(/distinct priorities/);
  });

  it("resolves every family's required service before a higher-priority family's extra", () => {
    const auto = withExtra(loan("auto", "1000", "0", 2, 3), "100");
    const student = loan("student", "1000", "0", 2, 2);
    const result = run([auto, student], "1000");
    expect(result.status).toBe("completed");
    for (const item of [auto, student]) expect(result.state.liabilities[item.principalLiabilityId]!.balance.equals(money("500"))).toBe(true);
    expect(result.periods[0]!.liabilities.find(item => item.loanId === auto.id)!.extraFundingStatus).toBe("unfunded");
    expect(run([student, auto], "1000")).toEqual(result);
  });

  it.each(["auto", "student"] as const)("reconciles %s arrears on resume without capitalizing or implicitly settling them", family => {
    const item = loan(family, "1000", "0.12", 3);
    const missed = run([item], "0", 2);
    expect(missed.status).toBe("completed");
    expect(missed.state.liabilities[item.principalLiabilityId]!.balance.equals(money("1000"))).toBe(true);
    expect(missed.state.liabilities[item.interestPayableLiabilityId]!.balance.equals(money("20"))).toBe(true);
    const snapshot = JSON.stringify(missed);
    // Explicit external opening cash for the resumed run; VS4 creates no funding.
    const fundedOpening = createAuthoritativeState({ ...missed.state, accounts: { ...missed.state.accounts, [cashId]: { ...missed.state.accounts[cashId]!, cash: money("2000") } } });
    const resumed = runVerticalSlice4({
      runContext: { ...context(3), simulationStart: instant("2026-03-01T00:00:00.000Z") },
      openingState: fundedOpening, primitiveState: missed.primitiveState, input: input([item]),
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.state.liabilities[item.principalLiabilityId]!.balance.isZero()).toBe(true);
    expect(resumed.state.liabilities[item.interestPayableLiabilityId]!.balance.isZero()).toBe(true);
    expect(resumed.state.accounts[cashId]!.cash.equals(money("970"))).toBe(true);
    expect(resumed.periods[0]!.interestExpense.equals(money("10"))).toBe(true);
    expect(Object.values(resumed.state.obligations).every(claim => claim.outstandingAmount.isZero())).toBe(true);
    expect(JSON.stringify(missed)).toBe(snapshot);
  });

  it("rejects duplicate identities and unsupported families/configurations without mutating input", () => {
    const item = loan("auto");
    const state = opening([item]);
    const before = JSON.stringify(state);
    const invalidLoans = [
      { ...item, debtFamily: "heloc" }, { ...item, debtFamily: "toString" }, { ...item, debtFamily: null },
      { ...item, rateType: "variable" }, { ...item, paymentFrequency: "daily" },
      { ...item, interestConvention: "daily" }, { ...item, interestCapitalization: "monthly" },
      { ...item, amortization: "income_driven" }, { ...item, paymentResetPolicy: "recast" },
      { ...item, partialPaymentPolicy: "partial" },
      { ...item, fundingPolicy: { ...policy, allowPartial: true } },
    ];
    for (const invalidLoan of invalidLoans) {
      expect(() => runVerticalSlice4({ runContext: context(), openingState: state, input: input([invalidLoan as FixedAmortizingLoan]) })).toThrow();
      expect(JSON.stringify(state)).toBe(before);
    }
    expect(() => run([item, { ...loan("student", "1000", "0", 2, 2), id: item.id }])).toThrow(/identities must be unique/);
    expect(() => run([item, { ...loan("student", "1000", "0", 2, 2), primitiveIds: item.primitiveIds }])).toThrow(/identities must be unique/);
  });

  it("rejects duplicate nonmortgage occurrences while preserving committed state", () => {
    const item = loan("student", "1000", "0.12", 2);
    const first = run([item]);
    const replay = runVerticalSlice4({ runContext: context(), openingState: first.state, primitiveState: first.primitiveState, input: input([item]) });
    expect(replay.status).toBe("incomplete");
    expect(replay.periods).toHaveLength(0);
    expect(replay.state).toEqual(first.state);
    expect(replay.primitiveState).toEqual(first.primitiveState);
    expect(replay.diagnostics.some(issue => issue.code === "DUPLICATE_GENERATED_OCCURRENCE")).toBe(true);
  });
});
