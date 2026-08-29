import { describe, expect, it } from "vitest";
import {
  canonicalOpeningState,
  dollars,
  money,
  runVerticalSlicePeriod,
  type VerticalSliceInput,
} from "../src/verticalSlice1.js";

const input: VerticalSliceInput = {
  householdId: "household-1",
  ownerId: "person-1",
  checkingAccountId: "checking-1",
  retirementAccountId: "retirement-1",
  taxLiabilityId: "tax-liability-1",
  monthlyGrossCompensation: money("10000"),
  taxRate: 0.2,
  retirementContribution: money("2000"),
  monthlyLivingExpense: money("4000"),
};

describe("Vertical Slice 1", () => {
  it("derives the canonical $10k/$2k/$2k/$4k scenario from domain inputs", () => {
    const result = runVerticalSlicePeriod({
      period: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
      input,
      openingState: canonicalOpeningState(input),
    });

    expect(dollars(result.outputs.grossCompensation)).toBe("$10000.00");
    expect(dollars(result.outputs.taxExpense)).toBe("$2000.00");
    expect(dollars(result.outputs.retirementContribution)).toBe("$2000.00");
    expect(dollars(result.outputs.livingExpenses)).toBe("$4000.00");
    expect(dollars(result.outputs.checkingCash)).toBe("$4000.00");
    expect(dollars(result.outputs.retirementCash)).toBe("$2000.00");
    expect(dollars(result.outputs.taxPayable)).toBe("$2000.00");
    expect(dollars(result.outputs.consolidatedCash)).toBe("$6000.00");
    expect(dollars(result.statements.income)).toBe("$10000.00");
    expect(dollars(result.statements.expenses)).toBe("$6000.00");
    expect(dollars(result.statements.operatingCashFlow)).toBe("$4000.00");
    expect(dollars(result.statements.netWorth)).toBe("$4000.00");
  });

  it("keeps the retirement transfer out of consolidated operating cash flow", () => {
    const result = runVerticalSlicePeriod({
      period: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
      input,
      openingState: canonicalOpeningState(input),
    });

    expect(dollars(result.statements.operatingCashFlow)).toBe("$4000.00");
    expect(dollars(result.outputs.consolidatedCash)).toBe("$6000.00");
    expect(dollars(result.outputs.checkingCash)).toBe("$4000.00");
    expect(dollars(result.outputs.retirementCash)).toBe("$2000.00");
  });

  it("supports a later-period tax settlement without recognizing tax expense again", () => {
    const january = runVerticalSlicePeriod({
      period: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
      input,
      openingState: canonicalOpeningState(input),
    });

    const february = runVerticalSlicePeriod({
      period: { start: "2026-02-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" },
      input: { ...input, monthlyGrossCompensation: 0n, retirementContribution: 0n, monthlyLivingExpense: 0n },
      openingState: january.state,
      taxSettlement: { obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z", amount: money("2000"), date: "2026-02-15T00:00:00.000Z" },
    });

    expect(dollars(february.outputs.taxPayable)).toBe("$0.00");
    expect(dollars(february.statements.expenses)).toBe("$0.00");
    expect(dollars(february.statements.operatingCashFlow)).toBe("-$2000.00");
  });

  it("rejects an over-settlement", () => {
    const january = runVerticalSlicePeriod({
      period: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
      input,
      openingState: canonicalOpeningState(input),
    });

    expect(() => runVerticalSlicePeriod({
      period: { start: "2026-02-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" },
      input: { ...input, monthlyGrossCompensation: 0n, retirementContribution: 0n, monthlyLivingExpense: 0n },
      openingState: january.state,
      taxSettlement: { obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z", amount: money("2000.01"), date: "2026-02-15T00:00:00.000Z" },
    })).toThrow("Settlement exceeds outstanding obligation");
  });
});
