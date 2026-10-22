import type { PersonalDraft } from "../../src/application/personalMvp.js";
import type { PersonalHouseholdForecastReadModel } from "../../src/application/householdProjection.js";
import type { inspectMonthlyMoney } from "../../src/application/monthlyMoney.js";
import type { MortgageWindow } from "../../src/application/mortgageChartData.js";
export type { ForecastWorkerRequest, ForecastWorkerResult, ForecastWorkerResponse } from "../../src/application/interactiveForecast.js";

/** A disposable evidence worker binds one immutable result/model, then selects
 * bounded windows without retransmitting the full replay artifact each time. */
export interface EvidenceSelection {
  readonly operation: "monthly_evidence" | "mortgage_evidence";
  readonly startIndex: number;
  readonly liabilityId: string;
}
export type EvidenceWorkerRequest = EvidenceSelection & {
  readonly requestId: number;
  readonly fingerprint: string;
  readonly source?: { readonly forecast: PersonalHouseholdForecastReadModel; readonly model: PersonalDraft };
};
export type EvidenceWorkerResponse = Pick<EvidenceWorkerRequest, "operation" | "requestId" | "fingerprint" | "startIndex" | "liabilityId"> & {
  readonly durationMs?: number;
} & (
  | { readonly outcome: "result"; readonly detail?: ReturnType<typeof inspectMonthlyMoney>; readonly window?: MortgageWindow }
  | { readonly outcome: "error"; readonly error: string }
);
