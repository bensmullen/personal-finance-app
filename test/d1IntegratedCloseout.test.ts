import { describe, expect, it } from "vitest";
import { assertBalanced } from "../src/accounting/index.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import { compileDomainMechanics } from "../src/application/compiler/domainMechanics.js";
import { GOLDEN_HOUSEHOLD_IDS as golden } from "../src/application/goldenHousehold.js";
import { exportPersonalModelJson, importPersonalModelJson } from "../src/application/modelPortability.js";
import { inspectPersistedPersonalModel, savePersonalModel, type PersonalModelPersistencePort } from "../src/application/personalPersistence.js";
import { authorDomainOperation, type PersonalDraft } from "../src/application/personalMvp.js";
import { deriveHouseholdClosingMetrics } from "../src/simulation/householdProjection.js";
import { replayHouseholdForecastWindow, runHouseholdKernel } from "../src/simulation/householdExecution.js";
import { summarizeHouseholdPeriod } from "../src/simulation/r3/forecastSummary.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../src/simulation/r3/replayArtifact.js";
import { taxBalanceIds } from "../src/simulation/tax.js";
import { USD } from "../src/values/index.js";
import { createD1IntegratedHousehold, d1IntegratedCompilerRequest, d1IntegratedRunContext, integratedId, integratedIds as ids } from "./fixtures/d1IntegratedHousehold.js";

const compile = (model = createD1IntegratedHousehold(), request = d1IntegratedCompilerRequest()) => {
  const result = compileHouseholdProjection(model, request);
  expect(result.status, JSON.stringify(result)).toBe("compiled");
  if (result.status !== "compiled") throw new Error("Integrated durable household did not compile");
  return result.value;
};
const detail = (model = createD1IntegratedHousehold(), request = d1IntegratedCompilerRequest()) =>
  runHouseholdKernel({ kernel: compile(model, request).executionKernel!, runContext: d1IntegratedRunContext(), resultTier: "detail" });

