import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Currency, DecimalAmount, Money, RoundingPolicy, money } from "../../../../values/index.js";
import type { EECode, EECoverage, EEOutput, EEProposal, EERequest, EEResult, EESource, EETaxFact, EEValues } from "./types.js";
export type * from "./types.js";

class Incomplete extends Error {
  constructor(readonly code: EECode, detail: string) { super(detail); }
}
function need(ok: boolean, code: EECode, detail: string): asserts ok {
  if (!ok) throw new Incomplete(code, detail);
}
const zero = money("0");
const outputs: readonly EEOutput[] = ["accrued_value", "redemption_value", "basis", "federal_tax", "state_tax", "local_tax", "settlement"];
const nonblank = (v: string): boolean => typeof v === "string" && v.trim().length > 0;
const unique = (v: readonly string[]): string[] => [...new Set(v)].sort();
const snapshot = <T>(v: T): T => {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Money || v instanceof DecimalAmount || v instanceof Currency || v instanceof RoundingPolicy) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(x => snapshot(x))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snapshot(x)]))) as T;
};
const amount = (v: Money): void => {
  need(v instanceof Money && v.currency.code === "USD" && v.amount.fitsScale(2) && !v.isNegative(),
    "CURRENCY_OR_AMOUNT_INVALID", "Nonnegative exact USD cents required");
};
const nextMonth = (at: CivilDate): CivilDate => {
  const m = Number(at.slice(5, 7));
  return civilDate(`${String(Number(at.slice(0, 4)) + (m === 12 ? 1 : 0)).padStart(4, "0")}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`);
};

