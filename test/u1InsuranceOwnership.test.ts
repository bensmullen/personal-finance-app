import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { authorTermLifePolicy, authorInsuredDeathScenario, unlinkPolicyDeathScenario, termLifeProblems } from "../src/application/insuranceAuthoring.js";
import { compileDomainMechanics } from "../src/application/compiler/domainMechanics.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";

const policyId = "ab940000-0000-4000-8000-000000000001", eventId = "ab940000-0000-4000-8000-000000000002";
const terms = { owner: ids.person, insured: ids.person, beneficiary: ids.household, premiumAccount: ids.checking, benefitAccount: ids.savings, premium: "50.25", benefit: "100000", start: "2026-01-01", end: "2027-01-01" };
const request = { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2027-01-01", executionOwnerId: ids.person };
const base = () => {
  const draft = createGoldenHouseholdDraft();
  // No other domain mechanics needed for the insurance-only regression.
  return { ...draft, objects: { ...draft.objects, Investment: [] } };
};
describe("U1 insurance contract and scenario have separate shared owners", () => {
  it("saves and reloads a policy without asserting death or posting a benefit", () => {
    const before = base(), authored = authorTermLifePolicy(before, policyId, terms);
    expect(authored.objects.Event).toEqual(before.objects.Event);
    expect(authored.objects.Scenario).toEqual(before.objects.Scenario);
    expect(authored.objects.Expense).toEqual(before.objects.Expense);
    expect(authored.objects.Transaction).toEqual(before.objects.Transaction);
    const restored = importPersonalModelJson(exportPersonalModelJson(authored));
    const compiled = compileDomainMechanics(restored, request);
    expect(compiled.status, JSON.stringify(compiled)).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("fixture did not compile");
    expect(compiled.value.input.operations).toHaveLength(12);
    expect(compiled.value.input.operations.every(operation => operation.kind === "insurance_premium" && operation.amount === "50.25" && operation.cashAccountId === ids.checking)).toBe(true);
    expect(compiled.value.input.operations.some(operation => operation.kind === "death_benefit")).toBe(false);
    expect(authored.objects.Insurance?.[0]).not.toHaveProperty("death_event_id");
  });
  it("preserves legacy linked identity on policy edits, with one premium stream and one covered benefit", () => {
    const authored = authorTermLifePolicy(base(), policyId, terms);
    const linked = authorInsuredDeathScenario(authored, { policyId, eventId, scenarioId: ids.rootScenario, date: "2026-03-01", enabled: true });
    const edited = authorTermLifePolicy(importPersonalModelJson(exportPersonalModelJson(linked)), policyId, { ...terms, premium: "60" });
    expect(edited.objects.Event).toEqual(linked.objects.Event);
    expect(edited.objects.Scenario).toEqual(linked.objects.Scenario);
    expect(edited.objects.Insurance?.[0]).toMatchObject({ death_event_id: eventId, coverage_amount: "100000", premium: "60" });
    const compiled = compileDomainMechanics(edited, request);
    expect(compiled.status, JSON.stringify(compiled)).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("fixture did not compile");
    expect(compiled.value.input.operations.map(item => [item.kind, item.amount, item.at.slice(0, 10)])).toEqual([
      ["insurance_premium", "60", "2026-01-01"], ["insurance_premium", "60", "2026-02-01"], ["death_benefit", "100000", "2026-03-01"],
    ]);
    expect(compiled.value.input.operations[2]?.sourceRefs).toEqual([`compiler:canonical:Insurance:${policyId}`, `compiler:canonical:Event:${eventId}`]);
    const revised = authorInsuredDeathScenario(edited, { policyId, eventId, scenarioId: ids.rootScenario, date: "2026-04-01", enabled: true });
    expect(revised.objects.Event?.filter(item => typeof item === "object" && item !== null && !Array.isArray(item) && item.event_id === eventId)).toHaveLength(1);
    expect(() => authorTermLifePolicy(revised, policyId, { ...terms, end: "2026-04-01" })).toThrow(/outside/);
  });
  it("disabling or unlinking the optional event keeps premiums and historical lineage", () => {
    const linked = authorInsuredDeathScenario(authorTermLifePolicy(base(), policyId, terms), { policyId, eventId, scenarioId: ids.rootScenario, date: "2026-03-01", enabled: true });
    const disabled = authorInsuredDeathScenario(linked, { policyId, eventId, scenarioId: ids.rootScenario, date: "2026-03-01", enabled: false });
    const compiled = compileDomainMechanics(disabled, request);
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") throw new Error("fixture did not compile");
    expect(compiled.value.input.operations).toHaveLength(12);
    expect(compiled.value.input.operations.every(item => item.kind === "insurance_premium")).toBe(true);
    const unlinked = unlinkPolicyDeathScenario(linked, policyId);
    expect(unlinked.objects.Event).toEqual(linked.objects.Event);
    expect(unlinked.objects.Scenario).toEqual(linked.objects.Scenario);
    expect(unlinked.objects.Insurance?.[0]).not.toHaveProperty("death_event_id");
  });
  it("rejects incompatible banks, people and coverage before authoring", () => {
    expect(termLifeProblems(base(), terms)).toEqual({});
    expect(termLifeProblems(base(), { ...terms, premiumAccount: ids.brokerageAccount })).toHaveProperty("premiumAccount");
    expect(termLifeProblems(base(), { ...terms, end: terms.start })).toHaveProperty("end");
    expect(termLifeProblems(base(), { ...terms, premium: "1,000" })).toHaveProperty("premium");
    expect(termLifeProblems(base(), { ...terms, insured: "unknown" })).toHaveProperty("insured");
    const policy = authorTermLifePolicy(base(), policyId, terms);
    expect(() => authorInsuredDeathScenario(policy, { policyId, eventId, scenarioId: ids.rootScenario, date: terms.end, enabled: true })).toThrow(/coverage/);
  });
});
