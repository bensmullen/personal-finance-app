import { failValidation, issueCodes, validationIssue, type ValidationIssue } from "./diagnostics.js";
import { domainId, type DomainId } from "./identity.js";
import { CURRENT_RUN_VERSIONS } from "./version.js";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type PortableModelObjects = Readonly<Record<string, readonly JsonValue[]>>;
export type ModelId = DomainId<"model">;

export interface PortableModelEnvelope<TObjects extends PortableModelObjects = PortableModelObjects> {
  readonly modelFormatVersion: string;
  readonly financialSpecificationVersion: string;
  readonly modelId: ModelId;
  readonly objects: TObjects;
}

export interface SerializedPortableModelEnvelope {
  readonly model_format_version: string;
  readonly financial_specification_version: string;
  readonly model_id: string;
  readonly objects: PortableModelObjects;
}

export const CURRENT_MODEL_FORMAT_VERSION = CURRENT_RUN_VERSIONS.modelFormatVersion;
export const LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION = "0.1.0-draft";

export type ModelCompatibilityClassification =
  | "supported_directly"
  | "migratable"
  | "read_only_legacy"
  | "unsupported";

export interface ModelCompatibilityResult {
  readonly classification: ModelCompatibilityClassification;
  readonly sourceVersion: string;
  readonly targetVersion: string;
  readonly issues: readonly ValidationIssue[];
}

export type PortableModelDocument = Readonly<Record<string, JsonValue>>;

export interface ModelMigration {
  readonly migrationId: string;
  readonly sourceVersion: string;
  readonly targetVersion: string;
  readonly migrate: (source: PortableModelDocument) => PortableModelDocument;
}

const migrationFailure = (code: string, message: string, relatedIds: readonly string[] = []): never =>
  failValidation({
    severity: "error",
    code,
    message,
    entityType: "portable_model",
    fieldPath: "model_format_version",
    ...(relatedIds.length === 0 ? {} : { relatedIds }),
  });

export class ModelMigrationRegistry {
  readonly #bySource = new Map<string, ModelMigration>();

  constructor(migrations: readonly ModelMigration[] = []) {
    for (const migration of migrations) {
      if (migration.migrationId.trim().length === 0 || migration.sourceVersion === migration.targetVersion) {
        migrationFailure(issueCodes.modelVersionMismatch, "Model migration must have an identity and distinct source/target versions");
      }
      if (this.#bySource.has(migration.sourceVersion)) {
        migrationFailure(issueCodes.modelVersionMismatch, `Multiple migrations start at ${migration.sourceVersion}`);
      }
      this.#bySource.set(migration.sourceVersion, Object.freeze({ ...migration }));
    }
  }

  chain(sourceVersion: string, targetVersion: string): readonly ModelMigration[] | undefined {
    const chain: ModelMigration[] = [];
    const visited = new Set<string>();
    let current = sourceVersion;
    while (current !== targetVersion) {
      if (visited.has(current)) return undefined;
      visited.add(current);
      const migration = this.#bySource.get(current);
      if (migration === undefined) return undefined;
      chain.push(migration);
      current = migration.targetVersion;
    }
    return Object.freeze(chain);
  }
}

export const DEFAULT_MODEL_MIGRATIONS = new ModelMigrationRegistry();

