import { describe, expect, it } from "vitest";
import {
  compileCashFlow,
  compileCurrentPosition,
} from "../src/application/compiler/index.js";
import {
  createSyntheticPersonalDraft,
  exportPersonalModelJson,
  importPersonalModelJson,
  type PersonalDraft,
} from "../src/application/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { runVerticalSlice2 } from "../src/simulation/verticalSlice2.js";
import { createFundingPolicy, fundingPolicyId } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant } from "../src/time/index.js";
import { Currency, Rate, money, rateConvention } from "../src/values/index.js";

const request = {
  baseCurrency: "USD",
  simulationStart: "2026-01-01",
  simulationEnd: "2026-04-01",
  sameInstantCashFlowOrder: "income_before_expense" as const,
};

const mutable = (draft: PersonalDraft) =>
  structuredClone(draft) as unknown as {
    modelFormatVersion: string;
    financialSpecificationVersion: string;
    modelId: PersonalDraft["modelId"];
    objects: Record<string, Record<string, unknown>[]>;
  };

const modelWith = (
  change: (value: ReturnType<typeof mutable>) => void,
): PersonalDraft => {
  const value = mutable(createSyntheticPersonalDraft());
  change(value);
  return value as unknown as PersonalDraft;
};

const execute = (draft: PersonalDraft) => {
  const compiled = compileCashFlow(draft, request);
  expect(compiled.status).toBe("compiled");
  if (compiled.status !== "compiled")
    throw new Error("fixture did not compile");
  return {
    compiled,
    result: runVerticalSlice2({
      input: compiled.value.input,
      openingState: compiled.value.openingState,
      months: 3,
      runContext: createRunContext({
        runId: runId("91000000-0000-4000-8000-000000000001"),
        scenarioId: scenarioId(compiled.value.scenarioIdentity),
        asOf: instant("2026-01-01T00:00:00.000Z"),
        dataCutoff: instant("2026-01-01T00:00:00.000Z"),
        simulationStart: instant("2026-01-01T00:00:00.000Z"),
        simulationEnd: instant("2026-04-01T00:00:00.000Z"),
        baseCurrency: compiled.value.input.baseCurrency,
      }),
    }),
  };
};

