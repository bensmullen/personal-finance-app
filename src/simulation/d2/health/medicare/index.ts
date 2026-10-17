import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Money } from "../../../../values/index.js";
import type { EffectivePeriod, MedicareElection, PremiumProposal, PremiumSource } from "../premiums/index.js";

export interface FilingState { readonly filingStatus: string; readonly maritalState: string }
export type MedicarePart = "part_b" | "part_d";
export interface IncomeTier {
  readonly id: string;
  readonly lower: Money | null;
  readonly lowerInclusive: boolean;
  readonly upper: Money | null;
  readonly upperInclusive: boolean;
  readonly partBMonthly: Money;
  readonly partDMonthly: Money;
}
export interface IrmaaRule {
  readonly source: PremiumSource;
  readonly taxYear: number;
  /** Explicit source-owned legal year; never inferred by subtracting two. */
  readonly lookbackTaxYear: number;
  readonly currency: "USD";
  readonly monthlyConvention: "whole_month_only" | "unknown_proration";
  readonly tables: readonly (FilingState & { readonly tiers: readonly IncomeTier[] })[];
}
export interface HistoricalIncome extends FilingState {
  readonly personId: string;
  readonly householdId: string;
  readonly taxYear: number;
  readonly taxReturnRef: string;
  readonly magi: Money;
  readonly source: PremiumSource;
}
export interface IrmaaOverride extends Omit<HistoricalIncome, "taxReturnRef">, EffectivePeriod {
  readonly incomeReference: string;
  readonly determinationId: string;
  readonly premiumTaxYear: number;
  readonly authority: "SSA" | "CMS";
  readonly qualification: "verified_legal_determination" | "unqualified";
  readonly applicableRuleSnapshotId: string;
  readonly lifeEventRef?: string;
}
export interface MedicareEnrollment extends EffectivePeriod {
  readonly coverageId: string;
  readonly personId: string;
  readonly householdId: string;
  readonly planId: string;
  readonly part: MedicarePart;
  readonly elected: readonly MedicareElection[];
  readonly source: PremiumSource;
  /** Read-only C1 reference: its base amount is never added or recognized here. */
  readonly basePremium?: PremiumProposal;
}
export interface IrmaaRequest {
  readonly householdId: string;
  readonly personIds: readonly string[];
  readonly period: EffectivePeriod;
  readonly taxYear: number;
  readonly enrollments: readonly MedicareEnrollment[];
  readonly deaths: readonly { readonly personId: string; readonly effectiveAt: CivilDate; readonly source: PremiumSource }[];
  readonly rules: readonly IrmaaRule[];
  readonly histories: readonly HistoricalIncome[];
  readonly overrides: readonly IrmaaOverride[];
}
export type IrmaaDiagnosticCode = "ENROLLMENT_NOT_ADMITTED" | "ELECTION_CONFLICT" | "DUPLICATE_SURCHARGE"
  | "RULE_REQUIRED" | "RULE_CONFLICT" | "RULE_NOT_ADMITTED" | "TIER_TABLE_REQUIRED"
  | "HISTORICAL_INCOME_REQUIRED" | "INCOME_CONFLICT" | "INCOME_NOT_ADMITTED"
  | "OVERRIDE_NOT_ADMITTED" | "OVERRIDE_CONFLICT" | "PRORATION_REQUIRED" | "DEATH_SOURCE_REQUIRED"
  | "TOTAL_AND_SETTLEMENT_OWNER_PENDING";
