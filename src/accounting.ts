import type { DomainId } from "./identity.js";
import type { Instant } from "./time.js";
import { failValidation, issueCodes } from "./diagnostics.js";
import { freezeTraceRefs, type CalculationTraceRef } from "./lineage.js";
import { Money, Quantity, sumMoney } from "./values.js";

export type AccountId = DomainId<"account">;
export type AccountingTargetId = DomainId<string>;
export type PostingSign = "debit" | "credit";
export type AccountingEffectType = "cash" | "asset" | "liability" | "income" | "expense" | "equity" | "gain" | "loss" | "tax";
export type CashFlowClass = "operating" | "investing" | "financing" | "non_cash";
export type CashFlowSummary = CashFlowClass | "mixed";

declare const accountingLegAuthority: unique symbol;
declare const accountingTransactionAuthority: unique symbol;
declare const accountingTransactionIdBrand: unique symbol;

export type AccountingTransactionId = string & {
  readonly [accountingTransactionIdBrand]: "AccountingTransactionId";
};

export const accountingTransactionId = (value: string): AccountingTransactionId => {
  if (value.trim().length === 0) throw new Error("Accounting transaction identity cannot be empty");
  return value as AccountingTransactionId;
};

interface AccountingLegBase {
  readonly posting: PostingSign;
  readonly amount: Money;
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export interface CashLegDraft extends AccountingLegBase {
  readonly type: "cash";
  readonly accountId: AccountId;
  readonly cashFlowClass: CashFlowClass;
}

export interface AssetLegDraft extends AccountingLegBase {
  readonly type: "asset";
  readonly entityId: AccountingTargetId;
  readonly quantity?: Quantity;
}

export interface LiabilityLegDraft extends AccountingLegBase {
  readonly type: "liability";
  readonly entityId: AccountingTargetId;
}

export interface StatementLegDraft extends AccountingLegBase {
  readonly type: "income" | "expense" | "equity" | "gain" | "loss" | "tax";
  readonly entityId?: AccountingTargetId;
}

export type AccountingLegDraft = CashLegDraft | AssetLegDraft | LiabilityLegDraft | StatementLegDraft;
export type AccountingLeg = Readonly<AccountingLegDraft> & { readonly [accountingLegAuthority]: true };

const missingTarget = (draft: Partial<AccountingLegDraft>, target: string): never => failValidation({
  severity: "error",
  code: issueCodes.accountingTargetMissing,
  message: `${draft.type ?? "Accounting"} leg requires ${target}`,
  entityType: "accounting_leg",
  fieldPath: target,
});

export const createAccountingLeg = (draft: AccountingLegDraft): AccountingLeg => {
  if (!(draft.amount instanceof Money)) throw new Error("Accounting leg amount must be Money");
  if (draft.amount.isNegative()) {
    failValidation({ severity: "error", code: issueCodes.accountingNegativeLegAmount, message: "Accounting leg amounts must be unsigned magnitudes", entityType: "accounting_leg", fieldPath: "amount" });
  }
  if (draft.type === "cash" && !("accountId" in draft) || draft.type === "cash" && draft.accountId === undefined) {
    missingTarget(draft, "accountId");
  }
  if ((draft.type === "asset" || draft.type === "liability") && (!("entityId" in draft) || draft.entityId === undefined)) {
    missingTarget(draft, "entityId");
  }
  if (draft.type === "cash" && (!("cashFlowClass" in draft) || draft.cashFlowClass === undefined)) {
    missingTarget(draft, "cashFlowClass");
  }
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return Object.freeze({
    ...draft,
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as AccountingLeg;
};

export interface AccountingTransactionDraft {
  readonly id: AccountingTransactionId;
  readonly type: string;
  readonly date: Instant;
  readonly legs: readonly AccountingLeg[];
  readonly traceRefs?: readonly CalculationTraceRef[];
}

export type AccountingTransaction = Readonly<AccountingTransactionDraft> & {
  readonly [accountingTransactionAuthority]: true;
};

const validateTransaction = (draft: AccountingTransactionDraft): void => {
  if (draft.legs.length < 2) {
    failValidation({ severity: "error", code: issueCodes.accountingUnbalanced, message: `Transaction ${draft.id} must contain at least two accounting legs`, entityType: "accounting_transaction", entityId: draft.id, fieldPath: "legs" });
  }
  const currencies = new Map<string, { currency: Money["currency"]; debits: Money[]; credits: Money[] }>();
  for (const leg of draft.legs) {
    if (leg.amount.isNegative()) {
      failValidation({ severity: "error", code: issueCodes.accountingNegativeLegAmount, message: `Transaction ${draft.id} contains a negative leg amount`, entityType: "accounting_transaction", entityId: draft.id, fieldPath: "legs.amount" });
    }
    if (!leg.amount.amount.fitsScale(leg.amount.currency.minorUnitScale)) {
      failValidation({ severity: "error", code: issueCodes.accountingPrecisionInvalid, message: `Posted amount in ${draft.id} exceeds ${leg.amount.currency.code} settlement precision`, entityType: "accounting_transaction", entityId: draft.id, fieldPath: "legs.amount" });
    }
    const code = leg.amount.currency.code;
    const group = currencies.get(code) ?? { currency: leg.amount.currency, debits: [], credits: [] };
    (leg.posting === "debit" ? group.debits : group.credits).push(leg.amount);
    currencies.set(code, group);
  }
  for (const [code, group] of currencies) {
    const debits = sumMoney(group.debits, group.currency);
    const credits = sumMoney(group.credits, group.currency);
    if (!debits.equals(credits)) {
      failValidation({
        severity: "error",
        code: issueCodes.accountingUnbalanced,
        message: `Unbalanced transaction ${draft.id} in ${code}: ${debits.amount.toString()} != ${credits.amount.toString()}`,
        entityType: "accounting_transaction",
        entityId: draft.id,
        relatedIds: [code],
      });
    }
  }
};

export const createAccountingTransaction = (draft: AccountingTransactionDraft): AccountingTransaction => {
  validateTransaction(draft);
  const traceRefs = freezeTraceRefs(draft.traceRefs);
  return Object.freeze({
    id: draft.id,
    type: draft.type,
    date: draft.date,
    legs: Object.freeze([...draft.legs]),
    ...(traceRefs === undefined ? {} : { traceRefs }),
  }) as AccountingTransaction;
};

export const assertBalanced = (transaction: AccountingTransaction): void => validateTransaction(transaction);

export const cashFlowClasses = (transaction: AccountingTransaction): readonly CashFlowClass[] =>
  Object.freeze([...new Set(transaction.legs
    .filter((leg): leg is AccountingLeg & CashLegDraft => leg.type === "cash")
    .map((leg) => leg.cashFlowClass))]);

export const summarizeCashFlowClass = (transaction: AccountingTransaction): CashFlowSummary => {
  const classes = cashFlowClasses(transaction);
  if (classes.length === 0) return "non_cash";
  return classes.length === 1 ? classes[0]! : "mixed";
};

export const cashFlowAmount = (
  transaction: AccountingTransaction,
  cashFlowClass: Exclude<CashFlowClass, "non_cash">,
  currency: Money["currency"],
): Money => sumMoney(transaction.legs
  .filter((leg): leg is AccountingLeg & CashLegDraft => leg.type === "cash"
    && leg.cashFlowClass === cashFlowClass
    && leg.amount.currency.equals(currency))
  .map((leg) => leg.posting === "debit" ? leg.amount : leg.amount.negated()), currency);
