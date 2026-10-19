import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { evaluateFsa, fsaScopeId, type FsaIdentity, type FsaPlan, type FsaReceipt,
  type FsaRequest, type FsaSource } from "../../../../../src/simulation/d2/health/fsa/index.js";
import { bindFsaYearChain, fsaYearChainFingerprint as fingerprint,
  type FsaYearChainRequest } from "../../../../../src/simulation/d2/health/fsa/yearChain/index.js";

// Artificial sources and limits; no real household data or statutory catalog.
const source = (ruleFamily: string, subjectId: string): FsaSource => ({ ruleFamily, subjectId,
  ruleSnapshotId: `synthetic/${ruleFamily}/${subjectId}`, version: "test/v1", jurisdiction: "US-test",
  sourcePublication: "synthetic test evidence, not law", projectionStatus: "verified",
  start: civilDate("2025-01-01"), endExclusive: civilDate("2030-01-01"),
  asOf: civilDate("2025-01-01"), verifiedThrough: civilDate("2029-12-31") });
const ids = (year: string): FsaIdentity => ({ householdId: "household", personId: "employee",
  employerId: "employer", planId: "plan", planYearId: year });
const plan = (year: "2026" | "2027"): FsaPlan => {
  const who = ids(year), scope = fsaScopeId(who);
  const period = { start: civilDate(`${year}-01-01`), endExclusive: civilDate(`${Number(year) + 1}-01-01`) };
  return { ...who, instrumentFamily: "health_fsa", period, coverage: period,
    planEvidence: source("health_fsa_plan", scope), annualElection: money("2000"), employerContribution: money("100"),
    planElectionLimit: money("3000"), planEmployerLimit: money("500"),
    law: { planYearId: year, electionLimit: money("3000"), employerLimit: money("500"), totalLimit: money("3500"),
      evidence: source("health_fsa_law", year) }, uniformCoverage: "full_election_and_employer",
    allocationPolicy: "prior_first_then_current/incurred_submitted_proof/v1",
    members: [{ memberId: who.personId, coverage: period,
      evidence: source("health_fsa_member", [scope, who.personId].map(encodeURIComponent).join("/")) }],
    termination: { kind: "none" }, submitEndExclusive: civilDate(`${Number(year) + 1}-04-01`),
    yearEnd: { kind: "forfeiture" } };
};
const receipt = (p: FsaPlan, proofId = "proof", incurred = "2026-01-05", submitted = "2026-01-06"): FsaReceipt => ({
  ...ids(p.planYearId), proofId, receiptId: `receipt/${proofId}`, memberId: p.personId, payeeId: "provider",
  expenseType: "qualified_medical_service", incurredAt: civilDate(incurred), submittedAt: civilDate(submitted),
  incurredAmount: money("1000"), payment: { status: "paid", paidAt: civilDate(incurred), amount: money("1000"), paymentRef: `paid/${proofId}` },
  destination: { kind: "bank_cash", accountId: "bank", ownerId: p.personId, householdId: p.householdId,
    evidence: source("health_fsa_destination", "bank") }, evidence: source("health_fsa_receipt", proofId),
  decision: { kind: "eligible", eligibleAmount: money("1000"), decidedAt: civilDate(submitted),
    evidence: source("health_fsa_adjudication", proofId) },
  reimbursement: { status: "settled", approvedAmount: money("1000"), allocations: [{ planYearId: p.planYearId, amount: money("1000") }],
    adjudicatedAt: civilDate(submitted), settledAt: civilDate(submitted), settlementId: `settled/${proofId}`,
    evidence: source("health_fsa_reimbursement", proofId) } });
const request = (p: FsaPlan, receipts: readonly FsaReceipt[] = []): FsaRequest => ({ plan: p, receipts, payroll: [],
  priorCarryover: null, evaluatedAt: civilDate("2027-04-01"), historyThrough: civilDate("2027-04-01"),
  historyEvidence: source("health_fsa_complete_history", fsaScopeId(p)) });
const rebind = (input: FsaYearChainRequest): FsaYearChainRequest => ({ ...input,
  expectedInputs: { prior: fingerprint(input.prior), successor: fingerprint(input.successor) } });
