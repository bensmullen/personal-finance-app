import { describe, expect, it } from "vitest";
import { createGoldenHouseholdDraft, getCurrentPosition, addPersonalObject, patchPersonalObject, type PersonalDraft } from "../src/application/personalMvp.js";
import type { JsonValue } from "../src/model/modelVersion.js";
import { GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { authorPayrollContributionPlan, payrollOpeningBalances, durablePayrollAllocations } from "../src/application/compiler/payrollAuthoring.js";
import { authorPersonalPurchasePlan, durablePersonalPurchaseInstructions } from "../src/application/compiler/personalPurchases.js";
import { authorOpeningContributionUsage, compileOpeningContributionUsage, savedOpeningContributionUsage, openingContributionOptions } from "../src/application/compiler/contributionOpening.js";
import { authorHistoricalContributionScope, historicalContributionScopes } from "../src/application/compiler/contributionHistoryScopes.js";
import { contributionCapacityReadModel } from "../src/application/compiler/contributionReadModel.js";
import { compileInvestments } from "../src/application/compiler/investments.js";
import { compileCashFlow } from "../src/application/compiler/cashFlow.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { createAuthoritativeState, positionValuationCandidate } from "../src/state/index.js";
import { decideContribution, recordContribution, contingentReclassificationCandidate } from "../src/simulation/contributions.js";
import { deriveStatements } from "../src/statements/index.js";
import { generatedOccurrenceKey, domainId } from "../src/identity/index.js";
import { money, USD } from "../src/values/index.js";
import { instant } from "../src/time/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { createWorkplaceEventParticipant } from "../src/simulation/workplaceEvents.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { compileHouseholdKernel } from "../src/simulation/r3/compiledHousehold.js";
import { runHouseholdKernel } from "../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";

const id = (n: number) => `d1c70000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const object = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
// Fixtures may define immutable account types and consistent derived market values;
// the ordinary editor intentionally cannot overwrite those canonical fields.
const fixtureFields = (model: PersonalDraft, collection: string, idField: string, id: string, fields: Readonly<Record<string, JsonValue>>): PersonalDraft => ({ ...model, objects: { ...model.objects,
  [collection]: model.objects[collection]!.map(value => object(value) && value[idField] === id ? { ...value, ...fields } : value),
} });
const workplace = (openingUnvestedQuantity = "0") => authorPayrollContributionPlan(createGoldenHouseholdDraft(), {
  primitiveId: id(1), investmentId: ids.retirementInvestment, incomeId: ids.income, character: "employer_401k", priority: 10,
  calculation: { kind: "fixed", amount: "100" }, planKey: "sponsor", vestedFraction: "0.25", openingUnvestedQuantity, excessPolicy: "reject",
  facts: { taxYear: 2026, ageAtYearEnd: 50, eligiblePlanCompensation: "100000", planHasRoth: true, priorYearSponsorWages: "100000" },
});
const investmentsRequest = (start = "2026-01-01") => ({ baseCurrency: "USD", asOf: start, simulationStart: start, simulationEnd: start === "2026-01-01" ? "2026-02-01" : "2026-08-01", months: 1, executionOwnerId: ids.person, purchaseInstructions: [], transferInstructions: [] });
const cashRequest = (start = "2026-01-01") => ({ baseCurrency: "USD", simulationStart: start, simulationEnd: start === "2026-01-01" ? "2026-02-01" : "2026-08-01", months: 1, sameInstantCashFlowOrder: "income_before_expense" as const, executionAccountId: ids.checking });

describe("D1 authoritative opening employer ownership", () => {
  it.each(["vest", "forfeit"] as const)("keeps employee/vested units owned and reclassifies opening contingent value on %s", kind => {
    const baseline = getCurrentPosition(createGoldenHouseholdDraft(), { baseCurrency: "USD", asOf: "2026-01-01" });
    const fixture = fixtureFields(workplace("100"), "Investment", "investment_id", ids.retirementInvestment, { quantity: "500", market_value: "50000" });
    const model = importPersonalModelJson(exportPersonalModelJson(fixture));
    const current = getCurrentPosition(model, { baseCurrency: "USD", asOf: "2026-01-01" });
    expect(current.contingentPlanValue!.exact).toBe("10000");
    expect(money(current.netWorth!.exact).plus(money("60000")).amount.toString()).toBe(money(baseline.netWorth!.exact).amount.toString());
    const opening = createAuthoritativeState(payrollOpeningBalances(model, durablePayrollAllocations(model)));
    expect(opening.positions[ids.retirementInvestment]!.quantity.amount.toString()).toBe("400");
    expect(opening.contingentPositions![ids.retirementInvestment]!.quantity.amount.toString()).toBe("100");
    expect(deriveStatements(opening, [], USD).netWorth.amount.toString()).toBe("40000");
    const cash = compileCashFlow(model, cashRequest()), investments = compileInvestments(model, investmentsRequest());
    expect(cash.status).toBe("compiled"); expect(investments.status).toBe("compiled");
    if (cash.status !== "compiled" || investments.status !== "compiled") throw new Error("Opening compilation failed");
    expect(cash.value.openingState.positions[ids.retirementInvestment]).toEqual(investments.value.openingState.positions[ids.retirementInvestment]);
    expect(cash.value.openingState.contingentPositions).toEqual(investments.value.openingState.contingentPositions);
    const at = instant("2026-02-10T00:00:00.000Z");
    const valued = positionValuationCandidate(opening, { positionId: domainId("position", ids.retirementInvestment), price: money("110"), generatedOccurrenceKey: generatedOccurrenceKey({ scenarioId: scenarioId(ids.rootScenario), primitiveInstanceId: domainId("primitive-instance", id(2)), scheduledAt: at, semanticEffectType: "valuation", economicTargetId: domainId("position", ids.retirementInvestment) }) });
    expect(deriveStatements(valued, [], USD).netWorth.amount.toString()).toBe("44000");
    expect(valued.positions[ids.retirementInvestment]!.price.times(valued.contingentPositions![ids.retirementInvestment]!.quantity.amount).amount.toString()).toBe("11000");
    const result = contingentReclassificationCandidate(valued, domainId("position", ids.retirementInvestment), "opening:event", at, kind);
    const statements = deriveStatements(result.state, [result.transaction], USD);
    expect(statements.netWorth.amount.toString()).toBe(kind === "vest" ? "55000" : "44000");
    expect(statements.income.isZero()).toBe(true); expect(statements.expenses.isZero()).toBe(true); expect(statements.operatingCashFlow.isZero()).toBe(true);
    expect(Object.values(result.state.contributions ?? {})).toHaveLength(0);
    expect(result.state.positions[ids.retirementInvestment]!.quantity.amount.toString()).toBe(kind === "vest" ? "500" : "400");
    const context = createRunContext({ runId: runId(id(3)), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-02-01T00:00:00.000Z"), dataCutoff: instant("2026-02-01T00:00:00.000Z"), simulationStart: instant("2026-02-01T00:00:00.000Z"), simulationEnd: instant("2026-03-01T00:00:00.000Z"), baseCurrency: USD });
    const kernel = compileHouseholdKernel({ reconciledOpeningState: valued, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), executionMonths: 1, scenarioIdentity: context.scenarioId, scenarioBindings: {}, standaloneAssets: [], participants: [createWorkplaceEventParticipant([{ eventId: id(4), positionId: domainId("position", ids.retirementInvestment), at, kind }])] }, context.simulationStart);
    const forecast = runHouseholdKernel({ kernel, runContext: context });
    expect(forecast.status).toBe("completed");
    const replay = restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(forecast));
    expect(runHouseholdKernel({ kernel: replay.replay.kernel, runContext: replay.replay.runContext }).state).toEqual(forecast.state);
  });
  it("rejects an opening contingent quantity larger than total units without changing the model", () => {
    expect(() => workplace("1001")).toThrow("OPENING_EMPLOYER_UNVESTED_QUANTITY_INVALID");
  });
});

describe("D1 prior YTD statutory usage", () => {
  it.each(["traditional_401k", "roth_401k"] as const)("keeps inactive Employer A %s and additions separate from active Employer B", character => {
    let model = fixtureFields(createGoldenHouseholdDraft(), "Account", "account_id", ids.brokerageAccount, { account_type: character, tax_treatment: character === "roth_401k" ? "tax_free" : "tax_deferred" });
    const facts = { taxYear: 2026, ageAtYearEnd: 50, eligiblePlanCompensation: "100000", planHasRoth: true, priorYearSponsorWages: "100000" };
    model = authorHistoricalContributionScope(model, { id: id(50), investmentId: ids.brokerageInvestment, planKey: "employer-a", facts });
    model = authorPayrollContributionPlan(model, { primitiveId: id(51), investmentId: ids.retirementInvestment, incomeId: ids.income, character: "traditional_401k", priority: 10, calculation: { kind: "fixed", amount: "20000" }, planKey: "employer-b", vestedFraction: "1", excessPolicy: "auto_cap", facts });
    const extra = character === "traditional_401k" ? [{ id: id(53), investmentId: ids.brokerageInvestment, character: "employer_401k" as const, amount: "30000" }, { id: id(54), investmentId: ids.brokerageInvestment, character: "after_tax_401k" as const, amount: "10000" }] : [];
    model = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [{ id: id(52), investmentId: ids.brokerageInvestment, character, amount: "20000", ordinaryAmount: "20000" }, ...extra] });
    const restored = importPersonalModelJson(exportPersonalModelJson(model));
    expect(historicalContributionScopes(restored)).toEqual(historicalContributionScopes(model));
    expect(durablePayrollAllocations(restored)).toHaveLength(1);
    expect(durablePersonalPurchaseInstructions(restored)).toEqual([]);
    const usage = compileOpeningContributionUsage(restored, "2026-07-01");
    expect(Object.values(usage.contributions).flatMap(entry => entry.buckets).some(bucket => bucket.identity.includes("401k_additions:employer-b"))).toBe(false);
    const rows = contributionCapacityReadModel(restored);
    expect(rows.find(row => row.bucketIdentity.includes("401k_additions:employer-a"))!.openingUsage).toBe(character === "traditional_401k" ? "60000" : "20000");
    expect(rows.find(row => row.bucketIdentity.includes("401k_additions:employer-b"))).toMatchObject({ openingUsage: "0", remaining: "72000" });
    expect(rows.filter(row => row.bucketIdentity.includes(":401k_elective:")).every(row => row.openingUsage === "20000" && row.remaining === "12500")).toBe(true);
    const balances = payrollOpeningBalances(restored, durablePayrollAllocations(restored));
    const opening = createAuthoritativeState({ ...balances, accounts: { ...usage.accounts, ...balances.accounts }, contributions: usage.contributions });
    const allocation = durablePayrollAllocations(restored)[0]!.allocation;
    const decision = decideContribution(opening, allocation.policy, allocation.accountId, instant("2026-07-15T00:00:00.000Z"), money("20000"));
    expect(decision.accepted.amount.toString()).toBe("12500");
    expect(decision.buckets.find(bucket => bucket.bucketIdentity.includes("401k_additions:employer-b"))!.usedBefore.isZero()).toBe(true);
    expect(decision.buckets.find(bucket => bucket.bucketIdentity.includes("401k_additions:employer-b"))!.consumedAmount!.amount.toString()).toBe("4500");
    expect(deriveStatements(opening, [], USD).income.isZero()).toBe(true);
    expect(deriveStatements(opening, [], USD).expenses.isZero()).toBe(true);
    expect(deriveStatements(opening, [], USD).operatingCashFlow.isZero()).toBe(true);
    const context = createRunContext({ runId: runId(id(55)), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-07-01T00:00:00.000Z"), dataCutoff: instant("2026-07-01T00:00:00.000Z"), simulationStart: instant("2026-07-01T00:00:00.000Z"), simulationEnd: instant("2026-08-01T00:00:00.000Z"), baseCurrency: USD });
    const kernel = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), executionMonths: 1, scenarioIdentity: context.scenarioId, scenarioBindings: {}, standaloneAssets: [], participants: [createWorkplaceEventParticipant([])] }, context.simulationStart);
    const result = runHouseholdKernel({ kernel, runContext: context });
    expect(result.status).toBe("completed");
    const replay = restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(result));
    expect(runHouseholdKernel({ kernel: replay.replay.kernel, runContext: replay.replay.runContext }).state.contributions).toEqual(opening.contributions);
    expect(() => compileOpeningContributionUsage(restored, "2026-08-01")).toThrow("OPENING_CONTRIBUTION_USAGE_REQUIRED");
  });
  it.each(["traditional_ira", "roth_ira"] as const)("uses inactive %s history against the shared IRA allowance", character => {
    let model = fixtureFields(createGoldenHouseholdDraft(), "Account", "account_id", ids.brokerageAccount, { account_type: character, tax_treatment: character === "roth_ira" ? "tax_free" : "tax_deferred" });
    model = fixtureFields(model, "Account", "account_id", ids.retirementAccount, { account_type: "traditional_ira", tax_treatment: "tax_deferred" });
    const facts = { taxYear: 2026, ageAtYearEnd: 40, taxableCompensation: "100000", filingStatus: "single" as const, rothMagi: "100000", workplacePlanCovered: false };
    model = authorHistoricalContributionScope(model, { id: id(60), investmentId: ids.brokerageInvestment, facts });
    model = authorPersonalPurchasePlan(model, { primitiveId: id(61), investmentId: ids.retirementInvestment, sourceCashAccountId: ids.checking, amount: "2000", date: "2026-07-15", frequency: "once", order: 10, contributionFacts: facts, excessPolicy: "auto_cap" });
    model = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [{ id: id(62), investmentId: ids.brokerageInvestment, character, amount: "6500" }] });
    const restored = importPersonalModelJson(exportPersonalModelJson(model));
    expect(durablePersonalPurchaseInstructions(restored)).toHaveLength(1);
    expect(Object.values(compileOpeningContributionUsage(restored, "2026-07-01").contributions)[0]!.character).toBe(character);
    const compiled = compileInvestments(restored, investmentsRequest("2026-07-01"));
    expect(compiled.status).toBe("compiled"); if (compiled.status !== "compiled") throw new Error("Inactive IRA history compilation failed");
    const purchase = compiled.value.input.purchases.find(item => item.destinationAccountId === ids.retirementAccount)!;
    const decision = decideContribution(compiled.value.openingState, purchase.contribution!, ids.retirementAccount, instant("2026-07-15T00:00:00.000Z"), money("2000"));
    expect(decision.accepted.amount.toString()).toBe("1000");
    expect(deriveStatements(compiled.value.openingState, [], USD).netWorth.amount.toString()).toBe("170000");
    expect(deriveStatements(compiled.value.openingState, [], USD).operatingCashFlow.isZero()).toBe(true);
  });
  it("keeps inactive spouse HSA ordinary usage shared and individual catch-up separate", () => {
    let model = patchPersonalObject(createGoldenHouseholdDraft(), "Household", ids.household, { members: [ids.person, id(70)], filing_status: "married_joint", household_type: "couple" });
    model = addPersonalObject(model, "Person", id(70), { household_id: ids.household, first_name: "Spouse", last_name: "Example", date_of_birth: "1971-01-01", residence_jurisdiction: "US-NY" });
    model = fixtureFields(model, "Account", "account_id", ids.brokerageAccount, { account_type: "hsa_investment", tax_treatment: "tax_free", owner_id: id(70) });
    model = fixtureFields(model, "Investment", "investment_id", ids.brokerageInvestment, { owner_id: id(70), tax_treatment: "tax_free" });
    model = fixtureFields(model, "Account", "account_id", ids.retirementAccount, { account_type: "hsa_investment", tax_treatment: "tax_free" });
    const facts = { taxYear: 2026, ageAtYearEnd: 55, hsaCoverage: "family" as const, hsaFullYearEligible: true };
    model = authorHistoricalContributionScope(model, { id: id(71), investmentId: ids.brokerageInvestment, facts: { ...facts, hsaFamilyAllocation: "4250" } });
    model = authorPayrollContributionPlan(model, { primitiveId: id(72), investmentId: ids.retirementInvestment, incomeId: ids.income, character: "employee_hsa", priority: 10, calculation: { kind: "fixed", amount: "2000" }, vestedFraction: "1", excessPolicy: "auto_cap", facts: { ...facts, hsaFamilyAllocation: "4500" } });
    model = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [{ id: id(73), investmentId: ids.brokerageInvestment, character: "employee_hsa", amount: "3000", ordinaryAmount: "3000" }, { id: id(74), investmentId: ids.brokerageInvestment, character: "employer_hsa", amount: "2250", ordinaryAmount: "1250" }, { id: id(75), investmentId: ids.retirementInvestment, character: "employee_hsa", amount: "4500", ordinaryAmount: "4500" }] });
    const restored = importPersonalModelJson(exportPersonalModelJson(model));
    const compiled = compileInvestments(restored, investmentsRequest("2026-07-01"));
    expect(compiled.status).toBe("compiled"); if (compiled.status !== "compiled") throw new Error("Inactive spouse HSA compilation failed");
    expect(durablePayrollAllocations(restored)).toHaveLength(1);
    const allocation = durablePayrollAllocations(restored)[0]!.allocation;
    const decision = decideContribution(compiled.value.openingState, allocation.policy, allocation.accountId, instant("2026-07-15T00:00:00.000Z"), money("2000"));
    expect(decision.accepted.amount.toString()).toBe("1000");
    expect(decision.buckets.find(bucket => bucket.bucketIdentity.includes(":hsa_family:"))!.usedBefore.amount.toString()).toBe("8750");
    expect(decision.buckets.find(bucket => bucket.bucketIdentity.includes(":hsa_family:"))!.consumedAmount!.isZero()).toBe(true);
    expect(contributionCapacityReadModel(restored).find(row => row.accountId === ids.retirementAccount && row.bucketIdentity.includes(":hsa_individual:"))).toMatchObject({ openingUsage: "4500", remaining: "1000" });
    expect(deriveStatements(compiled.value.openingState, [], USD).netWorth.amount.toString()).toBe("150000");
    expect(deriveStatements(compiled.value.openingState, [], USD).income.isZero()).toBe(true);
  });
  it("cannot attest complete history while an inactive supported account lacks a scope", () => {
    const model = fixtureFields(workplace(), "Account", "account_id", ids.brokerageAccount, { account_type: "traditional_401k", tax_treatment: "tax_deferred" });
    expect(() => authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] })).toThrow("OPENING_USAGE_SCOPE_REQUIRED");
    const represented = authorHistoricalContributionScope(model, { id: id(80), investmentId: ids.brokerageInvestment, planKey: "former-employer", facts: { taxYear: 2026, ageAtYearEnd: 50, eligiblePlanCompensation: "100000", planHasRoth: true, priorYearSponsorWages: "100000" } });
    expect(openingContributionOptions(represented).filter(option => option.investmentId === ids.brokerageInvestment).map(option => option.character)).toEqual(["traditional_401k", "after_tax_401k", "employer_401k"]);
    const confirmed = authorOpeningContributionUsage(represented, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] });
    expect(compileOpeningContributionUsage(confirmed, "2026-07-01").contributions).toEqual({});
    const incomplete = authorHistoricalContributionScope(model, { id: id(80), investmentId: ids.brokerageInvestment, planKey: "former-employer", facts: { taxYear: 2026 } });
    expect(() => authorOpeningContributionUsage(incomplete, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] })).toThrow("OPENING_USAGE_SCOPE_INCOMPLETE");
  });
  it("requires fresh confirmation for a new historical path even when its buckets were already confirmed", () => {
    const initial = authorOpeningContributionUsage(workplace(), { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] });
    let model = fixtureFields(initial, "Account", "account_id", ids.brokerageAccount, { account_type: "traditional_401k", tax_treatment: "tax_deferred" });
    model = authorHistoricalContributionScope(model, { id: id(81), investmentId: ids.brokerageInvestment, planKey: "sponsor", facts: { taxYear: 2026, ageAtYearEnd: 50, eligiblePlanCompensation: "100000", planHasRoth: true, priorYearSponsorWages: "100000" } });
    expect(() => compileOpeningContributionUsage(model, "2026-07-01")).toThrow("OPENING_CONTRIBUTION_USAGE_REQUIRED");
    model = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [{ id: id(82), investmentId: ids.brokerageInvestment, character: "traditional_401k", amount: "1000", ordinaryAmount: "1000" }] });
    expect(contributionCapacityReadModel(model).filter(row => row.bucketIdentity.includes(":401k_elective:")).every(row => row.openingUsage === "1000")).toBe(true);
  });
  it("shares prior elective usage across two paths and keeps opening facts out of forecast economics", () => {
    let model = workplace();
    model = fixtureFields(model, "Account", "account_id", ids.brokerageAccount, { account_type: "roth_401k", tax_treatment: "tax_free" });
    model = authorPayrollContributionPlan(model, { primitiveId: id(5), investmentId: ids.brokerageInvestment, incomeId: ids.income, character: "roth_401k", priority: 20, calculation: { kind: "fixed", amount: "1000" }, planKey: "sponsor", vestedFraction: "1", excessPolicy: "auto_cap", facts: { taxYear: 2026, ageAtYearEnd: 50, eligiblePlanCompensation: "100000", planHasRoth: true, priorYearSponsorWages: "100000" } });
    model = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [
      { id: id(6), investmentId: ids.retirementInvestment, character: "traditional_401k", amount: "20000", ordinaryAmount: "20000" },
      { id: id(7), investmentId: ids.brokerageInvestment, character: "roth_401k", amount: "12000", ordinaryAmount: "4500" },
      { id: id(8), investmentId: ids.retirementInvestment, character: "employer_401k", amount: "10000" },
      { id: id(9), investmentId: ids.retirementInvestment, character: "after_tax_401k", amount: "1000" },
    ] });
    const restored = importPersonalModelJson(exportPersonalModelJson(model));
    expect(savedOpeningContributionUsage(restored)).toEqual(savedOpeningContributionUsage(model));
    const usage = compileOpeningContributionUsage(restored, "2026-07-01");
    const opening = createAuthoritativeState({ ...payrollOpeningBalances(restored, durablePayrollAllocations(restored)), contributions: usage.contributions });
    expect(deriveStatements(opening, [], USD).income.isZero()).toBe(true);
    expect(deriveStatements(opening, [], USD).operatingCashFlow.isZero()).toBe(true);
    expect(deriveStatements(opening, [], USD).netWorth.amount.toString()).toBe("150000");
    const context = createRunContext({ runId: runId(id(10)), scenarioId: scenarioId(ids.rootScenario), asOf: instant("2026-07-01T00:00:00.000Z"), dataCutoff: instant("2026-07-01T00:00:00.000Z"), simulationStart: instant("2026-07-01T00:00:00.000Z"), simulationEnd: instant("2026-08-01T00:00:00.000Z"), baseCurrency: USD });
    const kernel = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), executionMonths: 1, scenarioIdentity: context.scenarioId, scenarioBindings: {}, standaloneAssets: [], participants: [createWorkplaceEventParticipant([])] }, context.simulationStart);
    const result = runHouseholdKernel({ kernel, runContext: context });
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.statements.income.isZero()).toBe(true);
    const replay = restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(result));
    expect(runHouseholdKernel({ kernel: replay.replay.kernel, runContext: replay.replay.runContext }).state.contributions).toEqual(opening.contributions);
    const roth = durablePayrollAllocations(restored).find(item => item.allocation.policy.character === "roth_401k")!.allocation;
    const at = instant("2026-07-15T00:00:00.000Z"), decision = decideContribution(opening, roth.policy, roth.accountId, at, money("1000"));
    expect(decision.accepted.amount.toString()).toBe("500");
    const committed = recordContribution(opening, roth.policy, roth.accountId, "forecast:roth", at, decision);
    expect(decision.buckets.find(bucket => bucket.bucketIdentity.includes(":401k_additions:"))!.consumedAmount!.isZero()).toBe(true);
    const rows = contributionCapacityReadModel(restored, committed).filter(row => row.bucketIdentity.includes(":401k_elective:"));
    expect(rows.every(row => row.openingUsage === "32000" && row.forecastUsage === "500" && row.yearToDate === "32500" && row.remaining === "0")).toBe(true);
    expect(compileCashFlow(restored, cashRequest("2026-07-01")).status).toBe("compiled");
    expect(compileInvestments(restored, investmentsRequest("2026-07-01")).status).toBe("compiled");
    expect(() => compileOpeningContributionUsage(restored, "2026-08-01")).toThrow("OPENING_CONTRIBUTION_USAGE_REQUIRED");
  });
  it("includes prior Traditional and Roth usage in shared IRA capacity", () => {
    let model = fixtureFields(createGoldenHouseholdDraft(), "Account", "account_id", ids.brokerageAccount, { account_type: "traditional_ira", tax_treatment: "tax_deferred" });
    model = fixtureFields(model, "Account", "account_id", ids.retirementAccount, { account_type: "roth_ira", tax_treatment: "tax_free" });
    const facts = { taxYear: 2026, ageAtYearEnd: 40, taxableCompensation: "100000", filingStatus: "single" as const, rothMagi: "100000", workplacePlanCovered: false, deductionMagi: "100000" };
    for (const [index, investmentId] of [ids.brokerageInvestment, ids.retirementInvestment].entries()) model = authorPersonalPurchasePlan(model, { primitiveId: id(20 + index), investmentId, sourceCashAccountId: ids.checking, amount: "1000", date: "2026-07-15", frequency: "once", order: index, contributionFacts: facts, excessPolicy: "auto_cap" });
    model = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [{ id: id(22), investmentId: ids.brokerageInvestment, character: "traditional_ira", amount: "4000" }, { id: id(23), investmentId: ids.retirementInvestment, character: "roth_ira", amount: "3000" }] });
    const rows = contributionCapacityReadModel(importPersonalModelJson(exportPersonalModelJson(model))).filter(row => row.bucketIdentity.includes(":ira_shared:"));
    expect(rows).toHaveLength(2); expect(rows.every(row => row.openingUsage === "7000" && row.remaining === "500")).toBe(true);
    const compiled = compileInvestments(model, investmentsRequest("2026-07-01"));
    expect(compiled.status).toBe("compiled"); if (compiled.status !== "compiled") throw new Error("IRA compilation failed");
    const purchase = compiled.value.input.purchases.find(item => item.destinationAccountId === ids.brokerageAccount)!;
    expect(purchase.contribution).toBeDefined();
    const decision = decideContribution(compiled.value.openingState, purchase.contribution!, ids.brokerageAccount, instant("2026-07-15T00:00:00.000Z"), money("1000"));
    expect(decision.accepted.amount.toString()).toBe("500");
  });
  it("shares prior HSA employee/employer usage without creating a second balance", () => {
    let model = fixtureFields(createGoldenHouseholdDraft(), "Account", "account_id", ids.retirementAccount, { account_type: "hsa_investment", tax_treatment: "tax_free" });
    model = authorPayrollContributionPlan(model, { primitiveId: id(30), investmentId: ids.retirementInvestment, incomeId: ids.income, character: "employee_hsa", priority: 10, calculation: { kind: "fixed", amount: "1000" }, vestedFraction: "1", excessPolicy: "auto_cap", facts: { taxYear: 2026, ageAtYearEnd: 55, hsaCoverage: "family", hsaFullYearEligible: true, hsaFamilyAllocation: "8750" } });
    model = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [{ id: id(31), investmentId: ids.retirementInvestment, character: "employee_hsa", amount: "8000", ordinaryAmount: "8000" }, { id: id(32), investmentId: ids.retirementInvestment, character: "employer_hsa", amount: "1000", ordinaryAmount: "750" }] });
    const usage = compileOpeningContributionUsage(model, "2026-07-01"), opening = createAuthoritativeState({ ...payrollOpeningBalances(model, durablePayrollAllocations(model)), contributions: usage.contributions });
    const allocation = durablePayrollAllocations(model)[0]!.allocation;
    const decision = decideContribution(opening, allocation.policy, allocation.accountId, instant("2026-07-15T00:00:00.000Z"), money("1000"));
    expect(decision.accepted.amount.toString()).toBe("750");
    expect(decision.buckets.find(bucket => bucket.bucketIdentity.includes(":hsa_family:"))!.consumedAmount!.isZero()).toBe(true);
    expect(deriveStatements(opening, [], USD).netWorth.amount.toString()).toBe("100000");
  });
  it("gates a mid-year forecast with unknown usage and permits an explicit zero attestation", () => {
    const model = workplace();
    expect(() => compileOpeningContributionUsage(model, "2026-07-01")).toThrow("OPENING_CONTRIBUTION_USAGE_REQUIRED");
    expect(compileCashFlow(model, cashRequest("2026-07-01")).status).toBe("unsupported");
    expect(compileInvestments(model, investmentsRequest("2026-07-01")).status).toBe("unsupported");
    expect(contributionCapacityReadModel(model).every(row => row.yearToDate === undefined && row.remaining === undefined && row.diagnostics.length > 0)).toBe(true);
    expect(compileOpeningContributionUsage(model, "2026-01-01").contributions).toEqual({});
    const confirmed = authorOpeningContributionUsage(model, { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [] });
    expect(compileOpeningContributionUsage(confirmed, "2026-07-01").contributions).toEqual({});
    expect(contributionCapacityReadModel(confirmed).every(row => row.openingUsage === "0")).toBe(true);
  });
  it("rejects duplicate imported history identities rather than consuming a contribution twice", () => {
    const entry = { id: id(40), investmentId: ids.retirementInvestment, character: "employer_401k" as const, amount: "1000" };
    expect(() => authorOpeningContributionUsage(workplace(), { asOf: "2026-07-01", allPriorUsageKnown: true, entries: [entry, entry] })).toThrow("OPENING_USAGE_DUPLICATE_IDENTITY");
  });
});
