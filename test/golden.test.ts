import { describe, expect, it } from "vitest";
import { DependencyGraph, GoldenRunner, assertBalanced, fixedMortgagePayment, mortgageInterest, mortgagePrincipal, month, money, posting, type KernelEvent, type SimulationState } from "../src/kernel.js";

const base = (accounts: SimulationState["accounts"] = {}, liabilities: SimulationState["liabilities"] = {}): SimulationState => ({ accounts, positions: {}, liabilities });
const acct = (id: string, kind: "checking" | "brokerage" | "retirement", cash: string) => ({ id, kind, cash: money(cash) });
const leg = (postingSide: "debit" | "credit", type: "asset" | "liability" | "income" | "expense" | "gain" | "cash", amount: string, accountId?: string, entityId?: string, quantity?: bigint) => ({ posting: postingSide, type, amount: money(amount), ...(accountId ? { accountId } : {}), ...(entityId ? { entityId } : {}), ...(quantity !== undefined ? { quantity } : {}) });
const event = (id: string, date: string, effect: KernelEvent["effect"], transaction: KernelEvent["transaction"], dependsOn?: string[]): KernelEvent => ({ id, date, effect, transaction, ...(dependsOn ? { dependsOn } : {}) });

describe("Semantic Kernel v0.1 golden scenarios", () => {
  it("S1 executes salary → retirement → tax → expenses through the semantic runner", () => {
    const initial = base({ checking: acct("checking", "checking", "0"), retirement: acct("retirement", "retirement", "0") });
    const events: KernelEvent[] = [
      event("salary", "2026-01-31T12:00:00.000Z", { id: "salary-recognition", kind: "recognition", amount: money("10000"), description: "gross compensation" }, posting("salary", "2026-01-31T12:00:00.000Z", "salary", "operating", [leg("debit", "cash", "10000", "checking"), leg("credit", "income", "10000")])),
      event("retirement", "2026-01-31T12:01:00.000Z", { id: "retirement-flow", kind: "flow", amount: money("2000"), description: "retirement contribution" }, posting("retirement", "2026-01-31T12:01:00.000Z", "retirement_transfer", "operating", [leg("debit", "cash", "2000", "retirement"), leg("credit", "cash", "2000", "checking")]), ["salary"]),
      event("tax", "2026-01-31T12:02:00.000Z", { id: "tax-recognition", kind: "recognition", amount: money("2000"), description: "tax expense" }, posting("tax", "2026-01-31T12:02:00.000Z", "tax", "operating", [leg("debit", "expense", "2000"), leg("credit", "cash", "2000", "checking")]), ["salary"]),
      event("living", "2026-01-31T12:03:00.000Z", { id: "living-recognition", kind: "recognition", amount: money("4000"), description: "living expense" }, posting("living", "2026-01-31T12:03:00.000Z", "living", "operating", [leg("debit", "expense", "4000"), leg("credit", "cash", "4000", "checking")]), ["salary"]),
    ];
    const r = new GoldenRunner(initial).run(month(2026, 1), events);
    expect(r.state.accounts.checking!.cash).toBe(money("2000")); expect(r.state.accounts.retirement!.cash).toBe(money("2000"));
    expect(r.statements.assets).toBe(money("4000")); expect(r.statements.netWorth).toBe(money("4000")); expect(r.statements.operatingCashFlow).toBe(money("2000"));
    expect(r.statements.income).toBe(money("10000")); expect(r.statements.expenses).toBe(money("6000")); r.transactions.forEach(assertBalanced);
  });

  it("S2 transfer is neutral, purchase creates a position, and mark-to-market creates no cash", () => {
    const initial = base({ checking: acct("checking", "checking", "100000"), brokerage: acct("brokerage", "brokerage", "0") });
    initial.positions.stock = { id: "stock", accountId: "brokerage", quantity: 0n, priceCents: money("110"), carryingCents: 0n };
    const events: KernelEvent[] = [
      event("transfer", "2026-01-05T12:00:00.000Z", { id: "transfer", kind: "flow", amount: money("100000"), description: "internal transfer" }, posting("transfer", "2026-01-05T12:00:00.000Z", "internal_transfer", "non_cash", [leg("debit", "cash", "100000", "brokerage"), leg("credit", "cash", "100000", "checking")])),
      event("purchase", "2026-01-10T12:00:00.000Z", { id: "purchase", kind: "flow", amount: money("100000"), description: "investment purchase" }, posting("purchase", "2026-01-10T12:00:00.000Z", "investment_purchase", "investing", [leg("debit", "asset", "100000", undefined, "stock", 1000n), leg("credit", "cash", "100000", "brokerage")]), ["transfer"]),
      event("mark", "2026-01-31T12:00:00.000Z", { id: "mark", kind: "valuation", amount: money("10000"), description: "investment mark-to-market" }, posting("mark", "2026-01-31T12:00:00.000Z", "mark_to_market", "non_cash", [leg("debit", "asset", "10000", undefined, "stock"), leg("credit", "gain", "10000", undefined, "stock")]), ["purchase"]),
    ];
    const r = new GoldenRunner(initial).run(month(2026, 1), events);
    expect(r.state.accounts.checking!.cash).toBe(money("0")); expect(r.state.accounts.brokerage!.cash).toBe(money("0"));
    expect(r.state.positions.stock!.quantity).toBe(1000n); expect(r.state.positions.stock!.carryingCents).toBe(money("110000"));
    expect(r.statements.assets).toBe(money("110000")); expect(r.statements.investingCashFlow).toBe(money("-100000")); expect(r.statements.gains).toBe(money("10000"));
  });

  it("S3 accrual creates a payable, and later settlement consumes it without new expense", () => {
    const initial = base({ checking: acct("checking", "checking", "10000") }, { tax: { id: "tax", balance: money("0"), rate: 0 } });
    const jan = new GoldenRunner(initial).run(month(2026, 1), [event("tax-accrual", "2026-01-31T12:00:00.000Z", { id: "tax-recognition", kind: "recognition", amount: money("1000"), description: "tax expense" }, posting("tax-accrual", "2026-01-31T12:00:00.000Z", "tax_accrual", "operating", [leg("debit", "expense", "1000"), leg("credit", "liability", "1000", undefined, "tax")]))]);
    expect(jan.state.liabilities.tax!.balance).toBe(money("1000")); expect(jan.state.accounts.checking!.cash).toBe(money("10000")); expect(jan.statements.expenses).toBe(money("1000"));
    const apr = new GoldenRunner(jan.state).run(month(2026, 4), [event("tax-settlement", "2026-04-15T12:00:00.000Z", { id: "tax-settlement", kind: "settlement", amount: money("1000"), description: "settle tax payable" }, posting("tax-settlement", "2026-04-15T12:00:00.000Z", "tax_settlement", "operating", [leg("debit", "liability", "1000", undefined, "tax"), leg("credit", "cash", "1000", "checking")]))]);
    expect(apr.statements.expenses).toBe(money("0")); expect(apr.state.accounts.checking!.cash).toBe(money("9000")); expect(apr.state.liabilities.tax!.balance).toBe(money("0"));
  });

  it("S4 uses one fixed payment for 12 months and separately tests reset/recast", () => {
    const payment = fixedMortgagePayment(money("300000"), 0.06, 360); expect(payment).toBe(money("1798.65"));
    let balance = money("300000");
    for (let i = 0; i < 12; i++) { const interest = mortgageInterest(balance, 0.06); const principal = mortgagePrincipal(payment, interest, balance); balance -= principal; }
    expect(balance).toBe(money("296316.00"));
    const resetInterest = mortgageInterest(balance, 0.07); expect(resetInterest).toBe(money("1728.51"));
    expect(fixedMortgagePayment(balance, 0.07, 348)).toBe(money("1991.63"));
    expect(money("1991.63") - resetInterest).toBe(money("263.12"));
  });

  it("S5 mark-to-market recognizes the $10k gain, then sale realizes the marked carrying value for $110k cash", () => {
    const initial = base({ checking: acct("checking", "checking", "0") });
    initial.positions.investment = { id: "investment", accountId: "checking", quantity: 1000n, priceCents: money("100"), carryingCents: money("100000") };
    const events: KernelEvent[] = [
      event("mark", "2026-01-15T12:00:00.000Z", { id: "unrealized", kind: "valuation", amount: money("10000"), description: "unrealized gain" }, posting("mark", "2026-01-15T12:00:00.000Z", "mark_to_market", "non_cash", [leg("debit", "asset", "10000", undefined, "investment"), leg("credit", "gain", "10000", undefined, "investment")])),
      event("sale", "2026-01-31T12:00:00.000Z", { id: "sale", kind: "settlement", amount: money("110000"), description: "investment sale" }, posting("sale", "2026-01-31T12:00:00.000Z", "investment_sale", "investing", [leg("debit", "cash", "110000", "checking"), leg("credit", "asset", "110000", undefined, "investment", 1000n)]), ["mark"]),
    ];
    const r = new GoldenRunner(initial).run(month(2026, 1), events);
    expect(r.state.accounts.checking!.cash).toBe(money("110000")); expect(r.state.positions.investment!.quantity).toBe(0n); expect(r.state.positions.investment!.carryingCents).toBe(money("0"));
    expect(r.statements.investingCashFlow).toBe(money("110000")); expect(r.statements.gains).toBe(money("10000")); expect(r.statements.netWorth).toBe(money("110000"));
  });
});

describe("Kernel invariants", () => {
  it("sorts a DAG deterministically and rejects zero-lag cycles", () => {
    const g = new DependencyGraph(); g.addEdge("salary", "tax"); g.addEdge("tax", "disposable"); g.addEdge("salary", "contribution"); expect(g.topologicalOrder()).toEqual(["salary", "contribution", "tax", "disposable"]);
    const bad = new DependencyGraph(); bad.addEdge("a", "b"); bad.addEdge("b", "a"); expect(() => bad.topologicalOrder()).toThrow(/cycle/);
  });
  it("enforces the half-open period and preserves the opening state on failure", () => {
    const initial = base({ checking: acct("checking", "checking", "1000") }); const before = structuredClone(initial);
    const bad = [event("late", "2026-02-01T00:00:00.000Z", { id: "late", kind: "flow", description: "outside" }, posting("late", "2026-02-01T00:00:00.000Z", "late", "operating", [leg("debit", "cash", "1", "checking"), leg("credit", "income", "1")]))];
    expect(() => new GoldenRunner(initial).run(month(2026, 1), bad)).toThrow(/outside period/); expect(initial).toEqual(before);
  });
});
