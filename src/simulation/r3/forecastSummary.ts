import type { Money } from "../../values/index.js";
import type { Statements } from "../../statements/index.js";
import type { HouseholdProjectionPeriodResult } from "../householdExecution.js";
import type { Period } from "../../time/index.js";

/** Display metrics and capability outcomes, with no transaction or lineage warehouse. */
export interface HouseholdForecastSummaryPeriod {
  readonly period: Period;
  readonly statements: Statements;
  readonly cash: Money;
  readonly investmentValue: Money;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly constraintOutcomes: HouseholdProjectionPeriodResult["constraintOutcomes"];
  readonly liquidityShortfalls: HouseholdProjectionPeriodResult["liquidityShortfalls"];
  readonly recurringIncomeRecognized?: Money;
  readonly recurringExpenseRecognized?: Money;
  readonly expenseCashSettlement?: Money;
  readonly outstandingExpenseObligations?: Money;
  readonly contributionPrincipal?: Money;
  readonly investmentFees?: Money;
  readonly unrealizedGain?: Money;
  readonly interestExpense?: Money;
  readonly principalReduction?: Money;
  readonly endingPrincipal?: Money;
  readonly outstandingInterest?: Money;
}

export const summarizeHouseholdPeriod = (result: HouseholdProjectionPeriodResult): HouseholdForecastSummaryPeriod =>
  Object.freeze({
    period: result.period,
    statements: result.statements,
    cash: result.cash,
    investmentValue: result.investmentValue,
    assets: result.assets,
    liabilities: result.liabilities,
    netWorth: result.netWorth,
    constraintOutcomes: result.constraintOutcomes,
    liquidityShortfalls: result.liquidityShortfalls,
    ...(result.cashFlow === undefined ? {} : {
      recurringIncomeRecognized: result.cashFlow.recurringIncomeRecognized,
      recurringExpenseRecognized: result.cashFlow.recurringExpenseRecognized,
      expenseCashSettlement: result.cashFlow.expenseCashSettlement,
      outstandingExpenseObligations: result.cashFlow.outstandingExpenseObligations,
    }),
    ...(result.investments === undefined ? {} : {
      contributionPrincipal: result.investments.contributionPrincipal,
      investmentFees: result.investments.fees,
      unrealizedGain: result.investments.unrealizedGain,
    }),
    ...(result.liability === undefined ? {} : {
      interestExpense: result.liability.interestExpense,
      principalReduction: result.liability.principalReduction,
      endingPrincipal: result.liability.endingPrincipal,
      outstandingInterest: result.liability.outstandingInterest,
    }),
  });
