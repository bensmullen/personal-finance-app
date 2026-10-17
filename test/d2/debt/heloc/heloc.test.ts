import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, decimal, money } from "../../../../src/values/index.js";
import { proposeHeloc, type HelocRequest, type PrincipalEvent, type RateContract, type Source,
  type DiagnosticCode } from "../../../../src/simulation/d2/debt/heloc/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const d = civilDate;
const source = (): Source => ({ start: d("2020-01-01"), endExclusive: d("2040-01-01"),
  householdId: "household", personId: "borrower", lineId: "line", liabilityAccountId: "liability", bankAccountId: "bank",
  ruleSnapshotId: "synthetic-heloc-contract-v1", jurisdiction: "US-test", sourcePublication: "Synthetic verified contract; not market terms",
  publishedAt: d("2023-01-01"), asOf: d("2023-01-01"), version: "1", projectionStatus: "verified" });
const request = (): HelocRequest => ({
  period: { start: d("2026-01-01"), endExclusive: d("2026-02-01") }, evaluatedAsOf: d("2026-02-01"),
  householdId: "household", ownerId: "borrower", borrowerId: "borrower", lineId: "line", liabilityAccountId: "liability", bankAccountId: "bank",
  currency: Currency.of("USD"), source: source(), creditLimit: money("2000"), openingPrincipal: money("1000"),
  openedAt: d("2024-01-01"), closedAt: d("2030-01-01"), maturityAt: d("2035-01-01"),
  drawWindow: { start: d("2024-01-01"), endExclusive: d("2030-01-01") }, revokedAt: null,
  phases: [{ start: d("2024-01-01"), endExclusive: d("2030-01-01"), kind: "interest_only_draw" },
    { start: d("2030-01-01"), endExclusive: d("2035-01-01"), kind: "amortizing" }],
  rate: { source: source(), indexId: "synthetic-index", spreadPpm: 20000n, lookbackDays: 2, resetIntervalDays: 31,
    priorResetAt: d("2025-12-15"), priorRatePpm: 60000n, nextResetOrdinal: 1, roundingIncrementPpm: 1000n, rounding: "half_up",
    initialCapPpm: 20000n, recurringCapPpm: 10000n, lifetimeFloorPpm: 30000n, lifetimeCeilingPpm: 120000n, legalMaximum: null,
    resets: [{ effectiveAt: d("2026-01-15"), sequence: 1, source: source() }],
    observations: [{ observationId: "index-jan13", indexId: "synthetic-index", observedAt: d("2026-01-13"), ratePpm: 60000n,
      source: { ...source(), sourcePublication: "Synthetic index publication January 14", publishedAt: d("2026-01-14"), asOf: d("2026-01-14") } }] },
  interest: { source: source(), dayCount: "actual_365_fixed", compounding: "simple", posting: "period_end_after_daily_activity", rounding: "half_up", dueAt: d("2026-02-10") },
  events: [],
});
const event = (id = "draw", amount = "500", sequence = 0): PrincipalEvent => ({ operationId: id, authorizationId: `auth-${id}`,
  kind: "draw", effectiveAt: d("2026-01-15"), sequence, actorId: "borrower", bankAccountId: "bank", authorized: true,
  amount: money(amount), source: source(), funding: null });
const repay = (id = "repay", amount = "500", sequence = 2): PrincipalEvent => ({ ...event(id, amount, sequence), kind: "principal_repayment",
  funding: { fundingId: `funding-${id}`, effectiveAt: d("2026-01-15"), amount: money(amount), source: source() } });
const rate = (r: HelocRequest, patch: Partial<RateContract>): HelocRequest => ({ ...r, rate: { ...r.rate!, ...patch } });
const proposal = (r = request()) => {
  const out = proposeHeloc(r);
  expect(out.diagnostics).toEqual([]); expect(out.coverage).toBe("complete");
  expect(out.proposals).toHaveLength(1); return out.proposals[0]!;
};
const reject = (r: HelocRequest, code: DiagnosticCode) => {
  const before = structuredClone(r);
  const out = proposeHeloc(r);
  expect(out.coverage).toBe("incomplete"); expect(out.proposals).toEqual([]);
  expect(out.diagnostics.map(x => x.diagnosticCode)).toContain(code);
  expect(out.diagnostics.every(x => x.period.start === r.period.start && x.traceRefs.includes("line"))).toBe(true);
  expect(structuredClone(r)).toEqual(before);
};

