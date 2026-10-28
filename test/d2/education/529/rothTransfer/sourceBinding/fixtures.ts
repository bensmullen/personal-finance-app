import type { EducationSource } from "../../../../../../src/simulation/d2/education/529/types.js";
import type { IraCapacity, RothTransferRequest as Request } from "../../../../../../src/simulation/d2/education/529/rothTransfer/index.js";
import { rothOriginalDigest, type RothOriginal, type RothOriginalRole, type RothOriginalPayloads,
  type RothOriginalPorts, type RothSourceBinding } from "../../../../../../src/simulation/d2/education/529/rothTransfer/sourceBinding/index.js";
import { civilDate } from "../../../../../../src/time/index.js";
import { Currency, money } from "../../../../../../src/values/index.js";

export const at = civilDate("2026-01-15"), opened = civilDate("2000-01-15");
/** Independently authored exact-cent oracle matching the supported B3 fixture economics.
 * Synthetic law and fictional records only; no statutory values or production capacity. */
export function request(suffix = "000"): Request {
  const tag = (s: string): string => `${s}-${suffix}`;
  const source = (name: string, patch: Partial<EducationSource> = {}): EducationSource => ({
    sourceId: tag(name), sourcePublication: "RAW_ORIGINAL_MARKER synthetic source publication", publishedAt: civilDate("1999-01-01"),
    asOf: at, start: civilDate("1999-01-01"), endExclusive: civilDate("2030-01-01"),
    ruleSnapshotId: "synthetic-529-roth", ruleFamily: "education_529", jurisdiction: "US", version: "v1",
    verification: "verified", projectionStatus: "verified", householdId: tag("hh"), ownerId: tag("parent"),
    beneficiaryId: tag("child"), planId: tag("plan"), providerId: "529-provider", currency: Currency.of("USD"), ...patch,
  });
  const capacity = (kind: IraCapacity["limitScope"]["kind"], maximum: string): IraCapacity => ({
    personId: tag("child"), taxYear: 2026, limitScope: { kind, aggregationId: "person" }, ruleSnapshotId: kind,
    maximum: money(maximum), used: money("100.02"), asOf: at, completeness: "complete",
    source: source(kind, { ruleSnapshotId: kind, start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") }),
    usageSource: source(`${kind}-usage`),
  });
  return {
    operationId: tag("transfer"), claimId: tag("claim"), kind: "529_beneficiary_roth_direct_trustee_transfer",
    effectiveAt: at, knownAt: at, taxYear: 2026, currency: Currency.of("USD"), amount: money("350.01"),
    plan: { householdId: tag("hh"), ownerId: tag("parent"), beneficiaryId: tag("child"), planId: tag("plan"), providerId: "529-provider",
      accountId: tag("container"), cashAccountId: tag("cash"), taxBucket: "education_529", treatment: "ordinary_original_owner",
      stateJurisdiction: "US:synthetic", localJurisdiction: "US:synthetic:local", source: source("plan"),
      contributions: [
        { lotId: tag("old"), basisId: tag("old-basis"), fundingOperationId: tag("old-funding"), fundedAt: opened, principal: money("600.03"), source: source("old-funding") },
        { lotId: tag("recent"), basisId: tag("recent-basis"), fundingOperationId: tag("recent-funding"), fundedAt: civilDate("2025-01-01"), principal: money("200.02"), source: source("recent-funding") },
      ], distributions: [], snapshot: { at, taxYear: 2026, history: "complete_since_inception", currentValue: money("1000.05"),
        contributionBasis: money("800.05"), earnings: money("200"), unencumberedCash: money("900"), source: source("snapshot") } },
    history: { openedAt: opened, beneficiarySince: opened, ageStart: opened, complete: "complete_since_inception", changes: [], source: source("history") },
    rules: { source: source("law"), treatment: "direct_trustee_beneficiary_roth", minimumPlanAgeYears: 10, ageStartPermission: "original_opening",
      recentFrom: civilDate("2021-01-15"), recentTreatment: "exclude_contributions_and_allocable_earnings", lifetimeMaximum: money("1000"),
      annualCapacityRuleSnapshotId: "ira_annual", compensationRuleSnapshotId: "ira_compensation" },
    holdings: { holdingId: tag("holding"), complete: "all_current_lots", source: source("holdings"), lots: [
      { lotId: tag("old"), basisId: tag("old-basis"), basis: money("600.03"), earnings: money("150.02"), source: source("old-current") },
      { lotId: tag("recent"), basisId: tag("recent-basis"), basis: money("200.02"), earnings: money("49.98"), source: source("recent-current") },
    ] },
    destination: { accountId: tag("roth"), ownerId: tag("child"), householdId: tag("hh"), taxBucket: "roth_ira", trusteeId: "trustee",
      receivingTrusteeId: "trustee", route: "direct_trustee", source: source("destination") },
    authorization: { permitted: "yes", operationId: tag("transfer"), claimId: tag("claim"), holdingId: tag("holding"), sourceAccountId: tag("cash"),
      destinationAccountId: tag("roth"), receivingTrusteeId: "trustee", amount: money("350.01"), source: source("authorization") },
    usage: { at, completeness: "all_beneficiary_lifetime_transfers_and_annual_ira_including_pending", source: source("usage"), entries: [
      { operationId: tag("previous"), claimId: tag("previous-claim"), kind: "529_roth_transfer", beneficiaryId: tag("child"),
        ownerId: "other-owner", planId: "other-plan", providerId: "other-provider", destinationAccountId: "other-roth",
        taxYear: 2025, effectiveAt: civilDate("2025-01-01"), state: "posted", amount: money("600.04"), basis: money("400"), earnings: money("200.04"),
        source: source("previous", { ownerId: "other-owner", planId: "other-plan", providerId: "other-provider" }) },
      { operationId: tag("regular"), claimId: tag("regular-claim"), kind: "regular_ira_contribution", beneficiaryId: tag("child"),
        ownerId: tag("child"), planId: "ira", providerId: "ira-provider", destinationAccountId: tag("roth"),
        taxYear: 2026, effectiveAt: civilDate("2026-01-05"), state: "posted", amount: money("100.02"), basis: money("0"), earnings: money("0"),
        source: source("regular", { ownerId: tag("child"), planId: "ira", providerId: "ira-provider" }) },
    ] }, annualCapacity: capacity("ira_annual", "500.07"), compensationCapacity: capacity("ira_compensation", "450.03"),
  };
}
export function fixture(r = request()) {
  const identity = { householdId: r.plan.householdId, ownerId: r.plan.ownerId, beneficiaryId: r.plan.beneficiaryId,
    planId: r.plan.planId, providerId: r.plan.providerId, planAccountId: r.plan.accountId, sourceAccountId: r.plan.cashAccountId,
    holdingId: r.holdings.holdingId, destinationAccountId: r.destination.accountId, receivingTrusteeId: r.destination.receivingTrusteeId };
  const event = { eventId: `event-${r.operationId}`, operationId: r.operationId, claimId: r.claimId,
    effectiveAt: r.effectiveAt, knownAt: r.knownAt, taxYear: r.taxYear };
  const original = <K extends RothOriginalRole>(role: K, payload: RothOriginalPayloads[K]): RothOriginal<K> => ({
    role, providerId: role === "annual" || role === "compensation" ? "independent-ira-producer" : `${role}-producer`,
    sourceId: `${role}-${r.operationId}`, version: "v1", status: "active", publishedAt: at, cutoff: at, identity, event, payload,
  });
  const originals = {
    plan: original("plan", { plan: r.plan, history: r.history, holdings: r.holdings }),
    trustee: original("trustee", { destination: r.destination, authorization: r.authorization }),
    law: original("law", { rules: r.rules! }),
    annual: original("annual", { capacity: r.annualCapacity, usage: r.usage }),
    compensation: original("compensation", { capacity: r.compensationCapacity, usage: r.usage }),
  };
  const pin = <K extends RothOriginalRole>(o: RothOriginal<K>) => ({ providerId: o.providerId, sourceId: o.sourceId,
    version: o.version, digest: rothOriginalDigest(o) });
  const binding: RothSourceBinding = { identity, event, originals: { plan: pin(originals.plan), trustee: pin(originals.trustee),
    law: pin(originals.law), annual: pin(originals.annual), compensation: pin(originals.compensation) } };
  const ports: RothOriginalPorts = { plan: () => originals.plan, trustee: () => originals.trustee,
    law: () => originals.law, annual: () => originals.annual, compensation: () => originals.compensation };
  return { binding, ports, originals };
}
