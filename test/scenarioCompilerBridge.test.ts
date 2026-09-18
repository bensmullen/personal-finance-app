import { describe, expect, it } from "vitest";
import {
  compileCashFlow,
  compileExecutableScenario,
  compileInvestments,
  compileLiabilities,
  type InvestmentCompilerRequest,
  type LiabilityCompilerRequest,
} from "../src/application/compiler/index.js";
import {
  createGuidedSetupDraft,
  createSyntheticPersonalDraft,
  type PersonalDraft,
} from "../src/application/personalMvp.js";

const rootId = "90000000-0000-4000-8000-000000000011";
const childId = "91000000-0000-4000-8000-000000000011";
const alternativeId = "92000000-0000-4000-8000-000000000011";
const cashRequest = {
  baseCurrency: "USD",
  simulationStart: "2026-01-01",
  simulationEnd: "2026-04-01",
  months: 3,
  sameInstantCashFlowOrder: "income_before_expense" as const,
};
type Mutable = { objects: Record<string, Record<string, unknown>[]> };
const mutate = (change: (draft: Mutable) => void): PersonalDraft => {
  const draft = structuredClone(
    createSyntheticPersonalDraft(),
  ) as unknown as Mutable;
  change(draft);
  return draft as unknown as PersonalDraft;
};

