import { civilDate, durationBetween, type CivilDate } from "../../../../time/index.js";
import { Currency, Money, decimal } from "../../../../values/index.js";

export interface Window { readonly start: CivilDate; readonly endExclusive: CivilDate }
/** Domain-local S1/S2 evidence. #149 owns the shared adapter and all posting. */
export interface Source extends Window {
  readonly householdId: string;
  readonly personId: string;
  readonly lineId: string;
  readonly liabilityAccountId: string;
  readonly bankAccountId: string;
  readonly ruleSnapshotId: string;
  readonly jurisdiction: string;
  readonly sourcePublication: string;
  readonly publishedAt: CivilDate;
  readonly asOf: CivilDate;
  readonly version: string;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export interface Observation {
  readonly observationId: string;
  readonly indexId: string;
  readonly observedAt: CivilDate;
  /** Nominal annual rate in exact millionths, never floating point. */
  readonly ratePpm: bigint;
  readonly source: Source;
}
export interface RateContract {
  readonly source: Source;
  readonly indexId: string;
  readonly spreadPpm: bigint;
  readonly lookbackDays: number;
  readonly resetIntervalDays: number;
  readonly priorResetAt: CivilDate;
  readonly priorRatePpm: bigint;
  readonly nextResetOrdinal: number;
  readonly roundingIncrementPpm: bigint;
  readonly rounding: "half_up" | "down";
  readonly initialCapPpm: bigint;
  readonly recurringCapPpm: bigint;
  readonly lifetimeFloorPpm: bigint;
  readonly lifetimeCeilingPpm: bigint;
  /** Explicit null means this sourced contract has no additional legal ceiling. */
  readonly legalMaximum: { readonly ratePpm: bigint; readonly source: Source } | null;
  readonly resets: readonly { readonly effectiveAt: CivilDate; readonly sequence: number; readonly source: Source }[];
  readonly observations: readonly Observation[];
}
export interface PrincipalEvent {
  readonly operationId: string;
  readonly authorizationId: string;
  readonly kind: "draw" | "principal_repayment";
  readonly effectiveAt: CivilDate;
  readonly sequence: number;
  readonly actorId: string;
  readonly bankAccountId: string;
  readonly authorized: boolean;
  readonly amount: Money;
  readonly source: Source;
  /** External non-reusable funding evidence; no cash is reserved here. */
  readonly funding: { readonly fundingId: string; readonly effectiveAt: CivilDate; readonly amount: Money; readonly source: Source } | null;
}
export interface HelocRequest {
  readonly period: Window;
  readonly evaluatedAsOf: CivilDate;
  readonly householdId: string;
  readonly ownerId: string;
  readonly borrowerId: string;
  readonly lineId: string;
  readonly liabilityAccountId: string;
  readonly bankAccountId: string;
  readonly currency: Currency;
  readonly source: Source;
  readonly creditLimit: Money;
  readonly openingPrincipal: Money;
  readonly openedAt: CivilDate;
  readonly closedAt: CivilDate;
  readonly maturityAt: CivilDate;
  readonly drawWindow: Window;
  readonly revokedAt: CivilDate | null;
  readonly phases: readonly (Window & { readonly kind: "interest_only_draw" | "amortizing" | "balloon" })[];
  readonly rate: RateContract | null;
  readonly interest: {
    readonly source: Source;
    readonly dayCount: "actual_365_fixed" | "actual_360" | "unknown";
    readonly compounding: "simple" | "capitalized";
    readonly posting: "period_end_after_daily_activity";
    readonly rounding: "half_up" | "down";
    readonly dueAt: CivilDate;
  };
  readonly events: readonly PrincipalEvent[];
}
export type DiagnosticCode = "INVALID_CONTRACT" | "SOURCE_UNAVAILABLE" | "IDENTITY_MISMATCH"
  | "INVALID_MONEY" | "DUPLICATE_EVENT" | "AMBIGUOUS_ORDER" | "DRAW_UNAVAILABLE"
  | "CREDIT_LIMIT_EXCEEDED" | "UNFUNDED_PAYMENT" | "INVALID_PRINCIPAL"
  | "RATE_TERMS_REQUIRED" | "RESET_SCHEDULE_INVALID" | "INDEX_UNAVAILABLE"
  | "UNSUPPORTED_RATE_VARIANT" | "UNSUPPORTED_INTEREST_CONVENTION" | "UNSUPPORTED_REPAYMENT_PHASE";
export interface Diagnostic {
  readonly diagnosticCode: DiagnosticCode;
  readonly sourceEntityPath: string;
  readonly period: Window;
  readonly affectedOutput: "heloc_draw_interest_and_payment";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
export interface Movement {
  readonly operationId: string;
  readonly authorizationId: string;
  readonly effectiveAt: CivilDate;
  readonly kind: "draw" | "principal_repayment";
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly cashDelta: Money;
  readonly liabilityDelta: Money;
  readonly income: Money;
  readonly expense: Money;
  readonly netWorthDelta: Money;
  readonly recognition: "none";
  readonly status: "uncommitted";
  readonly ruleSnapshotId: string;
  readonly dependsOn: readonly string[];
}
export interface HelocProposal {
  readonly contractVersion: "d2-shared/v1";
  readonly instrumentFamily: "heloc";
  readonly householdId: string;
  readonly personId: string;
  readonly lineId: string;
  readonly liabilityAccountId: string;
  readonly period: Window;
  readonly coverage: "complete";
  readonly confidence: "verified_source_conditional_execution";
  readonly movements: readonly Movement[];
  readonly statesIfExecuted: readonly { readonly effectiveAt: CivilDate; readonly principal: Money; readonly ratePpm: bigint }[];
  readonly closingPrincipalIfExecuted: Money;
  readonly unusedCreditIfExecuted: Money;
  readonly interestExpenseProposal: {
    readonly operationId: string; readonly effectiveAt: CivilDate; readonly amount: Money;
    readonly claimId: string; readonly ruleSnapshotId: string;
    readonly dependsOn: readonly string[];
  };
  readonly claim: { readonly claimId: string; readonly effectiveAt: CivilDate; readonly dueAt: CivilDate; readonly amount: Money };
  readonly settlementIntent: {
    readonly operationId: string; readonly claimId: string; readonly effectiveAt: CivilDate;
    readonly sourceAccountId: string; readonly destinationAccountId: string;
    readonly amount: Money; readonly recognition: "none"; readonly status: "uncommitted_requires_funding";
    readonly ruleSnapshotId: string; readonly dependsOn: readonly string[];
  } | null;
  readonly evidence: HelocRequest;
  readonly traceRefs: readonly string[];
}
export interface HelocResult { readonly coverage: "complete" | "incomplete"; readonly proposals: readonly HelocProposal[]; readonly diagnostics: readonly Diagnostic[] }

const dateOK = (d: CivilDate): boolean => { try { return civilDate(d) === d; } catch { return false; } };
const windowOK = (w: Window): boolean => dateOK(w.start) && dateOK(w.endExclusive) && w.start < w.endExclusive;
const covers = (s: Window, w: Window): boolean => s.start <= w.start && s.endExclusive >= w.endExclusive;
const inside = (d: CivilDate, w: Window): boolean => d >= w.start && d < w.endExclusive;
const named = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const shift = (d: CivilDate, days: number): CivilDate => civilDate(new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10));
const snapshot = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money || v instanceof Currency) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, item]) => [k, snapshot(item)]))) as T;
};
const min = (a: bigint, b: bigint): bigint => a < b ? a : b;
const max = (a: bigint, b: bigint): bigint => a > b ? a : b;
const rounded = (n: bigint, d: bigint, mode: "half_up" | "down"): bigint => n / d + (mode === "half_up" && (n % d) * 2n >= d ? 1n : 0n);

