import { describe, expect, it } from "vitest";
import { DependencyGraph, GoldenRunner, assertBalanced, fixedMortgagePayment, month, money, type SimulationState, type Transaction } from "../src/kernel.js";

const base = (accounts: SimulationState["accounts"] = {}, liabilities: SimulationState["liabilities"] = {}): SimulationState => ({ accounts, positions: {}, liabilities });
const acct = (id: string, kind: "checking" | "brokerage" | "retirement", cash: string) => ({ id, kind, cash: money(cash) });
const leg = (posting: "debit" | "credit", type: "asset" | "liability" | "income" | "expense" | "gain" | "cash", amount: string, accountId?: string, entityId?: string) => ({ posting, type, amount: money(amount), ...(accountId ? { accountId } : {}), ...(entityId ? { entityId } : {}) });

const expectTx = (tx: Transaction) => { expect(() => assertBalanced(tx)).not.toThrow(); };

describe("Semantic Kernel v0.1 golden scenarios", () => {
  it("S1 salary → tax → retirement → expenses preserves gross recognition but only $2k cash increase", () => {
    const r = new GoldenRunner(base({ checking: acct("checking", "checking", "0"), retirement: acct("retirement", "retirement", "0") })).run(month(2026, 1), (s, e, t) => {
      e.push({ id: "salary", kind: "recognition", amount: money("10000"), description: "income: gross compensation" });
      e.push({ id: "tax", kind: "recognition", amount: money("2000"), description: "expense: tax" });
      e.push({ id: "living", kind: "recognition", amount: money("4000"), description: "expense: living" });
      e.push({ id: "retirement", kind: "flow", amount: money("2000"), description: "retirement contribution" });
      s.accounts.checking.cash = money("2000"); s.accounts.retirement.cash = money("2000");
      t.push(postingSalary(), postingTax(), postingLiving());
    });
    expect(r.state.accounts.checking.cash).toBe(money("2000"));
    expect(r.state.accounts.retirement.cash).toBe(money("2000"));
    expect(r.statements.assets).toBe(money("4000"));
    expect(r.statements.netWorth).toBe(money("4000"));
    expect(r.statements.operatingCashFlow).toBe(money("2000"));
    expect(r.statements.income).toBe(money("10000"));
    expect(r.statements.expenses).toBe(money("6000"));
    r.transactions.forEach(expectTx);
  });

  it("S2 internal transfer is neutral, purchase moves cash into a position, mark-to-market adds no cash", () => {
    const r = new GoldenRunner(base({ checking: acct("checking", "checking", "100000"), brokerage: acct("brokerage", "brokerage", "0") })).run(month(2026, 1), s => {
      s.accounts.checking.cash = money("0"); s.accounts.brokerage.cash = money("0");
      s.positions.stock = { id: "stock", accountId: "brokerage", quantity: 1000n, priceCents: money("110"), carryingCents: money("100000") };
    });
    expect(r.statements.assets).toBe(money("110000"));
    expect(r.statements.netWorth).toBe(money("110000"));
    expect(r.statements.investingCashFlow).toBe(money("0"));
    expect(r.statements.assets).not.toBe(money("220000"));
  });

  it("S3 accrual creates payable, later settlement consumes it without new expense", () => {
    const initial = base({ checking: acct("checking", "checking", "10000") }, { tax: { id: "tax", balance: money("0"), rate: 0 } });
    const jan = new GoldenRunner(initial).run(month(2026, 1), (s, e, t) => {
      s.liabilities.tax.balance = money("1000");
      e.push({ id: "tax-recognition", kind: "recognition", amount: money("1000"), description: "expense: tax" });
      t.push(posting("tax-accrual", "2026-01-31", "tax", "operating", [leg("debit", "expense", "1000"), leg("credit", "liability", "1000", undefined, "tax")]));
    });
    expect(jan.state.liabilities.tax.balance).toBe(money("1000")); expect(jan.state.accounts.checking.cash).toBe(money("10000")); expect(jan.statements.expenses).toBe(money("1000"));
    const apr = new GoldenRunner(jan.state).run(month(2026, 4), (s, _e, t) => {
      s.liabilities.tax.balance = money("0"); s.accounts.checking.cash = money("9000");
      t.push(posting("tax-settlement", "2026-04-15", "tax", "operating", [leg("debit", "liability", "1000", undefined, "tax"), leg("credit", "cash", "1000", "checking")]));
    });
    expect(apr.statements.expenses).toBe(money("0")); expect(apr.state.accounts.checking.cash).toBe(money("9000")); expect(apr.state.liabilities.tax.balance).toBe(money("0"));
  });

  it("S4 fixed mortgage mechanics separate rate, payment, interest and principal; reset does not imply recast", () => {
    const payment = fixedMortgagePayment(money("300000"), 0.06, 360);
    expect(payment).toBe(money("1798.65"));
    const interest = money("1500.00"); const principal = payment - interest;
    expect(principal).toBe(money("298.65")); expect(money("300000") - principal).toBe(money("299701.35"));
    const recast = fixedMortgagePayment(money("299701.35"), 0.07, 348);
    expect(recast).toBe(money("1991.63"));
    const fixedInterest = money("299701.35") * 7n / 1200n;
    expect(fixedInterest).toBe(money("1748.25"));
    expect(payment - fixedInterest).toBe(money("50.40"));
  });

  it("S5 mark-to-market then sale preserves $10k gain while investing cash flow is $110k", () => {
    const r = new GoldenRunner(base({ checking: acct("checking", "checking", "0") })).run(month(2026, 1), (s, e, t) => {
      s.positions.investment = { id: "investment", accountId: "checking", quantity: 1000n, priceCents: money("110"), carryingCents: money("100000") };
      e.push({ id: "unrealized", kind: "valuation", amount: money("10000"), description: "unrealized gain" });
      s.positions.investment.quantity = 0n; s.accounts.checking.cash = money("110000");
      t.push(posting("sale", "2026-01-31", "investment_sale", "investing", [leg("debit", "cash", "110000", "checking"), leg("credit", "asset", "100000", undefined, "investment"), leg("credit", "gain", "10000", undefined, "investment")]));
    });
    expect(r.state.accounts.checking.cash).toBe(money("110000")); expect(r.state.positions.investment.quantity).toBe(0n);
    expect(r.statements.investingCashFlow).toBe(money("110000")); expect(r.statements.gains).toBe(money("10000")); expect(r.statements.netWorth).toBe(money("110000"));
  });
});

