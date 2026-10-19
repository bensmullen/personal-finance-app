import { civilDate, nextUtcDateOnlyInstant, type CivilDate } from "../../../../time/index.js";
import { Currency, DecimalAmount, Money, USD } from "../../../../values/index.js";
import { evaluateWithdrawals, type WithdrawalInput, type WithdrawalSource, type WithdrawalEvaluation } from "../withdrawals/index.js";
import { evaluateRmdObligations, rmdObligationId, type RmdInput, type RmdSource, type RmdEvaluation } from "../distributions/index.js";

export interface AllocationTerms {
  readonly withdrawalId: string;
  readonly authorizationId: string;
  readonly allocationId: string;
  readonly rmdObligationId: string;
  readonly householdId: string;
  readonly personId: string;
  readonly taxYear: number;
  readonly sourceAccountId: string;
  readonly effectiveAt: CivilDate;
  readonly amount: Money;
  readonly ruleSnapshotId: string;
}
export interface AllocationInstruction extends AllocationTerms {
  readonly approval?: {
    readonly id: string;
    readonly terms: AllocationTerms;
    readonly source: WithdrawalSource;
    readonly rmdSource: RmdSource;
  };
}
export interface WithdrawalRmdInput {
  readonly withdrawals: WithdrawalInput;
  readonly rmd: RmdInput;
  readonly allocations: readonly AllocationInstruction[];
  readonly usage: {
    readonly status: "verified_complete" | "unknown";
    readonly allocationIds: readonly string[];
    readonly approvalIds: readonly string[];
    readonly source: WithdrawalSource;
  };
}
export interface BindingDiagnostic {
  readonly seam: "S7";
  readonly sourceEntityPath: string;
  readonly period: { readonly start: CivilDate; readonly endExclusive: CivilDate };
  readonly affectedOutput: "withdrawal_rmd_authorization";
  readonly coverage: "incomplete";
  readonly diagnosticCode: "invalid" | "identity" | "authorization" | "source" | "duplicate" | "capacity" | "window" | "history" | "source_evaluation";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
const conditional = { committed: false, postable: false, funding: "incomplete", rmdSatisfaction: "not_applied" } as const;
export interface AuthorizationBundle {
  readonly contract: "d2-shared/v1";
  readonly version: "withdrawal-rmd-authorization/v1";
  readonly committed: false;
  readonly postable: false;
  readonly funding: "incomplete";
  readonly rmdSatisfaction: "not_applied";
  readonly executionCondition: "149_requalify_raw_sources_and_atomic_funded_transition";
  readonly requalification: WithdrawalRmdInput;
  readonly allocations: readonly (AllocationInstruction & { readonly proposedLate: boolean; readonly traceRefs: readonly string[] })[];
  readonly withdrawals: readonly {
    readonly withdrawalId: string;
    readonly authorizationId: string;
    readonly operationId: string;
    readonly sourceAccountId: string;
    readonly destinationAccountId: string;
    readonly grossAmount: Money;
    readonly netAmount: Money;
    readonly withholdingAmount: Money;
    readonly unallocatedGross: Money;
  }[];
  readonly obligations: readonly {
    readonly obligationId: string;
    readonly proposedOnTime: Money;
    readonly proposedLate: Money;
    readonly remainingRequested: Money;
  }[];
}
export interface WithdrawalRmdEvaluation {
  readonly contract: "d2-shared/v1";
  readonly committed: false;
  readonly postable: false;
  readonly funding: "incomplete";
  readonly rmdSatisfaction: "not_applied";
  readonly evidenceTier: "conditional";
  readonly bindingStatus: "conditional" | "incomplete";
  readonly bundle: AuthorizationBundle | null;
  readonly withdrawals: WithdrawalEvaluation;
  readonly rmd: RmdEvaluation;
  readonly diagnostics: readonly BindingDiagnostic[];
}
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const unique = (ids: readonly string[]): boolean => ids.every(text) && new Set(ids).size === ids.length;
/** Clone caller containers; immutable value primitives can safely be shared. */
function snapshot<T>(value: T): T {
  if (value === null || typeof value !== "object" || value instanceof Money || value instanceof Currency || value instanceof DecimalAmount) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]))) as T;
}
/** Canonicalize unordered raw facts for portable replay; this grants no priority. */
function canonical<T>(value: T): T {
  if (value === null || typeof value !== "object" || value instanceof Money || value instanceof Currency || value instanceof DecimalAmount) return value;
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b))) as T;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => cmp(a, b)).map(([k, v]) => [k, canonical(v)])) as T;
}
function sourcesConsistent(input: WithdrawalRmdInput): boolean {
  const seen = new Map<string, string>();
  let valid = true;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || value instanceof Money || value instanceof Currency || value instanceof DecimalAmount) return;
    const object = value as Record<string, unknown>;
    if ("publishedAt" in object && "id" in object) {
      const key = `${"projectionStatus" in object ? "withdrawal" : "rmd"}:${object.id}`;
      const encoded = JSON.stringify(canonical(value));
      if (seen.has(key) && seen.get(key) !== encoded) valid = false;
      seen.set(key, encoded);
    }
    Object.values(value).forEach(visit);
  };
  visit(input);
  return valid;
}
class Missing extends Error {
  constructor(readonly code: BindingDiagnostic["diagnosticCode"], readonly fact: string) { super(fact); }
}
const need = (ok: boolean, code: BindingDiagnostic["diagnosticCode"], fact: string): void => { if (!ok) throw new Missing(code, fact); };
const date = (at: CivilDate): void => { try { civilDate(at); } catch { throw new Missing("invalid", "civil_date"); } };
const exact = (m: Money): void => need(m instanceof Money && m.currency instanceof Currency && m.amount instanceof DecimalAmount && m.currency.equals(USD) && m.amount.fitsScale(2) && m.isPositive(), "invalid", "positive_exact_usd_cents");
const terms = (a: AllocationTerms): AllocationTerms => ({ withdrawalId: a.withdrawalId, authorizationId: a.authorizationId,
  allocationId: a.allocationId, rmdObligationId: a.rmdObligationId, householdId: a.householdId, personId: a.personId,
  taxYear: a.taxYear, sourceAccountId: a.sourceAccountId, effectiveAt: a.effectiveAt, amount: a.amount, ruleSnapshotId: a.ruleSnapshotId });
