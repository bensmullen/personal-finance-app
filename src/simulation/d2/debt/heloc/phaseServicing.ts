import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Currency, Money, decimal } from "../../../../values/index.js";
import { evaluateHelocPeriod, type HelocRequest, type Source, type Window } from "./index.js";

/** External posted history, not a previous conditional proposal or a payment's
 * observed `settled` status. #149 alone supplies canonical posting evidence. */
export interface PostedPrincipal {
  readonly postingId: string;
  readonly operationId: string;
  readonly authorizationId: string;
  readonly claimId: string;
  readonly fundingId: string;
  readonly effectiveAt: CivilDate;
  readonly sequence: number;
  readonly kind: "draw" | "principal_repayment";
  readonly principal: Money;
  readonly interest: Money;
  readonly cash: Money;
  readonly source: Source;
  readonly evidenceKind: "canonical_posting";
}
export interface PrincipalCheckpoint {
  readonly originalAt: CivilDate;
  readonly originalPrincipal: Money;
  readonly originalSource: Source;
  readonly closingAt: CivilDate;
  readonly closingPrincipal: Money;
  readonly source: Source;
  /** Complete posted history through the opening snapshot at closingAt,
   * including a prior installment actually posted on that boundary. */
  readonly history: readonly PostedPrincipal[];
}
export interface InstallmentTerms {
  readonly source: Source;
  readonly phase: Window & { readonly kind: "amortizing" | "balloon" };
  readonly accrualPeriod: Window;
  readonly dueAt: CivilDate;
  readonly convention: "fixed_per_installment" | "variable_recast";
  readonly method: "b1_daily_simple" | "issuer_quoted";
  readonly rounding: "half_up" | "down";
  readonly total: Money;
  readonly openingPrincipal: Money;
  readonly closingPrincipal: Money;
  /** Required for issuer quotes; reconciled against B1 when computation qualifies. */
  readonly allocation: { readonly interest: Money; readonly principal: Money; readonly source: Source } | null;
  /** An independently sourced original, *complete* issuer statement. Required
   * to admit a quote when B1 interest cannot be reconstructed. Its verified
   * provenance is a domain input, never permission to post bank cash. */
  readonly issuerQuote?: {
    readonly documentId: string;
    readonly issuerId: string;
    readonly evidenceKind: "original_complete_issuer_statement";
    readonly source: Source;
    readonly period: Window;
    readonly dueAt: CivilDate;
    readonly householdId: string;
    readonly borrowerId: string;
    readonly lineId: string;
    readonly liabilityAccountId: string;
    readonly bankAccountId: string;
    readonly openingPrincipal: Money;
    readonly closingPrincipal: Money;
    readonly interest: Money;
    readonly principal: Money;
    readonly fees: Money;
    readonly total: Money;
  };
  /** Only an exact-date final contractual quote may include fees. Null means zero. */
  readonly finalQuote: { readonly source: Source; readonly dueAt: CivilDate;
    readonly principal: Money; readonly interest: Money;
    readonly fee: { readonly amount: Money; readonly source: Source } | null } | null;
}
export interface DatedPayment {
  readonly operationId: string;
  readonly claimId: string;
  readonly effectiveAt: CivilDate;
  readonly actorId: string;
  readonly bankAccountId: string;
  readonly amount: Money;
  readonly source: Source;
  readonly status: "scheduled" | "authorized" | "settled";
  readonly authorization: { readonly authorizationId: string; readonly source: Source } | null;
  readonly observed: { readonly observedAt: CivilDate; readonly source: Source } | null;
  readonly funding: { readonly fundingId: string; readonly effectiveAt: CivilDate;
    readonly amount: Money; readonly source: Source } | null;
}
export interface PhaseServicingRequest {
  readonly line: HelocRequest;
  readonly checkpoint: PrincipalCheckpoint;
  readonly terms: InstallmentTerms | null;
  readonly payment: DatedPayment;
}
export type PhaseDiagnosticCode = "SOURCE_UNAVAILABLE" | "IDENTITY_MISMATCH" | "INVALID_MONEY"
  | "CHECKPOINT_MISMATCH" | "DUPLICATE_CLAIM" | "INSTALLMENT_TERMS_REQUIRED"
  | "UNSUPPORTED_SERVICING" | "QUOTE_MISMATCH" | "INVALID_PAYMENT_DATE" | "UNFUNDED_PAYMENT"
  | "PHYSICAL_INTEGRATION_REQUIRED";
