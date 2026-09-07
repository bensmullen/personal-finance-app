import { domainId, type DomainId } from "../identity/index.js";
import type { Period } from "../time/index.js";

export type ScenarioId = DomainId<"scenario">;
export type AssumptionId = DomainId<"assumption">;
export type ScenarioEventId = DomainId<"event">;

export const scenarioId = (value: string): ScenarioId => domainId("scenario", value);
export const assumptionId = (value: string): AssumptionId => domainId("assumption", value);
export const scenarioEventId = (value: string): ScenarioEventId => domainId("event", value);

/** Pure runtime execution binding; portable-model serialization remains owned by PR 13. */
export interface ScenarioDefinition<Change = unknown> {
  readonly scenarioId: ScenarioId;
  readonly name: string;
  readonly description?: string;
  readonly baseScenarioId?: ScenarioId;
  readonly horizon: Period;
  readonly timestep: "monthly";
  readonly enabled: boolean;
  readonly stochastic: boolean;
  readonly simulationCount: number;
  readonly changes: readonly Change[];
}
