import { beforeEach, expect, it } from "vitest";
import { createSyntheticPersonalDraft } from "../../../../../src/application/personalMvp.js";
import type { HouseholdForecastPoint } from "../../../../../src/application/householdProjection.js";
import { householdEvidenceMonth, restoreHouseholdEvidencePoints } from "../../../../../src/application/mortgageChartData.js";
import { calculationTraceId } from "../../../../../src/lineage/index.js";
import { registerFixedLoanOriginalProvider, type FixedLoanContractOriginal } from "../../../../../src/simulation/d2/integration/fixedLoanOriginalBridge/source.js";
import { registerHouseholdBankOriginalProvider } from "../../../../../src/simulation/d2/integration/householdBank/index.js";
import { compileHouseholdKernel, runHouseholdForecastSummary } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { executeForecastWorkerRequest } from "../../../../../ui/forecast/execute.js";
import type { EvidenceWorkerResponse } from "../../../../../ui/forecast/protocol.js";
import { at, control, fixture, principal, reset, start } from "../../fixedLoanOriginalBridge/scenario.js";
import { ids, originalFacts } from "../../householdBankAuthority/scenario.js";

const nestedLender = "348-evidence-nested-lender";
const nestedBank = { publisherId: "348-evidence-nested-bank", sourceId: "nested-bank-permission", accountId: ids.bank };
let nestedContract: FixedLoanContractOriginal | undefined;
const nestedReads = { lender: 0, bank: 0 };
beforeEach(() => {
  reset();
  nestedContract = undefined;
  nestedReads.lender = 0;
  nestedReads.bank = 0;
});
const published = instant("2025-01-01T00:00:00.000Z");
const revision = { status: "active", revisionId: "nested-original-1", publishedAt: published, knownAt: published,
  effectiveFrom: published, effectiveUntil: instant("2030-01-01T00:00:00.000Z") } as const;
registerFixedLoanOriginalProvider({ publisherId: nestedLender, readOriginals(query) {
  if (!nestedContract || query.reference.contractSourceId !== nestedContract.reference.contractSourceId || query.eventAt !== at) return undefined;
  nestedReads.lender++;
  return { version: "fixed-loan-original-inventory/v1", query, completeness: "complete", checkedAt: query.asOf,
    completeThrough: query.dataCutoff, contractHistory: [{ ...revision, original: nestedContract }],
    paymentHistory: [{ ...revision, original: { sourceId: "nested-january-installment", contractSourceId: nestedContract.reference.contractSourceId,
      eventAt: at, taxYear: 2026, contractualPayment: money("1"), currentInterest: money("0"),
      interestDue: money("0"), principalDue: money("1"), bank: nestedBank } }] };
} });
registerHouseholdBankOriginalProvider({ publisherId: nestedBank.publisherId, readOriginals(query) {
  if (query.sourceId !== nestedBank.sourceId) return undefined;
  nestedReads.bank++;
  return { version: "household-bank-original-inventory/v1", publisherId: nestedBank.publisherId, query,
    checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff, completeness: "complete", originals: originalFacts(query) };
} });

function nestedMortgage(request: ReturnType<typeof fixture>): ReturnType<typeof fixture> {
  const loan = request.input.loans[0]!;
  const reference = { ...loan.originalSource!, publisherId: nestedLender, contractSourceId: "nested-mortgage" };
  nestedContract = { reference, householdId: ids.household, borrowerId: ids.alice, legalOwnerId: ids.alice,
    loanId: loan.id, principalLiabilityId: loan.principalLiabilityId, interestPayableLiabilityId: loan.interestPayableLiabilityId,
    debtFamily: "mortgage", originalPrincipal: money("2"), annualRate: loan.annualRate, totalPayments: 2, paymentSchedule: loan.paymentSchedule };
  const input = { ...request.input, loans: [{ ...loan, originalSource: reference }] };
  return { ...request, input, compiled: { ...request.compiled, liabilityInput: input } };
}

