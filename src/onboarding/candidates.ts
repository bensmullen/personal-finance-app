import { z } from "zod";
import { idempotencyKey, type IdempotencyKey } from "../identity/index.js";
import type { ProvenanceSourceType } from "../model/provenance.js";

export const candidateCategories = [
  "current_fact", "historical_activity", "goal", "constraint", "assumption",
  "decision_policy", "planned_event", "scenario",
] as const;
export const sourcePaths = ["guided_entry", "file_import", "conversation", "portable_model"] as const;
const token = z.string().trim().min(1).max(256);
/** Opaque identity bytes are preserved; display-text normalization is not identity normalization. */
export const opaqueIdentifierSchema = z.string().min(1).max(256).refine(value => value === value.trim(), { message: "Non-canonical identifier" });
const decimal = z.string().max(128).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const dateSchema = z.iso.date();
const precisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exact") }),
  z.strictObject({ kind: z.literal("approximate"), qualifier: token }),
]);
const valueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("money"), amount: decimal, currency: z.string().regex(/^[A-Z]{3}$/), cadence: z.enum(["one_time", "monthly", "annual"]) }),
  z.strictObject({ kind: z.literal("quantity"), amount: decimal, unit: opaqueIdentifierSchema }),
  z.strictObject({ kind: z.literal("rate"), amount: decimal, unit: z.enum(["ratio", "percent"]), basis: opaqueIdentifierSchema, period: z.enum(["monthly", "annual"]) }),
  z.strictObject({ kind: z.literal("date"), date: dateSchema }),
  z.strictObject({ kind: z.literal("text"), text: z.string().trim().min(1).max(2048) }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
]);
export const unresolvedReasons = [
  "missing_dependency", "ambiguous_mapping", "unsupported_concept", "missing_effective_date",
  "missing_occurrence_identity", "approximate_value",
] as const;
const questionSchema = z.strictObject({ reason: z.enum(unresolvedReasons), impact: z.enum(["high", "low"]) });

/** Sensitive candidate data. No instance of this contract belongs in telemetry. */
export const candidateSchema = z.strictObject({
  category: z.enum(candidateCategories),
  source: z.strictObject({
    sourceId: opaqueIdentifierSchema,
    documentId: opaqueIdentifierSchema.optional(),
    recordId: opaqueIdentifierSchema,
    sourceType: z.enum(["user", "historical_import", "financial_institution", "market_data", "model", "system"] satisfies readonly ProvenanceSourceType[]),
    path: z.enum(sourcePaths),
    format: opaqueIdentifierSchema,
    evidence: z.enum(["user_statement", "document_observation", "model_assumption"]),
    locator: z.strictObject({ reference: opaqueIdentifierSchema, line: z.number().int().positive().optional() }),
  }),
  target: z.strictObject({ subjectId: opaqueIdentifierSchema, concept: opaqueIdentifierSchema, effectiveDate: dateSchema.optional(), occurrenceId: opaqueIdentifierSchema.optional() }),
  value: valueSchema,
  precision: precisionSchema,
  confidence: z.enum(["high", "medium", "low", "unknown"]),
  unresolved: z.array(questionSchema).max(32),
});
export type Candidate = z.infer<typeof candidateSchema>;
export type CandidateCategory = Candidate["category"];
export type SourcePath = Candidate["source"]["path"];
export interface CandidateIssue {
  readonly code: "invalid_shape" | "inconsistent_source" | typeof unresolvedReasons[number];
  readonly field: string;
  readonly impact: "high" | "low";
}
export type CandidateValidation =
  | { readonly status: "invalid"; readonly issues: readonly CandidateIssue[] }
  | { readonly status: "valid" | "unresolved"; readonly candidate: Candidate; readonly key: IdempotencyKey; readonly issues: readonly CandidateIssue[] };

export const candidateKey = (input: Candidate): IdempotencyKey => {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid onboarding candidate identity");
  const candidate = parsed.data;
  return idempotencyKey("onboarding_candidate_v1", JSON.stringify([
    candidate.source.sourceType, candidate.source.sourceId, candidate.source.documentId ?? null,
    candidate.source.recordId, candidate.target.concept,
  ]));
};

