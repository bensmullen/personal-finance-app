import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, decimal, money, Money } from "../../../../src/values/index.js";
import { evaluateFsa, fsaScopeId, type FsaIdentity, type FsaPeriod, type FsaPlan, type FsaSource,
  type FsaReceipt, type FsaRequest, type FsaPayrollContribution, type FsaPriorCarryover,
  type FsaYearEnd } from "../../../../src/simulation/d2/health/fsa/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const date = civilDate;
const span = (start = "2026-01-01", end = "2027-01-01"): FsaPeriod => ({ start: date(start), endExclusive: date(end) });
const ids: FsaIdentity = { householdId: "household", personId: "claimant", employerId: "employer", planId: "plan", planYearId: "2026" };
const key = (...parts: string[]) => parts.map(encodeURIComponent).join("/");
// Deliberately artificial evidence and limits: these are not an employer plan or statutory rule catalog.
const evidence = (family: string, subject: string, period = span("2025-01-01", "2029-01-01")): FsaSource => ({
  ...period, ruleSnapshotId: `synthetic-${family}-${subject}`, ruleFamily: family, subjectId: subject,
  jurisdiction: "US-test", sourcePublication: "synthetic isolated test evidence; not law", version: "test/v1",
  asOf: date("2025-01-01"), verifiedThrough: date("2028-12-31"), projectionStatus: "verified",
});
const plan = (who = ids, period = span()): FsaPlan => ({ ...who, instrumentFamily: "health_fsa", period, coverage: period,
  planEvidence: evidence("health_fsa_plan", fsaScopeId(who)), annualElection: money("1000"), employerContribution: money("0"),
  planElectionLimit: money("2000"), planEmployerLimit: money("500"),
  law: { planYearId: who.planYearId, electionLimit: money("2500"), employerLimit: money("500"), totalLimit: money("3000"),
    evidence: evidence("health_fsa_law", who.planYearId) },
  uniformCoverage: "full_election_and_employer", allocationPolicy: "prior_first_then_current/incurred_submitted_proof/v1",
  members: [{ memberId: who.personId, coverage: period,
    evidence: evidence("health_fsa_member", key(fsaScopeId(who), who.personId)) }],
  termination: { kind: "none" }, submitEndExclusive: period.endExclusive > "2027-04-01" ? period.endExclusive : date("2027-04-01"),
  yearEnd: { kind: "forfeiture" },
});
const receipt = (proofId = "medical-proof", p: FsaPlan = plan(), amount = "200", incurredAt = "2026-01-05",
  submittedAt = "2026-01-06"): FsaReceipt => ({ ...ids, ...pick(p), proofId, receiptId: `receipt-${proofId}`,
  memberId: p.personId, payeeId: "medical-provider", expenseType: "qualified_medical_service",
  incurredAt: date(incurredAt), submittedAt: date(submittedAt), incurredAmount: money(amount),
  payment: { status: "paid", paidAt: date(incurredAt), amount: money(amount), paymentRef: `payment-${proofId}` },
  destination: { accountId: "reimbursement_cash", kind: "bank_cash", ownerId: p.personId, householdId: p.householdId,
    evidence: evidence("health_fsa_destination", "reimbursement_cash") },
  evidence: evidence("health_fsa_receipt", proofId), decision: { kind: "eligible", eligibleAmount: money(amount), decidedAt: date(submittedAt),
    evidence: evidence("health_fsa_adjudication", proofId) }, reimbursement: { status: "not_adjudicated" },
});
const pick = (p: FsaIdentity): FsaIdentity => ({ householdId: p.householdId, personId: p.personId,
  employerId: p.employerId, planId: p.planId, planYearId: p.planYearId });
const payroll = (p = plan(), contributionId = "payroll-1"): FsaPayrollContribution => ({ ...pick(p), contributionId,
  effectiveAt: date("2026-01-15"), sourceAccountId: "payroll_source", contributionSource: "employee_salary_reduction",
  amount: money("100"), status: "previously_posted", postingRef: `posting-${contributionId}`,
  evidence: evidence("health_fsa_payroll", contributionId) });