describe("canonical executable-model compiler", () => {
  it("is execution-equivalent to an independently authored direct VS2 fixture", () => {
    const draft = modelWith((value) => {
      delete value.objects.Income![0]!.growth_model_id;
      value.objects.Scenario = [];
      value.objects.Assumption = [];
      value.objects.PrimitiveInstance = [];
    });
    const compiled = compileCashFlow(draft, request);
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled")
      throw new Error("fixture did not compile");
    const currency = Currency.of("USD");
    const householdId = domainId(
      "household",
      "90000000-0000-4000-8000-000000000002",
    );
    const ownerId = domainId("person", "90000000-0000-4000-8000-000000000003");
    const accountId = domainId(
      "account",
      "90000000-0000-4000-8000-000000000004",
    );
    const payableId = domainId(
      "liability",
      "f15c0000-0000-4000-8001-000000000006",
    );
    const funding = createFundingPolicy({
      id: fundingPolicyId(`compiler:explicit-payment-account:${accountId}`),
      orderedSources: [{ kind: "cash_account", accountId }],
      allowPartial: false,
      insufficientFundsBehavior: "unfunded",
    });
    const directInput = {
      householdId,
      ownerId,
      cashAccountId: accountId,
      expensePayableLiabilityId: payableId,
      baseCurrency: currency,
      sameInstantCashFlowOrder: "income_before_expense" as const,
      events: [],
      incomes: [
        {
          id: domainId("income", "90000000-0000-4000-8000-000000000005"),
          ownerId,
          depositAccountId: accountId,
          baseMonthlyAmount: money("6000", currency),
          start: instant("2026-01-01T00:00:00.000Z"),
          recurrence: {
            kind: "utc_monthly" as const,
            anchor: instant("2026-01-01T00:00:00.000Z"),
            invalidDayPolicy: "skip" as const,
          },
          growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
          growthBaseAt: instant("2026-01-01T00:00:00.000Z"),
          primitiveIds: {
            growth: domainId(
              "primitive-instance",
              "f15c0000-0000-4000-8001-000000000005",
            ),
            recurrence: domainId(
              "primitive-instance",
              "f15c0000-0000-4000-8001-000000000004",
            ),
          },
        },
      ],
      expenses: [
        {
          id: domainId("expense", "90000000-0000-4000-8000-000000000006"),
          ownerId: householdId,
          paymentAccountId: accountId,
          payableLiabilityId: payableId,
          baseMonthlyAmount: money("4200", currency),
          start: instant("2026-01-01T00:00:00.000Z"),
          recurrence: {
            kind: "utc_monthly" as const,
            anchor: instant("2026-01-01T00:00:00.000Z"),
            invalidDayPolicy: "skip" as const,
          },
          inflationRate: Rate.fromDecimal(
            "0",
            rateConvention.effectiveAnnual(),
          ),
          inflationBaseAt: instant("2026-01-01T00:00:00.000Z"),
          fundingPolicy: funding,
          primitiveIds: {
            indexGrowth: domainId(
              "primitive-instance",
              "f15c0000-0000-4000-8001-000000000003",
            ),
            inflationLink: domainId(
              "primitive-instance",
              "f15c0000-0000-4000-8001-000000000001",
            ),
            recurrence: domainId(
              "primitive-instance",
              "f15c0000-0000-4000-8001-000000000002",
            ),
          },
        },
      ],
    };
    const directState = createAuthoritativeState({
      accounts: {
        [accountId]: {
          id: accountId,
          kind: "checking",
          ownerId,
          cash: money("5000", currency),
        },
      },
      liabilities: {
        [payableId]: { id: payableId, balance: money("0", currency) },
      },
    });
    const context = createRunContext({
      runId: runId("95000000-0000-4000-8000-000000000001"),
      scenarioId: scenarioId("f15c0000-0000-4000-8000-000000000001"),
      asOf: instant("2026-01-01T00:00:00.000Z"),
      dataCutoff: instant("2026-01-01T00:00:00.000Z"),
      simulationStart: instant("2026-01-01T00:00:00.000Z"),
      simulationEnd: instant("2026-04-01T00:00:00.000Z"),
      baseCurrency: currency,
    });
    const direct = runVerticalSlice2({
      input: directInput,
      openingState: directState,
      runContext: context,
      months: 3,
    });
    const translated = runVerticalSlice2({
      input: compiled.value.input,
      openingState: compiled.value.openingState,
      runContext: context,
      months: 3,
    });
    const financial = (result: typeof direct) =>
      result.periods.map((period) => ({
        income: period.recurringIncomeRecognized.amount.toString(),
        expense: period.recurringExpenseRecognized.amount.toString(),
        cash: period.endingCash.amount.toString(),
        shortfall: period.liquidityShortfalls.map((item) =>
          item.shortfallAmount.amount.toString(),
        ),
      }));
    expect(financial(translated)).toEqual(financial(direct));
  });

  it("executes authored effective-annual salary growth with assumption lineage", () => {
    const { compiled, result } = execute(createSyntheticPersonalDraft());
    expect(result.periods[0]!.recurringIncomeRecognized.amount.toString()).toBe(
      "6000",
    );
    expect(
      result.periods[1]!.recurringIncomeRecognized.amount.toString(),
    ).not.toBe("6000");
    expect(compiled.value.input.incomes[0]!.primitiveIds.growth).toBe(
      "90000000-0000-4000-8000-000000000012",
    );
    expect(
      result.periods[1]!.incomeOccurrences[0]!.traceRefs.flatMap(
        (ref) => ref.assumptionIds ?? [],
      ),
    ).toContain("90000000-0000-4000-8000-000000000010");
  });

  it("executes explicit P08 inflation for expenses and rejects expense_growth equivalence", () => {
    const inflationId = "96000000-0000-4000-8000-000000000001";
    const primitiveId = "96000000-0000-4000-8000-000000000002";
    const draft = modelWith((value) => {
      value.objects.Assumption!.push({
        assumption_id: inflationId,
        name: "Inflation",
        category: "inflation",
        value: "0.06",
        unit: "effective annual rate",
        source: "user",
        scenario_id: "90000000-0000-4000-8000-000000000011",
      });
      (value.objects.Scenario![0]!.assumption_ids as string[]).push(
        inflationId,
      );
      value.objects.PrimitiveInstance!.push({
        primitive_instance_id: primitiveId,
        primitive_id: "P08",
        input_bindings: { rate: inflationId },
        parameters: {},
        scenario_id: "90000000-0000-4000-8000-000000000011",
        enabled: true,
      });
      value.objects.Expense![0]!.growth_model_id = primitiveId;
    });
    const { result } = execute(draft);
    expect(
      result.periods[1]!.recurringExpenseRecognized.amount.toString(),
    ).not.toBe("4200");
    expect(
      result.periods[1]!.expenseOccurrences[0]!.traceRefs.flatMap(
        (ref) => ref.assumptionIds ?? [],
      ),
    ).toContain(inflationId);
    const rejected = compileCashFlow(
      modelWith((value) => {
        value.objects.Assumption![0]!.category = "expense_growth";
        value.objects.Expense![0]!.growth_model_id =
          value.objects.PrimitiveInstance![0]!.primitive_instance_id;
        delete value.objects.Income![0]!.growth_model_id;
      }),
      request,
    );
    expect(rejected.status).toBe("unsupported");
    if (rejected.status === "unsupported")
      expect(rejected.diagnostics[0]!.code).toBe("GROWTH_CATEGORY_UNSUPPORTED");
  });

  it("maps inclusive canonical end dates to an exclusive next-day runtime boundary", () => {
    const draft = modelWith((value) => {
      value.objects.Income![0]!.end_date = "2026-02-01";
    });
    const { compiled, result } = execute(draft);
    expect(compiled.value.input.incomes[0]!.end).toBe(
      "2026-02-02T00:00:00.000Z",
    );
    expect(
      result.periods.map((period) =>
        period.recurringIncomeRecognized.amount.toString(),
      ),
    ).toEqual(["6000", expect.not.stringMatching(/^0(?:\.0+)?$/), "0"]);
  });

  it("keeps adapter identities and behavior stable when canonical arrays are reordered", () => {
    const extra = modelWith((value) => {
      const income: Record<string, unknown> = {
        ...value.objects.Income![0]!,
        income_id: "92000000-0000-4000-8000-000000000001",
      };
      delete income.growth_model_id;
      income.amount = "100";
      income.start_date = "2026-01-02";
      value.objects.Income!.push(income);
    });
    const reversed = modelWith((value) => {
      const income: Record<string, unknown> = {
        ...value.objects.Income![0]!,
        income_id: "92000000-0000-4000-8000-000000000001",
      };
      delete income.growth_model_id;
      income.amount = "100";
      income.start_date = "2026-01-02";
      value.objects.Income = [income, value.objects.Income![0]!];
    });
    const left = compileCashFlow(extra, request);
    const right = compileCashFlow(reversed, request);
    expect(left.status).toBe("compiled");
    expect(right.status).toBe("compiled");
    if (left.status === "compiled" && right.status === "compiled") {
      expect(left.value.input.incomes.map((income) => income.id)).toEqual(
        right.value.input.incomes.map((income) => income.id),
      );
      expect(
        left.value.input.incomes.map((income) => income.primitiveIds),
      ).toEqual(right.value.input.incomes.map((income) => income.primitiveIds));
    }
  });

  it.each([
    [
      "weekly recurrence",
      (value: ReturnType<typeof mutable>) => {
        value.objects.Income![0]!.frequency = "weekly";
      },
      "RECURRENCE_UNSUPPORTED",
    ],
    [
      "ambiguous monthly anchor",
      (value: ReturnType<typeof mutable>) => {
        value.objects.Income![0]!.start_date = "2026-01-31";
      },
      "MONTHLY_ANCHOR_UNSUPPORTED",
    ],
    [
      "stochastic scenario",
      (value: ReturnType<typeof mutable>) => {
        value.objects.Scenario![0]!.stochastic = true;
      },
      "SCENARIO_SELECTION_AMBIGUOUS",
    ],
    [
      "unsupported primitive",
      (value: ReturnType<typeof mutable>) => {
        value.objects.PrimitiveInstance![0]!.primitive_id = "P23";
      },
      "GROWTH_PRIMITIVE_UNSUPPORTED",
    ],
    [
      "unsupported rate unit",
      (value: ReturnType<typeof mutable>) => {
        value.objects.Assumption![0]!.unit = "nominal annual rate";
      },
      "RATE_UNIT_UNSUPPORTED",
    ],
  ])("returns typed unsupported for %s", (_name, change, code) => {
    const result = compileCashFlow(modelWith(change), request);
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported")
      expect(result.diagnostics[0]!.code).toBe(code);
  });

  it("distinguishes broken references from unsupported semantics", () => {
    const broken = compileCashFlow(
      modelWith((value) => {
        value.objects.Income![0]!.growth_model_id =
          "93000000-0000-4000-8000-000000000001";
      }),
      request,
    );
    expect(broken.status).toBe("invalid_model");
    const ambiguous = compileCashFlow(
      modelWith((value) => {
        value.objects.Household!.push({
          ...value.objects.Household![0]!,
          household_id: "93000000-0000-4000-8000-000000000002",
          members: [],
        });
      }),
      request,
    );
    expect(ambiguous.status).toBe("unsupported");
  });

  it("gates competing same-time expenses instead of synthesizing priority", () => {
    const result = compileCashFlow(
      modelWith((value) => {
        value.objects.Expense!.push({
          ...value.objects.Expense![0]!,
          expense_id: "94000000-0000-4000-8000-000000000001",
        });
      }),
      request,
    );
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported")
      expect(result.diagnostics[0]!.code).toBe(
        "SAME_INSTANT_EXPENSE_PRIORITY_UNDEFINED",
      );
  });

  it("uses only the explicit payment account and leaves liquidity shortfall as output", () => {
    const { compiled, result } = execute(
      modelWith((value) => {
        value.objects.Expense![0]!.amount = "20000";
      }),
    );
    expect(compiled.value.input.expenses[0]!.fundingPolicy).toEqual(
      expect.objectContaining({
        allowPartial: false,
        insufficientFundsBehavior: "unfunded",
        orderedSources: [
          {
            kind: "cash_account",
            accountId: "90000000-0000-4000-8000-000000000004",
          },
        ],
      }),
    );
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.liquidityShortfalls).toHaveLength(1);
  });

  it("compiles the synthetic current position exactly", () => {
    const result = compileCurrentPosition(createSyntheticPersonalDraft(), {
      baseCurrency: "USD",
      asOf: "2026-01-01",
    });
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") {
      expect(result.value.cash?.amount.toString()).toBe("5000");
      expect(result.value.assets?.amount.toString()).toBe("355000");
      expect(result.value.liabilities?.amount.toString()).toBe("235000");
      expect(result.value.netWorth?.amount.toString()).toBe("120000");
    }
  });

  it("keeps independent current metrics when a positive investment lacks price", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Investment![0]!.quantity = "2";
        value.objects.Investment![0]!.price = "0";
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") {
      expect(result.value.cash?.amount.toString()).toBe("5000");
      expect(result.value.liabilities?.amount.toString()).toBe("235000");
      expect(result.value.assets).toBeUndefined();
      expect(result.value.netWorth).toBeUndefined();
      expect(
        result.value.diagnostics.some(
          (item) => item.code === "INVESTMENT_PRICE_UNAVAILABLE",
        ),
      ).toBe(true);
    }
  });

  it("does not double count an Investment and its linked Asset representation", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Investment![0]!.quantity = "2";
        value.objects.Investment![0]!.price = "10";
        value.objects.Investment![0]!.asset_id =
          "90000000-0000-4000-8000-000000000007";
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled")
      expect(result.value.assets?.amount.toString()).toBe("5020");
  });

  it("gates opening cash when authored Transaction history is not replayed", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Transaction = [
          {
            transaction_id: "97000000-0000-4000-8000-000000000001",
            account_id: "90000000-0000-4000-8000-000000000004",
          },
        ];
        value.objects.Account![0]!.transaction_ids = [
          "97000000-0000-4000-8000-000000000001",
        ];
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") {
      expect(result.value.cash).toBeUndefined();
      expect(result.value.assets).toBeUndefined();
      expect(result.value.liabilities?.amount.toString()).toBe("235000");
    }
  });

  it("flows either explicit same-instant ordering value into VS2", () => {
    for (const sameInstantCashFlowOrder of [
      "income_before_expense",
      "expense_before_income",
    ] as const) {
      const result = compileCashFlow(createSyntheticPersonalDraft(), {
        ...request,
        sameInstantCashFlowOrder,
      });
      expect(result.status).toBe("compiled");
      if (result.status === "compiled")
        expect(result.value.input.sameInstantCashFlowOrder).toBe(
          sameInstantCashFlowOrder,
        );
    }
  });

  it("preserves compiler-only PrimitiveInstance collections across portable export/import", () => {
    const draft = createSyntheticPersonalDraft();
    expect(
      importPersonalModelJson(exportPersonalModelJson(draft)).objects
        .PrimitiveInstance,
    ).toEqual(draft.objects.PrimitiveInstance);
  });
});
