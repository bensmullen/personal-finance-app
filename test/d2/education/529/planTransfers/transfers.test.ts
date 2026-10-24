import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { propose529PlanTransfers, type PlanClaim, type PlanTransferRequest, type TrusteeAcceptance } from "../../../../../src/simulation/d2/education/529/planTransfers/index.js";
import { propose529Distribution } from "../../../../../src/simulation/d2/education/529/index.js";
import { propose529RothTransfers } from "../../../../../src/simulation/d2/education/529/rothTransfer/index.js";
import type { EducationSource } from "../../../../../src/simulation/d2/education/529/types.js";
import { civilDate } from "../../../../../src/time/index.js";
import { Currency, money } from "../../../../../src/values/index.js";
import { catalogSchema } from "../../../../fixtures/d2/schema.js";

// Literal synthetic oracle; these thresholds/permissions assert no actual law.
const at = civilDate("2026-01-15"), opened = civilDate("2000-01-15"), later = civilDate("2020-02-01");
const source = (sourceId: string, patch: Partial<EducationSource> = {}): EducationSource => ({ sourceId,
  sourcePublication: "Independent synthetic evidence; not actual law", publishedAt: civilDate("1999-01-01"),
  asOf: at, start: civilDate("1999-01-01"), endExclusive: civilDate("2030-01-01"), ruleSnapshotId: "synthetic-continuation",
  ruleFamily: "education_529", jurisdiction: "US", version: "v1", verification: "verified", projectionStatus: "verified",
  householdId: "hh", ownerId: "parent", beneficiaryId: "child", planId: "original", providerId: "original-trustee",
  currency: Currency.of("USD"), ...patch });
const receiving = (id: string, patch: Partial<EducationSource> = {}): EducationSource => source(id,
  { planId: "receiving", providerId: "receiving-trustee", ...patch });
const acceptance = (id: string, received = false): TrusteeAcceptance => ({ transferId: "provider-transfer", operationId: "transfer",
  claimId: "claim", sourceAccountId: "original-cash", destinationAccountId: "receiving-cash", originatingTrusteeId: "original-trustee",
  receivingTrusteeId: "receiving-trustee", sourceVersion: "v1", amount: money("1000.08"), status: "confirmed",
  source: received ? receiving(id) : source(id) });
