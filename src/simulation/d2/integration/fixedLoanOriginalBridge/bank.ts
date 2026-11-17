import type { AccountId } from "../../../../accounting/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import type { Money } from "../../../../values/index.js";
import { canonicalSerialize, type RunContext } from "../../../run.js";
import { checkHouseholdBankDebitAdmission, type HouseholdBankEventContext } from "../householdBank/index.js";
import { rejectFixedLoanOriginal, type FixedLoanPaymentOriginal } from "./source.js";
import { observeFixedLoanOriginal } from "./observation.js";

/** Only this seam can produce a policy-sensitive denial for fixed-loan work. */
class FixedLoanDebitPermissionDenied extends ValidationError {
  constructor(readonly inventoryDigest: string) {
    super({ severity: "error", code: "FIXED_LOAN_DEBIT_PERMISSION_DENIED", entityType: "fixed_loan_original",
      message: "The current household BANK original does not authorize this member to debit the account" });
  }
}

export function fixedLoanDebitDenial(error: unknown): string | undefined {
  return error instanceof FixedLoanDebitPermissionDenied ? error.inventoryDigest : undefined;
}

export function qualifyFixedLoanBankDebit(
  payment: FixedLoanPaymentOriginal,
  context: Omit<HouseholdBankEventContext, "bankAccountId" | "direction"> & { readonly scenarioId: RunContext["scenarioId"] },
  accountKind: string,
  amount: Money,
  allocations: readonly { readonly accountId: AccountId; readonly amount: Money }[],
) {
  const allocation = allocations[0];
  if (allocations.length !== 1 || allocation === undefined || allocation.accountId !== payment.bank.accountId ||
      !allocation.amount.equals(amount) || !amount.isPositive() || payment.eventAt !== context.eventAt)
    return rejectFixedLoanOriginal("Expected one actual BANK allocation matching the payment original");
  const { publisherId, sourceId } = payment.bank;
  const query = { ...context, bankAccountId: allocation.accountId, direction: "debit" as const };
  const read = () => checkHouseholdBankDebitAdmission(publisherId, sourceId, query);
  const admission = read();
  if ((admission.kind === "qualified" ? admission.pin.accountKind : admission.accountKind) !== accountKind)
    return rejectFixedLoanOriginal("Actual BANK account kind differs from the original");
  const digest = ({ kind, inventoryDigest }: ReturnType<typeof read>) => `${kind}:${inventoryDigest}`;
  observeFixedLoanOriginal("bank", canonicalSerialize({ publisherId, sourceId, query }),
    digest(admission), () => digest(read()));
  if (admission.kind === "debit_permission_denied") throw new FixedLoanDebitPermissionDenied(admission.inventoryDigest);
  return admission;
}
