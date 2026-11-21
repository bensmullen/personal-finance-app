import { expect } from "vitest";
import { accountingTransactionId, type AccountingTransaction } from "../../../../../src/accounting/index.js";
import type { CompiledHouseholdProjectionRunResult } from "../../../../../src/simulation/householdExecution.js";
import { depositOperationId, originalOperationId } from "../../../../../src/simulation/d2/integration/fsaCash/source.js";
import { idempotencyKey } from "../../../../../src/identity/index.js";
import { money, USD } from "../../../../../src/values/index.js";
import { ids } from "./bank.js";
import { cents } from "./cashSources.js";
import type { household } from "./scenario.js";
import { payrollCredit, payrollExpense } from "./wages.js";

type Witness = ReturnType<typeof household>;
type Leg = readonly [string, string, string, string];
type Entry = readonly [string, string, readonly Leg[]];
const debitCash = (amount: string, bank: string = ids.bank): Leg => ["cash", "debit", bank, amount];
const creditCash = (amount: string, bank: string = ids.bank): Leg => ["cash", "credit", bank, amount];
const income = (amount: string): Leg => ["income", "credit", "", amount];
const expense = (amount: string, entity = ""): Leg => ["expense", "debit", entity, amount];
const debitDebt = (entity: string, amount: string): Leg => ["liability", "debit", entity, amount];
const creditDebt = (entity: string, amount: string): Leg => ["liability", "credit", entity, amount];
const line = (tx: AccountingTransaction): Entry => [tx.type, tx.date, tx.legs.map(leg => [
  leg.type, leg.posting, leg.type === "cash" ? leg.accountId : "entityId" in leg ? leg.entityId ?? "" : "",
  leg.amount.amount.toString(),
])];
const sorted = (entries: readonly Entry[]) => entries.map(entry => JSON.stringify(entry)).sort();

export function expectedJournals(witness: Witness): readonly (readonly Entry[])[] {
  const { sources, periods, premium, medicare, ssa } = witness, [auto, mortgage] = sources.loans;
  const cmsLiability = medicare.confirmed[0]!.payable.liabilityId, premiumLiability = premium.confirmed[0]!.payable.liabilityId;
  const journal: Entry[][] = [[
    ["expense_recognition", "2025-12-01T00:00:00.000Z", [expense("120"), creditDebt(cmsLiability, "120")]],
    ["expense_settlement", "2025-12-01T00:00:00.000Z", [debitDebt(cmsLiability, "120"), creditCash("120")]],
  ]];
  for (const [index, period] of periods.slice(1).entries()) {
    const month = period.start.slice(0, 7);
    const at = (day: string, hour = "00") => `${month}-${day}T${hour}:00:00.000Z`;
    const entries: Entry[] = [];
    if (index === 0) entries.push(
      ["payroll_income", at("05", "17"), [["asset", "debit", payrollCredit, "100"], expense("200", payrollExpense), debitCash("700"), income("1000")]],
      ["retirement_cash_transfer", at("17"), [debitCash("500"), creditCash("500", ids.ira)]],
      ["expense_recognition", at("20"), [expense("300.37"), creditDebt(premiumLiability, "300.37")]],
      ["expense_settlement", at("20"), [debitDebt(premiumLiability, "300.37"), creditCash("300.37")]],
      ["mortgage_extra_principal", at("23"), [debitDebt(mortgage!.principalLiabilityId, "0.01"), creditCash("0.01")]],
    );
    if (index < 2) {
      const interest = index === 0 ? "1" : "0.5";
      const principal = index === 0 ? "49.75" : "50.24";
      const payable = mortgage!.interestPayableLiabilityId;
      entries.push(
        ["mortgage_interest_recognition", at("23"), [expense(interest), creditDebt(payable, interest)]],
        ["mortgage_interest_settlement", at("23"), [debitDebt(payable, interest), creditCash(interest)]],
        ["mortgage_principal_payment", at("23"), [debitDebt(mortgage!.principalLiabilityId, principal), creditCash(principal)]],
      );
    }
    if (index > 0) {
      const card = sources.cards[index - 1]!;
      entries.push(
        ["heloc_interest", at("01"), [expense("1"), creditDebt(ids.helocCharges, "1")]],
        ["heloc_service", at("01"), [debitDebt(ids.helocPrincipal, "10"), debitDebt(ids.helocCharges, "1"), creditCash("11", ids.personBank)]],
        ["funded_card_payment", at("15", "17"), [debitDebt(card.payment.cardAccountId, "200"), creditCash("200")]],
      );
    }
    if (index < ssa.length) {
      const card = sources.cards[index]!;
      entries.push(
        ["income", at("08"), [debitCash("125.37"), income("125.37")]],
        ["fsa_medical_expense_payment", at("10", "12"), [expense("1000"), creditCash("1000")]],
        ["ssa_medicare_same_event", at("15"), [debitCash("1420"), expense("80"), income("1500")]],
        ["fsa_expense_reimbursement", at("16", "12"), [debitCash("1000"), ["expense", "credit", "", "1000"]]],
        ["auto_loan_principal_payment", at("22"), [debitDebt(auto!.principalLiabilityId, "1"), creditCash("1")]],
        ["issuer_card_charge", card.charge.effectiveAt, [expense("20"), creditDebt(card.payment.cardAccountId, "20")]],
      );
    }
    journal.push(entries);
  }
  return journal;
}

