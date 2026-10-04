import { instant } from "../time/index.js";
import { Currency, decimal } from "../values/index.js";
import type { CalibrationDraft, CalibrationFingerprint, CalibrationMember, CalibrationReference, CalibrationSet } from "./types.js";
export type * from "./types.js";

export class CalibrationValidationError extends Error {
  readonly code = "INVALID_CALIBRATION";
  constructor(readonly fieldPath: string, message: string) {
    super(`${fieldPath}: ${message}`);
    this.name = "CalibrationValidationError";
  }
}
const invalid = (path: string, message: string): never => { throw new CalibrationValidationError(path, message); };
const text = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !value.trim()) return invalid(path, "Expected nonempty text");
  return value.trim();
};
const identifier = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(result)) return invalid(path, "Expected an explicit case-sensitive identifier");
  return result;
};
const record = (value: unknown, path: string, keys: readonly string[]): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    return invalid(path, "Expected a plain contract object");
  const result = value as Record<string, unknown>;
  if (Reflect.ownKeys(result).some(key => typeof key !== "string" || !keys.includes(key)))
    return invalid(path, "Unsupported fields require an explicit contract version or mapping");
  return result;
};
const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value) || value.length === 0) return invalid(path, "Expected a nonempty array");
  for (let i = 0; i < value.length; i++) if (!(i in value)) invalid(path, "Sparse arrays are unsupported");
  return value;
};
const choice = <T extends string>(value: unknown, path: string, options: readonly T[]): T => {
  if (typeof value !== "string" || !options.includes(value as T)) return invalid(path, `Supported values: ${options.join(", ")}`);
  return value as T;
};
const month = (value: unknown, path: string, positive = false): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    return invalid(path, "Expected a safe integer month offset");
  return value === 0 ? 0 : value;
};
const parameter = (value: unknown, path: string, min?: string, max?: string): string => {
  if (typeof value !== "string") return invalid(path, "Parameters must be finite exact decimal strings");
  let normalized: string;
  try { normalized = decimal(value).toString(); } catch { return invalid(path, "Invalid finite decimal parameter"); }
  if ((min !== undefined && decimal(normalized).compare(decimal(min)) < 0) ||
      (max !== undefined && decimal(normalized).compare(decimal(max)) > 0)) return invalid(path, "Parameter outside supported range");
  return normalized;
};
const timestamp = (value: unknown, path: string): string => {
  const result = text(value, path);
  try { return instant(result); } catch { return invalid(path, "Expected canonical UTC instant"); }
};
const versioned = (value: unknown, path: string) => {
  const v = record(value, path, ["id", "version"]);
  return { id: identifier(v.id, `${path}.id`), version: identifier(v.version, `${path}.version`) };
};
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const calibrationMemberKey = (member: Pick<CalibrationMember, "kind" | "id">): string => `${member.kind}:${member.id}`;

/** Exact fraction-free symmetric elimination: zero pivots require zero residual rows.
 * Singular positive semidefinite matrices are accepted without floating tolerances. */
const assertPositiveSemidefinite = (matrix: readonly (readonly string[])[]): void => {
  const scale = Math.max(...matrix.flat().map(value => value.split(".")[1]?.length ?? 0));
  const work = matrix.map(row => row.map(value => {
    const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".");
    return BigInt(`${whole}${fraction.padEnd(scale, "0")}`) * (value.startsWith("-") ? -1n : 1n);
  }));
  let previous = 1n;
  for (let k = 0; k < work.length; k++) {
    const pivot = work[k]![k]!;
    if (pivot < 0n) invalid("dependence.matrix", "Correlation matrix must be positive semidefinite");
    if (pivot === 0n) {
      if (work[k]!.slice(k + 1).some(value => value !== 0n)) invalid("dependence.matrix", "Zero pivot has nonzero residual correlation");
      continue;
    }
    for (let i = k + 1; i < work.length; i++) {
      for (let j = i; j < work.length; j++) {
        const numerator = pivot * work[i]![j]! - work[i]![k]! * work[k]![j]!;
        if (numerator % previous !== 0n) invalid("dependence.matrix", "Unsupported exact correlation structure");
        work[i]![j] = numerator / previous;
        work[j]![i] = work[i]![j]!;
      }
    }
    previous = pivot;
  }
};

