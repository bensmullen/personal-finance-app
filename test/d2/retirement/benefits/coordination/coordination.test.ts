import { describe, expect, it } from "vitest";
import { coordinateSocialSecurity, type Determination, type EntitlementQuote, type Evidence, type Recipient } from "../../../../../src/simulation/d2/retirement/benefits/coordination/index.js";
import { calculateQuotedBenefits, type BenefitPeriod, type QuotedBenefit } from "../../../../../src/simulation/d2/retirement/benefits/index.js";
import { civilDate as date } from "../../../../../src/time/index.js";
import { money, Ratio, RoundingPolicy } from "../../../../../src/values/index.js";

const period = (start = "2026-01-01", endExclusive = "2027-01-01"): BenefitPeriod => ({ start: date(start), endExclusive: date(endExclusive) });
const evidence = (id: string, effective = period()): Evidence => ({ evidenceId: id, coverageSetId: "coverage:1",
  knownAt: date("2025-12-01"), publishedAt: date("2025-11-01"), effective,
  source: { ruleSnapshotId: `synthetic:${id}`, jurisdiction: "US", ruleFamily: "synthetic_ssa_award",
    sourcePublication: "synthetic legal/payment determination; not official SSA law", asOf: date("2025-11-01"), version: "1", projectionStatus: "verified" } });
function quote(role: EntitlementQuote["role"], amount: string, kind: QuotedBenefit["benefitKind"] = role === "own" ? "ss_retirement" : "ss_spousal", person = "alice"): EntitlementQuote {
  const e = evidence(`${person}:${role}`), worker = kind === "ss_retirement" ? person : `${person}:spouse`;
  return { quoteId: `${person}:${role}`, role, evidence: e, award: {
    awardId: `${person}:${role}:award`, entitlementId: `${person}:${role}:entitlement`, householdId: "household",
    recipientPersonId: person, workerRecordPersonId: worker, benefitKind: kind,
    claimingMonth: date("2026-01-01"), commencement: date("2026-01-15"), frequency: "monthly", invalidDayPolicy: "skip", calendarSource: e.source,
    quote: { recipientPersonId: person, workerRecordPersonId: worker, claimingMonth: date("2026-01-01"),
      grossAmount: money(amount), basis: "at_claim", adjustmentOrder: "claiming_then_cola_then_continuation",
      asOf: e.source.asOf, dollarBasisAt: date("2026-01-01"), source: e.source, coveredHorizon: period() },
    cola: { source: e.source, coveredHorizon: period(), changes: [] },
    verifiedAward: { recipientPersonId: person, workerRecordPersonId: worker, claimingMonth: date("2026-01-01"),
      source: e.source, coveredHorizon: period(), eligibility: "eligible", coordination: role === "excess" ? "unknown" : "total_payable_award", unsupportedRules: [] },
  } };
}
function recipient(person = "alice"): Recipient {
  const own = quote("own", "1500", "ss_retirement", person), excess = quote("excess", "200", "ss_spousal", person);
  return { recipientPersonId: person, enabled: true, quotes: [own, excess], determinations: [{
    determinationId: `${person}:legal`, electionId: `${person}:election`, versionId: "v1", evidence: evidence(`${person}:legal`),
    inventoryComplete: true, inventoryQuoteIds: [own.quoteId, excess.quoteId], strategy: "own_plus_excess", benefitKind: "ss_spousal",
    ownQuoteId: own.quoteId, excessQuoteId: excess.quoteId, paymentAwardId: `${person}:payment`, paymentEntitlementId: `${person}:ssa`,
    paymentWorkerRecordPersonId: `${person}:spouse`, claimingMonth: date("2026-01-01"), installmentDay: "15", eligibility: "eligible",
    relationship: "married", relationshipEvidence: evidence(`${person}:marriage`), unsupportedRules: [],
    excessUnderOwn: { ownQuoteId: own.quoteId, claimedOwnAmount: money("1500"), evidence: evidence(`${person}:payable-excess`) },
  }] };
}
const run = (r: readonly Recipient[] = [recipient()], horizon = period("2026-01-01", "2026-02-01"), knownAt = date("2026-01-01")) =>
  coordinateSocialSecurity({ householdId: "household", horizon, knownAt, recipients: r });
