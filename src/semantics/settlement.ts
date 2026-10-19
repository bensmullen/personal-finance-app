import { failValidation, issueCodes } from "../diagnostics/index.js";
import {
  assertAcceptedFundingResolution,
  type AcceptedFundingResolution,
  type FundingAllocation,
} from "../funding/resolution.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type FactProvenance } from "../model/provenance.js";
import { civilDate, instant, type CivilDate, type Instant } from "../time/index.js";
import { Money, money } from "../values/index.js";
import type { ObligationOrRight } from "./claim.js";
import { appendSettlementIdentity, assertClaimInvariant } from "./claim.js";
import { settlementProposalId } from "./identity.js";
import { createSettlementProposal } from "./settlementProposal.js";
import type { ClaimId, SettlementId, SettlementProposalId } from "./identity.js";

interface SettlementData {
  readonly id: SettlementId;
  readonly proposalId: SettlementProposalId;
  readonly claimId: ClaimId;
  readonly amount: Money;
  readonly settledAt: Instant;
  readonly fundingAllocations: readonly FundingAllocation[];
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

declare const settlementAuthority: unique symbol;
const authoritativeSettlements = new WeakSet<object>();
const deductionClaims = new WeakMap<object, ObligationOrRight>();

export interface SettlementDraft {
  readonly id: SettlementId;
  readonly settledAt: Instant;
  readonly provenance?: FactProvenance;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export type Settlement = Readonly<SettlementData> & {
  readonly [settlementAuthority]: true;
};

export const createSettlement = (
  draft: SettlementDraft,
  acceptedFunding: AcceptedFundingResolution,
  claim: ObligationOrRight,
  existingSettlementIds: Iterable<string> = [],
): Settlement => {
  assertAcceptedFundingResolution(acceptedFunding);
  const proposal = acceptedFunding.proposal;
  const amount = acceptedFunding.acceptedAmount;
  const fundingAllocations = acceptedFunding.fundingAllocations;
  const indexed = existingSettlementIds as Iterable<string> & { readonly hasIdentity?: (id: string) => boolean };
  if ((indexed.hasIdentity?.(draft.id) ?? new Set(existingSettlementIds).has(draft.id)) || claim.settlementIds.includes(draft.id)) {
    failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Duplicate settlement ${draft.id}`, entityType: "settlement", entityId: draft.id });
  }
  if (proposal.claimId !== claim.id) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: "Funding proposal and claim identities must match", entityType: "settlement", entityId: draft.id });
  }
  if (!amount.isPositive()) {
    failValidation({ severity: "error", code: issueCodes.settlementAmountInvalid, message: "Settlement amount must be positive", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (!amount.currency.equals(claim.outstandingAmount.currency)) {
    failValidation({ severity: "error", code: issueCodes.settlementCurrencyMismatch, message: "Settlement currency must match claim currency", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (amount.compare(proposal.requestedAmount) > 0 || amount.compare(claim.outstandingAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementExceedsOutstanding, message: "Settlement exceeds its proposal or outstanding claim amount", entityType: "settlement", entityId: draft.id, fieldPath: "amount" });
  }
  if (draft.settledAt < claim.recognizedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeRecognition, message: "Settlement cannot precede recognition", entityType: "settlement", entityId: draft.id, fieldPath: "settledAt" });
  }
  if (draft.settledAt < proposal.requestedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeProposal, message: "Settlement cannot precede its proposal", entityType: "settlement", entityId: draft.id, fieldPath: "settledAt" });
  }
  if (draft.settledAt < acceptedFunding.outcome.evaluatedAt) {
    failValidation({ severity: "error", code: issueCodes.settlementBeforeFunding, message: "Settlement cannot precede its funding evaluation", entityType: "settlement", entityId: draft.id, fieldPath: "settledAt" });
  }
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  const settlement = Object.freeze({
    id: draft.id,
    proposalId: proposal.id,
    claimId: proposal.claimId,
    amount,
    settledAt: draft.settledAt,
    fundingAllocations: Object.freeze(fundingAllocations.map((allocation) => Object.freeze({ ...allocation }))),
    ...(draft.provenance === undefined ? {} : { provenance: createFactProvenance(draft.provenance) }),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as Settlement;
  authoritativeSettlements.add(settlement);
  return settlement;
};

export const applySettlement = (claim: ObligationOrRight, settlement: Settlement): ObligationOrRight => {
  if (!authoritativeSettlements.has(settlement)) {
    failValidation({ severity: "error", code: issueCodes.settlementNotAuthoritative, message: "Only the exact settlement created by createSettlement may be applied", entityType: "settlement" });
  }
  const deductionClaim = deductionClaims.get(settlement);
  if (deductionClaim !== undefined && deductionClaim !== claim) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: "SSA deduction requires the exact authorized Medicare obligation", entityType: "settlement", entityId: settlement.id });
  }
  if (settlement.claimId !== claim.id) {
    failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: `Settlement ${settlement.id} does not apply to claim ${claim.id}`, entityType: "settlement", entityId: settlement.id });
  }
  if (claim.settlementIds.includes(settlement.id)) {
    failValidation({ severity: "error", code: issueCodes.duplicateSettlement, message: `Duplicate settlement ${settlement.id}`, entityType: "settlement", entityId: settlement.id });
  }
  if (settlement.amount.compare(claim.outstandingAmount) > 0) {
    failValidation({ severity: "error", code: issueCodes.settlementExceedsOutstanding, message: "Settlement exceeds outstanding claim amount", entityType: "settlement", entityId: settlement.id });
  }
  return Object.freeze({
    ...claim,
    outstandingAmount: claim.outstandingAmount.minus(settlement.amount),
    settlementIds: appendSettlementIdentity(claim.settlementIds, settlement.id, claim.id),
  });
};

/** Already verified external facts are the trust boundary, as for A1/C2 quotes.
 * This interface does not authenticate publications or calculate benefits/taxes.
 * Source scope attests the complete enclosing fact, including amounts/identities.
 */
export interface SsaDeductionSource {
  readonly scopeId: string;
  readonly ruleSnapshotId: string;
  readonly ruleFamily: string;
  readonly version: string;
  readonly sourcePublication: string;
  readonly jurisdiction: "US";
  readonly status: "verified" | "unknown" | "unsupported";
  readonly effectiveStart: CivilDate;
  readonly effectiveEndExclusive: CivilDate;
  readonly asOf: Instant;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
}

export interface SsaPayableIdentity {
  readonly householdId: string;
  readonly recipientId: string;
  readonly workerRecordId: string;
  readonly awardId: string;
  readonly entitlementId: string;
  readonly paymentId: string;
  readonly rightClaimId: ClaimId;
  readonly rightRecognitionId: string;
  readonly paymentAt: Instant;
}

export interface SsaPayableEvidence extends SsaPayableIdentity {
  readonly kind: "coordinated_ssa_payable";
  readonly benefitKind: "ss_retirement" | "ss_spousal" | "ss_survivor";
  readonly eligibility: "eligible" | "unknown";
  readonly grossPayable: Money;
  readonly source: SsaDeductionSource;
}

export interface MedicarePremiumEvidence {
  readonly evidenceId: string;
  readonly householdId: string;
  readonly beneficiaryId: string;
  readonly part: "part_a" | "part_b" | "part_d" | "advantage" | "medigap" | "supplement";
  readonly coverageId: string;
  readonly providerId: string;
  readonly periodStart: CivilDate;
  readonly periodEndExclusive: CivilDate;
  readonly status: "complete" | "unknown" | "unsupported";
  readonly base: Money;
  /** Explicit zero is required when no surcharge applies. */
  readonly irmaa: Money;
  readonly source: SsaDeductionSource;
}

export interface SsaMedicareDeductionTerms {
  readonly authorizationId: string;
  readonly receiptId: string;
  readonly traceId: string;
  readonly route: "ssa_payable_deduction";
  readonly payable: SsaPayableIdentity;
  readonly premium: MedicarePremiumEvidence;
  /** Independent scope named by the legal deduction instruction. */
  readonly premiumScope: Readonly<Pick<MedicarePremiumEvidence, "evidenceId" | "householdId" | "beneficiaryId"
    | "part" | "coverageId" | "providerId" | "periodStart" | "periodEndExclusive">>;
  readonly obligationId: ClaimId;
  readonly obligationRecognitionId: string;
  readonly amount: Money;
  readonly partialDeduction: "forbidden";
  readonly source: SsaDeductionSource;
}

export interface SsaDeductionRequest {
  readonly draft: SettlementDraft;
  readonly claim: ObligationOrRight;
  readonly terms: SsaMedicareDeductionTerms;
}

export interface SsaDeductionReceipt {
  readonly kind: "ssa_payable_deduction";
  readonly committed: false;
  readonly settlement: Settlement;
  readonly payable: SsaPayableEvidence;
  readonly terms: SsaMedicareDeductionTerms;
  readonly sourceState: Readonly<Pick<SsaCommittedConsumption, "stateId" | "asOf" | "committedReceiptIds" | "source">>;
}
const deductionReceipts = new WeakSet<object>();

/** A state adapter must attest the COMPLETE committed receipt inventory at the
 * event, including an explicitly empty inventory. No remaining-balance input.
 * Receipts retain in-process factory identity; deserialization is outside this
 * interface-only phase. The source attests stateId, paymentId, asOf and the full
 * committedReceiptIds inventory. This factory never commits those receipts.
 */
export interface SsaCommittedConsumption {
  readonly stateId: string;
  readonly complete: true;
  readonly paymentId: string;
  readonly asOf: Instant;
  readonly committedReceiptIds: readonly string[];
  readonly receipts: readonly SsaDeductionReceipt[];
  readonly source: SsaDeductionSource;
}

const deductionInvalid = (message: string): never => failValidation({ severity: "error",
  code: issueCodes.settlementAmountInvalid, message, entityType: "ssa_payable_deduction" });
function requireDeduction(ok: boolean, message: string): asserts ok {
  if (!ok) deductionInvalid(message);
}
const nonempty = (value: string): boolean => typeof value === "string" && value.trim().length > 0;
const cents = (value: Money): boolean => value instanceof Money && value.currency.code === "USD"
  && value.amount.fitsScale(2) && !value.isNegative();
const identityFields = ["householdId", "recipientId", "workerRecordId", "awardId", "entitlementId",
  "paymentId", "rightClaimId", "rightRecognitionId", "paymentAt"] as const;
const samePayable = (a: SsaPayableIdentity, b: SsaPayableIdentity): boolean =>
  identityFields.every(key => a[key] === b[key]);
const sameDeductionSource = (a: SsaDeductionSource, b: SsaDeductionSource): boolean =>
  (["scopeId", "ruleSnapshotId", "ruleFamily", "version", "sourcePublication", "jurisdiction", "status",
    "effectiveStart", "effectiveEndExclusive", "asOf", "publishedAt", "knownAt"] as const).every(key => a[key] === b[key]);
const partPeriodKey = (p: MedicarePremiumEvidence): string => JSON.stringify([
  p.householdId, p.beneficiaryId, p.part, p.periodStart, p.periodEndExclusive,
]);
const immutableDeduction = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || value instanceof Money) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(item => immutableDeduction(item))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableDeduction(item)]))) as T;
};
const qualifyDeductionSource = (s: SsaDeductionSource, scopeId: string, family: string,
  at: Instant, start: CivilDate, endExclusive: CivilDate): void => {
  instant(at); instant(s.asOf); instant(s.publishedAt); instant(s.knownAt);
  civilDate(start); civilDate(endExclusive); civilDate(s.effectiveStart); civilDate(s.effectiveEndExclusive);
  requireDeduction(s.status === "verified" && s.jurisdiction === "US" && s.scopeId === scopeId
    && s.ruleFamily === family && [scopeId, s.ruleSnapshotId, s.version, s.sourcePublication].every(nonempty)
    && start < endExclusive && s.effectiveStart <= start && s.effectiveEndExclusive >= endExclusive
    && s.effectiveStart < s.effectiveEndExclusive && s.asOf <= at && s.publishedAt <= s.knownAt
    && s.knownAt <= at, "Complete effective event-known verified source required");
};
const validatePremium = (p: MedicarePremiumEvidence, at: Instant): void => {
  requireDeduction(p.status === "complete" && [p.evidenceId, p.householdId, p.beneficiaryId,
    p.coverageId, p.providerId].every(nonempty)
    && ["part_a", "part_b", "part_d", "advantage", "medigap", "supplement"].includes(p.part)
    && cents(p.base) && cents(p.irmaa), "Complete exact-cent base and IRMAA evidence required");
  const start = civilDate(p.periodStart), end = civilDate(p.periodEndExclusive);
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  requireDeduction(start.endsWith("-01") && date.toISOString().slice(0, 10) === end,
    "Medicare evidence must cover exactly one whole calendar month");
  qualifyDeductionSource(p.source, p.evidenceId, "medicare_premium", at, start, end);
};

/** Explicit sourced zero is conditional coverage evidence, never accounting.
 * Missing, partial or unsupported evidence cannot imply a free premium.
 */
export const createZeroMedicareCoverageEvidence = (premium: MedicarePremiumEvidence | undefined, at: Instant) => {
  try {
    requireDeduction(premium !== undefined, "Premium evidence missing");
    validatePremium(premium, at);
    requireDeduction(premium.base.isZero() && premium.irmaa.isZero(), "Explicit zero base and IRMAA required");
    return immutableDeduction({ status: "complete" as const, kind: "medicare_no_payment_evidence" as const,
      committed: false as const, premium });
  } catch {
    return Object.freeze({ status: "incomplete" as const });
  }
};

/** Pure all-or-nothing authorization for one actual gross SSA installment.
 * No source debit, reservation, posting, net deposit or tax credit is committed.
 * The next participant must atomically recheck/commit the receipts against state.
 */
export const createSsaBenefitDeductionSettlement = (
  payable: SsaPayableEvidence,
  right: ObligationOrRight,
  requests: readonly SsaDeductionRequest[],
  consumption: SsaCommittedConsumption,
  existingSettlementIds: Iterable<string>,
) => {
  assertClaimInvariant(right);
  const paymentDate = civilDate(payable.paymentAt.slice(0, 10));
  const nextDate = new Date(`${paymentDate}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const paymentEnd = civilDate(nextDate.toISOString().slice(0, 10));
  qualifyDeductionSource(payable.source, payable.paymentId, "ssa_coordinated_payable", payable.paymentAt,
    paymentDate, paymentEnd);
  requireDeduction(payable.kind === "coordinated_ssa_payable" && payable.eligibility === "eligible"
    && ["ss_retirement", "ss_spousal", "ss_survivor"].includes(payable.benefitKind)
    && identityFields.every(key => nonempty(payable[key])) && cents(payable.grossPayable)
    && payable.grossPayable.isPositive() && right.kind === "right" && right.category === "ssa_benefit_payable"
    && right.id === payable.rightClaimId && right.originatingRecognitionId === payable.rightRecognitionId
    && right.id === JSON.stringify(["d2-quoted-benefit/v1", payable.householdId, payable.entitlementId,
      payable.recipientId, paymentDate]) && payable.paymentId === right.id
    && right.economicOwnerId === payable.recipientId && right.originalAmount.equals(payable.grossPayable)
    && right.recognizedAt <= payable.paymentAt && right.dueAt === payable.paymentAt,
  "Payable must bind the actual coordinated positive SSA right");
  requireDeduction(consumption !== undefined && consumption.complete === true
    && consumption.paymentId === payable.paymentId && consumption.asOf === payable.paymentAt,
    "Complete committed source-consumption view at the payment event required");
  qualifyDeductionSource(consumption.source, consumption.stateId, "ssa_committed_consumption", payable.paymentAt,
    paymentDate, paymentEnd);
  const settlements = new Set(existingSettlementIds);
  const receiptIds = new Set<string>(), authorizations = new Set<string>(), claims = new Set<string>(), parts = new Set<string>();
  let consumed = money("0");
  const reserve = (id: string, t: SsaMedicareDeductionTerms, committed: boolean) => {
    requireDeduction((committed || !settlements.has(id)) && !receiptIds.has(t.receiptId)
      && !authorizations.has(t.authorizationId) && !claims.has(t.obligationId) && !parts.has(partPeriodKey(t.premium)),
    "Duplicate settlement, receipt, authorization, Medicare claim or Part/period");
    settlements.add(id); receiptIds.add(t.receiptId); authorizations.add(t.authorizationId);
    claims.add(t.obligationId); parts.add(partPeriodKey(t.premium));
    consumed = consumed.plus(t.amount);
    requireDeduction(consumed.compare(payable.grossPayable) <= 0, "Deduction exceeds unconsumed gross SSA payable");
  };
  const committedSettlements = new Set<string>();
  for (const receipt of consumption.receipts) {
    requireDeduction(deductionReceipts.has(receipt) && samePayable(receipt.payable, payable)
      && receipt.payable.grossPayable.equals(payable.grossPayable)
      && receipt.payable.benefitKind === payable.benefitKind && sameDeductionSource(receipt.payable.source, payable.source)
      && !committedSettlements.has(receipt.settlement.id), "Authentic unique committed source receipt required");
    committedSettlements.add(receipt.settlement.id);
    reserve(receipt.settlement.id, receipt.terms, true);
  }
  requireDeduction(new Set(consumption.committedReceiptIds).size === consumption.committedReceiptIds.length
    && receiptIds.size === consumption.committedReceiptIds.length
    && consumption.committedReceiptIds.every(id => receiptIds.has(id)), "Committed receipt inventory is incomplete or ambiguous");
  const priorConsumed = consumed;
  requireDeduction(right.outstandingAmount.equals(payable.grossPayable.minus(priorConsumed)),
    "Right outstanding must reconcile to complete committed source consumption");
  requireDeduction(right.settlementIds.length === committedSettlements.size
    && [...right.settlementIds].every(id => committedSettlements.has(id)),
  "Right history must reconcile to complete committed source receipts");
  const ordered = [...requests].sort((a, b) => a.terms.obligationId < b.terms.obligationId ? -1
    : a.terms.obligationId > b.terms.obligationId ? 1 : 0);
  requireDeduction(ordered.length > 0, "Positive Medicare deduction requests required");
  const prepared = ordered.map(({ draft, claim, terms: t }) => {
    assertClaimInvariant(claim);
    validatePremium(t.premium, payable.paymentAt);
    qualifyDeductionSource(t.source, t.authorizationId, "ssa_medicare_deduction", payable.paymentAt,
      t.premium.periodStart, t.premium.periodEndExclusive);
    requireDeduction(t.route === "ssa_payable_deduction" && t.partialDeduction === "forbidden"
      && [draft.id, t.authorizationId, t.receiptId, t.traceId, t.obligationRecognitionId].every(nonempty)
      && samePayable(t.payable, payable) && t.premium.householdId === payable.householdId
      && t.premium.beneficiaryId === payable.recipientId
      && (["evidenceId", "householdId", "beneficiaryId", "part", "coverageId", "providerId",
        "periodStart", "periodEndExclusive"] as const).every(key => t.premiumScope[key] === t.premium[key])
      && claim.kind === "obligation" && claim.category === "medicare_premium"
      && Object.isFrozen(claim) && Object.isFrozen(claim.settlementIds)
      && claim.id === t.obligationId && claim.originatingRecognitionId === t.obligationRecognitionId
      && claim.id === JSON.stringify(["medicare", payable.householdId, payable.recipientId,
        t.premium.part, t.premium.periodStart])
      && claim.economicOwnerId === payable.recipientId && claim.settlementIds.length === 0
      && cents(t.amount) && t.amount.isPositive() && t.amount.equals(t.premium.base.plus(t.premium.irmaa))
      && t.amount.equals(claim.originalAmount) && t.amount.equals(claim.outstandingAmount)
      && draft.settledAt === payable.paymentAt && claim.dueAt === payable.paymentAt
      && claim.recognizedAt.slice(0, 10) >= t.premium.periodStart
      && claim.recognizedAt.slice(0, 10) < t.premium.periodEndExclusive,
    "Deduction must match one full Medicare obligation, beneficiary, installment and premium month");
    reserve(draft.id, t, false);
    const proposal = createSettlementProposal({ id: settlementProposalId(JSON.stringify(["ssa_payable_deduction", draft.id])),
      claimId: claim.id, requestedAmount: t.amount, requestedAt: draft.settledAt }, claim);
    const traceRefs = freezeTraceRefs(draft.traceRefs);
    const settlement = Object.freeze({ id: draft.id, proposalId: proposal.id, claimId: claim.id,
      amount: t.amount, settledAt: draft.settledAt, fundingAllocations: Object.freeze([]),
      ...(draft.provenance === undefined ? {} : { provenance: createFactProvenance(draft.provenance) }),
      ...(traceRefs === undefined ? {} : { traceRefs }) }) as Settlement;
    const receipt = Object.freeze({ kind: "ssa_payable_deduction" as const, committed: false as const,
      settlement, payable: immutableDeduction(payable), terms: immutableDeduction(t),
      sourceState: immutableDeduction({ stateId: consumption.stateId, asOf: consumption.asOf,
        committedReceiptIds: [...consumption.committedReceiptIds].sort(), source: consumption.source }) });
    return { receipt, claim };
  });
  // Publish authority only once the entire batch has passed all checks.
  for (const { receipt, claim } of prepared) {
    authoritativeSettlements.add(receipt.settlement);
    deductionClaims.set(receipt.settlement, claim);
    deductionReceipts.add(receipt);
  }
  return Object.freeze({ kind: "conditional_ssa_deduction_group" as const, committed: false as const,
    receipts: Object.freeze(prepared.map(p => p.receipt)),
    deductionAmount: consumed.minus(priorConsumed),
    conditionalNetPayable: payable.grossPayable.minus(consumed) });
};
