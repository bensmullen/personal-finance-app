import { describe, expect, it } from "vitest";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Quantity, Rate, Ratio, RoundingPolicy, SHARE, USD, money, rateConvention, ratePeriod } from "../src/values/index.js";
import { runVerticalSlice3, type VerticalSlice3Input } from "../src/verticalSlice3.js";
import type { VerticalSlice2Input } from "../src/verticalSlice2.js";

const household = domainId("household", "51000000-0000-4000-8000-000000000001");
const owner = domainId("person", "51000000-0000-4000-8000-000000000002");
const checking = domainId("account", "51000000-0000-4000-8000-000000000003");
const savings = domainId("account", "51000000-0000-4000-8000-000000000004");
const brokerage = domainId("account", "51000000-0000-4000-8000-000000000005");
const reserve = domainId("account", "51000000-0000-4000-8000-000000000006");
const position = domainId("position", "51000000-0000-4000-8000-000000000007");
const position2 = domainId("position", "51000000-0000-4000-8000-000000000008");
const payable = domainId("liability", "51000000-0000-4000-8000-000000000009");
const expenseId = domainId("expense", "51000000-0000-4000-8000-000000000010");
const primitive = (n: number) => domainId("primitive-instance", `52000000-0000-4000-8000-${n.toString().padStart(12, "0")}`);
const start = instant("2026-01-01T00:00:00.000Z");
const at = (day: string) => instant(`2026-01-${day}T00:00:00.000Z`);
const monthlyBasis = { kind: "periodic" as const, period: ratePeriod("1", "calendar_month") };
const monthlyRate = (value: string) => Rate.fromDecimal(value, rateConvention.periodic(ratePeriod("1", "calendar_month")));
const priceRounding = RoundingPolicy.currency(2, "half_up");
const quantityRounding = new RoundingPolicy(12, "half_even");
const feeRule = (id: string, target: typeof checking, amount: string) => ({ id: domainId("tax-rule", id), kind: "fixed_fee" as const, target: { targetType: "account" as const, targetId: target }, effectiveFrom: start, amount: money(amount) });
const validationCode = (action: () => unknown): string | undefined => {
  try { action(); } catch (error) { return error instanceof ValidationError ? error.issues[0]?.code : undefined; }
  return undefined;
};

const context = (months = 1) => {
  const periods = utcMonthlyPeriods(start, months);
  return createRunContext({
    runId: runId("53000000-0000-4000-8000-000000000001"),
    scenarioId: scenarioId("53000000-0000-4000-8000-000000000002"),
    asOf: instant("2025-12-31T00:00:00.000Z"),
    dataCutoff: instant("2025-12-31T00:00:00.000Z"),
    simulationStart: start,
    simulationEnd: periods[periods.length - 1]!.end,
    baseCurrency: USD,
  });
};

const opening = (balances: Partial<Record<"checking" | "savings" | "brokerage" | "reserve", string>> = {}) => createAuthoritativeState({
  accounts: {
    [checking]: { id: checking, ownerId: owner, kind: "checking", cash: money(balances.checking ?? "1000") },
    [savings]: { id: savings, ownerId: owner, kind: "savings", cash: money(balances.savings ?? "500") },
    [brokerage]: { id: brokerage, ownerId: owner, kind: "brokerage", cash: money(balances.brokerage ?? "500") },
    [reserve]: { id: reserve, ownerId: owner, kind: "savings", cash: money(balances.reserve ?? "500") },
  },
  positions: {
    [position]: { id: position, accountId: brokerage, quantity: Quantity.parse("1", SHARE), price: money("10"), carryingValue: money("10") },
    [position2]: { id: position2, accountId: brokerage, quantity: Quantity.parse("1", SHARE), price: money("20"), carryingValue: money("20") },
  },
  liabilities: { [payable]: { id: payable, balance: money("0") } },
});

const returns = () => [
  { targetPositionId: position, accountId: brokerage, rate: monthlyRate("0"), returnBasis: monthlyBasis, timing: "end_of_period_on_opening_quantity" as const, priceRounding, primitiveIds: { compounding: primitive(1), markToMarket: primitive(2) } },
  { targetPositionId: position2, accountId: brokerage, rate: monthlyRate("0"), returnBasis: monthlyBasis, timing: "end_of_period_on_opening_quantity" as const, priceRounding, primitiveIds: { compounding: primitive(3), markToMarket: primitive(4) } },
];

const base = (): VerticalSlice3Input => ({
  householdId: household,
  ownerId: owner,
  baseCurrency: USD,
  valuationAccountingPolicy: "economic_only",
  ruleCatalog: [],
  transfers: [],
  purchases: [],
  fees: [],
  returns: returns(),
});

