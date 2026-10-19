import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { composeMedicareObligations, type MedicareCoordinationRequest, type MedicareInventory,
  type SsaDeductionTerms } from "../../../../../src/simulation/d2/health/medicare/coordination/index.js";
import type { EffectivePeriod, MedicareElection, PremiumCoverage, PremiumSource } from "../../../../../src/simulation/d2/health/premiums/index.js";
import type { QuotedBenefit } from "../../../../../src/simulation/d2/retirement/benefits/index.js";
import { coordinateSocialSecurity } from "../../../../../src/simulation/d2/retirement/benefits/coordination/index.js";
import { catalogSchema } from "../../../../fixtures/d2/schema.js";

const span = (start = "2026-01-01", end = "2027-01-01"): EffectivePeriod => ({ start: civilDate(start), endExclusive: civilDate(end) });
const source = (family = "synthetic_quote", period = span()): PremiumSource => ({ ...period, ruleSnapshotId: `test-${family}`,
  ruleFamily: family, jurisdiction: "US", sourcePublication: "Synthetic isolated evidence; not official law",
  asOf: civilDate("2025-12-01"), version: "test-v1", projectionStatus: "verified" });
const choices: readonly MedicareElection[] = ["part_a", "part_b", "part_d", "advantage", "medigap", "supplement"];
const id = (person: string, part: MedicareElection) => `${person}-${part}`;
const inventory = (person = "alice", elected: readonly MedicareElection[] = ["part_b"], period = span("2026-01-01", "2026-02-01")): MedicareInventory => ({
  ...period, personId: person, householdId: "hh", eventAt: period.start, source: source("medicare_inventory"),
  parts: choices.map(part => elected.includes(part) ? { part, status: "elected", coverageId: id(person, part), source: source("election") }
    : { part, status: "excluded", reason: "explicit sourced exclusion", source: source("election") }),
  surcharges: (["part_b", "part_d"] as const).map(part => ({ part, status: elected.includes(part) ? "applicable" : "not_applicable",
    reason: "explicit sourced surcharge applicability", source: source("cms_coverage") })),
});
const coverage = (person = "alice", part: MedicareElection = "part_b", elected: readonly MedicareElection[] = [part]): PremiumCoverage => ({
  ...span(), id: id(person, part), householdId: "hh", memberIds: [person], planId: `plan-${id(person, part)}`,
  sponsorId: "sponsor", recipientId: `recipient-${part}`, planFamily: "medicare",
  route: { kind: "aftertax_bank", payerId: person, sourceAccountId: `bank-${person}`, evidence: source("route") },
  eligibility: [{ memberId: person, householdId: "hh", planId: `plan-${id(person, part)}`, eligible: true, evidence: source("eligibility") }],
  medicare: { premiumFor: part, elected, enrollmentEvidence: source("medicare_enrollment"), compatibilityEvidence: source("coordination") },
  quote: { quoteId: `quote-${id(person, part)}`, source: source(), gross: money(part === "part_a" ? "0" : "350"),
    employer: money(part === "part_a" ? "0" : "50"), member: money(part === "part_a" ? "0" : "300"),
    schedule: { anchor: civilDate("2026-01-01"), frequency: "monthly", interval: 1, invalidDay: "skip", amountBasis: "per_occurrence_no_proration" } },
});
const request = (elected: readonly MedicareElection[] = ["part_b"], people = ["alice"]): MedicareCoordinationRequest => {
  const coverages = people.flatMap(person => elected.map(part => coverage(person, part, elected)));
  return {
    premiums: { householdId: "hh", memberIds: people, period: span("2026-01-01", "2026-02-01"), coverages,
      coordination: people.map(memberId => ({ memberId, coverageIds: elected.map(part => id(memberId, part)),
        admitsDistinctPremiums: true, evidence: source("coordination") })) },
    irmaa: { householdId: "hh", personIds: people, period: span("2026-01-01", "2026-02-01"), taxYear: 2026,
      enrollments: coverages.filter(c => c.medicare!.premiumFor === "part_b" || c.medicare!.premiumFor === "part_d").map(c => ({
        ...span(), coverageId: c.id, personId: c.memberIds[0]!, householdId: "hh", planId: c.planId,
        part: c.medicare!.premiumFor as "part_b" | "part_d", elected, source: source("medicare_enrollment") })), deaths: [], overrides: [],
      histories: people.map(personId => ({ personId, householdId: "hh", taxYear: 2024, taxReturnRef: `return-${personId}`,
        filingStatus: personId === "alice" ? "single" : "joint", maritalState: personId === "alice" ? "unmarried" : "married",
        magi: money(personId === "alice" ? "200" : "0"), source: source("historical_tax_return", span("2024-01-01", "2025-01-01")) })),
      rules: [{ source: source("cms_irmaa"), taxYear: 2026, lookbackTaxYear: 2024, currency: "USD", monthlyConvention: "whole_month_only",
        tables: ["single", "joint"].map(filingStatus => ({ filingStatus, maritalState: filingStatus === "single" ? "unmarried" : "married",
          tiers: [
            { id: "zero", lower: null, lowerInclusive: false, upper: money("100"), upperInclusive: true, partBMonthly: money("0"), partDMonthly: money("0") },
            { id: "high", lower: money("100"), lowerInclusive: false, upper: null, upperInclusive: false, partBMonthly: money("40"), partDMonthly: money("7") },
          ] })) }],
    },
    inventories: people.map(person => inventory(person, elected)),
    banks: people.map(person => ({ ...span(), householdId: "hh", accountId: `bank-${person}`, accountKind: "BANK", ownerIds: [person], source: source("bank_ownership") })),
    awards: [], deductionTerms: [],
  };
};
const award = (person = "alice", gross = "2000"): QuotedBenefit => ({
  awardId: `ssa-${person}`, entitlementId: `entitlement-${person}`, householdId: "hh", recipientPersonId: person, workerRecordPersonId: person,
  benefitKind: "ss_retirement", claimingMonth: civilDate("2026-01-01"), commencement: civilDate("2026-01-01"),
  frequency: "monthly", invalidDayPolicy: "skip", calendarSource: source("ssa_calendar"),
  quote: { recipientPersonId: person, workerRecordPersonId: person, claimingMonth: civilDate("2026-01-01"),
    adjustmentOrder: "claiming_then_cola_then_continuation", grossAmount: money(gross), asOf: civilDate("2025-12-01"),
    dollarBasisAt: civilDate("2026-01-01"), basis: "at_claim", source: source("ssa_quote"), coveredHorizon: span() },
  verifiedAward: { recipientPersonId: person, workerRecordPersonId: person, claimingMonth: civilDate("2026-01-01"),
    coveredHorizon: span(), source: source("ssa_award"), eligibility: "eligible", coordination: "total_payable_award", unsupportedRules: [] },
  cola: { coveredHorizon: span(), source: source("ssa_cola"), changes: [] },
});
const terms = (person = "alice", amount = "340"): SsaDeductionTerms => ({ ...span(), householdId: "hh", personId: person,
  benefitId: `ssa-${person}`, part: "part_b", coverageId: id(person, "part_b"), recipientId: "recipient-part_b",
  permittedAmount: money(amount), source: source("ssa_medicare_deduction") });
