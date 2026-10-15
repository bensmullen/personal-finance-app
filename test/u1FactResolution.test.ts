import { describe, expect, it } from "vitest";
import { resolveScopedFact, resolveAgeAtYearEnd, futureContributionFactBoundary, type FactScope } from "../src/application/factResolution.js";
import { createGoldenHouseholdDraft, authorHistoricalContributionScope, authorPayrollContributionPlan, getOpeningContributionReadiness, authorOpeningContributionUsage, exportPersonalModelJson, importPersonalModelJson, getOpeningContributionUsage } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { createD1IntegratedHousehold } from "./fixtures/d1IntegratedHousehold.js";
import { getOpeningContributionOptions } from "../src/application/personalMvp.js";
import { resolveAnnualPolicyCopies } from "../src/application/contributionFactResolution.js";

describe("U1 scoped fact resolution boundary", () => {
  const scope: FactScope = { personId: ids.person, taxYear: 2026, sponsorId: "Employer A" };
  const repair = { owner: "Money → Income", entityType: "Person" as const, entityId: ids.person, field: "date_of_birth" };
  const observation = (id: string, value: string, observedScope = scope) => ({ id, label: id, scope: observedScope, value, provenance: "observed" as const });
  const resolve = (sources: ReturnType<typeof observation>[]) => resolveScopedFact({ semanticId: "income.prior_sponsor_wages", scope, sources, repair, dependencies: ["income.employer"], equal: (a, b) => a === b });

  it("retains both identical sources and never resolves a discrepancy by input order", () => {
    const a = observation("history", "100"), b = observation("payroll", "100");
    expect(resolve([a, b])).toEqual(resolve([b, a]));
    expect(resolve([a, b])).toMatchObject({ status: "known", value: "100", sources: [a, b] });
    const conflict = resolve([a, observation("payroll", "200")]);
    expect(conflict.status).toBe("true_conflict");
    expect(conflict).not.toHaveProperty("value");
    expect(conflict.sources.map(source => source.value)).toEqual(["100", "200"]);
  });
  it("does not join employers, years, people, households or accounts", () => {
    for (const other of [{ ...scope, sponsorId: "Employer B" }, { ...scope, taxYear: 2027 },
      { ...scope, personId: "another-person" }, { ...scope, householdId: "another-household" },
      { ...scope, accountId: "another-account" }]) {
      expect(resolve([observation("different scope", "200", other)])).toMatchObject({ status: "missing", sources: [] });
    }
  });
  it("coalesces IRA, HSA and workplace compatibility metadata while retaining legal disagreements", () => {
    const options = getOpeningContributionOptions(createD1IntegratedHousehold());
    for (const suffix of ["_ira", "_hsa", "_401k"]) {
      const option = options.find(row => row.character.endsWith(suffix))!;
      expect(option, suffix).toBeDefined();
      const policy = option.policy;
      const sources = [{ id: "history", label: "Recorded history", policy }, { id: "future", label: "Future plan", policy: {
        ...policy, excessPolicy: "auto_cap" as const, facts: { ...policy.facts, annualFactProjection: "confirmed_nominal_carry_forward" as const },
        limits: [...policy.limits].reverse().map(binding => ({ ...binding, ruleId: "different-compatible-reference" })),
      } }];
      expect(resolveAnnualPolicyCopies(option.investmentId, sources)).toMatchObject({ status: "known", sources: expect.any(Array) });
      expect(resolveAnnualPolicyCopies(option.investmentId, [sources[0]!, { ...sources[1]!, policy: { ...sources[1]!.policy, facts: { ...policy.facts, ageAtYearEnd: 99 } } }]).status).toBe("true_conflict");
    }
  });
  it("derives December 31 age from the person without writing a policy or inventing eligibility", () => {
    const original = createGoldenHouseholdDraft();
    const model = { ...original, objects: { ...original.objects, Person: original.objects.Person!.map(person => ({ ...person as object, date_of_birth: "1990-12-31" })) } };
    const before = JSON.stringify(model);
    expect(resolveAgeAtYearEnd(model, ids.person, 2026)).toMatchObject({ status: "derived", value: 36, repair: { field: "date_of_birth" } });
    expect(resolveAgeAtYearEnd(model, ids.person, 2027)).toMatchObject({ status: "derived", value: 37 });
    expect(resolveAgeAtYearEnd(model, "unknown", 2026).status).toBe("missing");
    expect(futureContributionFactBoundary(scope, ids.retirementInvestment)).toMatchObject({ status: "unsupported", semanticId: "investment.contribution_projection" });
    expect(JSON.stringify(model)).toBe(before);
  });
  it("reuses identical historical/payroll facts despite future projection metadata, preserving YTD and cash", () => {
    const facts = { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: "108000" };
    const history = authorHistoricalContributionScope(createGoldenHouseholdDraft(), { id: "d1940000-0000-4000-8000-000000000021", investmentId: ids.retirementInvestment, planKey: "Example employer", facts });
    const model = authorPayrollContributionPlan(history, { primitiveId: "d1940000-0000-4000-8000-000000000022", investmentId: ids.retirementInvestment, incomeId: ids.income,
      character: "traditional_401k", priority: 10, calculation: { kind: "fixed", amount: "100" }, planKey: "Example employer", vestedFraction: "1", excessPolicy: "auto_cap",
      facts: { ...facts, eligiblePlanCompensation: "108000.00", annualFactProjection: "confirmed_nominal_carry_forward" } });
    expect(getOpeningContributionReadiness(model, "2026-07-01").ready).toBe(true);
    const saved = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [{ id: "d1940000-0000-4000-8000-000000000023", investmentId: ids.retirementInvestment, character: "traditional_401k", amount: "1000", ordinaryAmount: "1000" }] });
    const reloaded = importPersonalModelJson(exportPersonalModelJson(saved));
    expect(getOpeningContributionReadiness(reloaded, "2026-07-01").ready).toBe(true);
    expect(getOpeningContributionUsage(reloaded)?.entries[0]).toMatchObject({ amount: "1000", ordinaryAmount: "1000" });
    expect(saved.objects.Account).toEqual(model.objects.Account);
    expect(saved.objects.Investment).toEqual(model.objects.Investment);
    expect(() => authorPayrollContributionPlan(history, { primitiveId: "d1940000-0000-4000-8000-000000000022", investmentId: ids.retirementInvestment, incomeId: ids.income,
      character: "traditional_401k", priority: 10, calculation: { kind: "fixed", amount: "100" }, planKey: "Example employer", vestedFraction: "1", excessPolicy: "reject", facts: { ...facts, eligiblePlanCompensation: "100000" } })).toThrow("ANNUAL_FACT_CONFLICT:eligiblePlanCompensation:2026");
  });
});
