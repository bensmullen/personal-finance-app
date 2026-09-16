import { describe, expect, it } from "vitest";
import {
  compileInvestments,
  type InvestmentCompilerRequest,
} from "../src/application/compiler/index.js";
import {
  createSyntheticPersonalDraft,
  runPersonalForecast,
  type PersonalDraft,
} from "../src/application/index.js";
import { domainId } from "../src/identity/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import {
  runVerticalSlice3,
  type VerticalSlice3Input,
} from "../src/simulation/verticalSlice3.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant } from "../src/time/index.js";
import {
  Currency,
  Quantity,
  Rate,
  RoundingPolicy,
  SHARE,
  money,
  rateConvention,
} from "../src/values/index.js";

const ids = {
  household: "90000000-0000-4000-8000-000000000002",
  person: "90000000-0000-4000-8000-000000000003",
  checking: "90000000-0000-4000-8000-000000000004",
  investment: "90000000-0000-4000-8000-000000000009",
  assumption: "98000000-0000-4000-8000-000000000001",
  scenario: "90000000-0000-4000-8000-000000000011",
  primitive: "98000000-0000-4000-8000-000000000002",
  brokerage: "98000000-0000-4000-8000-000000000003",
  transfer: "98000000-0000-4000-8000-000000000004",
  purchase: "98000000-0000-4000-8000-000000000005",
  savings: "98000000-0000-4000-8000-000000000006",
  rule: "98000000-0000-4000-8000-000000000007",
};

type Mutable = {
  modelId: PersonalDraft["modelId"];
  modelFormatVersion: string;
  financialSpecificationVersion: string;
  objects: Record<string, Record<string, unknown>[]>;
};
const fixture = (change?: (draft: Mutable) => void): PersonalDraft => {
  const draft = structuredClone(
    createSyntheticPersonalDraft(),
  ) as unknown as Mutable;
  draft.objects.Income = [];
  draft.objects.Expense = [];
  draft.objects.Liability = [];
  draft.objects.Account![0] = {
    ...draft.objects.Account![0]!,
    account_type: "checking",
    opening_balance: "1000.00",
    transaction_ids: [],
    return_model_id: null,
  };
  draft.objects.Account!.push({
    ...draft.objects.Account![0]!,
    account_id: ids.brokerage,
    name: "Brokerage",
    account_type: "taxable_brokerage",
    opening_balance: "0.00",
  });
  draft.objects.Investment![0] = {
    ...draft.objects.Investment![0]!,
    account_id: ids.brokerage,
    investment_type: "fund",
    quantity: "10",
    price: "10",
    market_value: "100",
    expected_return: null,
    volatility: null,
    contribution_model_id: null,
    return_model_id: ids.primitive,
    rebalancing_rule_id: null,
  };
  draft.objects.Assumption = [
    {
      assumption_id: ids.assumption,
      name: "Market return",
      category: "market_return",
      value: "0.12",
      unit: "effective annual rate",
      source: "user",
      scenario_id: ids.scenario,
    },
  ];
  draft.objects.Scenario![0] = {
    ...draft.objects.Scenario![0]!,
    assumption_ids: [ids.assumption],
    event_ids: [],
    enabled: true,
    stochastic: false,
    simulation_count: 1,
    timestep: "monthly",
  };
  draft.objects.PrimitiveInstance = [
    {
      primitive_instance_id: ids.primitive,
      primitive_id: "P23",
      input_bindings: { rate: ids.assumption },
      parameters: {},
      scenario_id: ids.scenario,
      enabled: true,
    },
  ];
  change?.(draft);
  return draft as unknown as PersonalDraft;
};

const request = (
  changes: Partial<InvestmentCompilerRequest> = {},
): InvestmentCompilerRequest => ({
  baseCurrency: "USD",
  asOf: "2026-01-01",
  simulationStart: "2026-01-01",
  simulationEnd: "2026-03-01",
  months: 2,
  executionOwnerId: ids.person,
  transferInstructions: [],
  purchaseInstructions: [],
  ...changes,
});
const context = () =>
  createRunContext({
    runId: runId("98000000-0000-4000-8000-000000000010"),
    scenarioId: scenarioId(ids.scenario),
    asOf: instant("2026-01-01T00:00:00.000Z"),
    dataCutoff: instant("2026-01-01T00:00:00.000Z"),
    simulationStart: instant("2026-01-01T00:00:00.000Z"),
    simulationEnd: instant("2026-03-01T00:00:00.000Z"),
    baseCurrency: Currency.of("USD"),
  });
