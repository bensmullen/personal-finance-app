import { civilDate } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import type { EducationSource } from "../../../../src/simulation/d2/education/529/types.js";
import type { IraCapacity, RothTransferRequest } from "../../../../src/simulation/d2/education/529/rothTransfer/index.js";
import { ids } from "./combinedScenario.js";

/** Independent documentary eligibility only. These are not kernel assets. */
export function conditional529(): RothTransferRequest {
  const at = civilDate("2026-01-24"), opened = civilDate("2000-01-01");
  const source = (sourceId: string, patch: Partial<EducationSource> = {}): EducationSource => ({
    sourceId: `s8-3:529:${sourceId}`, sourcePublication: "Synthetic joint-household eligibility only; not statutory law",
    publishedAt: civilDate("1999-01-01"), asOf: at, start: civilDate("1999-01-01"), endExclusive: civilDate("2030-01-01"),
    ruleSnapshotId: "s8-3:529-law", ruleFamily: "education_529", jurisdiction: "US", version: "v1",
    verification: "verified", projectionStatus: "verified", householdId: ids.household, ownerId: ids.member,
    beneficiaryId: ids.other, planId: "s8-3:529-plan", providerId: "s8-3:529-provider", currency: USD, ...patch,
  });
  const capacity = (kind: IraCapacity["limitScope"]["kind"]): IraCapacity => ({ personId: ids.other, taxYear: 2026,
    limitScope: { kind, aggregationId: "person" }, ruleSnapshotId: kind, maximum: money("500"), used: money("0"),
    asOf: at, completeness: "complete", source: source(kind, { ruleSnapshotId: kind,
      start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") }), usageSource: source(`${kind}:usage`) });
  return { operationId: "s8-3:529-transfer", claimId: "s8-3:529-claim", kind: "529_beneficiary_roth_direct_trustee_transfer",
    effectiveAt: at, knownAt: at, taxYear: 2026, currency: USD, amount: money("200"),
    plan: { householdId: ids.household, ownerId: ids.member, beneficiaryId: ids.other, planId: "s8-3:529-plan", providerId: "s8-3:529-provider",
      accountId: "s8-3:529-container", cashAccountId: "s8-3:529-cash", taxBucket: "education_529", treatment: "ordinary_original_owner",
      stateJurisdiction: "US:synthetic", localJurisdiction: "US:synthetic:local", source: source("plan"),
      contributions: [{ lotId: "s8-3:529-lot", basisId: "s8-3:529-basis", fundingOperationId: "s8-3:529-funded", fundedAt: opened,
        principal: money("800"), source: source("funding") }], distributions: [], snapshot: { at, taxYear: 2026,
        history: "complete_since_inception", currentValue: money("1000"), contributionBasis: money("800"), earnings: money("200"),
        unencumberedCash: money("1000"), source: source("snapshot") } },
    history: { openedAt: opened, beneficiarySince: opened, ageStart: opened, complete: "complete_since_inception", changes: [], source: source("history") },
    rules: { source: source("law"), treatment: "direct_trustee_beneficiary_roth", minimumPlanAgeYears: 10,
      ageStartPermission: "original_opening", recentFrom: civilDate("2021-01-24"), recentTreatment: "exclude_contributions_and_allocable_earnings",
      lifetimeMaximum: money("1000"), annualCapacityRuleSnapshotId: "ira_annual", compensationRuleSnapshotId: "ira_compensation" },
    holdings: { holdingId: "s8-3:529-holding", complete: "all_current_lots", source: source("holdings"), lots: [
      { lotId: "s8-3:529-lot", basisId: "s8-3:529-basis", basis: money("800"), earnings: money("200"), source: source("lot") }] },
    destination: { accountId: "s8-3:beneficiary-roth", ownerId: ids.other, householdId: ids.household, taxBucket: "roth_ira",
      trusteeId: "s8-3:trustee", receivingTrusteeId: "s8-3:trustee", route: "direct_trustee", source: source("destination") },
    authorization: { permitted: "yes", operationId: "s8-3:529-transfer", claimId: "s8-3:529-claim", holdingId: "s8-3:529-holding",
      sourceAccountId: "s8-3:529-cash", destinationAccountId: "s8-3:beneficiary-roth", receivingTrusteeId: "s8-3:trustee",
      amount: money("200"), source: source("authorization") },
    usage: { at, completeness: "all_beneficiary_lifetime_transfers_and_annual_ira_including_pending", source: source("usage"), entries: [] },
    annualCapacity: capacity("ira_annual"), compensationCapacity: capacity("ira_compensation") };
}