export const classifyModelFormatVersion = (
  sourceVersion: string,
  migrations: ModelMigrationRegistry = DEFAULT_MODEL_MIGRATIONS,
): ModelCompatibilityResult => {
  const targetVersion = CURRENT_MODEL_FORMAT_VERSION;
  if (sourceVersion === targetVersion) {
    return Object.freeze({ classification: "supported_directly", sourceVersion, targetVersion, issues: Object.freeze([]) });
  }
  if (sourceVersion === LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION) {
    return Object.freeze({
      classification: "read_only_legacy",
      sourceVersion,
      targetVersion,
      issues: Object.freeze([validationIssue({
        severity: "warning",
        code: issueCodes.modelMigrationUnavailable,
        message: "Legacy specification_version did not unambiguously distinguish model format from financial specification version",
        entityType: "portable_model",
        fieldPath: "specification_version",
      })]),
    });
  }
  if (migrations.chain(sourceVersion, targetVersion) !== undefined) {
    return Object.freeze({ classification: "migratable", sourceVersion, targetVersion, issues: Object.freeze([]) });
  }
  return Object.freeze({
    classification: "unsupported",
    sourceVersion,
    targetVersion,
    issues: Object.freeze([validationIssue({
      severity: "error",
      code: issueCodes.unsupportedModelFormat,
      message: `Unsupported model format ${sourceVersion}; current format is ${targetVersion}`,
      entityType: "portable_model",
      fieldPath: "model_format_version",
      relatedIds: [sourceVersion, targetVersion],
    })]),
  });
};

export const migratePortableModel = (
  source: PortableModelDocument,
  sourceVersion: string,
  targetVersion: string,
  migrations: ModelMigrationRegistry,
): PortableModelDocument => {
  if (source.model_format_version !== sourceVersion) {
    migrationFailure(issueCodes.modelVersionMismatch, `Migration source document identifies ${String(source.model_format_version)} but ${sourceVersion} was requested`);
  }
  const chain = migrations.chain(sourceVersion, targetVersion);
  if (chain === undefined) {
    return migrationFailure(issueCodes.modelMigrationUnavailable, `No complete migration chain from ${sourceVersion} to ${targetVersion}`, [sourceVersion, targetVersion]);
  }
  let current = source;
  let currentVersion = sourceVersion;
  for (const migration of chain) {
    if (migration.sourceVersion !== currentVersion) {
      migrationFailure(issueCodes.modelVersionMismatch, `Migration ${migration.migrationId} expected ${migration.sourceVersion} but received ${currentVersion}`);
    }
    const migrated = migration.migrate(current);
    if (migrated.model_format_version !== migration.targetVersion) {
      migrationFailure(issueCodes.modelVersionMismatch, `Migration ${migration.migrationId} did not produce ${migration.targetVersion}`);
    }
    current = migrated;
    currentVersion = migration.targetVersion;
  }
  return current;
};

export const serializePortableModelEnvelope = <TObjects extends PortableModelObjects>(
  envelope: PortableModelEnvelope<TObjects>,
): SerializedPortableModelEnvelope => Object.freeze({
  model_format_version: envelope.modelFormatVersion,
  financial_specification_version: envelope.financialSpecificationVersion,
  model_id: envelope.modelId,
  objects: envelope.objects,
});

export const deserializePortableModelEnvelope = (
  serialized: SerializedPortableModelEnvelope,
): PortableModelEnvelope => {
  const compatibility = classifyModelFormatVersion(serialized.model_format_version);
  if (compatibility.classification !== "supported_directly") {
    migrationFailure(
      compatibility.issues[0]?.code ?? issueCodes.unsupportedModelFormat,
      compatibility.issues[0]?.message ?? `Model format ${serialized.model_format_version} is not directly supported`,
    );
  }
  if (serialized.financial_specification_version.trim().length === 0) {
    migrationFailure(issueCodes.modelVersionMismatch, "Portable model financial specification version cannot be empty");
  }
  return Object.freeze({
    modelFormatVersion: serialized.model_format_version,
    financialSpecificationVersion: serialized.financial_specification_version,
    modelId: domainId("model", serialized.model_id),
    objects: serialized.objects,
  });
};

export const detectSerializedModelFormatVersion = (document: PortableModelDocument): string => {
  if (typeof document.model_format_version === "string") return document.model_format_version;
  if (typeof document.specification_version === "string") return LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION;
  return migrationFailure(issueCodes.unsupportedModelFormat, "Portable model does not identify a model format version");
};