const ssa = (r = request(), person = "alice"): MedicareCoordinationRequest => ({ ...r,
  premiums: { ...r.premiums, coverages: r.premiums.coverages.map(c => c.memberIds[0] === person ? { ...c,
    route: { kind: "ssa_benefit_deduction_pending", payerId: person, benefitId: `ssa-${person}`, evidence: source("ssa_route") } } : c) },
  awards: [award(person)], deductionTerms: [terms(person, person === "alice" ? "340" : "300")],
});
const blocked = (r: MedicareCoordinationRequest, code?: string) => {
  const result = composeMedicareObligations(r);
  expect(result.householdTotal).toBeNull();
  expect(result.medicareTotalCoverage).toBe("incomplete");
  expect(result.netCashCoverage).toBe("incomplete");
  if (code) expect(result.diagnostics.map(d => d.diagnosticCode)).toContain(code);
  return result;
};

// The positive fixture uses A1's real installment output, not expanded coverage.
const installmentRequest = (payment = "2026-06-15", end = "2026-07-01"): MedicareCoordinationRequest => {
  const period = span(`${payment.slice(0, 7)}-01`, end), r = request(["part_b", "part_d"]);
  const s = source("ssa_coordinated_quote");
  const a = award();
  const input: QuotedBenefit = { ...a, commencement: civilDate(payment), calendarSource: s,
    quote: { ...a.quote!, source: s, asOf: s.asOf },
    cola: { ...a.cola!, source: s }, verifiedAward: { ...a.verifiedAward!, source: s } };
  const evidence = { evidenceId: "synthetic-evidence", coverageSetId: "synthetic-set", source: s,
    knownAt: s.asOf, publishedAt: s.asOf, effective: span() };
  const coordinated = coordinateSocialSecurity({ householdId: "hh", knownAt: civilDate(payment), horizon: period,
    recipients: [{ recipientPersonId: "alice", enabled: true,
      quotes: [{ quoteId: "own", role: "own", evidence, award: input }],
      determinations: [{ determinationId: "determination", electionId: "election", versionId: "v1", evidence,
        inventoryComplete: true, inventoryQuoteIds: ["own"], strategy: "own", benefitKind: "ss_retirement",
        ownQuoteId: "own", paymentAwardId: "payment", paymentEntitlementId: "entitlement-alice",
        paymentWorkerRecordPersonId: "alice", claimingMonth: input.claimingMonth, installmentDay: payment.slice(8),
        eligibility: "eligible", relationship: "self", unsupportedRules: [] }] }] });
  expect(coordinated.diagnostics).toEqual([]);
  const quoted = coordinated.proposals[0]!.quotedAward;
  expect(quoted.quote!.coveredHorizon).toEqual(span(payment, end));
  return { ...r, premiums: { ...r.premiums, period, coverages: r.premiums.coverages.map(c => ({ ...c,
    route: { kind: "ssa_benefit_deduction_pending", payerId: "alice", benefitId: quoted.awardId, evidence: source("route") } })) },
    irmaa: { ...r.irmaa, period }, inventories: [inventory("alice", ["part_b", "part_d"], period)],
    awards: [quoted], deductionTerms: (["part_b", "part_d"] as const).map(part => ({ ...terms(), ...period,
      benefitId: quoted.awardId, part, coverageId: id("alice", part), recipientId: `recipient-${part}`,
      permittedAmount: money(part === "part_b" ? "340" : "307") })) };
};

