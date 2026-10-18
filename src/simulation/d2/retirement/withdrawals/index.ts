import { civilDate, nextUtcDateOnlyInstant, type CivilDate } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";

export interface WithdrawalSource {
  readonly id: string;
  readonly ruleSnapshotId: string;
  readonly jurisdiction: string;
  readonly ruleFamily: string;
  readonly sourcePublication: string;
  readonly version: string;
  readonly publishedAt: CivilDate;
  readonly asOf: CivilDate;
  readonly effectiveFrom: CivilDate;
  readonly endExclusive: CivilDate;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
  readonly householdId: string;
  readonly personId: string;
  readonly resourceId: string;
}
export interface WithdrawalCash {
  readonly accountId: string;
  readonly ownerId: string;
  readonly householdId: string;
  readonly instrumentFamily: "traditional_ira" | "sep_ira" | "simple_ira" | "workplace_plan" | "roth_ira";
  readonly taxBucket: "pretax" | "roth" | "aftertax" | "mixed";
  readonly beneficiaryId: string | null;
  readonly eligibility: "eligible_ordinary_cash" | "unknown" | "unsupported";
  readonly unsupportedRules: readonly string[];
  readonly eligibilitySource: WithdrawalSource;
  readonly planTerms?: {
    readonly planId: string;
    readonly permission: "ordinary_cash_distribution" | "unknown";
    readonly source: WithdrawalSource;
  };
  /** Cash after ALL external reservations, never position market value. */
  readonly liquidity?: {
    readonly kind: "available_unencumbered_account_cash";
    readonly available: Money;
    readonly settledAt: CivilDate;
    readonly at: CivilDate;
    readonly contention: "complete_external_reservations" | "unknown";
    readonly source: WithdrawalSource;
  };
}
export interface WithdrawalRequest {
  readonly operationId: string;
  /** Stable underlying distribution identity across authorizations/retries. */
  readonly withdrawalId: string;
  readonly householdId: string;
  readonly personId: string;
  readonly sourceAccountId: string;
  readonly taxBucket: WithdrawalCash["taxBucket"];
  readonly kind: "ordinary" | "in_kind" | "rollover" | "conversion" | "qcd" | "inherited";
  readonly effectiveAt: CivilDate;
  readonly grossAmount: Money;
  readonly bank: {
    readonly id: string;
    readonly ownerId: string;
    readonly householdId: string;
    readonly kind: "checking" | "savings" | "other";
    readonly source: WithdrawalSource;
  };
  readonly withholding?: {
    readonly id: string;
    /** Attests ALL applicable jurisdictions, including verified zero instructions. */
    readonly completeness: "verified_complete" | "unknown";
    readonly source: WithdrawalSource;
    readonly instructions: readonly {
      readonly id: string;
      readonly jurisdiction: string;
      readonly amount: Money;
      readonly authorizationId: string;
      /** Independent authorization evidence for these exact remittance terms. */
      readonly authorizationSource: WithdrawalSource;
      readonly destinationId: string;
      readonly beneficiaryPersonId: string;
      readonly route: "qualified_tax_payment" | "unknown";
      readonly source: WithdrawalSource;
    }[];
  };
  readonly authorization?: {
    readonly id: string;
    readonly operationId: string;
    readonly withdrawalId: string;
    readonly sourceAccountId: string;
    readonly bankId: string;
    readonly withholdingId: string;
    readonly grossAmount: Money;
    readonly effectiveAt: CivilDate;
    readonly routing: "cash_only_all_or_none" | "unknown";
    readonly source: WithdrawalSource;
  };
  /** Nonbinding references, never allocations or satisfaction claims. */
  readonly targetObligationIds: readonly string[];
}
export interface WithdrawalInput {
  readonly householdId: string;
  readonly knownAt: CivilDate;
  readonly cash: readonly WithdrawalCash[];
  readonly requests: readonly WithdrawalRequest[];
  readonly usage: {
    readonly status: "verified_complete" | "unknown";
    readonly operationIds: readonly string[];
    readonly withdrawalIds: readonly string[];
    readonly authorizationIds: readonly string[];
    readonly source: WithdrawalSource;
  };
}
export type WithdrawalCode = "invalid" | "unknown" | "future_law" | "unsupported" | "identity" | "authorization" | "withholding" | "routing" | "liquidity" | "duplicate";
export interface WithdrawalDiagnostic {
  readonly seam: "S7";
  readonly sourceEntityPath: string;
  readonly period: { readonly start: CivilDate; readonly endExclusive: CivilDate };
  readonly affectedOutput: "withdrawal_candidate";
  readonly coverage: "incomplete";
  readonly diagnosticCode: WithdrawalCode;
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface WithdrawalCandidate {
  readonly operationId: string;
  readonly claimId: string;
  readonly authorizationId: string;
  readonly kind: "ordinary_retirement_cash_movement_candidate";
  readonly committed: false;
  readonly postable: false;
  readonly householdId: string;
  readonly actorId: string;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly instrumentFamily: WithdrawalCash["instrumentFamily"];
  readonly taxBucket: WithdrawalCash["taxBucket"];
  readonly effectiveAt: CivilDate;
  readonly ruleSnapshotId: string;
  readonly grossAmount: Money;
  readonly netAmount: Money;
  readonly withholdingAmount: Money;
  /** Economic direction, NOT ledger debit/credit conventions or history. */
  readonly intents: readonly {
    readonly kind: "source_retirement_cash_decrease" | "owned_bank_cash_increase" | "withheld_tax_advance_payment_credit";
    readonly resourceId: string;
    readonly amount: Money;
    readonly jurisdiction: string | null;
    readonly beneficiaryPersonId: string;
    readonly instructionId: string | null;
    readonly authorizationId: string;
  }[];
  readonly incrementalEconomicIncome: Money;
  readonly incrementalEconomicExpense: Money;
  readonly incomeCharacter: "unresolved_retirement_distribution";
  readonly taxCompleteness: "incomplete";
  readonly targetObligationIds: readonly string[];
  readonly rmdSatisfaction: "not_applied";
  readonly executionCondition: "149_atomic_funding_routing_usage_revalidation";
  readonly traceRefs: readonly string[];
}
export interface WithdrawalEvaluation {
  readonly contract: "d2-shared/v1";
  readonly committed: false;
  readonly postable: false;
  readonly evidenceTier: "conditional";
  readonly coverage: "complete" | "incomplete";
  readonly candidates: readonly WithdrawalCandidate[];
  readonly diagnostics: readonly WithdrawalDiagnostic[];
  readonly funding: "incomplete";
  readonly bankSettlement: "incomplete";
  readonly tax: "incomplete";
}

const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
class Missing extends Error {
  constructor(readonly code: WithdrawalCode, readonly path: string) { super(path); }
}
const need = (ok: boolean, code: WithdrawalCode, path: string): void => { if (!ok) throw new Missing(code, path); };
const date = (d: CivilDate): void => { try { civilDate(d); } catch { throw new Missing("invalid", "date"); } };
const exact = (m: Money): void => need(m.currency.equals(USD) && !m.isNegative() && m.amount.fitsScale(2), "invalid", "exact_usd_cents");
const unique = (ids: readonly string[]): boolean => ids.every(text) && new Set(ids).size === ids.length;
/** Only freezes newly constructed output objects; immutable Money is shared safely. */
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};

