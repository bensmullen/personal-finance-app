import { DecimalAmount, Money, RoundingPolicy, money } from "../../../values/index.js";
import { sha256 } from "./contentIdentity.js";

export type Identity<K extends string> = string & { readonly __domain: K };
export type OwnerId = Identity<"owner">;
export type AccountId = Identity<"account">;
export type LotId = Identity<"lot">;
export type PropertyId = Identity<"property">;
export type SecurityId = Identity<"security">;
export type Predicate = { readonly value: boolean | "unknown"; readonly evidence: readonly string[] };
export interface Context {
  readonly taxYear: number;
  readonly jurisdiction: string;
  readonly owner: OwnerId;
  readonly sources: readonly string[];
  readonly projection?: "2025_nominal_current_law";
}
export interface Diagnostic {
  readonly code: string;
  readonly output: string;
  readonly kind: "invalid" | "unsupported" | "legal_unknown" | "incomplete";
}
export type Outcome<T> =
  | { readonly status: "complete"; readonly value: T; readonly trace: Trace }
  | { readonly status: "incomplete"; readonly diagnostics: readonly Diagnostic[]; readonly trace: Trace };
export interface Trace {
  readonly ruleId: string;
  readonly version: string;
  readonly fingerprint: string;
  readonly context: Context;
  readonly sources: readonly string[];
  readonly assumptions: readonly string[];
  readonly inputIdentity: string;
}
export const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** Collision-free content address, following the shared catalog convention. */
export const canonical = (value: unknown): string => {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if ("toJSON" in value && typeof value.toJSON === "function") return canonical(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => compareText(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};
/** Fixed-size, domain-separated reference; original facts stay in receipts. */
export const contentIdentity = (domain: string, value: unknown): string => `${domain}:sha256:${sha256(canonical(value))}`;
export const law = freeze({
  id: "federal:t1b:2025", version: "2", jurisdiction: "US",
  effectiveFrom: "2025-01-01", effectiveUntil: "2026-01-01",
  annualLossCap: money("3000"), separateLossCap: money("1500"),
  washDays: 30, identificationDays: 45, exchangeDays: 180,
  rounding: { scale: 2, mode: "half_even", allocation: "cumulative_then_difference" },
  sources: [
    "https://www.irs.gov/publications/p550#en_US_2025_publink100010601",
    "https://www.irs.gov/publications/p550#en_US_2025_publink1000273751",
    "https://www.irs.gov/irb/2008-03_IRB#RR-2008-5",
    "https://www.irs.gov/instructions/i8824",
  ], reviewedOn: "2026-10-17",
});
export const ruleFingerprint = `t1b:canonical-v1:${canonical(law)}`;
export const rounding = new RoundingPolicy(2, "half_even");
export const zero = money("0");
export const min = (a: Money, b: Money): Money => a.compare(b) <= 0 ? a : b;
export const positive = (a: Money): Money => a.isNegative() ? zero : a;
export const sum = (items: readonly Money[]): Money => items.reduce((a, b) => a.plus(b), zero);
export const decimal = DecimalAmount.parse;
export const diagnostic = (code: string, output: string, kind: Diagnostic["kind"] = "incomplete"): Diagnostic => ({ code, output, kind });
export const validMoney = (items: readonly Money[], nonnegative = false): boolean => items.every(m => m instanceof Money && m.currency.code === "USD" && m.equals(m.round(rounding)) && (!nonnegative || !m.isNegative()));
export const day = (date: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("DATE_INVALID");
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error("DATE_INVALID");
  return time / 86400000;
};
export const trace = (context: Context, input: unknown, domain: string): Trace => ({
  ruleId: `${law.id}:${domain}`, version: law.version, fingerprint: ruleFingerprint,
  context: { ...context, sources: [...context.sources] }, sources: [...law.sources],
  assumptions: context.taxYear === 2025 ? [] : ["Explicit 2025 nominal-current-law scenario; not verified future law."],
  inputIdentity: contentIdentity(`t1b:${domain}:input`, input),
});
export const contextIssues = (c: Context): Diagnostic[] => {
  const issues: Diagnostic[] = [];
  if (c.jurisdiction !== "US") issues.push(diagnostic("FEDERAL_ONLY", "rule", "unsupported"));
  if (!c.owner || c.sources.length === 0) issues.push(diagnostic("CONTEXT_PROVENANCE_MISSING", "rule"));
  if (!Number.isSafeInteger(c.taxYear) || c.taxYear < 2025 || (c.taxYear !== 2025 && c.projection !== "2025_nominal_current_law")) issues.push(diagnostic("RULE_YEAR_UNAVAILABLE", "rule", "unsupported"));
  return issues;
};
export const incomplete = <T>(t: Trace, issues: readonly Diagnostic[]): Outcome<T> => freeze({ status: "incomplete", diagnostics: [...issues], trace: t });
export const complete = <T>(t: Trace, value: T): Outcome<T> => freeze({ status: "complete", value, trace: t });
