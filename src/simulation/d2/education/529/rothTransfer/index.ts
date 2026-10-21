import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { Currency, Money } from "../../../../../values/index.js";
import type { EducationSource } from "../types.js";
import type { IraCapacity, RothCoverage, RothOutput, RothProposal, RothTransferRequest, RothTransferResult } from "./types.js";
export type * from "./types.js";

const present = (v: string): boolean => typeof v === "string" && v.trim().length > 0;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
class Incomplete extends Error {
  constructor(readonly code: string, readonly path: string) { super(code); }
}
const need = (ok: boolean, code: string, path: string): void => { if (!ok) throw new Incomplete(code, path); };
const date = (v: CivilDate, path: string): void => {
  try { civilDate(v); } catch { throw new Incomplete("INVALID_DATE", path); }
};
const unique = (ids: readonly string[], path: string): void =>
  need(ids.every(present) && new Set(ids).size === ids.length, "DUPLICATE_OR_MISSING_ID", path);
const year = (d: CivilDate): number => Number(d.slice(0, 4));
const outputs: readonly RothOutput[] = ["eligibility", "basis_earnings", "annual_capacity", "lifetime_capacity", "funding", "federal_tax", "state_tax", "local_tax", "settlement"];
const key = (c: IraCapacity): string => JSON.stringify([c.personId, c.taxYear, c.limitScope.kind, c.limitScope.aggregationId, c.ruleSnapshotId]);
/** Clone/freeze containers without freezing or retaining mutable caller objects.
 * Money and its value objects are already immutable. */
function immutable<T>(value: T): T {
  if (value === null || typeof value !== "object" || value instanceof Money || value instanceof Currency) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(v => immutable(v))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, immutable(v)]))) as T;
}

/** Pure conditional eligibility. No postings, tax calculation, capacity reservation
 * or B3-1 expense logic. Ambiguous shared-beneficiary batches fail closed together. */
