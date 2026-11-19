import { beforeEach, expect, it } from "vitest";
import { createSyntheticPersonalDraft } from "../../../../../src/application/personalMvp.js";
import type { HouseholdForecastPoint } from "../../../../../src/application/householdProjection.js";
import { householdEvidenceMonth, restoreHouseholdEvidencePoints } from "../../../../../src/application/mortgageChartData.js";
import { calculationTraceId } from "../../../../../src/lineage/index.js";
import { compileHouseholdKernel, runHouseholdForecastSummary } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { executeForecastWorkerRequest } from "../../../../../ui/forecast/execute.js";
import { control, fixture, principal, reset, start } from "../../fixedLoanOriginalBridge/scenario.js";

beforeEach(reset);

function evidence() {
  const request = fixture("mortgage", "growth", 2, 1);
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
