import { ValidationError } from "../../../../../diagnostics/index.js";
import { domainId } from "../../../../../identity/index.js";
import { createObligation, createRight } from "../../../../../semantics/claim.js";
import { claimId, recognitionId, settlementId } from "../../../../../semantics/identity.js";
import { prepareSsaMedicareDeductionProposals, prepareSourcedSsaWithoutMedicare, type SsaDeductionSource } from "../../../../../semantics/settlement.js";
import { createIndexedRecognitionFact, type SsaMedicarePaymentInput } from "../../../../../state/index.js";
import { civilDate, instant } from "../../../../../time/index.js";
import { Money, USD } from "../../../../../values/index.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import { canonicalSerialize, type RunContext } from "../../../../run.js";
import { composeMedicareObligations } from "../../../health/medicare/coordination/index.js";
import { coordinateSocialSecurity } from "../../../retirement/benefits/coordination/index.js";
import type { SsaMedicarePaymentFacts } from "../index.js";
import { reviewSsaMedicareOriginals } from "../originalSources.js";
import type { NativeSsaMedicareOriginalInput } from "./index.js";

export const at = (date: string) => instant(`${date}T00:00:00.000Z`);
export const same = (a: unknown, b: unknown): boolean =>
  a === undefined || b === undefined ? a === b : canonicalSerialize(a) === canonicalSerialize(b);
export const orderedPayment = <T extends SsaMedicarePaymentFacts>(q: T): T => ({ ...q,
  deductions: [...q.deductions].sort((a, b) => a.terms.premium.part.localeCompare(b.terms.premium.part)) });
export const exact = (v: Money): boolean => v instanceof Money && v.currency.equals(USD) && v.amount.fitsScale(2) && !v.isNegative();
export function fail(code: string, message: string): never {
  throw new ValidationError({ severity: "error", code, entityType: "ssa_medicare_payment", message });
}

// Match every source field shared by the domain quote and the independently
// scoped legal evidence; source families/scope IDs retain their own contracts.
const lineage = (s: SsaDeductionSource, q: { readonly ruleSnapshotId: string; readonly version: string;
  readonly sourcePublication: string; readonly asOf: string; readonly jurisdiction: string; readonly projectionStatus: string }): boolean =>
  s.status === "verified" && q.projectionStatus === "verified" && s.jurisdiction === q.jurisdiction
  && s.ruleSnapshotId === q.ruleSnapshotId && s.version === q.version && s.sourcePublication === q.sourcePublication
  && s.asOf.slice(0, 10) === q.asOf;
export const knownBy = (value: unknown, cutoff: string): boolean => {
  if (value === null || typeof value !== "object" || value instanceof Money) return true;
  if (Array.isArray(value)) return value.every(v => knownBy(v, cutoff));
  return Object.entries(value).every(([key, v]) =>
    key === "nativeHousehold" ? true : ["asOf", "knownAt", "publishedAt"].includes(key) && typeof v === "string"
      ? (v.length === 10 ? at(v) : v) <= cutoff : knownBy(v, cutoff));
};

