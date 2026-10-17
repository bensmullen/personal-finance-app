import { civilDate, type CivilDate } from "../../../../time/index.js";
import { decimal, Money, Ratio, RoundingPolicy } from "../../../../values/index.js";

/** Private A1 types preserving d2-shared/v1 logical seams; #149 owns adapters. */
export interface BenefitSource {
  readonly ruleSnapshotId: string;
  readonly jurisdiction: string;
  readonly ruleFamily: string;
  readonly sourcePublication: string;
  readonly asOf: CivilDate;
  readonly version: string;
  readonly projectionStatus: "verified" | "explicit_projected" | "unavailable";
}
export interface BenefitPeriod { readonly start: CivilDate; readonly endExclusive: CivilDate }
export interface SourcedFactor {
  readonly factor: Ratio;
  readonly rounding: RoundingPolicy;
  readonly source: BenefitSource;
}
export interface BenefitQuote {
  readonly recipientPersonId: string;
  readonly workerRecordPersonId: string;
  readonly claimingMonth: CivilDate;
  readonly electionId?: string;
  /** Source attests to this supported sequence and its factor rounding points.
   * Other statutory/plan rounding sequences require a revised payment quote. */
  readonly adjustmentOrder: "claiming_then_cola_then_continuation";
  readonly grossAmount: Money;
  readonly asOf: CivilDate;
  /** Only COLA events after this dollar-basis date apply. */
  readonly dollarBasisAt: CivilDate;
  readonly basis: "at_claim" | "full_retirement_age" | "post_election";
  readonly source: BenefitSource;
  readonly coveredHorizon: BenefitPeriod;
}
export interface ColaSchedule {
  /** Attests to the complete change list, including an explicitly empty list. */
  readonly coveredHorizon: BenefitPeriod;
  readonly source: BenefitSource;
  readonly changes: readonly (SourcedFactor & { readonly year: number; readonly effectiveAt: CivilDate })[];
}
export interface VerifiedAward {
  readonly recipientPersonId: string;
  readonly workerRecordPersonId: string;
  readonly claimingMonth: CivilDate;
  readonly workerDeathDate?: CivilDate;
  readonly coveredHorizon: BenefitPeriod;
  readonly source: BenefitSource;
  /** Caller resolves eligibility, earnings test and all applicable coordination.
   * SSA quotes are TOTAL payable awards, never independent full spouse awards. */
  readonly eligibility: "eligible" | "ineligible" | "unknown";
  readonly coordination: "total_payable_award" | "unknown";
  readonly unsupportedRules: readonly string[];
}
export interface PensionElection {
  readonly electionId: string;
  readonly form: string;
  readonly beneficiaryId?: string;
  readonly source: BenefitSource;
  readonly continuation?: SourcedFactor & {
    /** Fraction of the quoted elected participant installment, not an actuarial
     * election reduction. A quote already includes the chosen election. */
    readonly beneficiaryId: string;
    /** Sourced payment boundary, not an inferred death-month convention. */
    readonly effectiveAt: CivilDate;
    readonly coversDeathBeforeCommencement: boolean;
    readonly endExclusive?: CivilDate;
  };
}
export interface QuotedBenefit {
  readonly awardId: string;
  /** Stable underlying entitlement, independent of quote/version identifiers. */
  readonly entitlementId: string;
  readonly householdId: string;
  readonly recipientPersonId: string;
  readonly workerRecordPersonId: string;
  readonly sponsorId?: string;
  readonly beneficiaryId?: string;
  readonly benefitKind: "ss_retirement" | "ss_spousal" | "ss_survivor" | "pension";
  readonly claimingMonth: CivilDate;
  readonly commencement: CivilDate;
  readonly endExclusive?: CivilDate;
  readonly frequency: "monthly" | "annual";
  /** Whole quoted installments on the commencement day; no implicit proration. */
  readonly invalidDayPolicy: "skip";
  readonly calendarSource: BenefitSource;
  readonly quote?: BenefitQuote;
  readonly claimingAdjustment?: SourcedFactor;
  readonly verifiedAward?: VerifiedAward;
  readonly cola?: ColaSchedule;
  readonly election?: PensionElection;
  readonly participantDeathDate?: CivilDate;
  readonly beneficiaryDeathDate?: CivilDate;
  readonly recipientDeathDate?: CivilDate;
  readonly workerDeathDate?: CivilDate;
  /** Authored instructions only, not calculated tax credits or premiums. */
  readonly withholding?: { readonly amount: Money; readonly source: BenefitSource };
  readonly medicareDeduction?: { readonly amount: Money; readonly source: BenefitSource };
}
export interface BenefitDiagnostic {
  readonly sourceEntityPath: string;
  readonly period: BenefitPeriod;
  readonly affectedOutput: "gross_schedule";
  readonly coverage: "incomplete";
  readonly diagnosticCode: string;
  readonly missingFacts: readonly string[];
  readonly traceRefs: readonly string[];
}
export interface GrossPaymentProposal {
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "retirement_benefit_recognition_candidate";
  readonly committed: false;
  readonly householdId: string;
  readonly actorId: string;
  readonly workerRecordId: string;
  readonly sponsorId?: string;
  readonly benefitKind: QuotedBenefit["benefitKind"];
  readonly effectiveAt: CivilDate;
  readonly grossAmount: Money;
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
  readonly withholdingInstruction?: Money;
  readonly potentialMedicareDeduction?: Money;
  readonly settlementProposal: { readonly kind: "unrouted_gross_benefit"; readonly committed: false };
}
export interface RecipientMonth {
  readonly awardId: string;
  readonly recipientPersonId: string;
  readonly month: string;
  readonly effectiveAt: CivilDate;
  readonly coverage: "complete" | "incomplete";
  /** Absent when incomplete; zero requires explicitly supplied terms. */
  readonly grossAmount?: Money;
}
export interface BenefitResult {
  readonly contract: "d2-shared/v1";
  readonly proposals: readonly GrossPaymentProposal[];
  readonly recipientMonths: readonly RecipientMonth[];
  readonly diagnostics: readonly BenefitDiagnostic[];
  readonly coverage: {
    readonly grossSchedule: "complete" | "incomplete";
    readonly statutoryCalculation: "not_applicable";
    readonly tax: "incomplete";
    readonly netCash: "incomplete";
    readonly postings: "not_applicable";
  };
}

