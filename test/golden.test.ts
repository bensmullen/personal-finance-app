import { describe, expect, it } from "vitest";
import { DependencyGraph, GoldenRunner, Rate, RoundingPolicy, assertBalanced, domainId, fixedMortgagePayment, instant, mortgageInterest, mortgagePrincipal, money, posting, rateConvention, utcMonth, type AccountId, type KernelEvent, type LiabilityId, type PositionId, type SimulationState } from "../src/kernel.js";
import { Quantity, SHARE } from "../src/values.js";

const base = (accounts: SimulationState["accounts"] = {}, liabilities: SimulationState["liabilities"] = {}): SimulationState => ({ accounts, positions: {}, liabilities });
const acct = (id: AccountId, kind: "checking" | "brokerage" | "retirement", cash: string) => ({ id, kind, cash: money(cash) });
const leg = (postingSide: "debit" | "credit", type: "asset" | "liability" | "income" | "expense" | "gain" | "cash", amount: string, accountId?: AccountId, entityId?: PositionId | LiabilityId, quantity?: string) => ({ posting: postingSide, type, amount: money(amount), ...(accountId ? { accountId } : {}), ...(entityId ? { entityId } : {}), ...(quantity !== undefined ? { quantity: Quantity.parse(quantity, SHARE) } : {}) });
const event = (id: string, date: string, effect: KernelEvent["effect"], transaction: KernelEvent["transaction"], dependsOn?: string[]): KernelEvent => ({ id, date: instant(date), effect, transaction, ...(dependsOn ? { dependsOn } : {}) });
const expectMoney = (actual: ReturnType<typeof money>, expected: string): void => expect(actual.equals(money(expected))).toBe(true);

const CHECKING = domainId("account", "00000000-0000-4000-8000-000000000001");
const BROKERAGE = domainId("account", "00000000-0000-4000-8000-000000000002");
const RETIREMENT = domainId("account", "00000000-0000-4000-8000-000000000003");
const STOCK = domainId("position", "00000000-0000-4000-8000-000000000011");
const INVESTMENT = domainId("position", "00000000-0000-4000-8000-000000000012");
const TAX = domainId("liability", "00000000-0000-4000-8000-000000000021");
const USD_POSTING = RoundingPolicy.currency(2, "half_up");

