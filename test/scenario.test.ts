import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/diagnostics/index.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, mergeTraceRefs } from "../src/lineage/index.js";
import { CURRENT_RUN_VERSIONS, assumptionId, scenarioEventId, scenarioId } from "../src/model/index.js";
import { compareVerticalSlice2Scenarios, applyVerticalSlice2Scenario, resolveScenario, type ExecutableScenario, type ScenarioChange } from "../src/simulation/scenario.js";
import { createRunContext, runId } from "../src/simulation/run.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Rate, USD, money, rateConvention, ratePeriod } from "../src/values/index.js";
import { runVerticalSlice2, type VerticalSlice2Input } from "../src/verticalSlice2.js";

const ids = {
  root: scenarioId("71000000-0000-4000-8000-000000000001"),
  middle: scenarioId("71000000-0000-4000-8000-000000000002"),
  leaf: scenarioId("71000000-0000-4000-8000-000000000003"),
  other: scenarioId("71000000-0000-4000-8000-000000000004"),
  household: domainId("household", "71000000-0000-4000-8000-000000000010"),
  person: domainId("person", "71000000-0000-4000-8000-000000000011"),
  cash: domainId("account", "71000000-0000-4000-8000-000000000012"),
  payable: domainId("liability", "71000000-0000-4000-8000-000000000013"),
  salary: domainId("income", "71000000-0000-4000-8000-000000000014"),
  pension: domainId("income", "71000000-0000-4000-8000-000000000015"),
  rent: domainId("expense", "71000000-0000-4000-8000-000000000016"),
  retire: domainId("event", "71000000-0000-4000-8000-000000000017"),
  assumption1: assumptionId("71000000-0000-4000-8000-000000000020"),
  assumption2: assumptionId("71000000-0000-4000-8000-000000000021"),
  assumption3: assumptionId("71000000-0000-4000-8000-000000000022"),
  retirementDecision: scenarioEventId("71000000-0000-4000-8000-000000000023"),
};
const primitive = (suffix: number) => domainId("primitive-instance", `72000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`);
const start = instant("2026-01-01T00:00:00.000Z");
const periods = utcMonthlyPeriods(start, 13);
const horizon = Object.freeze({ start, end: periods[12]!.end });
const annual = (value: string) => Rate.fromDecimal(value, rateConvention.effectiveAnnual());
const monthly = (value: string) => Rate.fromDecimal(value, rateConvention.periodic(ratePeriod("1", "calendar_month")));
const policy = createFundingPolicy({ id: fundingPolicyId("scenario:checking"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });

const baseInput = (): VerticalSlice2Input => ({
  householdId: ids.household, ownerId: ids.person, cashAccountId: ids.cash, expensePayableLiabilityId: ids.payable, baseCurrency: USD, sameInstantCashFlowOrder: "income_before_expense",
  incomes: [
    { id: ids.salary, ownerId: ids.person, depositAccountId: ids.cash, baseMonthlyAmount: money("1000"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, growthRate: annual("0"), growthBaseAt: instant("2026-01-15T00:00:00.000Z"), terminationEventId: ids.retire, primitiveIds: { growth: primitive(1), recurrence: primitive(2), termination: primitive(3) } },
    { id: ids.pension, ownerId: ids.person, depositAccountId: ids.cash, baseMonthlyAmount: money("100"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-20T00:00:00.000Z"), invalidDayPolicy: "skip" }, growthRate: annual("0"), growthBaseAt: instant("2026-01-20T00:00:00.000Z"), primitiveIds: { growth: primitive(4), recurrence: primitive(5) } },
  ],
  expenses: [{ id: ids.rent, ownerId: ids.household, paymentAccountId: ids.cash, payableLiabilityId: ids.payable, baseMonthlyAmount: money("100"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-25T00:00:00.000Z"), invalidDayPolicy: "skip" }, inflationRate: annual("0"), inflationBaseAt: instant("2026-01-25T00:00:00.000Z"), fundingPolicy: policy, settlementPriority: 1, primitiveIds: { indexGrowth: primitive(6), inflationLink: primitive(7), recurrence: primitive(8) } }],
  events: [{ id: ids.retire, targetId: ids.salary, kind: "termination", effectiveAt: horizon.end }],
});
const opening = () => createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, ownerId: ids.person, kind: "checking", cash: money("0") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } });
const change = (rate: string, assumption = ids.assumption1): ScenarioChange => ({ kind: "income_growth", incomeId: ids.salary, rate: annual(rate), assumptionId: assumption });
const scenario = (scenarioIdValue: typeof ids.root, changes: readonly ScenarioChange[] = [], baseScenarioId?: typeof ids.root): ExecutableScenario => Object.freeze({ scenarioId: scenarioIdValue, name: scenarioIdValue, ...(baseScenarioId === undefined ? {} : { baseScenarioId }), horizon, timestep: "monthly", enabled: true, stochastic: false, simulationCount: 1, changes: Object.freeze([...changes]) });
const runContext = { asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: horizon.end, baseCurrency: USD, versions: CURRENT_RUN_VERSIONS } as const;
const issue = (fn: () => unknown): string => { try { fn(); } catch (error) { return (error as ValidationError).issues[0]!.code; } throw new Error("Expected validation failure"); };

describe("scenario resolution and VS2 comparison", () => {
  it("resolves root-to-leaf immutably with descendant precedence", () => {
    const root = scenario(ids.root);
    const middle = scenario(ids.middle, [change("0.05")], ids.root);
    const leaf = scenario(ids.leaf, [change("0.1", ids.assumption2)], ids.middle);
    const base = baseInput();
    const applied = applyVerticalSlice2Scenario(base, resolveScenario([leaf, root, middle], ids.leaf), runContext);
    expect(applied.incomes[0]!.growthRate.value.toString()).toBe("0.1");
    expect(base.incomes[0]!.growthRate.value.toString()).toBe("0");
    expect(applied.incomes[0]!.sourceTraceRefs?.flatMap((ref) => ref.assumptionIds ?? [])).toContain(ids.assumption2);
  });

  it("applies only the resolved leaf overlay, independent of overridden ancestor payloads", () => {
    const leaf = scenario(ids.leaf, [change("0.1", ids.assumption2)], ids.root);
    const first = applyVerticalSlice2Scenario(baseInput(), resolveScenario([scenario(ids.root, [change("0.01")]), leaf], ids.leaf), runContext);
    const second = applyVerticalSlice2Scenario(baseInput(), resolveScenario([scenario(ids.root, [change("0.07", ids.assumption3)]), leaf], ids.leaf), runContext);
    expect(first).toEqual(second);
    const context = createRunContext({ ...runContext, runId: runId("73000000-0000-4000-8000-000000000009"), scenarioId: ids.leaf });
    expect(runVerticalSlice2({ runContext: context, openingState: opening(), input: first, months: 13 }).runMetadata.inputFingerprint).toBe(runVerticalSlice2({ runContext: context, openingState: opening(), input: second, months: 13 }).runMetadata.inputFingerprint);
  });

  it("is independent of catalog and independent change-array order", () => {
    const changes = [change("0.05"), { kind: "expense_inflation", expenseId: ids.rent, rate: annual("0.02"), assumptionId: ids.assumption2 } as const];
    const leafA = scenario(ids.leaf, changes, ids.root); const leafB = scenario(ids.leaf, [...changes].reverse(), ids.root); const root = scenario(ids.root);
    const left = applyVerticalSlice2Scenario(baseInput(), resolveScenario([leafA, root], ids.leaf), runContext);
    const right = applyVerticalSlice2Scenario(baseInput(), resolveScenario([root, leafB], ids.leaf), runContext);
    expect(left).toEqual(right);
  });

  it("reports stable definition, reference, cycle, conflict, stochastic, and selection diagnostics", () => {
    const root = scenario(ids.root);
    expect(issue(() => resolveScenario([root, root], ids.root))).toBe("SCENARIO_DEFINITION_INVALID");
    expect(issue(() => resolveScenario([scenario(ids.leaf, [], ids.other)], ids.leaf))).toBe("SCENARIO_REFERENCE_NOT_FOUND");
    const middle = scenario(ids.middle, [], ids.leaf); const leaf = scenario(ids.leaf, [], ids.middle);
    expect(issue(() => resolveScenario([middle, leaf], ids.leaf))).toBe("SCENARIO_INHERITANCE_CYCLE");
    expect(issue(() => resolveScenario([scenario(ids.root, [change("0.01"), change("0.02")])], ids.root))).toBe("SCENARIO_OVERLAY_CONFLICT");
    const disabled: ExecutableScenario = { ...root, enabled: false };
    expect(issue(() => resolveScenario([disabled], ids.root))).toBe("SCENARIO_DEFINITION_INVALID");
    const stochastic: ExecutableScenario = { ...root, stochastic: true };
    expect(issue(() => resolveScenario([stochastic], ids.root))).toBe("SCENARIO_STOCHASTIC_UNSUPPORTED");
    expect(issue(() => resolveScenario([root], ids.root, 2))).toBe("SCENARIO_STOCHASTIC_UNSUPPORTED");
  });

  it("rejects self inheritance, malformed definitions, missing targets, unsupported changes, and backdating", () => {
    const root = scenario(ids.root);
    const self = { ...root, baseScenarioId: ids.root };
    expect(issue(() => resolveScenario([self], ids.root))).toBe("SCENARIO_DEFINITION_INVALID");
    expect(issue(() => resolveScenario([{ ...root, simulationCount: 0 }], ids.root))).toBe("SCENARIO_DEFINITION_INVALID");
    const missing = scenario(ids.leaf, [{ kind: "income_growth", incomeId: domainId("income", "71000000-0000-4000-8000-000000000099"), rate: annual("0.1"), assumptionId: ids.assumption1 }], ids.root);
    expect(issue(() => applyVerticalSlice2Scenario(baseInput(), resolveScenario([root, missing], ids.leaf), runContext))).toBe("SCENARIO_OVERLAY_TARGET_NOT_FOUND");
    const unsupported = scenario(ids.leaf, [{ kind: "investment_return", positionId: domainId("position", "71000000-0000-4000-8000-000000000099"), rate: monthly("0.1"), assumptionId: ids.assumption1 }], ids.root);
    expect(issue(() => applyVerticalSlice2Scenario(baseInput(), resolveScenario([root, unsupported], ids.leaf), runContext))).toBe("SCENARIO_CHANGE_UNSUPPORTED");
    const backdated = scenario(ids.leaf, [{ kind: "retirement_date", targetEventId: ids.retire, eventId: ids.retirementDecision, effectiveAt: instant("2025-12-01T00:00:00.000Z") }], ids.root);
    const state = opening();
    expect(issue(() => applyVerticalSlice2Scenario(baseInput(), resolveScenario([root, backdated], ids.leaf), runContext))).toBe("SCENARIO_DEFINITION_INVALID");
    expect(state.accounts[ids.cash]!.cash.equals(money("0"))).toBe(true);
  });

  it("computes exact income/expense deltas and links only affected lineage", () => {
    const root = scenario(ids.root);
    const leaf = scenario(ids.leaf, [change("0.12"), { kind: "expense_inflation", expenseId: ids.rent, rate: annual("0.12"), assumptionId: ids.assumption2 }], ids.root);
    const result = compareVerticalSlice2Scenarios({ scenarios: [leaf, root], baselineScenarioId: ids.root, alternativeScenarioIds: [ids.leaf], runIds: { [ids.root]: runId("73000000-0000-4000-8000-000000000001"), [ids.leaf]: runId("73000000-0000-4000-8000-000000000002") }, runContext, openingState: opening(), input: baseInput(), months: 13 });
    const comparison = result.alternatives[0]!;
    expect(comparison.scenario.points[12]!.metrics.recognizedIncome!.equals(money("1220"))).toBe(true);
    expect(comparison.deltas[12]!.metrics.recognizedIncome!.equals(money("120"))).toBe(true);
    expect(comparison.scenario.points[12]!.metrics.recognizedExpenses!.equals(money("112"))).toBe(true);
    expect(comparison.deltas[12]!.relatedDifferenceIds).toHaveLength(2);
    expect(result.baseline.metadata.inputFingerprint).not.toBe(comparison.scenario.metadata.inputFingerprint);
  });

  it("moves only the explicitly targeted termination event", () => {
    const root = scenario(ids.root);
    const leaf = scenario(ids.leaf, [{ kind: "retirement_date", targetEventId: ids.retire, eventId: ids.retirementDecision, effectiveAt: instant("2026-06-15T00:00:00.000Z") }], ids.root);
    const result = compareVerticalSlice2Scenarios({ scenarios: [root, leaf], baselineScenarioId: ids.root, alternativeScenarioIds: [ids.leaf], runIds: { [ids.root]: runId("73000000-0000-4000-8000-000000000003"), [ids.leaf]: runId("73000000-0000-4000-8000-000000000004") }, runContext, openingState: opening(), input: baseInput(), months: 13 });
    expect(result.alternatives[0]!.scenario.points[5]!.metrics.recognizedIncome!.equals(money("100"))).toBe(true);
    expect(result.alternatives[0]!.deltas[5]!.metrics.recognizedIncome!.equals(money("-1000"))).toBe(true);
    expect(result.alternatives[0]!.differences[0]!.eventIds).toEqual([ids.retirementDecision]);
  });

  it("unions rule, assumption, and event lineage deterministically", () => {
    const trace = calculationTraceId("shared"); const rule = domainId("tax-rule", "74000000-0000-4000-8000-000000000001");
    const merged = mergeTraceRefs([calculationTraceRef(trace, [rule])], [calculationTraceRef(trace, undefined, [ids.assumption1], [ids.retirementDecision])])!;
    expect(merged).toEqual([calculationTraceRef(trace, [rule], [ids.assumption1], [ids.retirementDecision])]);
  });

  it("rejects incompatible baseline roots and horizons before execution", () => {
    const root = scenario(ids.root); const other = scenario(ids.other);
    expect(issue(() => compareVerticalSlice2Scenarios({ scenarios: [root, other], baselineScenarioId: ids.root, alternativeScenarioIds: [ids.other], runIds: { [ids.root]: runId("75000000-0000-4000-8000-000000000001"), [ids.other]: runId("75000000-0000-4000-8000-000000000002") }, runContext, openingState: opening(), input: baseInput(), months: 13 }))).toBe("SCENARIO_COMPARISON_INCOMPATIBLE");
    const short = { ...scenario(ids.leaf, [], ids.root), horizon: { start, end: periods[11]!.end } };
    expect(issue(() => compareVerticalSlice2Scenarios({ scenarios: [root, short], baselineScenarioId: ids.root, alternativeScenarioIds: [ids.leaf], runIds: { [ids.root]: runId("75000000-0000-4000-8000-000000000003"), [ids.leaf]: runId("75000000-0000-4000-8000-000000000004") }, runContext, openingState: opening(), input: baseInput(), months: 13 }))).toBe("SCENARIO_COMPARISON_INCOMPATIBLE");
  });

  it("keeps economics/fingerprints stable across run IDs and occurrence identity separate across scenarios", () => {
    const root = scenario(ids.root); const leaf = scenario(ids.leaf, [], ids.root); const state = opening();
    const first = compareVerticalSlice2Scenarios({ scenarios: [root, leaf], baselineScenarioId: ids.root, alternativeScenarioIds: [ids.leaf], runIds: { [ids.root]: runId("76000000-0000-4000-8000-000000000001"), [ids.leaf]: runId("76000000-0000-4000-8000-000000000002") }, runContext, openingState: state, input: baseInput(), months: 13 });
    const second = compareVerticalSlice2Scenarios({ scenarios: [leaf, root], baselineScenarioId: ids.root, alternativeScenarioIds: [ids.leaf], runIds: { [ids.root]: runId("76000000-0000-4000-8000-000000000003"), [ids.leaf]: runId("76000000-0000-4000-8000-000000000004") }, runContext, openingState: state, input: baseInput(), months: 13 });
    expect(first.baseline.points.map((point) => point.metrics)).toEqual(second.baseline.points.map((point) => point.metrics));
    expect(first.baseline.metadata.inputFingerprint).toBe(second.baseline.metadata.inputFingerprint);
    expect(state.accounts[ids.cash]!.cash.equals(money("0"))).toBe(true);
    const rootRun = runVerticalSlice2({ runContext: createRunContext({ ...runContext, runId: runId("76000000-0000-4000-8000-000000000005"), scenarioId: ids.root }), openingState: opening(), input: baseInput(), months: 13 });
    const leafRun = runVerticalSlice2({ runContext: createRunContext({ ...runContext, runId: runId("76000000-0000-4000-8000-000000000006"), scenarioId: ids.leaf }), openingState: opening(), input: baseInput(), months: 13 });
    expect(rootRun.periods[0]!.incomeOccurrences[0]!.occurrenceId).not.toBe(leafRun.periods[0]!.incomeOccurrences[0]!.occurrenceId);
  });
});
