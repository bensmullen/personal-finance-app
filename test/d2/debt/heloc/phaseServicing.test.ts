import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, money } from "../../../../src/values/index.js";
import type { Source } from "../../../../src/simulation/d2/debt/heloc/index.js";
import { proposeHelocPhaseServicing as propose, type PhaseServicingRequest, type PostedPrincipal,
  type PhaseDiagnosticCode } from "../../../../src/simulation/d2/debt/heloc/phaseServicing.js";

const d = civilDate;
const source = (): Source => ({ start: d("2020-01-01"), endExclusive: d("2040-01-01"), householdId: "household",
  personId: "borrower", lineId: "line", liabilityAccountId: "liability", bankAccountId: "bank",
  ruleSnapshotId: "synthetic-phase-v1", jurisdiction: "US-test", sourcePublication: "Synthetic issuer contract, not market terms",
  publishedAt: d("2023-01-01"), asOf: d("2023-01-01"), version: "1", projectionStatus: "verified" });
const request = (): PhaseServicingRequest => {
  const period = { start: d("2026-01-01"), endExclusive: d("2026-02-01") };
  const phase = { start: d("2026-01-01"), endExclusive: d("2027-01-01"), kind: "amortizing" as const };
  return {
    line: { period, evaluatedAsOf: d("2026-02-01"), householdId: "household", ownerId: "borrower", borrowerId: "borrower",
      lineId: "line", liabilityAccountId: "liability", bankAccountId: "bank", currency: Currency.of("USD"), source: source(),
      creditLimit: money("2000"), openingPrincipal: money("1000"), openedAt: d("2024-01-01"), closedAt: phase.start,
      maturityAt: phase.endExclusive, drawWindow: { start: d("2024-01-01"), endExclusive: phase.start }, revokedAt: null,
      phases: [{ start: d("2024-01-01"), endExclusive: phase.start, kind: "interest_only_draw" }, phase],
      rate: { source: source(), indexId: "synthetic-index", spreadPpm: 20000n, lookbackDays: 2, resetIntervalDays: 365,
        priorResetAt: period.start, priorRatePpm: 60000n, nextResetOrdinal: 1, roundingIncrementPpm: 1000n, rounding: "half_up",
        initialCapPpm: 20000n, recurringCapPpm: 10000n, lifetimeFloorPpm: 30000n, lifetimeCeilingPpm: 120000n,
        legalMaximum: null, resets: [], observations: [] },
      interest: { source: source(), dayCount: "actual_365_fixed", compounding: "simple", posting: "period_end_after_daily_activity",
        rounding: "half_up", dueAt: period.endExclusive }, events: [] },
    checkpoint: { originalAt: d("2024-01-01"), originalPrincipal: money("1000"), originalSource: source(),
      closingAt: period.start, closingPrincipal: money("1000"), source: source(), history: [] },
    terms: { source: source(), phase, accrualPeriod: period, dueAt: period.endExclusive, convention: "fixed_per_installment",
      method: "b1_daily_simple", rounding: "half_up", total: money("105.10"), openingPrincipal: money("1000"),
      closingPrincipal: money("900"), allocation: null, finalQuote: null },
    payment: { operationId: "payment-jan", claimId: "heloc/line/2026-01-01/2026-02-01/service", effectiveAt: period.endExclusive,
      actorId: "borrower", bankAccountId: "bank", amount: money("105.10"), source: source(), status: "authorized",
      authorization: { authorizationId: "auth-jan", source: source() }, observed: null,
      funding: { fundingId: "fund-jan", effectiveAt: period.endExclusive, amount: money("105.10"), source: source() } },
  };
};
const ok = (r = request()) => {
  const out = propose(r);
  expect(out.diagnostics.map(x => x.diagnosticCode)).toEqual(["PHYSICAL_INTEGRATION_REQUIRED"]);
  expect(out.obligationCoverage).toBe("complete");
  expect(out.coverage).toBe("incomplete");
  expect(out.committed).toBe(false); expect(out.postable).toBe(false);
  expect([out.cashCoverage, out.netWorthCoverage, out.taxCoverage, out.settlementCoverage]).toEqual(Array(4).fill("incomplete"));
  return out.proposals[0]!;
};
const reject = (r: PhaseServicingRequest, code: PhaseDiagnosticCode | "B1_INCOMPLETE") => {
  const before = structuredClone(r);
  const out = propose(r);
  expect(out.proposals).toEqual([]); expect(out.obligationCoverage).toBe("incomplete");
  expect(out.diagnostics.map(x => x.diagnosticCode)).toContain(code);
  expect(out.diagnostics.every(x => x.affectedOutput === "heloc_phase_servicing" && x.coverage === "incomplete")).toBe(true);
  expect(structuredClone(r)).toEqual(before);
};

