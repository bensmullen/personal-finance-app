import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const manifestRelativePath = "docs/spec-manifest.json";
const expectedPrimitiveIds = Array.from({ length: 34 }, (_, index) =>
  `P${String(index + 1).padStart(2, "0")}`,
);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const primitiveIds = (content) =>
  [...new Set(content.match(/\bP\d{2}\b/g) ?? [])].sort();

const sameStrings = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const markdownVersion = (content) =>
  content.match(/^\*\*Version:\*\*\s*([^\s]+)\s*$/m)?.[1];

const unwrapExpression = (expression) => {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  if (ts.isCallExpression(current) && current.arguments.length === 1) return unwrapExpression(current.arguments[0]);
  return current;
};

const objectProperty = (object, name) => object.properties.find((property) =>
  ts.isPropertyAssignment(property)
  && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  && property.name.text === name);

const parsedCatalogEntries = (content) => {
  const source = ts.createSourceFile("src/primitives/catalog.ts", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let initializer;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "primitiveCatalogEntries") {
        initializer = declaration.initializer;
      }
    }
  }
  if (!initializer) return { entries: [], errors: ["runtime primitive catalog must export primitiveCatalogEntries"] };
  const array = unwrapExpression(initializer);
  if (!ts.isArrayLiteralExpression(array)) {
    return { entries: [], errors: ["runtime primitiveCatalogEntries must be an array literal"] };
  }
  const entries = [];
  const errors = [];
  for (const [index, element] of array.elements.entries()) {
    const object = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(object)) {
      errors.push(`runtime primitive catalog entry ${index + 1} must be an object literal`);
      continue;
    }
    const stringField = (name) => {
      const property = objectProperty(object, name);
      const value = property && unwrapExpression(property.initializer);
      if (!value || !ts.isStringLiteral(value)) {
        errors.push(`runtime primitive catalog entry ${index + 1}.${name} must be a string literal`);
        return undefined;
      }
      return value.text;
    };
    const booleanField = (name) => {
      const property = objectProperty(object, name);
      const value = property && unwrapExpression(property.initializer);
      if (value?.kind !== ts.SyntaxKind.TrueKeyword && value?.kind !== ts.SyntaxKind.FalseKeyword) {
        errors.push(`runtime primitive catalog entry ${index + 1}.${name} must be a boolean literal`);
        return undefined;
      }
      return value.kind === ts.SyntaxKind.TrueKeyword;
    };
    entries.push({
      id: stringField("id"),
      name: stringField("name"),
      class: stringField("class"),
      stateful: booleanField("stateful"),
      randomness: stringField("randomness"),
      implementationStatus: stringField("implementationStatus"),
    });
  }
  return { entries, errors };
};

