import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  candidateCategories, candidateKey, detectImportFormat, importCandidates, importLimits,
  reviewCandidate, SYNTHETIC_CSV_HEADER, SYNTHETIC_CSV_MARKER, validateCandidate,
  validateOnboardingTelemetry, type Candidate, type ImportFile,
} from "../src/onboarding/index.js";

const csv = readFileSync(new URL("./fixtures/onboarding/synthetic.csv", import.meta.url), "utf8");
const file: ImportFile = { content: csv, sourceId: "synthetic-source", documentId: "synthetic-document" };
const candidate = (changes: Partial<Candidate> = {}): Candidate => ({
  category: "current_fact",
  source: { sourceId: "synthetic-source", documentId: "synthetic-document", recordId: "balance-1",
    sourceType: "historical_import", path: "file_import", format: "synthetic", evidence: "document_observation",
    locator: { reference: "row", line: 3 } },
  target: { subjectId: "synthetic-account", concept: "balance", effectiveDate: "2026-01-01" },
  value: { kind: "money", amount: "1234.56", currency: "USD", cadence: "one_time" },
  precision: { kind: "exact" }, confidence: "high", unresolved: [], ...changes,
});
const otherSource = (base: Candidate, sourceId: string): Candidate => ({ ...base, source: { ...base.source, sourceId } });
const withRows = (...rows: string[]): string => [SYNTHETIC_CSV_MARKER, SYNTHETIC_CSV_HEADER, ...rows].join("\n");
const exactRow = "balance-1,current_fact,synthetic-cash,balance,money,1234.56,USD,one_time,exact,,2026-01-01,";

