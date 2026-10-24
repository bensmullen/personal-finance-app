import { describe, expect, it } from "vitest";
import { assertBalanced } from "../../../../../src/accounting/index.js";
import { applyAccountingTransactionAtomically, cloneAuthoritativeState, createAuthoritativeState, requalifyD2SettlementReceiptHistory,
  d2PostedTransactionArchiveDelta, payrollHealthPostingEvidence } from "../../../../../src/state/index.js";
import { payrollContributionCandidate } from "../../../../../src/simulation/payrollContributions.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { deriveStatements } from "../../../../../src/statements/index.js";
import { instant } from "../../../../../src/time/index.js";
import { money, USD } from "../../../../../src/values/index.js";
import { paycheckFixture, originals, sourceStatus, context, ids } from "./scenario.js";

describe("P2 original-paycheck health source port", () => {
  it("posts one exact member-share expense without treating employer subsidy as household income", () => {
    const f = paycheckFixture(), before = canonicalSerialize(f.opening);
    const result = payrollContributionCandidate(f.opening, f.input), tx = result.transactions[0]!;
    assertBalanced(tx);
    expect(result.takeHomeCash.equals(money("750"))).toBe(true);
    const statements = deriveStatements(result.state, result.transactions, USD);
    expect(statements.income.equals(money("1000"))).toBe(true);
    expect(tx.legs.filter(l => l.type === "expense")).toEqual([expect.objectContaining({ entityId: f.deduction.expenseId, amount: money("150") })]);
    expect(result.withholdingEvidence?.healthDeduction).toEqual(f.deduction);
    expect(Object.isFrozen(result.withholdingEvidence!.healthDeduction)).toBe(true);
    expect(canonicalSerialize(f.opening)).toBe(before);
    const cold = createAuthoritativeState(result.state);
    requalifyD2SettlementReceiptHistory(cold, context);
    expect(payrollHealthPostingEvidence(cold, tx.id, context)).toEqual(f.deduction);
    expect(() => payrollContributionCandidate(result.state, f.input)).toThrow();
    expect(() => payrollContributionCandidate(result.state, { ...f.input, id: "renamed-operation" })).toThrow("exact original wage");
  });
  it("handles a verified zero employee premium without inventing a zero expense", () => {
    const f = paycheckFixture("zero", { amount: "0" });
    const result = payrollContributionCandidate(f.opening, f.input);
    expect(result.takeHomeCash.equals(money("900"))).toBe(true);
    expect(result.transactions[0]!.legs.some(l => l.type === "expense")).toBe(false);
    requalifyD2SettlementReceiptHistory(createAuthoritativeState(result.state), context);
  });
  it("fails closed on missing/replaced original authority and never backfills posting evidence", () => {
    const f = paycheckFixture("withdrawn"), result = payrollContributionCandidate(f.opening, f.input);
    sourceStatus.available = false;
    try {
      expect(() => payrollContributionCandidate(f.opening, f.input)).toThrow("source incomplete");
      expect(() => requalifyD2SettlementReceiptHistory(createAuthoritativeState(result.state), context)).toThrow("SOURCE_INCOMPLETE");
    } finally { sourceStatus.available = true; }
    originals.set(f.deduction.source.sourceId, { deduction: { ...f.deduction, employerAmount: money("401") }, transaction: f.transaction });
    expect(() => requalifyD2SettlementReceiptHistory(result.state, context)).toThrow("changed");
    const fake = cloneAuthoritativeState(f.opening);
    expect(() => applyAccountingTransactionAtomically(fake, f.transaction, { kind: "payroll_health_deduction", role: "original", operationId: f.transaction.id,
      householdId: ids.household, personId: ids.person, bankAccountId: ids.cash, deduction: f.deduction })).toThrow("independently qualified");
  });
  it.each(["employerId", "coverageId", "planId", "occurrenceId", "claimId"] as const)("rejects rebound %s atomically", field => {
    const f = paycheckFixture(`wrong-${field}`), before = canonicalSerialize(f.opening);
    expect(() => payrollContributionCandidate(f.opening, { ...f.input, healthPremium: { ...f.input.healthPremium,
      source: { ...f.input.healthPremium.source, [field]: "unadmitted" } } })).toThrow();
    expect(canonicalSerialize(f.opening)).toBe(before);
  });
  it("rejects partial inventory, misaligned payroll dates, overdraw and duplicate claims under new wage IDs", () => {
    for (const variant of ["inventory", "date", "overdraw"] as const) {
      const f = paycheckFixture(variant);
      const deduction = variant === "inventory" ? { ...f.deduction, deductionInventory: [] }
        : variant === "date" ? { ...f.deduction, source: { ...f.deduction.source, dueAt: instant("2024-01-16T00:00:00.000Z") } }
        : { ...f.deduction, employeeAmount: money("1001") };
      originals.set(f.deduction.source.sourceId, { deduction, transaction: f.transaction });
      expect(() => payrollContributionCandidate(f.opening, { ...f.input, healthPremium: { source: deduction.source, context } })).toThrow();
      expect(f.opening.accounts[ids.cash]!.cash.isZero()).toBe(true);
    }
    const jan = paycheckFixture("first-job"), first = payrollContributionCandidate(jan.opening, jan.input);
    const feb = paycheckFixture("second-job", { employer: "synthetic-job-B", at: instant("2024-02-15T00:00:00.000Z") });
    const second = payrollContributionCandidate(first.state, feb.input);
    expect(second.state.accounts[ids.cash]!.cash.equals(money("1500"))).toBe(true);
    const changed = { ...feb.deduction, source: { ...feb.deduction.source, claimId: jan.deduction.source.claimId }, deductionInventory: [jan.deduction.source.claimId] };
    originals.set(feb.deduction.source.sourceId, { deduction: changed, transaction: feb.transaction });
    expect(() => payrollContributionCandidate(first.state, { ...feb.input, healthPremium: { source: changed.source, context } })).toThrow("source");
  });
  it("keeps proof payload and archive deltas proportional at 1/12/120 occurrences", () => {
    const sizes: number[] = [];
    for (const n of [1, 12, 120]) {
      sourceStatus.calls = 0;
      const f = paycheckFixture(`growth-${n}`);
      let state = f.opening;
      for (let i = 0; i < n; i++) {
        const date = instant(`${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-15T00:00:00.000Z`);
        const occurrence = paycheckFixture(`growth:${n}:${i}`, { at: date });
        const before = cloneAuthoritativeState(state);
        state = payrollContributionCandidate(state, occurrence.input).state;
        expect(Object.keys(d2PostedTransactionArchiveDelta(state, before).set)).toHaveLength(1);
      }
      sizes.push(canonicalSerialize(state.d2PostedTransactions).length);
      expect(sourceStatus.calls).toBeLessThanOrEqual(3 * n);
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[0]! * 130);
  });
});
