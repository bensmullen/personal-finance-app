import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { domainId } from "../src/identity/index.js";
import {
  evaluateAnnualContributionLimit,
  evaluateFixedFee,
  evaluateProductOperationEligibility,
  resolveEffectiveRule,
  type FinancialRule,
} from "../src/rules/index.js";
import { instant } from "../src/time/index.js";
import { Ratio, RoundingPolicy, money } from "../src/values/index.js";

const account = domainId("account", "71000000-0000-4000-8000-000000000001");
const person = domainId("person", "71000000-0000-4000-8000-000000000002");
const id = (suffix: number) => domainId("tax-rule", `71000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`);
const tax = (ruleId: ReturnType<typeof id>, from: string, until?: string): FinancialRule => ({
  id: ruleId,
  kind: "proportional_income_tax",
  target: { targetType: "person", targetId: person },
  effectiveFrom: instant(from),
  ...(until === undefined ? {} : { effectiveUntil: instant(until) }),
  effectiveRate: Ratio.parse("0.2"),
  postingRounding: RoundingPolicy.currency(2, "half_up"),
});

const code = (operation: () => unknown): string => {
  try { operation(); } catch (error) { if (error instanceof ValidationError) return error.issues[0]!.code; throw error; }
  throw new Error("Expected ValidationError");
};

describe("effective-dated financial rules", () => {
  it("selects exactly one adjacent half-open version independent of catalog and binding order", () => {
    const first = tax(id(1), "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    const second = tax(id(2), "2027-01-01T00:00:00.000Z", "2028-01-01T00:00:00.000Z");
    const resolved = resolveEffectiveRule([second, first], [second.id, first.id], "proportional_income_tax", { targetType: "person", targetId: person }, instant("2027-01-01T00:00:00.000Z"));
    expect(resolved.id).toBe(second.id);
  });

  it("reports stable hard validation codes", () => {
    const first = tax(id(3), "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    const overlap = tax(id(4), "2026-06-01T00:00:00.000Z", "2027-06-01T00:00:00.000Z");
    expect(code(() => resolveEffectiveRule([first], [id(9)], "proportional_income_tax", { targetType: "person", targetId: person }, instant("2026-06-01T00:00:00.000Z")))).toBe(issueCodes.ruleReferenceNotFound);
    expect(code(() => resolveEffectiveRule([first], [first.id], "proportional_income_tax", { targetType: "person", targetId: domainId("person", "71000000-0000-4000-8000-000000000099") }, instant("2026-06-01T00:00:00.000Z")))).toBe(issueCodes.ruleTargetMismatch);
    expect(code(() => resolveEffectiveRule([first], [first.id], "proportional_income_tax", { targetType: "person", targetId: person }, instant("2027-01-01T00:00:00.000Z")))).toBe(issueCodes.ruleNotActive);
    expect(code(() => resolveEffectiveRule([first, overlap], [first.id, overlap.id], "proportional_income_tax", { targetType: "person", targetId: person }, instant("2026-07-01T00:00:00.000Z")))).toBe(issueCodes.ruleAmbiguous);
    const inverted = tax(id(5), "2027-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    expect(code(() => resolveEffectiveRule([inverted], [inverted.id], "proportional_income_tax", { targetType: "person", targetId: person }, instant("2026-07-01T00:00:00.000Z")))).toBe(issueCodes.ruleDefinitionInvalid);
  });

  it("returns contribution and eligibility policy outcomes without treating them as funding failures", () => {
    const limit = {
      id: id(10), kind: "annual_contribution_limit" as const, target: { targetType: "account" as const, targetId: account },
      effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"), calendarYear: 2026, calendar: "utc" as const, annualLimit: money("1000"),
    };
    const application = evaluateAnnualContributionLimit(limit, money("300"), money("900"), instant("2026-06-01T00:00:00.000Z"));
    expect(application.result.decision).toBe("partially_allowed");
    expect(application.result.accepted.equals(money("100"))).toBe(true);
    expect(application.result.excess.equals(money("200"))).toBe(true);
    expect(application.result.diagnostics[0]?.code).toBe(issueCodes.contributionLimitApplied);
    expect(application.traceRefs[0]?.ruleIds).toEqual([limit.id]);

    const eligibility = evaluateProductOperationEligibility({ id: id(11), kind: "product_operation_eligibility", target: { targetType: "account", targetId: account }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), operation: "contribution", allowed: false }, instant("2026-06-01T00:00:00.000Z"));
    expect(eligibility.result.decision).toBe("rejected");
    expect(eligibility.result.diagnostics[0]?.code).toBe(issueCodes.productOperationNotAllowed);
  });

  it("records zero fixed-fee applications without inventing a posting", () => {
    const application = evaluateFixedFee({ id: id(12), kind: "fixed_fee", target: { targetType: "account", targetId: account }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), amount: money("0") }, instant("2026-06-01T00:00:00.000Z"));
    expect(application.result.isZero()).toBe(true);
    expect(Object.isFrozen(application.traceRefs[0]?.ruleIds)).toBe(true);
  });
});
