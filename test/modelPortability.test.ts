import { describe, expect, it } from "vitest";
import {
  exportPersonalModelJson,
  importPersonalModelJson,
  migratePersonalModelVersion,
  validatePersonalModelJson,
} from "../src/application/index.js";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { domainId } from "../src/identity/index.js";
import {
  CURRENT_MODEL_FORMAT_VERSION,
  LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION,
  ModelMigrationRegistry,
  type ModelMigration,
  type PortableModelEnvelope,
} from "../src/model/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../src/model/version.js";

const MODEL_ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const OLD_FORMAT = "0.1.5-separated-draft";
const FUTURE_FINANCIAL_SPEC = "99.0.0-future";

const currentDocument = (overrides: Record<string, unknown> = {}) => ({
  model_format_version: CURRENT_MODEL_FORMAT_VERSION,
  financial_specification_version: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
  model_id: MODEL_ID,
  objects: {
    Account: [{ id: "synthetic-account", labels: ["second", "first"], balance: null }],
    CustomCollection: [{ nested: { z: 2, a: true }, exactText: "123.4500" }],
  },
  ...overrides,
});

const asJson = (value: unknown): string => JSON.stringify(value);

const capturedIssues = (operation: () => unknown) => {
  try {
    operation();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues;
    throw error;
  }
  throw new Error("Expected ValidationError");
};

const capturedIssue = (operation: () => unknown) => capturedIssues(operation)[0]!;

const migration: ModelMigration = {
  migrationId: "test:old-to-current",
  sourceVersion: OLD_FORMAT,
  targetVersion: CURRENT_MODEL_FORMAT_VERSION,
  migrate: (source) => ({ ...source, model_format_version: CURRENT_MODEL_FORMAT_VERSION }),
};

const migrationRegistry = new ModelMigrationRegistry([migration]);

describe("personal model validation and direct import", () => {
  it("validates a current synthetic model as directly importable", () => {
    const report = validatePersonalModelJson(asJson(currentDocument()));
    expect(report).toEqual(expect.objectContaining({
      jsonParsed: true,
      detectedModelFormatVersion: CURRENT_MODEL_FORMAT_VERSION,
      modelFormatCompatibility: "supported_directly",
      detectedFinancialSpecificationVersion: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      financialSpecificationCompatibility: "supported_directly",
      directlyImportable: true,
      explicitMigrationAvailable: false,
      issues: [],
    }));
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.issues)).toBe(true);
  });

  it("imports and exports the complete objects graph losslessly while preserving array order", () => {
    const document = currentDocument();
    const first = importPersonalModelJson(asJson(document));
    expect(first.modelFormatVersion).toBe(CURRENT_MODEL_FORMAT_VERSION);
    expect(first.financialSpecificationVersion).toBe(CURRENT_RUN_VERSIONS.financialSpecificationVersion);
    expect(first.modelId).toBe(MODEL_ID.toLowerCase());
    expect(first.objects).toEqual(document.objects);
    expect(first.objects.Account?.[0]).toEqual(expect.objectContaining({ labels: ["second", "first"] }));
    expect(importPersonalModelJson(exportPersonalModelJson(first))).toEqual(first);
  });

  it("produces deterministic bytes independent of object property insertion order", () => {
    const first = importPersonalModelJson(asJson(currentDocument({
      objects: { Zed: [{ z: 1, a: { y: 2, x: 1 } }], Alpha: [] },
    })));
    const second = importPersonalModelJson(asJson(currentDocument({
      objects: { Alpha: [], Zed: [{ a: { x: 1, y: 2 }, z: 1 }] },
    })));
    expect(exportPersonalModelJson(first)).toBe(exportPersonalModelJson(second));
    expect(exportPersonalModelJson(first).endsWith("\n")).toBe(true);
  });

  it("does not mutate exported input and returns an isolated deeply frozen import", () => {
    const mutableObjects = currentDocument().objects;
    const model = {
      modelFormatVersion: CURRENT_MODEL_FORMAT_VERSION,
      financialSpecificationVersion: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      modelId: domainId("model", MODEL_ID),
      objects: mutableObjects,
    } as PortableModelEnvelope;
    const before = structuredClone(mutableObjects);
    exportPersonalModelJson(model);
    expect(mutableObjects).toEqual(before);

    const imported = importPersonalModelJson(asJson(currentDocument()));
    expect(Object.isFrozen(imported)).toBe(true);
    expect(Object.isFrozen(imported.objects)).toBe(true);
    expect(Object.isFrozen(imported.objects.Account)).toBe(true);
    expect(Object.isFrozen(imported.objects.Account?.[0])).toBe(true);
    mutableObjects.Account[0]!.labels[0] = "changed";
    expect(imported.objects.Account?.[0]).toEqual(expect.objectContaining({ labels: ["second", "first"] }));
  });

  it("requires independent support for format and financial-specification versions", () => {
    expect(importPersonalModelJson(asJson(currentDocument())).financialSpecificationVersion)
      .toBe(CURRENT_RUN_VERSIONS.financialSpecificationVersion);
    const financial = capturedIssue(() => importPersonalModelJson(asJson(currentDocument({
      financial_specification_version: FUTURE_FINANCIAL_SPEC,
    }))));
    expect(financial).toEqual(expect.objectContaining({
      code: issueCodes.unsupportedFinancialSpecification,
      fieldPath: "financial_specification_version",
    }));
    const format = capturedIssue(() => importPersonalModelJson(asJson(currentDocument({
      model_format_version: "99.0.0-future",
    }))));
    expect(format).toEqual(expect.objectContaining({
      code: issueCodes.unsupportedModelFormat,
      fieldPath: "model_format_version",
    }));
  });
});

