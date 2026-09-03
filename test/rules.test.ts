import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { domainId } from "../src/identity/index.js";
import {
  applyProportionalIncomeTaxRule,
  evaluateAnnualContributionLimit,
  evaluateFixedFee,
  evaluateProductOperationEligibility,
  resolveEffectiveRule,
  type FinancialRule,
  type ResolvedRule,
} from "../src/rules/index.js";
import { instant } from "../src/time/index.js";
import { Currency, Ratio, RoundingPolicy, money } from "../src/values/index.js";

const account = domainId("account", "71000000-0000-4000-8000-000000000001");
const otherAccount = domainId("account", "71000000-0000-4000-8000-000000000003");
const liability = domainId("liability", "71000000-0000-4000-8000-000000000004");
const person = domainId("person", "71000000-0000-4000-8000-000000000002");
const id = (suffix: number) => domainId("tax-rule", `71000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`);
const at = instant("2026-06-01T00:00:00.000Z");
const tax = (ruleId: ReturnType<typeof id>, from: string, until?: string): Extract<FinancialRule, { kind: "proportional_income_tax" }> => ({
  id: ruleId, kind: "proportional_income_tax", target: { targetType: "person", targetId: person }, effectiveFrom: instant(from),
  ...(until === undefined ? {} : { effectiveUntil: instant(until) }), effectiveRate: Ratio.parse("0.2"), postingRounding: RoundingPolicy.currency(2, "half_up"),
});
const contributionRule = (): Extract<FinancialRule, { kind: "annual_contribution_limit" }> => ({
  id: id(20), kind: "annual_contribution_limit", target: { targetType: "account", targetId: account },
  effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"),
  calendarYear: 2026, calendar: "utc", annualLimit: money("1000"),
});
const productRule = (allowed: boolean): Extract<FinancialRule, { kind: "product_operation_eligibility" }> => ({
  id: id(30), kind: "product_operation_eligibility", target: { targetType: "account", targetId: account },
  effectiveFrom: instant("2026-01-01T00:00:00.000Z"), operation: "contribution", allowed,
});

const code = (operation: () => unknown): string => {
  try { operation(); } catch (error) { if (error instanceof ValidationError) return error.issues[0]!.code; throw error; }
  throw new Error("Expected ValidationError");
};