/** Pure isolated proposal. Any diagnostic suppresses the entire period. */
export function proposeHeloc(r: HelocRequest): HelocResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: DiagnosticCode, fact: string, s = r.source): void => {
    diagnostics.push({ diagnosticCode: code, sourceEntityPath: `heloc/${r.lineId}`, period: r.period,
      affectedOutput: "heloc_draw_interest_and_payment", coverage: "incomplete", missingFacts: [fact],
      ruleSnapshotId: s.ruleSnapshotId, traceRefs: [r.lineId, s.sourcePublication] });
  };
  const incomplete = (): HelocResult => snapshot<HelocResult>({ coverage: "incomplete", proposals: [],
    diagnostics: [...diagnostics].sort((a, b) => {
      const left = JSON.stringify(a); const right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }) });
  if (!windowOK(r.period) || !dateOK(r.evaluatedAsOf) || r.period.start < "0101-01-01" || r.period.endExclusive > "9900-01-01") {
    fail("INVALID_CONTRACT", "Valid half-open period within supported calendar years 0101–9899 and evaluation date required"); return incomplete();
  }
  const sourceOK = (s: Source, w: Window = r.period, knownAt = r.evaluatedAsOf): boolean => {
    const ok = windowOK(s) && covers(s, w) && dateOK(s.publishedAt) && dateOK(s.asOf)
      && s.publishedAt <= s.asOf && s.asOf <= knownAt && s.asOf <= r.evaluatedAsOf
      && s.projectionStatus === "verified"
      && [s.ruleSnapshotId, s.sourcePublication, s.jurisdiction, s.version].every(named)
      && s.householdId === r.householdId && s.personId === r.borrowerId && s.lineId === r.lineId
      && s.liabilityAccountId === r.liabilityAccountId && s.bankAccountId === r.bankAccountId;
    if (!ok) fail("SOURCE_UNAVAILABLE", "Matching verified evidence covering the interval, available by the required as-of date", s);
    return ok;
  };
  const cents = (m: Money): bigint => {
    const value = m.amount.times(decimal("100")).toString();
    if (!m.currency.equals(r.currency) || !/^-?\d+$/.test(value)) {
      fail("INVALID_MONEY", "Matching currency and integer cents required"); return 0n;
    }
    return BigInt(value);
  };
  const money = (n: bigint): Money => Money.parse(n.toString(), r.currency).times(decimal("0.01"));
  if (r.currency.minorUnitScale !== 2) fail("INVALID_MONEY", "Only two-decimal currencies admitted");
  sourceOK(r.source, r.period, r.period.start);
  if (![r.householdId, r.ownerId, r.borrowerId, r.lineId, r.liabilityAccountId, r.bankAccountId].every(named)
    || r.ownerId !== r.borrowerId || new Set([r.lineId, r.liabilityAccountId, r.bankAccountId]).size !== 3)
    fail("IDENTITY_MISMATCH", "Distinct line/liability/bank IDs and matching owner/borrower required");
  let principal = cents(r.openingPrincipal);
  const limit = cents(r.creditLimit);
  if (principal < 0n || limit < 0n || principal > limit) fail("INVALID_PRINCIPAL", "Opening principal must be within line cap");
  if (!dateOK(r.openedAt) || !dateOK(r.closedAt) || !dateOK(r.maturityAt)
    || !windowOK(r.drawWindow) || r.openedAt > r.drawWindow.start
    || r.drawWindow.endExclusive > r.closedAt || r.closedAt > r.maturityAt
    || (r.revokedAt !== null && !dateOK(r.revokedAt))) fail("INVALID_CONTRACT", "Ordered line, draw, closing and maturity dates required");
  const phases = [...r.phases].sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  if (!phases.length || phases.some((p, i) => !windowOK(p) || (i > 0 && phases[i - 1]!.endExclusive !== p.start))
    || phases[0]!.start !== r.openedAt || phases[phases.length - 1]!.endExclusive !== r.maturityAt)
    fail("INVALID_CONTRACT", "Contiguous phases from opening to maturity required");
  if (!phases.some(p => p.kind === "interest_only_draw" && covers(p, r.period))
    || r.period.start < r.openedAt || r.period.endExclusive > r.maturityAt)
    fail("UNSUPPORTED_REPAYMENT_PHASE", "Only covered interest-only draw phase supported; amortizing/balloon/maturity payoff requires another approved evaluator");
  sourceOK(r.interest.source, r.period, r.period.start);
  if (!["actual_365_fixed", "actual_360"].includes(r.interest.dayCount) || r.interest.compounding !== "simple"
    || r.interest.posting !== "period_end_after_daily_activity" || !["half_up", "down"].includes(r.interest.rounding)
    || !dateOK(r.interest.dueAt) || r.interest.dueAt < r.period.endExclusive)
    fail("UNSUPPORTED_INTEREST_CONVENTION", "Sourced simple actual/365 or actual/360, period-end rounding/posting and due date required");
  const rate = r.rate;
  if (!rate) { fail("RATE_TERMS_REQUIRED", "Index, spread, schedule, prior rate and caps/floors required"); return incomplete(); }
  sourceOK(rate.source, r.period, r.period.start);
  if (!named(rate.indexId) || !Number.isSafeInteger(rate.lookbackDays) || rate.lookbackDays < 0 || rate.lookbackDays > 3660
    || !Number.isSafeInteger(rate.resetIntervalDays) || rate.resetIntervalDays <= 0 || rate.resetIntervalDays > 3660
    || !Number.isSafeInteger(rate.nextResetOrdinal) || rate.nextResetOrdinal < 1
    || !dateOK(rate.priorResetAt) || rate.priorResetAt < "0101-01-01" || rate.priorResetAt > r.period.start || rate.priorResetAt < r.openedAt
    || rate.roundingIncrementPpm <= 0n || !["half_up", "down"].includes(rate.rounding)
    || rate.initialCapPpm < 0n || rate.recurringCapPpm < 0n || rate.lifetimeFloorPpm < 0n
    || rate.lifetimeFloorPpm > rate.lifetimeCeilingPpm || rate.priorRatePpm < rate.lifetimeFloorPpm
    || rate.priorRatePpm > rate.lifetimeCeilingPpm) {
    fail("UNSUPPORTED_RATE_VARIANT", "Valid nonnegative nominal bounds, prior reset, rounding and bounded fixed-day interval required"); return incomplete();
  }
  if (rate.legalMaximum) {
    sourceOK(rate.legalMaximum.source, r.period, r.period.start);
    if (rate.legalMaximum.ratePpm < rate.lifetimeFloorPpm || rate.priorRatePpm > rate.legalMaximum.ratePpm)
      fail("INVALID_CONTRACT", "Legal maximum must accommodate floor and prior rate");
  }
  const resets = [...rate.resets].sort((a, b) => a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : 0);
  let next = shift(rate.priorResetAt, rate.resetIntervalDays);
  if (next < r.period.start) fail("RESET_SCHEDULE_INVALID", "Prior reset must immediately precede the next scheduled reset");
  let index = 0;
  while (next < r.period.endExclusive && next >= r.period.start) {
    if (resets[index]?.effectiveAt !== next) { fail("RESET_SCHEDULE_INVALID", `Explicit reset required at ${next}`); break; }
    index++; next = shift(next, rate.resetIntervalDays);
  }
  if (index !== resets.length) fail("RESET_SCHEDULE_INVALID", "Extra, duplicate or out-of-period resets");
  const ids = new Set<string>();
  const claimId = `heloc/${r.lineId}/${r.period.start}/${r.period.endExclusive}/interest`;
  ids.add(`${claimId}/recognize`); ids.add(`${claimId}/settle`);
  const authorizations = new Set<string>();
  const fundingIds = new Set<string>();
  for (const o of rate.observations) {
    if (!named(o.observationId) || ids.has(o.observationId) || !dateOK(o.observedAt)) fail("DUPLICATE_EVENT", "Unique valid observation identities required");
    ids.add(o.observationId);
  }
  for (const e of r.events) {
    sourceOK(e.source, r.period, e.effectiveAt);
    if (!named(e.operationId) || !named(e.authorizationId) || ids.has(e.operationId) || authorizations.has(e.authorizationId)) fail("DUPLICATE_EVENT", "Unique operation and authorization IDs required");
    ids.add(e.operationId); authorizations.add(e.authorizationId);
    if (!dateOK(e.effectiveAt) || !inside(e.effectiveAt, r.period)) fail("INVALID_CONTRACT", "Event outside half-open period");
    if (!e.authorized || e.actorId !== r.borrowerId || e.bankAccountId !== r.bankAccountId) fail("IDENTITY_MISMATCH", "Explicit borrower authorization and named bank required");
    if (cents(e.amount) <= 0n) fail("INVALID_MONEY", "Positive event amount required");
    if (e.kind !== "draw" && e.kind !== "principal_repayment") fail("INVALID_CONTRACT", "Unsupported principal operation");
    if (e.kind === "principal_repayment") {
      if (!e.funding) fail("UNFUNDED_PAYMENT", "External funding evidence required");
      else {
        sourceOK(e.funding.source, r.period, e.effectiveAt);
        if (!named(e.funding.fundingId) || fundingIds.has(e.funding.fundingId) || e.funding.effectiveAt !== e.effectiveAt
          || cents(e.funding.amount) < cents(e.amount)) fail("UNFUNDED_PAYMENT", "Unique sufficient funding evidence for this exact effective date required");
        fundingIds.add(e.funding.fundingId);
      }
    }
  }
  const activity = [
    ...r.events.map(event => ({ effectiveAt: event.effectiveAt, sequence: event.sequence, event, reset: null })),
    ...resets.map(reset => ({ effectiveAt: reset.effectiveAt, sequence: reset.sequence, event: null, reset })),
  ].sort((a, b) => a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : a.sequence - b.sequence);
  activity.forEach((a, i) => {
    if (!Number.isSafeInteger(a.sequence) || a.sequence < 0 || (i > 0 && activity[i - 1]!.effectiveAt === a.effectiveAt && activity[i - 1]!.sequence === a.sequence)) fail("AMBIGUOUS_ORDER", "Unique sourced within-day sequence required before daily accrual");
  });
  if (diagnostics.length) return incomplete();
  let currentRate = rate.priorRatePpm;
  let ordinal = rate.nextResetOrdinal;
  let numerator = 0n;
  let cursor = r.period.start;
  const denominator = 1000000n * (r.interest.dayCount === "actual_360" ? 360n : 365n);
  const movements: Movement[] = [];
  const states: { effectiveAt: CivilDate; principal: Money; ratePpm: bigint }[] = [{ effectiveAt: cursor, principal: money(principal), ratePpm: currentRate }];
  for (const a of activity) {
    numerator += principal * currentRate * durationBetween(cursor, a.effectiveAt).days;
    cursor = a.effectiveAt;
    if (a.reset) {
      const end = shift(a.effectiveAt, rate.resetIntervalDays);
      sourceOK(a.reset.source, { start: a.effectiveAt, endExclusive: end < r.period.endExclusive ? end : r.period.endExclusive }, a.effectiveAt);
      const observedAt = shift(a.effectiveAt, -rate.lookbackDays);
      const observations = rate.observations.filter(o => o.indexId === rate.indexId && o.observedAt === observedAt);
      const o = observations[0];
      if (observations.length !== 1 || !o) { fail("INDEX_UNAVAILABLE", `Exactly one ${rate.indexId} observation at ${observedAt} required`); break; }
      if (o.source.publishedAt < o.observedAt) { fail("INDEX_UNAVAILABLE", "Observation cannot be published before its observation date", o.source); break; }
      if (!sourceOK(o.source, { start: observedAt, endExclusive: shift(observedAt, 1) }, a.effectiveAt)) break;
      const raw = o.ratePpm + rate.spreadPpm;
      if (raw < 0n) { fail("UNSUPPORTED_RATE_VARIANT", "Negative index-plus-spread requires separate admission", o.source); break; }
      const candidate = rounded(raw, rate.roundingIncrementPpm, rate.rounding) * rate.roundingIncrementPpm;
      const cap = ordinal === 1 ? rate.initialCapPpm : rate.recurringCapPpm;
      const low = max(rate.lifetimeFloorPpm, currentRate - cap);
      const high = min(min(rate.lifetimeCeilingPpm, rate.legalMaximum?.ratePpm ?? rate.lifetimeCeilingPpm), currentRate + cap);
      currentRate = max(low, min(high, candidate)); ordinal++;
    } else if (a.event) {
      const e = a.event;
      const amount = cents(e.amount);
      if (e.kind === "draw" && (!inside(e.effectiveAt, r.drawWindow) || e.effectiveAt < r.openedAt
        || e.effectiveAt >= r.closedAt || (r.revokedAt !== null && e.effectiveAt >= r.revokedAt))) {
        fail("DRAW_UNAVAILABLE", "Line must be open, unrevoked and inside draw window", e.source); break;
      }
      const delta = e.kind === "draw" ? amount : -amount;
      if (principal + delta > limit) { fail("CREDIT_LIMIT_EXCEEDED", "Cumulative proposed draws exceed available credit", e.source); break; }
      if (principal + delta < 0n) { fail("INVALID_PRINCIPAL", "Repayment exceeds principal", e.source); break; }
      principal += delta;
      movements.push({ operationId: e.operationId, authorizationId: e.authorizationId, effectiveAt: e.effectiveAt, kind: e.kind,
        sourceAccountId: e.kind === "draw" ? r.liabilityAccountId : r.bankAccountId,
        destinationAccountId: e.kind === "draw" ? r.bankAccountId : r.liabilityAccountId,
        cashDelta: money(delta), liabilityDelta: money(delta), income: money(0n), expense: money(0n), netWorthDelta: money(0n),
        recognition: "none", status: "uncommitted", ruleSnapshotId: e.source.ruleSnapshotId,
        dependsOn: movements.map(m => m.operationId) });
    }
    states.push({ effectiveAt: cursor, principal: money(principal), ratePpm: currentRate });
  }
  if (diagnostics.length) return incomplete();
  numerator += principal * currentRate * durationBetween(cursor, r.period.endExclusive).days;
  const expense = money(rounded(numerator, denominator, r.interest.rounding));
  states.push({ effectiveAt: r.period.endExclusive, principal: money(principal), ratePpm: currentRate });
  const canonicalEvidence = { ...r, phases, events: activity.flatMap(a => a.event ? [a.event] : []), rate: { ...rate, resets,
    observations: [...rate.observations].sort((a, b) => a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0) } };
  return snapshot<HelocResult>({ coverage: "complete", diagnostics: [], proposals: [{ contractVersion: "d2-shared/v1", instrumentFamily: "heloc",
    householdId: r.householdId, personId: r.borrowerId, lineId: r.lineId, liabilityAccountId: r.liabilityAccountId,
    period: r.period, coverage: "complete", confidence: "verified_source_conditional_execution", movements, statesIfExecuted: states,
    closingPrincipalIfExecuted: money(principal), unusedCreditIfExecuted: money(limit - principal),
    interestExpenseProposal: { operationId: `${claimId}/recognize`, effectiveAt: r.period.endExclusive, amount: expense, claimId,
      ruleSnapshotId: r.interest.source.ruleSnapshotId, dependsOn: movements.map(m => m.operationId) },
    claim: { claimId, effectiveAt: r.period.endExclusive, dueAt: r.interest.dueAt, amount: expense },
    settlementIntent: expense.isZero() ? null : { operationId: `${claimId}/settle`, claimId, effectiveAt: r.interest.dueAt, sourceAccountId: r.bankAccountId,
      destinationAccountId: r.liabilityAccountId, amount: expense, recognition: "none", status: "uncommitted_requires_funding",
      ruleSnapshotId: r.interest.source.ruleSnapshotId, dependsOn: [`${claimId}/recognize`] },
    evidence: canonicalEvidence, traceRefs: [r.source.ruleSnapshotId, rate.source.ruleSnapshotId, r.interest.source.ruleSnapshotId,
      ...movements.map(e => e.operationId), ...rate.observations.map(o => o.observationId).sort()] }] });
}