describe("C2 source-owner SSA installment admission", () => {
  it.each([["2026-06-01", "2026-07-01"], ["2026-06-15", "2026-07-01"],
    ["2026-06-30", "2026-07-01"], ["2026-01-15", "2026-02-01"], ["2026-12-15", "2027-01-01"]])(
    "admits A1 installment %s through %s with one B and one D", (payment, end) => {
      const r = composeMedicareObligations(installmentRequest(payment, end));
      expect(r.medicareTotalCoverage).toBe("complete");
      expect(r.obligations).toHaveLength(2);
      expect(r.householdTotal!.equals(money("647"))).toBe(true);
    });

  it("admits SSA and legal knowledge between premium and payment, never after payment", () => {
    const r = installmentRequest();
    const dated = (date: string): MedicareCoordinationRequest => ({ ...r,
      awards: r.awards.map(a => ({ ...a, calendarSource: { ...a.calendarSource, asOf: civilDate(date) },
        quote: { ...a.quote!, asOf: civilDate(date), source: { ...a.quote!.source, asOf: civilDate(date) } } })),
      deductionTerms: r.deductionTerms.map(t => ({ ...t, source: { ...t.source, asOf: civilDate(date) } })) });
    expect(composeMedicareObligations(dated("2026-06-10")).medicareTotalCoverage).toBe("complete");
    const future = dated("2026-06-16");
    blocked({ ...r, awards: future.awards }, "SSA_TERMS_REQUIRED");
    blocked({ ...r, deductionTerms: future.deductionTerms }, "SSA_TERMS_REQUIRED");
  });

  it("rejects truncated, shifted, wrong-person and wrong-worker quotes and advance premiums", () => {
    const r = installmentRequest(), a = r.awards[0]!;
    for (const coveredHorizon of [span("2026-06-16", "2026-07-01"), span("2026-06-15", "2026-06-30"),
      span("2026-05-15", "2026-06-01"), span("2026-07-15", "2026-08-01")])
      blocked({ ...r, awards: [{ ...a, quote: { ...a.quote!, coveredHorizon } }] }, "SSA_TERMS_REQUIRED");
    for (const patch of [{ recipientPersonId: "bob" }, { workerRecordPersonId: "bob" }, { awardId: "wrong" },
      { householdId: "other" }]) blocked({ ...r, awards: [{ ...a, ...patch }] }, "SSA_TERMS_REQUIRED");
    blocked({ ...r, awards: [{ ...a, endExclusive: civilDate("2026-06-16") }] }, "SSA_TERMS_REQUIRED");
    blocked({ ...r, awards: [{ ...a, verifiedAward: { ...a.verifiedAward!, coveredHorizon: span("2026-06-15", "2026-06-16") } }] }, "SSA_TERMS_REQUIRED");
    blocked({ ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.map(c => ({ ...c,
      quote: { ...c.quote, schedule: { ...c.quote.schedule, anchor: civilDate("2026-06-20") } } })) } }, "SSA_TERMS_REQUIRED");
    const bank = request(["part_b", "part_d"]).premiums.coverages[0]!.route;
    blocked({ ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.map((c, n) => n ? c : { ...c, route: bank }) } }, "DOUBLE_ROUTE");
  });

  it("retains premium and IRMAA event knowledge gates", () => {
    const r = installmentRequest();
    blocked({ ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.map(c => ({ ...c,
      quote: { ...c.quote, source: { ...c.quote.source, asOf: civilDate("2026-06-10") } } })) } });
    blocked({ ...r, irmaa: { ...r.irmaa, histories: [] } }, "SURCHARGE_REQUIRED");
    blocked({ ...r, irmaa: { ...r.irmaa, rules: r.irmaa.rules.map(rule => ({ ...rule,
      source: { ...rule.source, asOf: civilDate("2026-06-10") } })) } }, "SURCHARGE_REQUIRED");
  });
});

