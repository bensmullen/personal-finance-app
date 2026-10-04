import { z } from "zod";
import { opaqueIdentifierSchema, reviewCandidate, validateCandidate, type Candidate, type CandidateReview } from "./candidates.js";

export const SYNTHETIC_CSV_FORMAT = "pfm-onboarding-synthetic-v1";
export const SYNTHETIC_CSV_MARKER = `#${SYNTHETIC_CSV_FORMAT}`;
export const SYNTHETIC_CSV_HEADER = "record_id,category,subject,concept,value_kind,value,currency,cadence,precision,qualifier,effective_date,occurrence_id";
export const importLimits = Object.freeze({ characters: 65536, rows: 200 });
const identitySchema = z.strictObject({ sourceId: opaqueIdentifierSchema, documentId: opaqueIdentifierSchema });
export interface ImportFile {
  readonly content: string;
  /** Stable opaque identities, reused on re-import; never a filename or session ID. */
  readonly sourceId: string;
  readonly documentId: string;
}
export const importOutcomeReasons = ["none", "material_issues", "unsupported_format", "unsupported_version", "unsupported_header", "limit_exceeded", "invalid_source_identity", "malformed_csv", "empty_import"] as const;
export type ImportOutcomeReason = typeof importOutcomeReasons[number];
type FailureReason = Exclude<ImportOutcomeReason, "none" | "material_issues">;
export type ImportIssueCode = FailureReason | "unsupported_mapping" | "invalid_row" | "unresolved_candidate" | "candidate_overlap";
export interface ImportIssue {
  readonly code: ImportIssueCode;
  readonly line?: number;
  readonly fields: readonly string[];
  readonly impact: "high";
}
export interface ImportResult {
  readonly status: "success" | "partial" | "unsupported" | "invalid";
  readonly format: typeof SYNTHETIC_CSV_FORMAT | "unsupported";
  readonly reason: ImportOutcomeReason;
  readonly candidates: readonly Candidate[];
  readonly reviews: readonly CandidateReview[];
  readonly issues: readonly ImportIssue[];
  readonly omittedRows: number;
}
export type FormatDetection =
  | { readonly status: "supported"; readonly format: typeof SYNTHETIC_CSV_FORMAT }
  | { readonly status: "unsupported"; readonly format: "unsupported"; readonly reason: "unsupported_format" | "unsupported_version" | "limit_exceeded" };

/** Detection is content/version based; filename extensions never establish support. */
export function detectImportFormat(content: string): FormatDetection {
  if (content.length > importLimits.characters) return { status: "unsupported", format: "unsupported", reason: "limit_exceeded" };
  const marker = content.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  return marker === SYNTHETIC_CSV_MARKER ? { status: "supported", format: SYNTHETIC_CSV_FORMAT }
    : { status: "unsupported", format: "unsupported", reason: marker?.startsWith("#pfm-onboarding-synthetic-") ? "unsupported_version" : "unsupported_format" };
}
interface CsvRow { readonly fields: readonly string[]; readonly line: number }

/** Bounded RFC-style quoting; malformed structure aborts the entire file. */
function parseCsv(content: string): readonly CsvRow[] | "limit_exceeded" | undefined {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  let line = 1;
  let startLine = 1;
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!;
    if (state === "quoted") {
      if (char === '"') {
        if (content[index + 1] === '"') { field += '"'; index++; }
        else state = "closed";
      } else { field += char; if (char === "\n") line++; }
      continue;
    }
    if (char === '"') {
      if (state !== "plain" || field.length) return undefined;
      state = "quoted";
    } else if (char === ",") {
      fields.push(field); field = ""; state = "plain";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r") { if (content[index + 1] !== "\n") return undefined; index++; }
      fields.push(field); rows.push({ fields, line: startLine });
      if (rows.length > importLimits.rows + 2) return "limit_exceeded";
      fields = []; field = ""; state = "plain"; line++; startLine = line;
    } else {
      if (state === "closed") return undefined;
      field += char;
    }
  }
  if (state === "quoted") return undefined;
  if (field.length || fields.length || state === "closed") { fields.push(field); rows.push({ fields, line: startLine }); }
  return rows;
}

const mappings = [
  ["current_fact", "balance", "money"], ["historical_activity", "transaction", "money"],
  ["goal", "goal", "text"], ["constraint", "constraint", "text"],
  ["assumption", "spending", "money"], ["decision_policy", "policy", "text"],
  ["planned_event", "event", "date"], ["scenario", "scenario", "text"],
] as const;