/** Pure issue-vintage proposal helper. No purchase, bank, tax, or holdings writes. */
export const proposeSeriesEE = (request: EERequest): EEResult => {
  const { lot, rule, effectiveAt, knownAt, period } = request;
  const sources: EESource[] = [];
  const proposals: EEProposal[] = [];
  const coverage = new Map<EEOutput, EECoverage>();
  let values: EEValues | null = null;
  const record = (output: EEOutput, status: EECoverage["coverage"], code: EECode | null = null, detail = ""): void => {
    coverage.set(output, { sourceEntityPath: `holdings/${encodeURIComponent(lot.holdingId)}/lots/${encodeURIComponent(lot.lotId)}`,
      period, affectedOutput: output, coverage: status, diagnosticCode: code, missingFacts: detail ? [detail] : [],
      ruleSnapshotId: rule?.source.ruleSnapshotId ?? null, traceRefs: unique(sources.map(s => s.sourceId)) });
  };
  const fail = (affected: readonly EEOutput[], error: unknown): void => {
    const e = error instanceof Incomplete ? error : new Incomplete("INVALID_REQUEST", "Malformed dates, amounts or conventions");
    for (const o of affected) record(o, "incomplete", e.code, e.message);
  };
  const finish = (): EEResult => snapshot({ values, proposals, coverage: outputs.map(o => coverage.get(o)!) });
  for (const o of outputs) record(o, "not_applicable");
  record("settlement", "incomplete", "SHARED_SETTLEMENT_PENDING", "#149 atomic claim/checkpoint and wrapper settlement; #101 tax liability/payment");
  // Source publication may not be backdated by a later hindsight replay. An
  // observed cash event must have had its evidence available on that event date.
  const source = (s: EESource, at: CivilDate): void => {
    for (const d of [s.start, s.endExclusive, s.publishedAt, s.asOf]) civilDate(d);
    need([s.sourceId, s.ruleSnapshotId, s.sourcePublication, s.version, s.jurisdiction].every(nonblank)
      && s.ruleFamily === "series_ee" && ["official", "externally_verified"].includes(s.authority)
      && s.projectionStatus === "verified" && s.start <= at && at < s.endExclusive
      && s.publishedAt <= s.asOf && s.asOf <= knownAt && s.asOf <= effectiveAt,
    "SOURCE_NOT_ADMITTED", "Verified effective-dated source must be published/asOf by event and known-at dates");
    sources.push(s);
  };
  let openingInterest = zero;
  let interest = zero;
  let uplift = zero;
  let forfeiture = zero;
  let redemption: Money | null = null;
  let accrued = zero;
  try {
    for (const d of [period.start, period.endExclusive, effectiveAt, knownAt, lot.issueMonth, lot.purchaseDate, lot.acquisitionDate, lot.opening.at]) civilDate(d);
    need(period.start < period.endExclusive && period.start === lot.opening.at && period.start <= effectiveAt
      && effectiveAt < period.endExclusive && effectiveAt <= knownAt && lot.issueMonth.endsWith("-01")
      && lot.issueMonth <= lot.purchaseDate && lot.purchaseDate < nextMonth(lot.issueMonth)
      && lot.purchaseDate === lot.acquisitionDate && lot.acquisitionDate <= lot.opening.at,
    "INVALID_REQUEST", "Ordered half-open observation period and original issue-month acquisition required");
    need([lot.householdId, lot.personId, lot.holdingId, lot.bondId, lot.lotId, lot.basisId, lot.wrapperId,
      lot.fundingAccountId, lot.destination.accountId].every(nonblank) && (lot.beneficiaryId === null || nonblank(lot.beneficiaryId))
      && lot.destination.personId === lot.personId && lot.destination.wrapperId === lot.wrapperId
      && lot.destination.kind === "wrapper_cash" && lot.destination.accountId !== lot.holdingId
      && lot.treatment === "ordinary_original_owner" && lot.taxBucket === "taxable"
      && ["valuation", "redemption"].includes(request.action),
    "LOT_NOT_ADMITTED", "Ordinary original-owner single lot, explicit identities and same-owner wrapper cash only; special/education paths excluded");
    need(!lot.opening.redeemed, "DUPLICATE_REDEMPTION", "Committed redemption already exists");
    for (const v of [lot.face, lot.purchaseCost, lot.acquisitionCost, lot.opening.carrying]) amount(v);
    need(lot.face.isPositive() && lot.purchaseCost.isPositive() && lot.purchaseCost.equals(lot.acquisitionCost),
      "LOT_NOT_ADMITTED", "Positive original purchase/face and unchanged original-owner acquisition cost required");
    source(lot.source, lot.acquisitionDate); source(lot.opening.source, lot.opening.at);
    need(lot.source.asOf >= lot.acquisitionDate && lot.opening.source.asOf >= lot.opening.at,
      "SOURCE_NOT_ADMITTED", "Observed lot and checkpoint source must include their fact dates");
    need(rule !== undefined, "RULE_REQUIRED", "Verified issue-vintage schedule and redemption terms required");
    source(rule.source, lot.issueMonth); source(rule.source, effectiveAt);
    need(rule.source.jurisdiction === "US" && rule.issueMonth === lot.issueMonth
      && ["fixed_issue_schedule", "historical_issue_schedule"].includes(rule.method)
      && rule.posting === "monthly_interest_rounded_then_capitalized"
      && Number.isSafeInteger(rule.capitalizationMonths) && rule.capitalizationMonths > 0
      && rule.interestRounding instanceof RoundingPolicy && rule.interestRounding.scale === 2
      && ["half_up", "half_even", "toward_zero", "away_from_zero", "floor", "ceiling"].includes(rule.interestRounding.mode),
    "CONVENTION_NOT_ADMITTED", "Issue-specific monthly posting, periodic capitalization and explicit cent rounding required");
    for (const d of [rule.stopAccruingAt, rule.firstRedeemableAt, rule.penalty.endExclusive]) civilDate(d);
    need(rule.stopAccruingAt > lot.issueMonth && rule.stopAccruingAt.endsWith("-01")
      && rule.firstRedeemableAt >= lot.acquisitionDate && rule.firstRedeemableAt <= rule.stopAccruingAt
      && rule.penalty.endExclusive >= rule.firstRedeemableAt
      && Number.isSafeInteger(rule.penalty.forfeitureMonths) && rule.penalty.forfeitureMonths >= 0
      && rule.penalty.treatment === "last_monthly_interest_only",
    "CONVENTION_NOT_ADMITTED", "Explicit stop/minimum-hold/forfeiture terms required");
    if (rule.guarantee) {
      civilDate(rule.guarantee.at);
      need(rule.guarantee.at > lot.issueMonth && rule.guarantee.at <= rule.stopAccruingAt && rule.guarantee.at.endsWith("-01")
        && rule.guarantee.purchaseMultiple.isPositive(), "CONVENTION_NOT_ADMITTED", "Sourced eligible anniversary and positive purchase multiple required");
    }
    const schedule = new Map<CivilDate, (typeof rule.schedule)[number]>();
    for (const row of rule.schedule) {
      civilDate(row.start); civilDate(row.endExclusive);
      need(!schedule.has(row.start) && row.start.endsWith("-01") && row.endExclusive === nextMonth(row.start)
        && row.start >= lot.issueMonth && row.endExclusive <= rule.stopAccruingAt && !row.periodRate.isNegative(),
      "CONVENTION_NOT_ADMITTED", "Unambiguous nonnegative full monthly schedule rows required");
      schedule.set(row.start, row);
    }
    let capital = lot.purchaseCost;
    let pending = zero;
    let count = 0;
    const history: Money[] = [];
    const captureOpening = (at: CivilDate): void => {
      if (at <= lot.opening.at) openingInterest = interest.plus(uplift);
    };
    // Full replay from issuance reconciles carrying and guarantees without
    // trusting a fabricated missing early history or a mutable accrual cache.
    for (let at = lot.issueMonth; at < rule.stopAccruingAt && nextMonth(at) <= effectiveAt; at = nextMonth(at)) {
      const end = nextMonth(at);
      const row = schedule.get(at);
      need(row !== undefined, "SCHEDULE_INCOMPLETE", `Missing issue-vintage accrual interval [${at}, ${end})`);
      source(row.source, at);
      need(row.source.endExclusive >= end && row.source.jurisdiction === "US", "SOURCE_NOT_ADMITTED", "Full monthly source coverage required");
      count += 1;
      need(row.capitalize === (count % rule.capitalizationMonths === 0), "CONVENTION_NOT_ADMITTED", "Capitalization flag must match sourced frequency");
      const credit = capital.times(row.periodRate).round(rule.interestRounding);
      pending = pending.plus(credit); interest = interest.plus(credit); history.push(credit);
      if (row.capitalize) { capital = capital.plus(pending); pending = zero; }
      if (rule.guarantee?.eligible && rule.guarantee.at === end) {
        const floor = lot.purchaseCost.times(rule.guarantee.purchaseMultiple).round(rule.interestRounding);
        const value = capital.plus(pending);
        if (floor.compare(value) > 0) {
          const catchup = floor.minus(value);
          uplift = uplift.plus(catchup); capital = capital.plus(catchup);
        }
      }
      captureOpening(end);
    }
    accrued = capital.plus(pending);
    need(lot.opening.carrying.equals(lot.purchaseCost.plus(openingInterest)), "OPENING_NOT_RECONCILED", "Opening carrying must reconcile to complete sourced history including guarantee");
    record("accrued_value", "complete");
    if (effectiveAt >= rule.firstRedeemableAt) {
      if (effectiveAt < rule.penalty.endExclusive) {
        need(history.length >= rule.penalty.forfeitureMonths, "SCHEDULE_INCOMPLETE", "Full exact forfeiture history required");
        for (const credit of history.slice(history.length - rule.penalty.forfeitureMonths)) forfeiture = forfeiture.plus(credit);
      }
      redemption = accrued.minus(forfeiture);
      need(redemption.compare(lot.purchaseCost) >= 0, "CONVENTION_NOT_ADMITTED", "Unsupported below-basis redemption");
      record("redemption_value", "complete");
    } else record("redemption_value", "incomplete", "HOLD_RESTRICTION", "Sourced first redemption date has not arrived");
    values = { purchaseCost: lot.purchaseCost, purchaseBasis: null, accruedValue: accrued, creditedInterest: interest,
      guaranteeUplift: uplift, forfeitedInterest: forfeiture, redemptionValue: redemption };
  } catch (e) { fail(outputs.filter(o => o !== "settlement"), e); return finish(); }

  // Basis and tax failures leave independently computable economic values intact.
  let basisKnown = false;
  try {
    need(lot.opening.purchaseBasis !== null, "TAX_FACTS_REQUIRED", "Unknown purchase carry basis");
    amount(lot.opening.purchaseBasis);
    need(lot.opening.purchaseBasis.equals(lot.purchaseCost), "TAX_FACTS_REQUIRED", "Ordinary original purchase basis must reconcile");
    basisKnown = true; values = { ...values!, purchaseBasis: lot.purchaseCost }; record("basis", "complete");
  } catch (e) { fail(["basis"], e); }
  const redeem = request.action === "redemption";
  let cashEligible = !redeem;
  if (redeem) {
    try {
      need(redemption !== null, "HOLD_RESTRICTION", "Redemption before sourced first eligible date");
      const q = request.redemptionQuote;
      need(q !== undefined && nonblank(q.quoteId) && q.at === effectiveAt, "QUOTE_REQUIRED", "Observed dated redemption quote required");
      amount(q.amount); source(q.source, effectiveAt);
      need(q.source.asOf >= effectiveAt, "SOURCE_NOT_ADMITTED", "Observed quote requires event-date evidence");
      need(q.amount.equals(redemption), "QUOTE_MISMATCH", "Quote must reconcile to full issue-vintage accrual/guarantee/forfeiture calculation");
      cashEligible = true;
    } catch (e) { fail(["redemption_value"], e); }
  }
  const facts: EETaxFact[] = [];
  for (const [output, jurisdiction] of [["federal_tax", "US"], ["state_tax", lot.stateJurisdiction], ["local_tax", lot.localJurisdiction]] as const) {
    try {
      need(basisKnown && cashEligible, "TAX_FACTS_REQUIRED", "Reconciled basis and eligible observed event required");
      need(nonblank(jurisdiction) && (output === "federal_tax" || jurisdiction !== "US"), "TAX_FACTS_REQUIRED", "Explicit state/local jurisdiction required");
      need(output !== "local_tax" || jurisdiction !== lot.stateJurisdiction, "TAX_FACTS_REQUIRED", "State and local jurisdictions must remain distinct");
      need(["current_accrual", "redemption"].includes(lot.opening.election) && lot.opening.recognizedFederalInterest !== null,
        "TAX_FACTS_REQUIRED", "Verified election and historical recognized federal interest required");
      const prior = lot.opening.recognizedFederalInterest;
      amount(prior);
      need(prior.compare(openingInterest) <= 0, "TAX_FACTS_REQUIRED", "Previously recognized interest exceeds opening economic interest");
      const matches = request.taxRules.filter(t => t.source.jurisdiction === jurisdiction && t.issueMonth === lot.issueMonth
        && t.election === lot.opening.election && t.source.start <= effectiveAt && effectiveAt < t.source.endExclusive);
      need(matches.length === 1, "TAX_FACTS_REQUIRED", "Exactly one applicable vintage/election/jurisdiction law required");
      const law = matches[0]!; source(law.source, effectiveAt);
      if (lot.opening.election === "current_accrual") source(law.source, lot.opening.at);
      need(law.treatment === (output === "federal_tax" ? "federal_interest_less_previously_recognized" : "state_local_exempt"),
        "TAX_FACTS_REQUIRED", "Unsupported federal election or state/local nonconformity");
      const total = (redeem ? redemption! : accrued).minus(lot.purchaseCost);
      let taxable = zero;
      if (lot.opening.election === "current_accrual") {
        need(prior.equals(openingInterest) && lot.opening.at.slice(0, 4) === effectiveAt.slice(0, 4),
          "TAX_FACTS_REQUIRED", "Current taxation needs fully recognized opening history and a same-tax-year checkpoint");
        need(total.compare(prior) >= 0, "TAX_FACTS_REQUIRED", "Forfeiture of previously taxed interest requires separate tax-owner treatment");
        taxable = total.minus(prior);
      } else if (redeem) {
        need(total.compare(prior) >= 0, "TAX_FACTS_REQUIRED", "Previously taxed forfeiture requires separate treatment");
        taxable = total.minus(prior);
      }
      facts.push({ personId: lot.personId, basisId: lot.basisId, taxYear: Number(effectiveAt.slice(0, 4)), jurisdiction,
        incomeCharacter: output === "federal_tax" ? "ee_interest" : "ee_state_local_exempt_interest",
        gross: lot.opening.election === "redemption" && !redeem ? zero : total.minus(prior),
        taxable: output === "federal_tax" ? taxable : zero, basisRecovered: redeem ? lot.purchaseCost : zero,
        previouslyRecognized: prior, lawVersion: law.source.version, ruleSnapshotId: law.source.ruleSnapshotId,
        completeness: "complete_character_only", source: law.source });
      record(output, "complete");
    } catch (e) { fail([output], e); }
  }
  if (!cashEligible || (redeem && !basisKnown)) return finish();
  const kind = redeem ? "redemption" : "noncash_accrual";
  // Redemption exclusivity is lot-wide, independent of date or checkpoint.
  const key = ["series_ee", lot.householdId, lot.personId, lot.wrapperId, lot.holdingId, lot.bondId, lot.lotId, lot.basisId];
  const claimId = JSON.stringify([...key, kind, ...(redeem ? [] : [effectiveAt])]);
  const cash = redeem ? redemption! : zero;
  const asset = redeem ? lot.opening.carrying.negated() : accrued.minus(lot.opening.carrying);
  proposals.push({ lot, contractVersion: "d2-shared/v1", status: "conditional_uncommitted", instrumentFamily: "series_ee",
    operationId: JSON.stringify([...key, kind, lot.opening.at, effectiveAt]), claimId, kind, actorId: lot.personId,
    householdId: lot.householdId, beneficiaryId: lot.beneficiaryId, bondId: lot.bondId, lotId: lot.lotId, basisId: lot.basisId,
    wrapperId: lot.wrapperId, taxBucket: lot.taxBucket, effectiveAt, period, ruleSnapshotId: rule!.source.ruleSnapshotId,
    source: lot.holdingId, destination: redeem ? lot.destination.accountId : lot.holdingId,
    priority: redeem ? "movement" : "recognition", dependsOn: [],
    conditions: ["claim_uncommitted", "opening_checkpoint_still_current", "atomic_shared_owner_admission", "no_implicit_bank_transfer"],
    grossAmount: redeem ? cash : accrued.minus(lot.opening.carrying), cashDelta: cash, assetDelta: asset,
    basisDelta: redeem ? lot.purchaseCost.negated() : zero, netWorthDelta: cash.plus(asset), redeemedPrincipal: redeem ? lot.purchaseCost : zero,
    recognitionFacts: [{ character: "ee_interest_change", amount: cash.plus(asset) }], taxFacts: facts, values: values!,
    traceRefs: unique(sources.map(s => s.sourceId)), sources: [...sources] });
  return finish();
};
