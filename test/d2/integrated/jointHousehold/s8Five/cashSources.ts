import { registerCardBankSourcePort, type CardBankDocument } from "../../../../../src/simulation/d2/integration/cardBank/index.js";
import { fsaCashSourceFingerprint, registerFsaCashSourceProvider, type FsaCashSource } from "../../../../../src/simulation/d2/integration/fsaCash/index.js";
import { depositOperationId, originalOperationId } from "../../../../../src/simulation/d2/integration/fsaCash/source.js";
import { fsaScopeId } from "../../../../../src/simulation/d2/health/fsa/index.js";
import { registerFixedLoanOriginalProvider, type FixedLoanContractOriginal, type FixedLoanPaymentOriginal } from "../../../../../src/simulation/d2/integration/fixedLoanOriginalBridge/source.js";
import { registerHelocServicingSourcePorts, type HelocBankDebit, type HelocServiceDocument } from "../../../../../src/simulation/d2/integration/helocServicing/index.js";
import { instant, utcMonthlyPeriods } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { ids as cardIds, document } from "../../cardBank/scenario.js";
import { ids as fsaIds, provenance, source } from "../../fsaCash/scenario.js";
import { fixture as loanFixture } from "../../fixedLoanOriginalBridge/scenario.js";
import { ids as fixedIds } from "../../householdBankAuthority/scenario.js";
import { ids as helocIds, documents } from "../../helocServicing/scenario.js";
import { bank, bankEvent, ids, revision, sameObservation, seenAt, start } from "./bank.js";
import { bytes, mapDocument, observe, sourceMeterActive, testId } from "./sourceMeter.js";

const fsa = new Map<string, FsaCashSource>();
const cards = new Map<string, CardBankDocument>();
const issuer = new Map<string, { original: HelocServiceDocument; size?: number }>();
const helocBank = new Map<string, HelocBankDebit>();
const lender = new Map<string, FixedLoanContractOriginal>();
const installments = new Map<string, FixedLoanPaymentOriginal>();
const lenderId = "s8-five-fixed-lender";
export const cashFault: {
  missing?: string; card?: (row: CardBankDocument) => CardBankDocument; fsa?: (row: FsaCashSource) => FsaCashSource;
  heloc?: (row: HelocServiceDocument) => HelocServiceDocument; lender?: (row: FixedLoanPaymentOriginal) => FixedLoanPaymentOriginal;
} = {};
export const helocReads = { historyRows: 0, consumedRows: 0 };
export function installCashSources(): void {
  registerFsaCashSourceProvider({ lookup(id) {
    const row = fsa.get(id);
    return observe("fsa", row && cashFault.missing !== id ? cashFault.fsa?.(row) ?? row : undefined);
  } }, "s8-five-employer-fsa");
  registerCardBankSourcePort({ householdPublisherId: "s8-five-card-issuer", read(id) {
    const row = cards.get(id);
    return observe("card", row && cashFault.missing !== id ? cashFault.card?.(row) ?? row : undefined);
  } });
  registerHelocServicingSourcePorts({ issuer: { read(id) {
    const row = issuer.get(id);
    if (!row || cashFault.missing === id) return undefined;
    const original = cashFault.heloc?.(row.original) ?? row.original;
    if (!sourceMeterActive()) return original;
    const history = original.request.checkpoint.history.slice();
    helocReads.historyRows += history.length;
    for (const [index, row] of original.request.checkpoint.history.entries()) {
      let consumed = false;
      Object.defineProperty(history, index, { enumerable: true, get() {
        if (!consumed) { consumed = true; helocReads.consumedRows++; }
        return row;
      } });
    }
    return observe("helocIssuer", { ...original, request: { ...original.request, checkpoint: { ...original.request.checkpoint, history } } },
      original === row.original ? (row.size ??= bytes(original)) : bytes(original));
  } }, bank: { read: id => observe("helocBank", cashFault.missing === id ? undefined : helocBank.get(id)) } });
  registerFixedLoanOriginalProvider({ publisherId: lenderId, readOriginals(query) {
    if (!sameObservation(query)) return undefined;
    const contract = lender.get(query.reference.contractSourceId);
    const payment = installments.get(`${query.reference.contractSourceId}:${query.eventAt}`);
    if (!contract || !payment || cashFault.missing === payment.sourceId) return undefined;
    return observe("lender", { version: "fixed-loan-original-inventory/v1", query,
      checkedAt: seenAt, completeThrough: seenAt, completeness: "complete",
      contractHistory: [{ ...revision, revisionId: "contract-v1", original: contract }],
      paymentHistory: [{ ...revision, revisionId: "payment-v1", original: cashFault.lender?.(payment) ?? payment }] } as const);
  } });
}

