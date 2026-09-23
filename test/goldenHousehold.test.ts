import { describe, expect, it } from "vitest";
import {
  GOLDEN_HOUSEHOLD_IDS,
  comparePersonalHouseholdScenarioIntents,
  createGoldenHouseholdDraft,
  createGoldenHouseholdForecastRequest,
  createGoldenHouseholdScenarioIntents,
  exportPersonalModelJson,
  importPersonalModelJson,
  resolveHouseholdExplanation,
  runPersonalHouseholdForecast,
} from "../src/application/index.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";

const through = (simulationEnd: string, months: number) => {
  const request = createGoldenHouseholdForecastRequest();
  return {
    ...request,
    compiler: {
      ...request.compiler,
      cashFlow: { ...request.compiler.cashFlow!, simulationEnd, months },
      investments: { ...request.compiler.investments!, simulationEnd, months },
      liabilities: { ...request.compiler.liabilities!, simulationEnd, months },
    },
  };
};

describe("PR21 Golden Household", () => {
  it("round-trips the portable model and compiles every authored economic domain", () => {
    const model = createGoldenHouseholdDraft();
    expect(importPersonalModelJson(exportPersonalModelJson(model))).toEqual(
      model,
    );
    const compiled = compileHouseholdProjection(
      model,
      createGoldenHouseholdForecastRequest().compiler,
    );
    expect(compiled.status, JSON.stringify(compiled)).toBe("compiled");
    if (compiled.status !== "compiled") return;
    expect(compiled.value.cashFlowInput).toBeDefined();
    expect(compiled.value.investmentInput).toBeDefined();
    expect(compiled.value.liabilityInput).toBeDefined();
    expect(compiled.value.standaloneAssets).toHaveLength(1);
  });

  it("uses the reconciled opening state and reaches the long-term horizon deterministically", () => {
    const model = createGoldenHouseholdDraft();
    const request = createGoldenHouseholdForecastRequest();
    const result = runPersonalHouseholdForecast(model, request);
    expect(result.status, JSON.stringify(result)).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.openingSnapshot).toMatchObject({
      cash: { amount: "35000", currency: "USD" },
      investmentValue: { amount: "150000", currency: "USD" },
      standaloneAssetValue: { amount: "350000", currency: "USD" },
      totalAssets: { amount: "535000", currency: "USD" },
      totalLiabilities: { amount: "225669.71", currency: "USD" },
      netWorth: { amount: "309330.29", currency: "USD" },
    });
    expect(result.points).toHaveLength(120);
    expect(result.reachedThrough).toBe("2036-01-01T00:00:00.000Z");
    expect(result.stoppedAt).toBeUndefined();
    expect(result.actualHistoryAvailable).toBe(false);
    expect(
      [0, 11, 59, 107, 119].map((index) => {
        const point = result.points[index]!;
        return [
          point.periodEnd.slice(0, 10),
          point.cash.amount,
          point.investmentValue.amount,
          point.totalLiabilities.amount,
          point.netWorth.amount,
        ];
      }),
    ).toEqual([
      [
        "2026-02-01",
        "36874.71",
        "151714.9999999999744",
        "225331.72",
        "313257.9899999999744",
      ],
      [
        "2027-01-01",
        "69316.53",
        "159805.37332005970432",
        "221514.86",
        "357607.04332005970432",
      ],
      [
        "2031-01-01",
        "229493.02",
        "200481.1448481831424",
        "202537.45",
        "577436.7148481831424",
      ],
      [
        "2035-01-01",
        "423136.92",
        "251491.7471378795008",
        "179136.17",
        "845492.4971378795008",
      ],
      [
        "2036-01-01",
        "334478.36",
        "266160.3484320557056",
        "172478.66",
        "778160.0484320557056",
      ],
    ]);
    expect(result.retirementMilestones).toEqual([
      expect.objectContaining({
        eventId: GOLDEN_HOUSEHOLD_IDS.retirementEvent,
        date: "2035-01-01",
        label: "Planned retirement",
      }),
    ]);
    expect(result.points[0]).toMatchObject({
      statementIncome: { amount: "9000", currency: "USD" },
      statementExpenses: { amount: "5787.3", currency: "USD" },
      investmentContributionPrincipal: { amount: "1000", currency: "USD" },
    });
  }, 60_000);

  it("keeps explicit configuration and single-member capability boundaries precise", () => {
    const model = createGoldenHouseholdDraft();
    const request = createGoldenHouseholdForecastRequest();
    const {
      executionAccountId: _executionAccountId,
      ...cashFlowWithoutAccount
    } = request.compiler.cashFlow!;
    const missingAccount = compileHouseholdProjection(model, {
      ...request.compiler,
      cashFlow: cashFlowWithoutAccount,
    });
    expect(missingAccount.status).toBe("unsupported");
    if (missingAccount.status === "unsupported") {
      expect(
        missingAccount.diagnostics.some(
          (issue) => issue.fieldPath === "executionAccountId",
        ),
      ).toBe(true);
    }

    const secondPersonId = "90000000-0000-4000-8000-000000000099";
    const multiMember = structuredClone(model) as any;
    multiMember.objects.Person!.push({
      ...multiMember.objects.Person![0]!,
      person_id: secondPersonId,
      name: "Second synthetic member",
    });
    multiMember.objects.Household![0]!.members.push(secondPersonId);
    const multi = compileHouseholdProjection(multiMember, request.compiler);
    expect(multi.status).toBe("unsupported");
    if (multi.status === "unsupported")
      expect(
        multi.diagnostics.some(
          (issue) => issue.code === "HOUSEHOLD_MULTI_MEMBER_UNSUPPORTED",
        ),
      ).toBe(true);
  });

  it("is deterministic for identical explicit inputs", () => {
    const model = createGoldenHouseholdDraft();
    const short = through("2026-02-01", 1);
    expect(runPersonalHouseholdForecast(model, short)).toEqual(
      runPersonalHouseholdForecast(model, short),
    );
  }, 30_000);

  it("compares lower returns and valid earlier-retirement liquidity stress", () => {
    const model = createGoldenHouseholdDraft();
    const result = comparePersonalHouseholdScenarioIntents(
      model,
      through("2027-01-01", 12),
      createGoldenHouseholdScenarioIntents(),
    );
    expect(
      result.status,
      JSON.stringify({
        status: result.status,
        diagnostics: result.diagnostics,
        alternatives:
          result.status === "unavailable"
            ? []
            : result.alternatives.map((alternative) => ({
                name: alternative.name,
                status: alternative.status,
                pointCount: alternative.points.length,
                lastPoint: alternative.points.at(-1),
              })),
      }),
    ).toBe("completed");
    if (result.status === "unavailable") return;
    const lower = result.alternatives.find(
      (item) => item.name === "Lower investment returns",
    )!;
    expect(
      lower.points.some((point) => point.deltas.investmentValue.amount !== "0"),
    ).toBe(true);
    expect(
      lower.configurationDifferences.some(
        (difference) => difference.changeKind === "investment_return",
      ),
    ).toBe(true);
    const retirement = result.alternatives.find((item) =>
      item.name.startsWith("Earlier retirement"),
    )!;
    expect(
      retirement.points.some(
        (point) => point.alternative.liquidityShortfalls.length > 0,
      ),
    ).toBe(true);
    expect(
      retirement.configurationDifferences.some(
        (difference) => difference.changeKind === "retirement_date",
      ),
    ).toBe(true);
  }, 120_000);

  it("binds base-less user intents to the supplied household root", () => {
    const model = createGoldenHouseholdDraft();
    const [lowerReturns] = createGoldenHouseholdScenarioIntents();
    const { baseScenarioId: _baseScenarioId, ...baseLessLowerReturns } =
      lowerReturns!;
    const result = comparePersonalHouseholdScenarioIntents(
      model,
      through("2027-01-01", 12),
      [baseLessLowerReturns],
    );
    expect(result.status).not.toBe("unavailable");
    if (result.status === "unavailable") return;
    expect(result.alternatives).toHaveLength(1);
    expect(
      result.alternatives[0]!.configurationDifferences.some(
        (difference) => difference.changeKind === "investment_return",
      ),
    ).toBe(true);
  }, 120_000);

  it("resolves carried source, assumption, and event metadata without inventing causality", () => {
    const model = createGoldenHouseholdDraft();
    const result = runPersonalHouseholdForecast(
      model,
      through("2026-02-01", 1),
    );
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const explanation = resolveHouseholdExplanation(
      model,
      result.points[0]!.traceRefs,
    );
    expect(
      explanation.sources.some((source) => source.label === "Example salary"),
    ).toBe(true);
    expect(
      explanation.assumptions.some(
        (assumption) => assumption.label === "Salary growth",
      ),
    ).toBe(true);
    expect(explanation.traceRefs.length).toBeGreaterThan(0);
    expect(explanation.unresolvedTraceIds.length).toBeGreaterThan(0);
  });
});
