import { domainId } from "../identity/index.js";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../accounting/index.js";
import { applyAccountingTransactionAtomically, cloneAuthoritativeState } from "../state/index.js";
import { Currency, Money, Rate, rateConvention } from "../values/index.js";
import { instant } from "../time/index.js";
import { calculationTraceId, calculationTraceRef } from "../lineage/index.js";
import type { HouseholdKernelParticipant } from "./householdExecution.js";
import { prepareVerticalSlice4Period, executePreparedVerticalSlice4Operation, type FixedAmortizingLoan, type VerticalSlice4Input } from "./verticalSlice4.js";
import { immutableConfiguration } from "./r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "./r3/participantCodec.js";
import { operationRuntime } from "./r3/operations.js";
import type { AuthoritativeState } from "../state/index.js";
import { SummaryOperationSink } from "./r3/summarySink.js";

export interface MortgageRefinance {
  readonly id: string;
  readonly at: string;
  readonly oldLoan: FixedAmortizingLoan;
  readonly annualRate: string;
  readonly totalPayments: number;
  readonly firstPayment: string;
  readonly replacementId: string;
  readonly principalId: string;
  readonly interestId: string;
  readonly primitiveIds: { readonly schedule: string; readonly amortization: string; readonly accrual: string };
}
export interface MortgageLifecycleInput {
  readonly householdId: string;
  readonly ownerId: string;
  readonly currency: string;
  readonly refinances: readonly MortgageRefinance[];
}
const replacementLoan = (plan: MortgageRefinance, principal: string, currency: Currency): FixedAmortizingLoan => ({
  ...plan.oldLoan,
  id: domainId("loan-contract", plan.replacementId),
  principalLiabilityId: domainId("liability", plan.principalId),
  interestPayableLiabilityId: domainId("liability", plan.interestId),
  originalPrincipal: Money.parse(principal, currency),
  annualRate: Rate.fromDecimal(plan.annualRate, rateConvention.nominalAnnual(12)),
  totalPayments: plan.totalPayments,
  paymentSchedule: { kind: "utc_monthly", anchor: instant(plan.firstPayment), invalidDayPolicy: "skip" },
  extraPrincipalPayments: [],
  primitiveIds: { schedule: domainId("primitive-instance", plan.primitiveIds.schedule), amortization: domainId("primitive-instance", plan.primitiveIds.amortization), accrual: domainId("primitive-instance", plan.primitiveIds.accrual) },
  sourceTraceRefs: [calculationTraceRef(calculationTraceId("compiler:canonical:Event:" + plan.id))],
});

/** Refinancing changes debt identity. All subsequent interest and payments remain VS4 work. */
export const realizedMortgageLoans = (state: AuthoritativeState): readonly FixedAmortizingLoan[] => Object.values((operationRuntime(state).mortgageLifecycleLoans ?? {}) as Readonly<Record<string, FixedAmortizingLoan>>);
export const createMortgageLifecycleParticipant = (configuration: MortgageLifecycleInput): HouseholdKernelParticipant => {
  const input = immutableConfiguration(configuration);
  return Object.freeze({ id: "mortgage_lifecycle", version: "d1b-v1", portableCodec: "mortgage-lifecycle/v1", economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      const currency = Currency.of(input.currency);
      const principals = (opening.runtime?.refinancedPrincipals ?? {}) as Readonly<Record<string, string>>;
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      for (const plan of input.refinances) {
        if (period.start <= plan.at && plan.at < period.end && principals[plan.id] === undefined) {
          const service = work.find(item => item.operationClass === "liability_required_service" && item.sequencingInstant === plan.at && item.id.startsWith("liability-required:" + plan.oldLoan.id + ":"));
          if (!service) continue;
          operations.push({ descriptor: { id: "refinance:" + plan.id, domain: "mortgage_lifecycle", operationClass: "mortgage_refinance", sequencingInstant: instant(plan.at), dependsOn: [service.id], resourceAccesses: [], traceRefs: [] },
            execute: (candidate, statuses) => {
              if (statuses.get(service.id) !== "fully_satisfied") return { ...candidate, facts: {} };
              const state = cloneAuthoritativeState(candidate.state), balance = state.liabilities[plan.oldLoan.principalLiabilityId]!.balance;
              if (!balance.isPositive() || state.liabilities[plan.oldLoan.interestPayableLiabilityId]!.balance.isPositive()) return { ...candidate, facts: {} };
              const loan = replacementLoan(plan, balance.amount.toString(), currency);
              const traceRefs = loan.sourceTraceRefs ?? [];
              state.liabilities[loan.principalLiabilityId] = { id: loan.principalLiabilityId, balance: Money.zero(currency) };
              state.liabilities[loan.interestPayableLiabilityId] = { id: loan.interestPayableLiabilityId, balance: Money.zero(currency) };
              const tx = createAccountingTransaction({ id: accountingTransactionId("refinance:" + plan.id), date: instant(plan.at), type: "mortgage_refinance", traceRefs,
                legs: [createAccountingLeg({ type: "liability", posting: "debit", amount: balance, entityId: plan.oldLoan.principalLiabilityId }), createAccountingLeg({ type: "liability", posting: "credit", amount: balance, entityId: loan.principalLiabilityId })] });
              applyAccountingTransactionAtomically(state, tx);
              const prior = (candidate.runtime?.refinancedPrincipals ?? {}) as Readonly<Record<string, string>>;
              const priorLoans = (candidate.runtime?.mortgageLifecycleLoans ?? {}) as Readonly<Record<string, FixedAmortizingLoan>>;
              return { state, primitiveState: candidate.primitiveState, runtime: { ...candidate.runtime, refinancedPrincipals: { ...prior, [plan.id]: balance.amount.toString() }, mortgageLifecycleLoans: { ...priorLoans, [plan.id]: loan } }, facts: { transactions: [tx], traceRefs, debtReplacements: [{ oldLoanId: plan.oldLoan.id, amount: balance }] } };
            } });
        }
        const principal = principals[plan.id];
        if (principal === undefined) continue;
        const loan = replacementLoan(plan, principal, currency);
        const slice: VerticalSlice4Input = { householdId: domainId("household", input.householdId), ownerId: domainId("person", input.ownerId), baseCurrency: currency, loans: [loan] };
        const prepared = prepareVerticalSlice4Period(context, slice, period, opening.state, opening.primitiveState);
        for (const operation of prepared.operations) operations.push({ descriptor: operation.descriptor, execute: candidate => {
          if (tier === "summary") {
            const sink = new SummaryOperationSink(currency);
            const result = executePreparedVerticalSlice4Operation(prepared, operation, candidate.state, candidate.primitiveState, slice, context, sink);
            return { state: result.state, primitiveState: result.primitiveState, runtime: candidate.runtime, facts: { summary: { evidence: sink.snapshot(), ...(result.summary ? { debt: result.summary } : {}) } } };
          }
          const result = executePreparedVerticalSlice4Operation(prepared, operation, candidate.state, candidate.primitiveState, slice, context);
          return { state: result.state, primitiveState: result.primitiveState, runtime: candidate.runtime, facts: result.period ? { liability: result.period } : { transactions: result.transactions, diagnostics: result.diagnostics, traceRefs: result.traceRefs } };
        } });
      }
      return { id: "mortgage_lifecycle", operations };
    },
  } satisfies HouseholdKernelParticipant);
};
registerHouseholdParticipantCodec({ codec: "mortgage-lifecycle/v1", restore: input => createMortgageLifecycleParticipant(input as MortgageLifecycleInput) });
