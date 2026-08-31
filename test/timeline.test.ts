import { describe, expect, it } from "vitest";
import { type AccountId } from "../src/accounting/index.js";
import { issueCodes, validationIssue } from "../src/diagnostics/index.js";
import { domainId, generatedOccurrenceKey, uuid } from "../src/identity/index.js";
import { semanticEffectId } from "../src/semantics/identity.js";
import {
  createAuthoritativeState,
  type AuthoritativeState,
} from "../src/state/index.js";
import {
  createRunContext,
  posting,
  runId,
  runPeriod,
  runTimeline,
  scenarioId,
  type PrimitivePeriodWork,
  type SemanticPeriodWork,
  type TimelinePeriodPlan,
} from "../src/simulation/index.js";
import { instant, utcMonth, type Instant, type Period } from "../src/time/index.js";
import { money, USD } from "../src/values/index.js";

const CASH = domainId("account", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") as AccountId;
const SCENARIO = scenarioId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const PRIMITIVE = domainId("primitive-instance", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const TARGET = uuid("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const horizonStart = utcMonth(2026, 1).start;
const horizonEnd = utcMonth(2026, 12).end;

const context = (start = horizonStart, end = horizonEnd) => createRunContext({
  runId: runId("11111111-1111-4111-8111-111111111111"),
  scenarioId: SCENARIO,
  asOf: instant("2025-12-31T00:00:00.000Z"),
  dataCutoff: instant("2025-12-31T00:00:00.000Z"),
  simulationStart: start,
  simulationEnd: end,
  baseCurrency: USD,
});

const openingState = (cash = "0"): AuthoritativeState => createAuthoritativeState({
  accounts: { [CASH]: { id: CASH, kind: "checking", cash: money(cash) } },
});

const monthPlans = (work: (target: Period, index: number) => TimelinePeriodPlan["work"]): TimelinePeriodPlan[] =>
  Array.from({ length: 12 }, (_, index) => {
    const target = utcMonth(2026, index + 1);
    return { period: target, work: work(target, index) };
  });

const incomeWork = (id: string, at: Instant, amount = "100"): SemanticPeriodWork => ({
  kind: "semantic",
  id,
  at,
  effect: {
    id: semanticEffectId(`effect:${id}`),
    kind: "recognition",
    category: "synthetic_income",
    amount: money(amount),
    occurredAt: at,
  },
  transaction: posting(`transaction:${id}`, at, "synthetic_income", "operating", [
    { posting: "debit", type: "cash", amount: money(amount), accountId: CASH },
    { posting: "credit", type: "income", amount: money(amount) },
  ]),
});

const expenseWork = (id: string, at: Instant, amount: string): SemanticPeriodWork => ({
  kind: "semantic",
  id,
  at,
  effect: {
    id: semanticEffectId(`effect:${id}`),
    kind: "recognition",
    category: "synthetic_expense",
    amount: money(amount),
    occurredAt: at,
  },
  transaction: posting(`transaction:${id}`, at, "synthetic_expense", "operating", [
    { posting: "credit", type: "cash", amount: money(amount), accountId: CASH },
    { posting: "debit", type: "expense", amount: money(amount) },
  ]),
});

const p02Work = (target: Period, occurrenceAt: Instant): PrimitivePeriodWork => ({
  kind: "primitive",
  id: "primitive:one-time",
  request: {
    primitiveId: "P02",
    input: { value: money("25") },
    parameters: { occurrenceAt },
    context: {
      evaluationInstant: target.start,
      scenarioId: SCENARIO,
      primitiveInstanceId: PRIMITIVE,
      economicTargetId: TARGET,
      semanticEffectType: "recognition",
    },
  },
});

describe("multi-period simulation", () => {
  it("commits 12 consecutive periods under one deterministic run envelope", () => {
    const periods = monthPlans((target, index) => [incomeWork(`income:${index}`, target.start)]);
    const first = runTimeline({ runContext: context(), openingState: openingState(), periods });
    const second = runTimeline({ runContext: context(), openingState: openingState(), periods });
    expect(first.status).toBe("completed");
    expect(second).toEqual(first);
    if (first.status !== "completed") return;
    expect(first.periods).toHaveLength(12);
    expect(first.reachedThrough).toBe(horizonEnd);
    expect(first.metadata.simulationStart).toBe(horizonStart);
    expect(first.metadata.simulationEnd).toBe(horizonEnd);
    for (let index = 0; index < first.periods.length; index += 1) {
      const result = first.periods[index]!;
      expect(result.period).toEqual(utcMonth(2026, index + 1));
      expect(result.statements.income.equals(money("100"))).toBe(true);
      expect(result.statements.assets.minus(result.statements.liabilities).equals(result.statements.netWorth)).toBe(true);
      if (index > 0) expect(result.openingState).toEqual(first.periods[index - 1]!.closingState);
    }
    expect(first.periods[11]!.closingState.accounts[CASH]!.cash.equals(money("1200"))).toBe(true);
  });

  it("keeps liquidity shortfall warning nonblocking for all 12 periods", () => {
    const warning = validationIssue({ severity: "warning", code: issueCodes.liquidityShortfall, message: "Synthetic permitted liquidity is insufficient" });
    const periods = monthPlans((target, index) => [
      ...(index === 4 ? [{ kind: "diagnostic" as const, id: "liquidity:shortfall", diagnostics: [warning] }] : []),
      incomeWork(`income:${index}`, target.start, "10"),
    ]);
    const result = runTimeline({ runContext: context(), openingState: openingState(), periods });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.periods).toHaveLength(12);
    expect(result.periods[4]!.diagnostics).toContainEqual(warning);
    expect(result.periods[11]!.closingState.accounts[CASH]!.cash.equals(money("120"))).toBe(true);
    expect(result.periods.every((item) => !item.closingState.accounts[CASH]!.cash.isNegative())).toBe(true);
    expect(Object.keys(result.periods[11]!.closingState.liabilities)).toEqual([]);
    expect(Object.keys(result.periods[11]!.closingState.positions)).toEqual([]);
  });

  it("rolls back a hard middle-period failure and returns only prior commits", () => {
    const periods = monthPlans((target, index) => [
      incomeWork(`income:${index}`, target.start),
      ...(index === 5 ? [expenseWork("overspend", target.start, "1000")] : []),
    ]);
    const result = runTimeline({ runContext: context(), openingState: openingState(), periods });
    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") return;
    expect(result.periods).toHaveLength(5);
    expect(result.stoppedAt).toBe(utcMonth(2026, 6).start);
    expect(result.reachedThrough).toBe(utcMonth(2026, 5).end);
    expect(result.periods.flatMap((item) => item.transactions).some((item) => item.id === "transaction:overspend")).toBe(false);
    expect(result.periods[4]!.closingState.accounts[CASH]!.cash.equals(money("500"))).toBe(true);
    expect(result.reachedThrough).not.toBe(horizonEnd);
  });

  it("classifies a first-period execution failure as incomplete with no commits", () => {
    const periods = monthPlans((target, index) => index === 0 ? [expenseWork("first-failure", target.start, "1")] : []);
    const opening = openingState();
    const before = JSON.stringify(opening);
    const result = runTimeline({ runContext: context(), openingState: opening, periods });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toEqual([]);
    expect(JSON.stringify(opening)).toBe(before);
  });

  it("returns invalid_model for invalid preflight without executing", () => {
    const periods = monthPlans((target, index) => [incomeWork(`income:${index}`, target.start)]);
    const invalid = openingState();
    invalid.accounts[CASH]!.cash = money("-1");
    const result = runTimeline({ runContext: context(), openingState: invalid, periods });
    expect(result.status).toBe("invalid_model");
    expect(result.periods).toEqual([]);
    if (result.status === "invalid_model") expect(result.issues.some((issue) => issue.severity === "error")).toBe(true);
    expect(invalid.identities.generatedOccurrenceKeys).toEqual([]);
  });

  it("rejects primitive execution state that is not backed by authoritative occurrence identity", () => {
    const occurrenceAt = instant("2026-01-15T00:00:00.000Z");
    const occurrenceId = generatedOccurrenceKey({ scenarioId: SCENARIO, primitiveInstanceId: PRIMITIVE, scheduledAt: occurrenceAt, semanticEffectType: "recognition", economicTargetId: TARGET });
    const result = runTimeline({
      runContext: context(),
      openingState: openingState(),
      primitiveState: { [PRIMITIVE]: { primitiveId: "P02", state: { executed: true, occurrenceId } } },
      periods: monthPlans(() => []),
    });
    expect(result.status).toBe("invalid_model");
    if (result.status === "invalid_model") expect(result.issues[0]?.code).toBe(issueCodes.primitiveRuntimeStateInvalid);
  });

  it("commits P02 state only with a successful period and suppresses later execution", () => {
    const occurrenceAt = instant("2026-01-15T00:00:00.000Z");
    const periods = monthPlans((target) => [p02Work(target, occurrenceAt)]);
    const result = runTimeline({ runContext: context(), openingState: openingState(), periods });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const occurrences = result.periods.flatMap((item) => item.primitiveOutputs)
      .flatMap((item) => item.effects as readonly { readonly occurrenceId: string }[]);
    expect(occurrences).toHaveLength(1);
    expect(result.periods[0]!.primitiveState[PRIMITIVE]?.state.executed).toBe(true);
    expect(result.periods[11]!.primitiveState[PRIMITIVE]?.state.occurrenceId).toBe(occurrences[0]!.occurrenceId);
  });

  it("rolls back P02 state and generated identity, then retries with the same identity", () => {
    const target = utcMonth(2026, 1);
    const occurrenceAt = instant("2026-01-15T00:00:00.000Z");
    const opening = openingState();
    const expected = generatedOccurrenceKey({ scenarioId: SCENARIO, primitiveInstanceId: PRIMITIVE, scheduledAt: occurrenceAt, semanticEffectType: "recognition", economicTargetId: TARGET });
    const failed = runTimeline({
      runContext: context(target.start, target.end),
      openingState: opening,
      periods: [{ period: target, work: [
        p02Work(target, occurrenceAt),
        { kind: "diagnostic", id: "z:hard-stop", diagnostics: [validationIssue({ severity: "error", code: "SYNTHETIC_HARD_STOP", message: "later operation failed" })] },
      ] }],
    });
    expect(failed.status).toBe("incomplete");
    expect(opening.identities.generatedOccurrenceKeys).toEqual([]);

    const retried = runPeriod({ period: target, runContext: context(target.start, target.end), openingState: opening, work: [p02Work(target, occurrenceAt)] });
    const occurrence = (retried.primitiveOutputs[0]!.effects[0] as { readonly occurrenceId: string }).occurrenceId;
    expect(occurrence).toBe(expected);
    expect(retried.primitiveState[PRIMITIVE]?.state.executed).toBe(true);
    expect(retried.closingState.identities.generatedOccurrenceKeys).toEqual([expected]);
  });

  it("assigns an occurrence exactly at a shared boundary only to the second period", () => {
    const january = utcMonth(2026, 1);
    const february = utcMonth(2026, 2);
    const runContext = context(january.start, february.end);
    const result = runTimeline({
      runContext,
      openingState: openingState(),
      periods: [
        { period: january, work: [p02Work(january, january.end)] },
        { period: february, work: [p02Work(february, january.end)] },
      ],
    });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.periods[0]!.primitiveOutputs[0]!.effects).toHaveLength(0);
    expect(result.periods[1]!.primitiveOutputs[0]!.effects).toHaveLength(1);
  });

  it.each([
    ["gap", [utcMonth(2026, 1), utcMonth(2026, 3)]],
    ["overlap", [utcMonth(2026, 1), { start: instant("2026-01-15T00:00:00.000Z"), end: utcMonth(2026, 2).end }]],
    ["out of order", [utcMonth(2026, 1), utcMonth(2026, 2), utcMonth(2026, 1)]],
    ["start mismatch", [utcMonth(2026, 2)]],
    ["end mismatch", [utcMonth(2026, 1)]],
  ])("rejects %s period plans before execution", (_name, malformed) => {
    const plans = malformed.map((target) => ({ period: target, work: [] }));
    const result = runTimeline({ runContext: context(horizonStart, horizonEnd), openingState: openingState(), periods: plans });
    expect(result.status).toBe("invalid_model");
    if (result.status === "invalid_model") expect(result.issues[0]?.code).toBe(issueCodes.timelinePeriodPlanInvalid);
  });

  it("uses stable dependency identities instead of caller array order", () => {
    const target = utcMonth(2026, 1);
    const runContext = context(target.start, target.end);
    const left = incomeWork("b-income", target.start, "20");
    const right = incomeWork("a-income", target.start, "10");
    const first = runTimeline({ runContext, openingState: openingState(), periods: [{ period: target, work: [left, right] }] });
    const second = runTimeline({ runContext, openingState: openingState(), periods: [{ period: target, work: [right, left] }] });
    expect(first).toEqual(second);
    if (first.status === "completed") expect(first.periods[0]!.transactions.map((item) => item.id)).toEqual(["transaction:a-income", "transaction:b-income"]);
  });
});