function cardOriginal(index: number): CardBankDocument {
  const seed = document(), statement = seed.request.cards[0]!;
  const distinct = new Set([seed.sourceId, seed.statementId, seed.quoteId, seed.sourceApprovalId,
    seed.charge.evidenceId, seed.charge.operationId, statement.statementSource.ruleSnapshotId, statement.payment.operationId,
    seed.payment.approvalId, seed.payment.authorizationId, seed.payment.paymentId, seed.payment.settlementId]);
  return mapDocument(seed, value => {
    if (distinct.has(value)) return `${value}:${index}`;
    if (value === cardIds.card) return testId(500 + index);
    return value.replaceAll(cardIds.household, ids.household).replaceAll(cardIds.person, ids.bob)
      .replaceAll(cardIds.bank, ids.bank).replace(/^2026-(\d{2})-(\d{2})/, (_date, month: string, day: string) => {
      const offset = index + Number(month) - 1;
      const last = new Date(Date.UTC(2026, offset + 1, 0)).getUTCDate();
      return new Date(Date.UTC(2026, offset, Math.min(Number(day), last))).toISOString().slice(0, 10);
    });
  });
}

export function cents(value: bigint): string {
  const amount = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
}

/** Literal fixture arithmetic in cents, before any execution or quote output.
 * January includes elected payroll, retirement and a second loan payment.
 * The card payment belongs to the previous month's original interest charge. */
export function cashSchedule(count: number) {
  let closing = 988000n; // $10,000.00 less the December $120.00 CMS payment.
  return Array.from({ length: count + 1 }, (_, index) => {
    let cash = closing;
    if (index === 0) cash += 70000n;
    if (index < count) cash += 12537n;
    const medicalBefore = cash;
    if (index < count) cash += 42000n; // $1,000.00 debit, then $1,420.00 SSA credit.
    const cardBefore = cash;
    if (index > 0) cash -= 20000n;
    const reimbursementBefore = cash;
    if (index < count) cash += 100000n;
    const retirementBefore = cash;
    if (index === 0) cash += 50000n - 5076n - 30037n;
    if (index === 1) cash -= 5074n;
    if (index < count) cash -= 100n;
    closing = cash;
    return { medicalBefore, cardBefore, reimbursementBefore, retirementBefore, closing };
  });
}

