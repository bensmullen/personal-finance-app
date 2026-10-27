import { describe, expect, it } from "vitest";
import { bindTipsSources, tipsOriginalDigest, tipsOriginalIdentity, type TipsBinding, type TipsOriginal } from "../../../../../src/simulation/d2/fixedIncome/tips/sourceBinding/index.js";
import type { CpiPoint, TipsRequest, TipsSource } from "../../../../../src/simulation/d2/fixedIncome/tips/index.js";
import { civilDate as date } from "../../../../../src/time/index.js";
import { decimal, money, RoundingPolicy } from "../../../../../src/values/index.js";

// Entirely synthetic evidence. Fixed oracles below are independent of evaluator output.
const source = (sourceId: string, at = "2025-01-01", jurisdiction = "US"): TipsSource => ({
  sourceId, version: "v1", ruleSnapshotId: `${sourceId}:v1`, ruleFamily: "tips", sourcePublication: "SYNTHETIC ONLY",
  publishedAt: date(at), asOf: date(at), start: date("2024-01-01"), endExclusive: date("2027-01-01"), jurisdiction, projectionStatus: "verified",
});
const point = (month: string, value: string, release: string): CpiPoint => ({
  seriesId: "synthetic-cpi", month: date(month), value: decimal(value), source: source(`cpi:${month}`, release),
});
const original = (tag = "000"): TipsOriginal => ({
  sourceId: `original:${tag}`, version: "v1", status: "active", openingCommit: { checkpointId: `checkpoint:${tag}`, status: "committed" },
  request: {
    lot: { householdId: "hh", personId: "alice", wrapperId: "wrapper", holdingId: `holding:${tag}`, lotId: `lot:${tag}`, basisId: `basis:${tag}`,
      securityId: "security", issueId: "issue", taxBucket: "taxable", stateJurisdiction: "US:synthetic",
      destination: { accountId: "wrapper-cash", personId: "alice", wrapperId: "wrapper", kind: "wrapper_cash" },
      issueDate: date("2025-08-01"), purchaseDate: date("2025-08-01"), maturityDate: date("2026-08-01"), purchaseKind: "issuance_at_par",
      fundingAccountId: "purchase-evidence", originalPrincipal: money("1000"), parAmount: money("1000"), fundingCost: money("1000"),
      denomination: "USD", annualCouponRate: decimal("0.02"), firstCouponDate: date("2026-02-01"), lastCouponDate: date("2026-08-01"),
      couponDates: [date("2026-02-01"), date("2026-08-01")], lotTreatment: "single_ordinary_lot", source: source("lot", "2025-08-01"),
      opening: { at: date("2026-01-01"), carrying: money("1000"), basis: money("1000"), cumulativeIndexation: money("0"), source: source("opening", "2026-01-01") } },
    rule: { issueId: "issue", source: source("rule"), seriesId: "synthetic-cpi", lagMonths: 3,
      interpolation: "linear_day_minus_one_over_days_in_current_month", calendar: "gregorian_unadjusted",
      base: { referenceDate: date("2025-08-01"), denominator: decimal("100"), source: source("base", "2025-08-01") },
      referenceRounding: new RoundingPolicy(5, "half_up"), ratioRounding: new RoundingPolicy(7, "half_up"),
      principalRounding: new RoundingPolicy(2, "half_up"), couponRounding: new RoundingPolicy(2, "half_up"),
      couponConvention: "indexed_principal_times_annual_rate_times_sourced_fraction", carryingBasisConvention: "signed_indexation_no_other_adjustments",
      deflation: "signed_indexation", maturityFloor: "eligible_original_par", couponPeriods: [
        { start: date("2025-08-01"), endExclusive: date("2026-02-01"), paymentDate: date("2026-02-01"), yearFraction: decimal("0.5") },
        { start: date("2026-02-01"), endExclusive: date("2026-08-01"), paymentDate: date("2026-08-01"), yearFraction: decimal("0.5") },
      ] },
    observations: [point("2025-10-01", "100", "2025-11-15"), point("2025-11-01", "104", "2025-12-15")],
    taxRules: [{ source: source("tax:US"), taxBucket: "taxable", treatment: "signed_oid_and_coupon" },
      { source: source("tax:state", "2025-01-01", "US:synthetic"), taxBucket: "taxable", treatment: "unsupported" }],
    period: { start: date("2026-01-01"), endExclusive: date("2026-02-02") }, effectiveAt: date("2026-02-01"), knownAt: date("2026-09-01"), action: "scheduled_observation",
  },
});
const pin = (o: TipsOriginal, occurrenceId = `event:${o.sourceId}`): TipsBinding => ({
  occurrenceId, sourceId: o.sourceId, sourceVersion: o.version, digest: tipsOriginalDigest(o), identity: tipsOriginalIdentity(o.request.lot),
  period: o.request.period, effectiveAt: o.request.effectiveAt, knownAt: o.request.knownAt, action: o.request.action,
});
const patch = (o: TipsOriginal, change: Partial<TipsRequest>): TipsOriginal => ({ ...o, request: { ...o.request, ...change } });
const bind = (o: TipsOriginal) => bindTipsSources([pin(o)], () => o);
const refused = (o: TipsOriginal, code = "EVALUATION_INCOMPLETE") => {
  const result = bind(o);
  expect(result.occurrences).toEqual([]);
  expect(result.diagnostics[0]!.code).toBe(code);
  return result;
};