describe("effective-dated financial rules", () => {
  it("resolves adjacent half-open versions at the exact instant independent of order", () => {
    const first = tax(id(1), "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    const second = tax(id(2), "2027-01-01T00:00:00.000Z", "2028-01-01T00:00:00.000Z");
    const boundary = instant("2027-01-01T00:00:00.000Z");
    const resolved = resolveEffectiveRule([second, first], [second.id, first.id], "proportional_income_tax", { targetType: "person", targetId: person }, boundary);
    const reordered = resolveEffectiveRule([first, second], [first.id, second.id], "proportional_income_tax", { targetType: "person", targetId: person }, boundary);
    expect(resolved.rule.id).toBe(second.id);
    expect(reordered.rule.id).toBe(second.id);
    expect(resolved.resolvedAt).toBe(boundary);
    const application = applyProportionalIncomeTaxRule(resolved, money("100"));
    expect(application.evaluatedAt).toBe(boundary);
    expect(application.result.equals(money("20"))).toBe(true);
    expect(application.traceRefs[0]?.ruleIds).toEqual([second.id]);
    if (false) {
      // @ts-expect-error Raw rules cannot bypass effective-date resolution.
      applyProportionalIncomeTaxRule(second, money("100"));
    }
  });

  it("snapshots the selected rule so later source mutation cannot alter a resolved application", () => {
    const source = tax(id(8), "2026-01-01T00:00:00.000Z");
    const resolved = resolveEffectiveRule([source], [source.id], "proportional_income_tax", source.target, at);
    const mutable = source as unknown as {
      effectiveRate: Ratio;
      effectiveUntil?: ReturnType<typeof instant>;
      target: { targetType: "person"; targetId: typeof person };
    };
    mutable.effectiveRate = Ratio.parse("0.9");
    mutable.effectiveUntil = instant("2026-05-01T00:00:00.000Z");
    mutable.target.targetId = domainId("person", "71000000-0000-4000-8000-000000000099");

    const application = applyProportionalIncomeTaxRule(resolved, money("100"));
    expect(application.result.equals(money("20"))).toBe(true);
    expect(application.target.targetId).toBe(person);
    expect(resolved.rule.effectiveUntil).toBeUndefined();
    expect(Object.isFrozen(resolved.rule)).toBe(true);
    expect(Object.isFrozen(resolved.rule.target)).toBe(true);
  });

  it("rejects inactive, ambiguous, empty, duplicate, missing, wrong-target, and wrong-kind bindings", () => {
    const first = tax(id(3), "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    const overlap = tax(id(5), "2026-05-01T00:00:00.000Z", "2027-05-01T00:00:00.000Z");
    const target = { targetType: "person" as const, targetId: person };
    expect(code(() => resolveEffectiveRule([first], [first.id], "proportional_income_tax", target, instant("2025-12-31T23:59:59.999Z")))).toBe(issueCodes.ruleNotActive);
    expect(code(() => resolveEffectiveRule([first], [first.id], "proportional_income_tax", target, instant("2027-01-01T00:00:00.000Z")))).toBe(issueCodes.ruleNotActive);
    expect(code(() => resolveEffectiveRule([first, overlap], [first.id, overlap.id], "proportional_income_tax", target, at))).toBe(issueCodes.ruleAmbiguous);
    expect(code(() => resolveEffectiveRule([first], [], "proportional_income_tax", target, at))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(code(() => resolveEffectiveRule([first], [first.id, first.id], "proportional_income_tax", target, at))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(code(() => resolveEffectiveRule([first, { ...first }], [first.id], "proportional_income_tax", target, at))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(code(() => resolveEffectiveRule([first], [id(99)], "proportional_income_tax", target, at))).toBe(issueCodes.ruleReferenceNotFound);
    expect(code(() => resolveEffectiveRule([first], [first.id], "proportional_income_tax", { targetType: "person", targetId: domainId("person", "71000000-0000-4000-8000-000000000099") }, at))).toBe(issueCodes.ruleTargetMismatch);
    const fee: FinancialRule = { id: id(6), kind: "fixed_fee", target: { targetType: "account", targetId: account }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), amount: money("1") };
    expect(code(() => resolveEffectiveRule([fee], [fee.id], "proportional_income_tax", target, at))).toBe(issueCodes.ruleTargetMismatch);
  });

  it("rejects structurally forged resolved wrappers at runtime", () => {
    const raw = tax(id(7), "2026-01-01T00:00:00.000Z");
    const forged = { rule: raw, resolvedAt: at } as unknown as ResolvedRule<"proportional_income_tax">;
    expect(code(() => applyProportionalIncomeTaxRule(forged, money("100")))).toBe(issueCodes.ruleInputInvalid);
  });

  it("calculates contribution outcomes and clamps overused annual limits", () => {
    const rule = contributionRule();
    const resolved = resolveEffectiveRule([rule], [rule.id], "annual_contribution_limit", rule.target, at);
    const cases = [
      ["100", "100", "allowed", "100", "0"], ["900", "100", "allowed", "900", "0"],
      ["300", "900", "partially_allowed", "100", "200"], ["1", "1000", "rejected", "0", "1"],
      ["1", "1100", "rejected", "0", "1"],
    ] as const;
    for (const [requested, used, decision, accepted, excess] of cases) {
      const result = evaluateAnnualContributionLimit(resolved, money(requested), money(used)).result;
      expect(result).toMatchObject({ decision });
      expect(result.accepted.equals(money(accepted))).toBe(true);
      expect(result.excess.equals(money(excess))).toBe(true);
    }
  });

  it("uses structured validation for malformed contribution inputs", () => {
    const rule = contributionRule();
    const resolved = resolveEffectiveRule([rule], [rule.id], "annual_contribution_limit", rule.target, at);
    expect(code(() => evaluateAnnualContributionLimit(resolved, money("-1"), money("0")))).toBe(issueCodes.ruleInputInvalid);
    expect(code(() => evaluateAnnualContributionLimit(resolved, money("1"), money("-1")))).toBe(issueCodes.ruleInputInvalid);
    expect(code(() => evaluateAnnualContributionLimit(resolved, money("1", Currency.of("EUR")), money("0")))).toBe(issueCodes.ruleInputInvalid);
  });

  it("keeps product denial nonblocking and validates target-operation coherence", () => {
    for (const allowed of [true, false]) {
      const rule = productRule(allowed);
      const result = evaluateProductOperationEligibility(resolveEffectiveRule([rule], [rule.id], "product_operation_eligibility", rule.target, at)).result;
      expect(result.decision).toBe(allowed ? "allowed" : "rejected");
      expect(result.allowed).toBe(allowed);
      if (!allowed) expect(result.diagnostics[0]?.code).toBe(issueCodes.productOperationNotAllowed);
    }
    const malformed = (target: unknown, operation: unknown, allowed: unknown): FinancialRule => ({
      id: id(31), kind: "product_operation_eligibility", target, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), operation, allowed,
    } as unknown as FinancialRule);
    expect(code(() => resolveEffectiveRule([malformed({ targetType: "account", targetId: account }, "extra_principal", true)], [id(31)], "product_operation_eligibility", { targetType: "account", targetId: account }, at))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(code(() => resolveEffectiveRule([malformed({ targetType: "liability", targetId: liability }, "contribution", true)], [id(31)], "product_operation_eligibility", { targetType: "liability", targetId: liability }, at))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(code(() => resolveEffectiveRule([malformed({ targetType: "account", targetId: account }, "contribution", "yes")], [id(31)], "product_operation_eligibility", { targetType: "account", targetId: account }, at))).toBe(issueCodes.ruleDefinitionInvalid);
  });

  it("records zero fixed-fee applications", () => {
    const rule: FinancialRule = { id: id(40), kind: "fixed_fee", target: { targetType: "account", targetId: otherAccount }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), amount: money("0") };
    const application = evaluateFixedFee(resolveEffectiveRule([rule], [rule.id], "fixed_fee", rule.target, at));
    expect(application.result.isZero()).toBe(true);
    expect(Object.isFrozen(application.traceRefs[0]?.ruleIds)).toBe(true);
  });
});