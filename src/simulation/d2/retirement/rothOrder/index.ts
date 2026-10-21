import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Currency, DecimalAmount, Money, USD } from "../../../../values/index.js";
import type { WithdrawalSource } from "../withdrawals/index.js";

/** Domain-local seam, using the existing withdrawal provenance convention. */
export type RothSource = WithdrawalSource;
export interface RothPool {
  readonly original: Money;
  readonly available: Money;
  readonly source: RothSource;
}
export interface RothVintage extends RothPool {
  readonly id: string;
  /** Distinct component identity; taxable/nontaxable rows may share a transaction. */
  readonly transactionId: string;
  readonly accountId: string;
  readonly kind: "conversion" | "rollover" | "unknown";
  readonly originatedAt: CivilDate;
  readonly taxYear: number;
  readonly component: "taxable" | "nontaxable";
  readonly recaptureStart: CivilDate;
  readonly recaptureEndExclusive: CivilDate;
  readonly legalCharacter: "verified_roth_ira_vintage" | "unknown";
}
export interface RothAccount {
  readonly accountId: string;
  readonly ownerId: string;
  readonly family: "roth_ira" | "workplace_plan" | "traditional_ira";
  readonly taxBucket: "roth" | "pretax" | "mixed";
  readonly beneficiaryId: string | null;
  readonly source: RothSource;
  readonly cash: { readonly available: Money; readonly source: RothSource };
}
export interface RothUse {
  readonly operationId: string;
  readonly withdrawalId: string;
  readonly authorizationId: string;
  readonly accountId: string;
  readonly effectiveAt: CivilDate;
  readonly gross: Money;
  readonly contributions: Money;
  readonly earnings: Money;
  readonly vintages: readonly { readonly vintageId: string; readonly amount: Money }[];
  readonly source: RothSource;
}
export interface RothTerms {
  readonly operationId: string;
  readonly withdrawalId: string;
  readonly authorizationId: string;
  readonly personId: string;
  readonly sourceAccountId: string;
  readonly effectiveAt: CivilDate;
  /** Explicit approved economic order, unique across the batch. */
  readonly sequence: number;
  readonly gross: Money;
  readonly route: "ordinary_cash" | "inherited" | "qcd" | "rollover" | "unknown";
}
export interface RothRequest extends RothTerms {
  readonly source: RothSource;
  readonly authorization?: { readonly terms: RothTerms; readonly permission: "yes" | "unknown"; readonly source: RothSource };
  readonly qualification: {
    /** Sourced non-clock predicate; this helper never infers age or an exception. */
    readonly qualifyingCondition: "yes" | "no" | "unknown";
    readonly earlyDistribution: "yes" | "no" | "unknown";
    readonly exceptions: "verified_none" | "unknown";
    readonly source: RothSource;
  };
}
export interface RothOrderInput {
  readonly householdId: string;
  readonly personId: string;
  readonly taxYear: number;
  readonly knownAt: CivilDate;
  readonly snapshotAt: CivilDate;
  readonly accounts: readonly RothAccount[];
  readonly contributions: RothPool;
  readonly earnings: RothPool;
  readonly vintages: readonly RothVintage[];
  readonly history: readonly RothUse[];
  readonly requests: readonly RothRequest[];
  readonly rules?: {
    readonly source: RothSource;
    readonly model: "contributions_then_year_fifo_taxable_first_then_earnings" | "unsupported";
    readonly clocks: "independent_five_tax_years" | "unknown";
    readonly qualifiedStart: CivilDate;
    readonly qualifiedEndExclusive: CivilDate;
    /** Source-admitted order, including any same-year rollover tie treatment. */
    readonly vintageOrder: readonly string[];
  };
  readonly completeness?: {
    readonly source: RothSource;
    readonly status: "verified_exhaustive_owner_history" | "unknown";
    readonly accountIds: readonly string[];
    readonly vintageIds: readonly string[];
    readonly historicalOperationIds: readonly string[];
    readonly historicalWithdrawalIds: readonly string[];
    readonly historicalAuthorizationIds: readonly string[];
    readonly contributions: "verified_actual_regular_basis" | "unknown";
    readonly earnings: "verified_actual" | "unknown";
    readonly priorConsumption: "verified_complete" | "unknown";
    readonly cashReservations: "verified_complete" | "unknown";
    /** No additions, returns, adjustments or outside spending in this window. */
    readonly unchangedUntilExclusive: CivilDate;
    readonly interveningActivity: "verified_none" | "unknown";
  };
}
const flags = { committed: false, postable: false, physicalTransfer: "not_applied", taxSettlement: "incomplete" } as const;
export interface RothComponent {
  readonly character: "regular_contribution_basis" | "conversion_taxable_basis" | "conversion_nontaxable_basis" | "rollover_taxable_basis" | "rollover_nontaxable_basis" | "earnings";
  readonly vintageId: string | null;
  readonly amount: Money;
  readonly incomeCandidate: Money;
  readonly earlyDistributionCandidate: Money;
  readonly conversionRecaptureCandidate: Money;
  readonly clock: "not_applicable" | "open" | "elapsed";
}
export interface RothProposal {
  readonly contract: "d2-shared/v1";
  readonly seam: "S3/S5/S6";
  readonly committed: false;
  readonly postable: false;
  readonly physicalTransfer: "not_applied";
  readonly taxSettlement: "incomplete";
  readonly traceId: string;
  readonly personId: string;
  readonly taxYear: number;
  readonly operationId: string;
  readonly withdrawalId: string;
  readonly authorizationId: string;
  readonly sourceAccountId: string;
  readonly effectiveAt: CivilDate;
  readonly ruleSnapshotId: string;
  readonly qualified: boolean;
  readonly gross: Money;
  readonly components: readonly RothComponent[];
  readonly traceRefs: readonly string[];
}
export interface RothDiagnostic {
  readonly seam: "S7";
  readonly diagnosticCode: string;
  readonly sourceEntityPath: string;
  readonly affectedOutput: "roth_distribution_order";
  readonly coverage: "incomplete";
  readonly personId: string;
  readonly taxYear: number;
  readonly affectedAccountId: string | null;
  readonly period: { readonly start: CivilDate; readonly endExclusive: CivilDate };
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface RothOrderEvaluation {
  readonly contract: "d2-shared/v1";
  readonly committed: false;
  readonly postable: false;
  readonly physicalTransfer: "not_applied";
  readonly taxSettlement: "incomplete";
  readonly coverage: "conditional" | "incomplete";
  readonly proposals: readonly RothProposal[];
  readonly diagnostics: readonly RothDiagnostic[];
}
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const unique = (ids: readonly string[]): boolean => ids.every(text) && new Set(ids).size === ids.length;
/** Freeze detached containers, sharing only immutable value primitives. */
function immutable<T>(v: T): T {
  if (v === null || typeof v !== "object" || v instanceof Money || v instanceof Currency || v instanceof DecimalAmount) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(immutable)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, value]) => [k, immutable(value)]))) as T;
}
class Missing extends Error {
  constructor(readonly code: string, readonly path: string, readonly account: string | null = null, readonly source?: RothSource) { super(code); }
}