export interface PhaseDiagnostic {
  readonly diagnosticCode: PhaseDiagnosticCode | "B1_INCOMPLETE";
  readonly sourceEntityPath: string;
  readonly period: Window;
  readonly affectedOutput: "heloc_phase_servicing";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
interface Conditional { readonly committed: false; readonly postable: false }
export interface PhaseProposal extends Conditional {
  readonly contractVersion: "d2-shared/v1";
  readonly instrumentFamily: "heloc";
  readonly householdId: string;
  readonly personId: string;
  readonly lineId: string;
  readonly liabilityAccountId: string;
  readonly period: Window;
  /** Aggregate installment identity; interest retains B1's existing identity. */
  readonly claimId: string;
  readonly interestClaimId: string;
  readonly dueAt: CivilDate;
  readonly principal_due: Money;
  readonly interest_due: Money;
  readonly fees_due: Money;
  readonly gross_due: Money;
  readonly interestEvidence: "b1_computed" | "issuer_quoted_b1_reconciled" | "issuer_quoted_uncomputed";
  readonly paymentStatus: DatedPayment["status"];
  readonly finalBalanceIntent: Conditional & { readonly opening: Money; readonly closingIfExecuted: Money };
  readonly movements: readonly (Conditional & { readonly operationId: string; readonly authorizationId: string;
    readonly sourceAccountId: string; readonly destinationAccountId: string;
    readonly principal: Money; readonly gross: Money; readonly recognition: "none" })[];
  readonly evidence: PhaseServicingRequest;
  readonly traceRefs: readonly string[];
}
export interface PhaseServicingResult extends Conditional {
  readonly coverage: "incomplete";
  readonly obligationCoverage: "complete" | "incomplete";
  readonly cashCoverage: "incomplete";
  readonly netWorthCoverage: "incomplete";
  readonly taxCoverage: "incomplete";
  readonly settlementCoverage: "incomplete";
  readonly proposals: readonly PhaseProposal[];
  readonly diagnostics: readonly PhaseDiagnostic[];
}
const freeze = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money || v instanceof Currency) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(freeze)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, value]) => [k, freeze(value)]))) as T;
};
const named = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const dateOK = (d: CivilDate): boolean => { try { return civilDate(d) === d; } catch { return false; } };
const sameWindow = (a: Window, b: Window): boolean => a.start === b.start && a.endExclusive === b.endExclusive;

/** One sourced period-end installment. No calendar generation, recast, arrears,
 * capitalization, cash reservation, recognition or canonical state mutation. */
