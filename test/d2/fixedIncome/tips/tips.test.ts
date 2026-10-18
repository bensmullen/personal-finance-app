import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeTips, type CpiPoint, type TipsLot, type TipsOutput, type TipsRequest, type TipsRule, type TipsSource, type TipsTaxRule } from "../../../../src/simulation/d2/fixedIncome/tips/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, RoundingPolicy, decimal, money } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const date = civilDate;
// Every value/convention below is synthetic; no claim about actual Treasury or tax law.
const source = (id: string, jurisdiction = "US"): TipsSource => ({ sourceId: id, ruleSnapshotId: `${id}:v1`, ruleFamily: "tips",
  sourcePublication: "Synthetic isolated TIPS convention, NOT statutory/reference market evidence", version: "synthetic-v1", jurisdiction,
  publishedAt: date("2025-01-01"), asOf: date("2025-01-01"), start: date("2024-01-01"), endExclusive: date("2027-01-01"), projectionStatus: "verified" });
const round = (scale: number, mode: RoundingPolicy["mode"] = "half_up") => new RoundingPolicy(scale, mode);
const lot = (): TipsLot => ({ householdId: "hh", personId: "alice", holdingId: "tips-holding", lotId: "lot-a", basisId: "basis-a",
  securityId: "security-a", issueId: "synthetic-cusip-a", wrapperId: "wrapper-a", taxBucket: "taxable", stateJurisdiction: "US:synthetic_state",
  destination: { accountId: "wrapper-cash", personId: "alice", wrapperId: "wrapper-a", kind: "wrapper_cash" },
  issueDate: date("2025-08-01"), maturityDate: date("2026-08-01"), purchaseDate: date("2025-08-01"), purchaseKind: "issuance_at_par",
  fundingAccountId: "funded-purchase", originalPrincipal: money("1000"), parAmount: money("1000"), fundingCost: money("1000"), denomination: "USD",
  annualCouponRate: decimal("0.02"), firstCouponDate: date("2026-02-01"), lastCouponDate: date("2026-08-01"),
  couponDates: [date("2026-02-01"), date("2026-08-01")], lotTreatment: "single_ordinary_lot", source: { ...source("lot"), asOf: date("2025-08-01") },
  opening: { at: date("2026-01-01"), carrying: money("1000"), basis: money("1000"), cumulativeIndexation: money("0"),
    source: { ...source("opening"), asOf: date("2026-01-01") } } });
const rule = (): TipsRule => ({ issueId: lot().issueId, source: source("index-rule"), seriesId: "synthetic-cpi", lagMonths: 3,
  interpolation: "linear_day_minus_one_over_days_in_current_month", calendar: "gregorian_unadjusted",
  base: { referenceDate: lot().issueDate, denominator: decimal("100"), source: { ...source("issue-base"), asOf: date("2025-08-01") } },
  referenceRounding: round(5), ratioRounding: round(7), principalRounding: round(2), couponRounding: round(2),
  couponConvention: "indexed_principal_times_annual_rate_times_sourced_fraction", carryingBasisConvention: "signed_indexation_no_other_adjustments",
  deflation: "signed_indexation", maturityFloor: "eligible_original_par", couponPeriods: [
    { start: date("2025-08-01"), endExclusive: date("2026-02-01"), paymentDate: date("2026-02-01"), yearFraction: decimal("0.5") },
    { start: date("2026-02-01"), endExclusive: date("2026-08-01"), paymentDate: date("2026-08-01"), yearFraction: decimal("0.5") },
  ] });
const point = (month: string, value: string): CpiPoint => {
  const m = Number(month.slice(5, 7));
  const release = date(`${Number(month.slice(0, 4)) + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-15`);
  return { seriesId: "synthetic-cpi", month: date(month), value: decimal(value), source: { ...source(`cpi:${month}`), publishedAt: release, asOf: release } };
};
const tax = (jurisdiction = "US", bucket: TipsTaxRule["taxBucket"] = "taxable"): TipsTaxRule => ({ source: source(`tax:${jurisdiction}:${bucket}`, jurisdiction),
  taxBucket: bucket, treatment: bucket === "taxable" ? "signed_oid_and_coupon" : "no_current_tax_facts" });
