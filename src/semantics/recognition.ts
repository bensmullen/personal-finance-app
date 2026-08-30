import { failValidation, issueCodes } from "../diagnostics/index.js";
import type { GeneratedOccurrenceKey } from "../identity/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { normalizeOccurrenceProvenance, type FactProvenance } from "../model/provenance.js";
import type { Instant } from "../time/index.js";
import type { Money } from "../values/index.js";
import type { RecognitionId } from "./identity.js";

export interface RecognitionFact {
  readonly id: RecognitionId;
  readonly category: string;
  readonly amount: Money;
  readonly recognizedAt: Instant;
  readonly sourceOccurrenceKey?: GeneratedOccurrenceKey;
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface RecognitionFactDraft extends Omit<RecognitionFact, "traceRefs"> {
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export const createRecognitionFact = (
  draft: RecognitionFactDraft,
  existingRecognitionIds: Iterable<string> = [],
): RecognitionFact => {
  if (new Set(existingRecognitionIds).has(draft.id)) {
    failValidation({
      severity: "error",
      code: issueCodes.duplicateRecognition,
      message: `Duplicate recognition ${draft.id}`,
      entityType: "recognition",
      entityId: draft.id,
    });
  }
  if (draft.category.trim().length === 0) throw new Error("Recognition category cannot be empty");
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  const occurrence = normalizeOccurrenceProvenance(draft.provenance, draft.sourceOccurrenceKey);
  return Object.freeze({
    id: draft.id,
    category: draft.category,
    amount: draft.amount,
    recognizedAt: draft.recognizedAt,
    ...occurrence,
    ...(traceRefs === undefined ? {} : { traceRefs }),
  });
};
