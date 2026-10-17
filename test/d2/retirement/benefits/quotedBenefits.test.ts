import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateQuotedBenefits, type BenefitPeriod, type BenefitSource, type QuotedBenefit,
  type SourcedFactor,
} from "../../../../src/simulation/d2/retirement/benefits/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, money, Ratio, RoundingPolicy } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const date = civilDate;
const period = (start = "2026-01-01", endExclusive = "2027-01-01"): BenefitPeriod => ({ start: date(start), endExclusive: date(endExclusive) });
const source: BenefitSource = {
  ruleSnapshotId: "synthetic:verified-award/v1", jurisdiction: "US", ruleFamily: "quoted_benefit",
  sourcePublication: "synthetic awarded-payment terms, not statutory law", asOf: date("2026-01-01"),
  version: "1", projectionStatus: "verified",
};
const factor = (n: string, mode: RoundingPolicy["mode"] = "half_even", scale = 2): SourcedFactor => ({ factor: Ratio.parse(n), rounding: new RoundingPolicy(scale, mode), source });
const award = (kind: QuotedBenefit["benefitKind"] = "ss_retirement", person = "claimant"): QuotedBenefit => {
  const worker = kind === "ss_spousal" || kind === "ss_survivor" ? "other-worker" : person;
  return {
    awardId: `${kind}:${person}`, entitlementId: `${kind}:${person}`, householdId: "household",
    recipientPersonId: person, workerRecordPersonId: worker, benefitKind: kind,
    claimingMonth: date("2026-01-01"), commencement: date("2026-01-15"), frequency: "monthly",
    invalidDayPolicy: "skip", calendarSource: source,
    quote: { recipientPersonId: person, workerRecordPersonId: worker, claimingMonth: date("2026-01-01"),
      adjustmentOrder: "claiming_then_cola_then_continuation",
      grossAmount: money("1000"), asOf: source.asOf, dollarBasisAt: source.asOf,
      basis: kind === "pension" ? "post_election" : "at_claim", source, coveredHorizon: period(),
      ...(kind === "pension" ? { electionId: "election" } : {}) },
    cola: { source, coveredHorizon: period(), changes: [] },
    verifiedAward: { recipientPersonId: person, workerRecordPersonId: worker, claimingMonth: date("2026-01-01"),
      source, coveredHorizon: period(), eligibility: "eligible", coordination: "total_payable_award", unsupportedRules: [],
      ...(kind === "ss_survivor" ? { workerDeathDate: date("2025-12-15") } : {}) },
    ...(kind === "ss_survivor" ? { workerDeathDate: date("2025-12-15") } : {}),
    ...(kind === "pension" ? { sponsorId: "sponsor", beneficiaryId: "beneficiary",
      election: { electionId: "election", form: "quoted elected joint annuity", beneficiaryId: "beneficiary", source } } : {}),
    withholding: { amount: money("100"), source },
  };
};
const run = (awards: readonly QuotedBenefit[], horizon = period("2026-01-01", "2026-02-01")) => calculateQuotedBenefits({ householdId: "household", horizon, awards });
const amounts = (result: ReturnType<typeof run>) => result.proposals.map(p => p.grossAmount.amount.toString());
const codes = (a: QuotedBenefit, horizon?: BenefitPeriod) => run([a], horizon).diagnostics.map(d => d.diagnosticCode);
const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const cents = (value: string) => money(`${value.slice(0, -2) || "0"}.${value.slice(-2).padStart(2, "0")}`);

