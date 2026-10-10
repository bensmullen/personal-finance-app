import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, runPersonalForecast, patchPersonalObject, type ForecastRequest } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { runHouseholdKernel, replayHouseholdForecastWindow } from "../src/simulation/householdExecution.js";
import { summarizeHouseholdPeriod } from "../src/simulation/r3/forecastSummary.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { money, USD } from "../src/values/index.js";

const request = () => {
  const full = createGoldenHouseholdForecastRequest();
  return { ...full, compiler: { ...full.compiler,
    cashFlow: { ...full.compiler.cashFlow!, simulationEnd: "2028-01-01", months: 24 },
    investments: { ...full.compiler.investments!, simulationEnd: "2028-01-01", months: 24 },
    liabilities: { ...full.compiler.liabilities!, simulationEnd: "2028-01-01", months: 24 },
  } };
};
const standalone = (scope: ForecastRequest["scope"]): ForecastRequest => ({ scope, baseCurrency: "USD", asOf: "2026-01-01", dataCutoff: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2028-01-01", months: 24, sameInstantCashFlowOrder: "income_before_expense", cashFlowExecutionAccountId: ids.checking, executionOwnerId: ids.person, scenarioId: ids.rootScenario, liabilityExecutionProfiles: request().compiler.liabilities!.executionProfiles });

describe("U1 consolidated mortgage funding investigation (#94, synthetic evidence)", () => {
  it("reproduces the 2027 isolated shortfall while matched cash flow grows and reconciled checking funds every payment", () => {
    const model = createGoldenHouseholdDraft();
    const liabilities = runPersonalForecast(model, standalone("liabilities"));
    const cash = runPersonalForecast(model, standalone("cash_flow"));
    const integrated = runPersonalHouseholdForecast(model, request());
    if (liabilities.status === "unavailable" || liabilities.scope !== "liabilities" || cash.status === "unavailable" || cash.scope !== "cash_flow" || integrated.status === "unavailable") throw new Error("Matched Golden scopes must execute");
    const first = liabilities.shortfalls[0]!;
    expect(first.evaluatedAt?.slice(0, 4)).toBe("2027");
    expect(first.mortgageFunding).toEqual({ liabilityId: ids.mortgage, fundingAccountIds: [ids.checking], settlementPriority: 1 });
    expect(money(first.required.exact).compare(money(first.available.exact))).toBe(1);
    expect(money(cash.points[23]!.endingCash.exact).compare(money("25000"))).toBe(1);
    expect(integrated.liquidityShortfalls.filter(item => item.origin === "required_debt_service")).toEqual([]);
    expect(integrated.points).toHaveLength(24);
    // Independent accounting oracle: available cash immediately before each
    // payment follows actual posted transactions in execution order, not total
    // household cash or a separate forecast's ending balance.
    const compiled = compileHouseholdProjection(model, request().compiler);
    if (compiled.status !== "compiled") throw new Error("Golden household must compile");
    const runContext = createRunContext({ runId: runId(request().runIdentity), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2028-01-01T00:00:00.000Z"), baseCurrency: USD });
    const detail = runHouseholdKernel({ kernel: compiled.value.executionKernel!, runContext, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel: compiled.value.executionKernel!, runContext });
    expect(summary.periods).toEqual(detail.periods.map(summarizeHouseholdPeriod));
    expect(summary.state).toEqual(detail.state);
    const balances = new Map(Object.values(compiled.value.reconciledOpeningState.accounts).map(account => [String(account.id), account.cash]));
    const payments = new Set<string>();
    for (const period of detail.periods) for (const transaction of period.transactions) {
      const debit = transaction.legs.filter(leg => leg.posting === "debit").reduce((total, leg) => total.plus(leg.amount), money("0"));
      const credit = transaction.legs.filter(leg => leg.posting === "credit").reduce((total, leg) => total.plus(leg.amount), money("0"));
      expect(debit.equals(credit), transaction.id).toBe(true);
      for (const leg of transaction.legs) if (leg.type === "cash") {
        const available = balances.get(String(leg.accountId))!;
        if (["mortgage_principal_payment", "mortgage_interest_settlement"].includes(transaction.type) && leg.posting === "credit") {
          expect(String(leg.accountId)).toBe(ids.checking);
          if (!payments.has(transaction.date)) {
            const required = period.liability!.liabilities.find(item => item.scheduledAt === transaction.date)!.scheduledPayment;
            expect(available.compare(required), JSON.stringify({ paymentDate: transaction.date, account: "Everyday checking", available: available.amount.toString(), required: required.amount.toString(), order: 1 })).not.toBe(-1);
            payments.add(transaction.date);
          }
        }
        balances.set(String(leg.accountId), leg.posting === "debit" ? available.plus(leg.amount) : available.minus(leg.amount));
      }
    }
    expect(payments.size).toBe(24);
    expect(balances.get(ids.checking)).toEqual(detail.state.accounts[ids.checking]!.cash);
    const selected = detail.periods.find(period => period.period.start.slice(0, 7) === first.evaluatedAt!.slice(0, 7))!;
    expect(replayHouseholdForecastWindow(summary, selected.period).periods).toEqual([selected]);
  });
  it("does not use income deposited in another bank account as phantom mortgage funding", () => {
    const full = request();
    const separated = { ...full, compiler: { ...full.compiler, cashFlow: { ...full.compiler.cashFlow, executionAccountId: ids.savings } } };
    const model = patchPersonalObject(createGoldenHouseholdDraft(), "Expense", ids.expense, { payment_account_id: ids.savings });
    const result = runPersonalHouseholdForecast(model, separated);
    if (result.status === "unavailable") throw new Error(result.message);
    const shortfall = result.liquidityShortfalls.find(item => item.origin === "required_debt_service")!;
    expect(shortfall.evaluatedAt.slice(0, 4)).toBe("2027");
    expect(shortfall.mortgageFunding?.fundingAccountIds).toEqual([ids.checking]);
    expect(money(shortfall.requestedAmount.amount).compare(money(shortfall.fundedAmount.amount))).toBe(1);
    expect(money(result.points[23]!.cash.amount).compare(money("35000"))).toBe(1);
  });
});
