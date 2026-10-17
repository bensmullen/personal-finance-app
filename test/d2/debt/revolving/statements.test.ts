import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, decimal, money, type Money } from "../../../../src/values/index.js";
import { proposeCreditCardStatements, type CardPosting, type CreditCardStatement, type IssuerSource,
  type RevolvingRequest, type StatementCharge } from "../../../../src/simulation/d2/debt/revolving/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const cents = (s: string): Money => money(s).times(decimal("0.01"));
const cycle = { start: civilDate("2025-12-01"), endExclusive: civilDate("2026-01-01") };
const source = (account = "card", person = "borrower"): IssuerSource => ({
  start: civilDate("2025-01-01"), endExclusive: civilDate("2027-01-01"), issuerId: "synthetic-issuer",
  personId: person, cardAccountId: account, ruleSnapshotId: `synthetic-issuer-${account}`, jurisdiction: "US",
  ruleFamily: "authored_statement", sourcePublication: "synthetic verified issuer test statement and terms; not universal card policy",
  asOf: civilDate("2026-01-01"), version: "1", projectionStatus: "verified",
});
const card = (account = "card", person = "borrower"): CreditCardStatement => {
  const s = source(account, person);
  return {
    instrumentFamily: "credit_card", householdId: "household", personId: person, issuerId: s.issuerId,
    cardAccountId: account, currency: Currency.of("USD"), statementId: `statement-${account}`, cycle,
    statementDate: civilDate("2026-01-01"), dueDate: civilDate("2026-01-25"), statementSource: s,
    openingPrincipal: money("1000"), openingBasis: "principal_only_no_unpaid_charges",
    statementPrincipal: money("1000"), statementInterest: money("20"), statementFees: money("0"), statementTotal: money("1020"),
    balanceBasis: "principal_plus_itemized_charges", interestPolicy: "issuer_statement_quote",
    charges: [{ kind: "interest", postingId: `interest-${account}`, effectiveAt: civilDate("2025-12-31"), sequence: 0,
      amount: money("20"), source: s, recognition: "propose_expense" }], transactions: [],
    postingPolicy: { convention: "posted_date_end_exclusive", completeCycleActivity: true, source: s },
    // Supplemental synthetic evidence; the read-only prep fixture has NO minimum rule.
    minimum: { kind: "issuer_quote", amount: money("30"), source: { ...s, ruleSnapshotId: `synthetic-minimum-${account}` } },
    allocationPolicy: { kind: "issuer_order", order: ["interest", "fees", "principal"], source: s },
    payment: { operationId: `pay-${account}`, payerId: person, sourceAccountId: `cash-${person}`, effectiveAt: civilDate("2026-01-15"),
      funding: { kind: "requested", amount: money("100") }, balanceConvention: "statement_only_no_intervening_activity", source: s },
  };
};
const request = (...cards: CreditCardStatement[]): RevolvingRequest => ({ period: cycle, cards });
const evaluate = (c = card()) => proposeCreditCardStatements(request(c));
const proposal = (c = card()) => {
  const r = evaluate(c);
  expect(r.diagnostics).toEqual([]);
  expect(r.proposals).toHaveLength(1);
  return r.proposals[0]!;
};
const pay = (amount: string): CreditCardStatement => {
  const c = card(); return { ...c, payment: { ...c.payment, funding: { kind: "requested", amount: money(amount) } } };
};
const posting = (kind: "purchase" | "refund", amount: string, at = "2025-12-10", sequence = 0): CardPosting => ({
  kind, amount: money(amount), effectiveAt: civilDate(at), postingId: `${kind}-${at}-${sequence}`, sequence,
  source: source(), recognition: "propose_expense",
});
const rejected = (c: CreditCardStatement, code: string) => {
  const before = JSON.stringify(c); const r = evaluate(c);
  expect(r.proposals).toEqual([]);
  expect(r.statementCoverage).toBe("incomplete");
  expect(r.diagnostics.map(d => d.diagnosticCode)).toContain(code);
  expect(r.diagnostics.every(d => d.traceRefs.includes(c.statementId) && d.coverage === "incomplete")).toBe(true);
  expect(JSON.stringify(c)).toBe(before);
};

