import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { Currency, Money } from "../../../../../values/index.js";
import { proposeCreditCardStatements, type CardPosting, type CardProposal, type CreditCardStatement,
  type IssuerSource, type PaymentSplit, type RevolvingRequest, type StatementCharge, type StatementCycle } from "../index.js";

type Event = CardPosting | StatementCharge;
type PaymentEvent = Extract<CardPosting, { readonly kind: "payment" }>;
/** Documentary confirmation, never an engine BANK settlement receipt. */
export interface BankConfirmation {
  readonly confirmationId: string;
  readonly settlementId: string;
  readonly operationId: string;
  readonly householdId: string;
  readonly personId: string;
  readonly sourceAccountId: string;
  readonly cardAccountId: string;
  readonly issuerId: string;
  readonly effectiveAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly amount: Money;
  readonly authorization: {
    readonly authorizationId: string;
    readonly effectiveAt: CivilDate;
    readonly amount: Money;
    readonly sourcePublication: string;
  };
  readonly sourcePublication: string;
  readonly version: string;
  readonly status: "posted" | "pending";
}
export interface ObservedPosting {
  readonly event: Event;
  readonly knownAt: CivilDate;
  readonly bankConfirmation?: BankConfirmation;
  readonly issuerPayment?: {
    readonly operationId: string;
    readonly settlementId: string;
    readonly sourceAccountId: string;
    readonly allocationSource: IssuerSource;
  };
}
export interface CycleRegister {
  readonly statementId: string;
  readonly cardAccountId: string;
  readonly knownAt: CivilDate;
  readonly source: IssuerSource;
  /** Source attests exhaustive activity, including an explicitly empty list. */
  readonly complete: true;
  readonly activity: readonly ObservedPosting[];
  readonly opening: {
    readonly effectiveAt: CivilDate;
    readonly components: PaymentSplit;
    readonly convention: "principal_only_after_boundary_postings_no_unpaid_charges";
    readonly source: IssuerSource;
  };
  /** Exhaustive cutoff payments, after the statement and before the next opening.
   * Payments after the cutoff belong to the next cycle, never its opening. */
  readonly boundary: {
    readonly source: IssuerSource;
    readonly complete: true;
    readonly payments: readonly ObservedPosting[];
  };
}
export interface CreditCardContinuityRequest {
  readonly knownAt: CivilDate;
  readonly cycles: readonly { readonly request: RevolvingRequest; readonly registers: readonly CycleRegister[] }[];
}
export interface ContinuityDiagnostic {
  readonly sourceEntityPath: string;
  readonly period: StatementCycle;
  readonly affectedOutput: "card_cycle_continuity";
  readonly coverage: "incomplete";
  readonly diagnosticCode: "OWNER_QUOTE_REJECTED" | "HISTORY_REQUIRED" | "IDENTITY_MISMATCH"
    | "CYCLE_NOT_ADJACENT" | "SOURCE_INVALID" | "REGISTER_MISMATCH" | "DUPLICATE_IDENTITY"
    | "PAYMENT_PROOF_REQUIRED" | "PAYMENT_MISMATCH" | "OPENING_DRIFT" | "UNPAID_NONPRINCIPAL"
    | "MINIMUM_UNPAID" | "BANK_INTEGRATION_PENDING";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
export interface VerifiedCycle {
  readonly statementId: string;
  readonly cycle: StatementCycle;
  readonly opening: { readonly effectiveAt: CivilDate; readonly components: PaymentSplit };
  readonly closing: { readonly effectiveAt: CivilDate; readonly components: PaymentSplit };
  readonly afterBoundary: PaymentSplit;
  readonly observedActivity: readonly ObservedPosting[];
  readonly observedBoundaryPayments: readonly ObservedPosting[];
  readonly proposedPayment: CardProposal;
  readonly unpaidRequiredService: Money;
  readonly serviceStatus: "paid_by_due_date" | "unpaid";
  readonly traceRefs: readonly string[];
}
export interface CardContinuityRecord {
  readonly contractVersion: "d2-shared/v1";
  readonly instrumentFamily: "credit_card";
  readonly householdId: string;
  readonly personId: string;
  readonly issuerId: string;
  readonly cardAccountId: string;
  readonly committed: false;
  readonly postable: false;
  readonly physicalBankSettlement: "not_applied";
  readonly status: "conditional_continuity" | "pending";
  readonly cycles: readonly VerifiedCycle[];
  readonly conditionalContinuity: readonly {
    readonly fromStatementId: string;
    readonly toStatementId: string;
    readonly effectiveAt: CivilDate;
    readonly components: PaymentSplit;
  }[];
  readonly statementContinuityCoverage: "complete" | "incomplete";
  readonly coverage: "incomplete";
  readonly futureCycleCoverage: "incomplete";
  readonly integrationPrerequisite: string;
}
const keys = ["principal", "interest", "fees"] as const;
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const dateOK = (d: CivilDate): boolean => { try { civilDate(d); return true; } catch { return false; } };
const sameSplit = (a: PaymentSplit, b: PaymentSplit): boolean => keys.every(k => a[k].equals(b[k]));
const total = (s: PaymentSplit): Money => s.principal.plus(s.interest).plus(s.fees);
const freeze = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money || v instanceof Currency) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(freeze)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, item]) => [k, freeze(item)]))) as T;
};
// Compare source content as well as identity; object insertion order is irrelevant.
const canonical = (v: unknown): string => {
  if (v instanceof Money || v instanceof Currency) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => cmp(a, b))
    .map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
};
const eventOrder = (a: ObservedPosting, b: ObservedPosting): number => cmp(a.event.effectiveAt, b.event.effectiveAt)
  || a.event.sequence - b.event.sequence || cmp(a.event.postingId, b.event.postingId);