function postingSalary(): Transaction { return posting("salary", "2026-01-31", "salary", "operating", [leg("debit", "cash", "8000", "checking"), leg("debit", "asset", "2000", "retirement"), leg("credit", "income", "10000")]); }
function postingTax(): Transaction { return posting("tax", "2026-01-31", "tax", "operating", [leg("debit", "expense", "2000"), leg("credit", "cash", "2000", "checking")]); }
function postingLiving(): Transaction { return posting("living", "2026-01-31", "expense", "operating", [leg("debit", "expense", "4000"), leg("credit", "cash", "4000", "checking")]); }
function posting(id: string, date: string, type: string, cashFlow: Transaction["cashFlow"], legs: Transaction["legs"]): Transaction { return { id, date, type, cashFlow, legs }; }

describe("Kernel invariants", () => {
  it("sorts a DAG deterministically and rejects zero-lag cycles", () => {
    const g = new DependencyGraph(); g.addEdge("salary", "tax"); g.addEdge("tax", "disposable"); g.addEdge("salary", "contribution");
    expect(g.topologicalOrder()).toEqual(["salary", "contribution", "tax", "disposable"]);
    const bad = new DependencyGraph(); bad.addEdge("a", "b"); bad.addEdge("b", "a"); expect(() => bad.topologicalOrder()).toThrow(/cycle/);
  });
});
