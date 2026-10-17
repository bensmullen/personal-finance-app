import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Currency, Money } from "../../../../values/index.js";

export interface StatementCycle {
  readonly start: CivilDate;
  readonly endExclusive: CivilDate;
}
/** Domain-local S2 evidence; #149 owns the shared runtime adapter. */
export interface IssuerSource extends StatementCycle {
  readonly ruleSnapshotId: string;
  readonly issuerId: string;
  readonly personId: string;
  readonly cardAccountId: string;
  readonly jurisdiction: string;
  readonly ruleFamily: string;
  readonly sourcePublication: string;
  readonly asOf: CivilDate;
  readonly version: string;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export type Component = "principal" | "interest" | "fees";
export interface PaymentSplit {
  readonly principal: Money;
  readonly interest: Money;
  readonly fees: Money;
}
interface Posting {
  readonly postingId: string;
  readonly effectiveAt: CivilDate;
  /** Issuer sequence, never array order; unique within a posting day. */
  readonly sequence: number;
  readonly amount: Money;
  readonly source: IssuerSource;
}
export type CardPosting = Posting & (
  | { readonly kind: "purchase" | "refund"; readonly recognition: "already_recognized" | "propose_expense" }
  | { readonly kind: "payment"; readonly allocation: PaymentSplit }
);
export type StatementCharge = Posting & {
  readonly kind: "interest" | "ordinary_fee" | "late_fee" | "promotion";
  readonly recognition: "already_recognized" | "propose_expense";
};
export interface CreditCardStatement {
  readonly instrumentFamily: "credit_card" | "heloc";
  readonly householdId: string;
  readonly personId: string;
  readonly issuerId: string;
  /** The provider account IS the liability, not a second loan container. */
  readonly cardAccountId: string;
  readonly currency: Currency;
  readonly statementId: string;
  readonly cycle: StatementCycle;
  readonly statementDate: CivilDate;
  readonly dueDate: CivilDate;
  readonly statementSource: IssuerSource;
  /** Principal only, already recognized, before this cycle's activity. */
  readonly openingPrincipal: Money;
  readonly openingBasis: "principal_only_no_unpaid_charges";
  readonly statementPrincipal: Money;
  readonly statementInterest: Money;
  readonly statementFees: Money;
  /** Includes remaining principal AND unpaid itemized interest/ordinary fees. */
  readonly statementTotal: Money;
  readonly balanceBasis: "principal_plus_itemized_charges";
  readonly interestPolicy: "issuer_statement_quote" | "apr_accrual" | "grace_calculation";
  readonly charges: readonly StatementCharge[];
  readonly transactions: readonly CardPosting[];
  readonly postingPolicy: {
    readonly convention: "posted_date_end_exclusive";
    readonly completeCycleActivity: true;
    readonly source: IssuerSource;
  };
  readonly minimum: {
    readonly kind: "issuer_quote" | "unsupported_formula";
    readonly amount: Money;
    readonly source: IssuerSource;
  };
  readonly allocationPolicy: {
    readonly kind: "issuer_order";
    /** Issuer authority for this amount and balance class. */
    readonly order: readonly Component[];
    readonly source: IssuerSource;
  };
  readonly payment: {
    readonly operationId: string;
    readonly payerId: string;
    readonly sourceAccountId: string;
    readonly effectiveAt: CivilDate;
    readonly funding:
      | { readonly kind: "requested"; readonly amount: Money }
      | { readonly kind: "insufficient"; readonly amount: Money; readonly available: Money;
          readonly partialFunding: "authorized" | "declined" };
    readonly balanceConvention: "statement_only_no_intervening_activity";
    readonly source: IssuerSource;
  };
}
export interface RevolvingRequest {
  readonly period: StatementCycle;
  readonly cards: readonly CreditCardStatement[];
}
export type RevolvingDiagnosticCode =
  | "IDENTITY_REQUIRED" | "DUPLICATE_ACCOUNT" | "SOURCE_REQUIRED" | "MONEY_INVALID"
  | "STATEMENT_UNAVAILABLE" | "TRANSACTION_WINDOW_AMBIGUOUS" | "DUPLICATE_POSTING"
  | "UNSUPPORTED_CAPABILITY" | "MINIMUM_POLICY_REQUIRED" | "ALLOCATION_POLICY_REQUIRED"
  | "STATEMENT_MISMATCH" | "NEGATIVE_BALANCE" | "PAYMENT_EXCEEDS_DUE" | "PAYMENT_FACT_REQUIRED";
export interface RevolvingDiagnostic {
  readonly diagnosticCode: RevolvingDiagnosticCode;
  readonly sourceEntityPath: string;
  readonly period: StatementCycle;
  readonly affectedOutput: "statement_and_payment";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
export interface CardProposal {
  readonly contractVersion: "d2-shared/v1";
  readonly instrumentFamily: "credit_card";
  readonly householdId: string;
  readonly personId: string;
  readonly cardAccountId: string;
  readonly statementId: string;
  readonly cycle: StatementCycle;
  readonly statementDate: CivilDate;
  readonly dueDate: CivilDate;
  readonly statementLiability: Money;
  readonly statementComponents: PaymentSplit;
  readonly requiredService: Money;
  readonly requestedPayment: Money;
  readonly potentialPayment: Money;
  readonly potentialAllocation: PaymentSplit;
  readonly minimumUnfunded: Money;
  readonly fundingStatus: "minimum_unfunded" | "partial_funding_reported" | "requested_uncommitted";
  /** Conditional on settlement; never authoritative paid state. */
  readonly remainingIfSettled: PaymentSplit;
  readonly remainingRevolvingIfSettled: Money;
  readonly claim: {
    readonly claimId: string;
    readonly originalAmount: Money;
    readonly outstandingAmount: Money;
    readonly originatingFactIds: readonly string[];
    readonly effectiveAt: CivilDate;
    readonly dueDate: CivilDate;
  };
  readonly recognitionProposals: readonly {
    readonly operationId: string;
    readonly kind: "uncommitted_expense" | "uncommitted_expense_reversal";
    readonly actorId: string;
    readonly effectiveAt: CivilDate;
    readonly grossAmount: Money;
    readonly sourcePostingId: string;
    readonly ruleSnapshotId: string;
    readonly claimId: string;
  }[];
  readonly settlementProposals: readonly {
    readonly operationId: string;
    readonly kind: "uncommitted_card_payment";
    readonly actorId: string;
    readonly effectiveAt: CivilDate;
    readonly sourceAccountId: string;
    readonly destinationAccountId: string;
    readonly claimId: string;
    readonly grossAmount: Money;
    readonly allocation: PaymentSplit;
    readonly ruleSnapshotId: string;
    readonly recognition: "none";
  }[];
  readonly evidence: CreditCardStatement;
  readonly traceRefs: readonly string[];
}
const ordered = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const dateOK = (d: CivilDate): boolean => { try { civilDate(d); return true; } catch { return false; } };
const periodOK = (p: StatementCycle): boolean => dateOK(p.start) && dateOK(p.endExclusive) && p.start < p.endExclusive;
const snapshot = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money || v instanceof Currency) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, item]) => [k, snapshot(item)]))) as T;
};
const components: readonly Component[] = ["principal", "interest", "fees"];
const total = (s: PaymentSplit): Money => s.principal.plus(s.interest).plus(s.fees);
const min = (a: Money, b: Money): Money => a.compare(b) < 0 ? a : b;
const postingOrder = (a: Posting, b: Posting): number => ordered(a.effectiveAt, b.effectiveAt)
  || a.sequence - b.sequence || ordered(a.postingId, b.postingId);
