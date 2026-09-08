import { describe, expect, it } from "vitest";
import {
  addPersonalObject,
  comparePersonalCashFlowPlans,
  createEmptyPersonalDraft,
  createSyntheticPersonalDraft,
  deletePersonalObject,
  exportPersonalModelJson,
  importPersonalModelJson,
  patchPersonalObject,
  runPersonalForecast,
  validatePersonalDraft,
} from "../src/application/index.js";

const ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const request = (
  scope: "cash_flow" | "investments" | "liabilities" = "cash_flow",
) =>
  ({
    scope,
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
