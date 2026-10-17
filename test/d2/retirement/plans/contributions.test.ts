import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  capacityKey, evaluatePlanContributions, type CapacityRef, type ContributionPermission,
  type ContributionRequest, type PlanFamily, type PlanPeriod, type PlanSource, type PriorCapacity, type ScopeKind,
} from "../../../../src/simulation/d2/retirement/plans/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, money, Money, USD } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const date = civilDate;
const period = (year = 2026): PlanPeriod => ({ start: date(`${year}-01-01`), endExclusive: date(`${year + 1}-01-01`) });
const source = (id: string, year = 2026): PlanSource => ({
  ruleSnapshotId: id, jurisdiction: "US:synthetic", ruleFamily: "synthetic_ordinary_plan_capacity",
  sourcePublication: "Explicit synthetic verified test supplement; not IRS law", asOf: date(`${year}-01-01`),
  effectiveYear: year, effectivePeriod: period(year), version: "synthetic-v1", projectionStatus: "verified",
});
const personScopes = ["aggregate_deferral", "simple_deferral", "governmental_457"];
const ref = (kind: ScopeKind, group: string): CapacityRef => ({
  limitScope: { kind, aggregationId: personScopes.includes(kind) ? "person" : group },
  ruleSnapshotId: `synthetic:capacity:${kind}`,
});
const request = (family: PlanFamily = "403b", id = family as string, payer: "employee" | "employer" = family === "sep_ira" ? "employer" : "employee", personId = "claimant", sponsorId = "employer", year = 2026): ContributionRequest => {
  const kinds: ScopeKind[] = ["compensation"];
  if (family === "governmental_457b") kinds.push("governmental_457");
  if (["403b", "federal_tsp", "sep_ira"].includes(family)) kinds.push("annual_additions");
  if (payer === "employer") kinds.push("employer");
  if (payer === "employee" && family !== "governmental_457b") kinds.push("aggregate_deferral");
  if (family === "simple_ira" && payer === "employee") kinds.push("simple_deferral");
  const planId = `${family}:${sponsorId}`, src = source(`synthetic:plan:${planId}`, year);
  const permission: ContributionPermission = { payer, taxBucket: "pretax", contributionType: payer === "employee" ? "ordinary_deferral" : "employer_addition",
    compensationTypes: ["sourced_eligible_wages"], scopeCompleteness: "complete",
    capacities: kinds.map(k => ref(k, k === "annual_additions" ? sponsorId : `${sponsorId}:${payer}`)) };
  return { operationId: id, personId, sponsorId, planId, family, enrollment: period(year), enrollmentSource: src,
    destinationAccountId: `${personId}:${planId}:asset`, currency: USD, taxYear: year, effectiveAt: date(`${year}-01-15`), amount: money("500"),
    payer, taxBucket: "pretax", contributionType: permission.contributionType,
    funding: { kind: payer === "employee" ? "payroll" : "employer", sourceAccountId: `${sponsorId}:${payer}:source`, sourceReferenceId: `item:${id}`, personId, sponsorId, source: src },
    compensation: { personId, sponsorId, taxYear: year, type: "sourced_eligible_wages", sourceAccountId: `${sponsorId}:employee:source`, source: src,
      eligibleAmount: money("2000"), contributionCap: money("2000") },
    rules: { personId, sponsorId, planId, family, source: src, participation: "eligible", permissions: [permission] } };
};
// Explicit synthetic capacity facts, supplied by tests, not a statutory catalog.
const priors = (requests: readonly ContributionRequest[]): PriorCapacity[] => {
  const map = new Map<string, PriorCapacity>();
  for (const r of requests) for (const ref of r.rules!.permissions[0]!.capacities) {
    map.set(capacityKey(r.personId, r.taxYear, ref), { ...ref, personId: r.personId, taxYear: r.taxYear,
      source: source(ref.ruleSnapshotId, r.taxYear), usageSource: source(`synthetic:observed-usage:${ref.limitScope.kind}`, r.taxYear),
      maximum: money("2000"), used: money("0"), asOf: date(`${r.taxYear}-01-01`), completeness: "complete" });
  }
  return [...map.values()];
};
const run = (requests: readonly ContributionRequest[], priorCapacities = priors(requests), observedOperationIds: readonly string[] = []) =>
  evaluatePlanContributions({ asOf: date("2026-01-01"), period: period(), requests, priorCapacities, observedOperationIds });