export async function validateRepository(root = defaultRoot) {
  const errors = [];
  const contents = new Map();
  const parsedJson = new Map();

  const addError = (message) => errors.push(message);

  const resolvePath = (relativePath, label) => {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      addError(`${label} must be a non-empty repository-relative path`);
      return undefined;
    }

    const absolutePath = path.resolve(root, relativePath);
    const fromRoot = path.relative(root, absolutePath);
    if (path.isAbsolute(relativePath) || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`)) {
      addError(`${label} escapes the repository: ${relativePath}`);
      return undefined;
    }
    return absolutePath;
  };

  const readArtifact = async (relativePath, label) => {
    if (contents.has(relativePath)) return contents.get(relativePath);
    const absolutePath = resolvePath(relativePath, label);
    if (!absolutePath) return undefined;
    try {
      const content = await readFile(absolutePath, "utf8");
      contents.set(relativePath, content);
      return content;
    } catch (error) {
      addError(`${label} is missing or unreadable (${relativePath}): ${error.message}`);
      return undefined;
    }
  };

  const parseJson = async (relativePath, label) => {
    if (parsedJson.has(relativePath)) return parsedJson.get(relativePath);
    const content = await readArtifact(relativePath, label);
    if (content === undefined) return undefined;
    try {
      const value = JSON.parse(content);
      parsedJson.set(relativePath, value);
      return value;
    } catch (error) {
      addError(`${label} is not valid JSON (${relativePath}): ${error.message}`);
      return undefined;
    }
  };

  const manifest = await parseJson(manifestRelativePath, "specification manifest");
  if (!isRecord(manifest)) {
    if (manifest !== undefined) addError("specification manifest must contain a JSON object");
    return errors;
  }

  const requiredVersions = [
    "manifest_version",
    "canonical_schema_version",
    "model_format_version",
    "executable_semantics_version",
    "engine_contract_version",
    "result_schema_version",
  ];
  for (const key of requiredVersions) {
    if (typeof manifest[key] !== "string" || manifest[key].length === 0) {
      addError(`manifest.${key} must be a non-empty string`);
    }
  }
  if (manifest.manifest_version !== "1.0.0") {
    addError(`unsupported manifest_version: ${manifest.manifest_version ?? "missing"}`);
  }

  if (!Array.isArray(manifest.specifications)) {
    addError("manifest.specifications must be an array");
  }
  if (!isRecord(manifest.generated_artifact_versions)) {
    addError("manifest.generated_artifact_versions must be an object");
  }
  if (!Array.isArray(manifest.generated_artifacts)) {
    addError("manifest.generated_artifacts must be an array");
  }

  const specifications = Array.isArray(manifest.specifications) ? manifest.specifications : [];
  const generatedArtifacts = Array.isArray(manifest.generated_artifacts) ? manifest.generated_artifacts : [];
  const generatedVersions = isRecord(manifest.generated_artifact_versions)
    ? manifest.generated_artifact_versions
    : {};

  const declaredPaths = new Set();
  for (const [index, artifact] of [...specifications, ...generatedArtifacts].entries()) {
    const label = `artifact entry ${index + 1}`;
    if (!isRecord(artifact)) {
      addError(`${label} must be an object`);
      continue;
    }
    if (typeof artifact.path !== "string") {
      addError(`${label}.path must be a string`);
      continue;
    }
    if (declaredPaths.has(artifact.path)) addError(`duplicate artifact path: ${artifact.path}`);
    declaredPaths.add(artifact.path);
  }

  const specificationsById = new Map();
  for (const specification of specifications) {
    if (!isRecord(specification)) continue;
    if (typeof specification.id !== "string" || specification.id.length === 0) {
      addError("each specification requires a non-empty id");
      continue;
    }
    if (specificationsById.has(specification.id)) addError(`duplicate specification id: ${specification.id}`);
    specificationsById.set(specification.id, specification);

    const content = await readArtifact(specification.path, `specification ${specification.id}`);
    if (content === undefined) continue;
    if (typeof specification.version !== "string" || specification.version.length === 0) {
      addError(`specification ${specification.id} requires a non-empty version`);
      continue;
    }

    if (specification.version_source === "json-specification-version") {
      const value = await parseJson(specification.path, `specification ${specification.id}`);
      const actual = isRecord(value) && isRecord(value.specification) ? value.specification.version : undefined;
      if (actual !== specification.version) {
        addError(`specification ${specification.id} version mismatch: manifest=${specification.version}, file=${actual ?? "missing"}`);
      }
    } else if (specification.version_source === "markdown-version-header") {
      const actual = markdownVersion(content);
      if (actual !== specification.version) {
        addError(`specification ${specification.id} version mismatch: manifest=${specification.version}, file=${actual ?? "missing"}`);
      }
    } else {
      addError(`specification ${specification.id} has unsupported version_source: ${specification.version_source}`);
    }
  }

  const expectedSpecificationVersions = {
    "canonical-financial-schema": manifest.canonical_schema_version,
    "executable-financial-semantics": manifest.executable_semantics_version,
  };
  for (const [id, expectedVersion] of Object.entries(expectedSpecificationVersions)) {
    const specification = specificationsById.get(id);
    if (!specification) addError(`missing required specification entry: ${id}`);
    else if (specification.version !== expectedVersion) {
      addError(`${id} must match its top-level manifest version (${expectedVersion})`);
    }
  }

  const packageJson = await parseJson("package.json", "package metadata");
  if (!isRecord(packageJson) || packageJson.version !== manifest.engine_contract_version) {
    addError(`engine_contract_version must match package.json version (${packageJson?.version ?? "missing"})`);
  }

  const runtimeVersionsPath = manifest.runtime_versions_path;
  if (typeof runtimeVersionsPath !== "string" || runtimeVersionsPath.length === 0) {
    addError("manifest.runtime_versions_path must be a non-empty string");
  } else {
    const runtimeVersions = await readArtifact(runtimeVersionsPath, "runtime version authority");
    if (runtimeVersions !== undefined) {
      const runtimeValue = (key) => runtimeVersions.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1];
      const expectedRuntimeVersions = {
        engineVersion: manifest.engine_contract_version,
        resultSchemaVersion: manifest.result_schema_version,
        financialSpecificationVersion: manifest.executable_semantics_version,
        modelFormatVersion: manifest.model_format_version,
      };
      for (const [key, expected] of Object.entries(expectedRuntimeVersions)) {
        const actual = runtimeValue(key);
        if (actual !== expected) addError(`runtime ${key} must match manifest (${expected}); found ${actual ?? "missing"}`);
      }
    }
  }

  const generatedByPath = new Map();
  for (const artifact of generatedArtifacts) {
    if (!isRecord(artifact) || typeof artifact.path !== "string") continue;
    generatedByPath.set(artifact.path, artifact);
    const content = await readArtifact(artifact.path, `generated artifact ${artifact.path}`);
    await readArtifact(artifact.source, `source for ${artifact.path}`);
    if (artifact.path.endsWith(".json")) await parseJson(artifact.path, `generated artifact ${artifact.path}`);

    if (artifact.authority !== "derived-reference") {
      addError(`${artifact.path} must declare authority=derived-reference`);
    }
    if (artifact.status !== "reference-unreconciled") {
      addError(`${artifact.path} must declare status=reference-unreconciled`);
    }
    const knownDebt = Array.isArray(artifact.known_debt) ? artifact.known_debt : [];
    if (knownDebt.length === 0) {
      addError(`${artifact.path} must declare known_debt while unreconciled`);
    }
    if (generatedVersions[artifact.path] !== artifact.version) {
      addError(`${artifact.path} version differs between generated_artifact_versions and generated_artifacts`);
    }
    if (artifact.source_version !== manifest.canonical_schema_version) {
      addError(`${artifact.path} source_version must match canonical_schema_version`);
    }

    if (content !== undefined && artifact.metadata_location === "header") {
      const sourceName = typeof artifact.source === "string" ? path.basename(artifact.source) : "";
      const header = content.split(/\r?\n/, 1)[0] ?? "";
      if (!header.includes(`Derived from ${sourceName}`)) {
        addError(`${artifact.path} header must identify source ${sourceName}`);
      }
    } else if (artifact.metadata_location === "manifest") {
      if (!knownDebt.includes("missing-embedded-source-version")) {
        addError(`${artifact.path} must declare missing-embedded-source-version while metadata is manifest-only`);
      }
    } else if (artifact.metadata_location !== "header") {
      addError(`${artifact.path} has unsupported metadata_location: ${artifact.metadata_location}`);
    }
  }

  for (const [artifactPath, version] of Object.entries(generatedVersions)) {
    if (typeof version !== "string" || version.length === 0) {
      addError(`generated_artifact_versions.${artifactPath} must be a non-empty string`);
    }
    if (!generatedByPath.has(artifactPath)) {
      addError(`generated_artifact_versions contains no matching artifact entry: ${artifactPath}`);
    }
  }

  const modelSchema = generatedByPath.get("docs/personal_finance_model.schema.json");
  if (modelSchema?.version !== manifest.model_format_version) {
    addError("model_format_version must match the model JSON Schema artifact version");
  }
  const modelSchemaDocument = await parseJson("docs/personal_finance_model.schema.json", "portable model schema");
  if (isRecord(modelSchemaDocument)) {
    const required = Array.isArray(modelSchemaDocument.required) ? modelSchemaDocument.required : [];
    for (const field of ["model_format_version", "financial_specification_version", "model_id", "objects"]) {
      if (!required.includes(field)) addError(`portable model schema must require ${field}`);
    }
    if (required.includes("specification_version") || isRecord(modelSchemaDocument.properties) && "specification_version" in modelSchemaDocument.properties) {
      addError("portable model schema must not conflate model format and financial specification as specification_version");
    }
    const properties = isRecord(modelSchemaDocument.properties) ? modelSchemaDocument.properties : {};
    const modelVersionProperty = isRecord(properties.model_format_version) ? properties.model_format_version : {};
    if (modelVersionProperty.const !== manifest.model_format_version) {
      addError("portable model schema model_format_version const must match manifest");
    }
    const compatibility = isRecord(modelSchemaDocument["x-model-compatibility"])
      ? modelSchemaDocument["x-model-compatibility"]
      : {};
    if (compatibility.current !== manifest.model_format_version) {
      addError("portable model compatibility current version must match manifest");
    }
    const classifications = Array.isArray(compatibility.classifications) ? [...compatibility.classifications].sort() : [];
    const expectedClassifications = ["migratable", "read_only_legacy", "supported_directly", "unsupported"];
    if (!sameStrings(classifications, expectedClassifications)) {
      addError("portable model compatibility must declare the four architecture classifications");
    }
  }

  const canonicalPath = specificationsById.get("canonical-financial-schema")?.path;
  const interfacePath = "docs/personal_finance_simulation_interfaces_v1.0.ts";
  const canonicalContent = typeof canonicalPath === "string"
    ? await readArtifact(canonicalPath, "canonical primitive specification")
    : undefined;
  const interfaceContent = await readArtifact(interfacePath, "generated primitive interfaces");

  if (canonicalContent !== undefined) {
    const ids = primitiveIds(canonicalContent);
    if (!sameStrings(ids, expectedPrimitiveIds)) {
      addError(`canonical primitive identities must be exactly P01-P34; found ${ids.join(", ") || "none"}`);
    }
  }

  const runtimeCatalogContent = await readArtifact("src/primitives/catalog.ts", "runtime primitive catalog");
  if (canonicalContent !== undefined && runtimeCatalogContent !== undefined && typeof canonicalPath === "string") {
    const canonicalDocument = await parseJson(canonicalPath, "canonical primitive specification");
    const canonicalRegistry = isRecord(canonicalDocument) && isRecord(canonicalDocument.primitive_registry)
      ? canonicalDocument.primitive_registry
      : undefined;
    const runtime = parsedCatalogEntries(runtimeCatalogContent);
    errors.push(...runtime.errors);
    const runtimeById = new Map();
    for (const entry of runtime.entries) {
      if (typeof entry.id !== "string") continue;
      if (runtimeById.has(entry.id)) addError(`duplicate runtime primitive identity: ${entry.id}`);
      runtimeById.set(entry.id, entry);
    }
    const runtimeIds = [...runtimeById.keys()].sort();
    if (!sameStrings(runtimeIds, expectedPrimitiveIds)) {
      addError(`runtime primitive identities must be exactly P01-P34; found ${runtimeIds.join(", ") || "none"}`);
    }
    if (!canonicalRegistry) {
      addError("canonical primitive specification must contain primitive_registry");
    } else {
      for (const id of expectedPrimitiveIds) {
        const canonical = canonicalRegistry[id];
        const runtimeEntry = runtimeById.get(id);
        if (!isRecord(canonical) || !runtimeEntry) continue;
        const expectedFields = {
          name: canonical.name,
          class: canonical.class,
          stateful: isRecord(canonical.semantics) ? canonical.semantics.stateful : undefined,
          randomness: isRecord(canonical.semantics) ? canonical.semantics.randomness : undefined,
        };
        for (const [field, expected] of Object.entries(expectedFields)) {
          if (runtimeEntry[field] !== expected) {
            addError(`runtime primitive ${id}.${field} mismatch: canonical=${expected}, runtime=${runtimeEntry[field]}`);
          }
        }
      }
    }
    const implemented = runtime.entries
      .filter((entry) => entry.implementationStatus === "implemented")
      .map((entry) => entry.id)
      .filter((id) => typeof id === "string")
      .sort();
    const expectedImplemented = ["P01", "P02", "P03", "P04", "P05", "P06", "P08", "P13", "P20", "P23", "P26", "P27", "P29", "P30"];
    if (!sameStrings(implemented, expectedImplemented)) {
      addError(`runtime implemented primitive identities must be ${expectedImplemented.join(", ")}; found ${implemented.join(", ") || "none"}`);
    }
    for (const entry of runtime.entries) {
      if (entry.implementationStatus !== "implemented" && entry.implementationStatus !== "registered_only") {
        addError(`runtime primitive ${entry.id ?? "unknown"} has invalid implementationStatus: ${entry.implementationStatus}`);
      }
    }
  }
  if (interfaceContent !== undefined) {
    const ids = primitiveIds(interfaceContent);
    if (!sameStrings(ids, expectedPrimitiveIds)) {
      addError(`generated TypeScript primitive identities must be exactly P01-P34; found ${ids.join(", ") || "none"}`);
    }

    const interfaceArtifact = generatedByPath.get(interfacePath);
    const debt = Array.isArray(interfaceArtifact?.known_debt) ? interfaceArtifact.known_debt : [];
    if (/export\s+type\s+Money\s*=\s*number\s*;/.test(interfaceContent) && !debt.includes("binary-floating-point-money")) {
      addError(`${interfacePath} maps Money to number without declaring binary-floating-point-money`);
    }
    if (/export\s+type\s+Rate\s*=\s*number\s*;/.test(interfaceContent) && !debt.includes("binary-floating-point-rate")) {
      addError(`${interfacePath} maps Rate to number without declaring binary-floating-point-rate`);
    }
  }

  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
  const errors = await validateRepository();
  if (errors.length > 0) {
    console.error(`Specification validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Specification validation passed: runtime/model/result versions, portable envelope compatibility, artifacts, canonical/runtime P01-P34 catalog metadata, and declared debt are consistent.");
  }
}
