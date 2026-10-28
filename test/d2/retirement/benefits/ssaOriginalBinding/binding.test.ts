import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { civilDate as date } from "../../../../../src/time/index.js";
import { money, Ratio, RoundingPolicy } from "../../../../../src/values/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import * as coordination from "../../../../../src/simulation/d2/retirement/benefits/coordination/index.js";
import { bindSsaOriginals, ssaOriginalDigest, type SsaOriginalHistory, type SsaOriginalPin, type SsaOriginalProvider,
  type SsaOriginalPublication } from "../../../../../src/simulation/d2/retirement/benefits/ssaOriginalBinding/index.js";
import { cutoff, evidence, legalChange, period, pin, provider, publication, recipientChange, survivorPublication } from "./fixtures.js";

const horizon = period("2026-01-01", "2026-02-01");
function run(o = publication(), p: SsaOriginalProvider | undefined = provider([o]), binding = pin(o), h = horizon, knownAt = cutoff) {
  return bindSsaOriginals({ householdId: "household", knownAt, dataCutoff: binding.dataCutoff, horizon: h, pins: [binding] }, p ? [p] : []);
}
const codes = (r: ReturnType<typeof run>): string[] => r.coverage.flatMap(c => c.diagnosticCodes);
const reject = (o: SsaOriginalPublication): void => {
  const r = run(o); expect(r.installments).toEqual([]); expect(r.coverage.every(c => c.coverage === "incomplete")).toBe(true);
};
afterEach(() => vi.restoreAllMocks());

