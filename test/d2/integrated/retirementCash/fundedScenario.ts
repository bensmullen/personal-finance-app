import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { registerRetirementRawSourcePort, type RetirementRawSource, type RetirementCashInput } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import type { AllocationInstruction, WithdrawalRmdInput } from "../../../../src/simulation/d2/retirement/withdrawalRmd/index.js";
import { fixture, input, rmdInput, source } from "./scenario.js";

export const sources = new Map<string, RetirementRawSource>();
registerRetirementRawSourcePort({ read: reference => sources.get(reference.sourceId) });

export function funded(f = fixture(), label = "funded", amounts = ["500"]) {
  const parts = amounts.map((amount, n) => {
    const i = input(f, `${label}:${n}`), request = i.withdrawals.requests[0]!;
    const withdrawals = { ...i.withdrawals, requests: [{ ...request, grossAmount: money(amount),
      authorization: { ...request.authorization!, grossAmount: money(amount) } }] };
    const binding = rmdInput({ ...i, withdrawals });
    const a = binding.allocations[0]!;
    const { approval: _approval, ...terms } = { ...a, amount: money(amount), allocationId: `allocation:${label}:${n}` };
    const approvalId = `approval:${label}:${n}`;
    const allocation: AllocationInstruction = { ...terms, approval: { ...a.approval!, id: approvalId, terms,
      source: source(approvalId, request.personId, request.effectiveAt, `${label}:${n}:rmd-approval`) } };
    return { cash: { ...i, withdrawals: binding.withdrawals }, binding: { ...binding, allocations: [allocation] } };
  });
  const first = parts[0]!;
  let prior = money("0");
  const confirmations = parts.map((p, n) => {
    const q = p.cash.confirmations[0]!;
    const result = { ...q, sourceCashBefore: money("1000").minus(prior), bankCashBefore: money("200").plus(prior),
      ordering: { ...q.ordering, after: n ? [parts[n - 1]!.cash.withdrawals.requests[0]!.operationId] : [] } };
    prior = prior.plus(money(amounts[n]!));
    return result;
  });
  const cash: RetirementCashInput = { ...first.cash, confirmations,
    withdrawals: { ...first.cash.withdrawals, requests: parts.flatMap(p => p.cash.withdrawals.requests) } };
  const binding: WithdrawalRmdInput = { ...first.binding, withdrawals: cash.withdrawals, allocations: parts.flatMap(p => p.binding.allocations) };
  const raw: RetirementRawSource = { sourceId: `publisher:${label}`, sourceVersion: "v1", cash, binding, priorOperationIds: [],
    availability: cash.withdrawals.requests.map(r => ({ operationId: r.operationId,
      publishedAt: instant("2025-01-01T10:00:00.000Z"), knownAt: instant(`${r.effectiveAt}T00:00:00.000Z`) })) };
  const reference = { sourceId: raw.sourceId, sourceVersion: raw.sourceVersion,
    horizon: { start: f.context.simulationStart, end: f.context.simulationEnd } };
  sources.set(raw.sourceId, raw);
  return { cash: { ...cash, fundedRmd: reference }, raw, reference };
}