describe("D2-A isolated verified quoted schedules (no statutory or integrated claim)", () => {
  it.each(["ss_retirement", "ss_spousal", "ss_survivor", "pension_quote"])("preserves %s independently supplied gross facts", id => {
    const fixture = catalog.cases.find(c => c.id === id)!;
    const kind = id === "pension_quote" ? "pension" : id as QuotedBenefit["benefitKind"];
    const a = award(kind);
    const before = JSON.stringify(fixture);
    // Additional synthetic verified eligibility is explicit; the prep fixture
    // itself still has unresolved eligibility and conditional evidence only.
    const result = run([{ ...a, quote: { ...a.quote!, grossAmount: cents(fixture.input.amounts.quotedGrossCents!) },
      withholding: { amount: cents(fixture.input.amounts.authoredWithholdingCents!), source } }], fixture.period as BenefitPeriod);
    const p = result.proposals[0]!;
    expect(p.effectiveAt).toBe(fixture.input.terms.eventDate);
    expect(p.grossAmount.equals(cents(fixture.expected.effects!.recognition.incomeCents))).toBe(true);
    expect(p.withholdingInstruction!.equals(cents(fixture.expected.effects!.facts.withholdingCents!))).toBe(true);
    expect(p.committed).toBe(false);
    expect(p.settlementProposal).toEqual({ kind: "unrouted_gross_benefit", committed: false });
    expect(p).not.toHaveProperty("netCash");
    expect(p).not.toHaveProperty("taxable");
    expect(result.coverage).toEqual({ grossSchedule: "complete", statutoryCalculation: "not_applicable", tax: "incomplete", netCash: "incomplete", postings: "not_applicable" });
    expect(JSON.stringify(fixture)).toBe(before);
    expect(fixture.expected.capability).toBe("decision_required");
    expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
  });

  it("keeps ss_cola_coordination and pension_survivor_end missing facts unknown", () => {
    for (const id of ["ss_cola_coordination", "pension_survivor_end"]) {
      const fixture = catalog.cases.find(c => c.id === id)!;
      expect(fixture.expected.effects).toBeUndefined();
      expect(fixture.expected.capability).toBe("decision_required");
    }
    const ss = award("ss_spousal");
    const { cola: _cola, ...noCola } = ss;
    expect(codes(noCola)).toContain("MISSING_COLA_COVERAGE");
    const p = award("pension");
    const r = run([{ ...p, participantDeathDate: date("2026-01-15") }]);
    expect(r.proposals).toEqual([]);
    expect(r.recipientMonths[0]).not.toHaveProperty("grossAmount");
    expect(r.diagnostics[0]!.diagnosticCode).toBe("MISSING_CONTINUATION_TERMS");
  });

  it.each(["at_claim", "full_retirement_age"] as const)("applies claiming adjustment exactly once for %s", basis => {
    const a = award();
    const r = run([{ ...a, quote: { ...a.quote!, basis }, claimingAdjustment: factor("0.8") }]);
    expect(amounts(r)).toEqual([basis === "at_claim" ? "1000" : "800"]);
  });
  it("requires a sourced FRA adjustment and a matching claiming month", () => {
    const a = award();
    expect(codes({ ...a, quote: { ...a.quote!, basis: "full_retirement_age" } })).toContain("MISSING_CLAIMING_ADJUSTMENT");
    expect(codes({ ...a, claimingMonth: date("2025-12-01") })).toContain("QUOTE_IDENTITY_MISMATCH");
    expect(codes({ ...a, quote: { ...a.quote!, basis: "full_retirement_age" }, claimingAdjustment: { ...factor("0.8"), source: { ...source, projectionStatus: "unavailable" } } })).toContain("UNVERIFIED_SOURCE");
  });

  it("applies only dated COLA changes, sorted and rounded at each sourced boundary", () => {
    const a = award();
    const r = run([{ ...a, cola: { ...a.cola!, changes: [
      { ...factor("1.1"), year: 2026, effectiveAt: date("2026-03-15") },
      { ...factor("1.025"), year: 2026, effectiveAt: date("2026-02-16") },
    ] } }], period("2026-01-01", "2026-04-01"));
    expect(amounts(r)).toEqual(["1000", "1000", "1127.5"]);
    expect(r.proposals[2]!.traceRefs).toContain(source.ruleSnapshotId);
    expect(r.coverage.grossSchedule).toBe("complete");
  });
  it("does not reapply COLA already included in the quote's dollar basis", () => {
    const a = award();
    expect(amounts(run([{ ...a, cola: { ...a.cola!, changes: [{ ...factor("1.5"), year: 2026, effectiveAt: source.asOf }] } }]))).toEqual(["1000"]);
  });
  it("carries sourced pre-commencement COLA forward without assuming future COLA", () => {
    const a = award();
    const r = run([{ ...a, commencement: date("2026-03-15"), cola: { ...a.cola!, coveredHorizon: period("2026-01-01", "2026-04-01"), changes: [{ ...factor("1.02"), year: 2026, effectiveAt: date("2026-02-01") }] } }], period("2026-03-01", "2026-05-01"));
    expect(amounts(r)).toEqual(["1020"]);
    expect(r.coverage.grossSchedule).toBe("incomplete");
    expect(r.recipientMonths[1]!.grossAmount).toBeUndefined();
  });
  it("rejects ambiguous COLA dates and inconsistent rate years", () => {
    const a = award();
    const c = { ...factor("1.02"), year: 2026, effectiveAt: date("2026-02-01") };
    expect(codes({ ...a, cola: { ...a.cola!, changes: [c, c] } })).toContain("AMBIGUOUS_COLA");
    expect(codes({ ...a, cola: { ...a.cola!, changes: [{ ...c, year: 2027 }] } })).toContain("INVALID_COLA_DATE");
  });

  it.each(["0", "0.5", "1"])("pension survivor fraction %s changes only the continuation installment", fraction => {
    const a = award("pension");
    const r = run([{ ...a, participantDeathDate: date("2026-02-10"), claimingAdjustment: factor("0.7"),
      election: { ...a.election!, continuation: { ...factor(fraction), beneficiaryId: "beneficiary", effectiveAt: date("2026-02-15"), coversDeathBeforeCommencement: false } } }], period("2026-01-01", "2026-04-01"));
    expect(amounts(r)).toEqual(["1000", fraction === "0" ? "0" : fraction === "1" ? "1000" : "500", fraction === "0" ? "0" : fraction === "1" ? "1000" : "500"]);
    expect(r.proposals.map(p => p.actorId)).toEqual(["claimant", "beneficiary", "beneficiary"]);
    expect(r.proposals[1]).not.toHaveProperty("withholdingInstruction");
  });
  it("does not invent a deceased participant payment before survivor commencement", () => {
    const a = award("pension");
    const r = run([{ ...a, participantDeathDate: date("2026-01-10"),
      election: { ...a.election!, continuation: { ...factor("0.5"), beneficiaryId: "beneficiary", effectiveAt: date("2026-02-15"), coversDeathBeforeCommencement: true, endExclusive: date("2026-03-15") } } }], period("2026-01-01", "2026-04-01"));
    expect(amounts(r)).toEqual(["500"]);
    expect(r.diagnostics.map(d => d.diagnosticCode)).toContain("UNVERIFIED_PENSION_DEATH_TRANSITION_GAP");
    expect(r.recipientMonths).toContainEqual(expect.objectContaining({
      effectiveAt: "2026-01-15", coverage: "incomplete",
    }));
    expect(r.coverage.grossSchedule).toBe("incomplete");
  });
  it("projects a source-qualified survivor election while the participant is alive", () => {
    const a = award("pension");
    const elected = { ...a, election: { ...a.election!, continuation: {
      ...factor("0.5"), beneficiaryId: "beneficiary", effectiveAt: date("2026-07-15"),
      coversDeathBeforeCommencement: false,
    } } };
    const r = run([elected], period("2026-01-01", "2026-04-01"));
    expect(amounts(r)).toEqual(["1000", "1000", "1000"]);
    expect(r.diagnostics).toEqual([]);
  });
  it("requires explicit pre-commencement-death and beneficiary-death terms", () => {
    const a = award("pension");
    const c = { ...factor("0.5"), beneficiaryId: "beneficiary", effectiveAt: date("2026-01-15"), coversDeathBeforeCommencement: false };
    const p = { ...a, participantDeathDate: date("2026-01-10"), election: { ...a.election!, continuation: c } };
    expect(codes(p)).toContain("UNSUPPORTED_PRECOMMENCEMENT_DEATH");
    expect(codes({ ...p, beneficiaryDeathDate: date("2026-01-05"), election: { ...a.election!, continuation: { ...c, coversDeathBeforeCommencement: true } } })).toContain("MISSING_BENEFICIARY_DEATH_TERMS");
    expect(amounts(run([{ ...p, beneficiaryDeathDate: date("2026-01-15"), election: { ...a.election!, continuation: { ...c, coversDeathBeforeCommencement: true, endExclusive: date("2026-01-15") } } }]))).toEqual([]);
  });
  it("rejects incorrect beneficiary, mismatched election, and impossible transition dates", () => {
    const a = award("pension");
    expect(codes({ ...a, beneficiaryId: "wrong" })).toContain("INCORRECT_BENEFICIARY");
    expect(codes({ ...a, quote: { ...a.quote!, electionId: "other" } })).toContain("QUOTE_ELECTION_MISMATCH");
    expect(codes({ ...a, participantDeathDate: date("2026-02-01"), election: { ...a.election!, continuation: { ...factor("1"), beneficiaryId: "beneficiary", effectiveAt: date("2026-01-15"), coversDeathBeforeCommencement: true } } })).toContain("INVALID_DEATH_TRANSITION");
  });

  it.each(["divorced_spouse", "family_maximum", "special_survivor", "earnings_test"])("gates unsupported SSA %s", rule => {
    const a = award("ss_spousal");
    expect(codes({ ...a, verifiedAward: { ...a.verifiedAward!, unsupportedRules: [rule] } })).toContain("UNRESOLVED_SSA_RULES");
  });
  it("gates missing quote, eligibility, coordination, and unavailable source", () => {
    const a = award();
    const { quote: _q, ...noQuote } = a;
    const { verifiedAward: _v, ...noEligibility } = a;
    expect(codes(noQuote)).toContain("MISSING_QUOTE");
    expect(codes(noEligibility)).toContain("MISSING_VERIFIED_ELIGIBILITY");
    expect(codes({ ...a, verifiedAward: { ...a.verifiedAward!, eligibility: "unknown" } })).toContain("UNRESOLVED_SSA_RULES");
    expect(codes({ ...a, verifiedAward: { ...a.verifiedAward!, coordination: "unknown" } })).toContain("UNRESOLVED_SSA_RULES");
    expect(codes({ ...a, quote: { ...a.quote!, source: { ...source, sourcePublication: "" } } })).toContain("MISSING_SOURCE_IDENTITY");
    expect(codes({ ...a, quote: { ...a.quote!, source: { ...source, projectionStatus: "explicit_projected" } } })).toContain("UNVERIFIED_SOURCE");
    expect(run([{ ...a, verifiedAward: { ...a.verifiedAward!, eligibility: "ineligible" } }]).proposals).toEqual([]);
  });
  it("distinguishes worker death from recipient death and requires verified survivor eligibility", () => {
    const a = award("ss_survivor");
    expect(amounts(run([a]))).toEqual(["1000"]);
    const futureDeath = date("2026-02-01");
    expect(codes({ ...a, workerDeathDate: futureDeath, verifiedAward: { ...a.verifiedAward!, workerDeathDate: futureDeath } })).toContain("MISSING_SURVIVOR_DEATH_FACT");
    expect(codes({ ...a, recipientDeathDate: date("2026-01-15") })).toContain("SSA_DEATH_REQUIRES_REVISED_AWARD");
  });

  it("has exact commencement, stop, end-exclusive, annual, leap-day and invalid-day behavior", () => {
    const a = award();
    expect(amounts(run([{ ...a, endExclusive: date("2026-01-15") }]))).toEqual([]);
    expect(amounts(run([a], period("2026-01-01", "2026-01-15")))).toEqual([]);
    expect(amounts(run([a], period("2026-01-15", "2026-01-16")))).toEqual(["1000"]);
    expect(amounts(run([{ ...a, frequency: "annual" }], period()))).toEqual(["1000"]);
    const skipped = run([{ ...a, commencement: date("2026-01-31") }], period("2026-01-01", "2026-04-01"));
    expect(skipped.proposals.map(p => p.effectiveAt)).toEqual(["2026-01-31", "2026-03-31"]);
    const p = period("2028-01-01", "2030-01-01");
    const leap = { ...a, claimingMonth: date("2028-02-01"), commencement: date("2028-02-29"), frequency: "annual" as const,
      quote: { ...a.quote!, claimingMonth: date("2028-02-01"), dollarBasisAt: p.start, coveredHorizon: p },
      cola: { source, coveredHorizon: p, changes: [] }, verifiedAward: { ...a.verifiedAward!, claimingMonth: date("2028-02-01"), coveredHorizon: p } };
    expect(run([leap], p).proposals.map(x => x.effectiveAt)).toEqual(["2028-02-29"]);
  });

  it("uses currency precision and explicit rounding, never floating money", () => {
    const a = award();
    const quoted = { ...a, quote: { ...a.quote!, grossAmount: money("1.01"), basis: "full_retirement_age" as const } };
    expect(amounts(run([{ ...quoted, claimingAdjustment: factor("0.5", "half_even") }]))).toEqual(["0.5"]);
    expect(amounts(run([{ ...quoted, claimingAdjustment: factor("0.5", "half_up") }]))).toEqual(["0.51"]);
    expect(codes({ ...a, quote: { ...a.quote!, grossAmount: money("-1") } })).toContain("INVALID_EXACT_MONEY");
    expect(codes({ ...a, quote: { ...a.quote!, grossAmount: money("0.001") } })).toContain("INVALID_EXACT_MONEY");
    expect(codes({ ...a, withholding: { amount: money("1", Currency.of("EUR")), source } })).toContain("CURRENCY_MISMATCH");
    const { withholding: _w, ...bare } = a;
    const jpy = { ...bare, quote: { ...a.quote!, grossAmount: money("101", Currency.of("JPY")), basis: "full_retirement_age" as const } };
    expect(amounts(run([{ ...jpy, claimingAdjustment: factor("0.5", "half_even", 0) }]))).toEqual(["50"]);
    expect(codes({ ...jpy, claimingAdjustment: factor("0.5") })).toContain("INVALID_ROUNDING_SCALE");
  });
  it("keeps gross, authored withholding and potential Medicare deduction separate", () => {
    const r = run([{ ...award(), medicareDeduction: { amount: money("200"), source } }]);
    expect(amounts(r)).toEqual(["1000"]);
    expect(r.proposals[0]!.withholdingInstruction!.amount.toString()).toBe("100");
    expect(r.proposals[0]!.potentialMedicareDeduction!.amount.toString()).toBe("200");
    expect(r.coverage.tax).toBe("incomplete");
    expect(r.coverage.netCash).toBe("incomplete");
  });

  it("replays without mutation and is invariant to household inventory order", () => {
    const input = [award("ss_retirement", "alice"), award("ss_spousal", "bob"), award("pension", "alice")];
    const before = JSON.stringify(input);
    const r = run(input);
    expect(r.proposals).toHaveLength(3);
    expect(new Set(r.proposals.map(p => p.operationId)).size).toBe(3);
    expect(run(input)).toEqual(r);
    expect(run([...input].reverse())).toEqual(r);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("keeps idempotency identity stable across source quote revisions", () => {
    const a = award();
    const revised = { ...a, awardId: "revised-quote", quote: { ...a.quote!, source: { ...source, ruleSnapshotId: "new-evidence/v2", version: "2" } } };
    expect(run([revised]).proposals[0]!.operationId).toBe(run([a]).proposals[0]!.operationId);
  });
  it("isolates incomplete recipients and never substitutes zero for missing quotes", () => {
    const alice = award("ss_retirement", "alice");
    const bob = award("ss_retirement", "bob");
    const { quote: _quote, ...missing } = bob;
    const r = run([alice, missing]);
    expect(amounts(r)).toEqual(["1000"]);
    expect(r.proposals[0]!.actorId).toBe("alice");
    expect(r.coverage.grossSchedule).toBe("incomplete");
    expect(r.diagnostics[0]!.sourceEntityPath).toContain(bob.awardId);
    expect(codes({ ...alice, verifiedAward: { ...alice.verifiedAward!, recipientPersonId: "wrong" } })).toContain("INCORRECT_AWARD_RECIPIENT");
  });
  it("rejects both duplicate awards, duplicate entitlements and full overlapping SSA benefits", () => {
    const a = award();
    expect(run([a, a]).proposals).toEqual([]);
    const p = award("pension");
    expect(run([p, { ...p, awardId: "requoted" }]).proposals).toEqual([]);
    const spouse = award("ss_spousal");
    expect(run([a, spouse]).proposals).toEqual([]);
    expect(run([a, spouse]).diagnostics.map(d => d.diagnosticCode)).toEqual(["UNCOORDINATED_SSA_AWARDS", "UNCOORDINATED_SSA_AWARDS"]);
  });
  it("admits exclusive successive SSA awards instead of overlapping own and survivor payments", () => {
    const own = { ...award(), endExclusive: date("2026-02-01") };
    const survivor = { ...award("ss_survivor"), commencement: date("2026-02-15") };
    expect(amounts(run([own, survivor], period("2026-01-01", "2026-03-01")))).toEqual(["1000", "1000"]);
  });
  it("bounds repeated diagnostics while preserving unknown period amounts", () => {
    const a = award();
    const r = run([{ ...a, quote: { ...a.quote!, coveredHorizon: period("2026-01-01", "2026-02-01") } }], period());
    expect(r.diagnostics).toHaveLength(1);
    expect(r.recipientMonths.filter(p => p.coverage === "incomplete")).toHaveLength(11);
    expect(amounts(r)).toEqual(["1000"]);
  });
});
