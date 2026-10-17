import { domainId } from "../../src/identity/index.js";
import { calculationTraceId } from "../../src/lineage/index.js";
import { money } from "../../src/values/index.js";
import {
  decimal, evaluateCapitalLoss, evaluateWashSales, harvestActivityFingerprint, openingCapitalState,
  type AccountId, type AuthoritativeEvaluation, type CapitalInput, type Context, type ExchangeInput,
  type HarvestInput, type LandParcel, type LossSale, type LotId, type OwnerId, type Predicate,
  type PropertyId, type Replacement, type SecurityId, type WashInput,
} from "../../src/rules/tax/t1b/index.js";

/** Synthetic facts and evaluation receipts; these fixtures never supply tax law. */
export const yes: Predicate = { value: true, evidence: ["synthetic:verified"] };
export const no: Predicate = { value: false, evidence: ["synthetic:verified"] };
export const unknown: Predicate = { value: "unknown", evidence: [] };
export const owner = "taxpayer" as OwnerId;
export const context = (taxYear = 2025): Context => ({ taxYear, owner, jurisdiction: "US", sources: ["synthetic:return"], ...(taxYear === 2025 ? {} : { projection: "2025_nominal_current_law" as const }) });
export const capitalInput = (overrides: Partial<CapitalInput> = {}): CapitalInput => ({
  context: context(), filingStatus: "single", opening: openingCapitalState(context(), "single", "synthetic:no_prior_losses"),
  shortRealized: money("-5000"), longRealized: money("-4000"),
  returnContext: { signedTaxableIncomeAfterDeduction: money("20000"), authoritativeResultId: "synthetic:1040",
    ordinaryCategoriesOnly: yes, noNolOrDebtAttributeReduction: yes, ownershipAndFilingAllocationUnchanged: yes, finalReturn: no },
  ...overrides,
});
export const sale = (overrides: Partial<LossSale> = {}): LossSale => ({
  id: "sale-1", lot: "sold-lot" as LotId, security: "stock-A" as SecurityId,
  account: "broker-1" as AccountId, beneficialOwner: owner, economicOwner: owner,
  date: "2025-06-15", executionOrder: 1, quantity: decimal("100"), unit: "shares", instrument: "stock",
  sources: ["synthetic:lot-and-trade"], basis: money("2000"), netProceeds: money("1000"), holdingPeriodDays: 100, character: "short", ...overrides,
});
export const acquisition = (overrides: Partial<Replacement> = {}): Replacement => ({
  id: "buy-1", lot: "replacement-1" as LotId, security: "stock-A" as SecurityId,
  account: "broker-2" as AccountId, beneficialOwner: owner, economicOwner: owner,
  date: "2025-06-20", executionOrder: 1, quantity: decimal("100"), unit: "shares", instrument: "stock",
  sources: ["synthetic:purchase"], originalCost: money("1200"), accountKind: "taxable", relationship: "same_owner", relationshipVerified: yes, ...overrides,
});
export const washInput = (sales: readonly LossSale[] = [sale()], acquisitions: readonly Replacement[] = [acquisition()]): WashInput => ({
  context: context(), sales, acquisitions, similarity: sales.flatMap(s => acquisitions.map(a => ({ saleId: s.id, acquisitionId: a.id, substantiallyIdentical: yes, replacementEligibility: yes }))),
  coverage: yes, observedThrough: "2025-12-31",
});
export const parcel = (id: string, fairValue: string): LandParcel => ({
  id: id as PropertyId, owner, propertyClass: "nondepreciable_land", fairValue: money(fairValue),
  domestic: yes, realProperty: yes, qualifyingUse: yes, notHeldForSale: yes,
  depreciationHistory: "verified_never_depreciable", sources: ["synthetic:title-use-history-appraisal"],
});
export const exchangeInput = (overrides: Partial<ExchangeInput> = {}): ExchangeInput => ({
  context: context(), exchangeId: "exchange-1", relinquished: parcel("land-old", "200000"), replacement: parcel("land-new", "200000"),
  transferDate: "2025-01-01", signedIdentificationDate: "2025-02-15", receiptDate: "2025-06-30", federalReturnDueDate: "2026-04-15",
  adjustedBasis: money("100000"), basisSources: ["synthetic:verified-basis"], cashPaid: money("0"), cashReceived: money("0"),
  nonLikeBootReceived: money("0"), liabilitiesRelieved: money("0"), liabilitiesAssumed: money("0"), qualifyingCosts: money("0"),
  predicates: { likeKind: yes, sameTaxpayerOwnership: yes, qualifiedIntermediary: yes, noActualOrConstructiveReceipt: yes,
    replacementReceiptVerified: yes,
    signedIdentificationDelivered: yes, dueDateAndExtensionsVerified: yes, ordinaryDebtPrincipalOnly: yes,
    costsQualify: yes, bootValuationAndTreatmentVerified: yes, unrelatedParties: yes, deferredOneForOneOnly: yes,
    noOtherPropertyGiven: yes, noSellerFinancingOrSpecialStructures: yes, noRecaptureOrSpecialGainCategories: yes }, ...overrides,
});
export const harvestInput = (candidateTax = "850", fee = "0", replacement = false): HarvestInput => {
  const s = sale({ netProceeds: money("1000").minus(money(fee)) });
  const buys = replacement ? [acquisition()] : [];
  const wash = evaluateWashSales(washInput([s], buys));
  const proposal = { id: "harvest-1", sales: [s], replacements: buys, grossProceeds: money("1000"), disposalCosts: money(fee), replacementCosts: money("0"), exposureChange: "Sold stock A; future price/exposure differs.", exposureAcknowledged: yes };
  const eligible = replacement ? money("0") : s.netProceeds.minus(s.basis);
  const baseCapital = evaluateCapitalLoss(capitalInput({ shortRealized: money("0"), longRealized: money("0") }));
  const candidateCapital = evaluateCapitalLoss(capitalInput({ shortRealized: eligible, longRealized: money("0") }));
  const evaluation = (isCandidate: boolean): AuthoritativeEvaluation => {
    const capital = isCandidate ? candidateCapital : baseCapital;
    if (capital.status !== "complete") throw new Error("Invalid synthetic capital fixture");
    return { resultId: isCandidate ? "candidate-result" : "baseline-result", complete: true,
      tax: { totalLiability: money(isCandidate ? candidateTax : "1000"), catalogFingerprint: "synthetic:authoritative-tax-catalog",
        appliedRules: [{ id: domainId("tax-rule", "00000000-0000-4000-8000-000000000001"), version: "synthetic" }], traceRefs: [{ traceId: calculationTraceId("synthetic:tax-evaluation") }] },
      capital, capitalResultIdentity: capital.value.resultIdentity, context: context(), periodStart: "2025-01-01", periodEndExclusive: "2026-01-01",
      horizonEndExclusive: "2026-01-01", evaluatedThrough: "2025-12-31", inputCoverageFingerprint: "synthetic:coverage",
      unchangedFactsFingerprint: "synthetic:unchanged-household", scenarioId: isCandidate ? "candidate" : "baseline",
      activityFingerprint: isCandidate ? harvestActivityFingerprint(proposal) : "synthetic:baseline-activity", sources: ["synthetic:engine-receipt"] };
  };
  return { context: context(), proposal, wash, baseline: evaluation(false), candidate: evaluation(true),
    expectedBaselineActivityFingerprint: "synthetic:baseline-activity", expectedBaselineScenarioId: "baseline", expectedCandidateScenarioId: "candidate", householdCoverageFingerprint: "synthetic:coverage" };
};
