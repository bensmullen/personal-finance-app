import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes } from "../src/diagnostics.js";
import { domainId } from "../src/identity.js";
import {
  CURRENT_MODEL_FORMAT_VERSION,
  LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION,
  ModelMigrationRegistry,
  classifyModelFormatVersion,
  deserializePortableModelEnvelope,
  detectSerializedModelFormatVersion,
  migratePortableModel,
  serializePortableModelEnvelope,
  type ModelMigration,
  type PortableModelDocument,
  type PortableModelEnvelope,
} from "../src/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../src/version.js";

const MIGRATABLE_VERSION = "0.1.5-separated-draft";

const explicitMigration: ModelMigration = {
  migrationId: "test:0.1.5-separated-to-0.2.0",
  sourceVersion: MIGRATABLE_VERSION,
  targetVersion: CURRENT_MODEL_FORMAT_VERSION,
  migrate: (source) => Object.freeze({ ...source, model_format_version: CURRENT_MODEL_FORMAT_VERSION }),
};

const registry = new ModelMigrationRegistry([explicitMigration]);

const validationCode = (operation: () => unknown): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error("Expected ValidationError");
};

describe("portable model format compatibility", () => {
  it("classifies current, explicitly migratable, ambiguous legacy, and unknown formats", () => {
    expect(classifyModelFormatVersion(CURRENT_MODEL_FORMAT_VERSION).classification).toBe("supported_directly");
    expect(classifyModelFormatVersion(MIGRATABLE_VERSION, registry).classification).toBe("migratable");
    expect(classifyModelFormatVersion(LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION).classification).toBe("read_only_legacy");
    const unknown = classifyModelFormatVersion("99.0.0-future");
    expect(unknown.classification).toBe("unsupported");
    expect(unknown.issues[0]?.code).toBe(issueCodes.unsupportedModelFormat);
  });

  it("detects the old specification_version root as ambiguous legacy rather than current", () => {
    expect(detectSerializedModelFormatVersion({ specification_version: "unknown-semantics", model_id: "fixture", objects: {} }))
      .toBe(LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION);
  });

  it("runs an explicit deterministic migration without skipping missing gaps", () => {
    const source: PortableModelDocument = Object.freeze({
      model_format_version: MIGRATABLE_VERSION,
      financial_specification_version: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      model_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      objects: { Person: [] },
    });
    const first = migratePortableModel(source, MIGRATABLE_VERSION, CURRENT_MODEL_FORMAT_VERSION, registry);
    const second = migratePortableModel(source, MIGRATABLE_VERSION, CURRENT_MODEL_FORMAT_VERSION, registry);
    expect(first).toEqual(second);
    expect(first.model_format_version).toBe(CURRENT_MODEL_FORMAT_VERSION);
    expect(validationCode(() => migratePortableModel({ ...source, model_format_version: "0.1.4-missing" }, "0.1.4-missing", CURRENT_MODEL_FORMAT_VERSION, registry)))
      .toBe(issueCodes.modelMigrationUnavailable);
  });

  it("rejects migration source/target output mismatches", () => {
    const broken = new ModelMigrationRegistry([{
      migrationId: "broken",
      sourceVersion: "broken-source",
      targetVersion: CURRENT_MODEL_FORMAT_VERSION,
      migrate: (source) => source,
    }]);
    expect(validationCode(() => migratePortableModel(
      { model_format_version: "broken-source" },
      "broken-source",
      CURRENT_MODEL_FORMAT_VERSION,
      broken,
    ))).toBe(issueCodes.modelVersionMismatch);
    expect(validationCode(() => migratePortableModel(
      { model_format_version: "different-source" },
      "broken-source",
      CURRENT_MODEL_FORMAT_VERSION,
      broken,
    ))).toBe(issueCodes.modelVersionMismatch);
  });

  it("round-trips the current envelope without losing distinct version metadata", () => {
    const envelope: PortableModelEnvelope = Object.freeze({
      modelFormatVersion: CURRENT_MODEL_FORMAT_VERSION,
      financialSpecificationVersion: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      modelId: domainId("model", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      objects: { Person: [], Household: [] },
    });
    const serialized = serializePortableModelEnvelope(envelope);
    expect(serialized).toEqual(expect.objectContaining({
      model_format_version: CURRENT_MODEL_FORMAT_VERSION,
      financial_specification_version: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
      model_id: envelope.modelId,
    }));
    expect(deserializePortableModelEnvelope(JSON.parse(JSON.stringify(serialized)))).toEqual(envelope);
    expect(serialized.model_format_version).not.toBe(serialized.financial_specification_version);
  });
});
