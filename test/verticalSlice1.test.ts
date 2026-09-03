import { describe, expect, it } from "vitest";
import {
  canonicalOpeningState,
  claimStatus,
  createFundingPolicy,
  createRunContext,
  domainId,
  formatMoney,
  fundingPolicyId,
  instant,
  money,
  Percentage,
  RoundingPolicy,
  runId,
  runVerticalSlicePeriod as executeVerticalSlicePeriod,
  scenarioId,
  utcMonth,
  type Money,
  type RunContext,
  type VerticalSlicePeriodInput,
  type VerticalSliceInput,
} from "../src/verticalSlice1.js";
import { issueCodes } from "../src/diagnostics.js";
import { claimId, createObligation, recognitionId, settlementId } from "../src/semantics.js";

const dollars = (value: Money): string =>
  formatMoney(value, RoundingPolicy.currency(value.currency.minorUnitScale, "half_up"));

const testRunContext = (request: Pick<VerticalSlicePeriodInput, "period" | "input">): RunContext =>
  createRunContext({
    runId: runId("55555555-5555-4555-8555-555555555555"),
    scenarioId: scenarioId("66666666-6666-4666-8666-666666666666"),
    asOf: request.period.start,
    dataCutoff: request.period.start,
    simulationStart: request.period.start,
    simulationEnd: request.period.end,
    baseCurrency: request.input.currency ?? request.input.monthlyGrossCompensation.currency,
  });

const runVerticalSlicePeriod = (
  request: Omit<VerticalSlicePeriodInput, "runContext"> & { readonly runContext?: RunContext },
) => {
  const { runContext, ...periodRequest } = request;
  return executeVerticalSlicePeriod({
    ...periodRequest,
    runContext: runContext ?? testRunContext(request),
  });
};