const need = (ok: boolean, code: string): void => { if (!ok) throw new Error(code); };
const dated = (at: CivilDate): void => { civilDate(at); };
const validPeriod = (p: BenefitPeriod): void => { dated(p.start); dated(p.endExclusive); need(p.start < p.endExclusive, "INVALID_PERIOD"); };
const inside = (at: CivilDate, p: BenefitPeriod): boolean => at >= p.start && at < p.endExclusive;
const qualified = (s: BenefitSource): void => {
  need(Boolean(s), "MISSING_SOURCE"); dated(s.asOf);
  need([s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(x => x.trim().length > 0), "MISSING_SOURCE_IDENTITY");
  need(s.projectionStatus === "verified", "UNVERIFIED_SOURCE");
};
const exactMoney = (value: Money, currency: Money): void => {
  need(value.currency.equals(currency.currency), "CURRENCY_MISMATCH");
  need(!value.isNegative() && value.amount.fitsScale(value.currency.minorUnitScale), "INVALID_EXACT_MONEY");
};
const factor = (term: SourcedFactor, value: Money): Money => {
  qualified(term.source); need(!term.factor.value.isNegative(), "NEGATIVE_FACTOR");
  need(Number.isSafeInteger(term.rounding.scale) && term.rounding.scale >= 0 && term.rounding.scale <= value.currency.minorUnitScale, "INVALID_ROUNDING_SCALE");
  need(["half_up", "half_even", "toward_zero", "away_from_zero", "floor", "ceiling"].includes(term.rounding.mode), "INVALID_ROUNDING_MODE");
  return value.times(term.factor.value).round(term.rounding);
};
const monthIndex = (at: CivilDate): number => Number(at.slice(0, 4)) * 12 + Number(at.slice(5, 7)) - 1;
const monthText = (n: number): string => `${Math.floor(n / 12).toString().padStart(4, "0")}-${(n % 12 + 1).toString().padStart(2, "0")}`;
const overlaps = (a: BenefitPeriod, b: BenefitPeriod): boolean => a.start < b.endExclusive && b.start < a.endExclusive;
const active = (a: QuotedBenefit): BenefitPeriod => ({ start: a.commencement, endExclusive: a.endExclusive ?? civilDate("9999-12-31") });
const key = (parts: readonly string[]): string => JSON.stringify(parts);

/** Pure quoted installments, bounded to 64 awards / 1,200 months per call.
 * Malformed request envelopes throw; unsupported award facts are diagnostics.
 * No state, capacity, tax or cash posting. #149 validates canonical identities. */
export function calculateQuotedBenefits(request: {
  readonly householdId: string;
  readonly horizon: BenefitPeriod;
  readonly awards: readonly QuotedBenefit[];
}): BenefitResult {
  validPeriod(request.horizon); need(request.householdId.trim().length > 0, "MISSING_HOUSEHOLD");
  need(request.awards.length <= 64 && monthIndex(request.horizon.endExclusive) - monthIndex(request.horizon.start) <= 1200, "REQUEST_LIMIT");
  const proposals: GrossPaymentProposal[] = [], recipientMonths: RecipientMonth[] = [];
  const diagnostics: BenefitDiagnostic[] = [];
  let incomplete = false;
  // Presentation order only: conflicting SSA awards are rejected together.
  const awards = [...request.awards].sort((a, b) => a.awardId < b.awardId ? -1 : a.awardId > b.awardId ? 1 : 0);
  const diagnose = (a: QuotedBenefit, code: string): void => {
    incomplete = true;
    if (diagnostics.some(d => d.sourceEntityPath === key(["awards", a.awardId]) && d.diagnosticCode === code)) return;
    const sourceId = a.quote?.source?.ruleSnapshotId;
    diagnostics.push({ sourceEntityPath: key(["awards", a.awardId]), period: { ...request.horizon }, affectedOutput: "gross_schedule", coverage: "incomplete", diagnosticCode: code, missingFacts: [code], traceRefs: sourceId ? [sourceId] : [] });
  };
  for (const a of awards) {
    let base: Money;
    let changes: ColaSchedule["changes"];
    try {
      need([a.awardId, a.entitlementId, a.recipientPersonId, a.workerRecordPersonId].every(x => x.trim().length > 0) && a.householdId === request.householdId, "INVALID_IDENTITY");
      dated(a.commencement); dated(a.claimingMonth);
      need(a.claimingMonth.endsWith("-01") && a.claimingMonth <= a.commencement, "INVALID_CLAIMING_MONTH");
      if (a.endExclusive) { dated(a.endExclusive); need(a.endExclusive >= a.commencement, "INVALID_END"); }
      if (a.participantDeathDate) dated(a.participantDeathDate);
      if (a.beneficiaryDeathDate) dated(a.beneficiaryDeathDate);
      if (a.recipientDeathDate) dated(a.recipientDeathDate);
      if (a.workerDeathDate) dated(a.workerDeathDate);
      need(a.frequency === "monthly" || a.frequency === "annual", "UNSUPPORTED_FREQUENCY");
      need(a.invalidDayPolicy === "skip", "MISSING_CALENDAR_CONVENTION"); qualified(a.calendarSource);
      need(awards.filter(b => b.awardId === a.awardId).length === 1, "DUPLICATE_AWARD");
      need(!awards.some(b => b !== a && b.entitlementId === a.entitlementId && overlaps(active(a), active(b))), "DUPLICATE_ENTITLEMENT");
      const q = a.quote; need(Boolean(q), "MISSING_QUOTE"); if (!q) continue;
      qualified(q.source); dated(q.asOf); dated(q.dollarBasisAt); validPeriod(q.coveredHorizon);
      need(q.adjustmentOrder === "claiming_then_cola_then_continuation", "UNSUPPORTED_ADJUSTMENT_ORDER");
      need(q.recipientPersonId === a.recipientPersonId && q.workerRecordPersonId === a.workerRecordPersonId && q.claimingMonth === a.claimingMonth, "QUOTE_IDENTITY_MISMATCH");
      need(q.source.asOf === q.asOf && q.dollarBasisAt <= a.commencement, "INVALID_QUOTE_DATE_BASIS");
      base = q.grossAmount; exactMoney(base, base);
      need(Boolean(a.cola), "MISSING_COLA_COVERAGE"); if (!a.cola) continue;
      qualified(a.cola.source); validPeriod(a.cola.coveredHorizon);
      need(a.cola.coveredHorizon.start <= q.dollarBasisAt, "MISSING_COLA_HISTORY");
      need(a.cola.changes.length <= 1200, "COLA_LIMIT");
      changes = [...a.cola.changes].sort((x, y) => x.effectiveAt < y.effectiveAt ? -1 : x.effectiveAt > y.effectiveAt ? 1 : 0);
      for (const c of changes) {
        dated(c.effectiveAt); factor(c, base);
        need(c.year === Number(c.effectiveAt.slice(0, 4)) && inside(c.effectiveAt, a.cola.coveredHorizon), "INVALID_COLA_DATE");
        need(changes.filter(x => x.effectiveAt === c.effectiveAt).length === 1, "AMBIGUOUS_COLA");
      }
      if (a.benefitKind === "pension") {
        need(!a.recipientDeathDate && !a.workerDeathDate, "USE_PENSION_MORTALITY_FIELDS");
        need(Boolean(a.sponsorId?.trim()) && a.recipientPersonId === a.workerRecordPersonId, "INVALID_PENSION_PARTICIPANT");
        need(Boolean(a.election) && q.basis === "post_election", "MISSING_QUOTED_ELECTION"); if (!a.election) continue;
        qualified(a.election.source);
        need(q.electionId === a.election.electionId, "QUOTE_ELECTION_MISMATCH");
        need(Boolean(a.election.electionId.trim() && a.election.form.trim()) && a.election.beneficiaryId === a.beneficiaryId, "INCORRECT_BENEFICIARY");
        const c = a.election.continuation;
        if (c) {
          need(Boolean(c.beneficiaryId.trim()) && c.beneficiaryId === a.beneficiaryId && c.beneficiaryId !== a.recipientPersonId, "INCORRECT_BENEFICIARY");
          dated(c.effectiveAt);
          // A contracted survivor election exists even when the modeled participant remains alive.
          if (a.participantDeathDate) need(c.effectiveAt >= a.participantDeathDate, "INVALID_DEATH_TRANSITION");
          if (c.endExclusive) { dated(c.endExclusive); need(c.endExclusive >= c.effectiveAt, "INVALID_CONTINUATION_END"); }
          factor(c, base); need(c.factor.value.compare(decimal("1")) <= 0, "INVALID_SURVIVOR_FRACTION");
        }
      } else {
        need(!a.participantDeathDate && !a.beneficiaryDeathDate, "USE_SSA_MORTALITY_FIELDS");
        need(["ss_retirement", "ss_spousal", "ss_survivor"].includes(a.benefitKind), "UNSUPPORTED_BENEFIT_KIND");
        need(a.benefitKind === "ss_retirement" ? a.recipientPersonId === a.workerRecordPersonId : a.recipientPersonId !== a.workerRecordPersonId, "INVALID_WORKER");
        need(!awards.some(b => b !== a && b.benefitKind !== "pension" && b.recipientPersonId === a.recipientPersonId && overlaps(active(a), active(b))), "UNCOORDINATED_SSA_AWARDS");
        const v = a.verifiedAward; need(Boolean(v), "MISSING_VERIFIED_ELIGIBILITY"); if (!v) continue;
        qualified(v.source); validPeriod(v.coveredHorizon);
        need(v.recipientPersonId === a.recipientPersonId && v.workerRecordPersonId === a.workerRecordPersonId && v.claimingMonth === a.claimingMonth && v.workerDeathDate === a.workerDeathDate, "INCORRECT_AWARD_RECIPIENT");
        need(a.benefitKind !== "ss_survivor" || Boolean(a.workerDeathDate && a.workerDeathDate <= a.commencement), "MISSING_SURVIVOR_DEATH_FACT");
        need(v.eligibility !== "unknown" && v.coordination === "total_payable_award" && v.unsupportedRules.length === 0, "UNRESOLVED_SSA_RULES");
        need(q.basis === "at_claim" || q.basis === "full_retirement_age", "INVALID_SSA_QUOTE_BASIS");
        if (q.basis === "full_retirement_age") {
          need(Boolean(a.claimingAdjustment), "MISSING_CLAIMING_ADJUSTMENT");
          if (a.claimingAdjustment) base = factor(a.claimingAdjustment, base);
        }
      }
      // At-claim/post-election quotes deliberately receive no second adjustment.
      for (const instruction of [a.withholding, a.medicareDeduction]) if (instruction) { qualified(instruction.source); exactMoney(instruction.amount, base); }
    } catch (error) { diagnose(a, error instanceof Error ? error.message : "INVALID_AWARD"); continue; }
    for (let m = monthIndex(request.horizon.start); m <= monthIndex(request.horizon.endExclusive); m += 1) {
      if (a.frequency === "annual" && (m - monthIndex(a.commencement)) % 12 !== 0) continue;
      let at: CivilDate;
      try { at = civilDate(`${monthText(m)}-${a.commencement.slice(8, 10)}`); } catch { continue; }
      if (!inside(at, request.horizon) || !inside(at, active(a))) continue;
      let recipient = a.recipientPersonId;
      try {
        const q = a.quote!;
        need(inside(at, q.coveredHorizon) && inside(at, a.cola!.coveredHorizon), "UNCOVERED_QUOTE_OR_COLA");
        const refs = [q.source.ruleSnapshotId, a.calendarSource.ruleSnapshotId, a.cola!.source.ruleSnapshotId];
        let amount = base;
        for (const c of changes) if (c.effectiveAt > q.dollarBasisAt && c.effectiveAt <= at) { amount = factor(c, amount); refs.push(c.source.ruleSnapshotId); }
        if (a.benefitKind === "pension") {
          refs.push(a.election!.source.ruleSnapshotId);
          const c = a.election!.continuation;
          if (a.participantDeathDate && at >= a.participantDeathDate) {
            need(Boolean(c), "MISSING_CONTINUATION_TERMS"); if (!c) continue;
            need(a.participantDeathDate >= a.commencement || c.coversDeathBeforeCommencement, "UNSUPPORTED_PRECOMMENCEMENT_DEATH");
            // A dead participant cannot continue earning installments while the survivor award is not yet effective.
            // The plan's death-month/gap payment rule is outside this quote contract: flag unknown, never post cash.
            need(at >= c.effectiveAt, "UNVERIFIED_PENSION_DEATH_TRANSITION_GAP");
            if (at >= c.effectiveAt) {
              recipient = c.beneficiaryId;
              if (c.endExclusive && at >= c.endExclusive) continue;
              need(!a.beneficiaryDeathDate || at < a.beneficiaryDeathDate, "MISSING_BENEFICIARY_DEATH_TERMS");
              amount = factor(c, amount); refs.push(c.source.ruleSnapshotId);
            }
          }
        } else {
          const v = a.verifiedAward!; need(inside(at, v.coveredHorizon), "UNCOVERED_ELIGIBILITY");
          need(!a.recipientDeathDate || at < a.recipientDeathDate, "SSA_DEATH_REQUIRES_REVISED_AWARD");
          need(a.benefitKind === "ss_survivor" || !a.workerDeathDate || at < a.workerDeathDate, "SSA_DEATH_REQUIRES_REVISED_AWARD");
          refs.push(v.source.ruleSnapshotId);
          if (q.basis === "full_retirement_age") refs.push(a.claimingAdjustment!.source.ruleSnapshotId);
          if (v.eligibility === "ineligible") continue;
        }
        for (const instruction of [a.withholding, a.medicareDeduction]) if (instruction) refs.push(instruction.source.ruleSnapshotId);
        const operationId = key(["d2-quoted-benefit/v1", request.householdId, a.entitlementId, recipient, at]);
        recipientMonths.push({ awardId: a.awardId, recipientPersonId: recipient, month: monthText(m), effectiveAt: at, coverage: "complete", grossAmount: amount });
        proposals.push({ operationId, claimId: operationId, kind: "retirement_benefit_recognition_candidate", committed: false,
          householdId: request.householdId, actorId: recipient, workerRecordId: a.workerRecordPersonId,
          ...(a.sponsorId ? { sponsorId: a.sponsorId } : {}), benefitKind: a.benefitKind, effectiveAt: at, grossAmount: amount,
          ruleSnapshotId: q.source.ruleSnapshotId, traceRefs: [...new Set(refs)].sort(),
          ...(a.withholding && recipient === a.recipientPersonId ? { withholdingInstruction: a.withholding.amount } : {}),
          ...(a.medicareDeduction && recipient === a.recipientPersonId ? { potentialMedicareDeduction: a.medicareDeduction.amount } : {}),
          settlementProposal: { kind: "unrouted_gross_benefit", committed: false } });
      } catch (error) {
        diagnose(a, error instanceof Error ? error.message : "INVALID_PAYMENT");
        recipientMonths.push({ awardId: a.awardId, recipientPersonId: recipient, month: monthText(m), effectiveAt: at, coverage: "incomplete" });
      }
    }
  }
  return { contract: "d2-shared/v1", proposals, recipientMonths, diagnostics,
    coverage: { grossSchedule: incomplete ? "incomplete" : "complete", statutoryCalculation: "not_applicable", tax: "incomplete", netCash: "incomplete", postings: "not_applicable" } };
}