describe("D1-C bounded Golden Household integration", () => {
  it("reconciles beginning/ending cash, owned positions, debt, tax and net worth independently", () => {
    const compiled = compile(), before = compiled.reconciledOpeningState;
    expect(compiled.standaloneAssets.map(asset => asset.id)).toEqual([golden.home]);
    const opening = deriveHouseholdClosingMetrics(before, USD, compiled.standaloneAssets);
    expect(Object.fromEntries(Object.entries(opening).map(([key, value]) => [key, value.amount.toString()]))).toEqual({
      cash: "35000", investmentValue: "150000", standaloneAssetValue: "350000", totalAssets: "535000", totalLiabilities: "225669.71", netWorth: "309330.29",
    });
    const result = runHouseholdKernel({ kernel: compiled.executionKernel!, runContext: d1IntegratedRunContext(), resultTier: "detail" });
    // Supported federal tax is accrued; unsupported 2026 NY law is not zero tax.
    expect(result.status).toBe("incomplete");
    expect(result.stoppedAt, JSON.stringify(result.diagnostics)).toBeUndefined();
    expect(result.reachedThrough).toBe("2026-02-01T00:00:00.000Z");
    expect(result.periods).toHaveLength(1);
    const period = result.periods[0]!;
    // Salary cash 9000 - employee 450 - employee HSA 100 = 8450.
    // Checking: 20000 + 8450 - living 4800 - mortgage 1325.29 - premium 50
    // - brokerage 1000 - Treasury 980 - crypto 200 - estimated tax 500.
    expect(result.state.accounts[golden.checking]!.cash.amount.toString()).toBe("19594.71");
    // Savings: 15000 - Roth IRA 500 + bill maturity 1000 + excluded benefit 100000.
    expect(result.state.accounts[golden.savings]!.cash.amount.toString()).toBe("115500");
    // Proceeds stay in the wrapper; reinvestment settles and spends its own 100.
    expect(result.state.accounts[golden.brokerageAccount]!.cash.amount.toString()).toBe("1400");
    for (const accountId of [golden.retirementAccount, ids.hsaAccount, ids.iraAccount]) expect(result.state.accounts[accountId]!.cash.isZero()).toBe(true);
    expect([golden.retirementInvestment, ids.match, ids.hsaEmployee, ids.hsaEmployer, ids.ira, golden.brokerageInvestment, ids.treasury, ids.crypto].map(id => [result.state.positions[id]!.quantity.amount.toString(), result.state.positions[id]!.carryingValue.amount.toString()])).toEqual([
      ["1004.5", "100450"], ["2.25", "225"], ["1", "100"], ["0.25", "25"], ["5", "500"], ["501", "50100"], ["0", "0"], ["0", "0"],
    ]);
    expect(Object.values(result.state.contributions ?? {}).map(entry => [entry.character, entry.amount.amount.toString()]).sort()).toEqual([
      ["employee_hsa", "100"], ["employer_401k", "225"], ["employer_hsa", "25"], ["roth_ira", "500"], ["traditional_401k", "450"],
    ]);
    expect(result.state.liabilities[golden.mortgage]!.balance.amount.toString()).toBe("225331.72");
    const federal = taxBalanceIds("US:FEDERAL", "2026");
    // Below base standard deduction: income/NIIT tax 0; employee FICA
    // (9000 - HSA 100) * (6.2% + 1.45%) = 680.85, less the explicit 500 payment.
    expect(result.state.liabilities[federal.liabilityId]!.balance.amount.toString()).toBe("180.85");
    expect(result.state.positions[federal.creditPositionId]!.carryingValue.isZero()).toBe(true);
    expect(period.cash.amount.toString()).toBe("136494.71");
    expect(period.investmentValue.amount.toString()).toBe("151400");
    expect(period.assets.amount.toString()).toBe("637894.71");
    expect(period.liabilities.amount.toString()).toBe("225512.57");
    expect(period.netWorth.amount.toString()).toBe("412382.14");
    // Income = salary 9000 + employer benefits 250 + bill discount 20 +
    // qualified dividend 100 + excluded life benefit 100000. Gains = 100 + 100.
    expect(period.statements.income.amount.toString()).toBe("109370");
    expect(period.statements.gains.amount.toString()).toBe("200");
    expect(period.statements.expenses.amount.toString()).toBe("6518.15");
    expect(period.netWorth.minus(opening.netWorth).equals(period.statements.income.plus(period.statements.gains).minus(period.statements.expenses))).toBe(true);
    expect(period.liability!.principalReduction.amount.toString()).toBe("337.99");
    expect(period.liability!.interestExpense.amount.toString()).toBe("987.3");
    expect(period.investments!.contributionPrincipal.amount.toString()).toBe("1500");
    expect(period.constraintOutcomes.every(outcome => outcome.status === "fully_satisfied")).toBe(true);
    expect(period.liquidityShortfalls).toHaveLength(0);
    period.transactions.forEach(assertBalanced);
    expect(new Set(period.transactions.map(tx => tx.id)).size).toBe(period.transactions.length);
    const benefit = period.transactions.filter(tx => tx.id.startsWith(`domain:${ids.policy}:benefit:`));
    expect(benefit).toHaveLength(1);
    // Settlement creates no salary, expense, maturity income or benefit a second time.
    const taxPayments = period.transactions.filter(tx => tx.type === "tax_estimated");
    expect(taxPayments).toHaveLength(1);
    expect(taxPayments.flatMap(tx => tx.legs).some(leg => ["income", "expense", "tax", "gain"].includes(leg.type))).toBe(false);
    expect(before.accounts[golden.checking]!.cash.amount.toString()).toBe("20000");
    expect(before.identities.postedTransactionIds).toHaveLength(0);
  });

  it("closes summary/fast and detail to the same state, tax capabilities and version/fingerprint basis", () => {
    const kernel = compile().executionKernel!, runContext = d1IntegratedRunContext();
    const detailed = runHouseholdKernel({ kernel, runContext, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel, runContext });
    expect(detailed.periods).toHaveLength(1);
    expect(summary.periods).toEqual(detailed.periods.map(summarizeHouseholdPeriod));
    expect(summary.state).toEqual(detailed.state);
    expect(summary.primitiveState).toEqual(detailed.primitiveState);
    expect(summary.runMetadata).toEqual(detailed.runMetadata);
    expect(summary.outputCapabilities).toEqual(detailed.outputCapabilities);
    expect(summary.status).toBe(detailed.status);
    expect(summary.diagnostics).toEqual(detailed.diagnostics);
    expect(summary.reachedThrough).toBe(detailed.reachedThrough);
  });

  it("keeps scoped tax incompleteness separate from current position and income", () => {
    const result = detail();
    expect(result.periods).toHaveLength(1);
    expect(result.diagnostics.some(issue => "jurisdiction" in issue && issue.jurisdiction === "US:NY")).toBe(true);
    expect(result.diagnostics.some(issue => "category" in issue && issue.category === "term_life_state_exclusion")).toBe(true);
    expect(result.outputCapabilities?.currentPosition?.status).toBe("complete");
    expect(result.outputCapabilities?.statementIncome?.status).toBe("complete");
    expect(result.outputCapabilities?.netWorth?.status).toBe("incomplete");
    expect(result.outputCapabilities?.netWorth?.diagnostics.some(issue => issue.jurisdiction === "US:FEDERAL")).toBe(false);
  });

  it("recomputes from save/export/import inputs and separately restores explicit portable execution replay", async () => {
    const model = createD1IntegratedHousehold(), baseline = detail(model);
    let bytes: string | undefined;
    const port: PersonalModelPersistencePort = { read: async () => bytes, replace: async value => { bytes = value; }, remove: async () => { bytes = undefined; } };
    expect((await savePersonalModel(port, model)).status).toBe("saved");
    const saved = await inspectPersistedPersonalModel(port);
    expect(saved.status).toBe("ready");
    if (saved.status !== "ready") throw new Error("Synthetic saved model unavailable");
    const restored = importPersonalModelJson(exportPersonalModelJson(saved.model));
    expect(restored).toEqual(model);
    expect(JSON.parse(bytes!).objects).toEqual(JSON.parse(exportPersonalModelJson(model)).objects);
    const compiled = compile(restored);
    expect(compiled.reconciledOpeningState.identities.postedTransactionIds).toHaveLength(0);
    expect(compiled.reconciledOpeningState.contributions === undefined || Object.keys(compiled.reconciledOpeningState.contributions).length === 0).toBe(true);
    expect(detail(restored)).toEqual(baseline);
    const summary = runHouseholdKernel({ kernel: compiled.executionKernel!, runContext: d1IntegratedRunContext() });
    const replay = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(summary))));
    expect(replay.runMetadata).toEqual(summary.runMetadata);
    expect(replayHouseholdForecastWindow(replay, baseline.periods[0]!.period).periods).toEqual(baseline.periods);
    const rerun = runHouseholdKernel({ kernel: replay.replay.kernel, runContext: replay.replay.runContext, resultTier: "detail" });
    expect(rerun.state).toEqual(baseline.state);
    expect(rerun.periods).toEqual(baseline.periods);
    expect(exportPersonalModelJson(model)).toBe(bytes);
  });

  it("ignores irrelevant collection order while retaining the authored contention authority", () => {
    const model = createD1IntegratedHousehold(), baseline = detail(model);
    const reversed: PersonalDraft = { ...model, objects: Object.fromEntries(Object.entries(model.objects).map(([key, values]) => [key, [...values].reverse()])) };
    const reordered = detail(reversed);
    expect(reordered.state).toEqual(baseline.state);
    expect(reordered.runMetadata).toEqual(baseline.runMetadata);
    expect(reordered.periods.map(summarizeHouseholdPeriod)).toEqual(baseline.periods.map(summarizeHouseholdPeriod));
    const changed = detail(model, { ...d1IntegratedCompilerRequest(), contentionPolicy: { ...d1IntegratedCompilerRequest().contentionPolicy, id: "different-explicit-authority" } });
    expect(changed.state).toEqual(baseline.state);
    expect(changed.runMetadata.inputFingerprint).not.toBe(baseline.runMetadata.inputFingerprint);
  });

  it("rolls back the entire candidate period, including payroll usage, lots, insurance and mortgage, on an unfunded domain purchase", () => {
    const original = createD1IntegratedHousehold();
    const purchase = { eventId: ids.cryptoPurchase, effectId: integratedId(41), primitiveId: integratedId(42), name: "Unfunded spot purchase", date: "2026-01-11", kind: "purchase" as const, holdingId: ids.crypto, cashAccountId: golden.checking, amount: "1000000", quantity: "10000", order: 10 };
    const model = authorDomainOperation(original, purchase);
    const compiled = compile(model);
    const result = runHouseholdKernel({ kernel: compiled.executionKernel!, runContext: d1IntegratedRunContext(), resultTier: "detail" });
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics.some(issue => issue.code === "DOMAIN_INSUFFICIENT_CASH")).toBe(true);
    expect(result.periods).toHaveLength(0);
    expect(result.stoppedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.state).toEqual(compiled.reconciledOpeningState);
    expect(result.primitiveState).toEqual(compiled.reconciledPrimitiveState);
    const summary = runHouseholdKernel({ kernel: compiled.executionKernel!, runContext: d1IntegratedRunContext() });
    expect(summary.state).toEqual(result.state);
    expect(summary.periods).toHaveLength(0);
    // Both domains enforce bank funding through the real compiler.
    const domainRequest = { baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01", simulationEnd: "2026-02-01", executionOwnerId: golden.person };
    const wrongSource = authorDomainOperation(original, { ...purchase, amount: "200", quantity: "2", cashAccountId: golden.brokerageAccount });
    expect(compileDomainMechanics(wrongSource, domainRequest).status).toBe("unsupported");
  });
});
