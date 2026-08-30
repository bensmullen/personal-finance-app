import { type Instant, type Period, inPeriod, instant } from "./time.js";
import type { DomainId } from "./identity.js";
import {
  accountingTransactionId,
  cashFlowAmount,
  createAccountingLeg,
  createAccountingTransaction,
  type AccountingLeg,
  type AccountingLegDraft,
  type AccountingTransaction,
  type CashFlowClass,
} from "./accounting.js";
import { failValidation, issueCodes, type ValidationIssue } from "./diagnostics.js";
import type { SemanticEffect } from "./semantics.js";
import {
  applyAccountingTransactionAtomically,
  cloneAuthoritativeState,
  registerAuthoritativeIdentity,
  type AccountState,
  type AuthoritativeState,
  type LiabilityState,
  type PositionState,
} from "./state.js";
import { assertObservedFactWithinDataCutoff, createInputFingerprint, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";
import { isObservedFact } from "./provenance.js";
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
export { assertBalanced } from "./accounting.js";
export { semanticEffectId } from "./semantics.js";
export type { AccountingLeg, AccountingTransaction } from "./accounting.js";
export type { SemanticEffect } from "./semantics.js";
export type { ValidationIssue } from "./diagnostics.js";
export type { AccountState, PositionState, LiabilityState, AuthoritativeState } from "./state.js";
export { createAuthoritativeState } from "./state.js";
export { createRunContext, runId, scenarioId } from "./run.js";
export type { RunContext, RunMetadata } from "./run.js";

export type AccountId = DomainId<"account">;
export type PositionId = DomainId<"position">;
export type LiabilityId = DomainId<"liability">;
export type SimulationState = AuthoritativeState;

export interface Statements {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly income: Money;
  readonly expenses: Money;
  readonly gains: Money;
  readonly operatingCashFlow: Money;
  readonly investingCashFlow: Money;
  readonly financingCashFlow: Money;
}

export interface RunResult {
  readonly status: "completed";
  readonly runMetadata: RunMetadata;
  readonly requestedHorizon: Period;
  readonly reachedThrough: Instant;
  readonly state: SimulationState;
  readonly effects: readonly SemanticEffect[];
  readonly transactions: readonly AccountingTransaction[];
  readonly statements: Statements;
  readonly diagnostics: readonly ValidationIssue[];
}

interface PostingLegDraft {
  readonly posting: "debit" | "credit";
  readonly type: AccountingLegDraft["type"];
  readonly amount: Money;
  readonly accountId?: AccountId;
  readonly entityId?: PositionId | LiabilityId;
  readonly quantity?: Quantity;
  readonly cashFlowClass?: CashFlowClass;
}

export const posting = (
  id: string,
  date: string | Instant,
  type: string,
  cashFlowClass: CashFlowClass,
  legs: readonly PostingLegDraft[],
): AccountingTransaction => createAccountingTransaction({
  id: accountingTransactionId(id),
  date: instant(date),
  type,
  legs: legs.map((leg) => {
    if (leg.type === "cash") return createAccountingLeg({ posting: leg.posting, type: "cash", amount: leg.amount, accountId: leg.accountId!, cashFlowClass: leg.cashFlowClass ?? cashFlowClass });
    if (leg.type === "asset") return createAccountingLeg({ posting: leg.posting, type: "asset", amount: leg.amount, entityId: leg.entityId as PositionId, ...(leg.quantity === undefined ? {} : { quantity: leg.quantity }) });
    if (leg.type === "liability") return createAccountingLeg({ posting: leg.posting, type: "liability", amount: leg.amount, entityId: leg.entityId as LiabilityId });
    return createAccountingLeg({ posting: leg.posting, type: leg.type, amount: leg.amount, ...(leg.entityId === undefined ? {} : { entityId: leg.entityId }) });
  }),
});

export class DependencyGraph {
  private readonly edges = new Map<string, Set<string>>();
  addNode(id: string): void { if (!this.edges.has(id)) this.edges.set(id, new Set()); }
  addEdge(from: string, to: string, lag = 0): void {
    this.addNode(from);
    this.addNode(to);
    if (lag === 0) this.edges.get(from)!.add(to);
  }
  topologicalOrder(): string[] {
    const indegree = new Map([...this.edges.keys()].map((key) => [key, 0]));
    for (const targets of this.edges.values()) for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
    const ready = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key).sort();
    const output: string[] = [];
    while (ready.length > 0) {
      const node = ready.shift()!;
      output.push(node);
      for (const target of this.edges.get(node)!) {
        const degree = indegree.get(target)! - 1;
        indegree.set(target, degree);
        if (degree === 0) { ready.push(target); ready.sort(); }
      }
    }
    if (output.length !== indegree.size) throw new Error("Invalid zero-lag dependency cycle");
    return output;
  }
}

export interface KernelEvent {
  readonly id: string;
  readonly date: Instant;
  readonly dependsOn?: readonly string[];
  readonly lag?: number;
  readonly effect: SemanticEffect;
  readonly transaction: AccountingTransaction;
}

