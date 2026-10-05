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
export interface HouseholdTaxInput {
  readonly domainOperations?: readonly { readonly id: string; readonly at: Instant }[];
  readonly accountTaxTreatments?: Readonly<Record<string, string>>;
  readonly taxRuleReferences?: readonly { readonly id: string; readonly jurisdiction: string; readonly taxType: string; readonly effective_date: string; readonly expiration_date?: string; readonly embeddedDefinition: boolean }[];
  readonly simulationStart?: Instant;
  readonly catalog: readonly TaxCoreRule[];
  readonly filingStatus?: FilingStatus;
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
export const taxOutputCapabilities = (diagnostics: readonly TaxCapabilityDiagnostic[]): TaxOutputCapabilities => Object.freeze(Object.fromEntries([
  ...taxAffectedOutputs.map(field => [field, Object.freeze({ dependency: "tax_affected", status: diagnostics.length ? "incomplete" : "complete", diagnostics: Object.freeze([...diagnostics]) })]),
  ...["statementIncome", "recurringIncomeRecognized", "recurringExpenseRecognized", "currentPosition"].map(field => [field, Object.freeze({ dependency: "tax_independent", status: "complete", diagnostics: Object.freeze([]) })]),
]));
export interface RecognizedTaxEconomics {
  /** Treasury interest remains in the federal base and is excluded from state/local bases. */
  readonly exemptStateLocalInterest?: Money;
  readonly sourceId: string;
  readonly at: Instant;
  readonly income: TaxIncomeFacts;
  readonly facts: TaxJurisdictionFacts;
  readonly allocation: string;
  readonly traceRefs: readonly CalculationTraceRef[];
}
