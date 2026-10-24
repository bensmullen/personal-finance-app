import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { Currency, Money, RoundingPolicy } from "../../../../../values/index.js";
import type { EducationSource } from "../types.js";
import type { PlanIdentity, PlanTransferCoverage, PlanTransferOutput, PlanTransferProposal, PlanTransferRequest, PlanTransferResult, TransferredLot } from "./types.js";
export type * from "./types.js";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const present = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
class Incomplete extends Error {
  constructor(readonly code: string, readonly path: string) { super(code); }
}
const need = (ok: boolean, code: string, path: string): void => { if (!ok) throw new Incomplete(code, path); };
const date = (d: CivilDate, path: string): void => {
  try { civilDate(d); } catch { throw new Incomplete("INVALID_DATE", path); }
};
const unique = (ids: readonly string[], path: string): void =>
  need(ids.every(present) && new Set(ids).size === ids.length, "DUPLICATE_OR_MISSING_ID", path);
function immutable<T>(v: T): T {
  if (v === null || typeof v !== "object" || v instanceof Money || v instanceof Currency) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(immutable)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, immutable(x)]))) as T;
}
const identity = (p: PlanIdentity): PlanIdentity => ({ householdId: p.householdId, ownerId: p.ownerId,
  beneficiaryId: p.beneficiaryId, planId: p.planId, providerId: p.providerId, accountId: p.accountId,
  cashAccountId: p.cashAccountId, taxBucket: p.taxBucket });
const outputs: readonly PlanTransferOutput[] = ["eligibility", "basis_earnings", "continuity", "funding", "claim_registry", "ira_capacity", "federal_tax", "state_tax", "local_tax", "settlement"];
const byOperation = <T extends { readonly operationId: string }>(a: T, b: T): number => compare(a.operationId, b.operationId);

/** Pure, bounded cash-at-par continuation seam. No claim reservation, sale,
 * expense recognition, IRA limit arithmetic, tax liability or shared state write. */
