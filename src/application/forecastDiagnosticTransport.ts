import type { ProjectedCurrentLawAssumption, ProjectedTaxLawQualification, TaxCapabilityDiagnostic, TaxOutputCapabilities } from "../simulation/tax/contracts.js";

declare const catalogReference: unique symbol;
export type ForecastCatalogRef = string & { readonly [catalogReference]: true };
export interface ForecastDiagnosticSource { readonly runId: string; readonly inputFingerprint: string }
export interface ForecastCatalogTable {
  readonly source: ForecastDiagnosticSource;
  readonly entries: readonly { readonly id: ForecastCatalogRef; readonly content: string }[];
}
export type ForecastLawAssumption = Omit<ProjectedCurrentLawAssumption, "catalogFingerprint"> & { readonly catalogRef: ForecastCatalogRef };
export type ForecastLawQualification = Omit<ProjectedTaxLawQualification, "catalogFingerprint" | "assumption"> & {
  readonly catalogRef: ForecastCatalogRef;
  readonly assumption?: ForecastLawAssumption;
};
export type ForecastTaxDiagnostic = Omit<TaxCapabilityDiagnostic, "projectedLaw"> & { readonly projectedLaw?: ForecastLawQualification };
export type ForecastDiagnostic<T> = T extends object ? Omit<T, "projectedLaw"> & { readonly projectedLaw?: ForecastLawQualification } : never;
export type ForecastOutputCapabilities = Readonly<Record<string, Omit<TaxOutputCapabilities[string], "diagnostics"> & {
  readonly diagnostics: readonly ForecastTaxDiagnostic[];
}>>;

const mismatch = (): never => { throw new Error("FORECAST_CATALOG_MISMATCH: missing or mismatched source catalog"); };
const prefix = (source: ForecastDiagnosticSource) => JSON.stringify([source.runId, source.inputFingerprint]);

/** Exact DTO comparison with shared-pair memoization. Do not expand cumulative
 * warning histories once per output just to validate twelve selected months. */
