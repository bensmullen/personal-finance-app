import {
  ValidationError,
  failValidation,
  issueCodes,
  validationIssue,
  type ValidationIssue,
} from "../diagnostics/index.js";
import { domainId } from "../identity/index.js";
import {
  CURRENT_MODEL_FORMAT_VERSION,
  DEFAULT_MODEL_MIGRATIONS,
  LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION,
  ModelMigrationRegistry,
  classifyFinancialSpecificationVersion,
  classifyModelFormatVersion,
  deserializePortableModelEnvelope,
  detectSerializedModelFormatVersion,
  migratePortableModel,
  type JsonValue,
  type ModelCompatibilityClassification,
  type PortableModelDocument,
  type PortableModelEnvelope,
  type PortableModelObjects,
  type SerializedPortableModelEnvelope,
} from "../model/modelVersion.js";

const ROOT_FIELDS = Object.freeze([
  "model_format_version",
  "financial_specification_version",
  "model_id",
  "objects",
] as const);

export interface PersonalModelValidationReport {
  readonly jsonParsed: boolean;
  readonly detectedModelFormatVersion?: string;
  readonly modelFormatCompatibility?: ModelCompatibilityClassification;
  readonly detectedFinancialSpecificationVersion?: string;
  readonly financialSpecificationCompatibility?: ModelCompatibilityClassification;
  readonly directlyImportable: boolean;
  readonly explicitMigrationAvailable: boolean;
  readonly issues: readonly ValidationIssue[];
}

const documentIssue = (fieldPath: string | undefined, message = "Portable model document is invalid"): ValidationIssue =>
  validationIssue({
    severity: "error",
    code: issueCodes.modelDocumentInvalid,
    message,
    entityType: "portable_model",
    ...(fieldPath === undefined ? {} : { fieldPath }),
  });

const migrationRequiredIssue = (): ValidationIssue => validationIssue({
  severity: "error",
  code: issueCodes.modelMigrationRequired,
  message: "Portable model requires explicit version migration before import",
  entityType: "portable_model",
  fieldPath: "model_format_version",
});

const migrationInspectionIssue = (): ValidationIssue => validationIssue({
  ...migrationRequiredIssue(),
  severity: "warning",
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonValueIssue = (value: unknown, fieldPath: string, ancestors: Set<object>): ValidationIssue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? undefined : documentIssue(fieldPath);
  if (typeof value !== "object") return documentIssue(fieldPath);

  const object = value as object;
  if (ancestors.has(object)) return documentIssue(fieldPath);
  const prototype = Object.getPrototypeOf(object);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return documentIssue(fieldPath);
  if (Object.getOwnPropertySymbols(object).length > 0) return documentIssue(fieldPath);

  const nextAncestors = new Set(ancestors).add(object);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return documentIssue(`${fieldPath}.${index}`);
      const issue = jsonValueIssue(value[index], `${fieldPath}.${index}`, nextAncestors);
      if (issue !== undefined) return issue;
    }
    return undefined;
  }

  for (const key of Object.keys(value)) {
    const issue = jsonValueIssue((value as Record<string, unknown>)[key], `${fieldPath}.${key}`, nextAncestors);
    if (issue !== undefined) return issue;
  }
  return undefined;
};

const validateCurrentEnvelope = (value: unknown): readonly ValidationIssue[] => {
  if (!isRecord(value)) return Object.freeze([documentIssue(undefined)]);
  const issues: ValidationIssue[] = [];
  const keys = Object.keys(value);
  for (const field of ROOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) issues.push(documentIssue(field, `Portable model is missing ${field}`));
  }
  for (const key of keys) {
    if (!(ROOT_FIELDS as readonly string[]).includes(key)) issues.push(documentIssue(key, "Portable model contains an unsupported envelope field"));
  }
  if (typeof value.model_format_version !== "string") issues.push(documentIssue("model_format_version"));
  if (typeof value.financial_specification_version !== "string") issues.push(documentIssue("financial_specification_version"));
  if (typeof value.model_id !== "string") {
    issues.push(documentIssue("model_id", "Portable model model_id must be a UUID string"));
  } else {
    try {
      domainId("model", value.model_id);
    } catch {
      issues.push(documentIssue("model_id", "Portable model model_id must be a valid UUID"));
    }
  }
  if (!isRecord(value.objects)) {
    issues.push(documentIssue("objects", "Portable model objects must be a non-null JSON object"));
  } else {
    if (Object.getOwnPropertySymbols(value.objects).length > 0) issues.push(documentIssue("objects"));
    for (const [collection, entries] of Object.entries(value.objects)) {
      const fieldPath = `objects.${collection}`;
      if (!Array.isArray(entries)) {
        issues.push(documentIssue(fieldPath, "Portable model object collections must be arrays"));
        continue;
      }
      const issue = jsonValueIssue(entries, fieldPath, new Set([value.objects]));
      if (issue !== undefined) issues.push(issue);
    }
  }
  return Object.freeze(issues);
};