/** Pure documentary reconciliation. Canonical BANK/account authority remains #149's. */
export function reconcileCreditCardCycles(input: CreditCardContinuityRequest) {
  if (!dateOK(input.knownAt)) throw new Error("Continuity requires a valid knowledge cutoff");
  const diagnostics: ContinuityDiagnostic[] = [];
  const records: CardContinuityRecord[] = [];
  const entries = input.cycles.flatMap(cycle => {
    const result = proposeCreditCardStatements(cycle.request);
    return cycle.request.cards.map(card => ({ card, registers: cycle.registers, result }));
  }).sort((a, b) => cmp(a.card.cardAccountId, b.card.cardAccountId)
    || cmp(a.card.cycle.start, b.card.cycle.start) || cmp(a.card.statementId, b.card.statementId));
  const counts = new Map<string, number>();
  const count = (ns: string, id: string) => {
    const key = canonical([ns, id]); counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const { card: c, registers } of entries) {
    count("statement", c.statementId); count("operation", c.payment?.operationId ?? "");
    count("allocation", c.allocationPolicy?.source?.ruleSnapshotId ?? "");
    for (const e of [...c.transactions, ...c.charges]) count("posting", e.postingId);
    for (const r of registers.filter(r => r.cardAccountId === c.cardAccountId && r.statementId === c.statementId)) {
      for (const p of r.boundary.payments) count("posting", p.event.postingId);
      for (const p of [...r.activity, ...r.boundary.payments]) if (p.bankConfirmation) {
        count("settlement", p.bankConfirmation.settlementId);
        count("confirmation", p.bankConfirmation.confirmationId);
        count("authorization", p.bankConfirmation.authorization.authorizationId);
        if (r.activity.includes(p)) count("operation", p.bankConfirmation.operationId);
      }
    }
  }
  const unique = (ns: string, id: string): boolean => text(id) && counts.get(canonical([ns, id])) === 1;
  for (const accountId of [...new Set(entries.map(e => e.card.cardAccountId))].sort(cmp)) {
    const history = entries.filter(e => e.card.cardAccountId === accountId);
    const first = history[0]!.card;
    const verified: VerifiedCycle[] = [];
    const links: { fromStatementId: string; toStatementId: string; effectiveAt: CivilDate; components: PaymentSplit }[] = [];
    let invalid = false;
    let previous: { card: CreditCardStatement; closing: PaymentSplit } | undefined;
    for (const { card: c, registers, result } of history) {
      let bad = false;
      const fail = (diagnosticCode: ContinuityDiagnostic["diagnosticCode"], fact: string) => {
        bad = true; invalid = true;
        diagnostics.push({ diagnosticCode, sourceEntityPath: `cards/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(c.statementId)}`,
          period: c.cycle, affectedOutput: "card_cycle_continuity", coverage: "incomplete", missingFacts: [fact],
          ruleSnapshotId: c.statementSource?.ruleSnapshotId ?? "missing_issuer_source",
          traceRefs: [accountId, c.statementId, c.statementSource?.ruleSnapshotId ?? "missing_issuer_source"] });
      };
      if (history.length < 2) fail("HISTORY_REQUIRED", "At least two successive original issuer statements");
      if (c.householdId !== first.householdId || c.personId !== first.personId || c.issuerId !== first.issuerId
        || !c.currency.equals(first.currency)) fail("IDENTITY_MISMATCH", "Unchanged household, borrower, issuer, card and currency");
      const proposal = result.proposals.find(p => p.cardAccountId === accountId && p.statementId === c.statementId);
      if (!proposal) {
        fail("OWNER_QUOTE_REJECTED", result.diagnostics.map(d => `${d.diagnosticCode}: ${d.missingFacts.join("; ")}`).join("; "));
        previous = undefined; continue;
      }
      if (!unique("statement", c.statementId) || !unique("operation", c.payment.operationId)
        || !unique("allocation", c.allocationPolicy.source.ruleSnapshotId))
        fail("DUPLICATE_IDENTITY", "Unique statement/payment identities and cycle-specific allocation authority");
      const matches = registers.filter(r => r.cardAccountId === accountId && r.statementId === c.statementId);
      if (matches.length !== 1) { fail("HISTORY_REQUIRED", "Exactly one source-qualified complete activity register"); previous = undefined; continue; }
      const r = matches[0]!;
      const known = (at: CivilDate, eventAt: CivilDate): boolean => dateOK(at) && dateOK(eventAt) && eventAt <= at && at <= input.knownAt;
      const sourceOK = (s: IssuerSource, at: CivilDate): boolean => !!s && dateOK(s.start) && dateOK(s.endExclusive)
        && s.start <= at && at < s.endExclusive && dateOK(s.asOf) && s.asOf <= r.knownAt && r.knownAt <= input.knownAt
        && [s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text)
        && s.projectionStatus === "verified" && s.issuerId === c.issuerId && s.personId === c.personId && s.cardAccountId === accountId;
      const moneyOK = (m: Money): boolean => m instanceof Money && m.currency.equals(c.currency)
        && !m.isNegative() && m.amount.fitsScale(c.currency.minorUnitScale);
      if (!known(r.knownAt, c.statementDate) || r.complete !== true || r.boundary.complete !== true
        || !sourceOK(r.source, c.statementDate) || r.source.start > c.cycle.start || r.source.endExclusive <= c.cycle.endExclusive
        || !sourceOK(r.boundary.source, c.cycle.endExclusive)) fail("SOURCE_INVALID", "Dated exhaustive statement and boundary sources known by the cutoff");
      for (const [s, at] of [[c.statementSource, c.statementDate], [c.minimum.source, c.statementDate],
        [c.postingPolicy.source, c.cycle.start], [c.allocationPolicy.source, c.payment.effectiveAt],
        [c.payment.source, c.payment.effectiveAt]] as const)
        if (!sourceOK(s, at)) fail("SOURCE_INVALID", "Original quote sources effective at their events and known by the snapshot cutoff");
      const opening = r.opening;
      if (opening.effectiveAt !== c.cycle.start || opening.convention !== "principal_only_after_boundary_postings_no_unpaid_charges"
        || !sourceOK(opening.source, opening.effectiveAt) || !keys.every(k => moneyOK(opening.components[k])))
        fail("SOURCE_INVALID", "Dated principal-only opening convention after all cutoff postings");
      else if (!opening.components.principal.equals(c.openingPrincipal) || !opening.components.interest.isZero() || !opening.components.fees.isZero())
        fail("UNPAID_NONPRINCIPAL", "Opening must match quoted principal with no hidden or capitalized unpaid charges");
      const activity = [...r.activity].sort(eventOrder);
      const expected = [...c.transactions, ...c.charges].map(event => ({ event, knownAt: r.knownAt })).sort(eventOrder);
      if (canonical(activity.map(p => p.event)) !== canonical(expected.map(p => p.event)))
        fail("REGISTER_MISMATCH", "Register must reproduce every original posting, amount, allocation, recognition and source exactly");
      const boundary = [...r.boundary.payments].sort(eventOrder);
      const slots = new Set<string>();
      const checkPayment = (p: ObservedPosting): p is ObservedPosting & { event: PaymentEvent; bankConfirmation: BankConfirmation } => {
        const b = p.bankConfirmation;
        const issuer = p.issuerPayment;
        if (p.event.kind !== "payment" || !b || !issuer || b.status !== "posted") {
          fail("PAYMENT_PROOF_REQUIRED", "Separate posted bank confirmation and issuer allocation; proposed/pending payments prove nothing"); return false;
        }
        const e = p.event;
        if (issuer.operationId !== b.operationId || issuer.settlementId !== b.settlementId
          || issuer.sourceAccountId !== b.sourceAccountId || !sourceOK(issuer.allocationSource, e.effectiveAt)
          || issuer.allocationSource.asOf > p.knownAt) {
          fail("PAYMENT_MISMATCH", "Independently linked issuer and bank operation/settlement/account identities and dated allocation authority"); return false;
        }
        if (![b.amount, b.authorization.amount, e.amount, ...keys.map(k => e.allocation[k])].every(moneyOK)) {
          fail("PAYMENT_MISMATCH", "Exact nonnegative currency minor units in issuer, bank and authorization evidence"); return false;
        }
        if (!unique("settlement", b.settlementId) || !unique("confirmation", b.confirmationId)
          || !unique("authorization", b.authorization.authorizationId)) fail("DUPLICATE_IDENTITY", "Unused settlement, confirmation and authorization identities");
        if (![b.operationId, b.sourceAccountId, b.sourcePublication, b.version, b.authorization.sourcePublication].every(text)
          || b.householdId !== c.householdId || b.personId !== c.personId || b.issuerId !== c.issuerId
          || b.cardAccountId !== accountId || b.sourceAccountId === accountId || b.effectiveAt !== e.effectiveAt
          || !known(b.knownAt, b.effectiveAt) || b.knownAt > r.knownAt || !dateOK(b.authorization.effectiveAt)
          || b.authorization.effectiveAt > b.effectiveAt || !e.amount.equals(b.amount)
          || b.amount.compare(b.authorization.amount) > 0 || !total(e.allocation).equals(e.amount)) {
          fail("PAYMENT_MISMATCH", "Matching dated owner/card/issuer, bank account, authorized funds and exact posted split"); return false;
        }
        return true;
      };
      for (const p of [...activity, ...boundary]) {
        const e = p.event; const slot = canonical([e.effectiveAt, e.sequence]);
        if (!unique("posting", e.postingId) || slots.has(slot) || !Number.isSafeInteger(e.sequence) || e.sequence < 0)
          fail("DUPLICATE_IDENTITY", "Unused issuer posting identity and unique sourced same-day sequence");
        slots.add(slot);
        if (!known(p.knownAt, e.effectiveAt) || p.knownAt > r.knownAt || !sourceOK(e.source, e.effectiveAt) || e.source.asOf > p.knownAt)
          fail("SOURCE_INVALID", "Each posting needs effective and knowledge evidence without lookahead");
        if (activity.includes(p) && e.kind === "payment") checkPayment(p);
      }
      if (bad) { previous = undefined; continue; }
      if (previous) {
        if (previous.card.cycle.endExclusive !== c.cycle.start) fail("CYCLE_NOT_ADJACENT", "Successive half-open cycles without gaps, overlaps or duplicate dates");
        if (!sameSplit(previous.closing, opening.components)) fail("OPENING_DRIFT", "Successor opening equals reconciled prior principal, interest and fees");
        if (!bad) links.push({ fromStatementId: previous.card.statementId, toStatementId: c.statementId,
          effectiveAt: c.cycle.start, components: opening.components });
      } else if (verified.length > 0) fail("HISTORY_REQUIRED", "No continuity across a rejected predecessor");
      const balances = { ...proposal.statementComponents };
      let paid = Money.zero(c.currency);
      for (const p of boundary) {
        if (!checkPayment(p)) continue;
        const e = p.event; const b = p.bankConfirmation;
        if (e.effectiveAt !== c.cycle.endExclusive || e.effectiveAt < c.statementDate || e.effectiveAt > c.dueDate
          || b.operationId !== c.payment.operationId || b.sourceAccountId !== c.payment.sourceAccountId
          || e.effectiveAt !== c.payment.effectiveAt || !e.amount.equals(proposal.potentialPayment)
          || !sameSplit(e.allocation, proposal.potentialAllocation) || canonical(e.source) !== canonical(c.payment.source)) {
          fail("PAYMENT_MISMATCH", "Cutoff payment must match original operation/date/account/source, potential amount and allocation; later payments cannot reduce an earlier opening"); continue;
        }
        paid = paid.plus(e.amount);
        for (const k of keys) balances[k] = balances[k].minus(e.allocation[k]);
        if (keys.some(k => balances[k].isNegative())) fail("PAYMENT_MISMATCH", "Payment cannot exceed a remaining component");
      }
      if (paid.compare(proposal.potentialPayment) > 0) fail("PAYMENT_MISMATCH", "Observed payments cannot exceed original funding authorization");
      const unpaid = proposal.requiredService.minus(paid.compare(proposal.requiredService) < 0 ? paid : proposal.requiredService);
      if (unpaid.isPositive()) fail("MINIMUM_UNPAID", "Required service unpaid; no invented late fee or future interest");
      if (!balances.interest.isZero() || !balances.fees.isZero()) fail("UNPAID_NONPRINCIPAL", "Unpaid interest/fees cannot disappear or become principal");
      verified.push({ statementId: c.statementId, cycle: c.cycle, opening: { effectiveAt: c.cycle.start, components: opening.components },
        closing: { effectiveAt: c.statementDate, components: proposal.statementComponents }, afterBoundary: balances,
        observedActivity: activity, observedBoundaryPayments: boundary, proposedPayment: proposal,
        unpaidRequiredService: unpaid, serviceStatus: unpaid.isZero() ? "paid_by_due_date" : "unpaid",
        traceRefs: [...new Set([...proposal.traceRefs, r.source.ruleSnapshotId, r.boundary.source.ruleSnapshotId, opening.source.ruleSnapshotId,
          ...[...activity, ...boundary].flatMap(p => [p.event.postingId, p.event.source.ruleSnapshotId,
            ...(p.bankConfirmation ? [p.bankConfirmation.confirmationId, p.bankConfirmation.settlementId, p.bankConfirmation.authorization.authorizationId] : [])])])].sort(cmp) });
      previous = bad ? undefined : { card: c, closing: balances };
    }
    const integrationPrerequisite = "#149 must validate canonical account ownership, payment authorization, atomic BANK settlement and global idempotency";
    diagnostics.push({ sourceEntityPath: `cards/${encodeURIComponent(accountId)}`, period: first.cycle,
      affectedOutput: "card_cycle_continuity", coverage: "incomplete", diagnosticCode: "BANK_INTEGRATION_PENDING",
      missingFacts: [integrationPrerequisite], ruleSnapshotId: first.statementSource?.ruleSnapshotId ?? "missing_issuer_source", traceRefs: [accountId] });
    records.push({ contractVersion: "d2-shared/v1", instrumentFamily: "credit_card", householdId: first.householdId,
      personId: first.personId, issuerId: first.issuerId, cardAccountId: accountId, committed: false, postable: false,
      physicalBankSettlement: "not_applied", status: invalid ? "pending" : "conditional_continuity", cycles: verified,
      conditionalContinuity: invalid ? [] : links, statementContinuityCoverage: invalid ? "incomplete" : "complete",
      coverage: "incomplete", futureCycleCoverage: "incomplete", integrationPrerequisite });
  }
  diagnostics.sort((a, b) => cmp(a.sourceEntityPath, b.sourceEntityPath) || cmp(a.diagnosticCode, b.diagnosticCode) || cmp(canonical(a), canonical(b)));
  return freeze({ contractVersion: "d2-shared/v1" as const, records, diagnostics, coverage: "incomplete" as const,
    futureCycleCoverage: "incomplete" as const, physicalBankSettlement: "not_applied" as const });
}