const request = (patch: Partial<TipsRequest> = {}): TipsRequest => ({ lot: lot(), period: { start: date("2026-01-01"), endExclusive: date("2026-02-02") },
  effectiveAt: date("2026-02-01"), knownAt: date("2026-09-01"), rule: rule(), observations: [point("2025-10-01", "100"), point("2025-11-01", "105")],
  taxRules: [tax(), tax("US:synthetic_state")], action: "scheduled_observation", ...patch });
const cov = (r: ReturnType<typeof proposeTips>, output: TipsOutput) => r.coverage.find(c => c.affectedOutput === output)!;
const blocked = (input: TipsRequest, code: string, output: TipsOutput = "indexation") => {
  const result = proposeTips(input);
  expect(cov(result, output).coverage).toBe("incomplete");
  expect(cov(result, output).diagnosticCode).toBe(code);
  expect(result.proposals).toEqual([]);
  return result;
};
const maturity = (value = "95"): TipsRequest => {
  const l = lot();
  return request({ effectiveAt: l.maturityDate, period: { start: date("2026-07-01"), endExclusive: date("2026-08-02") },
    lot: { ...l, opening: { ...l.opening, at: date("2026-07-01"), carrying: money("1100"), basis: money("1100"), cumulativeIndexation: money("100"),
      source: { ...l.opening.source, asOf: date("2026-07-01") } } },
    observations: [point("2026-04-01", "110"), point("2026-05-01", value)] });
};

