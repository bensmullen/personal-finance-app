import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../../src/accounting/index.js";
import { createAuthoritativeState, applyD2SettlementAtomically, requalifyD2SettlementReceiptHistory } from "../../../../../src/state/index.js";
import { money } from "../../../../../src/values/index.js";
import { instant } from "../../../../../src/time/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { compileHouseholdKernel, applyHouseholdExecutionOverlay, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../../src/simulation/period.js";
import { attachHelocServicing, qualifyHelocServicingSource } from "../../../../../src/simulation/d2/integration/helocServicing/index.js";
import { withProvenance } from "../../helocServicing/scenario.js";
import { ids, jointHeloc, reset, publish, archive, debits, mapFacts } from "./scenario.js";

beforeEach(reset);
const amount = (m: ReturnType<typeof money>) => m.amount.toString();
const heloc = (t: { type: string }) => t.type === "heloc_service" || t.type === "heloc_interest";

describe("#149 S8-4 actual HELOC in funded joint-household execution", () => {
  it.each([false, true])("settles the independent $105.10/$100/$5.10 oracle with unchanged other journals (reversed=%s)", reversed => {
    const baseline = jointHeloc({ months: 2, payments: 1, service: false }).run();
    const s = jointHeloc({ months: 2, payments: 1 }), before = canonicalSerialize(s.opening);
    const participants = [...s.kernel.executable.participants!];
    const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(s.kernel,
      { participants: reversed ? participants.reverse() : participants }), runContext: s.context, resultTier: "detail" });
    expect(baseline.periods, JSON.stringify(baseline.diagnostics)).toHaveLength(2);
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(2);
    expect(out.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(out.status).toBe("incomplete");
    expect(amount(s.opening.accounts[ids.bank]!.cash)).toBe("2000");
    expect(amount(s.opening.liabilities[ids.heloc]!.balance)).toBe("1000");
    expect(s.opening.identities.postedTransactionIds).toEqual(["s8-4:actual-draw"]);
    expect(s.opening.identities.externalIdempotencyKeys.some(k => k.includes("d2:heloc-draw-receipt"))).toBe(true);
    expect(canonicalSerialize(s.opening)).toBe(before);
    expect(out.periods[0]!.statements).toEqual(baseline.periods[0]!.statements);
    expect(out.periods[0]!.transactions).toEqual(baseline.periods[0]!.transactions);
    expect(out.periods.map(p => amount(p.cash))).toEqual(["2200", "3094.9"]);
    expect(out.periods.map(p => amount(p.netWorth))).toEqual(["-4370", "-2720.6"]);
    expect(out.periods[1]!.netWorth.minus(baseline.periods[1]!.netWorth).equals(money("-5.10"))).toBe(true);
    expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("2794.9");
    expect(baseline.state.accounts[ids.bank]!.cash.minus(out.state.accounts[ids.bank]!.cash).equals(money("105.10"))).toBe(true);
    expect(amount(out.state.liabilities[ids.heloc]!.balance)).toBe("900");
    expect(out.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    const txs = out.periods.flatMap(p => p.transactions);
    expect(txs.filter(t => !heloc(t))).toEqual(baseline.periods.flatMap(p => p.transactions));
    expect(txs.filter(heloc).sort((a, b) => a.type.localeCompare(b.type))
      .map(t => [t.type, ...t.legs.map(l => [l.type, l.posting, amount(l.amount)])])).toEqual([
      ["heloc_interest", ["expense", "debit", "5.1"], ["liability", "credit", "5.1"]],
      ["heloc_service", ["liability", "debit", "100"], ["liability", "debit", "5.1"], ["cash", "credit", "105.1"]],
    ]);
    expect(out.state.retirementDistributionAllocations).toEqual(baseline.state.retirementDistributionAllocations);
    expect(out.state.accounts[ids.retirement]).toEqual(baseline.state.accounts[ids.retirement]);
    for (const id of [ids.principal, ids.interest, ids.payable, ids.card]) expect(out.state.liabilities[id]).toEqual(baseline.state.liabilities[id]);
    expect(Object.keys(out.state.accounts).sort()).toEqual([ids.bank, ids.retirement].sort());
    expect(out.state.positions).toEqual({});
    expect(txs.flatMap(t => t.legs).some(l => l.type === "tax")).toBe(false);
    expect(out.periods.map(p => amount(p.statements.income))).toEqual(["1000", "1000"]);
    for (const tx of txs) {
      const debit = tx.legs.filter(l => l.posting === "debit").reduce((m, l) => m.plus(l.amount), money("0"));
      const credit = tx.legs.filter(l => l.posting === "credit").reduce((m, l) => m.plus(l.amount), money("0"));
      expect(debit.equals(credit)).toBe(true);
    }
    expect(out.outputCapabilities?.helocFutureServicing?.status).toBe("incomplete");
    expect(out.outputCapabilities?.helocTax?.status).toBe("incomplete");
  });

  it("carries only actually posted principal into the second installment and settles each original once", () => {
    const s = jointHeloc(), out = s.run();
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(3);
    expect(out.periods.map(p => amount(p.cash))).toEqual(["2200", "3094.9", "3190.76"]);
    expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("2890.76");
    expect(amount(out.state.liabilities[ids.heloc]!.balance)).toBe("800");
    expect(out.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    expect(out.periods.flatMap(p => p.transactions).filter(t => t.type === "heloc_interest")
      .map(t => amount(t.legs[0]!.amount))).toEqual(["5.1", "4.14"]);
    const q = qualifyHelocServicingSource(s.pairs[1]!.issuer.sourceId, s.context);
    expect(q.status).toBe("qualified");
    if (q.status !== "qualified") throw new Error(q.reason);
    const h = q.document.request.checkpoint.history.find(h => h.kind === "principal_repayment")!;
    expect(out.state.d2PostedTransactions![accountingTransactionId(h.postingId)]!.transaction.id).toBe(h.postingId);
    expect(q.receipt.openingPrincipal.equals(money("900"))).toBe(true);
    const state = createAuthoritativeState(out.state);
    requalifyD2SettlementReceiptHistory(state, s.context);
    const before = canonicalSerialize(state);
    const receipts = Object.values(state.d2SettlementReceipts!);
    expect(receipts).toHaveLength(4); // card, FSA, two HELOC occurrences
    for (const r of receipts) expect(applyD2SettlementAtomically(state, r, s.context).status).toBe("already_committed");
    expect(canonicalSerialize(state)).toBe(before);
    const proofs = Object.values(state.d2PostedTransactions!);
    expect(new Set(proofs.map(p => p.transaction.id)).size).toBe(proofs.length);
    // Cross-domain source, operation and approval identity uniqueness. Journal
    // recognition aliases intentionally remain in their own identity namespace.
    const sources = [...receipts.map(r => r.source.sourceId), ...Object.values(state.retirementDistributionAllocations!).map(r => r.source.sourceId)];
    expect(new Set(sources).size).toBe(sources.length);
    for (const key of ["operationId", "authorizationId"] as const) {
      const values = receipts.map(r => r[key]);
      expect(new Set(values).size).toBe(values.length);
    }
    for (const p of s.pairs) {
      const q = qualifyHelocServicingSource(p.issuer.sourceId, s.context);
      if (q.status !== "qualified") throw new Error(q.reason);
      expect(state.d2PostedTransactions![q.receipt.originalTransaction.id]!.transaction).toEqual(q.receipt.originalTransaction);
      expect(state.d2PostedTransactions![q.receipt.paymentTransaction.id]!.transaction).toEqual(q.receipt.paymentTransaction);
    }
  });

  it.each([false, true])("rolls back all February effects for actual auto/HELOC BANK contention (reversed=%s)", reversed => {
    const january = jointHeloc({ months: 1, payments: 1 }).run(), s = jointHeloc({ payments: 1 });
    // Independently dated installment due at the actual auto/premium instant.
    const p = mapFacts(s.pairs[0]!, new Map([["2026-02-01", "2026-02-15"]]));
    publish([{ ...p, issuer: withProvenance(p.issuer), bank: { ...p.bank, bankCashBefore: money("2900") } }]);
    expect(qualifyHelocServicingSource(p.issuer.sourceId, s.context).status).toBe("qualified");
    const participants = [...s.kernel.executable.participants!];
    const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(s.kernel, { participants: reversed ? participants.reverse() : participants }),
      runContext: s.context, resultTier: "detail" });
    expect(out.status).toBe("incomplete");
    expect(out.diagnostics.map(d => d.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
    expect(out.periods).toHaveLength(1);
    expect(out.state).toEqual(january.state); expect(out.primitiveState).toEqual(january.primitiveState);
    expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("1900");
    expect(Object.values(out.state.d2SettlementReceipts ?? {}).some(r => r.kind === "heloc_phase_service")).toBe(false);
  });

  it("rejects one-cent insufficient actual BANK at the production participant boundary", () => {
    const s = jointHeloc({ months: 2, payments: 1 }), p = s.pairs[0]!;
    publish([{ ...p, bank: { ...p.bank, bankCashBefore: money("105.09") } }]);
    // Narrow negative isolates real HELOC funding on the same owned BANK and
    // draw-qualified state, without earlier wage/RMD confirmations masking it.
    const opening = createAuthoritativeState({ ...s.opening, accounts: { ...s.opening.accounts,
      [ids.bank]: { ...s.opening.accounts[ids.bank]!, cash: money("105.09") } } });
    const base = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
      executionMonths: 2, scenarioIdentity: s.context.scenarioId, scenarioBindings: { source: "#149 S8-4 cent-short boundary" } }, s.context.simulationStart);
    const out = runHouseholdKernel({ kernel: attachHelocServicing(base, { sourceIds: [p.issuer.sourceId] }), runContext: s.context, resultTier: "detail" });
    expect(out.periods).toHaveLength(1); expect(out.state).toEqual(opening);
    expect(out.status).toBe("incomplete"); expect(out.diagnostics.some(d => d.severity === "error")).toBe(true);
    expect(amount(out.state.accounts[ids.bank]!.cash)).toBe("105.09");
    expect(out.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    expect(out.state.d2SettlementReceipts).toBeUndefined();
  });

  it.each(["scheduled", "changed_amount", "missing_approval", "unposted_history", "draw_receipt"])("fails closed on %s", mode => {
    const s = jointHeloc({ service: mode !== "unposted_history" }), p = s.pairs[0]!;
    if (mode === "scheduled") debits.set(p.bank.id, { ...p.bank, status: "scheduled" });
    if (mode === "changed_amount") debits.set(p.bank.id, { ...p.bank, amount: money("105.09") });
    if (mode === "missing_approval") debits.set(p.bank.id, { ...p.bank, approvalId: "" });
    if (mode === "unposted_history") {
      // Configure only installment two: its issuer history is internally valid,
      // but the claimed first repayment was never posted in the joint archive.
      const kernel = attachHelocServicing(s.base, { sourceIds: [s.pairs[1]!.issuer.sourceId] });
      const out = runHouseholdKernel({ kernel, runContext: s.context, resultTier: "detail" });
      expect(out.periods).toHaveLength(2);
      expect(amount(out.state.liabilities[ids.heloc]!.balance)).toBe("1000");
      expect(out.diagnostics.some(d => d.message.includes("history") || d.message.includes("principal"))).toBe(true);
      return;
    }
    if (mode === "draw_receipt") {
      const opening = createAuthoritativeState({ ...s.opening, identities: { ...s.opening.identities,
        externalIdempotencyKeys: s.opening.identities.externalIdempotencyKeys.filter(k => !k.includes("d2:heloc-draw-receipt")) } });
      const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(s.kernel, { reconciledOpeningState: opening }), runContext: s.context, resultTier: "detail" });
      expect(out.periods).toHaveLength(1);
      expect(out.diagnostics.some(d => d.message.includes("Draw has no exact canonical"))).toBe(true);
      expect(amount(out.state.liabilities[ids.heloc]!.balance)).toBe("1000");
      return;
    }
    expect(qualifyHelocServicingSource(p.issuer.sourceId, s.context).status).toBe("incomplete");
    const out = s.run();
    expect(out.periods).toEqual([]); expect(out.state).toEqual(s.opening);
    expect(archive.size).toBe(2);
  });
});
