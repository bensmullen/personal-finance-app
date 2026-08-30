import {
  accountingTransactionId,
  createAccountingLeg,
  createAccountingTransaction,
  type AccountId,
  type AccountingLegDraft,
  type AccountingTransaction,
  type CashFlowClass,
  type LiabilityId,
  type PositionId,
} from "../accounting/index.js";
import { DependencyGraph } from "../dependencies/index.js";
import { failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { isObservedFact } from "../model/provenance.js";
import { createSemanticEffect, type SemanticEffect } from "../semantics/effect.js";
import {
  applyAccountingTransactionAtomically,
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  registerAuthoritativeIdentity,
  type AuthoritativeState,
} from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { type Instant, type Period, inPeriod, instant } from "../time/index.js";
import { Money, Quantity } from "../values/index.js";
import {
  assertObservedFactWithinDataCutoff,
  assertRunContext,
  createInputFingerprint,
  createRunMetadata,
  type RunContext,
  type RunMetadata,
} from "./run.js";

export type SimulationState = AuthoritativeState;

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
    assertRunContext(runContext);
    if (targetPeriod.start !== runContext.simulationStart || targetPeriod.end !== runContext.simulationEnd) {
      failValidation({ severity: "error", code: issueCodes.invalidRunContext, message: "Kernel period must match the run context horizon", entityType: "run_context", fieldPath: "simulationStart" });
    }
    const state = cloneAuthoritativeState(this.initial);
    assertAuthoritativeStateCurrency(state, runContext.baseCurrency);
    const inputFingerprint = createInputFingerprint({
      runContext,
      openingState: state,
      scenario: [...events]
        .map((event) => ({ ...event, ...(event.dependsOn === undefined ? {} : { dependsOn: [...event.dependsOn].sort() }) }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
    const runMetadata = createRunMetadata(runContext, inputFingerprint);
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
      const effect = createSemanticEffect(event.effect);
      if (effect.provenance !== undefined) {
        assertObservedFactWithinDataCutoff(effect.provenance, runContext);
        if (isObservedFact(effect.provenance)) registerAuthoritativeIdentity(state.identities, "externalIdempotencyKeys", effect.provenance.idempotencyKey);
      }
      if (effect.sourceOccurrenceKey !== undefined) registerAuthoritativeIdentity(state.identities, "generatedOccurrenceKeys", effect.sourceOccurrenceKey);
      if (effect.recognitionId !== undefined) registerAuthoritativeIdentity(state.identities, "recognitionIds", effect.recognitionId);
      if (effect.settlementId !== undefined) registerAuthoritativeIdentity(state.identities, "settlementIds", effect.settlementId);
      for (const leg of event.transaction.legs) {
        if (!leg.amount.currency.equals(runContext.baseCurrency)) {
          failValidation({ severity: "error", code: issueCodes.runBaseCurrencyMismatch, message: `Transaction ${event.transaction.id} leg uses ${leg.amount.currency.code} but run base currency is ${runContext.baseCurrency.code}`, entityType: "accounting_transaction", entityId: event.transaction.id, fieldPath: "legs.amount" });
        }
      }
      effects.push(effect);
      transactions.push(event.transaction);
      applyAccountingTransactionAtomically(state, event.transaction);
    }
    return Object.freeze({
      status: "completed",
      runMetadata,
      requestedHorizon: targetPeriod,
      reachedThrough: targetPeriod.end,
      state,
      effects: Object.freeze(effects),
      transactions: Object.freeze(transactions),
      statements: deriveStatements(state, transactions, runContext.baseCurrency),
      diagnostics: Object.freeze([]),
    });
  }
}

export class GoldenRunner {
  constructor(private readonly initial: SimulationState) {}
  run(targetPeriod: Period, events: readonly KernelEvent[], runContext: RunContext): RunResult {
    return new SemanticRunner(this.initial).run(targetPeriod, events, runContext);
  }
}