const request = (): PlanTransferRequest => ({ operationId: "transfer", claimId: "claim", transferId: "provider-transfer",
  kind: "529_plan_to_plan", effectiveAt: at, knownAt: at, taxYear: 2026, currency: Currency.of("USD"), amount: money("1000.08"),
  plan: { householdId: "hh", ownerId: "parent", beneficiaryId: "child", planId: "original", providerId: "original-trustee",
    accountId: "original-wrapper", cashAccountId: "original-cash", taxBucket: "education_529", treatment: "ordinary_original_owner",
    stateJurisdiction: "US:state", localJurisdiction: "US:local", source: source("plan"), contributions: [
      { lotId: "old", basisId: "old-basis", fundingOperationId: "old-funding", fundedAt: opened, principal: money("600.04"), source: source("old-funding", { asOf: opened }) },
      { lotId: "later", basisId: "later-basis", fundingOperationId: "later-funding", fundedAt: later, principal: money("200.02"), source: source("later-funding", { asOf: later }) },
    ], distributions: [], snapshot: { at, taxYear: 2026, history: "complete_since_inception", currentValue: money("1000.08"),
      contributionBasis: money("800.06"), earnings: money("200.02"), unencumberedCash: money("1000.08"), source: source("snapshot") } },
  history: { openedAt: opened, beneficiarySince: opened, ageStart: opened, complete: "complete_since_inception", changes: [], source: source("history") },
  holdings: { holdingId: "underlying-holding", complete: "all_current_lots", form: "cash_at_par", source: source("holdings"), lots: [
    { lotId: "old", basisId: "old-basis", basis: money("600.04"), earnings: money("150.02"), source: source("old-current") },
    { lotId: "later", basisId: "later-basis", basis: money("200.02"), earnings: money("50.00"), source: source("later-current") },
  ] },
  destination: { householdId: "hh", ownerId: "parent", beneficiaryId: "child", planId: "receiving", providerId: "receiving-trustee",
    accountId: "receiving-wrapper", cashAccountId: "receiving-cash", taxBucket: "education_529", stateJurisdiction: "US:state",
    localJurisdiction: "US:local", route: "direct_trustee", eligible: "yes", source: receiving("destination") },
  originatingAcceptance: acceptance("original-acceptance"), receivingAcceptance: acceptance("receiving-acceptance", true),
  rules: { source: source("law"), treatment: "ordinary_direct_529_continuation", eligibleMaximum: money("1000.08"),
    electionWindow: { start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") }, sameYearEligibility: "verified",
    planAgeContinuity: "verified_preserved", rothEligibilityContinuity: "verified_preserved", allocation: "whole_plan", rounding: "half_even" },
  beneficiaryChange: null,
  jurisdictionPermissions: [
    { side: "original", level: "state", permitted: "yes", source: source("original-state", { jurisdiction: "US:state" }) },
    { side: "original", level: "local", permitted: "yes", source: source("original-local", { jurisdiction: "US:local" }) },
    { side: "receiving", level: "state", permitted: "yes", source: receiving("receiving-state", { jurisdiction: "US:state" }) },
    { side: "receiving", level: "local", permitted: "yes", source: receiving("receiving-local", { jurisdiction: "US:local" }) },
  ],
  claims: { at, complete: "all_household_plan_claims_including_pending", source: source("claims"), entries: [] },
  rothUsage: { at, completeness: "all_beneficiary_lifetime_transfers_and_annual_ira_including_pending", source: source("roth-usage"), entries: [] },
});
const amount = (r: PlanTransferRequest, value: string): PlanTransferRequest => ({ ...r, amount: money(value),
  originatingAcceptance: { ...r.originatingAcceptance, amount: money(value) }, receivingAcceptance: { ...r.receivingAcceptance, amount: money(value) } });
const partial = (): PlanTransferRequest => { const r = request(); return amount({ ...r, rules: { ...r.rules!, allocation: "per_lot_proportional" } }, "500.04"); };
const claim = (): PlanClaim => ({ householdId: "hh", ownerId: "parent", beneficiaryId: "child", planId: "original", providerId: "original-trustee",
  accountId: "original-wrapper", cashAccountId: "original-cash", taxBucket: "education_529",
  operationId: "earlier", claimId: "earlier-claim", transferId: "earlier-provider-transfer",
  kind: "plan_transfer", state: "pending_authorized", effectiveAt: at, amount: money("500.04"), basis: money("400.03"), earnings: money("100.01"),
  destinationAccountId: "other-plan", source: source("pending") });
const blocked = (r: PlanTransferRequest, code: string): void => {
  const result = propose529PlanTransfers([r]);
  expect(result.proposals).toEqual([]);
  expect(result.coverage).toHaveLength(10);
  expect(result.coverage.every(c => c.coverage === "incomplete" && c.diagnosticCode === code)).toBe(true);
};

describe("B3-3 ordinary 529 continuation: PFA-DET-022 §5.7 / S1–S8", () => {
  it("moves the complete multi-lot value once, conserving basis, earnings and original dates", () => {
    const r = request(), before = JSON.stringify(r), result = propose529PlanTransfers([r]), p = result.proposals[0]!;
    expect(result.proposals).toHaveLength(1);
    expect(p.grossAmount.equals(money("1000.08"))).toBe(true);
    expect(p.basis.equals(money("800.06"))).toBe(true); expect(p.earnings.equals(money("200.02"))).toBe(true);
    expect(p.sourcePlanAssetDelta.equals(money("-1000.08"))).toBe(true);
    expect(p.destinationPlanAssetDelta.equals(money("1000.08"))).toBe(true);
    for (const m of [p.remainingSourceValue, p.remainingSourceBasis, p.remainingSourceEarnings, p.ownedBankCashDelta,
      p.consumptionExpenseDelta, p.movementNetWorthDelta, p.sourcePlanAssetDelta.plus(p.destinationPlanAssetDelta)]) expect(m.isZero()).toBe(true);
    expect(p.lots.map(l => [l.lotId, l.fundedAt, l.transferredBasis.amount.toString(), l.transferredEarnings.amount.toString()])).toEqual([
      ["later", later, "200.02", "50"], ["old", opened, "600.04", "150.02"],
    ]);
    expect(p.preservedHistory.ageStart).toBe(opened); expect(p.transferKey).toBe('["hh","original-wrapper","provider-transfer"]');
    expect(p.committed).toBe(false); expect(p.postable).toBe(false); expect(p.physicalTransfer).toBe("not_applied");
    expect(p).not.toHaveProperty("taxLiability"); expect(p).not.toHaveProperty("proposedCapacity");
    expect(result.coverage.filter(c => c.coverage === "complete").map(c => c.affectedOutput)).toEqual(["eligibility", "basis_earnings", "continuity"]);
    expect(JSON.stringify(r)).toBe(before); expect(Object.isFrozen(r.plan)).toBe(false);
    expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(p.fundingProof.holdings.lots[0])).toBe(true);
  });
  it("uses separately supplied proportional rounding for a partial transfer with exact literal end balances", () => {
    const p = propose529PlanTransfers([partial()]).proposals[0]!;
    expect(p.basis.equals(money("400.03"))).toBe(true); expect(p.earnings.equals(money("100.01"))).toBe(true);
    expect(p.remainingSourceValue.equals(money("500.04"))).toBe(true);
    expect(p.remainingSourceBasis.equals(money("400.03"))).toBe(true); expect(p.remainingSourceEarnings.equals(money("100.01"))).toBe(true);
    expect(p.lots.map(l => [l.lotId, l.transferredBasis.amount.toString(), l.transferredEarnings.amount.toString()])).toEqual([
      ["later", "100.01", "25"], ["old", "300.02", "75.01"],
    ]);
    for (const l of p.lots) {
      expect(l.transferredBasis.plus(l.remainingBasis).equals(l.originalBasis)).toBe(true);
      expect(l.transferredEarnings.plus(l.remainingEarnings).equals(l.originalEarnings)).toBe(true);
    }
    blocked(amount(request(), "500.04"), "SOURCED_PARTIAL_ALLOCATION_REQUIRED");
    blocked(amount(partial(), "0.02"), "SOURCED_RESIDUAL_ALLOCATION_REQUIRED");
  });
  it("requires the owner, beneficiary, provider and exact original and receiving acceptances", () => {
    const r = request();
    blocked({ ...r, destination: { ...r.destination, ownerId: "wrong" } }, "OWNED_529_TRUSTEE_ROUTE_REQUIRED");
    blocked({ ...r, destination: { ...r.destination, beneficiaryId: "other" } }, "SOURCE_SCOPE_MISMATCH");
    blocked({ ...r, destination: { ...r.destination, providerId: "wrong" } }, "SOURCE_SCOPE_MISMATCH");
    for (const field of ["originatingAcceptance", "receivingAcceptance"] as const) {
      for (const patch of [{ status: "revoked" as const }, { originatingTrusteeId: "wrong" }, { receivingTrusteeId: "wrong" },
        { sourceVersion: "v2" }, { amount: money("1000.07") }, { transferId: "renamed" }])
        blocked({ ...r, [field]: { ...r[field], ...patch } }, "EXACT_TRUSTEE_ACCEPTANCE_REQUIRED");
      blocked({ ...r, [field]: undefined } as unknown as PlanTransferRequest, "TRUSTEE_ACCEPTANCE_REQUIRED");
    }
    blocked({ ...r, destination: { ...r.destination, route: "bank" } }, "OWNED_529_TRUSTEE_ROUTE_REQUIRED");
  });
  it("gates missing, future, stale, mixed-version, state/local and same-year legal evidence", () => {
    const r = request(); const { rules: _rules, ...missing } = r;
    blocked(missing, "SOURCED_TRANSFER_LAW_REQUIRED");
    for (const patch of [{ projectionStatus: "explicit_projected" as const }, { endExclusive: at },
      { publishedAt: civilDate("2026-01-16") }, { asOf: civilDate("2026-01-14") }])
      blocked({ ...r, rules: { ...r.rules!, source: source("law", patch) } }, "SOURCE_NOT_ADMITTED");
    blocked({ ...r, originatingAcceptance: { ...r.originatingAcceptance, source: source("snapshot", { version: "v2" }) } }, "CONFLICTING_SOURCE_VERSION");
    blocked({ ...r, jurisdictionPermissions: r.jurisdictionPermissions.slice(1) }, "JURISDICTION_PERMISSION_REQUIRED");
    blocked({ ...r, jurisdictionPermissions: r.jurisdictionPermissions.map(x => ({ ...x, permitted: "no" })) }, "JURISDICTION_TRANSFER_NOT_ADMITTED");
    blocked({ ...r, rules: { ...r.rules!, sameYearEligibility: "unknown" } }, "LEGAL_WINDOW_OR_SAME_YEAR_REQUIRED");
    blocked({ ...r, rules: { ...r.rules!, electionWindow: { start: opened, endExclusive: at } } }, "LEGAL_WINDOW_OR_SAME_YEAR_REQUIRED");
    for (const field of ["planAgeContinuity", "rothEligibilityContinuity"] as const)
      blocked({ ...r, rules: { ...r.rules!, [field]: "unknown" } }, "LEGAL_AGING_CONTINUITY_REQUIRED");
    blocked({ ...r, rules: { ...r.rules!, treatment: "unsupported" } }, "LEGAL_WINDOW_OR_SAME_YEAR_REQUIRED");
  });
  it("never invents cash, a sale, a lot, original age or statutory permission", () => {
    const r = request();
    blocked(amount(r, "1000.09"), "REQUEST_EXCEEDS_ELIGIBLE_UNENCUMBERED_FUNDS");
    blocked({ ...r, holdings: { ...r.holdings, form: "invested_or_inaccessible" } }, "ACCESSIBLE_CASH_HOLDINGS_REQUIRED");
    blocked({ ...r, history: { ...r.history, complete: "unknown" } }, "ORIGINAL_AGING_HISTORY_REQUIRED");
    blocked({ ...r, history: { ...r.history, ageStart: later } }, "BENEFICIARY_HISTORY_REQUIRED");
    blocked({ ...r, holdings: { ...r.holdings, lots: r.holdings.lots.slice(1) } }, "ORIGINAL_LOT_PARTITION_REQUIRED");
    blocked({ ...r, plan: { ...r.plan, contributions: r.plan.contributions.map(c => ({ ...c, principal: money("1") })) } }, "BASIS_HISTORY_NOT_RECONCILED");
    blocked({ ...r, kind: "529_beneficiary_roth_direct_trustee_transfer" as PlanTransferRequest["kind"] }, "UNSUPPORTED_TRANSFER_PROFILE");
  });
  it("subtracts all pending source claims and rejects replay through renamed request IDs", () => {
    const r = partial(), c = claim();
    expect(propose529PlanTransfers([{ ...r, claims: { ...r.claims, entries: [c] } }]).proposals).toHaveLength(1);
    blocked({ ...amount(r, "500.05"), claims: { ...r.claims, entries: [c] } }, "REQUEST_EXCEEDS_ELIGIBLE_UNENCUMBERED_FUNDS");
    blocked({ ...r, claims: { ...r.claims, entries: [{ ...c, transferId: r.transferId }] } }, "DUPLICATE_TRANSFER_CLAIM");
    blocked({ ...r, claims: { ...r.claims, complete: "unknown" } }, "COMPLETE_CLAIM_REGISTER_REQUIRED");
    blocked({ ...r, claims: { ...r.claims, entries: [c, c] } }, "DUPLICATE_OR_MISSING_ID");
    blocked({ ...r, rothUsage: { ...r.rothUsage, completeness: "unknown" } }, "LIFETIME_ELIGIBILITY_HISTORY_REQUIRED");
  });
  it("fails competing source requests atomically with no iteration priority", () => {
    const a = partial(), b = { ...a, operationId: "other", claimId: "other-claim", transferId: "other-transfer" };
    const forward = propose529PlanTransfers([a, b]), reverse = propose529PlanTransfers([b, a]);
    expect(forward).toEqual(reverse); expect(forward.proposals).toEqual([]);
    expect(forward.coverage.every(c => c.diagnosticCode === "SHARED_SOURCE_REQUIRES_ATOMIC_OWNER")).toBe(true);
    expect(propose529PlanTransfers([a, { ...a, operationId: "renamed" }]).proposals).toEqual([]);
  });
  it("keeps immutable output and transfer identity stable under reordered independent evidence", () => {
    const r = partial(), reverse = { ...r, plan: { ...r.plan, contributions: [...r.plan.contributions].reverse() },
      holdings: { ...r.holdings, lots: [...r.holdings.lots].reverse() }, jurisdictionPermissions: [...r.jurisdictionPermissions].reverse() };
    expect(propose529PlanTransfers([reverse])).toEqual(propose529PlanTransfers([r]));
  });
  it("reconciles posted history once and carries prior Roth lifetime use without refreshing capacity", () => {
    const r = request(), previousAt = civilDate("2025-01-01");
    const prior: PlanClaim = { ...claim(), kind: "roth_transfer", state: "posted", effectiveAt: previousAt,
      amount: money("100"), basis: money("80"), earnings: money("20"), source: source("prior-roth") };
    // Original funded basis was 880.06; 80 already recovered leaves the current 800.06.
    const changed: PlanTransferRequest = { ...r, plan: { ...r.plan, contributions: r.plan.contributions.map(c =>
      c.lotId === "old" ? { ...c, principal: money("680.04") } : c) }, claims: { ...r.claims, entries: [prior] },
      rothUsage: { ...r.rothUsage, entries: [{ operationId: prior.operationId, claimId: prior.claimId, kind: "529_roth_transfer",
        beneficiaryId: "child", ownerId: "parent", planId: "original", providerId: "original-trustee", destinationAccountId: prior.destinationAccountId,
        taxYear: 2025, effectiveAt: previousAt, state: "posted", amount: money("100"), basis: money("80"), earnings: money("20"), source: source("roth-lifetime-entry") }] } };
    const p = propose529PlanTransfers([changed]).proposals[0]!;
    expect(p.basis.equals(money("800.06"))).toBe(true);
    expect(p.preservedRothUsage.entries[0]!.amount.equals(money("100"))).toBe(true);
    expect(p.preservedRothUsage.entries[0]!.claimId).toBe(prior.claimId);
    blocked({ ...changed, rothUsage: { ...changed.rothUsage, entries: [] } }, "ROTH_CLAIM_CONFLICT");
    blocked({ ...changed, claims: { ...changed.claims, entries: [] } }, "ROTH_CLAIM_CONFLICT");
  });
  it("admits a beneficiary change only with separate exact law/plan permissions and verified history", () => {
    const r = request(), scope = { beneficiaryId: "new-child" };
    const changed: PlanTransferRequest = { ...r, kind: "529_plan_to_plan_beneficiary_change",
      destination: { ...r.destination, ...scope, source: receiving("destination", scope) },
      receivingAcceptance: { ...r.receivingAcceptance, source: receiving("receiving-acceptance", scope) },
      jurisdictionPermissions: r.jurisdictionPermissions.map(x => x.side === "receiving" ? { ...x, source: { ...x.source, ...scope } } : x),
      beneficiaryChange: { changeId: "change", fromBeneficiaryId: "child", toBeneficiaryId: "new-child", legalPermission: "yes", planPermission: "yes",
        source: source("beneficiary-law"), planSource: receiving("beneficiary-plan", scope) } };
    const p = propose529PlanTransfers([changed]).proposals[0]!;
    expect(p.destinationPlan.beneficiaryId).toBe("new-child"); expect(p.beneficiaryChange!.fromBeneficiaryId).toBe("child");
    expect(p.preservedHistory.ageStart).toBe(opened); expect(p.lots[0]!.fundedAt).toBe(later);
    blocked({ ...changed, beneficiaryChange: null }, "BENEFICIARY_PERMISSION_REQUIRED");
    blocked({ ...changed, beneficiaryChange: { ...changed.beneficiaryChange!, legalPermission: "unknown" } }, "BENEFICIARY_PERMISSION_REQUIRED");
    blocked({ ...changed, rules: { ...changed.rules!, rothEligibilityContinuity: "unknown" } }, "LEGAL_AGING_CONTINUITY_REQUIRED");
  });
  it("consumes unchanged B3-1/B3-2 public seams and preserves their fixture assertions", () => {
    expect(typeof propose529Distribution).toBe("function"); expect(typeof propose529RothTransfers).toBe("function");
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    const cases = catalog.cases.filter(c => c.family === "education_529");
    expect(cases).toHaveLength(6);
    for (const c of cases) { expect(c.expected.capability).toBe("decision_required"); expect(c.expected.integratedRuntimeEvidence).toBe(false); }
    expect(cases.find(c => c.id === "529_qualified")!.input.amounts.contributedBasisCents).toBe("80000");
  });
});
