import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Money } from "../../../../values/index.js";

export interface EffectivePeriod {
  readonly start: CivilDate;
  readonly endExclusive: CivilDate;
}
/** Domain-local S2 fields; #149 owns the physical d2-shared/v1 adapter. */
export interface PremiumSource extends EffectivePeriod {
  readonly ruleSnapshotId: string;
  readonly jurisdiction: string;
  readonly ruleFamily: string;
  readonly sourcePublication: string;
  readonly asOf: CivilDate;
  readonly version: string;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export type MedicareElection = "part_a" | "part_b" | "part_d" | "advantage" | "medigap" | "supplement";
export type PremiumRoute =
  | { readonly kind: "aftertax_bank"; readonly payerId: string; readonly sourceAccountId: string; readonly evidence: PremiumSource }
  | { readonly kind: "pretax_payroll"; readonly payerId: string; readonly sponsorId: string; readonly employmentId: string; readonly evidence: PremiumSource }
  | { readonly kind: "ssa_benefit_deduction_pending"; readonly payerId: string; readonly benefitId: string; readonly evidence: PremiumSource };
export interface PremiumCoverage extends EffectivePeriod {
  readonly id: string;
  readonly householdId: string;
  readonly memberIds: readonly string[];
  readonly planId: string;
  readonly planFamily: "health_insurance" | "medicare";
  readonly sponsorId: string;
  readonly recipientId: string;
  readonly route: PremiumRoute;
  readonly eligibility: readonly {
    readonly memberId: string;
    readonly householdId: string;
    readonly planId: string;
    readonly eligible: boolean;
    readonly evidence: PremiumSource;
  }[];
  readonly medicare?: {
    readonly premiumFor: MedicareElection;
    readonly elected: readonly MedicareElection[];
    readonly enrollmentEvidence: PremiumSource;
    readonly compatibilityEvidence: PremiumSource;
  };
  readonly quote: {
    readonly quoteId: string;
    readonly source: PremiumSource;
    readonly gross: Money;
    readonly employer: Money;
    readonly member: Money;
    readonly schedule: {
      readonly anchor: CivilDate;
      readonly frequency: "monthly" | "annual";
      readonly interval: number;
      readonly invalidDay: "skip";
      readonly amountBasis: "per_occurrence_no_proration";
    };
  };
}
export interface PremiumRequest {
  readonly householdId: string;
  readonly memberIds: readonly string[];
  readonly period: EffectivePeriod;
  readonly coverages: readonly PremiumCoverage[];
  readonly coordination: readonly {
    readonly coverageIds: readonly string[];
    readonly memberId: string;
    readonly admitsDistinctPremiums: true;
    readonly evidence: PremiumSource;
  }[];
}
export interface PremiumDiagnostic {
  readonly diagnosticCode: string;
  readonly sourceEntityPath: string;
  readonly period: EffectivePeriod;
  readonly affectedOutput: "quoted_premium" | "medicare_total" | "net_cash" | "tax_effects";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
export interface PremiumProposal {
  readonly operationId: string;
  readonly kind: "uncommitted_quoted_premium";
  readonly contractVersion: "d2-shared/v1";
  readonly coverageId: string;
  readonly householdId: string;
  readonly memberIds: readonly string[];
  readonly planId: string;
  readonly sponsorId: string;
  readonly recipientId: string;
  readonly payerId: string;
  readonly effectiveAt: CivilDate;
  readonly taxYear: number;
  readonly grossAmount: Money;
  readonly employerAmount: Money;
  readonly memberAmount: Money;
  readonly expectedSettlementRoute: PremiumRoute;
  readonly quoteId: string;
  readonly source: PremiumSource;
  readonly medicare: PremiumCoverage["medicare"] | null;
  readonly coveragePeriod: EffectivePeriod;
  readonly eligibilityEvidence: PremiumCoverage["eligibility"];
  readonly coordinationEvidence: PremiumRequest["coordination"];
  readonly traceRefs: readonly string[];
}
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const validPeriod = (p: EffectivePeriod): void => {
  civilDate(p.start); civilDate(p.endExclusive);
  if (p.start >= p.endExclusive) throw new Error("Premium period must be nonempty and end-exclusive");
};
const overlaps = (a: EffectivePeriod, b: EffectivePeriod): boolean => a.start < b.endExclusive && b.start < a.endExclusive;
const intersect = (a: EffectivePeriod, b: EffectivePeriod): EffectivePeriod => ({
  start: a.start > b.start ? a.start : b.start,
  endExclusive: a.endExclusive < b.endExclusive ? a.endExclusive : b.endExclusive,
});
const admitted = (s: PremiumSource, p: EffectivePeriod): boolean => {
  validPeriod(s); civilDate(s.asOf);
  return [s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text)
    && ["verified", "explicit_projected"].includes(s.projectionStatus)
    && s.start <= p.start && s.endExclusive >= p.endExclusive;
};
const elections: readonly MedicareElection[] = ["part_a", "part_b", "part_d", "advantage", "medigap", "supplement"];
const incompatible = (p: readonly MedicareElection[]): boolean => p.includes("advantage") && p.includes("medigap");
const ordered = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Copy/freeze proposal data without freezing or retaining caller-owned containers. */
const snapshot = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || value instanceof Money) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(item => snapshot(item))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)]))) as T;
};

