import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/diagnostics/index.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { CURRENT_RUN_VERSIONS, assumptionId, scenarioEventId, scenarioId } from "../src/model/index.js";
import { applyVerticalSlice3Scenario, applyVerticalSlice4Scenario, compareVerticalSlice3Scenarios, compareVerticalSlice4Scenarios, resolveScenario, type ExecutableScenario, type ScenarioChange } from "../src/simulation/scenario.js";
import { runId } from "../src/simulation/run.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Quantity, Rate, RoundingPolicy, SHARE, USD, money, rateConvention, ratePeriod } from "../src/values/index.js";
import type { InvestmentPurchase, VerticalSlice3Input } from "../src/verticalSlice3.js";
import type { ExtraPrincipalPayment, FixedAmortizingLoan, VerticalSlice4Input } from "../src/verticalSlice4.js";

const rootId = scenarioId("81000000-0000-4000-8000-000000000001");
const middleId = scenarioId("81000000-0000-4000-8000-000000000002");
const leafId = scenarioId("81000000-0000-4000-8000-000000000003");
const assumption = assumptionId("81000000-0000-4000-8000-000000000004");
const event = scenarioEventId("81000000-0000-4000-8000-000000000005");
const start = instant("2026-01-01T00:00:00.000Z");
const horizon = { start, end: utcMonthlyPeriods(start, 2)[1]!.end };
const context = { asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: horizon.end, baseCurrency: USD, versions: CURRENT_RUN_VERSIONS } as const;
const scenario = (id: typeof rootId, changes: readonly ScenarioChange[] = [], baseScenarioId?: typeof rootId): ExecutableScenario => ({ scenarioId: id, name: id, ...(baseScenarioId === undefined ? {} : { baseScenarioId }), horizon, timestep: "monthly", enabled: true, stochastic: false, simulationCount: 1, changes });
const runIds = { [rootId]: runId("82000000-0000-4000-8000-000000000001"), [leafId]: runId("82000000-0000-4000-8000-000000000002") };
const primitive = (n: number) => domainId("primitive-instance", `83000000-0000-4000-8000-${n.toString().padStart(12, "0")}`);
const issue = (fn: () => unknown): string => { try { fn(); } catch (error) { return (error as ValidationError).issues[0]!.code; } throw new Error("Expected validation failure"); };

const owner = domainId("person", "84000000-0000-4000-8000-000000000001");
const household = domainId("household", "84000000-0000-4000-8000-000000000002");
const checking = domainId("account", "84000000-0000-4000-8000-000000000003");
const brokerage = domainId("account", "84000000-0000-4000-8000-000000000004");
const position = domainId("position", "84000000-0000-4000-8000-000000000005");
const purchaseId = domainId("investment-purchase", "84000000-0000-4000-8000-000000000006");
const feeId = domainId("investment-fee", "84000000-0000-4000-8000-000000000007");
const feeRule1 = domainId("tax-rule", "84000000-0000-4000-8000-000000000008");
const feeRule2 = domainId("tax-rule", "84000000-0000-4000-8000-000000000009");
const monthly = (value: string) => Rate.fromDecimal(value, rateConvention.periodic(ratePeriod("1", "calendar_month")));
const returnBasis = { kind: "periodic" as const, period: ratePeriod("1", "calendar_month") };
const priceRounding = RoundingPolicy.currency(2, "half_up");
const quantityRounding = new RoundingPolicy(12, "half_even");
const purchase = (amount: string): InvestmentPurchase => ({ id: purchaseId, sourceCashAccountId: checking, destinationAccountId: brokerage, targetPositionId: position, amount: money(amount), quantityRounding, eligibilitySchedule: { kind: "explicit_instants", instants: [instant("2026-01-31T00:00:00.000Z")] }, executionTiming: "end_of_period", order: 1, schedulePrimitiveId: primitive(amount === "20" ? 1 : 2) });
const input3 = (withFee = false): VerticalSlice3Input => ({ householdId: household, ownerId: owner, baseCurrency: USD, valuationAccountingPolicy: "economic_only", ruleCatalog: [{ id: feeRule1, kind: "fixed_fee", target: { targetType: "account", targetId: checking }, effectiveFrom: start, amount: money("1") }, { id: feeRule2, kind: "fixed_fee", target: { targetType: "account", targetId: checking }, effectiveFrom: start, amount: money("2") }], transfers: [], purchases: [], fees: withFee ? [{ id: feeId, cashAccountId: checking, feeRuleIds: [feeRule1], eligibilitySchedule: { kind: "explicit_instants", instants: [instant("2026-01-30T00:00:00.000Z")] }, executionTiming: "end_of_period", order: 2, schedulePrimitiveId: primitive(3) }] : [], returns: [{ targetPositionId: position, accountId: brokerage, rate: monthly("0"), returnBasis, timing: "end_of_period_on_opening_quantity", priceRounding, primitiveIds: { compounding: primitive(4), markToMarket: primitive(5) } }] });
const opening3 = (cash = "100") => createAuthoritativeState({ accounts: { [checking]: { id: checking, ownerId: owner, kind: "checking", cash: money(cash) }, [brokerage]: { id: brokerage, ownerId: owner, kind: "brokerage", cash: money("0") } }, positions: { [position]: { id: position, accountId: brokerage, quantity: Quantity.parse("10", SHARE), price: money("10"), carryingValue: money("100") } } });

