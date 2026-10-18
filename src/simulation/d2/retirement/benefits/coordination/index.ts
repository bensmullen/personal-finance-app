import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { Money } from "../../../../../values/index.js";
import { calculateQuotedBenefits, type BenefitPeriod, type BenefitSource, type QuotedBenefit } from "../index.js";

export interface Evidence {
  readonly evidenceId: string;
  readonly coverageSetId: string;
  readonly knownAt: CivilDate;
  readonly publishedAt: CivilDate;
  readonly effective: BenefitPeriod;
  readonly source: BenefitSource;
}
export interface EntitlementQuote {
  readonly quoteId: string;
  readonly role: "own" | "full_other" | "excess" | "total";
  readonly evidence: Evidence;
  readonly award: QuotedBenefit;
}
/** Legal findings are inputs, never deductions from age, PIA or relationships. */
export interface Determination {
  readonly determinationId: string;
  readonly electionId: string;
  readonly versionId: string;
  readonly evidence: Evidence;
  readonly inventoryComplete: boolean;
  readonly inventoryQuoteIds: readonly string[];
  readonly strategy: "own" | "own_plus_excess" | "replacement";
  readonly benefitKind: "ss_retirement" | "ss_spousal" | "ss_survivor";
  readonly ownQuoteId?: string;
  readonly excessQuoteId?: string;
  readonly totalQuoteId?: string;
  /** Stable SSA payment identities, not quote/version identifiers. */
  readonly paymentAwardId: string;
  readonly paymentEntitlementId: string;
  readonly paymentWorkerRecordPersonId: string;
  readonly claimingMonth: CivilDate;
  readonly installmentDay: string;
  readonly eligibility: "eligible" | "unknown";
  readonly relationship: "self" | "married" | "widowed" | "divorced" | "unknown";
  readonly relationshipEvidence?: Evidence;
  readonly unsupportedRules: readonly string[];
  readonly excessUnderOwn?: {
    readonly ownQuoteId: string;
    readonly claimedOwnAmount: Money;
    readonly evidence: Evidence;
  };
  readonly survivor?: {
    readonly workerRecordPersonId: string;
    readonly workerDeathDate: CivilDate;
    readonly effectiveAt: CivilDate;
    readonly deathMonthRuleId: string;
    readonly overlapRuleId: string;
    readonly partialMonthTerms: "whole_installment" | "unsupported";
    readonly evidence: Evidence;
  };
}
export interface Recipient {
  readonly recipientPersonId: string;
  readonly enabled: boolean;
  readonly recipientDeathDate?: CivilDate;
  readonly quotes: readonly EntitlementQuote[];
  readonly determinations: readonly Determination[];
}
export type DiagnosticCode = "MISSING_DETERMINATION" | "AMBIGUOUS_DETERMINATION" | "INCOMPLETE_INVENTORY"
  | "INVALID_IDENTITY" | "UNAVAILABLE_EVIDENCE" | "UNSUPPORTED_RULES" | "MISSING_ELIGIBILITY"
  | "MISSING_RELATIONSHIP" | "SOURCE_MIX" | "UNSUPPORTED_PAYMENT_STRUCTURE" | "UNQUALIFIED_EXCESS"
  | "TOTAL_CONFLICT" | "UNRESOLVED_SURVIVOR" | "RECIPIENT_DECEASED" | "INVALID_QUOTE" | "DUPLICATE_IDENTITY";
export interface CoordinatedPayableAward {
  readonly kind: "coordinated_payable_award";
  readonly committed: false;
  readonly recipientPersonId: string;
  readonly effectiveAt: CivilDate;
  readonly claimId: string;
  readonly grossAmount: Money;
  readonly quotedAward: QuotedBenefit;
  readonly workerRecordPersonIds: readonly string[];
  readonly entitlementIds: readonly string[];
  readonly traceRefs: readonly string[];
}
export interface CoordinationResult {
  readonly proposals: readonly CoordinatedPayableAward[];
  readonly recipientMonths: readonly { readonly recipientPersonId: string; readonly month: string;
    readonly coverage: "complete" | "incomplete" | "not_applicable" }[];
  readonly diagnostics: readonly { readonly recipientPersonId: string; readonly month: string;
    readonly diagnosticCode: DiagnosticCode; readonly affectedOutput: "gross_schedule";
    readonly coverage: "incomplete"; readonly traceRefs: readonly string[]; readonly detail: string }[];
}
class Incomplete extends Error {
  constructor(readonly code: DiagnosticCode, detail: string = code) { super(detail); }
}
function need(ok: boolean, code: DiagnosticCode, detail?: string): asserts ok {
  if (!ok) throw new Incomplete(code, detail);
}
const inside = (at: CivilDate, p: BenefitPeriod): boolean => at >= p.start && at < p.endExclusive;
const ids = (...values: string[]): boolean => values.every(v => Boolean(v?.trim()));
const validPeriod = (p: BenefitPeriod): void => {
  civilDate(p.start); civilDate(p.endExclusive);
  if (p.start >= p.endExclusive) throw new Error("INVALID_PERIOD");
};
const monthIndex = (at: CivilDate): number => Number(at.slice(0, 4)) * 12 + Number(at.slice(5, 7)) - 1;
const monthText = (n: number): string => `${String(Math.floor(n / 12)).padStart(4, "0")}-${String(n % 12 + 1).padStart(2, "0")}`;
const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort();
function immutable<T>(value: T): T {
  if (value instanceof Money || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(item => immutable(item))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, immutable(v)]))) as T;
}