/** Independent original issuer statement, not a synthesized rate or cash posting. */
const quoted = (input = request()): PhaseServicingRequest => {
  const r = input.line, t = input.terms!, documentSource: Source = {
    ...source(), sourcePublication: "Independent original issuer statement: complete period",
    publishedAt: t.dueAt, asOf: t.dueAt,
  };
  return { ...input, line: { ...r, rate: null }, terms: { ...t, method: "issuer_quoted",
    allocation: { interest: money("5.10"), principal: money("100"), source: documentSource },
    issuerQuote: { documentId: "issuer:complete:jan", issuerId: "issuer:heloc",
      evidenceKind: "original_complete_issuer_statement", source: documentSource,
      period: r.period, dueAt: t.dueAt, householdId: r.householdId, borrowerId: r.borrowerId,
      lineId: r.lineId, liabilityAccountId: r.liabilityAccountId, bankAccountId: r.bankAccountId,
      openingPrincipal: money("1000"), closingPrincipal: money("900"), interest: money("5.10"),
      principal: money("100"), fees: money("0"), total: money("105.10") } } };
};

describe("conditional HELOC amortizing and maturity servicing: synthetic exact-cent oracles", () => {
  it("admits separately verified complete issuer interest when B1 rate input is genuinely absent", () => {
    const input = quoted(), before = structuredClone(input), p = ok(input);
    expect(p.interestEvidence).toBe("issuer_quoted_uncomputed");
    expect(p.interestClaimId).toBe("heloc/line/2026-01-01/2026-02-01/interest");
    expect(p.interest_due.equals(money("5.10"))).toBe(true);
    expect(p.principal_due.equals(money("100"))).toBe(true);
    expect(p.gross_due.equals(money("105.10"))).toBe(true);
    expect(p.traceRefs).toContain("issuer:complete:jan");
    expect(p.movements.every(m => !m.committed && !m.postable)).toBe(true);
    expect(structuredClone(input)).toEqual(before);
    expect(propose(input)).toEqual(propose(input));
  });

  it("fails closed on absent, stale, partial, non-independent and mismatched issuer statement", () => {
    const r = quoted(), t = r.terms!, q = t.issuerQuote!;
    reject({ ...r, terms: { ...t, issuerQuote: undefined } }, "B1_INCOMPLETE");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, evidenceKind: "conditional_quote" as typeof q.evidenceKind } } }, "QUOTE_MISMATCH");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, period: { ...q.period, start: d("2026-01-02") } } } }, "QUOTE_MISMATCH");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, source: { ...q.source, asOf: d("2026-02-02") } } } }, "SOURCE_UNAVAILABLE");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, source: { ...q.source, projectionStatus: "unavailable" } } } }, "SOURCE_UNAVAILABLE");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, source: { ...q.source, sourcePublication: t.source.sourcePublication } } } }, "QUOTE_MISMATCH");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, interest: money("5.11") } } }, "QUOTE_MISMATCH");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, borrowerId: "other" } } }, "QUOTE_MISMATCH");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, total: money("105.11") } } }, "QUOTE_MISMATCH");
    reject({ ...r, terms: { ...t, issuerQuote: { ...q, fees: money("0.01") } } }, "QUOTE_MISMATCH");
    reject({ ...r, line: { ...r.line, interest: { ...r.line.interest, source: {
      ...r.line.interest.source, projectionStatus: "unavailable" } } } }, "SOURCE_UNAVAILABLE");
  });

  it("rejects disagreements with complete B1 interest and never lets a quote conceal bad rate law", () => {
    const q = quoted(), t = q.terms!, original = t.issuerQuote!;
    const known: PhaseServicingRequest = { ...q, line: { ...q.line, rate: request().line.rate } };
    expect(ok(known).interestEvidence).toBe("issuer_quoted_b1_reconciled");
    const amended = { ...t, total: money("105.11"), allocation: { ...t.allocation!, interest: money("5.11") },
      issuerQuote: { ...original, interest: money("5.11"), total: money("105.11") } };
    reject({ ...known, terms: amended, payment: { ...known.payment, amount: money("105.11"),
      funding: { ...known.payment.funding!, amount: money("105.11") } } }, "QUOTE_MISMATCH");
    reject({ ...q, line: { ...q.line, rate: { ...request().line.rate!, priorRatePpm: -1000n } } },
      "B1_INCOMPLETE");
  });

  it("recognizes an independently quoted complete final balloon without computed rate", () => {
    const r = request(), period = r.line.period;
    const phase = { ...r.terms!.phase, endExclusive: period.endExclusive, kind: "balloon" as const };
    const total = money("1007.10");
    const base: PhaseServicingRequest = { ...r, line: { ...r.line,
      maturityAt: period.endExclusive, phases: [r.line.phases[0]!, phase] },
      terms: { ...r.terms!, phase, total, closingPrincipal: money("0"), finalQuote: {
        source: source(), dueAt: period.endExclusive, principal: money("1000"),
        interest: money("5.10"), fee: { amount: money("2"), source: source() } } },
      payment: { ...r.payment, amount: total, funding: { ...r.payment.funding!, amount: total } } };
    const a = quoted(base), t = a.terms!, q = t.issuerQuote!;
    const withQuote = { ...a, terms: { ...t,
      allocation: { ...t.allocation!, principal: money("1000") },
      issuerQuote: { ...q, principal: money("1000"), closingPrincipal: money("0"),
        fees: money("2"), total } } };
    const p = ok(withQuote);
    expect(p.interestEvidence).toBe("issuer_quoted_uncomputed");
    expect(p.principal_due.equals(money("1000"))).toBe(true);
    expect(p.fees_due.equals(money("2"))).toBe(true);
    expect(p.finalBalanceIntent.closingIfExecuted.isZero()).toBe(true);
    reject({ ...withQuote, terms: { ...withQuote.terms!, issuerQuote: {
      ...withQuote.terms!.issuerQuote!, fees: money("2.01") } } }, "QUOTE_MISMATCH");
  });

  it("authors a fixed reset-free installment with separate immutable obligations", () => {
    const r = request(), before = structuredClone(r), p = ok(r);
    // 100000 cents * 60000 ppm * 31 / 365000000 = 509.589... cents -> 510.
    expect(p.interest_due.equals(money("5.10"))).toBe(true);
    expect(p.principal_due.equals(money("100"))).toBe(true);
    expect(p.gross_due.equals(money("105.10"))).toBe(true);
    expect(p.interestClaimId).toBe("heloc/line/2026-01-01/2026-02-01/interest");
    expect("interestExpenseProposal" in p).toBe(false);
    expect(p.finalBalanceIntent.closingIfExecuted.equals(money("900"))).toBe(true);
    expect(p.movements[0]!.recognition).toBe("none");
    expect(p.movements[0]!.postable).toBe(false);
    expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(p.evidence.terms)).toBe(true);
    expect(structuredClone(r)).toEqual(before); expect(Object.isFrozen(r)).toBe(false);
    expect(propose(r)).toEqual(propose(r));
  });

  it("reuses B1 reset evidence and reconciles an issuer allocation without claiming independent quote computation", () => {
    const r = request();
    const reset: PhaseServicingRequest = { ...r, line: { ...r.line, rate: { ...r.line.rate!, priorResetAt: d("2025-12-15"),
      resetIntervalDays: 31, resets: [{ effectiveAt: d("2026-01-15"), sequence: 0, source: source() }],
      observations: [{ observationId: "jan-index", indexId: "synthetic-index", observedAt: d("2026-01-13"), ratePpm: 60000n,
        source: { ...source(), publishedAt: d("2026-01-14"), asOf: d("2026-01-14") } }] } },
      terms: { ...r.terms!, method: "issuer_quoted", total: money("106.03"),
        allocation: { interest: money("6.03"), principal: money("100"), source: source() } },
      payment: { ...r.payment, amount: money("106.03"), funding: { ...r.payment.funding!, amount: money("106.03") } } };
    const p = ok(reset);
    expect(p.interest_due.equals(money("6.03"))).toBe(true);
    expect(p.interestEvidence).toBe("issuer_quoted_b1_reconciled");
    expect(p.traceRefs).toContain("jan-index");
    reject({ ...reset, line: { ...reset.line, rate: { ...reset.line.rate!, observations: [] } } }, "B1_INCOMPLETE");
    reject({ ...reset, line: { ...reset.line, rate: { ...reset.line.rate!, observations: [
      { ...reset.line.rate!.observations[0]!, ratePpm: 40000n }] } } }, "QUOTE_MISMATCH");
    reject({ ...reset, terms: { ...reset.terms!, allocation: null } }, "INSTALLMENT_TERMS_REQUIRED");
    expect(propose({ ...reset, line: { ...reset.line, phases: [...reset.line.phases].reverse(), rate: { ...reset.line.rate!,
      observations: [...reset.line.rate!.observations].reverse(), resets: [...reset.line.rate!.resets].reverse() } } })).toEqual(propose(reset));
  });

  it("requires a separately verified exact-date balloon including remaining principal and interest", () => {
    const r = request();
    const phase = { ...r.terms!.phase, endExclusive: r.line.period.endExclusive, kind: "balloon" as const };
    const final: PhaseServicingRequest = { ...r, line: { ...r.line, maturityAt: phase.endExclusive,
      phases: [r.line.phases[0]!, phase] }, terms: { ...r.terms!, phase, total: money("1007.10"), closingPrincipal: money("0"),
      finalQuote: { source: source(), dueAt: phase.endExclusive, principal: money("1000"), interest: money("5.10"),
        fee: { amount: money("2"), source: source() } } },
      payment: { ...r.payment, amount: money("1007.10"), funding: { ...r.payment.funding!, amount: money("1007.10") } } };
    const p = ok(final);
    expect(p.principal_due.equals(money("1000"))).toBe(true);
    expect(p.interest_due.equals(money("5.10"))).toBe(true); expect(p.fees_due.equals(money("2"))).toBe(true);
    expect(p.finalBalanceIntent.closingIfExecuted.isZero()).toBe(true);
    reject({ ...final, terms: { ...final.terms!, finalQuote: null } }, "INSTALLMENT_TERMS_REQUIRED");
    reject({ ...final, terms: { ...final.terms!, finalQuote: { ...final.terms!.finalQuote!, dueAt: d("2026-01-31") } } }, "QUOTE_MISMATCH");
    reject({ ...r, terms: { ...r.terms!, finalQuote: final.terms!.finalQuote } }, "QUOTE_MISMATCH");
    reject({ ...final, terms: { ...final.terms!, finalQuote: { ...final.terms!.finalQuote!, fee: {
      amount: money("2"), source: { ...source(), projectionStatus: "unavailable" } } } } }, "SOURCE_UNAVAILABLE");
  });

  it("requires actual posted continuity for a second period and rejects recycled identities", () => {
    const r = request(); ok(r);
    const period = { start: d("2026-02-01"), endExclusive: d("2026-03-01") };
    const posted: PostedPrincipal = { postingId: "canonical-jan", operationId: "payment-jan", claimId: r.payment.claimId,
      authorizationId: "auth-jan", fundingId: "fund-jan", effectiveAt: period.start, sequence: 0, kind: "principal_repayment",
      principal: money("100"), interest: money("5.10"), cash: money("105.10"), source: source(), evidenceKind: "canonical_posting" };
    // Actual boundary posting is admitted into the next opening checkpoint;
    // the prior conditional proposal alone cannot supply this balance.
    const nextPeriod = period;
    const next: PhaseServicingRequest = { ...r, line: { ...r.line, period: nextPeriod, evaluatedAsOf: period.endExclusive,
      openingPrincipal: money("900"), interest: { ...r.line.interest, dueAt: period.endExclusive } },
      checkpoint: { ...r.checkpoint, closingAt: nextPeriod.start, closingPrincipal: money("900"), history: [posted] },
      terms: { ...r.terms!, accrualPeriod: nextPeriod, dueAt: period.endExclusive, openingPrincipal: money("900"),
        total: money("104.14"), closingPrincipal: money("800") }, payment: { ...r.payment, operationId: "payment-feb",
        claimId: "heloc/line/2026-02-01/2026-03-01/service", effectiveAt: period.endExclusive, amount: money("104.14"),
        authorization: { authorizationId: "auth-feb", source: source() },
        funding: { fundingId: "fund-feb", effectiveAt: period.endExclusive, amount: money("104.14"), source: source() } } };
    // 90000 cents * 6% * 28 / 365 = 414.246... -> 414 cents.
    const p = ok(next);
    expect(p.interest_due.equals(money("4.14"))).toBe(true);
    expect(p.finalBalanceIntent.closingIfExecuted.equals(money("800"))).toBe(true);
    reject({ ...next, checkpoint: { ...next.checkpoint, history: [] } }, "CHECKPOINT_MISMATCH");
    reject({ ...next, payment: { ...next.payment, authorization: r.payment.authorization } }, "DUPLICATE_CLAIM");
    reject({ ...next, payment: { ...next.payment, claimId: r.payment.claimId } }, "DUPLICATE_CLAIM");
    reject({ ...next, checkpoint: { ...next.checkpoint, history: [{ ...posted,
      evidenceKind: "conditional_proposal" as PostedPrincipal["evidenceKind"] }] } }, "CHECKPOINT_MISMATCH");
    reject({ ...next, checkpoint: { ...next.checkpoint, history: [{ ...posted, cash: money("100") }] } }, "CHECKPOINT_MISMATCH");
  });

  it("distinguishes scheduled, authorized and observed settled status without posting", () => {
    const r = request();
    const scheduled = ok({ ...r, payment: { ...r.payment, status: "scheduled", authorization: null, funding: null } });
    expect(scheduled.movements).toEqual([]); expect(scheduled.paymentStatus).toBe("scheduled");
    const settled = ok({ ...r, payment: { ...r.payment, status: "settled", observed: { observedAt: r.payment.effectiveAt, source: source() } } });
    expect(settled.committed).toBe(false); expect(settled.finalBalanceIntent.postable).toBe(false);
    reject({ ...r, payment: { ...r.payment, status: "settled" } }, "SOURCE_UNAVAILABLE");
    reject({ ...r, payment: { ...r.payment, status: "settled", observed: { observedAt: d("2026-02-02"), source: source() } } }, "SOURCE_UNAVAILABLE");
  });

  it("reconciles actual draws and repayments with sourced order independent of input order", () => {
    const r = request();
    const draw: PostedPrincipal = { postingId: "posted-draw", operationId: "draw", authorizationId: "auth-draw",
      claimId: "draw-claim", fundingId: "draw-funding", effectiveAt: d("2025-01-02"), sequence: 0,
      kind: "draw", principal: money("200"), interest: money("0"), cash: money("200"), source: source(), evidenceKind: "canonical_posting" };
    const repay: PostedPrincipal = { ...draw, postingId: "posted-repay", operationId: "repay", authorizationId: "auth-repay",
      claimId: "repay-claim", fundingId: "repay-funding", sequence: 1, kind: "principal_repayment",
      principal: money("100"), interest: money("1"), cash: money("101") };
    const history = [draw, repay];
    const withHistory = { ...r, checkpoint: { ...r.checkpoint, originalPrincipal: money("900"), history } };
    expect(ok(withHistory).finalBalanceIntent.closingIfExecuted.equals(money("900"))).toBe(true);
    expect(propose({ ...withHistory, checkpoint: { ...withHistory.checkpoint, history: [...history].reverse() } })).toEqual(propose(withHistory));
    reject({ ...withHistory, checkpoint: { ...withHistory.checkpoint, history: [draw, { ...repay, sequence: 0 }] } }, "CHECKPOINT_MISMATCH");
    reject({ ...withHistory, checkpoint: { ...withHistory.checkpoint, history: [draw, draw] } }, "DUPLICATE_CLAIM");
    const future = { ...source(), publishedAt: d("2026-02-02"), asOf: d("2026-02-02") };
    reject({ ...r, terms: { ...r.terms!, source: future } }, "SOURCE_UNAVAILABLE");
    reject({ ...r, checkpoint: { ...r.checkpoint, originalSource: { ...source(), projectionStatus: "unavailable" } } }, "SOURCE_UNAVAILABLE");
    reject({ ...r, payment: { ...r.payment, claimId: "replacement-claim-for-same-installment" } }, "DUPLICATE_CLAIM");
  });

  it("fails closed on absent terms, identities, stale balance, recast, overpayment and insufficient gross funds", () => {
    const r = request();
    reject({ ...r, terms: null }, "INSTALLMENT_TERMS_REQUIRED");
    reject({ ...r, payment: { ...r.payment, actorId: "another-borrower" } }, "IDENTITY_MISMATCH");
    reject({ ...r, line: { ...r.line, borrowerId: "another-borrower" } }, "SOURCE_UNAVAILABLE");
    reject({ ...r, checkpoint: { ...r.checkpoint, closingPrincipal: money("999.99") } }, "CHECKPOINT_MISMATCH");
    reject({ ...r, terms: { ...r.terms!, convention: "variable_recast" } }, "UNSUPPORTED_SERVICING");
    reject({ ...r, terms: { ...r.terms!, total: money("1005.11"), closingPrincipal: money("0") },
      payment: { ...r.payment, amount: money("1005.11"), funding: { ...r.payment.funding!, amount: money("1005.11") } } }, "QUOTE_MISMATCH");
    reject({ ...r, payment: { ...r.payment, funding: { ...r.payment.funding!, amount: money("105.09") } } }, "UNFUNDED_PAYMENT");
    reject({ ...r, payment: { ...r.payment, funding: null } }, "UNFUNDED_PAYMENT");
    reject({ ...r, payment: { ...r.payment, effectiveAt: d("2026-01-31") } }, "INVALID_PAYMENT_DATE");
    reject({ ...r, terms: { ...r.terms!, total: money("4") } }, "QUOTE_MISMATCH");
    reject({ ...r, line: { ...r.line, interest: { ...r.line.interest, compounding: "capitalized" } } }, "B1_INCOMPLETE");
    reject({ ...r, terms: { ...r.terms!, total: money("105.10", Currency.of("EUR")) } }, "INVALID_MONEY");
    reject({ ...r, payment: { ...r.payment, source: { ...source(), asOf: d("2026-02-02") } } }, "SOURCE_UNAVAILABLE");
  });
});