describe("VS3 scenario adapter", () => {
  it("changes deterministic return economics and rejects incompatible rate bases", () => {
    const root = scenario(rootId); const leaf = scenario(leafId, [{ kind: "investment_return", positionId: position, rate: monthly("0.1"), assumptionId: assumption }], rootId);
    const compared = compareVerticalSlice3Scenarios({ scenarios: [leaf, root], baselineScenarioId: rootId, alternativeScenarioIds: [leafId], runIds, runContext: context, openingState: opening3(), input: input3(), months: 2 });
    expect(compared.baseline.points[0]!.metrics.portfolioValue!.equals(money("100"))).toBe(true);
    expect(compared.alternatives[0]!.scenario.points[0]!.metrics.portfolioValue!.equals(money("110"))).toBe(true);
    expect(compared.alternatives[0]!.deltas[0]!.metrics.netWorth!.equals(money("10"))).toBe(true);
    const bad = scenario(leafId, [{ kind: "investment_return", positionId: position, rate: Rate.fromDecimal("0.1", rateConvention.effectiveAnnual()), assumptionId: assumption }], rootId);
    expect(issue(() => applyVerticalSlice3Scenario(input3(), resolveScenario([root, bad], leafId), context))).toBe("SCENARIO_DEFINITION_INVALID");
  });

  it("uses ordinary purchase mechanics and supports add/replace/remove inheritance", () => {
    const add: ScenarioChange = { kind: "investment_purchase", operation: "add", purchaseId, eventId: event, purchase: purchase("20") };
    const replace: ScenarioChange = { kind: "investment_purchase", operation: "replace", purchaseId, eventId: event, purchase: purchase("30") };
    const remove: ScenarioChange = { kind: "investment_purchase", operation: "remove", purchaseId, eventId: event };
    const root = scenario(rootId, [add]); const middle = scenario(middleId, [replace], rootId); const leaf = scenario(leafId, [remove], middleId);
    expect(applyVerticalSlice3Scenario(input3(), resolveScenario([middle, leaf, root], leafId), context).purchases).toHaveLength(0);
    const emptyRoot = scenario(rootId); const replacementWithoutTarget = scenario(leafId, [replace], rootId);
    expect(issue(() => applyVerticalSlice3Scenario(input3(), resolveScenario([emptyRoot, replacementWithoutTarget], leafId), context))).toBe("SCENARIO_OVERLAY_TARGET_NOT_FOUND");
    expect(issue(() => applyVerticalSlice3Scenario({ ...input3(), purchases: [purchase("20")] }, resolveScenario([emptyRoot, scenario(leafId, [add], rootId)], leafId), context))).toBe("SCENARIO_OVERLAY_CONFLICT");
    expect(applyVerticalSlice3Scenario({ ...input3(), purchases: [purchase("20")] }, resolveScenario([emptyRoot, scenario(leafId, [remove], rootId)], leafId), context).purchases).toHaveLength(0);
    const compared = compareVerticalSlice3Scenarios({ scenarios: [root, scenario(leafId, [], rootId)], baselineScenarioId: rootId, alternativeScenarioIds: [leafId], runIds, runContext: context, openingState: opening3(), input: input3(), months: 2 });
    expect(compared.baseline.points[0]!.metrics.contributionPrincipal!.equals(money("20"))).toBe(true);
    expect(compared.baseline.points[0]!.metrics.portfolioValue!.equals(money("120"))).toBe(true);
  });

  it("reports actual fee rules and preserves incomplete alternative status/common prefix", () => {
    const root = scenario(rootId); const leaf = scenario(leafId, [{ kind: "fee_rule_binding", feeId, feeRuleIds: [feeRule2], assumptionId: assumption }], rootId);
    const fees = compareVerticalSlice3Scenarios({ scenarios: [root, leaf], baselineScenarioId: rootId, alternativeScenarioIds: [leafId], runIds, runContext: context, openingState: opening3(), input: input3(true), months: 2 });
    expect(fees.alternatives[0]!.appliedRuleDifferences).toEqual({ baselineOnly: [feeRule1], alternativeOnly: [feeRule2] });
    expect(fees.alternatives[0]!.differences[0]!.configuredRuleIds).toEqual([feeRule1, feeRule2]);
    expect(fees.alternatives[0]!.deltas[0]!.relatedDifferenceIds).toEqual([fees.alternatives[0]!.differences[0]!.differenceId]);

    const added = scenario(leafId, [{ kind: "investment_purchase", operation: "add", purchaseId, eventId: event, purchase: purchase("20") }], rootId);
    const incomplete = compareVerticalSlice3Scenarios({ scenarios: [root, added], baselineScenarioId: rootId, alternativeScenarioIds: [leafId], runIds, runContext: context, openingState: opening3("0"), input: input3(), months: 2 });
    expect(incomplete.alternatives[0]!.scenario.status).toBe("incomplete");
    expect(incomplete.alternatives[0]!.deltas).toHaveLength(0);
    expect(incomplete.alternatives[0]!.comparedThrough).toBeUndefined();
  });
});

