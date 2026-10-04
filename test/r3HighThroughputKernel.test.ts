import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PerformanceRegistry, type PerformanceObserver } from "../src/diagnostics/performance.js";
import type { CompiledHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { domainId } from "../src/identity/index.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { runHouseholdKernel, type HouseholdKernelParticipant, runCompiledHouseholdProjection,
  runHouseholdForecastSummary, replayHouseholdForecastWindow } from "../src/simulation/householdExecution.js";
import { summarizeHouseholdPeriod } from "../src/simulation/r3/forecastSummary.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { runPersonalHouseholdForecast, resolveHouseholdExplanation } from "../src/application/householdProjection.js";
import { createStatementFlowAccumulator, deriveVerticalSliceStatements } from "../src/statements/index.js";
import { createPrimitiveRuntimeStateStore, executePeriodWorkCandidate, updatePrimitiveRuntimeStateStore, type RunPeriodInput } from "../src/simulation/period.js";
import { runPeriod as referencePeriod } from "../src/simulation/r3/referencePeriod.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import type { FixedAmortizingLoan } from "../src/simulation/verticalSlice4.js";
import type { VerticalSlice2Input } from "../src/simulation/verticalSlice2.js";
import { createAuthoritativeState, createIndexedExecutionState, cloneAuthoritativeState, validateAuthoritativeState,
  applyAccountingTransactionAtomically, PersistentStringIndex, activeAuthoritativeClaims, authoritativeClaimHistory } from "../src/state/index.js";
import { authoritativeStateChangesSince, registerAuthoritativeIdentity } from "../src/state/index.js";
import { createObligation, executionSettlementHistory, appendSettlementIdentity, settlementIdentityAppendsSince, normalizeExecutionClaim, materializeClaimLifecycle, assertClaimInvariant } from "../src/semantics/claim.js";
import { instant } from "../src/time/index.js";
import { Quantity, Rate, RoundingPolicy, SHARE, USD, money, rateConvention, ratePeriod } from "../src/values/index.js";

const ids = {
  household: domainId("household", "93000000-0000-4000-8000-000000000001"), owner: domainId("person", "93000000-0000-4000-8000-000000000002"),
  cash: domainId("account", "93000000-0000-4000-8000-000000000003"), payable: domainId("liability", "93000000-0000-4000-8000-000000000004"),
  income: domainId("income", "93000000-0000-4000-8000-000000000005"), position: domainId("position", "93000000-0000-4000-8000-000000000006"),
  expense: domainId("expense", "93000000-0000-4000-8000-000000000017"),
  standaloneAsset: "93000000-0000-4000-8000-000000000012",
  missingPrincipal: domainId("liability", "93000000-0000-4000-8000-000000000009"), missingInterest: domainId("liability", "93000000-0000-4000-8000-000000000010"), loan: domainId("loan-contract", "93000000-0000-4000-8000-000000000011"),
  secondPrincipal: domainId("liability", "93000000-0000-4000-8000-000000000014"), secondInterest: domainId("liability", "93000000-0000-4000-8000-000000000015"), secondLoan: domainId("loan-contract", "93000000-0000-4000-8000-000000000016"),
  savings: domainId("account", "93000000-0000-4000-8000-000000000019"), transfer: domainId("transfer", "93000000-0000-4000-8000-000000000020"),
};
const scenario = "93000000-0000-4000-8000-000000000007";
const start = instant("2026-01-01T00:00:00.000Z"); const end = instant("2026-02-01T00:00:00.000Z");
const primitive = (suffix: string) => domainId("primitive-instance", `93000000-0000-4000-8001-${suffix.padStart(12, "0")}`);
const cashFlow: VerticalSlice2Input = { householdId: ids.household, ownerId: ids.owner, cashAccountId: ids.cash, expensePayableLiabilityId: ids.payable, baseCurrency: USD, sameInstantCashFlowOrder: "income_before_expense", expenses: [], events: [], incomes: [{ id: ids.income, ownerId: ids.owner, depositAccountId: ids.cash, baseMonthlyAmount: money("100"), start, recurrence: { kind: "utc_monthly", anchor: instant("2026-01-15T00:00:00.000Z"), invalidDayPolicy: "skip" }, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: instant("2026-01-15T00:00:00.000Z"), primitiveIds: { growth: primitive("1"), recurrence: primitive("2") } }] };
const opening = () => createAuthoritativeState({ accounts: { [ids.cash]: { id: ids.cash, kind: "brokerage", ownerId: ids.owner, cash: money("10") } }, positions: { [ids.position]: { id: ids.position, accountId: ids.cash, quantity: Quantity.parse("5", SHARE), price: money("10"), carryingValue: money("50") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } });
const context = (months = 1) => createRunContext({ runId: runId("93000000-0000-4000-8000-000000000008"), scenarioId: scenarioId(scenario), asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: months === 1 ? end : instant("2026-03-01T00:00:00.000Z"), baseCurrency: USD });
const compiled = (lateFailure = false, withAsset = false): CompiledHouseholdProjection => ({ cashFlowInput: cashFlow, ...(lateFailure ? { liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [{ id: ids.loan, principalLiabilityId: ids.missingPrincipal, interestPayableLiabilityId: ids.missingInterest, primitiveIds: { schedule: primitive("20"), amortization: primitive("21"), accrual: primitive("22") } } as never] } } : {}), reconciledOpeningState: opening(), reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), standaloneAssets: withAsset ? [{ id: ids.standaloneAsset, value: money("7") }] : [], scenarioIdentity: scenario, executionMonths: 1, contentionPolicy: { id: "pr20-order", version: "1", rules: [] }, diagnostics: [], scenarioBindings: { cashFlow: { incomeIds: {}, expenseIds: {}, accountIds: {}, retirementEvents: {} } } });

import { ValidationError } from "../src/diagnostics/index.js";
import { compileHouseholdKernel, applyHouseholdExecutionOverlay } from "../src/simulation/r3/compiledHousehold.js";
import { runCompiledHouseholdProjection as referenceRun } from "../src/simulation/r3/referenceHouseholdExecution.js";
import { firstDependencyOrder, indexReachability } from "../src/simulation/r3/ordering.js";
import { dependencyOrders } from "../src/simulation/r3/referenceOrdering.js";
import { compareReachableStates, createReachableStateCounters } from "../src/simulation/r3/reachableStates.js";
import { indexPreparedOperations, type PreparedHouseholdOperation } from "../src/simulation/r3/operations.js";
import { buildHouseholdScheduledPlan, type HouseholdWorkDescriptor } from "../src/simulation/intraperiodScheduler.js";
import { canonicalSerialize } from "../src/simulation/run.js";
import { calculationTraceId, calculationTraceRef } from "../src/lineage/index.js";
import { createGoldenHouseholdDraft, createGoldenHouseholdForecastRequest } from "../src/application/index.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";

