import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { attachFundedRetirementCashSchedule, evaluateFundedRmdSatisfaction, registerRetirementRawSourcePort,
  type RetirementRawSource } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { rmdObligationId, type RmdRequest } from "../../../../src/simulation/d2/retirement/distributions/index.js";
import { fixture, input, rmdInput, ids as isolatedIds } from "../retirementCash/scenario.js";
import { cardSource, combinedScenario, ids, medicalSource, publishers, registerPublishers, resetPublishers } from "./combinedScenario.js";

export const sources = new Map<string, RetirementRawSource>();
export let reads = 0;
registerPublishers({ retirement: false });
registerRetirementRawSourcePort({ read: reference => { reads++; return sources.get(reference.sourceId); } });
export function resetSources(): void { resetPublishers(); sources.clear(); reads = 0; }

// Reuse documentary input builders only, never the isolated executor or its
// expected output. Admission, funding, J1 and RMD calculation use production.
function scope<T>(value: T, date: string): T {
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return v === isolatedIds.household ? ids.household : v === "2026-01-15" ? date : v;
    if (Array.isArray(v)) return v.map(visit);
    if (v && Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, visit(item)]));
    return v;
  };
  return visit(value) as T;
}

export function fundedHousehold({ months = 2, second = true, deferred = false } = {}) {
  const medical = medicalSource(), card = cardSource();
  // Literal documentary balances from the dated truth table, not prior runs.
  const fsa = { ...medical, deposit: { ...medical.deposit, bankCashBefore: money(deferred ? "1200" : second ? "1900" : "1700") } };
  publishers.fsa = () => fsa;
  publishers.card = () => ({ ...card, payment: { ...card.payment, bankCashBefore: money(deferred ? "1400" : second ? "2100" : "1900") } });
  const s = combinedScenario({ months, fsa });
  const horizon = { start: s.context.simulationStart, end: s.context.simulationEnd };
  const documentary = fixture(1, undefined, "2026-01");
  const plan = (label: string, date: string, amount: string, ira: string, bank: string, previous?: RetirementRawSource): RetirementRawSource => {
    const i = scope(input(documentary, `s8-3:${label}`, ids.member, ids.retirement, ids.bank), date);
    const request = i.withdrawals.requests[0]!;
    const cash = { ...i, withdrawals: { ...i.withdrawals,
      cash: i.withdrawals.cash.map(a => ({ ...a, liquidity: { ...a.liquidity!, available: money(ira) } })),
      requests: [{ ...request, grossAmount: money(amount), authorization: { ...request.authorization!, grossAmount: money(amount) } }],
      usage: { ...i.withdrawals.usage,
        operationIds: previous ? previous.cash.withdrawals.requests.map(r => r.operationId) : [],
        withdrawalIds: previous ? previous.cash.withdrawals.requests.map(r => r.withdrawalId) : [],
        authorizationIds: previous ? previous.cash.withdrawals.requests.flatMap(r => [r.authorization!.id,
          ...r.withholding!.instructions.map(w => w.authorizationId)]) : [] } },
      confirmations: i.confirmations.map(q => ({ ...q, runId: s.context.runId,
        period: utcMonthlyPeriods(instant(`${date.slice(0, 7)}-01T00:00:00.000Z`), 1)[0]!,
        sourceCashBefore: money(ira), bankCashBefore: money(bank) })) };
    const b = scope(rmdInput(cash), date), row = b.allocations[0]!;
    const { approval: _approval, ...terms } = { ...row, allocationId: `s8-3:allocation:${label}`, amount: money(amount) };
    const approvalId = `s8-3:approval:${label}`;
    const binding = { ...b, allocations: [{ ...terms, approval: { ...row.approval!, id: approvalId, terms,
      source: { ...row.approval!.source, id: `s8-3:approval-source:${label}`, resourceId: approvalId } } }],
      usage: { ...b.usage, allocationIds: previous ? previous.binding.allocations.map(a => a.allocationId) : [],
        approvalIds: previous ? previous.binding.allocations.map(a => a.approval!.id) : [] } };
    return { sourceId: `s8-3:publisher:${label}`, sourceVersion: "v1", cash: { ...cash, withdrawals: binding.withdrawals }, binding,
      priorOperationIds: previous ? previous.cash.withdrawals.requests.map(r => r.operationId) : [],
      availability: [{ operationId: request.operationId, publishedAt: instant("2025-01-01T10:00:00.000Z"),
        knownAt: instant(`${date}T00:00:00.000Z`) }] };
  };
  let raw: RetirementRawSource[];
  if (deferred) {
    const p = plan("deferred", "2027-04-01", "500", "1000", "7905.07");
    const original = p.binding.rmd.requests[0]!;
    const first: RmdRequest = { ...original, election: "defer" };
    const current: RmdRequest = { ...original, taxYear: 2027,
      accounts: original.accounts.map(a => ({ ...a, priorValue: { ...a.priorValue!, at: civilDate("2026-12-31") } })),
      rule: { ...original.rule!, snapshotId: "synthetic:2027", originalDue: civilDate("2027-12-31"),
        deferredDue: civilDate("2028-04-01"), earliestSatisfaction: civilDate("2027-01-01"),
        factors: original.rule!.factors.map(f => ({ ...f, ruleSnapshotId: "synthetic:2027", age: 71 })) } };
    const row = p.binding.allocations[0]!, { approval: _approval, ...base } = row;
    const firstTerms = { ...base, amount: money("300") };
    const currentTerms = { ...base, allocationId: "s8-3:allocation:current", taxYear: 2027,
      rmdObligationId: rmdObligationId(current), ruleSnapshotId: "synthetic:2027", amount: money("200") };
    const withdrawals = { ...p.cash.withdrawals, requests: p.cash.withdrawals.requests.map(r => ({ ...r,
      targetObligationIds: [rmdObligationId(first), rmdObligationId(current)] })) };
    raw = [{ ...p, cash: { ...p.cash, withdrawals }, binding: { ...p.binding, withdrawals,
      rmd: { ...p.binding.rmd, requests: [first, current] }, allocations: [
        { ...firstTerms, approval: { ...row.approval!, terms: firstTerms } },
        { ...currentTerms, approval: { ...row.approval!, id: "s8-3:approval:current", terms: currentTerms,
          source: { ...row.approval!.source, id: "s8-3:source:current", resourceId: "s8-3:approval:current" } } },
      ] } }];
  } else {
    const first = plan("first", "2026-01-22", "500", "1000", "1200");
    raw = second ? [first, plan("second", "2026-01-23", "200", "500", "1700", first)] : [first];
  }
  raw.forEach(p => sources.set(p.sourceId, p));
  const annualSource = raw.at(-1)!;
  const plans = raw.map(p => ({ ...p.cash, fundedRmd: { sourceId: p.sourceId, sourceVersion: p.sourceVersion, horizon } }));
  const base = applyHouseholdExecutionOverlay(s.kernel, {
    participants: s.kernel.executable.participants!.filter(p => p.id !== "s8_j1_structure"),
    scenarioBindings: { source: "#149 S8-3; actual source-qualified J2 cash and account-scoped RMD" },
  });
  const schedule = { horizon, annualSource: { sourceId: annualSource.sourceId, sourceVersion: annualSource.sourceVersion }, plans };
  const kernel = attachFundedRetirementCashSchedule(base, schedule);
  const reference = { ...schedule.annualSource, horizon };
  return { ...s, baseKernel: base, kernel, raw, schedule, reference,
    satisfaction: (state: Parameters<typeof evaluateFundedRmdSatisfaction>[1], through = s.context.simulationEnd) =>
      evaluateFundedRmdSatisfaction(reference, state, s.context, through),
    run: () => runHouseholdKernel({ kernel, runContext: s.context, resultTier: "detail" }) };
}
