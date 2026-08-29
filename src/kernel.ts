export type Money = bigint;

export const money = (dollars: string): Money => {
  const raw = dollars.trim();
  const sign = raw.startsWith("-") ? -1n : 1n;
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole, frac = ""] = unsigned.split(".");
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(frac)) throw new Error(`Invalid money: ${dollars}`);
  return sign * (BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0")));
};

export const dollars = (v: Money): string => {
  const a = v < 0n ? -v : v;
  return `${v < 0n ? "-" : ""}$${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
};

export interface Period { start: string; end: string; }
export const month = (year: number, month1: number): Period => ({
  start: new Date(Date.UTC(year, month1 - 1, 1)).toISOString(),
  end: new Date(Date.UTC(year, month1, 1)).toISOString(),
});
export const inPeriod = (instant: string, p: Period) => instant >= p.start && instant < p.end;

export type AccountKind = "checking" | "brokerage" | "retirement";
export interface AccountState { id: string; kind: AccountKind; cash: Money; }
export interface PositionState { id: string; accountId: string; quantity: bigint; priceCents: Money; carryingCents: Money; }
export interface LiabilityState { id: string; balance: Money; rate: number; }
export interface SimulationState { accounts: Record<string, AccountState>; positions: Record<string, PositionState>; liabilities: Record<string, LiabilityState>; }

export type EffectKind = "flow" | "recognition" | "settlement" | "valuation" | "state";
export interface Effect { id: string; kind: EffectKind; amount?: Money; description: string; }
export interface AccountingLeg {
  posting: "debit" | "credit";
  type: "asset" | "liability" | "income" | "expense" | "gain" | "cash";
  amount: Money;
  accountId?: string;
  entityId?: string;
  quantity?: bigint;
}
export interface Transaction { id: string; type: string; date: string; cashFlow: "operating" | "investing" | "financing" | "non_cash"; legs: AccountingLeg[]; }
export interface Statements { assets: Money; liabilities: Money; netWorth: Money; income: Money; expenses: Money; gains: Money; operatingCashFlow: Money; investingCashFlow: Money; financingCashFlow: Money; }
export interface RunResult { state: SimulationState; effects: Effect[]; transactions: Transaction[]; statements: Statements; diagnostics: string[]; }

const clone = (s: SimulationState): SimulationState => structuredClone(s);
const sum = (xs: Money[]) => xs.reduce((a, b) => a + b, 0n);

export const assertBalanced = (t: Transaction) => {
  const d = sum(t.legs.filter(x => x.posting === "debit").map(x => x.amount));
  const c = sum(t.legs.filter(x => x.posting === "credit").map(x => x.amount));
  if (d !== c) throw new Error(`Unbalanced transaction ${t.id}: ${d} != ${c}`);
  if (!inPeriod(t.date, { start: "0000-01-01T00:00:00.000Z", end: "9999-12-31T23:59:59.999Z" })) throw new Error(`Invalid transaction date ${t.id}`);
};

export const posting = (id: string, date: string, type: string, cashFlow: Transaction["cashFlow"], legs: AccountingLeg[]): Transaction => {
  const t = { id, date, type, cashFlow, legs };
  assertBalanced(t);
  return t;
};

export class DependencyGraph {
  private edges = new Map<string, Set<string>>();
  addNode(id: string) { if (!this.edges.has(id)) this.edges.set(id, new Set()); }
  addEdge(from: string, to: string, lag = 0) { this.addNode(from); this.addNode(to); if (lag === 0) this.edges.get(from)!.add(to); }
  topologicalOrder(): string[] {
    const indegree = new Map([...this.edges.keys()].map(k => [k, 0]));
    for (const tos of this.edges.values()) for (const to of tos) indegree.set(to, (indegree.get(to) ?? 0) + 1);
    const ready = [...indegree].filter(([, d]) => d === 0).map(([k]) => k).sort();
    const out: string[] = [];
    while (ready.length) {
      const n = ready.shift()!; out.push(n);
      for (const to of this.edges.get(n)!) { const d = indegree.get(to)! - 1; indegree.set(to, d); if (d === 0) { ready.push(to); ready.sort(); } }
    }
    if (out.length !== indegree.size) throw new Error("Invalid zero-lag dependency cycle");
    return out;
  }
}

export interface KernelEvent { id: string; dependsOn?: string[]; lag?: number; effect: Effect; transaction: (date: string) => Transaction; }

function applyTransaction(state: SimulationState, t: Transaction) {
  assertBalanced(t);
  for (const leg of t.legs) {
    const sign = leg.posting === "debit" ? 1n : -1n;
    if (leg.type === "cash") {
      if (!leg.accountId || !state.accounts[leg.accountId]) throw new Error(`Unknown cash account in ${t.id}`);
      state.accounts[leg.accountId].cash += sign * leg.amount;
    } else if (leg.type === "liability") {
      if (!leg.entityId || !state.liabilities[leg.entityId]) throw new Error(`Unknown liability in ${t.id}`);
      state.liabilities[leg.entityId].balance += sign * leg.amount;
    } else if (leg.type === "asset" && leg.entityId) {
      const p = state.positions[leg.entityId];
      if (!p) throw new Error(`Unknown position in ${t.id}`);
      p.carryingCents += sign * leg.amount;
      if (leg.quantity !== undefined) p.quantity += sign * leg.quantity;
      if (p.quantity < 0n) throw new Error(`Negative position quantity in ${t.id}`);
    }
  }
}

export class SemanticRunner {
  constructor(private readonly initial: SimulationState) {}
  run(period: Period, events: KernelEvent[]): RunResult {
    const state = clone(this.initial);
    const effects: Effect[] = [], transactions: Transaction[] = [];
    const graph = new DependencyGraph();
    for (const e of events) { graph.addNode(e.id); for (const dep of e.dependsOn ?? []) graph.addEdge(dep, e.id, e.lag ?? 0); }
    const byId = new Map(events.map(e => [e.id, e]));
    for (const id of graph.topologicalOrder()) {
      const e = byId.get(id)!;
      if (!inPeriod(e.transaction(period.end.slice(0, 10) + "T00:00:00.000Z").date).date, period)) { /* date validation below */ }
      const t = e.transaction(period.end.slice(0, 10) + "T00:00:00.000Z");
      if (!inPeriod(t.date, period)) throw new Error(`Event ${e.id} produced transaction outside period`);
      effects.push(e.effect); transactions.push(t); applyTransaction(state, t);
    }
    return { state, effects, transactions, statements: deriveStatements(state, transactions, effects), diagnostics: [] };
  }
}

export class GoldenRunner {
  constructor(private readonly initial: SimulationState) {}
  run(period: Period, events: KernelEvent[]): RunResult { return new SemanticRunner(this.initial).run(period, events); }
}

function deriveStatements(state: SimulationState, tx: Transaction[], effects: Effect[]): Statements {
  const assets = sum(Object.values(state.accounts).map(a => a.cash)) + sum(Object.values(state.positions).map(p => p.quantity * p.priceCents));
  const liabilities = sum(Object.values(state.liabilities).map(l => l.balance));
  const amount = (type: AccountingLeg["type"]) => sum(tx.flatMap(t => t.legs.filter(l => l.type === type && l.posting === "credit").map(l => l.amount)));
  const cf = (k: Transaction["cashFlow"]) => sum(tx.filter(t => t.cashFlow === k).flatMap(t => t.legs.filter(l => l.type === "cash").map(l => l.posting === "debit" ? l.amount : -l.amount)));
  return { assets, liabilities, netWorth: assets - liabilities, income: amount("income"), expenses: amount("expense"), gains: amount("gain"), operatingCashFlow: cf("operating"), investingCashFlow: cf("investing"), financingCashFlow: cf("financing") };
}

export function fixedMortgagePayment(principalCents: Money, annualRate: number, remainingPayments: number): Money {
  if (!Number.isFinite(annualRate) || remainingPayments <= 0) throw new Error("Invalid mortgage terms");
  const r = annualRate / 12, p = Number(principalCents) / 100;
  const payment = r === 0 ? p / remainingPayments : p * r * Math.pow(1 + r, remainingPayments) / (Math.pow(1 + r, remainingPayments) - 1);
  return BigInt(Math.round(payment * 100));
}

export function mortgageInterest(principalCents: Money, annualRate: number): Money {
  return BigInt(Math.round(Number(principalCents) * annualRate / 12));
}

export function mortgagePrincipal(paymentCents: Money, interestCents: Money, balanceCents: Money): Money {
  return paymentCents - interestCents > balanceCents ? balanceCents : paymentCents - interestCents;
}
