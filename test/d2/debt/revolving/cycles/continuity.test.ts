import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../../src/time/index.js";
import { Currency, money } from "../../../../../src/values/index.js";
import { type CreditCardStatement, type IssuerSource, type PaymentSplit } from "../../../../../src/simulation/d2/debt/revolving/index.js";
import { reconcileCreditCardCycles, type CreditCardContinuityRequest, type CycleRegister,
  type ObservedPosting } from "../../../../../src/simulation/d2/debt/revolving/cycles/index.js";

type Cycle = CreditCardContinuityRequest["cycles"][number];
const dates = ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"].map(civilDate);
const split = (principal: string, interest = "0", fees = "0"): PaymentSplit => ({
  principal: money(principal), interest: money(interest), fees: money(fees),
});
const total = (s: PaymentSplit) => s.principal.plus(s.interest).plus(s.fees);
const source = (n: number, account: string, role: string): IssuerSource => ({
  start: civilDate("2025-01-01"), endExclusive: civilDate("2027-01-01"),
  issuerId: "synthetic-issuer", personId: `person-${account}`, cardAccountId: account,
  ruleSnapshotId: `${account}-${n}-${role}`, jurisdiction: "US", ruleFamily: "synthetic_issuer_statement",
  sourcePublication: `Synthetic dated ${role} evidence, not a universal card rule`,
  asOf: dates[n + 1]!, version: "1", projectionStatus: "verified",
});
function fixture(n: number, opening: string, closing: PaymentSplit, allocation: PaymentSplit,
  account = "card", purchases = "0", refunds = "0"): Cycle {
  const s = source(n, account, "statement");
  const cycle = { start: dates[n]!, endExclusive: dates[n + 1]! };
  const c: CreditCardStatement = {
    instrumentFamily: "credit_card", householdId: "household", personId: s.personId, issuerId: s.issuerId,
    cardAccountId: account, currency: Currency.of("USD"), statementId: `${account}-${n}`, cycle,
    statementDate: cycle.endExclusive, dueDate: cycle.endExclusive, statementSource: s,
    openingPrincipal: money(opening), openingBasis: "principal_only_no_unpaid_charges",
    statementPrincipal: closing.principal, statementInterest: closing.interest, statementFees: closing.fees,
    statementTotal: total(closing), balanceBasis: "principal_plus_itemized_charges", interestPolicy: "issuer_statement_quote",
    charges: [
      { kind: "interest", postingId: `${account}-${n}-interest`, effectiveAt: cycle.start, sequence: 3,
        amount: closing.interest, source: s, recognition: "already_recognized" },
      { kind: "ordinary_fee", postingId: `${account}-${n}-fee`, effectiveAt: cycle.start, sequence: 4,
        amount: closing.fees, source: s, recognition: "already_recognized" },
    ],
    transactions: [
      { kind: "purchase", postingId: `${account}-${n}-purchase`, effectiveAt: cycle.start, sequence: 1,
        amount: money(purchases), source: s, recognition: "already_recognized" },
      { kind: "refund", postingId: `${account}-${n}-refund`, effectiveAt: cycle.start, sequence: 2,
        amount: money(refunds), source: s, recognition: "already_recognized" },
    ],
    postingPolicy: { convention: "posted_date_end_exclusive", completeCycleActivity: true, source: s },
    minimum: { kind: "issuer_quote", amount: money("50"), source: source(n, account, "minimum") },
    allocationPolicy: { kind: "issuer_order", order: ["interest", "fees", "principal"], source: source(n, account, "allocation") },
    payment: { operationId: `${account}-${n}-operation`, payerId: s.personId, sourceAccountId: `bank-${account}`,
      effectiveAt: cycle.endExclusive, funding: { kind: "requested", amount: total(allocation) },
      balanceConvention: "statement_only_no_intervening_activity", source: source(n, account, "payment") },
  };
  const payment: ObservedPosting = {
    event: { kind: "payment", postingId: `${account}-${n}-posted-payment`, effectiveAt: cycle.endExclusive,
      sequence: 0, amount: total(allocation), allocation, source: c.payment.source }, knownAt: cycle.endExclusive,
    issuerPayment: { operationId: c.payment.operationId, settlementId: `${account}-${n}-settlement`,
      sourceAccountId: c.payment.sourceAccountId, allocationSource: c.allocationPolicy.source },
    bankConfirmation: { confirmationId: `${account}-${n}-confirmation`, settlementId: `${account}-${n}-settlement`,
      operationId: c.payment.operationId, householdId: c.householdId, personId: c.personId,
      sourceAccountId: c.payment.sourceAccountId, cardAccountId: account, issuerId: c.issuerId,
      effectiveAt: cycle.endExclusive, knownAt: cycle.endExclusive, amount: total(allocation),
      authorization: { authorizationId: `${account}-${n}-authorization`, effectiveAt: cycle.endExclusive,
        amount: total(allocation), sourcePublication: "Synthetic independent payment authorization" },
      sourcePublication: "Synthetic independent bank posted statement", version: "1", status: "posted" },
  };
  const r: CycleRegister = {
    statementId: c.statementId, cardAccountId: account, knownAt: cycle.endExclusive, source: source(n, account, "register"), complete: true,
    activity: [...c.transactions, ...c.charges].map(event => ({ event, knownAt: cycle.endExclusive })),
    opening: { effectiveAt: cycle.start, components: split(opening),
      convention: "principal_only_after_boundary_postings_no_unpaid_charges", source: source(n, account, "opening") },
    boundary: { source: source(n, account, "boundary"), complete: true, payments: [payment] },
  };
  return { request: { period: cycle, cards: [c] }, registers: [r] };
}
const history = (three = false, account = "card"): CreditCardContinuityRequest => ({ knownAt: civilDate("2026-03-01"), cycles: [
  fixture(0, "1000", split("1100", "20"), split("180", "20"), account, "100"),
  fixture(1, "920", split("920", "18.40"), split("81.60", "18.40"), account),
  ...(three ? [fixture(2, "838.40", split("848.40", "0", "5"), split("45", "0", "5"), account, "20", "10")] : []),
] });
const card = (c: Cycle): CreditCardStatement => c.request.cards[0]!;
const register = (c: Cycle): CycleRegister => c.registers[0]!;
const edit = (input: CreditCardContinuityRequest, n: number, fn: (c: Cycle) => Cycle): CreditCardContinuityRequest => ({
  ...input, cycles: input.cycles.map((c, i) => i === n ? fn(c) : c),
});
const editCard = (input: CreditCardContinuityRequest, n: number, fn: (c: CreditCardStatement) => CreditCardStatement) =>
  edit(input, n, c => ({ ...c, request: { ...c.request, cards: [fn(card(c))] } }));
