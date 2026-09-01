import { describe, expect, it } from "vitest";
import { createFundingPolicy, fundingPolicyId, resolveFunding } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { claimId, createObligation, createSettlementProposal, recognitionId, settlementProposalId } from "../src/semantics/index.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Quantity, Rate, RoundingPolicy, SHARE, USD, money, rateConvention, ratePeriod } from "../src/values/index.js";
import { runVerticalSlice3, type VerticalSlice3Input } from "../src/verticalSlice3.js";
import { runVerticalSlice2, type VerticalSlice2Input } from "../src/verticalSlice2.js";

const ids = {
  household: domainId("household", "40000000-0000-4000-8000-000000000001"),
  owner: domainId("person", "40000000-0000-4000-8000-000000000002"),
  checking: domainId("account", "40000000-0000-4000-8000-000000000003"),
  savings: domainId("account", "40000000-0000-4000-8000-000000000004"),
  brokerage: domainId("account", "40000000-0000-4000-8000-000000000005"),
  position: domainId("position", "40000000-0000-4000-8000-000000000006"),
  position2: domainId("position", "40000000-0000-4000-8000-000000000007"),
  payable: domainId("liability", "40000000-0000-4000-8000-000000000008"),
  salary: domainId("income", "40000000-0000-4000-8000-000000000009"),
};
const primitive = (suffix: number) => domainId("primitive-instance", `41000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`);
const start = instant("2026-01-01T00:00:00.000Z");
const at = (day: string) => instant(`2026-01-${day}T00:00:00.000Z`);
const priceRounding = RoundingPolicy.currency(2, "half_up");
const quantityRounding = new RoundingPolicy(12, "half_even");
const monthlyRate = (value: string) => Rate.fromDecimal(value, rateConvention.periodic(ratePeriod("1", "calendar_month")));
const returnBasis = { kind: "periodic" as const, period: ratePeriod("1", "calendar_month") };

const contextFrom = (simulationStart: ReturnType<typeof instant>, months: number, run: string) => {
  const periods = utcMonthlyPeriods(simulationStart, months);
  return createRunContext({
    runId: runId(run), scenarioId: scenarioId("42000000-0000-4000-8000-000000000002"),
    asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"),
    simulationStart, simulationEnd: periods[periods.length - 1]!.end, baseCurrency: USD,
  });
};
const context = (months = 1, run = "42000000-0000-4000-8000-000000000001") => contextFrom(start, months, run);

const opening = (checking = "1000") => createAuthoritativeState({
  accounts: {
    [ids.checking]: { id: ids.checking, ownerId: ids.owner, kind: "checking", cash: money(checking) },
    [ids.savings]: { id: ids.savings, ownerId: ids.owner, kind: "savings", cash: money("100") },
    [ids.brokerage]: { id: ids.brokerage, ownerId: ids.owner, kind: "brokerage", cash: money("0") },
  },
  positions: {
    [ids.position]: { id: ids.position, accountId: ids.brokerage, quantity: Quantity.zero(SHARE), price: money("10"), carryingValue: money("0") },
    [ids.position2]: { id: ids.position2, accountId: ids.brokerage, quantity: Quantity.parse("2", SHARE), price: money("5"), carryingValue: money("10") },
  },
});

const baseInput = (): VerticalSlice3Input => ({
  householdId: ids.household,
  ownerId: ids.owner,
  baseCurrency: USD,
  transfers: [{ id: domainId("transfer", "43000000-0000-4000-8000-000000000001"), sourceAccountId: ids.checking, destinationAccountId: ids.savings, amount: money("100"), schedule: { kind: "explicit_instants", instants: [at("05")] }, order: 10, schedulePrimitiveId: primitive(1) }],
  purchases: [{ id: domainId("investment-purchase", "43000000-0000-4000-8000-000000000002"), sourceCashAccountId: ids.checking, destinationAccountId: ids.brokerage, targetPositionId: ids.position, amount: money("200"), quantityRounding, schedule: { kind: "explicit_instants", instants: [at("10")] }, order: 20, schedulePrimitiveId: primitive(2) }],
  fees: [{ id: domainId("investment-fee", "43000000-0000-4000-8000-000000000003"), cashAccountId: ids.checking, amount: money("5"), schedule: { kind: "explicit_instants", instants: [at("20")] }, order: 30, schedulePrimitiveId: primitive(3) }],
  returns: [
    { targetPositionId: ids.position, accountId: ids.brokerage, rate: monthlyRate("0.1"), returnBasis, timing: "end_of_period_on_closing_quantity", priceRounding, primitiveIds: { compounding: primitive(4), markToMarket: primitive(5) } },
    { targetPositionId: ids.position2, accountId: ids.brokerage, rate: monthlyRate("0"), returnBasis, timing: "end_of_period_on_closing_quantity", priceRounding, primitiveIds: { compounding: primitive(6), markToMarket: primitive(7) } },
  ],
});

