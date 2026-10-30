import type { AccountingTransaction } from "../../../../accounting/index.js";
import { failValidation, issueCodes } from "../../../../diagnostics/index.js";
import { registerHouseholdEconomicOriginalAuthority, type HouseholdBankEventContext,
  type HouseholdDomainPostingEvidence, type HouseholdEconomicOriginalReference,
  type HouseholdEconomicWitness } from "../../../../state/index.js";
import type { Instant, Period } from "../../../../time/index.js";
import { canonicalSerialize } from "../../../run.js";
import { qualifyHouseholdBankRoute } from "./index.js";

/** Serializable address only; archives and registration belong to composition. */
export interface HouseholdExpenseSourceRef {
  readonly version: "household-expense-source/v1";
  readonly bank: { readonly publisherId: string; readonly sourceId: string };
  readonly original: HouseholdEconomicOriginalReference;
  readonly beneficiary: HouseholdEconomicWitness["beneficiary"];
}
export interface HouseholdExpenseOriginal {
  readonly version: "household-expense-original/v1";
  readonly context: HouseholdBankEventContext;
  readonly checkedAt: Instant;
  readonly completeThrough: Instant;
  readonly completeness: "complete";
  readonly expenseId: string;
  readonly occurrenceId: string;
  readonly claimId: string;
  readonly period: Period;
  readonly witness: HouseholdEconomicWitness;
  readonly recognition: AccountingTransaction;
  readonly settlement: AccountingTransaction;
}
export interface HouseholdExpenseOriginalProvider {
  readonly family: HouseholdEconomicOriginalReference["family"];
  readonly publisherId: string;
  /** Independently reconstruct both journals and occurrence at the real cutoff.
   * No caller amount, journal, period or payer is passed to the publisher. */
  readonly readOriginal: (reference: HouseholdEconomicOriginalReference,
    context: HouseholdBankEventContext) => HouseholdExpenseOriginal | undefined;
}
// Publisher registry only: no mutable source/event cache or history scans.
const providers = new Map<string, HouseholdExpenseOriginalProvider>();
const key = (ref: Pick<HouseholdEconomicOriginalReference, "family" | "publisherId">) =>
  JSON.stringify([ref.family, ref.publisherId]);
const equal = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
function need(ok: boolean): asserts ok {
  if (!ok) failValidation({ severity: "error", code: issueCodes.verticalSlice2InputInvalid,
    message: "HOUSEHOLD_EXPENSE_ORIGINAL_NOT_ADMITTED", entityType: "vertical_slice_2",
    fieldPath: "expenses.householdExpenseSource" });
}
function read(provider: HouseholdExpenseOriginalProvider, ref: HouseholdEconomicOriginalReference,
  context: HouseholdBankEventContext): HouseholdExpenseOriginal {
  const value = provider.readOriginal(Object.freeze({ ...ref }), Object.freeze({ ...context }));
  need(value !== undefined);
  need(value.version === "household-expense-original/v1" && value.completeness === "complete" &&
    value.checkedAt === context.asOf && value.completeThrough === context.dataCutoff &&
    equal(value.context, context) && equal(value.witness.original, ref) &&
    value.witness.payer.kind === "person" && value.witness.payer.id === context.personId &&
    context.direction === "debit" && value.period.start <= context.eventAt && context.eventAt < value.period.end &&
    value.claimId === `obligation:recognition:expense:${value.expenseId}:${context.eventAt}` &&
    value.recognition.id === `tx:recognition:recognition:expense:${value.expenseId}:${context.eventAt}` &&
    value.settlement.id === `tx:settlement:${value.claimId}` && context.eventId === `settlement:${value.claimId}` &&
    value.recognition.date === context.eventAt && value.recognition.type === "expense_recognition" &&
    value.settlement.date === context.eventAt && value.settlement.type === "expense_settlement");
  const [expense, payable] = value.recognition.legs, [liability, cash] = value.settlement.legs;
  need(value.recognition.legs.length === 2 && value.settlement.legs.length === 2 &&
    expense?.type === "expense" && expense.posting === "debit" &&
    payable?.type === "liability" && payable.posting === "credit" &&
    liability?.type === "liability" && liability.posting === "debit" && liability.entityId === payable.entityId &&
    cash?.type === "cash" && cash.posting === "credit" && cash.accountId === context.bankAccountId &&
    cash.cashFlowClass === "operating" && expense.amount.isPositive() &&
    [payable, liability, cash].every(leg => leg.amount.equals(expense.amount)));
  return value;
}

/** The same independent publisher is installed at execution and cold replay.
 * State reconstructs again; the execution read is never its authority. */
export function registerHouseholdExpenseOriginalProvider(provider: HouseholdExpenseOriginalProvider): void {
  need(provider.publisherId.trim().length > 0 && !providers.has(key(provider)));
  const registered = Object.freeze({ family: provider.family, publisherId: provider.publisherId,
    readOriginal: provider.readOriginal.bind(provider) });
  registerHouseholdEconomicOriginalAuthority(provider.family, provider.publisherId, {
    qualify: (ref, context) => {
      try {
        const original = read(registered, ref, context);
        return { witness: original.witness, transaction: original.settlement, context: original.context,
          requiredFamilies: [registered.family] };
      } catch { return undefined; }
    },
  });
  providers.set(key(provider), registered);
}

export function qualifyHouseholdExpense(source: HouseholdExpenseSourceRef, context: HouseholdBankEventContext,
  expected: Pick<HouseholdExpenseOriginal, "expenseId" | "occurrenceId" | "claimId" | "period" | "recognition" | "settlement">,
): HouseholdDomainPostingEvidence {
  try {
    need(source.version === "household-expense-source/v1" && source.original.version === "household-economic-original/v1");
    const provider = providers.get(key(source.original));
    need(provider !== undefined);
    const original = read(provider, source.original, context);
    need(original.witness.beneficiary === source.beneficiary && equal({ expenseId: original.expenseId,
      occurrenceId: original.occurrenceId, claimId: original.claimId, period: original.period,
      recognition: original.recognition, settlement: original.settlement }, expected));
    return Object.freeze({ version: "household-domain-posting/v1", context: Object.freeze({ ...context }),
      route: qualifyHouseholdBankRoute(source.bank.publisherId, source.bank.sourceId, context),
      originals: Object.freeze([original.witness]) });
  } catch {
    // Source outages and BANK rejection are honest incomplete projections too.
    return failValidation({ severity: "error", code: issueCodes.verticalSlice2InputInvalid,
      message: "HOUSEHOLD_EXPENSE_ORIGINAL_NOT_ADMITTED", entityType: "vertical_slice_2",
      fieldPath: "expenses.householdExpenseSource" });
  }
}