const request = (p = plan(), receipts: readonly FsaReceipt[] = [receipt("medical-proof", p)], at = "2026-01-31"): FsaRequest => ({
  evaluatedAt: date(at), historyThrough: date(at), plan: p, payroll: [], receipts, priorCarryover: null,
  historyEvidence: evidence("health_fsa_complete_history", fsaScopeId(p)),
});
const settle = (r: FsaReceipt, status: "pending" | "settled" = "settled"): FsaReceipt => ({ ...r,
  reimbursement: { status, approvedAmount: r.decision!.eligibleAmount, adjudicatedAt: r.submittedAt,
    allocations: [{ planYearId: r.planYearId, amount: r.decision!.eligibleAmount }],
    settlementId: status === "settled" ? `settlement-${r.proofId}` : null,
    settledAt: status === "settled" ? r.submittedAt : null, evidence: evidence("health_fsa_reimbursement", r.proofId) } });
const codes = (r: ReturnType<typeof evaluateFsa>) => r.diagnostics.map(d => d.diagnosticCode);
const cents = (value: string) => new Money(decimal(value).times(decimal("0.01")), Currency.of("USD"));
const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const carryRule = (p = plan(), enrolled = true): FsaYearEnd => {
  const next = { ...pick(p), planYearId: "2027", period: span("2027-01-01", "2028-01-01"), enrolled };
  return { kind: "carryover", planCap: money("600"), legalCap: money("500"),
    nextEnrollment: { ...next, evidence: evidence("health_fsa_next_enrollment", fsaScopeId(next)) } };
};
const prior = (p = plan()): FsaPriorCarryover => ({ from: { ...pick(p), planYearId: "2025" },
  fromPeriod: span("2025-01-01", "2026-01-01"), to: pick(p), transferId: "finalized-transfer",
  effectiveAt: p.period.start, sourceClosingEntitlement: money("800"), planCap: money("600"), legalCap: money("500"),
  amount: money("500"), yearEndKind: "carryover", finalized: true, consumedProofIds: ["old-proof"],
  evidence: evidence("health_fsa_finalized_carryover", "finalized-transfer") });

