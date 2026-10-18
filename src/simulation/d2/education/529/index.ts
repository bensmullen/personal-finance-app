import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Money, RoundingPolicy } from "../../../../values/index.js";
import type { EducationCoverage, EducationOutput, EducationProposal, EducationRequest, EducationResult, EducationSource } from "./types.js";
export type * from "./types.js";

const present = (v: string): boolean => typeof v === "string" && v.trim().length > 0;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
class Incomplete extends Error {
  constructor(readonly code: string, readonly path: string) { super(code); }
}

/** Private S1–S8 proposal seam. No ledger, tax, sale or capacity writer.
 * A proposal replaces the same operation/claim on replay. Only #149 can admit
 * it against current cash and usage and post all effects atomically. */
export function propose529Distribution(r: EducationRequest): EducationResult {
  const p = r.plan, snapshot = p.snapshot;
  const sources: EducationSource[] = [];
  const sourceVersions = new Map<string, string>();
  const attemptedRefs = new Set<string>();
  let proposal: EducationProposal | null = null, failure: Incomplete | null = null;
  const need = (ok: boolean, code: string, path: string): void => { if (!ok) throw new Incomplete(code, path); };
  const date = (d: CivilDate, path: string): void => {
    try { civilDate(d); } catch { throw new Incomplete("INVALID_DATE", path); }
  };
  const year = (d: CivilDate): number => Number(d.slice(0, 4));
  const exact = (m: Money, path: string): void => {
    need(m.currency.equals(r.currency) && r.currency.minorUnitScale === 2 && !m.isNegative() && m.amount.fitsScale(2),
      "CURRENCY_OR_CENTS_INVALID", path);
  };
  const unique = (ids: readonly string[], path: string): void => {
    need(ids.every(present) && new Set(ids).size === ids.length, "DUPLICATE_OR_MISSING_ID", path);
  };
  const source = (s: EducationSource, path: string, factAt = r.effectiveAt): void => {
    if (present(s.sourceId)) attemptedRefs.add(s.sourceId);
    date(s.start, path); date(s.endExclusive, path); date(s.publishedAt, path); date(s.asOf, path);
    need([s.sourceId, s.sourcePublication, s.ruleSnapshotId, s.jurisdiction, s.version].every(present), "SOURCE_IDENTITY_REQUIRED", path);
    need(s.verification === "verified" && s.projectionStatus === "verified" && s.ruleFamily === "education_529" &&
      s.publishedAt <= s.asOf && s.publishedAt <= factAt && s.asOf <= r.effectiveAt && s.asOf <= r.knownAt &&
      s.start <= factAt && factAt < s.endExclusive, "SOURCE_NOT_ADMITTED", path);
    need(s.householdId === p.householdId && s.ownerId === p.ownerId && s.beneficiaryId === p.beneficiaryId &&
      s.planId === p.planId && s.providerId === p.providerId && s.currency.equals(r.currency), "SOURCE_SCOPE_MISMATCH", path);
    need(s.ruleSnapshotId === r.rules?.source.ruleSnapshotId, "MIXED_RULE_SNAPSHOT", path);
    const version = JSON.stringify([s.sourcePublication, s.publishedAt, s.asOf, s.ruleSnapshotId, s.ruleFamily, s.jurisdiction, s.version,
      s.verification, s.projectionStatus, s.householdId, s.ownerId, s.beneficiaryId, s.planId, s.providerId, s.currency.code, s.start, s.endExclusive]);
    need(!sourceVersions.has(s.sourceId) || sourceVersions.get(s.sourceId) === version, "CONFLICTING_SOURCE_ID", path);
    sourceVersions.set(s.sourceId, version);
    sources.push(s);
  };
  try {
    date(r.effectiveAt, "effectiveAt"); date(r.knownAt, "knownAt");
    need(r.effectiveAt <= r.knownAt && Number.isSafeInteger(r.taxYear) && r.taxYear >= 1000 && r.taxYear < 9999 &&
      year(r.effectiveAt) === r.taxYear, "EVENT_YEAR_REQUIRED", "taxYear");
    need([r.operationId, r.claimId, p.householdId, p.ownerId, p.beneficiaryId, p.planId, p.providerId,
      p.accountId, p.cashAccountId, p.stateJurisdiction, p.localJurisdiction].every(present), "IDENTITY_REQUIRED", "plan");
    need(r.kind === "qualified_distribution" || r.kind === "nonqualified_distribution", "UNSUPPORTED_OPERATION", "kind");
    need(p.treatment === "ordinary_original_owner" && p.taxBucket === "education_529", "UNSUPPORTED_PLAN_TREATMENT", "plan");
    need(p.contributions.length <= 10000 && p.distributions.length <= 10000 && r.usage.entries.length <= 10000,
      "INPUT_LIMIT", "plan.history");
    const rules = r.rules;
    if (!rules) throw new Incomplete("SOURCED_LAW_REQUIRED", "rules");
    source(rules.source, "rules");
    need(rules.source.jurisdiction === "US" && rules.allocation === "current_plan_aggregate_earnings_over_value" &&
      ["half_up", "half_even", "toward_zero", "away_from_zero", "floor", "ceiling"].includes(rules.earningsRounding),
      "UNSUPPORTED_ALLOCATION_LAW", "rules");
    source(p.source, "plan"); source(snapshot.source, "plan.snapshot");
    date(snapshot.at, "plan.snapshot.at");
    need(snapshot.at === r.effectiveAt && snapshot.source.asOf === snapshot.at && snapshot.taxYear === r.taxYear &&
      snapshot.history === "complete_since_inception", "PLAN_VALUE_YEAR_OR_HISTORY_REQUIRED", "plan.snapshot");
    if (!snapshot.currentValue || !snapshot.contributionBasis || !snapshot.earnings || !snapshot.unencumberedCash)
      throw new Incomplete("PLAN_VALUE_BASIS_EARNINGS_OR_CASH_REQUIRED", "plan.snapshot");
    for (const m of [r.gross, snapshot.currentValue, snapshot.contributionBasis, snapshot.earnings, snapshot.unencumberedCash]) exact(m, "plan.snapshot");
    need(r.gross.isPositive() && snapshot.currentValue.isPositive() &&
      snapshot.contributionBasis.plus(snapshot.earnings).equals(snapshot.currentValue) &&
      snapshot.unencumberedCash.compare(snapshot.currentValue) <= 0, "PLAN_VALUE_NOT_RECONCILED", "plan.snapshot");
    unique(p.contributions.map(c => c.lotId), "plan.contributions.lotId");
    unique(p.contributions.map(c => c.basisId), "plan.contributions.basisId");
    unique([...p.contributions.map(c => c.fundingOperationId), ...p.distributions.map(d => d.operationId)], "plan.history.operationId");
    unique(p.distributions.map(d => d.claimId), "plan.distributions.claimId");
    let contributed = Money.zero(r.currency), recovered = Money.zero(r.currency);
    for (const c of p.contributions) {
      date(c.fundedAt, "plan.contributions"); source(c.source, "plan.contributions", c.fundedAt); exact(c.principal, "plan.contributions");
      need(c.fundedAt <= snapshot.at && c.source.asOf >= c.fundedAt && c.principal.isPositive(), "UNFUNDED_OR_FUTURE_CONTRIBUTION", "plan.contributions");
      contributed = contributed.plus(c.principal);
    }
    for (const d of p.distributions) {
      date(d.effectiveAt, "plan.distributions"); source(d.source, "plan.distributions", d.effectiveAt);
      for (const m of [d.gross, d.basisRecovered, d.earnings]) exact(m, "plan.distributions");
      need(d.effectiveAt <= snapshot.at && d.source.asOf >= d.effectiveAt && d.gross.isPositive() &&
        d.basisRecovered.plus(d.earnings).equals(d.gross) &&
        (d.kind === "qualified_distribution" ? typeof d.paidExpenseId === "string" && present(d.paidExpenseId) :
          d.kind === "nonqualified_distribution" && d.paidExpenseId === null), "DISTRIBUTION_HISTORY_INVALID", "plan.distributions");
      recovered = recovered.plus(d.basisRecovered);
    }
    need(contributed.minus(recovered).equals(snapshot.contributionBasis), "BASIS_HISTORY_NOT_RECONCILED", "plan.snapshot.contributionBasis");
    source(r.usage.source, "usage"); date(r.usage.at, "usage.at");
    need(r.usage.at === r.effectiveAt && r.usage.source.asOf === r.usage.at && r.usage.complete === "verified_complete",
      "COMPLETE_USAGE_REQUIRED", "usage");
    unique(r.usage.entries.map(u => u.operationId), "usage.operationId"); unique(r.usage.entries.map(u => u.claimId), "usage.claimId");
    for (const u of r.usage.entries) {
      date(u.effectiveAt, "usage.entries"); source(u.source, "usage.entries", u.effectiveAt); exact(u.amount, "usage.entries");
      need([u.paidExpenseId, u.planId, u.providerId].every(present) && u.beneficiaryId === p.beneficiaryId && year(u.effectiveAt) === u.taxYear &&
        u.effectiveAt <= r.effectiveAt && u.source.asOf >= u.effectiveAt && u.amount.isPositive() &&
        ["posted", "pending_authorized"].includes(u.state), "USAGE_SCOPE_OR_DATE_INVALID", "usage.entries");
    }
    need(!p.distributions.some(d => d.operationId === r.operationId || d.claimId === r.claimId) &&
      !p.contributions.some(c => c.fundingOperationId === r.operationId) &&
      !r.usage.entries.some(u => u.operationId === r.operationId || u.claimId === r.claimId), "DUPLICATE_OPERATION_OR_CLAIM", "operationId");
    for (const d of p.distributions) if (d.kind === "qualified_distribution") {
      const u = r.usage.entries.find(u => u.operationId === d.operationId);
      need(Boolean(u) && u!.claimId === d.claimId && u!.paidExpenseId === d.paidExpenseId && u!.amount.equals(d.gross) &&
        u!.effectiveAt === d.effectiveAt && u!.state === "posted" && u!.planId === p.planId && u!.providerId === p.providerId,
        "HISTORICAL_EXPENSE_USAGE_REQUIRED", "usage.entries");
    }
    source(r.route.source, "route"); source(r.authorization.source, "authorization"); exact(r.authorization.gross, "authorization.gross");
    need(r.authorization.permitted === "yes" && r.authorization.operationId === r.operationId && r.authorization.claimId === r.claimId &&
      r.authorization.destinationAccountId === r.route.accountId && r.authorization.gross.equals(r.gross), "FUNDED_ROUTE_NOT_AUTHORIZED", "authorization");
    need(present(r.route.accountId) && ![p.accountId, p.cashAccountId].includes(r.route.accountId), "INVALID_DESTINATION", "route");
    if (r.route.kind === "owned_bank") {
      exact(r.route.openingCash, "route.openingCash"); date(r.route.observedAt, "route.observedAt");
      need(r.route.ownerId === p.ownerId && r.route.householdId === p.householdId && r.route.observedAt === r.effectiveAt &&
        r.route.source.asOf === r.route.observedAt, "BANK_OWNERSHIP_OR_CASH_PROOF_REQUIRED", "route");
    } else need(r.route.kind === "institution", "INVALID_DESTINATION", "route");

    const qualified = r.kind === "qualified_distribution";
    const expense = r.expense;
    if (qualified) {
      const q = r.qualification;
      if (!expense || !q) throw new Incomplete("EXPENSE_AND_QUALIFICATION_REQUIRED", "expense");
      source(expense.source, "expense"); source(q.source, "qualification"); source(expense.recognition.source, "expense.recognition");
      need([expense.expenseId, expense.paidExpenseId, expense.studentId, expense.institutionId, expense.payeeId, expense.termId,
        expense.ownerRelationship, expense.payerId, expense.payerAccountId, expense.recognition.economicExpenseId].every(present), "EXPENSE_IDENTITY_REQUIRED", "expense");
      date(q.at, "qualification.at"); date(expense.incurredAt, "expense.incurredAt");
      need(q.at === r.effectiveAt && q.source.asOf === q.at && q.categoryEligible === "yes" && q.beneficiaryId === p.beneficiaryId &&
        expense.beneficiaryId === p.beneficiaryId && q.studentId === expense.studentId && q.institutionId === expense.institutionId &&
        q.termId === expense.termId, "BENEFICIARY_OR_QUALIFICATION_MISMATCH", "qualification");
      need(rules.expenseCategory === "postsecondary_tuition" && expense.category === rules.expenseCategory &&
        rules.qualifiedTreatment === "earnings_excluded" && rules.expenseYear === "paid_year_or_direct_payment_event",
        "UNSUPPORTED_EXPENSE_LAW", "rules.expenseCategory");
      need(expense.taxYear === r.taxYear && expense.incurredAt <= r.effectiveAt && expense.source.asOf >= expense.incurredAt && expense.adjustmentsComplete === "verified_complete" &&
        expense.unreimbursedUse === "verified", "EXPENSE_YEAR_OR_NONDUPLICATION_PROOF_REQUIRED", "expense");
      need(["already_recognized", "unrecognized"].includes(expense.recognition.status) && expense.recognition.source.asOf === r.effectiveAt,
        "RECOGNITION_PROOF_REQUIRED", "expense.recognition");
      for (const m of [expense.billed, expense.eligibleBilled, expense.adjustedEligible]) exact(m, "expense.amounts");
      need(expense.eligibleBilled.compare(expense.billed) <= 0 && expense.adjustments.length <= 10000,
        "ELIGIBLE_BILL_INVALID", "expense");
      unique(expense.adjustments.map(a => a.allocationId), "expense.adjustments");
      let adjustments = Money.zero(r.currency), used = Money.zero(r.currency);
      for (const a of expense.adjustments) {
        source(a.source, "expense.adjustments"); exact(a.amount, "expense.adjustments");
        need(["scholarship", "grant", "tax_credit", "other_529", "other_reimbursement"].includes(a.kind) &&
          a.allocationId !== r.operationId && a.allocationId !== r.claimId &&
          !r.usage.entries.some(u => u.operationId === a.allocationId || u.claimId === a.allocationId),
          "DUPLICATE_OR_UNSUPPORTED_ADJUSTMENT", "expense.adjustments");
        adjustments = adjustments.plus(a.amount);
      }
      need(expense.eligibleBilled.minus(adjustments).equals(expense.adjustedEligible), "ADJUSTED_EXPENSE_NOT_RECONCILED", "expense.adjustedEligible");
      for (const u of r.usage.entries) if (u.paidExpenseId === expense.paidExpenseId) {
        need(u.taxYear === r.taxYear, "EXPENSE_USAGE_YEAR_MISMATCH", "usage.entries"); used = used.plus(u.amount);
      }
      need(r.gross.compare(expense.adjustedEligible.minus(used)) <= 0, "ADJUSTED_EXPENSE_EXHAUSTED", "expense.adjustedEligible");
      if (r.route.kind === "owned_bank") {
        if (!expense.paidAt) throw new Incomplete("PAID_EXPENSE_PROOF_REQUIRED", "expense.paidAt");
        date(expense.paidAt, "expense.paidAt");
        need(expense.paymentMethod === "bank_paid" && expense.payerId === r.route.ownerId && expense.payerAccountId === r.route.accountId &&
          expense.unpaidClaim === null && expense.source.asOf >= expense.paidAt &&
          expense.incurredAt <= expense.paidAt && expense.paidAt <= r.effectiveAt && year(expense.paidAt) === r.taxYear,
          "PAYER_PAYMENT_OR_YEAR_MISMATCH", "expense");
      } else {
        const claim = expense.unpaidClaim;
        if (!claim) throw new Incomplete("UNPAID_INSTITUTION_CLAIM_REQUIRED", "expense.unpaidClaim");
        source(claim.source, "expense.unpaidClaim"); exact(claim.outstanding, "expense.unpaidClaim");
        need(present(claim.claimId) && claim.claimId !== r.claimId && claim.outstanding.compare(r.gross) >= 0 &&
          claim.source.asOf === r.effectiveAt && claim.outstanding.compare(expense.billed) <= 0,
          "UNPAID_INSTITUTION_CLAIM_INVALID", "expense.unpaidClaim");
        need(expense.paymentMethod === "direct_plan_payment" && expense.paidAt === null && expense.payerId === p.ownerId &&
          expense.payerAccountId === p.cashAccountId &&
          r.route.institutionId === expense.institutionId && r.route.payeeId === expense.payeeId,
          "DIRECT_PAY_MISMATCH_OR_ALREADY_PAID", "route");
      }
    } else {
      need(rules.nonqualifiedTreatment === "earnings_income_basis_return", "NONQUALIFIED_LAW_REQUIRED", "rules");
      need(expense === null && r.qualification === null && r.route.kind === "owned_bank", "NONQUALIFIED_ROUTE_OR_EXPENSE_UNSUPPORTED", "expense");
    }
    need(r.gross.compare(snapshot.currentValue) <= 0 && r.gross.compare(snapshot.unencumberedCash) <= 0,
      "LIQUIDATION_OR_ADDITIONAL_CASH_REQUIRED", "plan.snapshot.unencumberedCash");
    // Multiply before dividing: one legally sourced rounding step, no ratio
    // truncation, floating-point money or per-lot rounding accumulation.
    const earnings = new Money(r.gross.amount.times(snapshot.earnings.amount).dividedBy(snapshot.currentValue.amount,
      new RoundingPolicy(2, rules.earningsRounding)), r.currency);
    const basis = r.gross.minus(earnings), zero = Money.zero(r.currency);
    need(basis.compare(snapshot.contributionBasis) <= 0 && earnings.compare(snapshot.earnings) <= 0,
      "ALLOCATION_EXCEEDS_PLAN_BALANCES", "plan.snapshot");
    const traceRefs = [...new Set(sources.map(s => s.sourceId))].sort(compare);
    proposal = {
      contractVersion: "d2-shared/v1", committed: false, postable: false, instrumentFamily: "education_529", status: "conditional_uncommitted",
      operationId: r.operationId, claimId: r.claimId, kind: qualified ? "qualified_distribution" : "nonqualified_distribution", actorId: p.ownerId, householdId: p.householdId,
      beneficiaryId: p.beneficiaryId, planId: p.planId, providerId: p.providerId, sourceAccountId: p.cashAccountId,
      planAccountId: p.accountId,
      destinationAccountId: r.route.accountId, taxBucket: p.taxBucket, effectiveAt: r.effectiveAt, taxYear: r.taxYear,
      ruleSnapshotId: rules.source.ruleSnapshotId, priority: "movement", dependsOn: [], grossAmount: r.gross,
      originalPlanValue: snapshot.currentValue, originalBasis: snapshot.contributionBasis, originalEarnings: snapshot.earnings,
      basisLotIds: [...p.contributions].sort((a, b) => compare(a.lotId, b.lotId)).map(c => ({ lotId: c.lotId, basisId: c.basisId })),
      basisRecovered: basis, earnings, planAssetDelta: zero.minus(r.gross),
      ownedBankCashDelta: r.route.kind === "owned_bank" ? r.gross : zero,
      institutionClaimLiabilityDelta: r.route.kind === "institution" ? zero.minus(r.gross) : zero,
      institutionPaymentAmount: r.route.kind === "institution" ? r.gross : zero,
      basisDelta: zero.minus(basis), movementNetWorthDelta: zero,
      bankReceiptCharacter: r.route.kind === "owned_bank" ? "owned_transfer" : "not_applicable",
      expense: expense ? { paidExpenseId: expense.paidExpenseId, economicExpenseId: expense.recognition.economicExpenseId,
        recognize: expense.recognition.status === "unrecognized", amount: expense.billed,
        institutionClaimId: expense.unpaidClaim?.claimId ?? null,
        adjustmentAllocationIds: expense.adjustments.map(a => a.allocationId).sort(compare) } : null,
      fundingProof: { planSnapshot: snapshot, route: r.route, usage: r.usage },
      taxFacts: { jurisdiction: rules.source.jurisdiction, lawVersion: rules.source.version, ruleSnapshotId: rules.source.ruleSnapshotId,
        incomeCharacter: qualified ? "qualified_529_earnings_excluded" : "nonqualified_529_earnings", gross: r.gross,
        taxable: qualified ? zero : earnings, basisRecovered: basis, completeness: "complete_character_only" },
      conditions: ["#149 rechecks exact source plan cash/value/basis and destination proof before atomic posting",
        "#149 admits operationId and claimId once against the complete cross-plan paid-expense usage register",
        "#149 consumes plan cash/basis and expense usage only on successful posting; proposals reserve nothing",
        "Destination receipt and plan decrease are one movement; no wrapper/holding double count or new income",
        "Any expense recognition is separate and occurs once by economicExpenseId; existing expense/credit identity is preserved",
        "Institution payment settles its claim; recognition and claim settlement cannot duplicate expense",
        "#101 owns liability, penalties, state/local deductions and recapture; no tax payment is proposed"],
      traceRefs, sources: [...sources].sort((a, b) => compare(a.sourceId, b.sourceId)),
    };
  } catch (e) {
    if (!(e instanceof Incomplete)) throw e;
    failure = e;
  }
  const outputs: readonly EducationOutput[] = ["qualification", "basis_earnings", "funded_route", "federal_character", "penalty",
    "state_tax", "local_tax", "contribution_deduction", "settlement"];
  const coverage: EducationCoverage[] = outputs.map(affectedOutput => {
    const domain = ["qualification", "basis_earnings", "funded_route", "federal_character"].includes(affectedOutput);
    const notApplicable = affectedOutput === "qualification" && r.kind === "nonqualified_distribution" && !failure;
    const complete = domain && !failure;
    const diagnosticCode = failure?.code ?? (domain ? null : affectedOutput === "settlement" ? "SHARED_SETTLEMENT_PENDING" : "TAX_AUTHORITY_REQUIRED");
    return { sourceEntityPath: failure?.path ?? `plan.${p.planId}.${affectedOutput}`,
      period: { start: `${r.taxYear}-01-01` as CivilDate, endExclusive: `${r.taxYear + 1}-01-01` as CivilDate },
      affectedOutput, coverage: notApplicable ? "not_applicable" : complete ? "complete" : "incomplete", diagnosticCode,
      missingFacts: diagnosticCode ? [failure?.path ?? (affectedOutput === "settlement" ? "#149 atomic posting" : `#101 sourced ${affectedOutput}`)] : [],
      ruleSnapshotId: r.rules?.source.ruleSnapshotId ?? null, traceRefs: [...attemptedRefs].sort(compare) };
  });
  return { proposals: proposal ? [proposal] : [], coverage };
}
