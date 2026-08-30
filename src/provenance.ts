import { failValidation, issueCodes } from "./diagnostics.js";
import type { GeneratedOccurrenceKey, IdempotencyKey } from "./identity.js";
import { instant, type Instant } from "./time.js";

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
  if (typeof draft !== "object" || draft === null) invalid("Provenance must be an object");
  if (typeof draft.sourceId !== "string" || draft.sourceId.trim().length === 0) invalid("Provenance sourceId cannot be empty", "sourceId");
  const validateInstant = (value: unknown, fieldPath: string): void => {
    if (typeof value !== "string") return invalid(`Provenance ${fieldPath} must be a valid UTC instant`, fieldPath);
    try { instant(value); } catch { return invalid(`Provenance ${fieldPath} must be a valid UTC instant`, fieldPath); }
  };
  validateInstant(draft.effectiveAt, "effectiveAt");
  if (draft.confidence !== undefined && (typeof draft.confidence !== "string" || draft.confidence.trim().length === 0)) {
    invalid("Provenance confidence cannot be empty when supplied", "confidence");
  }
  if (draft.factKind === "observed") {
    if (!["historical_import", "financial_institution", "market_data"].includes(draft.sourceType)) {
      invalid("Observed provenance requires an observed external source type", "sourceType");
    }
    validateInstant(draft.observedAt, "observedAt");
    if (draft.importedAt !== undefined) validateInstant(draft.importedAt, "importedAt");
    if (typeof draft.originalExternalId !== "string" || draft.originalExternalId.trim().length === 0) {
      invalid("Observed provenance requires original external identity", "originalExternalId");
    }
    if (typeof draft.idempotencyKey !== "string" || draft.idempotencyKey.trim().length === 0) {
      invalid("Observed provenance requires an idempotency key", "idempotencyKey");
    }
    return Object.freeze({ ...draft });
  }
  if (draft.factKind === "authoritative_input") {
    if (draft.sourceType !== "user") invalid("Authoritative input provenance requires sourceType user", "sourceType");
    return Object.freeze({ ...draft });
  }
  if (draft.factKind !== "model_generated") invalid("Unsupported provenance factKind", "factKind");
  if (draft.sourceType !== "model" && draft.sourceType !== "system") {
    invalid("Model-generated provenance requires sourceType model or system", "sourceType");
  }
  if (draft.generatedOccurrenceKey !== undefined && (typeof draft.generatedOccurrenceKey !== "string" || draft.generatedOccurrenceKey.trim().length === 0)) {
    invalid("Generated occurrence key cannot be empty when supplied", "generatedOccurrenceKey");
  }
  return Object.freeze({ ...draft });
};

export const isObservedFact = (provenance: FactProvenance): provenance is ObservedFactProvenance =>
  provenance.factKind === "observed";

export const isModelGeneratedFact = (provenance: FactProvenance): provenance is ModelGeneratedFactProvenance =>
  provenance.factKind === "model_generated";

export interface NormalizedOccurrenceProvenance {
  readonly provenance?: FactProvenance;
  readonly sourceOccurrenceKey?: GeneratedOccurrenceKey;
}

/** Validates caller-supplied provenance and reconciles its generated identity with the semantic record. */
export const normalizeOccurrenceProvenance = (
  provenance?: FactProvenance,
  sourceOccurrenceKey?: GeneratedOccurrenceKey,
): NormalizedOccurrenceProvenance => {
  const normalized = provenance === undefined ? undefined : createFactProvenance(provenance);
  const provenanceKey = normalized !== undefined && isModelGeneratedFact(normalized)
    ? normalized.generatedOccurrenceKey
    : undefined;
  if (sourceOccurrenceKey !== undefined && provenanceKey !== undefined && sourceOccurrenceKey !== provenanceKey) {
    invalid("sourceOccurrenceKey must equal provenance.generatedOccurrenceKey", "sourceOccurrenceKey");
  }
  const effectiveKey = provenanceKey ?? sourceOccurrenceKey;
  return Object.freeze({
    ...(normalized === undefined ? {} : { provenance: normalized }),
    ...(effectiveKey === undefined ? {} : { sourceOccurrenceKey: effectiveKey }),
  });
};