const deepCloneFrozenJson = (value: JsonValue): JsonValue => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => deepCloneFrozenJson(entry)));
  const copy: Record<string, JsonValue> = {};
  const record = value as { readonly [key: string]: JsonValue };
  for (const key of Object.keys(record)) copy[key] = deepCloneFrozenJson(record[key]!);
  return Object.freeze(copy);
};

const stableJsonValue = (value: JsonValue): JsonValue => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableJsonValue);
  const sorted: Record<string, JsonValue> = {};
  const record = value as { readonly [key: string]: JsonValue };
  for (const key of Object.keys(record).sort()) sorted[key] = stableJsonValue(record[key]!);
  return sorted;
};

const serializeDeterministically = (document: SerializedPortableModelEnvelope): string => {
  const ordered = {
    model_format_version: document.model_format_version,
    financial_specification_version: document.financial_specification_version,
    model_id: document.model_id,
    objects: stableJsonValue(document.objects) as PortableModelObjects,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

const freezeReport = (report: PersonalModelValidationReport): PersonalModelValidationReport => Object.freeze({
  ...report,
  issues: Object.freeze([...report.issues]),
});

export const validatePersonalModelJson = (
  json: string,
  migrations: ModelMigrationRegistry = DEFAULT_MODEL_MIGRATIONS,
): PersonalModelValidationReport => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return freezeReport({
      jsonParsed: false,
      directlyImportable: false,
      explicitMigrationAvailable: false,
      issues: [documentIssue(undefined, "Portable model JSON is malformed")],
    });
  }
  if (!isRecord(parsed)) {
    return freezeReport({
      jsonParsed: true,
      directlyImportable: false,
      explicitMigrationAvailable: false,
      issues: [documentIssue(undefined)],
    });
  }

  let detectedModelFormatVersion: string;
  try {
    detectedModelFormatVersion = detectSerializedModelFormatVersion(parsed as PortableModelDocument);
  } catch {
    const fieldPath = Object.prototype.hasOwnProperty.call(parsed, "model_format_version")
      ? "model_format_version"
      : "model_format_version";
    return freezeReport({
      jsonParsed: true,
      directlyImportable: false,
      explicitMigrationAvailable: false,
      issues: [documentIssue(fieldPath, "Portable model must identify its model format")],
    });
  }
  const modelCompatibility = classifyModelFormatVersion(detectedModelFormatVersion, migrations);
  const isLegacy = detectedModelFormatVersion === LEGACY_AMBIGUOUS_MODEL_FORMAT_VERSION;
  const detectedFinancialSpecificationVersion = !isLegacy && typeof parsed.financial_specification_version === "string"
    ? parsed.financial_specification_version
    : undefined;
  const financialCompatibility = detectedFinancialSpecificationVersion === undefined
    ? undefined
    : classifyFinancialSpecificationVersion(detectedFinancialSpecificationVersion);

  const issues: ValidationIssue[] = [...modelCompatibility.issues];
  if (modelCompatibility.classification === "supported_directly") {
    issues.push(...validateCurrentEnvelope(parsed));
    if (financialCompatibility !== undefined) issues.push(...financialCompatibility.issues);
  } else if (modelCompatibility.classification === "migratable") {
    issues.push(migrationInspectionIssue());
    const genericIssue = jsonValueIssue(parsed, "", new Set());
    if (genericIssue !== undefined) issues.push(genericIssue);
    if (typeof parsed.financial_specification_version !== "string") issues.push(documentIssue("financial_specification_version"));
    if (typeof parsed.model_id !== "string") issues.push(documentIssue("model_id"));
    else {
      try { domainId("model", parsed.model_id); } catch { issues.push(documentIssue("model_id", "Portable model model_id must be a valid UUID")); }
    }
  }
  const structuralErrors = issues.some((issue) => issue.severity === "error" && issue.code === issueCodes.modelDocumentInvalid);
  const directlyImportable = modelCompatibility.classification === "supported_directly"
    && financialCompatibility?.classification === "supported_directly"
    && !structuralErrors;
  return freezeReport({
    jsonParsed: true,
    detectedModelFormatVersion,
    modelFormatCompatibility: modelCompatibility.classification,
    ...(detectedFinancialSpecificationVersion === undefined ? {} : { detectedFinancialSpecificationVersion }),
    ...(financialCompatibility === undefined ? {} : { financialSpecificationCompatibility: financialCompatibility.classification }),
    directlyImportable,
    explicitMigrationAvailable: modelCompatibility.classification === "migratable" && !structuralErrors,
    issues,
  });
};