/** Pure all-or-none admission. #149 must revalidate/reserve capacity at execution.
 * No funding resolver, ledger, tax calculator, or RMD satisfaction register. */
export function evaluateWithdrawals(input: WithdrawalInput): WithdrawalEvaluation {
  const candidates: WithdrawalCandidate[] = [], diagnostics: WithdrawalDiagnostic[] = [];
  const requests = [...input.requests].sort((a, b) => cmp(a.operationId, b.operationId) || cmp(a.withdrawalId, b.withdrawalId));
  for (const r of requests) {
    const refs = new Set<string>();
    const stamp = (s: WithdrawalSource, resource: string, person = r.personId): void => {
      refs.add(s.id);
      [s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive].forEach(date);
      need([s.id, s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text), "unknown", "source_identity");
      need(s.projectionStatus !== "explicit_projected", "future_law", "verified_effective_rule");
      need(s.projectionStatus === "verified", "unknown", "verified_source");
      need(s.householdId === input.householdId && s.personId === person && s.resourceId === resource, "identity", "source_scope");
      need(s.publishedAt <= input.knownAt && s.asOf <= input.knownAt && s.asOf <= r.effectiveAt &&
        s.effectiveFrom <= r.effectiveAt && r.effectiveAt < s.endExclusive, "unknown", "source_period");
    };
    try {
      date(input.knownAt); date(r.effectiveAt); exact(r.grossAmount);
      need(text(input.householdId) && r.householdId === input.householdId && [r.operationId, r.withdrawalId, r.personId, r.sourceAccountId].every(text), "identity", "request_identity");
      need(r.grossAmount.isPositive(), "invalid", "positive_gross");
      need(r.kind === "ordinary", "unsupported", "ordinary_cash_only");
      need(requests.filter(x => x.operationId === r.operationId || x.withdrawalId === r.withdrawalId).length === 1, "duplicate", "operation_or_withdrawal");
      const usage = input.usage;
      stamp(usage.source, input.householdId, "*");
      need(usage.status === "verified_complete", "unknown", "complete_usage_register");
      need(!usage.operationIds.includes(r.operationId) && !usage.withdrawalIds.includes(r.withdrawalId), "duplicate", "historical_operation_or_withdrawal");
      const accounts = input.cash.filter(a => a.accountId === r.sourceAccountId);
      need(accounts.length === 1, "identity", "unique_source_cash_snapshot");
      const a = accounts[0]!;
      stamp(a.eligibilitySource, a.accountId);
      need(a.ownerId === r.personId && a.householdId === r.householdId && a.taxBucket === r.taxBucket, "identity", "source_owner_bucket");
      need(a.beneficiaryId === null && a.taxBucket === "pretax" && ["traditional_ira", "sep_ira", "simple_ira", "workplace_plan"].includes(a.instrumentFamily), "unsupported", "owner_pretax_cash_only");
      need(a.eligibility !== "unknown", "unknown", "account_plan_eligibility");
      need(a.eligibility === "eligible_ordinary_cash" && a.unsupportedRules.length === 0, "unsupported", "eligibility_or_statutory_rules");
      if (a.instrumentFamily === "workplace_plan") {
        if (!a.planTerms) throw new Missing("unknown", "separately_sourced_plan_permission");
        stamp(a.planTerms.source, a.planTerms.planId);
        need(text(a.planTerms.planId) && a.planTerms.permission === "ordinary_cash_distribution", "unknown", "plan_distribution_permission");
      }
      const cash = a.liquidity;
      if (!cash) throw new Missing("liquidity", "settled_unencumbered_cash");
      stamp(cash.source, a.accountId); exact(cash.available); date(cash.at); date(cash.settledAt);
      need(cash.kind === "available_unencumbered_account_cash" && cash.contention === "complete_external_reservations" &&
        cash.at === r.effectiveAt && cash.source.asOf === cash.at && cash.settledAt <= cash.at, "liquidity", "payment_date_cash_and_contention");
      const total = requests.filter(x => x.sourceAccountId === a.accountId).reduce((sum, x) => { exact(x.grossAmount); return sum.plus(x.grossAmount); }, Money.zero(USD));
      need(cash.available.amount.compare(total.amount) >= 0, "liquidity", "aggregate_source_capacity");
      const b = r.bank; stamp(b.source, b.id);
      need(text(b.id) && b.id !== a.accountId && b.ownerId === r.personId && b.householdId === r.householdId, "identity", "owned_destination");
      need(b.kind === "checking" || b.kind === "savings", "routing", "checking_or_savings");
      const w = r.withholding;
      if (!w) throw new Missing("withholding", "explicit_complete_withholding_including_zero");
      stamp(w.source, w.id);
      need(text(w.id) && w.completeness === "verified_complete" && w.instructions.length > 0 && unique(w.instructions.map(i => i.id)) && unique(w.instructions.map(i => i.jurisdiction)), "withholding", "complete_unique_jurisdictions");
      need(requests.filter(x => x.withholding?.id === w.id).length === 1 && w.instructions.every(i => requests.flatMap(x => x.withholding?.instructions ?? []).filter(j => j.id === i.id).length === 1), "duplicate", "withholding_snapshot_or_instruction");
      let withheld = Money.zero(USD);
      for (const i of [...w.instructions].sort((x, y) => cmp(x.jurisdiction, y.jurisdiction))) {
        stamp(i.source, i.id); stamp(i.authorizationSource, i.authorizationId); exact(i.amount);
        need(i.source.jurisdiction === i.jurisdiction && i.authorizationSource.jurisdiction === i.jurisdiction && text(i.authorizationId) && text(i.destinationId) && i.destinationId !== a.accountId && i.destinationId !== b.id && i.beneficiaryPersonId === r.personId && i.route === "qualified_tax_payment", "routing", "authorized_tax_payment_destination_beneficiary");
        need(!usage.authorizationIds.includes(i.authorizationId) && requests.flatMap(x => x.withholding?.instructions ?? []).filter(x => x.authorizationId === i.authorizationId).length === 1, "duplicate", "remittance_authorization");
        withheld = withheld.plus(i.amount);
      }
      need(withheld.amount.compare(r.grossAmount.amount) <= 0, "withholding", "withholding_exceeds_gross");
      const auth = r.authorization;
      if (!auth) throw new Missing("authorization", "explicit_distribution_authorization");
      stamp(auth.source, auth.id); exact(auth.grossAmount); date(auth.effectiveAt);
      need(text(auth.id) && auth.operationId === r.operationId && auth.withdrawalId === r.withdrawalId && auth.sourceAccountId === a.accountId && auth.bankId === b.id && auth.withholdingId === w.id && auth.grossAmount.equals(r.grossAmount) && auth.effectiveAt === r.effectiveAt && auth.routing === "cash_only_all_or_none", "authorization", "authorization_terms");
      need(!usage.authorizationIds.includes(auth.id) && requests.filter(x => x.authorization?.id === auth.id).length === 1 && !requests.some(x => x.withholding?.instructions.some(i => i.authorizationId === auth.id)), "duplicate", "distribution_authorization");
      need(unique(r.targetObligationIds), "invalid", "rmd_reference_ids");
      const net = r.grossAmount.minus(withheld);
      candidates.push({ operationId: r.operationId, claimId: r.withdrawalId, authorizationId: auth.id,
        kind: "ordinary_retirement_cash_movement_candidate", committed: false, postable: false,
        householdId: r.householdId, actorId: r.personId, sourceAccountId: a.accountId, destinationAccountId: b.id,
        instrumentFamily: a.instrumentFamily, taxBucket: a.taxBucket, effectiveAt: r.effectiveAt,
        ruleSnapshotId: a.eligibilitySource.ruleSnapshotId, grossAmount: r.grossAmount, netAmount: net, withholdingAmount: withheld,
        intents: [
          { kind: "source_retirement_cash_decrease", resourceId: a.accountId, amount: r.grossAmount, jurisdiction: null, beneficiaryPersonId: r.personId, instructionId: null, authorizationId: auth.id },
          { kind: "owned_bank_cash_increase", resourceId: b.id, amount: net, jurisdiction: null, beneficiaryPersonId: r.personId, instructionId: null, authorizationId: auth.id },
          ...[...w.instructions].sort((x, y) => cmp(x.jurisdiction, y.jurisdiction)).map(i => ({ kind: "withheld_tax_advance_payment_credit" as const, resourceId: i.destinationId, amount: i.amount, jurisdiction: i.jurisdiction, beneficiaryPersonId: i.beneficiaryPersonId, instructionId: i.id, authorizationId: i.authorizationId })),
        ], incrementalEconomicIncome: Money.zero(USD), incrementalEconomicExpense: Money.zero(USD),
        incomeCharacter: "unresolved_retirement_distribution", taxCompleteness: "incomplete",
        targetObligationIds: [...r.targetObligationIds].sort(cmp), rmdSatisfaction: "not_applied",
        executionCondition: "149_atomic_funding_routing_usage_revalidation", traceRefs: [...refs].sort(cmp) });
    } catch (e) {
      if (!(e instanceof Missing)) throw e;
      diagnostics.push({ seam: "S7", sourceEntityPath: JSON.stringify(["withdrawals", r.operationId]),
        period: { start: r.effectiveAt, endExclusive: (nextUtcDateOnlyInstant(r.effectiveAt)?.slice(0, 10) ?? r.effectiveAt) as CivilDate },
        affectedOutput: "withdrawal_candidate", coverage: "incomplete", diagnosticCode: e.code,
        missingFacts: [e.path], ruleSnapshotId: r.authorization?.source.ruleSnapshotId ?? null, traceRefs: [...refs].sort(cmp) });
    }
  }
  diagnostics.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  const result: WithdrawalEvaluation = { contract: "d2-shared/v1", committed: false, postable: false, evidenceTier: "conditional",
    coverage: diagnostics.length ? "incomplete" : "complete", candidates: diagnostics.length ? [] : candidates,
    diagnostics, funding: "incomplete", bankSettlement: "incomplete", tax: "incomplete" };
  return freeze(result);
}
