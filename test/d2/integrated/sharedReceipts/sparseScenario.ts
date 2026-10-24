import { compileHouseholdKernel, runHouseholdKernel, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { registerHouseholdParticipantCodec } from "../../../../src/simulation/r3/participantCodec.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { payrollContributionCandidate } from "../../../../src/simulation/payrollContributions.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { applyD2SettlementAtomically, applyRetirementDistributionAtomically, createAuthoritativeState,
  d2SettlementSourceFingerprint, type AuthoritativeState } from "../../../../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { USD } from "../../../../src/values/index.js";
import * as shared from "./scenario.js";
import * as heloc from "../helocServicePort/scenario.js";
import * as retirement from "../retirementJournal/scenario.js";
import * as health from "../../health/premiums/payrollPort/scenario.js";

shared.registerMockAuthorities();
retirement.registerAuthority();
export const sourceCalls = () => shared.availability.calls + heloc.authorityStatus.calls + retirement.availability.calls + health.sourceStatus.calls;
export const resetSourceCalls = () => {
  shared.availability.calls = heloc.authorityStatus.calls = retirement.availability.calls = health.sourceStatus.calls = 0;
};
const growingPaycheck = (year: number) => health.paycheckFixture(`growth:${year}`, { at: instant(`${year}-01-15T00:00:00.000Z`) });
const growingParticipant = (count: number): HouseholdKernelParticipant => ({
  id: "synthetic_sparse_payroll", version: "1", portableCodec: "test-sparse-payroll/v1", economicInputs: count,
  prepare: (_context, period) => {
    const year = Number(period.start.slice(0, 4));
    if (period.start.slice(5, 7) !== "01" || year < 2035 || year >= 2035 + count) return { id: "synthetic_sparse_payroll", operations: [] };
    const f = growingPaycheck(year);
    return { id: "synthetic_sparse_payroll", operations: [{
      descriptor: { id: `synthetic-paycheck:${year}`, domain: "synthetic_sparse_payroll", operationClass: "synthetic_sparse_payroll:allocation",
        sequencingInstant: f.input.at, dependsOn: [], traceRefs: [],
        resourceAccesses: [{ kind: "account_cash", accountId: health.ids.cash, mode: "produce" }] },
      execute: opening => {
        const result = payrollContributionCandidate(opening.state, { ...f.input, taxCreditAccountId: health.ids.cash });
        return { ...opening, state: result.state, facts: { transactions: result.transactions } };
      },
    }] };
  },
});
registerHouseholdParticipantCodec({ codec: "test-sparse-payroll/v1", restore: inputs => {
  if (typeof inputs !== "number" || !Number.isSafeInteger(inputs) || inputs < 1 || inputs > 120) throw new Error("INVALID_SYNTHETIC_PAYROLL_COUNT");
  return growingParticipant(inputs);
} });
export const mixedFixture = (count: number, principalOnly = false, growing = false) => {
  let payroll: AuthoritativeState | undefined;
  for (let i = 0; i < count; i++) {
    const at = instant(`${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-15T00:00:00.000Z`);
    const f = health.paycheckFixture(`sparse:${i}`, { at });
    payroll = payrollContributionCandidate(payroll ?? f.opening, f.input).state;
  }
  const reimbursements = shared.state("1500");
  for (let i = 0; i < count; i++) {
    const r = shared.fsa(`sparse:${i}`), source = { ...r.source, executionOrder: { sequenceId: "sparse-source-order", position: i } };
    shared.admit({ ...r, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) });
    applyD2SettlementAtomically(reimbursements, shared.independentSources.get(source.sourceId)!, shared.context);
  }
  const card = shared.card("sparse-card"), cardSource = { ...card.source, executionOrder: { sequenceId: "sparse-source-order", position: count } };
  const cardReceipt = shared.admit({ ...card, bankCashBefore: reimbursements.accounts[shared.ids.bank]!.cash,
    source: cardSource, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(cardSource) });
  applyD2SettlementAtomically(reimbursements, cardReceipt, shared.context);
  const creditLine = heloc.opening();
  applyD2SettlementAtomically(creditLine, heloc.admitted("sparse-heloc", principalOnly ? "0" : "5.10"), heloc.context);
  const retired = retirement.state();
  applyRetirementDistributionAtomically(retired, retirement.admit(retirement.distribution(false, "sparse-retirement")), retirement.context);
  // Independent accounts/owners keep the existing fixture source authorities
  // intact. Merge only actually executed journals and their commitment IDs.
  const states = [payroll!, reimbursements, creditLine, retired];
  const opening = createAuthoritativeState({
    accounts: Object.assign({}, ...states.map(s => s.accounts)), positions: Object.assign({}, ...states.map(s => s.positions)),
    liabilities: Object.assign({}, ...states.map(s => s.liabilities)), obligations: Object.assign({}, ...states.map(s => s.obligations)),
    contributions: Object.assign({}, ...states.map(s => s.contributions)),
    d2PostedTransactions: Object.assign({}, ...states.map(s => s.d2PostedTransactions)),
    d2SettlementReceipts: Object.assign({}, ...states.map(s => s.d2SettlementReceipts)),
    retirementDistributionAllocations: retired.retirementDistributionAllocations!,
    identities: Object.fromEntries(Object.keys(payroll!.identities).map(kind => [kind,
      states.flatMap(s => [...s.identities[kind as keyof typeof s.identities]])])) as unknown as AuthoritativeState["identities"],
  });
  const start = instant("2035-01-01T00:00:00.000Z"), months = count * 12 + 1;
  const context = createRunContext({ runId: runId("149d0000-0000-4000-8000-000000000001"),
    scenarioId: scenarioId("149d0000-0000-4000-8000-000000000002"), asOf: start, dataCutoff: start,
    simulationStart: start, simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    ...(growing ? { participants: [growingParticipant(count)] } : {}),
    executionMonths: months, scenarioIdentity: context.scenarioId, scenarioBindings: { synthetic: "mixed immutable source history" } }, start);
  return { opening, context, forecast: runHouseholdKernel({ kernel, runContext: context }) };
};
