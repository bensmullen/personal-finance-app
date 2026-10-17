import { describe, expect, it } from "vitest";
import { inspectMortgageWindow, mortgageWindowTotals, MortgageWindowCache } from "../src/application/mortgageChartData.js";
import { createGoldenHouseholdDraft, patchPersonalObject, type PersonalDraft } from "../src/application/personalMvp.js";
import { createGoldenHouseholdForecastRequest, GOLDEN_HOUSEHOLD_IDS as ids } from "../src/application/goldenHousehold.js";
import { runPersonalHouseholdForecast } from "../src/application/householdProjection.js";
import { authorMortgageExtra, authorMortgageRefinance } from "../src/application/compiler/mortgageLifecycle.js";
import { restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow } from "../src/simulation/householdExecution.js";
import { instant } from "../src/time/index.js";
import { money } from "../src/values/index.js";

const second = "d1610000-0000-4000-8000-000000000002";
function source(model = createGoldenHouseholdDraft(), months = 3, separate = false) {
  const full = createGoldenHouseholdForecastRequest();
  const end = new Date(Date.UTC(2026, months, 1)).toISOString().slice(0, 10);
  const profiles = full.compiler.liabilities!.executionProfiles;
  const request = { ...full, compiler: { ...full.compiler,
    cashFlow: { ...full.compiler.cashFlow!, simulationEnd: end, months },
    investments: { ...full.compiler.investments!, simulationEnd: end, months },
    liabilities: { ...full.compiler.liabilities!, simulationEnd: end, months,
      executionProfiles: [...profiles, ...(separate ? [{ ...profiles[0]!, liabilityId: second, fundingAccountId: ids.savings, settlementPriority: 2 }] : [])] } } };
  const result = runPersonalHouseholdForecast(model, request);
  if (result.status === "unavailable") throw new Error(JSON.stringify(result));
  return result;
}
function extra(model: PersonalDraft, amount: string, fundingAccountId = ids.checking) {
  return authorMortgageExtra(model, { eventId: "d1610000-0000-4000-8000-000000000010", effectId: "d1610000-0000-4000-8000-000000000011", primitiveId: "d1610000-0000-4000-8000-000000000012", liabilityId: ids.mortgage, date: "2026-01-01", amount, fundingAccountId });
}
describe("source-backed mortgage chart data", () => {
  it("reconciles paid leg amounts and principal against the same real integrated replay", () => {
    const result = source(extra(createGoldenHouseholdDraft(), "100"));
    const before = JSON.stringify(result), window = inspectMortgageWindow(result.points, ids.mortgage);
    const address = result.points[0]!.traceRefs.find(ref => ref.replayArtifact)!.replayArtifact as { basis: unknown };
    const basis = restorePortableHouseholdReplayArtifact(address.basis);
    const replay = replayHouseholdForecastWindow(basis, { start: instant(window.start), end: instant(window.end) });
    const loan = basis.replay.kernel.executable.liabilityInput!.loans.find(item => String(item.principalLiabilityId) === ids.mortgage)!;
    for (const [index, row] of window.rows.entries()) {
      for (const [type, key, target] of [["mortgage_interest_settlement", "interestPaid", loan.interestPayableLiabilityId],
        ["mortgage_principal_payment", "scheduledPrincipalPaid", loan.principalLiabilityId],
        ["mortgage_extra_principal", "extraPrincipalPaid", loan.principalLiabilityId]] as const) {
        const paid = replay.periods[index]!.transactions.filter(tx => tx.type === type).flatMap(tx => tx.legs)
          .filter(leg => leg.type === "liability" && leg.entityId === target && leg.posting === "debit")
          .reduce((sum, leg) => sum.plus(leg.amount), money("0"));
        expect(row[key]).toBe(paid.amount.toString());
      }
      expect(money(row.openingPrincipal).minus(money(row.scheduledPrincipalPaid)).minus(money(row.extraPrincipalPaid)).amount.toString()).toBe(row.endingPrincipal);
      expect(row.reconciled).toBe(true);
      expect(new Set(row.sourceIds).size).toBe(row.sourceIds.length);
    }
    expect(window.rows[0]!.extraPrincipalPaid).toBe("100");
    expect(mortgageWindowTotals(window, window.rows[1]!.start)?.principal).toBe(
      window.rows.slice(0, 2).reduce((sum, row) => sum.plus(money(row.scheduledPrincipalPaid)).plus(money(row.extraPrincipalPaid)), money("0")).amount.toString());
    expect(JSON.stringify(result)).toBe(before);
    expect(inspectMortgageWindow(result.points, ids.mortgage)).toEqual(window);
  });
  it.each(["0", "500"])("keeps two mortgages and denied/insufficient available bank funding separate (%s)", available => {
    let model = createGoldenHouseholdDraft();
    const original = model.objects.Liability![0]!;
    model = { ...model, objects: { ...model.objects, Liability: [...model.objects.Liability!, { ...original as object, liability_id: second, name: "Second mortgage" }] } };
    model = patchPersonalObject(model, "Account", ids.savings, { opening_balance: available });
    const result = source(model, 2, true);
    const funded = inspectMortgageWindow(result.points, ids.mortgage), denied = inspectMortgageWindow(result.points, second);
    expect(funded.loanId).not.toBe(denied.loanId);
    expect(funded.rows[0]!.accountIds).toEqual([ids.checking]);
    expect(money(funded.rows[0]!.interestPaid).isPositive()).toBe(true);
    expect(denied.rows[0]).toMatchObject({ interestPaid: "0", scheduledPrincipalPaid: "0", extraPrincipalPaid: "0", accountIds: [] });
    expect(money(denied.rows[0]!.interestAccrued).isPositive()).toBe(true);
    expect(money(denied.rows[0]!.scheduledDue).isPositive()).toBe(true);
  });
  it("does not turn denied extra principal or accrued interest into paid amounts", () => {
    const result = source(extra(createGoldenHouseholdDraft(), "999999999"));
    const row = inspectMortgageWindow(result.points, ids.mortgage).rows[0]!;
    expect(row.extraPrincipalPaid).toBe("0");
    expect(money(row.scheduledPrincipalPaid).isPositive()).toBe(true);
    expect(row.funding).toBe("fully_satisfied");
  });
  it("keeps zero interest, early payoff, window boundaries and exact scoped totals", () => {
    let model = patchPersonalObject(createGoldenHouseholdDraft(), "Liability", ids.mortgage, { interest_rate: "0" });
    model = extra(model, "999999999"); // Denied extra still cannot become principal paid.
    const result = source(model, 24), cache = new MortgageWindowCache(result);
    const first = cache.get(ids.mortgage, 0), later = cache.get(ids.mortgage, 12);
    expect(first.rows[0]!.interestPaid).toBe("0");
    expect(first.rows).toHaveLength(12);
    expect(later.rows).toHaveLength(12);
    expect(cache.get(ids.mortgage, 12)).toBe(later);
    expect(mortgageWindowTotals(later, later.rows[0]!.start)?.fromForecastStart).toBe(false);
    expect(first.fingerprint).toBe(later.fingerprint);
    const changed = source(patchPersonalObject(createGoldenHouseholdDraft(), "Income", ids.income, { amount: "9100" }));
    expect(inspectMortgageWindow(changed.points, ids.mortgage).fingerprint).not.toBe(first.fingerprint);
    expect(() => inspectMortgageWindow(result.points.slice(0, 13), ids.mortgage)).toThrow(/twelve/);
    const rich = patchPersonalObject(createGoldenHouseholdDraft(), "Account", ids.savings, { opening_balance: "1000000" });
    const paid = inspectMortgageWindow(source(extra(rich, "500000", ids.savings)).points, ids.mortgage);
    expect(paid.rows[0]!.endingPrincipal).toBe("0");
    expect(money(paid.rows[0]!.extraPrincipalPaid).isPositive()).toBe(true);
    expect(paid.rows[1]).toMatchObject({ endingPrincipal: "0", interestPaid: "0", scheduledPrincipalPaid: "0", extraPrincipalPaid: "0" });
  });
  it("rejects identity, currency and period gaps without inventing replacement evidence", () => {
    const result = source(); const first = result.points[0]!;
    expect(() => inspectMortgageWindow([{ ...first, traceRefs: [] }], ids.mortgage)).toThrow(/missing/);
    expect(() => inspectMortgageWindow([first, result.points[2]!], ids.mortgage)).toThrow(/period/);
    expect(() => inspectMortgageWindow([{ ...first, cash: { ...first.cash, currency: "EUR" } }], ids.mortgage)).toThrow(/currencies/);
    expect(() => inspectMortgageWindow([first], second)).toThrow(/unavailable/);
    const bad = { ...first, traceRefs: first.traceRefs.map(ref => ref.replayArtifact ? { ...ref, traceId: "wrong" as typeof ref.traceId } : ref) };
    expect(() => inspectMortgageWindow([bad], ids.mortgage)).toThrow(/identity/);
  });
  it("does not count a same-date refinance replacement as cash principal paid", () => {
    const model = authorMortgageRefinance(createGoldenHouseholdDraft(), { eventId: "d1610000-0000-4000-8000-000000000020", effectId: "d1610000-0000-4000-8000-000000000021", primitiveId: "d1610000-0000-4000-8000-000000000022", liabilityId: ids.mortgage, date: "2026-01-01", annualRate: "0.04", totalPayments: 360 });
    const window = inspectMortgageWindow(source(model).points, ids.mortgage);
    expect(window.rows[0]!.endingPrincipal).toBe("0");
    expect(window.rows[0]!.reconciled).toBe(false);
    expect(mortgageWindowTotals(window, window.rows[0]!.start)).toBeUndefined();
    expect(money(window.rows[0]!.scheduledPrincipalPaid).compare(money(window.rows[0]!.openingPrincipal))).toBe(-1);
  });
});
