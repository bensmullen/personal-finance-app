import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeSeriesEE, type EEAccrualPeriod, type EELot, type EEOutput, type EERequest, type EERule, type EESource, type EETaxRule } from "../../../../src/simulation/d2/fixedIncome/seriesEE/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, RoundingPolicy, decimal, money } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const date = civilDate;
// Entirely synthetic schedules, dates and law: not actual Treasury terms/rates.
const source = (id: string, jurisdiction = "US"): EESource => ({ sourceId: id, ruleSnapshotId: `${id}:v1`, ruleFamily: "series_ee",
  sourcePublication: "Synthetic isolated EE evidence, not actual statutory or market evidence", authority: "externally_verified",
  publishedAt: date("1999-01-01"), asOf: date("1999-01-01"), version: "synthetic-v1", jurisdiction,
  start: date("1999-01-01"), endExclusive: date("2040-01-01"), projectionStatus: "verified" });
const month = (offset: number) => date(`${2000 + Math.floor(offset / 12)}-${String(offset % 12 + 1).padStart(2, "0")}-01`);
const rows = (months: number, rate = "0.01", capitalization = 1): EEAccrualPeriod[] => Array.from({ length: months }, (_, i) => ({
  start: month(i), endExclusive: month(i + 1), periodRate: decimal(rate), capitalize: (i + 1) % capitalization === 0, source: source(`month:${i}`),
}));
const lot = (): EELot => ({ householdId: "hh", personId: "alice", beneficiaryId: "bob", holdingId: "ee-position", bondId: "bond-a",
  lotId: "lot-a", basisId: "basis-a", wrapperId: "treasury-wrapper", taxBucket: "taxable", stateJurisdiction: "US:synthetic_state",
  localJurisdiction: "US:synthetic_local", fundingAccountId: "original-funding",
  destination: { accountId: "wrapper-cash", personId: "alice", wrapperId: "treasury-wrapper", kind: "wrapper_cash" },
  issueMonth: month(0), purchaseDate: month(0), acquisitionDate: month(0), face: money("1000"), purchaseCost: money("1000"), acquisitionCost: money("1000"),
  treatment: "ordinary_original_owner", source: { ...source("lot"), asOf: month(0) },
  opening: { at: month(0), carrying: money("1000"), purchaseBasis: money("1000"), recognizedFederalInterest: money("0"),
    election: "redemption", redeemed: false, source: { ...source("opening"), asOf: month(0) } } });
const rule = (): EERule => ({ issueMonth: month(0), source: source("rule"), method: "fixed_issue_schedule",
  posting: "monthly_interest_rounded_then_capitalized", interestRounding: new RoundingPolicy(2, "half_up"), capitalizationMonths: 1,
  stopAccruingAt: month(360), firstRedeemableAt: month(12), penalty: { endExclusive: month(60), forfeitureMonths: 3, treatment: "last_monthly_interest_only" },
  guarantee: { at: month(240), purchaseMultiple: decimal("2"), eligible: true }, schedule: rows(360) });
const tax = (jurisdiction = "US", election: EETaxRule["election"] = "redemption"): EETaxRule => ({ source: source(`tax:${jurisdiction}`, jurisdiction),
  issueMonth: month(0), election, treatment: jurisdiction === "US" ? "federal_interest_less_previously_recognized" : "state_local_exempt" });
const request = (patch: Partial<EERequest> = {}): EERequest => ({ lot: lot(), rule: rule(), action: "valuation", effectiveAt: month(12), knownAt: month(13),
  period: { start: month(0), endExclusive: month(14) }, taxRules: [tax(), tax(lot().stateJurisdiction), tax(lot().localJurisdiction)], ...patch });
const cov = (r: ReturnType<typeof proposeSeriesEE>, o: EEOutput) => r.coverage.find(c => c.affectedOutput === o)!;
const blocked = (r: EERequest, code: string, o: EEOutput = "accrued_value") => {
  const result = proposeSeriesEE(r);
  expect(cov(result, o).coverage).toBe("incomplete"); expect(cov(result, o).diagnosticCode).toBe(code); expect(result.proposals).toEqual([]);
};
const redeem = (r = request()): EERequest => {
  const calculated = proposeSeriesEE(r).values!.redemptionValue!;
  return { ...r, action: "redemption", redemptionQuote: { quoteId: "observed-redemption", at: r.effectiveAt, amount: calculated,
    source: { ...source("quote"), asOf: r.effectiveAt } } };
};

