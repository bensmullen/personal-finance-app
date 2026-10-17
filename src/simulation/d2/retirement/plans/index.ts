import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Money, type Currency } from "../../../../values/index.js";

/** Private d2-shared/v1 domain types; #149 owns physical adapters/state. */
export type PlanFamily = "403b" | "governmental_457b" | "federal_tsp" | "sep_ira" | "simple_ira";
export type TaxBucket = "pretax" | "roth" | "non_roth_after_tax";
export type Payer = "employee" | "employer";
export interface PlanPeriod { readonly start: CivilDate; readonly endExclusive: CivilDate }
export interface PlanSource {
  readonly ruleSnapshotId: string;
  readonly jurisdiction: string;
  readonly ruleFamily: string;
  readonly sourcePublication: string;
  readonly asOf: CivilDate;
  readonly effectiveYear: number;
  readonly effectivePeriod: PlanPeriod;
  readonly version: string;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export type ScopeKind = "aggregate_deferral" | "governmental_457" | "simple_deferral" | "annual_additions" | "employer" | "compensation";
export interface LimitScope {
  readonly kind: ScopeKind;
  /** Person scopes use "person". Others use sourced legal aggregation identity
   * (e.g. controlled employer group), never an inferred plan alias. */
  readonly aggregationId: string;
}
export interface CapacityRef {
  readonly limitScope: LimitScope;
  /** Capacity authority version, independent of plan-document version. */
  readonly ruleSnapshotId: string;
}
export interface PriorCapacity extends CapacityRef {
  readonly personId: string;
  readonly taxYear: number;
  readonly source: PlanSource;
  readonly usageSource: PlanSource;
  readonly maximum: Money;
  readonly used: Money;
  /** Complete current-year consumption before asOf, including other employers
   * and 401(k) usage. Missing capacity is never an implicit zero. */
  readonly asOf: CivilDate;
  readonly completeness: "complete" | "unknown";
}
export interface ContributionPermission {
  readonly payer: Payer;
  readonly taxBucket: TaxBucket;
  readonly contributionType: "ordinary_deferral" | "employer_addition" | "employee_after_tax";
  readonly compensationTypes: readonly string[];
  /** Source attests ALL applicable legal scopes; family minimums also enforced. */
  readonly scopeCompleteness: "complete" | "unknown";
  readonly capacities: readonly CapacityRef[];
}
export interface PlanRules {
  readonly personId: string;
  readonly sponsorId: string;
  readonly planId: string;
  readonly family: PlanFamily;
  readonly source: PlanSource;
  readonly participation: "eligible" | "ineligible" | "unknown";
  readonly permissions: readonly ContributionPermission[];
}
export interface CompensationFact {
  readonly personId: string;
  readonly sponsorId: string;
  readonly taxYear: number;
  readonly type: string;
  readonly sourceAccountId: string;
  readonly source: PlanSource;
  readonly eligibleAmount: Money;
  /** Sourced cap after compensation ceilings/formulas. Cumulative consumption
   * must also be supplied as a compensation capacity, never calculated here. */
  readonly contributionCap: Money;
}
export interface ContributionRequest {
  readonly operationId: string;
  readonly personId: string;
  readonly sponsorId: string;
  readonly planId: string;
  readonly family: PlanFamily;
  readonly enrollment: PlanPeriod;
  readonly enrollmentSource: PlanSource;
  readonly destinationAccountId: string;
  readonly currency: Currency;
  readonly taxYear: number;
  readonly effectiveAt: CivilDate;
  readonly amount: Money;
  readonly payer: Payer;
  readonly taxBucket: TaxBucket;
  readonly contributionType: ContributionPermission["contributionType"] | "catch_up" | "rollover" | "distribution";
  readonly funding: {
    readonly kind: "payroll" | "employer";
    /** Stable payroll item or employer authorization, independent of request ID. */
    readonly sourceReferenceId: string;
    readonly sourceAccountId: string;
    readonly personId: string;
    readonly sponsorId: string;
    readonly source: PlanSource;
  };
  readonly compensation: CompensationFact;
  readonly rules?: PlanRules;
}
export interface CapacityProposal extends CapacityRef {
  readonly personId: string;
  readonly taxYear: number;
  readonly committed: false;
  readonly priorUsage: Money;
  readonly proposedIncrement: Money;
  readonly proposedUsage: Money;
  readonly proposedHeadroom: Money;
  readonly asOf: CivilDate;
  readonly operationIds: readonly string[];
  readonly traceRefs: readonly string[];
}
export type FundingIntent =
  | { readonly kind: "employee_payroll_intent"; readonly payrollSourceAccountId: string }
  | { readonly kind: "employer_owned_asset_intent"; readonly employerSourceAccountId: string };
export interface ContributionCandidate {
  readonly kind: "retirement_contribution_candidate";
  readonly committed: false;
  readonly operationId: string;
  readonly personId: string;
  readonly sponsorId: string;
  readonly planId: string;
  readonly family: PlanFamily;
  readonly destinationAccountId: string;
  readonly effectiveAt: CivilDate;
  readonly taxYear: number;
  readonly amount: Money;
  readonly payer: Payer;
  readonly taxBucket: TaxBucket;
  readonly contributionType: ContributionPermission["contributionType"];
  readonly fundingIntent: FundingIntent;
  readonly fundingSourceReferenceId: string;
  readonly compensationSourceAccountId: string;
  readonly taxCharacter: "employee_pretax_deferral" | "employee_roth_contribution" | "employee_after_tax_basis" | "employer_pretax_addition" | "employer_roth_addition";
  readonly capacityKeys: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
export interface PlanDiagnostic {
  readonly status: "incomplete" | "unsupported" | "invalid";
  readonly diagnosticCode: string;
  readonly operationId: string;
  readonly sourceEntityPath: string;
  readonly affectedAccountId: string;
  readonly period: PlanPeriod;
  readonly affectedOutput: "contribution_capacity";
  readonly coverage: "incomplete";
  readonly traceRefs: readonly string[];
  readonly ruleSnapshotId?: string;
  readonly limitScope?: LimitScope;
}
export interface PlanEvaluation {
  readonly contract: "d2-shared/v1";
  readonly committed: false;
  readonly candidates: readonly ContributionCandidate[];
  readonly capacityProposals: readonly CapacityProposal[];
  readonly diagnostics: readonly PlanDiagnostic[];
  readonly accountPeriods: readonly {
    readonly accountId: string;
    readonly period: PlanPeriod;
    readonly contributionCapacity: "complete" | "incomplete";
    readonly tax: "incomplete";
    readonly funding: "incomplete";
    readonly postings: "not_applicable";
  }[];
}

const families: readonly string[] = ["403b", "governmental_457b", "federal_tsp", "sep_ira", "simple_ira"];
const scopeKinds: readonly string[] = ["aggregate_deferral", "governmental_457", "simple_deferral", "annual_additions", "employer", "compensation"];
const personScopes: readonly ScopeKind[] = ["aggregate_deferral", "governmental_457", "simple_deferral"];
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
class Rejection extends Error {
  constructor(readonly status: PlanDiagnostic["status"], code: string) { super(code); }
}
interface StagedUsage { prior: PriorCapacity; increment: Money; operations: string[]; refs: Set<string> }
const need = (ok: boolean, code: string, status: PlanDiagnostic["status"] = "invalid"): void => {
  if (!ok) throw new Rejection(status, code);
};
const period = (p: PlanPeriod): void => {
  civilDate(p.start); civilDate(p.endExclusive); need(p.start < p.endExclusive, "INVALID_PERIOD");
};
const inside = (d: CivilDate, p: PlanPeriod): boolean => d >= p.start && d < p.endExclusive;
const exact = (m: Money, currency: Currency): void => {
  need(m.currency.equals(currency), "CURRENCY_MISMATCH");
  need(!m.isNegative() && m.amount.fitsScale(currency.minorUnitScale), "INVALID_EXACT_MONEY");
};
const qualify = (s: PlanSource, year: number, at: CivilDate, knownAt: CivilDate): void => {
  need(Boolean(s), "MISSING_SOURCE", "incomplete");
  need([s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text), "MISSING_SOURCE_IDENTITY", "incomplete");
  civilDate(s.asOf); period(s.effectivePeriod);
  need(s.effectiveYear === year && inside(at, s.effectivePeriod), "UNCOVERED_RULE_YEAR_OR_DATE", "incomplete");
  need(s.projectionStatus === "verified" && s.asOf <= knownAt, "UNVERIFIED_OR_FUTURE_RULE", "incomplete");
};
const scopeIdentity = (s: LimitScope): string => JSON.stringify([s.kind, s.aggregationId]);
/** Stable S5 person + taxYear + limitScope + capacity version key. */
export const capacityKey = (personId: string, taxYear: number, ref: CapacityRef): string =>
  JSON.stringify([personId, taxYear, ref.limitScope.kind, ref.limitScope.aggregationId, ref.ruleSnapshotId]);
const legalKey = (personId: string, taxYear: number, ref: CapacityRef): string =>
  JSON.stringify([personId, taxYear, scopeIdentity(ref.limitScope)]);
const requiredScopes = (r: ContributionRequest): readonly ScopeKind[] => {
  const kinds: ScopeKind[] = ["compensation"];
  if (r.family === "governmental_457b") kinds.push("governmental_457");
  if (["403b", "federal_tsp", "sep_ira"].includes(r.family)) kinds.push("annual_additions");
  if (r.payer === "employer") kinds.push("employer");
  if (r.payer === "employee" && r.contributionType === "ordinary_deferral" && r.family !== "governmental_457b") kinds.push("aggregate_deferral");
  if (r.family === "simple_ira" && r.payer === "employee") kinds.push("simple_deferral");
  return kinds;
};

/** All-or-none batch: no input ordering assigns economic precedence. Caller
 * supplies complete prior usage and observed committed IDs. Identical replay
 * against unchanged facts is identical; observed-ID replay fails. No law catalog,
 * payroll calculation, funding, tax settlement or shared-state mutation. */
export function evaluatePlanContributions(input: {
  readonly asOf: CivilDate;
  readonly period: PlanPeriod;
  readonly requests: readonly ContributionRequest[];
  readonly priorCapacities: readonly PriorCapacity[];
  readonly observedOperationIds: readonly string[];
}): PlanEvaluation {
  period(input.period); civilDate(input.asOf);
  need(input.requests.length <= 256 && input.priorCapacities.length <= 2048 && input.observedOperationIds.length <= 10000, "REQUEST_LIMIT");
  const requests = [...input.requests].sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0);
  const diagnostics: PlanDiagnostic[] = [], candidates: ContributionCandidate[] = [];
  const usage = new Map<string, StagedUsage>();
  const diagnose = (r: ContributionRequest, status: PlanDiagnostic["status"], code: string, capacity?: PriorCapacity): void => {
    diagnostics.push({ status, diagnosticCode: code, operationId: r.operationId,
      sourceEntityPath: JSON.stringify(["plans", r.planId, "operations", r.operationId]), affectedAccountId: r.destinationAccountId,
      period: { ...input.period }, affectedOutput: "contribution_capacity", coverage: "incomplete",
      ...(capacity ? { ruleSnapshotId: capacity.ruleSnapshotId, limitScope: { ...capacity.limitScope } } :
        r.rules?.source?.ruleSnapshotId ? { ruleSnapshotId: r.rules.source.ruleSnapshotId } : {}),
      traceRefs: [...new Set([r.rules?.source?.ruleSnapshotId, r.funding?.source?.ruleSnapshotId,
        r.compensation?.source?.ruleSnapshotId, r.enrollmentSource?.ruleSnapshotId,
        capacity?.source.ruleSnapshotId, capacity?.usageSource.ruleSnapshotId].filter((s): s is string => Boolean(s)))].sort() });
  };
  for (const r of requests) {
    try {
      need([r.operationId, r.personId, r.sponsorId, r.planId, r.destinationAccountId].every(text), "INVALID_IDENTITY");
      need(!requests.some(x => x.planId === r.planId && (x.sponsorId !== r.sponsorId || x.family !== r.family)), "PLAN_IDENTITY_CONFLICT");
      need(!requests.some(x => x.destinationAccountId === r.destinationAccountId && (x.personId !== r.personId || x.planId !== r.planId)), "ACCOUNT_IDENTITY_CONFLICT");
      need(requests.filter(x => x.operationId === r.operationId).length === 1 && !input.observedOperationIds.includes(r.operationId), "DUPLICATE_OPERATION");
      need(!requests.some(x => x !== r && x.personId === r.personId && x.planId === r.planId && x.sponsorId === r.sponsorId &&
        x.payer === r.payer && x.taxBucket === r.taxBucket && x.contributionType === r.contributionType &&
        x.funding?.sourceReferenceId === r.funding?.sourceReferenceId), "REPEATED_SOURCE_REQUEST");
      need(families.includes(r.family), "UNSUPPORTED_PLAN_FAMILY", "unsupported");
      need(["ordinary_deferral", "employer_addition", "employee_after_tax"].includes(r.contributionType), "UNSUPPORTED_CONTRIBUTION_TYPE", "unsupported");
      civilDate(r.effectiveAt); period(r.enrollment);
      need(Number.isSafeInteger(r.taxYear) && r.taxYear === Number(r.effectiveAt.slice(0, 4)), "PRIOR_OR_WRONG_TAX_YEAR");
      need(inside(r.effectiveAt, input.period) && r.effectiveAt >= input.asOf, "OUTSIDE_EVALUATION_PERIOD");
      need(inside(r.effectiveAt, r.enrollment), "OUTSIDE_ENROLLMENT");
      exact(r.amount, r.currency); need(r.amount.isPositive(), "NONPOSITIVE_CONTRIBUTION");
      qualify(r.enrollmentSource, r.taxYear, r.effectiveAt, input.asOf);
      need(r.payer === "employee" || r.payer === "employer", "INVALID_PAYER");
      need(r.payer === "employee" ? r.contributionType !== "employer_addition" : r.contributionType === "employer_addition", "PAYER_CONTRIBUTION_MISMATCH");
      need(r.family !== "sep_ira" || r.payer === "employer", "UNSUPPORTED_SALARY_REDUCTION_SEP", "unsupported");
      need(r.contributionType === "employee_after_tax" ? r.taxBucket === "non_roth_after_tax" : ["pretax", "roth"].includes(r.taxBucket), "BUCKET_CONTRIBUTION_MISMATCH");
      need(r.taxBucket !== "non_roth_after_tax" || r.family === "403b", "UNSUPPORTED_AFTER_TAX_FAMILY", "unsupported");
      const f = r.funding, c = r.compensation;
      qualify(f.source, r.taxYear, r.effectiveAt, input.asOf); qualify(c.source, r.taxYear, r.effectiveAt, input.asOf);
      need(f.kind === (r.payer === "employee" ? "payroll" : "employer") && text(f.sourceReferenceId) && text(f.sourceAccountId) && f.sourceAccountId !== r.destinationAccountId && f.personId === r.personId && f.sponsorId === r.sponsorId, "FUNDING_IDENTITY_MISMATCH");
      need(c.personId === r.personId && c.sponsorId === r.sponsorId && c.taxYear === r.taxYear && text(c.sourceAccountId), "COMPENSATION_IDENTITY_MISMATCH");
      need(r.payer !== "employee" || c.sourceAccountId === f.sourceAccountId, "COMPENSATION_SOURCE_MISMATCH");
      exact(c.eligibleAmount, r.currency); exact(c.contributionCap, r.currency);
      need(c.contributionCap.compare(c.eligibleAmount) <= 0 && r.amount.compare(c.contributionCap) <= 0, "COMPENSATION_CAP_EXCEEDED");
      const rules = r.rules;
      need(Boolean(rules), "MISSING_PLAN_RULE", "incomplete"); if (!rules) continue;
      qualify(rules.source, r.taxYear, r.effectiveAt, input.asOf);
      need([f.source, c.source, r.enrollmentSource].every(s => s.jurisdiction === rules.source.jurisdiction), "SOURCE_JURISDICTION_MISMATCH");
      need(rules.personId === r.personId && rules.sponsorId === r.sponsorId && rules.planId === r.planId && rules.family === r.family, "RULE_PLAN_IDENTITY_MISMATCH");
      need(rules.permissions.length <= 64, "EXCESSIVE_PERMISSIONS");
      need(rules.participation === "eligible", "PARTICIPATION_NOT_ELIGIBLE", rules.participation === "unknown" ? "incomplete" : "invalid");
      const permissions = rules.permissions.filter(p => p.payer === r.payer && p.taxBucket === r.taxBucket && p.contributionType === r.contributionType);
      need(permissions.length === 1, "MISSING_OR_AMBIGUOUS_PERMISSION", "incomplete");
      const permission = permissions[0]!;
      need(permission.compensationTypes.includes(c.type), "INELIGIBLE_COMPENSATION_TYPE");
      need(permission.scopeCompleteness === "complete", "UNKNOWN_LEGAL_SCOPES", "incomplete");
      need(requiredScopes(r).every(k => permission.capacities.some(ref => ref.limitScope.kind === k)), "MISSING_LEGAL_SCOPE", "incomplete");
      need(permission.capacities.length <= 32 && new Set(permission.capacities.map(ref => scopeIdentity(ref.limitScope))).size === permission.capacities.length, "DUPLICATE_OR_EXCESSIVE_SCOPE");
      const resolved = permission.capacities.map(ref => {
        need(scopeKinds.includes(ref.limitScope.kind) && text(ref.limitScope.aggregationId) && text(ref.ruleSnapshotId), "INVALID_LIMIT_SCOPE");
        need(!personScopes.includes(ref.limitScope.kind) || ref.limitScope.aggregationId === "person", "HIDDEN_PERSON_CAPACITY");
        const matches = input.priorCapacities.filter(p => legalKey(p.personId, p.taxYear, p) === legalKey(r.personId, r.taxYear, ref));
        need(matches.length === 1, "MISSING_OR_AMBIGUOUS_PRIOR_CAPACITY", "incomplete");
        const p = matches[0]!;
        need(p.ruleSnapshotId === ref.ruleSnapshotId && p.source.ruleSnapshotId === ref.ruleSnapshotId, "CAPACITY_VERSION_MISMATCH", "incomplete");
        qualify(p.source, r.taxYear, r.effectiveAt, input.asOf);
        qualify(p.usageSource, r.taxYear, r.effectiveAt, input.asOf); civilDate(p.asOf);
        need(p.source.jurisdiction === rules.source.jurisdiction && p.usageSource.jurisdiction === rules.source.jurisdiction, "SOURCE_JURISDICTION_MISMATCH");
        need(p.completeness === "complete" && p.asOf === input.asOf, "INCOMPLETE_OR_STALE_PRIOR_USAGE", "incomplete");
        exact(p.maximum, r.currency); exact(p.used, r.currency);
        need(p.used.compare(p.maximum) <= 0, "INVALID_PRIOR_USAGE");
        if (ref.limitScope.kind === "compensation") need(p.maximum.compare(c.contributionCap) <= 0, "UNQUALIFIED_COMPENSATION_CAP");
        return p;
      });
      const refs = [rules.source.ruleSnapshotId, f.source.ruleSnapshotId, c.source.ruleSnapshotId, r.enrollmentSource.ruleSnapshotId];
      // Stage only after all scopes resolve. Nothing escapes a failed batch.
      for (const p of resolved) {
        const key = capacityKey(r.personId, r.taxYear, p);
        const staged: StagedUsage = usage.get(key) ?? { prior: p, increment: Money.zero(r.currency), operations: [], refs: new Set<string>() };
        staged.increment = staged.increment.plus(r.amount); staged.operations.push(r.operationId);
        for (const id of [...refs, p.source.ruleSnapshotId, p.usageSource.ruleSnapshotId]) staged.refs.add(id);
        usage.set(key, staged);
      }
      candidates.push({ kind: "retirement_contribution_candidate", committed: false, operationId: r.operationId,
        personId: r.personId, sponsorId: r.sponsorId, planId: r.planId, family: r.family, destinationAccountId: r.destinationAccountId,
        effectiveAt: r.effectiveAt, taxYear: r.taxYear, amount: r.amount, payer: r.payer, taxBucket: r.taxBucket,
        contributionType: permission.contributionType,
        fundingSourceReferenceId: f.sourceReferenceId, compensationSourceAccountId: c.sourceAccountId,
        fundingIntent: r.payer === "employee" ? { kind: "employee_payroll_intent", payrollSourceAccountId: f.sourceAccountId } : { kind: "employer_owned_asset_intent", employerSourceAccountId: f.sourceAccountId },
        taxCharacter: r.payer === "employee" ? r.taxBucket === "pretax" ? "employee_pretax_deferral" : r.taxBucket === "roth" ? "employee_roth_contribution" : "employee_after_tax_basis" : r.taxBucket === "roth" ? "employer_roth_addition" : "employer_pretax_addition",
        capacityKeys: resolved.map(p => capacityKey(r.personId, r.taxYear, p)).sort(), ruleSnapshotId: rules.source.ruleSnapshotId,
        traceRefs: [...new Set([...refs, ...resolved.flatMap(p => [p.source.ruleSnapshotId, p.usageSource.ruleSnapshotId])])].sort() });
    } catch (error) {
      diagnose(r, error instanceof Rejection ? error.status : "invalid", error instanceof Rejection ? error.message : "MALFORMED_CONTRIBUTION_FACT");
    }
  }
  for (const u of usage.values()) if (u.prior.used.plus(u.increment).compare(u.prior.maximum) > 0) {
    for (const r of requests) if (u.operations.includes(r.operationId)) diagnose(r, "invalid", "CAPACITY_EXCEEDED", u.prior);
  }
  const failed = diagnostics.length > 0;
  if (failed) for (const r of requests) if (!diagnostics.some(d => d.operationId === r.operationId)) diagnose(r, "incomplete", "ATOMIC_BATCH_REJECTED");
  const capacityProposals: CapacityProposal[] = failed ? [] : [...usage.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, u]) => ({
    personId: u.prior.personId, taxYear: u.prior.taxYear, limitScope: { ...u.prior.limitScope }, ruleSnapshotId: u.prior.ruleSnapshotId,
    committed: false, priorUsage: u.prior.used, proposedIncrement: u.increment, proposedUsage: u.prior.used.plus(u.increment),
    proposedHeadroom: u.prior.maximum.minus(u.prior.used.plus(u.increment)), asOf: input.asOf, operationIds: [...u.operations].sort(), traceRefs: [...u.refs].sort(),
  }));
  return { contract: "d2-shared/v1", committed: false, candidates: failed ? [] : candidates, capacityProposals,
    diagnostics: diagnostics.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0),
    accountPeriods: [...new Set(requests.map(r => r.destinationAccountId))].sort().map(accountId => ({ accountId, period: { ...input.period },
      contributionCapacity: failed ? "incomplete" : "complete", tax: "incomplete", funding: "incomplete", postings: "not_applicable" })) };
}
