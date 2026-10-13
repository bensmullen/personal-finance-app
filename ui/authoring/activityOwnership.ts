import { financialField, type FinancialField } from "./fieldContract.js";

/** UI bindings to PR #117; names refer to the registry, not new money inputs. */
export const OPERATION_OWNERS = {
  purchase: "investment.purchase", sale: "investment.sale", call_exercise: "investment.option_exercise",
  ordinary_dividend: "investment.income_distribution", qualified_dividend: "investment.income_distribution", interest: "investment.income_distribution",
  reinvest_dividend: "investment.dividend_reinvestment", conversion: "investment.retirement_conversion",
  direct_rollover: "investment.retirement_rollover", mixed_rollover: "investment.retirement_rollover",
  indirect_distribution: "investment.indirect_rollover", indirect_deposit: "investment.indirect_rollover",
  mortgage_extra: "debt.extra_refinance", refinance: "debt.extra_refinance",
} as const;
export function ownedField(key: string, family: string, binding: string, scope: string, source: string): FinancialField {
  return { ...financialField(key), semanticFamily: family, semanticBinding: binding, semanticScope: scope, source };
}
export const TERM_BINDINGS = {
  owner: ["termOwner", "insurance.term_life_policy", "ownerId"], insured: ["termInsured", "insurance.term_life_policy", "insuredPersonId"],
  beneficiary: ["termBeneficiary", "insurance.term_life_policy", "beneficiaryId"], start: ["termStart", "insurance.term_life_policy", "coverageStart"], end: ["termEnd", "insurance.term_life_policy", "coverageEnd"],
  premium: ["termPremium", "insurance.term_life_premium", "premiumAmount"], premiumAccount: ["termPremiumBank", "insurance.term_life_premium", "premiumFundingBankId"],
  benefit: ["termBenefit", "insurance.term_life_benefit", "faceAmount"], benefitAccount: ["termBenefitBank", "insurance.term_life_benefit", "benefitDepositBankId"],
} as const;
export function operationBindings(kind: keyof typeof OPERATION_OWNERS): Readonly<Record<string, string>> {
  return {
    operation: "operationKind", operationDate: kind === "indirect_distribution" ? "distributionAt" : kind === "indirect_deposit" ? "depositAt" : "at",
    operationHolding: kind === "call_exercise" ? "sourceOptionHoldingId" : kind === "indirect_distribution" ? "sourceRetirementHoldingId" : "sourceHoldingId",
    operationAmount: kind === "reinvest_dividend" ? "dividendAmount" : kind === "indirect_distribution" ? "distributionAmount" : "amount",
    operationUnits: kind === "call_exercise" ? "contracts" : kind === "reinvest_dividend" ? "purchasedQuantity" : "quantity",
    operationFunding: kind === "indirect_distribution" ? "proceedsCashAccountId" : kind === "indirect_deposit" ? "replacementFundingBankId" : "fundingCashAccountId",
    operationOrder: "sameDayOrder", operationDestination: kind === "conversion" ? "rothDestinationHoldingId" : kind === "indirect_deposit" ? "destinationHoldingId" : "preTaxDestinationHoldingId",
    operationAcceptance: ["direct_rollover", "mixed_rollover"].includes(kind) ? "destinationAcceptance" : "eligibilityConfirmation",
    samePlan: "samePlanConfirmation", rothDestination: "rothDestinationHoldingId", linkedDistribution: "linkedDistributionEventId",
    replacementCash: "replacementAmount", dividendCharacter: "dividendCharacterRequiresSourceQualification", specificLot: "lotIds",
    operationMortgage: "liabilityId", totalPayments: "totalPayments",
  };
}