const change = (r: Recipient, d: Partial<Determination>): Recipient => ({ ...r, determinations: [{ ...r.determinations[0]!, ...d }] });
const codes = (r: Recipient) => run([r]).diagnostics.map(d => d.diagnosticCode);
function withTotal(amount = "1700"): Recipient {
  const r = recipient(), total = quote("total", amount);
  return change({ ...r, quotes: [...r.quotes, total] }, { totalQuoteId: total.quoteId,
    inventoryQuoteIds: [...r.determinations[0]!.inventoryQuoteIds, total.quoteId] });
}

describe("isolated SSA coordination (prep cases remain conditional, no integrated runtime claim)", () => {
  it("coordinates 150000 own cents plus 20000 sourced excess cents into exactly one 170000 cent A1 award", () => {
    const result = run(), p = result.proposals[0]!;
    expect(result.diagnostics).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    expect(p.grossAmount.equals(money("1700"))).toBe(true);
    expect(p.workerRecordPersonIds).toEqual(["alice", "alice:spouse"]);
    expect(p.traceRefs).toContain("alice:payable-excess");
    expect(p.quotedAward.workerRecordPersonId).toBe("alice:spouse");
    const final = calculateQuotedBenefits({ householdId: "household", horizon: period("2026-01-01", "2026-02-01"), awards: [p.quotedAward] });
    expect(final.proposals).toHaveLength(1);
    expect(final.proposals[0]!.grossAmount.equals(money("1700"))).toBe(true);
    expect(final.proposals[0]!.claimId).toBe(p.claimId);
    expect(p.committed).toBe(false);
    expect(p).not.toHaveProperty("netCash");
    expect(p).not.toHaveProperty("taxable");
  });
  it("prefers an independently verified consistent total and rejects a conflicting total", () => {
    expect(run([withTotal()]).proposals[0]!.quotedAward.quote!.source.ruleSnapshotId).toBe("synthetic:alice:total");
    expect(codes(withTotal("1700.01"))).toContain("TOTAL_CONFLICT");
    expect(run([withTotal("1700.01")]).proposals).toEqual([]);
  });
  it("admits a final total without fabricating an excess calculation", () => {
    const r = withTotal();
    const { ownQuoteId: _own, excessQuoteId: _excess, excessUnderOwn: _terms, ...d } = r.determinations[0]!;
    expect(run([{ ...r, determinations: [{ ...d, strategy: "replacement" }] }]).proposals[0]!.grossAmount.equals(money("1700"))).toBe(true);
  });
  it("rejects two full awards, absent excess attestation and mismatched claimed-own amount", () => {
    const r = recipient(), d = r.determinations[0]!;
    expect(codes({ ...r, quotes: [r.quotes[0]!, { ...r.quotes[1]!, role: "full_other" }] })).toContain("INVALID_QUOTE");
    const { excessUnderOwn: _terms, ...missing } = d;
    expect(codes({ ...r, determinations: [missing] })).toContain("UNQUALIFIED_EXCESS");
    expect(codes(change(r, { excessUnderOwn: { ...d.excessUnderOwn!, claimedOwnAmount: money("1501") } }))).toContain("UNQUALIFIED_EXCESS");
  });
  it("requires complete inventory and rejects duplicate quote IDs and overlapping determinations", () => {
    const r = recipient();
    expect(codes(change(r, { inventoryComplete: false }))).toContain("INCOMPLETE_INVENTORY");
    expect(codes(change(r, { inventoryQuoteIds: [r.quotes[0]!.quoteId] }))).toContain("INCOMPLETE_INVENTORY");
    const duplicates = [...r.quotes, r.quotes[0]!];
    expect(codes(change({ ...r, quotes: duplicates }, { inventoryQuoteIds: duplicates.map(q => q.quoteId) }))).toContain("INCOMPLETE_INVENTORY");
    expect(codes({ ...r, determinations: [r.determinations[0]!, r.determinations[0]!] })).toContain("AMBIGUOUS_DETERMINATION");
    const own = r.quotes[0]!, excess = r.quotes[1]!;
    expect(codes({ ...r, quotes: [own, { ...excess, award: { ...excess.award, entitlementId: own.award.entitlementId } }] })).toContain("DUPLICATE_IDENTITY");
  });
  it.each(["divorced_spouse", "family_maximum", "earnings_test", "future_ssa_rule"])("gates unresolved %s", rule => {
    expect(codes(change(recipient(), { unsupportedRules: [rule] }))).toContain("UNSUPPORTED_RULES");
  });
  it("requires eligibility, marriage and correct beneficiary", () => {
    const r = recipient();
    expect(codes(change(r, { eligibility: "unknown" }))).toContain("MISSING_ELIGIBILITY");
    expect(codes(change(r, { relationship: "unknown" }))).toContain("MISSING_RELATIONSHIP");
    expect(codes(change(r, { relationship: "divorced" }))).toContain("UNSUPPORTED_RULES");
    expect(codes({ ...r, quotes: r.quotes.map(q => ({ ...q, award: { ...q.award, recipientPersonId: "wrong" } })) })).toContain("INVALID_IDENTITY");
  });
  it("rejects before-publication, unknown future evidence and mixed source coverage", () => {
    const r = recipient(), d = r.determinations[0]!;
    expect(run([r], undefined, date("2025-10-01")).diagnostics[0]!.diagnosticCode).toBe("UNAVAILABLE_EVIDENCE");
    expect(codes(change(r, { evidence: { ...d.evidence, publishedAt: date("2026-02-01") } }))).toContain("UNAVAILABLE_EVIDENCE");
    const laterEvidence = { ...d.evidence, publishedAt: date("2026-01-20"),
      knownAt: date("2026-01-20"), source: { ...d.evidence.source, asOf: date("2026-01-20") } };
    // Even when a later replay knows the determination, it was not available
    // for the January 15 installment and cannot backfill the payment.
    expect(run([change(r, { evidence: laterEvidence })], period("2026-01-01", "2026-02-01"),
      date("2026-02-01")).diagnostics[0]!.diagnosticCode).toBe("UNAVAILABLE_EVIDENCE");
    expect(codes(change(r, { evidence: { ...d.evidence, source: { ...d.evidence.source, projectionStatus: "explicit_projected" } } }))).toContain("UNAVAILABLE_EVIDENCE");
    expect(codes({ ...r, quotes: r.quotes.map(q => ({ ...q, evidence: { ...q.evidence, coverageSetId: "unrelated" } })) })).toContain("SOURCE_MIX");
    const q = r.quotes[0]!;
    expect(codes({ ...r, quotes: [{ ...q, award: { ...q.award, calendarSource: { ...q.award.calendarSource, ruleSnapshotId: "other" } } }, r.quotes[1]!] })).toContain("SOURCE_MIX");
  });
  it("returns unsupported for distinct due dates and uncovered installment dollars", () => {
    const r = recipient(), q = r.quotes[1]!;
    expect(codes({ ...r, quotes: [r.quotes[0]!, { ...q, award: { ...q.award, commencement: date("2026-01-20") } }] })).toContain("UNSUPPORTED_PAYMENT_STRUCTURE");
    expect(codes({ ...r, quotes: [r.quotes[0]!, { ...q, award: { ...q.award, quote: { ...q.award.quote!, dollarBasisAt: date("2025-12-01") } } }] })).toContain("UNQUALIFIED_EXCESS");
    expect(codes({ ...r, quotes: [r.quotes[0]!, { ...q, award: { ...q.award, workerRecordPersonId: "wrong" } }] })).toContain("INVALID_IDENTITY");
  });
  it("never reapplies age adjustment or COLA already included in dollar basis", () => {
    const r = recipient();
    const altered = { ...r, quotes: r.quotes.map(q => ({ ...q, award: { ...q.award,
      claimingAdjustment: { factor: Ratio.parse("0.5"), rounding: new RoundingPolicy(2, "half_even"), source: q.evidence.source },
      cola: { ...q.award.cola!, changes: [{ year: 2026, effectiveAt: date("2026-01-01"), factor: Ratio.parse("1.1"), rounding: new RoundingPolicy(2, "half_even"), source: q.evidence.source }] },
    } })) };
    expect(run([altered]).proposals[0]!.grossAmount.equals(money("1700"))).toBe(true);
    expect(run([altered]).proposals[0]!.quotedAward).not.toHaveProperty("claimingAdjustment");
  });
  it("is immutable, deterministic under replay/input order and exact beyond safe integer cents", () => {
    const a = recipient(), b = recipient("bob"), before = JSON.stringify([a, b]);
    const first = run([a, b]), second = run([{ ...b, quotes: [...b.quotes].reverse() }, { ...a, quotes: [...a.quotes].reverse() }]);
    expect(second).toEqual(first);
    expect(run([a, b])).toEqual(first);
    expect(JSON.stringify([a, b])).toBe(before);
    expect(Object.isFrozen(first.proposals[0]!.quotedAward.quote)).toBe(true);
    expect(Object.isFrozen(a.quotes[0]!.award)).toBe(false);
    expect(first.proposals.map(p => p.quotedAward.workerRecordPersonId)).toEqual(["alice:spouse", "bob:spouse"]);
    const own = quote("own", "9007199254740993.01"), excess = a.quotes[1]!;
    const large = change({ ...a, quotes: [own, excess] }, { excessUnderOwn: { ...a.determinations[0]!.excessUnderOwn!, claimedOwnAmount: money("9007199254740993.01") } });
    expect(run([large]).proposals[0]!.grossAmount.equals(money("9007199254741193.01"))).toBe(true);
  });
  it("does not pay disabled or deceased recipients and blocks shared payment identities", () => {
    expect(run([{ ...recipient(), enabled: false }]).recipientMonths[0]!.coverage).toBe("not_applicable");
    expect(codes({ ...recipient(), recipientDeathDate: date("2026-01-15") })).toContain("RECIPIENT_DECEASED");
    const a = recipient(), b = change(recipient("bob"), { paymentEntitlementId: "alice:ssa" });
    const result = run([a, b]);
    expect(result.proposals).toEqual([]);
    expect(result.diagnostics.every(d => d.diagnosticCode === "DUPLICATE_IDENTITY")).toBe(true);
  });
  it("materializes multiple months with stable claim identity and one A1 proposal per installment", () => {
    const result = run(undefined, period("2026-01-01", "2026-04-01"));
    const final = calculateQuotedBenefits({ householdId: "household", horizon: period("2026-01-01", "2026-04-01"), awards: result.proposals.map(p => p.quotedAward) });
    expect(final.diagnostics).toEqual([]);
    expect(final.proposals).toHaveLength(3);
    expect(new Set(final.proposals.map(p => p.claimId)).size).toBe(3);
    expect(new Set(result.proposals.map(p => p.quotedAward.entitlementId)).size).toBe(1);
  });
});

