import type { ExecutableScenarioIntent } from "./compiler/scenarios.js";
import {
  createHouseholdForecastRequest,
  type HouseholdForecastRequest,
  type PersonalHouseholdSessionExecutionConfiguration,
} from "./householdProjection.js";

export const GOLDEN_HOUSEHOLD_IDS = Object.freeze({
  model: "90000000-0000-4000-8000-000000000001",
  household: "90000000-0000-4000-8000-000000000002",
  person: "90000000-0000-4000-8000-000000000003",
  checking: "90000000-0000-4000-8000-000000000004",
  income: "90000000-0000-4000-8000-000000000005",
  expense: "90000000-0000-4000-8000-000000000006",
  home: "90000000-0000-4000-8000-000000000007",
  mortgage: "90000000-0000-4000-8000-000000000008",
  retirementInvestment: "90000000-0000-4000-8000-000000000009",
  salaryGrowthAssumption: "90000000-0000-4000-8000-000000000010",
  rootScenario: "90000000-0000-4000-8000-000000000011",
  savings: "90000000-0000-4000-8000-000000000013",
  retirementAccount: "90000000-0000-4000-8000-000000000014",
  brokerageAccount: "90000000-0000-4000-8000-000000000015",
  brokerageInvestment: "90000000-0000-4000-8000-000000000016",
  retirementReturnAssumption: "90000000-0000-4000-8000-000000000018",
  retirementEvent: "90000000-0000-4000-8000-000000000023",
  retirementTerminationEvent: "90000000-0000-4000-8000-000000000024",
  contributionPurchase: "90000000-0000-4000-8000-000000000025",
  lowerReturnScenario: "90000000-0000-4000-8000-000000000026",
  earlierRetirementScenario: "90000000-0000-4000-8000-000000000027",
  lowerReturnAssumption: "90000000-0000-4000-8000-000000000028",
  earlierRetirementEvent: "90000000-0000-4000-8000-000000000029",
});

export const createGoldenHouseholdSessionConfiguration =
  (): PersonalHouseholdSessionExecutionConfiguration =>
    Object.freeze({
      baseCurrency: "USD",
      asOf: "2026-01-01",
      dataCutoff: "2026-01-01",
      simulationStart: "2026-01-01",
      simulationEnd: "2036-01-01",
      sameInstantCashFlowOrder: "income_before_expense",
      cashFlowExecutionAccountId: GOLDEN_HOUSEHOLD_IDS.checking,
      investmentExecutionOwnerId: GOLDEN_HOUSEHOLD_IDS.person,
      investmentTransferInstructions: Object.freeze([]),
      investmentPurchaseInstructions: Object.freeze([
        Object.freeze({
          id: GOLDEN_HOUSEHOLD_IDS.contributionPurchase,
          investmentId: GOLDEN_HOUSEHOLD_IDS.brokerageInvestment,
          sourceCashAccountId: GOLDEN_HOUSEHOLD_IDS.checking,
          amount: "1000.00",
          schedule: Object.freeze({
            kind: "explicit_dates" as const,
            dates: Object.freeze(["2026-01-10"]),
          }),
          order: 10,
          quantityRounding: Object.freeze({
            scale: 12,
            mode: "half_even" as const,
          }),
        }),
      ]),
      liabilityExecutionOwnerId: GOLDEN_HOUSEHOLD_IDS.person,
      liabilityExecutionProfiles: Object.freeze([
        Object.freeze({
          liabilityId: GOLDEN_HOUSEHOLD_IDS.mortgage,
          kind: "vs4_fixed_monthly_fully_amortizing" as const,
          paymentAnchor: "2022-02-01",
          totalPayments: 360,
          fundingAccountId: GOLDEN_HOUSEHOLD_IDS.checking,
          settlementPriority: 1,
          openingContractStatus: "current" as const,
        }),
      ]),
      retirementBindings: Object.freeze([
        Object.freeze({
          incomeId: GOLDEN_HOUSEHOLD_IDS.income,
          terminationEventId: GOLDEN_HOUSEHOLD_IDS.retirementTerminationEvent,
          canonicalEventId: GOLDEN_HOUSEHOLD_IDS.retirementEvent,
          baselineDate: "2035-01-01",
        }),
      ]),
      selectedRootScenarioId: GOLDEN_HOUSEHOLD_IDS.rootScenario,
    });

export const createGoldenHouseholdForecastRequest = (
  runIdentity = "90000000-0000-4000-8000-000000000030",
): HouseholdForecastRequest =>
  createHouseholdForecastRequest(
    createGoldenHouseholdSessionConfiguration(),
    runIdentity,
  );

export const createGoldenHouseholdScenarioIntents =
  (): readonly ExecutableScenarioIntent[] =>
    Object.freeze([
      Object.freeze({
        scenarioId: GOLDEN_HOUSEHOLD_IDS.lowerReturnScenario,
        baseScenarioId: GOLDEN_HOUSEHOLD_IDS.rootScenario,
        name: "Lower investment returns",
        changes: Object.freeze([
          Object.freeze({
            kind: "investment_return" as const,
            investmentId: GOLDEN_HOUSEHOLD_IDS.retirementInvestment,
            annualRate: "0.0200",
          }),
        ]),
      }),
      Object.freeze({
        scenarioId: GOLDEN_HOUSEHOLD_IDS.earlierRetirementScenario,
        baseScenarioId: GOLDEN_HOUSEHOLD_IDS.rootScenario,
        name: "Earlier retirement and liquidity stress",
        changes: Object.freeze([
          Object.freeze({
            kind: "retirement_date" as const,
            incomeId: GOLDEN_HOUSEHOLD_IDS.income,
            targetEventId: GOLDEN_HOUSEHOLD_IDS.retirementEvent,
            baselineDate: "2035-01-01",
            newDate: "2026-02-01",
          }),
        ]),
      }),
    ]);
