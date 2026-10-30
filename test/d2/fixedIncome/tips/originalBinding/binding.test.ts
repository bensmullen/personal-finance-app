import { describe, expect, it, vi } from "vitest";
import * as calculation from "../../../../../src/simulation/d2/fixedIncome/tips/index.js";
import { bindTipsOriginals, tipsRoleOriginalDigest, type TipsOriginalCode } from "../../../../../src/simulation/d2/fixedIncome/tips/originalBinding/index.js";
import { civilDate as date } from "../../../../../src/time/index.js";
import { money, decimal } from "../../../../../src/values/index.js";
import { fixture, pin, publishers, roles, source, type Originals } from "./fixtures.js";

const bind = (o: Originals) => bindTipsOriginals([pin(o)], publishers([o]));
const refused = (o: Originals, code: TipsOriginalCode) => {
  const result = bind(o);
  expect(result.occurrences).toEqual([]); expect(result.diagnostics[0]!.code).toBe(code);
  expect(result.diagnostics[0]!.coverage).toBe("incomplete");
  return result;
};

describe("TIPS role-separated original qualification (synthetic conditional evidence)", () => {
  it("delegates exactly once, yielding $40 noncash accretion and $10.40 coupon", () => {
    const o = fixture(), before = JSON.stringify(o), calls: string[] = [];
    const spy = vi.spyOn(calculation, "proposeTips");
    try {
      const result = bindTipsOriginals([pin(o)], publishers([o], role => calls.push(role)));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result.diagnostics).toEqual([]);
      const event = result.occurrences[0]!, [index, coupon] = event.economics;
      expect(index!.adjustedPrincipal!.equals(money("1040"))).toBe(true);
      expect(index!.assetDelta.equals(money("40"))).toBe(true);
      expect(index!.basisDelta.equals(money("40"))).toBe(true);
      expect(index!.cashDelta.isZero()).toBe(true);
      expect(index!.taxCharacter[0]!.incomeCharacter).toBe("noncash_inflation_oid");
      expect(index!.taxCharacter[0]!.taxable.equals(money("40"))).toBe(true);
      expect(coupon!.grossAmount.equals(money("10.40"))).toBe(true);
      expect(coupon!.taxCharacter[0]!.incomeCharacter).toBe("coupon_interest");
      expect(coupon!.dependsOn).toEqual([index!.operationId]);
      expect(event).toMatchObject({ committed: false, postable: false, funding: "incomplete", physicalSettlement: "incomplete", taxLiability: "incomplete" });
      for (const role of roles) expect(calls.filter(r => r === role)).toHaveLength(2);
      expect(Object.isFrozen(event.originals)).toBe(true);
      expect(JSON.stringify(o)).toBe(before); expect(Object.isFrozen(o.basis.payload)).toBe(false);
    } finally { spy.mockRestore(); }
  });

  it("preserves signed deflation, $9.50 coupon, $1,000 floor and incomplete floor tax", () => {
    const event = bind(fixture("000", true)).occurrences[0]!;
    const [index, coupon, maturity] = event.economics;
    expect(index!.basisDelta.equals(money("-150"))).toBe(true);
    expect(index!.taxCharacter[0]!.incomeCharacter).toBe("noncash_deflation_adjustment");
    expect(coupon!.grossAmount.equals(money("9.50"))).toBe(true);
    expect(maturity!.grossAmount.equals(money("1000"))).toBe(true);
    expect(maturity!.assetDelta.equals(money("-950"))).toBe(true);
    expect(maturity!.recognitionFacts[0]!.amount.equals(money("50"))).toBe(true);
    expect(maturity!.taxCharacter).toEqual([]);
    expect(event.coverage.find(c => c.affectedOutput === "federal_tax")!.diagnosticCode).toBe("FLOOR_TAX_CHARACTER_REQUIRED");
  });

  it("rejects missing/conflicting CPI and re-reads every provider after incomplete calculation", () => {
    for (const variant of ["missing", "conflict"] as const) {
      const o = fixture(), p = o.cpi.payload, calls: string[] = [];
      o.cpi = { ...o.cpi, payload: { ...p, observations: variant === "missing" ? [] : [...p.observations,
        { ...p.observations[1]!, value: decimal("105") }] } };
      const result = bindTipsOriginals([pin(o)], publishers([o], role => calls.push(role)));
      expect(result.occurrences).toEqual([]);
      expect(result.diagnostics[0]!.outputs!.some(c => c.diagnosticCode === (variant === "missing" ? "CPI_REQUIRED" : "CPI_CONFLICT"))).toBe(true);
      for (const role of roles) expect(calls.filter(r => r === role)).toHaveLength(2);
    }
  });

  it("rejects lot, beneficial owner, wrapper, floor, unpaid acquisition and unverified law", () => {
    for (const field of ["lotId", "wrapperId", "personId", "basisId"] as const) {
      const o = fixture(); o.ownership = { ...o.ownership, payload: { ...o.ownership.payload,
        lot: { ...o.ownership.payload.lot, [field]: "wrong" } } };
      refused(o, "OWNERSHIP_MISMATCH");
    }
    const floor = fixture(); floor.ownership = { ...floor.ownership, payload: { ...floor.ownership.payload, floorEligible: false } };
    refused(floor, "OWNERSHIP_MISMATCH");
    const owner = fixture(); owner.ownership = { ...owner.ownership, payload: { ...owner.ownership.payload, beneficialOwnerId: "bob" } };
    refused(owner, "OWNERSHIP_MISMATCH");
    const unpaid = fixture(); unpaid.funding = { ...unpaid.funding, payload: { ...unpaid.funding.payload,
      entries: [{ ...unpaid.funding.payload.entries[0]!, status: "pending" }] } };
    refused(unpaid, "FUNDING_UNPAID");
    const law = fixture(); law.law = { ...law.law, payload: { ...law.law.payload, authority: "unverified" } };
    refused(law, "LEGAL_AUTHORITY_REQUIRED");
    const basis = fixture(); basis.basis = { ...basis.basis, payload: { ...basis.basis.payload,
      opening: { ...basis.basis.payload.opening, basis: money("1000.01") } } };
    refused(basis, "BASIS_CONFLICT");
  });

  it("rejects duplicate coupon/redemption and recognized-basis/claim replays", () => {
    for (const kind of ["coupon", "redemption", "basis_recognition", "claim_use"] as const) {
      const o = fixture();
      o.history = { ...o.history, payload: { ...o.history.payload, entries: [{ identity: o.history.identity,
        operationId: kind === "claim_use" ? o.history.event.operationId : "prior-operation",
        claimId: "prior-claim", kind, start: o.history.event.period.start, effectiveAt: o.history.event.effectiveAt, basisDelta: money("0") }] } };
      refused(o, "DUPLICATE_CLAIM");
    }
    const incomplete = fixture(); incomplete.history = { ...incomplete.history, payload: {
      ...incomplete.history.payload, complete: "unknown" as never } };
    refused(incomplete, "INVENTORY_INCOMPLETE");
  });

  it("refuses conflicting issuer versions, post-maturity events and future-known amendments", () => {
    const conflict = fixture(); conflict.security = { ...conflict.security, payload: { ...conflict.security.payload,
      issues: [...conflict.security.payload.issues, { ...conflict.security.payload.issues[0]!, annualCouponRate: decimal("0.03") }] } };
    refused(conflict, "ISSUER_CONFLICT");
    const late = fixture(); late.security = { ...late.security, payload: { ...late.security.payload,
      issues: [{ ...late.security.payload.issues[0]!, maturityDate: date("2026-01-31") }] } };
    refused(late, "EVALUATION_INCOMPLETE");
    const future = fixture(); future.terms = { ...future.terms, knownAt: date("2026-02-02") };
    refused(future, "CHRONOLOGY_INVALID");
    const unused = fixture(); unused.law = { ...unused.law, payload: { ...unused.law.payload,
      taxRules: [...unused.law.payload.taxRules, { source: source("future-unused", "2026-02-02", "OTHER"), taxBucket: "taxable", treatment: "exempt" }] } };
    refused(unused, "CHRONOLOGY_INVALID");
  });

  it("requires registered independent publisher capabilities rather than consumer digests", () => {
    const o = fixture(); const p = publishers([o]);
    expect(bindTipsOriginals([pin(o)], {}).diagnostics[0]!.code).toBe("PROVIDER_REQUIRED");
    const b = pin(o);
    expect(bindTipsOriginals([{ ...b, originals: { ...b.originals, law: { ...b.originals.law, producerId: "consumer" } } }], p)
      .diagnostics[0]!.code).toBe("PROVIDER_REQUIRED");
    expect(bindTipsOriginals([b], { ...p, law: { ...p.law!, read: () => undefined } }).diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
    const altered = fixture(); altered.law = { ...altered.law, version: "changed" };
    expect(bindTipsOriginals([b], publishers([altered])).diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
    const alias = fixture(); alias.law = { ...alias.law, producerId: alias.terms.producerId };
    expect(bindTipsOriginals([pin(alias)], { ...publishers([alias]), law: { ...publishers([alias]).law!, producerId: alias.terms.producerId } })
      .diagnostics[0]!.code).toBe("INDEPENDENT_PROVIDER_REQUIRED");
    const shifted = fixture(); shifted.funding = { ...shifted.funding, identity: { ...shifted.funding.identity, householdId: "other" } };
    refused(shifted, "ORIGINAL_SCOPE_MISMATCH");
  });

  it("reconciles complete prior coupon, accretion and basis inventories", () => {
    for (const missing of ["coupon", "indexation", "basis_recognition"] as const) {
      const o = fixture("000", true);
      o.history = { ...o.history, payload: { ...o.history.payload, entries: o.history.payload.entries.filter(h => h.kind !== missing) } };
      refused(o, "HISTORY_CONFLICT");
    }
  });

  it("re-reads every role even after withdrawal or changed basis on the second read", () => {
    for (const role of roles) {
      const o = fixture(), b = pin(o), reads = new Map<string, number>();
      const result = bindTipsOriginals([b], publishers([o], r => {
        reads.set(r, (reads.get(r) ?? 0) + 1);
        if (r === role && reads.get(r) === 2) {
          // Change only publisher state, after the immutable first-read snapshot.
          Object.assign(o, { [r]: { ...o[r], status: "withdrawn" } });
        }
      }));
      expect(result.occurrences).toEqual([]); expect(result.diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
      for (const r of roles) expect(reads.get(r)).toBe(2);
    }
    const o = fixture(), b = pin(o); let reads = 0;
    const result = bindTipsOriginals([b], publishers([o], role => {
      if (role === "basis" && ++reads === 2) o.basis = { ...o.basis, payload: { ...o.basis.payload,
        opening: { ...o.basis.payload.opening, basis: money("1000.01") } } };
    }));
    expect(result.diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
  });

  it("pins unused competing law observations and detects their amendment after evaluation", () => {
    const o = fixture();
    o.law = { ...o.law, payload: { ...o.law.payload, taxRules: [...o.law.payload.taxRules,
      { source: source("unused-law", "2025-01-01", "OTHER"), taxBucket: "taxable", treatment: "exempt" }] } };
    const b = pin(o); let reads = 0;
    const result = bindTipsOriginals([b], publishers([o], role => {
      if (role === "law" && ++reads === 2) o.law = { ...o.law, payload: { ...o.law.payload,
        taxRules: o.law.payload.taxRules.map(r => r.source.jurisdiction === "OTHER" ? { ...r, source: { ...r.source, version: "v2" } } : r) } };
    }));
    expect(result.occurrences).toEqual([]); expect(result.diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
  });

  it("preserves independent lots/households, refuses all competing batch claims and replays deterministically", () => {
    const a = fixture("000"), b = fixture("001");
    const first = bindTipsOriginals([pin(a), pin(b)], publishers([a, b]));
    expect(first.occurrences).toHaveLength(2);
    expect(bindTipsOriginals([pin(b), pin(a)], publishers([b, a]))).toEqual(first);
    const duplicate = { ...pin(a), event: { ...pin(a).event, occurrenceId: "alias", operationId: "alias-op", claimId: "alias-claim" } };
    const result = bindTipsOriginals([pin(a), duplicate, pin(b)], publishers([a, b]));
    expect(result.occurrences.map(o => o.occurrenceId)).toEqual([b.security.event.occurrenceId]);
    expect(result.diagnostics.every(d => d.code === "DUPLICATE_CLAIM")).toBe(true);
    const shuffled = fixture(); shuffled.cpi = { ...shuffled.cpi, payload: { ...shuffled.cpi.payload,
      observations: [...shuffled.cpi.payload.observations].reverse(), months: [...shuffled.cpi.payload.months].reverse() } };
    shuffled.law = { ...shuffled.law, payload: { ...shuffled.law.payload, taxRules: [...shuffled.law.payload.taxRules].reverse() } };
    expect(tipsRoleOriginalDigest(shuffled.cpi)).toBe(tipsRoleOriginalDigest(a.cpi));
    expect(bind(shuffled)).toEqual(bind(a));
    const extended = fixture();
    for (const role of roles) Object.assign(extended[role], { event: { ...extended[role].event,
      period: { ...extended[role].event.period, endExclusive: date("2026-12-01") } } });
    expect(bind(extended).occurrences[0]!.economics).toEqual(bind(a).occurrences[0]!.economics);
    const anotherHousehold = fixture("002");
    for (const role of roles) Object.assign(anotherHousehold[role], { identity: { ...anotherHousehold[role].identity, householdId: "other-hh" } });
    anotherHousehold.ownership = { ...anotherHousehold.ownership, payload: { ...anotherHousehold.ownership.payload,
      lot: { ...anotherHousehold.ownership.payload.lot, householdId: "other-hh" } } };
    anotherHousehold.funding = { ...anotherHousehold.funding, payload: { ...anotherHousehold.funding.payload,
      entries: anotherHousehold.funding.payload.entries.map(f => ({ ...f, identity: anotherHousehold.funding.identity })) } };
    expect(bindTipsOriginals([pin(a), pin(anotherHousehold)], publishers([a, anotherHousehold])).occurrences).toHaveLength(2);
  });

  it("bounds 1/12/120 output bytes, publisher reads and scoped CPI inventory work", () => {
    const sizes = [1, 12, 120].map(count => {
      const originals = Array.from({ length: count }, (_, n) => fixture(String(n).padStart(3, "0")));
      const cpiInventories = new Map(originals.map(o => [o.cpi.sourceId, o.cpi.payload.observations]));
      let reads = 0, cpiPoints = 0;
      const result = bindTipsOriginals(originals.map(pin), publishers(originals, (role, query) => {
        reads++;
        if (role === "cpi") {
          expect(query.cpiScope!.months).toEqual([date("2025-10-01"), date("2025-11-01")]);
          cpiPoints += cpiInventories.get(query.sourceId)!.length;
        }
      }));
      expect(result.occurrences).toHaveLength(count); expect(result.diagnostics).toEqual([]);
      expect(reads).toBe(16 * count); expect(cpiPoints).toBe(4 * count);
      const json = JSON.stringify(result);
      for (const forbidden of ["SYNTHETIC ONLY", "observations", "couponPeriods", "sourcePublication", "taxRules", "payload", "request"])
        expect(json).not.toContain(forbidden);
      return new TextEncoder().encode(json).length;
    });
    expect(sizes[1]! / sizes[0]!).toBeGreaterThan(11.6); expect(sizes[1]! / sizes[0]!).toBeLessThan(12.4);
    expect(sizes[2]! / sizes[1]!).toBeGreaterThan(9.7); expect(sizes[2]! / sizes[1]!).toBeLessThan(10.3);
  });
});
