import { requalifyRetirementDistributionHistory, type AuthoritativeState, type D2SettlementSourceContext } from "../../../../state/index.js";
import { civilDate, type Instant, type Period } from "../../../../time/index.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../run.js";
import { evaluateRmdObligations, type RmdDistribution, type RmdEvaluation } from "../../retirement/distributions/index.js";
import { readRetirementRawSource, qualifyRetirementRawSource, type RetirementSourceReference } from "./source.js";

export interface FundedRmdResult {
  readonly coverage: "complete" | "incomplete";
  readonly reason?: "source_unavailable" | "source_not_qualified" | "unsupported_group_journal" | "history_incomplete";
  readonly annual: RmdEvaluation | null;
}
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);

/** Derived read model, never a second satisfaction ledger or journal amendment. */
export function evaluateFundedRmdSatisfaction(reference: RetirementSourceReference & { readonly horizon: Period }, state: AuthoritativeState,
  context: D2SettlementSourceContext, through: Instant): FundedRmdResult {
  // Structural integrity matters, but a void return grants no source credit.
  requalifyRetirementDistributionHistory(state, context);
  try { return reconcile(reference, state, context, through); }
  catch { return { coverage: "incomplete", reason: "source_not_qualified", annual: null }; }
}

function reconcile(reference: RetirementSourceReference & { readonly horizon: Period }, state: AuthoritativeState,
  context: D2SettlementSourceContext, through: Instant): FundedRmdResult {
  const raw = readRetirementRawSource(reference, context);
  if (!raw) return { coverage: "incomplete", reason: "source_unavailable", annual: null };
  if (raw.binding.rmd.requests.some(r => r.aggregation || r.accounts.length !== 1))
    return { coverage: "incomplete", reason: "unsupported_group_journal", annual: null };
  // A forecast boundary cannot invent knowledge beyond authenticated A4 asOf.
  const lastDate = new Date(Date.parse(through) - 1).toISOString().slice(0, 10);
  const asOf = civilDate([lastDate, raw.binding.rmd.asOf, context.dataCutoff.slice(0, 10)].sort()[0]!);
  const baseline = evaluateRmdObligations({ ...raw.binding.rmd, asOf, distributions: [] });
  const incomplete = (reason: NonNullable<FundedRmdResult["reason"]>): FundedRmdResult => ({ coverage: "incomplete", reason, annual: baseline });
  let horizonComplete = true;
  const owners = new Set(raw.cash.members.map(m => m.personId));
  for (const account of Object.values(state.accounts).filter(a => a.kind === "retirement" && typeof a.ownerId === "string" && owners.has(a.ownerId))) {
    const finalYear = Number(new Date(Date.parse(reference.horizon.end) - 1).toISOString().slice(0, 4));
    for (let year = Number(reference.horizon.start.slice(0, 4)); year <= finalYear; year++)
      if (!raw.binding.rmd.requests.some(r => r.taxYear === year && r.personId === account.ownerId && r.accounts[0]?.id === account.id))
        horizonComplete = false;
  }
  const records = Object.values(state.retirementDistributionAllocations ?? {}).filter(d => d.householdId === raw.cash.withdrawals.householdId);
  const expected = [...raw.priorOperationIds, ...raw.cash.withdrawals.requests
    .filter(r => `${r.effectiveAt}T00:00:00.000Z` < through).map(r => r.operationId)];
  if (new Set(expected).size !== expected.length || !same([...expected].sort(), records.map(d => d.operationId).sort()))
    return incomplete("history_incomplete");
  const distributions: RmdDistribution[] = [];
  for (const d of records) {
    const historical = readRetirementRawSource(d.source, context);
    const qualified = historical && qualifyRetirementRawSource(historical, d.operationId, context);
    const proof = state.d2PostedTransactions?.[d.originalPostingProofId];
    if (!qualified || qualified.status !== "qualified" || !same(qualified.distribution, d)
      || proof?.registration.kind !== "retirement_cash_distribution" || !same(proof.registration.distribution, d)
      || !state.identities.postedTransactionIds.includes(d.transactionId)) return incomplete("source_not_qualified");
    for (const row of d.allocations) {
      const o = baseline.obligations.find(o => o.id === row.obligationId);
      const r = raw.binding.rmd.requests.find(r => r.personId === row.obligation.personId && r.taxYear === row.satisfiesRmdYear
        && r.accounts[0]?.id === row.sourceAccountId);
      if (!o || !r || !o.required.equals(row.obligation.required) || `${o.due}T00:00:00.000Z` !== row.deadline
        || (r.election === "defer") !== row.deferred || o.ruleSnapshotId !== row.ruleVersion
        || (o.taxYear - Number(r.birthDate.slice(0, 4)) === r.rule!.startAge) !== row.firstYear)
        return incomplete("source_not_qualified");
    }
    const source = historical!.binding.allocations.find(a => a.withdrawalId === d.withdrawalId)?.approval?.rmdSource;
    if (d.allocations.length && !source) return incomplete("source_not_qualified");
    if (source) distributions.push({ transactionId: d.transactionId, personId: d.personId, payerOwnerId: d.personId,
      accountId: d.sourceAccountId, at: civilDate(d.effectiveAt.slice(0, 10)), gross: d.gross, kind: "ordinary",
      authorized: true, funding: "posted_funded", usageRegister: "verified_complete", source,
      allocations: d.allocations.map(a => ({ id: a.allocationId, obligationId: a.obligationId,
        satisfiesRmdYear: a.satisfiesRmdYear, amount: a.amount, historical: true })) });
  }
  const annual = evaluateRmdObligations({ ...raw.binding.rmd, asOf, distributions });
  return immutableConfiguration({ coverage: !horizonComplete || annual.diagnostics.some(d => d.coverage === "incomplete") ? "incomplete" : "complete",
    ...(!horizonComplete ? { reason: "source_not_qualified" as const } : {}), annual });
}