export interface IrmaaDiagnostic {
  readonly diagnosticCode: IrmaaDiagnosticCode;
  readonly sourceEntityPath: string;
  readonly period: EffectivePeriod;
  readonly affectedOutput: "medicare_total" | "net_cash";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface IrmaaCandidate {
  readonly operationId: string;
  readonly kind: "uncommitted_irmaa_surcharge";
  readonly contractVersion: "d2-shared/v1";
  readonly personId: string;
  readonly householdId: string;
  readonly coverageId: string;
  readonly planId: string;
  readonly part: MedicarePart;
  readonly taxYear: number;
  readonly incomeTaxYear: number;
  readonly legalLookbackTaxYear: number;
  readonly magi: Money;
  readonly incomeReference: string;
  readonly period: EffectivePeriod;
  readonly amountBasis: "monthly_surcharge_no_proration";
  readonly monthlySurcharge: Money;
  readonly tier: IncomeTier;
  readonly filingState: FilingState;
  readonly determination: "historical_return" | "qualified_override";
  readonly determinationRef: string;
  readonly ruleSnapshotId: string;
  readonly ruleSource: PremiumSource;
  readonly incomeSource: PremiumSource;
  readonly traceRefs: readonly string[];
}
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const validPeriod = (p: EffectivePeriod): void => {
  civilDate(p.start); civilDate(p.endExclusive);
  if (p.start >= p.endExclusive) throw new Error("IRMAA period must be nonempty and half-open");
};
const overlaps = (a: EffectivePeriod, b: EffectivePeriod): boolean => a.start < b.endExclusive && b.start < a.endExclusive;
const contains = (a: EffectivePeriod, b: EffectivePeriod): boolean => a.start <= b.start && a.endExclusive >= b.endExclusive;
const intersect = (a: EffectivePeriod, b: EffectivePeriod): EffectivePeriod => ({ start: a.start > b.start ? a.start : b.start,
  endExclusive: a.endExclusive < b.endExclusive ? a.endExclusive : b.endExclusive });
const sourceValid = (s: PremiumSource, family: string, scope?: EffectivePeriod): boolean => {
  validPeriod(s); civilDate(s.asOf);
  return s.projectionStatus === "verified" && s.jurisdiction === "US" && s.ruleFamily === family
    && [s.ruleSnapshotId, s.sourcePublication, s.version].every(text) && (!scope || contains(s, scope));
};
const exactUsd = (m: Money): boolean => m instanceof Money && m.currency.code === "USD" && m.amount.fitsScale(2);
const yearValid = (y: number): boolean => Number.isSafeInteger(y) && y >= 1 && y <= 9998;
const yearPeriod = (y: number): EffectivePeriod => ({ start: civilDate(`${String(y).padStart(4, "0")}-01-01`),
  endExclusive: civilDate(`${String(y + 1).padStart(4, "0")}-01-01`) });
const freezeCopy = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || value instanceof Money) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(item => freezeCopy(item))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freezeCopy(v)]))) as T;
};
/** Full exact partition (including negative MAGI), with explicit equality ownership. */
const validTiers = (tiers: readonly IncomeTier[]): boolean => {
  if (!tiers.length || new Set(tiers.map(t => t.id)).size !== tiers.length
    || !tiers.every(t => text(t.id) && [t.partBMonthly, t.partDMonthly].every(m => exactUsd(m) && !m.isNegative())
      && (t.lower === null || exactUsd(t.lower)) && (t.upper === null || exactUsd(t.upper))
      && typeof t.lowerInclusive === "boolean" && typeof t.upperInclusive === "boolean")) return false;
  const sorted = [...tiers].sort((a, b) => a.lower === null ? (b.lower === null ? 0 : -1)
    : b.lower === null ? 1 : a.lower.amount.compare(b.lower.amount));
  if (sorted[0]!.lower !== null || sorted[sorted.length - 1]!.upper !== null) return false;
  return sorted.every((t, i) => {
    if (t.lower !== null && t.upper !== null && t.lower.amount.compare(t.upper.amount) >= 0) return false;
    if (i === 0) return true;
    const prior = sorted[i - 1]!;
    return prior.upper !== null && t.lower !== null && prior.upper.equals(t.lower) && prior.upperInclusive !== t.lowerInclusive;
  });
};
const includesIncome = (t: IncomeTier, m: Money): boolean =>
  (t.lower === null || m.amount.compare(t.lower.amount) > 0 || (t.lowerInclusive && m.amount.equals(t.lower.amount)))
  && (t.upper === null || m.amount.compare(t.upper.amount) < 0 || (t.upperInclusive && m.amount.equals(t.upper.amount)));