describe("PR 19 compiler scenario bridge", () => {
  it("validates exact canonical rate assumptions and rejects unsupported stochastic or bounded semantics", () => {
    const assumption = "95000000-0000-4000-8000-000000000001";
    const modelWith = (extras: Record<string, unknown> = {}) => mutate((draft) => {
      draft.objects.Scenario!.push({ ...draft.objects.Scenario![0]!, scenario_id: alternativeId, name: "Alternative", base_scenario_id: rootId, assumption_ids: [assumption] });
      draft.objects.Assumption!.push({ assumption_id: assumption, name: "Growth", category: "salary_growth", value: "0.0500", unit: "effective annual rate", source: "user", scenario_id: alternativeId, ...extras });
    });
    const compile = (model: PersonalDraft) => {
      const base = compileCashFlow(model, cashRequest);
      expect(base, JSON.stringify(base)).toMatchObject({ status: "compiled" });
      if (base.status !== "compiled") return base;
      return compileExecutableScenario(model, { scope: "cash_flow", compiled: base.value }, { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" }, { scenarioId: alternativeId, baseScenarioId: rootId, name: "Alternative", changes: [{ kind: "income_growth", incomeId: "90000000-0000-4000-8000-000000000005", annualRate: "0.05", assumptionId: assumption }] });
    };
    expect(compile(modelWith())).toMatchObject({ status: "compiled" });
    for (const extras of [{ correlation_group: "market" }, { start_date: "2026-02-01" }, { distribution_type: "normal", distribution_parameters: { mean: "0.05" } }])
      expect(compile(modelWith(extras))).toMatchObject({ status: "unsupported", diagnostics: [{ code: "SCENARIO_ASSUMPTION_SEMANTICS_UNSUPPORTED" }] });
  });
  it("selects roots independently of enabled children and rejects a child as an explicit base", () => {
    const model = mutate((draft) =>
      draft.objects.Scenario!.push({
        ...draft.objects.Scenario![0]!,
        scenario_id: childId,
        name: "Child",
        base_scenario_id: rootId,
      }),
    );
    expect(compileCashFlow(model, cashRequest)).toMatchObject({
      status: "compiled",
      value: { scenarioIdentity: rootId },
    });
    expect(
      compileCashFlow(model, { ...cashRequest, scenarioId: rootId }),
    ).toMatchObject({ status: "compiled" });
    expect(
      compileCashFlow(model, { ...cashRequest, scenarioId: childId }),
    ).toMatchObject({
      status: "unsupported",
      diagnostics: [{ code: "SCENARIO_CHILD_AS_BASE_UNSUPPORTED" }],
    });
    const reversed = structuredClone(model) as unknown as Mutable;
    reversed.objects.Scenario!.reverse();
    expect(compileCashFlow(reversed as unknown as PersonalDraft, cashRequest)).toMatchObject({
      status: "compiled",
      value: { scenarioIdentity: rootId },
    });
    const malformedChild = mutate((draft) => draft.objects.Scenario!.push({
      ...draft.objects.Scenario![0]!, scenario_id: childId, name: "Malformed child", base_scenario_id: rootId, stochastic: false, simulation_count: 2,
    }));
    expect(compileCashFlow(malformedChild, cashRequest)).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "SCENARIO_DETERMINISTIC_COUNT_INVALID" }] });
  });

  it("keeps synthetic-root compatibility and reports root ambiguity and bounds", () => {
    const noScenario = createGuidedSetupDraft({
      modelId: "10000000-0000-4000-8000-000000000001",
      householdId: "10000000-0000-4000-8000-000000000002",
      personId: "10000000-0000-4000-8000-000000000003",
      accountId: "10000000-0000-4000-8000-000000000004",
      incomeId: "10000000-0000-4000-8000-000000000005",
      assetId: "10000000-0000-4000-8000-000000000006",
      liabilityId: "10000000-0000-4000-8000-000000000007",
      expenseId: "10000000-0000-4000-8000-000000000008",
      householdName: "Test",
      monthlyIncome: "1000",
      openingCash: "1000",
      assetValue: "0",
      debt: "0",
      monthlySpending: "100",
      startDate: "2026-01-01",
    });
    expect(compileCashFlow(noScenario, cashRequest)).toMatchObject({
      status: "compiled",
    });
    const ambiguous = mutate((draft) =>
      draft.objects.Scenario!.push({
        ...draft.objects.Scenario![0]!,
        scenario_id: childId,
        name: "Other root",
      }),
    );
    expect(compileCashFlow(ambiguous, cashRequest)).toMatchObject({
      status: "unsupported",
      diagnostics: [{ code: "SCENARIO_BASE_AMBIGUOUS" }],
    });
    const malformedRoot = mutate((draft) => { draft.objects.Scenario![0]!.stochastic = false; draft.objects.Scenario![0]!.simulation_count = 2; });
    expect(compileCashFlow(malformedRoot, cashRequest)).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "SCENARIO_DETERMINISTIC_COUNT_INVALID" }] });
    expect(
      compileCashFlow(createSyntheticPersonalDraft(), {
        ...cashRequest,
        simulationStart: "2037-01-01",
        simulationEnd: "2037-04-01",
      }),
    ).toMatchObject({
      status: "unsupported",
      diagnostics: [{ code: "SCENARIO_OUTSIDE_REQUESTED_HORIZON" }],
    });
  });

  it("maps explicit cash-flow targets, preserves funding order, and rejects mixed scopes", () => {
    const compiled = compileCashFlow(
      createSyntheticPersonalDraft(),
      cashRequest,
    );
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    const incomeId = String(compiled.value.input.incomes[0]!.id);
    const expenseId = String(compiled.value.input.expenses[0]!.id);
    const accountId = String(compiled.value.input.cashAccountId);
    const income = compileExecutableScenario(
      createSyntheticPersonalDraft(),
      { scope: "cash_flow", compiled: compiled.value },
      { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
      {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Earn more",
        changes: [{ kind: "income_growth", incomeId, annualRate: "0.06" }],
      },
    );
    expect(income).toMatchObject({
      status: "compiled",
      value: { changes: [{ kind: "income_growth", incomeId }] },
    });
    const normalizedRate = compileExecutableScenario(createSyntheticPersonalDraft(), { scope: "cash_flow", compiled: compiled.value }, { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" }, { scenarioId: alternativeId, baseScenarioId: rootId, name: "Equivalent", changes: [{ annualRate: "0.0600", incomeId: incomeId.toUpperCase(), kind: "income_growth" }] });
    expect(normalizedRate.status).toBe("compiled");
    if (income.status === "compiled" && normalizedRate.status === "compiled") expect(normalizedRate.value.changes[0]).toMatchObject({ assumptionId: (income.value.changes[0] as { assumptionId: string }).assumptionId });
    expect(
      compileExecutableScenario(
        createSyntheticPersonalDraft(),
        { scope: "cash_flow", compiled: compiled.value },
        { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
        {
          scenarioId: alternativeId,
          baseScenarioId: rootId,
          name: "Spend more",
          changes: [
            { kind: "expense_inflation", expenseId, annualRate: "0.04" },
          ],
        },
      ),
    ).toMatchObject({
      status: "compiled",
      value: { changes: [{ kind: "expense_inflation", expenseId }] },
    });
    expect(
      compileExecutableScenario(
        createSyntheticPersonalDraft(),
        { scope: "cash_flow", compiled: compiled.value },
        { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
        {
          scenarioId: alternativeId,
          baseScenarioId: rootId,
          name: "Bad binding",
          changes: [
            {
              kind: "income_growth",
              incomeId,
              annualRate: "0.06",
              assumptionId: "90000000-0000-4000-8000-000000000010",
            },
          ],
        },
      ),
    ).toMatchObject({
      status: "invalid_model",
      diagnostics: [{ code: "SCENARIO_ASSUMPTION_MEMBERSHIP_INVALID" }],
    });
    const funding = compileExecutableScenario(
      createSyntheticPersonalDraft(),
      { scope: "cash_flow", compiled: compiled.value },
      { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
      {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Funding",
        changes: [
          {
            kind: "expense_funding_policy",
            expenseId,
            policy: {
              id: "what-if-funding",
              orderedAccountIds: [accountId],
              allowPartial: false,
              insufficientFundsBehavior: "unfunded",
            },
          },
        ],
      },
    );
    expect(funding.status).toBe("compiled");
    if (funding.status === "compiled")
      expect(funding.value.changes[0]).toMatchObject({
        fundingPolicy: { orderedSources: [{ accountId }] },
      });
    expect(compileExecutableScenario(createSyntheticPersonalDraft(), { scope: "cash_flow", compiled: compiled.value }, { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" }, { scenarioId: alternativeId, baseScenarioId: rootId, name: "Collision", changes: [{ kind: "expense_funding_policy", expenseId, assumptionId: accountId, policy: { id: "collision", orderedAccountIds: [accountId], allowPartial: false, insufficientFundsBehavior: "unfunded" } }] })).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "SCENARIO_LINEAGE_ID_COLLISION" }] });
    expect(
      compileExecutableScenario(
        createSyntheticPersonalDraft(),
        { scope: "cash_flow", compiled: compiled.value },
        { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
        {
          scenarioId: alternativeId,
          baseScenarioId: rootId,
          name: "Mixed",
          changes: [
            { kind: "income_growth", incomeId, annualRate: "0.06" },
            {
              kind: "investment_return",
              investmentId: "90000000-0000-4000-8000-000000000009",
              annualRate: "0.08",
            },
          ],
        },
      ),
    ).toMatchObject({
      status: "unsupported",
      diagnostics: [{ code: "SCENARIO_REQUIRES_RECONCILED_PROJECTION" }],
    });
  });

  it("requires an explicit retirement termination binding and keeps explanatory identity distinct", () => {
    const eventId = "93000000-0000-4000-8000-000000000001";
    const model = mutate((draft) => {
      (draft.objects.Scenario![0]!.event_ids as string[]).push(eventId);
      draft.objects.Event = [
        {
          event_id: eventId,
          name: "Retire",
          event_type: "retirement",
          start_date: "2026-03-01",
          trigger_type: "scheduled",
          effect_ids: [],
          dependencies: [],
          precedence: 0,
          scenario_id: rootId,
          enabled: true,
        },
      ];
    });
    const incomeId = "90000000-0000-4000-8000-000000000005";
    const terminationEventId = "93000000-0000-4000-8000-000000000099";
    const missing = compileCashFlow(model, cashRequest);
    expect(missing.status).toBe("compiled");
    if (missing.status !== "compiled") return;
    expect(
      compileExecutableScenario(
        model,
        { scope: "cash_flow", compiled: missing.value },
        { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
        {
          scenarioId: alternativeId,
          baseScenarioId: rootId,
          name: "Retire",
          changes: [
            {
              kind: "retirement_date",
              incomeId,
              targetEventId: eventId,
              baselineDate: "2026-03-01",
              newDate: "2026-02-01",
            },
          ],
        },
      ),
    ).toMatchObject({
      status: "unsupported",
      diagnostics: [{ code: "RETIREMENT_BINDING_UNAVAILABLE" }],
    });
    const bound = compileCashFlow(model, {
      ...cashRequest,
      retirementBindings: [
        {
          incomeId,
          terminationEventId,
          canonicalEventId: eventId,
          baselineDate: "2026-03-01",
        },
      ],
    });
    expect(bound.status).toBe("compiled");
    const unsupportedEvent = structuredClone(model) as unknown as Mutable;
    unsupportedEvent.objects.Event![0]!.precedence = 1;
    expect(compileCashFlow(unsupportedEvent as unknown as PersonalDraft, { ...cashRequest, retirementBindings: [{ incomeId, terminationEventId, canonicalEventId: eventId, baselineDate: "2026-03-01" }] })).toMatchObject({ status: "unsupported", diagnostics: [{ code: "RETIREMENT_BINDING_EVENT_SEMANTICS_UNSUPPORTED" }] });
    const outOfScope = structuredClone(model) as unknown as Mutable;
    const otherPersonId = "93000000-0000-4000-8000-000000000097";
    const otherIncomeId = "93000000-0000-4000-8000-000000000098";
    outOfScope.objects.Person!.push({ ...outOfScope.objects.Person![0]!, person_id: otherPersonId, household_id: null });
    outOfScope.objects.Income!.push({ ...outOfScope.objects.Income![0]!, income_id: otherIncomeId, owner_id: otherPersonId });
    expect(compileCashFlow(outOfScope as unknown as PersonalDraft, { ...cashRequest, retirementBindings: [{ incomeId: otherIncomeId, terminationEventId: "93000000-0000-4000-8000-000000000096", baselineDate: "2026-03-01" }] })).toMatchObject({ status: "unsupported", diagnostics: [{ code: "RETIREMENT_BINDING_TARGET_UNEXECUTABLE" }] });
    if (bound.status !== "compiled") return;
    const scenario = compileExecutableScenario(
      model,
      { scope: "cash_flow", compiled: bound.value },
      { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
      {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Retire",
        changes: [
          {
            kind: "retirement_date",
            incomeId,
              targetEventId: terminationEventId,
            baselineDate: "2026-03-01",
            newDate: "2026-02-01",
          },
        ],
      },
    );
    expect(scenario.status).toBe("compiled");
    if (scenario.status === "compiled")
      expect(scenario.value.changes[0]).toMatchObject({
        kind: "retirement_date",
        targetEventId: terminationEventId,
        effectiveAt: "2026-02-01T00:00:00.000Z",
      });
  });

  it("maps canonical liabilities to generated loans and capability-gates missing fee targets", () => {
    const liabilityRequest: LiabilityCompilerRequest = {
      baseCurrency: "USD",
      asOf: "2026-01-01",
      simulationStart: "2026-01-01",
      simulationEnd: "2026-04-01",
      months: 3,
      executionOwnerId: "90000000-0000-4000-8000-000000000003",
      executionProfiles: [
        {
          liabilityId: "90000000-0000-4000-8000-000000000008",
          kind: "vs4_fixed_monthly_fully_amortizing",
          paymentAnchor: "2022-02-01",
          totalPayments: 360,
          fundingAccountId: "90000000-0000-4000-8000-000000000004",
          settlementPriority: 1,
          openingContractStatus: "current",
        },
      ],
    };
    const compiled = compileLiabilities(
      createSyntheticPersonalDraft(),
      liabilityRequest,
    );
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    const result = compileExecutableScenario(
      createSyntheticPersonalDraft(),
      {
        scope: "liabilities",
        compiled: compiled.value,
        compilerRequest: liabilityRequest,
      },
      { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
      {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Funding",
        changes: [
          {
            kind: "loan_funding_policy",
            liabilityId: "90000000-0000-4000-8000-000000000008",
            policy: {
              id: "loan-policy",
              orderedAccountIds: ["90000000-0000-4000-8000-000000000004"],
              allowPartial: false,
              insufficientFundsBehavior: "unfunded",
            },
          },
        ],
      },
    );
    expect(result.status).toBe("compiled");
    if (result.status === "compiled")
      expect(result.value.changes[0]).toMatchObject({
        kind: "loan_funding_policy",
        loanId: compiled.value.input.loans[0]!.id,
      });
  });

  it("maps investment returns and purchase list operations through the investment compiler", () => {
    const ids = {
      investment: "90000000-0000-4000-8000-000000000009",
      assumption: "94000000-0000-4000-8000-000000000001",
      primitive: "94000000-0000-4000-8000-000000000002",
      brokerage: "94000000-0000-4000-8000-000000000003",
      purchase: "94000000-0000-4000-8000-000000000004",
    };
    const model = mutate((draft) => {
      draft.objects.Income = [];
      draft.objects.Expense = [];
      draft.objects.Liability = [];
      draft.objects.Account![0] = {
        ...draft.objects.Account![0]!,
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
          name: "Return",
          category: "market_return",
          value: "0.12",
          unit: "effective annual rate",
          source: "user",
          scenario_id: rootId,
        },
      ];
      draft.objects.Scenario![0]!.assumption_ids = [ids.assumption];
      draft.objects.PrimitiveInstance = [
        {
          primitive_instance_id: ids.primitive,
          primitive_id: "P23",
          input_bindings: { rate: ids.assumption },
          parameters: {},
          scenario_id: rootId,
          enabled: true,
        },
      ];
    });
    const purchase = {
      id: ids.purchase,
      investmentId: ids.investment,
      sourceCashAccountId: "90000000-0000-4000-8000-000000000004",
      amount: "50.00",
      schedule: { kind: "explicit_dates" as const, dates: ["2026-01-05"] },
      order: 10,
      quantityRounding: { scale: 4, mode: "half_even" as const },
    };
    const request: InvestmentCompilerRequest = {
      baseCurrency: "USD",
      asOf: "2026-01-01",
      simulationStart: "2026-01-01",
      simulationEnd: "2026-03-01",
      months: 2,
      executionOwnerId: "90000000-0000-4000-8000-000000000003",
      transferInstructions: [],
      purchaseInstructions: [],
    };
    const compiled = compileInvestments(model, request);
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    const base = {
      scope: "investments" as const,
      compiled: compiled.value,
      compilerRequest: request,
    };
    const horizon = {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-03-01T00:00:00.000Z",
    };
    expect(
      compileExecutableScenario(model, base, horizon, {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Return",
        changes: [
          {
            kind: "investment_return",
            investmentId: ids.investment,
            annualRate: "0.2",
          },
        ],
      }),
    ).toMatchObject({
      status: "compiled",
      value: {
        changes: [{ kind: "investment_return", positionId: ids.investment }],
      },
    });
    const added = compileExecutableScenario(model, base, horizon, {
      scenarioId: alternativeId,
      baseScenarioId: rootId,
      name: "Buy",
      changes: [
        {
          kind: "investment_purchase",
          operation: "add",
          purchaseId: ids.purchase,
          investmentId: ids.investment,
          instruction: purchase,
        },
      ],
    });
    expect(added).toMatchObject({
      status: "compiled",
      value: {
        changes: [
          {
            kind: "investment_purchase",
            operation: "add",
            purchaseId: ids.purchase,
            purchase: { targetPositionId: ids.investment },
          },
        ],
      },
    });
    const withPurchase = compileInvestments(model, {
      ...request,
      purchaseInstructions: [purchase],
    });
    expect(withPurchase.status).toBe("compiled");
    if (withPurchase.status !== "compiled") return;
    const existingBase = {
      scope: "investments" as const,
      compiled: withPurchase.value,
      compilerRequest: { ...request, purchaseInstructions: [purchase] },
    };
    expect(
      compileExecutableScenario(model, existingBase, horizon, {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Remove",
        changes: [
          {
            kind: "investment_purchase",
            operation: "remove",
            purchaseId: ids.purchase,
            investmentId: ids.investment,
          },
        ],
      }),
    ).toMatchObject({
      status: "compiled",
      value: { changes: [{ operation: "remove" }] },
    });
    expect(
      compileExecutableScenario(model, base, horizon, {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Fee",
        changes: [
          {
            kind: "fee_rule_binding",
            feeId: "94000000-0000-4000-8000-000000000009",
            taxRuleIds: [],
          },
        ],
      }),
    ).toMatchObject({
      status: "unsupported",
      diagnostics: [{ code: "SCENARIO_FEE_TARGET_UNAVAILABLE" }],
    });
  });

  it("maps extra-principal add, replace, and remove with explicit payload rules", () => {
    const liabilityId = "90000000-0000-4000-8000-000000000008";
    const paymentId = "95000000-0000-4000-8000-000000000001";
    const profile = {
      liabilityId,
      kind: "vs4_fixed_monthly_fully_amortizing" as const,
      paymentAnchor: "2022-02-01",
      totalPayments: 360,
      fundingAccountId: "90000000-0000-4000-8000-000000000004",
      settlementPriority: 1,
      openingContractStatus: "current" as const,
    };
    const request: LiabilityCompilerRequest = {
      baseCurrency: "USD",
      asOf: "2026-01-01",
      simulationStart: "2026-01-01",
      simulationEnd: "2026-04-01",
      months: 3,
      executionOwnerId: "90000000-0000-4000-8000-000000000003",
      executionProfiles: [profile],
    };
    const compiled = compileLiabilities(
      createSyntheticPersonalDraft(),
      request,
    );
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    const horizon = {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-04-01T00:00:00.000Z",
    };
    const instruction = {
      id: paymentId,
      scheduledAt: "2026-02-01",
      amount: "100.00",
      fundingAccountId: "90000000-0000-4000-8000-000000000004",
    };
    const added = compileExecutableScenario(
      createSyntheticPersonalDraft(),
      {
        scope: "liabilities",
        compiled: compiled.value,
        compilerRequest: request,
      },
      horizon,
      {
        scenarioId: alternativeId,
        baseScenarioId: rootId,
        name: "Extra",
        changes: [
          {
            kind: "extra_principal_payment",
            operation: "add",
            liabilityId,
            paymentId,
            instruction,
          },
        ],
      },
    );
    expect(added).toMatchObject({
      status: "compiled",
      value: { changes: [{ operation: "add", paymentId }] },
    });
    if (
      added.status === "compiled" &&
      added.value.changes[0]!.kind === "extra_principal_payment"
    )
      expect(added.value.changes[0]!.payment!.amount.amount.toString()).toBe(
        "100",
      );
    expect(
      compileExecutableScenario(
        createSyntheticPersonalDraft(),
        {
          scope: "liabilities",
          compiled: compiled.value,
          compilerRequest: request,
        },
        horizon,
        {
          scenarioId: alternativeId,
          baseScenarioId: rootId,
          name: "Invalid",
          changes: [
            {
              kind: "extra_principal_payment",
              operation: "remove",
              liabilityId,
              paymentId,
              instruction,
            },
          ],
        },
      ),
    ).toMatchObject({
      status: "invalid_model",
      diagnostics: [{ code: "SCENARIO_LIST_PAYLOAD_INVALID" }],
    });
    const existingRequest = {
      ...request,
      executionProfiles: [
        { ...profile, extraPrincipalPayments: [instruction] },
      ],
    };
    const existing = compileLiabilities(
      createSyntheticPersonalDraft(),
      existingRequest,
    );
    expect(existing.status).toBe("compiled");
    if (existing.status !== "compiled") return;
    const existingBase = {
      scope: "liabilities" as const,
      compiled: existing.value,
      compilerRequest: existingRequest,
    };
    expect(
      compileExecutableScenario(
        createSyntheticPersonalDraft(),
        existingBase,
        horizon,
        {
          scenarioId: alternativeId,
          baseScenarioId: rootId,
          name: "Remove",
          changes: [
            {
              kind: "extra_principal_payment",
              operation: "remove",
              liabilityId,
              paymentId,
            },
          ],
        },
      ),
    ).toMatchObject({
      status: "compiled",
      value: { changes: [{ operation: "remove" }] },
    });
    expect(
      compileExecutableScenario(
        createSyntheticPersonalDraft(),
        existingBase,
        horizon,
        {
          scenarioId: alternativeId,
          baseScenarioId: rootId,
          name: "Replace",
          changes: [
            {
              kind: "extra_principal_payment",
              operation: "replace",
              liabilityId,
              paymentId,
              instruction: { ...instruction, amount: "200.00" },
            },
          ],
        },
      ),
    ).toMatchObject({
      status: "compiled",
      value: { changes: [{ operation: "replace" }] },
    });
  });
});