describe("Vertical Slice 3 savings and investments", () => {
  it("preserves transfer value, exchanges purchase principal, marks positions once, and separates gains", () => {
    const result = runVerticalSlice3({ runContext: context(), openingState: opening(), input: baseInput(), months: 1 });
    expect(result.status).toBe("completed");
    expect(result.state.accounts[ids.checking]!.cash.equals(money("695"))).toBe(true);
    expect(result.state.accounts[ids.savings]!.cash.equals(money("200"))).toBe(true);
    expect(result.state.positions[ids.position]!.quantity.equals(Quantity.parse("20", SHARE))).toBe(true);
    expect(result.state.positions[ids.position]!.carryingValue.equals(money("200"))).toBe(true);
    expect(result.state.positions[ids.position]!.price.equals(money("11"))).toBe(true);
    const period = result.periods[0]!;
    expect(period.contributionPrincipal.equals(money("200"))).toBe(true);
    expect(period.unrealizedGain.equals(money("20"))).toBe(true);
    expect(period.realizedGain.equals(money("0"))).toBe(true);
    expect(period.cashInvestmentIncome.equals(money("0"))).toBe(true);
    expect(period.portfolioValue.equals(money("230"))).toBe(true);
    expect(period.accountValues[ids.brokerage]!.equals(money("230"))).toBe(true);
    expect(period.statements.assets.equals(money("1125"))).toBe(true);
    expect(period.statements.netWorth.equals(money("1125"))).toBe(true);
    expect(period.statements.investingCashFlow.equals(money("-200"))).toBe(true);
    expect(period.effects.filter((effect) => effect.kind === "valuation")).toHaveLength(2);
    expect(period.traceRefs.some((ref) => ref.traceId.includes("valuation"))).toBe(true);
    expect(period.transactions.every((tx) => tx.type !== "mark_to_market")).toBe(true);
  });

  it("keeps a pure savings transfer neutral and zero return unchanged", () => {
    const input = baseInput();
    const transferOnly: VerticalSlice3Input = { ...input, purchases: [], fees: [], returns: input.returns.map((item) => ({ ...item, rate: monthlyRate("0") })) };
    const before = opening();
    const result = runVerticalSlice3({ runContext: context(), openingState: before, input: transferOnly });
    expect(result.state.accounts[ids.checking]!.cash.equals(money("900"))).toBe(true);
    expect(result.state.accounts[ids.savings]!.cash.equals(money("200"))).toBe(true);
    expect(result.periods[0]!.statements.assets.equals(money("1110"))).toBe(true);
    expect(result.periods[0]!.unrealizedGain.equals(money("0"))).toBe(true);
    expect(result.periods[0]!.statements.operatingCashFlow.equals(money("0"))).toBe(true);
  });

  it("aggregates multiple positions without adding the brokerage container twice", () => {
    const input = baseInput();
    const result = runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...input, transfers: [], purchases: [], fees: [], returns: input.returns.map((item) => ({ ...item, rate: monthlyRate("0") })) } });
    expect(result.periods[0]!.portfolioValue.equals(money("10"))).toBe(true);
    expect(result.periods[0]!.accountValues[ids.brokerage]!.equals(money("10"))).toBe(true);
    expect(result.periods[0]!.statements.assets.equals(money("1110"))).toBe(true);
  });

  it("uses only named cash accounts for funding and never liquidates a position", () => {
    const claim = createObligation({ id: claimId("claim:funding"), category: "expense", originatingRecognitionId: recognitionId("recognition:funding"), economicOwnerId: ids.owner, originalAmount: money("150"), recognizedAt: at("02") });
    const proposal = createSettlementProposal({ id: settlementProposalId("proposal:funding"), claimId: claim.id, requestedAmount: money("150"), requestedAt: at("03") }, claim);
    const configured = resolveFunding(proposal, claim, createFundingPolicy({ id: fundingPolicyId("policy:savings"), orderedSources: [{ kind: "cash_account", accountId: ids.savings }], allowPartial: true, insufficientFundsBehavior: "unfunded" }), { [ids.checking]: money("0"), [ids.savings]: money("100"), [ids.brokerage]: money("0") });
    expect(configured.acceptedAmount.equals(money("100"))).toBe(true);
    const unconfigured = resolveFunding(proposal, claim, createFundingPolicy({ id: fundingPolicyId("policy:checking"), orderedSources: [{ kind: "cash_account", accountId: ids.checking }], allowPartial: false, insufficientFundsBehavior: "unfunded" }), { [ids.checking]: money("0"), [ids.savings]: money("100"), [ids.brokerage]: money("0") });
    expect(unconfigured.acceptedAmount.equals(money("0"))).toBe(true);
    expect(unconfigured.liquidityShortfall?.fundedAmount.equals(money("0"))).toBe(true);
  });

  it("rolls back position and primitive state when source cash is insufficient", () => {
    const input = baseInput();
    const failed = runVerticalSlice3({ runContext: context(), openingState: opening("0"), input: { ...input, transfers: [], fees: [] } });
    expect(failed.status).toBe("incomplete");
    expect(failed.periods).toHaveLength(0);
    expect(failed.state.accounts[ids.checking]!.cash.equals(money("0"))).toBe(true);
    expect(failed.state.positions[ids.position]!.quantity.equals(Quantity.zero(SHARE))).toBe(true);
    expect(failed.state.positions[ids.position]!.price.equals(money("10"))).toBe(true);
    expect(Object.keys(failed.primitiveState)).toHaveLength(0);
    expect(failed.state.identities.postedTransactionIds).toHaveLength(0);
    expect(failed.state.identities.generatedOccurrenceKeys).toHaveLength(0);
  });

  it("is deterministic and independent of independent configuration array order", () => {
    const input = baseInput();
    const first = runVerticalSlice3({ runContext: context(), openingState: opening(), input });
    const second = runVerticalSlice3({ runContext: context(1, "42000000-0000-4000-8000-000000000003"), openingState: opening(), input: { ...input, returns: [...input.returns].reverse() } });
    expect(first.state.accounts).toEqual(second.state.accounts);
    expect(first.state.positions).toEqual(second.state.positions);
    expect(first.periods.map((item) => [item.portfolioValue, item.unrealizedGain])).toEqual(second.periods.map((item) => [item.portfolioValue, item.unrealizedGain]));
    expect(first.runMetadata.inputFingerprint).toBe(second.runMetadata.inputFingerprint);
    expect(first.periods[0]!.effects).toEqual(second.periods[0]!.effects);
  });

  it("compounds a compact two-year monthly contribution scenario", () => {
    const input = baseInput();
    const recurring: VerticalSlice3Input = {
      ...input,
      transfers: [], fees: [],
      purchases: [{ ...input.purchases[0]!, amount: money("100"), schedule: { kind: "utc_monthly", anchor: instant("2026-01-10T00:00:00.000Z"), invalidDayPolicy: "skip" } }],
      returns: input.returns.map((item) => ({ ...item, rate: item.targetPositionId === ids.position ? monthlyRate("0.01") : monthlyRate("0") })),
    };
    const result = runVerticalSlice3({ runContext: context(24), openingState: opening("3000"), input: recurring, months: 24 });
    expect(result.status).toBe("completed");
    expect(result.periods).toHaveLength(24);
    expect(result.periods[0]!.portfolioValue.amount.toString()).toBe("111");
    expect(result.periods[11]!.portfolioValue.amount.toString()).toBe("1291.29754708127165");
    expect(result.periods[23]!.portfolioValue.amount.toString()).toBe("2733.36359695042834");
    expect(result.state.accounts[ids.checking]!.cash.equals(money("600"))).toBe(true);
    expect(result.periods.every((item) => item.realizedGain.isZero() && item.cashInvestmentIncome.isZero())).toBe(true);
  });

  it("feeds a multi-year VS2 household surplus into the investment slice", () => {
    const cashFlowOpening = opening("0");
    const withPayable = createAuthoritativeState({ ...cashFlowOpening, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } });
    const cashFlowInput: VerticalSlice2Input = {
      householdId: ids.household, ownerId: ids.owner, cashAccountId: ids.checking, expensePayableLiabilityId: ids.payable, baseCurrency: USD,
      incomes: [{ id: ids.salary, ownerId: ids.owner, depositAccountId: ids.checking, baseMonthlyAmount: money("200"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, growthRate: monthlyRate("0"), growthBaseAt: instant("2026-01-15T00:00:00.000Z"), primitiveIds: { growth: primitive(20), recurrence: primitive(21) } }],
      expenses: [], events: [],
    };
    const cashFlow = runVerticalSlice2({ runContext: context(24, "42000000-0000-4000-8000-000000000004"), openingState: withPayable, input: cashFlowInput, months: 24 });
    expect(cashFlow.status).toBe("completed");
    expect(cashFlow.state.accounts[ids.checking]!.cash.equals(money("4800"))).toBe(true);

    const investmentStart = instant("2028-01-01T00:00:00.000Z");
    const input = baseInput();
    const investmentInput: VerticalSlice3Input = {
      ...input, transfers: [], fees: [],
      purchases: [{ ...input.purchases[0]!, amount: money("100"), schedule: { kind: "utc_monthly", anchor: instant("2028-01-10T00:00:00.000Z"), invalidDayPolicy: "skip" } }],
      returns: input.returns.map((item) => ({ ...item, rate: item.targetPositionId === ids.position ? monthlyRate("0.01") : monthlyRate("0") })),
    };
    const invested = runVerticalSlice3({ runContext: contextFrom(investmentStart, 24, "42000000-0000-4000-8000-000000000005"), openingState: cashFlow.state, input: investmentInput, months: 24 });
    expect(invested.status).toBe("completed");
    expect(invested.state.accounts[ids.checking]!.cash.equals(money("2400"))).toBe(true);
    expect(invested.periods[23]!.portfolioValue.amount.toString()).toBe("2733.36359695042834");
    expect(invested.periods[23]!.statements.netWorth.compare(money("5233.36359695042834"))).toBe(0);
  });
});
