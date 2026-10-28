import type { EducationRequest as Request, EducationProposal, EducationCoverage, EducationExpense, ExpenseAdjustment, ExpenseUsage } from "../types.js";
import type { Money } from "../../../../../values/index.js";

export interface DistributionIdentity {
  readonly householdId: string; readonly ownerId: string; readonly beneficiaryId: string;
  readonly planId: string; readonly providerId: string; readonly planAccountId: string;
  readonly sourceAccountId: string; readonly destinationAccountId: string; readonly payeeId: string;
  readonly tuition: { readonly paidExpenseId: string; readonly economicExpenseId: string;
    readonly studentId: string; readonly institutionId: string; readonly termId: string } | null;
}
export interface DistributionEvent {
  readonly eventId: string; readonly operationId: string; readonly claimId: string;
  readonly kind: "qualified_distribution" | "nonqualified_distribution";
  readonly effectiveAt: Request["effectiveAt"]; readonly cutoff: Request["knownAt"];
  readonly taxYear: number; readonly gross: Money;
}
export type TuitionBill = Omit<EducationExpense, "adjustments" | "adjustedEligible" | "adjustmentsComplete" | "unreimbursedUse" | "recognition" | "unpaidClaim">;
export interface OriginalPayloads {
  readonly plan: { readonly plan: Request["plan"]; readonly complete: "all_current_lots" | "unknown";
    readonly lots: readonly { readonly lotId: string; readonly basisId: string; readonly basis: Money; readonly earnings: Money }[] };
  readonly funding: { readonly complete: "since_inception" | "unknown"; readonly entries: readonly {
    readonly lotId: string; readonly basisId: string; readonly operationId: string;
    readonly fundedAt: Request["effectiveAt"]; readonly householdId: string; readonly ownerId: string;
    readonly bankAccountId: string; readonly accountKind: "BANK"; readonly planCashAccountId: string;
    readonly status: "posted" | "pending"; readonly bankDebit: Money; readonly planCredit: Money;
  }[] };
  /** Exhaustive original bills/receipts, including competing receipts, at cutoff. */
  readonly tuition: { readonly complete: "all_receipts" | "unknown"; readonly bills: readonly TuitionBill[] };
  readonly adjustments: { readonly complete: "all_adjustments_and_benefits" | "unknown"; readonly entries: readonly {
    readonly paidExpenseId: string; readonly adjustedEligible: Money;
    readonly unreimbursedUse: EducationExpense["unreimbursedUse"]; readonly adjustments: readonly ExpenseAdjustment[];
  }[] };
  /** Independent payment/recognition ledger, not the bill's asserted paid flag. */
  readonly payment: { readonly complete: "all_payments_and_recognition" | "unknown"; readonly entries: readonly {
    readonly paidExpenseId: string; readonly economicExpenseId: string;
    readonly studentId: string; readonly institutionId: string; readonly payeeId: string; readonly termId: string;
    readonly payment: { readonly operationId: string; readonly status: "posted"; readonly accountKind: "BANK";
      readonly accountId: string; readonly payerId: string; readonly paidAt: Request["effectiveAt"]; readonly amount: Money } | null;
    readonly recognition: EducationExpense["recognition"]; readonly unpaidClaim: EducationExpense["unpaidClaim"];
  }[] };
  readonly law: { readonly rules: NonNullable<Request["rules"]>; readonly qualification: Request["qualification"] };
  /** Household register, across all plans/providers, including pending use. */
  readonly usage: { readonly complete: "all_household_education_uses_including_pending" | "unknown";
    readonly at: Request["effectiveAt"]; readonly source: Request["usage"]["source"];
    readonly entries: readonly { readonly householdId: string; readonly economicExpenseId: string; readonly usage: ExpenseUsage }[] };
  readonly trustee: { readonly authorization: Request["authorization"] };
  readonly route: { readonly route: Request["route"]; readonly accountKind: "BANK" | "institution"; readonly payeeId: string };
}
export type OriginalRole = keyof OriginalPayloads;
export interface DistributionOriginal<K extends OriginalRole> {
  readonly role: K; readonly producerId: string; readonly sourceId: string; readonly version: string;
  readonly status: "active" | "withdrawn";
  readonly issuedAt: Request["effectiveAt"]; readonly publishedAt: Request["effectiveAt"];
  readonly knownAt: Request["effectiveAt"]; readonly asOf: Request["effectiveAt"];
  readonly start: Request["effectiveAt"]; readonly endExclusive: Request["effectiveAt"];
  readonly identity: DistributionIdentity; readonly event: DistributionEvent;
  readonly payload: OriginalPayloads[K];
}
export interface OriginalPin {
  readonly producerId: string; readonly sourceId: string; readonly version: string; readonly digest: string;
}
/** Trusted repositories return the latest original, including amendments or
 * withdrawal, rather than echoing a pinned historical version. Digests are not authority. */
export type DistributionOriginalPorts = { readonly [K in OriginalRole]?:
  (pin: OriginalPin, cutoff: Request["effectiveAt"]) => DistributionOriginal<K> | undefined };
export type DistributionPins = { readonly [K in OriginalRole]?: OriginalPin };
export interface DistributionBinding {
  readonly identity: DistributionIdentity; readonly event: DistributionEvent; readonly originals: DistributionPins;
}
export type BindingCode = "INVALID_BINDING" | "ORIGINAL_UNAVAILABLE" | "ORIGINAL_CHANGED" | "ORIGINAL_SCOPE_MISMATCH"
  | "ORIGINAL_CHRONOLOGY_INVALID" | "INDEPENDENT_PRODUCER_REQUIRED" | "FUNDING_NOT_RECONCILED"
  | "TUITION_NOT_RECONCILED" | "COMPLETE_INVENTORY_REQUIRED" | "CONTESTED_CLAIM" | "EVALUATION_INCOMPLETE";
export type CompactEconomics = Pick<EducationProposal, "grossAmount" | "basisRecovered" | "earnings" | "planAssetDelta"
  | "ownedBankCashDelta" | "institutionClaimLiabilityDelta" | "institutionPaymentAmount" | "basisDelta"
  | "movementNetWorthDelta" | "bankReceiptCharacter" | "taxFacts"> & {
    readonly expense: Pick<NonNullable<EducationProposal["expense"]>, "paidExpenseId" | "economicExpenseId" | "recognize" | "amount" | "institutionClaimId"> | null;
  };
export type CompactCoverage = Pick<EducationCoverage, "affectedOutput" | "coverage" | "diagnosticCode" | "ruleSnapshotId">;
export interface DistributionOccurrence {
  readonly contractVersion: "529-distribution-original/v1";
  readonly identity: DistributionIdentity; readonly event: DistributionEvent; readonly originals: DistributionPins;
  readonly committed: false; readonly postable: false; readonly physicalDistribution: "not_applied";
  readonly settlement: "incomplete"; readonly taxLiability: "incomplete"; readonly penalty: "incomplete";
  readonly economics: CompactEconomics | null; readonly coverage: readonly CompactCoverage[];
}
export interface DistributionBindingResult {
  readonly occurrences: readonly DistributionOccurrence[];
  readonly diagnostics: readonly { readonly eventId: string; readonly operationId: string; readonly code: BindingCode;
    readonly missingPort: OriginalRole | null; readonly coverage: "incomplete" }[];
}
