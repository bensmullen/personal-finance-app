import { describe, expect, it } from "vitest";
import {
  canonicalOpeningState,
  dollars,
  domainId,
  instant,
  money,
  month,
  Rate,
  RateBasis,
  runVerticalSlicePeriod,
  type VerticalSliceInput,
} from "../src/verticalSlice1.js";

const input: VerticalSliceInput = {
  householdId: domainId("household", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  ownerId: domainId("person", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  checkingAccountId: domainId("account", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  retirementAccountId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
  taxLiabilityId: domainId("liability", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  monthlyGrossCompensation: money("10000"),
  taxRate: Rate.fromPercentage("20", RateBasis.Proportion),
  retirementContribution: money("2000"),
  monthlyLivingExpense: money("4000"),
};

describe("Vertical Slice 1", () => {
  it("derives the canonical $10k/$2k/$2k/$4k scenario from domain inputs", () => {
    const result = runVerticalSlicePeriod({
      period: month(2026, 1),
      input,
      openingState: canonicalOpeningState(input),
    });

    expect(dollars(result.outputs.grossCompensation)).toBe("$10000.00");
    expect(dollars(result.outputs.taxExpense)).toBe("$2000.00");
    expect(dollars(result.outputs.retirementContribution)).toBe("$2000.00");
    expect(dollars(result.outputs.livingExpenses)).toBe("$4000.00");
    expect(dollars(result.outputs.checkingCash)).toBe("$2000.00");
    expect(dollars(result.outputs.retirementCash)).toBe("$2000.00");
    expect(dollars(result.outputs.taxPayable)).toBe("$0.00");
    expect(dollars(result.outputs.consolidatedCash)).toBe("$4000.00");
    expect(dollars(result.statements.assets)).toBe("$4000.00");
    expect(dollars(result.statements.liabilities)).toBe("$0.00");
    expect(dollars(result.statements.income)).toBe("$10000.00");
    expect(dollars(result.statements.expenses)).toBe("$6000.00");
    expect(dollars(result.statements.netIncome)).toBe("$4000.00");
    expect(dollars(result.statements.operatingCashFlow)).toBe("$4000.00");
    expect(dollars(result.statements.netWorth)).toBe("$4000.00");
    expect(result.transactions).toHaveLength(5);
    expect(result.transactions.every((transaction) => {
      const debit = transaction.legs.filter((leg) => leg.posting === "debit").reduce((total, leg) => total.plus(leg.amount), money("0"));
      const credit = transaction.legs.filter((leg) => leg.posting === "credit").reduce((total, leg) => total.plus(leg.amount), money("0"));
      return debit.equals(credit);
    })).toBe(true);
  });

  it("keeps the retirement transfer out of consolidated operating cash flow", () => {
    const result = runVerticalSlicePeriod({
      period: month(2026, 1),
      input,
      openingState: canonicalOpeningState(input),
    });

    expect(dollars(result.statements.operatingCashFlow)).toBe("$4000.00");
    expect(dollars(result.outputs.checkingCash)).toBe("$2000.00");
    expect(dollars(result.outputs.retirementCash)).toBe("$2000.00");
  });

  it("supports a later-period tax settlement without recognizing tax expense again", () => {
    const january = runVerticalSlicePeriod({
      period: month(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });

    expect(dollars(january.outputs.taxPayable)).toBe("$2000.00");
    expect(dollars(january.outputs.checkingCash)).toBe("$4000.00");

    const february = runVerticalSlicePeriod({
      period: month(2026, 2),
      input: {
        ...input,
        monthlyGrossCompensation: money("0"),
        retirementContribution: money("0"),
        monthlyLivingExpense: money("0"),
        settleCurrentTax: false,
      },
      openingState: january.state,
      taxSettlements: [{
        settlementId: "settlement:jan-tax:1",
        obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z",
        amount: money("2000"),
        date: instant("2026-02-15T00:00:00.000Z"),
      }],
    });

    expect(dollars(february.outputs.taxPayable)).toBe("$0.00");
    expect(dollars(february.outputs.checkingCash)).toBe("$2000.00");
    expect(dollars(february.statements.expenses)).toBe("$0.00");
    expect(dollars(february.statements.operatingCashFlow)).toBe("-$2000.00");
  });

  it("supports partial settlement and carries the remainder", () => {
    const january = runVerticalSlicePeriod({
      period: month(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });

    const february = runVerticalSlicePeriod({
      period: month(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false },
      openingState: january.state,
      taxSettlements: [{
        settlementId: "settlement:jan-tax:partial",
        obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z",
        amount: money("500"),
        date: instant("2026-02-15T00:00:00.000Z"),
      }],
    });

    expect(dollars(february.outputs.taxPayable)).toBe("$1500.00");
    expect(february.state.obligations["obligation:recognition:tax:2026-01-01T00:00:00.000Z"]?.status).toBe("partially_settled");
  });

  it("rejects over-settlement without mutating the opening state", () => {
    const january = runVerticalSlicePeriod({
      period: month(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });
    const opening = JSON.stringify(january.state);

    expect(() => runVerticalSlicePeriod({
      period: month(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false },
      openingState: january.state,
      taxSettlements: [{
        settlementId: "settlement:too-much",
        obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z",
        amount: money("2000.01"),
        date: instant("2026-02-15T00:00:00.000Z"),
      }],
    })).toThrow("Settlement exceeds outstanding obligation");

    expect(JSON.stringify(january.state)).toBe(opening);
  });

  it("excludes a settlement exactly at period.end", () => {
    const january = runVerticalSlicePeriod({
      period: month(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });

    const february = runVerticalSlicePeriod({
      period: month(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false },
      openingState: january.state,
      taxSettlements: [{
        settlementId: "settlement:boundary",
        obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z",
        amount: money("2000"),
        date: instant("2026-03-01T00:00:00.000Z"),
      }],
    });

    expect(dollars(february.outputs.taxPayable)).toBe("$2000.00");
    expect(february.transactions).toHaveLength(0);
  });

  it("is deterministic for identical inputs", () => {
    const request = {
      period: month(2026, 1),
      input,
      openingState: canonicalOpeningState(input),
    };
    expect(runVerticalSlicePeriod(request)).toEqual(runVerticalSlicePeriod(request));
  });

  it("requires explicit currency precision at posted input boundaries", () => {
    expect(() => runVerticalSlicePeriod({
      period: month(2026, 1),
      input: { ...input, monthlyGrossCompensation: money("10000.001") },
      openingState: canonicalOpeningState(input),
    })).toThrow(/currency settlement precision/);
  });
});
