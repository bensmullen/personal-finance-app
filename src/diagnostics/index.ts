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

export function failValidation(issue: ValidationIssue | readonly ValidationIssue[]): never {
  throw new ValidationError(issue);
}

export const issueCodes = Object.freeze({
  accountingUnbalanced: "ACCOUNTING_UNBALANCED",
  accountingNegativeLegAmount: "ACCOUNTING_NEGATIVE_LEG_AMOUNT",
  accountingPrecisionInvalid: "ACCOUNTING_PRECISION_INVALID",
  accountingTargetMissing: "ACCOUNTING_TARGET_MISSING",
  duplicateTransaction: "DUPLICATE_TRANSACTION",
  duplicateRecognition: "DUPLICATE_RECOGNITION",
  duplicateSettlement: "DUPLICATE_SETTLEMENT",
  duplicateGeneratedOccurrence: "DUPLICATE_GENERATED_OCCURRENCE",
  duplicateExternalIdempotencyKey: "DUPLICATE_EXTERNAL_IDEMPOTENCY_KEY",
  claimInvariantInvalid: "CLAIM_INVARIANT_INVALID",
  settlementClaimNotFound: "SETTLEMENT_CLAIM_NOT_FOUND",
  settlementAmountInvalid: "SETTLEMENT_AMOUNT_INVALID",
  settlementExceedsOutstanding: "SETTLEMENT_EXCEEDS_OUTSTANDING",
  settlementCurrencyMismatch: "SETTLEMENT_CURRENCY_MISMATCH",
  settlementBeforeRecognition: "SETTLEMENT_BEFORE_RECOGNITION",
  settlementBeforeProposal: "SETTLEMENT_BEFORE_PROPOSAL",
  settlementBeforeFunding: "SETTLEMENT_BEFORE_FUNDING",
  settlementProposalNotAuthoritative: "SETTLEMENT_PROPOSAL_NOT_AUTHORITATIVE",
  fundingNotAuthoritative: "FUNDING_NOT_AUTHORITATIVE",
  settlementNotAuthoritative: "SETTLEMENT_NOT_AUTHORITATIVE",
  settlementLiabilityTargetInvalid: "SETTLEMENT_LIABILITY_TARGET_INVALID",
  fundingBeforeProposal: "FUNDING_BEFORE_PROPOSAL",
  fundingPolicyInvalid: "FUNDING_POLICY_INVALID",
  fundingSourceNotFound: "FUNDING_SOURCE_NOT_FOUND",
  fundingCurrencyMismatch: "FUNDING_CURRENCY_MISMATCH",
  liquidityShortfall: "LIQUIDITY_SHORTFALL",
  negativeCashInvariant: "NEGATIVE_CASH_INVARIANT",
  negativeLiabilityInvariant: "NEGATIVE_LIABILITY_INVARIANT",
  negativePositionInvariant: "NEGATIVE_POSITION_INVARIANT",
  stateEntityIdentityMismatch: "STATE_ENTITY_IDENTITY_MISMATCH",
  stateTargetNotFound: "STATE_TARGET_NOT_FOUND",
  runBaseCurrencyMismatch: "RUN_BASE_CURRENCY_MISMATCH",
  invalidRunContext: "INVALID_RUN_CONTEXT",
  observedFactAfterDataCutoff: "OBSERVED_FACT_AFTER_DATA_CUTOFF",
  invalidProvenance: "INVALID_PROVENANCE",
  invalidRunCompletionResult: "INVALID_RUN_COMPLETION_RESULT",
  unsupportedModelFormat: "UNSUPPORTED_MODEL_FORMAT",
  unsupportedFinancialSpecification: "UNSUPPORTED_FINANCIAL_SPECIFICATION",
  modelMigrationUnavailable: "MODEL_MIGRATION_UNAVAILABLE",
  modelVersionMismatch: "MODEL_VERSION_MISMATCH",
  primitiveUnknown: "PRIMITIVE_UNKNOWN",
  primitiveNotImplemented: "PRIMITIVE_NOT_IMPLEMENTED",
  primitiveInputInvalid: "PRIMITIVE_INPUT_INVALID",
  primitiveParametersInvalid: "PRIMITIVE_PARAMETERS_INVALID",
  primitiveStateInvalid: "PRIMITIVE_STATE_INVALID",
  primitiveTemporalConfigurationInvalid: "PRIMITIVE_TEMPORAL_CONFIGURATION_INVALID",
  primitiveCompositionIncompatible: "PRIMITIVE_COMPOSITION_INCOMPATIBLE",
  timelinePeriodPlanInvalid: "TIMELINE_PERIOD_PLAN_INVALID",
  timelineWorkInvalid: "TIMELINE_WORK_INVALID",
  primitiveRuntimeStateInvalid: "PRIMITIVE_RUNTIME_STATE_INVALID",
} as const);