function assertBalanced(tx: AccountingTransaction): void {
  let balance = money("0");
  for (const leg of tx.legs) {
    expect(leg.amount.currency).toEqual(USD);
    expect(leg.amount.amount.fitsScale(2)).toBe(true);
    balance = leg.posting === "debit" ? balance.plus(leg.amount) : balance.minus(leg.amount);
  }
  expect(balance.isZero(), tx.id).toBe(true);
}

export function assertWitness(witness: Witness, expected: readonly (readonly Entry[])[], result: CompiledHouseholdProjectionRunResult): void {
  const { state } = result, { sources, ssa, premium, medicare } = witness;
  const count = ssa.length;
  expect(result.diagnostics.filter(issue => issue.severity === "error")).toEqual([]);
  expect(result.periods).toHaveLength(expected.length);
  const transactions = result.periods.flatMap(period => period.transactions);
  expect(new Set(transactions.map(tx => tx.id)).size).toBe(transactions.length);
  for (const [index, period] of result.periods.entries()) {
    const authored = expected[index]!;
    expect(sorted(period.transactions.map(line))).toEqual(sorted(authored));
    period.transactions.forEach(assertBalanced);
    const statement = (kind: "income" | "expense", normal: "debit" | "credit") => authored.flatMap(entry => entry[2])
      .filter(leg => leg[0] === kind).reduce((sum, leg) => leg[1] === normal ? sum.plus(money(leg[3])) : sum.minus(money(leg[3])), money("0"));
    expect(period.statements.income).toEqual(statement("income", "credit"));
    expect(period.statements.expenses).toEqual(statement("expense", "debit"));
    const elapsed = Math.max(0, index - 1), processed = Math.min(index, count);
    const householdCash = index === 0 ? 988000n : sources.cash[index - 1]!.closing;
    const borrowerCash = 50000n - 1100n * BigInt(elapsed);
    const retirementCash = index === 0 ? 100000n : 50000n;
    const taxCredit = index === 0 ? 0n : 10000n;
    const fixed = BigInt(count - processed) * 100n + (index === 0 ? 10000n : index === 1 ? 5024n : 0n);
    const revolving = 100000n * BigInt(count) + 2000n * BigInt(processed) - 20000n * BigInt(elapsed);
    const heloc = 100000n - 1000n * BigInt(elapsed);
    const cash = householdCash + borrowerCash + retirementCash;
    expect(period.cash).toEqual(money(cents(cash)));
    expect(period.investmentValue).toEqual(money("0"));
    expect(period.assets).toEqual(money(cents(cash + taxCredit)));
    expect(period.liabilities).toEqual(money(cents(fixed + revolving + heloc)));
    expect(period.netWorth).toEqual(money(cents(cash + taxCredit - fixed - revolving - heloc)));
  }
  expect(Object.values(state.accounts).filter(account => account.kind === "checking").map(a => a.id).sort())
    .toEqual([ids.bank, ids.personBank].sort());
  expect(state.accounts[ids.bank]).toMatchObject({ ownerId: ids.household, cash: money(cents(sources.cash.at(-1)!.closing)) });
  expect(state.accounts[ids.personBank]).toMatchObject({ ownerId: ids.bob, cash: money(cents(50000n - 1100n * BigInt(count))) });
  expect(state.accounts[ids.ira]).toMatchObject({ ownerId: ids.alice, cash: money("500") });
  expect(Object.keys(state.positions)).toEqual([payrollCredit]);
  expect(state.positions[payrollCredit]?.carryingValue).toEqual(money("100"));
  expect(state.liabilities[sources.loans[0]!.principalLiabilityId]?.balance).toEqual(money("0"));
  expect(state.liabilities[sources.loans[1]!.principalLiabilityId]?.balance).toEqual(money("0"));
  expect(state.liabilities[ids.helocPrincipal]?.balance).toEqual(money(cents(100000n - 1000n * BigInt(count))));
  for (const card of sources.cards) expect(state.liabilities[card.payment.cardAccountId]?.balance).toEqual(money("820"));

  const archive = state.d2PostedTransactions!;
  const receipts = Object.values(state.d2SettlementReceipts!);
  expect(receipts).toHaveLength(count * 3);
  for (const receipt of receipts) {
    expect(archive[receipt.originalTransaction.id]?.transaction).toEqual(receipt.originalTransaction);
    expect(archive[receipt.paymentTransaction.id]?.transaction).toEqual(receipt.paymentTransaction);
    expect(state.identities.recognitionIds).toContain(receipt.recognitionId);
    expect(state.identities.settlementIds).toContain(receipt.settlementId);
    if (receipt.kind === "heloc_phase_service") {
      expect(receipt.bankAccountId).toBe(ids.personBank);
      expect(receipt.source.personId).toBe(ids.bob);
      expect(receipt.nativeHousehold).toBeUndefined();
    } else {
      expect(receipt.bankAccountId).toBe(ids.bank);
      expect(receipt.nativeHousehold?.settlement.route?.sourceId).toBe(receipt.kind === "fsa_paid_reimbursement" ? "fsaBank" : "cardBank");
      if (receipt.kind === "fsa_paid_reimbursement") {
        expect(receipt.entitlementConsumed).toEqual(money("1000"));
        expect(receipt.source.personId).toBe(ids.alice);
      } else {
        expect(receipt.interestAllocation).toEqual(money("20"));
        expect(receipt.principalAllocation).toEqual(money("180"));
        expect(receipt.source.personId).toBe(ids.bob);
      }
    }
  }
  for (const original of sources.medical) {
    expect(archive[accountingTransactionId(originalOperationId(original))]?.registration.kind).toBe("fsa_paid_reimbursement");
    expect(archive[accountingTransactionId(depositOperationId(original))]?.registration.kind).toBe("fsa_paid_reimbursement");
  }
  expect(Object.keys(state.ssaMedicarePayments!)).toHaveLength(count);
  for (const row of Object.values(state.ssaMedicarePayments!)) {
    expect(row.payable.recipientId).toBe(ids.bob);
    expect(row.netBank).toEqual(money("1420"));
    expect(row.requests.map(request => request.terms.amount)).toEqual([money("80")]);
    expect(row.nativeHousehold?.originals.map(witness => witness.original.family)).toEqual(["ssa", "medicare"]);
    expect(state.obligations[row.right.id]?.settlementIds).toEqual([row.rightSettlementId]);
    expect(state.identities.externalIdempotencyKeys).toContain(idempotencyKey("ssa-medicare:payment", row.payable.paymentId));
    for (const request of row.requests) expect(state.obligations[request.claim.id]?.settlementIds).toEqual([request.draft.id]);
  }
  for (const { original } of [premium, medicare]) {
    expect(archive[original.settlement.id]?.transaction).toEqual(original.settlement);
    expect(state.obligations[original.claimId]?.settlementIds).toEqual([original.context.eventId]);
  }
  const allocations = Object.values(state.retirementDistributionAllocations!);
  expect(allocations).toHaveLength(1);
  expect(allocations[0]).toMatchObject({ version: "retirement-distribution/v2", rmdSatisfaction: "not_applied", tax: "incomplete",
    destinationAccountId: ids.bank, sourceAccountId: ids.ira, gross: money("500"), withholding: money("0") });
  expect(result.outputCapabilities?.rmdSatisfaction?.status).toBe("incomplete");
  expect(result.outputCapabilities?.fsaCashSettlement?.status).toBe("complete");
  expect(result.outputCapabilities?.fsaPayrollTax?.status).toBe("incomplete");
  const paychecks = Object.values(archive).filter(({ registration }) => registration.kind === "household_domain" &&
    registration.evidence.originals.some(witness => witness.original.family === "wage"));
  expect(paychecks).toHaveLength(count + 1);
  for (const { transaction, registration } of paychecks) {
    if (registration.kind !== "household_domain") throw new Error("Missing wage archive");
    expect(registration.evidence.route.sourceId).toBe("wageBank");
    expect(registration.evidence.originals.map(witness => witness.original.family))
      .toEqual(transaction.type === "payroll_income" ? ["wage", "payroll_health"] : ["wage"]);
  }
  const fixed = Object.values(archive).flatMap(({ registration }) => registration.kind === "fixed_loan_original" ? [registration.evidence] : []);
  expect(fixed).toHaveLength(count + 7);
  for (const evidence of fixed) {
    expect(evidence.original.publisherId).toBe("s8-five-fixed-lender");
    const classification = evidence.classification;
    if (classification.kind !== "interest_recognition") {
      expect(classification.route.sourceId).toBe("loanBank");
      expect(state.obligations[evidence.claimId]?.settlementIds).toContain(classification.settlementId);
    }
  }
}