describe("O1 candidate validation and review boundary (PFA-ONB-004 through 008)", () => {
  it.each(candidateCategories)("retains semantic category %s without promoting a proposal", category => {
    const result = validateCandidate(candidate({ category, target: { ...candidate().target, occurrenceId: "synthetic-activity" } }));
    expect(result.status).toBe("valid");
    if (result.status === "invalid") throw new Error("Expected candidate");
    expect(result.candidate.category).toBe(category);
    expect(result.candidate.source.evidence).toBe("document_observation");
    expect(result.candidate).not.toHaveProperty("authoritative");
  });

  it("preserves decimal precision and explicitly requires review of approximate amounts", () => {
    const base = candidate({ value: { kind: "money", amount: "9007199254740993.123456789", currency: "USD", cadence: "annual" },
      precision: { kind: "approximate", qualifier: "about" } });
    const result = validateCandidate(base);
    expect(result.status).toBe("unresolved");
    if (result.status === "invalid") throw new Error("Expected candidate");
    expect(result.candidate.value).toEqual(base.value);
    expect(result.candidate.precision).toEqual(base.precision);
    expect(result.issues).toContainEqual({ code: "approximate_value", field: "precision", impact: "high" });
    expect(base).toEqual(candidate({ value: base.value, precision: base.precision }));
  });

  it.each([null, {}, { ...candidate(), category: "tax_fact_inferred" },
    { ...candidate(), value: { kind: "money", amount: 1.23, currency: "USD", cadence: "monthly" } },
    { ...candidate(), value: { kind: "money", amount: "1e3", currency: "USD", cadence: "monthly" } },
    { ...candidate(), precision: { kind: "approximate" } },
    { ...candidate(), target: { ...candidate().target, effectiveDate: "2026-02-30" } },
    { ...candidate(), commit: true },
  ])("rejects malformed candidate %#", input => expect(validateCandidate(input).status).toBe("invalid"));

  it("validates explicit quantity units, rate periods/bases, dates and booleans", () => {
    for (const value of [
      { kind: "quantity", amount: "1.25", unit: "shares" },
      { kind: "rate", amount: "4.5", unit: "percent", basis: "nominal", period: "annual" },
      { kind: "date", date: "2028-02-29" }, { kind: "boolean", value: false },
    ] as const) expect(validateCandidate(candidate({ value })).status).toBe("valid");
    expect(validateCandidate({ ...candidate(), value: { kind: "rate", amount: "4.5" } }).status).toBe("invalid");
  });

  it("keeps missing dependencies, dates, occurrence IDs and low confidence unresolved", () => {
    const input = candidate({ category: "historical_activity", target: { subjectId: "synthetic", concept: "transaction" },
      confidence: "low", unresolved: [{ reason: "missing_dependency", impact: "high" }] });
    const result = validateCandidate(input);
    expect(result.status).toBe("unresolved");
    expect(result.issues.map(issue => issue.code)).toEqual([
      "missing_dependency", "missing_effective_date", "missing_occurrence_identity", "ambiguous_mapping",
    ]);
    expect(input.target).not.toHaveProperty("effectiveDate");
  });

  it("reuses provenance source types without inventing confirmation", () => {
    const base = candidate();
    expect(validateCandidate({ ...base, source: { ...base.source, sourceType: "user" } }).status).toBe("invalid");
    expect(validateCandidate({ ...base, source: { ...base.source, sourceType: "user", evidence: "user_statement" } }).status).toBe("valid");
  });

  it("detects exact re-import and identity reuse with changed value/category", () => {
    const base = candidate();
    expect(reviewCandidate(base, [base])).toMatchObject({ status: "exact_reimport", matches: [{ relation: "exact_reimport" }] });
    for (const changed of [candidate({ value: { kind: "money", amount: "100", currency: "USD", cadence: "one_time" } }), candidate({ category: "goal" })]) {
      expect(candidateKey(changed)).toBe(candidateKey(base));
      expect(reviewCandidate(changed, [base])).toMatchObject({ status: "review_required", matches: [{ relation: "identity_conflict" }] });
    }
  });

  it("surfaces cross-source duplicates/conflicts and remains invariant to comparison order", () => {
    const base = candidate();
    const same = otherSource(base, "synthetic-other");
    const different = otherSource(candidate({ value: { kind: "money", amount: "999", currency: "USD", cadence: "one_time" } }), "synthetic-third");
    const existing = [base, same, different];
    expect(reviewCandidate(base, existing)).toEqual(reviewCandidate(base, [...existing].reverse()));
    expect(reviewCandidate(base, existing).matches.map(match => match.relation).sort()).toEqual(["exact_reimport", "potential_conflict", "potential_duplicate"]);
    expect(reviewCandidate(base, existing).status).toBe("review_required");
    expect(reviewCandidate(candidate({ category: "goal" }), [same]).status).toBe("new");
  });

  it("preserves same-source distinct historical occurrences", () => {
    const base = candidate({ category: "historical_activity", target: { ...candidate().target, occurrenceId: "synthetic-payment-1" } });
    const separate = { ...base, source: { ...base.source, recordId: "another-record", documentId: "another-export" },
      target: { ...base.target, occurrenceId: "synthetic-payment-2" } };
    expect(reviewCandidate(base, [separate]).status).toBe("new");
    // Reusing the original record identity still requires review.
    expect(reviewCandidate(base, [{ ...base, target: separate.target }]).matches[0]?.relation).toBe("identity_conflict");
  });

  it("surfaces bounded cross-source historical duplicates/conflicts despite different external occurrence IDs", () => {
    const base = candidate({ category: "historical_activity", target: { ...candidate().target, occurrenceId: "synthetic-payment-1" } });
    const duplicate = otherSource({ ...base, target: { ...base.target, occurrenceId: "synthetic-payment-2" } }, "synthetic-other");
    const conflict = otherSource({ ...duplicate, value: { kind: "money", amount: "999", currency: "USD", cadence: "one_time" } }, "synthetic-third");
    expect(reviewCandidate(base, [duplicate])).toMatchObject({ status: "review_required", matches: [{ relation: "potential_duplicate" }] });
    expect(reviewCandidate(base, [conflict])).toMatchObject({ status: "review_required", matches: [{ relation: "potential_conflict" }] });
    expect(reviewCandidate(base, [duplicate, conflict])).toEqual(reviewCandidate(base, [conflict, duplicate]));
    expect(reviewCandidate(base, [{ ...duplicate, target: { ...duplicate.target, effectiveDate: "2026-01-02" } }]).status).toBe("new");
    expect(reviewCandidate(base, [{ ...duplicate, target: { ...duplicate.target, subjectId: "another-target" } }]).status).toBe("new");
    expect(reviewCandidate(base, [{ ...duplicate, target: { ...duplicate.target, concept: "another-concept" } }]).status).toBe("new");
    expect(reviewCandidate(base, [{ ...duplicate, target: { subjectId: base.target.subjectId, concept: base.target.concept, occurrenceId: "different" } }]).status).toBe("new");
    const anotherSourceType = { ...duplicate, source: { ...duplicate.source, sourceId: base.source.sourceId, sourceType: "financial_institution" as const } };
    expect(reviewCandidate(base, [anotherSourceType]).matches[0]?.relation).toBe("potential_duplicate");
    expect(reviewCandidate(base, [otherSource({ ...base, precision: { kind: "approximate", qualifier: "roughly" } }, "synthetic-other")]).matches[0]?.relation).toBe("potential_conflict");
    expect(reviewCandidate(null, [base]).status).toBe("invalid");
  });

  it("agrees on identity through every public key path for accepted input", () => {
    for (const input of [candidate(), candidate({ precision: { kind: "approximate", qualifier: " about " } }),
      candidate({ source: { ...candidate().source, sourceId: "opaque:source", recordId: "opaque:record" },
        target: { ...candidate().target, subjectId: "opaque:subject", concept: "opaque:concept", occurrenceId: "opaque:occurrence" } })]) {
      const validation = validateCandidate(input);
      if (validation.status === "invalid") throw new Error("Expected accepted candidate");
      expect(candidateKey(input)).toBe(validation.key);
      expect(candidateKey(validation.candidate)).toBe(validation.key);
      expect(validation.candidate.source).toEqual(input.source);
      expect(validation.candidate.target).toEqual(input.target);
    }
  });

  it("rejects non-canonical opaque identity whitespace before validation or public key construction", () => {
    const base = candidate();
    const inputs = [
      ...["sourceId", "documentId", "recordId", "format"].flatMap(field => [" padded", "padded ", " \t", ""].map(value => ({ ...base, source: { ...base.source, [field]: value } }))),
      ...["subjectId", "concept", "occurrenceId"].flatMap(field => [" padded", "padded ", " \t", ""].map(value => ({ ...base, target: { ...base.target, [field]: value } }))),
      { ...base, source: { ...base.source, locator: { reference: " padded " } } },
    ];
    for (const input of inputs) {
      expect(validateCandidate(input).status).toBe("invalid");
      expect(() => candidateKey(input)).toThrow("Invalid onboarding candidate identity");
    }
  });

  it("uses collision-safe source/document/record/field identities", () => {
    const base = candidate();
    expect(candidateKey(base)).not.toBe(candidateKey({ ...base, source: { ...base.source, documentId: "another-synthetic-document" } }));
    expect(candidateKey(otherSource(base, "a:b"))).not.toBe(candidateKey({ ...base, source: { ...base.source, sourceId: "a", documentId: "b:synthetic-document" } }));
  });
});

