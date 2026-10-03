import { mergeTraceRefs } from "../../lineage/index.js";
import type { HouseholdInvestmentPeriodSummary, ExecutableHouseholdProjection } from "../householdExecution.js";
import type { VerticalSlice2PeriodResult, PreparedVerticalSlice2Period } from "../verticalSlice2.js";
import { executePreparedVerticalSlice2Occurrence } from "../verticalSlice2.js";
import type { PreparedVerticalSlice3Period } from "../verticalSlice3.js";
import { executePreparedVerticalSlice3Operation } from "../verticalSlice3.js";
import type { VerticalSlice4PeriodResult, PreparedVerticalSlice4Period } from "../verticalSlice4.js";
import { executePreparedVerticalSlice4Operation } from "../verticalSlice4.js";
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
  readonly cash?: VerticalSlice2PeriodResult;
  readonly investment?: InvestmentOperationFacts;
  readonly liability?: VerticalSlice4PeriodResult;
  readonly transactions?: readonly AccountingTransaction[];
  readonly constraintOutcomes?: readonly ConstraintOutcome[];
  readonly liquidityShortfalls?: readonly LiquidityShortfall[];
  readonly diagnostics?: readonly ValidationIssue[];
  readonly traceRefs?: readonly CalculationTraceRef[];
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
      execute: (opening: OperationState) => {
        const result = executePreparedVerticalSlice2Occurrence(prepared.cash!, occurrence,
          opening.state, opening.primitiveState,
          kernel.cash?.occurrenceInput(occurrence.streamId) ?? input.cashFlowInput!, context);
        return { state: result.state, primitiveState: result.primitiveState, facts: { cash: result.period } };
      },
    })) },
    { id: "investments", operations: (prepared.investments?.operations ?? []).map(operation => ({
      descriptor: operation.descriptor,
      execute: (opening: OperationState) => {
        const result = executePreparedVerticalSlice3Operation(prepared.investments!, operation,
          opening.state, opening.primitiveState, input.investmentInput!, context);
        return { state: result.state, primitiveState: result.primitiveState, facts: { investment: Object.freeze({
          transactions: result.transactions, contributionPrincipal: result.contributionPrincipal,
          fees: result.fees, unrealizedGain: result.unrealizedGain,
          traceRefs: mergeTraceRefs(result.effects.flatMap(effect => effect.traceRefs ?? [])) ?? Object.freeze([]),
        }) } };
      },
    })) },
    { id: "liabilities", operations: (prepared.liabilities?.operations ?? []).map(operation => ({
      descriptor: operation.descriptor,
      execute: (opening: OperationState, statuses: Map<string, string>) => {
        if (operation.kind === "extra_principal") {
          const service = required.get(JSON.stringify([operation.loan.id, operation.scheduledAt]));
          if (service !== undefined && statuses.get(service) !== "fully_satisfied")
            return { ...opening, facts: {} };
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
