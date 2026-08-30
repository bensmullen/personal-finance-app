export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly code: string;
  readonly message: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly fieldPath?: string;
  readonly relatedIds?: readonly string[];
}

export const validationIssue = (issue: ValidationIssue): ValidationIssue => Object.freeze({
  ...issue,
  ...(issue.relatedIds === undefined ? {} : { relatedIds: Object.freeze([...issue.relatedIds]) }),
});

export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: ValidationIssue | readonly ValidationIssue[]) {
    const normalized = Array.isArray(issues) ? issues : [issues];
    const frozen = Object.freeze(normalized.map(validationIssue));
    super(frozen.map((issue) => issue.message).join("; "));
    this.name = "ValidationError";
    this.issues = frozen;
  }
}

export const failValidation = (issue: ValidationIssue | readonly ValidationIssue[]): never => {
  throw new ValidationError(issue);
};

export const issueCodes = Object.freeze({
  accountingUnbalanced: "ACCOUNTING_UNBALANCED",
  accountingNegativeLegAmount: "ACCOUNTING_NEGATIVE_LEG_AMOUNT",
  accountingPrecisionInvalid: "ACCOUNTING_PRECISION_INVALID",
  accountingTargetMissing: "ACCOUNTING_TARGET_MISSING",
  duplicateTransaction: "DUPLICATE_TRANSACTION",
  duplicateRecognition: "DUPLICATE_RECOGNITION",
  duplicateSettlement: "DUPLICATE_SETTLEMENT",
  settlementClaimNotFound: "SETTLEMENT_CLAIM_NOT_FOUND",
  settlementAmountInvalid: "SETTLEMENT_AMOUNT_INVALID",
  settlementExceedsOutstanding: "SETTLEMENT_EXCEEDS_OUTSTANDING",
  settlementCurrencyMismatch: "SETTLEMENT_CURRENCY_MISMATCH",
  settlementBeforeRecognition: "SETTLEMENT_BEFORE_RECOGNITION",
  settlementBeforeProposal: "SETTLEMENT_BEFORE_PROPOSAL",
  settlementBeforeFunding: "SETTLEMENT_BEFORE_FUNDING",
  fundingBeforeProposal: "FUNDING_BEFORE_PROPOSAL",
  fundingPolicyInvalid: "FUNDING_POLICY_INVALID",
  fundingSourceNotFound: "FUNDING_SOURCE_NOT_FOUND",
  fundingCurrencyMismatch: "FUNDING_CURRENCY_MISMATCH",
  liquidityShortfall: "LIQUIDITY_SHORTFALL",
  negativeCashInvariant: "NEGATIVE_CASH_INVARIANT",
} as const);