describe("portable envelope structural validation", () => {
  const { model_id: _removedModelId, ...missingModelId } = currentDocument();

  it.each([
    ["malformed JSON", "{not-json"],
    ["null root", "null"],
    ["array root", "[]"],
    ["scalar root", "42"],
    ["missing field", asJson(missingModelId)],
  ])("rejects %s", (_name, input) => {
    expect(capturedIssue(() => importPersonalModelJson(input)).code).toBe(issueCodes.modelDocumentInvalid);
  });

  it.each([
    ["wrong format type", { model_format_version: 2 }, "model_format_version"],
    ["wrong financial type", { financial_specification_version: 2 }, "financial_specification_version"],
    ["invalid model id", { model_id: "not-a-uuid" }, "model_id"],
    ["non-object objects", { objects: [] }, "objects"],
    ["non-array collection", { objects: { Account: {} } }, "objects.Account"],
  ])("rejects %s", (_name, overrides, fieldPath) => {
    const issue = capturedIssues(() => importPersonalModelJson(asJson(currentDocument(overrides))))
      .find((candidate) => candidate.fieldPath === fieldPath);
    expect(issue?.code).toBe(issueCodes.modelDocumentInvalid);
  });

  it.each([
    ["undefined", undefined],
    ["function", () => 1],
    ["symbol", Symbol("x")],
    ["bigint", 1n],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("rejects programmatic %s values during export", (_name, invalid) => {
    const model = {
      modelFormatVersion: CURRENT_MODEL_FORMAT_VERSION,
      financialSpecificationVersion: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      modelId: domainId("model", MODEL_ID),
      objects: { Synthetic: [{ invalid }] },
    } as unknown as PortableModelEnvelope;
    expect(capturedIssue(() => exportPersonalModelJson(model))).toEqual(expect.objectContaining({
      code: issueCodes.modelDocumentInvalid,
      fieldPath: "objects.Synthetic.0.invalid",
    }));
  });
});

describe("explicit model-format migration", () => {
  const oldDocument = (financialSpecificationVersion = CURRENT_RUN_VERSIONS.financialSpecificationVersion) => currentDocument({
    model_format_version: OLD_FORMAT,
    financial_specification_version: financialSpecificationVersion,
  });

  it("classifies migratable input, refuses direct import, and migrates explicitly", () => {
    const source = oldDocument();
    const sourceJson = asJson(source);
    const report = validatePersonalModelJson(sourceJson, migrationRegistry);
    expect(report).toEqual(expect.objectContaining({
      modelFormatCompatibility: "migratable",
      directlyImportable: false,
      explicitMigrationAvailable: true,
    }));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: issueCodes.modelMigrationRequired }));
    expect(capturedIssue(() => importPersonalModelJson(sourceJson, migrationRegistry))).toEqual(expect.objectContaining({
      code: issueCodes.modelMigrationRequired,
      fieldPath: "model_format_version",
    }));

    const first = migratePersonalModelVersion(sourceJson, CURRENT_MODEL_FORMAT_VERSION, migrationRegistry);
    const second = migratePersonalModelVersion(sourceJson, CURRENT_MODEL_FORMAT_VERSION, migrationRegistry);
    expect(first).toBe(second);
    expect(source).toEqual(oldDocument());
    const migrated = JSON.parse(first) as Record<string, unknown>;
    expect(migrated.model_format_version).toBe(CURRENT_MODEL_FORMAT_VERSION);
    expect(migrated.financial_specification_version).toBe(CURRENT_RUN_VERSIONS.financialSpecificationVersion);
    expect(migrated.model_id).toBe(MODEL_ID.toLowerCase());
    expect(importPersonalModelJson(first).objects).toEqual(source.objects);
  });

  it("requires complete chains and declared output versions", () => {
    const missing = capturedIssue(() => migratePersonalModelVersion(asJson(oldDocument()), CURRENT_MODEL_FORMAT_VERSION, new ModelMigrationRegistry()));
    expect(missing.code).toBe(issueCodes.unsupportedModelFormat);

    const gapRegistry = new ModelMigrationRegistry([{
      migrationId: "test:old-to-gap",
      sourceVersion: OLD_FORMAT,
      targetVersion: "0.1.6-gap",
      migrate: (source) => ({ ...source, model_format_version: "0.1.6-gap" }),
    }]);
    expect(capturedIssue(() => migratePersonalModelVersion(asJson(oldDocument()), CURRENT_MODEL_FORMAT_VERSION, gapRegistry)).code)
      .toBe(issueCodes.modelMigrationUnavailable);

    const wrongOutput = new ModelMigrationRegistry([{
      ...migration,
      migrate: (source) => source,
    }]);
    expect(capturedIssue(() => migratePersonalModelVersion(asJson(oldDocument()), CURRENT_MODEL_FORMAT_VERSION, wrongOutput)).code)
      .toBe(issueCodes.modelVersionMismatch);
  });

  it("runs every registered step in order and rejects non-JSON migration output", () => {
    const intermediate = "0.1.6-separated-draft";
    const steps: string[] = [];
    const ordered = new ModelMigrationRegistry([
      {
        migrationId: "test:first",
        sourceVersion: OLD_FORMAT,
        targetVersion: intermediate,
        migrate: (source) => {
          expect(Object.isFrozen(source)).toBe(true);
          steps.push("first");
          return { ...source, model_format_version: intermediate };
        },
      },
      {
        migrationId: "test:second",
        sourceVersion: intermediate,
        targetVersion: CURRENT_MODEL_FORMAT_VERSION,
        migrate: (source) => {
          steps.push("second");
          return { ...source, model_format_version: CURRENT_MODEL_FORMAT_VERSION };
        },
      },
    ]);
    migratePersonalModelVersion(asJson(oldDocument()), CURRENT_MODEL_FORMAT_VERSION, ordered);
    expect(steps).toEqual(["first", "second"]);

    const nonJson = new ModelMigrationRegistry([{
      ...migration,
      migrate: (source) => ({
        ...source,
        model_format_version: CURRENT_MODEL_FORMAT_VERSION,
        objects: { Synthetic: [{ amount: Number.NaN }] },
      }) as never,
    }]);
    expect(capturedIssue(() => migratePersonalModelVersion(asJson(oldDocument()), CURRENT_MODEL_FORMAT_VERSION, nonJson)).code)
      .toBe(issueCodes.modelVersionMismatch);
  });

  it("rejects migrations that change financial semantics or model identity", () => {
    const semanticRewrite = new ModelMigrationRegistry([{
      ...migration,
      migrate: (source) => ({
        ...source,
        model_format_version: CURRENT_MODEL_FORMAT_VERSION,
        financial_specification_version: FUTURE_FINANCIAL_SPEC,
      }),
    }]);
    expect(capturedIssue(() => migratePersonalModelVersion(asJson(oldDocument()), CURRENT_MODEL_FORMAT_VERSION, semanticRewrite)))
      .toEqual(expect.objectContaining({ code: issueCodes.unsupportedFinancialSpecification, fieldPath: "financial_specification_version" }));

    const identityRewrite = new ModelMigrationRegistry([{
      ...migration,
      migrate: (source) => ({
        ...source,
        model_format_version: CURRENT_MODEL_FORMAT_VERSION,
        model_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    }]);
    expect(capturedIssue(() => migratePersonalModelVersion(asJson(oldDocument()), CURRENT_MODEL_FORMAT_VERSION, identityRewrite)))
      .toEqual(expect.objectContaining({ code: issueCodes.modelVersionMismatch, fieldPath: "model_id" }));
  });

  it("preserves an unsupported financial specification during format-only migration", () => {
    const migrated = migratePersonalModelVersion(asJson(oldDocument(FUTURE_FINANCIAL_SPEC)), CURRENT_MODEL_FORMAT_VERSION, migrationRegistry);
    expect(JSON.parse(migrated).financial_specification_version).toBe(FUTURE_FINANCIAL_SPEC);
    expect(capturedIssue(() => importPersonalModelJson(migrated))).toEqual(expect.objectContaining({
      code: issueCodes.unsupportedFinancialSpecification,
      fieldPath: "financial_specification_version",
    }));
  });

  it("allows a deterministic current-to-current format no-op without executing financial semantics", () => {
    const currentUnsupported = asJson(currentDocument({
      financial_specification_version: FUTURE_FINANCIAL_SPEC,
    }));
    const migrated = migratePersonalModelVersion(currentUnsupported);
    expect(JSON.parse(migrated).financial_specification_version).toBe(FUTURE_FINANCIAL_SPEC);
    expect(capturedIssue(() => importPersonalModelJson(migrated)).code)
      .toBe(issueCodes.unsupportedFinancialSpecification);
  });
});

describe("legacy and unsupported documents", () => {
  it("keeps specification_version legacy ambiguous and non-migratable", () => {
    const legacy = asJson({
      specification_version: "ambiguous-version",
      model_id: MODEL_ID,
      objects: { Synthetic: [] },
    });
    const report = validatePersonalModelJson(legacy);
    expect(report.detectedModelFormatVersion).toBe(LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION);
    expect(report.modelFormatCompatibility).toBe("read_only_legacy");
    expect(report.detectedFinancialSpecificationVersion).toBeUndefined();
    expect(report.financialSpecificationCompatibility).toBeUndefined();
    expect(() => importPersonalModelJson(legacy)).toThrow(ValidationError);
    expect(() => migratePersonalModelVersion(legacy)).toThrow(ValidationError);
  });

  it("classifies a future format as unsupported and never imports or migrates it", () => {
    const future = asJson(currentDocument({ model_format_version: "99.0.0-future" }));
    expect(validatePersonalModelJson(future).modelFormatCompatibility).toBe("unsupported");
    expect(capturedIssue(() => importPersonalModelJson(future)).code).toBe(issueCodes.unsupportedModelFormat);
    expect(capturedIssue(() => migratePersonalModelVersion(future)).code).toBe(issueCodes.unsupportedModelFormat);
  });
});
