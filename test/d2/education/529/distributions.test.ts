import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { propose529Distribution, type EducationExpense, type EducationOutput, type EducationRequest, type EducationSource, type ExpenseUsage } from "../../../../src/simulation/d2/education/529/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, money } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

// S8 isolated oracle: all law, identity, sources and amounts below are synthetic.
// They assert no actual jurisdiction's 529 eligibility or statutory convention.
const at = civilDate("2026-01-15"), funded = civilDate("2025-01-01");
const source = (id: string, asOf = at): EducationSource => ({ sourceId: id, sourcePublication: "Synthetic 529 evidence; not actual law",
  publishedAt: civilDate("2024-01-01"), asOf, ruleSnapshotId: "synthetic-529-v1", ruleFamily: "education_529", jurisdiction: "US",
  version: "synthetic-v1", verification: "verified", projectionStatus: "verified", householdId: "hh", ownerId: "owner", beneficiaryId: "student",
  planId: "plan", providerId: "provider", currency: Currency.of("USD"), start: civilDate("2020-01-01"), endExclusive: civilDate("2030-01-01") });
const expense = (): EducationExpense => ({ expenseId: "tuition", paidExpenseId: "canonical-bill", beneficiaryId: "student", studentId: "student-record",
  institutionId: "university", payeeId: "bursar", termId: "spring-2026", ownerRelationship: "parent", category: "postsecondary_tuition", taxYear: 2026,
  incurredAt: civilDate("2026-01-01"), paidAt: civilDate("2026-01-05"), payerId: "owner", payerAccountId: "bank", paymentMethod: "bank_paid",
  billed: money("2000"), eligibleBilled: money("2000"), adjustedEligible: money("2000"), adjustments: [], adjustmentsComplete: "verified_complete",
  unreimbursedUse: "verified", recognition: { status: "already_recognized", economicExpenseId: "tuition-recognition", source: source("recognition") },
  unpaidClaim: null, source: source("expense") });
const request = (): EducationRequest => ({ operationId: "distribution-1", claimId: "claim-1", kind: "qualified_distribution", effectiveAt: at,
  knownAt: civilDate("2026-02-01"), taxYear: 2026, currency: Currency.of("USD"), gross: money("2000"),
  plan: { householdId: "hh", ownerId: "owner", beneficiaryId: "student", planId: "plan", providerId: "provider", accountId: "plan-container",
    cashAccountId: "plan-cash", taxBucket: "education_529", treatment: "ordinary_original_owner", stateJurisdiction: "US:synthetic-state",
    localJurisdiction: "US:synthetic-local", source: source("plan"),
    contributions: [{ lotId: "lot-1", basisId: "basis-1", fundingOperationId: "original-contribution", fundedAt: funded,
      principal: money("6000"), source: source("contribution", funded) }], distributions: [],
    snapshot: { at, taxYear: 2026, currentValue: money("10000"), contributionBasis: money("6000"), earnings: money("4000"),
      unencumberedCash: money("3000"), history: "complete_since_inception", source: source("snapshot") } },
  rules: { source: source("law"), expenseCategory: "postsecondary_tuition", qualifiedTreatment: "earnings_excluded",
    nonqualifiedTreatment: "earnings_income_basis_return", allocation: "current_plan_aggregate_earnings_over_value",
    earningsRounding: "half_up", expenseYear: "paid_year_or_direct_payment_event" },
  qualification: { at, beneficiaryId: "student", studentId: "student-record", institutionId: "university", termId: "spring-2026",
    categoryEligible: "yes", source: source("qualification") }, expense: expense(),
  usage: { at, complete: "verified_complete", entries: [], source: source("usage") },
  route: { kind: "owned_bank", accountId: "bank", ownerId: "owner", householdId: "hh", observedAt: at, openingCash: money("50"), source: source("bank") },
  authorization: { permitted: "yes", operationId: "distribution-1", claimId: "claim-1", destinationAccountId: "bank", gross: money("2000"), source: source("authorization") } });
