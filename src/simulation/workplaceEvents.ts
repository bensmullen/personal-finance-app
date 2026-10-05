import { domainId } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../lineage/index.js";
import { instant, type Instant } from "../time/index.js";
import type { PositionId } from "../accounting/index.js";
import type { HouseholdKernelParticipant } from "./householdExecution.js";
import { immutableConfiguration } from "./r3/compiledHousehold.js";
import { contingentReclassificationCandidate } from "./contributions.js";
import { registerHouseholdParticipantCodec } from "./r3/participantCodec.js";

export interface WorkplaceReclassification {
  readonly eventId: string;
  readonly positionId: PositionId;
  readonly at: Instant;
  readonly kind: "vest" | "forfeit";
}
export const createWorkplaceEventParticipant = (configuration: readonly WorkplaceReclassification[]): HouseholdKernelParticipant => {
  const events = immutableConfiguration(configuration);
  if (new Set(events.map(event => event.eventId)).size !== events.length || events.some(event => events.some(other => other !== event && other.positionId === event.positionId && other.at === event.at))) throw new Error("WORKPLACE_EVENT_AMBIGUOUS");
  return Object.freeze({ id: "workplace", version: "d1-workplace-v1", portableCodec: "workplace-events/v1", economicInputs: events,
    prepare: (_context, period, _opening, work = []) => ({ id: "workplace", operations: events.filter(event => period.start <= event.at && event.at < period.end).map(event => ({
      descriptor: { id: `workplace:${event.eventId}`, domain: "workplace", operationClass: `workplace:${event.kind}`, sequencingInstant: event.at,
        dependsOn: work.filter(item => item.sequencingInstant === event.at).map(item => item.id), resourceAccesses: [], traceRefs: [calculationTraceRef(calculationTraceId(`compiler:canonical:Event:${event.eventId}`))] },
      execute: opening => {
        // A valid zero contingent balance has no reclassification or financial recognition.
        if (!opening.state.contingentPositions?.[event.positionId]?.quantity.amount.isPositive()) return { ...opening, facts: { transactions: [], traceRefs: [calculationTraceRef(calculationTraceId(`workplace:${event.eventId}:no-contingent-value`))] } };
        const result = contingentReclassificationCandidate(opening.state, event.positionId, `workplace:${event.eventId}`, event.at, event.kind);
        return { ...opening, state: result.state, facts: { transactions: [result.transaction], traceRefs: [calculationTraceRef(calculationTraceId(`compiler:canonical:Event:${event.eventId}`))] } };
      },
    })) }),
  } satisfies HouseholdKernelParticipant);
};
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
registerHouseholdParticipantCodec({ codec: "workplace-events/v1", restore: value => {
  if (!Array.isArray(value)) throw new Error("WORKPLACE_REPLAY_INVALID");
  const events: WorkplaceReclassification[] = value.map(item => {
    if (!record(item) || typeof item.eventId !== "string" || typeof item.positionId !== "string" || typeof item.at !== "string" || item.kind !== "vest" && item.kind !== "forfeit") throw new Error("WORKPLACE_REPLAY_INVALID");
    return { eventId: String(domainId("event", item.eventId)), positionId: domainId("position", item.positionId), at: instant(item.at), kind: item.kind };
  });
  return createWorkplaceEventParticipant(events);
} });