/** Recalculate both source owners and bind the complete exact deduction set. */
function qualifyPayment(q: SsaMedicarePaymentFacts, householdId: string, personId: string,
  reviewComposition: (value: ReturnType<typeof composeMedicareObligations>) => void,
  originalInput?: NativeSsaMedicareOriginalInput): SsaMedicarePaymentInput {
  const p = q.payable, award = q.award;
  const result = coordinateSocialSecurity(q.a1);
  const matches = result.proposals.filter(a => a.claimId === award.claimId);
  if (result.diagnostics.length || result.proposals.length !== 1 || matches.length !== 1 || !same(matches[0], award)
    || q.a1.householdId !== householdId || award.recipientPersonId !== personId
    || p.householdId !== householdId || p.recipientId !== personId || p.paymentId !== award.claimId
    || p.rightClaimId !== award.claimId || p.workerRecordId !== award.quotedAward.workerRecordPersonId
    || p.awardId !== award.quotedAward.awardId || p.entitlementId !== award.quotedAward.entitlementId
    || p.benefitKind !== award.quotedAward.benefitKind || !p.grossPayable.equals(award.grossAmount)
    || p.paymentAt !== at(award.effectiveAt) || !lineage(p.source, award.quotedAward.quote!.source))
    fail("SSA_SOURCE_NOT_ADMITTED", "Exact actual coordinated A1 recipient/worker/award/entitlement/installment and source required");
  const c = composeMedicareObligations(q.c2);
  reviewComposition(c);
  if (q.c2.premiums.householdId !== householdId || q.c2.premiums.memberIds.length !== 1
    || q.c2.premiums.memberIds[0] !== personId || c.medicareTotalCoverage !== "complete"
    || q.c2.awards.length !== 1 || !same(q.c2.awards[0], award.quotedAward))
    fail("MEDICARE_SOURCE_NOT_ADMITTED", "Actual complete same-recipient C2 source result and A1 quoted award required");
  const positive = c.obligations.filter(o => o.memberObligation.isPositive());
  if ((!positive.length && originalInput === undefined) || positive.length !== q.deductions.length || positive.some(o => !["part_b", "part_d"].includes(o.part))
    || q.deductions.some(d => !["part_b", "part_d"].includes(d.terms.premium.part))
    || c.obligations.some(o => o.personId !== personId || o.period.start.slice(0, 7) !== award.effectiveAt.slice(0, 7))
    || positive.some(o => o.intendedRoute.kind !== "ssa_benefit_deduction_pending" || o.intendedRoute.benefitId !== p.awardId))
    fail("SSA_MEDICARE_UNSUPPORTED_COVERAGE", "Only complete monthly B/D SSA deductions and explicit sourced-zero other Parts supported");
  const rightFact = createIndexedRecognitionFact({ id: recognitionId(p.rightRecognitionId), category: "ssa_gross_income",
    amount: p.grossPayable, recognizedAt: p.paymentAt });
  const right = createRight({ id: claimId(award.claimId), category: "ssa_benefit_payable", originatingRecognitionId: rightFact.id,
    economicOwnerId: domainId("person", personId), originalAmount: rightFact.amount, recognizedAt: p.paymentAt, dueAt: p.paymentAt });
  const requests = [...q.deductions].sort((a, b) => a.terms.premium.part.localeCompare(b.terms.premium.part)).map(({ draft, terms }) => {
    const e = terms.premium, rows = positive.filter(o => o.part === e.part), row = rows[0];
    const legal = q.c2.deductionTerms.filter(t => t.part === e.part && t.personId === personId
      && t.start <= e.periodStart && t.endExclusive >= e.periodEndExclusive);
    if (rows.length !== 1 || !row || legal.length !== 1 || !lineage(terms.source, legal[0]!.source)
      || !lineage(e.source, row.base.source) || e.householdId !== householdId || e.beneficiaryId !== personId
      || e.coverageId !== row.coverageId || e.providerId !== row.recipientId || terms.obligationId !== row.claimId
      || e.periodStart !== row.period.start || e.periodEndExclusive !== row.period.endExclusive
      || !e.base.equals(row.memberBase) || !e.irmaa.equals(row.surcharge) || !terms.amount.equals(row.memberObligation))
      fail("MEDICARE_SOURCE_NOT_ADMITTED", "Exact C2 Part/provider/coverage/month/base/IRMAA and legal source lineage required");
    const fact = createIndexedRecognitionFact({ id: recognitionId(terms.obligationRecognitionId), category: "medicare_expense",
      amount: row.memberObligation, recognizedAt: p.paymentAt });
    const claim = createObligation({ id: claimId(row.claimId), category: "medicare_premium", originatingRecognitionId: fact.id,
      economicOwnerId: domainId("person", personId), originalAmount: fact.amount, recognizedAt: p.paymentAt, dueAt: p.paymentAt });
    return { draft, terms, claim };
  });
  if (!requests.length && originalInput !== undefined) prepareSourcedSsaWithoutMedicare(p, right);
  else prepareSsaMedicareDeductionProposals(p, right, requests);
  const bank = q.bank, s = bank.evidence;
  if (bank.classification !== "BANK" || bank.householdId !== householdId || bank.personId !== personId || !exact(q.bankCashBefore))
    fail("SSA_BANK_NOT_ADMITTED", "Explicit source-known existing recipient-owned USD BANK and exact cash required");
  if (originalInput === undefined) {
    if (!s) fail("SSA_BANK_NOT_ADMITTED", "Recipient BANK ownership evidence is missing");
    const date = civilDate(p.paymentAt.slice(0, 10));
    civilDate(s.effectiveStart); civilDate(s.effectiveEndExclusive); instant(s.asOf); instant(s.publishedAt); instant(s.knownAt);
    if (s.status !== "verified" || s.jurisdiction !== "US" || s.ruleFamily !== "bank_ownership" || s.scopeId !== bank.accountId
      || ![s.ruleSnapshotId, s.version, s.sourcePublication].every(v => typeof v === "string" && v.trim().length > 0)
      || s.effectiveStart > date || s.effectiveEndExclusive <= date || s.asOf > s.knownAt || s.publishedAt > s.knownAt || s.knownAt > p.paymentAt)
      fail("SSA_BANK_NOT_ADMITTED", "Explicit source-known existing recipient-owned USD BANK required");
  }
  return immutableConfiguration({ ...(q.nativeHousehold === undefined ? {} : { nativeHousehold: q.nativeHousehold }), payable: p, right, requests, bankAccountId: bank.accountId, bankCashBefore: q.bankCashBefore,
    rightSettlementId: settlementId(q.rightSettlementId), sourceInputs: originalInput ?? orderedPayment(q) });
}

export function qualifyRawPayment(q: SsaMedicarePaymentFacts, householdId: string, personId: string, cutoff?: string,
  originalInput?: NativeSsaMedicareOriginalInput, observation?: Pick<RunContext, "asOf" | "dataCutoff">): SsaMedicarePaymentInput {
  try {
    const frozen = immutableConfiguration(q);
    if (frozen.originalSources !== undefined && !knownBy(frozen, frozen.originalSources.dataCutoff))
      fail("SSA_SOURCE_NOT_ADMITTED", "Every original-backed payment fact must be known by its forecast data cutoff");
    const review = reviewSsaMedicareOriginals(frozen, cutoff, observation);
    const qualified = qualifyPayment(frozen, householdId, personId, review.composition, originalInput);
    review.finish();
    return qualified;
  }
  catch (error) {
    if (error instanceof ValidationError) throw error;
    return fail("SSA_MEDICARE_SOURCE_INCOMPLETE", "Valid complete source-owned A1/C2 and withholding evidence required");
  }
}