export interface ImportAdapter {
  readonly format: typeof SYNTHETIC_CSV_FORMAT;
  readonly importCandidates: (file: ImportFile, existing?: readonly Candidate[]) => ImportResult;
}

export function importCandidates(file: ImportFile, existing: readonly Candidate[] = []): ImportResult {
  const detection = detectImportFormat(file.content);
  const failure = (status: "unsupported" | "invalid", code: FailureReason): ImportResult => ({
    status, format: detection.format, reason: code, candidates: [], reviews: [], issues: [{ code, fields: [], impact: "high" }], omittedRows: 0,
  });
  if (detection.status === "unsupported") return failure("unsupported", detection.reason);
  const identity = identitySchema.safeParse({ sourceId: file.sourceId, documentId: file.documentId });
  if (!identity.success) return failure("invalid", "invalid_source_identity");
  const rows = parseCsv(file.content.replace(/^\uFEFF/, ""));
  if (rows === "limit_exceeded") return failure("invalid", "limit_exceeded");
  if (!rows) return failure("invalid", "malformed_csv");
  if (rows.length > importLimits.rows + 2) return failure("invalid", "limit_exceeded");
  if (rows[1]?.fields.join(",") !== SYNTHETIC_CSV_HEADER || rows[1]?.fields.length !== 12) return failure("unsupported", "unsupported_header");
  if (rows.length === 2) return failure("invalid", "empty_import");
  const candidates: Candidate[] = [];
  const reviews: CandidateReview[] = [];
  const issues: ImportIssue[] = [];
  let omittedRows = 0;
  for (const row of rows.slice(2)) {
    const issue = (code: ImportIssueCode, fields: readonly string[] = []): void => { issues.push({ code, line: row.line, fields, impact: "high" }); };
    if (row.fields.length !== 12) { issue("invalid_row"); omittedRows++; continue; }
    const [recordId, category, subjectId, concept, kind, rawValue, currency, cadence, precision, qualifier, effectiveDate, occurrenceId] = row.fields as readonly string[];
    if (!mappings.some(mapping => mapping[0] === category && mapping[1] === concept && mapping[2] === kind)) {
      issue("unsupported_mapping", ["category", "concept", "value_kind"]); omittedRows++; continue;
    }
    // Unused material cells are never quietly dropped.
    if ((kind !== "money" && (currency || cadence)) || (precision === "exact" && qualifier)) {
      issue("invalid_row", ["currency", "cadence", "qualifier"]); omittedRows++; continue;
    }
    if ((concept === "balance" || concept === "transaction") && cadence !== "one_time") {
      issue("unsupported_mapping", ["cadence"]); omittedRows++; continue;
    }
    const value = kind === "money" ? { kind, amount: rawValue, currency, cadence }
      : kind === "date" ? { kind, date: rawValue } : { kind, text: rawValue };
    const validation = validateCandidate({
      category,
      source: { ...identity.data, recordId, sourceType: "historical_import", path: "file_import", format: SYNTHETIC_CSV_FORMAT,
        evidence: "document_observation", locator: { reference: "csv_record", line: row.line } },
      target: { subjectId, concept, ...(effectiveDate ? { effectiveDate } : {}), ...(occurrenceId ? { occurrenceId } : {}) },
      value,
      precision: precision === "approximate" ? { kind: precision, qualifier } : { kind: precision },
      confidence: "high", unresolved: [],
    });
    if (validation.status === "invalid") { issue("invalid_row", validation.issues.map(item => item.field)); omittedRows++; continue; }
    const review = reviewCandidate(validation.candidate, [...existing, ...candidates]);
    candidates.push(validation.candidate); reviews.push(review);
    if (validation.status === "unresolved") issue("unresolved_candidate", validation.issues.map(item => item.field));
    if (review.status === "review_required") issue("candidate_overlap");
  }
  return { status: issues.length ? "partial" : "success", format: SYNTHETIC_CSV_FORMAT,
    reason: issues.length ? "material_issues" : "none", candidates, reviews, issues, omittedRows };
}

export const syntheticCsvAdapter: ImportAdapter = Object.freeze({ format: SYNTHETIC_CSV_FORMAT, importCandidates });
