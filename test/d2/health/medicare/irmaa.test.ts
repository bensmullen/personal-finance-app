import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, decimal, money, Money } from "../../../../src/values/index.js";
import { evaluateIrmaa, type HistoricalIncome, type IncomeTier, type IrmaaOverride, type IrmaaRequest,
  type IrmaaRule, type MedicareEnrollment } from "../../../../src/simulation/d2/health/medicare/index.js";
import { proposePremiums, type EffectivePeriod, type PremiumCoverage, type PremiumSource } from "../../../../src/simulation/d2/health/premiums/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const span = (start = "2026-01-01", end = "2027-01-01"): EffectivePeriod => ({ start: civilDate(start), endExclusive: civilDate(end) });
// Deliberately tiny artificial thresholds/rates. These are not current CMS figures.
const source = (family: string, period = span(), id = `synthetic-${family}`): PremiumSource => ({ ...period,
  ruleSnapshotId: id, jurisdiction: "US", ruleFamily: family, sourcePublication: "synthetic isolated test evidence; not statutory law",
  asOf: civilDate("2025-12-01"), version: "test-v1", projectionStatus: "verified" });
const tiers = (boundary = "100"): readonly IncomeTier[] => [
  { id: "zero", lower: null, lowerInclusive: false, upper: money(boundary), upperInclusive: true, partBMonthly: money("0"), partDMonthly: money("0") },
  { id: "middle", lower: money(boundary), lowerInclusive: false, upper: money("300"), upperInclusive: false, partBMonthly: money("11.01"), partDMonthly: money("2.02") },
  { id: "high", lower: money("300"), lowerInclusive: true, upper: null, upperInclusive: false, partBMonthly: money("33.03"), partDMonthly: money("4.04") },
];
const rule = (): IrmaaRule => ({ source: source("cms_irmaa"), taxYear: 2026, lookbackTaxYear: 2024, currency: "USD",
  monthlyConvention: "whole_month_only", tables: [
    { filingStatus: "single", maritalState: "unmarried", tiers: tiers() },
    { filingStatus: "joint", maritalState: "married", tiers: tiers("200") },
  ] });
const history = (personId = "alice", magi = "250"): HistoricalIncome => ({ personId, householdId: "household", taxYear: 2024,
  taxReturnRef: `return-${personId}-2024`, magi: money(magi), filingStatus: "single", maritalState: "unmarried",
  source: source("historical_tax_return", span("2024-01-01", "2025-01-01"), `return-source-${personId}`) });
const enrollment = (personId = "alice", part: MedicareEnrollment["part"] = "part_b", period = span()): MedicareEnrollment => ({
  ...period, personId, householdId: "household", coverageId: `${personId}-${part}`, planId: `plan-${personId}-${part}`,
  part, elected: [part], source: source("medicare_enrollment") });
const appeal = (period = span("2026-04-01", "2026-07-01")): IrmaaOverride => ({ ...period, personId: "alice", householdId: "household",
  taxYear: 2026, incomeReference: "SSA-approved-current-income", magi: money("50"), filingStatus: "single", maritalState: "unmarried",
  determinationId: "appeal-1", premiumTaxYear: 2026, authority: "SSA", qualification: "verified_legal_determination",
  applicableRuleSnapshotId: "synthetic-cms_irmaa", lifeEventRef: "verified-retirement-event", source: source("irmaa_override", period) });
const request = (patch: Partial<IrmaaRequest> = {}): IrmaaRequest => ({ householdId: "household", personIds: ["alice", "bob"],
  period: span("2026-01-01", "2026-02-01"), taxYear: 2026, enrollments: [enrollment()], deaths: [], rules: [rule()],
  histories: [history()], overrides: [], ...patch });
const codes = (r: ReturnType<typeof evaluateIrmaa>) => r.diagnostics.map(d => d.diagnosticCode);
const blocked = (r: ReturnType<typeof evaluateIrmaa>, code: string) => {
  expect(r.candidates).toEqual([]);
  expect(r.surchargeCoverage).toBe("incomplete");
  expect(codes(r)).toContain(code);
  expect(r.medicareTotalCoverage).toBe("incomplete");
  expect(r.netCashCoverage).toBe("incomplete");
  expect(new Set(r.diagnostics.filter(d => d.diagnosticCode === code).map(d => d.affectedOutput))).toEqual(new Set(["medicare_total", "net_cash"]));
};