export const importPersonalModelJson = (
  json: string,
  migrations: ModelMigrationRegistry = DEFAULT_MODEL_MIGRATIONS,
): PortableModelEnvelope => {
  const report = validatePersonalModelJson(json, migrations);
  if (!report.jsonParsed) failValidation(report.issues);
  if (report.modelFormatCompatibility === "migratable") failValidation(migrationRequiredIssue());
  if (!report.directlyImportable) failValidation(report.issues.length > 0 ? report.issues : documentIssue(undefined));
  const parsed = JSON.parse(json) as SerializedPortableModelEnvelope;
  const imported = deserializePortableModelEnvelope(parsed);
  return Object.freeze({
    ...imported,
    objects: deepCloneFrozenJson(imported.objects) as PortableModelObjects,
  });
};

export const exportPersonalModelJson = (model: PortableModelEnvelope): string => {
  const rawModel = model as unknown;
  if (!isRecord(rawModel)) failValidation(documentIssue(undefined));
  const candidate: unknown = {
    model_format_version: rawModel.modelFormatVersion,
    financial_specification_version: rawModel.financialSpecificationVersion,
    model_id: rawModel.modelId,
    objects: rawModel.objects,
  };
  const structuralIssues = validateCurrentEnvelope(candidate);
  if (structuralIssues.length > 0) failValidation(structuralIssues);
  const serialized = candidate as SerializedPortableModelEnvelope;
  const formatCompatibility = classifyModelFormatVersion(serialized.model_format_version);
  if (formatCompatibility.classification !== "supported_directly") failValidation(formatCompatibility.issues);
  const financialCompatibility = classifyFinancialSpecificationVersion(serialized.financial_specification_version);
  if (financialCompatibility.classification !== "supported_directly") failValidation(financialCompatibility.issues);
  const canonicalModelId = domainId("model", serialized.model_id);
  return serializeDeterministically({ ...serialized, model_id: canonicalModelId });
};

export const migratePersonalModelVersion = (
  json: string,
  targetVersion = CURRENT_MODEL_FORMAT_VERSION,
  migrations: ModelMigrationRegistry = DEFAULT_MODEL_MIGRATIONS,
): string => {
  const report = validatePersonalModelJson(json, migrations);
  if (!report.jsonParsed || report.detectedModelFormatVersion === undefined) failValidation(report.issues);
  if (targetVersion !== CURRENT_MODEL_FORMAT_VERSION) {
    failValidation({
      severity: "error",
      code: issueCodes.modelMigrationUnavailable,
      message: "Application model migration target must be the current portable model format",
      entityType: "portable_model",
      fieldPath: "model_format_version",
      relatedIds: [report.detectedModelFormatVersion, CURRENT_MODEL_FORMAT_VERSION, targetVersion],
    });
  }
  if (report.modelFormatCompatibility === "read_only_legacy") failValidation(report.issues);
  if (report.modelFormatCompatibility === "unsupported" && !migrations.hasMigrationFrom(report.detectedModelFormatVersion)) {
    failValidation(report.issues);
  }
  const structuralErrors = report.issues.filter((issue) => issue.code === issueCodes.modelDocumentInvalid);
  if (structuralErrors.length > 0) failValidation(structuralErrors);

  const parsed = JSON.parse(json) as PortableModelDocument;
  const isolatedIssue = jsonValueIssue(parsed, "", new Set());
  if (isolatedIssue !== undefined) failValidation(isolatedIssue);
  const isolated = deepCloneFrozenJson(parsed) as PortableModelDocument;
  let migrated: PortableModelDocument;
  try {
    migrated = migratePortableModel(isolated, report.detectedModelFormatVersion, targetVersion, migrations);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    failValidation({
      severity: "error",
      code: issueCodes.modelVersionMismatch,
      message: "Portable model migration failed",
      entityType: "portable_model",
      fieldPath: "model_format_version",
    });
  }
  const outputIssue = jsonValueIssue(migrated, "", new Set());
  if (outputIssue !== undefined) failValidation(outputIssue);
  const outputIssues = validateCurrentEnvelope(migrated);
  if (outputIssues.length > 0) failValidation(outputIssues);
  const output = migrated as unknown as SerializedPortableModelEnvelope;
  return serializeDeterministically({ ...output, model_id: domainId("model", output.model_id) });
};
