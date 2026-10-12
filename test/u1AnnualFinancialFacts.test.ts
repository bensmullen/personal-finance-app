import { describe, expect, it } from "vitest";
import { contributionFactSources, recordAnnualFinancialFact, resolveAnnualFinancialFact } from "../src/application/financialFacts.js";
import { withContributionYearSchedule } from "../src/application/contributionYearFacts.js";
import { projectAnnualPay } from "../src/application/annualPay.js";
import { compileCashFlow } from "../src/application/compiler/cashFlow.js";
import { contributionPolicyAt } from "../src/simulation/contributionProjection.js";
import { exportPersonalModelJson, importPersonalModelJson, getPayrollContributionPlans, patchPersonalObject } from "../src/application/personalMvp.js";
import { instant } from "../src/time/index.js";
import { GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest, integratedId } from "./fixtures/d1IntegratedHousehold.js";

describe("U1 original annual sources and audited corrections", () => {
  const scope = { personId: golden.person, householdId: golden.household, taxYear: 2026, sponsorId: "golden-employer" };
  it("reconciles only acknowledged original observations and preserves history, cash and holdings", () => {
    const model = createD1IntegratedHousehold();
    const source = contributionFactSources(model).find(row => row.accountType.endsWith("_401k"))!;
    const resolved = resolveAnnualFinancialFact(model, "eligiblePlanCompensation", scope);
    expect(resolved).toMatchObject({ status: "known", value: "108000" });
    expect(() => recordAnnualFinancialFact(model, { id: integratedId(810), field: "eligiblePlanCompensation", scope, value: "120000", reconciledSources: [] })).toThrow("CONFIRM_SOURCES");
    const corrected = recordAnnualFinancialFact(model, { id: integratedId(810), field: "eligiblePlanCompensation", scope, value: "120000", reconciledSources: resolved.sources.map(row => row.id) });
    expect(resolveAnnualFinancialFact(corrected, "eligiblePlanCompensation", scope)).toMatchObject({ status: "known", value: "120000" });
    expect(corrected.objects.Account).toEqual(model.objects.Account);
    expect(corrected.objects.Investment).toEqual(model.objects.Investment);
    expect(corrected.objects.PrimitiveInstance).toEqual(expect.arrayContaining(model.objects.PrimitiveInstance!));
    expect(importPersonalModelJson(exportPersonalModelJson(corrected))).toEqual(corrected);
    const imported = { ...corrected, objects: { ...corrected.objects, PrimitiveInstance: corrected.objects.PrimitiveInstance!.map(item => {
      if (item === null || Array.isArray(item) || typeof item !== "object" || item.primitive_instance_id !== source.id) return item;
      const parameters = item.parameters as Record<string, unknown>;
      const contribution = parameters.contribution as Record<string, unknown>;
      return { ...item, parameters: { ...parameters, contribution: { ...contribution, facts: { ...contribution.facts as object, eligiblePlanCompensation: "130000" } } } };
    }) } };
    // A changed import carrying an old ID is new evidence, not an automatic override.
    expect(resolveAnnualFinancialFact(imported as typeof corrected, "eligiblePlanCompensation", scope).status).toBe("true_conflict");
  });
  it("does not reuse another employer/year, guess health coverage, or carry the nominal checkbox", () => {
    const model = createD1IntegratedHousehold({ projectAnnualFacts: true });
    expect(resolveAnnualFinancialFact(model, "eligiblePlanCompensation", { ...scope, sponsorId: "other-employer" }).status).toBe("missing");
    expect(resolveAnnualFinancialFact(model, "hsaCoverage", { ...scope, taxYear: 2027 }).status).toBe("missing");
    const policy = getPayrollContributionPlans(model)[0]!.allocation.policy;
    const future = contributionPolicyAt(withContributionYearSchedule(model, policy, "2026-01-01", "2028-01-01"), instant("2027-01-01T00:00:00.000Z"));
    expect(future.facts).toMatchObject({ taxYear: 2027, ageAtYearEnd: 37, lawProjection: "projected_current_law" });
    expect(future.facts.eligiblePlanCompensation).toBeUndefined();
    expect(future.facts.annualFactProjection).toBeUndefined();
    expect(() => recordAnnualFinancialFact(model, { id: integratedId(811), field: "hsaFullYearEligible", scope, value: "yes", reconciledSources: [] })).toThrow("VALUE_INVALID");
  });
  it("aggregates exact supported gross salary occurrences and respects dated termination without deriving MAGI", () => {
    const model = patchPersonalObject(createD1IntegratedHousehold(), "Income", golden.income, { end_date: "2026-07-01" });
    const compiled = compileCashFlow(model, { ...d1IntegratedCompilerRequest().cashFlow!, simulationEnd: "2027-01-01", months: 12 });
    if (compiled.status !== "compiled") throw new Error(JSON.stringify(compiled.diagnostics));
    const before = exportPersonalModelJson(model);
    const result = projectAnnualPay(model, compiled.value.input, golden.person, 2026, "golden-employer");
    expect(result).toMatchObject({ status: "derived", amount: "54000", basis: "modeled_gross_salary_occurrences" });
    expect(result.occurrences).toHaveLength(6);
    expect(projectAnnualPay(model, compiled.value.input, golden.person, 2026, "other-employer").status).toBe("missing");
    expect(resolveAnnualFinancialFact(model, "rothMagi", { ...scope, taxYear: 2027 }).status).toBe("missing");
    expect(exportPersonalModelJson(model)).toBe(before);
  });
});
