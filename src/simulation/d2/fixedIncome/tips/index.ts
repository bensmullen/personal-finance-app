import { civilDate, durationBetween, type CivilDate } from "../../../../time/index.js";
import { Currency, DecimalAmount, Money, RoundingPolicy, decimal, money } from "../../../../values/index.js";
import type { TipsCode, TipsCoverage, TipsOutput, TipsProposal, TipsRequest, TipsResult, TipsSource, TipsTaxFact } from "./types.js";
export type * from "./types.js";

class NotAdmitted extends Error {
  constructor(readonly code: TipsCode, detail: string) { super(detail); }
}
const requireFact = (condition: boolean, code: TipsCode, detail: string): void => {
  if (!condition) throw new NotAdmitted(code, detail);
};
const nonblank = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const zero = money("0");
const outputs: readonly TipsOutput[] = ["indexation", "basis", "computed_coupon", "quoted_coupon", "maturity", "federal_tax", "state_tax", "settlement"];
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const unique = (items: readonly string[]): string[] => [...new Set(items)].sort(compare);

/** Copy data records without cloning immutable exact-value objects or freezing caller input. */
const snapshot = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Money || value instanceof DecimalAmount || value instanceof Currency || value instanceof RoundingPolicy) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(v => snapshot(v))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]))) as T;
};
const validMoney = (amount: Money, signed = false): void => {
  requireFact(amount instanceof Money && amount.currency.code === "USD" && amount.amount.fitsScale(2)
    && (signed || !amount.isNegative()), "CURRENCY_OR_AMOUNT_INVALID", "USD integer-cent amount required");
};
const admitSource = (s: TipsSource, at: CivilDate, knownAt: CivilDate): void => {
  for (const date of [s.start, s.endExclusive, s.asOf, s.publishedAt]) civilDate(date);
  requireFact([s.sourceId, s.ruleSnapshotId, s.sourcePublication, s.version, s.jurisdiction].every(nonblank)
    && s.ruleFamily === "tips" && s.projectionStatus === "verified" && s.start < s.endExclusive && s.start <= at && at < s.endExclusive
    && s.publishedAt <= s.asOf && s.asOf <= knownAt,
  "SOURCE_NOT_ADMITTED", "Verified dated publication/asOf and effective coverage required");
};
const admitRounding = (p: RoundingPolicy, cents = false): void => {
  requireFact(p instanceof RoundingPolicy && Number.isSafeInteger(p.scale) && p.scale >= 0 && p.scale <= 18
    && (!cents || p.scale === 2) && ["half_up", "half_even", "toward_zero", "away_from_zero", "floor", "ceiling"].includes(p.mode),
  "CONVENTION_NOT_ADMITTED", "Explicit supported rounding and currency scale required");
};
const monthStart = (at: CivilDate, offset = 0): CivilDate => {
  const year = Number(at.slice(0, 4));
  const index = year * 12 + Number(at.slice(5, 7)) - 1 + offset;
  const y = Math.floor(index / 12);
  requireFact(y >= 1 && y <= 9999, "CONVENTION_NOT_ADMITTED", "Reference month outside supported Gregorian years");
  return civilDate(`${String(y).padStart(4, "0")}-${String(index - y * 12 + 1).padStart(2, "0")}-01`);
};