describe("D2-B ordinary credit-card statement proposals", () => {
  it("uses conditional credit_card_revolve economics with separate synthetic minimum evidence", () => {
    const f = catalog.cases.find(c => c.id === "credit_card_revolve")!;
    const c = card(); const principal = cents(f.input.amounts.openingPrincipalCents!);
    const interest = cents(f.input.amounts.statementInterestCents!);
    const p = proposal({ ...c, openingPrincipal: principal, statementPrincipal: principal, statementInterest: interest,
      statementTotal: principal.plus(interest), charges: [{ ...c.charges[0]!, amount: interest }],
      payment: { ...c.payment, effectiveAt: civilDate(f.input.terms.eventDate!), funding: { kind: "requested", amount: cents(f.input.amounts.authoredPaymentCents!) } } });
    expect(p.potentialAllocation.interest.equals(cents(f.expected.effects!.facts.interestPaidCents!))).toBe(true);
    expect(p.potentialAllocation.principal.equals(cents(f.expected.effects!.facts.principalPaidCents!))).toBe(true);
    expect(p.remainingIfSettled.principal.equals(cents(f.expected.effects!.closingCents.principal!))).toBe(true);
    expect(p.statementLiability.equals(money("1020"))).toBe(true);
    expect(p.remainingRevolvingIfSettled.equals(money("920"))).toBe(true);
    expect(p.requiredService.equals(money("30"))).toBe(true);
    expect(f.input.terms.minimumPayment).toBe("rule not supplied");
    expect(f.expected.capability).toBe("decision_required");
    expect(f.expected.integratedRuntimeEvidence).toBe(false);
    expect(p.statementDate).not.toBe(p.dueDate);
    expect(p.evidence.minimum.source.ruleSnapshotId).toBe("synthetic-minimum-card");
  });

  it.each([
    ["0", "0", "0", "1020", "30"],
    ["10", "10", "0", "1010", "20"],
    ["20", "20", "0", "1000", "10"],
    ["30", "20", "10", "990", "0"],
    ["200", "20", "180", "820", "0"],
    ["1020", "20", "1000", "0", "0"],
  ])("splits payment %s exactly without calling it committed", (amount, interest, principal, remaining, shortfall) => {
    const p = proposal(pay(amount));
    expect(p.potentialAllocation.interest.equals(money(interest))).toBe(true);
    expect(p.potentialAllocation.principal.equals(money(principal))).toBe(true);
    expect(p.remainingRevolvingIfSettled.equals(money(remaining))).toBe(true);
    expect(p.minimumUnfunded.equals(money(shortfall))).toBe(true);
    expect(p.claim.outstandingAmount.equals(money("1020"))).toBe(true);
    expect(p.settlementProposals).toHaveLength(amount === "0" ? 0 : 1);
    if (p.settlementProposals.length) {
      expect(p.settlementProposals[0]!.claimId).toBe(p.claim.claimId);
      expect(p.settlementProposals[0]!.recognition).toBe("none");
    }
  });

  it("distinguishes unfunded minimum and partially funded voluntary payment", () => {
    const c = card();
    for (const [available, status, shortfall] of [["0", "minimum_unfunded", "30"], ["10", "minimum_unfunded", "20"], ["50", "partial_funding_reported", "0"]]) {
      const p = proposal({ ...c, payment: { ...c.payment, funding: { kind: "insufficient", amount: money("100"), available: money(available!), partialFunding: "authorized" } } });
      expect(p.fundingStatus).toBe(status);
      expect(p.potentialPayment.equals(money(available!))).toBe(true);
      expect(p.requestedPayment.equals(money("100"))).toBe(true);
      expect(p.minimumUnfunded.equals(money(shortfall!))).toBe(true);
      expect(p.remainingRevolvingIfSettled.equals(money("1020").minus(money(available!)))).toBe(true);
    }
    rejected({ ...c, payment: { ...c.payment, funding: { kind: "insufficient", amount: money("100"), available: money("100"), partialFunding: "authorized" } } }, "PAYMENT_FACT_REQUIRED");
    const declined = proposal({ ...c, payment: { ...c.payment, funding: {
      kind: "insufficient", amount: money("100"), available: money("10"), partialFunding: "declined",
    } } });
    expect(declined.potentialPayment.isZero()).toBe(true);
    expect(declined.settlementProposals).toEqual([]);
    expect(declined.minimumUnfunded.equals(money("30"))).toBe(true);
  });

  it("uses an alternative explicit issuer allocation instead of universal interest-first", () => {
    const c = card(); const p = proposal({ ...c, allocationPolicy: { ...c.allocationPolicy, order: ["principal", "interest", "fees"] } });
    expect(p.potentialAllocation.principal.equals(money("100"))).toBe(true);
    expect(p.potentialAllocation.interest.isZero()).toBe(true);
    expect(p.remainingIfSettled.interest.equals(money("20"))).toBe(true);
  });

  it("reconciles purchases/refunds and emits recognition once without cash income", () => {
    const c = card(); const p = proposal({ ...c, transactions: [posting("refund", "10", "2025-12-11"), posting("purchase", "50")],
      statementPrincipal: money("1040"), statementTotal: money("1060") });
    expect(p.remainingIfSettled.principal.equals(money("960"))).toBe(true);
    expect(p.recognitionProposals.map(r => [r.kind, r.grossAmount.amount.toString()])).toEqual([
      ["uncommitted_expense", "50"], ["uncommitted_expense_reversal", "10"], ["uncommitted_expense", "20"],
    ]);
    expect(p.settlementProposals).toHaveLength(1);
    expect(Object.keys(p)).not.toContain("cashDelta");
    expect(Object.keys(p)).not.toContain("income");
    expect(evaluate().netCashCoverage).toBe("incomplete");
    expect(evaluate().taxEffectsCoverage).toBe("incomplete");
  });

  it("does not re-recognize observed expenses at payment", () => {
    const c = card(); const p = proposal({ ...c, charges: c.charges.map(x => ({ ...x, recognition: "already_recognized" })) });
    expect(p.recognitionProposals).toEqual([]);
    expect(p.settlementProposals[0]!.recognition).toBe("none");
  });

  it("accounts for prior posted payment once using issuer-quoted historical split", () => {
    const c = card(); const prior: CardPosting = { kind: "payment", postingId: "prior-pay", effectiveAt: civilDate("2025-12-31"), sequence: 1,
      amount: money("50"), source: source(), allocation: { interest: money("20"), principal: money("30"), fees: money("0") } };
    const changed = { ...c, transactions: [prior], statementPrincipal: money("970"), statementInterest: money("0"), statementTotal: money("970") };
    const p = proposal(changed);
    expect(p.potentialAllocation.principal.equals(money("100"))).toBe(true);
    expect(p.remainingRevolvingIfSettled.equals(money("870"))).toBe(true);
    expect(p.settlementProposals.map(x => x.operationId)).toEqual(["pay-card"]);
    rejected({ ...changed, transactions: [prior, prior] }, "DUPLICATE_POSTING");
    rejected({ ...changed, payment: { ...c.payment, operationId: prior.postingId } }, "DUPLICATE_POSTING");
    rejected({ ...changed, transactions: [{ ...prior, amount: money("49") }] }, "STATEMENT_MISMATCH");
  });

  it("admits only itemized ordinary issuer fees and allocates them explicitly", () => {
    const c = card(); const fee: StatementCharge = { kind: "ordinary_fee", postingId: "annual-fee", effectiveAt: civilDate("2025-12-15"),
      sequence: 0, amount: money("5"), source: source(), recognition: "propose_expense" };
    const p = proposal({ ...c, charges: [...c.charges, fee], statementFees: money("5"), statementTotal: money("1025") });
    expect(p.potentialAllocation.fees.equals(money("5"))).toBe(true);
    expect(p.potentialAllocation.principal.equals(money("75"))).toBe(true);
    for (const kind of ["late_fee", "promotion"] as const)
      rejected({ ...c, charges: [{ ...fee, kind }] }, "UNSUPPORTED_CAPABILITY");
  });

  it("rejects totals, interest or fees that fail exact statement reconciliation", () => {
    const c = card();
    for (const changed of [{ statementTotal: money("1000") }, { statementPrincipal: money("999") },
      { statementInterest: money("19") }, { statementFees: money("1") }, { charges: [] }, { minimum: { ...c.minimum, amount: money("1021") } }])
      rejected({ ...c, ...changed }, "STATEMENT_MISMATCH");
  });

  it("rejects overpayment without silently capping the requested amount", () => {
    rejected(pay("1020.01"), "PAYMENT_EXCEEDS_DUE");
  });

  it("rejects credit balances and interim negative balances even if later activity offsets them", () => {
    const c = card();
    rejected({ ...c, transactions: [posting("refund", "1001")] }, "NEGATIVE_BALANCE");
    rejected({ ...c, transactions: [posting("refund", "1100"), posting("purchase", "1100", "2025-12-11")] }, "NEGATIVE_BALANCE");
  });

  it("uses half-open posting windows and explicit issuer ordering", () => {
    const c = card(); const start = posting("purchase", "1", cycle.start);
    proposal({ ...c, transactions: [start], statementPrincipal: money("1001"), statementTotal: money("1021") });
    rejected({ ...c, transactions: [posting("purchase", "1", cycle.endExclusive)] }, "TRANSACTION_WINDOW_AMBIGUOUS");
    rejected({ ...c, transactions: [posting("purchase", "1", "2025-11-30")] }, "TRANSACTION_WINDOW_AMBIGUOUS");
    rejected({ ...c, transactions: [posting("purchase", "1"), posting("refund", "1")] }, "TRANSACTION_WINDOW_AMBIGUOUS");
    proposal({ ...c, transactions: [posting("refund", "1", "2025-12-10", 1), posting("purchase", "1")] });
  });

  it("requires a statement for the requested cycle without extrapolating future interest/minimum", () => {
    const r = proposeCreditCardStatements({ period: { start: civilDate("2026-01-01"), endExclusive: civilDate("2026-02-01") }, cards: [card()] });
    expect(r.proposals).toEqual([]);
    expect(r.diagnostics.map(d => d.diagnosticCode)).toContain("STATEMENT_UNAVAILABLE");
    expect(r.futureCycleCoverage).toBe("incomplete");
  });

  it("gates HELOC, generic APR/grace and issuer formulas", () => {
    const c = card();
    rejected({ ...c, instrumentFamily: "heloc" }, "UNSUPPORTED_CAPABILITY");
    for (const interestPolicy of ["apr_accrual", "grace_calculation"] as const)
      rejected({ ...c, interestPolicy }, "UNSUPPORTED_CAPABILITY");
    rejected({ ...c, minimum: { ...c.minimum, kind: "unsupported_formula" } }, "MINIMUM_POLICY_REQUIRED");
    rejected({ ...c, allocationPolicy: { ...c.allocationPolicy, order: [] } }, "ALLOCATION_POLICY_REQUIRED");
    rejected({ ...c, allocationPolicy: { ...c.allocationPolicy, order: ["interest", "interest", "principal"] } }, "ALLOCATION_POLICY_REQUIRED");
  });

  it("rejects mismatched owners, currencies and missing/unavailable issuer evidence", () => {
    const c = card();
    for (const s of [{ ...source(), personId: "other" }, { ...source(), cardAccountId: "other" },
      { ...source(), issuerId: "other" }, { ...source(), sourcePublication: "" },
      { ...source(), projectionStatus: "unavailable" as const }, { ...source(), projectionStatus: "explicit_projected" as const },
      { ...source(), endExclusive: c.statementDate }]) rejected({ ...c, statementSource: s }, "SOURCE_REQUIRED");
    rejected({ ...c, minimum: { ...c.minimum, source: { ...source(), projectionStatus: "unavailable" } } }, "SOURCE_REQUIRED");
    rejected({ ...c, payment: { ...c.payment, payerId: "other" } }, "IDENTITY_REQUIRED");
    for (const amount of [money("-1"), money("1.001"), money("20", Currency.of("EUR"))])
      rejected({ ...c, statementInterest: amount }, "MONEY_INVALID");
    rejected({ ...c, minimum: undefined } as unknown as CreditCardStatement, "SOURCE_REQUIRED");
    rejected({ ...c, payment: { ...c.payment, funding: undefined } } as unknown as CreditCardStatement, "SOURCE_REQUIRED");
  });

  it("gates late/pre-statement payment and missing transaction-window facts", () => {
    const c = card();
    for (const effectiveAt of [civilDate("2025-12-31"), civilDate("2026-01-26")])
      rejected({ ...c, payment: { ...c.payment, effectiveAt } }, "TRANSACTION_WINDOW_AMBIGUOUS");
    rejected({ ...c, postingPolicy: { ...c.postingPolicy, completeCycleActivity: false } } as unknown as CreditCardStatement, "TRANSACTION_WINDOW_AMBIGUOUS");
    rejected({ ...c, payment: { ...c.payment, balanceConvention: "unknown" } } as unknown as CreditCardStatement, "TRANSACTION_WINDOW_AMBIGUOUS");
  });

  it("preserves amounts far above JavaScript's safe integer range", () => {
    const c = card(); const huge = cents("900719925474099312345");
    const p = proposal({ ...c, openingPrincipal: huge, statementPrincipal: huge, statementTotal: huge.plus(money("20")) });
    expect(p.remainingIfSettled.principal.equals(huge.minus(money("80")))).toBe(true);
    expect(p.remainingRevolvingIfSettled.plus(p.potentialPayment).equals(p.statementLiability)).toBe(true);
  });

  it("keeps distinct cards/owners/sources separate with stable replay and input order", () => {
    const a = card(); const b = card("second", "second-owner");
    const input = request(a, b); const before = JSON.stringify(input);
    const r = proposeCreditCardStatements(input);
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals.map(p => p.personId)).toEqual(["borrower", "second-owner"]);
    expect(new Set(r.proposals.map(p => p.claim.claimId)).size).toBe(2);
    expect(proposeCreditCardStatements(request(b, a))).toEqual(r);
    expect(proposeCreditCardStatements(input)).toEqual(r);
    expect(JSON.stringify(input)).toBe(before);
    const duplicate = proposeCreditCardStatements(request(a, a));
    expect(duplicate.proposals).toEqual([]);
    expect(duplicate.diagnostics.map(d => d.diagnosticCode)).toContain("DUPLICATE_ACCOUNT");
    const colliding = proposeCreditCardStatements(request(a, { ...b, payment: { ...b.payment, operationId: a.payment.operationId } }));
    expect(colliding.proposals).toEqual([]);
    const recognitionCollision = proposeCreditCardStatements(request(a, { ...b, payment: { ...b.payment,
      operationId: JSON.stringify(["card_recognition", a.issuerId, a.cardAccountId, a.charges[0]!.postingId]),
    } }));
    expect(recognitionCollision.proposals).toEqual([]);
    const mixed = proposeCreditCardStatements(request(a, { ...b, statementTotal: money("0") }));
    expect(mixed.proposals.map(p => p.cardAccountId)).toEqual([a.cardAccountId]);
    expect(mixed.statementCoverage).toBe("incomplete");
  });

  it("canonicalizes posting arrays and returns frozen independent evidence", () => {
    const c = card(); const transactions = [posting("purchase", "1"), posting("refund", "1", "2025-12-11")];
    const input = { ...c, transactions }; const r = evaluate(input);
    expect(evaluate({ ...input, transactions: [...transactions].reverse() })).toEqual(r);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.proposals[0]!.evidence.statementSource)).toBe(true);
    expect(Object.isFrozen(c.statementSource)).toBe(false);
    expect(r.proposals[0]!.evidence.statementSource).not.toBe(c.statementSource);
    transactions.reverse();
    expect(r.proposals[0]!.evidence.transactions[0]!.kind).toBe("purchase");
  });
});
