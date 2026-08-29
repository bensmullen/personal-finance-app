import { type Instant, type Period, inPeriod, instant } from "./time.js";
import type { DomainId } from "./identity.js";
import {
  type DecimalAmount,
  Money,
  Quantity,
  Rate,
  RateBasis,
  RoundingPolicy,
  USD,
  decimal,
  sumMoney,
} from "./values.js";

export { instant, period, utcMonth, type Period } from "./time.js";
export { domainId, type DomainId } from "./identity.js";
export { Money, Rate, RateBasis, RoundingPolicy, formatMoney, money, rateConvention } from "./values.js";

export type AccountId = DomainId<"account">;
export type PositionId = DomainId<"position">;
export type LiabilityId = DomainId<"liability">;
export type AccountKind = "checking" | "brokerage" | "retirement";
export interface AccountState { id: AccountId; kind: AccountKind; cash: Money; }
export interface PositionState {
  id: PositionId;
  accountId: AccountId;
  quantity: Quantity;
  price: Money;
  carryingValue: Money;
}
export interface LiabilityState { id: LiabilityId; balance: Money; rate: Rate; }
export interface SimulationState {
  accounts: Record<string, AccountState>;
  positions: Record<string, PositionState>;
  liabilities: Record<string, LiabilityState>;
}
export type EffectKind = "flow" | "recognition" | "settlement" | "valuation" | "state";
export interface Effect { id: string; kind: EffectKind; amount?: Money; description: string; }
export interface AccountingLeg {
  posting: "debit" | "credit";
  type: "asset" | "liability" | "income" | "expense" | "gain" | "cash";
  amount: Money;
  accountId?: AccountId;
  entityId?: PositionId | LiabilityId;
  quantity?: Quantity;
}
export interface Transaction {
  id: string;
  type: string;
  date: Instant;
  cashFlow: "operating" | "investing" | "financing" | "non_cash";
  legs: AccountingLeg[];
}
export interface Statements {
  assets: Money;
  liabilities: Money;
  netWorth: Money;
  income: Money;
  expenses: Money;
  gains: Money;
  operatingCashFlow: Money;
  investingCashFlow: Money;
  financingCashFlow: Money;
}
export interface RunResult {
  state: SimulationState;
  effects: Effect[];
  transactions: Transaction[];
  statements: Statements;
  diagnostics: string[];
}

const clone = (state: SimulationState): SimulationState => ({
  accounts: Object.fromEntries(Object.entries(state.accounts).map(([key, value]) => [key, { ...value }])),
  positions: Object.fromEntries(Object.entries(state.positions).map(([key, value]) => [key, { ...value }])),
  liabilities: Object.fromEntries(Object.entries(state.liabilities).map(([key, value]) => [key, { ...value }])),
});

export const assertBalanced = (transaction: Transaction): void => {
  const currency = transaction.legs[0]?.amount.currency ?? USD;
  for (const leg of transaction.legs) {
    if (!leg.amount.amount.fitsScale(leg.amount.currency.minorUnitScale)) {
      throw new Error(`Posted amount in ${transaction.id} exceeds ${leg.amount.currency.code} settlement precision`);
    }
  }
  const debits = sumMoney(transaction.legs.filter((leg) => leg.posting === "debit").map((leg) => leg.amount), currency);
  const credits = sumMoney(transaction.legs.filter((leg) => leg.posting === "credit").map((leg) => leg.amount), currency);
  if (!debits.equals(credits)) throw new Error(`Unbalanced transaction ${transaction.id}: ${debits.amount} != ${credits.amount}`);
};

export const posting = (
  id: string,
  date: string | Instant,
  type: string,
  cashFlow: Transaction["cashFlow"],
  legs: AccountingLeg[],
): Transaction => {
  const transaction = { id, date: instant(date), type, cashFlow, legs };
  assertBalanced(transaction);
  return transaction;
};

export class DependencyGraph {
  private edges = new Map<string, Set<string>>();
  addNode(id: string): void { if (!this.edges.has(id)) this.edges.set(id, new Set()); }
  addEdge(from: string, to: string, lag = 0): void {
    this.addNode(from);
    this.addNode(to);
    if (lag === 0) this.edges.get(from)!.add(to);
  }
  topologicalOrder(): string[] {
    const indegree = new Map([...this.edges.keys()].map((key) => [key, 0]));
    for (const targets of this.edges.values()) {
      for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
    const ready = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key).sort();
    const output: string[] = [];
    while (ready.length > 0) {
      const node = ready.shift()!;
      output.push(node);
      for (const target of this.edges.get(node)!) {
        const degree = indegree.get(target)! - 1;
        indegree.set(target, degree);
        if (degree === 0) {
          ready.push(target);
          ready.sort();
        }
      }
    }
    if (output.length !== indegree.size) throw new Error("Invalid zero-lag dependency cycle");
    return output;
  }
}

export interface KernelEvent {
  id: string;
  date: Instant;
  dependsOn?: string[];
  lag?: number;
  effect: Effect;
  transaction: Transaction;
}