const normalize = (input: unknown): CalibrationDraft => {
  const draft = record(input, "calibration", ["source", "horizon", "baseCurrency", "basis", "returnConvention", "members", "dependence", "metadata", "schemaVersion", "id", "fingerprint"]);
  const s = record(draft.source, "source", ["kind", "id", "version", "methodology", "mapping", "publishedAt", "observedAt", "dataCutoff", "freshness", "provenance"]);
  const p = record(s.provenance, "source.provenance", ["reference", "license", "attribution"]);
  const source = {
    kind: choice(s.kind, "source.kind", ["synthetic", "internal", "external"] as const),
    ...versioned({ id: s.id, version: s.version }, "source"),
    methodology: versioned(s.methodology, "source.methodology"), mapping: versioned(s.mapping, "source.mapping"),
    publishedAt: timestamp(s.publishedAt, "source.publishedAt"), observedAt: timestamp(s.observedAt, "source.observedAt"),
    dataCutoff: timestamp(s.dataCutoff, "source.dataCutoff"),
    freshness: choice(s.freshness, "source.freshness", ["fixed_vintage"] as const),
    provenance: { reference: text(p.reference, "source.provenance.reference"), license: text(p.license, "source.provenance.license"), attribution: text(p.attribution, "source.provenance.attribution") },
  };
  if (source.dataCutoff > source.publishedAt || source.publishedAt > source.observedAt)
    invalid("source", "Require dataCutoff <= publishedAt <= observedAt");
  const h = record(draft.horizon, "horizon", ["unit", "months"]);
  const horizon = { unit: choice(h.unit, "horizon.unit", ["month"] as const), months: month(h.months, "horizon.months", true) };
  const baseCurrency = text(draft.baseCurrency, "baseCurrency").toUpperCase();
  // Explicit supported list also excludes inherited Object prototype currency keys.
  if (!["EUR", "GBP", "JPY", "KWD", "USD"].includes(baseCurrency)) invalid("baseCurrency", "Unsupported runtime currency");
  Currency.of(baseCurrency);
  const members = array(draft.members, "members").map((value, i): CalibrationMember => {
    const path = `members[${i}]`;
    const m = record(value, path, ["kind", "id", "definition", "terms"]);
    const terms = array(m.terms, `${path}.terms`).map((value, j) => {
      const tp = `${path}.terms[${j}]`;
      const t = record(value, tp, ["startMonth", "endMonth", "expectedReturn", "volatility"]);
      return { startMonth: month(t.startMonth, `${tp}.startMonth`), endMonth: month(t.endMonth, `${tp}.endMonth`, true),
        expectedReturn: parameter(t.expectedReturn, `${tp}.expectedReturn`, "-1"), volatility: parameter(t.volatility, `${tp}.volatility`, "0") };
    }).sort((a, b) => a.startMonth - b.startMonth);
    let end = 0;
    for (const term of terms) {
      if (term.startMonth !== end || term.endMonth <= term.startMonth || term.endMonth > horizon.months)
        invalid(`${path}.terms`, "Terms must cover the horizon exactly, without overlaps or gaps");
      end = term.endMonth;
    }
    if (end !== horizon.months) invalid(`${path}.terms`, "Incomplete horizon coverage");
    const compact: typeof terms = [];
    for (const term of terms) {
      const previous = compact[compact.length - 1];
      if (previous && previous.expectedReturn === term.expectedReturn && previous.volatility === term.volatility)
        previous.endMonth = term.endMonth;
      else compact.push({ ...term });
    }
    return { kind: choice(m.kind, `${path}.kind`, ["asset_class", "sector", "factor", "issuer"] as const),
      id: identifier(m.id, `${path}.id`), definition: text(m.definition, `${path}.definition`), terms: compact };
  }).sort((a, b) => compare(calibrationMemberKey(a), calibrationMemberKey(b)));
  const keys = members.map(calibrationMemberKey);
  if (new Set(keys).size !== keys.length) invalid("members", "Duplicate normalized member keys");
  const d = record(draft.dependence, "dependence", ["kind", "members", "matrix"]);
  const kind = choice(d.kind, "dependence.kind", ["pearson_simple_return"] as const);
  const matrixKeys = array(d.members, "dependence.members").map((value, i) => identifier(value, `dependence.members[${i}]`));
  if (new Set(matrixKeys).size !== keys.length || matrixKeys.length !== keys.length || matrixKeys.some(key => !keys.includes(key)))
    invalid("dependence.members", "Dependence must name each normalized member exactly once");
  const rows = array(d.matrix, "dependence.matrix");
  if (rows.length !== keys.length) invalid("dependence.matrix", "Matrix dimension mismatch");
  const matrix = rows.map((row, i) => {
    const values = array(row, `dependence.matrix[${i}]`);
    if (values.length !== keys.length) invalid("dependence.matrix", "Matrix dimension mismatch");
    return values.map((value, j) => parameter(value, `dependence.matrix[${i}][${j}]`, "-1", "1"));
  });
  for (let i = 0; i < keys.length; i++) {
    if (matrix[i]![i] !== "1") invalid("dependence.matrix", "Correlation diagonal must equal one");
    for (let j = 0; j < i; j++) if (matrix[i]![j] !== matrix[j]![i]) invalid("dependence.matrix", "Correlation matrix must be symmetric");
  }
  assertPositiveSemidefinite(matrix);
  const positions = keys.map(key => matrixKeys.indexOf(key));
  const dependence = { kind, members: keys, matrix: positions.map(i => positions.map(j => matrix[i]![j]!)) };
  let metadata: CalibrationDraft["metadata"];
  if (draft.metadata !== undefined) {
    const m = record(draft.metadata, "metadata", ["confidence", "coverage", "regime"]);
    const normalized: { confidence?: string; coverage?: string; regime?: string } = {};
    for (const key of ["confidence", "coverage", "regime"] as const) if (m[key] !== undefined) normalized[key] = text(m[key], `metadata.${key}`);
    if (Object.keys(normalized).length) metadata = normalized;
  }
  return { source, horizon, baseCurrency, basis: choice(draft.basis, "basis", ["nominal", "real"] as const),
    returnConvention: choice(draft.returnConvention, "returnConvention", ["annual_arithmetic_simple_total_return"] as const),
    members, dependence, ...(metadata === undefined ? {} : { metadata }) };
};

