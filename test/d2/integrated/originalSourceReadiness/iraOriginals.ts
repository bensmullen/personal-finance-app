import { civilDate, type CivilDate } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { type IraOriginalReturnProvenance, type IraRules, type IraSource, type IraYearInput } from "../../../../src/simulation/d2/retirement/conversions/index.js";
import { type IraOriginalReturnHistory, type IraOriginalReturnProvider, type IraYearChainInput } from "../../../../src/simulation/d2/retirement/conversions/yearChain/index.js";

import { cutoff, rawMarker } from "./household.js";
export { cutoff };
export const publication = `Synthetic independent filing registry; NOT IRS evidence ${rawMarker}`;
export const source = (id: string, year: number, accountId: string | null = null,
  asOf: CivilDate = civilDate(`${year + 1}-04-01`)): IraSource => ({
  sourceId: id, sourcePublication: publication, personId: "person", accountId, taxYear: year,
  asOf, ruleSnapshotId: `synthetic-law:${year}`, verification: "verified", projectionStatus: "observed",
});
export const rules = (year: number): IraRules => ({
  source: source(`law:${year}`, year, null, civilDate(`${year}-01-01`)), jurisdiction: "US:synthetic", version: `v:${year}`,
  ruleFamily: "form_8606", effectivePeriod: { start: civilDate(`${year}-01-01`), endExclusive: civilDate(`${year + 1}-01-01`) },
  filingStatus: "synthetic_single", model: "aggregate_basis_over_year_end_plus_distributions", ratio: "exact_capped_at_one",
  annualRounding: "half_even", allocation: "largest_remainder_operation_id",
});
export const filing = (year: number, amount: string): IraOriginalReturnProvenance => ({
  personId: "person", taxYear: year, filingId: `original:${year}`, filingVersion: "1", filingKind: "original",
  filingStatus: "synthetic_single", filedAt: civilDate(`${year + 1}-04-01`), publishedAt: civilDate(`${year + 1}-04-01`),
  knownAt: civilDate(`${year + 1}-04-01`), revisesFilingId: null, carryForwardBasis: money(amount),
  source: source(`return:${year}`, year), legalSnapshot: rules(year),
});
export const annual = (year: number, opening: string, remaining: string, endValue = "900", gross = "100"): IraYearInput => {
  const op = `convert:${year}`, tx = `tx:${year}`, prior = filing(year - 1, opening), close = filing(year, remaining);
  return {
    personId: "person", taxYear: year, currency: USD, knownAt: cutoff, asOf: cutoff, filingStatus: "synthetic_single",
    stateJurisdiction: null, rules: rules(year),
    accounts: [
      { accountId: "traditional", ownerId: "person", family: "traditional_ira", source: source(`identity:${year}`, year, "traditional"),
        december31Value: { amount: money(endValue), at: civilDate(`${year}-12-31`), source: source(`value:${year}`, year, "traditional") } },
      { accountId: "closed-sep", ownerId: "person", family: "sep_ira", source: source(`closed:${year}`, year, "closed-sep"),
        december31Value: { amount: money("0"), at: civilDate(`${year}-12-31`), source: source(`zero:${year}`, year, "closed-sep") } },
      { accountId: "roth", ownerId: "person", family: "roth_ira", source: source(`roth:${year}`, year, "roth") },
    ],
    requests: [{ operationId: op, transactionId: tx, personId: "person", sourceAccountId: "traditional", destinationAccountId: "roth",
      effectiveAt: civilDate(`${year}-06-01`), gross: money(gross), kind: "ira_roth_conversion", source: source(`request:${year}`, year, "traditional"),
      authorization: { permitted: "yes", effectivePeriod: { start: civilDate(`${year}-01-01`), endExclusive: civilDate(`${year + 1}-01-01`) },
        source: source(`permission:${year}`, year, "traditional") } }],
    distributions: [{ operationId: op, transactionId: tx, sourceAccountId: "traditional", effectiveAt: civilDate(`${year}-06-01`),
      gross: money(gross), kind: "ira_roth_conversion", source: source(`distribution:${year}`, year, "traditional") }],
    openingBasis: { amount: money(opening), priorTaxYear: year - 1, returnStatus: "verified_return", source: prior.source, originalReturn: prior },
    basisAdditions: [], closeout: { source: close.source, originalReturn: close, eligibleAccountIds: ["traditional", "closed-sep"],
      distributionOperationIds: [op], basisAdditionOperationIds: [], inventory: "complete", distributions: "complete", basisAdditions: "complete",
      legalBasisModel: "supported_without_special_adjustments", outstandingRollovers: "none", otherAdjustments: "none" },
  };
};
export const history = (p: IraOriginalReturnProvenance): IraOriginalReturnHistory => ({
  query: { personId: "person", taxYear: p.taxYear, knownAt: cutoff, asOf: cutoff }, publisherId: "registry", publisherVersion: "v1",
  sourcePublication: publication, authority: "verified_filing_history", status: "active",
  source: source(`history:${p.taxYear}`, p.taxYear, null, cutoff), original: p, originalStatus: "filed",
  revisionInventory: { completeness: "complete", completeThrough: cutoff, checkedAt: cutoff, revisions: [] },
});
export const provider = (facts: readonly IraOriginalReturnHistory[]): IraOriginalReturnProvider => ({
  publisherId: "registry", publisherVersion: "v1", sourcePublication: publication,
  lookupOriginalReturn: q => facts.find(h => h.query.taxYear === q.taxYear),
});
export const fixture = (): { input: IraYearChainInput; facts: IraOriginalReturnHistory[] } => ({
  input: { personId: "person", knownAt: cutoff, asOf: cutoff,
    years: [annual(2026, "200", "180"), annual(2027, "180", "162"), annual(2028, "162", "0", "0", "200")] },
  // Independent literal facts; never generated from calculator results/inputs.
  facts: [history(filing(2025, "200")), history(filing(2026, "180")), history(filing(2027, "162")), history(filing(2028, "0"))],
});
