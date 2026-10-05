import { describe, expect, it } from "vitest";
import { domainId, generatedOccurrenceKey } from "../src/identity/index.js";
import { createAuthoritativeState, positionValuationCandidate } from "../src/state/index.js";
import { deriveStatements } from "../src/statements/index.js";
import { employerContributionCandidate, contingentReclassificationCandidate, decideContribution, recordContribution, type ContributionPolicy } from "../src/simulation/contributions.js";
import { authoredContributionRules, compileContributionPolicy } from "../src/application/compiler/contributionAuthoring.js";
import { authorPersonalPurchasePlan, createGoldenHouseholdDraft, type PersonalDraft } from "../src/application/personalMvp.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { compileInvestments } from "../src/application/compiler/investments.js";
import { GOLDEN_HOUSEHOLD_IDS as ids, createGoldenHouseholdForecastRequest } from "../src/application/goldenHousehold.js";
import { runVerticalSlice3 } from "../src/simulation/verticalSlice3.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant } from "../src/time/index.js";
import { USD, Quantity, RoundingPolicy, SHARE, money, decimal } from "../src/values/index.js";
import type { JsonValue } from "../src/model/modelVersion.js";

const object = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
const at = instant("2026-01-31T23:59:59.999Z");
const facts = { taxYear: 2026, ageAtYearEnd: 36, taxableCompensation: "100000", filingStatus: "single" as const, rothMagi: "100000", deductionMagi: "100000", workplacePlanCovered: false };
const base = (character: "traditional_ira" | "roth_ira"): PersonalDraft => {
  const model = createGoldenHouseholdDraft();
  return { ...model, objects: { ...model.objects,
    Account: model.objects.Account!.map(value => object(value) && value.account_id === ids.brokerageAccount ? { ...value, account_type: character, tax_treatment: character === "traditional_ira" ? "tax_deferred" : "tax_free" } : value),
    Assumption: model.objects.Assumption!.map(value => object(value) && value.category === "market_return" ? { ...value, value: "0" } : value),
  } };
};
const run = (draft: PersonalDraft) => {
  const input = compileInvestments(draft, { ...createGoldenHouseholdForecastRequest().compiler.investments!, simulationEnd: "2026-02-01", months: 1, purchaseInstructions: [] });
  expect(input.status, JSON.stringify(input)).toBe("compiled");
  if (input.status !== "compiled") throw new Error("IRA fixture failed to compile");
  return runVerticalSlice3({ input: input.value.input, openingState: input.value.openingState, primitiveState: input.value.primitiveState, months: 1,
    runContext: createRunContext({ runId: runId("d1c40000-0000-4000-8000-000000000001"), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD }) });
};
describe("D1 authoritative contribution execution", () => {
  it.each(["traditional_ira", "roth_ira"] as const)("posts %s from checking after an export/import", character => {
    const model = base(character);
    const authored = authorPersonalPurchasePlan(model, { primitiveId: "d1c40000-0000-4000-8000-000000000002", investmentId: ids.brokerageInvestment, sourceCashAccountId: ids.checking, amount: "7500", frequency: "once", date: "2026-01-10", order: 10, contributionFacts: facts });
    const result = run(importPersonalModelJson(exportPersonalModelJson(authored)));
    expect(result.status).toBe("completed");
    expect(result.state.accounts[ids.checking]!.cash.amount.toString()).toBe("12500");
    expect(result.state.positions[ids.brokerageInvestment]!.quantity.amount.toString()).toBe("575");
    const ledger = Object.values(result.state.contributions!);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount.amount.toString()).toBe("7500");
    expect(ledger[0]!.buckets.map(bucket => bucket.amount.amount.toString())).toEqual(character === "roth_ira" ? ["7500", "7500"] : ["7500"]);
    expect(ledger[0]!.eligibleDeduction?.amount.toString()).toBe(character === "traditional_ira" ? "7500" : undefined);
    expect(result.periods[0]!.statements.income.isZero()).toBe(true);
    expect(result.periods[0]!.statements.expenses.isZero()).toBe(true);
    expect(result.periods[0]!.statements.netWorth.amount.toString()).toBe("170000");
    expect(model.objects.Account!.filter(object).find(item => item.account_id === ids.checking)!.opening_balance).toBe("20000.00");
  });
  it("rejects excess by default and explicitly caps without rewriting the authored amount", () => {
    const plan = { primitiveId: "d1c40000-0000-4000-8000-000000000002", investmentId: ids.brokerageInvestment, sourceCashAccountId: ids.checking, amount: "8000", frequency: "once" as const, date: "2026-01-10", order: 10, contributionFacts: facts };
    const rejected = run(authorPersonalPurchasePlan(base("traditional_ira"), plan));
    expect(rejected.status).toBe("incomplete");
    expect(rejected.state.accounts[ids.checking]!.cash.amount.toString()).toBe("20000");
    expect(Object.values(rejected.state.contributions ?? {})).toHaveLength(0);
    const authored = authorPersonalPurchasePlan(base("traditional_ira"), { ...plan, excessPolicy: "auto_cap" });
    const capped = run(authored);
    expect(capped.status).toBe("completed");
    expect(capped.state.accounts[ids.checking]!.cash.amount.toString()).toBe("12500");
    const primitive = authored.objects.PrimitiveInstance!.filter(object).find(item => item.primitive_instance_id === plan.primitiveId)!;
    expect(primitive.input_bindings).toMatchObject({ amount: "8000" });
  });
  it("failed funding consumes no statutory usage", () => {
    const original = base("traditional_ira");
    const emptyBank = { ...original, objects: { ...original.objects, Account: original.objects.Account!.map(value => object(value) && value.account_id === ids.checking ? { ...value, opening_balance: "0" } : value) } };
    const result = run(authorPersonalPurchasePlan(emptyBank, { primitiveId: "d1c40000-0000-4000-8000-000000000002", investmentId: ids.brokerageInvestment, sourceCashAccountId: ids.checking, amount: "1000", frequency: "once", date: "2026-01-10", order: 10, contributionFacts: facts }));
    expect(result.status).toBe("incomplete");
    expect(Object.values(result.state.contributions ?? {})).toHaveLength(0);
    expect(result.state.positions[ids.brokerageInvestment]!.quantity.amount.toString()).toBe("500");
  });
  it.each([["2000", "3750"], ["6000", "1500"]])("shares IRA capacity across accounts and applies the Roth worksheet after a %s Traditional contribution", (traditional, rothAccepted) => {
    const original = base("traditional_ira");
    const mixed = { ...original, objects: { ...original.objects, Account: original.objects.Account!.map(value => object(value) && value.account_id === ids.retirementAccount ? { ...value, account_type: "roth_ira", tax_treatment: "tax_free" } : value) } };
    const annualFacts = { ...facts, rothMagi: "160500" };
    const first = authorPersonalPurchasePlan(mixed, { primitiveId: "d1c40000-0000-4000-8000-000000000011", investmentId: ids.brokerageInvestment, sourceCashAccountId: ids.checking, amount: traditional, frequency: "once", date: "2026-01-10", order: 10, contributionFacts: annualFacts });
    const authored = authorPersonalPurchasePlan(first, { primitiveId: "d1c40000-0000-4000-8000-000000000012", investmentId: ids.retirementInvestment, sourceCashAccountId: ids.checking, amount: "5000", frequency: "once", date: "2026-01-10", order: 20, contributionFacts: annualFacts, excessPolicy: "auto_cap" });
    const result = run(importPersonalModelJson(exportPersonalModelJson(authored)));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    const contributions = Object.values(result.state.contributions!);
    expect(contributions.find(entry => entry.character === "roth_ira")!.amount.amount.toString()).toBe(rothAccepted);
    expect(contributions.flatMap(entry => entry.buckets.filter(bucket => bucket.identity.includes(":ira_shared:"))).reduce((sum, bucket) => sum.plus(bucket.amount), money("0")).equals(money(traditional).plus(money(rothAccepted)))).toBe(true);
    expect(result.state.accounts[ids.checking]!.cash.equals(money("20000").minus(money(traditional)).minus(money(rothAccepted)))).toBe(true);
    expect(result.periods[0]!.statements.netWorth.amount.toString()).toBe("170000");
  });
  it.each(["traditional_ira", "roth_ira"] as const)("funds %s from savings without expense recognition", character => {
    const result = run(authorPersonalPurchasePlan(base(character), { primitiveId: "d1c40000-0000-4000-8000-000000000013", investmentId: ids.brokerageInvestment, sourceCashAccountId: ids.savings, amount: "1000", frequency: "once", date: "2026-01-10", order: 10, contributionFacts: facts }));
    expect(result.status).toBe("completed");
    expect(result.state.accounts[ids.savings]!.cash.equals(money("14000"))).toBe(true);
    expect(result.periods[0]!.statements.expenses.isZero()).toBe(true);
    expect(Object.values(result.state.contributions!)[0]!.amount.equals(money("1000"))).toBe(true);
  });
});

