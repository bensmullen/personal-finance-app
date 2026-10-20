import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { calculationTraceId } from "../../../../src/lineage/index.js";
import { claimId, recognitionId, settlementId } from "../../../../src/semantics/identity.js";
import { createAuthoritativeState, d2SettlementSourceFingerprint, registerD2SettlementSourceAuthority,
  type D2CardSettlementReceipt, type D2FsaSettlementReceipt, type D2SettlementReceipt, type D2SettlementSourceAuthority } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";

export const ids = {
  bank: domainId("account", "149a0000-0000-4000-8000-000000000001"),
  person: domainId("person", "149a0000-0000-4000-8000-000000000002"),
  household: domainId("household", "149a0000-0000-4000-8000-000000000003"),
  liability: domainId("liability", "149a0000-0000-4000-8000-000000000004"),
};
export const context = { asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z") };
const known = instant("2025-12-01T00:00:00.000Z");
export const state = (cash = "500", balance = "1000") => createAuthoritativeState({
  accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.person, cash: money(cash) } },
  liabilities: { [ids.liability]: { id: ids.liability, balance: money(balance) } },
});
const common = (key: string) => ({ schemaVersion: "d2-shared/settlement-receipt/v1" as const,
  id: `receipt:${key}`, operationId: `operation:${key}`, authorizationId: `authorization:${key}`,
  claimId: claimId(`claim:${key}`), paymentId: `payment:${key}`, recognitionId: recognitionId(`recognition:${key}`),
  settlementId: settlementId(`settlement:${key}`), effectiveAt: instant("2026-01-15T00:00:00.000Z"),
  bankAccountId: ids.bank, traceIds: [calculationTraceId(`trace:${key}`)],
});
const source = (key: string) => ({ sourceId: `source:${key}`, sourceVersion: "synthetic/v1", ruleVersion: "synthetic/v1",
  publishedAt: known, knownAt: known, householdId: ids.household, personId: ids.person,
  sourceApprovalId: `source-approval:${key}`, paymentApprovalId: `payment-approval:${key}` });
const journal = (key: string, legs: AccountingTransaction["legs"], at = instant("2026-01-10T00:00:00.000Z")) =>
  createAccountingTransaction({ id: accountingTransactionId(key), type: "independent-mock-journal", date: at, legs });
export const card = (key = "card"): D2CardSettlementReceipt => {
  const base = common(key), binding = { ...source(key), kind: "card_interest_payment" as const,
    issuerId: "synthetic-issuer", statementId: `statement:${key}`, chargeId: `charge:${key}`, quoteId: `quote:${key}`, minimum: money("25") };
  return { ...base, kind: "card_interest_payment", source: binding, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(binding),
    bankCashBefore: money("500"), amount: money("200"), liabilityId: ids.liability, liabilityBefore: money("1000"),
    postedInterest: money("20"), postedFee: money("0"), interestAllocation: money("20"), principalAllocation: money("180"), feeAllocation: money("0"),
    originalTransaction: journal(`interest:${key}`, [
      createAccountingLeg({ type: "expense", posting: "debit", amount: money("20") }),
      createAccountingLeg({ type: "liability", posting: "credit", entityId: ids.liability, amount: money("20") }),
    ]), paymentTransaction: journal(`funded:${key}`, [
      createAccountingLeg({ type: "liability", posting: "debit", entityId: ids.liability, amount: money("200") }),
      createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount: money("200"), cashFlowClass: "operating" }),
    ], base.effectiveAt) };
};
export const fsa = (key = "fsa"): D2FsaSettlementReceipt => {
  const base = common(key), binding = { ...source(key), kind: "fsa_paid_reimbursement" as const,
    planId: "synthetic-plan", planYearId: "synthetic-2026", memberId: "synthetic-member", payeeId: "synthetic-provider",
    medicalReceiptId: `medical:${key}`, expensePaymentId: `expense-payment:${key}`,
    incurredAt: instant("2026-01-05T00:00:00.000Z"), entitlementConsumptionId: `entitlement:${key}` };
  return { ...base, kind: "fsa_paid_reimbursement", source: binding, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(binding),
    bankCashBefore: money("1500"), amount: money("1000"), eligibleExpense: money("1000"), entitlementConsumed: money("1000"),
    originalTransaction: journal(`expense:${key}`, [
      createAccountingLeg({ type: "expense", posting: "debit", amount: money("1000") }),
      createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount: money("1000"), cashFlowClass: "operating" }),
    ]), paymentTransaction: journal(`deposit:${key}`, [
      createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.bank, amount: money("1000"), cashFlowClass: "operating" }),
      createAccountingLeg({ type: "expense", posting: "credit", amount: money("1000") }),
    ], base.effectiveAt) };
};

/** Independent mock store populated explicitly by each test from its source
 * fixture, never from the qualify callback's caller-supplied binding. Production
 * plan/issuer evaluation is deliberately absent from this foundation. */
export const independentSources = new Map<string, D2SettlementReceipt>();
export const actualJournals = new Map<string, AccountingTransaction>();
export const availability = { source: true, calls: 0, failAt: 0 };
const authority: D2SettlementSourceAuthority = {
  qualify: binding => {
    availability.calls++;
    if (!availability.source || availability.calls === availability.failAt) return { status: "incomplete", reason: "source_unavailable" };
    const receipt = independentSources.get(binding.sourceId);
    return receipt === undefined ? { status: "incomplete", reason: "source_not_qualified" } : { status: "qualified", receipt };
  },
  postedTransaction: id => actualJournals.get(id),
};
export const registerMockAuthorities = () => {
  registerD2SettlementSourceAuthority("card_interest_payment", authority);
  registerD2SettlementSourceAuthority("fsa_paid_reimbursement", authority);
};
export const admit = <T extends D2SettlementReceipt>(receipt: T): T => {
  independentSources.set(receipt.source.sourceId, receipt);
  return receipt;
};
export const capturePostedJournals = (receipt: D2SettlementReceipt): void => {
  actualJournals.set(receipt.originalTransaction.id, receipt.originalTransaction);
  actualJournals.set(receipt.paymentTransaction.id, receipt.paymentTransaction);
};
