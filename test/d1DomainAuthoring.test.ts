import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, authorDomainOperation, type PersonalDraft, type JsonObject } from "../src/application/personalMvp.js";
import { compileDomainMechanics } from "../src/application/compiler/domainMechanics.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { runHouseholdKernel } from "../src/simulation/householdExecution.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { USD } from "../src/values/index.js";

const id = (n: number) => `d1b30000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const base = (): PersonalDraft => {
  const original = createGoldenHouseholdDraft();
  return { ...original, objects: { ...original.objects, Investment: original.objects.Investment!.filter(record).map(item => ({ ...item, acquisition_date: "2024-01-01", cost_basis: item.market_value!, after_tax_basis: "0" })) } };
};
const request = { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2027-01-01", executionOwnerId: ids.person };
const edit = (model: PersonalDraft, collection: string, predicate: (item: JsonObject) => boolean, fields: JsonObject): PersonalDraft => ({ ...model, objects: { ...model.objects, [collection]: (model.objects[collection] ?? []).filter(record).map(item => predicate(item) ? { ...item, ...fields } : item) } });
const plan = { eventId: id(1), effectId: id(2), primitiveId: id(3), name: "Sell brokerage units", date: "2026-01-10", kind: "sale" as const, amount: "1500", order: 20, holdingId: ids.brokerageInvestment, quantity: "10" };

describe("D1-B durable compiler boundaries", () => {
  it("round-trips one linked event/effect/primitive and compiles losslessly", () => {
    const original = base(), restored = importPersonalModelJson(exportPersonalModelJson(authorDomainOperation(original, plan)));
    const compiled = compileDomainMechanics(restored, request); expect(compiled.status, JSON.stringify(compiled)).toBe("compiled"); if (compiled.status !== "compiled") throw new Error("fixture unsupported");
    expect(compiled.value.input.operations.find(item => item.id === id(1))).toMatchObject({ kind: "sale", amount: "1500", quantity: "10", holdingId: ids.brokerageInvestment, at: "2026-01-10T00:00:00.000Z" });
    expect(original.objects.Event!.filter(record).some(item => item.event_id === id(1))).toBe(false);
  });
  it.each(["traditional_ira", "traditional_401k", "roth_ira"] as const)("persists an eligible direct retirement path to %s without annual contribution authorization", destinationType => {
    let model = base();
    model = edit(model, "Account", item => item.account_id === ids.retirementAccount, { account_type: destinationType === "roth_ira" ? "roth_401k" : "traditional_401k" });
    const retirement = model.objects.Investment!.filter(record).find(item => item.investment_id === ids.retirementInvestment)!;
    model = { ...model, objects: { ...model.objects, Account: [...model.objects.Account!, { account_id: id(10), owner_id: ids.person, account_type: destinationType, opening_balance: "0", opening_date: "2020-01-01", currency: "USD", tax_treatment: destinationType === "roth_ira" ? "tax_free" : "tax_deferred" }], Investment: [...model.objects.Investment!, { ...retirement, investment_id: id(11), account_id: id(10), quantity: "0", market_value: "0", after_tax_basis: "0" }] } };
    const restored = importPersonalModelJson(exportPersonalModelJson(authorDomainOperation(model, { ...plan, kind: "direct_rollover", holdingId: ids.retirementInvestment, destinationHoldingId: id(11), amount: "1000", eligibility: "eligible_owned_direct", destinationAcceptance: true })));
    const result = compileDomainMechanics(restored, request); expect(result.status, JSON.stringify(result)).toBe("compiled");
    expect(restored.objects.Account!.filter(record).find(item => item.account_id === id(10))!.contribution_limit_rule_id).toBeUndefined();
  });
  it("supports Traditional IRA trustee transfer, conversion and a mixed basis split with explicit same-plan and acceptance facts", () => {
    const original = base(), retirement = original.objects.Investment!.filter(record).find(item => item.investment_id === ids.retirementInvestment)!;
    const destinations = { ...original, objects: { ...original.objects,
      Account: [...original.objects.Account!, { account_id: id(10), owner_id: ids.person, account_type: "traditional_ira", opening_balance: "0", opening_date: "2020-01-01", currency: "USD" }, { account_id: id(12), owner_id: ids.person, account_type: "roth_ira", opening_balance: "0", opening_date: "2020-01-01", currency: "USD" }],
      Investment: [...original.objects.Investment!, { ...retirement, investment_id: id(11), account_id: id(10), quantity: "0", market_value: "0" }, { ...retirement, investment_id: id(13), account_id: id(12), quantity: "0", market_value: "0" }],
    } };
    const mixed = edit(destinations, "Investment", item => item.investment_id === ids.retirementInvestment, { after_tax_basis: "20000" });
    expect(compileDomainMechanics(authorDomainOperation(mixed, { ...plan, kind: "mixed_rollover", holdingId: ids.retirementInvestment, destinationHoldingId: id(11), rothHoldingId: id(13), amount: "50000", eligibility: "eligible_owned_direct", destinationAcceptance: true }), request).status).toBe("compiled");
    const trustee = edit(destinations, "Account", item => item.account_id === ids.retirementAccount, { account_type: "traditional_ira" });
    expect(compileDomainMechanics(authorDomainOperation(trustee, { ...plan, kind: "direct_rollover", holdingId: ids.retirementInvestment, destinationHoldingId: id(11), amount: "1000", eligibility: "eligible_owned_direct", destinationAcceptance: true }), request).status).toBe("compiled");
    const roth = edit(destinations, "Account", item => item.account_id === id(12), { account_type: "roth_401k" });
    expect(compileDomainMechanics(authorDomainOperation(roth, { ...plan, kind: "conversion", holdingId: ids.retirementInvestment, destinationHoldingId: id(13), amount: "1000", eligibility: "eligible_owned_direct", destinationAcceptance: true, samePlanConfirmed: true }), request).status).toBe("compiled");
    expect(compileDomainMechanics(authorDomainOperation(roth, { ...plan, kind: "conversion", holdingId: ids.retirementInvestment, destinationHoldingId: id(13), amount: "1000", eligibility: "eligible_owned_direct", destinationAcceptance: true }), request).status).toBe("unsupported");
  });
  it.each([ids.brokerageAccount, ids.retirementAccount])("rejects non-bank purchase funding %s before execution", cashAccountId => {
    const result = compileDomainMechanics(authorDomainOperation(base(), { ...plan, kind: "purchase", cashAccountId }), request);
    expect(result.status).toBe("unsupported"); expect(result.diagnostics[0]?.message).toContain("checking/savings");
  });
  it("requires actual retirement basis and explicit distribution eligibility, rather than contribution YTD or plan labels", () => {
    const model = authorDomainOperation(base(), { ...plan, kind: "indirect_distribution", holdingId: ids.retirementInvestment, cashAccountId: ids.checking, eligibility: "eligible_owned_participant", destinationAcceptance: true });
    const missingBasis = edit(model, "Investment", item => item.investment_id === ids.retirementInvestment, { after_tax_basis: null });
    expect(compileDomainMechanics(missingBasis, request).status).toBe("unsupported");
    const missingEligibility = edit(model, "PrimitiveInstance", item => item.primitive_instance_id === id(3), { parameters: { adapter: "d1-domain-operation/v1", kind: "indirect_distribution", amount: "1000", order: 10, holdingId: ids.retirementInvestment, cashAccountId: ids.checking, eligibility: "hardship", destinationAcceptance: true } });
    const rejected = compileDomainMechanics(missingEligibility, request); expect(rejected.status).toBe("unsupported"); expect(rejected.diagnostics[0]?.message).toContain("hardship");
  });
  it.each(["treasury_bill", "treasury_note", "treasury_bond", "cd"] as const)("persists %s terms and compiles explicit bank acquisition, income and principal maturity", subtype => {
    let model = edit(base(), "Investment", item => item.investment_id === ids.brokerageInvestment, { investment_type: "bond", instrument_subtype: subtype, quantity: "0", price: subtype === "treasury_bill" ? "980" : "1000", market_value: "0", cost_basis: subtype === "treasury_bill" ? "980" : "1000", acquisition_date: "2026-01-01", maturity_date: "2026-07-01", face_value: "1000", coupon_rate: "0.10", interest_convention: "nominal_annual_simple", crediting_frequency: "semiannual", first_credit_date: "2026-07-01", funding_account_id: ids.checking, settlement_account_id: ids.savings, return_model_id: null });
    model = importPersonalModelJson(exportPersonalModelJson(model)); const result = compileDomainMechanics(model, request); expect(result.status, JSON.stringify(result)).toBe("compiled"); if (result.status !== "compiled") throw new Error("instrument fixture unsupported");
    const operations = result.value.input.operations.filter(item => item.holdingId === ids.brokerageInvestment);
    expect(operations.map(item => [item.kind, item.amount, item.cashAccountId])).toEqual(subtype === "treasury_bill" ? [["purchase", "980", ids.checking], ["maturity", "1000", ids.savings]] : [["purchase", "1000", ids.checking], ["maturity", "1000", ids.savings], [subtype === "cd" ? "interest" : "treasury_interest", "50", ids.brokerageAccount]]);
    const missingDestination = edit(model, "Investment", item => item.investment_id === ids.brokerageInvestment, { settlement_account_id: null }); expect(compileDomainMechanics(missingDestination, request).status).toBe("unsupported");
  });
  it("gates unsupported option and fixed-income products, inferred rate bases and coupon stubs", () => {
    const option = edit(base(), "Investment", item => item.investment_id === ids.brokerageInvestment, { investment_type: "option", instrument_subtype: "put" }); expect(compileDomainMechanics(option, request).status).toBe("unsupported");
    const cash = edit(base(), "Account", item => item.account_id === ids.checking, { interest_rate: "0.05" }); expect(compileDomainMechanics(cash, request).status).toBe("unsupported");
    const bond = edit(base(), "Investment", item => item.investment_id === ids.brokerageInvestment, { investment_type: "bond", instrument_subtype: "tips" }); expect(compileDomainMechanics(bond, request).status).toBe("unsupported");
  });
  it("persists term-life insured/beneficiary identities and compiles 50 monthly premiums before a single 100000 death benefit", () => {
    const original = base();
    const model = { ...original, objects: { ...original.objects,
      Insurance: [{ insurance_id: id(20), owner_id: ids.person, insurance_type: "life", policy_family: "term_life_lump_sum", insured_person_id: ids.person, beneficiary_id: ids.household, premium_account_id: ids.checking, benefit_account_id: ids.savings, premium: "50", premium_frequency: "monthly", coverage_amount: "100000", start_date: "2026-01-01", end_date: "2027-01-01", death_event_id: id(21) }],
      Event: [...original.objects.Event!, { event_id: id(21), name: "Scheduled death", event_type: "death", start_date: "2026-03-01", scenario_id: ids.rootScenario, enabled: true, trigger_type: "scheduled", effect_ids: [], dependencies: [], precedence: 0 }],
    } };
    const restored = importPersonalModelJson(exportPersonalModelJson(model)), compiled = compileDomainMechanics(restored, request);
    expect(compiled.status, JSON.stringify(compiled)).toBe("compiled"); if (compiled.status !== "compiled") throw new Error("policy unsupported");
    expect(compiled.value.input.operations.map(item => [item.kind, item.amount, item.at.slice(0, 10), item.cashAccountId])).toEqual([["insurance_premium", "50", "2026-01-01", ids.checking], ["insurance_premium", "50", "2026-02-01", ids.checking], ["death_benefit", "100000", "2026-03-01", ids.savings]]);
    expect(compileDomainMechanics(edit(restored, "Insurance", () => true, { policy_family: "cash_value" }), request).status).toBe("unsupported");
  });
  it("executes a sale through the shared household kernel after portability, with wrapper settlement and balanced reconciliation", () => {
    const original = base();
    const model = authorDomainOperation(edit(original, "Assumption", item => item.category === "market_return", { value: "0" }), plan);
    const golden = createGoldenHouseholdForecastRequest().compiler;
    const compiled = compileHouseholdProjection(model, { ...golden, cashFlow: { ...golden.cashFlow!, simulationEnd: "2026-02-01", months: 1 }, investments: { ...golden.investments!, simulationEnd: "2026-02-01", months: 1, purchaseInstructions: [] }, liabilities: { ...golden.liabilities!, simulationEnd: "2026-02-01", months: 1 } });
    expect(compiled.status, JSON.stringify(compiled)).toBe("compiled"); if (compiled.status !== "compiled") throw new Error("shared fixture unsupported");
    const result = runHouseholdKernel({ kernel: compiled.value.executionKernel!, resultTier: "detail", runContext: createRunContext({ runId: runId(id(30)), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD }) });
    expect(result.state.accounts[ids.brokerageAccount]!.cash.amount.toString()).toBe("1500"); expect(result.state.positions[ids.brokerageInvestment]!.quantity.amount.toString()).toBe("490");
    expect(result.periods[0]?.transactions.some(tx => tx.type === "sale")).toBe(true);
    expect(result.periods[0]?.investments?.unrealizedGain.amount.toString()).toBe("0");
  });
});
