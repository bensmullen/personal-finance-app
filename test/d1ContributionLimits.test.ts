import { describe, expect, it } from "vitest";
import { domainId } from "../src/identity/index.js";
import { instant } from "../src/time/index.js";
import { money } from "../src/values/index.js";
import { deriveD1ContributionCapacity, type D1ContributionFacts } from "../src/rules/contribution2026.js";
import { evaluateContributionBuckets, committedContributionUsage } from "../src/rules/contribution.js";
import { resolveEffectiveRule, resolveContributionLimitBindings } from "../src/rules/resolver.js";
import type { AnnualContributionLimitRule } from "../src/rules/contracts.js";
import { normalizeContributionLimitRuleIds } from "../src/application/compiler/contributionBindings.js";
import { createGoldenHouseholdDraft, patchPersonalObject } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { classifyFinancialSpecificationVersion } from "../src/model/modelVersion.js";

const facts: D1ContributionFacts = { taxYear: 2026, ageAtYearEnd: 40, taxableCompensation: money("120000"), eligiblePlanCompensation: money("120000") };
const capacity = (kind: Parameters<typeof deriveD1ContributionCapacity>[0], patch: Partial<D1ContributionFacts> = {}, used = money("0")) => {
  const result = deriveD1ContributionCapacity(kind, { ...facts, ...patch }, used);
  expect(result.status).toBe("complete");
  if (result.status !== "complete") throw new Error(result.diagnostics.join(","));
  return result;
};
const participant = domainId("person", ids.person);
const rule = (suffix: number, bucketKey: string, annualLimit: string): AnnualContributionLimitRule => ({
  id: domainId("tax-rule", `d1000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`), kind: "annual_contribution_limit",
  target: { targetType: "person", targetId: participant }, bucketKey, includedCharacters: ["traditional_401k", "roth_401k"],
  calendarYear: 2026, calendar: "utc", annualLimit: money(annualLimit),
  effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"),
});
const bind = (value: AnnualContributionLimitRule) => resolveEffectiveRule([value], [value.id], value.kind, value.target, instant("2026-02-01T00:00:00.000Z"));

describe("D1-A published 2026 contribution capacities", () => {
  it.each([[40, "24500"], [50, "32500"], [59, "32500"], [60, "35750"], [61, "35750"], [62, "35750"], [63, "35750"], [64, "32500"]] as const)("uses the participant age tier at %s", (age, expected) => {
    const result = capacity("401k_elective", { ageAtYearEnd: age, planHasRoth: true, priorYearSponsorWages: money("150000") });
    expect(result.capacity.amount.toString()).toBe(expected);
    expect(result.rothCatchupRequired).toBe(false);
  });
  it("requires Roth catch-up only beyond the prior-year sponsor wage threshold", () => {
    expect(capacity("401k_elective", { ageAtYearEnd: 50, planHasRoth: true, priorYearSponsorWages: money("150000.01") }).rothCatchupRequired).toBe(true);
    expect(capacity("401k_elective", { ageAtYearEnd: 50, planHasRoth: false }).rothCatchupRequired).toBe(false);
    expect(deriveD1ContributionCapacity("401k_elective", { ...facts, ageAtYearEnd: 50 }).status).toBe("incomplete");
  });
  it("keeps catch-up outside the lesser-of-compensation annual-additions capacity", () => {
    expect(capacity("401k_additions").capacity.amount.toString()).toBe("72000");
    expect(capacity("401k_additions", { eligiblePlanCompensation: money("50000") }).capacity.amount.toString()).toBe("50000");
    expect(capacity("401k_additions", { ageAtYearEnd: 60 }).catchupCapacity.amount.toString()).toBe("0");
  });
  it("limits shared IRA capacity by ordinary/catch-up limits and compensation", () => {
    expect(capacity("ira_shared").capacity.amount.toString()).toBe("7500");
    expect(capacity("ira_shared", { ageAtYearEnd: 50 }).capacity.amount.toString()).toBe("8600");
    expect(capacity("ira_shared", { taxableCompensation: money("2300") }).capacity.amount.toString()).toBe("2300");
  });
  it.each([
    ["single", "153000", "7500"], ["single", "160500", "3750"], ["single", "167999", "200"], ["single", "168000", "0"],
    ["married_joint", "242000", "7500"], ["married_joint", "247000", "3750"], ["married_joint", "252000", "0"],
  ] as const)("uses the Roth worksheet for %s MAGI %s", (filingStatus, magi, expected) => {
    expect(capacity("roth_ira", { filingStatus, rothMagi: money(magi) }).capacity.amount.toString()).toBe(expected);
  });
  it("rounds Roth capacity upward to $10 and then honors other-account IRA usage", () => {
    expect(capacity("roth_ira", { filingStatus: "single", rothMagi: money("160501") }).capacity.amount.toString()).toBe("3750");
    expect(capacity("roth_ira", { filingStatus: "single", rothMagi: money("160500") }, money("6000")).capacity.amount.toString()).toBe("1500");
    expect(capacity("roth_ira", { filingStatus: "married_separate", livesWithSpouse: true, rothMagi: money("5000") }).capacity.amount.toString()).toBe("3750");
  });
  it("keeps Traditional IRA deduction phaseouts separate from contribution capacity", () => {
    expect(capacity("traditional_ira_deduction", { filingStatus: "single", workplacePlanCovered: true, deductionMagi: money("86000") }).capacity.amount.toString()).toBe("3750");
    expect(capacity("traditional_ira_deduction", { filingStatus: "married_joint", workplacePlanCovered: true, deductionMagi: money("139000") }).capacity.amount.toString()).toBe("3750");
    expect(capacity("traditional_ira_deduction", { filingStatus: "married_joint", workplacePlanCovered: false, spouseWorkplacePlanCovered: true, deductionMagi: money("247000") }).capacity.amount.toString()).toBe("3750");
    expect(capacity("ira_shared").capacity.amount.toString()).toBe("7500");
  });
  it("keeps HSA family ordinary capacity shared and catch-up individual", () => {
    expect(capacity("hsa_individual", { hsaFullYearEligible: true, hsaCoverage: "self" }).capacity.amount.toString()).toBe("4400");
    expect(capacity("hsa_individual", { ageAtYearEnd: 55, hsaFullYearEligible: true, hsaCoverage: "self" }).capacity.amount.toString()).toBe("5400");
    expect(capacity("hsa_family", { hsaFullYearEligible: true, hsaCoverage: "family" }).capacity.amount.toString()).toBe("8750");
    const first = capacity("hsa_individual", { ageAtYearEnd: 55, hsaFullYearEligible: true, hsaCoverage: "family", hsaFamilyAllocation: money("5000") });
    const spouse = capacity("hsa_individual", { ageAtYearEnd: 55, hsaFullYearEligible: true, hsaCoverage: "family", hsaFamilyAllocation: money("3750") });
    expect(first.ordinaryCapacity.plus(spouse.ordinaryCapacity).amount.toString()).toBe("8750");
    expect(first.catchupCapacity.amount.toString()).toBe("1000");
    expect(spouse.catchupCapacity.amount.toString()).toBe("1000");
  });
  it("gates absent law, compensation, MAGI and full-year eligibility", () => {
    for (const result of [
      deriveD1ContributionCapacity("ira_shared", { taxYear: 2026, ageAtYearEnd: 40 }),
      deriveD1ContributionCapacity("roth_ira", { ...facts, filingStatus: "single" }),
      deriveD1ContributionCapacity("hsa_individual", facts),
      deriveD1ContributionCapacity("ira_shared", { ...facts, taxYear: 2027 }),
    ]) expect(result.status).toBe("incomplete");
  });
});

