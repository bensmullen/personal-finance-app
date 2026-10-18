import { civilDate, type CivilDate } from "../../../../time/index.js";
import { decimal, Money, RoundingPolicy, type Currency, type DecimalAmount, type RoundingMode } from "../../../../values/index.js";

export interface RmdSource {
  readonly id: string;
  readonly publication: string;
  readonly publishedAt: CivilDate;
  readonly asOf: CivilDate;
  readonly effectiveFrom: CivilDate;
  readonly effectiveUntil: CivilDate;
  readonly version: string;
  readonly status: "verified" | "projected" | "unavailable";
  readonly personId: string;
  readonly accountId: string | null;
}
export type RmdFamily = "traditional_ira" | "sep_ira" | "simple_ira" | "workplace_plan" | "roth_ira";
export interface RmdAccount {
  readonly id: string;
  readonly ownerId: string;
  readonly beneficiaryId: string | null;
  readonly family: RmdFamily;
  readonly bucket: string;
  readonly source: RmdSource;
  readonly priorValue?: { readonly at: CivilDate; readonly amount: Money; readonly source: RmdSource };
  readonly planTerms?: { readonly rmdMethod: "owner_balance_divisor"; readonly ruleSnapshotId: string; readonly source: RmdSource };
}
export interface RmdRule {
  readonly snapshotId: string;
  readonly jurisdiction: string;
  readonly source: RmdSource;
  readonly family: RmdFamily;
  readonly bucket: string;
  readonly model: "owner_balance_divisor" | "lifetime_roth_exempt" | "unsupported";
  readonly bornFrom: CivilDate;
  readonly bornUntil: CivilDate;
  readonly startAge: number;
  readonly ageConvention: "age_at_year_end";
  readonly rounding: RoundingMode;
  readonly aggregationCalculation: "sum_account_rounded_amounts";
  readonly factors: readonly { readonly ruleSnapshotId: string; readonly age: number; readonly beneficiaryStatus: string; readonly spouseId: string | null; readonly spouseBirthDate: CivilDate | null; readonly divisor: string; readonly source: RmdSource }[];
  readonly originalDue: CivilDate;
  readonly deferredDue: CivilDate | null;
  readonly earliestSatisfaction: CivilDate;
  readonly stillWorkingException: "verified_plan_eligibility" | "not_permitted";
}
export interface RmdRequest {
  readonly personId: string;
  readonly birthDate: CivilDate;
  readonly personSource: RmdSource;
  readonly taxYear: number;
  readonly accounts: readonly RmdAccount[];
  readonly rule?: RmdRule;
  readonly beneficiary: { readonly status: "owner_no_spouse" | "owner_spouse" | "inherited" | "unknown"; readonly spouseId: string | null; readonly spouseBirthDate: CivilDate | null; readonly source: RmdSource };
  readonly election: "original" | "defer" | "undecided";
  readonly electionSource: RmdSource;
  readonly stillWorking: { readonly employed: boolean | null; readonly ownershipEligible: boolean | null; readonly source: RmdSource } | null;
  readonly aggregation: { readonly id: string; readonly ruleSnapshotId: string; readonly accountIds: readonly string[]; readonly permission: "ira_cross_account"; readonly source: RmdSource } | null;
}
export interface RmdDistribution {
  readonly transactionId: string;
  readonly personId: string;
  readonly payerOwnerId: string;
  readonly accountId: string;
  readonly at: CivilDate;
  readonly gross: Money;
  readonly kind: "ordinary" | "rmd" | "rollover" | "conversion" | "qcd" | "inherited" | "other";
  readonly funding: "posted_funded" | "unfunded" | "proposed";
  readonly authorized: boolean;
  readonly usageRegister: "verified_complete" | "unknown";
  readonly source: RmdSource;
  /** Exhaustive historical usage plus proposed allocations; same gross cap. */
  readonly allocations: readonly { readonly id: string; readonly obligationId: string; readonly satisfiesRmdYear: number; readonly amount: Money; readonly historical: boolean }[];
}
export interface RmdInput {
  readonly currency: Currency;
  readonly asOf: CivilDate;
  readonly knownAt: CivilDate;
  readonly requests: readonly RmdRequest[];
  readonly distributions: readonly RmdDistribution[];
}
export type RmdCode = "invalid" | "unsupported" | "missing_prior_balance" | "law" | "beneficiary" | "deadline" | "authorization" | "funding";
export interface RmdDiagnostic {
  readonly seam: "S7";
  readonly personId: string;
  readonly taxYear: number;
  readonly accountIds: readonly string[];
  readonly diagnosticCode: RmdCode;
  readonly sourceEntityPath: string;
  readonly period: { readonly start: CivilDate; readonly endExclusive: CivilDate };
  readonly affectedOutput: "rmd_obligation" | "rmd_satisfaction";
  readonly coverage: "incomplete" | "not_applicable";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface RmdObligation {
  readonly seam: "S3/S5";
  readonly committed: false;
  readonly postable: false;
  readonly id: string;
  readonly personId: string;
  readonly taxYear: number;
  readonly accountIds: readonly string[];
  readonly ruleSnapshotId: string;
  readonly required: Money;
  readonly components: readonly { readonly accountId: string; readonly priorValue: Money; readonly divisor: string; readonly required: Money }[];
  readonly rounding: RoundingMode;
  readonly originalDue: CivilDate;
  readonly permissibleDeferredDue: CivilDate | null;
  readonly due: CivilDate;
  readonly earliestSatisfaction: CivilDate;
  readonly satisfied: Money;
  readonly satisfiedOnTime: Money;
  readonly satisfiedLate: Money;
  /** Retained even after late payments clear the current remaining amount. */
  readonly deadlineShortfall: Money;
  readonly remaining: Money;
  readonly overdue: boolean;
  readonly allocations: readonly { readonly transactionId: string; readonly allocationId: string; readonly amount: Money; readonly late: boolean; readonly historical: boolean }[];
  readonly traceRefs: readonly string[];
}
export interface RmdEvaluation {
  readonly contract: "d2-shared/v1";
  readonly committed: false;
  readonly obligations: readonly RmdObligation[];
  readonly intents: readonly { readonly seam: "S3/S6"; readonly committed: false; readonly postable: false; readonly obligationId: string; readonly kind: "needed_withdrawal"; readonly grossNeeded: Money; readonly incomeCharacter: "unresolved_retirement_distribution"; readonly completeness: "incomplete" }[];
  readonly diagnostics: readonly RmdDiagnostic[];
  readonly tax: "incomplete";
  readonly bankSettlement: "incomplete";
  readonly funding: "incomplete";
}
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const ira = (f: RmdFamily): boolean => ["traditional_ira", "sep_ira", "simple_ira"].includes(f);
export const rmdObligationId = (r: RmdRequest): string => JSON.stringify([r.personId, r.taxYear,
  r.aggregation ? ["group", r.aggregation.id] : ["account", r.accounts[0]?.id], r.rule?.snapshotId]);
class Missing extends Error { constructor(readonly code: RmdCode, readonly path: string) { super(path); } }

/** Pure replacement proposals; no ledger, funding, withdrawal or tax executor. */
export function evaluateRmdObligations(input: RmdInput): RmdEvaluation {
  const diagnostics: RmdDiagnostic[] = [], obligations: RmdObligation[] = [];
  const need = (ok: boolean, code: RmdCode, path: string): void => { if (!ok) throw new Missing(code, path); };
  const date = (d: CivilDate): void => { try { civilDate(d); } catch { throw new Missing("invalid", "date"); } };
  const exact = (m: Money): void => need(m.currency.equals(input.currency) && !m.isNegative() && m.amount.fitsScale(input.currency.minorUnitScale), "invalid", "exact_money");
  const stamp = (s: RmdSource, person: string, account: string | null, at: CivilDate, code: RmdCode): void => {
    [s.publishedAt, s.asOf, s.effectiveFrom, s.effectiveUntil].forEach(date);
    need([s.id, s.publication, s.version].every(text) && s.personId === person && s.accountId === account && s.status === "verified" &&
      s.publishedAt <= input.knownAt && s.publishedAt <= input.asOf && s.asOf <= input.asOf && s.asOf <= input.knownAt &&
      s.effectiveFrom <= at && at < s.effectiveUntil, code, "source");
  };
  const diagnostic = (r: RmdRequest, e: Missing, output: RmdDiagnostic["affectedOutput"] = "rmd_obligation", coverage: RmdDiagnostic["coverage"] = "incomplete"): void => {
    diagnostics.push({ seam: "S7", personId: r.personId, taxYear: r.taxYear, accountIds: r.accounts.map(a => a.id).sort(cmp), diagnosticCode: e.code,
      sourceEntityPath: e.path, period: { start: `${r.taxYear}-01-01` as CivilDate, endExclusive: `${r.taxYear + 1}-01-01` as CivilDate }, affectedOutput: output,
      coverage, missingFacts: coverage === "not_applicable" ? [] : [e.path], ruleSnapshotId: r.rule?.snapshotId ?? null,
      traceRefs: [...new Set([r.personSource.id, r.beneficiary.source.id, r.electionSource.id,
        ...(r.rule ? [r.rule.source.id, ...r.rule.factors.map(f => f.source.id)] : []),
        ...r.accounts.flatMap(a => [a.source.id, ...(a.priorValue ? [a.priorValue.source.id] : []), ...(a.planTerms ? [a.planTerms.source.id] : [])]),
        ...(r.aggregation ? [r.aggregation.source.id] : []), ...(r.stillWorking ? [r.stillWorking.source.id] : []),
        ...(output === "rmd_satisfaction" ? input.distributions.map(d => d.source.id) : [])])].sort(cmp) });
  };
  const requests = [...input.requests].sort((a, b) => cmp(rmdObligationId(a), rmdObligationId(b)));
  for (const [index, r] of requests.entries()) {
    try {
      date(input.asOf); date(input.knownAt); date(r.birthDate);
      need(input.asOf <= input.knownAt && text(r.personId) && Number.isSafeInteger(r.taxYear) && r.taxYear >= 1001 && r.taxYear < 9998, "invalid", "context");
      const start = civilDate(`${r.taxYear}-01-01`), end = civilDate(`${r.taxYear + 1}-01-01`), prior = civilDate(`${r.taxYear - 1}-12-31`);
      need(r.birthDate < end, "invalid", "birthDate"); stamp(r.personSource, r.personId, null, start, "invalid");
      need(r.accounts.length > 0 && new Set(r.accounts.map(a => a.id)).size === r.accounts.length, "invalid", "accounts");
      need(!requests.some((other, i) => i !== index && other.taxYear === r.taxYear &&
        (rmdObligationId(other) === rmdObligationId(r) || other.accounts.some(a => r.accounts.some(b => a.id === b.id)))), "invalid", "overlapping_obligations");
      const rule = r.rule;
      if (!rule) throw new Missing("law", "effective_rule");
      need(text(rule.snapshotId) && text(rule.jurisdiction) && text(rule.bucket), "law", "rule_identity");
      stamp(rule.source, r.personId, null, start, "law");
      need(rule.source.effectiveUntil >= end && rule.ageConvention === "age_at_year_end" && rule.aggregationCalculation === "sum_account_rounded_amounts" &&
        ["half_even", "half_up", "toward_zero"].includes(rule.rounding), "law", "rule_period_or_convention");
      stamp(r.beneficiary.source, r.personId, null, start, "beneficiary");
      need(r.beneficiary.source.effectiveUntil >= end, "beneficiary", "annual_beneficiary_context");
      need(r.beneficiary.status === "owner_no_spouse" || r.beneficiary.status === "owner_spouse", "beneficiary", "unsupported_or_missing_beneficiary_method");
      if (r.beneficiary.status === "owner_spouse") {
        need(text(r.beneficiary.spouseId ?? "") && r.beneficiary.spouseBirthDate !== null, "beneficiary", "spouse_facts"); date(r.beneficiary.spouseBirthDate!);
      } else need(r.beneficiary.spouseId === null && r.beneficiary.spouseBirthDate === null, "beneficiary", "conflicting_spouse_facts");
      for (const a of r.accounts) {
        need(text(a.id) && a.ownerId === r.personId && a.bucket === rule.bucket, "invalid", "account_identity_bucket");
        need(a.beneficiaryId === null, "beneficiary", "inherited_account_method");
        stamp(a.source, r.personId, a.id, start, "invalid");
        need(a.family === rule.family || (r.aggregation !== null && ira(a.family) && ira(rule.family)), "unsupported", "account_family");
        if (a.family === "workplace_plan") {
          need(a.planTerms?.rmdMethod === "owner_balance_divisor" && a.planTerms.ruleSnapshotId === rule.snapshotId, "law", "separately_sourced_plan_terms");
          stamp(a.planTerms!.source, r.personId, a.id, start, "law");
          need(a.planTerms!.source.effectiveUntil >= end, "law", "plan_terms_period");
        }
      }
      if (r.aggregation) {
        const g = r.aggregation; stamp(g.source, r.personId, null, start, "law");
        need(text(g.id) && g.ruleSnapshotId === rule.snapshotId && g.source.effectiveUntil >= end && g.permission === "ira_cross_account" && r.accounts.every(a => ira(a.family)) && new Set(g.accountIds).size === g.accountIds.length &&
          g.accountIds.length === r.accounts.length && r.accounts.every(a => g.accountIds.includes(a.id)), "law", "legal_aggregation_group");
      } else need(r.accounts.length === 1, "law", "aggregation_permission");
      if (rule.model === "lifetime_roth_exempt") {
        need(r.accounts.every(a => a.family === "roth_ira"), "law", "roth_exception_family");
        diagnostic(r, new Missing("law", "sourced_lifetime_roth_exemption"), "rmd_obligation", "not_applicable"); continue;
      }
      need(rule.model === "owner_balance_divisor" && r.accounts.every(a => a.family !== "roth_ira"), "unsupported", "rmd_method");
      date(rule.bornFrom); date(rule.bornUntil);
      need(r.birthDate >= rule.bornFrom && r.birthDate < rule.bornUntil && Number.isSafeInteger(rule.startAge) && rule.startAge > 0, "law", "birth_cohort");
      const age = r.taxYear - Number(r.birthDate.slice(0, 4));
      if (age < rule.startAge) { diagnostic(r, new Missing("law", "before_sourced_start_age"), "rmd_obligation", "not_applicable"); continue; }
      if (rule.stillWorkingException === "verified_plan_eligibility") {
        need(r.accounts.every(a => a.family === "workplace_plan") && r.stillWorking !== null, "law", "still_working_eligibility");
        const work = r.stillWorking!; stamp(work.source, r.personId, null, start, "law");
        need(work.source.effectiveUntil >= end && work.employed !== null && work.ownershipEligible !== null, "law", "still_working_ownership");
        if (work.employed && work.ownershipEligible) { diagnostic(r, new Missing("law", "sourced_still_working_exemption"), "rmd_obligation", "not_applicable"); continue; }
      } else need(rule.stillWorkingException === "not_permitted", "law", "still_working_rule");
      date(rule.originalDue); date(rule.earliestSatisfaction);
      need(rule.originalDue >= start && rule.originalDue < end && rule.earliestSatisfaction >= start && rule.earliestSatisfaction <= rule.originalDue, "deadline", "original_deadline_or_window");
      if (rule.deferredDue !== null) { date(rule.deferredDue); need(rule.deferredDue >= end && rule.deferredDue < `${r.taxYear + 2}-01-01`, "deadline", "deferred_deadline"); }
      stamp(r.electionSource, r.personId, null, start, "deadline");
      need(r.election === "original" || (age === rule.startAge && r.election === "defer" && rule.deferredDue !== null), "deadline", "first_year_election");
      const factors = rule.factors.filter(f => f.age === age && f.beneficiaryStatus === r.beneficiary.status &&
        f.spouseId === r.beneficiary.spouseId && f.spouseBirthDate === r.beneficiary.spouseBirthDate);
      need(factors.length === 1, "law", "unique_sourced_factor"); const factor = factors[0]!;
      need(factor.ruleSnapshotId === rule.snapshotId, "law", "factor_rule_snapshot");
      stamp(factor.source, r.personId, null, start, "law");
      need(factor.source.effectiveUntil >= end, "law", "annual_factor_period");
      let divisor: DecimalAmount; try { divisor = decimal(factor.divisor); } catch { throw new Missing("invalid", "factor"); }
      need(divisor.isPositive(), "invalid", "factor");
      const components = [...r.accounts].sort((a, b) => cmp(a.id, b.id)).map(a => {
        const v = a.priorValue; if (!v) throw new Missing("missing_prior_balance", `accounts.${a.id}.priorValue`);
        exact(v.amount); date(v.at); stamp(v.source, r.personId, a.id, prior, "missing_prior_balance");
        need(v.at === prior && v.source.asOf >= prior, "missing_prior_balance", "prior_year_december31");
        return { accountId: a.id, priorValue: v.amount, divisor: factor.divisor,
          required: new Money(v.amount.amount.dividedBy(divisor, new RoundingPolicy(input.currency.minorUnitScale, rule.rounding)), input.currency) };
      });
      const required = components.reduce((s, c) => s.plus(c.required), Money.zero(input.currency)), due = r.election === "defer" ? rule.deferredDue! : rule.originalDue;
      const refs = [r.personSource, rule.source, factor.source, r.beneficiary.source, r.electionSource, ...r.accounts.flatMap(a => [a.source, a.priorValue!.source, ...(a.planTerms ? [a.planTerms.source] : [])]),
        ...(r.aggregation ? [r.aggregation.source] : []), ...(r.stillWorking ? [r.stillWorking.source] : [])];
      obligations.push({ seam: "S3/S5", committed: false, postable: false, id: rmdObligationId(r), personId: r.personId, taxYear: r.taxYear,
        accountIds: components.map(c => c.accountId), ruleSnapshotId: rule.snapshotId, required, components, rounding: rule.rounding,
        originalDue: rule.originalDue, permissibleDeferredDue: age === rule.startAge ? rule.deferredDue : null, due, earliestSatisfaction: rule.earliestSatisfaction,
        satisfied: Money.zero(input.currency), satisfiedOnTime: Money.zero(input.currency), satisfiedLate: Money.zero(input.currency), remaining: required, deadlineShortfall: required,
        overdue: input.asOf > due && required.isPositive(), allocations: [], traceRefs: [...new Set(refs.map(s => s.id))].sort(cmp) });
    } catch (e) { if (!(e instanceof Missing)) throw e; diagnostic(r, e); }
  }
  // Reject conflicting satisfaction registers atomically, never assign by incidental order.
  const updates = new Map<string, RmdObligation>();
  try {
    const txIds = new Set<string>(), allocationIds = new Set<string>();
    for (const d of [...input.distributions].sort((a, b) => cmp(a.transactionId, b.transactionId))) {
      need(text(d.transactionId) && !txIds.has(d.transactionId), "invalid", "duplicate_transaction"); txIds.add(d.transactionId);
      date(d.at); exact(d.gross); stamp(d.source, d.personId, d.accountId, d.at, "authorization");
      need(d.source.asOf >= d.at && d.at <= input.asOf && d.payerOwnerId === d.personId && text(d.accountId), "invalid", "actual_identity_or_date");
      need(d.kind === "ordinary" || d.kind === "rmd", "unsupported", "ineligible_distribution_kind");
      need(d.authorized, "authorization", "withdrawal_authorization"); need(d.funding === "posted_funded", "funding", "verified_posted_funding");
      need(d.usageRegister === "verified_complete", "authorization", "historical_usage_register");
      let used = Money.zero(input.currency);
      for (const a of [...d.allocations].sort((a, b) => cmp(a.id, b.id))) {
        exact(a.amount); need(text(a.id) && text(a.obligationId) && Number.isSafeInteger(a.satisfiesRmdYear) && a.satisfiesRmdYear >= 1001 && a.satisfiesRmdYear < 9998 &&
          a.amount.isPositive() && !allocationIds.has(a.id), "invalid", "duplicate_or_invalid_allocation"); allocationIds.add(a.id);
        used = used.plus(a.amount); need(used.compare(d.gross) <= 0, "invalid", "transaction_overallocated");
        const base = obligations.find(o => o.id === a.obligationId);
        if (!base) { need(a.historical, "authorization", "unknown_allocation_obligation"); continue; }
        const o = updates.get(base.id) ?? base;
        need(o.personId === d.personId && o.accountIds.includes(d.accountId) && o.taxYear === a.satisfiesRmdYear, "authorization", "satisfaction_owner_account_year");
        need(d.at >= o.earliestSatisfaction, "deadline", "satisfaction_before_window");
        const satisfied = o.satisfied.plus(a.amount); need(satisfied.compare(o.required) <= 0, "invalid", "obligation_overallocated");
        const late = d.at > o.due;
        updates.set(o.id, { ...o, satisfied, remaining: o.required.minus(satisfied), overdue: input.asOf > o.due && o.required.compare(satisfied) > 0,
          satisfiedOnTime: late ? o.satisfiedOnTime : o.satisfiedOnTime.plus(a.amount), satisfiedLate: late ? o.satisfiedLate.plus(a.amount) : o.satisfiedLate,
          deadlineShortfall: late ? o.deadlineShortfall : o.deadlineShortfall.minus(a.amount),
          allocations: [...o.allocations, { transactionId: d.transactionId, allocationId: a.id, amount: a.amount, late, historical: a.historical }],
          traceRefs: [...new Set([...o.traceRefs, d.source.id])].sort(cmp) });
      }
    }
  } catch (e) { if (!(e instanceof Missing)) throw e; updates.clear(); for (const r of requests) diagnostic(r, e, "rmd_satisfaction"); }
  const result = obligations.map(o => updates.get(o.id) ?? o);
  for (const o of result.filter(o => o.remaining.isPositive())) diagnostic(requests.find(r => rmdObligationId(r) === o.id)!, new Missing("funding", "remaining_shortfall"), "rmd_satisfaction");
  return { contract: "d2-shared/v1", committed: false, obligations: result,
    intents: result.filter(o => o.remaining.isPositive()).map(o => ({ seam: "S3/S6", committed: false, postable: false, obligationId: o.id,
      kind: "needed_withdrawal", grossNeeded: o.remaining, incomeCharacter: "unresolved_retirement_distribution", completeness: "incomplete" })),
    diagnostics, tax: "incomplete", bankSettlement: "incomplete", funding: "incomplete" };
}