describe("original SSA qualification — conditional synthetic evidence only", () => {
  it("fetches the independent original and emits exactly 150037 own cents with no cash/tax authority", () => {
    const o = publication(), p = provider([o]), before = canonicalSerialize(o), r = run(o, p);
    expect(r.installments).toHaveLength(1);
    expect(r.installments[0]!.grossAmount.equals(money("1500.37"))).toBe(true);
    expect(r.installments[0]).toMatchObject({ committed: false, postable: false, bankSettlement: "incomplete",
      taxLiability: "incomplete", coverage: "conditional", affectedOutput: "gross_schedule", effectiveAt: "2026-01-15" });
    expect(r.installments[0]).not.toHaveProperty("cashDelta");
    expect(r.installments[0]).not.toHaveProperty("taxable");
    expect(r.installments[0]).not.toHaveProperty("quotedAward");
    expect(r.originals).toHaveLength(1);
    expect(r.originals[0]!.referenceId).toBe(r.installments[0]!.originalRef);
    expect(r.originals[0]!.originalId).toBe("alice:original");
    expect(p.readOriginals).toHaveBeenCalledTimes(2);
    expect(p.readOriginals.mock.calls[0]![0]).toEqual({ sourceId: o.sourceId, householdId: "household", recipientPersonId: "alice",
      knownAt: cutoff, dataCutoff: cutoff });
    expect(Object.isFrozen(r.installments[0])).toBe(true);
    expect(Object.isFrozen(r.originals[0]!.traceRefs)).toBe(true);
    expect(canonicalSerialize(o)).toBe(before);
    expect(Object.isFrozen(o.recipient)).toBe(false);
    expect(codes(r)).toEqual([]);
  });
  it("coordinates 150037 own cents and 20012 excess cents into one 170049 cent installment", () => {
    const r = run(publication("alice", "own_plus_excess"));
    expect(codes(r)).toEqual([]); expect(r.installments).toHaveLength(1);
    expect(r.installments[0]!.grossAmount.equals(money("1700.49"))).toBe(true);
    expect(r.originals[0]!.traceRefs).toContain("alice:excess-attestation");
  });
  it("replaces own with exactly 210089 survivor cents at the sourced post-death election boundary", () => {
    const own = { ...publication(), eventPeriod: period("2026-01-01", "2026-03-01") };
    const prior = legalChange(own, { evidence: evidence("own-before-death", period("2026-01-01", "2026-02-01")) });
    const next = survivorPublication(), replay = date("2026-03-01");
    const r = bindSsaOriginals({ householdId: "household", knownAt: replay, dataCutoff: replay,
      horizon: period("2026-01-01", "2026-05-01"), pins: [prior, next].map(o => ({ ...pin(o), dataCutoff: replay })) }, [provider([prior, next])]);
    expect(r.installments.map(p => [p.effectiveAt, p.grossAmount.amount.toString()])).toEqual([
      ["2026-01-15", "1500.37"], ["2026-03-15", "2100.89"], ["2026-04-15", "2100.89"],
    ]);
    expect(codes(r)).toEqual(["MISSING_DETERMINATION"]);
    expect(r.originals.find(o => o.originalId === next.originalId)!.traceRefs).toContain("synthetic:replacement");
    const b = { ...pin(next), dataCutoff: replay };
    expect(run(next, provider([next]), b, period("2026-03-01", "2026-03-15"), replay).installments).toEqual([]);
    expect(run(next, provider([next]), b, period("2026-03-15", "2026-03-16"), replay).installments[0]!.grossAmount.equals(money("2100.89"))).toBe(true);
    const permuted = recipientChange(next, { determinations: [...next.recipient.determinations].reverse(), quotes: [...next.recipient.quotes].reverse() });
    expect(run(next, provider([permuted]), b, period("2026-03-01", "2026-05-01"), replay))
      .toEqual(run(next, provider([next]), b, period("2026-03-01", "2026-05-01"), replay));
  });
  it("cannot authenticate consumer eligibility flags or a matching digest without independent source proof", () => {
    const o = publication();
    const r = bindSsaOriginals({ householdId: "household", knownAt: cutoff, dataCutoff: cutoff, horizon, pins: [pin(o)] });
    expect(r.installments).toEqual([]); expect(codes(r)).toEqual(["MISSING_PROVIDER"]);
    expect(codes(run(o, provider([o], h => ({ ...h, authority: "unverified" }))))).toEqual(["UNQUALIFIED_INVENTORY"]);
    expect(codes(run(o, provider([], h => h)))).toEqual(["ORIGINAL_UNAVAILABLE"]);
    const fabricated: SsaOriginalProvider = { publisherId: o.publisherId, readOriginals: () => { throw new Error("unavailable"); } };
    expect(codes(run(o, fabricated))).toEqual(["ORIGINAL_UNAVAILABLE"]);
  });
  it("refuses wrong household, recipient, worker, entitlement, election, claim and event pins", () => {
    const o = publication(), b = pin(o);
    const changes: Partial<SsaOriginalPin>[] = [{ householdId: "other" }, { recipientPersonId: "other" },
      { workerRecordPersonIds: ["other"] }, { entitlementIds: ["other"] }, { awardIds: ["other"] }, { electionIds: ["other"] },
      { claimingMonths: [date("2026-02-01")] }, { eventPeriod: period("2026-01-01", "2027-01-01") }];
    for (const change of changes) {
      const r = run(o, provider([o]), { ...b, ...change }); expect(r.installments).toEqual([]); expect(codes(r).length).toBeGreaterThan(0);
    }
    const q = o.recipient.quotes[0]!;
    reject(recipientChange(o, { quotes: [{ ...q, award: { ...q.award, workerRecordPersonId: "other" } }] }));
    reject(recipientChange(o, { quotes: [{ ...q, award: { ...q.award, recipientPersonId: "other" } }] }));
    reject(recipientChange(o, { quotes: [{ ...q, award: { ...q.award, householdId: "other" } }] }));
  });
  it("rejects source version/cutoff mismatch and incomplete inventories", () => {
    const o = publication();
    expect(codes(run(o, provider([o]), { ...pin(o), sourceVersion: "2" }))).toEqual(["ORIGINAL_CHANGED"]);
    expect(codes(run(o, provider([o]), { ...pin(o), publisherId: "other" }))).toEqual(["MISSING_PROVIDER"]);
    for (const change of [{ completeThrough: date("2025-11-30") }, { checkedAt: date("2025-11-30") },
      { completeness: "unknown" as const }, { query: { sourceId: o.sourceId, householdId: "household", recipientPersonId: "alice",
        knownAt: cutoff, dataCutoff: date("2025-11-30") } }]) {
      expect(codes(run(o, provider([o], h => ({ ...h, ...change }))))).toEqual(["UNQUALIFIED_INVENTORY"]);
    }
    const b = { ...pin(o), dataCutoff: date("2025-11-30") };
    expect(codes(run(o, provider([o]), b))).toEqual(["UNAVAILABLE_EVIDENCE"]);
    reject(legalChange(o, { inventoryComplete: false }));
    reject(legalChange(o, { inventoryQuoteIds: [] }));
  });
  it("rejects amended/withdrawn originals and delayed known revisions", () => {
    const o = publication();
    reject({ ...o, kind: "amended", revisesOriginalId: "earlier" });
    reject({ ...o, status: "withdrawn" });
    for (const kind of ["amended", "corrected", "withdrawn", "superseding"] as const) {
      const p = provider([o], h => ({ ...h, revisions: [{ originalId: o.originalId, revisionId: "revision:2", kind,
        publishedAt: date("2026-02-01"), knownAt: date("2026-02-02") }] }));
      const b = { ...pin(o), dataCutoff: date("2026-03-01") };
      expect(codes(run(o, p, b, horizon, date("2026-03-01")))).toEqual(["KNOWN_REVISION"]);
    }
  });
  it("refuses second-read withdrawal, new amendment, disappearance and content/version changes", () => {
    const o = publication();
    const changes: ((h: SsaOriginalHistory) => SsaOriginalHistory | undefined)[] = [
      () => undefined,
      h => ({ ...h, originals: [{ ...o, status: "withdrawn" }] }),
      h => ({ ...h, originals: [{ ...o, version: "2" }] }),
      h => ({ ...h, originals: [legalChange(o, { eligibility: "unknown" })] }),
      h => ({ ...h, revisions: [{ originalId: o.originalId, revisionId: "late", kind: "withdrawn", publishedAt: cutoff, knownAt: cutoff }] }),
    ];
    for (const change of changes) {
      const p = provider([o], (h, call) => call === 2 ? change(h) : h), r = run(o, p);
      expect(p.readOriginals).toHaveBeenCalledTimes(2); expect(r.installments).toEqual([]); expect(r.originals).toEqual([]);
      expect(r.coverage.every(c => c.coverage === "incomplete")).toBe(true);
    }
    const bad = legalChange(o, { eligibility: "unknown" }), p = provider([bad]);
    expect(run(bad, p).installments).toEqual([]); expect(p.readOriginals).toHaveBeenCalledTimes(2);
  });
  it("refuses changed gross/quote/calendar/legal evidence even when authored flags remain eligible", () => {
    const o = publication(), q = o.recipient.quotes[0]!;
    const changes: SsaOriginalPublication[] = [
      recipientChange(o, { quotes: [{ ...q, award: { ...q.award, quote: { ...q.award.quote!, grossAmount: money("1500.38") } } }] }),
      recipientChange(o, { quotes: [{ ...q, award: { ...q.award, calendarSource: { ...q.award.calendarSource, version: "2" } } }] }),
      legalChange(o, { relationship: "unknown" }),
    ];
    for (const changed of changes) expect(codes(run(o, provider([changed]), pin(o)))).toEqual(["ORIGINAL_CHANGED"]);
    reject(changes[1]!);
  });
  it("validates publication/evidence dates at each installment and at the run cutoff", () => {
    const o = publication(), d = o.recipient.determinations[0]!;
    const late = { ...o, publishedAt: date("2026-01-20"), asOf: date("2026-01-20"), knownAt: date("2026-01-20") };
    const b = { ...pin(late), dataCutoff: date("2026-02-01") };
    expect(codes(run(late, provider([late]), b, horizon, date("2026-02-01")))).toEqual(["UNAVAILABLE_EVIDENCE"]);
    const knownLater = legalChange(o, { evidence: { ...d.evidence, knownAt: date("2026-01-10") } });
    // It is available at payment and replay, but exceeds the original data cutoff.
    expect(codes(run(knownLater, provider([knownLater]), pin(knownLater), horizon, date("2026-02-01")))).toEqual(["UNAVAILABLE_EVIDENCE"]);
    reject(legalChange(o, { evidence: { ...d.evidence, effective: period("2026-02-01") } }));
    reject(legalChange(o, { evidence: { ...d.evidence, source: { ...d.evidence.source, projectionStatus: "explicit_projected" } } }));
  });
  it("gates unsupported earnings/survivor rules, missing relationships and duplicate legal months", () => {
    const o = publication("alice", "own_plus_excess"), d = o.recipient.determinations[0]!;
    for (const unsupportedRules of [["earnings_test"], ["family_maximum"], ["special_survivor"]]) reject(legalChange(o, { unsupportedRules }));
    const { relationshipEvidence: _relationship, ...missing } = d;
    reject(recipientChange(o, { determinations: [missing] }));
    reject(legalChange(o, { eligibility: "unknown" }));
    reject(recipientChange(o, { determinations: [d, { ...d, determinationId: "competing-legal" }] }));
    reject(recipientChange(o, { determinations: [d, d] }));
    reject(recipientChange(o, { quotes: [o.recipient.quotes[0]!, o.recipient.quotes[0]!] }));
    const q = o.recipient.quotes[0]!;
    reject(recipientChange(o, { quotes: [{ ...q, award: { ...q.award, quote: { ...q.award.quote!, basis: "full_retirement_age" } } }, o.recipient.quotes[1]!] }));
  });
  it("requires supported sourced death/election/claim boundaries", () => {
    const o = survivorPublication(), next = o.recipient.determinations[1]!, replay = date("2026-03-01");
    const changes: Partial<coordination.Determination>[] = [
      { survivor: { ...next.survivor!, partialMonthTerms: "unsupported" } },
      { survivor: { ...next.survivor!, workerRecordPersonId: "wrong" } },
      { survivor: { ...next.survivor!, workerDeathDate: date("2026-04-01") } },
      { survivor: { ...next.survivor!, overlapRuleId: "" } },
      { claimingMonth: date("2026-01-01") },
      { survivor: { ...next.survivor!, evidence: evidence("unsupported:future-death") } },
    ];
    for (const change of changes) {
      const changed = recipientChange(o, { determinations: [o.recipient.determinations[0]!, { ...next, ...change }] });
      const r = run(changed, provider([changed]), { ...pin(changed), dataCutoff: replay }, period("2026-03-01", "2026-04-01"), replay);
      expect(r.installments).toEqual([]); expect(codes(r).length).toBeGreaterThan(0);
    }
  });
  it("rejects ALL competing publications/pins while unrelated recipients qualify", () => {
    const a = publication(), b = { ...a, sourceId: "synthetic:second-source", originalId: "alice:other-original", version: "2" }, c = publication("bob");
    const evaluate = (pins: readonly SsaOriginalPin[]) => bindSsaOriginals({ householdId: "household", knownAt: cutoff, dataCutoff: cutoff,
      horizon, pins }, [provider([a, b, c])]);
    const r = evaluate([pin(a), pin(b), pin(c)]);
    expect(r.installments.map(p => p.recipientPersonId)).toEqual(["bob"]);
    expect(codes(r)).toEqual(["COMPETING_ORIGINALS", "COMPETING_ORIGINALS"]);
    expect(evaluate([pin(c), pin(b), pin(a)])).toEqual(r);
    expect(evaluate([pin(a), pin(a)]).installments).toEqual([]);
    const sameSource = { ...a, originalId: "competing-original" };
    expect(codes(run(a, provider([a, sameSource])))).toEqual(["COMPETING_ORIGINALS"]);
    // An unselected conflicting original in the source inventory is still refused.
    expect(codes(run(a, provider([sameSource, a])))).toEqual(["COMPETING_ORIGINALS"]);
    expect(codes(run(a, provider([a, b])))).toEqual(["COMPETING_ORIGINALS"]);
    const shared = legalChange(c, { paymentEntitlementId: "alice:ssa" });
    const crossPerson = bindSsaOriginals({ householdId: "household", knownAt: cutoff, dataCutoff: cutoff, horizon,
      pins: [pin(a), pin(shared)] }, [provider([a, shared])]);
    expect(crossPerson.installments).toEqual([]);
    const sharedAward = legalChange(c, { paymentAwardId: "alice:payment" });
    expect(bindSsaOriginals({ householdId: "household", knownAt: cutoff, dataCutoff: cutoff, horizon,
      pins: [pin(a), pin(sharedAward)] }, [provider([a, sharedAward])]).installments).toEqual([]);
  });
  it("preserves semantics on replay, pin/source/evidence permutation and horizon changes", () => {
    const a = publication("alice", "own_plus_excess"), b = { ...publication("bob"), publisherId: "synthetic:publisher-2" };
    const pins = [pin(a), pin(b)], providers = [provider([a]), provider([b])];
    const request = { householdId: "household", knownAt: cutoff, dataCutoff: cutoff, horizon, pins };
    const r = bindSsaOriginals(request, providers);
    expect(bindSsaOriginals({ ...request, pins: [...pins].reverse() }, [...providers].reverse())).toEqual(r);
    expect(bindSsaOriginals(request, providers)).toEqual(r);
    const permuted = recipientChange(a, { quotes: [...a.recipient.quotes].reverse(), determinations: a.recipient.determinations.map(d =>
      ({ ...d, inventoryQuoteIds: [...d.inventoryQuoteIds].reverse() })) });
    expect(ssaOriginalDigest(permuted)).toBe(ssaOriginalDigest(a));
    expect(run(a, provider([permuted]))).toEqual(run(a));
    const extended = run(a, provider([a]), pin(a), period("2026-01-01", "2027-01-01"));
    expect(extended.installments[0]).toEqual(run(a).installments[0]);
    const shortened = run(a, provider([a]), pin(a), period("2026-01-15", "2026-01-16"));
    expect(shortened.installments[0]!.claimId).toBe(extended.installments[0]!.claimId);
    expect(shortened.installments[0]!.operationId).toBe(extended.installments[0]!.operationId);
  });
  it("does not reapply claiming adjustments to actual at-claim dollar amounts", () => {
    const o = publication(), q = o.recipient.quotes[0]!;
    const changed = recipientChange(o, { quotes: [{ ...q, award: { ...q.award,
      claimingAdjustment: { factor: Ratio.parse("0.5"), rounding: new RoundingPolicy(2, "half_even"), source: q.evidence.source } } }] });
    expect(run(changed).installments[0]!.grossAmount.equals(money("1500.37"))).toBe(true);
  });
  it("uses a full-publication SHA-256 witness, including inactive inventory and death/legal content", () => {
    const o = publication();
    // Single-element fixture arrays are already in canonical set order.
    const expected = createHash("sha256").update(canonicalSerialize(o)).digest("hex");
    expect(ssaOriginalDigest(o)).toBe(`ssa-original/v1:sha256:${expected}`);
    expect(ssaOriginalDigest(legalChange(o, { installmentDay: "16" }))).not.toBe(ssaOriginalDigest(o));
    expect(ssaOriginalDigest({ ...o, eventPeriod: period("2026-02-01") })).not.toBe(ssaOriginalDigest(o));
    expect(ssaOriginalDigest(recipientChange(o, { recipientDeathDate: date("2026-07-01") }))).not.toBe(ssaOriginalDigest(o));
    expect(ssaOriginalDigest({ ...o, recipient: { ...o.recipient, quotes: [...o.recipient.quotes, o.recipient.quotes[0]!] } })).not.toBe(ssaOriginalDigest(o));
  });
  it("keeps 1/12/120 installment output linear with two reads and one bounded coordination call", () => {
    const o = publication("alice", "own_plus_excess"), spy = vi.spyOn(coordination, "coordinateSocialSecurity");
    const sizes: number[] = [];
    for (const [count, end] of [[1, "2026-02-01"], [12, "2027-01-01"], [120, "2036-01-01"]] as const) {
      spy.mockClear();
      const p = provider([o]), r = run(o, p, pin(o), period("2026-01-01", end));
      expect(codes(r)).toEqual([]); expect(r.installments).toHaveLength(count); expect(r.coverage).toHaveLength(count);
      expect(r.installments.every(p => p.grossAmount.equals(money("1700.49")))).toBe(true);
      expect(p.readOriginals).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(1); expect(spy.mock.calls[0]![0].horizon).toEqual(period("2026-01-01", end));
      expect(r.originals).toHaveLength(1);
      expect(new Set(r.installments.map(p => p.originalRef))).toEqual(new Set([r.originals[0]!.referenceId]));
      expect(new Set(r.installments.map(p => p.claimId)).size).toBe(count);
      expect(new Set(r.installments.map(p => p.operationId)).size).toBe(count);
      const serialized = JSON.stringify(r);
      expect(serialized).not.toContain("inventoryQuoteIds"); expect(serialized).not.toContain("coveredHorizon");
      expect(serialized).not.toContain("Synthetic award/legal fixture");
      expect(serialized.split(o.originalId).length - 1).toBe(count + 1); // Reference catalog + coverage, never whole publications.
      sizes.push(serialized.length);
    }
    const slope = (sizes[1]! - sizes[0]!) / 11;
    expect((sizes[2]! - sizes[1]!) / 108).toBeLessThan(slope * 1.05);
    expect((sizes[2]! - sizes[1]!) / 108).toBeGreaterThan(slope * 0.95);
    expect(sizes[2]!).toBeLessThan(120 * 2000);
  });
});
