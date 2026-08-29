export type Money = bigint;
export const money = (dollars: string): Money => {
  const [whole, frac = ""] = dollars.replace(/^\+/, "").split(".");
  const sign = dollars.startsWith("-") ? -1n : 1n;
  const w = whole.replace("-", "") || "0";
  if (!/^\d+$/.test(w) || !/^\d{0,2}$/.test(frac)) throw new Error(`Invalid money: ${dollars}`);
  return sign * (BigInt(w) * 100n + BigInt(frac.padEnd(2, "0") || "0"));
};
export const dollars = (v: Money): string => `${v < 0n ? "-" : ""}$${(v < 0n ? -v : v) / 100n}.${((v < 0n ? -v : v) % 100n).toString().padStart(2, "0")}`;

export interface Period { start: string; end: string; }
export const month = (year: number, month1: number): Period => {
  const start = new Date(Date.UTC(year, month1 - 1, 1));
  const end = new Date(Date.UTC(year, month1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
};
export const inPeriod = (instant: string, p: Period) => instant >= p.start && instant < p.end;

export type AccountKind = "checking" | "brokerage" | "retirement";
export interface AccountState { id: string; kind: AccountKind; cash: Money; }
export interface PositionState { id: string; accountId: string; quantity: bigint; priceCents: Money; carryingCents: Money; }
export interface LiabilityState { id: string; balance: Money; rate: number; }
export interface SimulationState { accounts: Record<string, AccountState>; positions: Record<string, PositionState>; liabilities: Record<string, LiabilityState>; }

export type Effect = { id: string; kind: "flow" | "recognition" | "settlement" | "valuation" | "state"; amount?: Money; description: string };
export interface AccountingLeg { posting: "debit" | "credit"; type: "asset" | "liability" | "income" | "expense" | "gain" | "cash"; accountId?: string; entityId?: string; amount: Money; }
export interface Transaction { id: string; type: string; date: string; cashFlow: "operating" | "investing" | "financing" | "non_cash"; legs: AccountingLeg[]; }
export interface Statements { assets: Money; liabilities: Money; netWorth: Money; income: Money; expenses: Money; gains: Money; operatingCashFlow: Money; investingCashFlow: Money; financingCashFlow: Money; }
export interface RunResult { state: SimulationState; effects: Effect[]; transactions: Transaction[]; statements: Statements; diagnostics: string[]; }

const clone = (s: SimulationState): SimulationState => JSON.parse(JSON.stringify(s, (_k, v) => typeof v === "bigint" ? `${v}n` : v), (_k, v) => typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const sum = (xs: Money[]) => xs.reduce((a, b) => a + b, 0n);
const posting = (id: string, date: string, type: string, cashFlow: Transaction["cashFlow"], legs: AccountingLeg[]): Transaction => {
  const debits = sum(legs.filter(x => x.posting === "debit").map(x => x.amount));
  const credits = sum(legs.filter(x => x.posting === "credit").map(x => x.amount));
  if (debits !== credits) throw new Error(`Unbalanced transaction ${id}: ${debits} != ${credits}`);
  return { id, date, type, cashFlow, legs };
};

export class DependencyGraph {
  private edges = new Map<string, Set<string>>();
  addNode(id: string) { if (!this.edges.has(id)) this.edges.set(id, new Set()); }
  addEdge(from: string, to: string, lag = 0) { this.addNode(from); this.addNode(to); if (lag === 0) this.edges.get(from)!.add(to); }
  topologicalOrder(): string[] {
    const indegree = new Map([...this.edges.keys()].map(k => [k, 0]));
    for (const tos of this.edges.values()) for (const to of tos) indegree.set(to, (indegree.get(to) ?? 0) + 1);
    const ready = [...indegree].filter(([, d]) => d === 0).map(([k]) => k).sort(); const out: string[] = [];
    while (ready.length) { const n = ready.shift()!; out.push(n); for (const to of this.edges.get(n)!) { const d = indegree.get(to)! - 1; indegree.set(to, d); if (d === 0) { ready.push(to); ready.sort(); } } }
    if (out.length !== indegree.size) throw new Error("Invalid zero-lag dependency cycle");
    return out;
  }
}

export class GoldenRunner {
  constructor(private readonly initial: SimulationState) {}
  run(period: Period, work: (state: SimulationState, effects: Effect[], tx: Transaction[]) => void): RunResult {
    const state = clone(this.initial); const effects: Effect[] = []; const tx: Transaction[] = [];
    work(state, effects, tx);
    const diagnostics: string[] = [];
    const assets = sum(Object.values(state.accounts).map(a => a.cash)) + sum(Object.values(state.positions).map(p => p.quantity * p.priceCents));
    const liabilities = sum(Object.values(state.liabilities).map(l => l.balance));
    const income = sum(effects.filter(e => e.kind === "recognition" && e.description.includes("income")).map(e => e.amount ?? 0n));
    const expenses = sum(effects.filter(e => e.kind === "recognition" && e.description.includes("expense")).map(e => e.amount ?? 0n));
    const gains = sum(effects.filter(e => e.kind === "valuation").map(e => e.amount ?? 0n));
    const cf = (k: Transaction["cashFlow"]) => sum(tx.filter(t => t.cashFlow === k).flatMap(t => t.legs.filter(l => l.type === "cash").map(l => l.posting === "debit" ? l.amount : -l.amount)));
    const statements = { assets, liabilities, netWorth: assets - liabilities, income, expenses, gains, operatingCashFlow: cf("operating"), investingCashFlow: cf("investing"), financingCashFlow: cf("financing") };
    if (assets - liabilities !== statements.netWorth) diagnostics.push("Accounting closure failed");
    return { state, effects, transactions: tx, statements, diagnostics };
  }
}

export const assertBalanced = (t: Transaction) => { const d = sum(t.legs.filter(l => l.posting === "debit").map(l => l.amount)); const c = sum(t.legs.filter(l => l.posting === "credit").map(l => l.amount)); if (d !== c) throw new Error(`Unbalanced transaction ${t.id}`); };

export function fixedMortgagePayment(principalCents: Money, annualRate: number, remainingPayments: number): Money {
  const r = annualRate / 12; const p = Number(principalCents) / 100;
  const payment = r === 0 ? p / remainingPayments : p * r * Math.pow(1 + r, remainingPayments) / (Math.pow(1 + r, remainingPayments) - 1);
  return BigInt(Math.round(payment * 100));
}