const sameTerms = (a: AllocationTerms, b: AllocationTerms): boolean =>
  a.withdrawalId === b.withdrawalId && a.authorizationId === b.authorizationId && a.allocationId === b.allocationId &&
  a.rmdObligationId === b.rmdObligationId && a.householdId === b.householdId && a.personId === b.personId &&
  a.taxYear === b.taxYear && a.sourceAccountId === b.sourceAccountId && a.effectiveAt === b.effectiveAt &&
  a.ruleSnapshotId === b.ruleSnapshotId && b.amount instanceof Money && a.amount.equals(b.amount);

/** Pure all-or-none binding; no distribution, financial state or capacity register. */
export function evaluateWithdrawalRmd(input: WithdrawalRmdInput): WithdrawalRmdEvaluation {
  let malformedOwnerInput = false;
  let withdrawals: WithdrawalEvaluation;
  try { withdrawals = evaluateWithdrawals(input.withdrawals); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    malformedOwnerInput = true;
    withdrawals = { contract: "d2-shared/v1", committed: false, postable: false, evidenceTier: "conditional", coverage: "incomplete",
      candidates: [], diagnostics: [], funding: "incomplete", bankSettlement: "incomplete", tax: "incomplete" };
  }
  // Never evaluate purported posted history as authenticated satisfaction.
  let rmd: RmdEvaluation;
  try { rmd = evaluateRmdObligations({ ...input.rmd, distributions: [] }); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    malformedOwnerInput = true;
    rmd = { contract: "d2-shared/v1", committed: false, obligations: [], intents: [], diagnostics: [],
      funding: "incomplete", bankSettlement: "incomplete", tax: "incomplete" };
  }
  const diagnostics: BindingDiagnostic[] = [];
  const allocations: AuthorizationBundle["allocations"][number][] = [];
  const instructions = [...input.allocations].sort((a, b) => cmp(a.allocationId, b.allocationId));
  const report = (e: Missing, a?: AllocationInstruction): void => {
    const at = a?.effectiveAt ?? input.rmd.asOf;
    diagnostics.push({ seam: "S7", sourceEntityPath: JSON.stringify(["withdrawalRmd", a?.allocationId ?? "batch"]),
      period: { start: at, endExclusive: (nextUtcDateOnlyInstant(at)?.slice(0, 10) ?? at) as CivilDate },
      affectedOutput: "withdrawal_rmd_authorization", coverage: "incomplete", diagnosticCode: e.code,
      missingFacts: [e.fact], ruleSnapshotId: a?.ruleSnapshotId ?? null,
      traceRefs: [a?.approval?.source?.id, a?.approval?.rmdSource?.id].filter((id): id is string => typeof id === "string").sort(cmp) });
  };
  const stamp = (s: WithdrawalSource, resource: string, person: string, at: CivilDate): void => {
    need(s !== undefined && s !== null, "source", "source_provenance");
    [s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive].forEach(date);
    need([s.id, s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text) &&
      s.projectionStatus === "verified" && s.householdId === input.withdrawals.householdId && s.personId === person && s.resourceId === resource &&
      s.publishedAt <= s.asOf && s.asOf <= at && s.asOf <= input.withdrawals.knownAt && s.asOf <= input.rmd.knownAt &&
      s.effectiveFrom <= at && at < s.endExclusive, "source", "verified_event_scoped_source");
  };
  try {
    need(!malformedOwnerInput, "invalid", "well_formed_raw_owner_inputs");
    [input.withdrawals.knownAt, input.rmd.asOf, input.rmd.knownAt].forEach(date);
    need(input.rmd.asOf <= input.rmd.knownAt, "invalid", "knowledge_chronology");
    need(input.rmd.distributions.length === 0, "history", "149_authenticated_distribution_history_required");
    need(input.rmd.currency.equals(USD), "invalid", "usd_rmd");
    need(sourcesConsistent(input), "source", "unchanged_source_identities");
    need(unique(input.withdrawals.usage.operationIds) && unique(input.withdrawals.usage.withdrawalIds) && unique(input.withdrawals.usage.authorizationIds), "duplicate", "unique_withdrawal_usage_history");
    need(withdrawals.coverage === "complete" && !rmd.diagnostics.some(d => d.coverage === "incomplete" &&
      !(d.affectedOutput === "rmd_satisfaction" && d.diagnosticCode === "funding" && d.sourceEntityPath === "remaining_shortfall")),
    "source_evaluation", "owner_evaluator_diagnostics");
    need(input.usage.status === "verified_complete" && unique(input.usage.allocationIds) && unique(input.usage.approvalIds), "source", "complete_binding_usage");
    need(!input.withdrawals.requests.some(r => (r.authorization && input.usage.approvalIds.includes(r.authorization.id)) ||
      r.withholding?.instructions.some(i => input.usage.approvalIds.includes(i.authorizationId))), "duplicate", "unused_withdrawal_authorizations_across_binding_history");
    need(unique(instructions.map(a => a.allocationId)), "duplicate", "unique_allocation_ids");
    need(unique(instructions.filter(a => a.approval).map(a => a.approval!.id)), "duplicate", "unique_approval_ids");
    // Even an empty allocation batch needs qualified usage evidence.
    stamp(input.usage.source, input.withdrawals.householdId, "*", input.rmd.asOf);
  } catch (e) { if (!(e instanceof Missing)) throw e; report(e); }
  for (const a of instructions) {
    try {
      date(a.effectiveAt); exact(a.amount);
      need([a.withdrawalId, a.authorizationId, a.allocationId, a.rmdObligationId, a.personId, a.sourceAccountId, a.ruleSnapshotId].every(text), "identity", "allocation_identity");
      const c = withdrawals.candidates.find(c => c.claimId === a.withdrawalId);
      const o = rmd.obligations.find(o => o.id === a.rmdObligationId);
      need(c !== undefined && o !== undefined, "identity", "derived_candidate_and_obligation");
      if (!c || !o) continue;
      need(c.authorizationId === a.authorizationId && c.actorId === a.personId && o.personId === a.personId &&
        c.householdId === a.householdId && c.sourceAccountId === a.sourceAccountId && c.effectiveAt === a.effectiveAt &&
        o.taxYear === a.taxYear && o.ruleSnapshotId === a.ruleSnapshotId && o.accountIds.includes(a.sourceAccountId) &&
        c.targetObligationIds.includes(o.id), "identity", "exact_owner_account_year_target_and_rule");
      const request = input.rmd.requests.find(r => rmdObligationId(r) === o.id)!;
      const account = request.accounts.find(r => r.id === a.sourceAccountId)!;
      need(account.family === c.instrumentFamily && account.bucket === c.taxBucket && account.beneficiaryId === null,
        "identity", "matching_source_account_character");
      need(a.effectiveAt >= o.earliestSatisfaction && a.effectiveAt <= input.rmd.asOf, "window", "eligible_event_window");
      const approval = a.approval;
      need(approval !== undefined && text(approval.id), "authorization", "explicit_exact_allocation_approval");
      if (!approval) continue;
      need(approval.terms !== undefined && approval.terms !== null, "authorization", "immutable_approval_terms");
      exact(approval.terms.amount);
      need(sameTerms(a, approval.terms), "authorization", "immutable_approval_terms");
      stamp(approval.source, approval.id, a.personId, a.effectiveAt);
      stamp(input.usage.source, input.withdrawals.householdId, "*", a.effectiveAt);
      const s = approval.rmdSource;
      need(s !== undefined && s !== null, "source", "rmd_allocation_provenance");
      [s.publishedAt, s.asOf, s.effectiveFrom, s.effectiveUntil].forEach(date);
      need([s.id, s.publication, s.version].every(text) && s.status === "verified" && s.personId === a.personId && s.accountId === a.sourceAccountId &&
        s.publishedAt <= s.asOf && s.asOf <= a.effectiveAt && s.asOf <= input.rmd.knownAt && s.asOf <= input.withdrawals.knownAt &&
        s.effectiveFrom <= a.effectiveAt && a.effectiveAt < s.effectiveUntil, "source", "verified_rmd_allocation_permission");
      const refs = [request.personSource, request.beneficiary.source, request.electionSource, request.rule!.source,
        ...request.rule!.factors.map(f => f.source), ...request.accounts.flatMap(x => [x.source, x.priorValue!.source, ...(x.planTerms ? [x.planTerms.source] : [])]),
        ...(request.aggregation ? [request.aggregation.source] : []), ...(request.stillWorking ? [request.stillWorking.source] : [])];
      need(refs.every(s => s.publishedAt <= s.asOf && s.asOf <= a.effectiveAt), "source", "rmd_sources_known_at_event");
      need(!input.usage.allocationIds.includes(a.allocationId) && !input.usage.approvalIds.includes(approval.id) &&
        !input.withdrawals.usage.authorizationIds.includes(approval.id) && !input.withdrawals.requests.some(r =>
          r.authorization?.id === approval.id || r.withholding?.instructions.some(i => i.authorizationId === approval.id)), "duplicate", "unused_allocation_approval");
      allocations.push({ ...terms(a), approval: { id: approval.id, terms: terms(approval.terms), source: approval.source, rmdSource: s }, proposedLate: a.effectiveAt > o.due,
        traceRefs: [...new Set([...c.traceRefs, ...o.traceRefs, approval.source.id, s.id, input.usage.source.id])].sort(cmp) });
    } catch (e) { if (!(e instanceof Missing)) throw e; report(e, a); }
  }
  const sum = (items: readonly AllocationInstruction[]): Money => items.reduce((s, a) => s.plus(a.amount), Money.zero(USD));
  for (const c of withdrawals.candidates) {
    if (sum(allocations.filter(a => a.withdrawalId === c.claimId)).compare(c.grossAmount) > 0) report(new Missing("capacity", `withdrawal_gross:${c.claimId}`));
  }
  for (const o of rmd.obligations) {
    if (sum(allocations.filter(a => a.rmdObligationId === o.id)).compare(o.required) > 0) report(new Missing("capacity", `annual_required:${o.id}`));
  }
  const bundle: AuthorizationBundle | null = diagnostics.length ? null : {
    contract: "d2-shared/v1", version: "withdrawal-rmd-authorization/v1", ...conditional,
    executionCondition: "149_requalify_raw_sources_and_atomic_funded_transition",
    requalification: canonical(input), allocations,
    withdrawals: withdrawals.candidates.map(c => ({ withdrawalId: c.claimId, authorizationId: c.authorizationId, operationId: c.operationId,
      sourceAccountId: c.sourceAccountId, destinationAccountId: c.destinationAccountId, grossAmount: c.grossAmount,
      netAmount: c.netAmount, withholdingAmount: c.withholdingAmount,
      unallocatedGross: c.grossAmount.minus(sum(allocations.filter(a => a.withdrawalId === c.claimId))) })),
    obligations: rmd.obligations.map(o => ({ obligationId: o.id,
      proposedOnTime: sum(allocations.filter(a => a.rmdObligationId === o.id && !a.proposedLate)),
      proposedLate: sum(allocations.filter(a => a.rmdObligationId === o.id && a.proposedLate)),
      remainingRequested: o.required.minus(sum(allocations.filter(a => a.rmdObligationId === o.id))) })),
  };
  return snapshot<WithdrawalRmdEvaluation>({ contract: "d2-shared/v1", ...conditional, evidenceTier: "conditional", bindingStatus: bundle ? "conditional" : "incomplete",
    bundle, withdrawals, rmd, diagnostics: diagnostics.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b))) });
}