describe("bounded synthetic CSV import (PFA-ONB-003, 005, 008, 012)", () => {
  it("produces all eight categories with source locators and flags approximate spending", () => {
    const before = structuredClone(file);
    const result = importCandidates(file);
    expect(result.status).toBe("partial");
    expect(result.candidates.map(item => item.category)).toEqual(candidateCategories);
    expect(result.candidates[0]?.source).toMatchObject({ documentId: file.documentId, locator: { reference: "csv_record", line: 3 } });
    expect(result.candidates[2]?.value).toEqual({ kind: "text", text: "Save for a trip, then review" });
    expect(result.candidates[4]?.precision).toEqual({ kind: "approximate", qualifier: "roughly" });
    expect(result.issues).toEqual([{ code: "unresolved_candidate", line: 7, fields: ["precision"], impact: "high" }]);
    expect(result.omittedRows).toBe(0);
    expect(importCandidates(file)).toEqual(result);
    expect(file).toEqual(before);
  });

  it("reports exact repeated imports and within-file duplicate identities without choosing a merge", () => {
    const first = importCandidates(file);
    const before = structuredClone(first.candidates);
    const repeated = importCandidates(file, first.candidates);
    expect(repeated.reviews.every(review => review.status === "exact_reimport")).toBe(true);
    expect(first.candidates).toEqual(before);
    const duplicate = importCandidates({ ...file, content: withRows(exactRow, exactRow) });
    // Same external identity at another row is explicitly conflicting metadata.
    expect(duplicate.reviews[1]?.matches[0]?.relation).toBe("identity_conflict");
    expect(duplicate.status).toBe("partial");
  });

  it("keeps a clean exact repeat successful without a material overlap issue", () => {
    const exactFile = { ...file, content: withRows(exactRow) };
    const first = importCandidates(exactFile);
    const repeated = importCandidates(exactFile, first.candidates);
    expect(repeated.reviews[0]?.status).toBe("exact_reimport");
    expect(repeated).toMatchObject({ status: "success", reason: "none", issues: [] });
    expect(repeated.candidates).toEqual(first.candidates);
    expect(repeated.issues.some(issue => issue.code === "candidate_overlap")).toBe(false);
    const changed = importCandidates({ ...exactFile, content: withRows(exactRow.replace("1234.56", "999")) }, first.candidates);
    expect(changed.reviews[0]?.matches[0]?.relation).toBe("identity_conflict");
    expect(changed).toMatchObject({ status: "partial", reason: "material_issues", issues: [{ code: "candidate_overlap" }] });
  });

  it("supports exact bounded files, CRLF/BOM and escaped quotes", () => {
    const exact = importCandidates({ ...file, content: withRows(exactRow) });
    expect(exact.status).toBe("success");
    expect(exact.issues).toEqual([]);
    expect(importCandidates({ ...file, content: "\uFEFF" + withRows(exactRow).replaceAll("\n", "\r\n") }).candidates).toEqual(exact.candidates);
    const quoted = 'goal-1,goal,synthetic,goal,text,"A ""quoted""\nplan",,,exact,,,';
    expect(importCandidates({ ...file, content: withRows(quoted) }).candidates[0]?.value).toEqual({ kind: "text", text: 'A "quoted"\nplan' });
  });

  it("deliberately rejects unsupported versions/content/headers and oversized input", () => {
    for (const content of ["%PDF-synthetic", "date,amount\n2026-01-01,12", csv.replace("synthetic-v1", "synthetic-v2"), ""]) {
      expect(detectImportFormat(content).status).toBe("unsupported");
      expect(importCandidates({ ...file, content })).toMatchObject({ status: "unsupported", candidates: [], reviews: [] });
    }
    expect(importCandidates({ ...file, content: csv.replace("record_id,", "unknown,") }).issues[0]?.code).toBe("unsupported_header");
    expect(importCandidates({ ...file, content: csv.replace("synthetic-v1", "synthetic-v2") }).reason).toBe("unsupported_version");
    expect(detectImportFormat("x".repeat(importLimits.characters + 1))).toMatchObject({ reason: "limit_exceeded" });
  });

  it("aborts malformed quoting/structure, invalid identities and empty/over-limit files", () => {
    for (const content of [withRows(exactRow, '"unclosed'), withRows('bad"quote'), withRows('"closed"extra'), withRows(exactRow).replaceAll("\n", "\r")]) {
      expect(importCandidates({ ...file, content }).candidates).toEqual([]);
    }
    expect(importCandidates({ ...file, sourceId: "" }).status).toBe("invalid");
    for (const identity of [{ sourceId: " padded " }, { documentId: " padded " }]) {
      expect(importCandidates({ ...file, ...identity })).toMatchObject({ status: "invalid", reason: "invalid_source_identity", candidates: [] });
    }
    expect(importCandidates({ ...file, content: withRows(exactRow.replace("balance-1", " balance-1 ")) }).omittedRows).toBe(1);
    expect(importCandidates({ ...file, content: withRows() }).issues[0]?.code).toBe("empty_import");
    expect(importCandidates({ ...file, content: withRows(...Array.from({ length: importLimits.rows + 1 }, () => exactRow)) }).candidates).toEqual([]);
    expect(importCandidates({ ...file, content: withRows(...Array.from({ length: importLimits.rows + 1 }, () => exactRow)) + "\n" }).issues[0]?.code).toBe("limit_exceeded");
    expect(importCandidates({ ...file, content: withRows(exactRow.replace("one_time", "monthly")) }).issues[0]?.code).toBe("unsupported_mapping");
  });

  it("reports omitted rows/fields and unresolved material items rather than inventing data", () => {
    const result = importCandidates({ ...file, content: withRows(
      exactRow,
      "bad,current_fact,synthetic,interest,money,5,USD,annual,exact,,2026-01-01,",
      exactRow.replace("1234.56", "missing"),
      "missing-date,current_fact,synthetic,balance,money,4,USD,one_time,exact,,,",
      "unused,goal,synthetic,goal,text,Save,USD,monthly,exact,,,",
      "wrong-column-count,current_fact",
    ) });
    expect(result.status).toBe("partial");
    expect(result.omittedRows).toBe(4);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[1]?.target).not.toHaveProperty("effectiveDate");
    expect(result.issues.map(issue => [issue.line, issue.code])).toEqual([
      [4, "unsupported_mapping"], [5, "invalid_row"], [6, "unresolved_candidate"], [7, "invalid_row"], [8, "invalid_row"],
    ]);
  });
});