/** Pure source-qualified coordination; A1 remains the gross computation owner.
 * Outputs cover individual installments with stable payment identity. No state,
 * tax, withholding, Medicare, settlement or integrated runtime participation.
 * This floor admits at-claim quotes only; unsupported legal facts fail closed.
 */
export function coordinateSocialSecurity(request: {
  readonly householdId: string;
  readonly knownAt: CivilDate;
  readonly horizon: BenefitPeriod;
  readonly recipients: readonly Recipient[];
}): CoordinationResult {
  validPeriod(request.horizon); civilDate(request.knownAt);
  if (!ids(request.householdId) || request.recipients.length > 64 ||
    monthIndex(request.horizon.endExclusive) - monthIndex(request.horizon.start) > 1200) throw new Error("INVALID_REQUEST");
  const proposals: CoordinatedPayableAward[] = [];
  const recipientMonths: CoordinationResult["recipientMonths"][number][] = [];
  const diagnostics: CoordinationResult["diagnostics"][number][] = [];
  for (const r of [...request.recipients].sort((a, b) => a.recipientPersonId < b.recipientPersonId ? -1 : a.recipientPersonId > b.recipientPersonId ? 1 : 0)) {
    for (let n = monthIndex(request.horizon.start); n <= monthIndex(request.horizon.endExclusive); n++) {
      const month = monthText(n), start = civilDate(`${month}-01`);
      if (start >= request.horizon.endExclusive) continue;
      const endExclusive = civilDate(`${monthText(n + 1)}-01`), refs: string[] = [];
      const evidence = (e: Evidence, at: CivilDate, setId: string): void => {
        refs.push(e.evidenceId, e.source.ruleSnapshotId);
        validPeriod(e.effective); civilDate(e.knownAt); civilDate(e.publishedAt); civilDate(e.source.asOf);
        need(ids(e.evidenceId, e.coverageSetId, e.source.ruleSnapshotId, e.source.version,
          e.source.sourcePublication, e.source.jurisdiction, e.source.ruleFamily), "INVALID_IDENTITY");
        need(e.coverageSetId === setId, "SOURCE_MIX");
        need(e.source.projectionStatus === "verified" && e.publishedAt <= e.knownAt &&
          e.source.asOf <= e.knownAt && e.knownAt <= request.knownAt && inside(at, e.effective), "UNAVAILABLE_EVIDENCE");
      };
      try {
        need(ids(r.recipientPersonId), "INVALID_IDENTITY");
        need(request.recipients.filter(x => x.recipientPersonId === r.recipientPersonId).length === 1, "DUPLICATE_IDENTITY");
        if (!r.enabled) {
          recipientMonths.push({ recipientPersonId: r.recipientPersonId, month, coverage: "not_applicable" }); continue;
        }
        const candidates = r.determinations.filter(d => d.evidence.effective.start < endExclusive && d.evidence.effective.endExclusive > start);
        need(candidates.length > 0, "MISSING_DETERMINATION");
        // Intramonth competing determinations require a revised single payable quote.
        need(candidates.length === 1, "AMBIGUOUS_DETERMINATION");
        const d = candidates[0]!;
        refs.push(d.determinationId, d.electionId, d.versionId);
        need(/^\d{2}$/.test(d.installmentDay), "UNSUPPORTED_PAYMENT_STRUCTURE");
        const at = civilDate(`${month}-${d.installmentDay}`);
        need(inside(at, request.horizon), "UNSUPPORTED_PAYMENT_STRUCTURE");
        evidence(d.evidence, at, d.evidence.coverageSetId);
        need(ids(d.determinationId, d.electionId, d.versionId, d.paymentAwardId,
          d.paymentEntitlementId, d.paymentWorkerRecordPersonId), "INVALID_IDENTITY");
        if (r.recipientDeathDate) { civilDate(r.recipientDeathDate); need(at < r.recipientDeathDate, "RECIPIENT_DECEASED"); }
        need(d.inventoryComplete && d.inventoryQuoteIds.length === r.quotes.length &&
          sorted(d.inventoryQuoteIds).length === d.inventoryQuoteIds.length &&
          r.quotes.every(q => d.inventoryQuoteIds.includes(q.quoteId)), "INCOMPLETE_INVENTORY");
        need(sorted(r.quotes.map(q => q.quoteId)).length === r.quotes.length, "DUPLICATE_IDENTITY");
        need(d.eligibility === "eligible", "MISSING_ELIGIBILITY");
        need(d.unsupportedRules.length === 0 && d.relationship !== "divorced", "UNSUPPORTED_RULES");
        need(d.relationship === (d.benefitKind === "ss_retirement" ? "self" : d.benefitKind === "ss_survivor" ? "widowed" : "married"), "MISSING_RELATIONSHIP");
        if (d.benefitKind !== "ss_retirement") {
          need(Boolean(d.relationshipEvidence), "MISSING_RELATIONSHIP"); evidence(d.relationshipEvidence!, at, d.evidence.coverageSetId);
        }
        for (const q of [...r.quotes].sort((a, b) => a.quoteId < b.quoteId ? -1 : a.quoteId > b.quoteId ? 1 : 0)) {
          need(ids(q.quoteId, q.award.entitlementId) && q.award.householdId === request.householdId &&
            q.award.recipientPersonId === r.recipientPersonId && q.award.benefitKind !== "pension", "INVALID_IDENTITY");
          evidence(q.evidence, at, d.evidence.coverageSetId);
          need(!q.award.verifiedAward || q.award.verifiedAward.unsupportedRules.length === 0, "UNSUPPORTED_RULES");
        }
        const get = (id: string | undefined, role: EntitlementQuote["role"]): EntitlementQuote | undefined => {
          if (id === undefined) return undefined;
          const q = r.quotes.find(x => x.quoteId === id); need(Boolean(q) && q!.role === role, "INVALID_QUOTE"); return q;
        };
        const own = get(d.ownQuoteId, "own"), excess = get(d.excessQuoteId, "excess"), total = get(d.totalQuoteId, "total");
        need(d.strategy === "own" ? Boolean(own && !excess && d.benefitKind === "ss_retirement") :
          d.strategy === "own_plus_excess" ? Boolean(own && excess && d.benefitKind !== "ss_retirement") :
          Boolean(total && !own && !excess && d.benefitKind !== "ss_retirement"), "UNQUALIFIED_EXCESS");
        need(!own || !excess || (own.award.entitlementId !== excess.award.entitlementId &&
          own.award.awardId !== excess.award.awardId), "DUPLICATE_IDENTITY");
        const selected = [own, excess, total].filter((q): q is EntitlementQuote => Boolean(q));
        const primary = total ?? excess ?? own!;
        need(primary.award.workerRecordPersonId === d.paymentWorkerRecordPersonId &&
          primary.award.benefitKind === d.benefitKind && primary.award.claimingMonth === d.claimingMonth, "INVALID_IDENTITY");
        const installment = { start: at, endExclusive };
        const gross = (q: EntitlementQuote): Money => {
          const a = q.award;
          need(a.frequency === "monthly" && a.commencement.slice(8) === d.installmentDay &&
            a.invalidDayPolicy === "skip" && Boolean(a.quote && a.cola && a.verifiedAward) &&
            !a.withholding && !a.medicareDeduction && !a.election && !a.participantDeathDate && !a.beneficiaryDeathDate,
          "UNSUPPORTED_PAYMENT_STRUCTURE");
          need(a.quote!.source.ruleSnapshotId === q.evidence.source.ruleSnapshotId &&
            a.quote!.asOf <= request.knownAt && a.calendarSource.asOf <= request.knownAt &&
            a.cola!.source.asOf <= request.knownAt && a.verifiedAward!.source.asOf <= request.knownAt &&
            a.cola!.changes.every(c => c.source.asOf <= request.knownAt), "UNAVAILABLE_EVIDENCE");
          for (const s of [a.quote!.source, a.calendarSource, a.cola!.source, a.verifiedAward!.source,
            ...a.cola!.changes.map(c => c.source)]) {
            need(s.ruleSnapshotId === q.evidence.source.ruleSnapshotId && s.version === q.evidence.source.version &&
              s.sourcePublication === q.evidence.source.sourcePublication && s.asOf === q.evidence.source.asOf &&
              s.projectionStatus === "verified", "SOURCE_MIX");
          }
          need(q.role !== "own" || (a.benefitKind === "ss_retirement" && a.workerRecordPersonId === r.recipientPersonId), "INVALID_IDENTITY");
          need(q.role !== "excess" || a.benefitKind === d.benefitKind, "INVALID_IDENTITY");
          need(a.quote!.basis === "at_claim", "INVALID_QUOTE");
          if (q.role === "excess") {
            // An excess is not itself a total payable award. Do not relabel its
            // VerifiedAward to trick A1 into treating it as an independent award.
            const quote = a.quote!, v = a.verifiedAward!;
            validPeriod(quote.coveredHorizon); validPeriod(v.coveredHorizon); validPeriod(a.cola!.coveredHorizon);
            need(quote.recipientPersonId === r.recipientPersonId && v.recipientPersonId === r.recipientPersonId &&
              quote.workerRecordPersonId === d.paymentWorkerRecordPersonId && v.workerRecordPersonId === d.paymentWorkerRecordPersonId &&
              a.workerRecordPersonId === d.paymentWorkerRecordPersonId && quote.claimingMonth === a.claimingMonth &&
              v.claimingMonth === a.claimingMonth && quote.asOf === quote.source.asOf &&
              quote.adjustmentOrder === "claiming_then_cola_then_continuation", "INVALID_IDENTITY");
            need(v.eligibility === "eligible" && v.unsupportedRules.length === 0, "MISSING_ELIGIBILITY");
            need(inside(at, quote.coveredHorizon) && inside(at, v.coveredHorizon) && inside(at, a.cola!.coveredHorizon) &&
              at >= a.commencement && (!a.endExclusive || at < a.endExclusive), "INVALID_QUOTE");
            need(quote.dollarBasisAt <= at && a.cola!.coveredHorizon.start <= quote.dollarBasisAt &&
              !a.cola!.changes.some(c => c.effectiveAt > quote.dollarBasisAt && c.effectiveAt <= at), "UNSUPPORTED_PAYMENT_STRUCTURE");
            need(!a.recipientDeathDate || at < a.recipientDeathDate, "RECIPIENT_DECEASED");
            need(d.benefitKind === "ss_survivor" || !a.workerDeathDate || at < a.workerDeathDate, "UNRESOLVED_SURVIVOR");
            need(d.benefitKind !== "ss_survivor" || (a.workerDeathDate === d.survivor?.workerDeathDate &&
              v.workerDeathDate === a.workerDeathDate), "UNRESOLVED_SURVIVOR");
            need(!quote.grossAmount.isNegative() && quote.grossAmount.amount.fitsScale(quote.grossAmount.currency.minorUnitScale), "INVALID_QUOTE");
            return quote.grossAmount;
          }
          const result = calculateQuotedBenefits({ householdId: request.householdId, horizon: installment, awards: [a] });
          need(result.proposals.length === 1 && result.diagnostics.length === 0, "INVALID_QUOTE", result.diagnostics.map(x => x.diagnosticCode).join(","));
          return result.proposals[0]!.grossAmount;
        };
        if (d.benefitKind === "ss_survivor") {
          const s = d.survivor; need(Boolean(s), "UNRESOLVED_SURVIVOR");
          evidence(s!.evidence, at, d.evidence.coverageSetId); civilDate(s!.workerDeathDate); civilDate(s!.effectiveAt);
          need(s!.workerRecordPersonId === d.paymentWorkerRecordPersonId && s!.workerDeathDate <= s!.effectiveAt &&
            at >= s!.effectiveAt && ids(s!.deathMonthRuleId, s!.overlapRuleId) && s!.partialMonthTerms === "whole_installment" &&
            primary.award.workerDeathDate === s!.workerDeathDate, "UNRESOLVED_SURVIVOR");
          refs.push(s!.deathMonthRuleId, s!.overlapRuleId);
        } else need(!d.survivor, "UNRESOLVED_SURVIVOR");
        let amount: Money;
        if (d.strategy === "own_plus_excess") {
          const attestation = d.excessUnderOwn;
          need(Boolean(attestation) && attestation!.ownQuoteId === own!.quoteId && own!.evidence.evidenceId !== excess!.evidence.evidenceId &&
            own!.award.quote?.dollarBasisAt === excess!.award.quote?.dollarBasisAt, "UNQUALIFIED_EXCESS");
          evidence(attestation!.evidence, at, d.evidence.coverageSetId);
          const ownAmount = gross(own!); need(attestation!.claimedOwnAmount.equals(ownAmount), "UNQUALIFIED_EXCESS");
          amount = ownAmount.plus(gross(excess!));
        } else amount = gross(d.strategy === "own" ? own! : total!);
        if (total) need(gross(total).equals(amount), "TOTAL_CONFLICT");
        need(selected.every(q => q.award.quote!.dollarBasisAt === primary.award.quote!.dollarBasisAt &&
          q.award.commencement.slice(8) === d.installmentDay), "UNSUPPORTED_PAYMENT_STRUCTURE");
        const p = primary.award;
        const quotedAward: QuotedBenefit = {
          // A1 requires distinct quote award IDs even for nonoverlapping periods.
          // Its claim identity uses the stable underlying entitlement and date.
          awardId: JSON.stringify([d.paymentAwardId, at]), entitlementId: d.paymentEntitlementId, householdId: request.householdId,
          recipientPersonId: r.recipientPersonId, workerRecordPersonId: d.paymentWorkerRecordPersonId,
          benefitKind: d.benefitKind, claimingMonth: d.claimingMonth, commencement: at, endExclusive,
          frequency: "monthly", invalidDayPolicy: "skip", calendarSource: p.calendarSource,
          quote: { ...p.quote!, grossAmount: amount, dollarBasisAt: at, coveredHorizon: installment,
            // A derived total is authorized by the legal determination, not by
            // pretending the excess source independently quoted a full award.
            source: total ? p.quote!.source : d.evidence.source,
            asOf: total ? p.quote!.asOf : d.evidence.source.asOf },
          cola: { source: d.evidence.source, coveredHorizon: installment, changes: [] },
          verifiedAward: { ...p.verifiedAward!, coordination: "total_payable_award", source: d.evidence.source, coveredHorizon: installment },
          ...(p.workerDeathDate ? { workerDeathDate: p.workerDeathDate } : {}),
          ...(r.recipientDeathDate ? { recipientDeathDate: r.recipientDeathDate } : {}),
        };
        const final = calculateQuotedBenefits({ householdId: request.householdId, horizon: installment, awards: [quotedAward] });
        need(final.proposals.length === 1 && final.diagnostics.length === 0, "INVALID_QUOTE");
        for (const q of selected) refs.push(q.quoteId, q.award.entitlementId, q.award.quote!.source.ruleSnapshotId,
          q.award.calendarSource.ruleSnapshotId, q.award.verifiedAward!.source.ruleSnapshotId,
          q.award.cola!.source.ruleSnapshotId, ...q.award.cola!.changes.map(c => c.source.ruleSnapshotId));
        proposals.push({ kind: "coordinated_payable_award", committed: false, recipientPersonId: r.recipientPersonId,
          effectiveAt: at, claimId: final.proposals[0]!.claimId, grossAmount: final.proposals[0]!.grossAmount, quotedAward,
          workerRecordPersonIds: sorted(r.quotes.map(q => q.award.workerRecordPersonId)),
          entitlementIds: sorted(r.quotes.map(q => q.award.entitlementId)), traceRefs: sorted(refs) });
        recipientMonths.push({ recipientPersonId: r.recipientPersonId, month, coverage: "complete" });
      } catch (error) {
        diagnostics.push({ recipientPersonId: r.recipientPersonId, month, diagnosticCode: error instanceof Incomplete ? error.code : "INVALID_QUOTE",
          affectedOutput: "gross_schedule", coverage: "incomplete", traceRefs: sorted(refs), detail: error instanceof Error ? error.message : "INVALID_QUOTE" });
        recipientMonths.push({ recipientPersonId: r.recipientPersonId, month, coverage: "incomplete" });
      }
    }
  }
  const collisions = proposals.filter(p => proposals.some(q => q !== p && q.recipientPersonId !== p.recipientPersonId &&
    (q.quotedAward.awardId === p.quotedAward.awardId || q.quotedAward.entitlementId === p.quotedAward.entitlementId)));
  for (const p of collisions) {
    const month = p.effectiveAt.slice(0, 7), row = recipientMonths.find(x => x.recipientPersonId === p.recipientPersonId && x.month === month)!;
    recipientMonths[recipientMonths.indexOf(row)] = { ...row, coverage: "incomplete" };
    diagnostics.push({ recipientPersonId: p.recipientPersonId, month, diagnosticCode: "DUPLICATE_IDENTITY", affectedOutput: "gross_schedule",
      coverage: "incomplete", traceRefs: p.traceRefs, detail: "Shared payment identity across recipients" });
  }
  return immutable({ proposals: proposals.filter(p => !collisions.includes(p)), recipientMonths, diagnostics });
}