describe("Vertical Slice 3 semantic hardening", () => {
  it("rejects dormant fee binding defects during initial structural validation", () => {
    const valid = feeRule("54000000-0000-4000-8000-000000000101", checking, "1");
    const missing = domainId("tax-rule", "54000000-0000-4000-8000-000000000102");
    const wrongTarget = feeRule("54000000-0000-4000-8000-000000000103", savings as typeof checking, "1");
    const wrongKind = {
      id: domainId("tax-rule", "54000000-0000-4000-8000-000000000104"), kind: "proportional_income_tax" as const,
      target: { targetType: "person" as const, targetId: owner }, effectiveFrom: start,
      effectiveRate: Ratio.parse("0.2"), postingRounding: RoundingPolicy.currency(2, "half_up"),
    };
    const dormantFee = (ruleIds: readonly typeof valid.id[]) => ({
      id: domainId("investment-fee", "54000000-0000-4000-8000-000000000105"), cashAccountId: checking, feeRuleIds: ruleIds,
      eligibilitySchedule: { kind: "explicit_instants" as const, instants: [instant("2027-01-20T00:00:00.000Z")] },
      executionTiming: "end_of_period" as const, order: 1, schedulePrimitiveId: primitive(90),
    });
    expect(validationCode(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [valid], fees: [dormantFee([missing])] } }))).toBe(issueCodes.ruleReferenceNotFound);
    expect(validationCode(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [wrongKind], fees: [dormantFee([wrongKind.id])] } }))).toBe(issueCodes.ruleTargetMismatch);
    expect(validationCode(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [wrongTarget], fees: [dormantFee([wrongTarget.id])] } }))).toBe(issueCodes.ruleTargetMismatch);
    expect(validationCode(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [valid], fees: [dormantFee([valid.id, valid.id])] } }))).toBe(issueCodes.ruleDefinitionInvalid);
    expect(validationCode(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [valid, { ...valid }], fees: [dormantFee([valid.id])] } }))).toBe(issueCodes.ruleDefinitionInvalid);
  });

  it("defers fee effective-date selection until the scheduled occurrence", () => {
    const futureRule = { ...feeRule("54000000-0000-4000-8000-000000000111", checking, "1"), effectiveFrom: instant("2027-01-01T00:00:00.000Z") };
    const futureFee = {
      id: domainId("investment-fee", "54000000-0000-4000-8000-000000000112"), cashAccountId: checking, feeRuleIds: [futureRule.id],
      eligibilitySchedule: { kind: "explicit_instants" as const, instants: [instant("2027-01-20T00:00:00.000Z")] }, executionTiming: "end_of_period" as const, order: 1, schedulePrimitiveId: primitive(91),
    };
    expect(runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [futureRule], fees: [futureFee] } }).status).toBe("completed");
    const executed = runVerticalSlice3({ runContext: context(13), openingState: opening(), input: { ...base(), ruleCatalog: [futureRule], fees: [futureFee] }, months: 13 });
    expect(executed.status).toBe("completed");
    expect(executed.periods[12]!.ruleApplications[0]?.ruleId).toBe(futureRule.id);

    const inactiveRule = { ...feeRule("54000000-0000-4000-8000-000000000113", checking, "1"), effectiveFrom: instant("2026-02-01T00:00:00.000Z") };
    const januaryFee = { ...futureFee, id: domainId("investment-fee", "54000000-0000-4000-8000-000000000114"), feeRuleIds: [inactiveRule.id], eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("20")] }, schedulePrimitiveId: primitive(92) };
    const inactive = runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [inactiveRule], fees: [januaryFee] } });
    expect(inactive.status).toBe("incomplete");
    expect(inactive.diagnostics.some((issue) => issue.code === issueCodes.ruleNotActive)).toBe(true);

    const overlap = { ...feeRule("54000000-0000-4000-8000-000000000115", checking, "2") };
    const ambiguousFee = { ...januaryFee, id: domainId("investment-fee", "54000000-0000-4000-8000-000000000116"), feeRuleIds: [futureRule.id, overlap.id], schedulePrimitiveId: primitive(93) };
    const activeFutureNow = { ...futureRule, effectiveFrom: start };
    const ambiguous = runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [activeFutureNow, overlap], fees: [ambiguousFee] } });
    expect(ambiguous.status).toBe("incomplete");
    expect(ambiguous.diagnostics.some((issue) => issue.code === issueCodes.ruleAmbiguous)).toBe(true);
  });

  it("rejects zero-valued transfers and purchases but records a waived zero fee", () => {
    const transfer = { id: domainId("transfer", "54000000-0000-4000-8000-000000000001"), sourceAccountId: checking, destinationAccountId: savings, amount: money("0"), eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("20")] }, executionTiming: "end_of_period" as const, order: 1, schedulePrimitiveId: primitive(10) };
    const purchase = { id: domainId("investment-purchase", "54000000-0000-4000-8000-000000000002"), sourceCashAccountId: checking, destinationAccountId: brokerage, targetPositionId: position, amount: money("0"), quantityRounding, eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("20")] }, executionTiming: "end_of_period" as const, order: 1, schedulePrimitiveId: primitive(11) };
    const rule = feeRule("54000000-0000-4000-8000-000000000004", checking, "0");
    const fee = { id: domainId("investment-fee", "54000000-0000-4000-8000-000000000003"), cashAccountId: checking, feeRuleIds: [rule.id], eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("20")] }, executionTiming: "end_of_period" as const, order: 1, schedulePrimitiveId: primitive(12) };
    expect(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), transfers: [transfer] } })).toThrow(/strictly positive/);
    expect(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), purchases: [purchase] } })).toThrow(/strictly positive/);
    const result = runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [rule], fees: [fee] } });
    expect(result.periods[0]!.fees.isZero()).toBe(true);
    expect(result.periods[0]!.ruleApplications).toHaveLength(1);
  });

  it("allows equal order for independent targets and rejects equal order on a shared target", () => {
    const left = { id: domainId("transfer", "54000000-0000-4000-8000-000000000011"), sourceAccountId: checking, destinationAccountId: savings, amount: money("10"), eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("20")] }, executionTiming: "end_of_period" as const, order: 5, schedulePrimitiveId: primitive(20) };
    const right = { id: domainId("transfer", "54000000-0000-4000-8000-000000000012"), sourceAccountId: brokerage, destinationAccountId: reserve, amount: money("10"), eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("20")] }, executionTiming: "end_of_period" as const, order: 5, schedulePrimitiveId: primitive(21) };
    expect(runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), transfers: [left, right] } }).status).toBe("completed");
    const rule = feeRule("54000000-0000-4000-8000-000000000014", checking, "1");
    const conflictingFee = { id: domainId("investment-fee", "54000000-0000-4000-8000-000000000013"), cashAccountId: checking, feeRuleIds: [rule.id], eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("20")] }, executionTiming: "end_of_period" as const, order: 5, schedulePrimitiveId: primitive(22) };
    expect(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), ruleCatalog: [rule], transfers: [left], fees: [conflictingFee] } })).toThrow(/Same-target/);
  });

  it("rejects a mismatched Rate convention before P23 execution", () => {
    const effectiveAnnual = Rate.fromDecimal("0.12", rateConvention.effectiveAnnual());
    const item = returns()[0]!;
    expect(() => runVerticalSlice3({ runContext: context(), openingState: opening(), input: { ...base(), returns: [{ ...item, rate: effectiveAnnual, returnBasis: monthlyBasis }] } })).toThrow(/periodic Rate/);
  });

  it("canonicalizes all VS3 configuration arrays and explicit instants for the input fingerprint", () => {
    const transfers = [
      { id: domainId("transfer", "54000000-0000-4000-8000-000000000021"), sourceAccountId: checking, destinationAccountId: savings, amount: money("10"), eligibilitySchedule: { kind: "explicit_instants" as const, instants: [instant("2026-02-20T00:00:00.000Z"), at("21")] }, executionTiming: "end_of_period" as const, order: 1, schedulePrimitiveId: primitive(30) },
      { id: domainId("transfer", "54000000-0000-4000-8000-000000000022"), sourceAccountId: brokerage, destinationAccountId: reserve, amount: money("10"), eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("22")] }, executionTiming: "end_of_period" as const, order: 1, schedulePrimitiveId: primitive(31) },
    ];
    const purchases = [
      { id: domainId("investment-purchase", "54000000-0000-4000-8000-000000000023"), sourceCashAccountId: savings, destinationAccountId: brokerage, targetPositionId: position, amount: money("10"), quantityRounding, eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("23")] }, executionTiming: "end_of_period" as const, order: 2, schedulePrimitiveId: primitive(32) },
      { id: domainId("investment-purchase", "54000000-0000-4000-8000-000000000024"), sourceCashAccountId: reserve, destinationAccountId: brokerage, targetPositionId: position2, amount: money("20"), quantityRounding, eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("24")] }, executionTiming: "end_of_period" as const, order: 2, schedulePrimitiveId: primitive(33) },
    ];
    const rules = [feeRule("54000000-0000-4000-8000-000000000027", checking, "1"), feeRule("54000000-0000-4000-8000-000000000028", brokerage as typeof checking, "1")];
    const fees = [
      { id: domainId("investment-fee", "54000000-0000-4000-8000-000000000025"), cashAccountId: checking, feeRuleIds: [rules[0]!.id], eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("25")] }, executionTiming: "end_of_period" as const, order: 3, schedulePrimitiveId: primitive(34) },
      { id: domainId("investment-fee", "54000000-0000-4000-8000-000000000026"), cashAccountId: brokerage, feeRuleIds: [rules[1]!.id], eligibilitySchedule: { kind: "explicit_instants" as const, instants: [at("26")] }, executionTiming: "end_of_period" as const, order: 3, schedulePrimitiveId: primitive(35) },
    ];
    const model = { ...base(), ruleCatalog: rules, transfers, purchases, fees, returns: returns() };
    const first = runVerticalSlice3({ runContext: context(2), openingState: opening(), input: model, months: 2 });
    const reversed = runVerticalSlice3({ runContext: context(2), openingState: opening(), input: { ...model, ruleCatalog: [...rules].reverse(), transfers: [...transfers].reverse().map((item) => item.id === transfers[0]!.id ? { ...item, eligibilitySchedule: { ...item.eligibilitySchedule, instants: [...item.eligibilitySchedule.instants].reverse() } } : item), purchases: [...purchases].reverse(), fees: [...fees].reverse(), returns: [...model.returns].reverse() }, months: 2 });
    expect(first.status).toBe("completed");
    expect(reversed.status).toBe("completed");
    expect(first.runMetadata.inputFingerprint).toBe(reversed.runMetadata.inputFingerprint);
    expect(first.state.accounts).toEqual(reversed.state.accounts);
    expect(first.state.positions).toEqual(reversed.state.positions);
  });

  it("surfaces cumulative liquidity warnings and VS2 lineage without using unconfigured cash or liquidating positions", () => {
    const checkingOnly = createFundingPolicy({ id: fundingPolicyId("policy:hardening-checking-only"), orderedSources: [{ kind: "cash_account", accountId: checking }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const cashFlowInput: VerticalSlice2Input = {
      householdId: household,
      ownerId: owner,
      cashAccountId: checking,
      expensePayableLiabilityId: payable,
      baseCurrency: USD,
      incomes: [],
      expenses: [{
        id: expenseId,
        ownerId: owner,
        paymentAccountId: checking,
        payableLiabilityId: payable,
        fundingPolicy: checkingOnly,
        settlementPriority: 1,
        baseMonthlyAmount: money("80"),
        start,
        recurrence: { kind: "utc_monthly", anchor: at("10"), invalidDayPolicy: "skip" },
        inflationRate: monthlyRate("0"),
        inflationBaseAt: at("10"),
        primitiveIds: { indexGrowth: primitive(40), inflationLink: primitive(41), recurrence: primitive(42) },
      }],
      events: [],
    };
    const result = runVerticalSlice3({ runContext: context(), openingState: opening({ checking: "0", savings: "100", brokerage: "100" }), input: { ...base(), cashFlowInput, transfers: [], purchases: [], fees: [] } });
    expect(result.status).toBe("completed");
    expect(result.diagnostics.some((issue) => issue.code === issueCodes.liquidityShortfall)).toBe(true);
    expect(result.periods[0]!.cashFlowPeriod?.diagnostics.some((issue) => issue.code === issueCodes.liquidityShortfall)).toBe(true);
    expect(result.periods[0]!.traceRefs.some((ref) => ref.traceId.startsWith("vs2:"))).toBe(true);
    expect(result.periods[0]!.traceRefs.some((ref) => ref.traceId.includes("vs3:valuation"))).toBe(true);
    expect(result.state.accounts[savings]!.cash.equals(money("100"))).toBe(true);
    expect(result.state.accounts[brokerage]!.cash.equals(money("100"))).toBe(true);
    expect(result.state.positions[position]!.quantity.equals(Quantity.parse("1", SHARE))).toBe(true);
    expect(result.periods[0]!.transactions.some((tx) => /sale|liquidat/i.test(tx.type))).toBe(false);
  });

  it("registers valuation provenance identity and rejects replay of the same generated valuation occurrence", () => {
    const model = base();
    const first = runVerticalSlice3({ runContext: context(), openingState: opening(), input: model });
    expect(first.status).toBe("completed");
    const valuation = first.periods[0]!.effects.find((effect) => effect.kind === "valuation" && effect.sourceOccurrenceKey !== undefined)!;
    expect(valuation.provenance?.factKind).toBe("model_generated");
    if (valuation.provenance?.factKind !== "model_generated") throw new Error("Expected generated valuation provenance");
    expect(valuation.sourceOccurrenceKey).toBe(valuation.provenance.generatedOccurrenceKey);
    expect(first.state.identities.generatedOccurrenceKeys).toContain(valuation.sourceOccurrenceKey);
    const replay = runVerticalSlice3({ runContext: context(), openingState: first.state, primitiveState: first.primitiveState, input: model });
    expect(replay.status).toBe("incomplete");
    expect(replay.diagnostics.some((issue) => issue.code === issueCodes.duplicateGeneratedOccurrence)).toBe(true);
  });
});
