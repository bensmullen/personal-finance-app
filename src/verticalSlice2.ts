export {
  runVerticalSlice2,
  createVerticalSlice2PrimitiveId,
} from "./simulation/verticalSlice2.js";
export type {
  HouseholdId,
  PersonId,
  AccountId,
  LiabilityId,
  IncomeId,
  ExpenseId,
  EventId,
  PrimitiveInstanceId,
  ScheduledCashFlowEvent,
  RecurringIncomeStream,
  RecurringExpenseStream,
  VerticalSlice2Input,
  VerticalSlice2RunInput,
  ProjectedCashFlowOccurrence,
  VerticalSlice2PeriodResult,
  VerticalSlice2RunResult,
} from "./simulation/verticalSlice2.js";
export { compareVerticalSlice2Scenarios, applyVerticalSlice2Scenario, resolveScenario, scenarioSemanticTarget } from "./simulation/scenario.js";
export type { ExecutableScenario, ScenarioChange, ScenarioComparisonRequest, ScenarioComparisonResult } from "./simulation/scenario.js";