describe("TIPS independently fetched original source binding", () => {
  it("preserves the fixed $1,040 indexed principal / $10.40 coupon oracle and separate noncash OID", () => {
    const o = original(); const before = JSON.stringify(o);
    const calls: string[] = [];
    const result = bindTipsSources([pin(o)], (id, cutoff) => { calls.push(`${id}:${cutoff}`); return o; });
    expect(calls).toEqual(["original:000:2026-02-01", "original:000:2026-02-01"]);
    expect(result.diagnostics).toEqual([]);
    const event = result.occurrences[0]!; const [index, coupon] = event.economics;
    expect(index!.adjustedPrincipal!.equals(money("1040"))).toBe(true);
    expect(index!.assetDelta.equals(money("40"))).toBe(true);
    expect(index!.basisDelta.equals(money("40"))).toBe(true);
    expect(index!.cashDelta.isZero()).toBe(true);
    expect(index!.taxCharacter[0]!.incomeCharacter).toBe("noncash_inflation_oid");
    expect(index!.taxCharacter[0]!.taxable.equals(money("40"))).toBe(true);
    expect(coupon!.cashDelta.equals(money("10.40"))).toBe(true);
    expect(coupon!.basisDelta.isZero()).toBe(true);
    expect(coupon!.taxCharacter[0]!.incomeCharacter).toBe("coupon_interest");
    expect(coupon!.dependsOn).toEqual([index!.operationId]);
    expect(event.coverage.find(c => c.affectedOutput === "state_tax")!.coverage).toBe("incomplete");
    expect(event.coverage.find(c => c.affectedOutput === "federal_tax")!.coverage).toBe("complete");
    expect(event).toMatchObject({ status: "conditional", committed: false, postable: false, funding: "incomplete", physicalSettlement: "incomplete", taxLiability: "incomplete" });
    expect(Object.isFrozen(event.economics[0]!.taxCharacter)).toBe(true);
    expect(Object.isFrozen(event.original)).toBe(true);
    expect(JSON.stringify(o)).toBe(before);
    expect(Object.isFrozen(o.request.lot)).toBe(false);
  });

  it("keeps signed deflation and original-par maturity floor separate from coupon and tax liability", () => {
    const o = original(); const l = o.request.lot;
    const m = patch(o, { effectiveAt: l.maturityDate, period: { start: date("2026-07-01"), endExclusive: date("2026-08-02") },
      lot: { ...l, opening: { ...l.opening, at: date("2026-07-01"), carrying: money("1100"), basis: money("1100"), cumulativeIndexation: money("100"), source: source("opening", "2026-07-01") } },
      observations: [point("2026-04-01", "110", "2026-05-15"), point("2026-05-01", "95", "2026-06-15")] });
    const event = bind(m).occurrences[0]!; const [index, coupon, maturity] = event.economics;
    expect(index!.basisDelta.equals(money("-150"))).toBe(true);
    expect(index!.taxCharacter[0]!.incomeCharacter).toBe("noncash_deflation_adjustment");
    expect(coupon!.grossAmount.equals(money("9.50"))).toBe(true);
    expect(maturity!.grossAmount.equals(money("1000"))).toBe(true);
    expect(maturity!.assetDelta.equals(money("-950"))).toBe(true);
    expect(maturity!.recognitionFacts).toEqual([{ character: "maturity_floor_uplift", amount: money("50") }]);
    expect(maturity!.taxCharacter).toEqual([]);
    expect(event.coverage.find(c => c.affectedOutput === "federal_tax")!.diagnosticCode).toBe("FLOOR_TAX_CHARACTER_REQUIRED");
  });

  it("refuses missing, late, conflicting, projected and future CPI without fabricated cash", () => {
    const o = original(); const [a, b] = o.request.observations;
    const variants = [[], [a!], [a!, b!, { ...b!, value: decimal("105") }],
      [a!, { ...b!, source: source("late", "2026-02-02") }],
      [a!, { ...b!, source: { ...b!.source, projectionStatus: "explicit_projected" as const } }],
      [a!, { ...b!, month: date("2026-11-01") }]];
    for (const observations of variants) refused(patch(o, { observations }));
  });

  it("gates invalid conventions, changed opening basis, secondary purchases and future issuance", () => {
    const o = original(); const r = o.request.rule!; const l = o.request.lot;
    for (const rule of [{ ...r, lagMonths: -1 }, { ...r, principalRounding: new RoundingPolicy(3, "half_up") }]) refused(patch(o, { rule }));
    refused(patch(o, { lot: { ...l, opening: { ...l.opening, basis: money("999.99") } } }));
    refused(patch(o, { lot: { ...l, purchaseKind: "secondary_market" } }));
    refused(patch(o, { lot: { ...l, issueDate: date("2026-03-01") } }));
    refused(patch(o, { rule: { ...r, source: source("amended-rule", "2026-02-02") } }), "EVIDENCE_AFTER_EVENT");
    refused(patch(o, { lot: { ...l, source: source("amended-lot", "2026-02-02") } }), "EVIDENCE_AFTER_EVENT");
  });

  it("requires exact consumer subject and event pins", () => {
    const o = original(); const p = pin(o);
    for (const field of ["householdId", "personId", "wrapperId", "securityId", "issueId", "holdingId", "lotId", "basisId"] as const) {
      expect(bindTipsSources([{ ...p, identity: { ...p.identity, [field]: "wrong" } }], () => o).diagnostics[0]!.code).toBe("IDENTITY_MISMATCH");
    }
    expect(bindTipsSources([{ ...p, action: "sale" }], () => o).diagnostics[0]!.code).toBe("EVENT_MISMATCH");
    expect(bindTipsSources([{ ...p, sourceVersion: "v2" }], () => o).diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
  });

  it("re-reads originals and rejects one-cent amendments, refusal, unavailability and withdrawal", () => {
    const o = original(); const p = pin(o);
    const changed = patch(o, { lot: { ...o.request.lot, opening: { ...o.request.lot.opening, basis: money("1000.01") } } });
    for (const second of [changed, { ...o, status: "withdrawn" as const }, undefined]) {
      let reads = 0;
      const result = bindTipsSources([p], () => ++reads === 1 ? o : second);
      expect(reads).toBe(2); expect(result.occurrences).toEqual([]);
      expect(result.diagnostics[0]!.code).toBe(second === changed ? "ORIGINAL_CHANGED" : "ORIGINAL_UNAVAILABLE");
    }
    expect(bindTipsSources([p], () => { throw new Error("refused"); }).diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
    expect(bindTipsSources([p], () => undefined).occurrences).toEqual([]);
    expect(bindTipsSources([p], () => changed).diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
  });

  it("uses an exact sourced quote exclusively, retaining incomplete CPI coverage on the quoted fallback", () => {
    const o = original(); const quote = { quoteId: "quote", paymentDate: o.request.effectiveAt, amount: money("10.40"), source: source("quote") };
    const quoted = patch(o, { couponQuote: quote }); const event = bind(quoted).occurrences[0]!;
    expect(event.economics.map(e => e.kind)).toEqual(["indexation", "quoted_coupon"]);
    expect(event.economics[1]!.claimId).toBe(bind(o).occurrences[0]!.economics[1]!.claimId);
    expect(event.coverage.find(c => c.affectedOutput === "quoted_coupon")!.coverage).toBe("complete");
    refused(patch(o, { couponQuote: { ...quote, amount: money("10.41") } }), "QUOTE_CONFLICT");
    refused(patch(o, { couponQuote: { ...quote, source: source("late-quote", "2026-02-02") } }), "EVIDENCE_AFTER_EVENT");
    const fallback = bind(patch(o, { couponQuote: quote, observations: [] })).occurrences[0]!;
    expect(fallback.economics.map(e => e.kind)).toEqual(["quoted_coupon"]);
    expect(fallback.economics[0]!.cashDelta.equals(money("10.40"))).toBe(true);
    expect(fallback.economics[0]!.adjustedPrincipal).toBeNull();
    expect(fallback.coverage.find(c => c.affectedOutput === "indexation")!.coverage).toBe("incomplete");
    expect(fallback.coverage.find(c => c.affectedOutput === "basis")!.coverage).toBe("incomplete");
    const conflict = patch(o, { couponQuote: quote, observations: [...o.request.observations, o.request.observations[1]!] });
    refused(conflict);
    const q2 = { ...quoted, sourceId: "quoted-original" };
    const result = bindTipsSources([pin(o), pin(q2)], id => id === o.sourceId ? o : q2);
    expect(result.occurrences).toEqual([]); expect(result.diagnostics.every(d => d.code === "DUPLICATE_CLAIM")).toBe(true);
  });

  it("retains missing federal/state law as incomplete rather than zero tax", () => {
    const o = patch(original(), { taxRules: [] }); const event = bind(o).occurrences[0]!;
    expect(event.economics.every(e => e.taxCharacter.length === 0)).toBe(true);
    for (const affectedOutput of ["federal_tax", "state_tax"]) expect(event.coverage.find(c => c.affectedOutput === affectedOutput)!.coverage).toBe("incomplete");
    const late = patch(original(), { taxRules: [{ source: source("future-tax", "2026-02-02"), taxBucket: "taxable", treatment: "signed_oid_and_coupon" }] });
    expect(bind(late).occurrences[0]!.coverage.find(c => c.affectedOutput === "federal_tax")!.coverage).toBe("incomplete");
  });

  it("rejects all duplicate occurrences/claims and preserves independent events in any input order", () => {
    const a = original(); const b = { ...a, sourceId: "alias" }; const independent = original("001");
    const lookup = (id: string) => [a, b, independent].find(o => o.sourceId === id);
    const pins = [pin(a), pin(b), pin(independent)];
    const result = bindTipsSources(pins, lookup);
    expect(result.occurrences.map(o => o.original.sourceId)).toEqual([independent.sourceId]);
    expect(bindTipsSources([...pins].reverse(), lookup)).toEqual(result);
    const duplicate = bindTipsSources([pin(a, "same"), pin(independent, "same")], lookup);
    expect(duplicate.occurrences).toEqual([]); expect(duplicate.diagnostics.every(d => d.code === "DUPLICATE_OCCURRENCE")).toBe(true);
  });

  it("rejects conflicting opening identities even when the conflicting evaluator cannot admit basis", () => {
    const a = original(); const r = a.request;
    const b = patch({ ...a, sourceId: "opening-conflict" }, { effectiveAt: date("2026-01-31"),
      lot: { ...r.lot, basisId: "different-basis", opening: { ...r.lot.opening, basis: money("999") } } });
    const pins = [pin(a), pin(b)]; const lookup = (id: string) => id === a.sourceId ? a : b;
    const result = bindTipsSources(pins, lookup);
    expect(result.occurrences).toEqual([]); expect(result.diagnostics.some(d => d.code === "OPENING_CONFLICT")).toBe(true);
    expect(bindTipsSources([...pins].reverse(), lookup)).toEqual(result);
  });

  it("refuses overlapping indexation intervals without selecting a date-order winner", () => {
    const a = original(); const b = patch({ ...a, sourceId: "overlap" }, { effectiveAt: date("2026-01-31") });
    const lookup = (id: string) => id === a.sourceId ? a : b;
    const pins = [pin(a), pin(b)]; const result = bindTipsSources(pins, lookup);
    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every(d => d.code === "DUPLICATE_CLAIM")).toBe(true);
    expect(bindTipsSources([...pins].reverse(), lookup)).toEqual(result);
  });

  it("rejects absent committed opening attribution and withdrawn originals on the first read", () => {
    const o = original();
    refused({ ...o, openingCommit: { ...o.openingCommit, checkpointId: "" } }, "OPENING_CONFLICT");
    refused({ ...o, status: "withdrawn" }, "ORIGINAL_UNAVAILABLE");
  });

  it("normalizes evidence set order and keeps operation/claim identities stable under horizon extension", () => {
    const a = original(); const r = a.request;
    const b = patch(a, { observations: [...r.observations].reverse(), taxRules: [...r.taxRules].reverse(),
      lot: { ...r.lot, couponDates: [...r.lot.couponDates].reverse() }, rule: { ...r.rule!, couponPeriods: [...r.rule!.couponPeriods].reverse() } });
    expect(tipsOriginalDigest(b)).toBe(tipsOriginalDigest(a)); expect(bind(b)).toEqual(bind(a));
    const extended = patch(a, { period: { ...r.period, endExclusive: date("2026-12-01") } });
    expect(bind(extended).occurrences[0]!.economics).toEqual(bind(a).occurrences[0]!.economics);
  });

  it("serializes 1/12/120 independent events proportionally without copying reused source catalogs", () => {
    const sizes = [1, 12, 120].map(count => {
      const originals = Array.from({ length: count }, (_, n) => original(String(n).padStart(3, "0")));
      const lookup = new Map(originals.map(o => [o.sourceId, o]));
      const result = bindTipsSources(originals.map(o => pin(o)), id => lookup.get(id));
      expect(result.occurrences).toHaveLength(count); expect(result.diagnostics).toEqual([]);
      const json = JSON.stringify(result);
      for (const forbidden of ["SYNTHETIC ONLY", "observations", "couponPeriods", "openingCommit", "sourcePublication", "taxRules", "request"]) expect(json).not.toContain(forbidden);
      return json.length;
    });
    expect(sizes[1]! / sizes[0]!).toBeGreaterThan(11.6); expect(sizes[1]! / sizes[0]!).toBeLessThan(12.4);
    expect(sizes[2]! / sizes[1]!).toBeGreaterThan(9.7); expect(sizes[2]! / sizes[1]!).toBeLessThan(10.3);
  });
});
