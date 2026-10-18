import { describe, expect, it } from "vitest";
import type { AccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { money, Money, USD } from "../../../../src/values/index.js";
import { instant } from "../../../../src/time/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { applyHouseholdExecutionOverlay, exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { attachAftertaxPremiums, type PremiumRepresentation } from "../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { anchor, scenario, source, trace } from "./scenario.js";

const rows = (transactions: readonly AccountingTransaction[]) => transactions.map(t => ({
  type: t.type, legs: t.legs.map(l => [l.posting, l.type, l.amount.amount.toString(),
    l.type === "cash" ? l.accountId : l.type === "liability" ? l.entityId : "statement"]),
})).sort((a, b) => a.type.localeCompare(b.type));

describe("#149 S8-1 real joint household execution", () => {
  it("posts the independent $2200 cash / $4550 loan / +$650 net-worth oracle", () => {
    const s = scenario();
    const snapshot = () => canonicalSerialize({ opening: s.opening, request: s.input.request,
      confirmed: s.input.confirmed, kernel: s.attached.kernel.canonicalInputs });
    const before = snapshot();
    expect(s.attached.diagnostics).toEqual([]);
    expect(s.attached.admittedOperationIds).toHaveLength(1);
    const result = s.run();
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods).toHaveLength(1);
    const p = result.periods[0]!;
    const { bank, payable, principal, interest, wage, loan } = s.ids;
    const expected = [
      { type: "income", legs: [["debit", "cash", "1000", bank], ["credit", "income", "1000", "statement"]] },
      { type: "expense_recognition", legs: [["debit", "expense", "300", "statement"], ["credit", "liability", "300", payable]] },
      { type: "expense_settlement", legs: [["debit", "liability", "300", payable], ["credit", "cash", "300", bank]] },
      { type: "auto_loan_interest_recognition", legs: [["debit", "expense", "50", "statement"], ["credit", "liability", "50", interest]] },
      { type: "auto_loan_interest_settlement", legs: [["debit", "liability", "50", interest], ["credit", "cash", "50", bank]] },
      { type: "auto_loan_principal_payment", legs: [["debit", "liability", "394.24", principal], ["credit", "cash", "394.24", bank]] },
      { type: "auto_loan_extra_principal", legs: [["debit", "liability", "55.76", principal], ["credit", "cash", "55.76", bank]] },
    ].sort((a, b) => a.type.localeCompare(b.type));
    expect(rows(p.transactions)).toEqual(expected);
    for (const tx of p.transactions) {
      const sum = (side: "debit" | "credit") => tx.legs.filter(l => l.posting === side)
        .reduce((total, l) => total.plus(l.amount), Money.zero(USD));
      expect(sum("debit").equals(sum("credit"))).toBe(true);
      expect(tx.legs.every(l => l.amount.currency.equals(USD))).toBe(true);
    }
    expect(p.cash.equals(money("2200"))).toBe(true);
    expect(result.state.liabilities[principal]!.balance.equals(money("4550"))).toBe(true);
    expect(result.state.liabilities[interest]!.balance.isZero()).toBe(true);
    expect(result.state.liabilities[payable]!.balance.isZero()).toBe(true);
    expect(p.netWorth.minus(money("-3000")).equals(money("650"))).toBe(true);
    expect(Object.fromEntries(Object.entries(p.statements).map(([k, v]) => [k, v.amount.toString()]))).toEqual({
      assets: "2200", liabilities: "4550", netWorth: "-2350", income: "1000", expenses: "350", gains: "0",
      operatingCashFlow: "650", investingCashFlow: "0", financingCashFlow: "-450",
    });
    expect(p.cashFlow!.recurringIncomeRecognized.equals(money("1000"))).toBe(true);
    expect(p.cashFlow!.recurringExpenseRecognized.equals(money("300"))).toBe(true);
    expect(p.cashFlow!.expenseCashSettlement.equals(money("300"))).toBe(true);
    expect(p.cashFlow!.outstandingExpenseObligations.isZero()).toBe(true);
    const debt = p.liability!.liabilities[0]!;
    expect(debt.contractualPayment.equals(money("444.24"))).toBe(true);
    expect(debt.currentInterest.equals(money("50"))).toBe(true);
    expect(debt.scheduledPrincipalPaid.equals(money("394.24"))).toBe(true);
    expect(p.liquidityShortfalls).toEqual([]);
    expect(p.constraintOutcomes.every(o => o.status === "fully_satisfied")).toBe(true);

    const at = "2026-01-15T00:00:00.000Z";
    const premiumRecognition = `recognition:expense:${s.input.confirmed[0]!.expenseId}:${at}`;
    const extra = s.loan.extraPrincipalPayments![0]!;
    expect([...result.state.identities.recognitionIds].sort()).toEqual([
      `recognition:income:${wage}:2026-01-05T00:00:00.000Z`, premiumRecognition,
      `recognition:auto_loan-interest:${loan}:${at}`, `recognition:auto_loan-principal-due:${loan}:${at}`,
      `recognition:extra-principal-option:${extra.id}:${at}`,
    ].sort());
    const claims = [
      `obligation:${premiumRecognition}`, `obligation:auto_loan-interest:${loan}:${at}`,
      `obligation:auto_loan-principal:${loan}:${at}`, `right:extra-principal:${extra.id}:${at}`,
    ];
    expect(Object.keys(result.state.obligations).sort()).toEqual([...claims].sort());
    expect([...result.state.identities.settlementIds].sort()).toEqual([
      `settlement:${claims[0]}`, `settlement:${claims[1]}:${at}`, `settlement:${claims[2]}:${at}`, `settlement:${claims[3]}`,
    ].sort());
    for (const claim of Object.values(result.state.obligations)) {
      expect(claim.outstandingAmount.isZero()).toBe(true);
      expect(result.state.identities.recognitionIds).toContain(claim.originatingRecognitionId);
    }
    const premiumClaim = result.state.obligations[claims[0]!]!;
    expect(premiumClaim.traceRefs?.some(r => r.traceId === s.coverage.quote.quoteId)).toBe(true);
    expect(Object.keys(result.state.accounts)).toEqual([bank]);
    expect(result.state.positions).toEqual({});
    expect(p.investmentValue.isZero()).toBe(true);
    expect(p.transactions.flatMap(t => t.legs).some(l => l.type === "tax")).toBe(false);
    // No tax participant was admitted: completed is only these gross economics.
    expect(result.outputCapabilities).toBeUndefined();
    expect(snapshot()).toBe(before);
    expect(s.run()).toEqual(result);
  });

  it("carries two actual periods without repeating recognition, claims, interest or settlement", () => {
    const s = scenario({ months: 2 });
    expect(s.attached.diagnostics).toEqual([]);
    const result = s.run();
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods.map(p => [p.cash.amount.toString(), p.liabilities.amount.toString(), p.netWorth.amount.toString(), p.statements.expenses.amount.toString()]))
      .toEqual([["2200", "4550", "-2350", "350"], ["2400", "4095.5", "-1695.5", "345.5"]]);
    expect(result.periods.map(p => p.transactions.length)).toEqual([7, 7]);
    expect(result.state.identities.recognitionIds).toHaveLength(10);
    expect(result.state.identities.settlementIds).toHaveLength(8);
    expect(Object.values(result.state.obligations)).toHaveLength(8);
    expect(new Set(result.state.identities.recognitionIds).size).toBe(10);
    expect(result.state.liabilities[s.ids.interest]!.balance.isZero()).toBe(true);
    const forecast = runHouseholdKernel({ kernel: s.attached.kernel, runContext: s.context });
    const replay = replayHouseholdForecastWindow(forecast, result.periods[1]!.period);
    expect(replay.periods).toEqual([result.periods[1]]);
    expect(replay.state).toEqual(result.state);
    expect(replayHouseholdForecastWindow(forecast, result.periods[1]!.period)).toEqual(replay);
    const again = attachAftertaxPremiums({ ...s.input, kernel: s.attached.kernel });
    expect(again.diagnostics).toEqual([]);
    expect(runHouseholdKernel({ kernel: again.kernel, runContext: s.context, resultTier: "detail" })).toEqual(result);
  });

  it("resumes the first real sparse checkpoint without double claims or interest", () => {
    // The existing checkpoint cadence is twelve months; thirteen is the smallest
    // horizon that exercises checkpoint continuation rather than opening replay.
    const s = scenario({ months: 13 });
    expect(s.attached.diagnostics).toEqual([]);
    const forecast = runHouseholdKernel({ kernel: s.attached.kernel, runContext: s.context });
    expect(forecast.status, JSON.stringify(forecast.diagnostics)).toBe("completed");
    const checkpoints = exportHouseholdReplayCheckpoints(forecast);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.at).toBe(instant("2027-01-01T00:00:00.000Z"));
    const detail = s.run();
    expect(detail.status).toBe("completed");
    const window = detail.periods[12]!.period;
    const resumed = replayHouseholdForecastWindow(forecast, window);
    // Copying the public forecast drops the private WeakMap checkpoints, forcing
    // the same production replay to restart from its immutable opening instead.
    const fromOpening = replayHouseholdForecastWindow({ ...forecast }, window);
    expect(resumed).toEqual(fromOpening);
    expect(resumed.periods).toEqual([detail.periods[12]]);
    expect(resumed.state).toEqual(detail.state);
    expect(resumed.primitiveState).toEqual(detail.primitiveState);
  });

  it("leaves scarce same-period funding unresolved without inventing debt/premium precedence", () => {
    // Payday is later than service: a future $1000 cannot fund the 15th.
    const s = scenario({ cash: "400", wageDay: "20", priority: "unresolved" });
    const result = s.run();
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics.some(d => d.code === "HOUSEHOLD_CONTENTION_UNRESOLVED")).toBe(true);
    expect(result.stoppedAt).toBe(s.context.simulationStart);
    expect(result.periods).toEqual([]);
    expect(result.state).toEqual(s.opening);
    expect(result.primitiveState).toEqual({});
    expect(result.state.accounts[s.ids.bank]!.cash.equals(money("400"))).toBe(true);
    expect(result.state.liabilities[s.ids.principal]!.balance.equals(money("5000"))).toBe(true);
    expect(result.state.identities.recognitionIds).toEqual([]);
    expect(result.state.identities.settlementIds).toEqual([]);
    expect(Object.values(result.state.obligations)).toEqual([]);
    expect(s.run()).toEqual(result);
  });

  it("preserves both unpaid claims when neither payment can be funded before payday", () => {
    const s = scenario({ cash: "100", wageDay: "20", priority: "unresolved" });
    const result = s.run();
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    const p = result.periods[0]!;
    // Neither all-or-nothing payment is possible on the 15th, in either order.
    // Later wages are posted on the 20th; VS2 does not invent a second attempt.
    expect(p.cash.equals(money("1100"))).toBe(true);
    expect(result.state.liabilities[s.ids.principal]!.balance.equals(money("5000"))).toBe(true);
    expect(result.state.liabilities[s.ids.interest]!.balance.equals(money("50"))).toBe(true);
    expect(result.state.liabilities[s.ids.payable]!.balance.equals(money("300"))).toBe(true);
    expect(p.netWorth.equals(money("-4250"))).toBe(true);
    expect(p.netWorth.minus(money("-4900")).equals(money("650"))).toBe(true);
    expect(p.cashFlow!.expenseCashSettlement.isZero()).toBe(true);
    expect(p.cashFlow!.outstandingExpenseObligations.equals(money("300"))).toBe(true);
    expect(p.liability!.liabilities[0]!.scheduledPrincipalPaid.isZero()).toBe(true);
    expect(p.transactions.map(t => t.type).sort()).toEqual(["income", "expense_recognition", "auto_loan_interest_recognition"].sort());
    expect(p.liquidityShortfalls).toHaveLength(2);
    // The existing diagnostics report potentially available funds ($100), while
    // all-or-nothing accepted amounts and actual settlements remain zero.
    expect(p.liquidityShortfalls.map(f => f.shortfallAmount.amount.toString()).sort()).toEqual(["200", "344.24"].sort());
    expect(p.liquidityShortfalls.every(f => f.fundedAmount.equals(money("100")))).toBe(true);
    expect(p.constraintOutcomes.every(o => o.acceptedAmount.isZero())).toBe(true);
    expect(result.state.identities.settlementIds).toEqual([]);
    expect(Object.values(result.state.obligations).map(c => c.outstandingAmount.amount.toString()).sort())
      .toEqual(["300", "394.24", "50"].sort());
    expect(Object.values(result.state.obligations).some(c => c.kind === "right")).toBe(false);
    expect(s.run()).toEqual(result);
  });

  it("does not use input arrival order to choose a same-day economic outcome", () => {
    const s = scenario({ months: 2, wageDay: "15" });
    const result = s.run();
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods.map(p => p.cash.amount.toString())).toEqual(["2200", "2400"]);
    // Fixed deterministic permutation of actual source confirmations and loan
    // instructions; no random seed, extra calculator or alternate ledger.
    const loan = { ...s.loan, extraPrincipalPayments: [...s.loan.extraPrincipalPayments!].reverse() };
    const kernel = applyHouseholdExecutionOverlay(s.input.kernel, {
      liabilityInput: { ...s.input.kernel.executable.liabilityInput!, loans: [loan] },
    });
    const attached = attachAftertaxPremiums({ ...s.input, kernel, confirmed: [...s.input.confirmed].reverse() });
    expect(attached.diagnostics).toEqual([]);
    const shuffled = runHouseholdKernel({ kernel: attached.kernel, runContext: s.context, resultTier: "detail" });
    expect(shuffled).toEqual(result);
  });

  it("keeps distinct household owners isolated and rejects a foreign bank binding", () => {
    const a = scenario(); const b = scenario({ namespace: 2 });
    const before = b.run();
    const bad = attachAftertaxPremiums({ ...b.input, confirmed: b.input.confirmed.map(c => ({ ...c, bank: a.input.confirmed[0]!.bank })) });
    expect(bad.admittedOperationIds).toEqual([]);
    expect(bad.kernel).toBe(b.input.kernel);
    expect(bad.diagnostics.some(d => d.missingFacts.join().includes("SOURCED_BANK_PAYABLE_REQUIRED"))).toBe(true);
    const ar = a.run();
    expect(b.run()).toEqual(before);
    expect(ar.state.accounts[b.ids.bank]).toBeUndefined();
    expect(before.state.accounts[a.ids.bank]).toBeUndefined();
    expect(ar.state.obligations).not.toEqual(before.state.obligations);
  });

  it("replaces a proven generic Expense equivalence rather than posting a second premium", () => {
    const s = scenario();
    const stream = s.attached.kernel.cash!.input.expenses[0]!;
    const generic = { ...stream, id: domainId("expense", "14910000-0000-4000-8000-000000099999"),
      sourceTraceRefs: [trace(source("health-quote").ruleSnapshotId)] };
    const kernel = applyHouseholdExecutionOverlay(s.input.kernel, {
      cashFlowInput: { ...s.input.kernel.cash!.input, expenses: [generic] },
    });
    const proof: PremiumRepresentation = { operationId: s.input.confirmed[0]!.proposal.operationId,
      quoteId: s.coverage.quote.quoteId, streamId: generic.id, relationship: "equivalent_expense",
      evidence: source("health-quote"), streamSourceTraceId: source("health-quote").ruleSnapshotId };
    const attached = attachAftertaxPremiums({ ...s.input, kernel, representations: [proof] });
    expect(attached.diagnostics).toEqual([]);
    expect(attached.kernel.cash!.input.expenses).toHaveLength(1);
    const result = runHouseholdKernel({ kernel: attached.kernel, runContext: s.context, resultTier: "detail" });
    expect(result).toEqual(s.run());
  });

  it("preserves fixture coverage boundaries and excludes unsupported domains and tax completeness", () => {
    const s = scenario();
    const result = s.run();
    for (const id of ["health_after_tax", "auto_final_interest", "auto_zero_rate", "debt_unfunded"]) {
      expect(anchor(id).expected.integratedRuntimeEvidence).toBe(false);
    }
    expect(s.attached.kernel.executable.participants ?? []).toEqual([]);
    expect(result.outputCapabilities).toBeUndefined();
    expect(result.periods[0]!.transactions.map(t => t.type).sort()).toEqual([
      "income", "expense_recognition", "expense_settlement", "auto_loan_interest_recognition",
      "auto_loan_interest_settlement", "auto_loan_principal_payment", "auto_loan_extra_principal",
    ].sort());
    expect(Object.keys(result.state.accounts)).toEqual([s.ids.bank]);
    expect(result.state.positions).toEqual({});
    expect(Object.keys(result.state.liabilities).sort()).toEqual([s.ids.payable, s.ids.principal, s.ids.interest].sort());
    expect(result.periods[0]!.transactions.flatMap(t => t.legs).filter(l => l.type === "tax")).toEqual([]);
    // A route outside C1 cannot silently become the existing bank expense.
    const coverage = { ...s.coverage, route: { kind: "ssa_benefit_deduction_pending" as const,
      payerId: s.ids.member, benefitId: "excluded-SSA", evidence: source("SSA-excluded") } };
    const unsupported = attachAftertaxPremiums({ ...s.input, request: { ...s.input.request, coverages: [coverage] }, confirmed: [] });
    expect(unsupported.kernel).toBe(s.input.kernel);
    expect(unsupported.admittedOperationIds).toEqual([]);
    expect(unsupported.netCashCoverage).toBe("incomplete");
    expect(unsupported.diagnostics.length).toBeGreaterThan(0);
  });
});