const input: VerticalSliceInput = {
  householdId: domainId("household", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  ownerId: domainId("person", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  checkingAccountId: domainId("account", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  retirementAccountId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
  taxLiabilityId: domainId("liability", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  monthlyGrossCompensation: money("10000"),
  ruleCatalog: [
    { id: domainId("tax-rule", "10000000-0000-4000-8000-000000000011"), kind: "proportional_income_tax", target: { targetType: "person", targetId: domainId("person", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveRate: Percentage.parse("20").toRatio(), postingRounding: RoundingPolicy.currency(2, "half_up") },
    { id: domainId("tax-rule", "10000000-0000-4000-8000-000000000012"), kind: "product_operation_eligibility", target: { targetType: "account", targetId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd") }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), operation: "contribution", allowed: true },
    { id: domainId("tax-rule", "10000000-0000-4000-8000-000000000013"), kind: "annual_contribution_limit", target: { targetType: "account", targetId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd") }, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"), calendarYear: 2026, calendar: "utc", annualLimit: money("24000") },
  ],
  incomeTaxRuleIds: [domainId("tax-rule", "10000000-0000-4000-8000-000000000011")],
  retirementContribution: money("2000"),
  retirementEligibilityRuleIds: [domainId("tax-rule", "10000000-0000-4000-8000-000000000012")],
  retirementContributionLimitRuleIds: [domainId("tax-rule", "10000000-0000-4000-8000-000000000013")],
  retirementContributionUsage: { calendarYear: 2026, usedBeforePeriod: money("0") },
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
    const januaryRuleId = input.incomeTaxRuleIds[0]!;
    const februaryRuleId = domainId("tax-rule", "10000000-0000-4000-8000-000000000014");
    const versionedInput: VerticalSliceInput = {
      ...input,
      ruleCatalog: [
        ...input.ruleCatalog.map((rule) => rule.id === januaryRuleId ? { ...rule, effectiveUntil: instant("2026-02-01T00:00:00.000Z") } : rule),
        { id: februaryRuleId, kind: "proportional_income_tax", target: { targetType: "person", targetId: input.ownerId }, effectiveFrom: instant("2026-02-01T00:00:00.000Z"), effectiveRate: Percentage.parse("30").toRatio(), postingRounding: RoundingPolicy.currency(2, "half_up") },
      ],
      incomeTaxRuleIds: [januaryRuleId, februaryRuleId],
    };
    const ruleIds = (refs: readonly { readonly ruleIds?: readonly string[] }[] | undefined): readonly string[] => refs?.flatMap((ref) => ref.ruleIds ?? []) ?? [];
    const january = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...versionedInput, settleCurrentTax: false },
      openingState: canonicalOpeningState(versionedInput),
    });

    expect(dollars(january.outputs.taxPayable)).toBe("$2000.00");
    expect(dollars(january.outputs.checkingCash)).toBe("$4000.00");
    const januaryClaim = january.state.obligations["obligation:recognition:tax:2026-01-01T00:00:00.000Z"]!;
    expect(ruleIds(januaryClaim.traceRefs)).toContain(januaryRuleId);

    const february = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: {
        ...versionedInput,
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
    const proposal = february.settlementProposals[0]!;
    const settlement = february.settlements[0]!;
    const effect = february.effects.find((item) => item.settlementId === settlement.id)!;
    const transaction = february.transactions.find((item) => item.type === "tax_settlement")!;
    for (const refs of [proposal.traceRefs, settlement.traceRefs, effect.traceRefs, transaction.traceRefs, ...transaction.legs.map((leg) => leg.traceRefs)]) {
      expect(ruleIds(refs)).toContain(januaryRuleId);
      expect(ruleIds(refs)).not.toContain(februaryRuleId);
    }
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

  const fundedTaxOpeningState = (checking = "500", claimAmount = "2000", retirement = "0") => {
    const state = canonicalOpeningState(input);
    const recognizedAt = instant("2026-01-31T12:00:00.000Z");
    const recognition = recognitionId("recognition:tax:synthetic");
    const obligation = createObligation({
      id: claimId("obligation:tax:synthetic"),
      category: "tax_payable",
      originatingRecognitionId: recognition,
      economicOwnerId: input.ownerId,
      balanceEntityId: input.taxLiabilityId,
      originalAmount: money(claimAmount),
      recognizedAt,
    });
    state.accounts[input.checkingAccountId]!.cash = money(checking);
    state.accounts[input.retirementAccountId]!.cash = money(retirement);
    state.liabilities[input.taxLiabilityId]!.balance = money(claimAmount);
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

    expect(result.status).toBe("completed");
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

  it("does not let later salary fund an earlier settlement proposal", () => {
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: {
        ...input,
        monthlyGrossCompensation: money("1500"),
        ruleCatalog: input.ruleCatalog.map((rule) => rule.kind === "proportional_income_tax" ? { ...rule, effectiveRate: Percentage.parse("0").toRatio() } : rule),
        retirementContribution: money("0"),
        monthlyLivingExpense: money("0"),
        settleCurrentTax: false,
        taxFundingPolicy: syntheticFundingPolicy(false),
      },
      openingState: fundedTaxOpeningState(),
      taxSettlements: [{
        settlementId: "settlement:before-salary",
        obligationId: "obligation:tax:synthetic",
        amount: money("2000"),
        date: instant("2026-02-05T00:00:00.000Z"),
      }],
    });

    expect(result.constraintOutcomes[0]?.status).toBe("unfunded");
    expect(result.liquidityShortfalls[0]?.shortfallAmount.equals(money("1500"))).toBe(true);
    expect(result.settlements).toHaveLength(0);
    expect(result.transactions.map((transaction) => transaction.type)).toEqual(["income"]);
    expect(result.state.obligations["obligation:tax:synthetic"]?.outstandingAmount.equals(money("2000"))).toBe(true);
    expect(result.outputs.checkingCash.equals(money("2000"))).toBe(true);
    expect(result.diagnostics.some((issue) => issue.code === issueCodes.negativeCashInvariant)).toBe(false);
  });

  it("allows the same settlement after salary has actually arrived", () => {
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: {
        ...input,
        monthlyGrossCompensation: money("1500"),
        ruleCatalog: input.ruleCatalog.map((rule) => rule.kind === "proportional_income_tax" ? { ...rule, effectiveRate: Percentage.parse("0").toRatio() } : rule),
        retirementContribution: money("0"),
        monthlyLivingExpense: money("0"),
        settleCurrentTax: false,
        taxFundingPolicy: syntheticFundingPolicy(false),
      },
      openingState: fundedTaxOpeningState(),
      taxSettlements: [{
        settlementId: "settlement:after-salary",
        obligationId: "obligation:tax:synthetic",
        amount: money("2000"),
        date: instant("2026-02-28T23:59:59.996Z"),
      }],
    });

    expect(result.constraintOutcomes[0]?.status).toBe("fully_satisfied");
    expect(result.settlements[0]?.amount.equals(money("2000"))).toBe(true);
    expect(result.outputs.checkingCash.isZero()).toBe(true);
  });

  it("does not let a later expense affect earlier funding", () => {
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: {
        ...input,
        monthlyGrossCompensation: money("0"),
        retirementContribution: money("0"),
        monthlyLivingExpense: money("500"),
        settleCurrentTax: false,
        taxFundingPolicy: syntheticFundingPolicy(false),
      },
      openingState: fundedTaxOpeningState("1500", "1000"),
      taxSettlements: [{
        settlementId: "settlement:before-expense",
        obligationId: "obligation:tax:synthetic",
        amount: money("1000"),
        date: instant("2026-02-15T00:00:00.000Z"),
      }],
    });

    expect(result.constraintOutcomes[0]?.status).toBe("fully_satisfied");
    expect(result.outputs.checkingCash.isZero()).toBe(true);
  });

  it("lets an earlier expense reduce later funding", () => {
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: {
        ...input,
        monthlyGrossCompensation: money("0"),
        retirementContribution: money("0"),
        monthlyLivingExpense: money("1000"),
        settleCurrentTax: false,
        taxFundingPolicy: syntheticFundingPolicy(false),
      },
      openingState: fundedTaxOpeningState("1500", "1000"),
      taxSettlements: [{
        settlementId: "settlement:after-expense",
        obligationId: "obligation:tax:synthetic",
        amount: money("1000"),
        date: instant("2026-02-28T23:59:59.999Z"),
      }],
    });

    expect(result.constraintOutcomes[0]?.status).toBe("unfunded");
    expect(result.liquidityShortfalls[0]?.shortfallAmount.equals(money("500"))).toBe(true);
    expect(result.settlements).toHaveLength(0);
    expect(result.outputs.checkingCash.equals(money("500"))).toBe(true);
  });

  it("produces identical economics when settlement request input order is reversed", () => {
    const earlier = {
      settlementId: "settlement:a",
      obligationId: "obligation:tax:synthetic",
      amount: money("500"),
      date: instant("2026-02-05T00:00:00.000Z"),
    };
    const later = {
      settlementId: "settlement:b",
      obligationId: "obligation:tax:synthetic",
      amount: money("1000"),
      date: instant("2026-02-15T00:00:00.000Z"),
    };
    const baseRequest = {
      period: utcMonth(2026, 2),
      input: {
        ...input,
        monthlyGrossCompensation: money("0"),
        retirementContribution: money("0"),
        monthlyLivingExpense: money("0"),
        settleCurrentTax: false,
        taxFundingPolicy: syntheticFundingPolicy(false),
      },
      openingState: fundedTaxOpeningState("1000", "1500"),
    };
    const chronological = runVerticalSlicePeriod({ ...baseRequest, taxSettlements: [earlier, later] });
    const reversed = runVerticalSlicePeriod({ ...baseRequest, taxSettlements: [later, earlier] });

    expect(reversed).toEqual(chronological);
    expect(chronological.constraintOutcomes.map((outcome) => outcome.status)).toEqual(["fully_satisfied", "unfunded"]);
  });

  it("uses an explicit non-checking funding source as authoritative policy", () => {
    const retirementPolicy = createFundingPolicy({
      id: fundingPolicyId("funding:tax:retirement-only"),
      orderedSources: [{ kind: "cash_account", accountId: input.retirementAccountId }],
      allowPartial: false,
      insufficientFundsBehavior: "unfunded",
    });
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false, taxFundingPolicy: retirementPolicy },
      openingState: fundedTaxOpeningState("0", "2000", "2000"),
      taxSettlements: [{ settlementId: "settlement:retirement-funded", obligationId: "obligation:tax:synthetic", amount: money("2000"), date: instant("2026-02-15T00:00:00.000Z") }],
    });

    expect(result.constraintOutcomes[0]?.status).toBe("fully_satisfied");
    expect(result.outputs.checkingCash.isZero()).toBe(true);
    expect(result.outputs.retirementCash.isZero()).toBe(true);
  });

  it("settles the liability linked by the claim rather than the configured default liability", () => {
    const liabilityA = domainId("liability", "ffffffff-ffff-4fff-8fff-ffffffffffff");
    const opening = canonicalOpeningState(input);
    opening.accounts[input.checkingAccountId]!.cash = money("500");
    opening.liabilities[liabilityA] = { id: liabilityA, balance: money("500") };
    opening.liabilities[input.taxLiabilityId]!.balance = money("500");
    const linkedClaim = createObligation({
      id: claimId("obligation:tax:liability-a"),
      category: "tax_payable",
      originatingRecognitionId: recognitionId("recognition:tax:liability-a"),
      economicOwnerId: input.ownerId,
      balanceEntityId: liabilityA,
      originalAmount: money("500"),
      recognizedAt: instant("2026-01-31T12:00:00.000Z"),
    });
    opening.obligations[linkedClaim.id] = linkedClaim;

    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false, taxFundingPolicy: syntheticFundingPolicy(false) },
      openingState: opening,
      taxSettlements: [{ settlementId: "settlement:liability-a", obligationId: linkedClaim.id, amount: money("500"), date: instant("2026-02-15T00:00:00.000Z") }],
    });

    expect(result.state.liabilities[liabilityA]?.balance.isZero()).toBe(true);
    expect(result.state.liabilities[input.taxLiabilityId]?.balance.equals(money("500"))).toBe(true);
    expect(claimStatus(result.state.obligations[linkedClaim.id]!)).toBe("settled");
    expect(result.outputs.checkingCash.isZero()).toBe(true);
    expect(result.transactions[0]?.legs).toContainEqual(expect.objectContaining({ type: "liability", entityId: liabilityA }));
  });

  it("detects a settlement identity already present on another available claim", () => {
    const opening = fundedTaxOpeningState("2000");
    const other = createObligation({
      id: claimId("obligation:tax:other"),
      category: "tax_payable",
      originatingRecognitionId: recognitionId("recognition:tax:other"),
      economicOwnerId: input.ownerId,
      balanceEntityId: input.taxLiabilityId,
      originalAmount: money("1"),
      recognizedAt: instant("2026-01-31T12:00:00.000Z"),
      settlementIds: [settlementId("settlement:historic")],
    });
    opening.obligations[other.id] = other;
    expect(() => runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false, taxFundingPolicy: syntheticFundingPolicy(false) },
      openingState: opening,
      taxSettlements: [{ settlementId: "settlement:historic", obligationId: "obligation:tax:synthetic", amount: money("2000"), date: instant("2026-02-15T00:00:00.000Z") }],
    })).toThrow(/Duplicate settlement/);
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

  it("posts only the annual-limit accepted retirement contribution and exposes rule lineage", () => {
    const limited: VerticalSliceInput = {
      ...input,
      retirementContributionUsage: { calendarYear: 2026, usedBeforePeriod: money("23500") },
    };
    const result = runVerticalSlicePeriod({ period: utcMonth(2026, 1), input: limited, openingState: canonicalOpeningState(limited) });
    expect(result.outputs.retirementContribution.equals(money("500"))).toBe(true);
    expect(result.outputs.retirementCash.equals(money("500"))).toBe(true);
    expect(result.diagnostics.some((issue) => issue.code === issueCodes.contributionLimitApplied)).toBe(true);
    const contribution = result.ruleApplications.find((application) => application.ruleKind === "annual_contribution_limit");
    expect(contribution?.traceRefs[0]?.ruleIds).toEqual([contribution?.ruleId]);
  });

  it("treats product disallowance as a nonblocking no-transaction decision", () => {
    const disallowed: VerticalSliceInput = {
      ...input,
      ruleCatalog: input.ruleCatalog.map((rule) => rule.kind === "product_operation_eligibility" ? { ...rule, allowed: false } : rule),
    };
    const result = runVerticalSlicePeriod({ period: utcMonth(2026, 1), input: disallowed, openingState: canonicalOpeningState(disallowed) });
    expect(result.outputs.retirementContribution.isZero()).toBe(true);
    expect(result.transactions.some((transaction) => transaction.type === "internal_transfer")).toBe(false);
    expect(result.diagnostics.some((issue) => issue.code === issueCodes.productOperationNotAllowed)).toBe(true);
  });

  it("canonicalizes unordered rule catalogs and bindings in the input fingerprint", () => {
    const period = utcMonth(2026, 1);
    const first = runVerticalSlicePeriod({ period, input, openingState: canonicalOpeningState(input) });
    const reordered: VerticalSliceInput = { ...input, ruleCatalog: [...input.ruleCatalog].reverse(), incomeTaxRuleIds: [...input.incomeTaxRuleIds].reverse(), retirementEligibilityRuleIds: [...input.retirementEligibilityRuleIds].reverse(), retirementContributionLimitRuleIds: [...input.retirementContributionLimitRuleIds].reverse() };
    const second = runVerticalSlicePeriod({ period, input: reordered, openingState: canonicalOpeningState(reordered) });
    expect(second.runMetadata.inputFingerprint).toBe(first.runMetadata.inputFingerprint);
    expect(second.outputs).toEqual(first.outputs);
  });

  it.each(["-1", "101"])("rejects an out-of-range tax percentage of %s", (value) => {
    expect(() => runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, ruleCatalog: input.ruleCatalog.map((rule) => rule.kind === "proportional_income_tax" ? { ...rule, effectiveRate: Percentage.parse(value).toRatio() } : rule) },
      openingState: canonicalOpeningState(input),
    })).toThrow(/tax rate must be between zero and one/);
  });
});