/** PFA-DET §5.6 / S3,S4,S6,S7; no ledger, holdings, tax-payment or market-data writes. */
export const proposeTips = (request: TipsRequest): TipsResult => {
  const { lot, period, effectiveAt, knownAt, rule } = request;
  const proposals: TipsProposal[] = [];
  const coverage = new Map<TipsOutput, TipsCoverage>();
  const sources: TipsSource[] = [];
  const record = (output: TipsOutput, status: TipsCoverage["coverage"], code: TipsCode | null = null, detail = ""): void => {
    coverage.set(output, { sourceEntityPath: `holdings/${encodeURIComponent(lot.holdingId)}/lots/${encodeURIComponent(lot.lotId)}`,
      period, affectedOutput: output, coverage: status, diagnosticCode: code, missingFacts: detail ? [detail] : [],
      ruleSnapshotId: rule?.source?.ruleSnapshotId ?? null, traceRefs: unique(sources.map(s => s.sourceId)) });
  };
  const failure = (error: unknown): NotAdmitted => error instanceof NotAdmitted ? error
    : new NotAdmitted("INVALID_REQUEST", "Malformed dates, amounts or source conventions");
  const fail = (affected: readonly TipsOutput[], error: unknown): void => {
    const e = failure(error);
    for (const output of affected) record(output, "incomplete", e.code, e.message);
  };
  const finish = (): TipsResult => snapshot({ proposals, coverage: outputs.map(o => coverage.get(o)!) });
  for (const output of outputs) record(output, "not_applicable");
  record("settlement", "incomplete", "SHARED_SETTLEMENT_PENDING", "#149 must admit and atomically commit these proposals; tax liability/payment remains tax-owner work");

  // Admission failures invalidate the whole request; nothing partially posts or silently becomes zero.
  try {
    for (const date of [period.start, period.endExclusive, effectiveAt, knownAt, lot.issueDate, lot.maturityDate,
      lot.purchaseDate, lot.opening.at, lot.firstCouponDate, lot.lastCouponDate, ...lot.couponDates]) civilDate(date);
    requireFact(period.start < period.endExclusive && period.start <= effectiveAt && effectiveAt < period.endExclusive
      && effectiveAt <= knownAt && lot.opening.at === period.start && lot.opening.at < effectiveAt
      && lot.issueDate <= lot.opening.at && effectiveAt <= lot.maturityDate && lot.issueDate < lot.maturityDate,
    "INVALID_REQUEST", "Ordered half-open period and opening checkpoint before the observed event required");
    requireFact([lot.householdId, lot.personId, lot.holdingId, lot.lotId, lot.securityId, lot.issueId, lot.basisId,
      lot.wrapperId, lot.fundingAccountId, lot.destination.accountId].every(nonblank)
      && lot.destination.personId === lot.personId && lot.destination.wrapperId === lot.wrapperId
      && lot.destination.kind === "wrapper_cash" && lot.destination.accountId !== lot.holdingId,
    "LOT_NOT_ADMITTED", "Source-qualified identities and same-owner same-wrapper cash destination required");
    requireFact(request.action === "scheduled_observation" && lot.purchaseKind === "issuance_at_par"
      && lot.purchaseDate === lot.issueDate && lot.lotTreatment === "single_ordinary_lot"
      && ["taxable", "tax_deferred"].includes(lot.taxBucket),
    "LOT_NOT_ADMITTED", "Only ordinary issuance-at-par single lots with known wrappers; sales/splits/early redemptions excluded");
    for (const amount of [lot.originalPrincipal, lot.parAmount, lot.fundingCost, lot.opening.carrying, lot.opening.basis]) validMoney(amount);
    validMoney(lot.opening.cumulativeIndexation, true);
    requireFact(lot.denomination === "USD" && lot.originalPrincipal.isPositive() && lot.originalPrincipal.equals(lot.parAmount)
      && lot.fundingCost.equals(lot.parAmount) && !lot.annualCouponRate.isNegative(),
    "LOT_NOT_ADMITTED", "Positive USD original face/par, at-par funding and nonnegative sourced annual decimal coupon rate required");
    admitSource(lot.source, effectiveAt, knownAt); admitSource(lot.opening.source, lot.opening.at, knownAt);
    requireFact(lot.source.asOf >= lot.purchaseDate && lot.opening.source.asOf >= lot.opening.at,
      "SOURCE_NOT_ADMITTED", "Observed purchase and committed opening checkpoint cannot predate their facts");
    sources.push(lot.source, lot.opening.source);
    requireFact(new Set(lot.couponDates).size === lot.couponDates.length, "DUPLICATE_COUPON", "Duplicate coupon dates are ambiguous");
    const dates = [...lot.couponDates].sort(compare);
    requireFact(dates.length > 0 && dates[0] === lot.firstCouponDate && dates[dates.length - 1] === lot.lastCouponDate
      && dates.every(d => d > lot.issueDate && d <= lot.maturityDate),
    "COUPON_PERIOD_REQUIRED", "Complete sourced first/last coupon calendar required");
    requireFact(!dates.some(d => d > lot.opening.at && d < effectiveAt), "COUPON_PERIOD_REQUIRED", "Process intervening coupon dates before this checkpoint");
  } catch (e) { fail(outputs, e); return finish(); }

  const isCoupon = lot.couponDates.includes(effectiveAt);
  const isMaturity = effectiveAt === lot.maturityDate;
  const identity = (kind: TipsProposal["kind"], checkpoint = true): string => JSON.stringify(["tips", lot.householdId, lot.personId, lot.wrapperId,
    lot.holdingId, lot.lotId, lot.securityId, lot.issueId, lot.basisId, ...(checkpoint ? [lot.opening.at] : []), effectiveAt, kind]);
  let adjusted: Money | null = null;
  let reference: DecimalAmount | null = null;
  let ratio: DecimalAmount | null = null;
  const make = (kind: TipsProposal["kind"], gross: Money, cash: Money, asset: Money, basis: Money,
    recognitionFacts: TipsProposal["recognitionFacts"], dependsOn: readonly string[] = []): TipsProposal => ({
    contractVersion: "d2-shared/v1", status: "conditional_uncommitted", operationId: identity(kind),
    // The same coupon claim is shared by quoted and computed routes; adapters must never post both.
    claimId: identity(kind === "quoted_coupon" ? "computed_coupon" : kind, false), kind,
    actorId: lot.personId, householdId: lot.householdId, holdingId: lot.holdingId, lotId: lot.lotId,
    securityId: lot.securityId, issueId: lot.issueId, basisId: lot.basisId, taxBucket: lot.taxBucket,
    effectiveAt, period, ruleSnapshotId: rule?.source.ruleSnapshotId ?? request.couponQuote?.source.ruleSnapshotId ?? lot.source.ruleSnapshotId,
    source: lot.holdingId, destination: kind === "indexation" ? lot.holdingId : lot.destination.accountId,
    priority: kind === "indexation" ? "recognition" : "movement", dependsOn,
    conditions: ["source_and_opening_checkpoint_still_current", "claim_uncommitted", "atomic_shared_owner_admission",
      "exclusive_coupon_claim", "no_implicit_checking_transfer"],
    grossAmount: gross, originalPrincipal: lot.originalPrincipal, adjustedPrincipal: adjusted, referenceCpi: reference, indexRatio: ratio,
    cashDelta: cash, assetDelta: asset, basisDelta: basis, netWorthDelta: cash.plus(asset), recognitionFacts, taxFacts: [],
    traceRefs: unique(sources.map(s => s.sourceId)), sources: [...sources],
  });

  let economicFailure: NotAdmitted | null = null;
  try {
    requireFact(rule !== undefined, "RULE_REQUIRED", "Issue-specific CPI base/lag/interpolation/rounding rule required");
    // Narrowing is explicit for strict compilation; requireFact also gives a typed public diagnostic.
    if (!rule) throw new NotAdmitted("RULE_REQUIRED", "Issue-specific CPI rule required");
    admitSource(rule.source, lot.opening.at, knownAt); admitSource(rule.source, effectiveAt, knownAt);
    admitSource(rule.base.source, rule.base.referenceDate, knownAt);
    requireFact(rule.base.source.asOf >= rule.base.referenceDate, "SOURCE_NOT_ADMITTED", "Observed issue reference denominator must be dated at or after the issue reference date");
    sources.push(rule.source, rule.base.source);
    requireFact(rule.issueId === lot.issueId && rule.source.jurisdiction === "US" && nonblank(rule.seriesId) && rule.base.referenceDate === lot.issueDate
      && rule.base.denominator.isPositive() && rule.base.denominator.equals(rule.base.denominator.round(rule.referenceRounding))
      && Number.isSafeInteger(rule.lagMonths) && rule.lagMonths >= 0 && rule.lagMonths <= 120
      && rule.interpolation === "linear_day_minus_one_over_days_in_current_month" && rule.calendar === "gregorian_unadjusted"
      && rule.carryingBasisConvention === "signed_indexation_no_other_adjustments",
    "CONVENTION_NOT_ADMITTED", "Issue-specific denominator, Gregorian day/month lag/interpolation and signed carrying/basis convention required");
    admitRounding(rule.referenceRounding); admitRounding(rule.ratioRounding);
    admitRounding(rule.principalRounding, true); admitRounding(rule.couponRounding, true);
    const principalAt = (at: CivilDate): { principal: Money; reference: DecimalAmount; ratio: DecimalAmount } => {
      const get = (month: CivilDate): DecimalAmount => {
        const points = request.observations.filter(p => p.seriesId === rule.seriesId && p.month === month);
        requireFact(points.length > 0, "CPI_REQUIRED", `Observed ${rule.seriesId} CPI for ${month} required; never infer inflation`);
        requireFact(points.length === 1, "CPI_CONFLICT", `Ambiguous CPI observation for ${month}; source revision selection required`);
        const point = points[0]!;
        civilDate(point.month); admitSource(point.source, month, at); // CPI used for dated cash/carrying must have been available at that event, not merely at later replay.
        requireFact(point.source.publishedAt >= monthStart(month, 1), "SOURCE_NOT_ADMITTED", "An observed monthly CPI publication cannot precede completion of its observation month");
        requireFact(!point.value.isNegative(), "NEGATIVE_PRINCIPAL", "Negative CPI cannot create an indexed principal");
        requireFact(point.month.endsWith("-01") && point.value.isPositive(), "CPI_REQUIRED", "Positive observed monthly CPI required");
        sources.push(point.source);
        return point.value;
      };
      const firstMonth = monthStart(at, -rule.lagMonths);
      const a = get(firstMonth);
      const day = Number(at.slice(8, 10));
      const days = decimal(durationBetween(monthStart(at), monthStart(at, 1)).days.toString());
      // Round the exact rational reference once; no rounded intermediate day fraction.
      const ref = day === 1 ? a.round(rule.referenceRounding) : a.times(days)
        .plus(get(monthStart(firstMonth, 1)).minus(a).times(decimal(String(day - 1))))
        .dividedBy(days, rule.referenceRounding);
      const r = ref.dividedBy(rule.base.denominator, rule.ratioRounding);
      const principal = lot.originalPrincipal.times(r).round(rule.principalRounding);
      requireFact(!principal.isNegative(), "NEGATIVE_PRINCIPAL", "Negative indexed principal is not admitted");
      return { principal, reference: ref, ratio: r };
    };
    const opening = principalAt(lot.opening.at);
    requireFact(opening.principal.equals(lot.opening.carrying) && lot.opening.basis.equals(lot.opening.carrying)
      && lot.opening.cumulativeIndexation.equals(lot.opening.carrying.minus(lot.originalPrincipal)),
    "OPENING_NOT_RECONCILED", "Sourced opening carrying/basis/cumulative indexation must reconcile to opening CPI");
    const current = principalAt(effectiveAt);
    adjusted = current.principal; reference = current.reference; ratio = current.ratio;
    const delta = adjusted.minus(opening.principal);
    requireFact(!delta.isNegative() || rule.deflation === "signed_indexation", "DEFLATION_NOT_ADMITTED", "Sourced signed deflation treatment required");
    const indexation = make("indexation", delta, zero, delta, delta, [{ character: "noncash_indexation", amount: delta }]);
    proposals.push(indexation); record("indexation", "complete"); record("basis", "complete");

    if (isCoupon) {
      try {
        requireFact(rule.couponConvention === "indexed_principal_times_annual_rate_times_sourced_fraction",
          "CONVENTION_NOT_ADMITTED", "Indexed principal coupon convention required");
        const periods = rule.couponPeriods.filter(p => p.paymentDate === effectiveAt);
        requireFact(periods.length === 1, periods.length > 1 ? "DUPLICATE_COUPON" : "COUPON_PERIOD_REQUIRED", "One sourced coupon period required");
        const p = periods[0]!;
        civilDate(p.start); civilDate(p.endExclusive); civilDate(p.paymentDate);
        const prior = [...lot.couponDates].filter(d => d < effectiveAt).sort(compare).at(-1) ?? lot.issueDate;
        requireFact(p.start === prior && p.endExclusive === effectiveAt && p.yearFraction.isPositive()
          && p.yearFraction.compare(decimal("1")) <= 0, "COUPON_PERIOD_REQUIRED", "Sourced period fraction and contiguous coupon interval required");
        const coupon = adjusted.times(lot.annualCouponRate).times(p.yearFraction).round(rule.couponRounding);
        proposals.push(make("computed_coupon", coupon, coupon, zero, zero, [{ character: "coupon_interest", amount: coupon }], [indexation.operationId]));
        record("computed_coupon", "complete");
      } catch (e) { fail(["computed_coupon"], e); }
    }
    if (isMaturity) {
      if (rule.maturityFloor !== "eligible_original_par") {
        fail(["maturity"], new NotAdmitted("CONVENTION_NOT_ADMITTED", "Verified eligible original-par maturity floor required"));
      } else {
        const redemption = adjusted.compare(lot.parAmount) < 0 ? lot.parAmount : adjusted;
        const uplift = redemption.minus(adjusted);
        proposals.push(make("maturity", redemption, redemption, adjusted.negated(), adjusted.negated(),
          uplift.isZero() ? [] : [{ character: "maturity_floor_uplift", amount: uplift }], [indexation.operationId]));
        record("maturity", "complete");
      }
    }
  } catch (e) {
    economicFailure = failure(e);
    fail(["indexation", "basis", ...(isCoupon ? ["computed_coupon" as const] : []), ...(isMaturity ? ["maturity" as const] : [])], e);
  }

  // A statement quote is an exclusive alternate claim, never evidence of a computed CPI coupon.
  if (request.couponQuote && isCoupon && coverage.get("computed_coupon")?.coverage !== "complete") {
    try {
      requireFact(economicFailure === null || ["RULE_REQUIRED", "CPI_REQUIRED"].includes(economicFailure.code),
        "CONVENTION_NOT_ADMITTED", "Malformed or conflicting index sources cannot be bypassed by a quote");
      const quote = request.couponQuote;
      requireFact(nonblank(quote.quoteId) && quote.paymentDate === effectiveAt, "INVALID_REQUEST", "Dated matching coupon quote required");
      admitSource(quote.source, effectiveAt, knownAt); validMoney(quote.amount);
      sources.push(quote.source);
      const quoted = make("quoted_coupon", quote.amount, quote.amount, zero, zero, [{ character: "coupon_interest", amount: quote.amount }]);
      proposals.push({ ...quoted, adjustedPrincipal: null, referenceCpi: null, indexRatio: null, traceRefs: unique([...quoted.traceRefs, quote.quoteId]) });
      record("quoted_coupon", "complete");
    } catch (e) { fail(["quoted_coupon"], e); }
  }

  for (const [output, jurisdiction] of [["federal_tax", "US"], ["state_tax", lot.stateJurisdiction]] as const) {
    try {
      requireFact(nonblank(jurisdiction) && (output === "federal_tax" || jurisdiction !== "US"), "TAX_LAW_REQUIRED", "Distinct source-qualified state jurisdiction required");
      const laws = request.taxRules.filter(t => t.source.jurisdiction === jurisdiction && t.taxBucket === lot.taxBucket);
      requireFact(laws.length > 0, "TAX_LAW_REQUIRED", `Effective ${jurisdiction} ${lot.taxBucket} law required`);
      requireFact(laws.length === 1, "TAX_LAW_CONFLICT", "Resolve competing tax snapshots explicitly");
      const law = laws[0]!;
      admitSource(law.source, effectiveAt, knownAt);
      requireFact(lot.taxBucket === "tax_deferred" ? law.treatment === "no_current_tax_facts"
        : ["signed_oid_and_coupon", "exempt"].includes(law.treatment), "TAX_LAW_REQUIRED", "Supported wrapper-specific signed OID/coupon law required");
      sources.push(law.source);
      requireFact(lot.taxBucket !== "taxable" || lot.opening.at.slice(0, 4) === effectiveAt.slice(0, 4),
        "TAX_LAW_REQUIRED", "Cross-tax-year indexation needs a tax-year opening checkpoint; no allocation invented");
      if (coverage.get("indexation")?.coverage !== "complete" || (isCoupon && !proposals.some(p => p.kind === "computed_coupon" || p.kind === "quoted_coupon"))) {
        throw new NotAdmitted("TAX_LAW_REQUIRED", "Dependent economic character remains incomplete; any available coupon fact is partial");
      }
      if (lot.taxBucket === "taxable") {
        for (let i = 0; i < proposals.length; i++) {
          const p = proposals[i]!;
          if (p.kind === "maturity") continue; // redemption is never an automatic second taxable gain
          const fact: TipsTaxFact = { taxYear: Number(effectiveAt.slice(0, 4)), jurisdiction,
            incomeCharacter: p.kind !== "indexation" ? "coupon_interest" : p.grossAmount.isNegative() ? "noncash_deflation_adjustment" : "noncash_inflation_oid",
            gross: p.grossAmount, taxable: law.treatment === "exempt" ? zero : p.grossAmount, basisRecovered: zero,
            lawVersion: law.source.version, ruleSnapshotId: law.source.ruleSnapshotId, completeness: "complete_character_only", source: law.source };
          proposals[i] = { ...p, taxFacts: [...p.taxFacts, fact], sources: [...p.sources, law.source], traceRefs: unique([...p.traceRefs, law.source.sourceId]) };
        }
      }
      const uplift = proposals.some(p => p.recognitionFacts.some(f => f.character === "maturity_floor_uplift"));
      if (uplift && lot.taxBucket === "taxable") record(output, "incomplete", "FLOOR_TAX_CHARACTER_REQUIRED", "Floor uplift tax character requires separate law; no taxable redemption gain inferred");
      else if (isMaturity && coverage.get("maturity")?.coverage !== "complete") record(output, "incomplete", "TAX_LAW_REQUIRED", "Maturity economic output incomplete");
      else record(output, lot.taxBucket === "tax_deferred" ? "not_applicable" : "complete");
    } catch (e) { fail([output], e); }
  }
  return finish();
};
