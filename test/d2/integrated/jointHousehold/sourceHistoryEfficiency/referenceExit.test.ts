import { beforeEach, describe, expect, it } from "vitest";
import { runVerticalSlice4 as referenceVs4 } from "../../../../../src/simulation/r3/referenceVerticalSlice4.js";
import { runVerticalSlice4 } from "../../../../../src/simulation/verticalSlice4.js";
import { registerFixedLoanOriginalProvider, type FixedLoanContractOriginal } from "../../../../../src/simulation/d2/integration/fixedLoanOriginalBridge/source.js";
import { registerHouseholdBankOriginalProvider } from "../../../../../src/simulation/d2/integration/householdBank/index.js";
import { runHouseholdForecastSummary, compileHouseholdKernel, type HouseholdKernelParticipant } from "../../../../../src/simulation/householdExecution.js";
import { compareVerticalSlice4Scenarios, type ExecutableScenario } from "../../../../../src/simulation/scenario.js";
import { runId, scenarioId } from "../../../../../src/simulation/run.js";
import { instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { fixture, reset, control, start } from "../../fixedLoanOriginalBridge/scenario.js";
import { ids, originalFacts } from "../../householdBankAuthority/scenario.js";

const publisherId = "348-independent-reference-exit-lender";
const bankPublisherId = "348-independent-reference-exit-bank";
const january = instant("2026-01-15T00:00:00.000Z");
const february = instant("2026-02-15T00:00:00.000Z");
let contract: FixedLoanContractOriginal;
let withdrawJanuaryOnFebruary = false;
let januaryWithdrawn = false;
let januaryReadsAfterWithdrawal = 0;
let withdrawRun: { baseline: string; alternative: string } | undefined;
let bankReads = 0;
let withdrawOnBankRead: number | undefined;

// Independent dated originals: the second installment is unavailable. A
// publisher may also withdraw January while answering February's own read.
// No forecast result or journal is used to author the $1 installment.
registerFixedLoanOriginalProvider({ publisherId, readOriginals(query) {
  if (query.eventAt === february) {
    januaryWithdrawn ||= withdrawJanuaryOnFebruary;
    return undefined;
  }
  if (query.eventAt !== january || query.reference.contractSourceId !== contract.reference.contractSourceId) return undefined;
  if (query.runId === withdrawRun?.alternative) januaryWithdrawn = true;
  if (januaryWithdrawn && (withdrawRun === undefined || query.runId === withdrawRun.baseline)) {
    januaryReadsAfterWithdrawal++;
    return undefined;
  }
  const revision = { status: "active" as const, revisionId: "original-1",
    publishedAt: instant("2025-01-01T00:00:00.000Z"), knownAt: instant("2025-01-01T00:00:00.000Z"),
    effectiveFrom: instant("2025-01-01T00:00:00.000Z"), effectiveUntil: instant("2030-01-01T00:00:00.000Z") };
  return { version: "fixed-loan-original-inventory/v1", query, completeness: "complete", checkedAt: query.asOf,
    completeThrough: query.dataCutoff, contractHistory: [{ ...revision, original: contract }], paymentHistory: [{ ...revision,
      original: { sourceId: "348-january-installment", contractSourceId: contract.reference.contractSourceId,
        eventAt: january, taxYear: 2026, contractualPayment: money("1"), currentInterest: money("0"),
        interestDue: money("0"), principalDue: money("1"),
        bank: { publisherId: bankPublisherId, sourceId: "348-bank-permission", accountId: ids.bank } } }] };
} });
registerHouseholdBankOriginalProvider({ publisherId: bankPublisherId, readOriginals: query => {
  if (++bankReads === withdrawOnBankRead) januaryWithdrawn = true;
  return { version: "household-bank-original-inventory/v1", publisherId: bankPublisherId, query,
    checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff, completeness: "complete", originals: originalFacts(query) };
} });

function request(months = 2) {
  const base = fixture("student", "growth", 2, months);
  const original = base.input.loans[0]!;
  const reference = { ...original.originalSource!, publisherId };
  contract = { reference, householdId: ids.household, borrowerId: ids.alice, legalOwnerId: ids.alice,
    loanId: original.id, principalLiabilityId: original.principalLiabilityId,
    interestPayableLiabilityId: original.interestPayableLiabilityId, debtFamily: "student", originalPrincipal: money("2"),
    annualRate: original.annualRate, totalPayments: 2, paymentSchedule: original.paymentSchedule };
  return { ...base, input: { ...base.input, loans: [{ ...original, originalSource: reference }] } };
}

beforeEach(() => {
  reset(); withdrawJanuaryOnFebruary = false; januaryWithdrawn = false; januaryReadsAfterWithdrawal = 0;
  withdrawRun = undefined;
  bankReads = 0; withdrawOnBankRead = undefined;
});

describe("#348 independent original-source outward observation", () => {
  it("allows the frozen standalone reference to return an independently available January prefix", () => {
    const result = referenceVs4(request());
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("99"))).toBe(true);
    expect(result.state.liabilities[contract.principalLiabilityId]!.balance.equals(money("1"))).toBe(true);
  });

  it("rejects a withdrawn January original before the frozen standalone reference releases a failed-February prefix", () => {
    const input = request();
    withdrawJanuaryOnFebruary = true;
    expect(() => referenceVs4(input)).toThrow();
    expect(januaryReadsAfterWithdrawal).toBeGreaterThan(0);
  });

  it("qualifies at the lender's own read even when the final BANK read later withdraws the lender original", () => {
    const input = request(1);
    expect(runVerticalSlice4(input).status).toBe("completed");
    expect(bankReads).toBeGreaterThan(1);
    withdrawOnBankRead = bankReads;
    bankReads = 0;
    const result = runVerticalSlice4(input);
    expect(januaryWithdrawn).toBe(true);
    expect(januaryReadsAfterWithdrawal).toBe(0);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("99"))).toBe(true);
    expect(result.state.liabilities[contract.principalLiabilityId]!.balance.equals(money("1"))).toBe(true);
  });

  it("reobserves the committed baseline after evaluating a source-backed alternative", () => {
    const { runContext, openingState, input, months } = request(1);
    const baseline = runContext.scenarioId;
    const alternative = scenarioId("149a0000-0000-4000-8000-000000000080");
    const alternativeRun = runId("149a0000-0000-4000-8000-000000000081");
    const common = { horizon: { start: runContext.simulationStart, end: runContext.simulationEnd },
      timestep: "monthly", enabled: true, stochastic: false, simulationCount: 1, changes: [] } as const;
    const scenarios: readonly ExecutableScenario[] = [
      { ...common, scenarioId: baseline, name: "Baseline" },
      { ...common, scenarioId: alternative, baseScenarioId: baseline, name: "Alternative" },
    ];
    const compare = () => compareVerticalSlice4Scenarios({ scenarios, baselineScenarioId: baseline,
      alternativeScenarioIds: [alternative], runIds: { [baseline]: runContext.runId, [alternative]: alternativeRun },
      runContext, openingState, input, months });
    expect(compare().baseline.status).toBe("completed");
    withdrawRun = { baseline: runContext.runId, alternative: alternativeRun };
    expect(compare).toThrow(/Lender originals unavailable/);
    expect(januaryReadsAfterWithdrawal).toBeGreaterThan(0);
    expect(openingState.accounts[ids.bank]!.cash.equals(money("100"))).toBe(true);
  });

  it("reobserves production summary history after the final performance sink", () => {
    const input = fixture("student", "growth", 1);
    let callbacks = 0;
    expect(() => runHouseholdForecastSummary({ kernel: compileHouseholdKernel(input.compiled, start), runContext: input.runContext }, {
      clock: { now: () => 0 },
      context: { runId: String(input.runContext.runId), dataClassification: "synthetic", modelCounts: {},
        executionLocation: "local_node", cacheState: "not_applicable" },
      sink: { record: () => { callbacks++; control.lenderAvailable = false; } },
    })).toThrow();
    expect(callbacks).toBeGreaterThan(0);
  });

  it("checks originals before giving a custom observer the candidate postings", () => {
    const input = fixture("student", "growth", 1);
    const monthEnd = instant("2026-01-31T00:00:00.000Z");
    let priorPostingObserved = false;
    let withdrawnPostingExposed = false;
    const external: HouseholdKernelParticipant = {
      id: "d2_fsa_cash", version: "synthetic", economicInputs: null,
      prepare: () => ({ id: "d2_fsa_cash", operations: [{
        descriptor: { id: "withdraw-after-installment", domain: "synthetic", sequencingInstant: monthEnd,
          dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: opening => {
          control.lenderAvailable = false;
          return { ...opening, facts: {} };
        },
      }] }),
      observe: (descriptor, _facts, runtime, observation) => {
        if (Object.values(observation?.postingProofs ?? {}).some(proof => proof.registration.kind === "fixed_loan_original")) {
          priorPostingObserved = true;
          withdrawnPostingExposed ||= descriptor.id === "withdraw-after-installment";
        }
        return runtime;
      },
    };
    const result = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(input.compiled, start),
      runContext: input.runContext, participants: [external] });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(0);
    expect(priorPostingObserved).toBe(true);
    expect(withdrawnPostingExposed).toBe(false);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("100"))).toBe(true);
  });
});