describe("D1 employer benefit and contingent ownership", () => {
  const accountId = domainId("account", ids.retirementAccount), positionId = domainId("position", ids.retirementInvestment);
  const opening = () => createAuthoritativeState({ accounts: { [accountId]: { id: accountId, ownerId: domainId("person", ids.person), kind: "retirement", cash: money("0") } },
    positions: { [positionId]: { id: positionId, accountId, quantity: new Quantity(decimal("0"), SHARE), price: money("100"), carryingValue: money("0") } } });
  const policy = (): ContributionPolicy => {
    const rules = authoredContributionRules(ids.person, ["401k_additions"], 2026, { planKey: "example-sponsor" });
    const model = createGoldenHouseholdDraft();
    const account = model.objects.Account!.filter(object).find(item => item.account_id === accountId)!;
    return compileContributionPolicy({ ...model, objects: { ...model.objects, TaxRule: rules } }, { ...account, contribution_limit_rule_ids: rules.map(rule => String(rule.tax_rule_id)) }, { character: "employer_401k", personId: ids.person, householdId: ids.household, excessPolicy: "reject", facts: { taxYear: 2026, eligiblePlanCompensation: "100000" } });
  };
  it("recognizes the full benefit, values contingent units, then vests without repeat recognition or usage", () => {
    const original = opening();
    const posted = employerContributionCandidate(original, { id: "employer:first", at, accountId, positionId, requested: money("400"), vestedFraction: "0.25", policy: policy(), quantityRounding: new RoundingPolicy(12, "half_even") });
    const statements = deriveStatements(posted.state, [posted.transaction], USD);
    expect(statements.income.amount.toString()).toBe("400");
    expect(statements.netWorth.amount.toString()).toBe("100");
    expect(statements.operatingCashFlow.isZero()).toBe(true);
    expect(posted.state.accounts[accountId]!.cash.isZero()).toBe(true);
    expect(posted.state.contingentPositions![positionId]!.quantity.amount.toString()).toBe("3");
    expect(Object.values(posted.state.contributions!)[0]!.buckets[0]!.amount.amount.toString()).toBe("400");
    const valued = positionValuationCandidate(posted.state, { positionId, price: money("110"), generatedOccurrenceKey: generatedOccurrenceKey({ scenarioId: scenarioId(ids.rootScenario), primitiveInstanceId: domainId("primitive-instance", "d1c40000-0000-4000-8000-000000000003"), scheduledAt: at, semanticEffectType: "valuation", economicTargetId: positionId }) });
    expect(deriveStatements(valued, [], USD).netWorth.amount.toString()).toBe("110");
    const vested = contingentReclassificationCandidate(valued, positionId, "vest:first", at, "vest");
    expect(vested.value.amount.toString()).toBe("330");
    expect(deriveStatements(vested.state, [vested.transaction], USD).netWorth.amount.toString()).toBe("440");
    expect(deriveStatements(vested.state, [vested.transaction], USD).income.isZero()).toBe(true);
    expect(Object.values(vested.state.contributions!)).toHaveLength(1);
    expect(vested.state.contingentPositions![positionId]!.quantity.amount.isZero()).toBe(true);
    expect(original.positions[positionId]!.quantity.amount.isZero()).toBe(true);
    expect(() => employerContributionCandidate(posted.state, { id: "employer:first", at, accountId, positionId, requested: money("400"), vestedFraction: "0.25", policy: policy(), quantityRounding: new RoundingPolicy(12, "half_even") })).toThrow();
    expect(posted.state.contingentPositions![positionId]!.quantity.amount.toString()).toBe("3");
  });
  it("forfeits contingent value without spending or owned realized loss", () => {
    const posted = employerContributionCandidate(opening(), { id: "employer:first", at, accountId, positionId, requested: money("400"), vestedFraction: "0.25", policy: policy(), quantityRounding: new RoundingPolicy(12, "half_even") });
    const forfeited = contingentReclassificationCandidate(posted.state, positionId, "forfeit:first", at, "forfeit");
    const statements = deriveStatements(forfeited.state, [forfeited.transaction], USD);
    expect(statements.netWorth.amount.toString()).toBe("100");
    expect(statements.income.isZero()).toBe(true); expect(statements.expenses.isZero()).toBe(true);
    expect(forfeited.transaction.legs.some(leg => leg.type === "loss" || leg.type === "expense" || leg.type === "cash")).toBe(false);
    expect(Object.values(forfeited.state.contributions!)[0]!.amount.amount.toString()).toBe("400");
  });
});