const editRegister = (input: CreditCardContinuityRequest, n: number, fn: (r: CycleRegister) => CycleRegister) =>
  edit(input, n, c => ({ ...c, registers: [fn(register(c))] }));
const editPayment = (input: CreditCardContinuityRequest, fn: (p: ObservedPosting) => ObservedPosting) =>
  editRegister(input, 0, r => ({ ...r, boundary: { ...r.boundary, payments: r.boundary.payments.map(fn) } }));
function rejected(input: CreditCardContinuityRequest, code: string) {
  const before = JSON.stringify(input); const result = reconcileCreditCardCycles(input);
  expect(result.records.every(r => r.conditionalContinuity.length === 0)).toBe(true);
  expect(result.diagnostics.map(d => d.diagnosticCode)).toContain(code);
  expect(result.coverage).toBe("incomplete");
  expect(JSON.stringify(input)).toBe(before);
  return result;
}

describe("source-verified card cycle continuity (isolated documentary evidence)", () => {
  it.each([false, true])("recomputes the two/three-cycle oracle (third=%s), never applies BANK cash", three => {
    const result = reconcileCreditCardCycles(history(three)); const r = result.records[0]!;
    expect(r.status).toBe("conditional_continuity");
    expect(r.conditionalContinuity).toHaveLength(three ? 2 : 1);
    expect(r.cycles[0]!.closing.components.principal.equals(money("1100"))).toBe(true);
    expect(r.cycles[0]!.proposedPayment.statementLiability.equals(money("1120"))).toBe(true);
    expect(r.cycles[0]!.proposedPayment.potentialAllocation).toEqual(split("180", "20"));
    expect(r.conditionalContinuity[0]!.components).toEqual(split("920"));
    expect(r.cycles[1]!.afterBoundary).toEqual(split("838.40"));
    if (three) expect(r.cycles[2]!.afterBoundary).toEqual(split("803.40"));
    expect(r.cycles.every(c => c.unpaidRequiredService.isZero())).toBe(true);
    expect(r.cycles[0]!.proposedPayment.recognitionProposals).toEqual([]);
    expect(r.committed).toBe(false); expect(r.postable).toBe(false);
    expect(result.physicalBankSettlement).toBe("not_applied");
    expect(r.coverage).toBe("incomplete"); expect(r.futureCycleCoverage).toBe("incomplete");
    expect(result.diagnostics.map(d => d.diagnosticCode)).toEqual(["BANK_INTEGRATION_PENDING"]);
    expect(r.integrationPrerequisite).toContain("#149");
  });

  it("ignores caller proposal/coverage flags and requires separately posted evidence for $920", () => {
    const input = editRegister(history(), 0, r => ({ ...r, boundary: { ...r.boundary, payments: [] } }));
    const forged = { ...input, futureCycleCoverage: "complete", potentialPayment: money("200"), remainingIfSettled: split("920") };
    const r = rejected(forged, "MINIMUM_UNPAID");
    expect(r.records[0]!.cycles[0]!.afterBoundary).toEqual(split("1100", "20"));
    expect(r.records[0]!.cycles[0]!.unpaidRequiredService.equals(money("50"))).toBe(true);
  });

  it("requires full historical activity and independently linked payment documents", () => {
    rejected(edit(history(), 0, c => ({ ...c, registers: [] })), "HISTORY_REQUIRED");
    rejected(editRegister(history(), 0, r => ({ ...r, activity: [] })), "REGISTER_MISMATCH");
    rejected(editRegister(history(), 0, r => ({ ...r, complete: false } as unknown as CycleRegister)), "SOURCE_INVALID");
    rejected(editPayment(history(), p => ({ event: p.event, knownAt: p.knownAt })), "PAYMENT_PROOF_REQUIRED");
    rejected(editPayment(history(), p => ({ ...p, bankConfirmation: { ...p.bankConfirmation!, status: "pending" } })), "PAYMENT_PROOF_REQUIRED");
    rejected(editPayment(history(), p => ({ ...p, issuerPayment: { ...p.issuerPayment!, settlementId: "unrelated" } })), "PAYMENT_MISMATCH");
    rejected(editPayment(history(), p => ({ ...p, bankConfirmation: { ...p.bankConfirmation!, amount: money("199.99") } })), "PAYMENT_MISMATCH");
    rejected(editPayment(history(), p => ({ ...p, bankConfirmation: { ...p.bankConfirmation!, authorization: {
      ...p.bankConfirmation!.authorization, amount: money("199") } } })), "PAYMENT_MISMATCH");
  });

  it("rejects tampered prior posting amounts, source content, allocation and owner", () => {
    rejected(editRegister(history(), 0, r => ({ ...r, activity: r.activity.map((p, i) => i ? p : {
      ...p, event: { ...p.event, amount: money("99") } }) })), "REGISTER_MISMATCH");
    rejected(editRegister(history(), 0, r => ({ ...r, activity: r.activity.map((p, i) => i ? p : {
      ...p, event: { ...p.event, source: { ...p.event.source, sourcePublication: "changed" } } }) })), "REGISTER_MISMATCH");
    rejected(editPayment(history(), p => ({ ...p, event: { ...p.event, kind: "payment", allocation: split("179", "21") } })), "PAYMENT_MISMATCH");
    rejected(editPayment(history(), p => ({ ...p, bankConfirmation: { ...p.bankConfirmation!, personId: "other" } })), "PAYMENT_MISMATCH");
  });

  it("reports authorized partial and declined payments with exact shortfall and no invented fee", () => {
    for (const partialFunding of ["authorized", "declined"] as const) {
      let input = editCard(history(), 0, c => ({ ...c, payment: { ...c.payment, funding: {
        kind: "insufficient", amount: money("200"), available: money("30"), partialFunding } } }));
      input = editRegister(input, 0, r => ({ ...r, boundary: { ...r.boundary, payments: partialFunding === "declined" ? [] : r.boundary.payments.map(p => ({
        ...p, event: { ...p.event, kind: "payment", amount: money("30"), allocation: split("10", "20") },
        bankConfirmation: { ...p.bankConfirmation!, amount: money("30") },
      })) } }));
      const r = rejected(input, "MINIMUM_UNPAID").records[0]!.cycles[0]!;
      expect(r.unpaidRequiredService.equals(money(partialFunding === "authorized" ? "20" : "50"))).toBe(true);
      expect(r.afterBoundary).toEqual(partialFunding === "authorized" ? split("1090") : split("1100", "20"));
      expect(r.serviceStatus).toBe("unpaid");
      expect(r.timeliness).toBe("overdue");
      expect(r.closing.components.fees.isZero()).toBe(true);
    }
  });

  it("does not hide leftover interest/fees in a principal-only successor opening", () => {
    let input = editCard(history(), 0, c => ({ ...c, allocationPolicy: { ...c.allocationPolicy, order: ["principal", "interest", "fees"] } }));
    input = editPayment(input, p => ({ ...p, event: { ...p.event, kind: "payment", allocation: split("200") } }));
    const result = rejected(input, "UNPAID_NONPRINCIPAL");
    expect(result.records[0]!.cycles[0]!.afterBoundary).toEqual(split("900", "20"));
    rejected(editRegister(history(), 1, r => ({ ...r, opening: { ...r.opening, components: split("920", "1") } })), "UNPAID_NONPRINCIPAL");
    rejected(editCard(history(), 1, c => ({ ...c, openingPrincipal: money("921"), statementPrincipal: money("921"), statementTotal: money("939.40") })), "UNPAID_NONPRINCIPAL");
    let drift = editCard(history(), 1, c => ({ ...c, openingPrincipal: money("921"), statementPrincipal: money("921"), statementTotal: money("939.40") }));
    drift = editRegister(drift, 1, r => ({ ...r, opening: { ...r.opening, components: split("921") } }));
    rejected(drift, "OPENING_DRIFT");
    let fee = editCard(history(true), 2, c => ({ ...c, allocationPolicy: { ...c.allocationPolicy, order: ["principal", "fees", "interest"] } }));
    fee = editRegister(fee, 2, r => ({ ...r, boundary: { ...r.boundary, payments: r.boundary.payments.map(p => ({
      ...p, event: { ...p.event, kind: "payment", allocation: split("50") },
    })) } }));
    const feeResult = rejected(fee, "UNPAID_NONPRINCIPAL");
    expect(feeResult.records[0]!.cycles[2]!.afterBoundary).toEqual(split("798.40", "0", "5"));
  });

  it("requires independent bank evidence for historical payments inside a statement, exactly once", () => {
    let input = history();
    const original = input.cycles[0]!; const c = card(original); const r = register(original);
    const template = r.boundary.payments[0]!;
    const at = civilDate("2025-12-02");
    const past: ObservedPosting = {
      event: { kind: "payment", postingId: "historical-posting", effectiveAt: at, sequence: 0,
        amount: money("10"), allocation: split("10"), source: c.payment.source }, knownAt: r.knownAt,
      issuerPayment: { operationId: "historical-operation", settlementId: "historical-settlement",
        sourceAccountId: c.payment.sourceAccountId, allocationSource: { ...c.allocationPolicy.source, ruleSnapshotId: "historical-allocation" } },
      bankConfirmation: { ...template.bankConfirmation!, operationId: "historical-operation", settlementId: "historical-settlement",
        confirmationId: "historical-confirmation", effectiveAt: at, amount: money("10"),
        authorization: { ...template.bankConfirmation!.authorization, authorizationId: "historical-authorization", effectiveAt: at, amount: money("10") } },
    };
    input = edit(input, 0, item => ({ request: { ...item.request, cards: [{ ...c,
      transactions: [...c.transactions, past.event as Extract<typeof past.event, { kind: "payment" }>],
      statementPrincipal: money("1090"), statementTotal: money("1110"),
    }] }, registers: [{ ...r, activity: [...r.activity, past] }] }));
    input = editCard(input, 1, c => ({ ...c, openingPrincipal: money("910"), statementPrincipal: money("910"), statementTotal: money("928.40") }));
    input = editRegister(input, 1, r => ({ ...r, opening: { ...r.opening, components: split("910") } }));
    const result = reconcileCreditCardCycles(input);
    expect(result.records[0]!.status).toBe("conditional_continuity");
    expect(result.records[0]!.cycles[0]!.afterBoundary).toEqual(split("910"));
    expect(result.records[0]!.cycles[1]!.afterBoundary).toEqual(split("828.40"));
    expect(result.records[0]!.cycles[0]!.proposedPayment.recognitionProposals).toEqual([]);
    rejected(editRegister(input, 0, r => ({ ...r, activity: r.activity.map(p => p.event.kind === "payment"
      ? { event: p.event, knownAt: p.knownAt } : p) })), "PAYMENT_PROOF_REQUIRED");
    rejected(editRegister(input, 0, r => ({ ...r, activity: r.activity.map(p => p.event.kind === "payment"
      ? { ...p, event: { ...p.event, allocation: split("9", "1") } } : p) })), "REGISTER_MISMATCH");
  });

  it("rejects gaps, overlaps, duplicate cycles and reused statement/allocation/settlement IDs", () => {
    for (const start of ["2026-01-02", "2025-12-31"]) {
      const input = edit(history(), 1, item => {
        const c = card(item); const r = register(item); const cycle = { ...c.cycle, start: civilDate(start) };
        return { request: { period: cycle, cards: [{ ...c, cycle }] }, registers: [{ ...r, opening: { ...r.opening, effectiveAt: cycle.start } }] };
      });
      // A gap may first reject out-of-window activity in the unchanged owner.
      rejected(input, start === "2026-01-02" ? "OWNER_QUOTE_REJECTED" : "CYCLE_NOT_ADJACENT");
    }
    const h = history();
    rejected({ ...h, cycles: [h.cycles[0]!, h.cycles[0]!] }, "DUPLICATE_IDENTITY");
    rejected(editCard(h, 1, c => ({ ...c, statementId: card(h.cycles[0]!).statementId })), "DUPLICATE_IDENTITY");
    rejected(editCard(h, 1, c => ({ ...c, allocationPolicy: { ...c.allocationPolicy, source: card(h.cycles[0]!).allocationPolicy.source } })), "DUPLICATE_IDENTITY");
    rejected(editRegister(h, 1, r => ({ ...r, boundary: { ...r.boundary, payments: r.boundary.payments.map(p => ({ ...p,
      bankConfirmation: { ...p.bankConfirmation!, settlementId: register(h.cycles[0]!).boundary.payments[0]!.bankConfirmation!.settlementId } })) } })), "DUPLICATE_IDENTITY");
  });

  it("never applies an early, late or subsequent-cycle payment to an earlier opening", () => {
    for (const at of ["2025-12-31", "2026-01-02", "2026-01-26"]) {
      rejected(editPayment(history(), p => ({ ...p, event: { ...p.event, effectiveAt: civilDate(at) },
        bankConfirmation: { ...p.bankConfirmation!, effectiveAt: civilDate(at), knownAt: civilDate("2026-02-01"),
          authorization: { ...p.bankConfirmation!.authorization, effectiveAt: civilDate(at) } }, knownAt: civilDate("2026-02-01") })), "SOURCE_INVALID");
    }
    rejected(editCard(history(), 0, c => ({ ...c, payment: { ...c.payment, effectiveAt: civilDate("2026-01-02") } })), "OWNER_QUOTE_REJECTED");
    let late = editCard(history(), 0, c => ({ ...c, dueDate: civilDate("2026-01-25") }));
    late = editPayment(late, p => ({ ...p, event: { ...p.event, effectiveAt: civilDate("2026-01-02") },
      knownAt: civilDate("2026-01-02"), bankConfirmation: { ...p.bankConfirmation!, effectiveAt: civilDate("2026-01-02"),
        knownAt: civilDate("2026-01-02") } }));
    late = editRegister(late, 0, r => ({ ...r, knownAt: civilDate("2026-01-02") }));
    rejected(late, "PAYMENT_MISMATCH");
  });

  it("rejects source lookahead, stale effective coverage and unverified future rules/minimums", () => {
    rejected({ ...history(), knownAt: civilDate("2025-12-31") }, "SOURCE_INVALID");
    rejected(editRegister(history(), 0, r => ({ ...r, source: { ...r.source, asOf: civilDate("2026-02-01") } })), "SOURCE_INVALID");
    rejected(editRegister(history(), 0, r => ({ ...r, source: { ...r.source, endExclusive: civilDate("2026-01-01") } })), "SOURCE_INVALID");
    rejected(editCard(history(), 0, c => ({ ...c, minimum: { ...c.minimum, source: { ...c.minimum.source, projectionStatus: "explicit_projected" } } })), "OWNER_QUOTE_REJECTED");
    for (const interestPolicy of ["apr_accrual", "grace_calculation"] as const)
      rejected(editCard(history(), 0, c => ({ ...c, interestPolicy })), "OWNER_QUOTE_REJECTED");
    rejected(editCard(history(), 0, c => ({ ...c, minimum: { ...c.minimum, kind: "unsupported_formula" } })), "OWNER_QUOTE_REJECTED");
    rejected(editCard(history(), 0, c => ({ ...c, minimum: { ...c.minimum, amount: money("1120.01") } })), "OWNER_QUOTE_REJECTED");
  });

  it("gates other instruments, owner changes, currencies and sub-cent/negative amounts", () => {
    rejected(editCard(history(), 0, c => ({ ...c, instrumentFamily: "heloc" })), "OWNER_QUOTE_REJECTED");
    rejected(editCard(history(), 0, c => ({ ...c, instrumentFamily: "auto" } as unknown as CreditCardStatement)), "OWNER_QUOTE_REJECTED");
    rejected(editCard(history(), 1, c => ({ ...c, householdId: "new-household" })), "IDENTITY_MISMATCH");
    rejected(editCard(history(), 1, c => ({ ...c, personId: "new-person" })), "OWNER_QUOTE_REJECTED");
    rejected(editCard(history(), 1, c => ({ ...c, issuerId: "new-issuer" })), "OWNER_QUOTE_REJECTED");
    for (const amount of [money("200.001"), money("-1"), money("200", Currency.of("EUR"))])
      rejected(editPayment(history(), p => ({ ...p, bankConfirmation: { ...p.bankConfirmation!, amount } })), "PAYMENT_MISMATCH");
    const h = history();
    rejected({ ...h, cycles: [h.cycles[0]!, history(false, "new-card").cycles[1]!] }, "HISTORY_REQUIRED");
  });

  it("reconciles zero-interest exact cents and very large Money without numeric conversion", () => {
    const huge = "900719925474099312345.67";
    const input: CreditCardContinuityRequest = { knownAt: civilDate("2026-03-01"), cycles: [
      fixture(0, huge, split(huge), split("50.01")),
      fixture(1, "900719925474099312295.66", split("900719925474099312295.66"), split("50.02")),
    ] };
    const result = reconcileCreditCardCycles(input);
    expect(result.records[0]!.status).toBe("conditional_continuity");
    expect(result.records[0]!.cycles[1]!.afterBoundary).toEqual(split("900719925474099312245.64"));
  });

  it("uses issuer same-day sequence; reversal of cards, histories and activity is deterministic", () => {
    const h = history(true); const b = history(true, "second");
    const input: CreditCardContinuityRequest = { ...h, cycles: h.cycles.map((c, i) => ({
      request: { ...c.request, cards: [...c.request.cards, ...b.cycles[i]!.request.cards] },
      registers: [...c.registers, ...b.cycles[i]!.registers],
    })) };
    const result = reconcileCreditCardCycles(input);
    expect(result.records.every(r => r.status === "conditional_continuity")).toBe(true);
    const reversed = { ...input, cycles: [...input.cycles].reverse().map(c => ({
      request: { ...c.request, cards: [...c.request.cards].reverse().map(c => ({ ...c,
        transactions: [...c.transactions].reverse(), charges: [...c.charges].reverse() })) },
      registers: [...c.registers].reverse().map(r => ({ ...r, activity: [...r.activity].reverse() })),
    })) };
    expect(reconcileCreditCardCycles(reversed)).toEqual(result);
    rejected(editRegister(h, 0, r => ({ ...r, boundary: { ...r.boundary, payments: [...r.boundary.payments, ...r.boundary.payments] } })), "DUPLICATE_IDENTITY");
    rejected(editCard(h, 0, c => ({ ...c, transactions: c.transactions.map(p => ({ ...p, sequence: 0 })) })), "OWNER_QUOTE_REJECTED");
  });

  it("returns independent deeply frozen evidence and bounded statements without modifying input", () => {
    const input = history(true); const before = JSON.stringify(input); const result = reconcileCreditCardCycles(input);
    const cycle = result.records[0]!.cycles[0]!;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(cycle.observedBoundaryPayments[0]!.bankConfirmation!.authorization)).toBe(true);
    expect(Object.isFrozen(cycle.proposedPayment.evidence.statementSource)).toBe(true);
    expect(cycle.observedActivity).not.toBe(register(input.cycles[0]!).activity);
    expect(cycle.observedActivity[0]!.event.source).not.toBe(register(input.cycles[0]!).activity[0]!.event.source);
    expect(Object.isFrozen(register(input.cycles[0]!).source)).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
    expect(reconcileCreditCardCycles(input)).toEqual(result);
  });
});