export function proposeHelocPhaseServicing(input: PhaseServicingRequest): PhaseServicingResult {
  const { line: r, checkpoint: c, payment: p, terms: t } = input;
  const diagnostics: PhaseDiagnostic[] = [];
  const fail = (diagnosticCode: PhaseDiagnosticCode | "B1_INCOMPLETE", fact: string, s = r.source): void => {
    diagnostics.push({ diagnosticCode, sourceEntityPath: `heloc/${r.lineId}`, period: r.period,
      affectedOutput: "heloc_phase_servicing", coverage: "incomplete", missingFacts: [fact],
      ruleSnapshotId: s.ruleSnapshotId, traceRefs: [r.lineId, s.sourcePublication] });
  };
  const result = (proposals: readonly PhaseProposal[] = []): PhaseServicingResult => {
    if (proposals.length) fail("PHYSICAL_INTEGRATION_REQUIRED", "#149 must independently admit funding, post bank/liability settlement and interest recognition, and complete cash/net-worth/tax effects");
    return freeze<PhaseServicingResult>({
      committed: false, postable: false, coverage: "incomplete", obligationCoverage: proposals.length ? "complete" : "incomplete",
      cashCoverage: "incomplete", netWorthCoverage: "incomplete", taxCoverage: "incomplete", settlementCoverage: "incomplete",
      proposals, diagnostics: diagnostics.sort((a, b) => {
        const left = JSON.stringify(a), right = JSON.stringify(b);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
    });
  };
  const source = (s: Source, at: CivilDate, w?: Window): void => {
    if (!dateOK(s.start) || !dateOK(s.endExclusive) || s.start >= s.endExclusive
      || !dateOK(s.publishedAt) || !dateOK(s.asOf) || s.publishedAt > s.asOf
      || s.asOf > at || s.asOf > r.evaluatedAsOf || s.start > (w?.start ?? at)
      || (w ? s.endExclusive < w.endExclusive : s.endExclusive <= at)
      || s.projectionStatus !== "verified" || ![s.ruleSnapshotId, s.sourcePublication, s.version, s.jurisdiction].every(named)
      || s.householdId !== r.householdId || s.personId !== r.borrowerId || s.lineId !== r.lineId
      || s.bankAccountId !== r.bankAccountId || s.liabilityAccountId !== r.liabilityAccountId)
      fail("SOURCE_UNAVAILABLE", "Matching verified source effective and known by economic event and evaluation cutoff required", s);
  };
  const cents = (m: Money): bigint => {
    const n = m.amount.times(decimal("100")).toString();
    if (!m.currency.equals(r.currency) || r.currency.minorUnitScale !== 2 || !/^\d+$/.test(n)) {
      fail("INVALID_MONEY", "Nonnegative exact cents in the line currency required"); return 0n;
    }
    return BigInt(n);
  };
  const money = (n: bigint): Money => Money.parse(n.toString(), r.currency).times(decimal("0.01"));
  const ids = new Set<string>();
  const reserve = (id: string): void => {
    if (!named(id) || ids.has(id)) fail("DUPLICATE_CLAIM", "Non-reusable posting, operation, claim, authorization and funding identities required");
    ids.add(id);
  };
  source(c.originalSource, c.originalAt);
  source(c.source, r.period.start);
  if (!dateOK(c.originalAt) || !dateOK(c.closingAt) || c.originalAt !== r.openedAt || c.closingAt !== r.period.start)
    fail("CHECKPOINT_MISMATCH", "Original line opening and exact period-start closing checkpoint required");
  let balance = cents(c.originalPrincipal);
  const limit = cents(r.creditLimit);
  if (balance > limit) fail("CHECKPOINT_MISMATCH", "Original principal must be within the source-qualified line limit");
  const history = [...c.history].sort((a, b) => a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1
    : a.sequence - b.sequence || (a.postingId < b.postingId ? -1 : a.postingId > b.postingId ? 1 : 0));
  for (const [i, h] of history.entries()) {
    source(h.source, h.effectiveAt);
    for (const id of [h.postingId, h.operationId, h.claimId, h.authorizationId, h.fundingId]) reserve(id);
    const principal = cents(h.principal), interest = cents(h.interest), cash = cents(h.cash);
    if (h.evidenceKind !== "canonical_posting" || !dateOK(h.effectiveAt) || h.effectiveAt < c.originalAt || h.effectiveAt > c.closingAt
      || !Number.isSafeInteger(h.sequence) || h.sequence < 0
      || (i > 0 && history[i - 1]!.effectiveAt === h.effectiveAt && history[i - 1]!.sequence === h.sequence)
      || !["draw", "principal_repayment"].includes(h.kind) || principal === 0n
      || cash !== principal + interest || (h.kind === "draw" && interest !== 0n))
      fail("CHECKPOINT_MISMATCH", "Actual canonical principal/cash identity and dated complete history required; conditional/settled assertions are insufficient");
    if (h.kind === "draw" && (h.effectiveAt < r.drawWindow.start || h.effectiveAt >= r.drawWindow.endExclusive
      || h.effectiveAt >= r.closedAt || (r.revokedAt !== null && h.effectiveAt >= r.revokedAt)))
      fail("CHECKPOINT_MISMATCH", "Historical draw must have been inside the admitted line/draw availability window");
    balance += h.kind === "draw" ? principal : -principal;
    if (balance < 0n || balance > limit) fail("CHECKPOINT_MISMATCH", "Every posted checkpoint movement must respect principal and credit bounds");
  }
  if (balance < 0n || balance !== cents(c.closingPrincipal) || balance !== cents(r.openingPrincipal))
    fail("CHECKPOINT_MISMATCH", "Original principal plus actual draws minus posted principal repayments must equal opening checkpoint");
  if (!t) { fail("INSTALLMENT_TERMS_REQUIRED", "Verified installment calendar, allocation method and rounding required"); return result(); }
  source(t.source, r.period.start, r.period);
  source(t.source, t.dueAt);
  source(p.source, p.effectiveAt);
  reserve(p.operationId); reserve(p.claimId);
  if (p.claimId !== `heloc/${r.lineId}/${r.period.start}/${r.period.endExclusive}/service`)
    fail("DUPLICATE_CLAIM", "Servicing claim identity must be stable for this line and accrual period");
  if (p.actorId !== r.borrowerId || p.bankAccountId !== r.bankAccountId) fail("IDENTITY_MISMATCH", "Payment must name the source-qualified borrower and bank");
  if (!dateOK(p.effectiveAt) || !dateOK(t.dueAt) || p.effectiveAt !== t.dueAt || t.dueAt !== r.period.endExclusive
    || r.interest.dueAt !== t.dueAt || !sameWindow(t.accrualPeriod, r.period))
    fail("INVALID_PAYMENT_DATE", "Only explicit period-end installments with matching accrual period and due dates are supported");
  if (t.convention !== "fixed_per_installment" || !["b1_daily_simple", "issuer_quoted"].includes(t.method)
    || t.rounding !== r.interest.rounding || r.events.length !== 0
    || !r.phases.some(phase => phase.kind === t.phase.kind && sameWindow(phase, t.phase))
    || !["amortizing", "balloon"].includes(t.phase.kind))
    fail("UNSUPPORTED_SERVICING", "Sourced fixed installment with B1 rounding in an explicit repayment phase required; recast, intraperiod activity and other conventions are unsupported");
  if (!["scheduled", "authorized", "settled"].includes(p.status)) fail("UNSUPPORTED_SERVICING", "Known payment status required");
  if (p.status === "scheduled") {
    if (p.authorization !== null || p.funding !== null || p.observed !== null)
      fail("UNSUPPORTED_SERVICING", "Merely scheduled payments carry no authorization, funding or settlement evidence");
  } else {
    if (!p.authorization || !p.funding) fail("UNFUNDED_PAYMENT", "Explicit authorization and independent sufficient gross funding evidence required");
    if (p.authorization) { reserve(p.authorization.authorizationId); source(p.authorization.source, p.effectiveAt); }
    if (p.funding) {
      reserve(p.funding.fundingId); source(p.funding.source, p.effectiveAt);
      if (p.funding.effectiveAt !== p.effectiveAt || cents(p.funding.amount) < cents(p.amount))
        fail("UNFUNDED_PAYMENT", "Exact-date funding must cover gross cash, not just principal");
    }
    if (p.status === "settled" && !p.observed) fail("SOURCE_UNAVAILABLE", "Dated observed settlement evidence required; it is not a canonical bank posting");
    if (p.observed) {
      source(p.observed.source, p.observed.observedAt);
      if (!dateOK(p.observed.observedAt) || p.observed.observedAt < p.effectiveAt || p.observed.observedAt > r.evaluatedAsOf)
        fail("SOURCE_UNAVAILABLE", "Settlement observation must follow payment and precede cutoff");
    }
  }
  if (diagnostics.length) return result();
  const accrual = evaluateHelocPeriod(r, t.phase.kind);
  const b1 = accrual.coverage === "complete" ? accrual.proposals[0]! : undefined;
  // An original issuer statement can stand in for unavailable computation,
  // but cannot override conflicting B1 evidence or unrelated invalid data.
  const quotedWithoutComputation = !b1 && t.method === "issuer_quoted" && !!t.issuerQuote
    && accrual.diagnostics.length > 0 && accrual.diagnostics.every(d =>
      ["RATE_TERMS_REQUIRED", "INDEX_UNAVAILABLE", "UNSUPPORTED_INTEREST_CONVENTION"].includes(d.diagnosticCode));
  if (!b1 && !quotedWithoutComputation) {
    for (const diagnostic of accrual.diagnostics) fail("B1_INCOMPLETE", `${diagnostic.diagnosticCode}: ${diagnostic.missingFacts.join("; ")}`);
    return result();
  }
  if (quotedWithoutComputation) {
    // B1's normal accrual validation is incomplete here. Retain independent
    // coverage for line, current period and any present rate source.
    source(r.source, r.period.start, r.period);
    source(r.interest.source, r.period.start, r.period);
    if (r.rate) source(r.rate.source, r.period.start, r.period);
    if (r.ownerId !== r.borrowerId || !r.openingPrincipal.equals(c.closingPrincipal)
      || !r.phases.some(phase => phase.kind === t.phase.kind
        && phase.start <= r.period.start && phase.endExclusive >= r.period.endExclusive))
      fail("UNSUPPORTED_SERVICING", "Original owner, opening balance and complete sourced phase required");
  }
  // Preserve the B1 claim/recognition/settlement IDs on either path.
  const interestClaimId = `heloc/${r.lineId}/${r.period.start}/${r.period.endExclusive}/interest`;
  reserve(interestClaimId); reserve(`${interestClaimId}/recognize`); reserve(`${interestClaimId}/settle`);
  for (const observation of b1?.evidence.rate?.observations ?? []) reserve(observation.observationId);
  const quote = t.issuerQuote;
  if (quote) {
    reserve(quote.documentId);
    source(quote.source, t.dueAt);
    if (!named(quote.issuerId) || quote.evidenceKind !== "original_complete_issuer_statement"
      || !sameWindow(quote.period, r.period) || quote.dueAt !== t.dueAt
      || quote.householdId !== r.householdId || quote.borrowerId !== r.borrowerId
      || quote.lineId !== r.lineId || quote.liabilityAccountId !== r.liabilityAccountId
      || quote.bankAccountId !== r.bankAccountId
      || quote.source.sourcePublication === t.source.sourcePublication
      || quote.source.sourcePublication === r.source.sourcePublication
      || quote.source.publishedAt < r.period.endExclusive || quote.source.asOf < r.period.endExclusive
      || cents(quote.openingPrincipal) !== balance
      || cents(quote.closingPrincipal) !== cents(t.closingPrincipal)
      || cents(quote.total) !== cents(t.total)
      || !t.allocation || cents(quote.interest) !== cents(t.allocation.interest)
      || cents(quote.principal) !== cents(t.allocation.principal))
      fail("QUOTE_MISMATCH", "Original complete issuer statement must match exact period, owner, source, balance, due date and allocation");
  }
  const interest = b1 ? cents(b1.claim.amount) : quote ? cents(quote.interest) : 0n;
  const total = cents(t.total);
  let fee = 0n;
  if (t.finalQuote) {
    const q = t.finalQuote;
    source(q.source, t.dueAt);
    if (q.fee) { source(q.fee.source, t.dueAt); fee = cents(q.fee.amount); }
    if (q.dueAt !== r.maturityAt || t.dueAt !== r.maturityAt || cents(q.principal) !== balance || cents(q.interest) !== interest)
      fail("QUOTE_MISMATCH", "Separately verified final quote must match exact contractual maturity, remaining principal and confirmed B1 interest");
  } else if (t.phase.kind === "balloon" || t.dueAt === r.maturityAt) {
    fail("INSTALLMENT_TERMS_REQUIRED", "Exact-date separately verified contractual final maturity quote required");
  }
  if (quote && (cents(quote.fees) !== fee || cents(quote.interest) + cents(quote.principal) + cents(quote.fees) !== total))
    fail("QUOTE_MISMATCH", "Complete issuer interest, principal and separately quoted final fees must sum to cash");
  const principal = total - interest - fee;
  if (principal < 0n || principal > balance || (t.finalQuote !== null && principal !== balance)
    || (principal === 0n && balance > 0n)) fail("QUOTE_MISMATCH", "No negative amortization, over-credit, arrears or unpaid final principal permitted");
  if (cents(t.openingPrincipal) !== balance || cents(t.closingPrincipal) !== balance - principal || cents(p.amount) !== total)
    fail("QUOTE_MISMATCH", "Sourced original installment cash, opening and closing balance must reconcile exactly");
  if (t.method === "issuer_quoted" && !t.allocation) fail("INSTALLMENT_TERMS_REQUIRED", "Issuer quoted principal and interest allocation with source lineage required");
  if (t.allocation) {
    source(t.allocation.source, t.dueAt);
    if (cents(t.allocation.interest) !== interest || cents(t.allocation.principal) !== principal)
      fail("QUOTE_MISMATCH", "Issuer allocation disagrees with supported B1 interest or remaining principal");
  }
  if (diagnostics.length) return result();
  const evidence = { ...input, checkpoint: { ...c, history }, line: b1?.evidence ?? r };
  return result([{ committed: false, postable: false, contractVersion: "d2-shared/v1", instrumentFamily: "heloc",
    householdId: r.householdId, personId: r.borrowerId, lineId: r.lineId, liabilityAccountId: r.liabilityAccountId, period: r.period,
    claimId: p.claimId, interestClaimId, dueAt: t.dueAt,
    principal_due: money(principal), interest_due: money(interest), fees_due: money(fee), gross_due: money(total),
    interestEvidence: quotedWithoutComputation ? "issuer_quoted_uncomputed"
      : t.method === "issuer_quoted" ? "issuer_quoted_b1_reconciled" : "b1_computed", paymentStatus: p.status,
    finalBalanceIntent: { committed: false, postable: false, opening: money(balance), closingIfExecuted: money(balance - principal) },
    movements: p.authorization ? [{ committed: false, postable: false, operationId: p.operationId,
      authorizationId: p.authorization.authorizationId, sourceAccountId: r.bankAccountId, destinationAccountId: r.liabilityAccountId,
      principal: money(principal), gross: money(total), recognition: "none" }] : [],
    evidence, traceRefs: [...new Set([interestClaimId,
      ...(b1?.traceRefs ?? [r.source.ruleSnapshotId, r.interest.source.ruleSnapshotId]),
      ...(quote ? [quote.documentId, quote.source.sourcePublication] : []), ...history.map(h => h.postingId),
      t.source.sourcePublication, p.source.sourcePublication, c.source.sourcePublication])].sort(),
  }]);
}