describe("Semantic Kernel v0.1 golden scenarios", () => {
  it("S1 executes salary → retirement → tax → expenses through the semantic runner", () => {
    const initial = base({ [CHECKING]: acct(CHECKING, "checking", "0"), [RETIREMENT]: acct(RETIREMENT, "retirement", "0") });
    const events: KernelEvent[] = [
      event("salary", "2026-01-31T12:00:00.000Z", { id: "salary-recognition", kind: "recognition", amount: money("10000"), description: "gross compensation" }, posting("salary", "2026-01-31T12:00:00.000Z", "salary", "operating", [leg("debit", "cash", "10000", CHECKING), leg("credit", "income", "10000")])),
      event("retirement", "2026-01-31T12:01:00.000Z", { id: "retirement-flow", kind: "flow", amount: money("2000"), description: "retirement contribution" }, posting("retirement", "2026-01-31T12:01:00.000Z", "retirement_transfer", "operating", [leg("debit", "cash", "2000", RETIREMENT), leg("credit", "cash", "2000", CHECKING)]), ["salary"]),
      event("tax", "2026-01-31T12:02:00.000Z", { id: "tax-recognition", kind: "recognition", amount: money("2000"), description: "tax expense" }, posting("tax", "2026-01-31T12:02:00.000Z", "tax", "operating", [leg("debit", "expense", "2000"), leg("credit", "cash", "2000", CHECKING)]), ["salary"]),
      event("living", "2026-01-31T12:03:00.000Z", { id: "living-recognition", kind: "recognition", amount: money("4000"), description: "living expense" }, posting("living", "2026-01-31T12:03:00.000Z", "living", "operating", [leg("debit", "expense", "4000"), leg("credit", "cash", "4000", CHECKING)]), ["salary"]),
    ];
    const r = new GoldenRunner(initial).run(utcMonth(2026, 1), events);
    expectMoney(r.state.accounts[CHECKING]!.cash, "2000"); expectMoney(r.state.accounts[RETIREMENT]!.cash, "2000");
    expectMoney(r.statements.assets, "4000"); expectMoney(r.statements.netWorth, "4000"); expectMoney(r.statements.operatingCashFlow, "4000");
    expectMoney(r.statements.income, "10000"); expectMoney(r.statements.expenses, "6000"); r.transactions.forEach(assertBalanced);
  });

  it("S2 transfer is neutral, purchase creates a position, and mark-to-market creates no cash", () => {
    const initial = base({ [CHECKING]: acct(CHECKING, "checking", "100000"), [BROKERAGE]: acct(BROKERAGE, "brokerage", "0") });
    initial.positions[STOCK] = { id: STOCK, accountId: BROKERAGE, quantity: Quantity.zero(SHARE), price: money("110"), carryingValue: money("0") };
    const events: KernelEvent[] = [
      event("transfer", "2026-01-05T12:00:00.000Z", { id: "transfer", kind: "flow", amount: money("100000"), description: "internal transfer" }, posting("transfer", "2026-01-05T12:00:00.000Z", "internal_transfer", "non_cash", [leg("debit", "cash", "100000", BROKERAGE), leg("credit", "cash", "100000", CHECKING)])),
      event("purchase", "2026-01-10T12:00:00.000Z", { id: "purchase", kind: "flow", amount: money("100000"), description: "investment purchase" }, posting("purchase", "2026-01-10T12:00:00.000Z", "investment_purchase", "investing", [leg("debit", "asset", "100000", undefined, STOCK, "1000"), leg("credit", "cash", "100000", BROKERAGE)]), ["transfer"]),
      event("mark", "2026-01-31T12:00:00.000Z", { id: "mark", kind: "valuation", amount: money("10000"), description: "investment mark-to-market" }, posting("mark", "2026-01-31T12:00:00.000Z", "mark_to_market", "non_cash", [leg("debit", "asset", "10000", undefined, STOCK), leg("credit", "gain", "10000", undefined, STOCK)]), ["purchase"]),
    ];
    const r = new GoldenRunner(initial).run(utcMonth(2026, 1), events);
    expectMoney(r.state.accounts[CHECKING]!.cash, "0"); expectMoney(r.state.accounts[BROKERAGE]!.cash, "0");
    expect(r.state.positions[STOCK]!.quantity.equals(Quantity.parse("1000", SHARE))).toBe(true); expectMoney(r.state.positions[STOCK]!.carryingValue, "110000");
    expectMoney(r.statements.assets, "110000"); expectMoney(r.statements.investingCashFlow, "-100000"); expectMoney(r.statements.gains, "10000");
  });

  it("S3 accrual creates a payable, and later settlement consumes it without new expense", () => {
    const initial = base({ [CHECKING]: acct(CHECKING, "checking", "10000") }, { [TAX]: { id: TAX, balance: money("0"), rate: Rate.fromPercentage("0", rateConvention.nominalAnnual(12)) } });
    const jan = new GoldenRunner(initial).run(utcMonth(2026, 1), [event("tax-accrual", "2026-01-31T12:00:00.000Z", { id: "tax-recognition", kind: "recognition", amount: money("1000"), description: "tax expense" }, posting("tax-accrual", "2026-01-31T12:00:00.000Z", "tax_accrual", "operating", [leg("debit", "expense", "1000"), leg("credit", "liability", "1000", undefined, TAX)]))]);
    expectMoney(jan.state.liabilities[TAX]!.balance, "1000"); expectMoney(jan.state.accounts[CHECKING]!.cash, "10000"); expectMoney(jan.statements.expenses, "1000");
    const apr = new GoldenRunner(jan.state).run(utcMonth(2026, 4), [event("tax-settlement", "2026-04-15T12:00:00.000Z", { id: "tax-settlement", kind: "settlement", amount: money("1000"), description: "settle tax payable" }, posting("tax-settlement", "2026-04-15T12:00:00.000Z", "tax_settlement", "operating", [leg("debit", "liability", "1000", undefined, TAX), leg("credit", "cash", "1000", CHECKING)]))]);
    expectMoney(apr.statements.expenses, "0"); expectMoney(apr.state.accounts[CHECKING]!.cash, "9000"); expectMoney(apr.state.liabilities[TAX]!.balance, "0");
  });

  it("S4 uses one fixed payment for 12 months and separately tests reset/recast", () => {
    const sixPercent = Rate.fromPercentage("6", rateConvention.nominalAnnual(12));
    const sevenPercent = Rate.fromPercentage("7", rateConvention.nominalAnnual(12));
    const payment = fixedMortgagePayment(money("300000"), sixPercent, 360, USD_POSTING); expectMoney(payment, "1798.65");
    let balance = money("300000");
    for (let i = 0; i < 12; i++) { const interest = mortgageInterest(balance, sixPercent, USD_POSTING); const principal = mortgagePrincipal(payment, interest, balance); balance = balance.minus(principal); }
    expectMoney(balance, "296316.00");
    const resetInterest = mortgageInterest(balance, sevenPercent, USD_POSTING); expectMoney(resetInterest, "1728.51");
    expectMoney(fixedMortgagePayment(balance, sevenPercent, 348, USD_POSTING), "1991.63");
    expectMoney(money("1991.63").minus(resetInterest), "263.12");
    expectMoney(fixedMortgagePayment(money("10000"), Rate.fromPercentage("0", rateConvention.nominalAnnual(12)), 12, USD_POSTING), "833.33");
    expect(() => fixedMortgagePayment(money("10000"), Rate.fromPercentage("6", rateConvention.nominalAnnual(2)), 12, USD_POSTING)).toThrow(/12 contractual/);
  });

  it("S5 mark-to-market recognizes the $10k gain, then sale realizes the marked carrying value for $110k cash", () => {
    const initial = base({ [CHECKING]: acct(CHECKING, "checking", "0") });
    initial.positions[INVESTMENT] = { id: INVESTMENT, accountId: CHECKING, quantity: Quantity.parse("1000", SHARE), price: money("100"), carryingValue: money("100000") };
    const events: KernelEvent[] = [
      event("mark", "2026-01-15T12:00:00.000Z", { id: "unrealized", kind: "valuation", amount: money("10000"), description: "unrealized gain" }, posting("mark", "2026-01-15T12:00:00.000Z", "mark_to_market", "non_cash", [leg("debit", "asset", "10000", undefined, INVESTMENT), leg("credit", "gain", "10000", undefined, INVESTMENT)])),
      event("sale", "2026-01-31T12:00:00.000Z", { id: "sale", kind: "settlement", amount: money("110000"), description: "investment sale" }, posting("sale", "2026-01-31T12:00:00.000Z", "investment_sale", "investing", [leg("debit", "cash", "110000", CHECKING), leg("credit", "asset", "110000", undefined, INVESTMENT, "1000")]), ["mark"]),
    ];
    const r = new GoldenRunner(initial).run(utcMonth(2026, 1), events);
    expectMoney(r.state.accounts[CHECKING]!.cash, "110000"); expect(r.state.positions[INVESTMENT]!.quantity.equals(Quantity.zero(SHARE))).toBe(true); expectMoney(r.state.positions[INVESTMENT]!.carryingValue, "0");
    expectMoney(r.statements.investingCashFlow, "110000"); expectMoney(r.statements.gains, "10000"); expectMoney(r.statements.netWorth, "110000");
  });
});

describe("Kernel invariants", () => {
  it("sorts a DAG deterministically and rejects zero-lag cycles", () => {
    const g = new DependencyGraph(); g.addEdge("salary", "tax"); g.addEdge("tax", "disposable"); g.addEdge("salary", "contribution"); expect(g.topologicalOrder()).toEqual(["salary", "contribution", "tax", "disposable"]);
    const bad = new DependencyGraph(); bad.addEdge("a", "b"); bad.addEdge("b", "a"); expect(() => bad.topologicalOrder()).toThrow(/cycle/);
  });
  it("enforces the half-open period and preserves the opening state on failure", () => {
    const initial = base({ [CHECKING]: acct(CHECKING, "checking", "1000") }); const before = JSON.stringify(initial);
    const bad = [event("late", "2026-02-01T00:00:00.000Z", { id: "late", kind: "flow", description: "outside" }, posting("late", "2026-02-01T00:00:00.000Z", "late", "operating", [leg("debit", "cash", "1", CHECKING), leg("credit", "income", "1")]))];
    expect(() => new GoldenRunner(initial).run(utcMonth(2026, 1), bad)).toThrow(/outside period/); expect(JSON.stringify(initial)).toBe(before);
  });
});