export function publishCashSources(count: number) {
  fsa.clear(); cards.clear(); issuer.clear(); helocBank.clear(); installments.clear(); lender.clear();
  delete cashFault.missing; delete cashFault.card; delete cashFault.fsa; delete cashFault.heloc; delete cashFault.lender;
  helocReads.historyRows = 0;
  helocReads.consumedRows = 0;
  const cash = cashSchedule(count), periods = utcMonthlyPeriods(start, count);
  for (const [index, period] of periods.entries()) {
    const month = period.start.slice(0, 7), year = month.slice(0, 4);
    const original = source(month, "1000", `${month}-10`, `${month}-16`);
    const oldScope = fsaScopeId(original.request.plan);
    // Distinct plans over distinct short synthetic employments keep complete
    // per-plan claim histories bounded. No plan consumes another plan's rights.
    const identity = { householdId: ids.household, personId: ids.alice, employerId: `clinic-benefit-job:${index}`,
      planId: `health-fsa:${index}`, planYearId: year };
    const planScope = fsaScopeId(identity);
    const dates = new Map([["2026-01-01", `${year}-01-01`], ["2027-01-01", `${Number(year) + 1}-01-01`],
      ["2027-04-01", `${Number(year) + 1}-04-01`], ["2026", year]]);
    const medical = mapDocument(original, value => dates.get(value) ?? value
      .replaceAll(encodeURIComponent(oldScope), encodeURIComponent(planScope)).replaceAll(oldScope, planScope)
      .replaceAll("health_fsa_law:2026", `health_fsa_law:${year}`)
      .replaceAll("synthetic-employer", identity.employerId).replaceAll("synthetic-plan", identity.planId)
      .replaceAll(fsaIds.household, ids.household).replaceAll(fsaIds.person, ids.alice).replaceAll(fsaIds.bank, ids.bank));
    const request = { ...medical.request, receipts: medical.request.receipts.map(row => ({
      ...row, destination: { ...row.destination!, ownerId: ids.household, householdBank: true as const },
    })) };
    fsa.set(medical.sourceId, { ...medical, request, provenance: provenance(request),
      original: { ...medical.original, bankCashBefore: money(cents(cash[index]!.medicalBefore)) },
      deposit: { ...medical.deposit, ownerId: ids.household, bankCashBefore: money(cents(cash[index]!.reimbursementBefore)) },
      householdBank: { bankPublisherId: bank("fsaBank").publisherId, bankSourceId: bank("fsaBank").sourceId,
        originalContext: bankEvent(ids.alice, originalOperationId(medical), medical.original.paidAt, "debit"),
        settlementContext: bankEvent(ids.alice, depositOperationId(medical), medical.deposit.settledAt, "credit") } });
    const card = cardOriginal(index);
    cards.set(card.sourceId, { ...card, householdBank: { runId: bankEvent(ids.bob, "", start, "debit").runId, bank: bank("cardBank") },
      payment: { ...card.payment, bankCashBefore: money(cents(cash[index + 1]!.cardBefore)) } });
  }

  const helocs = mapDocument(documents(count, true), value => value.replaceAll(helocIds.household, ids.household)
    .replaceAll(helocIds.person, ids.bob));
  for (const row of helocs) {
    issuer.set(row.issuer.sourceId, { original: row.issuer });
    helocBank.set(row.bank.id, row.bank);
  }

  const loans = (["growth", "extra"] as const).map(mode => {
    const growth = mode === "growth", family = growth ? "auto" : "mortgage", term = growth ? count : 2;
    const original = loanFixture(family, mode, term).input.loans[0]!;
    const loan = mapDocument(original, value => value.replaceAll(fixedIds.bank, ids.bank)
      .replaceAll(fixedIds.alice, ids.alice)
      .replaceAll("2026-01-15T00:00:00.000Z", growth ? "2026-01-22T00:00:00.000Z" : "2026-01-23T00:00:00.000Z")
      .replaceAll("58f21d59-0077-4ee2-8593-", growth ? "33150001-0000-4000-8000-" : "33150002-0000-4000-8000-"));
    return { ...loan, originalSource: { ...loan.originalSource!, publisherId: lenderId } };
  });
  const [growthLoan, interestLoan] = loans;
  for (const loan of loans) {
    lender.set(loan.originalSource.contractSourceId, { reference: loan.originalSource, householdId: ids.household, borrowerId: ids.alice,
      loanId: loan.id, legalOwnerId: ids.alice, principalLiabilityId: loan.principalLiabilityId,
      interestPayableLiabilityId: loan.interestPayableLiabilityId, debtFamily: loan.debtFamily!,
      originalPrincipal: loan.originalPrincipal, annualRate: loan.annualRate, totalPayments: loan.totalPayments, paymentSchedule: loan.paymentSchedule });
  }
  for (const period of periods) {
    const month = period.start.slice(0, 7), eventAt = instant(`${month}-22T00:00:00.000Z`);
    const contractSourceId = growthLoan!.originalSource.contractSourceId;
    installments.set(`${contractSourceId}:${eventAt}`, { sourceId: `auto-installment:${month}`, contractSourceId, eventAt,
      taxYear: Number(month.slice(0, 4)), contractualPayment: money("1"), currentInterest: money("0"),
      interestDue: money("0"), principalDue: money("1"), bank: { ...bank("loanBank"), accountId: ids.bank } });
  }
  const original = interestLoan!.originalSource.contractSourceId;
  const extra = interestLoan!.extraPrincipalPayments![0]!;
  const eventAt = extra.scheduledAt;
  installments.set(`${original}:${eventAt}`, { sourceId: "mortgage-installment:2026-01", contractSourceId: original, eventAt,
    taxYear: 2026, contractualPayment: money("50.75"), currentInterest: money("1"),
    interestDue: money("1"), principalDue: money("49.75"), extra: { instructionId: extra.id, authorizedAmount: money("0.01") },
    bank: { ...bank("loanBank"), accountId: ids.bank } });
  const finalAt = instant("2026-02-23T00:00:00.000Z");
  installments.set(`${original}:${finalAt}`, { sourceId: "mortgage-installment:2026-02", contractSourceId: original, eventAt: finalAt,
    taxYear: 2026, contractualPayment: money("50.75"), currentInterest: money("0.50"),
    interestDue: money("0.50"), principalDue: money("50.24"), bank: { ...bank("loanBank"), accountId: ids.bank } });
  return { loans, cash, helocs, cards: [...cards.values()], medical: [...fsa.values()],
    cardSourceIds: [...cards.keys()], helocSourceIds: [...issuer.keys()],
    fsaReferences: [...fsa.values()].map(raw => ({ sourceId: raw.sourceId, expectedSource: fsaCashSourceFingerprint(raw) })) };
}

export function publishContendingLoan() {
  const seed = loanFixture("mortgage", "contention", 1).input.loans[0]!;
  const loan = mapDocument(seed, value => value.replaceAll(fixedIds.bank, ids.bank).replaceAll(fixedIds.alice, ids.alice)
    .replaceAll("2026-01-15T00:00:00.000Z", "2026-01-20T00:00:00.000Z"));
  const originalSource = { ...loan.originalSource!, publisherId: lenderId };
  const { contractSourceId } = originalSource;
  lender.set(contractSourceId, { reference: originalSource, householdId: ids.household, borrowerId: ids.alice,
    legalOwnerId: ids.alice, loanId: loan.id, debtFamily: "mortgage", originalPrincipal: money("99.01"),
    principalLiabilityId: loan.principalLiabilityId, interestPayableLiabilityId: loan.interestPayableLiabilityId,
    annualRate: loan.annualRate, totalPayments: 1, paymentSchedule: loan.paymentSchedule });
  const eventAt = loan.paymentSchedule.anchor;
  installments.set(`${contractSourceId}:${eventAt}`, { sourceId: "s8-five-contention-installment", contractSourceId, eventAt,
    taxYear: 2026, contractualPayment: money("100"), currentInterest: money("0.99"),
    interestDue: money("0.99"), principalDue: money("99.01"), bank: { ...bank("loanBank"), accountId: ids.bank } });
  return { ...loan, originalSource };
}