const descriptor = (id: string, dependsOn: readonly string[] = []): HouseholdWorkDescriptor => ({
  id, domain: "synthetic", operationClass: "synthetic:noop", sequencingInstant: start,
  dependsOn, resourceAccesses: [], traceRefs: [],
});

const integrated = (incomeAmount: string, withPolicy = true): CompiledHouseholdProjection => {
  const funding = createFundingPolicy({ id: fundingPolicyId("r3:cash"), orderedSources: [{ kind: "cash_account", accountId: ids.cash }],
    allowPartial: false, insufficientFundsBehavior: "unfunded" });
  const loan: FixedAmortizingLoan = {
    id: ids.loan, ownerId: ids.owner, principalLiabilityId: ids.missingPrincipal,
    interestPayableLiabilityId: ids.missingInterest, originalPrincipal: money("100"),
    annualRate: Rate.fromDecimal("0", rateConvention.nominalAnnual(12)), totalPayments: 2,
    rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12",
    amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none",
    partialPaymentPolicy: "all_or_nothing", paymentSchedule: cashFlow.incomes[0]!.recurrence,
    fundingPolicy: funding, settlementPriority: 1, extraPrincipalPayments: [],
    postingRounding: RoundingPolicy.currency(2, "half_up"),
    primitiveIds: { schedule: primitive("42"), amortization: primitive("43"), accrual: primitive("44") },
  };
  return {
    ...compiled(), cashFlowInput: { ...cashFlow, incomes: [{ ...cashFlow.incomes[0]!, baseMonthlyAmount: money(incomeAmount) }] },
    investmentInput: {
      householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, valuationAccountingPolicy: "economic_only",
      ruleCatalog: [], transfers: [], purchases: [], fees: [],
      returns: [{ targetPositionId: ids.position, accountId: ids.cash,
        rate: Rate.fromDecimal("0.01", rateConvention.periodic(ratePeriod("1", "calendar_month"))),
        returnBasis: { kind: "periodic", period: ratePeriod("1", "calendar_month") },
        timing: "end_of_period_on_opening_quantity", priceRounding: RoundingPolicy.currency(2, "half_up"),
        primitiveIds: { compounding: primitive("40"), markToMarket: primitive("41") } }],
    },
    liabilityInput: { householdId: ids.household, ownerId: ids.owner, baseCurrency: USD, loans: [loan] },
    reconciledOpeningState: createAuthoritativeState({ ...opening(), liabilities: {
      [ids.payable]: { id: ids.payable, balance: money("0") },
      [ids.missingPrincipal]: { id: ids.missingPrincipal, balance: money("100") },
      [ids.missingInterest]: { id: ids.missingInterest, balance: money("0") },
    } }),
    contentionPolicy: withPolicy ? { id: "r3-policy", version: "1", rules: [{ before: "cash_income_settlement", after: "liability_required_service" }] } : undefined,
  };
};