describe("D2-C Medicare total and uncommitted intended route composition", () => {
  it("composes 30000 base + independently sourced 4000 IRMAA exactly once", () => {
    const r = composeMedicareObligations(request());
    expect(r.householdTotal!.equals(money("340"))).toBe(true);
    const row = r.obligations[0]!;
    expect(row.memberObligation.equals(money("340"))).toBe(true);
    expect(row.grossBase.equals(money("350"))).toBe(true);
    expect(row.employerShare.equals(money("50"))).toBe(true);
    expect(row.memberBase.equals(money("300"))).toBe(true);
    expect(row.consumedOperationIds).toHaveLength(2);
    expect(row.intendedRoute.kind).toBe("aftertax_bank");
    expect(row.irmaa!.incomeTaxYear).toBe(2024);
    expect(row.irmaa!.tier.id).toBe("high");
    expect(row.traceRefs).toContain("return-alice");
    expect(row.committed).toBe(false);
    expect(r.taxEffectsCoverage).toBe("incomplete");
    expect(r.netCashCoverage).toBe("incomplete");
    expect(r.postingsCoverage).toBe("not_applicable");
  });

  it("keeps separate D surcharge, sourced zero Part A, and per-part recipients", () => {
    const r = composeMedicareObligations(request(["part_a", "part_b", "part_d"]));
    expect(r.obligations).toHaveLength(3);
    expect(r.householdTotal!.equals(money("647"))).toBe(true);
    expect(r.obligations.find(o => o.part === "part_a")!.memberObligation.isZero()).toBe(true);
    const d = r.obligations.find(o => o.part === "part_d")!;
    expect(d.surcharge.equals(money("7"))).toBe(true);
    expect(d.recipientId).toBe("recipient-part_d");
    expect(d.irmaa!.part).toBe("part_d");
  });

  it("uses distinct spouse MAGI/filing and bank versus SSA routes", () => {
    const r = composeMedicareObligations(ssa(request(["part_b"], ["alice", "bob"]), "bob"));
    expect(r.householdTotal!.equals(money("640"))).toBe(true);
    expect(r.obligations.find(o => o.personId === "alice")!.intendedRoute.kind).toBe("aftertax_bank");
    const bob = r.obligations.find(o => o.personId === "bob")!;
    expect(bob.intendedRoute.kind).toBe("ssa_benefit_deduction_pending");
    expect(bob.irmaa!.filingState.filingStatus).toBe("joint");
    expect(bob.surcharge.isZero()).toBe(true);
  });

  it("retains distinct Part occurrence dates without using later evaluation knowledge", () => {
    const r = request(["part_b", "part_d"]);
    const result = composeMedicareObligations({ ...r, premiums: { ...r.premiums,
      coverages: r.premiums.coverages.map(c => ({ ...c, quote: { ...c.quote, schedule: { ...c.quote.schedule,
        anchor: civilDate(c.medicare!.premiumFor === "part_b" ? "2026-01-15" : "2026-01-20") } } })) } });
    expect(result.householdTotal!.equals(money("647"))).toBe(true);
    expect(result.obligations.find(o => o.part === "part_b")!.effectiveAt).toBe("2026-01-15");
    expect(result.obligations.find(o => o.part === "part_d")!.effectiveAt).toBe("2026-01-20");
  });

  it("requires exhaustive inventory, real zero quote, and all elected base rows", () => {
    const r = request(["part_a", "part_b", "part_d"]);
    blocked({ ...r, inventories: [] }, "COMPLETE_INVENTORY_REQUIRED");
    blocked({ ...r, inventories: r.inventories.map(v => ({ ...v, parts: v.parts.filter(p => p.part !== "part_d") })) }, "COMPLETE_INVENTORY_REQUIRED");
    for (const part of ["part_a", "part_d"]) {
      const b = blocked({ ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.filter(c => c.medicare!.premiumFor !== part) } }, "BASE_REQUIRED");
      expect(b.obligations).toEqual([]);
    }
    blocked({ ...r, inventories: r.inventories.map(v => ({ ...v, surcharges: v.surcharges.filter(s => s.part !== "part_d") })) });
  });

  it("never infers zero surcharge from missing D income or absent C2 candidates", () => {
    const r = request(["part_d"]);
    blocked({ ...r, irmaa: { ...r.irmaa, histories: [] } }, "SURCHARGE_REQUIRED");
    blocked({ ...r, irmaa: { ...r.irmaa, enrollments: [] } }, "SURCHARGE_REQUIRED");
    blocked({ ...r, irmaa: { ...r.irmaa, histories: r.irmaa.histories.map(h => ({ ...h, taxYear: 2025 })) } });
  });

  it("rejects duplicate coverage/surcharge, conflicting tier rules and elections", () => {
    const r = request();
    blocked({ ...r, irmaa: { ...r.irmaa, enrollments: [...r.irmaa.enrollments, { ...r.irmaa.enrollments[0]!, coverageId: "duplicate" }] } });
    blocked({ ...r, irmaa: { ...r.irmaa, rules: [...r.irmaa.rules, { ...r.irmaa.rules[0]!, source: source("other_rule") }] } });
    blocked({ ...r, premiums: { ...r.premiums, coverages: [...r.premiums.coverages, { ...r.premiums.coverages[0]!, id: "duplicate" }] } });
    blocked(request(["advantage", "part_d"]), "ELECTION_CONFLICT");
    blocked(request(["advantage", "medigap"]), "ELECTION_CONFLICT");
  });

  it("blocks projected, expired and known-after-event sources at every composition boundary", () => {
    const r = request();
    for (const patch of [
      { asOf: civilDate("2026-01-02") }, { projectionStatus: "explicit_projected" as const },
      { start: civilDate("2025-01-01"), endExclusive: civilDate("2026-01-01") },
    ]) {
      blocked({ ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.map(c => ({ ...c, quote: { ...c.quote, source: { ...c.quote.source, ...patch } } })) } });
      blocked({ ...r, irmaa: { ...r.irmaa, rules: r.irmaa.rules.map(rule => ({ ...rule, source: { ...rule.source, ...patch } })) } });
      blocked({ ...r, inventories: r.inventories.map(v => ({ ...v, source: { ...v.source, ...patch } })) });
      blocked({ ...r, banks: r.banks.map(b => ({ ...b, source: { ...b.source, ...patch } })) });
    }
    blocked({ ...r, irmaa: { ...r.irmaa, histories: r.irmaa.histories.map(h => ({ ...h, source: { ...h.source, asOf: civilDate("2026-01-02") } })) } });
  });

  it("uses qualified overrides only on their effective months and known by the event", () => {
    const r = request();
    const override = { ...span("2026-01-01", "2026-02-01"), personId: "alice", householdId: "hh", taxYear: 2026,
      incomeReference: "approved-income", magi: money("0"), filingStatus: "single", maritalState: "unmarried", determinationId: "appeal",
      premiumTaxYear: 2026, authority: "SSA" as const, qualification: "verified_legal_determination" as const,
      applicableRuleSnapshotId: "test-cms_irmaa", source: source("irmaa_override") };
    const result = composeMedicareObligations({ ...r, irmaa: { ...r.irmaa, histories: [], overrides: [override] } });
    expect(result.householdTotal!.equals(money("300"))).toBe(true);
    expect(result.obligations[0]!.irmaa!.determination).toBe("qualified_override");
    blocked({ ...r, irmaa: { ...r.irmaa, overrides: [{ ...override, start: civilDate("2026-01-02") }] } });
    blocked({ ...r, irmaa: { ...r.irmaa, overrides: [{ ...override, source: { ...override.source, asOf: civilDate("2026-01-02") } }] } });
    const feb = { ...r, premiums: { ...r.premiums, period: span("2026-02-01", "2026-03-01") },
      irmaa: { ...r.irmaa, period: span("2026-02-01", "2026-03-01"), overrides: [override] },
      inventories: [inventory("alice", ["part_b"], span("2026-02-01", "2026-03-01"))] };
    expect(composeMedicareObligations(feb).householdTotal!.equals(money("340"))).toBe(true);
  });

  it("requires owned bank data and rejects SSA plus bank authorization", () => {
    const r = request();
    blocked({ ...r, banks: [] }, "BANK_REQUIRED");
    blocked({ ...r, banks: r.banks.map(b => ({ ...b, ownerIds: ["other"] })) }, "BANK_REQUIRED");
    blocked({ ...r, deductionTerms: [terms()] }, "DOUBLE_ROUTE");
    blocked({ ...r, awards: [{ ...award(), medicareDeduction: { amount: money("340"), source: source("ssa_deduction") } }] }, "DOUBLE_ROUTE");
  });

  it("requires same-person verified SSA award, sufficient gross and exact legal deduction terms", () => {
    const r = ssa();
    expect(composeMedicareObligations(r).householdTotal!.equals(money("340"))).toBe(true);
    for (const patch of [
      { awards: [] }, { deductionTerms: [] }, { awards: [award("bob")] }, { awards: [award("alice", "339.99")] },
      { awards: [{ ...award(), benefitKind: "pension" as const }] }, { deductionTerms: [terms("alice", "300")] },
      { deductionTerms: [{ ...terms(), benefitId: "wrong" }] }, { deductionTerms: [{ ...terms(), recipientId: "other" }] },
      { awards: [{ ...award(), quote: { ...award().quote!, source: { ...source("ssa_quote"), projectionStatus: "explicit_projected" as const } } }] },
      { awards: [{ ...award(), calendarSource: { ...source("ssa_calendar"), asOf: civilDate("2026-01-02") } }] },
    ]) blocked({ ...r, ...patch }, "SSA_TERMS_REQUIRED");
    blocked({ ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.map(c => ({ ...c,
      route: { kind: "ssa_benefit_deduction_pending", payerId: "bob", benefitId: "ssa-alice", evidence: source("route") } })) } });
  });

  it("covers January and December half-open months and gates partial months", () => {
    const r = request();
    const december = { ...r, premiums: { ...r.premiums, period: span("2026-12-01", "2027-01-01") },
      irmaa: { ...r.irmaa, period: span("2026-12-01", "2027-01-01") },
      inventories: [inventory("alice", ["part_b"], span("2026-12-01", "2027-01-01"))] };
    const result = composeMedicareObligations(december);
    expect(result.householdTotal!.equals(money("340"))).toBe(true);
    expect(result.obligations[0]!.period.endExclusive).toBe("2027-01-01");
    expect(result.obligations[0]!.claimId).not.toBe(composeMedicareObligations(r).obligations[0]!.claimId);
    blocked({ ...r, premiums: { ...r.premiums, period: span("2026-01-15", "2026-02-01") },
      irmaa: { ...r.irmaa, period: span("2026-01-15", "2026-02-01") } }, "COMPLETE_INVENTORY_REQUIRED");
  });

  it("withholds the household total when just one spouse is incomplete", () => {
    const r = request(["part_b"], ["alice", "bob"]);
    const result = blocked({ ...r, banks: r.banks.filter(b => b.accountId === "bank-alice") });
    expect(result.obligations).toHaveLength(1);
    expect(result.obligations[0]!.personId).toBe("alice");
  });

  it("preserves exact large cents without rounding, and rejects fractional cents", () => {
    const r = request();
    const large = { ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.map(c => ({ ...c,
      quote: { ...c.quote, gross: money("9007199254740993.01"), employer: money("0"), member: money("9007199254740993.01") } })) } };
    expect(composeMedicareObligations(large).householdTotal!.equals(money("9007199254741033.01"))).toBe(true);
    expect(() => composeMedicareObligations({ ...large, premiums: { ...large.premiums,
      coverages: large.premiums.coverages.map(c => ({ ...c, quote: { ...c.quote, gross: money("1.001"), member: money("1.001") } })) } })).toThrow();
  });

  it("is replayable, independent of input order, and does not freeze or mutate callers", () => {
    const r = request(["part_a", "part_b", "part_d"], ["alice", "bob"]), before = JSON.stringify(r);
    const first = composeMedicareObligations(r);
    const reverse = { ...r, premiums: { ...r.premiums, memberIds: [...r.premiums.memberIds].reverse(),
      coverages: [...r.premiums.coverages].reverse().map(c => ({ ...c, medicare: { ...c.medicare!, elected: [...c.medicare!.elected].reverse() } })),
      coordination: [...r.premiums.coordination].reverse().map(c => ({ ...c, coverageIds: [...c.coverageIds].reverse() })) },
      irmaa: { ...r.irmaa, personIds: [...r.irmaa.personIds].reverse(), enrollments: [...r.irmaa.enrollments].reverse(), histories: [...r.irmaa.histories].reverse() },
      banks: [...r.banks].reverse(), inventories: [...r.inventories].reverse().map(v => ({ ...v, parts: [...v.parts].reverse(), surcharges: [...v.surcharges].reverse() })) };
    expect(composeMedicareObligations(reverse)).toEqual(first);
    expect(composeMedicareObligations(r)).toEqual(first);
    expect(JSON.stringify(r)).toBe(before);
    expect(Object.isFrozen(r.premiums.coverages[0])).toBe(false);
    expect(Object.isFrozen(first.obligations[0]!.base.medicare!.elected)).toBe(true);
    expect(new Set(first.obligations.flatMap(o => o.consumedOperationIds)).size)
      .toBe(first.obligations.reduce((n, o) => n + o.consumedOperationIds.length, 0));
    (r.premiums.coverages[0]!.quote.source as { version: string }).version = "caller-edited";
    expect(first.obligations.every(o => o.base.source.version === "test-v1")).toBe(true);
  });

  it("reads all unchanged Medicare prep fixtures as conditional decision-required evidence", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    for (const name of ["medicare_part_a", "medicare_part_b", "medicare_part_d", "medicare_advantage", "medicare_medigap", "medicare_irmaa"]) {
      const fixture = catalog.cases.find(c => c.id === name)!;
      expect(fixture).toBeDefined();
      expect(fixture.expected.capability).toBe("decision_required");
      expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
    }
    const r = composeMedicareObligations(request());
    expect(r.evidenceTier).toBe("conditional");
  });
});
