import { distributionOriginalDigest, type DistributionBinding, type DistributionOriginal, type DistributionOriginalPorts,
  type OriginalPayloads, type OriginalRole, type OriginalPin, type DistributionIdentity, type DistributionEvent } from "../../../../../src/simulation/d2/education/529/distributionOriginalBinding/index.js";
import type { EducationSource } from "../../../../../src/simulation/d2/education/529/types.js";
import { civilDate } from "../../../../../src/time/index.js";
import { Currency, money } from "../../../../../src/values/index.js";

export const at = civilDate("2026-01-15"), fundedAt = civilDate("2025-01-01"), paidAt = civilDate("2026-01-05");
export const allRoles = ["plan", "funding", "law", "usage", "trustee", "route", "tuition", "adjustments", "payment"] as const;
export type Originals = { [K in OriginalRole]: DistributionOriginal<K> };
export const pin = <K extends OriginalRole>(o: DistributionOriginal<K>): OriginalPin => ({
  producerId: o.producerId, sourceId: o.sourceId, version: o.version, digest: distributionOriginalDigest(o),
});

/** Fictional independent producers. No real IRS, custodian, university or BANK
 * connection is claimed. Expected cents are literal independent test oracles. */
export function fixture(suffix = "000", kind: DistributionEvent["kind"] = "qualified_distribution", direct = false) {
  const tag = (s: string): string => `${s}-${suffix}`;
  const source = (name: string, asOf = at): EducationSource => ({ sourceId: tag(name),
    sourcePublication: "RAW_ORIGINAL_MARKER fictional producer document " + "x".repeat(512),
    publishedAt: civilDate("2024-01-01"), asOf, start: civilDate("2020-01-01"), endExclusive: civilDate("2030-01-01"),
    ruleSnapshotId: "synthetic-law-1", ruleFamily: "education_529", jurisdiction: "US", version: "v1",
    verification: "verified", projectionStatus: "verified", householdId: "household", ownerId: "parent", beneficiaryId: "child",
    planId: tag("plan"), providerId: tag("custodian"), currency: Currency.of("USD") });
  const qualified = kind === "qualified_distribution";
  const identity: DistributionIdentity = { householdId: "household", ownerId: "parent", beneficiaryId: "child",
    planId: tag("plan"), providerId: tag("custodian"), planAccountId: tag("container"), sourceAccountId: tag("plan-cash"),
    destinationAccountId: direct ? tag("institution-account") : "owned-bank", payeeId: direct ? "bursar" : "parent",
    tuition: qualified ? { paidExpenseId: tag("paid-expense"), economicExpenseId: tag("economic-expense"),
      studentId: "student-record", institutionId: "university", termId: "spring-2026" } : null };
  const event: DistributionEvent = { eventId: tag("event"), operationId: tag("distribution"), claimId: tag("claim"),
    kind, effectiveAt: at, cutoff: at, taxYear: 2026, gross: money("1000.03") };
  const bill: OriginalPayloads["tuition"]["bills"][number] = { expenseId: tag("bill"), paidExpenseId: tag("paid-expense"),
    beneficiaryId: "child", studentId: "student-record", institutionId: "university", payeeId: "bursar", termId: "spring-2026",
    ownerRelationship: "parent", category: "postsecondary_tuition", taxYear: 2026, incurredAt: civilDate("2026-01-01"),
    paidAt: direct ? null : paidAt, payerId: "parent", payerAccountId: direct ? tag("plan-cash") : "owned-bank",
    paymentMethod: direct ? "direct_plan_payment" : "bank_paid", billed: money("2000.09"), eligibleBilled: money("2000.09"), source: source("bill") };
  const payloads: OriginalPayloads = {
    plan: { complete: "all_current_lots", lots: [{ lotId: tag("lot"), basisId: tag("basis"), basis: money("6000"), earnings: money("4000") }],
      plan: { householdId: "household", ownerId: "parent", beneficiaryId: "child", planId: tag("plan"), providerId: tag("custodian"),
        accountId: tag("container"), cashAccountId: tag("plan-cash"), taxBucket: "education_529", treatment: "ordinary_original_owner",
        stateJurisdiction: "US:synthetic", localJurisdiction: "US:synthetic:local", source: source("plan"),
        contributions: [{ lotId: tag("lot"), basisId: tag("basis"), fundingOperationId: tag("contribution"),
          fundedAt, principal: money("6000"), source: source("contribution", fundedAt) }], distributions: [],
        snapshot: { at, taxYear: 2026, currentValue: money("10000"), contributionBasis: money("6000"), earnings: money("4000"),
          unencumberedCash: money("3000"), history: "complete_since_inception", source: source("snapshot") } } },
    funding: { complete: "since_inception", entries: [{ lotId: tag("lot"), basisId: tag("basis"), operationId: tag("contribution"), fundedAt,
      householdId: "household", ownerId: "parent", bankAccountId: "funding-bank", accountKind: "BANK", planCashAccountId: tag("plan-cash"),
      status: "posted", bankDebit: money("6000"), planCredit: money("6000") }] },
    tuition: { complete: "all_receipts", bills: [bill] },
    adjustments: { complete: "all_adjustments_and_benefits", entries: [{ paidExpenseId: tag("paid-expense"),
      adjustedEligible: money("2000.09"), unreimbursedUse: "verified", adjustments: [] }] },
    payment: { complete: "all_payments_and_recognition", entries: [{ paidExpenseId: tag("paid-expense"), economicExpenseId: tag("economic-expense"),
      studentId: "student-record", institutionId: "university", payeeId: "bursar", termId: "spring-2026",
      payment: direct ? null : { operationId: tag("bank-payment"), status: "posted", accountKind: "BANK", accountId: "owned-bank",
        payerId: "parent", paidAt, amount: money("2000.09") },
      recognition: { economicExpenseId: tag("economic-expense"), status: direct ? "unrecognized" : "already_recognized", source: source("recognition") },
      unpaidClaim: direct ? { claimId: tag("institution-claim"), outstanding: money("2000.09"), source: source("institution-claim") } : null }] },
    law: { rules: { source: source("law"), expenseCategory: "postsecondary_tuition", qualifiedTreatment: "earnings_excluded",
      nonqualifiedTreatment: "earnings_income_basis_return", allocation: "current_plan_aggregate_earnings_over_value",
      earningsRounding: "half_up", expenseYear: "paid_year_or_direct_payment_event" },
      qualification: qualified ? { at, beneficiaryId: "child", studentId: "student-record", institutionId: "university", termId: "spring-2026",
        categoryEligible: "yes", source: source("qualification") } : null },
    usage: { complete: "all_household_education_uses_including_pending", at, source: source("usage"), entries: [] },
    trustee: { authorization: { permitted: "yes", operationId: event.operationId, claimId: event.claimId,
      destinationAccountId: identity.destinationAccountId, gross: money("1000.03"), source: source("trustee") } },
    route: { accountKind: direct ? "institution" : "BANK", payeeId: direct ? "bursar" : "parent",
      route: direct ? { kind: "institution", accountId: tag("institution-account"), institutionId: "university", payeeId: "bursar", source: source("route") }
        : { kind: "owned_bank", accountId: "owned-bank", ownerId: "parent", householdId: "household", observedAt: at,
          openingCash: money("50.01"), source: source("route") } },
  };
  const original = <K extends OriginalRole>(role: K): DistributionOriginal<K> => ({ role, producerId: `${role}-independent-producer`,
    sourceId: tag(`${role}-original`), version: "v1", status: "active", issuedAt: at, publishedAt: at, knownAt: at, asOf: at,
    start: civilDate("2020-01-01"), endExclusive: civilDate("2030-01-01"), identity, event, payload: payloads[role] });
  const originals: Originals = { plan: original("plan"), funding: original("funding"), tuition: original("tuition"),
    adjustments: original("adjustments"), payment: original("payment"), law: original("law"), usage: original("usage"),
    trustee: original("trustee"), route: original("route") };
  const binding: DistributionBinding = { identity, event, originals: Object.fromEntries(
    (qualified ? allRoles : allRoles.slice(0, 6)).map(role => [role, pin(originals[role])])) };
  const counts = new Map<OriginalRole, number>();
  const get = <K extends OriginalRole>(role: K): DistributionOriginal<K> => {
    counts.set(role, (counts.get(role) ?? 0) + 1); return originals[role];
  };
  const ports: DistributionOriginalPorts = { plan: () => get("plan"), funding: () => get("funding"), law: () => get("law"), usage: () => get("usage"),
    trustee: () => get("trustee"), route: () => get("route"), tuition: () => get("tuition"), adjustments: () => get("adjustments"), payment: () => get("payment") };
  return { originals, binding, counts, ports, source };
}
export type Fixture = ReturnType<typeof fixture>;
/** Re-pin a changed original to test its facts, rather than only a digest mismatch. */
export function replace<K extends OriginalRole>(f: Fixture, role: K, change: (o: DistributionOriginal<K>) => DistributionOriginal<K>): void {
  f.originals = { ...f.originals, [role]: change(f.originals[role]) };
  f.binding = { ...f.binding, originals: { ...f.binding.originals, [role]: pin(f.originals[role]) } };
}