/** Pure source-quoted proposals: never posts cash, salary, taxes or benefit deductions. */
export function proposePremiums(request: PremiumRequest) {
  validPeriod(request.period);
  if (!text(request.householdId) || request.memberIds.length === 0 || !request.memberIds.every(text)
    || new Set(request.memberIds).size !== request.memberIds.length) throw new Error("Invalid household membership");
  const coverages = [...request.coverages].sort((a, b) => ordered(a.id, b.id));
  if (new Set(coverages.map(c => c.id)).size !== coverages.length) throw new Error("Duplicate coverage identity");
  const blocked = new Set<string>();
  const diagnostics: PremiumDiagnostic[] = [];
  const diagnose = (c: PremiumCoverage, code: string, output: PremiumDiagnostic["affectedOutput"], facts: readonly string[]) => {
    diagnostics.push({ diagnosticCode: code, sourceEntityPath: `coverages/${encodeURIComponent(c.id)}`,
      period: intersect(c, request.period), affectedOutput: output, coverage: "incomplete", missingFacts: facts,
      ruleSnapshotId: c.quote.source.ruleSnapshotId, traceRefs: [c.id, c.quote.quoteId] });
    if (output === "quoted_premium") blocked.add(c.id);
  };
  for (const c of coverages) {
    validPeriod(c);
    if (![c.id, c.planId, c.sponsorId, c.recipientId].every(text)) throw new Error("Missing coverage identity");
    const q = c.quote;
    const s = q.schedule;
    civilDate(s.anchor);
    if (!text(q.quoteId) || !Number.isSafeInteger(s.interval) || s.interval < 1 || !Number.isSafeInteger(s.interval * 12)
      || !["monthly", "annual"].includes(s.frequency) || s.invalidDay !== "skip"
      || s.amountBasis !== "per_occurrence_no_proration") throw new Error("Invalid quoted recurrence");
    if (![q.gross, q.employer, q.member].every(m => m instanceof Money && !m.isNegative()
      && m.amount.fitsScale(m.currency.minorUnitScale) && m.currency.equals(q.gross.currency))
      || !q.employer.plus(q.member).equals(q.gross)) throw new Error("Premium shares must reconcile exactly in one currency");
    if (!overlaps(c, request.period)) continue;
    const scope = intersect(c, request.period);
    if (!["health_insurance", "medicare"].includes(c.planFamily) || (c.planFamily === "medicare") !== !!c.medicare) {
      diagnose(c, "PLAN_CONFIGURATION_REQUIRED", "quoted_premium", ["legal plan family and explicit Medicare configuration"]);
    }
    if (c.householdId !== request.householdId || c.memberIds.length === 0 || new Set(c.memberIds).size !== c.memberIds.length
      || c.memberIds.some(id => !request.memberIds.includes(id) || !c.eligibility.some(e => e.memberId === id
        && e.householdId === c.householdId && e.planId === c.planId && e.eligible && admitted(e.evidence, scope)))) {
      diagnose(c, "MEMBERSHIP_NOT_ADMITTED", "quoted_premium", ["member/household/plan eligibility evidence"]);
    }
    if (!admitted(q.source, scope)) diagnose(c, "PREMIUM_QUOTE_UNAVAILABLE", "quoted_premium", ["dated quote covering requested effective period"]);
    const r = c.route;
    const routeKeys = r && Object.keys(r);
    const exclusiveRoute = r && routeKeys && routeKeys.every(key =>
      ["kind", "payerId", "evidence", ...(r.kind === "aftertax_bank" ? ["sourceAccountId"]
        : r.kind === "pretax_payroll" ? ["sponsorId", "employmentId"] : ["benefitId"])].includes(key));
    if (!r || !exclusiveRoute || !text(r.payerId) || !request.memberIds.includes(r.payerId)
      || !admitted(r.evidence, scope) || r.evidence.projectionStatus !== "verified"
      || !(r.kind === "aftertax_bank" ? text(r.sourceAccountId)
        : r.kind === "pretax_payroll" ? text(r.employmentId) && r.sponsorId === c.sponsorId && !c.medicare
          : r.kind === "ssa_benefit_deduction_pending" ? text(r.benefitId) && !!c.medicare : false)) {
      diagnose(c, "PAYER_ROUTE_NOT_ADMITTED", "quoted_premium", ["exclusive verified member payer and funding source"]);
    }
    if (c.medicare) {
      const m = c.medicare;
      if (c.memberIds.length !== 1 || !elections.includes(m.premiumFor) || !m.elected.includes(m.premiumFor)
        || m.elected.some(e => !elections.includes(e)) || new Set(m.elected).size !== m.elected.length
        || incompatible(m.elected) || !admitted(m.enrollmentEvidence, scope) || !admitted(m.compatibilityEvidence, scope)) {
        diagnose(c, "MEDICARE_ELECTION_NOT_ADMITTED", "quoted_premium", ["compatible enrolled person-specific Medicare elections"]);
      }
      diagnose(c, "IRMAA_OWNER_PENDING", "medicare_total", ["authoritative MAGI lookback", "filing status", "dated CMS snapshots", "qualified override when applicable", "C2/#149 IRMAA adjudication"]);
    }
    diagnose(c, "SETTLEMENT_OWNER_PENDING", "net_cash", ["#149 committed bank/payroll/SSA settlement", ...(c.medicare ? ["complete Medicare premium including applicable IRMAA"] : [])]);
    diagnose(c, "TAX_OWNER_PENDING", "tax_effects", ["#101/#149 wage bases and federal/state tax characterization"]);
  }
  for (let i = 0; i < coverages.length; i++) for (const b of coverages.slice(i + 1)) {
    const a = coverages[i]!;
    if (!overlaps(a, b) || !overlaps(intersect(a, b), request.period)) continue;
    const shared = a.memberIds.filter(id => b.memberIds.includes(id));
    const scope = intersect(intersect(a, b), request.period);
    if (shared.length === 0) continue;
    const duplicate = a.planId === b.planId && a.medicare?.premiumFor === b.medicare?.premiumFor;
    const invalidMedicare = a.medicare && b.medicare && incompatible([...a.medicare.elected, ...b.medicare.elected]);
    const coordinated = shared.every(id => request.coordination.some(f => f.memberId === id && f.coverageIds.includes(a.id)
      && f.coverageIds.includes(b.id) && f.admitsDistinctPremiums === true && admitted(f.evidence, scope)));
    if (duplicate || invalidMedicare || !coordinated) for (const c of [a, b]) diagnose(c,
      duplicate ? "DUPLICATE_PLAN_RECURRENCE" : invalidMedicare ? "INCOMPATIBLE_MEDICARE_PLANS" : "OVERLAP_COORDINATION_REQUIRED",
      "quoted_premium", ["distinct premium obligations and explicit overlap coordination"]);
  }
  const proposals: PremiumProposal[] = [];
  const coverage = coverages.filter(c => overlaps(c, request.period)).map(c => ({
    coverageId: c.id, householdId: c.householdId, planId: c.planId, memberIds: [...c.memberIds].sort(ordered),
    period: intersect(c, request.period), quotedPremiumCoverage: blocked.has(c.id) ? "incomplete" as const : "complete" as const,
    medicareTotalCoverage: c.medicare ? "incomplete" as const : "not_applicable" as const,
  }));
  for (const c of coverages) {
    if (blocked.has(c.id) || !overlaps(c, request.period)) continue;
    const scope = intersect(c, request.period);
    const s = c.quote.schedule;
    const [year, month, day] = s.anchor.split("-").map(Number) as [number, number, number];
    const step = s.interval * (s.frequency === "annual" ? 12 : 1);
    const firstMonth = year * 12 + month - 1;
    const [sy, sm] = scope.start.split("-").map(Number) as [number, number];
    const [ey, em] = scope.endExclusive.split("-").map(Number) as [number, number];
    const firstIndex = Math.max(0, Math.floor((sy * 12 + sm - 1 - firstMonth) / step));
    for (let index = firstIndex; firstMonth + index * step <= ey * 12 + em - 1; index++) {
      const offset = firstMonth + index * step;
      const y = Math.floor(offset / 12);
      const m = offset % 12 + 1;
      let at: CivilDate;
      try { at = civilDate(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`); }
      catch { continue; } // Explicit skip; never move missing anchor days or infer proration.
      if (at < scope.start || at >= scope.endExclusive || at < s.anchor) continue;
      proposals.push({ operationId: JSON.stringify(["premium", c.id, c.planId, at]), kind: "uncommitted_quoted_premium",
        contractVersion: "d2-shared/v1", coverageId: c.id, householdId: c.householdId,
        memberIds: [...c.memberIds].sort(ordered), planId: c.planId, sponsorId: c.sponsorId, recipientId: c.recipientId,
        payerId: c.route.payerId, effectiveAt: at, taxYear: y, grossAmount: c.quote.gross,
        employerAmount: c.quote.employer, memberAmount: c.quote.member, expectedSettlementRoute: c.route,
        quoteId: c.quote.quoteId, source: c.quote.source, medicare: c.medicare ?? null,
        coveragePeriod: { start: c.start, endExclusive: c.endExclusive }, eligibilityEvidence: c.eligibility,
        coordinationEvidence: request.coordination.filter(f => f.coverageIds.includes(c.id)),
        traceRefs: [...new Set([c.id, c.quote.quoteId, c.quote.source.ruleSnapshotId, c.route.evidence.ruleSnapshotId,
          ...c.eligibility.map(e => e.evidence.ruleSnapshotId),
          ...(c.medicare ? [c.medicare.enrollmentEvidence.ruleSnapshotId, c.medicare.compatibilityEvidence.ruleSnapshotId] : []),
          ...request.coordination.filter(f => f.coverageIds.includes(c.id)).map(f => f.evidence.ruleSnapshotId)])].sort(ordered) });
    }
  }
  proposals.sort((a, b) => ordered(a.effectiveAt, b.effectiveAt) || ordered(a.operationId, b.operationId));
  diagnostics.sort((a, b) => ordered(a.sourceEntityPath, b.sourceEntityPath) || ordered(a.diagnosticCode, b.diagnosticCode));
  // Deduplicate pairwise conflicts: bounded by coverage count, never by horizon days.
  const uniqueDiagnostics = diagnostics.filter((d, i) => i === 0 || d.sourceEntityPath !== diagnostics[i - 1]!.sourceEntityPath
    || d.diagnosticCode !== diagnostics[i - 1]!.diagnosticCode);
  return snapshot({ contractVersion: "d2-shared/v1" as const, proposals, coverage, diagnostics: uniqueDiagnostics,
    quotedPremiumCoverage: blocked.size ? "incomplete" as const : "complete" as const,
    netCashCoverage: "incomplete" as const, taxEffectsCoverage: "incomplete" as const });
}