function evidence(request = fixture("mortgage", "growth", 2, 1)) {
  const summary = runHouseholdForecastSummary({ kernel: compileHouseholdKernel(request.compiled, start), runContext: request.runContext });
  const basis = createPortableHouseholdReplayArtifact(summary);
  const period = summary.periods[0]!.period;
  const fingerprint = `household:replay:${summary.runMetadata.inputFingerprint}:${period.start}:${period.end}`;
  const amount = (value: string) => ({ amount: value, currency: "USD" });
  const zero = amount("0"), cash = amount("99"), debt = amount("1");
  const point: HouseholdForecastPoint = { periodStart: period.start, periodEnd: period.end,
    cash, investmentValue: zero, assets: cash, totalAssets: cash, liabilities: debt, totalLiabilities: debt,
    netWorth: amount("98"), debtPrincipalReduction: debt, statementIncome: zero, statementExpenses: zero, gains: zero,
    operatingCashFlow: zero, investingCashFlow: zero, financingCashFlow: amount("-1"), investmentContributionPrincipal: zero,
    fees: zero, unrealizedGain: zero, debtBalances: [], liquidityShortfalls: [], traceIds: [fingerprint],
    traceRefs: [{ traceId: calculationTraceId(fingerprint), replayArtifact: { start: period.start, end: period.end } }],
  };
  return { basis, fingerprint, point, selection: { startIndex: 0, liabilityId: String(principal) } };
}

it("reobserves published sources after qualification and cached replay callbacks", () => {
  const { basis, fingerprint, point, selection } = evidence();
  const select = { ...selection, operation: "monthly_evidence" } as const;
  expect(restoreHouseholdEvidencePoints(basis, select, [point], fingerprint)).toHaveLength(1);
  expect(() => restoreHouseholdEvidencePoints(basis, select, [point], fingerprint, undefined, {
    now: () => 0, record() {}, phase: phase => { if (phase === "qualification_validated") control.lenderAvailable = false; },
  })).toThrow();

  control.lenderAvailable = true;
  const restored = restorePortableHouseholdReplayArtifact(basis);
  const replayMonth = (phase?: (name: string) => void) => householdEvidenceMonth(restored, point.periodStart, point.periodEnd,
    { now: () => 0, record() {}, phase: name => phase?.(name) });
  expect(replayMonth()).toHaveLength(1);
  expect(() => replayMonth(phase => { if (phase === "replay_cached") control.lenderAvailable = false; })).toThrow();
});

it.each([
  ["monthly_evidence", "issuer"],
  ["monthly_evidence", "bank"],
  ["mortgage_evidence", "issuer"],
  ["mortgage_evidence", "bank"],
] as const)("rejects %s worker release after %s withdrawal", (operation, publisher) => {
  const { basis, fingerprint, point, selection } = evidence();
  const request = { ...selection, operation, requestId: 1, fingerprint, points: [point],
    source: { basis, model: createSyntheticPersonalDraft() } };
  const before = { lender: control.lenderReads, bank: control.bankReads };
  let projectedReads: typeof before | undefined;
  const cpuAtStart = process.cpuUsage();
  const succeeded = executeForecastWorkerRequest(request, { now: () => performance.now() }, progress => {
    if (progress.outcome === "progress" && progress.phase === "projected")
      projectedReads = { lender: control.lenderReads, bank: control.bankReads };
  });
  const cpu = process.cpuUsage(cpuAtStart);
  expect(succeeded).toMatchObject({ outcome: "result", sourceIdentityMatched: true });
  expect(cpu.user + cpu.system).toBeGreaterThan(0);
  expect(projectedReads?.lender).toBeGreaterThan(before.lender);
  expect(projectedReads?.bank).toBeGreaterThan(before.bank);
  expect(control.lenderReads).toBeGreaterThan(projectedReads!.lender);
  expect(control.bankReads).toBeGreaterThan(projectedReads!.bank);

  const withdraw = () => {
    if (publisher === "issuer") control.lenderAvailable = false;
    else control.permission = "revoked";
  };
  const withdrawnInProgress = executeForecastWorkerRequest(request, { now: () => 0 }, progress => {
    if (progress.outcome === "progress" && progress.phase === "projected") withdraw();
  });
  expect(withdrawnInProgress).toMatchObject({ outcome: "error", sourceIdentityMatched: false });

  control.lenderAvailable = true;
  control.permission = "debit";
  let projected = false;
  const withdrawnInFinalClock = executeForecastWorkerRequest(request,
    { now: () => { if (projected) withdraw(); return 0; } }, progress => {
      if (progress.outcome === "progress" && progress.phase === "projected") projected = true;
    });
  expect(projected).toBe(true);
  expect(withdrawnInFinalClock).toMatchObject({ outcome: "error", sourceIdentityMatched: false });
});

