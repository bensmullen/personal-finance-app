import type { AuthoritativeState } from "../../state/index.js";
import { createStatementFlowAccumulator, deriveStatementsFromFlows } from "../../statements/index.js";
import { mergeTraceRefs } from "../../lineage/index.js";
import { Money, type Currency } from "../../values/index.js";
import type { Period } from "../../time/index.js";
import type { CompiledHouseholdKernel } from "./compiledHousehold.js";
import type { HouseholdOperationFacts } from "./domainOperations.js";
import type { HouseholdForecastSummaryPeriod } from "./forecastSummary.js";
import { householdExecutionMetrics } from "./metrics.js";
import { mergeOutputCapabilities } from "./capabilities.js";
import { realizedMortgageLoans } from "../mortgageLifecycle.js";
import { SummaryOperationSink } from "./summarySink.js";

/** Materializes display facts directly, without a detailed period adapter. */
export const createHouseholdSummaryPeriod = (period: Period, opening: AuthoritativeState, closing: AuthoritativeState,
  facts: readonly HouseholdOperationFacts[], kernel: CompiledHouseholdKernel, currency: Currency): HouseholdForecastSummaryPeriod => {
  const operations = facts.flatMap(fact => fact.summary === undefined ? [] : [fact.summary]);
  const cash = operations.flatMap(op => op.cash === undefined ? [] : [op.cash]);
  const investments = operations.flatMap(op => op.investment === undefined ? [] : [op.investment]);
  const debts = operations.flatMap(op => op.debt === undefined ? [] : [op.debt]);
  const flows = createStatementFlowAccumulator(currency);
  for (const op of operations) flows.merge(op.evidence.flows);
  // Legacy extensions are an explicit compatibility boundary, rather than a
  // reason for built-in operations to construct detailed warehouses.
  for (const fact of facts) for (const tx of fact.transactions ?? []) flows.add(tx);
  const zero = Money.zero(currency);
  const sum = (values: readonly Money[]) => values.reduce((total, value) => total.plus(value), zero);
  const metrics = householdExecutionMetrics(closing, currency, kernel.executable);
  const balances = debts.flatMap(debt => debt.balances);
  const last = new Map<string, number>();
  balances.forEach((balance, index) => last.set(balance.loanId, index));
  const realizedLoans = realizedMortgageLoans(closing);
  const principalIds = [...(kernel.liabilities?.principalIds ?? []), ...realizedLoans.map(loan => loan.principalLiabilityId)];
  const interestIds = [...(kernel.liabilities?.interestIds ?? []), ...realizedLoans.map(loan => loan.interestPayableLiabilityId)];
  const principalBefore = sum(principalIds.map(id => opening.liabilities[id]?.balance ?? zero));
  const principalAfter = sum(principalIds.map(id => closing.liabilities[id]?.balance ?? zero));
  const extensionEvidence = new SummaryOperationSink(currency);
  for (const fact of facts) {
    extensionEvidence.traces(fact.traceRefs ?? []);
    for (const tx of fact.transactions ?? []) extensionEvidence.traces(tx.traceRefs ?? []);
  }
  const extension = extensionEvidence.snapshot();
  const rules = [...new Set([...operations.flatMap(op => op.evidence.rules), ...extension.rules])].sort();
  const assumptions = [...new Set([...operations.flatMap(op => op.evidence.assumptions), ...extension.assumptions])].sort();
  const events = [...new Set([...operations.flatMap(op => op.evidence.events), ...extension.events])].sort();
  const outputCapabilities = mergeOutputCapabilities(facts.map(fact => fact.outputCapabilities));
  return Object.freeze({ period: Object.freeze({ ...period }), statements: deriveStatementsFromFlows(closing, flows.snapshot(), currency),
    ...(outputCapabilities === undefined ? {} : { outputCapabilities }),
    cash: metrics.cash, investmentValue: metrics.investmentValue, assets: metrics.totalAssets, liabilities: metrics.totalLiabilities, netWorth: metrics.netWorth,
    constraintOutcomes: Object.freeze([...cash.flatMap(op => op.constraintOutcomes), ...debts.flatMap(op => op.constraintOutcomes), ...facts.flatMap(op => op.constraintOutcomes ?? [])]),
    liquidityShortfalls: Object.freeze([...cash.flatMap(op => op.liquidityShortfalls), ...debts.flatMap(op => op.liquidityShortfalls), ...facts.flatMap(op => op.liquidityShortfalls ?? [])]),
    explanationBindings: Object.freeze({ sources: mergeTraceRefs(...operations.map(op => op.evidence.sources), extension.sources) ?? Object.freeze([]),
      rules: Object.freeze(rules), assumptions: Object.freeze(assumptions), events: Object.freeze(events) }),
    ...(cash.length === 0 ? {} : { recurringIncomeRecognized: sum(cash.map(op => op.recurringIncomeRecognized)),
      recurringExpenseRecognized: sum(cash.map(op => op.recurringExpenseRecognized)), expenseCashSettlement: sum(cash.map(op => op.expenseCashSettlement)),
      outstandingExpenseObligations: cash[cash.length - 1]!.outstandingExpenseObligations }),
    ...(investments.length === 0 ? {} : { contributionPrincipal: sum(investments.map(op => op.contributionPrincipal)),
      investmentFees: sum(investments.map(op => op.fees)), unrealizedGain: sum(investments.map(op => op.unrealizedGain)) }),
    ...(debts.length === 0 ? {} : { interestExpense: sum(debts.map(op => op.interestExpense)), principalReduction: principalBefore.minus(principalAfter),
      endingPrincipal: principalAfter, outstandingInterest: sum(interestIds.map(id => closing.liabilities[id]?.balance ?? zero)),
      debtBalances: Object.freeze(balances.map((balance, index) => {
        const loan = kernel.liabilities?.loan(balance.loanId) ?? realizedLoans.find(loan => loan.id === balance.loanId);
        return last.get(balance.loanId) !== index || loan === undefined ? balance : Object.freeze({ ...balance,
          endingPrincipal: closing.liabilities[loan.principalLiabilityId]?.balance ?? zero });
      })) }),
  });
};