/** All-or-none replacement proposal; never persists or reserves basis/cash. */
export function evaluateRothOrder(input: RothOrderInput): RothOrderEvaluation {
  const refs = new Set<string>();
  const seenSources = new Map<string, string>();
  const zero = Money.zero(USD);
  const need = (ok: boolean, code: string, path: string, account: string | null = null, s?: RothSource): void => {
    if (!ok) throw new Missing(code, path, account, s);
  };
  const date = (d: CivilDate, path: string): void => { try { civilDate(d); } catch { throw new Missing("INVALID_DATE", path); } };
  const exact = (m: Money, path: string): void => need(m instanceof Money && m.currency.equals(USD) && !m.isNegative() && m.amount.fitsScale(2), "INVALID_EXACT_USD_CENTS", path);
  const stamp = (s: RothSource, resource: string, at: CivilDate, path: string, account: string | null = null): void => {
    need(Boolean(s), "MISSING_SOURCE", path, account);
    [s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive].forEach(d => date(d, path));
    need([s.id, s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text), "SOURCE_IDENTITY", path, account, s);
    refs.add(s.id);
    const encoded = JSON.stringify([s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version,
      s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive, s.projectionStatus, s.householdId, s.personId, s.resourceId]);
    need(!seenSources.has(s.id) || seenSources.get(s.id) === encoded, "CONFLICTING_SOURCE_ID", path, account, s);
    seenSources.set(s.id, encoded);
    need(s.householdId === input.householdId && s.personId === input.personId && s.resourceId === resource, "SOURCE_OWNER_OR_RESOURCE", path, account, s);
    need(s.projectionStatus === "verified" && s.publishedAt <= s.asOf && s.asOf <= at && s.asOf <= input.knownAt &&
      s.effectiveFrom <= at && at < s.endExclusive, "UNVERIFIED_LATE_OR_INEFFECTIVE_SOURCE", path, account, s);
    need(s.ruleSnapshotId === input.rules?.source.ruleSnapshotId, "CONFLICTING_RULE_SNAPSHOT", path, account, s);
    need(s.jurisdiction === input.rules?.source.jurisdiction, "CONFLICTING_JURISDICTION", path, account, s);
  };
  const ids = (attested: readonly string[], actual: readonly string[], path: string): void => need(unique(attested) && unique(actual) &&
    attested.length === actual.length && actual.every(id => attested.includes(id)), "NONEXHAUSTIVE_REGISTER", path);
  const clock = (start: CivilDate, end: CivilDate, path: string): void => {
    date(start, path); date(end, path);
    const y = Number(start.slice(0, 4));
    need(start === `${y}-01-01` && y >= 1000 && y <= 9994 && end === `${y + 5}-01-01`, "UNSUPPORTED_FIVE_YEAR_CLOCK", path);
  };
  try {
    need(text(input.personId) && text(input.householdId) && Number.isSafeInteger(input.taxYear) && input.taxYear >= 1000 && input.taxYear < 9999, "INVALID_IDENTITY_OR_YEAR", "input");
    date(input.knownAt, "knownAt"); date(input.snapshotAt, "snapshotAt");
    need(input.snapshotAt <= input.knownAt, "SNAPSHOT_AFTER_CUTOFF", "snapshotAt");
    need(input.accounts.length > 0 && input.accounts.length <= 512 && input.vintages.length <= 10000 && input.history.length <= 10000 && input.requests.length <= 512, "INPUT_LIMIT", "input");
    const rules = input.rules;
    if (!rules) throw new Missing("MISSING_APPLICABLE_RULE", "rules");
    stamp(rules.source, input.personId, input.snapshotAt, "rules");
    need(rules.source.ruleFamily === "roth_ira_ordering" && rules.model === "contributions_then_year_fifo_taxable_first_then_earnings" && rules.clocks === "independent_five_tax_years", "UNSUPPORTED_RULE_MODEL", "rules", null, rules.source);
    clock(rules.qualifiedStart, rules.qualifiedEndExclusive, "rules.qualifiedClock");
    need(rules.qualifiedStart <= input.snapshotAt, "FUTURE_QUALIFIED_CLOCK", "rules.qualifiedClock", null, rules.source);
    const proof = input.completeness;
    if (!proof) throw new Missing("MISSING_EXHAUSTIVENESS_PROOF", "completeness");
    stamp(proof.source, input.personId, input.snapshotAt, "completeness");
    need(proof.source.asOf === input.snapshotAt, "STALE_INVENTORY_PROOF", "completeness", null, proof.source);
    date(proof.unchangedUntilExclusive, "completeness.unchangedUntilExclusive");
    need(proof.status === "verified_exhaustive_owner_history" && proof.contributions === "verified_actual_regular_basis" && proof.earnings === "verified_actual" &&
      proof.priorConsumption === "verified_complete" && proof.cashReservations === "verified_complete" && proof.interveningActivity === "verified_none" &&
      input.snapshotAt < proof.unchangedUntilExclusive, "UNKNOWN_BASIS_HISTORY_OR_ACTIVITY", "completeness", null, proof.source);
    ids(proof.accountIds, input.accounts.map(a => a.accountId), "completeness.accountIds");
    ids(proof.vintageIds, input.vintages.map(v => v.id), "completeness.vintageIds");
    ids(proof.historicalOperationIds, input.history.map(h => h.operationId), "completeness.historicalOperationIds");
    ids(proof.historicalWithdrawalIds, input.history.map(h => h.withdrawalId), "completeness.historicalWithdrawalIds");
    ids(proof.historicalAuthorizationIds, input.history.map(h => h.authorizationId), "completeness.historicalAuthorizationIds");
    const cash = new Map<string, Money>();
    for (const a of [...input.accounts].sort((a, b) => cmp(a.accountId, b.accountId))) {
      const path = `accounts.${a.accountId}`;
      stamp(a.source, a.accountId, input.snapshotAt, path, a.accountId);
      need(a.ownerId === input.personId && a.family === "roth_ira" && a.taxBucket === "roth" && a.beneficiaryId === null, "UNSUPPORTED_ACCOUNT_OR_OWNER", path, a.accountId, a.source);
      exact(a.cash.available, `${path}.cash`); stamp(a.cash.source, a.accountId, input.snapshotAt, `${path}.cash`, a.accountId);
      need(a.cash.source.asOf === input.snapshotAt, "STALE_CASH", `${path}.cash`, a.accountId, a.cash.source);
      cash.set(a.accountId, a.cash.available);
    }
    const pool = (p: RothPool, resource: string, path: string): void => {
      exact(p.original, path); exact(p.available, path); stamp(p.source, resource, input.snapshotAt, path);
      need(p.source.asOf === input.snapshotAt, "STALE_POOL", path, null, p.source);
      need(p.available.compare(p.original) <= 0, "CORRUPTED_POOL", path, null, p.source);
    };
    pool(input.contributions, input.personId, "contributions"); pool(input.earnings, input.personId, "earnings");
    ids(rules.vintageOrder, input.vintages.map(v => v.id), "rules.vintageOrder");
    const vintages = rules.vintageOrder.map(id => input.vintages.find(v => v.id === id)!);
    need(vintages.every((v, i) => i === 0 || vintages[i - 1]!.taxYear < v.taxYear ||
      (vintages[i - 1]!.taxYear === v.taxYear && !(vintages[i - 1]!.component === "nontaxable" && v.component === "taxable"))),
    "NONSTATUTORY_VINTAGE_ORDER", "rules.vintageOrder", null, rules.source);
    need(unique(vintages.map(v => JSON.stringify([v.transactionId, v.component]))), "DUPLICATE_VINTAGE_TRANSACTION", "vintages");
    const remaining = new Map<string, Money>();
    for (const v of vintages) {
      const path = `vintages.${v.id}`;
      pool(v, v.accountId, path); date(v.originatedAt, path); clock(v.recaptureStart, v.recaptureEndExclusive, path);
      need(text(v.transactionId) && cash.has(v.accountId) && ["conversion", "rollover"].includes(v.kind) && ["taxable", "nontaxable"].includes(v.component) &&
        v.legalCharacter === "verified_roth_ira_vintage" && Number.isSafeInteger(v.taxYear) && v.taxYear === Number(v.originatedAt.slice(0, 4)) &&
        v.originatedAt < input.snapshotAt && v.recaptureStart <= v.originatedAt && rules.qualifiedStart <= v.originatedAt &&
        v.source.asOf >= v.originatedAt && (v.kind !== "conversion" || v.recaptureStart === `${v.taxYear}-01-01`), "UNQUALIFIED_VINTAGE", path, v.accountId, v.source);
      const sibling = vintages.find(other => other !== v && other.transactionId === v.transactionId);
      need(!sibling || (sibling.accountId === v.accountId && sibling.originatedAt === v.originatedAt && sibling.kind === v.kind &&
        sibling.recaptureStart === v.recaptureStart && sibling.recaptureEndExclusive === v.recaptureEndExclusive), "CONFLICTING_VINTAGE_TRANSACTION", path, v.accountId, v.source);
      remaining.set(v.id, v.original);
    }
    let contributions = input.contributions.original, earnings = input.earnings.original;
    const spend = (available: Money, amount: Money, path: string): Money => {
      exact(amount, path); need(amount.compare(available) <= 0, "HISTORY_OR_BATCH_OVERSPEND", path); return available.minus(amount);
    };
    for (const h of [...input.history].sort((a, b) => cmp(a.effectiveAt, b.effectiveAt) || cmp(a.operationId, b.operationId))) {
      const path = `history.${h.operationId}`;
      date(h.effectiveAt, path); stamp(h.source, h.accountId, input.snapshotAt, path, h.accountId);
      need(cash.has(h.accountId) && h.effectiveAt < input.snapshotAt && h.source.asOf >= h.effectiveAt && rules.qualifiedStart <= h.effectiveAt, "INVALID_HISTORY", path, h.accountId, h.source);
      exact(h.gross, path); contributions = spend(contributions, h.contributions, path); earnings = spend(earnings, h.earnings, path);
      need(unique(h.vintages.map(v => v.vintageId)), "DUPLICATE_HISTORY_COMPONENT", path);
      let total = h.contributions.plus(h.earnings);
      for (const allocation of [...h.vintages].sort((a, b) => cmp(a.vintageId, b.vintageId))) {
        const v = vintages.find(v => v.id === allocation.vintageId);
        need(Boolean(v) && v!.originatedAt <= h.effectiveAt, "UNKNOWN_OR_FUTURE_HISTORY_VINTAGE", path, h.accountId, h.source);
        remaining.set(allocation.vintageId, spend(remaining.get(allocation.vintageId)!, allocation.amount, path));
        total = total.plus(allocation.amount);
      }
      need(total.equals(h.gross), "HISTORY_DECOMPOSITION", path, h.accountId, h.source);
    }
    need(contributions.equals(input.contributions.available) && earnings.equals(input.earnings.available) &&
      vintages.every(v => remaining.get(v.id)!.equals(v.available)), "UNRECONCILED_PRIOR_CONSUMPTION", "history");
    const all = [...input.history, ...input.requests];
    need(unique(all.map(r => r.operationId)) && unique(all.map(r => r.withdrawalId)) && unique(all.map(r => r.authorizationId)), "REUSED_OPERATION_WITHDRAWAL_OR_AUTHORIZATION", "requests/history");
    need(unique(input.requests.map(r => String(r.sequence))) && input.requests.every(r => Number.isSafeInteger(r.sequence) && r.sequence >= 0), "UNPROVEN_BATCH_ORDER", "requests");
    const proposals: RothProposal[] = [];
    for (const r of [...input.requests].sort((a, b) => cmp(a.effectiveAt, b.effectiveAt) || a.sequence - b.sequence)) {
      const path = `requests.${r.operationId}`;
      date(r.effectiveAt, path); exact(r.gross, path);
      stamp(r.source, r.sourceAccountId, r.effectiveAt, path, r.sourceAccountId);
      need(r.personId === input.personId && cash.has(r.sourceAccountId) && r.route === "ordinary_cash", "UNSUPPORTED_ROUTE_OR_OWNER", path, r.sourceAccountId, r.source);
      need(r.effectiveAt >= input.snapshotAt && r.effectiveAt < proof.unchangedUntilExclusive && Number(r.effectiveAt.slice(0, 4)) === input.taxYear &&
        r.effectiveAt < rules.source.endExclusive && r.effectiveAt < proof.source.endExclusive && r.effectiveAt <= input.knownAt, "UNCOVERED_EVENT_WINDOW", path, r.sourceAccountId, r.source);
      for (const a of input.accounts) need(r.effectiveAt < a.source.endExclusive && r.effectiveAt < a.cash.source.endExclusive, "EXPIRED_ACCOUNT_EVIDENCE", path, a.accountId, a.source);
      need([input.contributions.source, input.earnings.source, ...vintages.map(v => v.source)].every(s => r.effectiveAt < s.endExclusive), "EXPIRED_POOL_EVIDENCE", path);
      const auth = r.authorization;
      if (!auth) throw new Missing("MISSING_AUTHORIZATION", path, r.sourceAccountId, r.source);
      stamp(auth.source, r.sourceAccountId, r.effectiveAt, `${path}.authorization`, r.sourceAccountId);
      const t = auth.terms;
      need(auth.permission === "yes" && t.operationId === r.operationId && t.withdrawalId === r.withdrawalId && t.authorizationId === r.authorizationId &&
        t.personId === r.personId && t.sourceAccountId === r.sourceAccountId && t.effectiveAt === r.effectiveAt && t.sequence === r.sequence &&
        t.route === r.route && t.gross instanceof Money && t.gross.equals(r.gross), "AUTHORIZATION_TERMS_MISMATCH", path, r.sourceAccountId, auth.source);
      stamp(r.qualification.source, input.personId, r.effectiveAt, `${path}.qualification`, r.sourceAccountId);
      const q = r.qualification;
      need(["yes", "no"].includes(q.qualifyingCondition) && ["yes", "no"].includes(q.earlyDistribution) && q.exceptions === "verified_none", "UNKNOWN_QUALIFICATION_OR_EXCEPTION", path, r.sourceAccountId, q.source);
      const qualified = r.effectiveAt >= rules.qualifiedEndExclusive && q.qualifyingCondition === "yes";
      need(r.gross.compare(cash.get(r.sourceAccountId)!) <= 0, "HISTORY_OR_BATCH_OVERSPEND", `${path}.cash`, r.sourceAccountId, r.source);
      cash.set(r.sourceAccountId, cash.get(r.sourceAccountId)!.minus(r.gross));
      let left = r.gross;
      const components: RothComponent[] = [];
      const take = (available: Money): Money => { const used = left.compare(available) < 0 ? left : available; left = left.minus(used); return used; };
      const regular = take(contributions); contributions = contributions.minus(regular);
      if (regular.isPositive()) components.push({ character: "regular_contribution_basis", vintageId: null, amount: regular, incomeCandidate: zero,
        earlyDistributionCandidate: zero, conversionRecaptureCandidate: zero, clock: "not_applicable" });
      for (const v of vintages) {
        const amount = take(remaining.get(v.id)!); remaining.set(v.id, remaining.get(v.id)!.minus(amount));
        if (amount.isZero()) continue;
        const open = r.effectiveAt < v.recaptureEndExclusive;
        components.push({ character: v.kind === "conversion" ? (v.component === "taxable" ? "conversion_taxable_basis" : "conversion_nontaxable_basis") :
          (v.component === "taxable" ? "rollover_taxable_basis" : "rollover_nontaxable_basis"), vintageId: v.id, amount, incomeCandidate: zero,
          earlyDistributionCandidate: zero, conversionRecaptureCandidate: !qualified && q.earlyDistribution === "yes" && open && v.component === "taxable" ? amount : zero,
          clock: open ? "open" : "elapsed" });
      }
      const earned = take(earnings); earnings = earnings.minus(earned);
      if (earned.isPositive()) components.push({ character: "earnings", vintageId: null, amount: earned, incomeCandidate: qualified ? zero : earned,
        earlyDistributionCandidate: !qualified && q.earlyDistribution === "yes" ? earned : zero, conversionRecaptureCandidate: zero,
        clock: r.effectiveAt < rules.qualifiedEndExclusive ? "open" : "elapsed" });
      need(left.isZero(), "INSUFFICIENT_ATTESTED_BASIS_VINTAGES_EARNINGS", path, r.sourceAccountId, r.source);
      proposals.push({ contract: "d2-shared/v1", seam: "S3/S5/S6", ...flags,
        traceId: JSON.stringify(["roth-order/v1", input.householdId, input.personId, input.taxYear, rules.source.ruleSnapshotId, r.operationId, r.withdrawalId, r.authorizationId]),
        personId: input.personId, taxYear: input.taxYear, operationId: r.operationId, withdrawalId: r.withdrawalId, authorizationId: r.authorizationId,
        sourceAccountId: r.sourceAccountId, effectiveAt: r.effectiveAt, ruleSnapshotId: rules.source.ruleSnapshotId, qualified, gross: r.gross,
        components, traceRefs: [] });
    }
    const traceRefs = [...refs].sort(cmp);
    return immutable({ contract: "d2-shared/v1", ...flags, coverage: "conditional", proposals: proposals.map(p => ({ ...p, traceRefs })), diagnostics: [] });
  } catch (e) {
    if (!(e instanceof Missing) && !(e instanceof TypeError)) throw e;
    const failure = e instanceof Missing ? e : new Missing("MALFORMED_INPUT", "input");
    return immutable({ contract: "d2-shared/v1", ...flags, coverage: "incomplete", proposals: [], diagnostics: [{ seam: "S7", diagnosticCode: failure.code,
      sourceEntityPath: failure.path, affectedOutput: "roth_distribution_order", coverage: "incomplete", personId: input.personId, taxYear: input.taxYear,
      affectedAccountId: failure.account, period: { start: `${input.taxYear}-01-01` as CivilDate, endExclusive: `${input.taxYear + 1}-01-01` as CivilDate },
      missingFacts: [failure.path], ruleSnapshotId: failure.source?.ruleSnapshotId ?? input.rules?.source.ruleSnapshotId ?? null,
      traceRefs: [...new Set([...refs, ...(failure.source ? [failure.source.id] : [])])].sort(cmp) }] });
  }
}