it.each([
  ["monthly_evidence", "projected"],
  ["monthly_evidence", "final clock"],
  ["mortgage_evidence", "projected"],
  ["mortgage_evidence", "final clock"],
] as const)("reobserves the outer %s source after reentry from %s", (operation, callback) => {
  const outer = evidence();
  const nested = evidence(nestedMortgage(fixture("mortgage", "growth", 2, 1)));
  expect(nested.fingerprint).not.toBe(outer.fingerprint);
  const request = { ...outer.selection, operation, requestId: 1, fingerprint: outer.fingerprint, points: [outer.point],
    source: { basis: outer.basis, model: createSyntheticPersonalDraft() } };
  const nestedSelection = { ...nested.selection, operation, requestId: 2, fingerprint: nested.fingerprint, points: [nested.point] };
  const nestedRequest = { ...nestedSelection, source: { basis: nested.basis, model: createSyntheticPersonalDraft() } };
  const stillClock = { now: () => 0 };
  const reads = () => ({ outer: { lender: control.lenderReads, bank: control.bankReads }, nested: { ...nestedReads } });

  for (const withdrawn of [undefined, "issuer", "bank"] as const) {
    control.lenderAvailable = true;
    control.permission = "debit";
    let projected = false;
    let initialRestore: "cold" | "warm" | undefined;
    let nestedResponse: EvidenceWorkerResponse | undefined;
    let beforeNested: ReturnType<typeof reads> | undefined;
    let beforeRelease: ReturnType<typeof reads> | undefined;
    const reenter = () => {
      beforeNested = reads();
      nestedResponse = executeForecastWorkerRequest(nestedRequest, stillClock);
      beforeRelease = reads();
      if (withdrawn === "issuer") control.lenderAvailable = false;
      if (withdrawn === "bank") control.permission = "revoked";
    };
    const response = executeForecastWorkerRequest(request, { now: () => {
      if (callback === "final clock" && projected && !nestedResponse) reenter();
      return 0;
    } }, progress => {
      if (progress.outcome !== "progress") return;
      if (progress.phase === "decoded") initialRestore ??= "cold";
      if (progress.phase === "restore_warm") initialRestore ??= "warm";
      if (progress.phase !== "projected") return;
      projected = true;
      if (callback === "projected") reenter();
    });

    expect(initialRestore).toBe(withdrawn === undefined ? "cold" : "warm");
    expect(projected).toBe(true);
    expect(nestedResponse).toMatchObject({ outcome: "result", sourceIdentityMatched: true, requestId: 2 });
    expect(beforeRelease!.outer).toEqual(beforeNested!.outer);
    expect(beforeRelease!.nested.lender).toBeGreaterThan(beforeNested!.nested.lender);
    expect(beforeRelease!.nested.bank).toBeGreaterThan(beforeNested!.nested.bank);
    expect(response).toMatchObject({ requestId: 1, fingerprint: outer.fingerprint, ownership: "transported_source",
      outcome: withdrawn ? "error" : "result", sourceIdentityMatched: withdrawn === undefined });
    // A detected BANK revocation can end admission before the lender is read.
    if (withdrawn !== "bank") expect(control.lenderReads).toBeGreaterThan(beforeRelease!.outer.lender);
    if (withdrawn !== "issuer") expect(control.bankReads).toBeGreaterThan(beforeRelease!.outer.bank);
    expect(nestedReads).toEqual(beforeRelease!.nested);
    expect(executeForecastWorkerRequest(nestedSelection, stillClock))
      .toMatchObject({ outcome: "result", sourceIdentityMatched: true, fingerprint: nested.fingerprint });
    expect(nestedReads.lender).toBeGreaterThan(beforeRelease!.nested.lender);
    expect(nestedReads.bank).toBeGreaterThan(beforeRelease!.nested.bank);
  }
});