describe("privacy-safe event boundary (PFA-ONB-001, 009, 010)", () => {
  const progress = { event: "stage_progress", stage: "minimum_valid_model", outcome: "completed", elapsedMs: 1200,
    manualSteps: 2, corrections: 1, rejections: 0, unresolvedHighImpactItems: 1 };
  const counts = { event: "candidate_counts", stage: "candidate_review",
    countsByCategory: { current_fact: 1, historical_activity: 1, goal: 1, constraint: 1, assumption: 1, decision_policy: 1, planned_event: 1, scenario: 1 },
    countsBySourcePath: { guided_entry: 0, file_import: 8, conversation: 0, portable_model: 0 } };

  it("accepts bounded stage/duration/effort, candidate type/source mix and import status aggregates", () => {
    for (const event of [progress, counts, { event: "import_result", format: "unsupported", status: "unsupported", reason: "unsupported_format", elapsedMs: 1,
      candidateCount: 0, omittedRows: 0, unresolvedHighImpactItems: 0 }]) {
      expect(validateOnboardingTelemetry(event)).toEqual({ status: "accepted", event });
    }
  });

  const importEvent = { event: "import_result", format: "pfm-onboarding-synthetic-v1", status: "success", reason: "none", elapsedMs: 1,
    candidateCount: 1, omittedRows: 0, unresolvedHighImpactItems: 0 };
  it("accepts coherent closed import status/reason/count combinations", () => {
    const inputs = [importEvent,
      { ...importEvent, status: "partial", reason: "material_issues" }, // Overlap review without omissions.
      { ...importEvent, status: "partial", reason: "material_issues", unresolvedHighImpactItems: 2 },
      { ...importEvent, status: "partial", reason: "material_issues", candidateCount: 0, omittedRows: 1 },
      { ...importEvent, status: "unsupported", reason: "unsupported_header", candidateCount: 0 },
      ...["unsupported_format", "unsupported_version", "limit_exceeded"].map(reason => ({ ...importEvent, format: "unsupported", status: "unsupported", reason, candidateCount: 0 })),
      ...["limit_exceeded", "invalid_source_identity", "malformed_csv", "empty_import"].map(reason => ({ ...importEvent, status: "invalid", reason, candidateCount: 0 })),
    ];
    for (const event of inputs) expect(validateOnboardingTelemetry(event)).toEqual({ status: "accepted", event });
  });

  it("rejects impossible import formats, reasons, statuses and counts without echoing input", () => {
    const inputs = [
      { ...importEvent, format: "unsupported" },
      { ...importEvent, format: "unsupported", status: "partial", reason: "material_issues" },
      { ...importEvent, status: "unsupported", candidateCount: 0 },
      { ...importEvent, status: "unsupported", reason: "unsupported_format", candidateCount: 0 },
      { ...importEvent, reason: "malformed_csv" }, { ...importEvent, reason: undefined },
      { ...importEvent, reason: "SYNTHETIC-SENSITIVE-SENTINEL" },
      { ...importEvent, candidateCount: 0 }, { ...importEvent, omittedRows: 1 }, { ...importEvent, unresolvedHighImpactItems: 1 },
      { ...importEvent, status: "partial", reason: "none" },
      { ...importEvent, status: "partial", reason: "material_issues", candidateCount: 0 },
      { ...importEvent, status: "partial", reason: "material_issues", candidateCount: 0, unresolvedHighImpactItems: 1 },
      { ...importEvent, status: "invalid", reason: "unsupported_header", candidateCount: 0 },
      { ...importEvent, status: "invalid", reason: "malformed_csv" },
      { ...importEvent, status: "invalid", reason: "malformed_csv", candidateCount: 0, omittedRows: 1 },
      { ...importEvent, status: "invalid", reason: "malformed_csv", candidateCount: 0, unresolvedHighImpactItems: 1 },
      { ...importEvent, format: "unsupported", status: "invalid", reason: "malformed_csv", candidateCount: 0 },
      { ...importEvent, format: "unsupported", status: "unsupported", reason: "unsupported_header", candidateCount: 0 },
      { ...importEvent, format: "unsupported", status: "unsupported", reason: "unsupported_version" },
      { ...importEvent, format: "unsupported", status: "unsupported", reason: "unsupported_format", candidateCount: 0, omittedRows: 1 },
      { ...importEvent, format: "unsupported", status: "unsupported", reason: "limit_exceeded", candidateCount: 0, unresolvedHighImpactItems: 1 },
      { ...importEvent, filename: "SYNTHETIC-SENSITIVE-SENTINEL" },
    ];
    for (const input of inputs) expect(validateOnboardingTelemetry(input)).toEqual({ status: "rejected", reason: "invalid_telemetry" });
  });

  it("exposes adapter outcome reasons through the closed telemetry contract", () => {
    for (const content of [withRows(exactRow), csv, "%PDF-synthetic", csv.replace("synthetic-v1", "synthetic-v2"),
      csv.replace("record_id,", "unknown,"), withRows('"unclosed'), withRows(),
      "x".repeat(importLimits.characters + 1), withRows(...Array.from({ length: importLimits.rows + 1 }, () => exactRow))]) {
      const result = importCandidates({ ...file, content });
      const event = { ...importEvent, format: result.format, status: result.status, reason: result.reason,
        candidateCount: result.candidates.length, omittedRows: result.omittedRows,
        unresolvedHighImpactItems: result.reviews.reduce((sum, review) => sum + review.validation.issues.filter(issue => issue.impact === "high").length, 0) };
      expect(validateOnboardingTelemetry(event)).toEqual({ status: "accepted", event });
    }
  });

  it.each(["rawFinancialValue", "documentContents", "transcript", "accountNumber", "filename", "sourceId", "candidate"])("rejects sensitive extra field %s without echoing its value", field => {
    expect(validateOnboardingTelemetry({ ...progress, [field]: "SYNTHETIC-SENSITIVE-SENTINEL" })).toEqual({ status: "rejected", reason: "invalid_telemetry" });
  });

  it("rejects sensitive nested labels, arbitrary strings, inconsistent totals and invalid counters", () => {
    const inputs = [
      { ...counts, countsBySourcePath: { ...counts.countsBySourcePath, filename: "synthetic-private.csv" } },
      { ...counts, countsByCategory: { ...counts.countsByCategory, goal: 2 } },
      { ...progress, stage: "synthetic-account-name" },
      { ...progress, elapsedMs: -1 }, { ...progress, manualSteps: 1.5 }, { ...progress, corrections: Infinity },
      { ...progress, elapsedMs: Number.MAX_SAFE_INTEGER + 1 }, candidate(),
      // Totals remain exact even when aggregate sums exceed safe integer range.
      { ...counts, countsByCategory: { ...counts.countsByCategory, current_fact: Number.MAX_SAFE_INTEGER, historical_activity: Number.MAX_SAFE_INTEGER, goal: 2 },
        countsBySourcePath: { guided_entry: Number.MAX_SAFE_INTEGER, file_import: Number.MAX_SAFE_INTEGER, conversation: 6, portable_model: 0 } },
    ];
    for (const input of inputs) expect(validateOnboardingTelemetry(input)).toEqual({ status: "rejected", reason: "invalid_telemetry" });
  });
});
