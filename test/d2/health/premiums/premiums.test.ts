import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, decimal, money, Money, sumMoney } from "../../../../src/values/index.js";
import { proposePremiums, type EffectivePeriod, type MedicareElection, type PremiumCoverage, type PremiumRequest, type PremiumSource } from "../../../../src/simulation/d2/health/premiums/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const span = (start = "2026-01-01", end = "2027-01-01"): EffectivePeriod => ({ start: civilDate(start), endExclusive: civilDate(end) });
const source: PremiumSource = { ...span("2025-01-01", "2027-01-01"), ruleSnapshotId: "synthetic-plan-2026", jurisdiction: "US",
  ruleFamily: "authored_premium_quote", sourcePublication: "synthetic test plan terms (not CMS law)", asOf: civilDate("2025-12-01"), version: "1", projectionStatus: "verified" };
const coverage = (id = "coverage", members: readonly string[] = ["claimant"]): PremiumCoverage => ({
  ...span(), id, householdId: "household", memberIds: members, planId: id, planFamily: "health_insurance", sponsorId: "sponsor", recipientId: "insurer",
  route: { kind: "aftertax_bank", payerId: "claimant", sourceAccountId: "cash", evidence: source },
  eligibility: members.map(memberId => ({ memberId, householdId: "household", planId: id, eligible: true, evidence: source })),
  quote: { quoteId: `quote-${id}`, source, gross: money("300"), employer: money("0"), member: money("300"),
    schedule: { anchor: civilDate("2026-01-15"), frequency: "monthly", interval: 1, invalidDay: "skip", amountBasis: "per_occurrence_no_proration" } },
});
const request = (coverages: readonly PremiumCoverage[], period = span("2026-01-01", "2026-02-01")): PremiumRequest => ({
  householdId: "household", memberIds: ["claimant", "beneficiary"], period, coverages, coordination: [],
});
const medicare = (part: MedicareElection): PremiumCoverage => ({ ...coverage(), planFamily: "medicare", medicare: {
  premiumFor: part, elected: [part], enrollmentEvidence: source, compatibilityEvidence: source,
} });
const cents = (value: string): Money => money(value).times(decimal("0.01"));
const codes = (r: ReturnType<typeof proposePremiums>) => r.diagnostics.map(d => d.diagnosticCode);