describe("D2-C C3 isolated health-FSA entitlement", () => {
  it.each(["fsa_payroll_contribution", "fsa_reimbursement", "fsa_carryover", "fsa_grace_period", "fsa_forfeiture"])(
    "consumes %s exact amounts only with separately supplied plan and receipt evidence", caseId => {
      const f = catalog.cases.find(c => c.id === caseId)!;
      const base = plan();
      const p = { ...base, annualElection: cents(f.input.amounts.annualElectionCents!),
        yearEnd: caseId === "fsa_carryover" ? carryRule() : caseId === "fsa_grace_period"
          ? { kind: "grace_period" as const, incurredEndExclusive: date("2027-03-16") } : base.yearEnd };
      const r = receipt("medical-proof", p);
      const result = evaluateFsa({ ...request(p, [{ ...r, incurredAmount: cents(f.input.amounts.requestedReimbursementCents!),
        payment: { status: "unpaid" }, decision: { ...r.decision!, eligibleAmount: cents(f.input.amounts.requestedReimbursementCents!) } }]),
        payroll: [{ ...payroll(p), amount: cents(f.input.amounts.payrollContributionCents!) }] });
      expect(result.entitlementCoverage).toBe("complete");
      expect(result.entitlement!.remaining.equals(money("800"))).toBe(true);
      expect(result.entitlement!.employeePayrollToDate.equals(money("100"))).toBe(true);
      expect(result.claims[0]!.grossAmount.equals(money("200"))).toBe(true);
      expect(f.expected.capability).toBe("decision_required");
      expect(f.expected.integratedRuntimeEvidence).toBe(false);
      const missing = evaluateFsa(request({ ...p, planEvidence: null }));
      expect(missing.claims).toEqual([]);
      expect(missing.entitlement).toBeNull();
    });

  it("uses full annual election before any payroll; creates no cash, wage, deduction or employer asset", () => {
    const r = evaluateFsa(request());
    expect(r.claims[0]!.restrictedEntitlementDelta.equals(money("-200"))).toBe(true);
    expect(r.claims[0]!.source).toEqual({ kind: "employer_health_fsa", employerId: "employer", planId: "plan" });
    expect(r.claims[0]!.destinationAccountId).toBe("reimbursement_cash");
    expect(r.claims[0]!.medicalDeduction).toBe("not_determined");
    expect(r.netWorthTreatment).toBe("excluded_restricted_entitlement");
    expect([r.payrollEffectCoverage, r.reimbursementSettlementCoverage, r.taxCoverage]).toEqual(["incomplete", "incomplete", "incomplete"]);
    for (const field of ["cashDelta", "assetDelta", "taxSavings", "wageReduction", "expenseRecognition"]) {
      expect(Object.keys(r)).not.toContain(field); expect(Object.keys(r.claims[0]!)).not.toContain(field);
    }
  });

  it("distinguishes employer additions from employee salary reduction and pending payroll", () => {
    const p = { ...plan(), employerContribution: money("250") };
    const employee = payroll(p);
    const employer = { ...payroll(p, "employer-addition"), contributionSource: "employer" as const, amount: money("50") };
    const pending = { ...payroll(p, "future-posting"), status: "pending" as const, postingRef: null };
    const r = evaluateFsa({ ...request(p), payroll: [employee, employee, employer, pending] });
    expect(r.entitlement!.remaining.equals(money("1050"))).toBe(true);
    expect(r.entitlement!.employeePayrollToDate.equals(money("100"))).toBe(true);
    expect(r.entitlement!.employerPayrollToDate.equals(money("50"))).toBe(true);
    expect(r.payrollIntents).toHaveLength(3);
    expect(r.payrollIntents.filter(x => x.postingRequired)).toHaveLength(1);
  });

  it("debits multiple receipts once, deduplicates proof aliases and keeps replay/order invariant", () => {
    const a = receipt("proof-a", plan(), "200.01"); const b = receipt("proof-b", plan(), "300.02");
    const alias = { ...a, receiptId: "alias-a" };
    const input = { ...request(plan(), [a, b, a, alias]), payroll: [payroll(), payroll()] };
    const before = JSON.stringify(input);
    const result = evaluateFsa(input);
    expect(result.claims).toHaveLength(2);
    expect(result.entitlement!.remaining.equals(money("499.97"))).toBe(true);
    expect(evaluateFsa({ ...input, receipts: [...input.receipts].reverse() })).toEqual(result);
    expect(evaluateFsa(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result.claims[0]!.evidence[0])).toBe(true);
    expect(Object.isFrozen(input.plan)).toBe(false);
  });

  it("keeps claim identity and remaining balance across pending and settled replays", () => {
    const r = receipt();
    const fresh = evaluateFsa(request(plan(), [r]));
    const pending = evaluateFsa(request(plan(), [settle(r, "pending")]));
    const settled = evaluateFsa(request(plan(), [settle(r)]));
    expect(fresh.claims[0]!.claimId).toBe(pending.claims[0]!.claimId);
    expect(pending.claims[0]!.claimId).toBe(settled.claims[0]!.claimId);
    expect(pending.claims[0]!.settlementRequired).toBe(true);
    expect(settled.claims[0]!.settlementRequired).toBe(false);
    expect(settled.claims[0]!.status).toBe("previously_settled");
    expect(settled.entitlement!.remaining.equals(money("800"))).toBe(true);
    expect(evaluateFsa(request(plan(), [settle(r), settle(r)]))).toEqual(settled);
  });

  it("honors denial and partial qualification without consuming denied amounts", () => {
    const denied = receipt("denied"); const partial = receipt("partial");
    const r = evaluateFsa(request(plan(), [
      { ...denied, decision: { ...denied.decision!, kind: "denied", eligibleAmount: money("0") } },
      { ...partial, decision: { ...partial.decision!, kind: "partial", eligibleAmount: money("12.34") } },
    ]));
    expect(r.claims).toHaveLength(1); expect(r.entitlement!.remaining.equals(money("987.66"))).toBe(true);
  });

  it("uses sourced contention priority rather than receipt order and caps at entitlement", () => {
    const a = receipt("a", plan(), "900"); const b = receipt("b", plan(), "900");
    const r = evaluateFsa(request(plan(), [b, a]));
    expect(r.claims.map(x => [x.proofId, x.grossAmount.amount.toString()])).toEqual([["a", "900"], ["b", "100"]]);
    expect(evaluateFsa(request(plan(), [a, b]))).toEqual(r);
    const historical = settle(b);
    const historyFirst = evaluateFsa(request(plan(), [a, historical]));
    expect(historyFirst.claims.map(x => x.grossAmount.amount.toString())).toEqual(["900", "100"]);
    expect(historyFirst.claims[0]!.proofId).toBe("b");
  });

  it("isolates people, covered dependents and noncalendar plan years", () => {
    const who = { ...ids, personId: "other-person", planYearId: "2026-july" };
    const p = plan(who, span("2026-07-01", "2027-07-01"));
    const dependent = { memberId: "child", coverage: p.coverage,
      evidence: evidence("health_fsa_member", key(fsaScopeId(p), "child")) };
    const r = receipt("child-proof", p, "200", "2026-07-01", "2026-07-02");
    const result = evaluateFsa(request({ ...p, members: [...p.members, dependent] }, [{ ...r, memberId: "child" }], "2026-08-01"));
    expect(result.entitlementCoverage).toBe("complete");
    expect(result.claims[0]!.memberId).toBe("child");
    expect(result.claims[0]!.claimId).not.toBe(evaluateFsa(request()).claims[0]!.claimId);
  });

  it.each(["personId", "householdId", "employerId", "planId", "planYearId", "memberId"] as const)("rejects wrong receipt %s", field => {
    const r = evaluateFsa(request(plan(), [{ ...receipt(), [field]: "stranger" }]));
    expect(r.claims).toEqual([]); expect(r.entitlementCoverage).toBe("incomplete");
  });
  it("rejects wrong owner/destination and does not manufacture a replacement account", () => {
    const r = receipt();
    for (const destination of [null, { ...r.destination!, ownerId: "stranger" }, { ...r.destination!, householdId: "elsewhere" },
      { ...r.destination!, evidence: { ...r.destination!.evidence, projectionStatus: "unavailable" as const } }]) {
      expect(evaluateFsa(request(plan(), [{ ...r, destination }])).claims).toEqual([]);
    }
  });

  it.each(["evidence", "decision", "reimbursement"] as const)("requires receipt %s", field => {
    const result = evaluateFsa(request(plan(), [{ ...receipt(), [field]: null }]));
    expect(result.claims).toEqual([]); expect(result.entitlement).toBeNull();
  });
  it("gates reversal/cancellation and unsupported expense types", () => {
    const r = receipt();
    for (const changed of [{ ...r, reimbursement: { status: "unsupported_reversal" as const } },
      { ...r, expenseType: "unsupported" as const }]) {
      const result = evaluateFsa(request(plan(), [changed]));
      expect(result.claims).toEqual([]); expect(codes(result)).toContain("RECEIPT_EVIDENCE_REQUIRED");
    }
  });

  it("accepts start day and rejects end-exclusive incurred and submitted days", () => {
    expect(evaluateFsa(request(plan(), [receipt("start", plan(), "1", "2026-01-01", "2026-01-01")])).claims).toHaveLength(1);
    const at = "2027-04-02";
    for (const r of [receipt("end", plan(), "1", "2027-01-01", "2027-01-01"),
      receipt("late", plan(), "1", "2026-12-31", "2027-04-01")]) {
      expect(evaluateFsa(request(plan(), [r], at)).claims).toEqual([]);
    }
    expect(evaluateFsa(request(plan(), [receipt("runout", plan(), "1", "2026-12-31", "2027-03-31")], at)).claims).toHaveLength(1);
  });

  it("extends incurred eligibility only for an explicitly sourced grace window", () => {
    const p = { ...plan(), yearEnd: { kind: "grace_period" as const, incurredEndExclusive: date("2027-03-16") } };
    const r = receipt("grace", p, "200", "2027-03-15", "2027-03-20");
    const result = evaluateFsa(request(p, [r], "2027-03-25"));
    expect(result.claims).toHaveLength(1);
    expect(result.entitlement!.remaining.equals(money("800"))).toBe(true);
    expect(result.disposition!.carryover.isZero()).toBe(true);
    expect(result.disposition!.graceAvailable.isZero()).toBe(true);
    expect(evaluateFsa(request(p, [receipt("after-grace", p, "1", "2027-03-16", "2027-03-20")], "2027-03-25")).claims).toEqual([]);
  });

  it("rejects mixed carryover/grace terms even when reconstructed outside TypeScript", () => {
    const rule = { ...carryRule(), incurredEndExclusive: date("2027-03-16") } as FsaYearEnd;
    const r = evaluateFsa(request({ ...plan(), yearEnd: rule }));
    expect(codes(r)).toContain("YEAR_END_RULE_REQUIRED"); expect(r.claims).toEqual([]);
  });

  it("caps carryover by plan and law only at sourced re-enrollment, preserving forfeiture", () => {
    const p = { ...plan(), yearEnd: carryRule() };
    const r = evaluateFsa(request(p, [settle(receipt())], "2027-04-01"));
    expect(r.disposition!.status).toBe("proposed");
    expect(r.disposition!.carryover.equals(money("500"))).toBe(true);
    expect(r.disposition!.forfeiture.equals(money("300"))).toBe(true);
    expect(r.disposition!.toPlanYearId).toBe("2027");
    const lower = evaluateFsa(request({ ...p, yearEnd: { ...carryRule(), planCap: money("100") } as FsaYearEnd }, [], "2027-04-01"));
    expect(lower.disposition!.carryover.equals(money("100"))).toBe(true);
    const notEnrolled = evaluateFsa(request({ ...p, yearEnd: carryRule(plan(), false) }, [], "2027-04-01"));
    expect(notEnrolled.disposition!.forfeiture.equals(money("1000"))).toBe(true);
    const missing = evaluateFsa(request({ ...p, yearEnd: { kind: "carryover", planCap: money("600"), legalCap: money("500"), nextEnrollment: null } }));
    expect(missing.entitlementCoverage).toBe("complete"); expect(missing.yearEndCoverage).toBe("incomplete");
    expect(missing.disposition).toBeNull();
  });

  it("keeps disposition provisional while claims are pending or runout is open", () => {
    expect(evaluateFsa(request(plan(), [], "2027-03-31")).disposition!.status).toBe("pending_close");
    expect(evaluateFsa(request(plan(), [receipt()], "2027-04-01")).disposition!.status).toBe("pending_close");
    const closed = evaluateFsa(request(plan(), [settle(receipt())], "2027-04-01"));
    expect(closed.disposition!.status).toBe("proposed");
    expect(closed.disposition!.forfeiture.equals(money("800"))).toBe(true);
  });

  it("traces prior/current lots separately and excludes prior-year proofs from a new claim", () => {
    const r = receipt("new-proof", plan(), "600");
    const result = evaluateFsa({ ...request(plan(), [r, receipt("old-proof")]), priorCarryover: prior() });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.allocations.map(x => [x.planYearId, x.amount.amount.toString()])).toEqual([["2025", "500"], ["2026", "100"]]);
    expect(result.entitlement!.currentRemaining.equals(money("900"))).toBe(true);
    expect(result.entitlement!.priorRemaining.isZero()).toBe(true);
    expect(result.claims[0]!.traceRefs).toContain("finalized-transfer");
  });

  it("requires a capped finalized same-owner adjacent-year carryover, never an uncommitted proposal", () => {
    const base = prior();
    for (const changed of [{ ...base, amount: money("600") }, { ...base, from: { ...base.from, personId: "other" } },
      { ...base, fromPeriod: span("2024-01-01", "2025-01-01") }, { ...base, finalized: false } as unknown as FsaPriorCarryover]) {
      const r = evaluateFsa({ ...request(), priorCarryover: changed });
      expect(r.claims).toEqual([]); expect(codes(r)).toContain("PRIOR_CARRYOVER_REQUIRED");
    }
  });

  it("preserves original historical lot allocations when another claim later settles", () => {
    const a = receipt("a", plan(), "400"); const b = receipt("b", plan(), "400");
    const original = evaluateFsa({ ...request(plan(), [a, b]), priorCarryover: prior() });
    const originalB = original.claims.find(c => c.proofId === "b")!;
    const settledB: FsaReceipt = { ...b, reimbursement: { status: "settled", approvedAmount: money("400"),
      allocations: originalB.allocations, adjudicatedAt: b.submittedAt, settledAt: b.submittedAt,
      settlementId: "settled-b", evidence: evidence("health_fsa_reimbursement", "b") } };
    const replay = evaluateFsa({ ...request(plan(), [a, settledB]), priorCarryover: prior() });
    expect(replay.claims.find(c => c.proofId === "b")!.allocations).toEqual(originalB.allocations);
    expect(replay.entitlement!.remaining.equals(original.entitlement!.remaining)).toBe(true);
    expect(replay.claims.find(c => c.proofId === "b")!.settlementRequired).toBe(false);
  });

  it("honors termination and cannot regain grace coverage or carryover implicitly", () => {
    const p: FsaPlan = { ...plan(), yearEnd: carryRule(), termination: { kind: "terminated",
      incurredEndExclusive: date("2026-06-01"), submitEndExclusive: date("2026-07-01"), disposition: "forfeit_after_runout" } };
    expect(evaluateFsa(request(p, [receipt("after", p, "1", "2026-06-01", "2026-06-02")], "2026-07-02")).claims).toEqual([]);
    const r = evaluateFsa(request(p, [settle(receipt())], "2027-04-01"));
    expect(r.disposition!.kind).toBe("forfeiture"); expect(r.disposition!.carryover.isZero()).toBe(true);
  });

  it.each(["law", "planEvidence", "uniformCoverage", "termination", "yearEnd"] as const)("requires plan %s", field => {
    const r = evaluateFsa(request({ ...plan(), [field]: null }));
    expect(r.entitlementCoverage).toBe("incomplete"); expect(r.claims).toEqual([]);
  });
  it("requires complete history through the evaluation boundary", () => {
    for (const changed of [{ ...request(), historyEvidence: null }, { ...request(), historyThrough: date("2026-01-30") }]) {
      expect(evaluateFsa(changed).claims).toEqual([]);
    }
  });
  it("does not reuse another year's limits, projected law or stale verification", () => {
    const p = plan();
    for (const law of [{ ...p.law!, planYearId: "2027" },
      { ...p.law!, evidence: { ...p.law!.evidence, projectionStatus: "explicit_projected" as const } },
      { ...p.law!, evidence: { ...p.law!.evidence, verifiedThrough: date("2026-01-01") } },
      { ...p.law!, evidence: { ...p.law!.evidence, asOf: date("2027-01-01") } },
      { ...p.law!, evidence: { ...p.law!.evidence, ...span("2025-01-01", "2026-01-01") } }]) {
      const r = evaluateFsa(request({ ...p, law })); expect(codes(r)).toContain("LAW_REQUIRED"); expect(r.claims).toEqual([]);
    }
    const future = plan({ ...ids, planYearId: "2030" }, span("2030-01-01", "2031-01-01"));
    expect(evaluateFsa(request(future, [], "2030-02-01")).entitlementCoverage).toBe("incomplete");
  });

  it("enforces independent plan/legal employee, employer and total caps", () => {
    const p = plan();
    for (const changed of [{ ...p, planElectionLimit: money("999.99") },
      { ...p, employerContribution: money("501") }, { ...p, law: { ...p.law!, totalLimit: money("999") } },
      { ...p, law: { ...p.law!, electionLimit: money("999") } }]) {
      expect(codes(evaluateFsa(request(changed)))).toContain("LIMIT_EXCEEDED");
    }
  });
  it.each(["hsa", "dependent_care_fsa"])("rejects unsupported family %s", instrumentFamily => {
    const p = { ...plan(), instrumentFamily } as unknown as FsaPlan;
    expect(codes(evaluateFsa(request(p)))).toContain("UNSUPPORTED_FAMILY");
  });
  it("rejects subcent, negative and non-USD money with no rounding", () => {
    for (const annualElection of [money("1.001"), money("-1"), money("1", Currency.of("EUR"))]) {
      expect(() => evaluateFsa(request({ ...plan(), annualElection }))).toThrow("exact USD cents");
    }
    expect(() => evaluateFsa(request(plan(), [{ ...receipt(), incurredAmount: money("0.001") }]))).toThrow("exact USD cents");
  });

  it("suppresses all proposals on contradictory proofs, settlements or approval overdraw", () => {
    const a = receipt("a"); const b = receipt("b");
    const settledA = settle(a); const settledB = settle(b);
    const duplicateSettlement = { ...settledB, reimbursement: { ...settledB.reimbursement!,
      settlementId: "settlement-a" } } as FsaReceipt;
    for (const receipts of [[a, { ...a, incurredAmount: money("201") }], [settledA, duplicateSettlement],
      [settle(receipt("a", plan(), "900")), settle(receipt("b", plan(), "900"))]]) {
      const r = evaluateFsa(request(plan(), receipts));
      expect(r.claims).toEqual([]); expect(r.entitlement).toBeNull();
      expect(r.entitlementCoverage).toBe("incomplete");
    }
  });
  it("preserves source trace, scoped diagnostic fields and immutable evidence snapshots", () => {
    const input = request(); const r = evaluateFsa(input);
    expect(r.claims[0]!.traceRefs).toContain(input.plan.law!.evidence.ruleSnapshotId);
    expect(r.claims[0]!.evidence).toContainEqual(input.plan.planEvidence);
    expect(r.claims[0]!.evidence[0]).not.toBe(input.plan.planEvidence);
    for (const d of r.diagnostics) {
      expect(d.personId).toBe("claimant"); expect(d.period).toEqual(span());
      expect(d.missingFacts.length).toBeGreaterThan(0); expect(d.coverage).toBe("incomplete");
    }
  });
});
