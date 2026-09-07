export interface RunVersionMetadata {
  readonly engineVersion: string;
  readonly resultSchemaVersion: string;
  readonly financialSpecificationVersion: string;
  readonly modelFormatVersion: string;
}

/** Kept in one runtime authority and checked against docs/spec-manifest.json by spec:validate. */
export const CURRENT_RUN_VERSIONS: RunVersionMetadata = Object.freeze({
  engineVersion: "0.1.0",
  resultSchemaVersion: "0.1.0",
  financialSpecificationVersion: "0.1.9-draft",
  modelFormatVersion: "0.2.0-draft",
});