export class SemanticRunner {
  constructor(private readonly initial: SimulationState) {}

  run(targetPeriod: Period, events: readonly KernelEvent[], runContext: RunContext): RunResult {
    if (targetPeriod.start !== runContext.simulationStart || targetPeriod.end !== runContext.simulationEnd) {
      failValidation({ severity: "error", code: issueCodes.invalidRunContext, message: "Kernel period must match the run context horizon", entityType: "run_context", fieldPath: "simulationStart" });
    }
    const inputFingerprint = createInputFingerprint({
      runContext,
      openingState: cloneAuthoritativeState(this.initial),
      scenario: [...events].sort((left, right) => left.id.localeCompare(right.id)),
    });
    const runMetadata = createRunMetadata(runContext, inputFingerprint);
    const state = cloneAuthoritativeState(this.initial);
    const effects: SemanticEffect[] = [];
    const transactions: AccountingTransaction[] = [];
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
      if (event.effect.provenance !== undefined) {
        assertObservedFactWithinDataCutoff(event.effect.provenance, runContext);
        if (isObservedFact(event.effect.provenance)) {
          registerAuthoritativeIdentity(state.identities, "externalIdempotencyKeys", event.effect.provenance.idempotencyKey);
        }
      }
      if (event.effect.sourceOccurrenceKey !== undefined) {
        registerAuthoritativeIdentity(state.identities, "generatedOccurrenceKeys", event.effect.sourceOccurrenceKey);
      }
      if (event.effect.recognitionId !== undefined) {
        registerAuthoritativeIdentity(state.identities, "recognitionIds", event.effect.recognitionId);
      }
      if (event.effect.settlementId !== undefined) {
        registerAuthoritativeIdentity(state.identities, "settlementIds", event.effect.settlementId);
      }
      effects.push(event.effect);
      transactions.push(event.transaction);
      applyAccountingTransactionAtomically(state, event.transaction);
    }
    return Object.freeze({ status: "completed", runMetadata, requestedHorizon: targetPeriod, reachedThrough: targetPeriod.end, state, effects: Object.freeze(effects), transactions: Object.freeze(transactions), statements: deriveStatements(state, transactions), diagnostics: Object.freeze([]) });
  }
}

export class GoldenRunner {
  constructor(private readonly initial: SimulationState) {}
  run(targetPeriod: Period, events: readonly KernelEvent[], runContext: RunContext): RunResult { return new SemanticRunner(this.initial).run(targetPeriod, events, runContext); }
}

function deriveStatements(state: SimulationState, transactions: readonly AccountingTransaction[]): Statements {
  const accountValues = Object.values(state.accounts).map((account) => account.cash);
  const positionValues = Object.values(state.positions).map((position) => position.price.times(position.quantity.amount));
  const currency = accountValues[0]?.currency ?? positionValues[0]?.currency ?? USD;
  const assets = sumMoney([...accountValues, ...positionValues], currency);
  const liabilities = sumMoney(Object.values(state.liabilities).map((liability) => liability.balance), currency);
  const total = (type: AccountingLeg["type"], side: AccountingLeg["posting"]): Money =>
    sumMoney(transactions.flatMap((transaction) => transaction.legs.filter((leg) => leg.type === type && leg.posting === side).map((leg) => leg.amount)), currency);
  return Object.freeze({
    assets,
    liabilities,
    netWorth: assets.minus(liabilities),
    income: total("income", "credit"),
    expenses: total("expense", "debit").plus(total("tax", "debit")),
    gains: total("gain", "credit"),
    operatingCashFlow: sumMoney(transactions.map((transaction) => cashFlowAmount(transaction, "operating", currency)), currency),
    investingCashFlow: sumMoney(transactions.map((transaction) => cashFlowAmount(transaction, "investing", currency)), currency),
    financingCashFlow: sumMoney(transactions.map((transaction) => cashFlowAmount(transaction, "financing", currency)), currency),
  });
}

const divisionPrecision = new RoundingPolicy(30, "half_even");

const monthlyNominalRate = (annualRate: Rate): DecimalAmount => {
  if (annualRate.convention.basis !== RateBasis.NominalAnnual || annualRate.convention.compoundingPeriodsPerYear !== 12) {
    throw new Error("Monthly mortgage rate requires nominal annual convention with 12 contractual compounding periods");
  }
  return annualRate.value.dividedBy(decimal(annualRate.convention.compoundingPeriodsPerYear.toString()), divisionPrecision);
};

export function fixedMortgagePayment(principal: Money, annualRate: Rate, remainingPayments: number, postingRounding: RoundingPolicy): Money {
  if (!Number.isSafeInteger(remainingPayments) || remainingPayments <= 0 || principal.isNegative()) throw new Error("Invalid mortgage terms");
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
  return new Money(principal.amount.times(monthlyNominalRate(annualRate)).round(accrualRounding), principal.currency);
}

export function mortgagePrincipal(payment: Money, interest: Money, balance: Money): Money {
  const principal = payment.minus(interest);
  return principal.compare(balance) > 0 ? balance : principal;
}