describe("isolated sourced HELOC draw-phase proposals", () => {
  it("reads conditional draw/reset prep without promoting their missing-rate evidence", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    const draw = catalog.cases.find(c => c.id === "heloc_draw")!;
    const reset = catalog.cases.find(c => c.id === "heloc_reset")!;
    const r = request();
    const amount = money(draw.input.amounts.drawCents!).times(decimal("0.01"));
    const p = proposal({ ...r, openingPrincipal: money("0"), events: [{ ...event(), amount }] });
    expect(p.movements[0]!.cashDelta.equals(money("500"))).toBe(true);
    expect(p.movements[0]!.liabilityDelta.equals(money("500"))).toBe(true);
    expect(p.movements[0]!.netWorthDelta.isZero()).toBe(true);
    expect(p.movements[0]!.income.isZero()).toBe(true);
    expect(p.movements[0]!.expense.isZero()).toBe(true);
    expect(p.movements[0]!.status).toBe("uncommitted");
    expect(p.closingPrincipalIfExecuted.equals(money("500"))).toBe(true);
    expect(p.interestExpenseProposal.amount.equals(money("1.86"))).toBe(true);
    const openingPrincipal = money(reset.input.amounts.openingPrincipalCents!).times(decimal("0.01"));
    expect(proposal({ ...r, openingPrincipal }).closingPrincipalIfExecuted.equals(money("1000"))).toBe(true);
    for (const f of [draw, reset]) {
      expect(f.expected.capability).toBe("decision_required"); expect(f.expected.integratedRuntimeEvidence).toBe(false);
    }
    expect(draw.input.terms.reset).toContain("missing"); expect(reset.input.terms.index).toBe("missing");
    reject({ ...r, rate: null }, "RATE_TERMS_REQUIRED");
  });

  it("resets to index plus spread and recognizes exact simple expense separately from settlement", () => {
    const p = proposal();
    // 100000 cents * (6% * 14 + 8% * 17) / 365 = 602.7397... cents.
    expect(p.interestExpenseProposal.amount.equals(money("6.03"))).toBe(true);
    expect(p.statesIfExecuted[1]!.ratePpm).toBe(80000n);
    expect(p.claim.amount.equals(p.interestExpenseProposal.amount)).toBe(true);
    expect(p.settlementIntent!.claimId).toBe(p.claim.claimId);
    expect(p.settlementIntent!.recognition).toBe("none");
    expect(p.settlementIntent!.status).toBe("uncommitted_requires_funding");
    expect(p.closingPrincipalIfExecuted.equals(money("1000"))).toBe(true);
    const r = request();
    expect(proposal({ ...r, interest: { ...r.interest, dayCount: "actual_360" } }).claim.amount.equals(money("6.11"))).toBe(true);
    expect(proposal({ ...r, interest: { ...r.interest, rounding: "down" } }).claim.amount.equals(money("6.02"))).toBe(true);
  });

  it("uses sourced order for draw, reset and repayment before same-day accrual", () => {
    const r = request();
    const p = proposal({ ...r, events: [repay(), event()] });
    expect(p.statesIfExecuted.slice(1, 4).map(s => [s.principal.amount.toString(), s.ratePpm])).toEqual([
      ["1500", 60000n], ["1500", 80000n], ["1000", 80000n],
    ]);
    expect(p.movements[1]!.cashDelta.equals(money("-500"))).toBe(true);
    expect(p.movements[1]!.liabilityDelta.equals(money("-500"))).toBe(true);
    expect(p.movements[1]!.income.isZero()).toBe(true);
    expect(p.movements[1]!.expense.isZero()).toBe(true);
    expect(p.movements[1]!.dependsOn).toEqual(["draw"]);
    expect(p.claim.amount.equals(money("6.03"))).toBe(true);
    const after = proposal({ ...r, events: [event("after", "500", 2)] });
    expect(after.statesIfExecuted[1]!.ratePpm).toBe(80000n);
    expect(after.statesIfExecuted[1]!.principal.equals(money("1000"))).toBe(true);
    expect(after.claim.amount.equals(money("7.89"))).toBe(true);
  });

  it("enforces cumulative credit and permits only explicitly funded extra principal", () => {
    const r = request();
    const p = proposal({ ...r, events: [event("a", "500", 0), event("b", "500", 2), repay("c", "1000", 3), event("d", "1000", 4)] });
    expect(p.closingPrincipalIfExecuted.equals(money("2000"))).toBe(true);
    expect(p.unusedCreditIfExecuted.isZero()).toBe(true);
    reject({ ...r, events: [event("a", "500", 0), event("b", "500.01", 2)] }, "CREDIT_LIMIT_EXCEEDED");
    reject({ ...r, events: [{ ...repay(), funding: null }] }, "UNFUNDED_PAYMENT");
    reject({ ...r, events: [{ ...repay(), funding: { fundingId: "f", effectiveAt: d("2026-01-15"), amount: money("1"), source: source() } }] }, "UNFUNDED_PAYMENT");
    reject({ ...r, events: [{ ...repay(), funding: { ...repay().funding!, effectiveAt: d("2026-01-16") } }] }, "UNFUNDED_PAYMENT");
    reject({ ...r, events: [repay("too-much", "1001")] }, "INVALID_PRINCIPAL");
    reject({ ...r, events: [repay("one", "1", 2), { ...repay("two", "1", 3), funding: repay("one", "1").funding }] }, "UNFUNDED_PAYMENT");
  });

  it.each([
    [1, 100000n, 80000n], [2, 100000n, 70000n], [1, -10000n, 40000n], [2, -10000n, 50000n],
  ] as const)("applies ordinal %s cap to index %s", (ordinal, index, expected) => {
    const r = request();
    const p = proposal(rate(r, { nextResetOrdinal: ordinal, observations: [{ ...r.rate!.observations[0]!, ratePpm: index }] }));
    expect(p.statesIfExecuted[1]!.ratePpm).toBe(expected);
  });

  it("applies rate rounding, lifetime floor/ceiling and separately sourced legal maximum", () => {
    const r = request();
    expect(proposal(rate(r, { observations: [{ ...r.rate!.observations[0]!, ratePpm: 40500n }] })).statesIfExecuted[1]!.ratePpm).toBe(61000n);
    expect(proposal(rate(r, { initialCapPpm: 100000n, lifetimeCeilingPpm: 65000n })).statesIfExecuted[1]!.ratePpm).toBe(65000n);
    expect(proposal(rate(r, { initialCapPpm: 100000n, legalMaximum: { ratePpm: 63000n, source: source() } })).statesIfExecuted[1]!.ratePpm).toBe(63000n);
    expect(proposal(rate(r, { initialCapPpm: 100000n, observations: [{ ...r.rate!.observations[0]!, ratePpm: 0n }] })).statesIfExecuted[1]!.ratePpm).toBe(30000n);
    reject(rate(r, { lifetimeFloorPpm: 130000n }), "UNSUPPORTED_RATE_VARIANT");
    reject(rate(r, { recurringCapPpm: -1n }), "UNSUPPORTED_RATE_VARIANT");
    reject(rate(r, { legalMaximum: { ratePpm: 20000n, source: source() } }), "INVALID_CONTRACT");
    reject(rate(r, { resetIntervalDays: 0 }), "UNSUPPORTED_RATE_VARIANT");
  });

  it("does not project unknown resets or use observations published after reset/evaluation", () => {
    const r = request();
    reject(rate(r, { observations: [] }), "INDEX_UNAVAILABLE");
    reject(rate(r, { resets: [] }), "RESET_SCHEDULE_INVALID");
    reject(rate(r, { observations: [{ ...r.rate!.observations[0]!, indexId: "another-index" }] }), "INDEX_UNAVAILABLE");
    const late = { ...r.rate!.observations[0]!, source: { ...source(), publishedAt: d("2026-01-16"), asOf: d("2026-01-16") } };
    reject(rate(r, { observations: [late] }), "SOURCE_UNAVAILABLE");
    reject({ ...r, evaluatedAsOf: d("2026-01-13") }, "SOURCE_UNAVAILABLE");
    reject(rate(r, { observations: [{ ...r.rate!.observations[0]!, source: { ...source(), projectionStatus: "explicit_projected" } }] }), "SOURCE_UNAVAILABLE");
    reject(rate(r, { source: { ...source(), endExclusive: d("2026-01-20") } }), "SOURCE_UNAVAILABLE");
  });

  it("requires every recurring reset and exact lookback observations", () => {
    const r = request();
    const extended = { ...r, evaluatedAsOf: d("2026-03-01"), period: { ...r.period, endExclusive: d("2026-03-01") }, interest: { ...r.interest, dueAt: d("2026-03-10") } };
    reject(extended, "RESET_SCHEDULE_INVALID");
    const next = { effectiveAt: d("2026-02-15"), sequence: 0, source: source() };
    reject(rate(extended, { resets: [...r.rate!.resets, next] }), "INDEX_UNAVAILABLE");
    const p = proposal(rate(extended, { resets: [...r.rate!.resets, next], observations: [...r.rate!.observations,
      { observationId: "feb", indexId: "synthetic-index", observedAt: d("2026-02-13"), ratePpm: 100000n,
        source: { ...source(), publishedAt: d("2026-02-14"), asOf: d("2026-02-14") } }] }));
    expect(p.statesIfExecuted.map(s => s.ratePpm)).toEqual([60000n, 80000n, 90000n, 90000n]);
  });

  it("rejects closed/revoked/expired lines, wrong identities and duplicate activity", () => {
    const r = request();
    reject({ ...r, revokedAt: d("2026-01-15"), events: [event()] }, "DRAW_UNAVAILABLE");
    reject({ ...r, closedAt: d("2026-01-15"), drawWindow: { ...r.drawWindow, endExclusive: d("2026-01-15") }, events: [event()] }, "DRAW_UNAVAILABLE");
    reject({ ...r, drawWindow: { ...r.drawWindow, endExclusive: d("2026-01-14") }, events: [event()] }, "DRAW_UNAVAILABLE");
    for (const e of [{ ...event(), authorized: false }, { ...event(), actorId: "stranger" }, { ...event(), bankAccountId: "another-bank" }])
      reject({ ...r, events: [e] }, "IDENTITY_MISMATCH");
    reject({ ...r, events: [event(), event()] }, "DUPLICATE_EVENT");
    reject({ ...r, events: [event(), { ...event("other", "1", 2), authorizationId: "auth-draw" }] }, "DUPLICATE_EVENT");
    reject({ ...r, events: [event("tie", "1", 1)] }, "AMBIGUOUS_ORDER");
    reject({ ...r, events: [{ ...event(), amount: money("1", Currency.of("EUR")) }] }, "INVALID_MONEY");
    reject({ ...r, openingPrincipal: money("2001") }, "INVALID_PRINCIPAL");
    reject({ ...r, events: [{ ...event(), amount: money("0.001") }] }, "INVALID_MONEY");
    reject({ ...r, events: [{ ...event(), effectiveAt: r.period.endExclusive }] }, "INVALID_CONTRACT");
    reject({ ...r, source: { ...source(), personId: "wrong-owner" } }, "SOURCE_UNAVAILABLE");
  });

  it("gates unknown accrual, capitalization, conversion, balloon and maturity", () => {
    const r = request();
    reject({ ...r, interest: { ...r.interest, dayCount: "unknown" } }, "UNSUPPORTED_INTEREST_CONVENTION");
    reject({ ...r, interest: { ...r.interest, compounding: "capitalized" } }, "UNSUPPORTED_INTEREST_CONVENTION");
    for (const start of ["2030-01-01", "2035-01-01"]) reject({ ...r,
      period: { start: d(start), endExclusive: d(start === "2030-01-01" ? "2030-02-01" : "2035-02-01") } }, "UNSUPPORTED_REPAYMENT_PHASE");
    reject({ ...r, phases: r.phases.map(p => p.kind === "interest_only_draw" ? { ...p, kind: "balloon" as const } : p) }, "UNSUPPORTED_REPAYMENT_PHASE");
  });

  it.each([["2024-02-28", "2024-03-01", "0.33"], ["2025-12-31", "2026-01-01", "0.16"],
    ["2026-09-30", "2026-10-01", "0.16"]])("uses half-open actual days across %s to %s", (start, end, expense) => {
    const r = request();
    const p = proposal(rate({ ...r, period: { start: d(start), endExclusive: d(end) },
      interest: { ...r.interest, dueAt: d(end) } }, { priorResetAt: d(start), resets: [], observations: [] }));
    expect(p.claim.amount.equals(money(expense))).toBe(true);
  });

  it("is replay/order invariant and copies/freezes evidence without mutating caller objects", () => {
    const r = { ...request(), events: [repay(), event()] };
    const before = structuredClone(r);
    const p = proposeHeloc(r);
    expect(proposeHeloc(r)).toEqual(p);
    expect(proposeHeloc({ ...r, events: [...r.events].reverse(), phases: [...r.phases].reverse() })).toEqual(p);
    expect(structuredClone(r)).toEqual(before);
    expect(Object.isFrozen(r)).toBe(false);
    expect(Object.isFrozen(p.proposals[0]!.evidence)).toBe(true);
    expect(Object.isFrozen(p.proposals[0]!.evidence.events)).toBe(true);
    const invalid = { ...r, events: [{ ...event("a"), actorId: "wrong" }, { ...event("b", "0", 2), authorized: false }] };
    expect(proposeHeloc({ ...invalid, events: [...invalid.events].reverse() })).toEqual(proposeHeloc(invalid));
  });

  it("creates no zero settlement and ties interest recognition to conditional movements", () => {
    const r = request();
    const empty = proposal({ ...r, openingPrincipal: money("0") });
    expect(empty.claim.amount.isZero()).toBe(true);
    expect(empty.settlementIntent).toBeNull();
    const p = proposal({ ...r, events: [event()] });
    expect(p.interestExpenseProposal.dependsOn).toEqual(["draw"]);
    expect(p.settlementIntent!.dependsOn).toEqual([p.interestExpenseProposal.operationId]);
  });
});
