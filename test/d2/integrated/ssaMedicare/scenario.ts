import { domainId } from "../../../../src/identity/index.js";
import { claimId, settlementId } from "../../../../src/semantics/identity.js";
import type { SsaDeductionSource, SsaPayableEvidence } from "../../../../src/semantics/settlement.js";
import { createAuthoritativeState, type AuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { composeMedicareObligations, type MedicareCoordinationRequest } from "../../../../src/simulation/d2/health/medicare/coordination/index.js";
import type { MedicareElection, PremiumSource } from "../../../../src/simulation/d2/health/premiums/index.js";
import type { QuotedBenefit } from "../../../../src/simulation/d2/retirement/benefits/index.js";
import { coordinateSocialSecurity } from "../../../../src/simulation/d2/retirement/benefits/coordination/index.js";
import type { ConfirmedSsaMedicarePayment, SsaMedicareInput } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";

export const uuid = (n: number) => `149e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { household: domainId("household", uuid(1)), person: domainId("person", uuid(2)), bank: domainId("account", uuid(3)) };
const d = civilDate;
const known = instant("2025-12-01T00:00:00.000Z");
const span = { start: d("2026-01-01"), endExclusive: d("2028-01-01") };
const parts: readonly MedicareElection[] = ["part_a", "part_b", "part_d", "advantage", "medigap", "supplement"];
const source = (ruleFamily: string): PremiumSource => ({ ...span, ruleSnapshotId: `synthetic:${ruleFamily}`, ruleFamily,
  jurisdiction: "US", sourcePublication: "Synthetic evidence only; no official SSA/CMS law", asOf: d("2025-12-01"),
  version: "synthetic-v1", projectionStatus: "verified" });
export const scopedSource = (scopeId: string, ruleFamily: string,
  s: Pick<PremiumSource, "ruleSnapshotId" | "version" | "sourcePublication" | "asOf">
    & Partial<Pick<PremiumSource, "start" | "endExclusive">> = source(ruleFamily)): SsaDeductionSource => ({
  scopeId, ruleFamily, ruleSnapshotId: s.ruleSnapshotId, version: s.version, sourcePublication: s.sourcePublication,
  jurisdiction: "US", status: "verified", effectiveStart: s.start ?? span.start, effectiveEndExclusive: s.endExclusive ?? span.endExclusive,
  asOf: instant(`${s.asOf}T00:00:00.000Z`), publishedAt: known, knownAt: known,
});

export function payment(month = "2026-06", bankCashBefore = money("2000")): ConfirmedSsaMedicarePayment {
  const start = d(`${month}-01`), date = d(`${month}-15`);
  const year = Number(month.slice(0, 4)), m = Number(month.slice(5));
  const endExclusive = d(m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`);
  const period = { start, endExclusive }, s = source("ssa_quote");
  const quoted: QuotedBenefit = { awardId: "original", entitlementId: "original-entitlement", householdId: ids.household,
    recipientPersonId: ids.person, workerRecordPersonId: ids.person, benefitKind: "ss_retirement",
    claimingMonth: d("2026-01-01"), commencement: d("2026-01-15"), frequency: "monthly", invalidDayPolicy: "skip", calendarSource: s,
    quote: { recipientPersonId: ids.person, workerRecordPersonId: ids.person, claimingMonth: d("2026-01-01"),
      adjustmentOrder: "claiming_then_cola_then_continuation", grossAmount: money("1500"), asOf: s.asOf,
      dollarBasisAt: d("2026-01-01"), basis: "at_claim", source: s, coveredHorizon: span },
    verifiedAward: { recipientPersonId: ids.person, workerRecordPersonId: ids.person, claimingMonth: d("2026-01-01"),
      coveredHorizon: span, source: s, eligibility: "eligible", coordination: "total_payable_award", unsupportedRules: [] },
    cola: { coveredHorizon: span, source: s, changes: [] } };
  const evidence = { evidenceId: "ssa-evidence", coverageSetId: "ssa-set", knownAt: s.asOf, publishedAt: s.asOf, effective: span, source: s };
  const a1: ConfirmedSsaMedicarePayment["a1"] = { householdId: ids.household, knownAt: d("2025-12-31"), horizon: period,
    recipients: [{ recipientPersonId: ids.person, enabled: true, quotes: [{ quoteId: "own", role: "own", evidence, award: quoted }],
      determinations: [{ determinationId: "determination", electionId: "election", versionId: "v1", evidence, inventoryComplete: true,
        inventoryQuoteIds: ["own"], strategy: "own", benefitKind: "ss_retirement", ownQuoteId: "own", paymentAwardId: "payment",
        paymentEntitlementId: "payable-entitlement", paymentWorkerRecordPersonId: ids.person, claimingMonth: quoted.claimingMonth,
        installmentDay: "15", eligibility: "eligible", relationship: "self", unsupportedRules: [] }] }] };
  const award = coordinateSocialSecurity(a1).proposals[0]!;
  const elected = ["part_b", "part_d"] as const;
  const coverages = elected.map(part => ({ ...span, id: `coverage:${part}`, householdId: ids.household, memberIds: [ids.person],
    planId: `plan:${part}`, sponsorId: "sponsor", recipientId: `provider:${part}`, planFamily: "medicare" as const,
    route: { kind: "ssa_benefit_deduction_pending" as const, payerId: ids.person, benefitId: award.quotedAward.awardId, evidence: source("route") },
    eligibility: [{ memberId: ids.person, householdId: ids.household, planId: `plan:${part}`, eligible: true, evidence: source("eligibility") }],
    medicare: { premiumFor: part, elected, enrollmentEvidence: source("medicare_enrollment"), compatibilityEvidence: source("coordination") },
    quote: { quoteId: `quote:${part}:${month}`, source: source("medicare_quote"), gross: money(part === "part_b" ? "80" : "120"), employer: money("0"),
      member: money(part === "part_b" ? "80" : "120"), schedule: { anchor: start, frequency: "monthly" as const, interval: 1,
        invalidDay: "skip" as const, amountBasis: "per_occurrence_no_proration" as const } } }));
  const c2: MedicareCoordinationRequest = {
    premiums: { householdId: ids.household, memberIds: [ids.person], period, coverages,
      coordination: [{ memberId: ids.person, coverageIds: coverages.map(c => c.id), admitsDistinctPremiums: true, evidence: source("coordination") }] },
    irmaa: { householdId: ids.household, personIds: [ids.person], period, taxYear: year,
      enrollments: coverages.map(c => ({ ...span, coverageId: c.id, personId: ids.person, householdId: ids.household, planId: c.planId,
        part: c.medicare.premiumFor, elected, source: source("medicare_enrollment") })), deaths: [], overrides: [],
      histories: [{ personId: ids.person, householdId: ids.household, taxYear: year - 2, taxReturnRef: `return:${year - 2}`,
        filingStatus: "single", maritalState: "unmarried", magi: money("0"), source: { ...source("historical_tax_return"),
          start: d(`${year - 2}-01-01`), endExclusive: d(`${year - 1}-01-01`), asOf: d("2026-01-01") } }],
      rules: [{ source: source("cms_irmaa"), taxYear: year, lookbackTaxYear: year - 2, currency: "USD", monthlyConvention: "whole_month_only",
        tables: [{ filingStatus: "single", maritalState: "unmarried", tiers: [{ id: "verified-zero", lower: null, lowerInclusive: false,
          upper: null, upperInclusive: false, partBMonthly: money("0"), partDMonthly: money("0") }] }] }] },
    inventories: [{ ...period, householdId: ids.household, personId: ids.person, eventAt: start, source: source("medicare_inventory"),
      parts: parts.map(part => elected.some(p => p === part) ? { part, status: "elected" as const, coverageId: `coverage:${part}`, source: source("election") }
        : { part, status: "excluded" as const, reason: "explicit sourced exclusion", source: source("election") }),
      surcharges: elected.map(part => ({ part, status: "applicable" as const, reason: "explicit source-known zero tier", source: source("cms_coverage") })) }],
    banks: [], awards: [award.quotedAward], deductionTerms: elected.map(part => ({ ...period, householdId: ids.household, personId: ids.person,
      benefitId: award.quotedAward.awardId, part, coverageId: `coverage:${part}`, recipientId: `provider:${part}`,
      permittedAmount: money(part === "part_b" ? "80" : "120"), source: source("ssa_medicare_deduction") })),
  };
  const identity = { householdId: ids.household, recipientId: ids.person, workerRecordId: ids.person,
    awardId: award.quotedAward.awardId, entitlementId: award.quotedAward.entitlementId,
    paymentId: award.claimId, rightClaimId: claimId(award.claimId), rightRecognitionId: `ssa-recognition:${month}`, paymentAt: instant(`${date}T00:00:00.000Z`) };
  const payable: SsaPayableEvidence = { ...identity, kind: "coordinated_ssa_payable", benefitKind: "ss_retirement", eligibility: "eligible",
    grossPayable: award.grossAmount, source: scopedSource(identity.paymentId, "ssa_coordinated_payable", award.quotedAward.quote!.source),
    taxWithholding: { status: "verified_zero", payable: identity, amount: money("0"), source: scopedSource(identity.paymentId, "ssa_withholding") } };
  const rows = composeMedicareObligations(c2).obligations;
  return { a1, award, c2, payable, bankCashBefore, rightSettlementId: `ssa-settlement:${month}`,
    bank: { classification: "BANK", accountId: ids.bank, householdId: ids.household, personId: ids.person, evidence: scopedSource(ids.bank, "bank_ownership") },
    deductions: rows.map(row => {
      const evidenceId = `premium:${row.part}:${month}`, authorizationId = `authorization:${row.part}:${month}`;
      const premium = { evidenceId, householdId: ids.household, beneficiaryId: ids.person,
        part: row.part, coverageId: row.coverageId, providerId: row.recipientId, periodStart: start, periodEndExclusive: endExclusive,
        status: "complete" as const, base: row.memberBase, irmaa: row.surcharge, source: scopedSource(evidenceId, "medicare_premium", row.base.source) };
      return { draft: { id: settlementId(`medicare-settlement:${row.part}:${month}`), settledAt: payable.paymentAt },
        terms: { authorizationId, receiptId: `receipt:${row.part}:${month}`, traceId: evidenceId, route: "ssa_payable_deduction" as const,
          payable: identity, premium, premiumScope: { evidenceId, householdId: ids.household, beneficiaryId: ids.person, part: row.part,
            coverageId: row.coverageId, providerId: row.recipientId, periodStart: start, periodEndExclusive: endExclusive },
          obligationId: claimId(row.claimId), obligationRecognitionId: `medicare-recognition:${row.part}:${month}`,
          amount: row.memberObligation, partialDeduction: "forbidden" as const,
          source: scopedSource(authorizationId, "ssa_medicare_deduction", c2.deductionTerms.find(t => t.part === row.part)!.source) } };
    }) };
}
export const input = (payments = [payment()]): SsaMedicareInput => ({ householdId: ids.household, personId: ids.person, payments });
export function fixture(months = 1, opening?: AuthoritativeState, startMonth = "2026-06") {
  const start = instant(`${startMonth}-01T00:00:00.000Z`);
  const state = opening ?? createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.person, cash: money("2000") } } });
  const context = createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)), asOf: instant("2026-01-01T00:00:00.000Z"),
    dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: start, simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: { synthetic: "#149 SSA/Medicare same-event settlement" } }, start);
  return { state, context, kernel };
}
