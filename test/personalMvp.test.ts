import { describe, expect, it } from "vitest";
import {
  addPersonalObject,
  comparePersonalCashFlowPlans,
  createEmptyPersonalDraft,
  createGuidedSetupDraft,
  createSyntheticPersonalDraft,
  deletePersonalObject,
  exportPersonalModelJson,
  getCurrentPosition,
  importPersonalModelJson,
  patchPersonalObject,
  runPersonalForecast,
  resolvePersonalSessionSettings,
  sessionSettingsFromHorizon,
  validatePersonalDraft,
} from "../src/application/index.js";

const ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const request = (
  scope: "cash_flow" | "investments" | "liabilities" = "cash_flow",
) =>
  ({
    scope,
    baseCurrency: "USD",
    asOf: "2026-01-01",
    dataCutoff: "2026-01-01",
    simulationStart: "2026-01-01",
    simulationEnd: "2026-04-01",
    months: 3,
  }) as const;

describe("Personal-MVP application facade", () => {
  it("creates and edits immutable drafts with canonical IDs and defaults", () => {
    const empty = createEmptyPersonalDraft(ID);
    const added = addPersonalObject(empty, "Account", ID, {
      name: "Cash",
      account_type: "checking",
    });
    const account = added.objects.Account?.[0] as Record<string, unknown>;
    expect(Object.isFrozen(added)).toBe(true);
    expect(empty.objects.Account).toEqual([]);
    expect(account.account_id).toBe(ID.toLowerCase());
    expect(account.currency).toBe("USD");
    expect(account.opening_balance).toBe("0.0000");
    expect(account).not.toHaveProperty("current_balance");
    const patched = patchPersonalObject(added, "Account", ID, {
      name: "Daily cash",
      current_balance: "999",
      account_id: "bad",
    });
    expect((patched.objects.Account?.[0] as Record<string, unknown>).name).toBe(
      "Daily cash",
    );
    expect(
      patched.objects.Account?.[0] as Record<string, unknown>,
    ).not.toHaveProperty("current_balance");
    expect(account.name).toBe("Cash");
  });

  it("allows a missing immutable creation field once and never overwrites it", () => {
    const added = addPersonalObject(
      createEmptyPersonalDraft(ID),
      "Household",
      ID,
      { name: "Example" },
    );
    const initialized = patchPersonalObject(added, "Household", ID, {
      formation_date: "2026-01-01",
    });
    const unchanged = patchPersonalObject(initialized, "Household", ID, {
      formation_date: "2027-01-01",
    });
    expect(
      (unchanged.objects.Household?.[0] as Record<string, unknown>)
        .formation_date,
    ).toBe("2026-01-01");
  });

  it("blocks referenced deletion without cascading", () => {
    const model = createSyntheticPersonalDraft();
    const person = model.objects.Person?.[0] as Record<string, string>;
    const result = deletePersonalObject(model, "Person", person.person_id!);
    expect(result.deleted).toBe(false);
    expect(result.draft).toBe(model);
    expect(result.references.some((path) => path.includes("Household"))).toBe(
      true,
    );
  });

  it("retains exact financial text and rejects number authority", () => {
    const model = createSyntheticPersonalDraft();
    expect(validatePersonalDraft(model)).toEqual([]);
    const expense = model.objects.Expense?.[0] as Record<string, string>;
    const exact = patchPersonalObject(model, "Expense", expense.expense_id!, {
      amount: "4200.1250",
    });
    expect((exact.objects.Expense?.[0] as Record<string, unknown>).amount).toBe(
      "4200.1250",
    );
    const invalid = patchPersonalObject(model, "Expense", expense.expense_id!, {
      amount: 4200,
    });
    expect(validatePersonalDraft(invalid)).toContainEqual(
      expect.objectContaining({
        field: "amount",
        message: expect.stringContaining("exact decimal string"),
      }),
    );
  });

  it("preserves unknown collections and unexposed fields across import-edit-export", () => {
    const base = createSyntheticPersonalDraft();
    const serialized = JSON.parse(exportPersonalModelJson(base)) as {
      objects: Record<string, unknown[]>;
    };
    serialized.objects.Custom = [
      { exact_text: "1.2300", future_field: { enabled: true } },
    ];
    (
      serialized.objects.Income![0] as Record<string, unknown>
    ).future_income_field = "preserved";
    const imported = importPersonalModelJson(JSON.stringify(serialized));
    const income = imported.objects.Income?.[0] as Record<string, string>;
    const edited = patchPersonalObject(imported, "Income", income.income_id!, {
      source: "Updated example salary",
    });
    const roundTrip = importPersonalModelJson(exportPersonalModelJson(edited));
    expect(roundTrip.objects.Custom).toEqual(serialized.objects.Custom);
    expect(
      (roundTrip.objects.Income?.[0] as Record<string, unknown>)
        .future_income_field,
    ).toBe("preserved");
  });

  it("capability-gates non-executable scopes rather than consolidating slices", () => {
    const model = createSyntheticPersonalDraft();
    expect(runPersonalForecast(model, request("investments"))).toEqual(
      expect.objectContaining({ scope: "investments", status: "unavailable" }),
    );
    expect(runPersonalForecast(model, request("liabilities"))).toEqual(
      expect.objectContaining({ scope: "liabilities", status: "unavailable" }),
    );
  });

  it("does not aggregate a mixed-currency current position without FX semantics", () => {
    let model = createEmptyPersonalDraft(
      "10000000-0000-4000-8000-000000000001",
    );
    model = addPersonalObject(
      model,
      "Account",
      "10000000-0000-4000-8000-000000000002",
      {
        name: "USD cash",
        account_type: "checking",
        currency: "USD",
        opening_balance: "100.00",
      },
    );
    model = addPersonalObject(
      model,
      "Account",
      "10000000-0000-4000-8000-000000000003",
      {
        name: "EUR cash",
        account_type: "checking",
        currency: "EUR",
        opening_balance: "100.00",
      },
    );

    const position = getCurrentPosition(model, "USD");
    expect(position.cash).toBeUndefined();
    expect(position.assets).toBeUndefined();
    expect(position.netWorth).toBeUndefined();
    expect(position.unavailable).toContain(
      "Mixed-currency current position requires FX semantics not implemented in PR 14.",
    );
  });

  it("executes only plain monthly fixed streams and never silently zeroes authored behavior", () => {
    const model = createSyntheticPersonalDraft();
    expect(runPersonalForecast(model, request()).status).toBe("completed");

    const income = model.objects.Income?.[0] as Record<string, string>;
    const incomeGrowth = patchPersonalObject(
      model,
      "Income",
      income.income_id!,
      {
        growth_model_id: "11111111-1111-4111-8111-111111111111",
      },
    );
    expect(runPersonalForecast(incomeGrowth, request())).toEqual(
      expect.objectContaining({
        status: "unavailable",
        message: expect.stringContaining("growth_model_id"),
      }),
    );

    const expense = model.objects.Expense?.[0] as Record<string, string>;
    const expenseGrowth = patchPersonalObject(
      model,
      "Expense",
      expense.expense_id!,
      {
        growth_model_id: "22222222-2222-4222-8222-222222222222",
      },
    );
    expect(runPersonalForecast(expenseGrowth, request())).toEqual(
      expect.objectContaining({
        status: "unavailable",
        message: expect.stringContaining("growth_model_id"),
      }),
    );
    const eventBoundExpense = patchPersonalObject(
      model,
      "Expense",
      expense.expense_id!,
      {
        event_trigger_id: "33333333-3333-4333-8333-333333333333",
      },
    );
    expect(runPersonalForecast(eventBoundExpense, request())).toEqual(
      expect.objectContaining({
        status: "unavailable",
        message: expect.stringContaining("event_trigger_id"),
      }),
    );
    expect(
      comparePersonalCashFlowPlans(incomeGrowth, request(), "0.03"),
    ).toEqual(
      expect.objectContaining({
        status: "unavailable",
        message: expect.stringContaining("growth_model_id"),
      }),
    );
  });

  it("builds guided setup from user input without loading the synthetic example", () => {
    const setup = createGuidedSetupDraft({
      modelId: "10000000-0000-4000-8000-000000000001",
      householdId: "10000000-0000-4000-8000-000000000002",
      personId: "10000000-0000-4000-8000-000000000003",
      accountId: "10000000-0000-4000-8000-000000000004",
      incomeId: "10000000-0000-4000-8000-000000000005",
      assetId: "10000000-0000-4000-8000-000000000006",
      liabilityId: "10000000-0000-4000-8000-000000000007",
      expenseId: "10000000-0000-4000-8000-000000000008",
      householdName: "My household",
      monthlyIncome: "1000.00",
      openingCash: "200.00",
      assetValue: "300.00",
      debt: "400.00",
      monthlySpending: "500.00",
      startDate: "2028-02-01",
    });
    expect(setup.objects.Investment).toEqual([]);
    expect(setup.objects.Assumption).toEqual([]);
    expect(setup.objects.Scenario).toEqual([]);
    expect(setup.objects.Household?.[0]).toEqual(
      expect.objectContaining({ name: "My household" }),
    );
    expect(setup.objects.Liability?.[0]).toEqual(
      expect.objectContaining({
        liability_type: "other",
        principal: "400.00",
        current_balance: "400.00",
        interest_rate: "0.0",
      }),
    );
    expect(setup.objects.Liability?.[0]).not.toHaveProperty("maturity_date");
    expect(setup.objects.Liability?.[0]).not.toHaveProperty("collateral_id");
    expect(createSyntheticPersonalDraft().objects.Assumption).toHaveLength(1);
  });

  it("resolves session-only settings into a shared exact calendar-month horizon", () => {
    const settings = sessionSettingsFromHorizon("2028-02-01", 24);
    const forecast = resolvePersonalSessionSettings(settings, "cash_flow");
    const comparison = resolvePersonalSessionSettings(settings, "cash_flow");
    expect(forecast.request).toEqual(
      expect.objectContaining({ simulationEnd: "2030-02-01", months: 24 }),
    );
    expect(comparison.request).toEqual(forecast.request);
    expect(
      comparePersonalCashFlowPlans(
        createSyntheticPersonalDraft(),
        comparison.request!,
        "0.03",
      ).points,
    ).toHaveLength(24);
    expect(
      resolvePersonalSessionSettings(
        { ...settings, asOf: "2028-03-01", dataCutoff: "2028-04-01" },
        "cash_flow",
      ).error,
    ).toContain("Data cutoff");
    expect(
      resolvePersonalSessionSettings(
        { ...settings, simulationEnd: "2028-02-01" },
        "cash_flow",
      ).error,
    ).toContain("Simulation start");
  });

  it("preserves run boundaries, exact results, shortfalls, and real trace references", () => {
    const model = createSyntheticPersonalDraft();
    const result = runPersonalForecast(model, request());
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        asOf: "2026-01-01T00:00:00.000Z",
        dataCutoff: "2026-01-01T00:00:00.000Z",
        actualHistoryAvailable: false,
      }),
    );
    expect(result.points).toHaveLength(3);
    expect(result.points[0]).toEqual(
      expect.objectContaining({
        income: expect.objectContaining({ exact: "6000" }),
        spending: expect.objectContaining({ exact: "4200" }),
        netCashFlow: expect.objectContaining({ exact: "1800" }),
      }),
    );
    expect(result.points[0]!.traceIds.length).toBeGreaterThan(0);

    const expense = model.objects.Expense?.[0] as Record<string, string>;
    const stressed = patchPersonalObject(
      model,
      "Expense",
      expense.expense_id!,
      { amount: "20000.00" },
    );
    const stressResult = runPersonalForecast(stressed, request());
    expect(stressResult.status).toBe("completed");
    expect(stressResult.shortfalls.length).toBeGreaterThan(0);
    expect(stressResult.shortfalls[0]!.unfunded.exact).not.toBe("0");
  });

  it("matches the deterministic scenario engine with explicit configuration deltas", () => {
    const result = comparePersonalCashFlowPlans(
      createSyntheticPersonalDraft(),
      request(),
      "0.03",
    );
    expect(result.status).toBe("completed");
    expect(result.scope).toBe("cash_flow");
    expect(result.configurationDifferences).toContainEqual(
      expect.objectContaining({
        kind: "income_growth",
        assumptionIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"],
      }),
    );
    expect(result.points).toHaveLength(3);
    expect(result.points[0]!.delta.exact).toBe("0");
    expect(result.points[1]!.alternative.exact).not.toBe(
      result.points[1]!.baseline.exact,
    );
    expect(result.points[1]!.traceIds.length).toBeGreaterThan(0);
  });
});