function survivorRecipient(): Recipient {
  const r = recipient(), own = r.quotes[0]!, raw = quote("total", "2100", "ss_survivor");
  const total: EntitlementQuote = { ...raw, award: { ...raw.award, commencement: date("2026-03-15"), workerDeathDate: date("2026-02-10"),
    verifiedAward: { ...raw.award.verifiedAward!, workerDeathDate: date("2026-02-10") } } };
  const inventoryQuoteIds = [own.quoteId, total.quoteId], d = r.determinations[0]!;
  const prior: Determination = { ...d, evidence: evidence("own-legal", period("2026-01-01", "2026-02-01")),
    strategy: "own", benefitKind: "ss_retirement", paymentWorkerRecordPersonId: "alice", relationship: "self", inventoryQuoteIds };
  const { excessQuoteId: _excess, excessUnderOwn: _terms, ownQuoteId: _own, ...base } = d;
  const next: Determination = { ...base, determinationId: "survivor-legal", electionId: "survivor-election", evidence: evidence("survivor-legal", period("2026-03-01")),
    strategy: "replacement", benefitKind: "ss_survivor", totalQuoteId: total.quoteId, inventoryQuoteIds, relationship: "widowed",
    survivor: { workerRecordPersonId: "alice:spouse", workerDeathDate: date("2026-02-10"), effectiveAt: date("2026-03-15"),
      deathMonthRuleId: "synthetic:death-month-gap", overlapRuleId: "synthetic:replace-own", partialMonthTerms: "whole_installment", evidence: evidence("survivor-switch") } };
  const { excessQuoteId: _priorExcess, excessUnderOwn: _priorTerms, ...onlyOwn } = prior;
  return { ...r, quotes: [own, total], determinations: [onlyOwn, next] };
}
describe("sourced survivor switch", () => {
  it("replaces own exactly at the elected boundary and leaves the death-month gap unavailable", () => {
    const r = survivorRecipient(), result = run([r], period("2026-01-01", "2026-05-01"));
    expect(result.proposals.map(p => [p.effectiveAt, p.grossAmount.amount.toString()])).toEqual([
      ["2026-01-15", "1500"], ["2026-03-15", "2100"], ["2026-04-15", "2100"],
    ]);
    expect(result.recipientMonths[1]!.coverage).toBe("incomplete");
    expect(result.diagnostics[0]!.diagnosticCode).toBe("MISSING_DETERMINATION");
    expect(result.proposals[1]!.traceRefs).toContain("synthetic:replace-own");
    expect(result.proposals[1]!.quotedAward.workerRecordPersonId).toBe("alice:spouse");
    expect(run([{ ...r, determinations: [...r.determinations].reverse() }], period("2026-01-01", "2026-05-01"))).toEqual(result);
  });
  it("requires worker death, election, partial-month and overlap terms", () => {
    const r = survivorRecipient(), next = r.determinations[1]!;
    for (const survivor of [{ ...next.survivor!, workerRecordPersonId: "wrong" }, { ...next.survivor!, overlapRuleId: "" },
      { ...next.survivor!, effectiveAt: date("2026-04-15") }, { ...next.survivor!, partialMonthTerms: "unsupported" as const }]) {
      expect(run([{ ...r, determinations: [{ ...next, survivor }] }], period("2026-03-01", "2026-04-01")).diagnostics[0]!.diagnosticCode).toBe("UNRESOLVED_SURVIVOR");
    }
    expect(run([{ ...r, determinations: [{ ...next, electionId: "" }] }], period("2026-03-01", "2026-04-01")).proposals).toEqual([]);
  });
  it("admits survivor excess only with the same explicit own-amount attestation", () => {
    const r = survivorRecipient(), next = r.determinations[1]!, raw = quote("excess", "600", "ss_survivor");
    const excess: EntitlementQuote = { ...raw, award: { ...raw.award, commencement: date("2026-03-15"), workerDeathDate: date("2026-02-10"),
      verifiedAward: { ...raw.award.verifiedAward!, workerDeathDate: date("2026-02-10") } } };
    const own = r.quotes[0]!;
    const coordinated: Recipient = { ...r, quotes: [own, excess], determinations: [{ ...next,
      strategy: "own_plus_excess", ownQuoteId: own.quoteId, excessQuoteId: excess.quoteId,
      inventoryQuoteIds: [own.quoteId, excess.quoteId],
      excessUnderOwn: { ownQuoteId: own.quoteId, claimedOwnAmount: money("1500"), evidence: evidence("survivor-excess") },
    }] };
    const { totalQuoteId: _total, ...d } = coordinated.determinations[0]!;
    const result = run([{ ...coordinated, determinations: [d] }], period("2026-03-01", "2026-04-01"));
    expect(result.diagnostics).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.grossAmount.equals(money("2100"))).toBe(true);
  });
});
