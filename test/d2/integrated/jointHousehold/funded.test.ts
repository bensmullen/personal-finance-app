import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { ValidationError } from "../../../../src/diagnostics/index.js";
import { createAuthoritativeState, cloneAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { Money, money, USD } from "../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { attachFundedRetirementCashSchedule, attachRetirementCash } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { qualifyRetirementRawSource } from "../../../../src/simulation/d2/integration/retirementCash/source.js";
import { evaluateFsa } from "../../../../src/simulation/d2/health/fsa/index.js";
import { propose529RothTransfers } from "../../../../src/simulation/d2/education/529/rothTransfer/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { ids, publishers } from "./combinedScenario.js";
import { fundedHousehold, resetSources, sources } from "./fundedScenario.js";
import { conditional529 } from "./funded529Scenario.js";

beforeEach(resetSources);
const amount = (m: Money) => m.amount.toString();
const archiveIds = ["card-charge-january", "card-payment-february", "fsa-cash:s8-medical-source:original",
  "fsa-cash:s8-medical-source:deposit", "withdraw:s8-3:first", "withdraw:s8-3:second"].sort();

describe("#149 S8-3 funded account-scoped RMD in the real joint household", () => {
  it.each([false, true])("reconciles literal financial oracles and exact canonical postings (reversed=%s)", reversed => {
    const s = fundedHousehold(), before = canonicalSerialize(s.opening);
    const participants = [...s.kernel.executable.participants!];
    const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(s.kernel,
      { participants: reversed ? participants.reverse() : participants }), runContext: s.context, resultTier: "detail" });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(2);
    expect(out.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(out.status).toBe("incomplete");
    expect(out.periods.map(p => Object.fromEntries(Object.entries(p.statements).map(([k, v]) => [k, amount(v)]))))
      .toEqual([
        { assets: "2200", liabilities: "5570", netWorth: "-3370", income: "1000", expenses: "1370", gains: "0",
          operatingCashFlow: "-350", investingCashFlow: "0", financingCashFlow: "-450" },
        { assets: "3200", liabilities: "4915.5", netWorth: "-1715.5", income: "1000", expenses: "-654.5", gains: "0",
          operatingCashFlow: "1454.5", investingCashFlow: "0", financingCashFlow: "-454.5" },
      ]);
    expect(out.periods.map(p => amount(p.cash))).toEqual(["2200", "3200"]);
    expect(out.periods.map(p => p.transactions.length)).toEqual([11, 9]);
    expect([amount(out.state.accounts[ids.bank]!.cash), amount(out.state.accounts[ids.retirement]!.cash),
      amount(out.state.liabilities[ids.principal]!.balance), amount(out.state.liabilities[ids.card]!.balance)])
      .toEqual(["2900", "300", "4095.5", "820"]);
    expect(out.state.liabilities[ids.payable]!.balance.isZero()).toBe(true);
    expect(out.state.liabilities[ids.interest]!.balance.isZero()).toBe(true);
    expect(Object.keys(out.state.accounts).sort()).toEqual([ids.bank, ids.retirement].sort());
    expect(out.state.positions).toEqual({});
    const eligibility = evaluateFsa(publishers.fsa("s8-medical-source")!.request);
    expect(eligibility.netWorthTreatment).toBe("excluded_restricted_entitlement");
    expect(amount(eligibility.entitlement!.remaining)).toBe("1000");
    expect(amount(eligibility.entitlement!.employeePayrollToDate)).toBe("0");
    const transactions = out.periods.flatMap(p => p.transactions);
    let bank = money("2000");
    const datedBank = new Map<string, Money>();
    for (const t of transactions) for (const leg of t.legs) if (leg.type === "cash" && leg.accountId === ids.bank) {
      bank = leg.posting === "debit" ? bank.plus(leg.amount) : bank.minus(leg.amount);
      datedBank.set(t.date, bank);
    }
    expect([...datedBank].map(([date, balance]) => [date, amount(balance)])).toEqual([
      ["2026-01-05T00:00:00.000Z", "3000"], ["2026-01-10T12:00:00.000Z", "2000"],
      ["2026-01-15T00:00:00.000Z", "1200"], ["2026-01-22T00:00:00.000Z", "1700"],
      ["2026-01-23T00:00:00.000Z", "1900"], ["2026-02-05T00:00:00.000Z", "2900"],
      ["2026-02-15T00:00:00.000Z", "2100"], ["2026-02-15T17:00:00.000Z", "1900"],
      ["2026-02-16T12:00:00.000Z", "2900"],
    ]);
    expect(out.periods.map(p => [amount(p.liability!.liabilities[0]!.currentInterest),
      amount(p.liability!.liabilities[0]!.scheduledPrincipalPaid), amount(p.liability!.liabilities[0]!.endingPrincipal)]))
      .toEqual([["50", "394.24", "4550"], ["45.5", "398.74", "4095.5"]]);
    expect(new Set(transactions.map(t => t.id)).size).toBe(20);
    expect(out.state.identities.postedTransactionIds).toHaveLength(20);
    expect(Object.keys(out.state.d2PostedTransactions!).sort()).toEqual(archiveIds);
    for (const id of archiveIds) {
      const proof = out.state.d2PostedTransactions![accountingTransactionId(id)]!;
      expect(proof.writer).toBe("applyAccountingTransactionAtomically/v1");
      expect(proof.transaction).toEqual(transactions.find(t => t.id === id));
      expect(out.state.identities.postedTransactionIds).toContain(id);
    }
    expect(Object.keys(out.state.d2SettlementReceipts!).sort()).toEqual([
      "card-bank:payment-february", "fsa-cash:s8-medical-source:receipt"].sort());
    const transfers = transactions.filter(t => t.type === "retirement_cash_transfer");
    expect(transfers.map(t => [t.id, t.date, ...t.legs.map(l => [l.type, l.posting, amount(l.amount), l.type === "cash" ? l.accountId : null])]))
      .toEqual([
        ["withdraw:s8-3:first", "2026-01-22T00:00:00.000Z", ["cash", "debit", "500", ids.bank], ["cash", "credit", "500", ids.retirement]],
        ["withdraw:s8-3:second", "2026-01-23T00:00:00.000Z", ["cash", "debit", "200", ids.bank], ["cash", "credit", "200", ids.retirement]],
      ]);
    expect(transactions.filter(t => t.type === "income").map(t => amount(t.legs[0]!.amount))).toEqual(["1000", "1000"]);
    expect(transactions.filter(t => t.type === "issuer_card_charge").map(t => amount(t.legs[0]!.amount))).toEqual(["20"]);
    expect(transactions.filter(t => t.type === "fsa_medical_expense_payment").map(t => amount(t.legs[0]!.amount))).toEqual(["1000"]);
    expect(transactions.flatMap(t => t.legs).filter(l => l.type === "tax")).toEqual([]);
    for (const t of transactions) {
      const sum = (side: "debit" | "credit") => t.legs.filter(l => l.posting === side).reduce((m, l) => m.plus(l.amount), Money.zero(USD));
      expect(sum("debit").equals(sum("credit"))).toBe(true);
    }
    const journal = Object.values(out.state.retirementDistributionAllocations!);
    expect(journal.map(d => [d.operationId, d.withdrawalId, d.authorizationId, d.source.sourceId, d.rmdSatisfaction, d.tax,
      ...d.allocations.map(a => [a.allocationId, a.approvalId, a.satisfiesRmdYear, amount(a.amount)])]))
      .toEqual([
        ["withdraw:s8-3:first", "distribution:s8-3:first", "authorize:s8-3:first", "s8-3:publisher:first", "not_applied", "incomplete",
          ["s8-3:allocation:first", "s8-3:approval:first", 2026, "500"]],
        ["withdraw:s8-3:second", "distribution:s8-3:second", "authorize:s8-3:second", "s8-3:publisher:second", "not_applied", "incomplete",
          ["s8-3:allocation:second", "s8-3:approval:second", 2026, "200"]],
      ]);
    for (const raw of s.raw) {
      const q = qualifyRetirementRawSource(raw, raw.cash.withdrawals.requests[0]!.operationId, s.context);
      expect(q.status).toBe("qualified");
      if (q.status !== "qualified") throw new Error("Independent publisher must qualify");
      expect(out.state.retirementDistributionAllocations![q.distribution.transactionId]).toEqual(q.distribution);
      expect(q.distribution.traceIds).toContain(raw.cash.confirmations[0]!.source.id);
      expect(q.distribution.traceIds).toContain(raw.binding.allocations[0]!.approval!.source.id);
    }
    const rmd = s.satisfaction(out.state);
    expect(rmd.coverage).toBe("complete");
    expect(rmd.annual!.obligations.map(o => [amount(o.required), amount(o.satisfied), amount(o.remaining)]))
      .toEqual([["700", "700", "0"]]);
    for (const [key, status] of Object.entries({ retirementCashTransfer: "complete", rmdSatisfaction: "complete", retirementTax: "incomplete",
      fsaCashSettlement: "complete", fsaPayrollTax: "incomplete", cardFutureCycles: "incomplete", cash: "incomplete", netWorth: "incomplete" }))
      expect(out.outputCapabilities?.[key]?.status, key).toBe(status);
    expect(new Set(out.diagnostics.filter(d => d.code === "RETIREMENT_TAX_INCOMPLETE").map(d => d.message)).size).toBe(1);
    expect(canonicalSerialize(s.opening)).toBe(before);
    expect(s.run().state).toEqual(out.state);
  });

  it("credits genuine 500 funding against 700 and leaves exactly 200", () => {
    const s = fundedHousehold({ second: false }), out = s.run();
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(2);
    expect([amount(out.state.accounts[ids.bank]!.cash), amount(out.state.accounts[ids.retirement]!.cash)]).toEqual(["2700", "500"]);
    expect(s.satisfaction(out.state).annual!.obligations.map(o => [amount(o.required), amount(o.satisfied), amount(o.remaining)]))
      .toEqual([["700", "500", "200"]]);
    expect(out.periods.map(p => amount(p.netWorth))).toEqual(["-3370", "-1715.5"]);
  });

  it("keeps B3-2 conditional eligibility uncommitted alongside the funded household", () => {
    const s = fundedHousehold(), request = conditional529(), rawBefore = canonicalSerialize(request), out = s.run();
    expect(out.periods).toHaveLength(2);
    const stateBefore = canonicalSerialize(out.state), result = propose529RothTransfers([request]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ committed: false, postable: false, physicalTransfer: "not_applied" });
    expect([amount(result.proposals[0]!.grossAmount), amount(result.proposals[0]!.eligibleAmount),
      amount(result.proposals[0]!.availableAnnualRoom)]).toEqual(["200", "1000", "500"]);
    expect(result.coverage.filter(c => c.coverage === "complete").map(c => c.affectedOutput))
      .toEqual(["eligibility", "basis_earnings", "annual_capacity", "lifetime_capacity"]);
    expect(result.coverage.filter(c => ["funding", "settlement", "federal_tax", "state_tax", "local_tax"].includes(c.affectedOutput))
      .every(c => c.coverage === "incomplete")).toBe(true);
    expect(request.plan.snapshot.currentValue!.equals(money("1000"))).toBe(true);
    expect(request.plan.snapshot.contributionBasis!.equals(money("800"))).toBe(true);
    expect(request.annualCapacity.used.equals(money("0"))).toBe(true);
    expect(request.compensationCapacity.used.equals(money("0"))).toBe(true);
    expect(canonicalSerialize(request)).toBe(rawBefore); expect(canonicalSerialize(out.state)).toBe(stateBefore);
    expect(Object.keys(out.state.accounts).sort()).toEqual([ids.bank, ids.retirement].sort());
    expect(out.periods.flatMap(p => p.transactions).some(t => t.id === request.operationId)).toBe(false);
    expect(out.state.identities.externalIdempotencyKeys.some(k => k.includes(request.operationId))).toBe(false);
  });

  it.each(["missing", "changed", "stale_rmd", "stale_history", "duplicate_withdrawal", "overallocated", "wrong_owner", "wrong_account"])(
    "rejects %s at admission or before committing January in both participant orders", mode => {
      const s = fundedHousehold(), p = s.raw[0]!, row = p.binding.allocations[0]!;
      let bad = p;
      if (mode === "missing") sources.delete(p.sourceId);
      if (mode === "changed") bad = { ...p, sourceVersion: "withdrawn-v2" };
      if (mode === "stale_rmd") bad = { ...p, binding: { ...p.binding, rmd: { ...p.binding.rmd, requests: p.binding.rmd.requests.map(r => ({ ...r,
        accounts: r.accounts.map(a => ({ ...a, priorValue: { ...a.priorValue!, at: civilDate("2024-12-31") } })) })) } } };
      if (mode === "stale_history") bad = { ...p, priorOperationIds: ["unpublished-prior-withdrawal"] };
      if (mode === "duplicate_withdrawal") bad = { ...p, cash: { ...p.cash, withdrawals: { ...p.cash.withdrawals,
        requests: [...p.cash.withdrawals.requests, p.cash.withdrawals.requests[0]!] } } };
      if (mode === "overallocated") {
        const { approval: _approval, ...terms } = { ...row, amount: money("500.01") };
        bad = { ...p, binding: { ...p.binding, allocations: [{ ...terms, approval: { ...row.approval!, terms } }] } };
      }
      if (mode === "wrong_owner" || mode === "wrong_account") bad = { ...p, binding: { ...p.binding, allocations: [
        { ...row, ...(mode === "wrong_owner" ? { personId: ids.other } : { sourceAccountId: ids.bank }) }] } };
      if (mode !== "missing") sources.set(p.sourceId, bad);
      if (mode === "duplicate_withdrawal") {
        // This invariant is rejected at immutable participant construction,
        // before either participant ordering or any household period exists.
        // Never weaken J2's construction guard to obtain a runtime diagnostic.
        const before = canonicalSerialize(s.opening);
        expect(() => attachFundedRetirementCashSchedule(s.baseKernel, { ...s.schedule,
          plans: [{ ...bad.cash, fundedRmd: s.schedule.plans[0]!.fundedRmd }, s.schedule.plans[1]!] }))
          .toThrow("Distinct source-qualified dated plans and a common full horizon are required");
        expect(canonicalSerialize(s.opening)).toBe(before);
        return;
      }
      const kernel = s.kernel;
      for (const reversed of [false, true]) {
        const participants = [...kernel.executable.participants!];
        const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(kernel, { participants: reversed ? participants.reverse() : participants }),
          runContext: s.context, resultTier: "detail" });
        expect(out.periods, mode).toEqual([]); expect(out.state).toEqual(s.opening);
        expect(out.state.d2PostedTransactions).toBeUndefined();
        expect(out.state.retirementDistributionAllocations).toBeUndefined();
        expect(out.diagnostics.some(d => d.severity === "error")).toBe(true);
      }
    });

  it.each(["withdrawn", "amended"])("preserves historical cash when raw publisher is %s", mode => {
    const s = fundedHousehold(), out = s.run(), before = canonicalSerialize(out.state), p = s.raw[0]!;
    expect(out.periods).toHaveLength(2);
    if (mode === "withdrawn") sources.delete(p.sourceId);
    else sources.set(p.sourceId, { ...p, binding: { ...p.binding, allocations: [] } });
    const rmd = s.satisfaction(out.state);
    expect(rmd.coverage).toBe("incomplete");
    expect(rmd.annual!.obligations.map(o => amount(o.satisfied))).toEqual(["0"]);
    expect([amount(out.state.accounts[ids.bank]!.cash), amount(out.state.accounts[ids.retirement]!.cash)]).toEqual(["2900", "300"]);
    expect(canonicalSerialize(out.state)).toBe(before);
  });

  it("rejects forged canonical proof and allocation archives independently of checksums", () => {
    const s = fundedHousehold(), out = s.run(), state = cloneAuthoritativeState(out.state);
    expect(out.periods).toHaveLength(2);
    expect(() => createAuthoritativeState({ ...state, d2PostedTransactions: {} })).toThrow();
    const proof = state.d2PostedTransactions![accountingTransactionId("withdraw:s8-3:first")]!;
    expect(() => createAuthoritativeState({ ...state, d2PostedTransactions: { ...state.d2PostedTransactions,
      [proof.transaction.id]: { ...proof, registration: { ...proof.registration, role: "settlement" as const } } } })).toThrow();
    const omitted = createAuthoritativeState({ accounts: state.accounts, liabilities: state.liabilities });
    expect(s.satisfaction(omitted).coverage).toBe("incomplete");
    expect(s.satisfaction(omitted).annual!.obligations.map(o => amount(o.remaining))).toEqual(["700"]);
  });

  it("never upgrades a legacy physical transfer into funded RMD credit", () => {
    const s = fundedHousehold({ second: false, months: 1 });
    const { fundedRmd: _reference, ...cash } = s.schedule.plans[0]!;
    const legacy = runHouseholdKernel({ kernel: attachRetirementCash(s.baseKernel, cash).kernel, runContext: s.context, resultTier: "detail" });
    expect(legacy.periods, JSON.stringify(legacy.diagnostics)).toHaveLength(1);
    expect(amount(legacy.state.accounts[ids.bank]!.cash)).toBe("1700");
    expect(legacy.state.retirementDistributionAllocations).toBeUndefined();
    expect(s.satisfaction(legacy.state).coverage).toBe("incomplete");
    expect(s.satisfaction(legacy.state).annual!.obligations.map(o => amount(o.satisfied))).toEqual(["0"]);
    // Isolate the real funded participant's admission against that committed
    // joint archive, so an earlier FSA/issuer check cannot mask the J2 failure.
    expect(() => s.kernel.executable.participants!.find(p => p.id === "d2_retirement_cash")!.prepare(s.context,
      legacy.periods[0]!.period, { state: legacy.state, primitiveState: legacy.primitiveState }, [], "detail")).toThrow();
    expect(amount(legacy.state.accounts[ids.bank]!.cash)).toBe("1700");
  });

  it.each([false, true])("rejects independent real VS2 BANK contention (reversed=%s)", reversed => {
    const s = fundedHousehold(), payday = instant("2026-01-22T00:00:00.000Z");
    const participants = [...s.kernel.executable.participants!];
    const kernel = applyHouseholdExecutionOverlay(s.kernel, { participants: reversed ? participants.reverse() : participants,
      cashFlowInput: { ...s.kernel.cash!.input, incomes: s.kernel.cash!.input.incomes.map(w => ({ ...w, start: payday,
        recurrence: { kind: "utc_monthly" as const, anchor: payday, invalidDayPolicy: "skip" as const } })) } });
    const out = runHouseholdKernel({ kernel, runContext: s.context, resultTier: "detail" });
    expect(out.periods).toEqual([]); expect(out.state).toEqual(s.opening);
    expect(out.diagnostics.map(d => d.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
  });

  it("rolls back the first transfer and every other January effect if the second confirmation is stale", () => {
    const s = fundedHousehold(), p = s.raw[1]!;
    const cash = { ...p.cash, confirmations: p.cash.confirmations.map(q => ({ ...q, bankCashBefore: money("1700.01") })) };
    sources.set(p.sourceId, { ...p, cash });
    const plans = [s.schedule.plans[0]!, { ...cash, fundedRmd: s.schedule.plans[1]!.fundedRmd }];
    const kernel = attachFundedRetirementCashSchedule(s.baseKernel, { ...s.schedule, plans });
    const out = runHouseholdKernel({ kernel, runContext: s.context, resultTier: "detail" });
    expect(out.periods).toEqual([]); expect(out.state).toEqual(s.opening);
    expect(out.diagnostics.map(d => d.code)).toContain("RETIREMENT_STALE_BALANCE");
  });

  it.each([false, true])("rejects actual funding one cent above the annual RMD allocation cap (reversed=%s)", reversed => {
    const s = fundedHousehold(), p = s.raw[1]!, row = p.binding.allocations[0]!;
    const withdrawals = { ...p.cash.withdrawals, requests: p.cash.withdrawals.requests.map(r => ({ ...r,
      grossAmount: money("200.01"), authorization: { ...r.authorization!, grossAmount: money("200.01") } })) };
    const cash = { ...p.cash, withdrawals };
    const { approval: _approval, ...terms } = { ...row, amount: money("200.01") };
    const raw = { ...p, cash, binding: { ...p.binding, withdrawals,
      allocations: [{ ...terms, approval: { ...row.approval!, terms } }] } };
    sources.set(p.sourceId, raw);
    const attached = attachFundedRetirementCashSchedule(s.baseKernel, { ...s.schedule,
      plans: [s.schedule.plans[0]!, { ...cash, fundedRmd: s.schedule.plans[1]!.fundedRmd }] });
    const participants = [...attached.executable.participants!];
    const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(attached, { participants: reversed ? participants.reverse() : participants }),
      runContext: s.context, resultTier: "detail" });
    expect(out.periods).toEqual([]); expect(out.state).toEqual(s.opening);
    expect(out.diagnostics.map(d => d.code)).toContain("RETIREMENT_RMD_OVERALLOCATED");
  });

  it("preserves funded January when a late February failure rolls back all February participants", () => {
    const jan = fundedHousehold({ months: 1 }).run(), s = fundedHousehold();
    expect(jan.periods).toHaveLength(1);
    const failure: HouseholdKernelParticipant = { id: "s8-3:late-failure", version: "1", economicInputs: {},
      prepare: (_context, period) => ({ id: "s8-3:late-failure", operations: period.start !== instant("2026-02-01T00:00:00.000Z") ? [] : [{
        descriptor: { id: "s8-3:after-settlements", domain: "synthetic", sequencingInstant: instant("2026-02-28T00:00:00.000Z"),
          dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: () => { throw new ValidationError({ severity: "error", code: "S8_3_LATE_FAILURE", entityType: "test", message: "Synthetic February failure" }); },
      }] }) };
    for (const participants of [[...s.kernel.executable.participants!, failure], [failure, ...s.kernel.executable.participants!].reverse()]) {
      const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(s.kernel, { participants }), runContext: s.context, resultTier: "detail" });
      expect(out.periods).toHaveLength(1); expect(out.state).toEqual(jan.state); expect(out.primitiveState).toEqual(jan.primitiveState);
      expect(out.diagnostics.map(d => d.code)).toContain("S8_3_LATE_FAILURE");
      expect([amount(out.state.accounts[ids.bank]!.cash), amount(out.state.accounts[ids.retirement]!.cash)]).toEqual(["1900", "300"]);
    }
  });

  it("pays a true first-year deferred 2026 obligation in 2027 with separately approved 2027 allocation", () => {
    const s = fundedHousehold({ months: 16, deferred: true }), out = s.run();
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(16);
    expect(out.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const txs = out.periods.flatMap(p => p.transactions).filter(t => t.type === "retirement_cash_transfer");
    expect(txs.map(t => [t.id, t.date, amount(t.legs[0]!.amount)]))
      .toEqual([["withdraw:s8-3:deferred", "2027-04-01T00:00:00.000Z", "500"]]);
    expect(out.periods.slice(0, 12).flatMap(p => p.transactions).some(t => t.type === "retirement_cash_transfer")).toBe(false);
    expect(out.periods.slice(0, 12).map(p => amount(p.statements.income))).toEqual(Array(12).fill("1000"));
    expect([amount(out.state.accounts[ids.bank]!.cash), amount(out.state.accounts[ids.retirement]!.cash)]).toEqual(["9405.07", "500"]);
    const record = Object.values(out.state.retirementDistributionAllocations!)[0]!;
    expect(record.taxYear).toBe(2027); expect(record.tax).toBe("incomplete");
    expect([...record.allocations].sort((a, b) => a.satisfiesRmdYear - b.satisfiesRmdYear)
      .map(a => [a.satisfiesRmdYear, a.firstYear, a.deferred, amount(a.amount)]))
      .toEqual([[2026, true, true, "300"], [2027, false, false, "200"]]);
    expect(new Set(record.allocations.map(a => a.approvalId)).size).toBe(2);
    expect(record.allocations.reduce((m, a) => m.plus(a.amount), money("0")).equals(record.gross)).toBe(true);
    expect(s.satisfaction(out.state).annual!.obligations.map(o => [o.taxYear, amount(o.required), amount(o.satisfied), amount(o.remaining)]))
      .toEqual([[2026, "700", "300", "400"], [2027, "700", "200", "500"]]);
    const deferred = s.satisfaction(out.state).annual!.obligations.find(o => o.taxYear === 2026)!;
    expect([amount(deferred.satisfiedOnTime), amount(deferred.satisfiedLate), amount(deferred.deadlineShortfall)])
      .toEqual(["300", "0", "400"]);
    expect(out.outputCapabilities?.retirementTax?.status).toBe("incomplete");
  });

  it("caps the two approved RMD-year allocations at the one real 2027 withdrawal", () => {
    const s = fundedHousehold({ months: 16, deferred: true }), p = s.raw[0]!;
    const allocations = p.binding.allocations.map(a => {
      if (a.taxYear !== 2027) return a;
      const { approval: _approval, ...terms } = { ...a, amount: money("200.01") };
      return { ...terms, approval: { ...a.approval!, terms } };
    });
    sources.set(p.sourceId, { ...p, binding: { ...p.binding, allocations } });
    for (const reversed of [false, true]) {
      const participants = [...s.kernel.executable.participants!];
      const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(s.kernel, { participants: reversed ? participants.reverse() : participants }),
        runContext: s.context, resultTier: "detail" });
      expect(out.periods).toHaveLength(15);
      expect(out.diagnostics.some(d => d.severity === "error")).toBe(true);
      expect([amount(out.state.accounts[ids.bank]!.cash), amount(out.state.accounts[ids.retirement]!.cash)])
        .toEqual(["7905.07", "1000"]);
      expect(out.state.retirementDistributionAllocations).toBeUndefined();
    }
  });
});