describe("isolated source-qualified Series EE proposals, PFA-DET §5.6/S1–S8", () => {
  it("compounds exact monthly interest and forfeits the last sourced three months", () => {
    const r = proposeSeriesEE(request());
    expect(r.values!.accruedValue.equals(money("1126.84"))).toBe(true);
    expect(r.values!.creditedInterest.equals(money("126.84"))).toBe(true);
    expect(r.values!.redemptionValue!.equals(money("1093.69"))).toBe(true);
    expect(r.values!.forfeitedInterest.equals(money("33.15"))).toBe(true);
    expect(r.proposals[0]!.cashDelta.isZero()).toBe(true);
    expect(r.proposals[0]!.assetDelta.equals(money("126.84"))).toBe(true);
    expect(r.proposals[0]!.taxFacts[0]!.taxable.isZero()).toBe(true);
    expect(cov(r, "settlement").diagnosticCode).toBe("SHARED_SETTLEMENT_PENDING");
  });
  it("supports sourced semiannual capitalization and a distinct historical period schedule", () => {
    const semi = proposeSeriesEE(request({ rule: { ...rule(), capitalizationMonths: 6, schedule: rows(12, "0.01", 6) } }));
    expect(semi.values!.accruedValue.equals(money("1123.60"))).toBe(true);
    const legacy = rows(12, "0", 6).map((r, i) => ({ ...r, periodRate: decimal(i < 6 ? "0.01" : "0.02") }));
    const historical = proposeSeriesEE(request({ rule: { ...rule(), method: "historical_issue_schedule", capitalizationMonths: 6, schedule: legacy } }));
    expect(historical.values!.accruedValue.equals(money("1187.20"))).toBe(true);
    const paper = lot();
    const discounted = proposeSeriesEE(request({ lot: { ...paper, face: money("2000") } }));
    expect(discounted.values!.purchaseBasis!.equals(money("1000"))).toBe(true);
  });
  it("uses full completed issue months on month-end/leap dates and never earns coupons", () => {
    const r = proposeSeriesEE(request({ effectiveAt: date("2000-02-29") }));
    expect(r.values!.accruedValue.equals(money("1010"))).toBe(true);
    expect(r.values!.redemptionValue).toBeNull(); expect(r.proposals[0]!.cashDelta.isZero()).toBe(true);
    expect(proposeSeriesEE(request({ effectiveAt: date("2000-01-31") })).values!.accruedValue.equals(money("1000"))).toBe(true);
    expect(proposeSeriesEE(request({ effectiveAt: month(2) })).values!.accruedValue.equals(money("1020.10"))).toBe(true);
  });
  it("honors exact first redemption and penalty-window boundaries without hardcoded legal values", () => {
    const before = request({ effectiveAt: date("2000-12-31") });
    blocked({ ...before, action: "redemption" }, "HOLD_RESTRICTION", "redemption_value");
    const unusual = { ...rule(), firstRedeemableAt: month(2), penalty: { ...rule().penalty, endExclusive: month(3), forfeitureMonths: 1 } };
    const first = proposeSeriesEE(request({ rule: unusual, effectiveAt: month(2) }));
    expect(first.values!.redemptionValue!.equals(money("1010"))).toBe(true);
    const end = proposeSeriesEE(request({ rule: unusual, effectiveAt: month(3) }));
    expect(end.values!.forfeitedInterest.isZero()).toBe(true);
    const noPenalty = proposeSeriesEE(request({ rule: { ...unusual, penalty: { ...unusual.penalty, forfeitureMonths: 0 } }, effectiveAt: month(2) }));
    expect(noPenalty.values!.forfeitedInterest.isZero()).toBe(true);
    const five = proposeSeriesEE(request({ effectiveAt: month(60), knownAt: month(61), period: { start: month(0), endExclusive: month(62) } }));
    expect(five.values!.forfeitedInterest.isZero()).toBe(true);
  });
  it("applies guarantee catch-up once at sourced twenty-year boundary and stops at thirty years", () => {
    const base = request({ rule: { ...rule(), schedule: rows(360, "0") }, effectiveAt: month(239), knownAt: month(362),
      period: { start: month(0), endExclusive: month(363) } });
    expect(proposeSeriesEE(base).values!.accruedValue.equals(money("1000"))).toBe(true);
    const at = proposeSeriesEE({ ...base, effectiveAt: month(240) });
    expect(at.values!.accruedValue.equals(money("2000"))).toBe(true); expect(at.values!.guaranteeUplift.equals(money("1000"))).toBe(true);
    const after = proposeSeriesEE({ ...base, effectiveAt: month(241) });
    expect(after.values!.guaranteeUplift.equals(money("1000"))).toBe(true);
    expect(proposeSeriesEE({ ...base, effectiveAt: month(360) }).values).toEqual(proposeSeriesEE({ ...base, effectiveAt: month(361) }).values);
    const checkpoint = { ...lot(), opening: { ...lot().opening, at: month(240), carrying: money("2000"), source: { ...source("opening"), asOf: month(240) } } };
    const replay = proposeSeriesEE({ ...base, lot: checkpoint, effectiveAt: month(241), period: { start: month(240), endExclusive: month(242) } });
    expect(replay.proposals[0]!.assetDelta.isZero()).toBe(true);
    const ineligible = proposeSeriesEE({ ...base, effectiveAt: month(240), rule: { ...base.rule!, guarantee: { ...rule().guarantee!, eligible: false } } });
    expect(ineligible.values!.guaranteeUplift.isZero()).toBe(true);
    const alternative = proposeSeriesEE({ ...base, effectiveAt: month(6), rule: { ...base.rule!, guarantee: { at: month(6), purchaseMultiple: decimal("1.5"), eligible: true } } });
    expect(alternative.values!.accruedValue.equals(money("1500"))).toBe(true);
    const aboveFloor = proposeSeriesEE({ ...base, effectiveAt: month(240), rule: rule() });
    expect(aboveFloor.values!.guaranteeUplift.isZero()).toBe(true);
  });
  it("rejects missing early/later history, ambiguous schedules and unsupported conventions", () => {
    for (const index of [0, 11]) blocked(request({ rule: { ...rule(), schedule: rows(12).filter((_, i) => i !== index) } }), "SCHEDULE_INCOMPLETE");
    blocked(request({ rule: { ...rule(), schedule: [...rows(12), rows(1)[0]!] } }), "CONVENTION_NOT_ADMITTED");
    blocked(request({ rule: { ...rule(), method: "unsupported" } }), "CONVENTION_NOT_ADMITTED");
    blocked(request({ rule: { ...rule(), capitalizationMonths: 6 } }), "CONVENTION_NOT_ADMITTED");
    blocked(request({ rule: { ...rule(), schedule: rows(11) } }), "SCHEDULE_INCOMPLETE");
    const { rule: omitted, ...noRule } = request();
    expect(omitted).toBeDefined(); blocked(noRule, "RULE_REQUIRED");
  });
  it("checks full period coverage and rejects actual publication after cash event even in hindsight", () => {
    const schedule = rows(12); schedule[0] = { ...schedule[0]!, source: { ...source("short"), endExclusive: date("2000-01-20") } };
    blocked(request({ rule: { ...rule(), schedule } }), "SOURCE_NOT_ADMITTED");
    const r = redeem();
    blocked({ ...r, knownAt: month(20), redemptionQuote: { ...r.redemptionQuote!, source: { ...source("late"), publishedAt: month(13), asOf: month(13) } } }, "SOURCE_NOT_ADMITTED", "redemption_value");
    blocked(request({ rule: { ...rule(), source: { ...source("future"), publishedAt: month(13), asOf: month(13) } } }), "SOURCE_NOT_ADMITTED");
    blocked(request({ rule: { ...rule(), source: { ...source("projected"), projectionStatus: "explicit_projected" } } }), "SOURCE_NOT_ADMITTED");
    blocked(request({ knownAt: date("2000-12-31") }), "INVALID_REQUEST");
  });
  it("requires matching quote, debits reconciled carrying and proposes wrapper cash only", () => {
    const r = proposeSeriesEE(redeem()); const p = r.proposals[0]!;
    expect(p.cashDelta.equals(money("1093.69"))).toBe(true); expect(p.assetDelta.equals(money("-1000"))).toBe(true);
    expect(p.netWorthDelta.equals(money("93.69"))).toBe(true); expect(p.redeemedPrincipal.equals(money("1000"))).toBe(true);
    expect(p.destination).toBe("wrapper-cash"); expect(p.basisDelta.equals(money("-1000"))).toBe(true);
    expect(p.taxFacts.find(t => t.jurisdiction === "US")!.taxable.equals(money("93.69"))).toBe(true);
    expect(p.taxFacts.filter(t => t.jurisdiction !== "US").every(t => t.taxable.isZero())).toBe(true);
    expect(p.contractVersion).toBe("d2-shared/v1"); expect(p.status).toBe("conditional_uncommitted");
    blocked({ ...request(), action: "redemption" }, "QUOTE_REQUIRED", "redemption_value");
    const bad = redeem(); blocked({ ...bad, redemptionQuote: { ...bad.redemptionQuote!, amount: money("1200") } }, "QUOTE_MISMATCH", "redemption_value");
    blocked(request({ lot: { ...lot(), opening: { ...lot().opening, redeemed: true } } }), "DUPLICATE_REDEMPTION");
    blocked(request({ lot: { ...lot(), opening: { ...lot().opening, carrying: money("1001") } } }), "OPENING_NOT_RECONCILED");
  });
  it("subtracts historically recognized interest without recognizing prior economic accrual twice", () => {
    const l: EELot = { ...lot(), opening: { ...lot().opening, at: month(11), carrying: money("1115.68"), recognizedFederalInterest: money("50"),
      source: { ...source("opening"), asOf: month(11) } } };
    const r = proposeSeriesEE(redeem(request({ lot: l, period: { start: month(11), endExclusive: month(14) } })));
    const p = r.proposals[0]!;
    expect(p.recognitionFacts[0]!.amount.equals(money("-21.99"))).toBe(true);
    expect(p.taxFacts.find(t => t.jurisdiction === "US")!.taxable.equals(money("43.69"))).toBe(true);
    expect(p.taxFacts[0]!.previouslyRecognized.equals(money("50"))).toBe(true);
  });
  it("admits current-accrual election only with reconciled history and same-year tax checkpoint", () => {
    const l: EELot = { ...lot(), opening: { ...lot().opening, at: month(1), carrying: money("1010"), recognizedFederalInterest: money("10"), election: "current_accrual",
      source: { ...source("opening"), asOf: month(1) } } };
    const r = request({ lot: l, effectiveAt: month(2), period: { start: month(1), endExclusive: month(3) },
      taxRules: [tax("US", "current_accrual"), tax(l.stateJurisdiction, "current_accrual"), tax(l.localJurisdiction, "current_accrual")] });
    expect(proposeSeriesEE(r).proposals[0]!.taxFacts[0]!.taxable.equals(money("10.10"))).toBe(true);
    const incomplete = proposeSeriesEE({ ...r, lot: { ...l, opening: { ...l.opening, recognizedFederalInterest: money("9") } } });
    expect(cov(incomplete, "federal_tax").coverage).toBe("incomplete"); expect(incomplete.proposals[0]!.taxFacts).toEqual([]);
    expect(cov(proposeSeriesEE({ ...r, effectiveAt: month(12), period: { start: month(1), endExclusive: month(13) } }), "federal_tax").coverage).toBe("incomplete");
    const forfeitedPrior: EELot = { ...lot(), opening: { ...lot().opening, at: month(11), carrying: money("1115.68"),
      recognizedFederalInterest: money("115.68"), source: { ...source("opening"), asOf: month(11) } } };
    const taxedForfeiture = proposeSeriesEE(redeem(request({ lot: forfeitedPrior, period: { start: month(11), endExclusive: month(13) } })));
    expect(cov(taxedForfeiture, "federal_tax").coverage).toBe("incomplete");
    expect(taxedForfeiture.proposals[0]!.taxFacts).toEqual([]);
  });
  it("keeps unsupported election, unknown carry basis and missing/nonconforming law incomplete", () => {
    const l = lot();
    const missing = proposeSeriesEE(request({ taxRules: [tax()] }));
    expect(cov(missing, "federal_tax").coverage).toBe("complete"); expect(cov(missing, "state_tax").coverage).toBe("incomplete");
    for (const opening of [{ ...l.opening, election: "unsupported" as const }, { ...l.opening, recognizedFederalInterest: null }, { ...l.opening, purchaseBasis: null }]) {
      const r = proposeSeriesEE(request({ lot: { ...l, opening } }));
      expect(cov(r, "federal_tax").coverage).toBe("incomplete"); expect(r.proposals[0]!.taxFacts).toEqual([]);
      expect(cov(r, "accrued_value").coverage).toBe("complete");
    }
    const r = proposeSeriesEE(request({ taxRules: [tax(), { ...tax(l.stateJurisdiction), treatment: "unsupported" }] }));
    expect(cov(r, "state_tax").coverage).toBe("incomplete");
    const unknownBasis = proposeSeriesEE(request({ lot: { ...l, opening: { ...l.opening, purchaseBasis: null } } }));
    expect(unknownBasis.values!.purchaseBasis).toBeNull();
    const cash = redeem();
    const unknownRedemption = proposeSeriesEE({ ...cash, lot: { ...l, opening: { ...l.opening, purchaseBasis: null } } });
    expect(unknownRedemption.proposals).toEqual([]); expect(cov(unknownRedemption, "basis").coverage).toBe("incomplete");
    expect(cov(proposeSeriesEE(request({ taxRules: [tax(), tax()] })), "federal_tax").coverage).toBe("incomplete");
    blocked(request({ action: "education_redemption" }), "LOT_NOT_ADMITTED"); blocked(request({ action: "special_redemption" }), "LOT_NOT_ADMITTED");
    blocked(request({ lot: { ...l, treatment: "inherited" } }), "LOT_NOT_ADMITTED");
  });
  it("preserves large exact cents and rejects other currencies", () => {
    const huge = money("900719925474099312345.67");
    const l = { ...lot(), face: huge, purchaseCost: huge, acquisitionCost: huge,
      opening: { ...lot().opening, carrying: huge, purchaseBasis: huge } };
    const r = proposeSeriesEE(request({ lot: l, effectiveAt: month(1) }));
    expect(r.values!.accruedValue.equals(money("909727124728840305469.13"))).toBe(true);
    blocked(request({ lot: { ...lot(), face: money("1000", Currency.of("EUR")) } }), "CURRENCY_OR_AMOUNT_INVALID");
  });
  it("keeps people/beneficiaries and claims distinct, snapshots input, and replays deterministically", () => {
    const input = redeem(); const before = JSON.stringify(input); const a = proposeSeriesEE(input); const b = proposeSeriesEE(input);
    expect(a).toEqual(b); expect(JSON.stringify(input)).toBe(before); expect(Object.isFrozen(a.proposals[0]!.values)).toBe(true);
    expect(proposeSeriesEE({ ...input, rule: { ...input.rule!, schedule: [...input.rule!.schedule].reverse() }, taxRules: [...input.taxRules].reverse() })).toEqual(a);
    expect(Object.isFrozen(input)).toBe(false); expect(a.proposals[0]!.beneficiaryId).toBe("bob");
    const bob = { ...lot(), personId: "bob", beneficiaryId: "alice", destination: { ...lot().destination, personId: "bob" } };
    const other = proposeSeriesEE(redeem(request({ lot: bob })));
    expect(other.proposals[0]!.claimId).not.toBe(a.proposals[0]!.claimId);
    const later = proposeSeriesEE(redeem(request({ effectiveAt: date("2001-01-31") })));
    expect(later.proposals[0]!.claimId).toBe(a.proposals[0]!.claimId);
    expect(later.proposals[0]!.operationId).not.toBe(a.proposals[0]!.operationId);
    blocked(request({ lot: { ...lot(), destination: { ...lot().destination, personId: "bob" } } }), "LOT_NOT_ADMITTED");
  });
  it("retains the unchanged quote-only and unknown-accrual fixtures as conditional evidence", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    const quote = catalog.cases.find(c => c.id === "ee_redemption_quote")!;
    const timing = catalog.cases.find(c => c.id === "ee_accrual_timing")!;
    expect(quote.input.amounts.purchaseCents).toBe("100000"); expect(quote.input.amounts.quotedRedemptionCents).toBe("120000");
    for (const c of [quote, timing]) { expect(c.expected.integratedRuntimeEvidence).toBe(false); expect(c.expected.capability).toBe("decision_required"); }
    expect(timing.expected.unknownOutputs).toContain("accrued_value");
  });
});
