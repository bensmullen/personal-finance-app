import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256 } from "../src/rules/tax/t1b/contentIdentity.js";
import { Currency, money } from "../src/values/index.js";
import {
  canonical, contentIdentity, decimal, evaluateCapitalLoss, evaluateHarvest, evaluateLandExchange, evaluateWashSales,
  harvestActivityFingerprint, law, openingCapitalState, ruleFingerprint,
  type AccountId, type LotId, type Outcome, type OwnerId,
} from "../src/rules/tax/t1b/index.js";
import { acquisition, capitalInput, context, exchangeInput, harvestInput, no, parcel, sale, unknown, washInput, yes } from "./fixtures/t1bTaxRules.js";

const value = <T>(result: Outcome<T>): T => {
  if (result.status !== "complete") throw new Error(canonical(result.diagnostics));
  return result.value;
};
const codes = <T>(result: Outcome<T>): readonly string[] => result.status === "incomplete" ? result.diagnostics.map(d => d.code) : [];
const amount = (m: ReturnType<typeof money>): string => m.amount.toString();
const eligibleExchange = (input = exchangeInput()) => {
  const result = value(evaluateLandExchange(input));
  if (result.eligibility !== "eligible") throw new Error(canonical(result));
  return result;
};

describe("T1B compact content identities", () => {
  it.each(["", "abc", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    ...[55, 56, 63, 64, 65, 1000].map(length => "a".repeat(length)), "é税🙂"])("uses standard SHA-256 for %j", text => {
    expect(sha256(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });
  it("binds canonical values and domain without depending on object key order", () => {
    expect(contentIdentity("a", { b: 2, a: 1 })).toBe(contentIdentity("a", { a: 1, b: 2 }));
    expect(contentIdentity("a", { a: 1 })).not.toBe(contentIdentity("b", { a: 1 }));
    expect(contentIdentity("a", { a: 1 })).not.toBe(contentIdentity("a", { a: 2 }));
  });
});

describe("PFA-TAX-016 isolated federal wash-sale rules", () => {
  it.each([
    ["2025-06-15", 100, "long", false], ["2025-06-15", 400, "short", false],
    ["2025-06-15", 100, "short", true], ["2025-06-15", 400, "long", true],
    ["2025-02-28", 366, "short", true], ["2025-02-28", 366, "long", false],
    ["2025-02-28", 367, "long", true], ["2025-03-01", 365, "short", true],
    ["2025-03-01", 366, "long", true], ["2028-02-29", 365, "short", true],
    ["2028-02-29", 366, "long", true],
  ] as const)("checks calendar holding character: %s / %s / %s", (date, holdingPeriodDays, character, supported) => {
    const result = evaluateWashSales({ ...washInput([sale({ date, holdingPeriodDays, character })], []),
      context: context(Number(date.slice(0, 4))), observedThrough: `${date.slice(0, 4)}-12-31` });
    expect(result.status).toBe(supported ? "complete" : "incomplete");
    if (!supported) expect(codes(result)).toContain("HOLDING_PERIOD_CHARACTER_CONTRADICTION");
    else expect(value(result).sales[0]!.character).toBe(character);
  });
  it("preserves supported long-term wash matching and holding-period tacking", () => {
    const r = value(evaluateWashSales(washInput([sale({ holdingPeriodDays: 400, character: "long" })])));
    expect(r.sales[0]!.character).toBe("long");
    expect(amount(r.sales[0]!.disallowedLoss)).toBe("1000");
    expect(r.state.adjustments[0]!.tackedHoldingDays).toBe(400);
    expect(amount(r.replacements[0]!.adjustedBasis)).toBe("2200");
  });
  it.each([
    ["2025-05-15", "0"], ["2025-05-16", "1000"], ["2025-05-17", "1000"],
    ["2025-07-14", "1000"], ["2025-07-15", "1000"], ["2025-07-16", "0"],
  ])("uses inclusive 30-day endpoints: %s", (date, expected) => {
    expect(amount(value(evaluateWashSales(washInput([sale()], [acquisition({ date })]))).sales[0]!.disallowedLoss)).toBe(expected);
  });
  it("matches oldest purchases first, conserves partial quantities and preserves lot lineage", () => {
    const a = acquisition({ quantity: decimal("30"), originalCost: money("360") });
    const b = acquisition({ id: "buy-2", lot: "second-lot" as LotId, date: "2025-06-21", quantity: decimal("20"), originalCost: money("240") });
    const input = washInput([sale()], [b, a]);
    const result = value(evaluateWashSales(input));
    expect(result.state.adjustments.map(m => [m.acquisitionId, m.quantity.toString(), amount(m.disallowedLoss)])).toEqual([["buy-1", "30", "300"], ["buy-2", "20", "200"]]);
    expect(result.replacements.map(r => amount(r.adjustedBasis))).toEqual(["660", "440"]);
    expect(amount(result.sales[0]!.eligibleLoss)).toBe("500");
    expect(result.state.adjustments[0]!.tackedHoldingDays).toBe(100);
    expect(canonical(evaluateWashSales({ ...input, acquisitions: [a, b], similarity: [...input.similarity].reverse() }))).toBe(canonical(evaluateWashSales(input)));
  });
  it("does not assign an acquisition twice across multiple sales", () => {
    const s1 = sale({ quantity: decimal("50"), basis: money("1000"), netProceeds: money("500") });
    const s2 = sale({ id: "sale-2", lot: "lot-2" as LotId, executionOrder: 2, quantity: decimal("50"), basis: money("1500"), netProceeds: money("500") });
    const result = value(evaluateWashSales(washInput([s2, s1], [acquisition({ quantity: decimal("60") })])));
    expect(result.sales.map(s => amount(s.disallowedLoss))).toEqual(["500", "200"]);
    expect(result.state.adjustments.map(m => m.quantity.toString())).toEqual(["50", "10"]);
  });
  it("uses cumulative cent rounding for exact allocation across three partials", () => {
    const buys = [1, 2, 3].map(n => acquisition({ id: `b${n}`, lot: `lot-${n}` as LotId, executionOrder: n, quantity: decimal("0.1") }));
    const result = value(evaluateWashSales(washInput([sale({ quantity: decimal("0.3"), basis: money("1"), netProceeds: money("0.99") })], buys)));
    expect(result.state.adjustments.map(m => amount(m.disallowedLoss))).toEqual(["0", "0.01", "0"]);
    expect(amount(result.sales[0]!.eligibleLoss)).toBe("0");
  });
  it.each(["ira", "roth_ira"] as const)("permanently disallows %s replacement loss without basis or holding-period increase", accountKind => {
    const result = value(evaluateWashSales(washInput([sale()], [acquisition({ accountKind })])));
    expect(amount(result.state.adjustments[0]!.permanentlyDisallowed)).toBe("1000");
    expect(amount(result.state.adjustments[0]!.basisIncrease)).toBe("0");
    expect(amount(result.replacements[0]!.adjustedBasis)).toBe("1200");
    expect(result.state.adjustments[0]!.tackedHoldingDays).toBe(0);
  });
  it.each(["spouse", "controlled_entity"] as const)("uses verified %s beneficial ownership across accounts", relationship => {
    const a = acquisition({ relationship, beneficialOwner: "other-owner" as OwnerId, economicOwner: "other-owner" as OwnerId, account: "external-account" as AccountId });
    expect(amount(value(evaluateWashSales(washInput([sale()], [a]))).sales[0]!.disallowedLoss)).toBe("1000");
  });
  it("keeps unrelated acquisitions and verified dissimilar securities clean", () => {
    expect(amount(value(evaluateWashSales(washInput([sale()], [acquisition({ relationship: "unrelated" })]))).sales[0]!.eligibleLoss)).toBe("1000");
    const i = washInput();
    expect(amount(value(evaluateWashSales({ ...i, similarity: [{ ...i.similarity[0]!, substantiallyIdentical: no }] })).sales[0]!.eligibleLoss)).toBe("1000");
  });
  it("fails closed for missing external coverage, legal similarity and observation window", () => {
    const i = washInput();
    expect(codes(evaluateWashSales({ ...i, coverage: unknown }))).toContain("EXTERNAL_ACCOUNT_COVERAGE_UNKNOWN");
    expect(codes(evaluateWashSales({ ...i, similarity: [] }))).toContain("SUBSTANTIAL_IDENTITY_UNKNOWN");
    expect(codes(evaluateWashSales({ ...i, observedThrough: "2025-07-14" }))).toContain("POST_SALE_WINDOW_UNOBSERVED");
    expect(codes(evaluateWashSales(washInput([sale()], [acquisition({ accountKind: "unknown" })])))).toContain("REPLACEMENT_CLASSIFICATION_UNKNOWN");
  });
  it.each(["dealer", "short_sale", "complex_option", "other"] as const)("gates unsupported %s", instrument => {
    expect(evaluateWashSales(washInput([sale({ instrument })])).status).toBe("incomplete");
  });
  it("requires evidence for option/right similarity and preserves replay without double basis", () => {
    const input = washInput([sale()], [acquisition({ instrument: "verified_option_right" })]);
    const first = value(evaluateWashSales(input));
    expect(canonical(value(evaluateWashSales({ ...input, opening: first.state })))).toBe(canonical(first));
    expect(Object.isFrozen(first.state.adjustments)).toBe(true);
    expect(Object.isFrozen(input.sales)).toBe(false);
    expect(codes(evaluateWashSales({ ...input, opening: first.state, sales: [sale({ basis: money("2100") })] }))).toContain("ORIGINAL_HISTORY_CHANGED");
  });
  it("rejects ambiguous execution order, duplicate identity, invalid dates and currency", () => {
    const a = acquisition();
    expect(codes(evaluateWashSales(washInput([sale()], [a, { ...a, id: "b2", lot: "b2" as LotId }])))).toContain("EXECUTION_ORDER_AMBIGUOUS");
    expect(codes(evaluateWashSales(washInput([sale()], [a, a])))).toContain("ACTIVITY_ID_DUPLICATE");
    expect(codes(evaluateWashSales(washInput([sale({ date: "2025-02-30" })])))).toContain("DATE_INVALID");
    expect(codes(evaluateWashSales(washInput([sale({ basis: money("2000", Currency.of("EUR")) })])))).toContain("SALE_VALUE_INVALID");
  });
});

describe("PFA-TAX-016 Schedule D worksheet and durable character", () => {
  it.each([
    ["-5000", "-4000", "20000", "3000", "2000", "4000"],
    ["2000", "-10000", "20000", "3000", "0", "5000"],
    ["-10000", "2000", "20000", "3000", "5000", "0"],
    ["-5000", "-4000", "-2000", "1000", "4000", "4000"],
    ["-5000", "-4000", "-3000", "0", "5000", "4000"],
    ["-5000", "-4000", "0", "3000", "2000", "4000"],
    ["0", "0", "0", "0", "0", "0"],
    ["5000", "-2000", "10000", "0", "0", "0"],
  ])("nets ST=%s LT=%s signed taxable=%s", (st, lt, taxable, consumed, shortCarry, longCarry) => {
    const i = capitalInput();
    const r = value(evaluateCapitalLoss({ ...i, shortRealized: money(st), longRealized: money(lt), returnContext: { ...i.returnContext!, signedTaxableIncomeAfterDeduction: money(taxable) } }));
    expect([amount(r.lossConsumed), amount(r.closing.shortLoss), amount(r.closing.longLoss)]).toEqual([consumed, shortCarry, longCarry]);
    expect(r.shortDeductionConsumed.plus(r.longDeductionConsumed).equals(r.lossConsumed)).toBe(true);
  });
  it("applies MFS $1500 cap and short-term-first deduction", () => {
    const r = value(evaluateCapitalLoss(capitalInput({ filingStatus: "married_separate", opening: openingCapitalState(context(), "married_separate", "verified:none") })));
    expect(amount(r.scheduledDeduction)).toBe("1500");
    expect([amount(r.closing.shortLoss), amount(r.closing.longLoss)]).toEqual(["3500", "4000"]);
  });
  it("preserves character over multiple zero-gain years and exhausts only actual losses", () => {
    const first = value(evaluateCapitalLoss(capitalInput()));
    const secondInput = capitalInput({ context: context(2026), opening: first.closing, shortRealized: money("0"), longRealized: money("0") });
    const second = value(evaluateCapitalLoss(secondInput));
    expect([amount(second.closing.shortLoss), amount(second.closing.longLoss)]).toEqual(["0", "3000"]);
    const third = value(evaluateCapitalLoss(capitalInput({ context: context(2027), opening: second.closing, shortRealized: money("0"), longRealized: money("0") })));
    expect(amount(third.closing.longLoss)).toBe("0");
    expect(canonical(evaluateCapitalLoss(secondInput))).toBe(canonical(evaluateCapitalLoss(secondInput)));
    expect(third.closing.predecessor!.openingResultIdentity).toBe(second.resultIdentity);
    expect(second.closing.predecessor!.openingResultIdentity).toBe(first.resultIdentity);
    expect(second.closing.ruleFingerprint).toBe(ruleFingerprint);
  });
  it("replays 40 years with constant-size state and resolvable nonrecursive provenance", () => {
    const replay = () => {
      let opening = openingCapitalState(context(), "single", "synthetic:initial-return");
      const results = new Map<string, ReturnType<typeof evaluateCapitalLoss>>();
      for (let year = 2025; year < 2065; year++) {
        // Fail before the next evaluation if a regression starts embedding history.
        // This bounds even a run against the original exponentially growing code.
        expect(canonical(opening).length).toBeLessThan(12000);
        expect(opening.priorResultIdentity.length).toBeLessThan(200);
        const base = capitalInput();
        const input = capitalInput({ context: context(year), opening, shortRealized: money("-5000.01"), longRealized: money("-4000.02"),
          returnContext: { ...base.returnContext!, authoritativeResultId: `synthetic:return:${year}` } });
        const result = evaluateCapitalLoss(input), r = value(result);
        expect(canonical(result).length).toBeLessThan(35000);
        expect(r.resultIdentity.length).toBeLessThan(200);
        expect(result.trace.inputIdentity.length).toBeLessThan(200);
        expect(canonical(evaluateCapitalLoss(input))).toBe(canonical(result));
        expect(r.closing.lineage).toHaveLength(4);
        const p = r.closing.predecessor!;
        expect(p.openingStateIdentity).toBe(opening.stateIdentity);
        expect(p.openingResultIdentity).toBe(opening.priorResultIdentity);
        expect(p.trace).toEqual(result.trace);
        expect(p.trace.context.taxYear).toBe(year);
        expect(p.trace.fingerprint).toBe(ruleFingerprint);
        expect(p.trace.sources).toEqual(law.sources);
        expect(p.trace.context.sources).toEqual(context(year).sources);
        expect(p.trace.assumptions.length).toBe(year === 2025 ? 0 : 1);
        if (year > 2025) expect(value(results.get(p.openingResultIdentity)!).closing).toEqual(opening);
        expect(amount(r.closing.shortLoss)).toBe(amount(money("2000.01").times(decimal(String(year - 2024)))));
        expect(amount(r.closing.longLoss)).toBe(amount(money("4000.02").times(decimal(String(year - 2024)))));
        results.set(r.resultIdentity, result);
        opening = r.closing;
      }
      return [...results.keys()];
    };
    expect(replay()).toEqual(replay());
  });
  it("rejects altered carryover values, lineage, result/rule/source/year links", () => {
    const first = value(evaluateCapitalLoss(capitalInput()));
    const closing = first.closing, predecessor = closing.predecessor!;
    for (const changed of [
      { ...closing, shortLoss: money("1") }, { ...closing, priorResultIdentity: "other-result" },
      { ...closing, lineage: ["other-source"] }, { ...closing, ruleFingerprint: "old-rule" },
      { ...closing, predecessor: { ...predecessor, returnResultIdentity: "other-return" } },
      { ...closing, predecessor: { ...predecessor, trace: { ...predecessor.trace, sources: [] } } },
      { ...closing, predecessor: { ...predecessor, trace: { ...predecessor.trace, context: context(2024) } } },
    ]) expect(evaluateCapitalLoss(capitalInput({ context: context(2026), opening: changed })).status).toBe("incomplete");
    const changedInput = capitalInput({ returnContext: { ...capitalInput().returnContext!, authoritativeResultId: "new-return" } });
    expect(value(evaluateCapitalLoss(changedInput)).resultIdentity).not.toBe(first.resultIdentity);
    expect(Object.isFrozen(closing.predecessor!.trace.context.sources)).toBe(true);
  });
  it("gates absent return/opening facts, filing changes, subclasses, NOL and final returns", () => {
    const i = capitalInput();
    expect(codes(evaluateCapitalLoss({ ...i, opening: undefined }))).toContain("OPENING_CARRYOVER_REQUIRED");
    expect(codes(evaluateCapitalLoss({ ...i, returnContext: undefined }))).toContain("SIGNED_TAXABLE_INCOME_REQUIRED");
    expect(codes(evaluateCapitalLoss({ ...i, filingStatus: "married_separate" }))).toContain("OPENING_STATE_BOUNDARY_MISMATCH");
    for (const key of ["ordinaryCategoriesOnly", "noNolOrDebtAttributeReduction", "ownershipAndFilingAllocationUnchanged"] as const) {
      expect(evaluateCapitalLoss({ ...i, returnContext: { ...i.returnContext!, [key]: no } }).status).toBe("incomplete");
    }
    expect(codes(evaluateCapitalLoss({ ...i, returnContext: { ...i.returnContext!, finalReturn: yes } }))).toContain("FINAL_RETURN_OR_UNKNOWN");
  });
  it("does not silently extrapolate law or conflate federal/state coverage", () => {
    const i = capitalInput();
    expect(codes(evaluateCapitalLoss({ ...i, context: { ...context(), taxYear: 2026 } }))).toContain("RULE_YEAR_UNAVAILABLE");
    expect(codes(evaluateCapitalLoss({ ...i, context: { ...context(), jurisdiction: "US-CA" } }))).toContain("FEDERAL_ONLY");
    expect(Object.isFrozen(law.sources)).toBe(true);
  });
});

describe("PFA-TAX-016 bounded one-for-one domestic investment land exchange", () => {
  it("defers unbooted gain and reconciles replacement basis at 45/180-day endpoints", () => {
    const r = eligibleExchange();
    expect([amount(r.realizedGainOrLoss), amount(r.recognizedGain), amount(r.deferredGainOrLoss), amount(r.replacementBasis)]).toEqual(["100000", "0", "100000", "100000"]);
  });
  it.each([
    [{ signedIdentificationDate: "2025-02-16" }, "identification_after_45_days"],
    [{ receiptDate: "2025-07-01" }, "receipt_after_exchange_deadline"],
  ] as const)("rejects a missed statutory deadline", (changes, reason) => {
    const r = value(evaluateLandExchange(exchangeInput(changes)));
    expect(r.eligibility === "ineligible" && r.reasons.includes(reason)).toBe(true);
  });
  it("uses a realistic transfer-year return deadline and only evidenced extensions", () => {
    const input = exchangeInput({ transferDate: "2025-12-01", signedIdentificationDate: "2026-01-15", receiptDate: "2026-04-15" });
    expect(eligibleExchange(input).identification).toBe("written_notice");
    const late = value(evaluateLandExchange({ ...input, receiptDate: "2026-04-16" }));
    expect(late.eligibility === "ineligible" && late.reasons).toContain("receipt_after_exchange_deadline");
    const extended = { ...input, federalReturnDueDate: "2026-10-15", receiptDate: "2026-05-30" };
    expect(eligibleExchange(extended).eligibility).toBe("eligible");
    const after180 = value(evaluateLandExchange({ ...extended, receiptDate: "2026-05-31" }));
    expect(after180.eligibility === "ineligible" && after180.reasons).toContain("receipt_after_exchange_deadline");
    for (const fact of [no, unknown]) expect(evaluateLandExchange({ ...extended,
      predicates: { ...extended.predicates, dueDateAndExtensionsVerified: fact } }).status).toBe("incomplete");
  });
  it.each(["2025-04-15", "2025-12-31"])("fails closed on impossible calendar-year return due date %s", federalReturnDueDate => {
    expect(codes(evaluateLandExchange(exchangeInput({ federalReturnDueDate, receiptDate: "2025-04-15" })))).toContain("EXCHANGE_DATE_CONTEXT_INVALID");
  });
  it("deems verified receipt on day 45 identified without written notice", () => {
    const input = exchangeInput({ receiptDate: "2025-02-15", signedIdentificationDate: undefined });
    for (const notice of [no, unknown]) {
      const r = eligibleExchange({ ...input, predicates: { ...input.predicates, signedIdentificationDelivered: notice } });
      expect(r.identification).toBe("deemed_on_receipt");
      expect(r.identificationDate).toBe("2025-02-15");
      expect(amount(r.deferredGainOrLoss)).toBe("100000");
    }
    for (const key of ["replacementReceiptVerified", "qualifiedIntermediary", "noActualOrConstructiveReceipt"] as const) {
      expect(evaluateLandExchange({ ...input, predicates: { ...input.predicates, [key]: unknown } }).status).toBe("incomplete");
    }
    expect(evaluateLandExchange({ ...input, predicates: { ...input.predicates, replacementReceiptVerified: no } }).status).toBe("incomplete");
  });
  it("requires documented timely identification for day 46 receipt", () => {
    const input = exchangeInput({ receiptDate: "2025-02-16" });
    const r = eligibleExchange(input);
    expect(r.identification).toBe("written_notice");
    expect(r.identificationDate).toBe("2025-02-15");
    const absent = value(evaluateLandExchange({ ...input, signedIdentificationDate: undefined,
      predicates: { ...input.predicates, signedIdentificationDelivered: no } }));
    expect(absent.eligibility === "ineligible" && absent.reasons).toContain("signedIdentificationDelivered");
    expect(codes(evaluateLandExchange({ ...input, signedIdentificationDate: undefined }))).toContain("WRITTEN_IDENTIFICATION_DATE_REQUIRED");
    expect(evaluateLandExchange({ ...input, predicates: { ...input.predicates, signedIdentificationDelivered: unknown } }).status).toBe("incomplete");
  });
  it.each([
    { receiptDate: "" }, { receiptDate: "2025-02-30" }, { signedIdentificationDate: "not-a-date" },
    { federalReturnDueDate: "unknown" }, { transferDate: "2025-02-30" },
  ])("keeps malformed identification/receipt/deadline dates incomplete", changes => {
    expect(codes(evaluateLandExchange(exchangeInput(changes)))).toContain("DATE_INVALID");
  });
  it("recognizes partial cash/non-like boot with a gain cap", () => {
    const r = eligibleExchange(exchangeInput({ replacement: parcel("new", "170000"), cashReceived: money("20000"), nonLikeBootReceived: money("10000") }));
    expect([amount(r.recognizedGain), amount(r.deferredGainOrLoss), amount(r.replacementBasis), amount(r.nonLikeBootBasis)]).toEqual(["30000", "70000", "100000", "10000"]);
    const capped = eligibleExchange(exchangeInput({ replacement: parcel("new", "170000"), cashReceived: money("30000"), adjustedBasis: money("190000") }));
    expect(amount(capped.recognizedGain)).toBe("10000");
  });
  it("offsets debt relief with debt assumed and cash paid", () => {
    const r = eligibleExchange(exchangeInput({ replacement: parcel("new", "170000"), liabilitiesRelieved: money("80000"), liabilitiesAssumed: money("30000"), cashPaid: money("20000") }));
    expect([amount(r.netDebtBoot), amount(r.recognizedGain), amount(r.replacementBasis)]).toEqual(["30000", "30000", "100000"]);
  });
  it("does not offset received cash boot with net debt assumed", () => {
    const r = eligibleExchange(exchangeInput({ replacement: parcel("new", "230000"), liabilitiesRelieved: money("80000"), liabilitiesAssumed: money("150000"), cashReceived: money("40000") }));
    expect([amount(r.taxableBoot), amount(r.realizedGainOrLoss), amount(r.recognizedGain), amount(r.replacementBasis)]).toEqual(["40000", "100000", "40000", "170000"]);
  });
  it("allocates eligible expenses once against boot then basis", () => {
    const r = eligibleExchange(exchangeInput({ replacement: parcel("new", "190000"), cashReceived: money("10000"), qualifyingCosts: money("15000") }));
    expect([amount(r.costsAgainstBoot), amount(r.costsToBasis), amount(r.realizedGainOrLoss), amount(r.replacementBasis)]).toEqual(["10000", "5000", "85000", "105000"]);
  });
  it("does not recognize a qualifying loss and carries the unrecovered basis", () => {
    const r = eligibleExchange(exchangeInput({ adjustedBasis: money("250000") }));
    expect([amount(r.recognizedGain), amount(r.recognizedLoss), amount(r.deferredGainOrLoss), amount(r.replacementBasis)]).toEqual(["0", "0", "-50000", "250000"]);
  });
  it.each(["rental_building", "commercial_building", "land_with_improvements", "cost_segregated", "other"] as const)("reports %s as unsupported, never ineligible", propertyClass => {
    const i = exchangeInput();
    const r = evaluateLandExchange({ ...i, replacement: { ...i.replacement, propertyClass } });
    expect(r.status).toBe("incomplete");
    expect(codes(r)).toContain("DEPRECIABLE_OR_UNVERIFIED_PROPERTY_UNSUPPORTED");
  });
  it("requires known history and all legal predicates before claiming completed treatment", () => {
    const i = exchangeInput();
    expect(evaluateLandExchange({ ...i, relinquished: { ...i.relinquished, depreciationHistory: "unknown" } }).status).toBe("incomplete");
    for (const key of Object.keys(i.predicates) as (keyof typeof i.predicates)[]) {
      expect(evaluateLandExchange({ ...i, predicates: { ...i.predicates, [key]: unknown } }).status).toBe("incomplete");
    }
    expect(evaluateLandExchange({ ...i, predicates: { ...i.predicates, unrelatedParties: no } }).status).toBe("incomplete");
    expect(evaluateLandExchange({ ...i, replacement: { ...i.replacement, domestic: no } }).status).toBe("incomplete");
  });
  it("distinguishes known ownership/use/QI negatives from unknowns", () => {
    const i = exchangeInput();
    expect(value(evaluateLandExchange({ ...i, replacement: { ...i.replacement, owner: "stranger" as OwnerId } })).eligibility).toBe("ineligible");
    expect(value(evaluateLandExchange({ ...i, replacement: { ...i.replacement, qualifyingUse: no } })).eligibility).toBe("ineligible");
    expect(value(evaluateLandExchange({ ...i, predicates: { ...i.predicates, qualifiedIntermediary: no } })).eligibility).toBe("ineligible");
    expect(evaluateLandExchange({ ...i, predicates: { ...i.predicates, qualifiedIntermediary: unknown } }).status).toBe("incomplete");
  });
  it("gates malformed dates, mixed currencies, absent basis sources and unreconciled consideration", () => {
    expect(codes(evaluateLandExchange(exchangeInput({ transferDate: "2025-02-30" })))).toContain("DATE_INVALID");
    expect(codes(evaluateLandExchange(exchangeInput({ cashPaid: money("1", Currency.of("EUR")) })))).toContain("EXCHANGE_MONEY_INVALID");
    expect(codes(evaluateLandExchange(exchangeInput({ basisSources: [] })))).toContain("EXCHANGE_ID_OR_BASIS_PROVENANCE_INVALID");
    expect(codes(evaluateLandExchange(exchangeInput({ cashReceived: money("1") })))).toContain("EXCHANGE_CONSIDERATION_DOES_NOT_RECONCILE");
  });
});

describe("PFA-TAX-016 authoritative harvesting comparison", () => {
  it.each([["850", "0", "150", "150"], ["1000", "0", "0", "0"], ["1100", "0", "-100", "-100"], ["850", "200", "150", "-50"]])("preserves signed tax delta and transaction costs", (tax, fees, delta, net) => {
    const r = value(evaluateHarvest(harvestInput(tax, fees)));
    expect([amount(r.currentYearTaxReduction), amount(r.currentYearReductionAfterCosts)]).toEqual([delta, net]);
    expect(amount(r.netDisposalProceeds)).toBe(amount(money("1000").minus(money(fees))));
    expect(r.futureValue).toBe("unvalued_requires_future_authoritative_gains_and_tax_evaluation");
  });
  it("preserves washed loss but does not invent current savings", () => {
    const r = value(evaluateHarvest(harvestInput("1000", "0", true)));
    expect([amount(r.eligibleCurrentLoss), amount(r.blockedCurrentLoss), amount(r.currentYearTaxReduction)]).toEqual(["0", "1000", "0"]);
  });
  it("rejects stale/mismatched/incomplete authoritative evaluations", () => {
    const i = harvestInput();
    for (const c of [
      { ...i.candidate, complete: false }, { ...i.candidate, periodStart: "2024-01-01" },
      { ...i.candidate, evaluatedThrough: "2025-06-15" }, { ...i.candidate, horizonEndExclusive: "2027-01-01" },
      { ...i.candidate, inputCoverageFingerprint: "other" }, { ...i.candidate, activityFingerprint: "old-proposal" },
      { ...i.candidate, unchangedFactsFingerprint: "changed-income" },
      { ...i.candidate, tax: { ...i.candidate.tax, catalogFingerprint: "different-law" } },
      { ...i.candidate, capitalResultIdentity: "unrelated-capital-state" },
    ]) expect(evaluateHarvest({ ...i, candidate: c }).status).toBe("incomplete");
  });
  it("rejects unknown wash facts and authoritative realization ignoring disallowance", () => {
    const i = harvestInput();
    expect(codes(evaluateHarvest({ ...i, wash: evaluateWashSales({ ...washInput(), coverage: unknown }) }))).toContain("WASH_RESULT_INCOMPLETE");
    const washed = harvestInput("1000", "0", true);
    expect(codes(evaluateHarvest({ ...washed, candidate: { ...i.candidate, activityFingerprint: harvestActivityFingerprint(washed.proposal) } }))).toContain("CANDIDATE_REALIZATION_MISMATCH");
  });
  it("keeps multi-year carryover future value unpriced without realized future gains", () => {
    const i = harvestInput("1000");
    const candidateCapital = evaluateCapitalLoss(capitalInput({ shortRealized: money("-1000"), longRealized: money("0"), returnContext: { ...capitalInput().returnContext!, signedTaxableIncomeAfterDeduction: money("-1000") } }));
    const r = value(evaluateHarvest({ ...i, candidate: { ...i.candidate, capital: candidateCapital, capitalResultIdentity: value(candidateCapital).resultIdentity } }));
    expect(amount(r.candidateCarryover.shortLoss)).toBe("1000");
    expect(amount(r.currentYearTaxReduction)).toBe("0");
    expect(r.futureValue).toContain("unvalued");
  });
});
