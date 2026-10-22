import type { PersonalDraft, ForecastRequest, PersonalForecastReadModel } from "../../src/application/personalMvp.js";
import type { HouseholdForecastPoint } from "../../src/application/householdProjection.js";
import type { PortableHouseholdReplayArtifact } from "../../src/simulation/r3/replayArtifact.js";
import type { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import type { MortgageWindow } from "../../src/application/mortgageChartData.js";
export type { ForecastWorkerRequest, ForecastWorkerResult, ForecastWorkerResponse } from "../../src/application/interactiveForecast.js";

/** One immutable proof per worker; only selected original points cross per request.
 * Replay addresses carry their original dates/trace IDs, with basis attached once. */
export interface EvidenceSelection {
  readonly operation: "monthly_evidence" | "mortgage_evidence";
  readonly startIndex: number;
  readonly liabilityId: string;
}
export type EvidenceWorkerRequest = EvidenceSelection & {
  readonly requestId: number;
  readonly fingerprint: string;
  readonly points: readonly HouseholdForecastPoint[];
  readonly source?: { readonly basis?: PortableHouseholdReplayArtifact; readonly model: PersonalDraft };
};
export type EvidenceWorkerResponse = Pick<EvidenceWorkerRequest, "operation" | "requestId" | "fingerprint" | "startIndex" | "liabilityId"> & {
  readonly durationMs?: number;
} & (
  | { readonly outcome: "progress"; readonly phase: "received" | "restored" }
  | { readonly outcome: "result"; readonly detail?: ReturnType<typeof inspectMonthlyMoney>; readonly window?: MortgageWindow }
  | { readonly outcome: "error"; readonly error: string }
);

export interface StandaloneWorkerRequest {
  readonly operation: "standalone_forecast";
  readonly requestId: number;
  readonly model: PersonalDraft;
  readonly request: ForecastRequest;
}
export type StandaloneWorkerResponse = Pick<StandaloneWorkerRequest, "operation" | "requestId"> & (
  | { readonly outcome: "result"; readonly result: PersonalForecastReadModel; readonly durationMs: number }
  | { readonly outcome: "error"; readonly error: string }
);