describe("R3 reusable deterministic household kernel", () => {
  it("accepts policy-free scarce-funding overlap when a transfer preserves every funding outcome", () => {
    const base = integrated("0", false);
    const at = instant("2026-01-31T23:59:59.999Z");
    const fundingPolicy = createFundingPolicy({ id: fundingPolicyId("r3:conserved-source-group"),
      orderedSources: [{ kind: "cash_account", accountId: ids.cash }, { kind: "cash_account", accountId: ids.savings }],
      allowPartial: false, insufficientFundsBehavior: "unfunded" });
    const input: CompiledHouseholdProjection = {
      ...base, cashFlowInput: undefined,
      reconciledOpeningState: createAuthoritativeState({ ...base.reconciledOpeningState, accounts: {
        [ids.cash]: { ...base.reconciledOpeningState.accounts[ids.cash]!, cash: money("10") },
        [ids.savings]: { id: ids.savings, kind: "savings", ownerId: ids.owner, cash: money("10") },
      } }),
      liabilityInput: { ...base.liabilityInput!, loans: [{ ...base.liabilityInput!.loans[0]!, fundingPolicy,
        paymentSchedule: { kind: "utc_monthly", anchor: at, invalidDayPolicy: "skip" } }] },
      investmentInput: { ...base.investmentInput!, returns: [], transfers: [{
        id: ids.transfer, sourceAccountId: ids.cash, destinationAccountId: ids.savings, amount: money("5"),
        eligibilitySchedule: { kind: "explicit_instants", instants: [at] }, executionTiming: "end_of_period",
        order: 1, schedulePrimitiveId: primitive("950"),
      }] },
    };
    const reference = referenceRun({ compiled: input, runContext: context() });
    const registry = new PerformanceRegistry();
    let tick = 0;
    const actual = runCompiledHouseholdProjection({ compiled: input, runContext: context() }, {
      clock: { now: () => tick++ }, sink: registry,
      context: { runId: "conservation", dataClassification: "synthetic", modelCounts: {},
        executionLocation: "local_node", cacheState: "not_applicable" },
    });
    expect(reference.status).toBe("completed");
    expect(actual).toEqual(reference);
    expect(actual.periods[0]!.liability!.liabilities[0]!.scheduledFundingStatus).toBe("unfunded");
    expect(actual.state.accounts[ids.cash]!.cash).toEqual(money("5"));
    expect(actual.state.accounts[ids.savings]!.cash).toEqual(money("15"));
    expect(actual.periods[0]!.traceRefs.some(ref => ref.traceId.includes("contention-policy"))).toBe(false);
    const counters = registry.latest("engine.schedule_contention")!.resources!.structuralCounters!;
    expect(counters.contentionAnalyticalFundingPoolConservation).toBe(1);
    expect(counters.contentionFallbackInvocations ?? 0).toBe(0);
    // Funded service can consume the transfer's source. The order in which
    // service precedes the transfer then fails, and that failure must retain
    // precedence over an unresolved-contention diagnostic.
    const funded = { ...input, reconciledOpeningState: createAuthoritativeState({ ...input.reconciledOpeningState,
      accounts: { ...input.reconciledOpeningState.accounts,
        [ids.cash]: { ...input.reconciledOpeningState.accounts[ids.cash]!, cash: money("48") } },
    }) };
    const ambiguous = runCompiledHouseholdProjection({ compiled: funded, runContext: context() }, {
      clock: { now: () => tick++ }, sink: registry,
      context: { runId: "funded-allocation", dataClassification: "synthetic", modelCounts: {},
        executionLocation: "local_node", cacheState: "not_applicable" },
    });
    expect(ambiguous).toEqual(referenceRun({ compiled: funded, runContext: context() }));
    expect(ambiguous.status).toBe("incomplete");
    expect(ambiguous.diagnostics.some(issue => issue.code === "HOUSEHOLD_CONTENTION_UNRESOLVED")).toBe(false);
    expect(registry.latest("engine.schedule_contention")!.resources!.structuralCounters!.contentionFallbackInvocations).toBeGreaterThan(0);
  });

  it("merges exact reachable prefixes rather than executing every complete order", () => {
    const items = Array.from({ length: 8 }, (_, i) => descriptor(String(i)));
    const counters = createReachableStateCounters();
    const result = compareReachableStates({ items, edges: [], opening: 0,
      advance: state => state + 1, equivalenceKey: String, terminalSignature: String, counters });
    expect(result.differs).toBe(false);
    expect(result.first).toEqual(items);
    expect(counters.distinctStates).toBe(256);
    expect(counters.terminalOutcomes).toBe(1);
    expect(counters.mergedPrefixes).toBeGreaterThan(0);
  });

  it("proves income/service independence when opening cash guarantees first-source funding", () => {
    for (const annualRate of ["0", "0.12"]) {
      const base = integrated("120", false);
      const input = { ...base, reconciledOpeningState: createAuthoritativeState({ ...base.reconciledOpeningState,
        accounts: { ...base.reconciledOpeningState.accounts,
          [ids.cash]: { ...base.reconciledOpeningState.accounts[ids.cash]!, cash: money("100") } },
      }), liabilityInput: { ...base.liabilityInput!, loans: [{ ...base.liabilityInput!.loans[0]!,
        annualRate: Rate.fromDecimal(annualRate, rateConvention.nominalAnnual(12)) }] } };
      const registry = new PerformanceRegistry();
      let tick = 0;
      const actual = runCompiledHouseholdProjection({ compiled: input, runContext: context() }, {
        clock: { now: () => tick++ }, sink: registry,
        context: { runId: "funding-margin", dataClassification: "synthetic", modelCounts: {},
          executionLocation: "local_node", cacheState: "not_applicable" },
      });
      expect(actual).toEqual(referenceRun({ compiled: input, runContext: context() }));
      expect(actual.status).toBe("completed");
      const counters = registry.latest("engine.schedule_contention")!.resources!.structuralCounters!;
      expect(counters.contentionAnalyticalGuaranteedFirstSource).toBe(1);
      expect(counters.contentionFallbackInvocations ?? 0).toBe(0);
    }
  });

  it("matches exhaustive outcomes for bounded state-dependent contention graphs", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 4, maxLength: 4 }),
      fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }), (amounts, flags) => {
        const items = amounts.map((_, i) => descriptor(String(i)));
        const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] as const;
        const edges = pairs.filter((_, i) => flags[i]).map(([before, after]) => ({ before: String(before), after: String(after) }));
        const advance = (state: { cash: number; accepted: readonly string[] }, item: HouseholdWorkDescriptor) => {
          const amount = amounts[Number(item.id)]!;
          return amount <= state.cash ? { cash: state.cash - amount, accepted: [...state.accepted, item.id].sort() } : state;
        };
        const opening = { cash: 10, accepted: [] as readonly string[] };
        const signatures = [...dependencyOrders(items, edges)].map(order => canonicalSerialize(order.reduce(advance, opening)));
        const result = compareReachableStates({ items, edges, opening, advance,
          equivalenceKey: canonicalSerialize, terminalSignature: canonicalSerialize, counters: createReachableStateCounters() });
        expect(result.differs).toBe(new Set(signatures).size > 1);
        expect(result.first).toEqual(firstDependencyOrder(items, edges));
      }), { numRuns: 32, seed: 68 });
  });

  it("does not hide a hard failure after sensitivity has already been established", () => {
    const items = [descriptor("a"), descriptor("b"), descriptor("c")];
    expect(() => compareReachableStates({ items, edges: [], opening: "",
      advance: (state, item) => {
        if (state === "b" && item.id === "c") throw new Error("late reachable failure");
        return state + item.id;
      }, equivalenceKey: String, terminalSignature: String, counters: createReachableStateCounters(),
    })).toThrow("late reachable failure");
  });

  it("shares persistent history across forks while isolating edits and deletions", () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer()), { maxLength: 60 }), entries => {
      const expected = new Map(entries.map(([key, value]) => [String(key), value]));
      const index = new PersistentStringIndex(entries.map(([key, value]) => [String(key), value] as const));
      const snapshot = [...index.entries()];
      const branch = index.fork();
      for (const key of expected.keys()) if (Number(key) % 2 === 0) { branch.delete(key); expected.delete(key); }
      branch.set("new", 12); expected.set("new", 12);
      const sorted = [...expected].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      expect([...branch.entries()]).toEqual(sorted);
      expect(branch.size).toBe(expected.size);
      sorted.forEach((entry, ordinal) => expect(branch.at(ordinal)).toEqual(entry));
      expect([...index.entries()]).toEqual(snapshot);
    }), { numRuns: 20, seed: 68 });
  });

  it("compares shared state by exact changes without traversing archived history", () => {
    const base = createIndexedExecutionState(createAuthoritativeState({ ...opening(), identities: {
      postedTransactionIds: Array.from({ length: 500 }, (_, i) => `tx:archived:${String(i).padStart(4, "0")}` as never),
    } }));
    const left = cloneAuthoritativeState(base);
    const right = cloneAuthoritativeState(base);
    registerAuthoritativeIdentity(left.identities, "postedTransactionIds", "tx:new:a" as never);
    registerAuthoritativeIdentity(left.identities, "postedTransactionIds", "tx:new:b" as never);
    registerAuthoritativeIdentity(right.identities, "postedTransactionIds", "tx:new:b" as never);
    registerAuthoritativeIdentity(right.identities, "postedTransactionIds", "tx:new:a" as never);
    left.accounts[ids.cash]!.cash = left.accounts[ids.cash]!.cash.plus(money("1"));
    right.accounts[ids.cash]!.cash = money("11");
    let visited = 0;
    const delta = (state: typeof base) => authoritativeStateChangesSince(state, base,
      (a, b) => canonicalSerialize(a) === canonicalSerialize(b), nodes => { visited += nodes; });
    expect(canonicalSerialize(delta(left))).toBe(canonicalSerialize(delta(right)));
    expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
    expect(visited).toBeLessThan(150);
    const changed = cloneAuthoritativeState(right);
    changed.accounts[ids.cash]!.cash = money("12");
    expect(canonicalSerialize(delta(changed))).not.toBe(canonicalSerialize(delta(left)));
  });

  it("reports exact persistent-index changes across insertions, updates, deletion and rotations", () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer()), { maxLength: 40 }), changes => {
      const before = new PersistentStringIndex(Array.from({ length: 20 }, (_, i) => [String(i), i] as const));
      const next = before.fork();
      for (const [key, value] of changes) next.set(String(key), value);
      for (let key = 0; key < 5; key += 1) next.delete(String(key));
      const rebuilt = new Map(before.entries());
      for (const change of next.changesSince(before).changes) {
        if (change.after === undefined) rebuilt.delete(change.key);
        else rebuilt.set(change.key, change.after);
      }
      expect([...rebuilt].sort(([a], [b]) => a.localeCompare(b))).toEqual([...next.entries()].sort(([a], [b]) => a.localeCompare(b)));
    }), { numRuns: 24, seed: 68 });
  });

  it("encodes state deletions separately from canonical set values without comparing absent entries", () => {
    const base = createIndexedExecutionState(opening());
    const deleted = cloneAuthoritativeState(base);
    delete deleted.accounts[ids.cash];
    const equal = (left: unknown, right: unknown): boolean => {
      expect(left).not.toBeUndefined();
      expect(right).not.toBeUndefined();
      return canonicalSerialize(left) === canonicalSerialize(right);
    };
    const delta = authoritativeStateChangesSince(deleted, base, equal) as { accounts: unknown[] };
    expect(delta.accounts).toEqual([{ key: ids.cash, kind: "delete" }]);
    expect(() => canonicalSerialize(delta)).not.toThrow();
    const replaced = cloneAuthoritativeState(base);
    replaced.accounts[ids.cash]!.cash = money("0");
    const setDelta = authoritativeStateChangesSince(replaced, base, equal) as { accounts: unknown[] };
    expect(setDelta.accounts).toEqual([{ key: ids.cash, kind: "set", value: replaced.accounts[ids.cash] }]);
    expect(canonicalSerialize(setDelta)).not.toBe(canonicalSerialize(delta));
    expect((authoritativeStateChangesSince(base, base, equal) as { accounts: unknown[] }).accounts).toEqual([]);
  });

  it("appends unique settlement history through shared roots without copying the preceding entries", () => {
    const counts: Record<string, number> = {};
    const meter = (values: Readonly<Record<string, number>>) => { for (const [key, value] of Object.entries(values)) counts[key] = (counts[key] ?? 0) + value; };
    const empty = executionSettlementHistory([], "history-test", meter);
    let history = empty;
    const expected: typeof history[number][] = [];
    let fork = empty;
    for (let index = 0; index < 128; index += 1) {
      const id = `settlement:${String(index).padStart(4, "0")}` as typeof history[number];
      const previous = history;
      history = appendSettlementIdentity(history, id, "history-test");
      expected.push(id);
      expect(settlementIdentityAppendsSince(history, previous)).toEqual([id]);
      expect(history.includes(id)).toBe(true);
      expect(history.includes(id, history.length)).toBe(false);
      expect(history[index]).toBe(id);
      if (index === 63) fork = history;
    }
    expect([...history]).toEqual(expected);
    expect([...fork]).toEqual(expected.slice(0, 64));
    expect(settlementIdentityAppendsSince(history, fork)).toEqual(expected.slice(64));
    const alternate = appendSettlementIdentity(fork, "settlement:alternate" as never, "history-test");
    expect(alternate.includes(expected[64]!)).toBe(false);
    expect(settlementIdentityAppendsSince(history, alternate)).toBeUndefined();
    expect(() => appendSettlementIdentity(history, expected[0]!, "history-test")).toThrow(ValidationError);
    expect(() => executionSettlementHistory([expected[0]!, expected[0]!], "history-test")).toThrow(ValidationError);
    expect(counts.settlementHistoryAppendEntriesCopied).toBe(0);
    expect(counts.fullClaimHistoryValidationsDuringHotExecution).toBe(0);
    expect(counts.settlementHistoryColdValidations).toBe(1);
    expect(counts.settlementHistoryAppendNodesVisited).toBeLessThan(129 * 20);
  });

  it("keeps settled history duplicate-protected while removing only active claim membership", () => {
    const claim = createObligation({ id: "claim:long-lived" as never, category: "expense_payable",
      originatingRecognitionId: "recognition:long-lived" as never, economicOwnerId: ids.owner,
      balanceEntityId: ids.payable, originalAmount: money("128"), recognizedAt: start });
    let state = createIndexedExecutionState(createAuthoritativeState({ ...opening(), obligations: { [claim.id]: claim } }));
    const original = state;
    for (let index = 0; index < 128; index += 1) {
      state = cloneAuthoritativeState(state);
      const previous = state.obligations[claim.id]!;
      state.obligations[claim.id] = { ...previous, outstandingAmount: previous.outstandingAmount.minus(money("1")),
        settlementIds: appendSettlementIdentity(previous.settlementIds, `settlement:monthly:${index}` as never, claim.id) };
      validateAuthoritativeState(state);
    }
    state = cloneAuthoritativeState(state);
    expect(activeAuthoritativeClaims(state, claim.category, ids.payable)).toHaveLength(0);
    expect(activeAuthoritativeClaims(original, claim.category, ids.payable)).toHaveLength(1);
    expect(() => createObligation({ ...claim, id: "claim:duplicate" as never }, authoritativeClaimHistory(state))).toThrow(ValidationError);
    expect(state.identities.settlementIds).toHaveLength(128);
    const finalClaim = state.obligations[claim.id]!;
    const normalized = normalizeExecutionClaim(finalClaim);
    expect(normalized.settlementIds).toBe(finalClaim.settlementIds);
    assertClaimInvariant(normalized);
    const output = materializeClaimLifecycle(finalClaim);
    expect(output.settlementIds).toEqual(Array.from({ length: 128 }, (_, index) => `settlement:monthly:${index}`));
    expect(Object.isFrozen(output.settlementIds)).toBe(true);
    const other = createObligation({ ...claim, id: "claim:other" as never, originatingRecognitionId: "recognition:other" as never,
      settlementIds: [finalClaim.settlementIds[0]!] });
    expect(() => { state.obligations[other.id] = other; }).toThrow(ValidationError);
  });

  it("preserves canonical settlement order across arbitrary identity ordering and forks", () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 100 }), { maxLength: 40 }), values => {
      let history = executionSettlementHistory([], "property-history");
      const versions = [history];
      const ids = values.map(value => `settlement:property:${value}` as typeof history[number]);
      for (const id of ids) { history = appendSettlementIdentity(history, id, "property-history"); versions.push(history); }
      for (let index = 0; index < versions.length; index += 1) {
        expect([...versions[index]!]).toEqual(ids.slice(0, index));
        expect(settlementIdentityAppendsSince(history, versions[index]!)).toEqual(ids.slice(index));
      }
      expect(history.map(id => id)).toEqual(ids);
      expect(canonicalSerialize(history)).toBe(canonicalSerialize(ids));
    }), { numRuns: 20, seed: 68 });
  });

  it("isolates failed candidates and retains indexed historical claim identities", () => {
    const source = createIndexedExecutionState(opening());
    const failed = cloneAuthoritativeState(source);
    failed.accounts[ids.cash]!.cash = money("-1");
    expect(() => validateAuthoritativeState(failed)).toThrow(ValidationError);
    expect(source.accounts[ids.cash]!.cash).toEqual(money("10"));
    const input = integrated("120");
    const reference = referenceRun({ compiled: input, runContext: context() });
    const branch = cloneAuthoritativeState(source);
    const transaction = reference.periods[0]!.transactions.find(transaction => transaction.type === "income")!;
    applyAccountingTransactionAtomically(branch, transaction);
    expect(source.identities.postedTransactionIds).toHaveLength(0);
    expect(branch.accounts[ids.cash]!.cash).toEqual(money("130"));
    const committed = canonicalSerialize(branch);
    expect(() => applyAccountingTransactionAtomically(branch, transaction)).toThrow(ValidationError);
    expect(canonicalSerialize(branch)).toBe(committed);
    const historical = createIndexedExecutionState(reference.state);
    const claim = Object.values(reference.state.obligations)[0]!;
    expect(activeAuthoritativeClaims(historical, claim.category, claim.balanceEntityId)).toHaveLength(0);
    expect(Object.values(historical.obligations)).toEqual(Object.values(reference.state.obligations)
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    expect(() => createObligation({ ...claim, id: "duplicate-claim" as never }, authoritativeClaimHistory(historical)))
      .toThrow(ValidationError);
  });

  it("does not revisit inactive historical claims while forking candidates", () => {
    const input = integrated("120");
    const reference = referenceRun({ compiled: input, runContext: context() });
    let historyReads = 0;
    const obligations = Object.fromEntries(Object.entries(reference.state.obligations).map(([key, claim]) => [key, {
      ...claim, get outstandingAmount() { historyReads += 1; return claim.outstandingAmount; },
    }]));
    let state = createIndexedExecutionState({ ...reference.state, obligations });
    historyReads = 0;
    for (let count = 0; count < 30; count += 1) state = cloneAuthoritativeState(state);
    expect(historyReads).toBe(0);
    expect(activeAuthoritativeClaims(state, "mortgage_principal_due", ids.missingPrincipal)).toHaveLength(0);
    expect(historyReads).toBe(0);
  });

  it("evaluates primitive work without standalone statements or an opening-state result", () => {
    const request: RunPeriodInput = {
      period: { start, end }, runContext: context(), openingState: opening(),
      work: [{ id: "atomic-interest", kind: "primitive", request: {
        primitiveId: "P24", input: { balance: money("1200"), rate: Rate.fromDecimal("0.12", rateConvention.nominalAnnual(12)) },
        parameters: { temporal: { measurement: "occurrence_based", contractualPeriod: "monthly", rateBasis: "nominal_annual_12",
          calendar: "utc", stubPeriodPolicy: "reject", dayCountConvention: "none", capitalization: "none" },
          postingRounding: RoundingPolicy.currency(2, "half_up") },
        context: { evaluationInstant: start, scenarioId: context().scenarioId, primitiveInstanceId: primitive("900"),
          economicTargetId: ids.payable, semanticEffectType: "interest-accrual" },
      } }],
    };
    const reference = referencePeriod(request);
    const candidate = executePeriodWorkCandidate(request);
    expect(candidate.closingState).toEqual(reference.closingState);
    expect(candidate.primitiveState).toEqual(reference.primitiveState);
    expect(candidate.primitiveOutputs).toEqual(reference.primitiveOutputs);
    expect(candidate.diagnostics).toEqual(reference.diagnostics);
    expect(candidate).not.toHaveProperty("statements");
    expect(candidate).not.toHaveProperty("openingState");
    expect(candidate.primitiveState[primitive("900")]?.primitiveId).toBe("P24");
    expect(request.openingState).toEqual(opening());
    const nextEntry = { primitiveId: "P24" as const, state: { evaluations: 2, lastAccruedAmount: money("12") } };
    const updated = updatePrimitiveRuntimeStateStore(candidate.primitiveState, { [primitive("900")]: nextEntry });
    expect(updated[primitive("900")]).toEqual(nextEntry);
    expect(candidate.primitiveState[primitive("900")]).toEqual(reference.primitiveState[primitive("900")]);
    expect(() => updatePrimitiveRuntimeStateStore(updated, { [primitive("900")]: {
      primitiveId: "P24", state: { evaluations: -1 },
    } })).toThrow(ValidationError);
    expect(updated[primitive("900")]).toEqual(nextEntry);
  });

  it("retains compact metrics and regenerates selected evidence from the same immutable basis", () => {
    const input = { ...integrated("120"), executionMonths: 2 };
    const runContext = context(2);
    const reference = referenceRun({ compiled: input, runContext });
    const registry = new PerformanceRegistry(); let tick = 0;
    const summary = runHouseholdKernel({ kernel: compileHouseholdKernel(input, start), runContext }, {
      clock: { now: () => tick++ }, sink: registry,
      context: { runId: "summary-structure", dataClassification: "synthetic", modelCounts: {}, executionLocation: "local_node", cacheState: "not_applicable" },
    });
    expect(summary.resultTier).toBe("summary");
    const counters = registry.latest("engine.execute")!.resources!.structuralCounters!;
    expect(counters.summaryOperationsExecuted).toBeGreaterThan(0);
    expect(counters.detailedPeriodResultsMaterialized).toBe(0);
    expect(counters.detailedObjectsRetainedBySummary).toBe(0);
    expect(counters.summaryTraceUnionsMaterialized).toBe(0);
    expect(summary.status).toBe("completed");
    expect(summary.state).toEqual(reference.state);
    expect(summary.primitiveState).toEqual(reference.primitiveState);
    expect(summary.runMetadata).toEqual(reference.runMetadata);
    expect(summary.periods).toEqual(reference.periods.map(summarizeHouseholdPeriod));
    for (const period of summary.periods) {
      expect(period).not.toHaveProperty("transactions");
      expect(period).not.toHaveProperty("traceRefs");
      expect(period).not.toHaveProperty("liability");
      expect(period).not.toHaveProperty("openingState");
      expect(period).not.toHaveProperty("closingState");
    }
    const explanation = replayHouseholdForecastWindow(summary, reference.periods[1]!.period);
    expect(explanation.periods).toEqual([reference.periods[1]]);
    expect(explanation.runMetadata).toEqual(summary.runMetadata);
    expect(() => replayHouseholdForecastWindow(summary, { start, end: instant("2026-02-15T00:00:00.000Z") }))
      .toThrow(ValidationError);
    const tampered = { ...summary, runMetadata: { ...summary.runMetadata, inputFingerprint: "changed" as never } };
    expect(() => replayHouseholdForecastWindow(tampered, reference.periods[0]!.period)).toThrow(ValidationError);
  });

  it("streams statement flows without retaining accounting evidence", () => {
    const input = integrated("120");
    const reference = referenceRun({ compiled: input, runContext: context() });
    const period = reference.periods[0]!;
    const accumulator = createStatementFlowAccumulator(USD);
    for (const transaction of period.transactions) accumulator.add(transaction);
    const flows = accumulator.snapshot();
    const legacy = deriveVerticalSliceStatements(reference.state, period.transactions, USD);
    expect(flows.income).toEqual(legacy.income);
    expect(flows.expenses).toEqual(legacy.expenses);
    expect(flows.operatingCashFlow).toEqual(legacy.operatingCashFlow);
    expect(flows.investingCashFlow).toEqual(period.statements.investingCashFlow);
    expect(flows.financingCashFlow).toEqual(period.statements.financingCashFlow);
    expect(flows.gains).toEqual(period.statements.gains);
    expect(Object.keys(accumulator).sort()).toEqual(["add", "merge", "snapshot"]);
  });

  it("reconstructs exact detail from portable opening artifacts without transporting a warehouse", () => {
    const input = { ...integrated("120"), executionMonths: 2 };
    const runContext = context(2);
    const forecast = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(input, start), runContext });
    const artifact = structuredClone(createPortableHouseholdReplayArtifact(forecast));
    const basis = restorePortableHouseholdReplayArtifact(artifact);
    const reference = referenceRun({ compiled: input, runContext });
    const selected = reference.periods[1]!.period;
    expect(replayHouseholdForecastWindow(basis, selected).periods).toEqual([reference.periods[1]]);
    expect(basis.runMetadata).toEqual(forecast.runMetadata);
    expect(basis.periods).toEqual(forecast.periods);
    expect(artifact.encoded).not.toContain('"transactions"');
    expect(artifact.encoded).not.toContain('"recognitions"');
    expect(artifact.encoded).not.toContain('"settlements"');
    expect(artifact.encoded).not.toContain('"effects"');
    const model = createGoldenHouseholdDraft();
    const golden = createGoldenHouseholdForecastRequest();
    const read = runPersonalHouseholdForecast(model, { ...golden, compiler: { ...golden.compiler,
      cashFlow: { ...golden.compiler.cashFlow!, simulationEnd: "2026-02-01", months: 1 },
      investments: { ...golden.compiler.investments!, simulationEnd: "2026-02-01", months: 1 },
      liabilities: { ...golden.compiler.liabilities!, simulationEnd: "2026-02-01", months: 1 },
    } });
    expect(read.status).toBe("completed");
    if (read.status !== "completed") throw new Error("Expected a completed bounded Golden forecast");
    const point = read.points[0]!;
    expect(point.traceIds.some(id => id.startsWith("compiler:canonical:Income:"))).toBe(true);
    expect(point.traceIds.some(id => id.endsWith(":salary-growth-assumption"))).toBe(true);
    const transported = structuredClone(point.traceRefs);
    expect(resolveHouseholdExplanation(model, transported)).toEqual(resolveHouseholdExplanation(model, point.traceRefs));
    const missing = transported.map(({ replayArtifact: _artifact, ...ref }) => ref);
    expect(() => resolveHouseholdExplanation(model, missing)).toThrow(/ARTIFACT_UNAVAILABLE/);
  });

  it("replays a bounded late window from a sparse shared checkpoint", () => {
    const input = { ...compiled(), executionMonths: 13 };
    const runContext = createRunContext({ ...context(), simulationEnd: instant("2027-02-01T00:00:00.000Z") });
    const reference = referenceRun({ compiled: input, runContext });
    const summary = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(input, start), runContext });
    expect(summary.status).toBe("completed");
    expect(summary.periods).toEqual(reference.periods.map(summarizeHouseholdPeriod));
    const registry = new PerformanceRegistry();
    let tick = 0;
    const selectedWindow = reference.periods[12]!.period;
    const explanation = replayHouseholdForecastWindow(summary, selectedWindow, {
      clock: { now: () => tick++ }, sink: registry,
      context: { runId: "sparse-replay", dataClassification: "synthetic", modelCounts: {},
        executionLocation: "local_node", cacheState: "not_applicable" },
    });
    expect(explanation.periods).toEqual([reference.periods[12]]);
    expect(explanation.state).toEqual(reference.state);
    expect(explanation.primitiveState).toEqual(reference.primitiveState);
    expect(explanation.runMetadata).toEqual(reference.runMetadata);
    expect(explanation.requestedHorizon).toEqual(selectedWindow);
    const counters = registry.latest("engine.execute")!.resources!.structuralCounters!;
    expect(counters.replayCheckpointResumes).toBe(1);
    expect(counters.householdPeriodsExecuted).toBe(1);
    expect(counters.replayDetailPeriodsMaterialized).toBe(1);
    // A plain compatibility copy loses optional private roots, but remains
    // reproducible from the same immutable opening basis.
    expect(replayHouseholdForecastWindow({ ...summary }, selectedWindow).periods).toEqual(explanation.periods);
  });

  it("matches the frozen R2 reference, including fingerprint, lineage, accounting and stress outcomes", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 140 }), amount => {
      const input = integrated(String(amount));
      const request = { compiled: input, runContext: context() };
      const actual = runCompiledHouseholdProjection(request);
      const reference = referenceRun(request);
      expect(actual).toEqual(reference);
      expect(actual.status).toBe("completed");
    }), { numRuns: 8, seed: 53 });
  });

  it("matches a bounded Golden Household with all supported domains", () => {
    const request = createGoldenHouseholdForecastRequest();
    const compiler = { ...request.compiler,
      cashFlow: { ...request.compiler.cashFlow!, simulationEnd: "2026-02-01", months: 1 },
      investments: { ...request.compiler.investments!, simulationEnd: "2026-02-01", months: 1 },
      liabilities: { ...request.compiler.liabilities!, simulationEnd: "2026-02-01", months: 1 },
    };
    const result = compileHouseholdProjection(createGoldenHouseholdDraft(), compiler);
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") throw new Error("Golden compilation failed");
    const compiledInput = result.value;
    const runContext = createRunContext({ ...context(), scenarioId: scenarioId(compiledInput.scenarioIdentity),
      asOf: instant(request.asOf + "T00:00:00.000Z"), dataCutoff: instant(request.dataCutoff + "T00:00:00.000Z") });
    const actual = runCompiledHouseholdProjection({ compiled: compiledInput, runContext });
    expect(actual).toEqual(referenceRun({ compiled: compiledInput, runContext }));
    expect(actual.status).toBe("completed");
    expect(compiledInput.executionKernel).toBeDefined();
  });

  it("preserves event eligibility and primitive commit frontiers", () => {
    const event = domainId("event", "93000000-0000-4000-8000-000000000070");
    const input = { ...compiled(), cashFlowInput: {
      ...cashFlow,
      incomes: [{ ...cashFlow.incomes[0]!, terminationEventId: event,
        primitiveIds: { ...cashFlow.incomes[0]!.primitiveIds, termination: primitive("70") } }],
      events: [{ id: event, targetId: ids.income, kind: "termination" as const, effectiveAt: instant("2026-01-10T00:00:00.000Z") }],
    } };
    const result = runCompiledHouseholdProjection({ compiled: input, runContext: context() });
    expect(result).toEqual(referenceRun({ compiled: input, runContext: context() }));
    expect(result.status).toBe("completed");
    expect(result.state.accounts[ids.cash]!.cash.equals(money("10"))).toBe(true);
    expect(result.primitiveState[primitive("70")]).toBeDefined();
  });

  it("matches required-service and dependent extra-principal semantics over two bounded periods", () => {
    const input = integrated("120");
    const loan = input.liabilityInput!.loans[0]!;
    const selected = { ...input, executionMonths: 2,
      liabilityInput: { ...input.liabilityInput!, loans: [{ ...loan, extraPrincipalPayments: [{
        id: domainId("extra-principal-payment", "93000000-0000-4000-8000-000000000071"),
        scheduledAt: loan.paymentSchedule.anchor, amount: money("10"),
        fundingPolicy: loan.fundingPolicy, primitiveInstanceId: primitive("71"),
      }] }] },
    };
    const result = runCompiledHouseholdProjection({ compiled: selected, runContext: context(2) });
    expect(result).toEqual(referenceRun({ compiled: selected, runContext: context(2) }));
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.liability!.liabilities[0]!.extraPrincipalPaid.equals(money("10"))).toBe(true);
  });

  it("keeps diagnostic clocks and sinks outside financial control flow", () => {
    const kernel = compileHouseholdKernel(integrated("100"), start);
    const registry = new PerformanceRegistry(); let tick = 0;
    const observer: PerformanceObserver = { clock: { now: () => ++tick }, sink: registry,
      context: { runId: "r3-diagnostics", dataClassification: "synthetic", modelCounts: {},
        executionLocation: "local_node", cacheState: "not_applicable" } };
    const request = { kernel, runContext: context() };
    expect(runHouseholdKernel(request, observer)).toEqual(runHouseholdKernel(request));
    expect(registry.latest("engine.fingerprint")?.availability).toBe("measured");
    expect(runHouseholdKernel(request, { ...observer, clock: { now: () => { throw new Error("clock"); } },
      sink: { record: () => { throw new Error("sink"); } } })).toEqual(runHouseholdKernel(request));
  });

  it("reuses compiled invariants across runs and domain-local overlays without changing result identity", () => {
    const kernel = compileHouseholdKernel(integrated("100"), start);
    const original = canonicalSerialize(kernel.canonicalInputs);
    const first = runHouseholdKernel({ kernel, runContext: context() });
    const again = runHouseholdKernel({ kernel, runContext: context() });
    expect(again).toEqual(first);
    const otherContext = createRunContext({ ...context(), runId: runId("93000000-0000-4000-8000-000000000099") });
    expect(runHouseholdKernel({ kernel, runContext: otherContext }).runMetadata.inputFingerprint).toBe(first.runMetadata.inputFingerprint);
    const overlay = applyHouseholdExecutionOverlay(kernel, {
      cashFlowInput: { ...kernel.cash!.input, incomes: [{ ...kernel.cash!.input.incomes[0]!, baseMonthlyAmount: money("75") }] },
    });
    expect(overlay.cash).not.toBe(kernel.cash);
    expect(overlay.investments).toBe(kernel.investments);
    expect(overlay.liabilities).toBe(kernel.liabilities);
    expect(overlay.horizon).toBe(kernel.horizon);
    expect(overlay.cash!.schedules[0]).toBe(kernel.cash!.schedules[0]);
    const overlaid = runHouseholdKernel({ kernel: overlay, runContext: context() });
    const overlayReference = referenceRun({ compiled: overlay.executable, runContext: context() });
    expect(overlaid.periods).toEqual(overlayReference.periods.map(summarizeHouseholdPeriod));
    expect(overlaid.state).toEqual(overlayReference.state);
    expect(overlaid.primitiveState).toEqual(overlayReference.primitiveState);
    expect(overlaid.runMetadata).toEqual(overlayReference.runMetadata);
    expect(runHouseholdKernel({ kernel: overlay, runContext: context(), resultTier: "detail" })).toEqual(overlayReference);
    expect(overlaid.runMetadata.inputFingerprint).not.toBe(first.runMetadata.inputFingerprint);
    expect(canonicalSerialize(kernel.canonicalInputs)).toBe(original);
    expect(runHouseholdKernel({ kernel, runContext: context() })).toEqual(first);
    const same = applyHouseholdExecutionOverlay(kernel, { scenarioIdentity: kernel.executable.scenarioIdentity });
    expect(same.cash).toBe(kernel.cash);
    expect(same.investments).toBe(kernel.investments);
    expect(same.liabilities).toBe(kernel.liabilities);
  });

  it("snapshots caller configuration and never caches state-sensitive preparation across runs", () => {
    const input = integrated("100");
    const kernel = compileHouseholdKernel(input, start);
    const initial = runHouseholdKernel({ kernel, runContext: context() });
    const raw = input.cashFlowInput!.incomes as unknown as { baseMonthlyAmount: ReturnType<typeof money> }[];
    raw[0]!.baseMonthlyAmount = money("999");
    expect(kernel.cash!.input.incomes[0]!.baseMonthlyAmount.equals(money("100"))).toBe(true);
    expect(runHouseholdKernel({ kernel, runContext: context() })).toEqual(initial);
    const changedOpening = createAuthoritativeState({ ...input.reconciledOpeningState,
      accounts: { [ids.cash]: { ...input.reconciledOpeningState.accounts[ids.cash]!, cash: money("0") } } });
    const changed = applyHouseholdExecutionOverlay(kernel, { reconciledOpeningState: changedOpening });
    expect(changed.cash).toBe(kernel.cash);
    expect(runHouseholdKernel({ kernel: changed, runContext: context(), resultTier: "detail" }))
      .toEqual(referenceRun({ compiled: changed.executable, runContext: context() }));
  });

  it("preserves unresolved contention and exact rollback of identities and primitive runtime", () => {
    const input = integrated("100", false);
    const actual = runCompiledHouseholdProjection({ compiled: input, runContext: context() });
    expect(actual).toEqual(referenceRun({ compiled: input, runContext: context() }));
    expect(actual.status).toBe("incomplete");
    expect(actual.diagnostics.some(issue => issue.code === "HOUSEHOLD_CONTENTION_UNRESOLVED")).toBe(true);
    expect(actual.state).toEqual(input.reconciledOpeningState);
    expect(actual.primitiveState).toEqual(input.reconciledPrimitiveState);
    const invalid = compiled(true);
    expect(runCompiledHouseholdProjection({ compiled: invalid, runContext: context() }))
      .toEqual(referenceRun({ compiled: invalid, runContext: context() }));
  });

  it("retains the preceding monthly commit when later preparation fails", () => {
    const participant: HouseholdKernelParticipant = {
      id: "late-failure", version: "1", economicInputs: { failMonth: 2 },
      prepare: (_context, period) => {
        if (period.start !== start) throw new ValidationError({ severity: "error", code: "R3_TEST_FAILURE",
          message: "Synthetic second period failure", entityType: "household_projection" });
        return { id: "late-failure", operations: [] };
      },
    };
    const oneMonth = runCompiledHouseholdProjection({ compiled: compiled(), runContext: context(), participants: [participant] });
    const result = runCompiledHouseholdProjection({ compiled: { ...compiled(), executionMonths: 2 },
      runContext: context(2), participants: [participant] });
    expect(result.status).toBe("incomplete");
    expect(result.reachedThrough).toBe(end);
    expect(result.periods).toEqual(oneMonth.periods);
    expect(result.state).toEqual(oneMonth.state);
    expect(result.primitiveState).toEqual(oneMonth.primitiveState);
  });

  it("registers additional domains without central dispatch changes and fingerprints their economic inputs", () => {
    const participant = (id: string, economic = 1): HouseholdKernelParticipant => ({
      id, version: "1", economicInputs: { economic },
      prepare: () => ({ id, operations: [{
        descriptor: descriptor(id),
        execute: opening => ({ ...opening, facts: { transactions: [],
          traceRefs: [calculationTraceRef(calculationTraceId("extension:" + id))] } }),
      }] }),
    });
    const a = participant("a"); const b = participant("b");
    const input = { compiled: compiled(), runContext: context() };
    const run = runCompiledHouseholdProjection({ ...input, participants: [a, b] });
    expect(run.status).toBe("completed");
    expect(run.periods[0]!.traceRefs.map(ref => ref.traceId)).toContain("extension:a");
    expect(runCompiledHouseholdProjection({ ...input, participants: [b, a] })).toEqual(run);
    expect(runCompiledHouseholdProjection({ ...input, participants: [participant("a", 2), b] }).runMetadata.inputFingerprint)
      .not.toBe(run.runMetadata.inputFingerprint);
    const duplicate = runCompiledHouseholdProjection({ ...input, participants: [a, a] });
    expect(duplicate.status).toBe("incomplete");
    expect(duplicate.state).toEqual(input.compiled.reconciledOpeningState);
  });

  it("isolates a failed participant's mutable candidate from committed authority", () => {
    const input = compiled();
    const participant: HouseholdKernelParticipant = {
      id: "candidate-failure", version: "1", economicInputs: {},
      prepare: () => ({ id: "candidate-failure", operations: [{
        descriptor: descriptor("candidate-failure"),
        execute: opening => {
          opening.state.accounts[ids.cash]!.cash = money("999");
          throw new ValidationError({ severity: "error", code: "R3_TEST_FAILURE",
            message: "Synthetic candidate failure", entityType: "household_projection" });
        },
      }] }),
    };
    const result = runCompiledHouseholdProjection({ compiled: input, runContext: context(), participants: [participant] });
    expect(result.status).toBe("incomplete");
    expect(result.state).toEqual(input.reconciledOpeningState);
    expect(result.primitiveState).toEqual(input.reconciledPrimitiveState);
  });

  it("dispatches through an index after one registration pass, with no repeated list lookup", () => {
    let reads = 0;
    const operations: PreparedHouseholdOperation<number>[] = Array.from({ length: 12 }, (_, index) => ({
      get descriptor() { reads += 1; return descriptor("operation-" + index); },
      execute: opening => ({ ...opening, facts: index }),
    }));
    const index = indexPreparedOperations([{ id: "synthetic", operations }]);
    expect(index.size).toBe(12);
    const beforeDispatch = reads;
    for (const work of index.descriptors)
      expect(index.execute(work, { state: opening(), primitiveState: createPrimitiveRuntimeStateStore() }, new Map()).facts)
        .toBe(Number(work.id.replace("operation-", "")));
    expect(reads).toBe(beforeDispatch);
    expect(() => index.execute(descriptor("missing"), { state: opening(), primitiveState: createPrimitiveRuntimeStateStore() }, new Map()))
      .toThrow(ValidationError);
  });

  it("matches exhaustive first-order semantics independent of index insertion and detects cycles", () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }), flags => {
      const items = Array.from({ length: 4 }, (_, index) => descriptor(String(index)));
      const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] as const;
      const edges = pairs.filter((_, index) => flags[index]).map(([before, after]) => ({ before: String(before), after: String(after) }));
      // Independent bounded pre-R3 oracle enumerates all permutations before dependency filtering.
      const permutations = (values: readonly HouseholdWorkDescriptor[]): HouseholdWorkDescriptor[][] =>
        values.length === 0 ? [[]] : values.flatMap((value, index) =>
          permutations(values.filter((_, other) => other !== index)).map(rest => [value, ...rest]));
      const expected = permutations(items).filter(order => edges.every(edge =>
        order.findIndex(item => item.id === edge.before) < order.findIndex(item => item.id === edge.after)))[0];
      expect(firstDependencyOrder([...items].reverse(), [...edges].reverse())).toEqual(expected);
      expect([...dependencyOrders([...items].reverse(), edges)][0]).toEqual(expected);
      const reaches = indexReachability(edges);
      for (const edge of edges) expect(reaches(edge.before, edge.after)).toBe(true);
    }), { numRuns: 16, seed: 53 });
    expect(firstDependencyOrder([descriptor("a"), descriptor("b")], [{ before: "a", after: "b" }, { before: "b", after: "a" }])).toBeUndefined();
    expect([...dependencyOrders([descriptor("a"), descriptor("b")], [{ before: "a", after: "b" }, { before: "b", after: "a" }])]).toEqual([]);
    expect(firstDependencyOrder(Array.from({ length: 24 }, (_, index) => descriptor(String(index).padStart(2, "0"))), [])).toHaveLength(24);
  });

  it("supports cross-domain class policies and unchanged canonical fingerprints for reordered economics", () => {
    const a = { ...descriptor("a"), domain: "alpha", operationClass: "alpha:adjust" };
    const b = { ...descriptor("b", ["a"]), domain: "beta", operationClass: "beta:adjust" };
    expect(buildHouseholdScheduledPlan([b, a], { id: "extensions", version: "1",
      rules: [{ before: "alpha:adjust", after: "beta:adjust" }] }).status).toBe("compiled");
    expect(buildHouseholdScheduledPlan([b, a], { id: "extensions", version: "1",
      rules: [{ before: "beta:adjust", after: "alpha:adjust" }] }).status).toBe("invalid_model");
    const original = integrated("100");
    const income = original.cashFlowInput!.incomes[0]!;
    const extra = { ...income, id: domainId("income", "93000000-0000-4000-8000-000000000088"),
      recurrence: { ...income.recurrence, anchor: instant("2026-01-10T00:00:00.000Z") },
      growthBaseAt: instant("2026-01-10T00:00:00.000Z"),
      primitiveIds: { growth: primitive("80"), recurrence: primitive("81") } };
    const left = { ...original, cashFlowInput: { ...original.cashFlowInput!, incomes: [income, extra] } };
    const right = { ...original, cashFlowInput: { ...original.cashFlowInput!, incomes: [extra, income] } };
    const result = runCompiledHouseholdProjection({ compiled: left, runContext: context() });
    expect(runCompiledHouseholdProjection({ compiled: right, runContext: context() })).toEqual(result);
    expect(result).toEqual(referenceRun({ compiled: left, runContext: context() }));
  });
});
