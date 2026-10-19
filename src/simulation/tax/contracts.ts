import type { AccountId } from "../../accounting/index.js";
import type { FundingPolicy } from "../../funding/index.js";
import type { DomainId } from "../../identity/index.js";
import type { CalculationTraceRef } from "../../lineage/index.js";
import type { FilingStatus, TaxCoreRule, TaxIncomeFacts, TaxJurisdictionFacts } from "../../rules/tax/contracts.js";
import type { Instant } from "../../time/index.js";
import type { Money } from "../../values/index.js";

export interface TaxFactInterval { readonly effective_date: string; readonly expiration_date?: string }
export interface ResidenceTaxPeriod extends TaxFactInterval {
  readonly state_jurisdiction: string;
  readonly local_jurisdiction?: string;
  readonly municipality?: string;
  readonly psd_code?: string;
}
export interface WorkTaxAllocation extends ResidenceTaxPeriod { readonly allocation: string }
export interface TaxEligibilityPeriod extends TaxFactInterval { readonly key: string; readonly value: boolean }
export interface CompiledTaxIncome {
  readonly id: string;
  readonly ownerId: string;
  readonly incomeType: string;
  readonly taxCharacter: string;
  readonly grossOrNet?: string;
  readonly start: string;
  readonly end?: string;
  readonly residence: readonly ResidenceTaxPeriod[];
  readonly work: readonly WorkTaxAllocation[];
  readonly eligibility: readonly TaxEligibilityPeriod[];
}
export interface TaxPaymentInstruction {
  readonly priority?: number;
  readonly id: string;
  readonly jurisdiction: string;
  readonly at: Instant;
  readonly amount: Money;
  readonly kind: "withholding" | "estimated";
}
export interface TaxSettlementInstruction {
  readonly priority?: number;
  readonly id: string;
  readonly jurisdiction: string;
  readonly taxYear: string;
  readonly at: Instant;
}
/** One modeled household filing unit; annual facts apply to the entire year. */
export interface AnnualHouseholdFilingStatus {
  readonly householdId: string;
  readonly taxYear: string;
  readonly status: "known" | "missing" | "true_conflict";
  readonly value?: FilingStatus;
  readonly sources: readonly { readonly id: string; readonly label: string; readonly value: string; readonly provenance: string; readonly ruleVersion: string }[];
  readonly repairPersonId?: string;
}
/** Explicit compiler selection persisted with the executable run/scenario basis. */
export interface ProjectedCurrentLawAssumption {
  readonly version: "projected-current-law/v1";
  readonly selection: "projectedCurrentLawThrough";
  readonly modelId: string;
  readonly householdId: string;
  /** Exclusive date boundary; nominal carry-forward never implies enacted law. */
  readonly through: string;
  readonly catalogFingerprint: string;
}
export interface ProjectedTaxLawQualification {
  readonly assumption?: ProjectedCurrentLawAssumption;
  readonly catalogFingerprint: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly baseRuleId: string;
  readonly baseRuleVersion: string;
  readonly baseYear: number;
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
}
export interface HouseholdTaxInput {
  readonly projectedCurrentLawAssumption?: ProjectedCurrentLawAssumption;
  readonly domainOperations?: readonly { readonly id: string; readonly at: Instant }[];
  readonly accountTaxTreatments?: Readonly<Record<string, string>>;
  readonly taxRuleReferences?: readonly { readonly id: string; readonly jurisdiction: string; readonly taxType: string; readonly effective_date: string; readonly expiration_date?: string; readonly embeddedDefinition: boolean }[];
  readonly simulationStart?: Instant;
  readonly catalog: readonly TaxCoreRule[];
  readonly filingStatus?: FilingStatus;
  /** Absent only for the historical fixed-status v1 execution contract. */
  readonly filingStatuses?: Readonly<Record<string, AnnualHouseholdFilingStatus>>;
  readonly ownerId: DomainId<string>;
  readonly incomes: readonly CompiledTaxIncome[];
  readonly eligibility: readonly TaxEligibilityPeriod[];
  readonly fundingPolicy?: FundingPolicy;
  readonly refundAccountId?: AccountId;
  readonly payments: readonly TaxPaymentInstruction[];
  readonly settlements?: readonly TaxSettlementInstruction[];
  readonly diagnostics: readonly TaxCapabilityDiagnostic[];
}
export interface TaxCapabilityDiagnostic {
  readonly projectedLaw?: ProjectedTaxLawQualification;
  readonly taxYear?: string;
  readonly severity: "warning";
  readonly code: "PFA-TAX-008" | "PFA-TAX-009";
  readonly message: string;
  readonly entityType: "tax_capability";
  readonly entityId?: string;
  readonly jurisdiction?: string;
  readonly category: string;
  readonly affectedOutputs: readonly string[];
}
export interface OutputTaxCapability {
  readonly dependency: "tax_independent" | "tax_affected";
  readonly status: "complete" | "incomplete";
  readonly diagnostics: readonly TaxCapabilityDiagnostic[];
}
export type TaxOutputCapabilities = Readonly<Record<string, OutputTaxCapability>>;
export const taxAffectedOutputs = Object.freeze(["cash", "investmentValue", "assets", "totalAssets", "liabilities", "totalLiabilities", "netWorth", "statementExpenses", "netIncome", "operatingCashFlow", "investingCashFlow", "financingCashFlow", "investmentContributionPrincipal", "contributionPrincipal", "investmentFees", "debtPrincipalReduction", "principalReduction", "endingPrincipal", "outstandingInterest", "interestExpense", "debtBalances", "fees", "gains", "unrealizedGain", "expenseCashSettlement", "outstandingExpenseObligations", "constraintOutcomes", "liquidityShortfalls"]);
export const taxDiagnostic = (category: string, message: string, jurisdiction?: string, entityId?: string): TaxCapabilityDiagnostic => Object.freeze({
  severity: "warning", code: "PFA-TAX-009", entityType: "tax_capability", category, message,
  ...(jurisdiction === undefined ? {} : { jurisdiction }), ...(entityId === undefined ? {} : { entityId }), affectedOutputs: taxAffectedOutputs,
});
/** Fail closed for legacy warnings, unknown categories and unbound projected rules. */
export const isNonblockingProjectedTaxLaw = (diagnostic: TaxCapabilityDiagnostic, selection?: ProjectedCurrentLawAssumption): boolean => {
  const law = diagnostic.projectedLaw, bound = law?.assumption;
  return diagnostic.category === "projected_current_law" && diagnostic.code === "PFA-TAX-009" &&
    selection != null && bound != null && bound.version === "projected-current-law/v1" &&
    bound.selection === "projectedCurrentLawThrough" && bound.version === selection.version &&
    bound.selection === selection.selection && bound.modelId === selection.modelId && bound.householdId === selection.householdId &&
    bound.through === selection.through && bound.catalogFingerprint === selection.catalogFingerprint &&
    law != null && law.catalogFingerprint === selection.catalogFingerprint &&
    diagnostic.jurisdiction !== undefined && law.effectiveFrom < law.effectiveUntil &&
    law.effectiveUntil <= `${selection.through}T00:00:00.000Z`;
};
export const taxOutputCapabilities = (diagnostics: readonly TaxCapabilityDiagnostic[], selection?: ProjectedCurrentLawAssumption): TaxOutputCapabilities => Object.freeze(Object.fromEntries([
  ...taxAffectedOutputs.map(field => [field, Object.freeze({ dependency: "tax_affected", status: diagnostics.some(diagnostic => !isNonblockingProjectedTaxLaw(diagnostic, selection)) ? "incomplete" : "complete", diagnostics: Object.freeze([...diagnostics]) })]),
  ...["statementIncome", "recurringIncomeRecognized", "recurringExpenseRecognized", "currentPosition"].map(field => [field, Object.freeze({ dependency: "tax_independent", status: "complete", diagnostics: Object.freeze([]) })]),
]));
export interface RecognizedTaxEconomics {
  /** Bounded ordinary lump-sum term-life proceeds excluded from federal gross income. */
  readonly excludedFederalTermLifeBenefit?: Money;
  /** Treasury interest remains in the federal base and is excluded from state/local bases. */
  readonly exemptStateLocalInterest?: Money;
  readonly sourceId: string;
  readonly at: Instant;
  readonly income: TaxIncomeFacts;
  readonly facts: TaxJurisdictionFacts;
  readonly allocation: string;
  readonly traceRefs: readonly CalculationTraceRef[];
}
