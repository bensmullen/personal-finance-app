import { describe, expect, it } from "vitest";
import {
  canonicalOpeningState,
  claimStatus,
  createFundingPolicy,
  domainId,
  formatMoney,
  fundingPolicyId,
  instant,
  money,
  Percentage,
  RoundingPolicy,
  runVerticalSlicePeriod,
  utcMonth,
  type Money,
  type VerticalSliceInput,
} from "../src/verticalSlice1.js";
import { issueCodes } from "../src/diagnostics.js";
import { claimId, createObligation, recognitionId } from "../src/semantics.js";

const dollars = (value: Money): string =>
  formatMoney(value, RoundingPolicy.currency(value.currency.minorUnitScale, "half_up"));

const input: VerticalSliceInput = {
  householdId: domainId("household", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  ownerId: domainId("person", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  checkingAccountId: domainId("account", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  retirementAccountId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
  taxLiabilityId: domainId("liability", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  monthlyGrossCompensation: money("10000"),
  taxRate: Percentage.parse("20").toRatio(),
  retirementContribution: money("2000"),
  monthlyLivingExpense: money("4000"),
  taxFundingPolicy: createFundingPolicy({
    id: fundingPolicyId("funding:tax:checking"),
    orderedSources: [{ kind: "cash_account", accountId: domainId("account", "cccccccc-cccc-4ccc-8ccc-cccccccccccc") }],
    allowPartial: false,
    insufficientFundsBehavior: "unfunded",
  }),
};

describe("Vertical Slice 1", () => {
  it("derives the canonical $10k/$2k/$2k/$4k scenario from domain inputs", () => {
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
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
      period: utcMonth(2026, 1),
      input,
      openingState: canonicalOpeningState(input),
    });

    expect(dollars(result.statements.operatingCashFlow)).toBe("$4000.00");
    expect(dollars(result.outputs.checkingCash)).toBe("$2000.00");
    expect(dollars(result.outputs.retirementCash)).toBe("$2000.00");
  });

  it("supports a later-period tax settlement without recognizing tax expense again", () => {
    const january = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });

    expect(dollars(january.outputs.taxPayable)).toBe("$2000.00");
    expect(dollars(january.outputs.checkingCash)).toBe("$4000.00");

    const february = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
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
      period: utcMonth(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });

    const february = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
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
    expect(claimStatus(february.state.obligations["obligation:recognition:tax:2026-01-01T00:00:00.000Z"]!)).toBe("partially_settled");
    expect(february.constraintOutcomes[0]?.status).toBe("fully_satisfied");
  });

  it("rejects over-settlement without mutating the opening state", () => {
    const january = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });
    const opening = JSON.stringify(january.state);

    expect(() => runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false },
      openingState: january.state,
      taxSettlements: [{
        settlementId: "settlement:too-much",
        obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z",
        amount: money("2000.01"),
        date: instant("2026-02-15T00:00:00.000Z"),
      }],
    })).toThrow("Settlement proposal exceeds outstanding claim amount");

    expect(JSON.stringify(january.state)).toBe(opening);
  });

  it("excludes a settlement exactly at period.end", () => {
    const january = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
    });

    const february = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
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

  const fundedTaxOpeningState = () => {
    const state = canonicalOpeningState(input);
    const recognizedAt = instant("2026-01-31T12:00:00.000Z");
    const recognition = recognitionId("recognition:tax:synthetic");
    const obligation = createObligation({
      id: claimId("obligation:tax:synthetic"),
      category: "tax_payable",
      originatingRecognitionId: recognition,
      economicOwnerId: input.ownerId,
      balanceEntityId: input.taxLiabilityId,
      originalAmount: money("2000"),
      recognizedAt,
    });
    state.accounts[input.checkingAccountId]!.cash = money("500");
    state.liabilities[input.taxLiabilityId]!.balance = money("2000");
    state.obligations[obligation.id] = obligation;
    return state;
  };

  const syntheticFundingPolicy = (allowPartial: boolean) => createFundingPolicy({
    id: fundingPolicyId(`funding:synthetic:${allowPartial}`),
    orderedSources: [{ kind: "cash_account", accountId: input.checkingAccountId }],
    allowPartial,
    insufficientFundsBehavior: "unfunded",
  });

  it("leaves a $2,000 tax claim unfunded when checking has $500 and partial funding is forbidden", () => {
    const policy = syntheticFundingPolicy(false);
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false, taxFundingPolicy: policy },
      openingState: fundedTaxOpeningState(),
      taxSettlements: [{ settlementId: "settlement:synthetic:all-or-nothing", obligationId: "obligation:tax:synthetic", amount: money("2000"), date: instant("2026-02-15T00:00:00.000Z"), fundingPolicy: policy }],
    });

    expect(result.constraintOutcomes[0]?.status).toBe("unfunded");
    expect(result.constraintOutcomes[0]?.acceptedAmount.isZero()).toBe(true);
    expect(result.liquidityShortfalls[0]?.shortfallAmount.equals(money("1500"))).toBe(true);
    expect(result.outputs.checkingCash.equals(money("500"))).toBe(true);
    expect(result.outputs.taxPayable.equals(money("2000"))).toBe(true);
    expect(result.state.obligations["obligation:tax:synthetic"]?.outstandingAmount.equals(money("2000"))).toBe(true);
    expect(result.settlements).toHaveLength(0);
    expect(result.transactions).toHaveLength(0);
    expect(result.statements.expenses.isZero()).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: issueCodes.liquidityShortfall }));
  });

  it("accepts $500 and leaves a $1,500 tax claim when explicit partial funding is allowed", () => {
    const policy = syntheticFundingPolicy(true);
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false, taxFundingPolicy: policy },
      openingState: fundedTaxOpeningState(),
      taxSettlements: [{ settlementId: "settlement:synthetic:partial", obligationId: "obligation:tax:synthetic", amount: money("2000"), date: instant("2026-02-15T00:00:00.000Z"), fundingPolicy: policy }],
    });

    expect(result.constraintOutcomes[0]?.status).toBe("partially_satisfied");
    expect(result.settlements[0]?.amount.equals(money("500"))).toBe(true);
    expect(result.liquidityShortfalls[0]?.shortfallAmount.equals(money("1500"))).toBe(true);
    expect(result.outputs.checkingCash.isZero()).toBe(true);
    expect(result.outputs.taxPayable.equals(money("1500"))).toBe(true);
    expect(claimStatus(result.state.obligations["obligation:tax:synthetic"]!)).toBe("partially_settled");
    expect(result.statements.expenses.isZero()).toBe(true);
    expect(result.outputs.checkingCash.isNegative()).toBe(false);
  });

  it("is deterministic for identical inputs", () => {
    const request = {
      period: utcMonth(2026, 1),
      input,
      openingState: canonicalOpeningState(input),
    };
    expect(runVerticalSlicePeriod(request)).toEqual(runVerticalSlicePeriod(request));
  });

  it("requires explicit currency precision at posted input boundaries", () => {
    expect(() => runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, monthlyGrossCompensation: money("10000.001") },
      openingState: canonicalOpeningState(input),
    })).toThrow(/currency settlement precision/);
  });

  it.each(["-1", "101"])("rejects an out-of-range tax percentage of %s", (value) => {
    expect(() => runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, taxRate: Percentage.parse(value).toRatio() },
      openingState: canonicalOpeningState(input),
    })).toThrow(/Tax ratio must be from 0 to 1/);
  });
});
