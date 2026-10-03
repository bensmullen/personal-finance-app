import type { PortableModelEnvelope } from "../../src/model/modelVersion.js";
import type { ExecutableScenarioIntent } from "../../src/application/compiler/scenarios.js";
import type { HouseholdForecastRequest, MajorAssetDebtAddition, PersonalHouseholdForecastReadModel, PersonalHouseholdScenarioComparisonReadModel } from "../../src/application/householdProjection.js";
import type { PerformanceContext, PerformanceRecord } from "../../src/diagnostics/performance.js";

interface RequestBoundary {
  readonly requestId: number;
  readonly fingerprint: string;
  readonly model: PortableModelEnvelope;
  readonly request: HouseholdForecastRequest;
  readonly performanceContext: PerformanceContext;
}
export type ForecastWorkerRequest = RequestBoundary & (
  | { readonly operation: "baseline_forecast" }
  | { readonly operation: "scenario_comparison"; readonly intents: readonly ExecutableScenarioIntent[] }
  | { readonly operation: "major_asset_debt_comparison"; readonly addition: MajorAssetDebtAddition }
);
export type ForecastWorkerResult = PersonalHouseholdForecastReadModel | PersonalHouseholdScenarioComparisonReadModel;
export type ForecastWorkerResponse = Pick<ForecastWorkerRequest, "operation" | "requestId" | "fingerprint"> & {
  readonly records: readonly PerformanceRecord[];
} & (
  | { readonly outcome: "result"; readonly result: ForecastWorkerResult }
  | { readonly outcome: "error"; readonly error: { readonly code: "EXECUTION_ERROR"; readonly message: string } }
);