describe("D1-A shared simultaneous contribution buckets", () => {
  it("resolves independent buckets together without treating them as competing versions", () => {
    const first = rule(11, "402g", "24500"), second = rule(12, "sponsor-A:415c", "72000");
    const resolved = resolveContributionLimitBindings([second, first], [second.id, first.id, first.id], [first.target], instant("2026-02-01T00:00:00.000Z"));
    expect(resolved).toHaveLength(2);
    expect(evaluateContributionBuckets(resolved, money("25000"), "traditional_401k", [], "auto_cap").accepted.amount.toString()).toBe("24500");
  });
  it("takes the tightest remaining capacity independent of binding order", () => {
    const elective = bind(rule(1, "402g", "24500")), additions = bind(rule(2, "sponsor-A:415c", "72000"));
    const committed = committedContributionUsage(evaluateContributionBuckets([elective, additions], money("24000"), "traditional_401k", []), "first-account", "traditional_401k");
    const forward = evaluateContributionBuckets([elective, additions], money("1000"), "roth_401k", committed, "auto_cap");
    const reverse = evaluateContributionBuckets([additions, elective], money("1000"), "roth_401k", committed, "auto_cap");
    expect(forward).toEqual(reverse);
    expect(forward.accepted.amount.toString()).toBe("500");
    expect(forward.excess.amount.toString()).toBe("500");
    expect(forward.buckets.map(bucket => bucket.remainingBefore.amount.toString()).sort()).toEqual(["48000", "500"]);
    expect(committedContributionUsage(forward, "second-account", "roth_401k").map(entry => entry.amount.amount.toString())).toEqual(["500", "500"]);
  });
  it("does not create a second shared allowance by splitting across accounts", () => {
    const binding = bind(rule(3, "402g", "24500"));
    const committed = committedContributionUsage(evaluateContributionBuckets([binding], money("20000"), "traditional_401k", []), "account-A", "traditional_401k");
    const second = evaluateContributionBuckets([binding], money("5000"), "roth_401k", committed);
    expect(second.accepted.amount.toString()).toBe("0");
    expect(second.requested.amount.toString()).toBe("5000");
    expect(second.buckets[0]!.usedBefore.amount.toString()).toBe("20000");
    expect(committedContributionUsage(second, "rejected-account-B", "roth_401k")).toEqual([]);
    expect(evaluateContributionBuckets([binding], money("4500"), "roth_401k", committed).accepted.amount.toString()).toBe("4500");
  });
  it("aggregates employee, employer and after-tax consumption in annual additions", () => {
    const additions = bind({ ...rule(13, "sponsor-A:415c", "72000"), includedCharacters: ["traditional_401k", "roth_401k", "employer_401k", "after_tax_401k"] });
    const employee = committedContributionUsage(evaluateContributionBuckets([additions], money("24500"), "traditional_401k", []), "employee", "traditional_401k");
    const employer = committedContributionUsage(evaluateContributionBuckets([additions], money("40000"), "employer_401k", employee), "employer", "employer_401k");
    const afterTax = evaluateContributionBuckets([additions], money("10000"), "after_tax_401k", [...employee, ...employer], "auto_cap");
    expect(afterTax.buckets[0]!.usedBefore.amount.toString()).toBe("64500");
    expect(afterTax.accepted.amount.toString()).toBe("7500");
    expect(afterTax.excess.amount.toString()).toBe("2500");
  });
  it("shares Traditional/Roth IRA capacity across accounts while separately constraining Roth eligibility", () => {
    const shared = bind({ ...rule(14, "ira_shared", "7500"), includedCharacters: ["traditional_ira", "roth_ira"] });
    const roth = bind({ ...rule(15, "roth_eligibility", "3750"), includedCharacters: ["roth_ira"] });
    const traditional = committedContributionUsage(evaluateContributionBuckets([shared], money("5000"), "traditional_ira", []), "traditional-account", "traditional_ira");
    const acceptedRoth = evaluateContributionBuckets([shared, roth], money("3000"), "roth_ira", traditional, "auto_cap");
    expect(acceptedRoth.accepted.amount.toString()).toBe("2500");
    const rothUsage = committedContributionUsage(acceptedRoth, "roth-account-A", "roth_ira");
    expect(evaluateContributionBuckets([roth, shared], money("1"), "roth_ira", [...traditional, ...rothUsage]).accepted.amount.toString()).toBe("0");
  });
  it("shares ordinary family HSA usage between employee and employer without absorbing individual catch-up", () => {
    const familyRule: AnnualContributionLimitRule = { ...rule(16, "hsa_family", "8750"), target: { targetType: "household", targetId: domainId("household", ids.household) }, includedCharacters: ["hsa_employee_ordinary", "hsa_employer_ordinary"] };
    const family = bind(familyRule);
    const first = committedContributionUsage(evaluateContributionBuckets([family], money("5000"), "hsa_employee_ordinary", []), "spouse-A-employee", "hsa_employee_ordinary");
    const second = evaluateContributionBuckets([family], money("4000"), "hsa_employer_ordinary", first, "auto_cap");
    expect(second.accepted.amount.toString()).toBe("3750");
    expect(() => evaluateContributionBuckets([family], money("1000"), "hsa_individual_catchup", first)).toThrow("CONTRIBUTION_CHARACTER_NOT_INCLUDED");
  });
  it("rejects overlapping active versions of a bucket and duplicate usage identities", () => {
    const first = bind(rule(4, "402g", "24500")), second = bind(rule(5, "402g", "24500"));
    expect(() => evaluateContributionBuckets([first, second], money("1"), "traditional_401k", [])).toThrow("CONTRIBUTION_LIMIT_BUCKET_AMBIGUOUS");
    const entries = committedContributionUsage(evaluateContributionBuckets([first], money("1"), "traditional_401k", []), "same", "traditional_401k");
    expect(() => evaluateContributionBuckets([first], money("1"), "traditional_401k", [...entries, ...entries])).toThrow("CONTRIBUTION_USAGE_DUPLICATE");
  });
  it("normalizes legacy/plural identities without changing portable format", () => {
    const ruleId = "d1000000-0000-4000-8000-000000000099";
    expect(normalizeContributionLimitRuleIds({ contribution_limit_rule_id: ruleId, contribution_limit_rule_ids: [ruleId, ruleId.toUpperCase()] })).toEqual([ruleId]);
    expect(() => normalizeContributionLimitRuleIds({ contribution_limit_rule_ids: ["invalid"] })).toThrow("CONTRIBUTION_LIMIT_BINDING_INVALID");
    const original = createGoldenHouseholdDraft();
    const model = patchPersonalObject({ ...original, objects: { ...original.objects, TaxRule: [{ tax_rule_id: ruleId, jurisdiction: "US", tax_type: "other", effective_date: "2026-01-01", expiration_date: "2027-01-01", calculation_method: "custom" }] } }, "Account", ids.retirementAccount, { contribution_limit_rule_ids: [ruleId] });
    const restored = importPersonalModelJson(exportPersonalModelJson(model));
    expect(restored.objects.Account).toEqual(model.objects.Account);
    expect(restored.modelFormatVersion).toBe(model.modelFormatVersion);
    expect(classifyFinancialSpecificationVersion("0.1.11-draft").classification).toBe("supported_directly");
  });
});
