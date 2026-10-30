import { civilDate as date } from "../../../../../src/time/index.js";
import { decimal, money, RoundingPolicy } from "../../../../../src/values/index.js";
import type { TipsSource, TipsLot, TipsRule } from "../../../../../src/simulation/d2/fixedIncome/tips/index.js";
import { tipsOriginalIdentity } from "../../../../../src/simulation/d2/fixedIncome/tips/sourceBinding/index.js";
import { tipsRoleOriginalDigest, type TipsOriginalBinding, type TipsOriginalPayloads, type TipsOriginalRole,
  type TipsRoleOriginal, type TipsOriginalProviders, type TipsOriginalQuery } from "../../../../../src/simulation/d2/fixedIncome/tips/originalBinding/index.js";

export const roles = ["security", "terms", "ownership", "basis", "funding", "cpi", "law", "history"] as const;
export const source = (sourceId: string, at = "2025-01-01", jurisdiction = "US"): TipsSource => ({
  sourceId, version: "v1", ruleSnapshotId: `${sourceId}:v1`, ruleFamily: "tips", sourcePublication: "SYNTHETIC ONLY",
  publishedAt: date(at), asOf: date(at), start: date("2024-01-01"), endExclusive: date("2028-01-01"), jurisdiction, projectionStatus: "verified",
});
export type Originals = { [K in TipsOriginalRole]: TipsRoleOriginal<K> };
export function fixture(tag = "000", maturity = false): Originals {
  const at = date(maturity ? "2026-08-01" : "2026-02-01"), openingAt = date(maturity ? "2026-07-01" : "2026-01-01");
  const lot: TipsLot = {
    householdId: "hh", personId: "alice", wrapperId: "wrapper", holdingId: `holding:${tag}`, lotId: `lot:${tag}`, basisId: `basis:${tag}`,
    securityId: "security", issueId: "issue", taxBucket: "taxable", stateJurisdiction: "US:synthetic",
    destination: { accountId: "wrapper-cash", personId: "alice", wrapperId: "wrapper", kind: "wrapper_cash" },
    issueDate: date("2025-08-01"), purchaseDate: date("2025-08-01"), maturityDate: date("2026-08-01"), purchaseKind: "issuance_at_par",
    fundingAccountId: "purchase-evidence", originalPrincipal: money("1000"), parAmount: money("1000"), fundingCost: money("1000"),
    denomination: "USD", annualCouponRate: decimal("0.02"), firstCouponDate: date("2026-02-01"), lastCouponDate: date("2026-08-01"),
    couponDates: [date("2026-02-01"), date("2026-08-01")], lotTreatment: "single_ordinary_lot", source: source("lot", "2025-08-01"),
    opening: { at: openingAt, carrying: money(maturity ? "1100" : "1000"), basis: money(maturity ? "1100" : "1000"),
      cumulativeIndexation: money(maturity ? "100" : "0"), source: source("opening", openingAt) },
  };
  const rule: TipsRule = { issueId: "issue", source: source("rule"), seriesId: "synthetic-cpi", lagMonths: 3,
    interpolation: "linear_day_minus_one_over_days_in_current_month", calendar: "gregorian_unadjusted",
    base: { referenceDate: lot.issueDate, denominator: decimal("100"), source: source("base", "2025-08-01") },
    referenceRounding: new RoundingPolicy(5, "half_up"), ratioRounding: new RoundingPolicy(7, "half_up"),
    principalRounding: new RoundingPolicy(2, "half_up"), couponRounding: new RoundingPolicy(2, "half_up"),
    couponConvention: "indexed_principal_times_annual_rate_times_sourced_fraction", carryingBasisConvention: "signed_indexation_no_other_adjustments",
    deflation: "signed_indexation", maturityFloor: "eligible_original_par", couponPeriods: [
      { start: lot.issueDate, endExclusive: lot.firstCouponDate, paymentDate: lot.firstCouponDate, yearFraction: decimal("0.5") },
      { start: lot.firstCouponDate, endExclusive: lot.lastCouponDate, paymentDate: lot.lastCouponDate, yearFraction: decimal("0.5") },
    ] };
  const identity = tipsOriginalIdentity(lot);
  const event: TipsOriginalBinding["event"] = { occurrenceId: `event:${tag}`, operationId: `operation:${tag}`, claimId: `claim:${tag}`,
    effectiveAt: at, effectiveMonth: at.slice(0, 7), knownAt: at, period: { start: openingAt, endExclusive: date(maturity ? "2026-08-02" : "2026-02-02") } };
  const { securityId, issueId, issueDate, maturityDate, annualCouponRate, firstCouponDate, lastCouponDate, couponDates, denomination,
    opening, ...owned } = lot;
  const months = maturity ? [date("2026-04-01"), date("2026-05-01")] : [date("2025-10-01"), date("2025-11-01")];
  const payloads: TipsOriginalPayloads = {
    security: { complete: true, issues: [{ securityId, issueId, issueDate, maturityDate, annualCouponRate, firstCouponDate, lastCouponDate, couponDates, denomination }] },
    terms: { complete: true, rules: [rule] }, ownership: { lot: owned, beneficialOwnerId: "alice", floorEligible: true },
    basis: { checkpointId: `checkpoint:${tag}`, status: "committed", opening },
    funding: { complete: true, entries: [{ operationId: `purchase:${tag}`, identity, accountId: lot.fundingAccountId,
      fundedAt: lot.purchaseDate, status: "posted", debit: money("1000"), acquisitionCredit: money("1000") }] },
    cpi: { complete: true, seriesId: rule.seriesId, months, observations: months.map((month, n) => ({
      seriesId: rule.seriesId, month, value: decimal(maturity ? n ? "95" : "110" : n ? "104" : "100"),
      source: source(`cpi:${month}`, maturity ? n ? "2026-06-15" : "2026-05-15" : n ? "2025-12-15" : "2025-11-15"),
    })) },
    law: { authority: "enacted", legalSourceId: "synthetic-legal-authority", taxRules: [
      { source: source("tax:US"), taxBucket: "taxable", treatment: "signed_oid_and_coupon" },
      { source: source("tax:state", "2025-01-01", "US:synthetic"), taxBucket: "taxable", treatment: "exempt" },
    ] },
    history: { complete: "since_inception_including_pending", checkpointId: `checkpoint:${tag}`, opening,
      entries: maturity ? [
        { identity, operationId: "prior-basis", claimId: "prior-basis-claim", kind: "basis_recognition",
          start: lot.issueDate, effectiveAt: openingAt, basisDelta: money("100") },
        { identity, operationId: "prior-index", claimId: "prior-index-claim", kind: "indexation",
          start: lot.issueDate, effectiveAt: openingAt, basisDelta: money("100") },
        { identity, operationId: "prior-coupon", claimId: "prior-coupon-claim", kind: "coupon",
          start: lot.issueDate, effectiveAt: lot.firstCouponDate, basisDelta: money("0") },
      ] : [] },
  };
  const make = <K extends TipsOriginalRole>(role: K): TipsRoleOriginal<K> => ({
    contractVersion: "tips-role-original/v1", role, producerId: `publisher:${role}`, sourceId: `${role}:${tag}`, version: "v1", status: "active",
    identity, event, publishedAt: at, knownAt: at, asOf: at, start: date("2025-01-01"), endExclusive: date("2028-01-01"), payload: payloads[role],
  });
  return { security: make("security"), terms: make("terms"), ownership: make("ownership"), basis: make("basis"),
    funding: make("funding"), cpi: make("cpi"), law: make("law"), history: make("history") };
}
export function pin(o: Originals): TipsOriginalBinding {
  const ref = <K extends TipsOriginalRole>(role: K) => ({ producerId: o[role].producerId, sourceId: o[role].sourceId,
    version: o[role].version, digest: tipsRoleOriginalDigest(o[role]) });
  return { contractVersion: "tips-original-binding/v1", identity: o.security.identity, event: o.security.event,
    originals: { security: ref("security"), terms: ref("terms"), ownership: ref("ownership"), basis: ref("basis"),
      funding: ref("funding"), cpi: ref("cpi"), law: ref("law"), history: ref("history") } };
}
export function publishers(originals: readonly Originals[], observe: (role: TipsOriginalRole, query: TipsOriginalQuery) => void = () => {}): TipsOriginalProviders {
  const make = <K extends TipsOriginalRole>(role: K) => {
    const bySource = new Map(originals.map(o => [o[role].sourceId, o]));
    return { authority: role, producerId: `publisher:${role}`,
      read: (query: TipsOriginalQuery): TipsRoleOriginal<K> | undefined => {
        observe(role, query);
        return bySource.get(query.sourceId)?.[role];
      } };
  };
  return { security: make("security"), terms: make("terms"), ownership: make("ownership"), basis: make("basis"),
    funding: make("funding"), cpi: make("cpi"), law: make("law"), history: make("history") };
}