describe("D2-C source-quoted premium foundation (isolated proposals only)", () => {
  it("uses the independent health_after_tax amount without promoting conditional evidence", () => {
    const fixture = catalog.cases.find(c => c.id === "health_after_tax")!;
    const c = coverage();
    const amount = cents(fixture.input.amounts.householdShareCents!);
    const r = proposePremiums(request([{ ...c, quote: { ...c.quote, gross: amount, member: amount } }]));
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.memberAmount.equals(cents(fixture.expected.effects!.facts.premiumCents!))).toBe(true);
    expect(r.proposals[0]!.kind).toBe("uncommitted_quoted_premium");
    expect(r.netCashCoverage).toBe("incomplete");
    expect(fixture.expected.capability).toBe("not_yet_executable");
    expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
  });

  it("quotes two covered members once, separating the employer subsidy from the employee amount", () => {
    const f = catalog.cases.find(c => c.id === "health_pretax_employer")!;
    const c = coverage("employer-plan", ["claimant", "beneficiary"]);
    const r = proposePremiums(request([{ ...c,
      route: { kind: "pretax_payroll", payerId: "claimant", sponsorId: "sponsor", employmentId: "job-1", evidence: source },
      quote: { ...c.quote, gross: cents(f.input.amounts.grossPremiumCents!), employer: cents(f.input.amounts.employerShareCents!), member: cents(f.input.amounts.employeeShareCents!) },
    }]));
    expect(r.proposals).toHaveLength(1);
    const p = r.proposals[0]!;
    expect(p.memberIds).toEqual(["beneficiary", "claimant"]);
    expect(p.grossAmount.equals(money("300"))).toBe(true);
    expect(p.employerAmount.equals(money("100"))).toBe(true);
    expect(p.memberAmount.equals(money("200"))).toBe(true);
    expect(p.employerAmount.plus(p.memberAmount).equals(p.grossAmount)).toBe(true);
    expect(r.taxEffectsCoverage).toBe("incomplete");
    expect(f.expected.capability).toBe("decision_required");
    expect(f.expected.integratedRuntimeEvidence).toBe(false);
    expect(Object.keys(r)).not.toContain("cashDelta");
    expect(Object.keys(p)).not.toContain("salary");
  });

  it.each(["part_a", "part_b", "part_d", "advantage", "medigap"] as const)("schedules admitted quoted Medicare %s without requiring SSA or inventing IRMAA", part => {
    const f = catalog.cases.find(c => c.id === `medicare_${part}`)!;
    const c = medicare(part);
    const amount = cents(f.input.amounts.authoredPremiumCents!);
    const r = proposePremiums(request([{ ...c, quote: { ...c.quote, gross: amount, member: amount } }]));
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.grossAmount.equals(cents(f.expected.effects!.facts.premiumCents!))).toBe(true);
    expect(r.proposals[0]!.expectedSettlementRoute.kind).toBe("aftertax_bank");
    expect(codes(r)).toContain("IRMAA_OWNER_PENDING");
    expect(r.diagnostics.find(d => d.affectedOutput === "medicare_total")!.missingFacts).toContain("authoritative MAGI lookback");
    expect(r.netCashCoverage).toBe("incomplete");
    expect(Object.keys(r.proposals[0]!)).not.toContain("irmaa");
    expect(f.expected.capability).toBe("decision_required");
    expect(f.expected.integratedRuntimeEvidence).toBe(false);
  });

  it("keeps verified SSA deduction a distinct pending route", () => {
    const c = medicare("part_b");
    const r = proposePremiums(request([{ ...c, route: { kind: "ssa_benefit_deduction_pending", payerId: "claimant", benefitId: "ssa-award", evidence: source } }]));
    expect(r.proposals[0]!.expectedSettlementRoute.kind).toBe("ssa_benefit_deduction_pending");
    expect(r.netCashCoverage).toBe("incomplete");
  });

  it("preserves premium_end_exclusive and never bills the termination boundary", () => {
    const f = catalog.cases.find(c => c.id === "premium_end_exclusive")!;
    const c = coverage();
    const r = proposePremiums(request([{ ...c, ...span(f.input.terms.effectiveStart!, f.input.terms.effectiveEndExclusive!) }]));
    expect(r.proposals).toEqual([]);
    expect(f.expected.effects!.transactions).toEqual([]);
    expect(f.expected.capability).toBe("not_yet_executable");
    expect(f.expected.integratedRuntimeEvidence).toBe(false);
  });

  it("includes the effective start and excludes the end with no inferred proration", () => {
    const c = coverage();
    const r = proposePremiums(request([{ ...c, ...span("2026-01-15", "2026-02-15") }], span("2026-01-01", "2026-03-01")));
    expect(r.proposals.map(p => p.effectiveAt)).toEqual(["2026-01-15"]);
  });

  it("changes jobs only on explicit nonoverlapping effective facts", () => {
    const old = { ...coverage("old"), ...span("2026-01-01", "2026-07-01") };
    const next = { ...coverage("new"), ...span("2026-07-01", "2027-01-01"), sponsorId: "new-employer" };
    const r = proposePremiums(request([old, next], span()));
    expect(r.proposals).toHaveLength(12);
    expect(r.proposals.filter(p => p.coverageId === "old")).toHaveLength(6);
    expect(r.proposals.filter(p => p.coverageId === "new")).toHaveLength(6);
    expect(r.quotedPremiumCoverage).toBe("complete");
  });

  it("blocks accidental overlap and duplicate recurrence even with coordination", () => {
    const a = coverage("a"); const b = coverage("b");
    const input = request([a, b]);
    expect(proposePremiums(input).proposals).toEqual([]);
    expect(codes(proposePremiums(input))).toContain("OVERLAP_COORDINATION_REQUIRED");
    const coordination: PremiumRequest["coordination"] = [{ coverageIds: ["a", "b"], memberId: "claimant", admitsDistinctPremiums: true, evidence: source }];
    expect(proposePremiums({ ...input, coordination }).proposals).toHaveLength(2);
    const duplicate = { ...b, planId: a.planId, eligibility: a.eligibility };
    const r = proposePremiums({ ...request([a, duplicate]), coordination });
    expect(r.proposals).toEqual([]);
    expect(codes(r)).toContain("DUPLICATE_PLAN_RECURRENCE");
  });

  it("rejects incompatible Advantage/Medigap within and across plans", () => {
    const a = medicare("advantage");
    const bad = { ...a, medicare: { ...a.medicare!, elected: ["advantage", "medigap"] as const } };
    expect(codes(proposePremiums(request([bad])))).toContain("MEDICARE_ELECTION_NOT_ADMITTED");
    const b = { ...medicare("medigap"), id: "other", planId: "other", eligibility: coverage("other").eligibility };
    const r = proposePremiums({ ...request([a, b]), coordination: [{ memberId: "claimant", coverageIds: [a.id, b.id], admitsDistinctPremiums: true, evidence: source }] });
    expect(r.proposals).toEqual([]);
    expect(codes(r)).toContain("INCOMPATIBLE_MEDICARE_PLANS");
  });

  it("prevents duplicate Medicare Part premiums across distinct plan IDs, even when overlap is authorized", () => {
    const a = medicare("part_b");
    const b = { ...medicare("part_b"), id: "other-b", planId: "other-b",
      eligibility: coverage("other-b").eligibility };
    const coordination: PremiumRequest["coordination"] = [{
      coverageIds: [a.id, b.id], memberId: "claimant", admitsDistinctPremiums: true, evidence: source,
    }];
    const r = proposePremiums({ ...request([a, b]), coordination });
    expect(r.proposals).toEqual([]);
    expect(codes(r)).toContain("DUPLICATE_PLAN_RECURRENCE");
    expect(r.quotedPremiumCoverage).toBe("incomplete");
  });

  it("blocks unadmitted membership, source, payer and enrollment independently", () => {
    const c = coverage();
    const variants: PremiumCoverage[] = [
      { ...c, memberIds: ["outsider"] }, { ...c, householdId: "another" }, { ...c, eligibility: [] },
      { ...c, eligibility: c.eligibility.map(e => ({ ...e, eligible: false })) },
      { ...c, quote: { ...c.quote, source: { ...source, sourcePublication: "" } } },
      { ...c, route: { kind: "aftertax_bank", payerId: "outsider", sourceAccountId: "cash", evidence: source } },
      { ...c, route: { kind: "aftertax_bank", payerId: "claimant", sourceAccountId: "cash", evidence: { ...source, projectionStatus: "unavailable" } } },
      { ...c, route: { kind: "pretax_payroll", payerId: "claimant", sponsorId: "wrong", employmentId: "job", evidence: source } },
      { ...medicare("part_b"), medicare: { ...medicare("part_b").medicare!, enrollmentEvidence: { ...source, projectionStatus: "unavailable" } } },
    ];
    for (const item of variants) {
      const r = proposePremiums(request([item]));
      expect(r.proposals).toEqual([]);
      expect(r.quotedPremiumCoverage).toBe("incomplete");
    }
  });

  it("does not extend a quote into an unknown future year or default it to zero", () => {
    const c = { ...coverage(), ...span("2026-01-01", "2028-01-01") };
    const r = proposePremiums(request([c], span("2027-01-01", "2028-01-01")));
    expect(r.proposals).toEqual([]);
    expect(codes(r)).toContain("PREMIUM_QUOTE_UNAVAILABLE");
  });

  it("admits explicit projected quotes with their source status and supports a sourced zero premium", () => {
    const c = medicare("part_a");
    const r = proposePremiums(request([{ ...c, quote: { ...c.quote, gross: money("0"), member: money("0"),
      source: { ...source, projectionStatus: "explicit_projected" } } }]));
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.grossAmount.isZero()).toBe(true);
    expect(r.proposals[0]!.source.projectionStatus).toBe("explicit_projected");
    expect(r.coverage[0]!.medicareTotalCoverage).toBe("incomplete");
  });

  it("rejects a missing payer, mixed bank/SSA routing and omitted Medicare configuration", () => {
    const c = medicare("part_b");
    const mixed = { ...c.route, benefitId: "ssa-award" };
    for (const item of [
      { ...c, route: mixed },
      { ...c, route: { ...c.route, payerId: "" } },
      { ...coverage(), planFamily: "medicare" as const },
    ]) expect(proposePremiums(request([item])).proposals).toEqual([]);
  });

  it("bounds diagnostics when many overlapping plans are rejected", () => {
    const r = proposePremiums(request(Array.from({ length: 20 }, (_, i) => coverage(`plan-${i}`)), span()));
    expect(r.proposals).toEqual([]);
    expect(r.diagnostics).toHaveLength(60);
  });

  it("returns immutable snapshots without freezing the caller's sources", () => {
    const mutableSource = { ...source };
    const c = coverage();
    const r = proposePremiums(request([{ ...c, quote: { ...c.quote, source: mutableSource } }]));
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.proposals)).toBe(true);
    expect(Object.isFrozen(r.proposals[0]!.expectedSettlementRoute.evidence)).toBe(true);
    expect(Object.isFrozen(mutableSource)).toBe(false);
    mutableSource.version = "later-edit";
    expect(r.proposals[0]!.source.version).toBe("1");
    expect(r.proposals[0]!.eligibilityEvidence).not.toBe(c.eligibility);
  });

  it("allows a verified household payer for another covered household member", () => {
    const r = proposePremiums(request([coverage("dependent", ["beneficiary"])]));
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.payerId).toBe("claimant");
    expect(r.proposals[0]!.memberIds).toEqual(["beneficiary"]);
  });

  it("reconciles exact cents, monthly partitions, annual frequency and interval", () => {
    const c = coverage();
    const exact = { ...c, quote: { ...c.quote, gross: money("300.03"), employer: money("100.01"), member: money("200.02") } };
    const whole = proposePremiums(request([exact], span()));
    const parts = Array.from({ length: 12 }, (_, i) => proposePremiums(request([exact], span(`2026-${String(i + 1).padStart(2, "0")}-01`, i === 11 ? "2027-01-01" : `2026-${String(i + 2).padStart(2, "0")}-01`))).proposals).flat();
    expect(parts).toEqual(whole.proposals);
    expect(sumMoney(parts.map(p => p.memberAmount)).equals(money("2400.24"))).toBe(true);
    const annual = { ...exact, quote: { ...exact.quote, schedule: { ...exact.quote.schedule, frequency: "annual" as const } } };
    expect(proposePremiums(request([annual], span())).proposals).toHaveLength(1);
    const quarterly = { ...exact, quote: { ...exact.quote, schedule: { ...exact.quote.schedule, interval: 3 } } };
    expect(proposePremiums(request([quarterly], span())).proposals).toHaveLength(4);
  });

  it("skips missing anchor days explicitly", () => {
    const c = coverage();
    const r = proposePremiums(request([{ ...c, quote: { ...c.quote, schedule: { ...c.quote.schedule, anchor: civilDate("2026-01-31") } } }], span("2026-01-01", "2026-04-01")));
    expect(r.proposals.map(p => p.effectiveAt)).toEqual(["2026-01-31", "2026-03-31"]);
  });

  it("rejects negative, unbalanced, fractional-cent and mixed-currency shares", () => {
    const c = coverage();
    for (const quote of [
      { ...c.quote, employer: money("-1"), member: money("301") },
      { ...c.quote, member: money("299.99") },
      { ...c.quote, gross: money("300.001"), member: money("300.001") },
      { ...c.quote, member: new Money(decimal("300"), Currency.of("EUR")) },
    ]) expect(() => proposePremiums(request([{ ...c, quote }]))).toThrow(/reconcile exactly/);
  });

  it("is deterministic, input-order independent and nonmutating on success and rejection", () => {
    const a = coverage("a"); const b = { ...coverage("b", ["beneficiary"]), route: { kind: "aftertax_bank" as const, payerId: "beneficiary", sourceAccountId: "other-cash", evidence: source } };
    const input = request([a, b], span());
    const before = JSON.stringify(input);
    const r = proposePremiums(input);
    expect(proposePremiums(input)).toEqual(r);
    expect(proposePremiums({ ...input, coverages: [b, a] })).toEqual(r);
    expect(JSON.stringify(input)).toBe(before);
    expect(() => proposePremiums({ ...input, coverages: [a, a] })).toThrow(/Duplicate/);
    expect(JSON.stringify(input)).toBe(before);
    expect(r.diagnostics.length).toBeLessThanOrEqual(16);
  });
});
