import { eeOriginalIdentity, eeRequestDigest, type EEBinding, type EEOriginal } from "../../../../src/simulation/d2/fixedIncome/seriesEE/sourceBinding/index.js";
import type { EERequest, EESource } from "../../../../src/simulation/d2/fixedIncome/seriesEE/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { decimal, money, RoundingPolicy } from "../../../../src/values/index.js";

import { cutoff, rawMarker, householdId, personId } from "./household.js";

// Independently authored illustrative evidence; none of these are Treasury terms.
const month = (n: number) => civilDate(`2026-${String(n + 1).padStart(2, "0")}-01`);
const publication = `Synthetic EE issuer illustration; NOT Treasury terms ${rawMarker}`;
const source = (id: string, jurisdiction = "US"): EESource => ({ sourceId: id, ruleSnapshotId: `${id}:law`,
  ruleFamily: "series_ee", sourcePublication: publication, authority: "externally_verified", version: "illustration-1",
  publishedAt: month(0), asOf: month(0), jurisdiction, start: month(0), endExclusive: civilDate("2028-01-01"), projectionStatus: "verified" });
export const original = (id = "000"): EEOriginal => {
  const s = source(`evidence:${id}`);
  const request: EERequest = {
    lot: { householdId, personId, beneficiaryId: personId, holdingId: `holding:${id}`,
      bondId: `bond:${id}`, lotId: `lot:${id}`, basisId: `basis:${id}`, wrapperId: "wrapper", taxBucket: "taxable",
      stateJurisdiction: "US:STATE", localJurisdiction: "US:STATE:CITY", fundingAccountId: "purchase-bank",
      destination: { accountId: "wrapper-cash", personId, wrapperId: "wrapper", kind: "wrapper_cash" },
      issueMonth: month(0), purchaseDate: month(0), acquisitionDate: month(0), face: money("200"), purchaseCost: money("100"),
      acquisitionCost: money("100"), treatment: "ordinary_original_owner", source: s,
      opening: { at: month(0), carrying: money("100"), purchaseBasis: money("100"), recognizedFederalInterest: money("0"),
        election: "redemption", redeemed: false, source: s } },
    period: { start: month(0), endExclusive: month(4) }, effectiveAt: month(3), knownAt: cutoff, action: "redemption",
    rule: { issueMonth: month(0), source: s, method: "fixed_issue_schedule", posting: "monthly_interest_rounded_then_capitalized",
      interestRounding: new RoundingPolicy(2, "half_up"), capitalizationMonths: 1, stopAccruingAt: month(11),
      firstRedeemableAt: month(1), penalty: { endExclusive: month(1), forfeitureMonths: 1, treatment: "last_monthly_interest_only" },
      guarantee: null, schedule: Array.from({ length: 11 }, (_, i) => ({ start: month(i), endExclusive: month(i + 1),
        periodRate: decimal("0.01"), capitalize: true, source: s })) },
    taxRules: ["US", "US:STATE", "US:STATE:CITY"].map(jurisdiction => ({ source: source(`tax:${id}:${jurisdiction}`, jurisdiction),
      issueMonth: month(0), election: "redemption", treatment: jurisdiction === "US" ? "federal_interest_less_previously_recognized" : "state_local_exempt" })),
    redemptionQuote: { quoteId: `quote:${id}`, at: month(3), amount: money("103.03"), source: { ...s, asOf: month(3) } },
  };
  return { sourceId: `publisher:${id}`, version: "original-1", status: "active", request };
};
export const pin = (o: EEOriginal, occurrenceId = o.sourceId): EEBinding => ({ occurrenceId, sourceId: o.sourceId,
  sourceVersion: o.version, digest: eeRequestDigest(o.request), identity: eeOriginalIdentity(o.request.lot),
  action: o.request.action, effectiveAt: o.request.effectiveAt, knownAt: o.request.knownAt, period: o.request.period });