function applyTransaction(state: SimulationState, transaction: Transaction): void {
  assertBalanced(transaction);
  for (const leg of transaction.legs) {
    const signedAmount = leg.posting === "debit" ? leg.amount : leg.amount.negated();
    if (leg.type === "cash") {
      if (!leg.accountId) throw new Error(`Missing cash account in ${transaction.id}`);
      const account = state.accounts[leg.accountId];
      if (!account) throw new Error(`Unknown cash account in ${transaction.id}`);
      account.cash = account.cash.plus(signedAmount);
    } else if (leg.type === "liability") {
      if (!leg.entityId) throw new Error(`Missing liability in ${transaction.id}`);
      const liability = state.liabilities[leg.entityId];
      if (!liability) throw new Error(`Unknown liability in ${transaction.id}`);
      liability.balance = liability.balance.minus(signedAmount);
      if (liability.balance.isNegative()) throw new Error(`Negative liability balance in ${transaction.id}`);
    } else if (leg.type === "asset" && leg.entityId) {
      const position = state.positions[leg.entityId];
      if (!position) throw new Error(`Unknown position in ${transaction.id}`);
      position.carryingValue = position.carryingValue.plus(signedAmount);
      if (leg.quantity) {
        position.quantity = leg.posting === "debit"
          ? position.quantity.plus(leg.quantity)
          : position.quantity.minus(leg.quantity);
      }
      if (position.quantity.isNegative() || position.carryingValue.isNegative()) {
        throw new Error(`Negative position balance in ${transaction.id}`);
      }
    }
  }
}

export class SemanticRunner {
  constructor(private readonly initial: SimulationState) {}

  run(targetPeriod: Period, events: KernelEvent[]): RunResult {
    const state = clone(this.initial);
    const effects: Effect[] = [];
    const transactions: Transaction[] = [];
    const graph = new DependencyGraph();
    for (const event of events) {
      graph.addNode(event.id);
      for (const dependency of event.dependsOn ?? []) graph.addEdge(dependency, event.id, event.lag ?? 0);
    }
    const byId = new Map(events.map((event) => [event.id, event]));
    for (const id of graph.topologicalOrder()) {
      const event = byId.get(id);
      if (!event) throw new Error(`Unknown dependency node ${id}`);
      if (!inPeriod(event.date, targetPeriod)) throw new Error(`Event ${event.id} is outside period`);
      if (event.transaction.date !== event.date) throw new Error(`Transaction date mismatch for ${event.id}`);
      assertBalanced(event.transaction);
      effects.push(event.effect);
      transactions.push(event.transaction);
      applyTransaction(state, event.transaction);
    }
    return { state, effects, transactions, statements: deriveStatements(state, transactions), diagnostics: [] };
  }
}

export class GoldenRunner {
  constructor(private readonly initial: SimulationState) {}
  run(targetPeriod: Period, events: KernelEvent[]): RunResult { return new SemanticRunner(this.initial).run(targetPeriod, events); }
}

function deriveStatements(state: SimulationState, transactions: Transaction[]): Statements {
  const accountValues = Object.values(state.accounts).map((account) => account.cash);
  const positionValues = Object.values(state.positions).map((position) => position.price.times(position.quantity.amount));
  const currency = accountValues[0]?.currency ?? positionValues[0]?.currency ?? USD;
  const assets = sumMoney([...accountValues, ...positionValues], currency);
  const liabilities = sumMoney(Object.values(state.liabilities).map((liability) => liability.balance), currency);
  const total = (type: AccountingLeg["type"], side: AccountingLeg["posting"]): Money =>
    sumMoney(transactions.flatMap((transaction) => transaction.legs
      .filter((leg) => leg.type === type && leg.posting === side)
      .map((leg) => leg.amount)), currency);
  const cashFlow = (cashFlowClass: Transaction["cashFlow"]): Money =>
    sumMoney(transactions.filter((transaction) => transaction.cashFlow === cashFlowClass)
      .flatMap((transaction) => transaction.legs
        .filter((leg) => leg.type === "cash")
        .map((leg) => leg.posting === "debit" ? leg.amount : leg.amount.negated())), currency);
  return {
    assets,
    liabilities,
    netWorth: assets.minus(liabilities),
    income: total("income", "credit"),
    expenses: total("expense", "debit"),
    gains: total("gain", "credit"),
    operatingCashFlow: cashFlow("operating"),
    investingCashFlow: cashFlow("investing"),
    financingCashFlow: cashFlow("financing"),
  };
}

const divisionPrecision = new RoundingPolicy(30, "half_even");

const monthlyNominalRate = (annualRate: Rate): DecimalAmount => {
  if (annualRate.convention.basis !== RateBasis.NominalAnnual || annualRate.convention.compoundingPeriodsPerYear !== 12) {
    throw new Error("Monthly mortgage rate requires nominal annual convention with 12 contractual compounding periods");
  }
  return annualRate.value.dividedBy(decimal(annualRate.convention.compoundingPeriodsPerYear.toString()), divisionPrecision);
};

export function fixedMortgagePayment(
  principal: Money,
  annualRate: Rate,
  remainingPayments: number,
  postingRounding: RoundingPolicy,
): Money {
  if (!Number.isSafeInteger(remainingPayments) || remainingPayments <= 0 || principal.isNegative()) {
    throw new Error("Invalid mortgage terms");
  }
  const periodicRate = monthlyNominalRate(annualRate);
  const unrounded = periodicRate.isZero()
    ? principal.amount.dividedBy(decimal(remainingPayments.toString()), divisionPrecision)
    : (() => {
        const factor = decimal("1").plus(periodicRate).pow(remainingPayments);
        return principal.amount.times(periodicRate).times(factor).dividedBy(factor.minus(decimal("1")), divisionPrecision);
      })();
  return new Money(unrounded.round(postingRounding), principal.currency);
}

export function mortgageInterest(principal: Money, annualRate: Rate, accrualRounding: RoundingPolicy): Money {
  const interest = principal.amount.times(monthlyNominalRate(annualRate)).round(accrualRounding);
  return new Money(interest, principal.currency);
}

export function mortgagePrincipal(payment: Money, interest: Money, balance: Money): Money {
  const principal = payment.minus(interest);
  return principal.compare(balance) > 0 ? balance : principal;
}