const recognitionId = (c: CreditCardStatement, p: Posting): string =>
  JSON.stringify(["card_recognition", c.issuerId, c.cardAccountId, p.postingId]);
const recognitionIds = (c: CreditCardStatement): readonly string[] => [...c.transactions, ...c.charges]
  .filter(p => p.kind !== "payment" && p.recognition === "propose_expense").map(p => recognitionId(c, p));

/** Pure statement reconciliation; never a cash/state/tax writer or future forecast. */
export function proposeCreditCardStatements(request: RevolvingRequest) {
  if (!periodOK(request.period)) throw new Error("Evaluation period must be a valid half-open civil-date cycle");
  const proposals: CardProposal[] = [];
  const diagnostics: RevolvingDiagnostic[] = [];
  const cards = [...request.cards].sort((a, b) => ordered(a.cardAccountId, b.cardAccountId) || ordered(a.statementId, b.statementId));
  const paymentIds = cards.map(c => c.payment?.operationId ?? "");
  const proposedRecognitionIds = cards.flatMap(c => recognitionIds(c));
  for (const c of cards) {
    const errors = new Set<RevolvingDiagnosticCode>();
    const fail = (code: RevolvingDiagnosticCode, fact: string, source = c.statementSource) => {
      if (errors.has(code)) return;
      errors.add(code);
      diagnostics.push({ diagnosticCode: code, sourceEntityPath: `cards/${encodeURIComponent(c.cardAccountId)}/statements/${encodeURIComponent(c.statementId)}`,
        period: request.period, affectedOutput: "statement_and_payment", coverage: "incomplete", missingFacts: [fact],
        ruleSnapshotId: source?.ruleSnapshotId ?? "missing_issuer_source",
        traceRefs: [c.cardAccountId, c.statementId, source?.ruleSnapshotId ?? "missing_issuer_source"] });
    };
    const sourceOK = (s: IssuerSource, at: CivilDate): boolean => !!s && periodOK(s) && dateOK(s.asOf)
      && [s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text)
      && s.projectionStatus === "verified" && s.issuerId === c.issuerId && s.personId === c.personId
      && s.cardAccountId === c.cardAccountId && s.start <= at && at < s.endExclusive;
    const moneyOK = (m: Money): boolean => m instanceof Money && m.currency.equals(c.currency)
      && !m.isNegative() && m.amount.fitsScale(c.currency.minorUnitScale);
    // Missing runtime policy is incompleteness even at an untyped adapter boundary.
    if (!c.minimum || !c.allocationPolicy || !c.postingPolicy || !c.payment || !c.payment.source || !c.payment.funding) {
      fail("SOURCE_REQUIRED", "explicit issuer minimum, allocation, cutoff and payment evidence");
      continue;
    }
    if (![c.householdId, c.personId, c.issuerId, c.cardAccountId, c.statementId].every(text)
      || c.payment.payerId !== c.personId || !text(c.payment.sourceAccountId)
      || c.payment.sourceAccountId === c.cardAccountId || !text(c.payment.operationId))
      fail("IDENTITY_REQUIRED", "matching borrower/card/payer and distinct named funding account");
    if (cards.filter(other => other.cardAccountId === c.cardAccountId).length !== 1)
      fail("DUPLICATE_ACCOUNT", "one provider account per liability per evaluation");
    if (paymentIds.filter(id => id === c.payment.operationId).length !== 1)
      fail("DUPLICATE_POSTING", "globally unique proposed payment operation identity");
    if (proposedRecognitionIds.includes(c.payment.operationId) || recognitionIds(c).some(id => paymentIds.includes(id)))
      fail("DUPLICATE_POSTING", "settlement and recognition operations must have distinct identities");
    if (c.instrumentFamily !== "credit_card" || c.interestPolicy !== "issuer_statement_quote"
      || c.balanceBasis !== "principal_plus_itemized_charges" || c.openingBasis !== "principal_only_no_unpaid_charges"
      || c.charges.some(x => !["interest", "ordinary_fee"].includes(x.kind))
      || c.transactions.some(x => !["purchase", "refund", "payment"].includes(x.kind)))
      fail("UNSUPPORTED_CAPABILITY", "ordinary card statement quote only; HELOC, APR/accrual/grace, late fees and promotions require another capability");
    if (!periodOK(c.cycle) || c.cycle.start !== request.period.start || c.cycle.endExclusive !== request.period.endExclusive)
      fail("STATEMENT_UNAVAILABLE", "issuer statement for exactly the requested cycle; no extrapolation");
    if (![c.statementDate, c.dueDate, c.payment.effectiveAt].every(dateOK) || c.statementDate < c.cycle.endExclusive
      || c.dueDate < c.statementDate || c.payment.effectiveAt < c.statementDate || c.payment.effectiveAt > c.dueDate
      || c.postingPolicy.convention !== "posted_date_end_exclusive" || c.postingPolicy.completeCycleActivity !== true
      || c.payment.balanceConvention !== "statement_only_no_intervening_activity")
      fail("TRANSACTION_WINDOW_AMBIGUOUS", "posted-date cutoff, statement/due dates and on-time payment against unchanged statement balance");
    for (const [s, at] of [[c.statementSource, c.statementDate], [c.minimum.source, c.statementDate],
      [c.allocationPolicy.source, c.payment.effectiveAt], [c.postingPolicy.source, c.cycle.start], [c.payment.source, c.payment.effectiveAt]] as const)
      if (!sourceOK(s, at)) fail("SOURCE_REQUIRED", "verified issuer/borrower/account-matched evidence effective at operation date", s);
    if (c.postingPolicy.source && c.postingPolicy.source.endExclusive < c.cycle.endExclusive)
      fail("SOURCE_REQUIRED", "posting policy covering the complete cycle", c.postingPolicy.source);
    if (c.minimum.kind !== "issuer_quote") fail("MINIMUM_POLICY_REQUIRED", "issuer statement minimum quote; formula evaluation unsupported", c.minimum.source);
    const order = c.allocationPolicy.order ?? [];
    if (c.allocationPolicy.kind !== "issuer_order" || order.length !== 3 || new Set(order).size !== 3 || order.some(k => !components.includes(k)))
      fail("ALLOCATION_POLICY_REQUIRED", "issuer-authorized total order over principal, interest and permitted fees", c.allocationPolicy.source);
    const postings = [...c.transactions, ...c.charges].sort(postingOrder);
    const postingIds = new Set<string>(); const slots = new Set<string>();
    for (const p of postings) {
      if (!text(p.postingId) || postingIds.has(p.postingId) || p.postingId === c.payment.operationId)
        fail("DUPLICATE_POSTING", "unique source postings distinct from proposed payment", p.source);
      postingIds.add(p.postingId);
      const slot = JSON.stringify([p.effectiveAt, p.sequence]);
      if (!dateOK(p.effectiveAt) || p.effectiveAt < c.cycle.start || p.effectiveAt >= c.cycle.endExclusive
        || !Number.isSafeInteger(p.sequence) || p.sequence < 0 || slots.has(slot))
        fail("TRANSACTION_WINDOW_AMBIGUOUS", "unique issuer ordering inside [cycle start, cycle end)", p.source);
      slots.add(slot);
      if (!sourceOK(p.source, p.effectiveAt)) fail("SOURCE_REQUIRED", "verified source posting scope", p.source);
      if (p.kind !== "payment" && !["already_recognized", "propose_expense"].includes(p.recognition))
        fail("SOURCE_REQUIRED", "explicit observed versus proposed recognition", p.source);
    }
    const amounts = [c.openingPrincipal, c.statementPrincipal, c.statementInterest, c.statementFees, c.statementTotal, c.minimum.amount, c.payment.funding.amount,
      ...(c.payment.funding.kind === "insufficient" ? [c.payment.funding.available] : []),
      ...postings.flatMap(p => [p.amount, ...(p.kind === "payment" ? components.map(k => p.allocation[k]) : [])])];
    if (!amounts.every(moneyOK)) fail("MONEY_INVALID", "nonnegative exact currency minor-unit amounts throughout");
    if (!["requested", "insufficient"].includes(c.payment.funding.kind)) fail("PAYMENT_FACT_REQUIRED", "requested amount or insufficient-funding fact");
    if (errors.size) continue;
    const zero = Money.zero(c.currency);
    const balances = { principal: c.openingPrincipal, interest: zero, fees: zero };
    for (const p of postings) {
      switch (p.kind) {
        case "purchase": balances.principal = balances.principal.plus(p.amount); break;
        case "refund": balances.principal = balances.principal.minus(p.amount); break;
        case "interest": balances.interest = balances.interest.plus(p.amount); break;
        case "ordinary_fee": balances.fees = balances.fees.plus(p.amount); break;
        case "payment":
          if (!total(p.allocation).equals(p.amount)) fail("STATEMENT_MISMATCH", "prior issuer payment split must equal payment", p.source);
          for (const k of components) balances[k] = balances[k].minus(p.allocation[k]);
          break;
      }
      if (components.some(k => balances[k].isNegative())) fail("NEGATIVE_BALANCE", "refund/payment cannot exceed outstanding component; credit balances unsupported", p.source);
    }
    if (!balances.principal.equals(c.statementPrincipal) || !balances.interest.equals(c.statementInterest)
      || !balances.fees.equals(c.statementFees) || !total(balances).equals(c.statementTotal))
      fail("STATEMENT_MISMATCH", "statement principal and total must reconcile to opening principal and every event/charge");
    if (c.minimum.amount.compare(c.statementTotal) > 0) fail("STATEMENT_MISMATCH", "minimum cannot exceed statement liability", c.minimum.source);
    const f = c.payment.funding;
    if (f.amount.compare(c.statementTotal) > 0) fail("PAYMENT_EXCEEDS_DUE", "request cannot exceed legally due amount; no silent cap", c.payment.source);
    if (f.kind === "insufficient" && f.available.compare(f.amount) >= 0)
      fail("PAYMENT_FACT_REQUIRED", "available amount must be strictly below requested amount", c.payment.source);
    if (f.kind === "insufficient" && !["authorized", "declined"].includes(f.partialFunding))
      fail("PAYMENT_FACT_REQUIRED", "explicit partial-payment authorization or decline", c.payment.source);
    if (errors.size) continue;
    const potential = f.kind === "insufficient" ? f.partialFunding === "authorized" ? f.available : zero : f.amount;
    const allocation = { principal: zero, interest: zero, fees: zero };
    let unallocated = potential;
    for (const k of order) { allocation[k] = min(unallocated, balances[k]); unallocated = unallocated.minus(allocation[k]); }
    const remaining = { principal: balances.principal.minus(allocation.principal), interest: balances.interest.minus(allocation.interest), fees: balances.fees.minus(allocation.fees) };
    const claimId = JSON.stringify(["card_statement", c.issuerId, c.cardAccountId, c.statementId]);
    const recognitionProposals: CardProposal["recognitionProposals"][number][] = [];
    for (const p of postings) if (p.kind !== "payment" && p.recognition === "propose_expense" && p.amount.isPositive())
      recognitionProposals.push({ operationId: recognitionId(c, p),
        kind: p.kind === "refund" ? "uncommitted_expense_reversal" : "uncommitted_expense", actorId: c.personId,
        effectiveAt: p.effectiveAt, grossAmount: p.amount, sourcePostingId: p.postingId, ruleSnapshotId: p.source.ruleSnapshotId, claimId });
    const minimumUnfunded = c.minimum.amount.minus(min(c.minimum.amount, potential));
    proposals.push({ contractVersion: "d2-shared/v1", instrumentFamily: "credit_card", householdId: c.householdId,
      personId: c.personId, cardAccountId: c.cardAccountId, statementId: c.statementId, cycle: c.cycle,
      statementDate: c.statementDate, dueDate: c.dueDate, statementLiability: c.statementTotal, statementComponents: balances,
      requiredService: c.minimum.amount, requestedPayment: f.amount, potentialPayment: potential, potentialAllocation: allocation,
      minimumUnfunded, fundingStatus: minimumUnfunded.isPositive() ? "minimum_unfunded" : f.kind === "insufficient" ? "partial_funding_reported" : "requested_uncommitted",
      remainingIfSettled: remaining, remainingRevolvingIfSettled: total(remaining),
      claim: { claimId, originalAmount: c.statementTotal, outstandingAmount: c.statementTotal,
        originatingFactIds: [JSON.stringify(["card_opening", c.cardAccountId, c.cycle.start]), ...postings.map(p => p.postingId)], effectiveAt: c.statementDate, dueDate: c.dueDate },
      recognitionProposals, settlementProposals: potential.isZero() ? [] : [{ operationId: c.payment.operationId,
        kind: "uncommitted_card_payment", actorId: c.payment.payerId, effectiveAt: c.payment.effectiveAt,
        sourceAccountId: c.payment.sourceAccountId, destinationAccountId: c.cardAccountId, claimId, grossAmount: potential,
        allocation, ruleSnapshotId: c.allocationPolicy.source.ruleSnapshotId, recognition: "none" }],
      evidence: { ...c, transactions: [...c.transactions].sort(postingOrder), charges: [...c.charges].sort(postingOrder) },
      traceRefs: [...new Set([c.statementSource, c.minimum.source, c.postingPolicy.source, c.allocationPolicy.source, c.payment.source,
        ...postings.map(p => p.source)].map(s => s.ruleSnapshotId))].sort(ordered) });
  }
  diagnostics.sort((a, b) => ordered(a.sourceEntityPath, b.sourceEntityPath) || ordered(a.diagnosticCode, b.diagnosticCode)
    || ordered(JSON.stringify(a), JSON.stringify(b)));
  return Object.freeze(snapshot({ contractVersion: "d2-shared/v1" as const,
    proposals: proposals as readonly CardProposal[], diagnostics: diagnostics as readonly RevolvingDiagnostic[],
    statementCoverage: diagnostics.length ? "incomplete" as const : "complete" as const,
    netCashCoverage: "incomplete" as const, taxEffectsCoverage: "incomplete" as const, futureCycleCoverage: "incomplete" as const }));
}