const codes = (r: ContributionRequest, p = priors([r])) => run([r], p).diagnostics.map(d => d.diagnosticCode);
const withPermission = (r: ContributionRequest, edit: Partial<ContributionPermission>): ContributionRequest => ({
  ...r, rules: { ...r.rules!, permissions: [{ ...r.rules!.permissions[0]!, ...edit }] },
});
const usage = (result: ReturnType<typeof run>, kind: ScopeKind) => result.capacityProposals.filter(p => p.limitScope.kind === kind);
const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const cents = (s: string): Money => money(`${s.slice(0, -2) || "0"}.${s.slice(-2).padStart(2, "0")}`);

describe("A2 isolated contribution proposals with explicit synthetic sources", () => {
  it.each(["403b_contribution", "governmental_457b_contribution", "tsp_contribution", "sep_ira_contribution", "simple_ira_contribution"])("consumes unchanged catalog case %s at its authored 50,000 cents", id => {
    const fixture = catalog.cases.find(c => c.id === id)!;
    const before = JSON.stringify(fixture);
    // The fixture explicitly calls this source family tsp; the adapter names it
    // federal_tsp, never 401k. Eligibility comes ONLY from the synthetic supplement.
    const family = fixture.family === "tsp" ? "federal_tsp" : fixture.family as PlanFamily;
    const roles = fixture.input.roles;
    const payer = fixture.input.terms.employeeEmployerCharacter === "employer" ? "employer" : "employee";
    const base = request(family, id, payer, roles.owner, roles.employer!, Number(fixture.input.terms.taxYear));
    const r: ContributionRequest = { ...base, planId: roles.plan!, destinationAccountId: roles.destination,
      currency: Currency.of(fixture.input.currency), amount: cents(fixture.input.amounts.authoredContributionCents!),
      // Fixtures author a period, not an instant. Jan 15 is an explicit synthetic supplement.
      effectiveAt: date("2026-01-15"),
      funding: { ...base.funding, sourceAccountId: roles.source },
      rules: { ...base.rules!, planId: roles.plan! },
      compensation: { ...base.compensation, sourceAccountId: payer === "employee" ? roles.source : base.compensation.sourceAccountId,
        eligibleAmount: cents(fixture.input.amounts.grossCompensationCents!) } };
    const result = evaluatePlanContributions({ asOf: date(fixture.period.start),
      period: { start: date(fixture.period.start), endExclusive: date(fixture.period.endExclusive) },
      requests: [r], priorCapacities: priors([r]), observedOperationIds: [] });
    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate.amount.equals(money("500"))).toBe(true);
    expect(candidate.family).toBe(family);
    expect(candidate.committed).toBe(false);
    expect(candidate.destinationAccountId).toBe(roles.destination);
    expect(candidate.personId).toBe(roles.owner);
    expect(candidate.fundingIntent.kind).toBe(family === "sep_ira" ? "employer_owned_asset_intent" : "employee_payroll_intent");
    expect(candidate.taxCharacter).toBe(family === "sep_ira" ? "employer_pretax_addition" : "employee_pretax_deferral");
    expect(result.accountPeriods[0]).toMatchObject({ tax: "incomplete", funding: "incomplete", postings: "not_applicable" });
    expect(fixture.expected.capability).toBe("decision_required");
    expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("shares 401k/403b/TSP and SIMPLE deferrals, preserving independent governmental 457 capacity", () => {
    const requests = [request("403b"), request("federal_tsp", "tsp", "employee", "claimant", "federal"),
      request("governmental_457b"), request("simple_ira", "simple", "employee", "claimant", "small-employer")];
    const prior = priors(requests).map(p => p.limitScope.kind === "aggregate_deferral" ? { ...p, used: money("499.99") } : p);
    const result = run(requests, prior);
    expect(result.diagnostics).toEqual([]);
    expect(usage(result, "aggregate_deferral")).toHaveLength(1);
    expect(usage(result, "aggregate_deferral")[0]!.proposedUsage.equals(money("1999.99"))).toBe(true);
    expect(usage(result, "aggregate_deferral")[0]!.proposedHeadroom.equals(money("0.01"))).toBe(true);
    expect(usage(result, "governmental_457")[0]!.proposedUsage.equals(money("500"))).toBe(true);
    expect(usage(result, "simple_deferral")[0]!.proposedUsage.equals(money("500"))).toBe(true);
    expect(run([...requests].reverse(), [...prior].reverse())).toEqual(result);
  });

  it.each(["0", "999.99", "1000", "1000.01"])("honors supplied 401k prior consumption %s", consumed => {
    const rs = [request("403b"), request("federal_tsp")];
    const p = priors(rs).map(p => p.limitScope.kind === "aggregate_deferral" ? { ...p, used: money(consumed) } : p);
    const result = run(rs, p);
    if (consumed === "1000.01") {
      expect(result.candidates).toEqual([]); expect(result.capacityProposals).toEqual([]);
      expect(result.diagnostics.some(d => d.diagnosticCode === "CAPACITY_EXCEEDED")).toBe(true);
    } else expect(usage(result, "aggregate_deferral")[0]!.proposedUsage.equals(money(consumed).plus(money("1000")))).toBe(true);
  });

  it("counts repeated installments once cumulatively and preserves exact cents", () => {
    const a = { ...request("403b", "a"), amount: money("0.01") };
    const b = { ...request("403b", "b"), amount: money("0.02"), effectiveAt: date("2026-02-15") };
    const result = run([b, a]);
    expect(result.diagnostics).toEqual([]);
    for (const p of result.capacityProposals) expect(p.proposedIncrement.equals(money("0.03"))).toBe(true);
    expect(run([a, b])).toEqual(result);
    expect(run([a, b])).toEqual(run([a, b]));
  });

  it("keeps members independent and annual additions shared across source-qualified employer groups", () => {
    const rs = [request("403b", "a"), request("federal_tsp", "b"), request("403b", "other", "employee", "spouse")];
    const result = run(rs);
    expect(result.diagnostics).toEqual([]);
    expect(usage(result, "aggregate_deferral")).toHaveLength(2);
    expect(usage(result, "aggregate_deferral").find(p => p.personId === "claimant")!.proposedIncrement.equals(money("1000"))).toBe(true);
    expect(usage(result, "annual_additions").find(p => p.personId === "claimant")!.proposedIncrement.equals(money("1000"))).toBe(true);
    const independent = request("403b", "independent", "employee", "claimant", "unrelated-employer");
    expect(usage(run([rs[0]!, independent]), "annual_additions")).toHaveLength(2);
  });

  it("separates SEP employer assets and SIMPLE employee/employer funding and limits", () => {
    const rs = [request("sep_ira"), request("simple_ira", "simple-employee"), request("simple_ira", "simple-employer", "employer")];
    const result = run(rs);
    expect(result.diagnostics).toEqual([]);
    expect(usage(result, "aggregate_deferral")[0]!.proposedIncrement.equals(money("500"))).toBe(true);
    expect(usage(result, "employer")[0]!.proposedIncrement.equals(money("1000"))).toBe(true);
    expect(result.candidates.filter(c => c.fundingIntent.kind === "employer_owned_asset_intent")).toHaveLength(2);
    expect(result.candidates.find(c => c.family === "sep_ira")!.capacityKeys.some(k => k.includes("aggregate_deferral"))).toBe(false);
    expect(result.candidates.find(c => c.operationId === "simple-employee")!.fundingIntent).toEqual({ kind: "employee_payroll_intent", payrollSourceAccountId: "employer:employee:source" });
  });

  it("atomically rejects a failed second cap without changing any supplied observation", () => {
    const rs = [request("403b"), request("governmental_457b")];
    const prior = priors(rs).map(p => p.limitScope.kind === "annual_additions" ? { ...p, used: money("1600") } : p);
    const before = JSON.stringify({ rs, prior });
    const result = run(rs, prior);
    expect(result.candidates).toEqual([]); expect(result.capacityProposals).toEqual([]);
    expect(result.diagnostics.some(d => d.diagnosticCode === "ATOMIC_BATCH_REJECTED")).toBe(true);
    expect(result.accountPeriods.every(p => p.contributionCapacity === "incomplete")).toBe(true);
    expect(JSON.stringify({ rs, prior })).toBe(before);
    expect(run([...rs].reverse(), [...prior].reverse())).toEqual(result);
  });

  it("rejects duplicate IDs, repeated source requests, and replay against committed IDs", () => {
    const r = request();
    expect(run([r, r]).diagnostics.every(d => d.diagnosticCode === "DUPLICATE_OPERATION")).toBe(true);
    expect(run([r, { ...r, operationId: "renamed" }]).diagnostics.every(d => d.diagnosticCode === "REPEATED_SOURCE_REQUEST")).toBe(true);
    expect(run([r], priors([r]), [r.operationId]).diagnostics[0]!.diagnosticCode).toBe("DUPLICATE_OPERATION");
  });

  it.each(["0", "-0.01", "0.001"])("rejects zero, negative or sub-cent amount %s", amount => {
    const r = { ...request(), amount: money(amount) };
    expect(run([r]).candidates).toEqual([]); expect(codes(r).length).toBeGreaterThan(0);
  });
  it("rejects currency mismatch, wrong compensation and wrong source identity", () => {
    const r = request();
    expect(codes({ ...r, amount: money("500", Currency.of("EUR")) })).toContain("CURRENCY_MISMATCH");
    expect(codes({ ...r, compensation: { ...r.compensation, type: "investment_income" } })).toContain("INELIGIBLE_COMPENSATION_TYPE");
    expect(codes({ ...r, compensation: { ...r.compensation, sourceAccountId: "other-payroll" } })).toContain("COMPENSATION_SOURCE_MISMATCH");
    expect(codes({ ...r, funding: { ...r.funding, sponsorId: "other-employer" } })).toContain("FUNDING_IDENTITY_MISMATCH");
    expect(codes({ ...r, funding: { ...r.funding, kind: "employer" } })).toContain("FUNDING_IDENTITY_MISMATCH");
    expect(codes({ ...r, compensation: { ...r.compensation, contributionCap: money("499.99") } })).toContain("COMPENSATION_CAP_EXCEEDED");
    expect(codes({ ...r, payer: "employer" })).toContain("PAYER_CONTRIBUTION_MISMATCH");
  });
  it.each(["catch_up", "rollover", "distribution"] as const)("gates unsupported %s with source-linked diagnostic and no usage", contributionType => {
    const r = { ...request(), contributionType };
    const result = run([r]);
    expect(result.candidates).toEqual([]); expect(result.capacityProposals).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ status: "unsupported", diagnosticCode: "UNSUPPORTED_CONTRIBUTION_TYPE", affectedAccountId: r.destinationAccountId, period: period() });
    expect(result.diagnostics[0]!.traceRefs).toContain(r.rules!.source.ruleSnapshotId);
  });
  it("does not alias nongovernmental 457, TSP or salary-reduction SEP", () => {
    expect(codes({ ...request(), family: "nongovernmental_457b" as PlanFamily })).toContain("UNSUPPORTED_PLAN_FAMILY");
    const tsp = request("federal_tsp");
    expect(codes({ ...tsp, rules: { ...tsp.rules!, family: "403b" } })).toContain("RULE_PLAN_IDENTITY_MISMATCH");
    expect(codes(request("sep_ira", "salary-reduction", "employee"))).toContain("UNSUPPORTED_SALARY_REDUCTION_SEP");
  });
  it("requires explicit Roth/after-tax permissions and preserves annual additions without deferral consumption", () => {
    const r = request();
    expect(codes({ ...r, taxBucket: "roth" })).toContain("MISSING_OR_AMBIGUOUS_PERMISSION");
    const roth = withPermission({ ...r, taxBucket: "roth" }, { taxBucket: "roth" });
    expect(run([roth]).candidates[0]!.taxCharacter).toBe("employee_roth_contribution");
    const after = withPermission({ ...r, taxBucket: "non_roth_after_tax", contributionType: "employee_after_tax" }, {
      taxBucket: "non_roth_after_tax", contributionType: "employee_after_tax",
      capacities: r.rules!.permissions[0]!.capacities.filter(p => p.limitScope.kind !== "aggregate_deferral"),
    });
    const result = run([after]);
    expect(result.diagnostics).toEqual([]);
    expect(result.candidates[0]!.taxCharacter).toBe("employee_after_tax_basis");
    expect(usage(result, "aggregate_deferral")).toEqual([]);
    expect(usage(result, "annual_additions")[0]!.proposedIncrement.equals(money("500"))).toBe(true);
    expect(codes({ ...request("federal_tsp"), taxBucket: "non_roth_after_tax", contributionType: "employee_after_tax" })).toContain("UNSUPPORTED_AFTER_TAX_FAMILY");
  });

  it("requires every legal scope, complete prior facts and an unambiguous authority version", () => {
    const r = request(), ps = priors([r]);
    const missing = withPermission(r, { capacities: r.rules!.permissions[0]!.capacities.filter(p => p.limitScope.kind !== "annual_additions") });
    expect(codes(missing)).toContain("MISSING_LEGAL_SCOPE");
    expect(codes(withPermission(r, { scopeCompleteness: "unknown" }))).toContain("UNKNOWN_LEGAL_SCOPES");
    expect(codes(r, [])).toContain("MISSING_OR_AMBIGUOUS_PRIOR_CAPACITY");
    expect(codes(r, ps.map(p => ({ ...p, taxYear: 2025 })))).toContain("MISSING_OR_AMBIGUOUS_PRIOR_CAPACITY");
    expect(codes(r, ps.map(p => ({ ...p, completeness: "unknown" })))).toContain("INCOMPLETE_OR_STALE_PRIOR_USAGE");
    expect(codes(r, ps.map(p => ({ ...p, asOf: date("2025-12-31") })))).toContain("INCOMPLETE_OR_STALE_PRIOR_USAGE");
    expect(codes(r, ps.map(p => ({ ...p, ruleSnapshotId: "different-vintage" })))).toContain("CAPACITY_VERSION_MISMATCH");
    expect(codes(r, [...ps, { ...ps[0]!, ruleSnapshotId: "alternative" }])).toContain("MISSING_OR_AMBIGUOUS_PRIOR_CAPACITY");
    const hidden = withPermission(r, { capacities: r.rules!.permissions[0]!.capacities.map(p => p.limitScope.kind === "aggregate_deferral" ? { ...p, limitScope: { ...p.limitScope, aggregationId: r.planId } } : p) });
    expect(codes(hidden)).toContain("HIDDEN_PERSON_CAPACITY");
  });

  it.each(["403b", "governmental_457b", "federal_tsp", "sep_ira", "simple_ira"] as const)("fails incomplete when synthetic %s rules omit a necessary scope", family => {
    const r = request(family), permission = r.rules!.permissions[0]!;
    for (const cap of permission.capacities) {
      const missing = withPermission(r, { capacities: permission.capacities.filter(c => c !== cap) });
      expect(run([missing]).diagnostics[0]).toMatchObject({ status: "incomplete", diagnosticCode: "MISSING_LEGAL_SCOPE" });
      expect(run([missing]).capacityProposals).toEqual([]);
    }
  });

  it("keeps governmental 457 employee/employer additions within its independent combined cap", () => {
    const rs = [request("governmental_457b", "employee"), request("governmental_457b", "employer", "employer")];
    const result = run(rs);
    expect(result.diagnostics).toEqual([]);
    expect(usage(result, "governmental_457")[0]!.proposedUsage.equals(money("1000"))).toBe(true);
    expect(usage(result, "aggregate_deferral")).toEqual([]);
    const over = priors(rs).map(p => p.limitScope.kind === "governmental_457" ? { ...p, maximum: money("999.99") } : p);
    expect(run(rs, over).capacityProposals).toEqual([]);
    expect(run(rs, over).diagnostics.every(d => d.diagnosticCode === "CAPACITY_EXCEEDED")).toBe(true);
  });

  it("requires cumulative compensation capacity even when statutory deferral/additions headroom remains", () => {
    const rs = [{ ...request("403b", "a"), amount: money("1500") }, { ...request("federal_tsp", "b"), amount: money("700") }];
    const p = priors(rs).map(p => p.limitScope.kind === "compensation" ? p : { ...p, maximum: money("5000") });
    const result = run(rs, p);
    expect(result.candidates).toEqual([]); expect(result.capacityProposals).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every(d => d.diagnosticCode === "CAPACITY_EXCEEDED" && d.limitScope?.kind === "compensation")).toBe(true);
    expect(result.diagnostics[0]!.traceRefs).toContain("synthetic:capacity:compensation");
  });

  it("requires source-qualified participation, rule coverage and observed consumption provenance", () => {
    const r = request(), p = priors([r]);
    expect(codes({ ...r, rules: { ...r.rules!, participation: "unknown" } })).toContain("PARTICIPATION_NOT_ELIGIBLE");
    expect(codes({ ...r, rules: { ...r.rules!, participation: "ineligible" } })).toContain("PARTICIPATION_NOT_ELIGIBLE");
    expect(codes({ ...r, rules: { ...r.rules!, source: { ...r.rules!.source, effectiveYear: 2025 } } })).toContain("UNCOVERED_RULE_YEAR_OR_DATE");
    expect(codes({ ...r, enrollmentSource: { ...r.enrollmentSource, sourcePublication: "" } })).toContain("MISSING_SOURCE_IDENTITY");
    expect(codes(r, p.map(p => ({ ...p, usageSource: { ...p.usageSource, projectionStatus: "unavailable" } })))).toContain("UNVERIFIED_OR_FUTURE_RULE");
    expect(codes(r, p.map(p => ({ ...p, source: { ...p.source, jurisdiction: "other" } })))).toContain("SOURCE_JURISDICTION_MISMATCH");
    expect(codes(r, p.map(p => ({ ...p, used: money("2000.01") })))).toContain("INVALID_PRIOR_USAGE");
    expect(codes(r, p.map(p => ({ ...p, maximum: money("2000", Currency.of("EUR")) })))).toContain("CURRENCY_MISMATCH");
  });

  it("preserves identity across source plans and rejects conflicting plan/account aliases", () => {
    const a = request("403b", "a"), b = request("federal_tsp", "b");
    expect(run([a, { ...b, planId: a.planId }]).diagnostics.every(d => d.diagnosticCode === "PLAN_IDENTITY_CONFLICT")).toBe(true);
    expect(run([a, { ...b, destinationAccountId: a.destinationAccountId }]).diagnostics.every(d => d.diagnosticCode === "ACCOUNT_IDENTITY_CONFLICT")).toBe(true);
    const result = run([a]);
    expect(result.candidates[0]!.fundingSourceReferenceId).toBe(a.funding.sourceReferenceId);
    expect(result.candidates[0]!.compensationSourceAccountId).toBe(a.compensation.sourceAccountId);
    expect(result.capacityProposals[0]!.traceRefs.some(id => id.startsWith("synthetic:observed-usage:"))).toBe(true);
  });

  it("uses half-open enrollment and evaluation periods and gates unknown future law", () => {
    const r = request();
    expect(codes({ ...r, enrollment: { ...period(), start: date("2026-01-16") } })).toContain("OUTSIDE_ENROLLMENT");
    expect(codes({ ...r, enrollment: { ...period(), endExclusive: r.effectiveAt } })).toContain("OUTSIDE_ENROLLMENT");
    expect(codes({ ...r, effectiveAt: date("2027-01-01"), taxYear: 2026 })).toContain("PRIOR_OR_WRONG_TAX_YEAR");
    expect(codes({ ...r, effectiveAt: date("2026-12-31") })).toEqual([]);
    const future = request("403b", "future", "employee", "claimant", "employer", 2027);
    const result = evaluatePlanContributions({ asOf: date("2027-01-01"), period: period(2027), requests: [{ ...future, rules: { ...future.rules!, source: { ...future.rules!.source, projectionStatus: "unavailable" } } }], priorCapacities: priors([future]), observedOperationIds: [] });
    expect(result.diagnostics[0]).toMatchObject({ status: "incomplete", diagnosticCode: "UNVERIFIED_OR_FUTURE_RULE" });
    const nextYear = evaluatePlanContributions({ asOf: date("2027-01-01"), period: period(2027), requests: [{ ...future, effectiveAt: date("2027-01-01") }], priorCapacities: priors([future]), observedOperationIds: [] });
    expect(nextYear.diagnostics).toEqual([]);
    expect(nextYear.capacityProposals.every(p => p.taxYear === 2027 && p.priorUsage.isZero())).toBe(true);
    expect(codes({ ...r, rules: { ...r.rules!, source: { ...r.rules!.source, projectionStatus: "explicit_projected" } } })).toContain("UNVERIFIED_OR_FUTURE_RULE");
    const { rules: _missing, ...withoutRules } = r;
    expect(codes(withoutRules)).toContain("MISSING_PLAN_RULE");
  });
});