/** Shape validation is separate from later canonical domain validation/confirmation. */
export function validateCandidate(input: unknown): CandidateValidation {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", issues: parsed.error.issues.map(issue => ({
    code: "invalid_shape", field: issue.path.join("."), impact: "high",
  })) };
  const candidate = parsed.data;
  const { source } = candidate;
  const compatible = source.evidence === "user_statement" ? source.sourceType === "user"
    : source.evidence === "model_assumption" ? ["model", "system"].includes(source.sourceType)
    : ["historical_import", "financial_institution", "market_data"].includes(source.sourceType);
  if (!compatible) return { status: "invalid", issues: [{ code: "inconsistent_source", field: "source.evidence", impact: "high" }] };
  const issues: CandidateIssue[] = candidate.unresolved.map(item => ({ code: item.reason, impact: item.impact, field: "unresolved" }));
  if (["current_fact", "historical_activity"].includes(candidate.category) && !candidate.target.effectiveDate) {
    issues.push({ code: "missing_effective_date", field: "target.effectiveDate", impact: "high" });
  }
  if (candidate.category === "historical_activity" && !candidate.target.occurrenceId) {
    issues.push({ code: "missing_occurrence_identity", field: "target.occurrenceId", impact: "high" });
  }
  if (candidate.precision.kind === "approximate") issues.push({ code: "approximate_value", field: "precision", impact: "high" });
  if (candidate.confidence === "low" || candidate.confidence === "unknown") {
    issues.push({ code: "ambiguous_mapping", field: "confidence", impact: "high" });
  }
  return { status: issues.length ? "unresolved" : "valid", candidate, key: candidateKey(candidate), issues };
}

export type CandidateRelation = "exact_reimport" | "identity_conflict" | "potential_duplicate" | "potential_conflict";
export interface CandidateMatch { readonly key: IdempotencyKey; readonly relation: CandidateRelation }
export interface CandidateReview {
  readonly validation: CandidateValidation;
  readonly status: "invalid" | "new" | "exact_reimport" | "review_required";
  readonly matches: readonly CandidateMatch[];
}
const targetSignature = (candidate: Candidate, includeOccurrence = true): string => JSON.stringify([
  candidate.category, candidate.target.subjectId, candidate.target.concept,
  candidate.target.effectiveDate ?? null, includeOccurrence ? candidate.target.occurrenceId ?? null : null,
]);
const valueSignature = (candidate: Candidate): string => JSON.stringify([candidate.value, candidate.precision]);
const historicalOverlap = (left: Candidate, right: Candidate): boolean =>
  left.category === "historical_activity" && right.category === "historical_activity"
  && (left.source.sourceType !== right.source.sourceType || left.source.sourceId !== right.source.sourceId)
  && left.target.effectiveDate !== undefined && right.target.effectiveDate !== undefined
  && targetSignature(left, false) === targetSignature(right, false);

/** No merge/replace/ignore decision or authoritative write is performed here. */
export function reviewCandidate(input: unknown, existing: readonly Candidate[]): CandidateReview {
  const validation = validateCandidate(input);
  if (validation.status === "invalid") return { validation, status: "invalid", matches: [] };
  const matches: CandidateMatch[] = [];
  for (const otherInput of existing) {
    const other = validateCandidate(otherInput);
    if (other.status === "invalid") throw new Error("Invalid existing onboarding candidate");
    let relation: CandidateRelation | undefined;
    if (validation.key === other.key) {
      relation = JSON.stringify(validation.candidate) === JSON.stringify(other.candidate) ? "exact_reimport" : "identity_conflict";
    } else if (targetSignature(validation.candidate) === targetSignature(other.candidate)
      || historicalOverlap(validation.candidate, other.candidate)) {
      relation = valueSignature(validation.candidate) === valueSignature(other.candidate) ? "potential_duplicate" : "potential_conflict";
    }
    if (relation) matches.push({ key: other.key, relation });
  }
  const ordered = [...new Map(matches.map(match => [JSON.stringify(match), match])).values()]
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.relation < b.relation ? -1 : a.relation > b.relation ? 1 : 0);
  const status = ordered.some(match => match.relation !== "exact_reimport") ? "review_required"
    : ordered.length ? "exact_reimport" : "new";
  return { validation, status, matches: ordered };
}