const withGross = (r: EducationRequest, amount: string): EducationRequest => ({ ...r, gross: money(amount), authorization: { ...r.authorization, gross: money(amount) } });
const nonqualified = (): EducationRequest => withGross({ ...request(), kind: "nonqualified_distribution", expense: null, qualification: null }, "1000");
const usage = (): ExpenseUsage => ({ operationId: "earlier-distribution", claimId: "earlier-claim", planId: "plan", providerId: "provider", paidExpenseId: "canonical-bill", beneficiaryId: "student",
  taxYear: 2026, amount: money("2000"), effectiveAt: civilDate("2026-01-10"), state: "posted", source: source("prior-usage") });
const coverage = (r: ReturnType<typeof propose529Distribution>, output: EducationOutput) => r.coverage.find(c => c.affectedOutput === output)!;
const blocked = (r: EducationRequest, code: string) => {
  const result = propose529Distribution(r);
  expect(result.proposals).toEqual([]);
  expect(coverage(result, "basis_earnings").diagnosticCode).toBe(code);
  expect(result.coverage.every(c => c.coverage === "incomplete")).toBe(true);
};

describe("529 B3-1 conditional proposals: PFA-DET §5.7 / PFA-INV-028 / PFA-TAX-015", () => {
  it("allocates $2,000 qualified tuition from $10,000 with $6,000 basis/$4,000 earnings; receipt is a transfer", () => {
    const r = request(), result = propose529Distribution(r), p = result.proposals[0]!;
    expect(result.proposals).toHaveLength(1);
    expect(p.grossAmount.equals(money("2000"))).toBe(true);
    expect(p.basisRecovered.equals(money("1200"))).toBe(true);
    expect(p.earnings.equals(money("800"))).toBe(true);
    expect(p.taxFacts.taxable.isZero()).toBe(true);
    expect(p.taxFacts.incomeCharacter).toBe("qualified_529_earnings_excluded");
    expect(p.planAssetDelta.plus(p.ownedBankCashDelta).minus(p.institutionClaimLiabilityDelta).isZero()).toBe(true);
    expect(p.movementNetWorthDelta.isZero()).toBe(true);
    expect(p.bankReceiptCharacter).toBe("owned_transfer");
    expect(p.expense).toEqual({ paidExpenseId: "canonical-bill", economicExpenseId: "tuition-recognition", recognize: false, amount: money("2000"),
      institutionClaimId: null, adjustmentAllocationIds: [] });
    expect(p.basisDelta.equals(money("-1200"))).toBe(true);
    expect(p.basisLotIds).toEqual([{ lotId: "lot-1", basisId: "basis-1" }]);
    expect(p.originalPlanValue.equals(money("10000"))).toBe(true);
    expect(p.fundingProof.route).toEqual(r.route);
    expect(p.committed).toBe(false); expect(p.postable).toBe(false);
    for (const o of ["qualification", "basis_earnings", "funded_route", "federal_character"] as const) expect(coverage(result, o).coverage).toBe("complete");
    for (const o of ["penalty", "state_tax", "local_tax", "contribution_deduction", "settlement"] as const) expect(coverage(result, o).coverage).toBe("incomplete");
    expect(coverage(result, "settlement").diagnosticCode).toBe("SHARED_SETTLEMENT_PENDING");
    expect(result.coverage.every(c => c.traceRefs.includes("law") && c.ruleSnapshotId === "synthetic-529-v1")).toBe(true);
  });
  it("allocates sourced nonqualified $1,000 as $600 basis and $400 earnings without tax payment or expense", () => {
    const result = propose529Distribution(nonqualified()), p = result.proposals[0]!;
    expect(p.basisRecovered.equals(money("600"))).toBe(true); expect(p.earnings.equals(money("400"))).toBe(true);
    expect(p.taxFacts.taxable.equals(money("400"))).toBe(true); expect(p.taxFacts.gross.equals(money("1000"))).toBe(true);
    expect(p.expense).toBeNull(); expect(p.movementNetWorthDelta.isZero()).toBe(true);
    expect(coverage(result, "qualification").coverage).toBe("not_applicable");
    expect(coverage(result, "penalty").diagnosticCode).toBe("TAX_AUTHORITY_REQUIRED");
    const r = nonqualified(); blocked({ ...r, rules: { ...r.rules!, nonqualifiedTreatment: "unsupported" } }, "NONQUALIFIED_LAW_REQUIRED");
  });
  it("excludes a second overlapping $2,000 reimbursement even with a renamed expense", () => {
    const r = request(), u = usage();
    const afterPosting: EducationRequest = { ...r, operationId: "second", claimId: "second-claim",
      authorization: { ...r.authorization, operationId: "second", claimId: "second-claim" },
      expense: { ...r.expense!, expenseId: "renamed-tuition" }, usage: { ...r.usage, entries: [u] },
      plan: { ...r.plan, distributions: [{ operationId: u.operationId, claimId: u.claimId, effectiveAt: u.effectiveAt,
        kind: "qualified_distribution", paidExpenseId: u.paidExpenseId,
        gross: money("2000"), basisRecovered: money("1200"), earnings: money("800"), source: source("historical") }],
        snapshot: { ...r.plan.snapshot, currentValue: money("8000"), contributionBasis: money("4800"), earnings: money("3200"), unencumberedCash: money("3000") } } };
    blocked(afterPosting, "ADJUSTED_EXPENSE_EXHAUSTED");
    blocked({ ...afterPosting, usage: { ...afterPosting.usage, entries: [] } }, "HISTORICAL_EXPENSE_USAGE_REQUIRED");
    blocked({ ...r, usage: { ...r.usage, entries: [{ ...u, state: "pending_authorized" }] } }, "ADJUSTED_EXPENSE_EXHAUSTED");
    blocked({ ...r, usage: { ...r.usage, entries: [{ ...u, planId: "another-plan", providerId: "another-provider" }] } }, "ADJUSTED_EXPENSE_EXHAUSTED");
  });
  it("subtracts scholarships, grants, credit allocations, other 529 and reimbursements exactly once", () => {
    const r = request();
    const e = { ...r.expense!, adjustments: (["scholarship", "grant", "tax_credit", "other_529", "other_reimbursement"] as const)
      .map((kind, i) => ({ allocationId: `adjustment-${i}`, kind, amount: money("200"), source: source(`adjustment-${i}`) })), adjustedEligible: money("1000") };
    blocked({ ...r, expense: e }, "ADJUSTED_EXPENSE_EXHAUSTED");
    expect(propose529Distribution(withGross({ ...r, expense: e }, "1000")).proposals).toHaveLength(1);
    blocked({ ...r, expense: { ...e, adjustedEligible: money("2000") } }, "ADJUSTED_EXPENSE_NOT_RECONCILED");
    blocked({ ...r, expense: { ...e, adjustments: [...e.adjustments, e.adjustments[0]!] } }, "DUPLICATE_OR_MISSING_ID");
    blocked({ ...r, expense: { ...e, adjustments: [{ ...e.adjustments[0]!, allocationId: usage().operationId }] },
      usage: { ...r.usage, entries: [usage()] } }, "DUPLICATE_OR_UNSUPPORTED_ADJUSTMENT");
  });
  it("preserves recognition separately, including a sourced unpaid direct institution claim", () => {
    const r = request(), e = r.expense!;
    const direct: EducationRequest = { ...r, expense: { ...e, paidAt: null, payerAccountId: "plan-cash", paymentMethod: "direct_plan_payment",
      recognition: { ...e.recognition, status: "unrecognized" }, unpaidClaim: { claimId: "institution-bill", outstanding: money("2000"), source: source("unpaid-claim") } },
      route: { kind: "institution", accountId: "bursar-destination", institutionId: e.institutionId, payeeId: e.payeeId, source: source("institution") },
      authorization: { ...r.authorization, destinationAccountId: "bursar-destination" } };
    const p = propose529Distribution(direct).proposals[0]!;
    expect(p.expense!.recognize).toBe(true); expect(p.expense!.institutionClaimId).toBe("institution-bill");
    expect(p.bankReceiptCharacter).toBe("not_applicable"); expect(p.movementNetWorthDelta.isZero()).toBe(true);
    expect(p.ownedBankCashDelta.isZero()).toBe(true); expect(p.institutionPaymentAmount.equals(money("2000"))).toBe(true);
    expect(p.institutionClaimLiabilityDelta.equals(money("-2000"))).toBe(true);
    expect(p.planAssetDelta.plus(p.ownedBankCashDelta).minus(p.institutionClaimLiabilityDelta).isZero()).toBe(true);
    expect(propose529Distribution({ ...direct, expense: { ...direct.expense!, recognition: e.recognition } }).proposals[0]!.expense!.recognize).toBe(false);
    blocked({ ...direct, expense: { ...direct.expense!, unpaidClaim: null } }, "UNPAID_INSTITUTION_CLAIM_REQUIRED");
    blocked({ ...direct, expense: { ...direct.expense!, paidAt: at } }, "DIRECT_PAY_MISMATCH_OR_ALREADY_PAID");
    blocked({ ...direct, route: { ...(direct.route as Extract<EducationRequest["route"], { kind: "institution" }>), payeeId: "other" } }, "DIRECT_PAY_MISMATCH_OR_ALREADY_PAID");
  });
  it("does not sell invested securities or partially fund a requested distribution", () => {
    const r = request();
    for (const cash of ["0", "1999.99"]) blocked({ ...r, plan: { ...r.plan, snapshot: { ...r.plan.snapshot, unencumberedCash: money(cash) } } }, "LIQUIDATION_OR_ADDITIONAL_CASH_REQUIRED");
    expect(propose529Distribution({ ...r, plan: { ...r.plan, snapshot: { ...r.plan.snapshot, unencumberedCash: money("2000") } } }).proposals).toHaveLength(1);
  });
  it("rejects operation/claim replay and duplicate registers rather than allocating by array order", () => {
    const r = request(), u = usage();
    blocked({ ...r, usage: { ...r.usage, entries: [{ ...u, operationId: r.operationId }] } }, "DUPLICATE_OPERATION_OR_CLAIM");
    blocked({ ...r, usage: { ...r.usage, entries: [{ ...u, claimId: r.claimId }] } }, "DUPLICATE_OPERATION_OR_CLAIM");
    blocked({ ...r, usage: { ...r.usage, entries: [u, u] } }, "DUPLICATE_OR_MISSING_ID");
    blocked({ ...r, plan: { ...r.plan, contributions: [...r.plan.contributions, r.plan.contributions[0]!] } }, "DUPLICATE_OR_MISSING_ID");
    const n = nonqualified();
    const h = { operationId: n.operationId, claimId: n.claimId, kind: "nonqualified_distribution" as const, paidExpenseId: null,
      effectiveAt: civilDate("2026-01-10"), gross: money("1000"),
      basisRecovered: money("600"), earnings: money("400"), source: source("historical") };
    blocked({ ...n, plan: { ...n.plan, distributions: [h], snapshot: { ...n.plan.snapshot, currentValue: money("9000"),
      contributionBasis: money("5400"), earnings: money("3600") } } }, "DUPLICATE_OPERATION_OR_CLAIM");
  });
  it("is deterministic, preserves input, and consumes no cash/basis/expense capacity on evaluation", () => {
    const r = request(), before = JSON.stringify(r), a = propose529Distribution(r);
    expect(propose529Distribution(r)).toEqual(a); expect(JSON.stringify(r)).toBe(before);
    expect(r.plan.snapshot.unencumberedCash!.equals(money("3000"))).toBe(true); expect(r.usage.entries).toEqual([]);
    const n = nonqualified();
    const twoLots = { ...n, plan: { ...n.plan, contributions: [
      { ...n.plan.contributions[0]!, principal: money("1000") },
      { ...n.plan.contributions[0]!, lotId: "lot-2", basisId: "basis-2", fundingOperationId: "funding-2", principal: money("5000"), source: source("contribution-2", funded) }] } };
    expect(propose529Distribution({ ...twoLots, plan: { ...twoLots.plan, contributions: [...twoLots.plan.contributions].reverse() } })).toEqual(propose529Distribution(twoLots));
  });
  it("uses the sourced legal rounding once after multiplying exact values", () => {
    const n = nonqualified();
    const r = withGross({ ...n, plan: { ...n.plan, contributions: [{ ...n.plan.contributions[0]!, principal: money("5000") }],
      snapshot: { ...n.plan.snapshot, contributionBasis: money("5000"), earnings: money("5000") } } }, "0.01");
    const up = propose529Distribution(r).proposals[0]!, even = propose529Distribution({ ...r, rules: { ...r.rules!, earningsRounding: "half_even" } }).proposals[0]!;
    expect(up.earnings.equals(money("0.01"))).toBe(true); expect(up.basisRecovered.isZero()).toBe(true);
    expect(even.earnings.isZero()).toBe(true); expect(even.basisRecovered.equals(money("0.01"))).toBe(true);
    expect(up.earnings.plus(up.basisRecovered).equals(r.gross)).toBe(true);
  });
  it("handles amounts beyond JavaScript integer precision without floating point", () => {
    const n = nonqualified(), huge = money("100000000000000000000.00");
    const r = withGross({ ...n, plan: { ...n.plan, contributions: [{ ...n.plan.contributions[0]!, principal: money("60000000000000000000") }],
      snapshot: { ...n.plan.snapshot, currentValue: huge, contributionBasis: money("60000000000000000000"), earnings: money("40000000000000000000"), unencumberedCash: huge } } }, "10000000000000000.01");
    const p = propose529Distribution(r).proposals[0]!;
    expect(p.earnings.equals(money("4000000000000000"))).toBe(true);
    expect(p.basisRecovered.equals(money("6000000000000000.01"))).toBe(true);
  });
  it.each(["roth_rollover", "plan_rollover", "beneficiary_change", "contribution"] as const)("excludes %s without inferring eligibility", kind => blocked({ ...request(), kind }, "UNSUPPORTED_OPERATION"));
  it.each(["precollege", "vocational", "loan", "special_education", "unsupported"] as const)("gates unsourced %s tuition categories", category => {
    const r = request(); blocked({ ...r, expense: { ...r.expense!, category } }, "UNSUPPORTED_EXPENSE_LAW");
  });
  it("requires source-qualified law even when every economic amount is known", () => {
    const { rules: _rules, ...withoutLaw } = request(); blocked(withoutLaw, "SOURCED_LAW_REQUIRED");
    const r = request(); blocked({ ...r, rules: { ...r.rules!, allocation: "unsupported" } }, "UNSUPPORTED_ALLOCATION_LAW");
    blocked({ ...r, rules: { ...r.rules!, qualifiedTreatment: "unsupported" } }, "UNSUPPORTED_EXPENSE_LAW");
    blocked({ ...r, expense: null }, "EXPENSE_AND_QUALIFICATION_REQUIRED");
  });
  it("rejects future publication, projection, stale/expired observations and exact effective end", () => {
    const r = request();
    for (const patch of [
      { publishedAt: civilDate("2026-01-16"), asOf: civilDate("2026-01-16") },
      { projectionStatus: "explicit_projected" as const }, { verification: "unverified" as const },
      { start: civilDate("2026-01-16") }, { endExclusive: at },
    ]) blocked({ ...r, rules: { ...r.rules!, source: { ...r.rules!.source, ...patch } } }, "SOURCE_NOT_ADMITTED");
    const historical = r.plan.contributions[0]!;
    blocked({ ...r, plan: { ...r.plan, contributions: [{ ...historical, source: { ...historical.source, publishedAt: at, asOf: at } }] } }, "SOURCE_NOT_ADMITTED");
    expect(propose529Distribution({ ...r, rules: { ...r.rules!, source: { ...r.rules!.source, start: at } } }).proposals).toHaveLength(1);
  });
  it.each(["providerId", "planId", "ownerId", "beneficiaryId", "householdId"] as const)("rejects mismatched sourced %s", key => {
    const r = request(); blocked({ ...r, plan: { ...r.plan, source: { ...r.plan.source, [key]: "other" } } }, "SOURCE_SCOPE_MISMATCH");
  });
  it("rejects mixed currencies, fractional cents and mixed rule snapshots", () => {
    const r = request(); blocked({ ...r, gross: money("2000", Currency.of("EUR")) }, "CURRENCY_OR_CENTS_INVALID");
    blocked({ ...r, gross: money("2000.001") }, "CURRENCY_OR_CENTS_INVALID");
    blocked({ ...r, plan: { ...r.plan, source: { ...r.plan.source, currency: Currency.of("EUR") } } }, "SOURCE_SCOPE_MISMATCH");
    blocked({ ...r, plan: { ...r.plan, source: { ...r.plan.source, ruleSnapshotId: "other" } } }, "MIXED_RULE_SNAPSHOT");
  });
  it("requires current plan value/year, complete funded basis and distribution histories", () => {
    const r = request();
    for (const patch of [{ taxYear: 2025 }, { taxYear: null }, { at: civilDate("2026-01-14") }, { history: "unknown" as const }])
      blocked({ ...r, plan: { ...r.plan, snapshot: { ...r.plan.snapshot, ...patch } } }, "PLAN_VALUE_YEAR_OR_HISTORY_REQUIRED");
    blocked({ ...r, plan: { ...r.plan, contributions: [] } }, "BASIS_HISTORY_NOT_RECONCILED");
    for (const field of ["currentValue", "contributionBasis", "earnings", "unencumberedCash"] as const)
      blocked({ ...r, plan: { ...r.plan, snapshot: { ...r.plan.snapshot, [field]: null } } }, "PLAN_VALUE_BASIS_EARNINGS_OR_CASH_REQUIRED");
    blocked({ ...r, plan: { ...r.plan, snapshot: { ...r.plan.snapshot, currentValue: money("0") } } }, "PLAN_VALUE_NOT_RECONCILED");
    blocked({ ...r, plan: { ...r.plan, snapshot: { ...r.plan.snapshot, unencumberedCash: money("10001") } } }, "PLAN_VALUE_NOT_RECONCILED");
    blocked({ ...r, plan: { ...r.plan, distributions: [{ operationId: "old", claimId: "old-claim", effectiveAt: at, gross: money("1000"),
      kind: "nonqualified_distribution", paidExpenseId: null,
      basisRecovered: money("600"), earnings: money("500"), source: source("invalid-history") }] } }, "DISTRIBUTION_HISTORY_INVALID");
  });
  it("requires adjusted expense completeness, dated beneficiary/year proof and actual payer routing", () => {
    const r = request(), e = r.expense!;
    blocked({ ...r, expense: { ...e, adjustmentsComplete: "unknown" } }, "EXPENSE_YEAR_OR_NONDUPLICATION_PROOF_REQUIRED");
    blocked({ ...r, expense: { ...e, unreimbursedUse: "unknown" } }, "EXPENSE_YEAR_OR_NONDUPLICATION_PROOF_REQUIRED");
    blocked({ ...r, expense: { ...e, taxYear: 2025 } }, "EXPENSE_YEAR_OR_NONDUPLICATION_PROOF_REQUIRED");
    blocked({ ...r, expense: { ...e, beneficiaryId: "sibling" } }, "BENEFICIARY_OR_QUALIFICATION_MISMATCH");
    blocked({ ...r, qualification: { ...r.qualification!, categoryEligible: "unknown" } }, "BENEFICIARY_OR_QUALIFICATION_MISMATCH");
    blocked({ ...r, expense: { ...e, paidAt: null } }, "PAID_EXPENSE_PROOF_REQUIRED");
    blocked({ ...r, expense: { ...e, paidAt: civilDate("2025-12-31") } }, "PAYER_PAYMENT_OR_YEAR_MISMATCH");
    blocked({ ...r, expense: { ...e, payerAccountId: "unverified-bank" } }, "PAYER_PAYMENT_OR_YEAR_MISMATCH");
    blocked({ ...r, authorization: { ...r.authorization, permitted: "unknown" } }, "FUNDED_ROUTE_NOT_AUTHORIZED");
    blocked({ ...r, authorization: { ...r.authorization, gross: money("1999") } }, "FUNDED_ROUTE_NOT_AUTHORIZED");
    blocked({ ...r, usage: { ...r.usage, complete: "unknown" } }, "COMPLETE_USAGE_REQUIRED");
  });
  it("retains only the remaining expense after a prior partial allocation and reconciled history", () => {
    const r = request(), u = { ...usage(), amount: money("500") };
    const partial: EducationRequest = { ...r, usage: { ...r.usage, entries: [u] },
      plan: { ...r.plan, distributions: [{ operationId: u.operationId, claimId: u.claimId, effectiveAt: u.effectiveAt,
        kind: "qualified_distribution", paidExpenseId: u.paidExpenseId,
        gross: money("500"), basisRecovered: money("300"), earnings: money("200"), source: source("historical") }],
        snapshot: { ...r.plan.snapshot, currentValue: money("9500"), contributionBasis: money("5700"), earnings: money("3800") } } };
    blocked(partial, "ADJUSTED_EXPENSE_EXHAUSTED");
    const p = propose529Distribution(withGross(partial, "1500")).proposals[0]!;
    expect(p.basisRecovered.equals(money("900"))).toBe(true); expect(p.earnings.equals(money("600"))).toBe(true);
    expect(p.originalBasis.equals(money("5700"))).toBe(true);
    blocked(withGross(partial, "1500.01"), "ADJUSTED_EXPENSE_EXHAUSTED");
  });
  it("requires bank ownership, current destination cash and authorization of the exact destination", () => {
    const r = request(), bank = r.route as Extract<EducationRequest["route"], { kind: "owned_bank" }>;
    for (const patch of [{ ownerId: "student" }, { householdId: "other" }, { observedAt: civilDate("2026-01-14") }])
      blocked({ ...r, route: { ...bank, ...patch } }, "BANK_OWNERSHIP_OR_CASH_PROOF_REQUIRED");
    blocked({ ...r, authorization: { ...r.authorization, destinationAccountId: "other-bank" } }, "FUNDED_ROUTE_NOT_AUTHORIZED");
    blocked({ ...r, route: { ...bank, accountId: r.plan.cashAccountId },
      authorization: { ...r.authorization, destinationAccountId: r.plan.cashAccountId } }, "INVALID_DESTINATION");
    blocked({ ...r, expense: { ...r.expense!, recognition: { ...r.expense!.recognition, source: source("recognition", civilDate("2026-01-14")) } } }, "RECOGNITION_PROOF_REQUIRED");
  });
  it("diagnoses conflicting source identities and retains attempted source references", () => {
    const r = request();
    const result = propose529Distribution({ ...r, plan: { ...r.plan, source: { ...r.rules!.source, version: "conflicting-v2" } } });
    expect(result.proposals).toEqual([]); expect(coverage(result, "basis_earnings").diagnosticCode).toBe("CONFLICTING_SOURCE_ID");
    const bad = propose529Distribution({ ...r, plan: { ...r.plan, source: { ...r.plan.source, providerId: "other" } } });
    expect(coverage(bad, "basis_earnings").traceRefs).toContain("plan");
  });
  it("reads retained prep catalog facts without promoting decision-required or integrated evidence", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    const cases = catalog.cases.filter(c => c.family === "education_529");
    expect(cases).toHaveLength(6);
    for (const c of cases) { expect(c.expected.capability).toBe("decision_required"); expect(c.expected.integratedRuntimeEvidence).toBe(false); }
    const qualified = cases.find(c => c.id === "529_qualified")!;
    expect(qualified.input.amounts.contributedBasisCents).toBe("80000");
    expect(qualified.expected.unknownOutputs).toContain("earnings_basis_split");
  });
});