export function propose529RothTransfers(input: readonly RothTransferRequest[]): RothTransferResult {
  // Avoid unbounded diagnostic generation as well as unbounded evaluation.
  if (input.length > 256) throw new RangeError("ROTH_TRANSFER_BATCH_LIMIT");
  const requests = [...input].sort((a, b) => compare(a.operationId, b.operationId) || compare(a.claimId, b.claimId));
  const proposals: RothProposal[] = [], coverage: RothCoverage[] = [], bounds: RothTransferResult["bounds"][number][] = [];
  for (const r of requests) {
    const p = r.plan, s = p.snapshot, refs = new Set<string>(), sources = new Map<string, EducationSource>();
    const versions = new Map<string, string>();
    let failure: Incomplete | null = null;
    const exact = (m: Money, path: string): void => need(m instanceof Money && m.currency.equals(r.currency) &&
      r.currency.minorUnitScale === 2 && !m.isNegative() && m.amount.fitsScale(2), "EXACT_MONEY_REQUIRED", path);
    const source = (v: EducationSource, path: string, scope = { ownerId: p.ownerId, planId: p.planId, providerId: p.providerId }, current = true, effectiveAt: CivilDate = r.effectiveAt): void => {
      need(Boolean(v), "SOURCE_REQUIRED", path);
      refs.add(v.sourceId);
      for (const d of [v.start, v.endExclusive, v.publishedAt, v.asOf]) date(d, path);
      need([v.sourceId, v.sourcePublication, v.ruleSnapshotId, v.jurisdiction, v.version].every(present), "SOURCE_IDENTITY_REQUIRED", path);
      need(v.verification === "verified" && v.projectionStatus === "verified" && v.ruleFamily === "education_529" &&
        v.start < v.endExclusive && v.start <= effectiveAt && effectiveAt < v.endExclusive &&
        v.publishedAt <= v.asOf && v.asOf <= r.effectiveAt && v.asOf <= r.knownAt &&
        (!current || v.asOf === r.effectiveAt), "SOURCE_UNVERIFIED_STALE_OR_UNAVAILABLE", path);
      need(v.householdId === p.householdId && v.beneficiaryId === p.beneficiaryId && v.ownerId === scope.ownerId &&
        v.planId === scope.planId && v.providerId === scope.providerId && v.currency.equals(r.currency), "SOURCE_SCOPE_MISMATCH", path);
      const fingerprint = JSON.stringify([v.sourcePublication, v.publishedAt, v.asOf, v.start, v.endExclusive,
        v.ruleSnapshotId, v.jurisdiction, v.version, v.householdId, v.ownerId, v.beneficiaryId, v.planId, v.providerId, v.currency.code]);
      need(!versions.has(v.sourceId) || versions.get(v.sourceId) === fingerprint, "CONFLICTING_SOURCE_ID", path);
      versions.set(v.sourceId, fingerprint); sources.set(v.sourceId, v);
    };
    try {
      date(r.effectiveAt, "effectiveAt"); date(r.knownAt, "knownAt");
      need(Number.isSafeInteger(r.taxYear) && r.taxYear >= 1000 && r.taxYear < 9999 && year(r.effectiveAt) === r.taxYear &&
        r.effectiveAt <= r.knownAt, "EVENT_YEAR_REQUIRED", "taxYear");
      need([r.operationId, r.claimId, p.householdId, p.ownerId, p.beneficiaryId, p.planId, p.providerId,
        p.accountId, p.cashAccountId, r.holdings.holdingId].every(present), "IDENTITY_REQUIRED", "plan");
      unique([p.accountId, p.cashAccountId, r.holdings.holdingId], "plan.container_cash_holding");
      need(r.kind === "529_beneficiary_roth_direct_trustee_transfer", "NOT_A_DIRECT_BENEFICIARY_TRANSFER", "kind");
      need(requests.filter(x => x.operationId === r.operationId || x.claimId === r.claimId).length === 1, "BATCH_DUPLICATE_ID", "batch");
      // No arbitrary ordering/implicit legal precedence. #149 must aggregate shared
      // capacity and physical source claims before admitting concurrent requests.
      need(requests.filter(x => x.plan.beneficiaryId === p.beneficiaryId || x.plan.planId === p.planId ||
        x.plan.cashAccountId === p.cashAccountId || x.holdings.holdingId === r.holdings.holdingId ||
        x.destination.accountId === r.destination.accountId).length === 1, "BATCH_SHARED_RESOURCE", "batch");
      need(p.taxBucket === "education_529" && p.treatment === "ordinary_original_owner", "UNSUPPORTED_PLAN", "plan");
      need(p.contributions.length <= 10000 && p.distributions.length <= 10000 && r.holdings.lots.length <= 10000 &&
        r.usage.entries.length <= 10000 && r.history.changes.length <= 256, "INPUT_LIMIT", "history");
      const law = r.rules;
      if (!law) throw new Incomplete("SOURCED_LAW_REQUIRED", "rules");
      source(law.source, "rules", undefined, false);
      need(law.source.jurisdiction === "US" && law.treatment === "direct_trustee_beneficiary_roth" &&
        law.recentTreatment === "exclude_contributions_and_allocable_earnings" &&
        Number.isSafeInteger(law.minimumPlanAgeYears) && law.minimumPlanAgeYears > 0 &&
        [law.annualCapacityRuleSnapshotId, law.compensationRuleSnapshotId].every(present), "APPLICABLE_LAW_REQUIRED", "rules");
      exact(law.lifetimeMaximum, "rules.lifetimeMaximum");
      source(p.source, "plan"); source(s.source, "plan.snapshot"); source(r.history.source, "history");
      date(law.recentFrom, "rules.recentFrom");
      need(law.recentFrom <= r.effectiveAt, "INVALID_LOOKBACK", "rules.recentFrom");
      for (const d of [r.history.openedAt, r.history.beneficiarySince, r.history.ageStart]) date(d, "history");
      need(r.history.complete === "complete_since_inception" && r.history.openedAt <= r.history.beneficiarySince &&
        r.history.beneficiarySince <= r.effectiveAt && r.history.ageStart <= r.effectiveAt &&
        (law.ageStartPermission === "original_opening" ? r.history.ageStart === r.history.openedAt :
          law.ageStartPermission === "sourced_continuity" && r.history.changes.length > 0), "AGED_HISTORY_REQUIRED", "history");
      unique(r.history.changes.map(c => c.changeId), "history.changes");
      for (const c of r.history.changes) {
        date(c.at, "history.changes"); source(c.source, "history.changes", undefined, false, c.at);
        need(c.at >= r.history.openedAt && c.at <= r.effectiveAt && c.continuity === "verified_preserved" &&
          ["plan_transfer", "beneficiary_change"].includes(c.kind) && law.ageStartPermission === "sourced_continuity" &&
          c.source.ruleSnapshotId === law.source.ruleSnapshotId, "LEGAL_CONTINUITY_REQUIRED", "history.changes");
      }
      const beneficiaryChanges = r.history.changes.filter(c => c.kind === "beneficiary_change").map(c => c.at).sort(compare);
      need(beneficiaryChanges.length ? beneficiaryChanges[beneficiaryChanges.length - 1] === r.history.beneficiarySince :
        r.history.beneficiarySince === r.history.openedAt, "BENEFICIARY_CONTINUITY_REQUIRED", "history");
      // Calendar anniversary comparison avoids elapsed-day approximations and
      // invented leap-day treatment; unavailable anniversary needs sourced interpretation.
      const anniversaryYear = year(r.history.ageStart) + law.minimumPlanAgeYears;
      need(anniversaryYear < 10000, "PLAN_AGE_NOT_MET", "history.ageStart");
      const anniversary = `${anniversaryYear}-${r.history.ageStart.slice(5)}` as CivilDate;
      date(anniversary, "history.ageAnniversary");
      need(r.effectiveAt >= anniversary, "PLAN_AGE_NOT_MET", "history.ageStart");
      need(s.at === r.effectiveAt && s.taxYear === r.taxYear && s.history === "complete_since_inception" &&
        Boolean(s.currentValue && s.contributionBasis && s.earnings && s.unencumberedCash), "CURRENT_PLAN_BALANCES_REQUIRED", "plan.snapshot");
      const value = s.currentValue!, basis = s.contributionBasis!, earnings = s.earnings!, cash = s.unencumberedCash!;
      for (const m of [r.amount, value, basis, earnings, cash]) exact(m, "plan.snapshot");
      need(r.amount.isPositive() && basis.plus(earnings).equals(value) && cash.compare(value) <= 0, "PLAN_BALANCES_NOT_RECONCILED", "plan.snapshot");
      const d = r.destination, a = r.authorization;
      source(d.source, "destination"); source(a.source, "authorization"); exact(a.amount, "authorization.amount");
      need([d.accountId, d.trusteeId, d.receivingTrusteeId].every(present) && d.ownerId === p.beneficiaryId &&
        d.householdId === p.householdId && d.taxBucket === "roth_ira" && d.route === "direct_trustee" &&
        d.trusteeId === d.receivingTrusteeId && ![p.accountId, p.cashAccountId, r.holdings.holdingId].includes(d.accountId),
      "BENEFICIARY_ROTH_TRUSTEE_REQUIRED", "destination");
      need(a.permitted === "yes" && a.operationId === r.operationId && a.claimId === r.claimId &&
        a.holdingId === r.holdings.holdingId && a.sourceAccountId === p.cashAccountId && a.destinationAccountId === d.accountId &&
        a.receivingTrusteeId === d.receivingTrusteeId && a.amount.equals(r.amount), "EXACT_AUTHORIZATION_REQUIRED", "authorization");
      source(r.usage.source, "usage");
      need(r.usage.at === r.effectiveAt && r.usage.completeness === "all_beneficiary_lifetime_transfers_and_annual_ira_including_pending",
        "EXHAUSTIVE_USAGE_REQUIRED", "usage");
      unique(r.usage.entries.map(u => u.operationId), "usage.operationId"); unique(r.usage.entries.map(u => u.claimId), "usage.claimId");
      let annualUsed = Money.zero(r.currency), lifetimeUsed = Money.zero(r.currency), rothBasisRecovered = Money.zero(r.currency);
      for (const u of r.usage.entries) {
        date(u.effectiveAt, "usage.entries"); source(u.source, "usage.entries", u, false, u.state === "posted" ? u.effectiveAt : r.effectiveAt);
        for (const m of [u.amount, u.basis, u.earnings]) exact(m, "usage.entries");
        need([u.operationId, u.claimId, u.ownerId, u.planId, u.providerId, u.destinationAccountId].every(present) &&
          u.beneficiaryId === p.beneficiaryId && u.operationId !== r.operationId && u.claimId !== r.claimId &&
          Number.isSafeInteger(u.taxYear) && u.taxYear >= 1000 && u.taxYear <= r.taxYear && year(u.effectiveAt) === u.taxYear &&
          u.amount.isPositive() && (u.state === "posted" ? u.effectiveAt <= r.effectiveAt : u.state === "pending_authorized") &&
          ["regular_ira_contribution", "529_roth_transfer"].includes(u.kind), "USAGE_IDENTITY_OR_DATE_INVALID", "usage.entries");
        if (u.taxYear === r.taxYear) annualUsed = annualUsed.plus(u.amount);
        if (u.kind === "529_roth_transfer") {
          need(u.basis.plus(u.earnings).equals(u.amount), "HISTORICAL_ROTH_BASIS_REQUIRED", "usage.entries");
          lifetimeUsed = lifetimeUsed.plus(u.amount);
          if (u.planId === p.planId) {
            need(u.ownerId === p.ownerId && u.providerId === p.providerId, "PLAN_HISTORY_IDENTITY_CONFLICT", "usage.entries");
            if (u.state === "posted") rothBasisRecovered = rothBasisRecovered.plus(u.basis);
          }
        } else need(u.basis.isZero() && u.earnings.isZero(), "REGULAR_USAGE_NOT_529_BASIS", "usage.entries");
      }
      const capacityRoom = (c: IraCapacity, kind: IraCapacity["limitScope"]["kind"], version: string): Money => {
        need(Boolean(c), "IRA_CAPACITY_REQUIRED", kind);
        source(c.source, kind, undefined, false); source(c.usageSource, `${kind}.usageSource`);
        exact(c.maximum, kind); exact(c.used, kind);
        need(c.personId === p.beneficiaryId && c.taxYear === r.taxYear && c.asOf === r.effectiveAt &&
          c.completeness === "complete" && c.limitScope.kind === kind && c.limitScope.aggregationId === "person" &&
          c.ruleSnapshotId === version && c.source.ruleSnapshotId === version && c.source.start >= `${r.taxYear}-01-01` &&
          c.source.endExclusive <= `${r.taxYear + 1}-01-01` && c.used.equals(annualUsed) && c.used.compare(c.maximum) <= 0,
        "IRA_CAPACITY_IDENTITY_OR_USAGE_MISMATCH", kind);
        return c.maximum.minus(c.used);
      };
      const annualRoom = capacityRoom(r.annualCapacity, "ira_annual", law.annualCapacityRuleSnapshotId);
      const compensationRoom = capacityRoom(r.compensationCapacity, "ira_compensation", law.compensationRuleSnapshotId);
      need(lifetimeUsed.compare(law.lifetimeMaximum) <= 0, "LIFETIME_USAGE_EXCEEDS_LIMIT", "usage");
      const lifetimeRoom = law.lifetimeMaximum.minus(lifetimeUsed);
      unique(p.contributions.map(c => c.lotId), "plan.contributions.lotId");
      unique(p.contributions.map(c => c.basisId), "plan.contributions.basisId");
      unique([...p.contributions.map(c => c.fundingOperationId), ...p.distributions.map(c => c.operationId),
        ...r.usage.entries.map(u => u.operationId)], "history.operationId");
      unique([...p.distributions.map(c => c.claimId), ...r.usage.entries.map(u => u.claimId)], "history.claimId");
      need(!p.contributions.some(c => c.fundingOperationId === r.operationId) &&
        !p.distributions.some(c => c.operationId === r.operationId || c.claimId === r.claimId), "REPLAY_ALREADY_USED", "history");
      let originalBasis = Money.zero(r.currency), recoveredBasis = rothBasisRecovered;
      for (const c of p.contributions) {
        date(c.fundedAt, "plan.contributions"); exact(c.principal, "plan.contributions");
        source(c.source, "plan.contributions", undefined, false, c.fundedAt);
        need(c.fundedAt >= r.history.openedAt && c.fundedAt <= r.effectiveAt && c.source.asOf >= c.fundedAt &&
          c.principal.isPositive(), "FUNDED_CONTRIBUTION_REQUIRED", "plan.contributions");
        originalBasis = originalBasis.plus(c.principal);
      }
      for (const h of p.distributions) {
        date(h.effectiveAt, "plan.distributions"); source(h.source, "plan.distributions", undefined, false, h.effectiveAt);
        for (const m of [h.gross, h.basisRecovered, h.earnings]) exact(m, "plan.distributions");
        need(h.effectiveAt >= r.history.openedAt && h.effectiveAt <= r.effectiveAt && h.source.asOf >= h.effectiveAt &&
          h.gross.isPositive() && h.basisRecovered.plus(h.earnings).equals(h.gross) &&
          ["qualified_distribution", "nonqualified_distribution"].includes(h.kind), "DISTRIBUTION_HISTORY_INVALID", "plan.distributions");
        recoveredBasis = recoveredBasis.plus(h.basisRecovered);
      }
      need(originalBasis.minus(recoveredBasis).equals(basis), "BASIS_HISTORY_NOT_RECONCILED", "plan.snapshot");
      source(r.holdings.source, "holdings");
      need(r.holdings.complete === "all_current_lots", "EXHAUSTIVE_HOLDINGS_REQUIRED", "holdings");
      unique(r.holdings.lots.map(l => l.lotId), "holdings.lotId"); unique(r.holdings.lots.map(l => l.basisId), "holdings.basisId");
      need(r.holdings.lots.length === p.contributions.length, "LOT_PARTITION_INCOMPLETE", "holdings");
      let eligibleBasis = Money.zero(r.currency), eligibleEarnings = Money.zero(r.currency);
      let excludedBasis = Money.zero(r.currency), excludedEarnings = Money.zero(r.currency);
      for (const l of r.holdings.lots) {
        source(l.source, "holdings.lots"); exact(l.basis, "holdings.lots"); exact(l.earnings, "holdings.lots");
        const c = p.contributions.find(c => c.lotId === l.lotId && c.basisId === l.basisId);
        need(Boolean(c) && l.basis.compare(c!.principal) <= 0, "LOT_BASIS_IDENTITY_INVALID", "holdings.lots");
        if (c!.fundedAt >= law.recentFrom) { excludedBasis = excludedBasis.plus(l.basis); excludedEarnings = excludedEarnings.plus(l.earnings); }
        else { eligibleBasis = eligibleBasis.plus(l.basis); eligibleEarnings = eligibleEarnings.plus(l.earnings); }
      }
      need(eligibleBasis.plus(excludedBasis).equals(basis) && eligibleEarnings.plus(excludedEarnings).equals(earnings),
        "LOT_PARTITION_NOT_RECONCILED", "holdings");
      const eligibleAmount = eligibleBasis.plus(eligibleEarnings), excludedAmount = excludedBasis.plus(excludedEarnings);
      // Existing authorized pending source claims have not yet reduced current cash/value.
      let pendingSource = Money.zero(r.currency);
      for (const u of r.usage.entries) if (u.kind === "529_roth_transfer" && u.planId === p.planId && u.state === "pending_authorized") pendingSource = pendingSource.plus(u.amount);
      need(pendingSource.compare(cash) <= 0 && pendingSource.compare(eligibleAmount) <= 0, "PENDING_SOURCE_OVERDRAWN", "usage");
      const permitted = [r.amount, a.amount, value, cash.minus(pendingSource), eligibleAmount.minus(pendingSource), annualRoom, compensationRoom, lifetimeRoom]
        .reduce((a, b) => a.compare(b) <= 0 ? a : b);
      bounds.push({ operationId: r.operationId, requestedAmount: r.amount, permittedAmount: permitted });
      need(r.amount.compare(permitted) <= 0, "REQUEST_EXCEEDS_PERMITTED_AMOUNT", "amount");
      proposals.push({ contractVersion: "d2-shared/v1", committed: false, postable: false, physicalTransfer: "not_applied",
        status: "conditional_uncommitted", kind: r.kind, instrumentFamily: "education_529", taxBucket: "education_529", priority: "movement", dependsOn: [],
        operationId: r.operationId, claimId: r.claimId, actorId: p.ownerId, personId: p.beneficiaryId, householdId: p.householdId,
        beneficiaryId: p.beneficiaryId, planId: p.planId, providerId: p.providerId, planAccountId: p.accountId,
        sourceAccountId: p.cashAccountId, holdingId: r.holdings.holdingId, destinationAccountId: d.accountId, receivingTrusteeId: d.receivingTrusteeId,
        effectiveAt: r.effectiveAt, taxYear: r.taxYear, ruleSnapshotId: law.source.ruleSnapshotId, grossAmount: r.amount,
        eligibleAmount, excludedAmount, eligibleBasis, eligibleEarnings, excludedBasis, excludedEarnings,
        originalPlanValue: value, originalBasis: basis, originalEarnings: earnings, originalLiquidCash: cash,
        basisLotIds: [...r.holdings.lots].sort((a, b) => compare(a.lotId, b.lotId)).map(l => ({ lotId: l.lotId, basisId: l.basisId })),
        availableAnnualRoom: annualRoom, availableCompensationRoom: compensationRoom, availableLifetimeRoom: lifetimeRoom,
        proposedCapacity: [r.annualCapacity, r.compensationCapacity].map(c => ({ key: key(c), personId: c.personId,
          taxYear: c.taxYear, legalLimitScope: { ...c.limitScope }, ruleSnapshotId: c.ruleSnapshotId,
          priorUsage: c.used, proposedIncrement: r.amount, committed: false })), proposedLifetimeIncrement: r.amount,
        traceRefs: [...refs].sort(compare), sources: [...sources.values()].sort((a, b) => compare(a.sourceId, b.sourceId)) });
    } catch (e) {
      if (!(e instanceof Incomplete)) throw e;
      failure = e;
    }
    for (const affectedOutput of outputs) {
      const domain = ["eligibility", "basis_earnings", "annual_capacity", "lifetime_capacity"].includes(affectedOutput);
      const code = failure?.code ?? (domain ? null : affectedOutput.includes("tax") ? "TAX_AUTHORITY_REQUIRED" : "SHARED_ATOMIC_SETTLEMENT_REQUIRED");
      coverage.push({ operationId: r.operationId, sourceEntityPath: failure?.path ?? `plan.${p.planId}.${affectedOutput}`,
        period: { start: `${r.taxYear}-01-01` as CivilDate, endExclusive: `${r.taxYear + 1}-01-01` as CivilDate }, affectedOutput,
        coverage: domain && !failure ? "complete" : "incomplete", diagnosticCode: code,
        missingFacts: code ? [failure?.path ?? affectedOutput] : [], ruleSnapshotId: r.rules?.source.ruleSnapshotId ?? null, traceRefs: [...refs].sort(compare) });
    }
  }
  // Duplicate operation/claim diagnostics can differ in year or source version;
  // their ordering must also be independent of the caller's batch order.
  coverage.sort((a, b) => compare(a.operationId, b.operationId) ||
    outputs.indexOf(a.affectedOutput) - outputs.indexOf(b.affectedOutput) || compare(JSON.stringify(a), JSON.stringify(b)));
  return immutable({ proposals, bounds, coverage });
}