const transfer = {
  id: ids.transfer,
  sourceAccountId: ids.checking,
  destinationAccountId: ids.brokerage,
  amount: "200.00",
  schedule: { kind: "explicit_dates" as const, dates: ["2026-01-05"] },
  order: 10,
};
const purchase = {
  id: ids.purchase,
  investmentId: ids.investment,
  sourceCashAccountId: ids.checking,
  amount: "200.00",
  schedule: { kind: "explicit_dates" as const, dates: ["2026-01-10"] },
  order: 20,
  quantityRounding: { scale: 12, mode: "half_even" as const },
};

describe("canonical investment compiler", () => {
  it("compiles one economic position without account double counting and retains P23 assumption lineage", () => {
    const compiled = compileInvestments(fixture(), request());
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    expect(
      compiled.value.openingState.accounts[
        ids.brokerage
      ]!.cash.amount.toString(),
    ).toBe("0");
    expect(
      compiled.value.openingState.positions[
        ids.investment
      ]!.carryingValue.amount.toString(),
    ).toBe("100");
    const run = runVerticalSlice3({
      runContext: context(),
      input: compiled.value.input,
      openingState: compiled.value.openingState,
      primitiveState: compiled.value.primitiveState,
      months: 2,
    });
    expect(run.status).toBe("completed");
    expect(
      run.periods[0]!.accountValues[ids.brokerage]!.equals(
        run.periods[0]!.portfolioValue,
      ),
    ).toBe(true);
    expect(
      run.periods[0]!.traceRefs.flatMap((ref) => ref.assumptionIds ?? []),
    ).toContain(ids.assumption);
    expect(compiled.value.input.returns[0]!.returnBasis).toMatchObject({
      kind: "effective_annual",
      yearFraction: { numerator: 1, denominator: 12 },
    });
    const directAccount = domainId(
      "account",
      "99000000-0000-4000-8000-000000000001",
    );
    const directPosition = domainId(
      "position",
      "99000000-0000-4000-8000-000000000002",
    );
    const directInput: VerticalSlice3Input = {
      householdId: domainId("household", ids.household),
      ownerId: domainId("person", ids.person),
      baseCurrency: Currency.of("USD"),
      valuationAccountingPolicy: "economic_only",
      ruleCatalog: [],
      transfers: [],
      purchases: [],
      fees: [],
      returns: [
        {
          targetPositionId: directPosition,
          accountId: directAccount,
          rate: Rate.fromDecimal("0.12", rateConvention.effectiveAnnual()),
          returnBasis: {
            kind: "effective_annual",
            yearFraction: { numerator: 1, denominator: 12 },
            calculationRounding: new RoundingPolicy(18, "half_even"),
          },
          timing: "end_of_period_on_opening_quantity",
          priceRounding: RoundingPolicy.currency(2, "half_up"),
          primitiveIds: {
            compounding: domainId(
              "primitive-instance",
              "99000000-0000-4000-8000-000000000003",
            ),
            markToMarket: domainId(
              "primitive-instance",
              "99000000-0000-4000-8000-000000000004",
            ),
          },
        },
      ],
    };
    const direct = runVerticalSlice3({
      runContext: context(),
      input: directInput,
      openingState: createAuthoritativeState({
        accounts: {
          [directAccount]: {
            id: directAccount,
            ownerId: directInput.ownerId,
            kind: "brokerage",
            cash: money("0"),
          },
        },
        positions: {
          [directPosition]: {
            id: directPosition,
            accountId: directAccount,
            quantity: Quantity.parse("10", SHARE),
            price: money("10"),
            carryingValue: money("100"),
          },
        },
      }),
      months: 2,
    });
    expect(
      run.periods.map((point) => ({
        portfolio: point.portfolioValue.amount.toString(),
        gain: point.unrealizedGain.amount.toString(),
      })),
    ).toEqual(
      direct.periods.map((point) => ({
        portfolio: point.portfolioValue.amount.toString(),
        gain: point.unrealizedGain.amount.toString(),
      })),
    );
  });

  it("compiles explicit ordered transfer and purchase, preserves value, and records principal", () => {
    const compiled = compileInvestments(
      fixture(),
      request({
        transferInstructions: [transfer],
        purchaseInstructions: [purchase],
      }),
    );
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    expect(compiled.value.input.cashFlowInput).toBeUndefined();
    expect(compiled.value.input.transfers[0]!.order).toBe(10);
    expect(compiled.value.input.purchases[0]!.order).toBe(20);
    const run = runVerticalSlice3({
      runContext: context(),
      input: compiled.value.input,
      openingState: compiled.value.openingState,
      primitiveState: compiled.value.primitiveState,
      months: 2,
    });
    expect(run.status).toBe("completed");
    expect(run.periods[0]!.contributionPrincipal.amount.toString()).toBe("200");
    expect(
      run.periods[0]!.statements.assets.minus(run.periods[0]!.unrealizedGain)
        .round(RoundingPolicy.currency(2, "half_even"))
        .amount.toString(),
    ).toBe("1100");
  });

  it("is stable under canonical/request array reordering", () => {
    const expanded = fixture((draft) => {
      draft.objects.Account!.push({
        ...draft.objects.Account![0]!,
        account_id: ids.savings,
        account_type: "savings",
        opening_balance: "50",
      });
    });
    const extra = {
      ...transfer,
      id: "98000000-0000-4000-8000-000000000008",
      sourceAccountId: ids.savings,
      amount: "10.00",
      order: 11,
    };
    const left = compileInvestments(
      expanded,
      request({
        transferInstructions: [transfer, extra],
        purchaseInstructions: [purchase],
      }),
    );
    const reordered = structuredClone(expanded) as unknown as Mutable;
    reordered.objects.Account!.reverse();
    reordered.objects.Investment!.reverse();
    const right = compileInvestments(
      reordered as unknown as PersonalDraft,
      request({
        transferInstructions: [extra, transfer],
        purchaseInstructions: [purchase],
      }),
    );
    expect(left.status).toBe("compiled");
    expect(right.status).toBe("compiled");
    if (left.status !== "compiled" || right.status !== "compiled") return;
    expect(left.value.input).toEqual(right.value.input);
    expect(left.value.openingState).toEqual(right.value.openingState);
    const lrun = runVerticalSlice3({
      runContext: context(),
      input: left.value.input,
      openingState: left.value.openingState,
      months: 2,
    });
    const rrun = runVerticalSlice3({
      runContext: context(),
      input: right.value.input,
      openingState: right.value.openingState,
      months: 2,
    });
    expect(lrun.runMetadata.inputFingerprint).toBe(
      rrun.runMetadata.inputFingerprint,
    );
    expect(
      lrun.periods.map((point) => point.portfolioValue.amount.toString()),
    ).toEqual(
      rrun.periods.map((point) => point.portfolioValue.amount.toString()),
    );
  });

  it.each([
    ["expected_return", "0.1", "INVESTMENT_EXPECTED_RETURN_UNSUPPORTED"],
    ["volatility", "0.1", "INVESTMENT_STOCHASTIC_RETURN_UNSUPPORTED"],
    [
      "contribution_model_id",
      ids.primitive,
      "INVESTMENT_CONTRIBUTION_MODEL_UNSUPPORTED",
    ],
    [
      "rebalancing_rule_id",
      ids.rule,
      "INVESTMENT_REBALANCING_RULE_UNSUPPORTED",
    ],
  ])("gates authored %s", (field, value, code) => {
    const result = compileInvestments(
      fixture((draft) => {
        draft.objects.Investment![0]![field] = value;
      }),
      request(),
    );
    expect(result).toMatchObject({
      status: "unsupported",
      diagnostics: [
        expect.objectContaining({ code, capability: "investment_forecast" }),
      ],
    });
  });

  it("gates fee rules, FX, and observed-opening boundary", () => {
    const fee = compileInvestments(
      fixture((draft) => {
        draft.objects.TaxRule = [{ tax_rule_id: ids.rule }];
        draft.objects.Account![1]!.fee_rule_id = ids.rule;
      }),
      request(),
    );
    expect(fee.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ACCOUNT_FEE_RULE_UNSUPPORTED" }),
    );
    const fx = compileInvestments(
      fixture((draft) => {
        draft.objects.Account![1]!.currency = "EUR";
      }),
      request(),
    );
    expect(fx.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVESTMENT_FX_UNSUPPORTED" }),
    );
    const boundary = compileInvestments(
      fixture(),
      request({ asOf: "2025-12-01" }),
    );
    expect(boundary.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVESTMENT_OPENING_BOUNDARY_UNSUPPORTED",
      }),
    );
  });

  it.each([
    ["quantity", "-1", "INVESTMENT_QUANTITY_INVALID"],
    ["price", "-1", "INVESTMENT_VALUE_INVALID"],
    ["market_value", "99", "INVESTMENT_MARKET_VALUE_INCONSISTENT"],
  ])("rejects invalid %s", (field, value, code) => {
    const result = compileInvestments(
      fixture((draft) => {
        draft.objects.Investment![0]![field] = value;
      }),
      request(),
    );
    expect(result).toMatchObject({
      status: "invalid_model",
      diagnostics: [expect.objectContaining({ code })],
    });
  });

  it("rejects duplicate IDs, invalid schedules, and ambiguous equal-order operations", () => {
    expect(
      compileInvestments(
        fixture(),
        request({
          transferInstructions: [transfer],
          purchaseInstructions: [{ ...purchase, id: transfer.id }],
        }),
      ),
    ).toMatchObject({
      status: "invalid_model",
      diagnostics: [
        expect.objectContaining({ code: "INVESTMENT_INSTRUCTION_ID_INVALID" }),
      ],
    });
    expect(
      compileInvestments(
        fixture(),
        request({
          transferInstructions: [
            {
              ...transfer,
              schedule: { kind: "explicit_dates", dates: ["2025-12-31"] },
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: "invalid_model",
      diagnostics: [
        expect.objectContaining({ code: "INVESTMENT_SCHEDULE_INVALID" }),
      ],
    });
    expect(
      compileInvestments(
        fixture(),
        request({
          transferInstructions: [transfer],
          purchaseInstructions: [{ ...purchase, order: transfer.order }],
        }),
      ),
    ).toMatchObject({
      status: "invalid_model",
      diagnostics: [
        expect.objectContaining({
          code: "INVESTMENT_OPERATION_ORDER_AMBIGUOUS",
        }),
      ],
    });
  });

  it("requires a price for nonzero positions, permits the zero derived default, and gates contribution limits", () => {
    const missing = compileInvestments(
      fixture((draft) => {
        delete draft.objects.Investment![0]!.price;
      }),
      request(),
    );
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVESTMENT_PRICE_REQUIRED" }),
    );
    const zero = compileInvestments(
      fixture((draft) => {
        draft.objects.Investment![0]!.quantity = "0";
        delete draft.objects.Investment![0]!.price;
        delete draft.objects.Investment![0]!.market_value;
      }),
      request(),
    );
    expect(zero.status).toBe("compiled");
    const limit = compileInvestments(
      fixture((draft) => {
        draft.objects.TaxRule = [{ tax_rule_id: ids.rule }];
        draft.objects.Account![1]!.contribution_limit_rule_id = ids.rule;
      }),
      request({ purchaseInstructions: [purchase] }),
    );
    expect(limit.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ACCOUNT_CONTRIBUTION_LIMIT_UNSUPPORTED",
      }),
    );
  });

  it("preserves VS3 atomic rollback and exposes the Personal-MVP investment read model", () => {
    const tooLarge = { ...purchase, amount: "2000.00" };
    const failed = compileInvestments(
      fixture(),
      request({ purchaseInstructions: [tooLarge] }),
    );
    expect(failed.status).toBe("compiled");
    if (failed.status !== "compiled") return;
    const run = runVerticalSlice3({
      runContext: context(),
      input: failed.value.input,
      openingState: failed.value.openingState,
      primitiveState: failed.value.primitiveState,
      months: 2,
    });
    expect(run.status).toBe("incomplete");
    expect(run.periods).toHaveLength(0);
    expect(
      run.state.positions[ids.investment]!.quantity.amount.toString(),
    ).toBe("10");
    const read = runPersonalForecast(fixture(), {
      scope: "investments",
      baseCurrency: "USD",
      asOf: "2026-01-01",
      dataCutoff: "2026-01-01",
      simulationStart: "2026-01-01",
      simulationEnd: "2026-03-01",
      months: 2,
      sameInstantCashFlowOrder: "income_before_expense",
      executionOwnerId: ids.person,
    });
    expect(read).toMatchObject({
      scope: "investments",
      status: "completed",
      points: expect.arrayContaining([
        expect.objectContaining({
          portfolioValue: expect.any(Object),
          contributionPrincipal: expect.any(Object),
          fees: expect.any(Object),
          unrealizedGain: expect.any(Object),
          realizedGain: expect.any(Object),
          cashInvestmentIncome: expect.any(Object),
          accountValues: expect.any(Array),
          traceIds: expect.any(Array),
        }),
      ]),
    });
  });
});