/** Plain JSON subset of simulation/run.ts canonical serialization: sorted keys, ordered arrays.
 * Kept here to avoid an outward dependency on simulation. */
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)!;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};
/** Same UTF-8 FNV-1a 64 convention as run input fingerprints; not a security hash. */
const fingerprint = (content: string): CalibrationFingerprint => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(content)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `calibration:fnv1a64:v1:${hash.toString(16).padStart(16, "0")}` as CalibrationFingerprint;
};
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const construct = (draft: unknown): { snapshot: CalibrationSet; content: string } => {
  const economic = { schemaVersion: "calibration/v1" as const, ...normalize(draft) };
  const content = canonical(economic);
  const key = fingerprint(content);
  const supplied = draft as Record<string, unknown>;
  if (["schemaVersion", "id", "fingerprint"].some(field => Object.hasOwn(supplied, field))) {
    if (supplied.schemaVersion !== economic.schemaVersion || supplied.id !== key || supplied.fingerprint !== key)
      invalid("calibration.identity", "Supplied snapshot identity does not match normalized content");
  }
  return { snapshot: freeze({ ...economic, id: key, fingerprint: key }), content };
};
/** Copies, validates, normalizes, and recursively freezes the caller's draft. */
export const createCalibrationSet = (draft: CalibrationDraft): CalibrationSet => construct(draft).snapshot;

/** Explicit owner-scoped storage. Retained references must keep their registry alive;
 * persistence and retention policy belong to later consumers. */
export class CalibrationSnapshotRegistry {
  readonly #entries = new Map<CalibrationFingerprint, { snapshot: CalibrationSet; content: string }>();
  intern(draft: CalibrationDraft): CalibrationSet {
    const entry = construct(draft);
    const existing = this.#entries.get(entry.snapshot.fingerprint);
    if (existing) {
      if (existing.content !== entry.content) invalid("fingerprint", "Content fingerprint collision");
      return existing.snapshot;
    }
    this.#entries.set(entry.snapshot.fingerprint, entry);
    return entry.snapshot;
  }
  resolve(reference: CalibrationReference): CalibrationSet {
    if (reference.schemaVersion !== "calibration/v1") return invalid("reference.schemaVersion", "Unsupported calibration version");
    const entry = this.#entries.get(reference.fingerprint);
    if (!entry) return invalid("reference.fingerprint", "Calibration snapshot unavailable");
    return entry.snapshot;
  }
  get size(): number { return this.#entries.size; }
}
export const calibrationReference = (snapshot: CalibrationSet): CalibrationReference =>
  Object.freeze({ schemaVersion: snapshot.schemaVersion, fingerprint: snapshot.fingerprint });
