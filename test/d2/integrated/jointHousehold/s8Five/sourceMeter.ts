import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { Money } from "../../../../../src/values/index.js";

export const testId = (index: number) => `33150000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const bytes = (value: unknown) => Buffer.byteLength(canonicalSerialize(value));

export function mapDocument<T>(value: T, change: (field: string) => string): T {
  const visit = (field: unknown): unknown => {
    if (typeof field === "string") return change(field);
    if (field === null || typeof field !== "object") return field;
    if (Array.isArray(field)) return field.map(visit);
    if (Object.getPrototypeOf(field) !== Object.prototype) return field;
    return Object.fromEntries(Object.entries(field).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}

export const families = ["fsa", "fsaBank", "card", "cardBank", "helocIssuer", "helocBank", "lender", "loanBank",
  "ssaAward", "irmaa", "ssaInstallment", "medicareInstallment", "ssaBank", "wage", "wageBank",
  "payrollHealth", "premium", "premiumBank", "retirement", "retirementBank", "cmsBank", "cmsExpense"] as const;
export type Family = typeof families[number];
export interface SourceWork { count: number; bytes: number; consumedEnvelopeBytes: number }
export const reads = new Map<Family, SourceWork>();
function meterEnvelope<T>(original: T, complete: () => void): T {
  let pending = 1;
  function visit(value: unknown): unknown {
    if (value === null || typeof value !== "object" || value instanceof Money ||
        !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
      if (--pending === 0) complete();
      return value;
    }
    const fields = Object.entries(value).filter(([, child]) => child !== undefined);
    pending += fields.length - 1;
    if (pending === 0) complete();
    const copy = Array.isArray(value) ? [...value] : { ...value };
    for (const [field, child] of fields) {
      let consumed = false, result: unknown;
      Object.defineProperty(copy, field, { enumerable: true, get() {
        if (!consumed) {
          consumed = true;
          result = visit(child);
        }
        return result;
      } });
    }
    return copy;
  }
  return visit(original) as T;
}
export function observe<T>(family: Family, original: T | undefined, issuedBytes?: number): T | undefined {
  if (original === undefined) return undefined;
  const stats = reads.get(family) ?? { count: 0, bytes: 0, consumedEnvelopeBytes: 0 };
  const size = issuedBytes ?? bytes(original);
  stats.count++;
  stats.bytes += size;
  reads.set(family, stats);
  // Each observation gets its own meter. Only a full consumer traversal
  // earns the envelope's bytes. Report the cumulative HELOC issuer payload
  // separately, where per-row meter overhead would dominate the fixture.
  return family === "helocIssuer" ? original : meterEnvelope(original, () => { stats.consumedEnvelopeBytes += size; });
}