/** Pure lookup of externally verified data; never posts cash, premiums, taxes or SSA deductions. */
export function evaluateIrmaa(request: IrmaaRequest) {
  validPeriod(request.period);
  if (!yearValid(request.taxYear) || !text(request.householdId) || !request.personIds.length
    || !request.personIds.every(text) || new Set(request.personIds).size !== request.personIds.length)
    throw new Error("Invalid IRMAA tax year or household identity");
  const annual = yearPeriod(request.taxYear);
  if (!contains(annual, request.period)) throw new Error("IRMAA request must be within its premium tax year");
  const enrollments = [...request.enrollments].sort((a, b) => order(a.coverageId, b.coverageId) || order(a.personId, b.personId)
    || order(a.part, b.part) || order(a.planId, b.planId) || order(a.start, b.start) || order(a.endExclusive, b.endExclusive));
  for (const e of enrollments) {
    validPeriod(e);
    if (![e.coverageId, e.personId, e.householdId, e.planId].every(text)) throw new Error("Missing Medicare identity");
  }
  for (const o of request.overrides) validPeriod(o);
  for (const d of request.deaths) civilDate(d.effectiveAt);
  const candidates: IrmaaCandidate[] = [];
  const diagnostics: IrmaaDiagnostic[] = [];
  const coverage: { coverageId: string; personId: string; part: MedicarePart; period: EffectivePeriod;
    surchargeCoverage: "complete" | "incomplete" | "not_applicable" }[] = [];
  const diagnose = (e: MedicareEnrollment, period: EffectivePeriod, code: IrmaaDiagnosticCode, fact: string, refs: readonly string[], ruleId: string | null) => {
    for (const affectedOutput of ["medicare_total", "net_cash"] as const) diagnostics.push({ diagnosticCode: code,
      sourceEntityPath: `enrollments/${encodeURIComponent(e.coverageId)}/${encodeURIComponent(e.personId)}/${e.part}`,
      period, affectedOutput, coverage: "incomplete", missingFacts: [fact], ruleSnapshotId: ruleId,
      traceRefs: [...new Set(refs)].sort(order) });
  };
  for (const e of enrollments) {
    if (!overlaps(e, request.period)) continue;
    const scope = intersect(e, request.period);
    for (let month = 1; month <= 12; month++) {
      const calendar: EffectivePeriod = { start: civilDate(`${String(request.taxYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`),
        endExclusive: month === 12 ? annual.endExclusive : civilDate(`${String(request.taxYear).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`) };
      if (!overlaps(scope, calendar)) continue;
      const period = intersect(scope, calendar);
      const row = { coverageId: e.coverageId, personId: e.personId, part: e.part, period,
        surchargeCoverage: "incomplete" as "complete" | "incomplete" | "not_applicable" };
      coverage.push(row);
      let refs = [e.coverageId, e.planId, e.source.ruleSnapshotId];
      let ruleId: string | null = null;
      const fail = (code: IrmaaDiagnosticCode, fact: string) => diagnose(e, period, code, fact, refs, ruleId);
      const deaths = request.deaths.filter(d => d.personId === e.personId && d.effectiveAt < calendar.endExclusive);
      if (deaths.length) {
        refs = [...refs, ...deaths.map(d => d.source.ruleSnapshotId)];
        if (deaths.length !== 1 || !sourceValid(deaths[0]!.source, "death_record")
          || deaths[0]!.effectiveAt < deaths[0]!.source.start || deaths[0]!.effectiveAt >= deaths[0]!.source.endExclusive) {
          fail("DEATH_SOURCE_REQUIRED", "one verified dated death record"); continue;
        }
        if (deaths[0]!.effectiveAt <= calendar.start) { row.surchargeCoverage = "not_applicable"; continue; }
        fail("PRORATION_REQUIRED", "source-owned death-month proration"); continue;
      }
      if (e.householdId !== request.householdId || !request.personIds.includes(e.personId)
        || !["part_b", "part_d"].includes(e.part) || !sourceValid(e.source, "medicare_enrollment", calendar)) {
        fail("ENROLLMENT_NOT_ADMITTED", "verified person/household/Part enrollment covering the month"); continue;
      }
      const choices: readonly MedicareElection[] = ["part_a", "part_b", "part_d", "advantage", "medigap", "supplement"];
      const peers = enrollments.filter(other => other.personId === e.personId && overlaps(other, calendar));
      refs = [...refs, ...peers.map(other => other.source.ruleSnapshotId), ...(e.basePremium ? e.basePremium.traceRefs : [])];
      const combined = peers.flatMap(other => other.elected);
      if (!e.elected.includes(e.part) || new Set(e.elected).size !== e.elected.length || e.elected.some(p => !choices.includes(p))
        || (combined.includes("advantage") && combined.includes("medigap"))
        || (e.basePremium && (e.basePremium.householdId !== e.householdId || e.basePremium.coverageId !== e.coverageId
          || e.basePremium.planId !== e.planId || e.basePremium.memberIds.length !== 1 || e.basePremium.memberIds[0] !== e.personId
          || !e.basePremium.medicare || e.basePremium.medicare.elected.length !== e.elected.length
          || e.basePremium.medicare.elected.some(p => !e.elected.includes(p))
          || !contains(e.basePremium.coveragePeriod, calendar)))) {
        fail("ELECTION_CONFLICT", "compatible elected Part/plan and matching C1 reference"); continue;
      }
      if (peers.filter(other => other.part === e.part).length !== 1) {
        refs = [...refs, ...peers.filter(other => other.part === e.part).map(other => other.source.ruleSnapshotId)];
        fail("DUPLICATE_SURCHARGE", "one person/Part/month obligation regardless of plan identity"); continue;
      }
      if (!contains(scope, calendar)) { fail("PRORATION_REQUIRED", "whole-month request/coverage or sourced partial-month semantics"); continue; }
      const rules = request.rules.filter(r => r.taxYear === request.taxYear && overlaps(r.source, calendar));
      refs = [...refs, ...rules.map(r => r.source.ruleSnapshotId)];
      if (rules.length !== 1) { fail(rules.length ? "RULE_CONFLICT" : "RULE_REQUIRED", "one applicable versioned CMS IRMAA rule"); continue; }
      const rule = rules[0]!;
      ruleId = rule.source.ruleSnapshotId;
      if (!sourceValid(rule.source, "cms_irmaa", calendar) || rule.currency !== "USD"
        || !yearValid(rule.lookbackTaxYear) || rule.lookbackTaxYear >= request.taxYear) {
        fail("RULE_NOT_ADMITTED", "verified CMS rule with explicit historical lookback year and USD currency"); continue;
      }
      if (rule.monthlyConvention !== "whole_month_only") { fail("PRORATION_REQUIRED", "verified whole-month convention"); continue; }
      const overrides = request.overrides.filter(o => o.personId === e.personId && o.premiumTaxYear === request.taxYear && overlaps(o, calendar));
      refs = [...refs, ...overrides.flatMap(o => [o.determinationId, o.source.ruleSnapshotId])];
      if (overrides.length > 1) { fail("OVERRIDE_CONFLICT", "one nonconflicting qualified override per month"); continue; }
      const override = overrides[0];
      let income: HistoricalIncome | IrmaaOverride;
      if (override) {
        if (override.householdId !== request.householdId || !contains(override, calendar)
          || override.qualification !== "verified_legal_determination" || !["SSA", "CMS"].includes(override.authority)
          || !text(override.determinationId) || override.applicableRuleSnapshotId !== ruleId
          || !sourceValid(override.source, "irmaa_override", calendar)) {
          fail("OVERRIDE_NOT_ADMITTED", "dated verified SSA/CMS legally valid override for this annual rule"); continue;
        }
        income = override;
      } else {
        const histories = request.histories.filter(h => h.personId === e.personId && h.taxYear === rule.lookbackTaxYear);
        refs = [...refs, ...histories.flatMap(h => [h.taxReturnRef, h.source.ruleSnapshotId])];
        if (histories.length !== 1) { fail(histories.length ? "INCOME_CONFLICT" : "HISTORICAL_INCOME_REQUIRED", "one source-qualified return for the legal lookback year"); continue; }
        income = histories[0]!;
      }
      const incomeRef = "incomeReference" in income ? income.incomeReference : income.taxReturnRef;
      refs = [...refs, incomeRef, income.source.ruleSnapshotId, ...(override?.lifeEventRef ? [override.lifeEventRef] : [])];
      // Historical return windows refer to the historical tax year, not the premium year.
      if (income.householdId !== request.householdId || !text(income.filingStatus) || !text(income.maritalState)
        || !text(incomeRef) || !exactUsd(income.magi) || !yearValid(income.taxYear)
        || (override ? income.taxYear > request.taxYear : income.taxYear >= request.taxYear)
        || (!override && !sourceValid(income.source, "historical_tax_return", yearPeriod(income.taxYear)))) {
        fail("INCOME_NOT_ADMITTED", "exact USD MAGI and filing/marital state linked to a verified return or determination"); continue;
      }
      const tables = rule.tables.filter(t => t.filingStatus === income.filingStatus && t.maritalState === income.maritalState);
      if (tables.length !== 1 || !validTiers(tables[0]!.tiers)) { fail("TIER_TABLE_REQUIRED", "one complete exact-boundary CMS tier partition for the sourced filing/marital state"); continue; }
      const tier = tables[0]!.tiers.find(t => includesIncome(t, income.magi))!;
      row.surchargeCoverage = "complete";
      candidates.push({ operationId: JSON.stringify(["irmaa", request.householdId, e.personId, e.part, calendar.start]),
        kind: "uncommitted_irmaa_surcharge", contractVersion: "d2-shared/v1", personId: e.personId,
        householdId: e.householdId, coverageId: e.coverageId, planId: e.planId, part: e.part, taxYear: request.taxYear,
        incomeTaxYear: income.taxYear, legalLookbackTaxYear: rule.lookbackTaxYear, magi: income.magi, incomeReference: incomeRef,
        period: calendar, amountBasis: "monthly_surcharge_no_proration", monthlySurcharge: e.part === "part_b" ? tier.partBMonthly : tier.partDMonthly,
        tier, filingState: { filingStatus: income.filingStatus, maritalState: income.maritalState },
        determination: override ? "qualified_override" : "historical_return", determinationRef: override ? override.determinationId : incomeRef,
        ruleSnapshotId: ruleId, ruleSource: rule.source, incomeSource: income.source, traceRefs: [...new Set(refs)].sort(order) });
      fail("TOTAL_AND_SETTLEMENT_OWNER_PENDING", "#149 base-premium combination and single SSA-or-bank settlement");
    }
  }
  candidates.sort((a, b) => order(a.operationId, b.operationId));
  coverage.sort((a, b) => order(a.coverageId, b.coverageId) || order(a.personId, b.personId) || order(a.part, b.part)
    || order(a.period.start, b.period.start) || order(a.period.endExclusive, b.period.endExclusive));
  diagnostics.sort((a, b) => order(a.sourceEntityPath, b.sourceEntityPath) || order(a.period.start, b.period.start)
    || order(a.period.endExclusive, b.period.endExclusive) || order(a.diagnosticCode, b.diagnosticCode) || order(a.affectedOutput, b.affectedOutput));
  return freezeCopy({ contractVersion: "d2-shared/v1" as const, candidates, coverage, diagnostics,
    surchargeCoverage: coverage.some(c => c.surchargeCoverage === "incomplete") ? "incomplete" as const
      : coverage.some(c => c.surchargeCoverage === "complete") ? "complete" as const : "not_applicable" as const,
    medicareTotalCoverage: "incomplete" as const, netCashCoverage: "incomplete" as const });
}
