import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATION_OWNERS, TERM_BINDINGS, operationBindings } from "../ui/authoring/activityOwnership.js";
import { ENTITY_FIELD_INVENTORY, entityField, financialField } from "../ui/authoring/fieldContract.js";
import { WORKFLOW_FIELD_OWNERS } from "../ui/authoring/fieldOwnership.js";
import { authorDomainOperation, createGoldenHouseholdDraft } from "../src/application/personalMvp.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { callExerciseAmount, holdingDomainActivities } from "../src/application/investmentActivity.js";
import { objects } from "../src/application/compiler/shared.js";
const registry = JSON.parse(readFileSync(new URL("../docs/specs/verification/u1-fact-ownership.json", import.meta.url), "utf8")) as { records: { id: string; authored_domain_operation_kinds?: string[]; ui_fact_bindings?: { always: string[]; optional?: string[]; derived?: string[]; conditional?: string[] } }[] };
const families = new Map(registry.records.map(row => [row.id, row]));
const id = (n: number) => `ab940001-0000-4000-8000-${String(n).padStart(12, "0")}`;
describe("U1 rendered-control ownership guard", () => {
  it("binds every inventoried entity field and workflow input to a controlled family", () => {
    for (const [context, fields] of Object.entries(ENTITY_FIELD_INVENTORY)) for (const key of fields) {
      const field = entityField(key, context)!;
      expect(families.has(field.semanticFamily!), `${context}.${key}`).toBe(true);
      expect(field.semanticBinding).toBe(key);
      expect(field.semanticScope).toBeTruthy();
    }
    for (const [key, owner] of Object.entries(WORKFLOW_FIELD_OWNERS)) {
      expect(families.has(owner), key).toBe(true);
      expect(financialField(key).semanticFamily).toBe(owner);
    }
    expect(entityField("opening_balance", "Account", undefined, false, "0", undefined, "roth_ira")?.semanticFamily).toBe("investment.account");
    expect(entityField("value", "Assumption", undefined, false, "0", undefined, undefined, "market_return")?.semanticFamily).toBe("investment.return");
  });
  it("maps each activity subtype to precisely its approved family and conditional terms", () => {
    for (const [kind, owner] of Object.entries(OPERATION_OWNERS)) {
      const declared = registry.records.filter(row => row.authored_domain_operation_kinds?.includes(kind));
      expect(declared.map(row => row.id), kind).toEqual([owner]);
    }
    for (const [, [key, owner, binding]] of Object.entries(TERM_BINDINGS)) {
      expect(financialField(key)).toBeDefined();
      expect(families.get(owner)?.ui_fact_bindings?.always, key).toContain(binding);
    }
    expect(operationBindings("mixed_rollover").rothDestination).toBe("rothDestinationHoldingId");
    expect(operationBindings("indirect_deposit").linkedDistribution).toBe("linkedDistributionEventId");
    expect(operationBindings("call_exercise").operationUnits).toBe("contracts");
  });
  it("isolates source activity, links indirect deposits, and edits without new identities", () => {
    const plan = { eventId: id(1), effectId: id(2), primitiveId: id(3), name: "Sell units", date: "2026-01-15", kind: "sale" as const, amount: "500", order: 10, holdingId: ids.brokerageInvestment, quantity: "5" };
    const saved = authorDomainOperation(createGoldenHouseholdDraft(), plan);
    const edited = authorDomainOperation(saved, { ...plan, amount: "600" });
    expect(holdingDomainActivities(edited, ids.brokerageInvestment)).toHaveLength(1);
    expect(holdingDomainActivities(edited, ids.retirementInvestment)).toHaveLength(0);
    expect(holdingDomainActivities(edited, ids.brokerageInvestment)[0]?.terms.amount).toBe("600");
    const disabled = { ...saved, objects: { ...saved.objects, Event: objects(saved, "Event").map(item => ({ ...item, enabled: false })) } };
    const revised = authorDomainOperation(disabled, { ...plan, amount: "700" });
    expect(holdingDomainActivities(revised, ids.brokerageInvestment)[0]?.event.enabled).toBe(false);
    expect(holdingDomainActivities(revised, ids.brokerageInvestment)[0]?.primitive.primitive_instance_id).toBe(plan.primitiveId);
    expect(holdingDomainActivities(revised, ids.brokerageInvestment)[0]?.effect.event_effect_id).toBe(plan.effectId);
    expect(revised.objects.Scenario).toEqual(saved.objects.Scenario);
    const distribution = authorDomainOperation(edited, { ...plan, eventId: id(4), effectId: id(5), primitiveId: id(6), kind: "indirect_distribution", holdingId: ids.retirementInvestment, cashAccountId: ids.checking });
    const { holdingId: _source, ...depositTerms } = plan;
    const deposit = authorDomainOperation(distribution, { ...depositTerms, eventId: id(7), effectId: id(8), primitiveId: id(9), kind: "indirect_deposit", destinationHoldingId: ids.brokerageInvestment, linkedOperationId: id(4) });
    expect(holdingDomainActivities(deposit, ids.retirementInvestment).map(row => row.terms.kind)).toEqual(["indirect_distribution", "indirect_deposit"]);
    expect(holdingDomainActivities(deposit, ids.brokerageInvestment).map(row => row.terms.kind)).toEqual(["sale"]);
  });
  it("suggests exact exercise cash from contract terms, never from a guessed return", () => {
    const draft = createGoldenHouseholdDraft();
    const call = { investment_id: id(20), account_id: ids.brokerageAccount, instrument_subtype: "long_equity_call", strike_price: "50.125", contract_multiplier: 100 };
    const model = { ...draft, objects: { ...draft.objects, Investment: [...draft.objects.Investment!, call] } };
    expect(callExerciseAmount(model, id(20), "2")).toBe("10025");
    expect(callExerciseAmount(model, id(20), "0.5")).toBeUndefined();
    expect(callExerciseAmount(model, ids.brokerageInvestment, "2")).toBeUndefined();
  });
});
