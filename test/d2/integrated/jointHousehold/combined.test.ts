import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId, type AccountingTransaction } from "../../../../src/accounting/index.js";
import { ValidationError } from "../../../../src/diagnostics/index.js";
import { cloneAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { money, Money, USD } from "../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { evaluateFsa } from "../../../../src/simulation/d2/health/fsa/index.js";
import { type FsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/index.js";
import { qualifyFsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/source.js";
import { qualifyCardBankSource } from "../../../../src/simulation/d2/integration/cardBank/index.js";
import { at, cardSource, combinedScenario, ids, medicalSource, publishers, registerPublishers, resetPublishers, retirementSource } from "./combinedScenario.js";

registerPublishers();
beforeEach(resetPublishers);
const amount = (m: Money) => m.amount.toString();
const run = (s: ReturnType<typeof combinedScenario>, kernel = s.kernel) => runHouseholdKernel({ kernel, runContext: s.context, resultTier: "detail" });
const archiveIds = ["card-charge-january", "card-payment-february", "fsa-cash:s8-medical-source:original",
  "fsa-cash:s8-medical-source:deposit", "s8-retirement-posted"].sort();
const bankRows = (transactions: readonly AccountingTransaction[]) => transactions.flatMap(tx => tx.legs
  .filter(l => l.type === "cash" && l.accountId === ids.bank)
  .map(l => [tx.date, tx.type, l.posting, amount(l.amount)]))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe("#149 S8-2 canonical cross-domain truth table", () => {
  it("posts exact dated BANK, principal, recognition and consolidated wealth without duplicate income or expense", () => {
    const s = combinedScenario(), before = canonicalSerialize(s.opening), result = s.run();
    expect(s.base.attached.diagnostics).toEqual([]);
    expect(s.base.attached.admittedOperationIds).toHaveLength(12);
    // Every admitted operation executes, but missing tax/future-cycle coverage
    // must keep the overall forecast explicitly incomplete.
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.periods).toHaveLength(2);
    const [jan, feb] = result.periods;
    expect(amount(s.opening.accounts[ids.bank]!.cash)).toBe("2000");
    expect(amount(s.opening.accounts[ids.retirement]!.cash)).toBe("1000");
    const januaryOnly = combinedScenario({ months: 1 }).run();
    expect(januaryOnly.periods).toHaveLength(1);
    expect(januaryOnly.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(amount(januaryOnly.state.accounts[ids.bank]!.cash)).toBe("1700");
    expect(amount(januaryOnly.state.liabilities[ids.card]!.balance)).toBe("1020");
    expect(bankRows(jan!.transactions)).toEqual([
      ["2026-01-05T00:00:00.000Z", "income", "debit", "1000"],
      ["2026-01-10T12:00:00.000Z", "fsa_medical_expense_payment", "credit", "1000"],
      ["2026-01-15T00:00:00.000Z", "auto_loan_extra_principal", "credit", "55.76"],
      ["2026-01-15T00:00:00.000Z", "auto_loan_interest_settlement", "credit", "50"],
      ["2026-01-15T00:00:00.000Z", "auto_loan_principal_payment", "credit", "394.24"],
      ["2026-01-15T00:00:00.000Z", "expense_settlement", "credit", "300"],
      ["2026-01-22T12:00:00.000Z", "retirement_cash_transfer", "debit", "500"],
    ]);
    const service = (txs: readonly AccountingTransaction[]) => bankRows(txs).filter(row => row[0]!.includes("-15T00:"))
      .map(row => row.slice(1)).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(service(jan!.transactions)).toEqual([
      ["auto_loan_extra_principal", "credit", "55.76"], ["auto_loan_interest_settlement", "credit", "50"],
      ["auto_loan_principal_payment", "credit", "394.24"], ["expense_settlement", "credit", "300"],
    ]);
    expect(service(feb!.transactions)).toEqual([
      ["auto_loan_extra_principal", "credit", "55.76"], ["auto_loan_interest_settlement", "credit", "45.5"],
      ["auto_loan_principal_payment", "credit", "398.74"], ["expense_settlement", "credit", "300"],
    ]);
    expect(bankRows(feb!.transactions).filter(row => row[0] !== "2026-02-15T00:00:00.000Z")).toEqual([
      ["2026-02-05T00:00:00.000Z", "income", "debit", "1000"],
      ["2026-02-15T17:00:00.000Z", "funded_card_payment", "credit", "200"],
      ["2026-02-16T12:00:00.000Z", "fsa_expense_reimbursement", "debit", "1000"],
    ]);
    expect(result.periods.map(p => [amount(p.cash), amount(p.statements.assets), amount(p.liabilities),
      amount(p.netWorth), amount(p.statements.income), amount(p.statements.expenses)]))
      .toEqual([["2200", "2200", "5570", "-3370", "1000", "1370"], ["3200", "3200", "4915.5", "-1715.5", "1000", "-654.5"]]);
    expect(result.periods.map(p => p.transactions.length)).toEqual([10, 9]);
    expect(result.periods.map(p => amount(p.cashFlow!.recurringIncomeRecognized))).toEqual(["1000", "1000"]);
    expect(result.periods.map(p => amount(p.cashFlow!.recurringExpenseRecognized))).toEqual(["300", "300"]);
    expect(result.periods.every(p => p.liquidityShortfalls.length === 0)).toBe(true);
    expect(result.periods.map(p => [amount(p.liability!.liabilities[0]!.currentInterest), amount(p.liability!.liabilities[0]!.scheduledPrincipalPaid)]))
      .toEqual([["50", "394.24"], ["45.5", "398.74"]]);
    expect(result.periods.map(p => amount(p.liability!.liabilities[0]!.endingPrincipal))).toEqual(["4550", "4095.5"]);
    expect(amount(result.state.accounts[ids.bank]!.cash)).toBe("2700");
    expect(amount(result.state.accounts[ids.retirement]!.cash)).toBe("500");
    expect(amount(result.state.liabilities[ids.principal]!.balance)).toBe("4095.5");
    expect(amount(result.state.liabilities[ids.card]!.balance)).toBe("820");
    expect(result.state.liabilities[ids.payable]!.balance.isZero()).toBe(true);
    expect(result.state.liabilities[ids.interest]!.balance.isZero()).toBe(true);
    expect(Object.keys(result.state.accounts).sort()).toEqual([ids.bank, ids.retirement].sort());
    expect(Object.keys(result.state.liabilities).sort()).toEqual([ids.payable, ids.principal, ids.interest, ids.card].sort());
    expect(result.state.positions).toEqual({});
    const txs = result.periods.flatMap(p => p.transactions);
    expect(txs.filter(t => t.type === "issuer_card_charge").map(t => [t.date, amount(t.legs[0]!.amount)]))
      .toEqual([["2026-01-31T17:00:00.000Z", "20"]]);
    expect(txs.filter(t => t.type === "income").map(t => amount(t.legs[0]!.amount))).toEqual(["1000", "1000"]);
    expect(txs.flatMap(t => t.legs).filter(l => l.type === "tax")).toEqual([]);
    for (const tx of txs) {
      const sum = (posting: "debit" | "credit") => tx.legs.filter(l => l.posting === posting)
        .reduce((total, l) => total.plus(l.amount), Money.zero(USD));
      expect(sum("debit").equals(sum("credit"))).toBe(true);
    }
    const transfer = txs.find(t => t.type === "retirement_cash_transfer")!;
    expect(transfer.legs.map(l => [l.type, l.posting, amount(l.amount)])).toEqual([["cash", "debit", "500"], ["cash", "credit", "500"]]);
    expect(Object.keys(result.state.d2PostedTransactions!).sort()).toEqual(archiveIds);
    for (const id of archiveIds) {
      const proof = result.state.d2PostedTransactions![accountingTransactionId(id)]!;
      expect(proof.writer).toBe("applyAccountingTransactionAtomically/v1");
      expect(proof.transaction).toEqual(txs.find(tx => tx.id === id));
      expect(result.state.identities.postedTransactionIds).toContain(id);
    }
    expect(Object.keys(result.state.d2SettlementReceipts!).sort()).toEqual(["card-bank:payment-february", "fsa-cash:s8-medical-source:receipt"]);
    const q = qualifyCardBankSource("s8-issuer-source", s.context);
    expect(q.status).toBe("qualified");
    if (q.status !== "qualified") throw new Error("Issuer source did not qualify");
    expect(result.state.d2SettlementReceipts![q.receipt.id]).toEqual(q.receipt);
    const fsaReceipt = qualifyFsaCashSource(medicalSource(), s.context);
    expect(result.state.d2SettlementReceipts![fsaReceipt.id]).toEqual(fsaReceipt);
    expect(amount(fsaReceipt.entitlementConsumed)).toBe("1000");
    const eligibility = evaluateFsa(medicalSource().request);
    expect(eligibility.entitlementCoverage).toBe("complete");
    expect(eligibility.netWorthTreatment).toBe("excluded_restricted_entitlement");
    expect(amount(eligibility.entitlement!.remaining)).toBe("1000");
    expect(amount(eligibility.entitlement!.employeePayrollToDate)).toBe("0");
    expect(eligibility.claims.map(c => amount(c.grossAmount))).toEqual(["1000"]);
    expect(result.outputCapabilities?.fsaPayrollTax?.status).toBe("incomplete");
    expect(result.outputCapabilities?.fsaCashSettlement?.status).toBe("complete");
    expect(result.outputCapabilities?.cardFutureCycles?.status).toBe("incomplete");
    expect(result.state.retirementDistributionAllocations).toEqual({ "s8-retirement-posted": retirementSource() });
    expect(retirementSource()).toMatchObject({ rmdSatisfaction: "not_applied", tax: "incomplete", allocations: [] });
    expect(canonicalSerialize(s.opening)).toBe(before);
    expect(s.run()).toEqual(result);
  });

  it("fails an unfunded actual medical payment atomically without using a later deposit", () => {
    const raw = medicalSource(), fsa = { ...raw, original: { ...raw.original, bankCashBefore: money("0") } };
    publishers.fsa = () => fsa;
    const s = combinedScenario({ cash: "0", fsa }), payday = at("2026-01-20");
    const out = run(s, applyHouseholdExecutionOverlay(s.kernel, { cashFlowInput: { ...s.kernel.cash!.input,
      incomes: s.kernel.cash!.input.incomes.map(w => ({ ...w, start: payday,
        recurrence: { kind: "utc_monthly" as const, anchor: payday, invalidDayPolicy: "skip" as const } })) } }));
    expect(out.status).toBe("incomplete");
    expect(out.periods).toEqual([]);
    expect(out.state).toEqual(s.opening);
    expect(out.state.d2PostedTransactions).toBeUndefined();
    expect(out.state.identities.postedTransactionIds).toEqual([]);
    expect(out.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it("rejects actual VS2 payday at an unrelated FSA BANK instant in both participant permutations", () => {
    const s = combinedScenario(), payday = at("2026-01-10");
    const cashFlowInput = { ...s.kernel.cash!.input, incomes: s.kernel.cash!.input.incomes.map(w => ({ ...w,
      start: payday, recurrence: { kind: "utc_monthly" as const, anchor: payday, invalidDayPolicy: "skip" as const } })) };
    const participants = s.kernel.executable.participants!;
    for (const order of [participants, [...participants].reverse()]) {
      const out = run(s, applyHouseholdExecutionOverlay(s.kernel, { cashFlowInput, participants: order }));
      expect(out.status).toBe("incomplete"); expect(out.periods).toEqual([]); expect(out.state).toEqual(s.opening);
      expect(out.diagnostics.some(d => d.severity === "error"), JSON.stringify(out.diagnostics)).toBe(true);
      expect(out.state.identities.postedTransactionIds).toEqual([]);
      expect(out.state.d2PostedTransactions).toBeUndefined();
    }
  });

  it.each([false, true])("only admits the FSA provider's authenticated same-instant original/deposit sequence, signed=%s", signed => {
    const raw = medicalSource(), day = at("2026-01-10"), request = { ...raw.request,
      evaluatedAt: civilDay(day), historyThrough: civilDay(day), receipts: raw.request.receipts.map(r => {
        if (r.reimbursement?.status !== "settled") throw new Error("Fixed source must supply a settled reimbursement");
        return { ...r, reimbursement: { ...r.reimbursement, settledAt: civilDay(day) } };
      }) };
    const fsa: FsaCashSource = { ...raw, request, original: { ...raw.original,
      ...(signed ? { executionOrder: { sequenceId: "s8-signed-medical-bank", position: 1 } } : {}) },
      deposit: { ...raw.deposit, settledAt: day, publishedAt: day, knownAt: day, bankCashBefore: money("2000"),
        ...(signed ? { executionOrder: { sequenceId: "s8-signed-medical-bank", position: 2 } } : {}) } };
    publishers.fsa = () => fsa;
    const card = cardSource(); publishers.card = () => ({ ...card, payment: { ...card.payment, bankCashBefore: money("2900") } });
    const s = combinedScenario({ fsa }), out = s.run();
    expect(out.status).toBe("incomplete");
    if (signed) {
      expect(out.diagnostics.filter(d => d.severity === "error")).toEqual([]);
      expect(out.periods).toHaveLength(2); expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("2700");
      expect(Object.keys(out.state.d2PostedTransactions!).sort()).toEqual(archiveIds);
      expect(Object.keys(out.state.d2SettlementReceipts!)).toHaveLength(2);
    } else { expect(out.periods).toEqual([]); expect(out.state).toEqual(s.opening); }
  });

  it.each(["backdated_original", "late_source", "approval", "owner"] as const)("rejects %s source evidence without erasing committed January", mode => {
    const raw = medicalSource();
    const bad: FsaCashSource = mode === "backdated_original" ? { ...raw, original: { ...raw.original, publishedAt: at("2026-01-09") } }
      : mode === "late_source" ? { ...raw, provenance: raw.provenance.map(p => ({ ...p, knownAt: at("2026-03-01") })) }
      : { ...raw, deposit: { ...raw.deposit, ...(mode === "approval" ? { paymentApprovalId: "" } : { ownerId: ids.other }) } };
    publishers.fsa = () => bad;
    const s = combinedScenario({ fsa: bad }), out = s.run();
    expect(out.status).toBe("incomplete");
    if (mode === "backdated_original" || mode === "late_source") {
      expect(out.periods).toEqual([]); expect(out.state).toEqual(s.opening);
    } else {
      expect(out.periods).toHaveLength(1); expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("1700");
      expect(Object.keys(out.state.d2PostedTransactions!).sort()).toEqual(["card-charge-january", "fsa-cash:s8-medical-source:original", "s8-retirement-posted"]);
      expect(out.state.d2SettlementReceipts).toBeUndefined();
    }
    expect(out.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it("rolls back every February posting after a late failure, preserving the full earlier committed period", () => {
    const s = combinedScenario(), jan = combinedScenario({ months: 1 }).run();
    const failure: HouseholdKernelParticipant = { id: "s8-late-failure", version: "1", economicInputs: {},
      prepare: (_context, period) => ({ id: "s8-late-failure", operations: period.start !== instant("2026-02-01T00:00:00.000Z") ? [] : [{
        descriptor: { id: "s8-fail-after-both-payments", domain: "synthetic", sequencingInstant: at("2026-02-28"), dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: () => { throw new ValidationError({ severity: "error", code: "S8_LATE_FAILURE", entityType: "test", message: "Synthetic late February failure" }); },
      }] }) };
    const out = run(s, applyHouseholdExecutionOverlay(s.kernel, { participants: [...s.kernel.executable.participants!, failure] }));
    expect(out.status).toBe("incomplete"); expect(out.periods).toHaveLength(1);
    expect(out.diagnostics.map(d => d.code)).toContain("S8_LATE_FAILURE");
    expect(out.state).toEqual(jan.state); expect(out.primitiveState).toEqual(jan.primitiveState);
    expect(out.state.d2SettlementReceipts).toBeUndefined();
    expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("1700");
    expect(amount(out.state.liabilities[ids.card]!.balance)).toBe("1020");
  });

  it("refuses amended committed approval and preserves historical BANK on source loss", () => {
    const s = combinedScenario(), committed = s.run(), before = canonicalSerialize(committed.state);
    expect(committed.periods).toHaveLength(2);
    publishers.card = () => undefined;
    const out = run(s, applyHouseholdExecutionOverlay(s.kernel, { reconciledOpeningState: committed.state }));
    expect(out.status).toBe("incomplete"); expect(out.periods).toEqual([]);
    expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("2700");
    expect(out.state).toEqual(committed.state);
    expect(out.outputCapabilities?.cardFutureCycles?.status).not.toBe("complete");
    resetPublishers();
    const raw = medicalSource(); publishers.fsa = () => ({ ...raw, deposit: { ...raw.deposit, paymentApprovalId: "forged-approval" } });
    const amended = run(s, applyHouseholdExecutionOverlay(s.kernel, { reconciledOpeningState: committed.state }));
    expect(amended.status).toBe("incomplete"); expect(amended.state).toEqual(committed.state);
    expect(canonicalSerialize(committed.state)).toBe(before);
  });

  it("rejects mismatched BANK ownership for the entire combination", () => {
    const s = combinedScenario(), opening = cloneAuthoritativeState(s.opening);
    opening.accounts[ids.bank] = { ...opening.accounts[ids.bank]!, ownerId: ids.other };
    const out = run(s, applyHouseholdExecutionOverlay(s.kernel, { reconciledOpeningState: opening }));
    expect(out.status).toBe("incomplete"); expect(out.periods).toEqual([]); expect(out.state).toEqual(opening);
  });

  it("does not ignore a missing J1 source after earlier January operations have executed", () => {
    publishers.retirement = () => undefined;
    const s = combinedScenario(), out = s.run();
    expect(out.status).toBe("incomplete"); expect(out.periods).toEqual([]);
    expect(out.diagnostics.map(d => d.code)).toContain("S8_J1_SOURCE_INCOMPLETE");
    expect(out.state).toEqual(s.opening);
    expect(out.state.retirementDistributionAllocations).toBeUndefined();
    expect(out.state.d2PostedTransactions).toBeUndefined();
    expect(out.state.identities.postedTransactionIds).toEqual([]);
  });
});

// Keep branded civil dates at the request boundary rather than weakening types.
const civilDay = (at: string) => civilDate(at.slice(0, 10));
