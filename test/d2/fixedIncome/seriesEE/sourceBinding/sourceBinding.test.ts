import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bindSeriesEESources, eeOriginalIdentity, eeRequestDigest, type EEBinding, type EEOriginal } from "../../../../../src/simulation/d2/fixedIncome/seriesEE/sourceBinding/index.js";
import type { EERequest, EESource } from "../../../../../src/simulation/d2/fixedIncome/seriesEE/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { civilDate } from "../../../../../src/time/index.js";
import { decimal, money, RoundingPolicy } from "../../../../../src/values/index.js";

// Independently authored illustrative evidence; none of these are Treasury terms.
const month = (n: number) => civilDate(`2020-${String(n + 1).padStart(2, "0")}-01`);
const publication = "SYNTHETIC_ORIGINAL_DOCUMENT_ONLY:" + "issuer appendix ".repeat(80);
const source = (id: string, jurisdiction = "US"): EESource => ({ sourceId: id, ruleSnapshotId: `${id}:law`,
  ruleFamily: "series_ee", sourcePublication: publication, authority: "externally_verified", version: "illustration-1",
  publishedAt: month(0), asOf: month(0), jurisdiction, start: month(0), endExclusive: civilDate("2022-01-01"), projectionStatus: "verified" });
const original = (id = "000"): EEOriginal => {
  const s = source(`evidence:${id}`);
  const request: EERequest = {
    lot: { householdId: "house", personId: "original-owner", beneficiaryId: "beneficiary", holdingId: `holding:${id}`,
      bondId: `bond:${id}`, lotId: `lot:${id}`, basisId: `basis:${id}`, wrapperId: "wrapper", taxBucket: "taxable",
      stateJurisdiction: "US:STATE", localJurisdiction: "US:STATE:CITY", fundingAccountId: "purchase-bank",
      destination: { accountId: "wrapper-cash", personId: "original-owner", wrapperId: "wrapper", kind: "wrapper_cash" },
      issueMonth: month(0), purchaseDate: month(0), acquisitionDate: month(0), face: money("200"), purchaseCost: money("100"),
      acquisitionCost: money("100"), treatment: "ordinary_original_owner", source: s,
      opening: { at: month(0), carrying: money("100"), purchaseBasis: money("100"), recognizedFederalInterest: money("0"),
        election: "redemption", redeemed: false, source: s } },
    period: { start: month(0), endExclusive: month(4) }, effectiveAt: month(3), knownAt: month(3), action: "redemption",
    rule: { issueMonth: month(0), source: s, method: "fixed_issue_schedule", posting: "monthly_interest_rounded_then_capitalized",
      interestRounding: new RoundingPolicy(2, "half_up"), capitalizationMonths: 1, stopAccruingAt: month(11),
      firstRedeemableAt: month(1), penalty: { endExclusive: month(1), forfeitureMonths: 1, treatment: "last_monthly_interest_only" },
      guarantee: null, schedule: Array.from({ length: 11 }, (_, i) => ({ start: month(i), endExclusive: month(i + 1),
        periodRate: decimal("0.01"), capitalize: true, source: s })) },
    taxRules: ["US", "US:STATE", "US:STATE:CITY"].map(jurisdiction => ({ source: source(`tax:${id}:${jurisdiction}`, jurisdiction),
      issueMonth: month(0), election: "redemption", treatment: jurisdiction === "US" ? "federal_interest_less_previously_recognized" : "state_local_exempt" })),
    redemptionQuote: { quoteId: `quote:${id}`, at: month(3), amount: money("103.03"), source: { ...s, asOf: month(3) } },
  };
  return { sourceId: `publisher:${id}`, version: "original-1", status: "active", request };
};
const pin = (o: EEOriginal, occurrenceId = o.sourceId): EEBinding => ({ occurrenceId, sourceId: o.sourceId,
  sourceVersion: o.version, digest: eeRequestDigest(o.request), identity: eeOriginalIdentity(o.request.lot),
  action: o.request.action, effectiveAt: o.request.effectiveAt, knownAt: o.request.knownAt, period: o.request.period });