describe("D2-C isolated sourced Medicare IRMAA", () => {
  it.each([
    ["-0.01", "zero", "0"], ["99.99", "zero", "0"], ["100", "zero", "0"], ["100.01", "middle", "11.01"],
    ["299.99", "middle", "11.01"], ["300", "high", "33.03"], ["300.01", "high", "33.03"],
  ])("selects exact boundary/adjacent cents %s", (magi, tierId, amount) => {
    const r = evaluateIrmaa(request({ histories: [history("alice", magi)] }));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c.tier.id).toBe(tierId);
    expect(c.monthlySurcharge.equals(money(amount))).toBe(true);
    expect(c.ruleSnapshotId).toBe("synthetic-cms_irmaa");
    expect(c.incomeTaxYear).toBe(2024);
    expect(c.legalLookbackTaxYear).toBe(2024);
    expect(c.magi.equals(money(magi))).toBe(true);
    expect(c.tier.lowerInclusive).toBe(tiers().find(t => t.id === tierId)!.lowerInclusive);
    expect(c.tier.upperInclusive).toBe(tiers().find(t => t.id === tierId)!.upperInclusive);
    expect(c.period).toEqual(span("2026-01-01", "2026-02-01"));
    expect(c.traceRefs).toEqual(expect.arrayContaining(["return-alice-2024", "return-source-alice", "synthetic-cms_irmaa", "synthetic-medicare_enrollment"]));
    expect(r.surchargeCoverage).toBe("complete");
    expect(r.medicareTotalCoverage).toBe("incomplete");
    expect(r.netCashCoverage).toBe("incomplete");
    expect(c.kind).toBe("uncommitted_irmaa_surcharge");
  });

  it("uses filing and marital state, person identity and separately enrolled B/D months", () => {
    const bob: HistoricalIncome = { ...history("bob", "150"), filingStatus: "joint", maritalState: "married" };
    const r = evaluateIrmaa(request({ period: span(), histories: [history("alice", "150"), bob], enrollments: [
      enrollment("alice", "part_b", span("2026-06-01", "2026-09-01")),
      enrollment("alice", "part_d", span("2026-07-01", "2026-08-01")), enrollment("bob", "part_b"),
    ] }));
    expect(r.candidates).toHaveLength(16);
    expect(r.candidates.filter(c => c.personId === "alice" && c.part === "part_b").map(c => c.period.start))
      .toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
    expect(r.candidates.find(c => c.part === "part_d")!.monthlySurcharge.equals(money("2.02"))).toBe(true);
    expect(r.candidates.filter(c => c.personId === "bob").every(c => c.monthlySurcharge.isZero())).toBe(true);
    const wrongMarital = { ...bob, maritalState: "unmarried" };
    blocked(evaluateIrmaa(request({ histories: [wrongMarital], enrollments: [enrollment("bob")] })), "TIER_TABLE_REQUIRED");
  });

  it("never creates D surcharges from B-only elections and needs no Social Security award", () => {
    const r = evaluateIrmaa(request({ period: span() }));
    expect(r.candidates).toHaveLength(12);
    expect(r.candidates.every(c => c.part === "part_b")).toBe(true);
    expect(evaluateIrmaa(request({ enrollments: [] })).surchargeCoverage).toBe("not_applicable");
  });

  it("applies a verified current-year appeal only within its half-open effective dates", () => {
    const r = evaluateIrmaa(request({ period: span(), overrides: [appeal()] }));
    expect(r.candidates.map(c => c.determination)).toEqual([
      "historical_return", "historical_return", "historical_return", "qualified_override", "qualified_override", "qualified_override",
      "historical_return", "historical_return", "historical_return", "historical_return", "historical_return", "historical_return",
    ]);
    const overridden = r.candidates.filter(c => c.determination === "qualified_override");
    expect(overridden.every(c => c.monthlySurcharge.isZero() && c.incomeTaxYear === 2026)).toBe(true);
    expect(overridden.every(c => c.legalLookbackTaxYear === 2024)).toBe(true);
    expect(overridden[0]!.traceRefs).toContain("verified-retirement-event");
    expect(r.candidates[6]!.monthlySurcharge.equals(money("11.01"))).toBe(true);
    const withoutHistory = evaluateIrmaa(request({ period: span("2026-04-01", "2026-05-01"), histories: [], overrides: [appeal()] }));
    expect(withoutHistory.surchargeCoverage).toBe("complete");
  });

  it("does not accept unqualified, wrong-rule, projected, wrong-household or partial-month appeals", () => {
    for (const o of [
      { ...appeal(), qualification: "unqualified" as const }, { ...appeal(), applicableRuleSnapshotId: "other-rule" },
      { ...appeal(), householdId: "other" }, { ...appeal(), source: { ...appeal().source, projectionStatus: "explicit_projected" as const } },
      appeal(span("2026-04-15", "2026-07-01")),
    ]) blocked(evaluateIrmaa(request({ period: span("2026-04-01", "2026-05-01"), overrides: [o] })), "OVERRIDE_NOT_ADMITTED");
    blocked(evaluateIrmaa(request({ period: span("2026-04-01", "2026-05-01"), overrides: [appeal(), { ...appeal(), determinationId: "other" }] })), "OVERRIDE_CONFLICT");
  });

  it("uses only the rule's explicit legal lookback, including 2026 to verified 2024", () => {
    blocked(evaluateIrmaa(request({ histories: [{ ...history(), taxYear: 2025 }] })), "HISTORICAL_INCOME_REQUIRED");
    const r = evaluateIrmaa(request({ rules: [{ ...rule(), lookbackTaxYear: 2023 }], histories: [
      { ...history(), taxYear: 2023, source: source("historical_tax_return", span("2023-01-01", "2024-01-01")) },
    ] }));
    expect(r.candidates[0]!.incomeTaxYear).toBe(2023);
    blocked(evaluateIrmaa(request({ rules: [{ ...rule(), lookbackTaxYear: 2026 }] })), "RULE_NOT_ADMITTED");
  });

  it("keeps missing MAGI, filing state, brackets and unknown future years incomplete", () => {
    blocked(evaluateIrmaa(request({ histories: [] })), "HISTORICAL_INCOME_REQUIRED");
    blocked(evaluateIrmaa(request({ histories: [{ ...history(), filingStatus: "" }] })), "INCOME_NOT_ADMITTED");
    blocked(evaluateIrmaa(request({ rules: [] })), "RULE_REQUIRED");
    blocked(evaluateIrmaa(request({ rules: [{ ...rule(), tables: [] }] })), "TIER_TABLE_REQUIRED");
    blocked(evaluateIrmaa(request({ taxYear: 2027, period: span("2027-01-01", "2027-02-01"),
      enrollments: [enrollment("alice", "part_b", span("2027-01-01", "2028-01-01"))].map(e => ({ ...e, source: source("medicare_enrollment", span("2027-01-01", "2028-01-01")) })) })), "RULE_REQUIRED");
  });

  it("blocks source/currency mismatch, fractional cents and competing historical returns", () => {
    for (const h of [
      { ...history(), householdId: "other" }, { ...history(), taxReturnRef: "" },
      { ...history(), magi: new Money(decimal("250"), Currency.of("EUR")) }, { ...history(), magi: money("250.001") },
      { ...history(), source: source("other_family", span("2024-01-01", "2025-01-01")) },
      { ...history(), source: { ...history().source, projectionStatus: "unavailable" as const } },
      { ...history(), source: source("historical_tax_return") },
    ]) blocked(evaluateIrmaa(request({ histories: [h] })), "INCOME_NOT_ADMITTED");
    blocked(evaluateIrmaa(request({ histories: [history(), history("alice", "300")] })), "INCOME_CONFLICT");
    for (const s of [{ ...rule().source, jurisdiction: "CA" }, { ...rule().source, sourcePublication: "" },
      { ...rule().source, projectionStatus: "explicit_projected" as const }, source("cms_irmaa", span("2026-01-15", "2027-01-01"))]) {
      blocked(evaluateIrmaa(request({ rules: [{ ...rule(), source: s }] })), "RULE_NOT_ADMITTED");
    }
    blocked(evaluateIrmaa(request({ rules: [rule(), { ...rule(), source: { ...rule().source, version: "competing-v2" } }] })), "RULE_CONFLICT");
  });

  it("rejects tier holes, overlap, duplicate IDs, mixed currencies and negative/subcent rates", () => {
    const t = tiers();
    const variants: readonly IncomeTier[][] = [
      [], [t[0]!, { ...t[1]!, lowerInclusive: true }, t[2]!], [t[0]!, { ...t[1]!, lower: money("101") }, t[2]!],
      [t[0]!, { ...t[1]!, id: "zero" }, t[2]!],
      [t[0]!, { ...t[1]!, partDMonthly: money("-1") }, t[2]!],
      [t[0]!, { ...t[1]!, partBMonthly: money("11.001") }, t[2]!],
      [t[0]!, { ...t[1]!, upper: new Money(decimal("300"), Currency.of("EUR")) }, t[2]!],
      [t[0]!, { ...t[1]!, upper: money("100") }, t[2]!],
    ];
    for (const tierTable of variants) blocked(evaluateIrmaa(request({ rules: [{ ...rule(), tables: [
      { filingStatus: "single", maritalState: "unmarried", tiers: tierTable },
    ] }] })), "TIER_TABLE_REQUIRED");
  });

  it("blocks conflicting elections and duplicate surcharges across plan IDs", () => {
    const e = enrollment();
    blocked(evaluateIrmaa(request({ enrollments: [{ ...e, elected: ["part_d"] }] })), "ELECTION_CONFLICT");
    blocked(evaluateIrmaa(request({ enrollments: [{ ...e, elected: ["part_b", "advantage", "medigap"] }] })), "ELECTION_CONFLICT");
    const d = { ...enrollment("alice", "part_d"), elected: ["part_d", "medigap"] as const };
    blocked(evaluateIrmaa(request({ enrollments: [{ ...e, elected: ["part_b", "advantage"] }, d] })), "ELECTION_CONFLICT");
    blocked(evaluateIrmaa(request({ enrollments: [e, { ...e, planId: "renamed", coverageId: "renamed" }] })), "DUPLICATE_SURCHARGE");
    blocked(evaluateIrmaa(request({ enrollments: [e, e] })), "DUPLICATE_SURCHARGE");
    blocked(evaluateIrmaa(request({ enrollments: [{ ...e, source: { ...e.source, projectionStatus: "unavailable" } }] })), "ENROLLMENT_NOT_ADMITTED");
    // A conflict for Alice must not suppress Bob's independent determination.
    const independent = evaluateIrmaa(request({ enrollments: [e, e, enrollment("bob")], histories: [history(), history("bob")] }));
    expect(independent.candidates).toHaveLength(1);
    expect(independent.candidates[0]!.personId).toBe("bob");
    expect(independent.surchargeCoverage).toBe("incomplete");
  });

  it("does not infer partial-month premiums, coverage termination or death refunds", () => {
    blocked(evaluateIrmaa(request({ enrollments: [enrollment("alice", "part_b", span("2026-01-15", "2027-01-01"))] })), "PRORATION_REQUIRED");
    blocked(evaluateIrmaa(request({ period: span("2026-01-01", "2026-01-15") })), "PRORATION_REQUIRED");
    blocked(evaluateIrmaa(request({ rules: [{ ...rule(), monthlyConvention: "unknown_proration" }] })), "PRORATION_REQUIRED");
    const ended = evaluateIrmaa(request({ period: span(), enrollments: [enrollment("alice", "part_b", span("2026-01-01", "2026-03-01"))] }));
    expect(ended.candidates).toHaveLength(2);
    const partialEnd = evaluateIrmaa(request({ period: span("2026-01-01", "2026-03-01"),
      enrollments: [enrollment("alice", "part_b", span("2026-01-01", "2026-02-15"))] }));
    expect(partialEnd.candidates).toHaveLength(1);
    expect(codes(partialEnd)).toContain("PRORATION_REQUIRED");
    const death = { personId: "alice", effectiveAt: civilDate("2026-03-01"), source: source("death_record") };
    const r = evaluateIrmaa(request({ period: span(), deaths: [death] }));
    expect(r.candidates).toHaveLength(2);
    expect(r.coverage.filter(c => c.surchargeCoverage === "not_applicable")).toHaveLength(10);
    blocked(evaluateIrmaa(request({ deaths: [{ ...death, effectiveAt: civilDate("2026-01-15") }] })), "PRORATION_REQUIRED");
    blocked(evaluateIrmaa(request({ deaths: [{ ...death, effectiveAt: civilDate("2026-01-01"), source: { ...death.source, projectionStatus: "unavailable" } }] })), "DEATH_SOURCE_REQUIRED");
  });

  it("preserves C1 quoted base premiums and the original conditional catalog evidence", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    const fixture = catalog.cases.find(c => c.id === "medicare_irmaa")!;
    const before = JSON.stringify(fixture);
    expect(fixture.input.amounts.authoredBasePremiumCents).toBe("30000");
    expect(fixture.input.terms.lookback).toBe("missing effective rule");
    expect(fixture.expected.capability).toBe("decision_required");
    expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
    blocked(evaluateIrmaa(request({ rules: [], histories: [] })), "RULE_REQUIRED");
    const e = enrollment();
    const evidence = source("authored_premium_quote");
    const c: PremiumCoverage = { ...span(), id: e.coverageId, householdId: "household", memberIds: ["alice"], planId: e.planId,
      planFamily: "medicare", sponsorId: "sponsor", recipientId: "insurer", route: { kind: "aftertax_bank", payerId: "alice", sourceAccountId: "cash", evidence },
      eligibility: [{ memberId: "alice", householdId: "household", planId: e.planId, eligible: true, evidence }],
      medicare: { premiumFor: "part_b", elected: ["part_b"], enrollmentEvidence: evidence, compatibilityEvidence: evidence },
      quote: { quoteId: "base-quote", source: evidence, gross: money("300"), employer: money("0"), member: money("300"),
        schedule: { anchor: civilDate("2026-01-15"), frequency: "monthly", interval: 1, invalidDay: "skip", amountBasis: "per_occurrence_no_proration" } } };
    const c1 = proposePremiums({ householdId: "household", memberIds: ["alice"], period: request().period, coverages: [c], coordination: [] });
    const c1Before = JSON.stringify(c1);
    const basePremium = c1.proposals[0]!;
    expect(basePremium.memberAmount.equals(money("300"))).toBe(true);
    const r = evaluateIrmaa(request({ enrollments: [{ ...e, basePremium }] }));
    expect(r.candidates[0]!.monthlySurcharge.equals(money("11.01"))).toBe(true);
    expect(JSON.stringify(c1)).toBe(c1Before);
    expect(JSON.stringify(fixture)).toBe(before);
    blocked(evaluateIrmaa(request({ enrollments: [{ ...e, basePremium: { ...basePremium, planId: "other" } }] })), "ELECTION_CONFLICT");
  });

  it("returns immutable snapshots and deterministic results independent of caller ordering", () => {
    const input = request({ period: span(), histories: [history(), history("bob")], enrollments: [enrollment(), enrollment("bob")], overrides: [appeal()] });
    const before = JSON.stringify(input);
    const r = evaluateIrmaa(input);
    expect(evaluateIrmaa(input)).toEqual(r);
    expect(evaluateIrmaa({ ...input, enrollments: [...input.enrollments].reverse(), histories: [...input.histories].reverse(),
      rules: input.rules.map(law => ({ ...law, tables: [...law.tables].reverse().map(t => ({ ...t, tiers: [...t.tiers].reverse() })) })) })).toEqual(r);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input.rules[0]!.source)).toBe(false);
    expect(Object.isFrozen(r.candidates[0]!.tier)).toBe(true);
    expect(Object.isFrozen(r.candidates[0]!.ruleSource)).toBe(true);
    expect(Object.isFrozen(r.coverage)).toBe(true);
    expect(r.candidates[0]!.ruleSource).not.toBe(input.rules[0]!.source);
    const mutableSource = { ...rule().source };
    const copied = evaluateIrmaa(request({ rules: [{ ...rule(), source: mutableSource }] }));
    mutableSource.version = "later-version";
    expect(copied.candidates[0]!.ruleSource.version).toBe("test-v1");
    expect(() => evaluateIrmaa({ ...input, period: span("2026-01-01", "2028-01-01") })).toThrow(/premium tax year/);
    expect(JSON.stringify(input)).toBe(before);
    const whole = evaluateIrmaa(request({ period: span() })).candidates;
    const parts = Array.from({ length: 12 }, (_, i) => evaluateIrmaa(request({ period: span(`2026-${String(i + 1).padStart(2, "0")}-01`,
      i === 11 ? "2027-01-01" : `2026-${String(i + 2).padStart(2, "0")}-01`) })).candidates).flat();
    expect(parts).toEqual(whole);
  });
});
