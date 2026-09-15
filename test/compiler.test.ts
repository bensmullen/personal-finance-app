import { describe, expect, it } from "vitest";
import {
  compileCashFlow,
  compileCurrentPosition,
} from "../src/application/compiler/index.js";
import {
  comparePersonalCashFlowPlans,
  createGuidedSetupDraft,
  createSyntheticPersonalDraft,
  exportPersonalModelJson,
  importPersonalModelJson,
  type PersonalDraft,
  getCurrentPosition,
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
      "SCENARIO_STOCHASTIC_UNSUPPORTED",
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
        delete value.objects.Investment![0]!.price;
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
          (item) => item.code === "INVESTMENT_CURRENT_VALUATION_UNAVAILABLE",
        ),
      ).toBe(true);
    }
  });

  it("does not promote an exact zero investment price into a current valuation", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Investment![0]!.quantity = "2";
        value.objects.Investment![0]!.price = "0";
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") {
      expect(result.value.assets).toBeUndefined();
      expect(
        result.value.diagnostics.some(
          (item) => item.code === "INVESTMENT_CURRENT_VALUATION_UNAVAILABLE",
        ),
      ).toBe(true);
    }
  });

  it("keeps linked Investment valuation unavailable rather than using derived price", () => {
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
      expect(result.value.assets).toBeUndefined();
  });

  it("gates opening cash when authored Transaction history is not replayed", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Transaction = [
          {
            transaction_id: "97000000-0000-4000-8000-000000000001",
            source_account_id: "90000000-0000-4000-8000-000000000004",
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

  it("preflights malformed entries and duplicate aggregated identities", () => {
    const malformed = modelWith((value) => {
      value.objects.Asset!.push(
        "not-an-object" as unknown as Record<string, unknown>,
      );
    });
    expect(
      compileCurrentPosition(malformed, {
        baseCurrency: "USD",
        asOf: "2026-01-01",
      }).status,
    ).toBe("invalid_model");
    for (const collection of ["Liability", "Asset", "Investment"] as const) {
      const duplicate = modelWith((value) => {
        value.objects[collection]!.push({ ...value.objects[collection]![0]! });
      });
      expect(
        compileCurrentPosition(duplicate, {
          baseCurrency: "USD",
          asOf: "2026-01-01",
        }).status,
      ).toBe("invalid_model");
    }
  });

  it("rejects the inverse Household membership contradiction", () => {
    const result = compileCashFlow(
      modelWith((value) => {
        value.objects.Person!.push({
          person_id: "98000000-0000-4000-8000-000000000001",
          household_id: "90000000-0000-4000-8000-000000000002",
        });
      }),
      request,
    );
    expect(result.status).toBe("invalid_model");
    const establishedByMembers = compileCashFlow(
      modelWith((value) => {
        delete value.objects.Person![0]!.household_id;
      }),
      request,
    );
    expect(establishedByMembers.status).toBe("compiled");
  });

  it("preserves Person and Household Account ownership in opening state", () => {
    for (const owner of [
      "90000000-0000-4000-8000-000000000003",
      "90000000-0000-4000-8000-000000000002",
    ]) {
      const result = compileCashFlow(
        modelWith((value) => {
          value.objects.Account![0]!.owner_id = owner;
        }),
        request,
      );
      expect(result.status).toBe("compiled");
      if (result.status === "compiled")
        expect(
          Object.values(result.value.openingState.accounts)[0]!.ownerId,
        ).toBe(owner);
    }
  });

  it("defaults omitted simulation_count and gates valid scenario inheritance", () => {
    const omitted = compileCashFlow(
      modelWith((value) => {
        delete value.objects.Scenario![0]!.simulation_count;
      }),
      request,
    );
    expect(omitted.status).toBe("compiled");
    const inherited = compileCashFlow(
      modelWith((value) => {
        const baseId = "98000000-0000-4000-8000-000000000002";
        value.objects.Scenario!.push({
          scenario_id: baseId,
          enabled: false,
          stochastic: false,
          timestep: "monthly",
        });
        value.objects.Scenario![0]!.base_scenario_id = baseId;
      }),
      request,
    );
    expect(inherited.status).toBe("unsupported");
    if (inherited.status === "unsupported")
      expect(inherited.diagnostics[0]!.code).toBe(
        "SCENARIO_INHERITANCE_UNSUPPORTED",
      );
    const malformedCount = compileCashFlow(
      modelWith((value) => {
        value.objects.Scenario![0]!.simulation_count = "1";
      }),
      request,
    );
    expect(malformedCount.status).toBe("invalid_model");
    for (const base of ["bad", "98000000-0000-4000-8000-000000000099"]) {
      const result = compileCashFlow(
        modelWith((value) => {
          value.objects.Scenario![0]!.base_scenario_id = base;
        }),
        request,
      );
      expect(result.status).toBe("invalid_model");
    }
  });

  it("classifies cross-scenario growth and missing explicit membership as unsupported", () => {
    const other = "98000000-0000-4000-8000-000000000003";
    const cross = compileCashFlow(
      modelWith((value) => {
        value.objects.Scenario!.push({
          scenario_id: other,
          enabled: false,
          stochastic: false,
          timestep: "monthly",
        });
        value.objects.PrimitiveInstance![0]!.scenario_id = other;
      }),
      request,
    );
    expect(cross.status).toBe("unsupported");
    const missing = compileCashFlow(
      modelWith((value) => {
        value.objects.Scenario![0]!.assumption_ids = [];
      }),
      request,
    );
    expect(missing.status).toBe("unsupported");
    const crossAssumption = compileCashFlow(
      modelWith((value) => {
        value.objects.Scenario!.push({
          scenario_id: other,
          enabled: false,
          stochastic: false,
          timestep: "monthly",
        });
        value.objects.Assumption![0]!.scenario_id = other;
      }),
      request,
    );
    expect(crossAssumption.status).toBe("unsupported");
  });

  it("rejects P08 rates at or below -1 and accepts a greater negative rate", () => {
    for (const rate of ["-1.0", "-1.01"]) {
      const result = compileCashFlow(
        modelWith((value) => {
          value.objects.Assumption![0]!.value = rate;
        }),
        request,
      );
      expect(result.status).toBe("invalid_model");
    }
    const valid = compileCashFlow(
      modelWith((value) => {
        value.objects.Assumption![0]!.value = "-0.5";
      }),
      request,
    );
    expect(valid.status).toBe("compiled");
  });

  it("classifies malformed and negative current values as invalid, but missing values as partial", () => {
    for (const price of ["not-exact", "-1"]) {
      const result = compileCurrentPosition(
        modelWith((value) => {
          value.objects.Investment![0]!.quantity = "2";
          value.objects.Investment![0]!.price = price;
        }),
        { baseCurrency: "USD", asOf: "2026-01-01" },
      );
      expect(result.status).toBe("compiled");
    }
    for (const cost of ["not-exact", "-1"]) {
      const result = compileCurrentPosition(
        modelWith((value) => {
          value.objects.Asset![0]!.acquisition_cost = cost;
        }),
        { baseCurrency: "USD", asOf: "2026-01-01" },
      );
      expect(result.status).toBe("invalid_model");
    }
    const missing = compileCurrentPosition(
      modelWith((value) => {
        delete value.objects.Asset![0]!.acquisition_cost;
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(missing.status).toBe("compiled");
    if (missing.status === "compiled")
      expect(missing.value.assets).toBeUndefined();
  });

  it("excludes future investment Accounts and gates already-closed positions", () => {
    const future = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Account![0]!.opening_date = "2026-02-01";
        value.objects.Investment![0]!.quantity = "2";
        value.objects.Investment![0]!.price = "10";
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(future.status).toBe("compiled");
    if (future.status === "compiled")
      expect(future.value.assets?.amount.toString()).toBe("350000");
    const closed = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Account![0]!.closing_date = "2026-01-01";
        value.objects.Investment![0]!.quantity = "2";
        value.objects.Investment![0]!.price = "10";
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(closed.status).toBe("compiled");
    if (closed.status === "compiled") {
      expect(closed.value.assets).toBeUndefined();
      expect(
        closed.value.diagnostics.some(
          (item) => item.code === "CLOSED_INVESTMENT_ACCOUNT_UNSUPPORTED",
        ),
      ).toBe(true);
    }
  });

  it("validates return models and detects uppercase Transaction references", () => {
    for (const returnModel of ["bad", "98000000-0000-4000-8000-000000000099"]) {
      const draft = modelWith((value) => {
        value.objects.Account![0]!.return_model_id = returnModel;
      });
      expect(compileCashFlow(draft, request).status).toBe("invalid_model");
      expect(
        compileCurrentPosition(draft, {
          baseCurrency: "USD",
          asOf: "2026-01-01",
        }).status,
      ).toBe("invalid_model");
    }
    const authored = modelWith((value) => {
      value.objects.Account![0]!.return_model_id =
        "90000000-0000-4000-8000-000000000012";
    });
    expect(compileCashFlow(authored, request).status).toBe("unsupported");
    const authoredCurrent = compileCurrentPosition(authored, {
      baseCurrency: "USD",
      asOf: "2026-01-01",
    });
    expect(authoredCurrent.status).toBe("compiled");
    if (authoredCurrent.status === "compiled")
      expect(authoredCurrent.value.cash).toBeUndefined();
    const transaction = modelWith((value) => {
      value.objects.Transaction = [
        {
          transaction_id: "98000000-0000-4000-8000-000000000004",
          source_account_id:
            "90000000-0000-4000-8000-000000000004".toUpperCase(),
        },
      ];
    });
    expect(compileCashFlow(transaction, request).status).toBe("unsupported");
    const current = compileCurrentPosition(transaction, {
      baseCurrency: "USD",
      asOf: "2026-01-01",
    });
    expect(current.status).toBe("compiled");
    if (current.status === "compiled")
      expect(current.value.cash).toBeUndefined();
    const malformedTransaction = modelWith((value) => {
      value.objects.Transaction = [
        {
          transaction_id: "98000000-0000-4000-8000-000000000007",
          source_account_id: "bad",
        },
      ];
    });
    expect(compileCashFlow(malformedTransaction, request).status).toBe(
      "invalid_model",
    );
    expect(
      compileCurrentPosition(malformedTransaction, {
        baseCurrency: "USD",
        asOf: "2026-01-01",
      }).status,
    ).toBe("invalid_model");
  });

  it("keeps fixed monthly metrics independent of unrelated Scenarios", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        delete value.objects.Income![0]!.growth_model_id;
        value.objects.Scenario!.push({
          scenario_id: "98000000-0000-4000-8000-000000000005",
          enabled: true,
          stochastic: false,
          timestep: "monthly",
        });
      }),
      { baseCurrency: "USD", asOf: "2026-02-01" },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") {
      expect(result.value.monthlyIncome?.amount.toString()).toBe("6000");
      expect(result.value.monthlySpending?.amount.toString()).toBe("4200");
    }
  });

  it("uses the latest occurred monthly anchor for current P08 growth", () => {
    const draft = modelWith((value) => {
      value.objects.Income![0]!.start_date = "2026-01-15";
    });
    const before = compileCurrentPosition(draft, {
      baseCurrency: "USD",
      asOf: "2026-02-01",
    });
    const after = compileCurrentPosition(draft, {
      baseCurrency: "USD",
      asOf: "2026-02-15",
    });
    expect(before.status).toBe("compiled");
    expect(after.status).toBe("compiled");
    if (before.status === "compiled" && after.status === "compiled") {
      expect(before.value.monthlyIncome?.amount.toString()).toBe("6000");
      expect(after.value.monthlyIncome?.amount.toString()).not.toBe("6000");
    }
    const ambiguous = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Income![0]!.start_date = "2026-01-29";
      }),
      { baseCurrency: "USD", asOf: "2026-02-01" },
    );
    expect(ambiguous.status).toBe("compiled");
    if (ambiguous.status === "compiled") {
      expect(ambiguous.value.monthlyIncome).toBeUndefined();
      expect(ambiguous.value.monthlySpending?.amount.toString()).toBe("4200");
    }
  });

  it("preserves typed compiler diagnostics through current and comparison facades", () => {
    const draft = modelWith((value) => {
      value.objects.Account![0]!.return_model_id = "bad";
    });
    const current = getCurrentPosition(draft, { baseCurrency: "USD", asOf: "2026-01-01" });
    expect(current.diagnostics[0]!.code).toBe("RETURN_MODEL_REFERENCE_INVALID");
    const partial = getCurrentPosition(
      modelWith((value) => {
        value.objects.Investment![0]!.quantity = "2";
        delete value.objects.Investment![0]!.price;
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(
      partial.diagnostics.some(
        (diagnostic) => diagnostic.code === "INVESTMENT_CURRENT_VALUATION_UNAVAILABLE",
      ),
    ).toBe(true);
    const comparison = comparePersonalCashFlowPlans(
      draft,
      {
        scope: "cash_flow",
        baseCurrency: "USD",
        asOf: "2026-01-01",
        dataCutoff: "2026-01-01",
        simulationStart: "2026-01-01",
        simulationEnd: "2026-04-01",
        months: 3,
        sameInstantCashFlowOrder: "income_before_expense",
      },
      "0.05",
    );
    expect(comparison.status).toBe("unavailable");
    expect(comparison.diagnostics[0]!.code).toBe(
      "RETURN_MODEL_REFERENCE_INVALID",
    );
  });

  it("classifies a valid in-scope non-cash payment Account as unsupported", () => {
    const result = compileCashFlow(
      modelWith((value) => {
        const id = "98000000-0000-4000-8000-000000000006";
        value.objects.Account!.push({
          ...value.objects.Account![0]!,
          account_id: id,
          account_type: "taxable_brokerage",
        });
        value.objects.Expense![0]!.payment_account_id = id;
      }),
      request,
    );
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported")
      expect(result.diagnostics[0]!.code).toBe(
        "PAYMENT_ACCOUNT_TYPE_UNSUPPORTED",
      );
  });

  it("makes guided setup cost-valued and the synthetic 3%-vs-5% comparison economic", () => {
    const guided = createGuidedSetupDraft({
      modelId: "99000000-0000-4000-8000-000000000001",
      householdId: "99000000-0000-4000-8000-000000000002",
      personId: "99000000-0000-4000-8000-000000000003",
      accountId: "99000000-0000-4000-8000-000000000004",
      incomeId: "99000000-0000-4000-8000-000000000005",
      assetId: "99000000-0000-4000-8000-000000000006",
      liabilityId: "99000000-0000-4000-8000-000000000007",
      expenseId: "99000000-0000-4000-8000-000000000008",
      householdName: "Household",
      monthlyIncome: "6000",
      openingCash: "5000",
      assetValue: "10000",
      debt: "1000",
      monthlySpending: "3000",
      startDate: "2026-01-01",
    });
    expect(
      (guided.objects.Asset![0] as Record<string, unknown>).valuation_method,
    ).toBe("cost");
    const position = compileCurrentPosition(guided, {
      baseCurrency: "USD",
      asOf: "2026-01-01",
    });
    expect(position.status).toBe("compiled");
    if (position.status === "compiled")
      expect(position.value.assets?.amount.toString()).toBe("15000");
    const comparison = comparePersonalCashFlowPlans(
      createSyntheticPersonalDraft(),
      {
        scope: "cash_flow",
        baseCurrency: "USD",
        asOf: "2026-01-01",
        dataCutoff: "2026-01-01",
        simulationStart: "2026-01-01",
        simulationEnd: "2026-07-01",
        months: 6,
        sameInstantCashFlowOrder: "income_before_expense",
      },
      "0.05",
    );
    expect(comparison.status).toBe("completed");
    expect(comparison.configurationDifferences).not.toHaveLength(0);
    expect(
      comparison.points.slice(1).some((point) => point.delta.exact !== "0"),
    ).toBe(true);
  });

  it("does not let future investment links suppress a current Asset", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Account![0]!.opening_date = "2026-02-01";
        value.objects.Investment![0]!.asset_id = "90000000-0000-4000-8000-000000000007";
        value.objects.Investment![0]!.quantity = "2";
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") expect(result.value.assets?.amount.toString()).toBe("350000");
  });

  it("excludes future liabilities and ignores currency-like extensions", () => {
    const result = compileCurrentPosition(
      modelWith((value) => {
        value.objects.Liability![0]!.origination_date = "2026-02-01";
        value.objects.Liability![0]!.currency = "EUR";
        value.objects.Liability![0]!.current_balance_currency = "EUR";
      }),
      { baseCurrency: "USD", asOf: "2026-01-01" },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled") expect(result.value.liabilities?.amount.toString()).toBe("0");
  });

  it("requires a boundary-derived monthly horizon and matching request months", () => {
    expect(compileCashFlow(createSyntheticPersonalDraft(), { ...request, months: 2 }).status).toBe("invalid_model");
    expect(compileCashFlow(createSyntheticPersonalDraft(), { ...request, simulationStart: "2026-01-02" }).status).toBe("invalid_model");
    const valid = compileCashFlow(createSyntheticPersonalDraft(), { ...request, months: 3 });
    expect(valid.status).toBe("compiled");
    if (valid.status === "compiled") expect(valid.value.executionMonths).toBe(3);
  });
});