const fixture = (): FsaYearChainRequest => {
  const successor = request(plan("2027")), base = plan("2026");
  const prior = request({ ...base, yearEnd: { kind: "carryover", planCap: money("500"), legalCap: money("700"),
    nextEnrollment: { ...ids("2027"), period: successor.plan.period, enrolled: true,
      evidence: source("health_fsa_next_enrollment", fsaScopeId(successor.plan)) } } }, [receipt(base)]);
  return rebind({ prior, successor, calendar: { prior: source("health_fsa_calendar", fsaScopeId(prior.plan)),
    successor: source("health_fsa_calendar", fsaScopeId(successor.plan)) },
    carryoverLaw: { planYearId: "2026", planCap: money("500"), legalCap: money("700"),
      evidence: source("health_fsa_carryover_law", fsaScopeId(prior.plan)) },
    transferId: "transfer/2026/2027", externalCloseout: null, competingTransfers: [], expectedInputs: { prior: "", successor: "" } });
};
const codes = (input: FsaYearChainRequest) => bindFsaYearChain(input).diagnostics.map(d => d.diagnosticCode);

describe("conditional source-bound FSA year chain", () => {
  it("delegates $2100 available/$1000 settled/$500 carryover/$600 forfeiture without funding or net worth", () => {
    const input = fixture(), result = bindFsaYearChain(input);
    expect(result.proposalCoverage).toBe("complete");
    expect(result.closingEntitlement!.equals(money("1100"))).toBe(true);
    expect(result.proposedCarryover.equals(money("500"))).toBe(true);
    expect(result.proposedForfeiture.equals(money("600"))).toBe(true);
    expect(result.appliedCarryover.isZero()).toBe(true);
    expect(result.evaluations.prior).toEqual(evaluateFsa(input.prior));
    expect(result.evaluations.successor.entitlement!.remaining.equals(money("2100"))).toBe(true);
    expect(result.evaluations.prior.entitlement!.employeePayrollToDate.isZero()).toBe(true);
    expect(result).toMatchObject({ committed: false, postable: false, coverage: "incomplete", successorCoverage: "incomplete",
      payrollEffectCoverage: "incomplete", reimbursementSettlementCoverage: "incomplete", taxCoverage: "incomplete",
      netWorthTreatment: "excluded_restricted_entitlement" });
    expect(codes(input)).toEqual(["requires_149_authoritative_closeout"]);
    for (const field of ["cashDelta", "wageReduction", "expenseRecognition", "taxSavings", "assetDelta"]) expect(result).not.toHaveProperty(field);
  });

  it.each(["not_adjudicated", "pending"] as const)("prevents close for %s receipts, including unpaid medical expenses", status => {
    const input = fixture(), r = input.prior.receipts[0]!;
    const reimbursement: FsaReceipt["reimbursement"] = status === "not_adjudicated" ? { status }
      : { status, approvedAmount: money("1000"), allocations: [{ planYearId: "2026", amount: money("1000") }],
        adjudicatedAt: r.submittedAt, evidence: source("health_fsa_reimbursement", r.proofId), settlementId: null, settledAt: null };
    const result = bindFsaYearChain(rebind({ ...input, prior: { ...input.prior,
      receipts: [{ ...r, reimbursement, payment: { status: "unpaid" } }] } }));
    expect(result.proposalCoverage).toBe("incomplete");
    expect(result.proposedCarryover.isZero()).toBe(true);
    expect(result.evaluations.prior.claims[0]!.medicalDeduction).toBe("not_determined");
    expect(result.evaluations.prior.claims[0]!.settlementRequired).toBe(true);
  });

  it("denial consumes zero and duplicate aliases consume once", () => {
    const input = fixture(), r = input.prior.receipts[0]!;
    const denied: FsaReceipt = { ...receipt(input.prior.plan, "denied"), reimbursement: { status: "not_adjudicated" },
      decision: { ...r.decision!, kind: "denied", eligibleAmount: money("0"), evidence: source("health_fsa_adjudication", "denied") } };
    const result = bindFsaYearChain(rebind({ ...input, prior: { ...input.prior,
      receipts: [r, { ...r, receiptId: "alias" }, denied] } }));
    expect(result.closingEntitlement!.equals(money("1100"))).toBe(true);
    expect(result.evaluations.prior.claims).toHaveLength(1);
  });

  it("does not close an unadjudicated claim omitted by the owner for lack of remaining coverage", () => {
    const input = fixture(), r = input.prior.receipts[0]!;
    const exhausted: FsaReceipt = { ...r, incurredAmount: money("2100"), payment: { status: "unpaid" },
      decision: { ...r.decision!, eligibleAmount: money("2100") },
      reimbursement: { status: "settled", approvedAmount: money("2100"), allocations: [{ planYearId: "2026", amount: money("2100") }],
        adjudicatedAt: r.submittedAt, settledAt: r.submittedAt, settlementId: "settled/proof",
        evidence: source("health_fsa_reimbursement", r.proofId) } };
    const pending: FsaReceipt = { ...receipt(input.prior.plan, "unresolved"), reimbursement: { status: "not_adjudicated" } };
    const changed = rebind({ ...input, prior: { ...input.prior, receipts: [exhausted, pending] } });
    expect(codes(changed)).toContain("PRIOR_CLOSE_PENDING");
    expect(bindFsaYearChain(changed).proposalCoverage).toBe("incomplete");
  });

  it("pending payroll never becomes wages reduced or reimbursement cash", () => {
    const input = fixture();
    const changed = rebind({ ...input, prior: { ...input.prior, payroll: [{ ...ids("2026"),
      contributionId: "pending-payroll", effectiveAt: civilDate("2026-01-15"), sourceAccountId: "salary",
      contributionSource: "employee_salary_reduction", amount: money("100"), status: "pending", postingRef: null,
      evidence: source("health_fsa_payroll", "pending-payroll") }] } });
    const result = bindFsaYearChain(changed);
    expect(result.proposedCarryover.equals(money("500"))).toBe(true);
    expect(result.evaluations.prior.entitlement!.employeePayrollToDate.isZero()).toBe(true);
    expect(result.payrollEffectCoverage).toBe("incomplete");
    expect(result.postable).toBe(false);
  });

  it("keeps grace service and runout submissions in prior-year coverage", () => {
    const input = fixture();
    const p: FsaPlan = { ...input.prior.plan, yearEnd: { kind: "grace_period", incurredEndExclusive: civilDate("2027-03-16") } };
    const grace = receipt(p, "grace", "2027-03-15", "2027-03-20");
    const result = bindFsaYearChain(rebind({ ...input, prior: request(p, [grace]) }));
    expect(result.proposalCoverage).toBe("complete");
    expect(result.proposedCarryover.isZero()).toBe(true);
    expect(result.proposedForfeiture.equals(money("1100"))).toBe(true);
    expect(result.evaluations.prior.claims[0]!.planYearId).toBe("2026");
    expect(result.evaluations.successor.claims).toEqual([]);
    const early = civilDate("2027-02-01");
    const open = bindFsaYearChain(rebind({ ...input, prior: { ...request(p), evaluatedAt: early, historyThrough: early },
      successor: { ...input.successor, evaluatedAt: early, historyThrough: early } }));
    expect(open.priorGraceAvailable.equals(money("2100"))).toBe(true);
    expect(open.proposalCoverage).toBe("incomplete");
    for (const r of [receipt(p, "boundary", "2027-03-16", "2027-03-20"), receipt(p, "late", "2026-12-31", "2027-04-01")]) {
      expect(bindFsaYearChain(rebind({ ...input, prior: request(p, [r]) })).proposalCoverage).toBe("incomplete");
    }
    const runout = bindFsaYearChain(rebind({ ...input, prior: { ...input.prior,
      receipts: [receipt(input.prior.plan, "runout", "2026-12-31", "2027-03-31")] } }));
    expect(runout.proposalCoverage).toBe("complete");
  });

  it("uses exclusive forfeiture for termination and explicit non-enrollment", () => {
    const input = fixture(), rule = input.prior.plan.yearEnd!;
    const terminated: FsaPlan = { ...input.prior.plan, termination: { kind: "terminated",
      incurredEndExclusive: civilDate("2026-06-01"), submitEndExclusive: civilDate("2026-07-01"), disposition: "forfeit_after_runout" } };
    const noEnrollment: FsaPlan = { ...input.prior.plan, yearEnd: rule.kind === "carryover"
      ? { ...rule, nextEnrollment: { ...rule.nextEnrollment!, enrolled: false } } : rule };
    for (const p of [terminated, noEnrollment, { ...input.prior.plan, yearEnd: { kind: "forfeiture" as const } }]) {
      const result = bindFsaYearChain(rebind({ ...input, prior: { ...input.prior, plan: p } }));
      expect(result.proposalCoverage).toBe("complete");
      expect(result.proposedCarryover.isZero()).toBe(true);
      expect(result.proposedForfeiture.equals(money("1100"))).toBe(true);
    }
    const mixed = { ...rule, incurredEndExclusive: civilDate("2027-03-16") };
    expect(bindFsaYearChain(rebind({ ...input, prior: { ...input.prior,
      plan: { ...input.prior.plan, yearEnd: mixed } } })).proposalCoverage).toBe("incomplete");
  });

  it("requires legal cap, calendar and complete benefit substantiation", () => {
    const input = fixture();
    for (const changed of [{ ...input, carryoverLaw: null }, { ...input, calendar: { ...input.calendar, prior: null } },
      { ...input, carryoverLaw: { ...input.carryoverLaw!, planYearId: "2027" } },
      { ...input, carryoverLaw: { ...input.carryoverLaw!, evidence: { ...input.carryoverLaw!.evidence, verifiedThrough: civilDate("2027-03-31") } } },
      { ...input, prior: { ...input.prior, historyEvidence: null } },
      { ...input, prior: { ...input.prior, receipts: [{ ...input.prior.receipts[0]!, evidence: null }] } },
      { ...input, successor: { ...input.successor, plan: { ...input.successor.plan, law: null } } }]) {
      expect(bindFsaYearChain(rebind(changed)).proposalCoverage).toBe("incomplete");
    }
    const rule = input.prior.plan.yearEnd!;
    if (rule.kind !== "carryover") throw new Error("fixture");
    expect(codes(rebind({ ...input, prior: { ...input.prior, plan: { ...input.prior.plan,
      yearEnd: { ...rule, nextEnrollment: null } } } }))).toContain("SUCCESSOR_ENROLLMENT_REQUIRED");
    const lower = rebind({ ...input, prior: { ...input.prior, plan: { ...input.prior.plan,
      yearEnd: { ...rule, legalCap: money("300") } } }, carryoverLaw: { ...input.carryoverLaw!, legalCap: money("300") } });
    expect(bindFsaYearChain(lower).proposedCarryover.equals(money("300"))).toBe(true);
  });

  it.each(["personId", "householdId", "employerId", "planId"] as const)("isolates changed %s", field => {
    const input = fixture();
    expect(codes(rebind({ ...input, successor: { ...input.successor,
      plan: { ...input.successor.plan, [field]: "renamed" } } }))).toContain("IDENTITY_CONFLICT");
  });

  it("rejects short/gapped years, unrelated instruments and stale post-year-end amendments", () => {
    const input = fixture();
    for (const start of ["2027-02-01", "2028-01-01"]) {
      expect(codes(rebind({ ...input, successor: { ...input.successor, plan: { ...input.successor.plan,
        period: { start: civilDate(start), endExclusive: civilDate(start === "2028-01-01" ? "2029-01-01" : "2028-01-01") }
      } } }))).toContain("ADJACENT_ANNUAL_YEARS_REQUIRED");
    }
    const changed = { ...input, prior: { ...input.prior, plan: { ...input.prior.plan, annualElection: money("1900") } } };
    expect(codes(changed)).toContain("STALE_SOURCE");
    const hsa = { ...input.successor.plan, instrumentFamily: "hsa" } as unknown as FsaPlan;
    expect(bindFsaYearChain(rebind({ ...input, successor: { ...input.successor, plan: hsa } })).proposalCoverage).toBe("incomplete");
  });

  it("admits sourced consecutive noncalendar years and isolates dependent member coverage", () => {
    const input = fixture();
    const shift = (p: FsaPlan, start: string, end: string, submit: string): FsaPlan => {
      const period = { start: civilDate(start), endExclusive: civilDate(end) };
      return { ...p, period, coverage: period, submitEndExclusive: civilDate(submit),
        members: p.members.map(m => ({ ...m, coverage: period })) };
    };
    const next = shift(input.successor.plan, "2027-07-01", "2028-07-01", "2028-10-01");
    const old = shift(input.prior.plan, "2026-07-01", "2027-07-01", "2027-10-01");
    if (old.yearEnd?.kind !== "carryover") throw new Error("fixture");
    const p: FsaPlan = { ...old, yearEnd: { ...old.yearEnd, nextEnrollment: { ...old.yearEnd.nextEnrollment!, period: next.period } },
      members: [...old.members, { memberId: "child", coverage: old.coverage,
        evidence: source("health_fsa_member", [fsaScopeId(old), "child"].map(encodeURIComponent).join("/")) }] };
    const at = civilDate("2027-10-01");
    const changed = rebind({ ...input, prior: { ...request(p, [{ ...receipt(p, "child-proof", "2026-08-01", "2026-08-02"),
      memberId: "child" }]), evaluatedAt: at, historyThrough: at },
      successor: { ...request(next), evaluatedAt: at, historyThrough: at } });
    const result = bindFsaYearChain(changed);
    expect(result.proposalCoverage).toBe("complete");
    expect(result.provenance[0]!.memberId).toBe("child");
    expect(result.proposedCarryover.equals(money("500"))).toBe(true);
    const wrong = rebind({ ...changed, prior: { ...changed.prior,
      receipts: [{ ...changed.prior.receipts[0]!, memberId: "uncovered-child" }] } });
    expect(bindFsaYearChain(wrong).proposalCoverage).toBe("incomplete");
  });

  it("vetoes transfer replay, competing successors and receipt/proof/settlement reuse across years", () => {
    const input = fixture();
    for (const other of [{ transferId: input.transferId, from: ids("2025"), to: ids("2026") },
      { transferId: "other", from: ids("2026"), to: { ...ids("2027"), planId: "second-plan" } }]) {
      expect(codes({ ...input, competingTransfers: [other] })).toContain("TRANSFER_CONFLICT");
    }
    const r = receipt(input.successor.plan, "new", "2027-01-05", "2027-01-06"), old = input.prior.receipts[0]!;
    for (const duplicate of [{ ...r, proofId: old.proofId }, { ...r, receiptId: old.receiptId },
      { ...r, reimbursement: { ...r.reimbursement!, settlementId: "settled/proof" } } as FsaReceipt]) {
      expect(codes(rebind({ ...input, successor: { ...input.successor, receipts: [duplicate] } }))).toContain("CROSS_YEAR_BENEFIT_CONFLICT");
    }
  });

  it("retains a matching external claim but never authenticates a finalized flag", () => {
    const input = fixture();
    const externalCloseout = { closeoutId: "external-close", transferId: input.transferId, from: ids("2026"), to: ids("2027"),
      amount: money("500"), priorInputFingerprint: fingerprint(input.prior), successorInputFingerprint: fingerprint(input.successor),
      settlementIds: ["settled/proof"], evidence: source("health_fsa_closeout", "external-close") };
    const result = bindFsaYearChain({ ...input, externalCloseout });
    expect(result.proposalCoverage).toBe("complete");
    expect(result.appliedCarryover.isZero()).toBe(true);
    expect(codes({ ...input, externalCloseout: { ...externalCloseout, amount: money("600") } })).toContain("EXTERNAL_CLOSEOUT_CONFLICT");
    const claimed = rebind({ ...input, externalCloseout: null, successor: { ...input.successor, priorCarryover: {
      from: ids("2026"), fromPeriod: input.prior.plan.period, to: ids("2027"), transferId: input.transferId,
      effectiveAt: input.successor.plan.period.start, sourceClosingEntitlement: money("1100"), planCap: money("500"), legalCap: money("700"),
      amount: money("500"), yearEndKind: "carryover", finalized: true, consumedProofIds: ["proof"],
      evidence: source("health_fsa_finalized_carryover", input.transferId) } } });
    expect(codes(claimed)).toContain("UNAUTHENTICATED_PRIOR_TRANSFER");
    expect(bindFsaYearChain(claimed).appliedCarryover.isZero()).toBe(true);
  });

  it("clones and deeply freezes sources, preserving deterministic reversed fact order", () => {
    const input = fixture(), r = input.prior.receipts[0]!;
    const withAliases = rebind({ ...input, prior: { ...input.prior, receipts: [r, { ...r, receiptId: "alias" }] } });
    const before = fingerprint(withAliases), result = bindFsaYearChain(withAliases);
    expect(bindFsaYearChain({ ...withAliases, prior: { ...withAliases.prior, receipts: [...withAliases.prior.receipts].reverse() } })).toEqual(result);
    expect(fingerprint(withAliases)).toBe(before);
    expect(result.inputs.prior.plan).not.toBe(withAliases.prior.plan);
    expect(Object.isFrozen(result.inputs.prior.plan.law!.evidence)).toBe(true);
    expect(Object.isFrozen(result.inputs.prior.receipts[0]!.reimbursement)).toBe(true);
    expect(Object.isFrozen(withAliases.prior.plan)).toBe(false);
    expect(result.fingerprints.priorEvaluation).toBe(fingerprint(result.evaluations.prior));
  });
});