export function createForecastDiagnosticEquality(): (left: unknown, right: unknown) => boolean {
  const pairs = new WeakMap<object, WeakSet<object>>();
  const equal = (left: unknown, right: unknown): boolean => {
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
    if (pairs.get(left)?.has(right)) return true;
    const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    const matches = pairs.get(left) ?? new WeakSet<object>();
    matches.add(right); pairs.set(left, matches);
    const result = leftKeys.every(key => Object.hasOwn(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
    if (!result) matches.delete(right);
    return result;
  };
  return equal;
}

/** Exact string equality interns content; IDs are addresses, never content hashes.
 * One factory belongs to one engine run. Canonical engine objects stay intact. */
export function createForecastDiagnosticTransport(source: ForecastDiagnosticSource, canonicalCatalogs: readonly string[] = []) {
  const identity = Object.freeze({ ...source });
  const entries: ForecastCatalogTable["entries"][number][] = [];
  const contents = new Map<string, ForecastCatalogRef>();
  const diagnostics = new WeakMap<object, object>();
  const laws = new WeakMap<ProjectedTaxLawQualification, ForecastLawQualification>();
  const assumptions = new WeakMap<ProjectedCurrentLawAssumption, ForecastLawAssumption>();
  const outputs = new WeakMap<TaxOutputCapabilities[string], ForecastOutputCapabilities[string]>();
  const capabilityMaps = new WeakMap<TaxOutputCapabilities, ForecastOutputCapabilities>();
  const ref = (content: string): ForecastCatalogRef => {
    if (typeof content !== "string" || !content) return mismatch();
    let id = contents.get(content);
    if (id === undefined) {
      id = `${prefix(identity)}:${entries.length}` as ForecastCatalogRef;
      contents.set(content, id);
      entries.push(Object.freeze({ id, content }));
    }
    return id;
  };
  const diagnostic = <T extends object>(value: T): ForecastDiagnostic<T> => {
    const existing = diagnostics.get(value);
    if (existing) return existing as ForecastDiagnostic<T>;
    const { projectedLaw, ...rest } = value as T & { readonly projectedLaw?: ProjectedTaxLawQualification };
    if (!projectedLaw) {
      const result = Object.freeze(rest);
      diagnostics.set(value, result);
      return result as ForecastDiagnostic<T>;
    }
    const { catalogFingerprint, assumption } = projectedLaw;
    if (assumption && assumption.catalogFingerprint !== catalogFingerprint) return mismatch();
    const catalogRef = ref(catalogFingerprint);
    const compactAssumption = assumption === undefined ? undefined : assumptions.get(assumption) ?? (() => {
      const compact = Object.freeze(Object.fromEntries(Object.entries(assumption).map(([key, field]) =>
        key === "catalogFingerprint" ? ["catalogRef", catalogRef] : [key, field]))) as ForecastLawAssumption;
      assumptions.set(assumption, compact);
      return compact;
    })();
    let compactLaw = laws.get(projectedLaw);
    if (!compactLaw) {
      compactLaw = Object.freeze(Object.fromEntries(Object.entries(projectedLaw).map(([key, field]) =>
        key === "catalogFingerprint" ? ["catalogRef", catalogRef] : key === "assumption" ? [key, compactAssumption] : [key, field]))) as ForecastLawQualification;
      laws.set(projectedLaw, compactLaw);
    }
    const compact = Object.freeze(Object.fromEntries(Object.entries(value).map(([key, field]) =>
      [key, key === "projectedLaw" ? compactLaw : field])));
    diagnostics.set(value, compact);
    return compact as ForecastDiagnostic<T>;
  };
  canonicalCatalogs.forEach(ref);
  const capabilities = (value: TaxOutputCapabilities): ForecastOutputCapabilities => {
    const existing = capabilityMaps.get(value);
    if (existing) return existing;
    const compact = Object.freeze(Object.fromEntries(Object.entries(value).map(([name, output]) => {
      let result = outputs.get(output);
      if (!result) {
        result = Object.freeze({ ...output, diagnostics: Object.freeze(output.diagnostics.map(item => diagnostic(item))) });
        outputs.set(output, result);
      }
      return [name, result];
    })));
    capabilityMaps.set(value, compact);
    return compact;
  };
  return { diagnostic, capabilities, table: (): ForecastCatalogTable => Object.freeze({ source: identity, entries: Object.freeze([...entries]) }) };
}

/** Lightweight transport check. Source-owned drill-down additionally compares
 * every exact catalog string to the original executable selection below. */
export function validateForecastCatalogTable(table: ForecastCatalogTable, source: ForecastDiagnosticSource): void {
  if (!table || !table.source || typeof table.source.runId !== "string" || !table.source.runId ||
    typeof table.source.inputFingerprint !== "string" || !table.source.inputFingerprint ||
    prefix(table.source) !== prefix(source) || !Array.isArray(table.entries)) mismatch();
  const ids = new Set<string>(), contents = new Set<string>();
  table.entries.forEach((entry, index) => {
    if (!entry || entry.id !== `${prefix(source)}:${index}` || typeof entry.content !== "string" || !entry.content ||
      ids.has(entry.id) || contents.has(entry.content)) mismatch();
    ids.add(entry.id); contents.add(entry.content);
  });
  // structuredClone deliberately drops frozen descriptors. Re-establish the
  // immutable read-model boundary after validating the transported table.
  Object.freeze(table.source);
  table.entries.forEach(entry => Object.freeze(entry));
  Object.freeze(table.entries);
  Object.freeze(table);
}

export function validateForecastLawReference(law: ForecastLawQualification, table: ForecastCatalogTable): void {
  if (!law || "catalogFingerprint" in law || !table.entries.some(entry => entry.id === law.catalogRef) ||
    law.assumption && ("catalogFingerprint" in law.assumption || law.assumption.catalogRef !== law.catalogRef)) mismatch();
}

/** Called only with source-owned canonical catalog content, never an unchecked
 * digest or another copy of an untrusted transport table. */
export function rehydrateForecastLaw(law: ForecastLawQualification, table: ForecastCatalogTable,
  source: ForecastDiagnosticSource, canonicalCatalogs: readonly string[]): ProjectedTaxLawQualification {
  validateForecastCatalogTable(table, source);
  if (table.entries.length !== new Set(canonicalCatalogs).size ||
    table.entries.some(entry => !canonicalCatalogs.includes(entry.content))) mismatch();
  validateForecastLawReference(law, table);
  const catalogFingerprint = table.entries.find(entry => entry.id === law.catalogRef)!.content;
  const { catalogRef: _ref, assumption, ...fields } = law;
  const canonicalAssumption = assumption === undefined ? undefined : (() => {
    const { catalogRef: _assumptionRef, ...rest } = assumption;
    return Object.freeze({ ...rest, catalogFingerprint });
  })();
  return Object.freeze({ ...fields, catalogFingerprint,
    ...(canonicalAssumption === undefined ? {} : { assumption: canonicalAssumption }) });
}

/** Reference-preserving portable JSON accounting, like a worker transport graph.
 * Shared objects are visited once; catalogs remain exact primitive strings.
 * Virtual canonical expansion avoids allocating the old repeated catalog JSON. */
export function forecastDiagnosticBytes(value: unknown, table: ForecastCatalogTable): { readonly compact: number; readonly canonical: number } {
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const sizes = new Map(table.entries.map(entry => [entry.id,
    bytes(JSON.stringify(entry.content)) - bytes(JSON.stringify(entry.id)) + bytes('"catalogFingerprint"') - bytes('"catalogRef"')]));
  let extra = 0;
  const identities = new WeakMap<object, number>();
  let nextId = 0;
  const serialized = JSON.stringify(value, (key, item: unknown) => {
    if (item !== null && typeof item === "object") {
      const existing = identities.get(item);
      if (existing !== undefined) return { $ref: existing };
      identities.set(item, nextId++);
    }
    if (key === "catalogRef") {
      const size = sizes.get(item as ForecastCatalogRef);
      if (size === undefined) mismatch();
      extra += size!;
    }
    return item;
  });
  const compact = bytes(serialized);
  return Object.freeze({ compact, canonical: compact + extra });
}

/** Inspect only diagnostic-bearing read-model fields, never the portable proof. */
export function validateForecastDiagnostics(diagnostics: readonly object[], capabilities: readonly (ForecastOutputCapabilities | TaxOutputCapabilities | undefined)[],
  table: ForecastCatalogTable | undefined, source?: ForecastDiagnosticSource): void {
  if (table) validateForecastCatalogTable(table, source ?? table.source);
  const seenDiagnostics = new WeakSet<object>(), seenOutputs = new WeakSet<object>();
  const check = (diagnostic: object) => {
    if (seenDiagnostics.has(diagnostic)) return;
    seenDiagnostics.add(diagnostic);
    const law = (diagnostic as { projectedLaw?: ForecastLawQualification }).projectedLaw;
    if (law !== undefined) {
      if (!table) mismatch();
      validateForecastLawReference(law, table!);
    }
  };
  diagnostics.forEach(check);
  capabilities.forEach(value => { if (value) Object.values(value).forEach(output => {
    if (seenOutputs.has(output)) return;
    seenOutputs.add(output); output.diagnostics.forEach(check);
  }); });
}
