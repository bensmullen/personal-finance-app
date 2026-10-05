import { mergeTraceRefs } from "../../lineage/index.js";
import { SummaryOperationSink, type SummaryAccountingEvidence } from "./summarySink.js";
import type { CashOperationSummary } from "../verticalSlice2.js";
import type { DebtOperationSummary } from "../verticalSlice4.js";
import type { HouseholdInvestmentPeriodSummary, ExecutableHouseholdProjection } from "../householdExecution.js";
import type { VerticalSlice2PeriodResult, PreparedVerticalSlice2Period } from "../verticalSlice2.js";
import { executePreparedVerticalSlice2Occurrence } from "../verticalSlice2.js";
import type { PreparedVerticalSlice3Period } from "../verticalSlice3.js";
import { executePreparedVerticalSlice3Operation } from "../verticalSlice3.js";
import type { VerticalSlice4PeriodResult, PreparedVerticalSlice4Period } from "../verticalSlice4.js";
import { executePreparedVerticalSlice4Operation, guaranteedUnfundedRequiredServicePool, guaranteedFirstSourceRequiredService } from "../verticalSlice4.js";
import type { RunContext } from "../run.js";
import type { OperationState, PreparedOperationParticipant } from "./operations.js";
import type { CompiledHouseholdKernel } from "./compiledHousehold.js";
import type { AccountingTransaction } from "../../accounting/index.js";
import type { ConstraintOutcome, LiquidityShortfall } from "../../funding/index.js";
import type { ValidationIssue } from "../../diagnostics/index.js";
import type { CalculationTraceRef } from "../../lineage/index.js";

export type InvestmentOperationFacts = Pick<HouseholdInvestmentPeriodSummary,
  "transactions" | "contributionPrincipal" | "fees" | "unrealizedGain" | "traceRefs">;