const cash2 = domainId("account", "85000000-0000-4000-8000-000000000001");
const principal = domainId("liability", "85000000-0000-4000-8000-000000000002");
const interest = domainId("liability", "85000000-0000-4000-8000-000000000003");
const loanId = domainId("loan-contract", "85000000-0000-4000-8000-000000000004");
const extraId = domainId("extra-principal-payment", "85000000-0000-4000-8000-000000000005");
const paymentAt = instant("2026-01-15T00:00:00.000Z");
const loanPolicy = (accountId = checking) => createFundingPolicy({ id: fundingPolicyId(`loan:${accountId}`), orderedSources: [{ kind: "cash_account", accountId }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
const loan = (): FixedAmortizingLoan => ({ id: loanId, ownerId: owner, principalLiabilityId: principal, interestPayableLiabilityId: interest, originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 2, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: paymentAt, invalidDayPolicy: "skip" }, fundingPolicy: loanPolicy(), settlementPriority: 1, extraPrincipalPayments: [], postingRounding: priceRounding, primitiveIds: { schedule: primitive(10), amortization: primitive(11), accrual: primitive(12) } });
const extra = (amount = "25", fundingPolicy = loanPolicy()): ExtraPrincipalPayment => ({ id: extraId, scheduledAt: paymentAt, amount: money(amount), fundingPolicy, primitiveInstanceId: primitive(13) });
const input4 = (): VerticalSlice4Input => ({ householdId: household, ownerId: owner, baseCurrency: USD, loans: [loan()] });
const opening4 = (cash = "200") => createAuthoritativeState({ accounts: { [checking]: { id: checking, ownerId: owner, kind: "checking", cash: money(cash) }, [cash2]: { id: cash2, ownerId: owner, kind: "checking", cash: money("100") } }, liabilities: { [principal]: { id: principal, balance: money("100") }, [interest]: { id: interest, balance: money("0") } } });

describe("VS4 scenario adapter", () => {
  it("changes only explicit extra principal while preserving the loan contract", () => {
    const root = scenario(rootId); const leaf = scenario(leafId, [{ kind: "extra_principal_payment", operation: "add", loanId, paymentId: extraId, eventId: event, payment: extra() }], rootId);
    const before = input4(); const applied = applyVerticalSlice4Scenario(before, resolveScenario([leaf, root], leafId), context);
    expect(applied.loans[0]!.originalPrincipal).toBe(before.loans[0]!.originalPrincipal);
    expect(before.loans[0]!.extraPrincipalPayments).toHaveLength(0);
    const compared = compareVerticalSlice4Scenarios({ scenarios: [root, leaf], baselineScenarioId: rootId, alternativeScenarioIds: [leafId], runIds, runContext: context, openingState: opening4(), input: before, months: 2 });
    expect(compared.baseline.points[0]!.metrics.principalReduction!.equals(money("50"))).toBe(true);
    expect(compared.alternatives[0]!.scenario.points[0]!.metrics.principalReduction!.equals(money("75"))).toBe(true);
    expect(compared.alternatives[0]!.deltas[0]!.metrics.endingPrincipal!.equals(money("-25"))).toBe(true);
  });

  it("preserves declared funding order and never invents funding", () => {
    const ordered = createFundingPolicy({ id: fundingPolicyId("loan:ordered"), orderedSources: [{ kind: "cash_account", accountId: cash2 }, { kind: "cash_account", accountId: checking }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const root = scenario(rootId); const policyLeaf = scenario(leafId, [{ kind: "loan_funding_policy", loanId, fundingPolicy: ordered, assumptionId: assumption }], rootId);
    const applied = applyVerticalSlice4Scenario(input4(), resolveScenario([root, policyLeaf], leafId), context);
    expect(applied.loans[0]!.fundingPolicy.orderedSources.map((source) => source.accountId)).toEqual([cash2, checking]);
    const extraLeaf = scenario(leafId, [{ kind: "extra_principal_payment", operation: "add", loanId, paymentId: extraId, eventId: event, payment: extra("25") }], rootId);
    const result = compareVerticalSlice4Scenarios({ scenarios: [root, extraLeaf], baselineScenarioId: rootId, alternativeScenarioIds: [leafId], runIds, runContext: context, openingState: opening4("50"), input: input4(), months: 2 });
    expect(result.alternatives[0]!.scenario.points[0]!.metrics.principalReduction!.equals(money("50"))).toBe(true);
    expect(result.alternatives[0]!.scenario.diagnostics.some((item) => item.code === "LIQUIDITY_SHORTFALL")).toBe(true);
  });
});