const bind = (o: EEOriginal) => bindSeriesEESources([pin(o)], () => o);
const changed = (o: EEOriginal, request: EERequest): EEOriginal => ({ ...o, request });

describe("independent original Series EE source binder", () => {
  it("re-reads publisher and emits exact conditional original-cost redemption character", () => {
    const o = original(); const before = canonicalSerialize(o); let reads = 0;
    const result = bindSeriesEESources([pin(o)], id => { expect(id).toBe(o.sourceId); reads++; return o; });
    expect(reads).toBe(2); expect(result.diagnostics).toEqual([]);
    const c = result.occurrences[0]!;
    expect(c).toMatchObject({ committed: false, postable: false, funding: "incomplete", physicalRedemption: "incomplete", kind: "redemption" });
    expect(c.summary.cashDelta.equals(money("103.03"))).toBe(true);
    expect(c.summary.redeemedPrincipal.equals(money("100"))).toBe(true);
    expect(c.summary.basisDelta.equals(money("-100"))).toBe(true);
    expect(c.taxCharacter.find(t => t.jurisdiction === "US")!.taxable.equals(money("3.03"))).toBe(true);
    expect(c.coverage.find(x => x.affectedOutput === "settlement")!.coverage).toBe("incomplete");
    expect(Object.isFrozen(c.summary)).toBe(true); expect(canonicalSerialize(o)).toBe(before);
    expect(bind(o)).toEqual(result);
  });
  it("binds sourced monthly noncash accrual, separate forfeiture and guarantee illustrations", () => {
    const o = original(); const r = o.request;
    const accrue = bind(changed(o, { ...r, action: "valuation", effectiveAt: month(1) })).occurrences[0]!;
    expect(accrue.summary.assetDelta.equals(money("1"))).toBe(true); expect(accrue.summary.cashDelta.isZero()).toBe(true);
    const penalty = bind(changed(o, { ...r, rule: { ...r.rule!, penalty: { ...r.rule!.penalty, endExclusive: month(6) } },
      redemptionQuote: { ...r.redemptionQuote!, amount: money("102.01") } })).occurrences[0]!;
    expect(penalty.summary.values.forfeitedInterest.equals(money("1.02"))).toBe(true);
    expect(penalty.summary.cashDelta.equals(money("102.01"))).toBe(true);
    const guarantee = bind(changed(o, { ...r, rule: { ...r.rule!, guarantee: { at: month(3), purchaseMultiple: decimal("2"), eligible: true } },
      redemptionQuote: { ...r.redemptionQuote!, amount: money("200") } })).occurrences[0]!;
    expect(guarantee.summary.values.guaranteeUplift.equals(money("96.97"))).toBe(true);
    expect(guarantee.summary.cashDelta.equals(money("200"))).toBe(true);
  });
  it("does not tax previously recognized interest twice", () => {
    const o = original(); const r = o.request;
    const next = changed(o, { ...r, period: { ...r.period, start: month(1) }, lot: { ...r.lot,
      opening: { ...r.lot.opening, at: month(1), carrying: money("101"), recognizedFederalInterest: money("1"),
        source: { ...r.lot.opening.source, asOf: month(1) } } } });
    const c = bind(next).occurrences[0]!;
    expect(c.taxCharacter.find(t => t.jurisdiction === "US")!.taxable.equals(money("2.03"))).toBe(true);
    expect(c.summary.netWorthDelta.equals(money("2.03"))).toBe(true);
  });
  it("pins complete canonical input with fixed-size v1 SHA-256, including unused future rows", () => {
    const o = original(); const p = pin(o);
    expect(p.digest).toBe(`ee-request/v1:sha256:${createHash("sha256").update(canonicalSerialize(o.request)).digest("hex")}`);
    expect(p.digest).toMatch(/^ee-request\/v1:sha256:[a-f0-9]{64}$/);
    const updates: EEOriginal[] = [
      { ...o, version: "original-2" }, { ...o, sourceId: "other-publisher" },
      changed(o, { ...o.request, redemptionQuote: { ...o.request.redemptionQuote!, amount: money("103.04") } }),
      changed(o, { ...o.request, rule: { ...o.request.rule!, schedule: o.request.rule!.schedule.map((row, i) => i === 10 ? { ...row, periodRate: decimal("0.02") } : row) } }),
      changed(o, { ...o.request, taxRules: [] }),
    ];
    for (const updated of updates) {
      const result = bindSeriesEESources([p], () => updated);
      expect(result.occurrences).toEqual([]); expect(result.diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
    }
  });
  it("refuses absent, withdrawn, stale and mid-read changed publisher originals", () => {
    const o = original(); const p = pin(o);
    for (const fetched of [undefined, { ...o, status: "withdrawn" as const }]) {
      expect(bindSeriesEESources([p], () => fetched).diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
    }
    expect(bindSeriesEESources([p], () => { throw new Error("offline"); }).diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
    for (const updated of [undefined, { ...o, status: "withdrawn" as const }, { ...o, version: "new-version" },
      changed(o, { ...o.request, knownAt: month(4) })]) {
      let reads = 0;
      const result = bindSeriesEESources([p], () => ++reads === 1 ? o : updated);
      expect(reads).toBe(2); expect(result.occurrences).toEqual([]); expect(result.diagnostics).toHaveLength(1);
    }
    expect(bindSeriesEESources([{ ...p, digest: canonicalSerialize(o.request) }], () => o).diagnostics[0]!.code).toBe("INVALID_BINDING");
  });
  it("refuses consumer identity, cost, wrapper, beneficiary and event rewrites", () => {
    const o = original(); const p = pin(o);
    for (const identity of [{ ...p.identity, personId: "inheritor" }, { ...p.identity, lotId: "another-lot" },
      { ...p.identity, basisId: "another-basis" }, { ...p.identity, purchaseCost: money("100.01") },
      { ...p.identity, wrapperId: "other-wrapper" }, { ...p.identity, beneficiaryId: "other" },
      { ...p.identity, destination: { ...p.identity.destination, accountId: "bank" } }]) {
      expect(bindSeriesEESources([{ ...p, identity }], () => o).diagnostics[0]!.code).toBe("IDENTITY_MISMATCH");
    }
    expect(bindSeriesEESources([{ ...p, effectiveAt: month(4) }], () => o).diagnostics[0]!.code).toBe("EVENT_MISMATCH");
  });
  it("rejects incomplete vintage, quote delta, early redemption, future evidence and unsupported ownership", () => {
    const o = original(); const r = o.request;
    const requests: EERequest[] = [
      { ...r, redemptionQuote: { ...r.redemptionQuote!, amount: money("103.04") } },
      { ...r, rule: { ...r.rule!, firstRedeemableAt: month(4), penalty: { ...r.rule!.penalty, endExclusive: month(4) } } },
      { ...r, rule: { ...r.rule!, schedule: r.rule!.schedule.slice(1) } },
      { ...r, rule: { ...r.rule!, issueMonth: month(1) } },
      { ...r, rule: { ...r.rule!, source: { ...r.rule!.source, projectionStatus: "explicit_projected" } } },
      { ...r, rule: { ...r.rule!, source: { ...r.rule!.source, asOf: month(4) } }, knownAt: month(5) },
      { ...r, lot: { ...r.lot, treatment: "inherited" } }, { ...r, action: "education_redemption" },
      { ...r, lot: { ...r.lot, opening: { ...r.lot.opening, purchaseBasis: money("99") } } },
    ];
    for (const request of requests) {
      const result = bind(changed(o, request));
      expect(result.occurrences).toEqual([]); expect(result.diagnostics[0]!.code).toBe("EVALUATION_INCOMPLETE");
      expect(result.diagnostics[0]!.outputs!.some(x => x.coverage === "incomplete")).toBe(true);
    }
  });
  it("keeps valid economics separate from incomplete federal/state/local fiscal facts", () => {
    const o = original(); const r = o.request;
    for (const request of [{ ...r, taxRules: [] }, { ...r, lot: { ...r.lot, opening: { ...r.lot.opening, election: "unsupported" as const } } },
      { ...r, taxRules: r.taxRules.map(t => ({ ...t, source: { ...t.source, asOf: month(4) } })), knownAt: month(5) },
      { ...r, taxRules: r.taxRules.map(t => ({ ...t, source: { ...t.source, jurisdiction: "WRONG" } })) }]) {
      const c = bind(changed(o, request)).occurrences[0]!;
      expect(c.summary.cashDelta.equals(money("103.03"))).toBe(true); expect(c.taxCharacter).toEqual([]);
      for (const output of ["federal_tax", "state_tax", "local_tax"]) expect(c.coverage.find(x => x.affectedOutput === output)!.coverage).toBe("incomplete");
    }
    const federalOnly = bind(changed(o, { ...r, taxRules: r.taxRules.slice(0, 1) })).occurrences[0]!;
    expect(federalOnly.taxCharacter).toHaveLength(1);
    expect(federalOnly.coverage.find(x => x.affectedOutput === "federal_tax")!.coverage).toBe("complete");
    expect(federalOnly.coverage.find(x => x.affectedOutput === "state_tax")!.coverage).toBe("incomplete");
  });
  it("rejects all reused occurrences and lot-wide redemption claims without reserving global usage", () => {
    const a = original(); const p = pin(a);
    expect(bindSeriesEESources([p, p], () => a).diagnostics.every(d => d.code === "DUPLICATE_OCCURRENCE")).toBe(true);
    const b = { ...a, sourceId: "later-original", request: { ...a.request, effectiveAt: civilDate("2020-04-02"),
      knownAt: civilDate("2020-04-02"), redemptionQuote: { ...a.request.redemptionQuote!, at: civilDate("2020-04-02"),
        source: { ...a.request.redemptionQuote!.source, asOf: civilDate("2020-04-02") } } } };
    const lookup = (id: string) => id === a.sourceId ? a : b;
    const result = bindSeriesEESources([p, pin(b)], lookup);
    expect(result.occurrences).toEqual([]); expect(result.diagnostics.map(d => d.code)).toEqual(["DUPLICATE_CLAIM", "DUPLICATE_CLAIM"]);
    expect(bindSeriesEESources([pin(b), p], lookup)).toEqual(result);
    expect(bind(a).occurrences).toHaveLength(1); expect(bind(a).occurrences).toHaveLength(1);
  });
  it("has linear compact payload growth for 1/12/120 distinct originals, independent of source order", () => {
    const sizes = [1, 12, 120].map(count => {
      const originals = Array.from({ length: count }, (_, i) => original(String(i).padStart(3, "0")));
      const catalog = new Map(originals.map(o => [o.sourceId, o]));
      const bindings = originals.map(o => pin(o));
      const result = bindSeriesEESources(bindings, id => catalog.get(id));
      expect(result.occurrences).toHaveLength(count); expect(result.diagnostics).toEqual([]);
      expect(bindSeriesEESources([...bindings].reverse(), id => catalog.get(id))).toEqual(result);
      const payload = JSON.stringify(result);
      for (const literal of [publication, '"schedule"', '"periodRate"', '"taxRules"', '"sourcePublication"', '"lot"', '"request"']) expect(payload).not.toContain(literal);
      for (const c of result.occurrences) expect(c.digest).toHaveLength("ee-request/v1:sha256:".length + 64);
      expect(new Set(result.occurrences.map(c => c.digest)).size).toBe(count);
      return new TextEncoder().encode(payload).length;
    });
    // Constant wrapper overhead and fixed-width distinct identities; 3% allows
    // JSON separators and framing, not duplication of schedules or tax catalogs.
    expect(sizes[1]! / sizes[0]!).toBeGreaterThan(12 * 0.97); expect(sizes[1]! / sizes[0]!).toBeLessThan(12 * 1.03);
    expect(sizes[2]! / sizes[1]!).toBeGreaterThan(10 * 0.97); expect(sizes[2]! / sizes[1]!).toBeLessThan(10 * 1.03);
  });
});
