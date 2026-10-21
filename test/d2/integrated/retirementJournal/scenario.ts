import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { calculationTraceId } from "../../../../src/lineage/index.js";
import { applyRetirementDistributionAtomically, createAuthoritativeState, registerRetirementDistributionSourceAuthority,
  retirementDistributionSourceFingerprint, type RetirementDistributionRecord } from "../../../../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";

export const ids = {
  bank: domainId("account", "204a0000-0000-4000-8000-000000000001"),
  source: domainId("account", "204a0000-0000-4000-8000-000000000002"),
  person: domainId("person", "204a0000-0000-4000-8000-000000000003"),
  household: domainId("household", "204a0000-0000-4000-8000-000000000004"),
};
export const context = { asOf: instant("2026-02-01T00:00:00.000Z"), dataCutoff: instant("2026-02-01T00:00:00.000Z") };
export const state = () => createAuthoritativeState({ accounts: {
  [ids.source]: { id: ids.source, kind: "retirement", ownerId: ids.person, cash: money("1000") },
  [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.person, cash: money("200") },
} });
export const distribution = (rows = false, key = "first", year = 2026): RetirementDistributionRecord => {
  const source = { sourceId: `source:${key}`, sourceVersion: "synthetic-independent-A4/v1", ruleVersion: "synthetic/v1",
    publishedAt: instant("2025-12-01T00:00:00.000Z"), knownAt: instant("2025-12-01T00:00:00.000Z"),
    householdId: ids.household, personId: ids.person, sourceApprovalId: `source-approval:${key}`, paymentApprovalId: `payment-approval:${key}` };
  return { version: "retirement-distribution/v1", transactionId: accountingTransactionId(`posted:${key}`),
    originalPostingProofId: accountingTransactionId(`posted:${key}`), operationId: `operation:${key}`, withdrawalId: `withdrawal:${key}`,
    authorizationId: `authorization:${key}`, householdId: ids.household, personId: ids.person,
    sourceAccountId: ids.source, destinationAccountId: ids.bank, effectiveAt: instant(`${year}-01-15T00:00:00.000Z`), taxYear: year,
    gross: money("500"), netBank: money("500"), withholding: money("0"), instrumentFamily: "traditional_ira", taxBucket: "pretax",
    beneficiaryId: null, distributionKind: "ordinary_cash", source, sourceEvidenceFingerprint: retirementDistributionSourceFingerprint(source),
    traceIds: [calculationTraceId("independent-source-trace")], rmdSatisfaction: "not_applied", tax: "incomplete",
    allocations: rows ? [{ allocationId: `allocation:${key}`, approvalId: `allocation-approval:${key}`,
      obligationId: JSON.stringify([ids.person, year, ["account", ids.source], "synthetic-rmd/v1"]), satisfiesRmdYear: year,
      sourceAccountId: ids.source, amount: money("500"), deadline: instant(`${year}-12-31T00:00:00.000Z`),
      firstYear: false, deferred: false, ruleVersion: "synthetic-rmd/v1", sourceId: "independent-rmd-source",
      obligation: { personId: ids.person, accountId: ids.source, taxYear: year, ruleSnapshotId: "synthetic-rmd/v1", required: money("700") } }] : [] };
};
// A fixed independent fixture store, never populated from replay payloads.
export const sources = new Map<string, RetirementDistributionRecord>();
export const availability = { enabled: true, calls: 0, failAt: 0 };
export const registerAuthority = () => registerRetirementDistributionSourceAuthority({ qualify: source => {
  availability.calls++;
  const d = sources.get(source.sourceId);
  return !availability.enabled || availability.calls === availability.failAt || !d
    ? { status: "incomplete", reason: "source_unavailable" } : { status: "qualified", distribution: d };
} });
export const admit = (d: RetirementDistributionRecord) => { sources.set(d.source.sourceId, d); return d; };
export const fixture = (months = 13, journal = true, rows = false) => {
  const opening = state();
  if (journal) applyRetirementDistributionAtomically(opening, admit(distribution(rows)), context);
  const start = context.asOf;
  const runContext = createRunContext({ ...context, runId: runId("204b0000-0000-4000-8000-000000000001"),
    scenarioId: scenarioId("204b0000-0000-4000-8000-000000000002"), simulationStart: start,
    simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: runContext.scenarioId, executionMonths: months,
    scenarioBindings: { synthetic: "#204 J1 persistence; no J2 application or tax coverage" } }, start);
  return { opening, kernel, runContext };
};
