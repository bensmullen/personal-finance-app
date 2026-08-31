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
import { failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { type SemanticEffect } from "../semantics/effect.js";
import {
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  type AuthoritativeState,
} from "../state/index.js";
import { type Statements } from "../statements/index.js";
import { type Instant, type Period, instant } from "../time/index.js";
import { Money, Quantity } from "../values/index.js";
import {
  assertRunContext,
  createInputFingerprint,
  createRunMetadata,
  type RunContext,
  type RunMetadata,
} from "./run.js";
import { runPeriod, type SemanticPeriodWork } from "./period.js";

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
    const work: SemanticPeriodWork[] = events.map((event) => ({
      kind: "semantic",
      id: event.id,
      at: event.date,
      ...(event.dependsOn === undefined ? {} : { dependsOn: event.dependsOn }),
      ...(event.lag === undefined ? {} : { lag: event.lag }),
      effect: event.effect,
      transaction: event.transaction,
    }));
    const committed = runPeriod({ period: targetPeriod, runContext, openingState: state, work });
    return Object.freeze({
      status: "completed",
      runMetadata,
      requestedHorizon: targetPeriod,
      reachedThrough: targetPeriod.end,
      state: committed.closingState,
      effects: committed.effects,
      transactions: committed.transactions,
      statements: committed.statements,
      diagnostics: committed.diagnostics,
    });
  }
}

export class GoldenRunner {
  constructor(private readonly initial: SimulationState) {}
  run(targetPeriod: Period, events: readonly KernelEvent[], runContext: RunContext): RunResult {
    return new SemanticRunner(this.initial).run(targetPeriod, events, runContext);
  }
}
