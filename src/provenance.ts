import { failValidation, issueCodes } from "./diagnostics.js";
import type { GeneratedOccurrenceKey, IdempotencyKey } from "./identity.js";
import type { Instant } from "./time.js";

export type ProvenanceSourceType =
  | "user"
  | "historical_import"
  | "financial_institution"
  | "market_data"
  | "model"
  | "system";

interface ProvenanceBase {
  readonly sourceId: string;
  readonly effectiveAt: Instant;
  readonly confidence?: string;
}

export interface ObservedFactProvenance extends ProvenanceBase {
  readonly factKind: "observed";
  readonly sourceType: "historical_import" | "financial_institution" | "market_data";
  readonly observedAt: Instant;
  readonly importedAt?: Instant;
  readonly originalExternalId: string;
  readonly idempotencyKey: IdempotencyKey;
}

export interface UserEnteredFactProvenance extends ProvenanceBase {
  readonly factKind: "authoritative_input";
  readonly sourceType: "user";
}

export interface ModelGeneratedFactProvenance extends ProvenanceBase {
  readonly factKind: "model_generated";
  readonly sourceType: "model" | "system";
  readonly generatedOccurrenceKey?: GeneratedOccurrenceKey;
}

export type FactProvenance =
  | ObservedFactProvenance
  | UserEnteredFactProvenance
  | ModelGeneratedFactProvenance;

const invalid = (message: string, fieldPath?: string): never => failValidation({
  severity: "error",
  code: issueCodes.invalidProvenance,
  message,
  entityType: "provenance",
  ...(fieldPath === undefined ? {} : { fieldPath }),
});

export const createFactProvenance = (draft: FactProvenance): FactProvenance => {
  if (draft.sourceId.trim().length === 0) invalid("Provenance sourceId cannot be empty", "sourceId");
  if (draft.confidence !== undefined && draft.confidence.trim().length === 0) {
    invalid("Provenance confidence cannot be empty when supplied", "confidence");
  }
  if (draft.factKind === "observed") {
    if (!["historical_import", "financial_institution", "market_data"].includes(draft.sourceType)) {
      invalid("Observed provenance requires an observed external source type", "sourceType");
    }
    if (draft.originalExternalId.trim().length === 0) {
      invalid("Observed provenance requires original external identity", "originalExternalId");
    }
    return Object.freeze({ ...draft });
  }
  if (draft.factKind === "authoritative_input") {
    if (draft.sourceType !== "user") invalid("Authoritative input provenance requires sourceType user", "sourceType");
    return Object.freeze({ ...draft });
  }
  if (draft.sourceType !== "model" && draft.sourceType !== "system") {
    invalid("Model-generated provenance requires sourceType model or system", "sourceType");
  }
  return Object.freeze({ ...draft });
};

export const isObservedFact = (provenance: FactProvenance): provenance is ObservedFactProvenance =>
  provenance.factKind === "observed";

export const isModelGeneratedFact = (provenance: FactProvenance): provenance is ModelGeneratedFactProvenance =>
  provenance.factKind === "model_generated";