/** Existing summaries remain intact. New domains contribute common audit/accounting facts. */
export interface HouseholdOperationFacts {
  readonly debtReplacements?: readonly { readonly oldLoanId: string; readonly amount: import("../../values/index.js").Money }[];
  readonly acquiredLots?: readonly { readonly holdingId: string; readonly id: string; readonly acquired: string; readonly quantity: string; readonly basis: string }[];
  readonly taxEconomics?: readonly import("../tax/contracts.js").RecognizedTaxEconomics[];
  readonly taxDiagnostics?: readonly import("../tax/contracts.js").TaxCapabilityDiagnostic[];
  readonly resolvedTaxDiagnosticSourceIds?: readonly string[];
  readonly instrumentation?: Readonly<Record<string, number>>;
  readonly outputCapabilities?: import("../tax/contracts.js").TaxOutputCapabilities;
  readonly summary?: HouseholdSummaryOperationFacts;
  readonly cash?: VerticalSlice2PeriodResult;
  readonly investment?: InvestmentOperationFacts;
  readonly liability?: VerticalSlice4PeriodResult;
  readonly transactions?: readonly AccountingTransaction[];
  readonly constraintOutcomes?: readonly ConstraintOutcome[];
  readonly liquidityShortfalls?: readonly LiquidityShortfall[];
  readonly diagnostics?: readonly ValidationIssue[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface HouseholdSummaryOperationFacts {
  readonly evidence: SummaryAccountingEvidence;
  readonly cash?: CashOperationSummary;
  readonly investment?: Pick<InvestmentOperationFacts, "contributionPrincipal" | "fees" | "unrealizedGain">;
  readonly debt?: DebtOperationSummary;
}

export interface PreparedHouseholdDomains {
  readonly cash: PreparedVerticalSlice2Period | undefined;
  readonly investments: PreparedVerticalSlice3Period | undefined;
  readonly liabilities: PreparedVerticalSlice4Period | undefined;
}

/** Financial work delegates to owning modules; every domain uses the same operation contract. */
export const householdDomainParticipants = (
  prepared: PreparedHouseholdDomains, input: ExecutableHouseholdProjection, context: RunContext,
  kernel: CompiledHouseholdKernel,
  tier: "summary" | "detail" = "detail",
): readonly PreparedOperationParticipant<HouseholdOperationFacts>[] => {
  const required = new Map<string, string>();
  for (const operation of prepared.liabilities?.operations ?? [])
    if (operation.kind === "required_service") {
      const key = JSON.stringify([operation.loan.id, operation.scheduledAt]);
      // Match the reference's first required operation if a malformed input contains duplicates.
      if (!required.has(key)) required.set(key, operation.descriptor.id);
    }
  return Object.freeze([
    { id: "cash_flow", operations: (prepared.cash?.occurrences ?? []).map(occurrence => ({
      descriptor: occurrence.descriptor,
      commutativity: () => {
        if (occurrence.descriptor.operationClass !== "cash_income_settlement") return undefined;
        const income = kernel.cash?.occurrenceInput(occurrence.streamId)?.incomes[0];
        return income === undefined ? undefined : { kind: "nonnegative_cash_income" as const,
          account: income.depositAccountId, primitiveIds: Object.values(income.primitiveIds).filter((id): id is NonNullable<typeof id> => id !== undefined) };
      },
      execute: (opening: OperationState) => {
        if (tier === "summary") {
          const sink = new SummaryOperationSink(context.baseCurrency);
          const result = executePreparedVerticalSlice2Occurrence(prepared.cash!, occurrence, opening.state, opening.primitiveState,
            kernel.cash?.occurrenceInput(occurrence.streamId) ?? input.cashFlowInput!, context, sink);
          return { state: result.state, primitiveState: result.primitiveState, facts: { summary: { evidence: sink.snapshot(), cash: result.summary } } };
        }
        const result = executePreparedVerticalSlice2Occurrence(prepared.cash!, occurrence,
          opening.state, opening.primitiveState,
          kernel.cash?.occurrenceInput(occurrence.streamId) ?? input.cashFlowInput!, context);
        return { state: result.state, primitiveState: result.primitiveState, facts: { cash: result.period } };
      },
    })) },
    { id: "investments", operations: (prepared.investments?.operations ?? []).map(operation => ({
      descriptor: operation.descriptor,
      commutativity: () => operation.kind === "transfer" ? {
        kind: "fixed_owned_transfer" as const, source: operation.operation.sourceAccountId,
        destination: operation.operation.destinationAccountId, amount: operation.operation.amount,
        primitiveIds: [operation.operation.schedulePrimitiveId],
      } : undefined,
      execute: (opening: OperationState) => {
        const acquired = (state: OperationState["state"]): NonNullable<HouseholdOperationFacts["acquiredLots"]> => operation.kind !== "purchase" ? [] : [{
          holdingId: operation.operation.targetPositionId, id: operation.descriptor.id + ":lot", acquired: operation.descriptor.sequencingInstant.slice(0, 10),
          quantity: state.positions[operation.operation.targetPositionId]!.quantity.minus(opening.state.positions[operation.operation.targetPositionId]!.quantity).amount.toString(),
          basis: state.positions[operation.operation.targetPositionId]!.carryingValue.minus(opening.state.positions[operation.operation.targetPositionId]!.carryingValue).amount.toString(),
        }].filter(item => item.quantity !== "0");
        if (tier === "summary") {
          const sink = new SummaryOperationSink(context.baseCurrency);
          const result = executePreparedVerticalSlice3Operation(prepared.investments!, operation,
            opening.state, opening.primitiveState, input.investmentInput!, context, sink);
          return { state: result.state, primitiveState: result.primitiveState, facts: { acquiredLots: acquired(result.state), summary: { evidence: sink.snapshot(), investment: {
            contributionPrincipal: result.contributionPrincipal, fees: result.fees, unrealizedGain: result.unrealizedGain,
          } } } };
        }
        const result = executePreparedVerticalSlice3Operation(prepared.investments!, operation,
          opening.state, opening.primitiveState, input.investmentInput!, context);
        return { state: result.state, primitiveState: result.primitiveState, facts: { acquiredLots: acquired(result.state), investment: Object.freeze({
          transactions: result.transactions, contributionPrincipal: result.contributionPrincipal,
          fees: result.fees, unrealizedGain: result.unrealizedGain,
          traceRefs: mergeTraceRefs(result.effects.flatMap(effect => effect.traceRefs ?? [])) ?? Object.freeze([]),
        }) } };
      },
    })) },
    { id: "liabilities", operations: (prepared.liabilities?.operations ?? []).map(operation => ({
      descriptor: operation.descriptor,
      commutativity: (opening: OperationState) => {
        const primitiveIds = [operation.loan.primitiveIds.schedule, operation.loan.primitiveIds.amortization, operation.loan.primitiveIds.accrual];
        if (guaranteedFirstSourceRequiredService(operation, opening.state, opening.primitiveState))
          return { kind: "guaranteed_first_source_service" as const, primitiveIds };
        const accounts = guaranteedUnfundedRequiredServicePool(operation, opening.state, opening.primitiveState);
        return accounts === undefined ? undefined : { kind: "guaranteed_unfunded_pool" as const, accounts,
          primitiveIds };
      },
      execute: (opening: OperationState, statuses: Map<string, string>) => {
        if (operation.kind === "extra_principal") {
          const service = required.get(JSON.stringify([operation.loan.id, operation.scheduledAt]));
          if (service !== undefined && statuses.get(service) !== "fully_satisfied")
            return { ...opening, facts: {} };
        }
        if (tier === "summary") {
          const sink = new SummaryOperationSink(context.baseCurrency);
          const result = executePreparedVerticalSlice4Operation(prepared.liabilities!, operation,
            opening.state, opening.primitiveState, input.liabilityInput!, context, sink);
          if (operation.kind === "required_service" && result.summary !== undefined) {
            const balance = result.summary.balances[0];
            if (balance !== undefined) statuses.set(operation.descriptor.id, balance.scheduledFundingStatus);
            return { state: result.state, primitiveState: result.primitiveState, facts: { summary: { evidence: sink.snapshot(), debt: result.summary } } };
          }
          return { state: result.state, primitiveState: result.primitiveState, facts: {} };
        }
        const result = executePreparedVerticalSlice4Operation(prepared.liabilities!, operation,
          opening.state, opening.primitiveState, input.liabilityInput!, context);
        if (operation.kind === "required_service" && result.period !== undefined) {
          const loan = result.period.liabilities[0];
          if (loan !== undefined) statuses.set(operation.descriptor.id, loan.scheduledFundingStatus);
          return { state: result.state, primitiveState: result.primitiveState, facts: { liability: result.period } };
        }
        // Preserve the reference household's extra-principal summary/lineage behavior.
        return { state: result.state, primitiveState: result.primitiveState, facts: {} };
      },
    })) },
  ] satisfies readonly PreparedOperationParticipant<HouseholdOperationFacts>[]);
};
