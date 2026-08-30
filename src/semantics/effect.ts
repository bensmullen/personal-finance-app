import type { GeneratedOccurrenceKey } from "../identity/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { normalizeOccurrenceProvenance, type FactProvenance } from "../model/provenance.js";
import type { Instant } from "../time/index.js";
import type { Money } from "../values/index.js";
import type { ClaimId, RecognitionId, SemanticEffectId, SettlementId } from "./identity.js";

export type SemanticEffectKind = "flow" | "recognition" | "claim" | "settlement" | "valuation" | "state";

export interface SemanticEffect {
  readonly id: SemanticEffectId;
  readonly kind: SemanticEffectKind;
  readonly category: string;
  readonly amount?: Money;
  readonly occurredAt?: Instant;
  readonly sourceOccurrenceKey?: GeneratedOccurrenceKey;
  readonly recognitionId?: RecognitionId;
  readonly claimId?: ClaimId;
  readonly settlementId?: SettlementId;
  readonly description?: string;
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const createSemanticEffect = (draft: SemanticEffect): SemanticEffect => {
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  const occurrence = normalizeOccurrenceProvenance(draft.provenance, draft.sourceOccurrenceKey);
  const { provenance: _provenance, sourceOccurrenceKey: _sourceOccurrenceKey, ...rest } = draft;
  return Object.freeze({ ...rest, ...occurrence, ...(traceRefs === undefined ? {} : { traceRefs }) });
};
