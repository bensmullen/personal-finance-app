import {
  CURRENT_MODEL_FORMAT_VERSION,
  DEFAULT_MODEL_MIGRATIONS,
  type ModelMigrationRegistry,
} from "../model/modelVersion.js";
import {
  exportPersonalModelJson,
  importPersonalModelJson,
  migratePersonalModelVersion,
  validatePersonalModelJson,
  type PersonalModelValidationReport,
} from "./modelPortability.js";
import type { PersonalDraft } from "./personalMvp.js";

export interface PersonalModelPersistencePort {
  read(): Promise<string | undefined>;
  replace(serializedModel: string): Promise<void>;
  remove(): Promise<void>;
}

export type PersistedPersonalModelState =
  | Readonly<{ status: "empty" }>
  | Readonly<{
      status: "ready";
      model: PersonalDraft;
      serializedModel: string;
      report: PersonalModelValidationReport;
    }>
  | Readonly<{
      status: "migration_required" | "read_only_legacy" | "unsupported" | "invalid";
      serializedModel: string;
      report: PersonalModelValidationReport;
    }>;

export type SavePersonalModelResult =
  | Readonly<{ status: "saved"; serializedModel: string }>
  | Readonly<{ status: "different_model_confirmation_required" }>
  | Readonly<{
      status: "recovery_required";
      savedState: Exclude<PersistedPersonalModelState, { status: "empty" } | { status: "ready" }>;
    }>;

const classifyReport = (
  serializedModel: string,
  report: PersonalModelValidationReport,
): Exclude<PersistedPersonalModelState, { status: "empty" | "ready" }> => {
  if (report.modelFormatCompatibility === "migratable" && report.explicitMigrationAvailable)
    return Object.freeze({ status: "migration_required", serializedModel, report });
  if (report.modelFormatCompatibility === "read_only_legacy")
    return Object.freeze({ status: "read_only_legacy", serializedModel, report });
  if (
    report.modelFormatCompatibility === "unsupported" ||
    report.financialSpecificationCompatibility === "unsupported"
  )
    return Object.freeze({ status: "unsupported", serializedModel, report });
  return Object.freeze({ status: "invalid", serializedModel, report });
};

export const inspectPersistedPersonalModel = async (
  port: PersonalModelPersistencePort,
  migrations: ModelMigrationRegistry = DEFAULT_MODEL_MIGRATIONS,
): Promise<PersistedPersonalModelState> => {
  const serializedModel = await port.read();
  if (serializedModel === undefined) return Object.freeze({ status: "empty" });
  const report = validatePersonalModelJson(serializedModel, migrations);
  if (!report.directlyImportable) return classifyReport(serializedModel, report);
  try {
    return Object.freeze({
      status: "ready",
      model: importPersonalModelJson(serializedModel, migrations),
      serializedModel,
      report,
    });
  } catch {
    return Object.freeze({ status: "invalid", serializedModel, report });
  }
};

export const savePersonalModel = async (
  port: PersonalModelPersistencePort,
  draft: PersonalDraft,
  options: Readonly<{
    confirmDifferentModel?: boolean;
    migrations?: ModelMigrationRegistry;
  }> = {},
): Promise<SavePersonalModelResult> => {
  const savedState = await inspectPersistedPersonalModel(
    port,
    options.migrations ?? DEFAULT_MODEL_MIGRATIONS,
  );
  if (savedState.status !== "empty" && savedState.status !== "ready")
    return Object.freeze({ status: "recovery_required", savedState });
  if (
    savedState.status === "ready" &&
    savedState.model.modelId !== draft.modelId &&
    options.confirmDifferentModel !== true
  )
    return Object.freeze({ status: "different_model_confirmation_required" });
  const serializedModel = exportPersonalModelJson(draft);
  await port.replace(serializedModel);
  return Object.freeze({ status: "saved", serializedModel });
};

export const migratePersistedPersonalModel = async (
  port: PersonalModelPersistencePort,
  migrations: ModelMigrationRegistry = DEFAULT_MODEL_MIGRATIONS,
): Promise<Extract<PersistedPersonalModelState, { status: "ready" }>> => {
  const savedState = await inspectPersistedPersonalModel(port, migrations);
  if (savedState.status !== "migration_required")
    throw new Error("Saved model is not eligible for explicit migration");
  const migrated = migratePersonalModelVersion(
    savedState.serializedModel,
    CURRENT_MODEL_FORMAT_VERSION,
    migrations,
  );
  const report = validatePersonalModelJson(migrated, migrations);
  if (!report.directlyImportable)
    throw new Error("Migrated saved model did not pass compatibility validation");
  const model = importPersonalModelJson(migrated, migrations);
  await port.replace(migrated);
  return Object.freeze({ status: "ready", model, serializedModel: migrated, report });
};

export const deletePersistedPersonalModel = async (
  port: PersonalModelPersistencePort,
): Promise<void> => port.remove();

export const readPersistedPersonalModelBackup = async (
  port: PersonalModelPersistencePort,
): Promise<string | undefined> => port.read();