export function propose529PlanTransfers(input: readonly PlanTransferRequest[]): PlanTransferResult {
  if (input.length > 256) throw new RangeError("PLAN_TRANSFER_BATCH_LIMIT");
  const requests = [...input].sort((a, b) => byOperation(a, b) || compare(a.claimId, b.claimId));
  const proposals: PlanTransferProposal[] = [], coverage: PlanTransferCoverage[] = [];
  for (const r of requests) {
    const p = r.plan, s = p.snapshot, d = r.destination, refs = new Set<string>();
    const sources = new Map<string, EducationSource>(), versions = new Map<string, string>();
    let failure: Incomplete | null = null;
    const exact = (m: Money, path: string): void => need(m instanceof Money && m.currency.equals(r.currency) &&
      r.currency.minorUnitScale === 2 && m.amount.fitsScale(2) && !m.isNegative(), "EXACT_CENTS_REQUIRED", path);
    const source = (v: EducationSource, path: string, scope = p, at = r.effectiveAt, current = true): void => {
      need(Boolean(v), "SOURCE_REQUIRED", path);
      refs.add(v.sourceId);
      for (const x of [v.start, v.endExclusive, v.publishedAt, v.asOf]) date(x, path);
      need([v.sourceId, v.sourcePublication, v.ruleSnapshotId, v.jurisdiction, v.version].every(present), "SOURCE_IDENTITY_REQUIRED", path);
      need(v.verification === "verified" && v.projectionStatus === "verified" && v.ruleFamily === "education_529" &&
        v.start < v.endExclusive && v.start <= at && at < v.endExclusive && v.publishedAt <= at &&
        v.publishedAt <= v.asOf && v.asOf >= at && v.asOf <= r.effectiveAt && v.asOf <= r.knownAt &&
        (!current || v.asOf === r.effectiveAt), "SOURCE_NOT_ADMITTED", path);
      need(v.householdId === scope.householdId && v.ownerId === scope.ownerId && v.beneficiaryId === scope.beneficiaryId &&
        v.planId === scope.planId && v.providerId === scope.providerId && v.currency.equals(r.currency), "SOURCE_SCOPE_MISMATCH", path);
      const fingerprint = JSON.stringify([v.sourcePublication, v.publishedAt, v.asOf, v.start, v.endExclusive,
        v.ruleSnapshotId, v.jurisdiction, v.version, v.householdId, v.ownerId, v.beneficiaryId, v.planId, v.providerId, v.currency.code]);
      need(!versions.has(v.sourceId) || versions.get(v.sourceId) === fingerprint, "CONFLICTING_SOURCE_VERSION", path);
      versions.set(v.sourceId, fingerprint); sources.set(v.sourceId, v);
    };
    try {
      date(r.effectiveAt, "effectiveAt"); date(r.knownAt, "knownAt");
      need(Number.isSafeInteger(r.taxYear) && r.taxYear >= 1000 && r.taxYear < 9999 &&
        Number(r.effectiveAt.slice(0, 4)) === r.taxYear && r.effectiveAt <= r.knownAt, "EVENT_YEAR_REQUIRED", "taxYear");
      need([r.operationId, r.claimId, r.transferId, ...Object.values(identity(p)), r.holdings.holdingId,
        ...Object.values(identity(d)), p.stateJurisdiction, p.localJurisdiction, d.stateJurisdiction, d.localJurisdiction].every(present), "IDENTITY_REQUIRED", "plan");
      unique([p.accountId, p.cashAccountId, r.holdings.holdingId, d.accountId, d.cashAccountId], "accounts");
      need(p.taxBucket === "education_529" && p.treatment === "ordinary_original_owner" && d.taxBucket === "education_529" &&
        d.householdId === p.householdId && d.ownerId === p.ownerId && d.planId !== p.planId &&
        d.route === "direct_trustee" && d.eligible === "yes", "OWNED_529_TRUSTEE_ROUTE_REQUIRED", "destination");
      need(["529_plan_to_plan", "529_plan_to_plan_beneficiary_change"].includes(r.kind), "UNSUPPORTED_TRANSFER_PROFILE", "kind");
      need(requests.filter(x => x.operationId === r.operationId || x.claimId === r.claimId ||
        (x.plan.accountId === p.accountId && x.transferId === r.transferId)).length === 1, "DUPLICATE_TRANSFER_CLAIM", "batch");
      // Shared-source batches fail closed as a group, including invalid siblings.
      // No input ordering establishes a winner or produces a partial accepted group.
      need(requests.filter(x => x.plan.planId === p.planId || x.plan.accountId === p.accountId ||
        x.plan.cashAccountId === p.cashAccountId || x.holdings.holdingId === r.holdings.holdingId ||
        x.plan.beneficiaryId === p.beneficiaryId || x.destination.beneficiaryId === d.beneficiaryId ||
        x.destination.accountId === p.accountId || x.destination.cashAccountId === p.cashAccountId ||
        x.plan.accountId === d.accountId || x.plan.cashAccountId === d.cashAccountId).length === 1,
      "SHARED_SOURCE_REQUIRES_ATOMIC_OWNER", "batch");
      need(p.contributions.length <= 10000 && p.distributions.length <= 10000 && r.holdings.lots.length <= 10000 &&
        r.claims.entries.length <= 10000 && r.rothUsage.entries.length <= 10000 && r.history.changes.length <= 256 &&
        r.jurisdictionPermissions.length <= 4, "INPUT_LIMIT", "history");
      const law = r.rules;
      if (!law) throw new Incomplete("SOURCED_TRANSFER_LAW_REQUIRED", "rules");
      source(law.source, "rules"); exact(law.eligibleMaximum, "rules.eligibleMaximum");
      date(law.electionWindow.start, "rules.electionWindow"); date(law.electionWindow.endExclusive, "rules.electionWindow");
      need(law.source.jurisdiction === "US" && law.treatment === "ordinary_direct_529_continuation" &&
        law.sameYearEligibility === "verified" && law.electionWindow.start <= r.effectiveAt &&
        r.effectiveAt < law.electionWindow.endExclusive, "LEGAL_WINDOW_OR_SAME_YEAR_REQUIRED", "rules");
      need(law.planAgeContinuity === "verified_preserved" && law.rothEligibilityContinuity === "verified_preserved",
        "LEGAL_AGING_CONTINUITY_REQUIRED", "rules");
      source(p.source, "plan"); source(s.source, "plan.snapshot");
      source(d.source, "destination", { ...p, ...d });
      for (const side of ["original", "receiving"] as const) for (const level of ["state", "local"] as const) {
        const entries = r.jurisdictionPermissions.filter(x => x.side === side && x.level === level);
        need(entries.length === 1, "JURISDICTION_PERMISSION_REQUIRED", `permissions.${side}.${level}`);
        const permission = entries[0]!, scope = side === "original" ? p : { ...p, ...d };
        source(permission.source, `permissions.${side}.${level}`, scope);
        need(permission.permitted === "yes" && permission.source.jurisdiction ===
          (level === "state" ? scope.stateJurisdiction : scope.localJurisdiction), "JURISDICTION_TRANSFER_NOT_ADMITTED", `permissions.${side}.${level}`);
      }
      const change = r.beneficiaryChange;
      if (d.beneficiaryId === p.beneficiaryId) need(r.kind === "529_plan_to_plan" && change === null, "BENEFICIARY_SOURCE_CONFLICT", "beneficiaryChange");
      else {
        need(r.kind === "529_plan_to_plan_beneficiary_change" && Boolean(change), "BENEFICIARY_PERMISSION_REQUIRED", "beneficiaryChange");
        need(present(change!.changeId) && change!.fromBeneficiaryId === p.beneficiaryId && change!.toBeneficiaryId === d.beneficiaryId &&
          change!.legalPermission === "yes" && change!.planPermission === "yes", "BENEFICIARY_PERMISSION_REQUIRED", "beneficiaryChange");
        source(change!.source, "beneficiaryChange.law"); source(change!.planSource, "beneficiaryChange.plan", { ...p, ...d });
        need(change!.source.jurisdiction === "US", "BENEFICIARY_PERMISSION_REQUIRED", "beneficiaryChange.law");
      }
      source(r.history.source, "history");
      for (const x of [r.history.openedAt, r.history.ageStart, r.history.beneficiarySince]) date(x, "history");
      need(r.history.complete === "complete_since_inception" && r.history.openedAt <= r.history.ageStart &&
        r.history.ageStart <= r.effectiveAt && r.history.openedAt <= r.history.beneficiarySince &&
        r.history.beneficiarySince <= r.effectiveAt, "ORIGINAL_AGING_HISTORY_REQUIRED", "history");
      unique(r.history.changes.map(c => c.changeId), "history.changes");
      for (const c of r.history.changes) {
        date(c.at, "history.changes"); source(c.source, "history.changes", p, c.at, false);
        need(c.at >= r.history.openedAt && c.at <= r.effectiveAt && c.continuity === "verified_preserved" &&
          ["plan_transfer", "beneficiary_change"].includes(c.kind) && c.source.ruleSnapshotId === law.source.ruleSnapshotId,
          "HISTORICAL_CONTINUITY_REQUIRED", "history.changes");
      }
      const changes = r.history.changes.filter(c => c.kind === "beneficiary_change").map(c => c.at).sort(compare);
      need((changes.length ? changes[changes.length - 1] : r.history.openedAt) === r.history.beneficiarySince &&
        (r.history.changes.length > 0 || r.history.ageStart === r.history.openedAt) &&
        (!change || !r.history.changes.some(c => c.changeId === change.changeId)), "BENEFICIARY_HISTORY_REQUIRED", "history");
      need(s.at === r.effectiveAt && s.taxYear === r.taxYear && s.history === "complete_since_inception" &&
        Boolean(s.currentValue && s.contributionBasis && s.earnings && s.unencumberedCash), "CURRENT_BALANCES_REQUIRED", "plan.snapshot");
      const value = s.currentValue!, basis = s.contributionBasis!, earnings = s.earnings!, cash = s.unencumberedCash!;
      for (const m of [r.amount, value, basis, earnings, cash]) exact(m, "plan.snapshot");
      need(r.amount.isPositive() && basis.plus(earnings).equals(value) && cash.compare(value) <= 0, "BALANCES_NOT_RECONCILED", "plan.snapshot");
      for (const [a, scope, path] of [[r.originatingAcceptance, p, "originatingAcceptance"],
        [r.receivingAcceptance, { ...p, ...d }, "receivingAcceptance"]] as const) {
        need(Boolean(a), "TRUSTEE_ACCEPTANCE_REQUIRED", path);
        source(a.source, path, scope); exact(a.amount, path);
        need(a.status === "confirmed" && a.transferId === r.transferId && a.operationId === r.operationId && a.claimId === r.claimId &&
          a.sourceAccountId === p.cashAccountId && a.destinationAccountId === d.cashAccountId &&
          a.originatingTrusteeId === p.providerId && a.receivingTrusteeId === d.providerId &&
          a.sourceVersion === s.source.version && a.amount.equals(r.amount), "EXACT_TRUSTEE_ACCEPTANCE_REQUIRED", path);
      }
      source(r.claims.source, "claims");
      need(r.claims.at === r.effectiveAt && r.claims.complete === "all_household_plan_claims_including_pending", "COMPLETE_CLAIM_REGISTER_REQUIRED", "claims");
      unique(r.claims.entries.map(c => c.operationId), "claims.operationId"); unique(r.claims.entries.map(c => c.claimId), "claims.claimId");
      unique(r.claims.entries.map(c => JSON.stringify([c.accountId, c.transferId])), "claims.transferId");
      let pending = Money.zero(r.currency), transferBasis = Money.zero(r.currency);
      for (const c of r.claims.entries) {
        date(c.effectiveAt, "claims.entries"); source(c.source, "claims.entries", { ...p, ...c }, c.effectiveAt, false);
        for (const m of [c.amount, c.basis, c.earnings]) exact(m, "claims.entries");
        need([...Object.values(identity(c)), c.operationId, c.claimId, c.transferId, c.destinationAccountId].every(present) &&
          c.householdId === p.householdId && c.taxBucket === "education_529" && c.effectiveAt <= r.effectiveAt &&
          c.amount.isPositive() && c.basis.plus(c.earnings).equals(c.amount) &&
          ["distribution", "plan_transfer", "roth_transfer"].includes(c.kind) && ["posted", "pending_authorized"].includes(c.state), "CLAIM_HISTORY_INVALID", "claims.entries");
        need(c.operationId !== r.operationId && c.claimId !== r.claimId &&
          !(c.accountId === p.accountId && c.transferId === r.transferId), "DUPLICATE_TRANSFER_CLAIM", "claims.entries");
        if (c.planId === p.planId || c.accountId === p.accountId || c.cashAccountId === p.cashAccountId) {
          need(c.planId === p.planId && c.accountId === p.accountId && c.cashAccountId === p.cashAccountId &&
            c.ownerId === p.ownerId && c.beneficiaryId === p.beneficiaryId && c.providerId === p.providerId, "CLAIM_SOURCE_CONFLICT", "claims.entries");
          if (c.state === "pending_authorized") pending = pending.plus(c.amount);
          else if (c.kind !== "distribution") transferBasis = transferBasis.plus(c.basis);
          else need(p.distributions.some(h => h.operationId === c.operationId && h.claimId === c.claimId && h.effectiveAt === c.effectiveAt &&
            h.gross.equals(c.amount) && h.basisRecovered.equals(c.basis) && h.earnings.equals(c.earnings)), "DISTRIBUTION_REGISTER_CONFLICT", "claims.entries");
        }
      }
      source(r.rothUsage.source, "rothUsage");
      need(r.rothUsage.at === r.effectiveAt && r.rothUsage.completeness === "all_beneficiary_lifetime_transfers_and_annual_ira_including_pending",
        "LIFETIME_ELIGIBILITY_HISTORY_REQUIRED", "rothUsage");
      unique(r.rothUsage.entries.map(u => u.operationId), "rothUsage.operationId"); unique(r.rothUsage.entries.map(u => u.claimId), "rothUsage.claimId");
      for (const u of r.rothUsage.entries) {
        date(u.effectiveAt, "rothUsage.entries"); source(u.source, "rothUsage.entries", { ...p, ...u }, u.effectiveAt, false);
        for (const m of [u.amount, u.basis, u.earnings]) exact(m, "rothUsage.entries");
        need([u.operationId, u.claimId, u.destinationAccountId, u.ownerId, u.planId, u.providerId].every(present) &&
          u.operationId !== r.operationId && u.claimId !== r.claimId &&
          u.beneficiaryId === p.beneficiaryId && u.effectiveAt <= r.effectiveAt && Number(u.effectiveAt.slice(0, 4)) === u.taxYear &&
          u.amount.isPositive() && ["posted", "pending_authorized"].includes(u.state) &&
          (u.kind === "regular_ira_contribution" ? u.basis.isZero() && u.earnings.isZero() :
            u.kind === "529_roth_transfer" && u.basis.plus(u.earnings).equals(u.amount)), "ROTH_HISTORY_INVALID", "rothUsage.entries");
        if (u.kind === "529_roth_transfer" && u.planId === p.planId) need(r.claims.entries.some(c =>
          c.kind === "roth_transfer" && c.operationId === u.operationId && c.claimId === u.claimId && c.state === u.state &&
          c.effectiveAt === u.effectiveAt && c.destinationAccountId === u.destinationAccountId && c.amount.equals(u.amount) &&
          c.basis.equals(u.basis) && c.earnings.equals(u.earnings)), "ROTH_CLAIM_CONFLICT", "rothUsage.entries");
      }
      need(!r.claims.entries.some(c => c.kind === "roth_transfer" && c.planId === p.planId &&
        !r.rothUsage.entries.some(u => u.operationId === c.operationId && u.claimId === c.claimId)), "ROTH_CLAIM_CONFLICT", "claims.entries");
      unique(p.contributions.map(c => c.lotId), "contributions.lotId"); unique(p.contributions.map(c => c.basisId), "contributions.basisId");
      unique([...p.contributions.map(c => c.fundingOperationId), ...p.distributions.map(h => h.operationId)], "history.operationId");
      unique(p.distributions.map(h => h.claimId), "history.claimId");
      let funded = Money.zero(r.currency), recovered = transferBasis;
      for (const c of p.contributions) {
        date(c.fundedAt, "contributions"); source(c.source, "contributions", p, c.fundedAt, false); exact(c.principal, "contributions");
        need(c.fundedAt >= r.history.openedAt && c.fundedAt <= r.effectiveAt && c.principal.isPositive() &&
          c.fundingOperationId !== r.operationId && !r.claims.entries.some(h => h.operationId === c.fundingOperationId),
          "ORIGINAL_FUNDED_LOT_REQUIRED", "contributions");
        funded = funded.plus(c.principal);
      }
      for (const h of p.distributions) {
        date(h.effectiveAt, "distributions"); source(h.source, "distributions", p, h.effectiveAt, false);
        for (const m of [h.gross, h.basisRecovered, h.earnings]) exact(m, "distributions");
        need(h.effectiveAt >= r.history.openedAt && h.effectiveAt <= r.effectiveAt && h.gross.isPositive() &&
          h.basisRecovered.plus(h.earnings).equals(h.gross) && ["qualified_distribution", "nonqualified_distribution"].includes(h.kind) &&
          r.claims.entries.some(c => c.kind === "distribution" && c.state === "posted" && c.planId === p.planId &&
            c.operationId === h.operationId && c.claimId === h.claimId), "DISTRIBUTION_HISTORY_REQUIRED", "distributions");
        recovered = recovered.plus(h.basisRecovered);
      }
      need(funded.minus(recovered).equals(basis), "BASIS_HISTORY_NOT_RECONCILED", "plan.snapshot");
      source(r.holdings.source, "holdings");
      need(r.holdings.complete === "all_current_lots" && r.holdings.form === "cash_at_par" && cash.equals(value),
        "ACCESSIBLE_CASH_HOLDINGS_REQUIRED", "holdings");
      unique(r.holdings.lots.map(l => l.lotId), "holdings.lotId"); unique(r.holdings.lots.map(l => l.basisId), "holdings.basisId");
      need(r.holdings.lots.length === p.contributions.length, "ORIGINAL_LOT_PARTITION_REQUIRED", "holdings");
      need(pending.compare(cash) <= 0 && r.amount.compare(cash.minus(pending)) <= 0 && r.amount.compare(law.eligibleMaximum) <= 0,
        "REQUEST_EXCEEDS_ELIGIBLE_UNENCUMBERED_FUNDS", "amount");
      need((law.allocation === "whole_plan" && r.amount.equals(value)) || law.allocation === "per_lot_proportional",
        "SOURCED_PARTIAL_ALLOCATION_REQUIRED", "rules.allocation");
      need(["half_up", "half_even", "toward_zero", "away_from_zero", "floor", "ceiling"].includes(law.rounding), "SOURCED_ROUNDING_REQUIRED", "rules.rounding");
      const lots: TransferredLot[] = [];
      let lotBasis = Money.zero(r.currency), lotEarnings = Money.zero(r.currency), movedBasis = Money.zero(r.currency), movedEarnings = Money.zero(r.currency);
      for (const l of [...r.holdings.lots].sort((a, b) => compare(a.lotId, b.lotId))) {
        source(l.source, "holdings.lots"); exact(l.basis, "holdings.lots"); exact(l.earnings, "holdings.lots");
        const c = p.contributions.find(c => c.lotId === l.lotId && c.basisId === l.basisId);
        need(Boolean(c) && l.basis.compare(c!.principal) <= 0, "ORIGINAL_LOT_IDENTITY_REQUIRED", "holdings.lots");
        const portion = (m: Money): Money => r.amount.equals(value) ? m : new Money(m.amount.times(r.amount.amount)
          .dividedBy(value.amount, new RoundingPolicy(2, law.rounding)), r.currency);
        const b = portion(l.basis), e = portion(l.earnings);
        need(b.compare(l.basis) <= 0 && e.compare(l.earnings) <= 0, "LOT_ALLOCATION_EXCEEDS_BALANCE", "holdings.lots");
        lotBasis = lotBasis.plus(l.basis); lotEarnings = lotEarnings.plus(l.earnings);
        movedBasis = movedBasis.plus(b); movedEarnings = movedEarnings.plus(e);
        lots.push({ lotId: l.lotId, basisId: l.basisId, fundingOperationId: c!.fundingOperationId, fundedAt: c!.fundedAt,
          originalPrincipal: c!.principal, originalBasis: l.basis, originalEarnings: l.earnings,
          transferredBasis: b, transferredEarnings: e, remainingBasis: l.basis.minus(b), remainingEarnings: l.earnings.minus(e) });
      }
      need(lotBasis.equals(basis) && lotEarnings.equals(earnings), "LOT_PARTITION_NOT_RECONCILED", "holdings");
      need(movedBasis.plus(movedEarnings).equals(r.amount), "SOURCED_RESIDUAL_ALLOCATION_REQUIRED", "rules.allocation");
      const zero = Money.zero(r.currency);
      proposals.push({ contractVersion: "d2-shared/v1", committed: false, postable: false, physicalTransfer: "not_applied",
        status: "conditional_uncommitted", kind: r.kind, operationId: r.operationId, claimId: r.claimId, transferId: r.transferId,
        transferKey: JSON.stringify([p.householdId, p.accountId, r.transferId]), instrumentFamily: "education_529", taxBucket: "education_529",
        actorId: p.ownerId, priority: "movement", dependsOn: [], effectiveAt: r.effectiveAt, taxYear: r.taxYear,
        ruleSnapshotId: law.source.ruleSnapshotId, sourcePlan: identity(p), destinationPlan: identity(d),
        sourceAccountId: p.cashAccountId, destinationAccountId: d.cashAccountId, grossAmount: r.amount, basis: movedBasis, earnings: movedEarnings,
        sourcePlanAssetDelta: zero.minus(r.amount), destinationPlanAssetDelta: r.amount,
        remainingSourceValue: value.minus(r.amount), remainingSourceBasis: basis.minus(movedBasis), remainingSourceEarnings: earnings.minus(movedEarnings),
        ownedBankCashDelta: zero, consumptionExpenseDelta: zero, movementNetWorthDelta: zero, lots,
        preservedHistory: { ...r.history, changes: [...r.history.changes].sort((a, b) => compare(a.changeId, b.changeId)) },
        beneficiaryChange: change, preservedRothUsage: { ...r.rothUsage, entries: [...r.rothUsage.entries].sort(byOperation) },
        legalProof: { rules: law, jurisdictionPermissions: [...r.jurisdictionPermissions].sort((a, b) =>
          compare(a.side, b.side) || compare(a.level, b.level)) },
        fundingProof: { snapshot: s, holdings: { ...r.holdings, lots: [...r.holdings.lots].sort((a, b) => compare(a.lotId, b.lotId)) },
          claims: { ...r.claims, entries: [...r.claims.entries].sort(byOperation) }, originatingAcceptance: r.originatingAcceptance, receivingAcceptance: r.receivingAcceptance },
        traceRefs: [...refs].sort(compare), sources: [...sources.values()].sort((a, b) => compare(a.sourceId, b.sourceId)) });
    } catch (e) {
      if (!(e instanceof Incomplete)) throw e;
      failure = e;
    }
    for (const affectedOutput of outputs) {
      const complete = !failure && ["eligibility", "basis_earnings", "continuity"].includes(affectedOutput);
      const code = failure?.code ?? (complete ? null : affectedOutput.endsWith("tax") ? "TAX_AUTHORITY_REQUIRED_101" : "SHARED_ATOMIC_OWNER_REQUIRED_149");
      coverage.push({ operationId: r.operationId, sourceEntityPath: failure?.path ?? `plan.${p.planId}.${affectedOutput}`,
        period: { start: `${r.taxYear}-01-01` as CivilDate, endExclusive: `${r.taxYear + 1}-01-01` as CivilDate }, affectedOutput,
        coverage: complete ? "complete" : "incomplete", diagnosticCode: code, missingFacts: code ? [failure?.path ?? affectedOutput] : [],
        ruleSnapshotId: r.rules?.source.ruleSnapshotId ?? null, traceRefs: [...refs].sort(compare) });
    }
  }
  coverage.sort((a, b) => byOperation(a, b) || outputs.indexOf(a.affectedOutput) - outputs.indexOf(b.affectedOutput) || compare(JSON.stringify(a), JSON.stringify(b)));
  return immutable({ proposals, coverage });
}