describe("D2-B isolated TIPS issue/lot proposals (PFA-DET §5.6, PFA-INV-027, PFA-TAX-015)", () => {
  it("computes exact indexed-principal coupons separately from noncash accretion/basis", () => {
    const r = proposeTips(request());
    expect(r.proposals.map(p => p.kind)).toEqual(["indexation", "computed_coupon"]);
    const [index, coupon] = r.proposals;
    expect(index!.referenceCpi!.toString()).toBe("105");
    expect(index!.indexRatio!.toString()).toBe("1.05");
    expect(index!.originalPrincipal.equals(money("1000"))).toBe(true);
    expect(index!.adjustedPrincipal!.equals(money("1050"))).toBe(true);
    expect(index!.assetDelta.equals(money("50"))).toBe(true);
    expect(index!.basisDelta.equals(money("50"))).toBe(true);
    expect(index!.cashDelta.isZero()).toBe(true);
    expect(index!.netWorthDelta.equals(money("50"))).toBe(true);
    expect(coupon!.grossAmount.equals(money("10.50"))).toBe(true); // face-only coupon would be $10
    expect(coupon!.cashDelta.equals(money("10.50"))).toBe(true);
    expect(coupon!.assetDelta.isZero()).toBe(true);
    expect(coupon!.basisDelta.isZero()).toBe(true);
    expect(coupon!.dependsOn).toEqual([index!.operationId]);
    expect(coupon!.destination).toBe("wrapper-cash");
    expect(coupon!.taxFacts[0]!.incomeCharacter).toBe("coupon_interest");
    expect(index!.taxFacts[0]!.incomeCharacter).toBe("noncash_inflation_oid");
    expect(index!.taxFacts[0]!.taxable.equals(money("50"))).toBe(true);
    for (const p of r.proposals) {
      expect(p.status).toBe("conditional_uncommitted"); expect(p.contractVersion).toBe("d2-shared/v1");
      expect(p.netWorthDelta.equals(p.cashDelta.plus(p.assetDelta))).toBe(true);
      expect(p.conditions).toContain("claim_uncommitted");
      expect(p.sources.map(s => s.sourceId)).toContain("issue-base");
    }
    expect(cov(r, "federal_tax").coverage).toBe("complete");
    expect(cov(r, "settlement").coverage).toBe("incomplete");
    expect(cov(r, "maturity").coverage).toBe("not_applicable");
    expect(cov(r, "basis").traceRefs).toContain("cpi:2025-11-01");
  });

  it("honors issue-specific base and lag, and exact day interpolation at month boundaries", () => {
    const jan31 = proposeTips(request({ effectiveAt: date("2026-01-31") }));
    expect(jan31.proposals[0]!.referenceCpi!.toString()).toBe("104.83871");
    expect(jan31.proposals[0]!.adjustedPrincipal!.equals(money("1048.39"))).toBe(true);
    expect(jan31.proposals).toHaveLength(1);
    const alternate = request({ rule: { ...rule(), lagMonths: 2, base: { ...rule().base, denominator: decimal("200") } },
      observations: [point("2025-11-01", "200"), point("2025-12-01", "220")] });
    expect(proposeTips(alternate).proposals[0]!.adjustedPrincipal!.equals(money("1100"))).toBe(true);
    // At day 1 only the lagged month is needed, not a guessed later observation.
    const missingUnused = request({ observations: [point("2025-10-01", "100"), point("2025-11-01", "105")] });
    expect(proposeTips(missingUnused).proposals).toHaveLength(2);
    blocked(request({ effectiveAt: date("2026-01-31"), observations: [point("2025-10-01", "100")] }), "CPI_REQUIRED");
  });

  it("uses Gregorian leap-February day counts with no rounded intermediate fraction", () => {
    const l = lot(); const law = rule();
    const input = request({ period: { start: date("2024-02-01"), endExclusive: date("2024-03-01") }, effectiveAt: date("2024-02-29"),
      lot: { ...l, issueDate: date("2023-08-01"), purchaseDate: date("2023-08-01"), maturityDate: date("2024-08-01"),
        firstCouponDate: date("2024-08-01"), lastCouponDate: date("2024-08-01"), couponDates: [date("2024-08-01")],
        opening: { ...l.opening, at: date("2024-02-01") } },
      rule: { ...law, base: { ...law.base, referenceDate: date("2023-08-01"), source: { ...source("base"), start: date("2023-01-01") } } },
      observations: [point("2023-11-01", "100"), point("2023-12-01", "129")].map(p => ({ ...p, source: { ...p.source, start: date("2023-01-01") } })) });
    expect(proposeTips(input).proposals[0]!.referenceCpi!.toString()).toBe("128");
    expect(proposeTips(input).proposals[0]!.adjustedPrincipal!.equals(money("1280"))).toBe(true);
  });

  it("admits observed CPI only once published and known, including publication date", () => {
    const p = { ...point("2025-11-01", "105"), source: { ...source("late-release"), publishedAt: date("2026-02-02"), asOf: date("2026-02-02") } };
    const input = request({ observations: [point("2025-10-01", "100"), p], knownAt: date("2026-02-01") });
    blocked(input, "SOURCE_NOT_ADMITTED");
    // Hindsight publication remains inadmissible for a coupon dated the prior day,
    // even when the later replay now knows that observation.
    blocked({ ...input, knownAt: date("2026-02-02") }, "SOURCE_NOT_ADMITTED");
    blocked(request({ observations: [point("2025-10-01", "100"), { ...point("2025-11-01", "105"),
      source: { ...source("premature-release"), publishedAt: date("2025-11-15"), asOf: date("2025-11-15") } }] }), "SOURCE_NOT_ADMITTED");
    blocked(request({ observations: [point("2025-10-01", "100")] }), "CPI_REQUIRED");
    blocked(request({ observations: [...request().observations, point("2025-11-01", "106")] }), "CPI_CONFLICT");
  });

  it("applies explicit cent tie rounding and arbitrary large exact amounts", () => {
    const l = lot();
    const input = request({ lot: { ...l, annualCouponRate: decimal("0.01") },
      observations: [point("2025-10-01", "100"), point("2025-11-01", "100.1")] });
    expect(proposeTips(input).proposals[1]!.grossAmount.equals(money("5.01"))).toBe(true);
    expect(proposeTips({ ...input, rule: { ...rule(), couponRounding: round(2, "half_even") } }).proposals[1]!.grossAmount.equals(money("5"))).toBe(true);
    const huge = money("900719925474099312345.67");
    const big = proposeTips(request({ lot: { ...l, originalPrincipal: huge, parAmount: huge, fundingCost: huge,
      opening: { ...l.opening, carrying: huge, basis: huge } } }));
    expect(big.proposals[0]!.adjustedPrincipal!.equals(money("945755921747804277962.95"))).toBe(true);
    expect(big.proposals[0]!.basisDelta.equals(money("45035996273704965617.28"))).toBe(true);
    expect(big.proposals[1]!.grossAmount.equals(money("9457559217478042779.63"))).toBe(true);
  });

  it("keeps signed deflation noncash and gates deflation variants without an admitted rule", () => {
    const input = request({ observations: [point("2025-10-01", "100"), point("2025-11-01", "95")] });
    const r = proposeTips(input);
    expect(r.proposals[0]!.basisDelta.equals(money("-50"))).toBe(true);
    expect(r.proposals[0]!.cashDelta.isZero()).toBe(true);
    expect(r.proposals[0]!.taxFacts[0]!.incomeCharacter).toBe("noncash_deflation_adjustment");
    expect(r.proposals[0]!.taxFacts[0]!.taxable.equals(money("-50"))).toBe(true);
    expect(r.proposals[1]!.grossAmount.equals(money("9.50"))).toBe(true);
    blocked({ ...input, rule: { ...rule(), deflation: "unsupported" } }, "DEFLATION_NOT_ADMITTED");
  });

  it("redeems at the eligible original-par floor with a separate maturity-day coupon", () => {
    const r = proposeTips(maturity());
    expect(r.proposals.map(p => p.kind)).toEqual(["indexation", "computed_coupon", "maturity"]);
    const [index, coupon, principal] = r.proposals;
    expect(index!.grossAmount.equals(money("-150"))).toBe(true);
    expect(coupon!.grossAmount.equals(money("9.50"))).toBe(true);
    expect(principal!.grossAmount.equals(money("1000"))).toBe(true);
    expect(principal!.adjustedPrincipal!.equals(money("950"))).toBe(true);
    expect(principal!.assetDelta.equals(money("-950"))).toBe(true);
    expect(principal!.basisDelta.equals(money("-950"))).toBe(true);
    expect(principal!.recognitionFacts).toEqual([{ character: "maturity_floor_uplift", amount: money("50") }]);
    expect(principal!.taxFacts).toEqual([]);
    expect(principal!.claimId).not.toBe(coupon!.claimId);
    expect(index!.assetDelta.plus(principal!.assetDelta).equals(money("-1100"))).toBe(true);
    expect(index!.basisDelta.plus(principal!.basisDelta).equals(money("-1100"))).toBe(true);
    expect(cov(r, "federal_tax").diagnosticCode).toBe("FLOOR_TAX_CHARACTER_REQUIRED");
    const above = proposeTips(maturity("120"));
    expect(above.proposals[2]!.grossAmount.equals(money("1200"))).toBe(true);
    expect(above.proposals[2]!.netWorthDelta.isZero()).toBe(true);
    expect(above.proposals[2]!.recognitionFacts).toEqual([]);
    expect(above.proposals[2]!.taxFacts).toEqual([]); // already recognized indexation is not taxed again
    const unknownFloor = proposeTips({ ...maturity(), rule: { ...rule(), maturityFloor: "unsupported" } });
    expect(unknownFloor.proposals.map(p => p.kind)).toEqual(["indexation", "computed_coupon"]);
    expect(cov(unknownFloor, "maturity").coverage).toBe("incomplete");
    blocked({ ...maturity(), observations: [point("2026-04-01", "110")] }, "CPI_REQUIRED", "maturity");
  });

  it("requires dated tax laws by wrapper/jurisdiction and never emits deferred current OID", () => {
    const deferred = request({ lot: { ...lot(), taxBucket: "tax_deferred" }, taxRules: [tax("US", "tax_deferred"), tax("US:synthetic_state", "tax_deferred")] });
    const r = proposeTips(deferred);
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals.every(p => p.taxFacts.length === 0)).toBe(true);
    expect(cov(r, "federal_tax").coverage).toBe("not_applicable");
    const noLaw = proposeTips(request({ taxRules: [] }));
    expect(noLaw.proposals).toHaveLength(2);
    expect(cov(noLaw, "federal_tax").diagnosticCode).toBe("TAX_LAW_REQUIRED");
    expect(cov(noLaw, "state_tax").coverage).toBe("incomplete");
    expect(noLaw.proposals.every(p => p.taxFacts.length === 0)).toBe(true);
    const federalOnly = proposeTips(request({ taxRules: [tax()] }));
    expect(cov(federalOnly, "federal_tax").coverage).toBe("complete");
    expect(cov(federalOnly, "state_tax").coverage).toBe("incomplete");
    const exempt = proposeTips(request({ taxRules: [tax(), { ...tax("US:synthetic_state"), treatment: "exempt" }] }));
    expect(exempt.proposals[0]!.taxFacts[1]!.taxable.isZero()).toBe(true);
    const future = proposeTips(request({ taxRules: [{ ...tax(), source: { ...tax().source, endExclusive: date("2026-01-01") } }] }));
    expect(cov(future, "federal_tax").diagnosticCode).toBe("SOURCE_NOT_ADMITTED");
    const conflict = proposeTips(request({ taxRules: [tax(), { ...tax(), source: source("other-tax") }] }));
    expect(cov(conflict, "federal_tax").diagnosticCode).toBe("TAX_LAW_CONFLICT");
    expect(cov(proposeTips({ ...deferred, taxRules: [tax()] }), "federal_tax").coverage).toBe("incomplete");
    const crossYear = proposeTips(request({ period: { start: date("2025-12-01"), endExclusive: date("2026-02-02") },
      lot: { ...lot(), opening: { ...lot().opening, at: date("2025-12-01") } },
      observations: [point("2025-09-01", "100"), point("2025-11-01", "105")] }));
    expect(crossYear.proposals).toHaveLength(2);
    expect(crossYear.proposals.every(p => p.taxFacts.length === 0)).toBe(true);
    expect(cov(crossYear, "federal_tax").coverage).toBe("incomplete");
  });

  it("rejects malformed/stale sources, amounts, calendars, unsupported lots and actions", () => {
    for (const patch of [
      { ...lot(), purchaseKind: "secondary_market" as const }, { ...lot(), fundingCost: money("1001") },
      { ...lot(), fundingCost: money("999") }, { ...lot(), lotTreatment: "special_basis_or_multiple_lots" as const },
      { ...lot(), taxBucket: "unknown" as const }, { ...lot(), destination: { ...lot().destination, personId: "bob" } },
      { ...lot(), destination: { ...lot().destination, wrapperId: "other" } }, { ...lot(), basisId: "" },
    ]) blocked(request({ lot: patch }), "LOT_NOT_ADMITTED");
    for (const action of ["sale", "split", "early_redemption"] as const) blocked(request({ action }), "LOT_NOT_ADMITTED");
    for (const amount of [money("-1"), money("1000.001"), money("1000", Currency.of("EUR"))]) {
      blocked(request({ lot: { ...lot(), originalPrincipal: amount } }), "CURRENCY_OR_AMOUNT_INVALID");
    }
    blocked(request({ observations: [point("2025-10-01", "100"), point("2025-11-01", "-105")] }), "NEGATIVE_PRINCIPAL");
    for (const s of [{ ...source("lot"), sourcePublication: "" }, { ...source("lot"), projectionStatus: "explicit_projected" as const },
      { ...source("lot"), endExclusive: date("2026-02-01") }, { ...source("lot"), asOf: date("2024-01-01") },
      { ...source("lot"), publishedAt: "undated" as TipsSource["publishedAt"] }]) {
      const r = proposeTips(request({ lot: { ...lot(), source: s } }));
      expect(r.proposals).toEqual([]); expect(cov(r, "indexation").coverage).toBe("incomplete");
    }
    for (const patch of [{ ...rule(), issueId: "other-issue" }, { ...rule(), interpolation: "unsupported" as const },
      { ...rule(), calendar: "unsupported" as const }, { ...rule(), lagMonths: -1 },
      { ...rule(), base: { ...rule().base, denominator: decimal("0") } },
      { ...rule(), principalRounding: round(3) }, { ...rule(), couponRounding: round(2, "unknown" as RoundingPolicy["mode"]) }]) {
      blocked(request({ rule: patch }), "CONVENTION_NOT_ADMITTED");
    }
    blocked(request({ lot: { ...lot(), opening: { ...lot().opening, basis: money("999") } } }), "OPENING_NOT_RECONCILED");
    blocked(request({ lot: { ...lot(), opening: { ...lot().opening, source: source("opening-before-checkpoint") } } }), "SOURCE_NOT_ADMITTED");
    blocked(request({ lot: { ...lot(), source: undefined as unknown as TipsSource } }), "INVALID_REQUEST");
    blocked(request({ lot: { ...lot(), couponDates: [...lot().couponDates, lot().firstCouponDate] } }), "DUPLICATE_COUPON");
    const unsupportedCoupon = proposeTips(request({ rule: { ...rule(), couponPeriods: [] } }));
    expect(unsupportedCoupon.proposals.map(p => p.kind)).toEqual(["indexation"]);
    expect(cov(unsupportedCoupon, "computed_coupon").diagnosticCode).toBe("COUPON_PERIOD_REQUIRED");
    blocked(request({ period: { start: date("2026-01-01"), endExclusive: date("2026-02-01") } }), "INVALID_REQUEST");
  });

  it("preserves conditional catalog facts and admits quotes without claiming computed CPI coupons", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    const cases = catalog.cases.filter(c => ["tips_accretion", "tips_coupon", "tips_maturity"].includes(c.id));
    const before = JSON.stringify(cases);
    expect(cases).toHaveLength(3);
    for (const c of cases) { expect(c.expected.capability).toBe("decision_required"); expect(c.expected.integratedRuntimeEvidence).toBe(false); }
    expect(cases.find(c => c.id === "tips_accretion")!.input.amounts.originalPrincipalCents).toBe("100000");
    expect(cases.find(c => c.id === "tips_maturity")!.input.amounts.originalPrincipalCents).toBe("100000");
    const c = cases.find(c => c.id === "tips_coupon")!;
    expect(c.input.amounts.quotedAdjustedPrincipalCents).toBe("105000");
    expect(c.input.amounts.quotedCouponCents).toBe("1000"); expect(c.input.terms.eventDate).toBe("2026-01-15");
    const { rule: unused, ...withoutRule } = request();
    const input: TipsRequest = { ...withoutRule, effectiveAt: date("2026-01-15"), observations: [], taxRules: [],
      lot: { ...lot(), firstCouponDate: date("2026-01-15"), couponDates: [date("2026-01-15"), lot().lastCouponDate] },
      couponQuote: { quoteId: "catalog-quote", paymentDate: date("2026-01-15"), amount: money("10"), source: source("quote") } };
    const r = proposeTips(input);
    expect(r.proposals.map(p => p.kind)).toEqual(["quoted_coupon"]);
    expect(r.proposals[0]!.cashDelta.equals(money("10"))).toBe(true);
    expect(r.proposals[0]!.adjustedPrincipal).toBeNull();
    for (const output of ["indexation", "basis", "computed_coupon", "federal_tax", "state_tax", "settlement"] as const) {
      expect(cov(r, output).coverage).toBe("incomplete");
    }
    expect(cov(r, "quoted_coupon").coverage).toBe("complete");
    blocked({ ...input, couponQuote: { ...input.couponQuote!, amount: money("-1") } }, "CURRENCY_OR_AMOUNT_INVALID", "quoted_coupon");
    expect(JSON.stringify(cases)).toBe(before);
  });

  it("returns immutable copied snapshots and replay/order-independent issue/owner/lot identities", () => {
    const input = request(); const before = JSON.stringify(input); const r = proposeTips(input);
    expect(proposeTips(input)).toEqual(r);
    expect(proposeTips({ ...input, observations: [...input.observations].reverse(), taxRules: [...input.taxRules].reverse(),
      lot: { ...input.lot, couponDates: [...input.lot.couponDates].reverse() }, rule: { ...rule(), couponPeriods: [...rule().couponPeriods].reverse() } })).toEqual(r);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(r)).toBe(true); expect(Object.isFrozen(r.proposals[0]!.sources[0])).toBe(true);
    expect(Object.isFrozen(r.proposals[0]!.taxFacts)).toBe(true); expect(Object.isFrozen(r.coverage[0]!.period)).toBe(true);
    expect(Object.isFrozen(input.lot.source)).toBe(false);
    expect(r.proposals[0]!.sources[0]).not.toBe(input.lot.source);
    const bob = proposeTips(request({ lot: { ...lot(), personId: "bob", destination: { ...lot().destination, personId: "bob" } } }));
    const otherLot = proposeTips(request({ lot: { ...lot(), lotId: "lot-b", basisId: "basis-b" } }));
    const otherIssue = proposeTips(request({ lot: { ...lot(), issueId: "issue-b" }, rule: { ...rule(), issueId: "issue-b" } }));
    for (const other of [bob, otherLot, otherIssue]) {
      expect(other.proposals[0]!.operationId).not.toBe(r.proposals[0]!.operationId);
      expect(other.proposals[1]!.claimId).not.toBe(r.proposals[1]!.claimId);
    }
    const { rule: unused, ...noRule } = request();
    const quote = proposeTips({ ...noRule, couponQuote: { quoteId: "q", paymentDate: input.effectiveAt, amount: money("10.50"), source: source("q") } });
    expect(quote.proposals[0]!.claimId).toBe(r.proposals[1]!.claimId);
  });
});
