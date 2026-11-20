import { describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../../src/accounting/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../../src/funding/index.js";
import { domainId, generatedOccurrenceKey } from "../../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../../src/lineage/index.js";
import { registerHouseholdPayrollHealthProvider, type HouseholdPayrollHealthOriginal } from "../../../../../src/simulation/d2/health/premiums/payrollBinding/index.js";
import { registerHouseholdBankOriginalProvider } from "../../../../../src/simulation/d2/integration/householdBank/index.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal } from "../../../../../src/simulation/d2/integration/householdWages/index.js";
import { compileHouseholdKernel, observeHouseholdForecastSources, runHouseholdForecastSummary } from "../../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../../src/simulation/run.js";
import { createHouseholdTaxParticipant, taxBalanceIds } from "../../../../../src/simulation/tax/participant.js";
import { createAuthoritativeState } from "../../../../../src/state/index.js";
import { instant } from "../../../../../src/time/index.js";
import { money, Rate, rateConvention, Ratio, USD } from "../../../../../src/values/index.js";
import { bank, coverage, household, payroll, person, scenario } from "../../../health/premiums/payrollBinding/fixtures.js";
import { taxRule } from "../../../../fixtures/t1aTaxRules.js";

describe("tax factory and independently signed health wages", () => {
  it("uses the signed federal income and payroll bases and denies a withdrawn health original", () => {
    const start = instant("2024-01-01T00:00:00.000Z"), end = instant("2024-02-01T00:00:00.000Z");
    const payday = instant("2024-01-15T17:00:00.000Z"), cutoff = instant("2023-12-31T23:59:59.000Z");
    const id = (n: number) => `34810000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const context = createRunContext({ simulationStart: start, simulationEnd: end, asOf: cutoff, dataCutoff: cutoff,
      runId: runId(id(1)), scenarioId: scenarioId(id(2)), baseCurrency: USD });
    const incomeId = domainId("income", id(3)), expenseId = domainId("expense", id(4));
    const payable = domainId("liability", id(5)), recurrence = domainId("primitive-instance", id(6));
    const plan = coverage(), raw = payroll(plan, payday);
    const gross = money("1000"), employeePremium = money("200");
    const rule = taxRule(1, { jurisdiction: "US:FEDERAL", income: { ...taxRule().income!, standardDeduction: money("0") },
      payroll: [{ key: "synthetic-payroll", rate: Ratio.parse("0.1"), basis: "per_employee", threshold: money("0") }] });
    const transactionId = accountingTransactionId(`tx:recognition:income:${incomeId}:${payday}`);
    const occurrenceId = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: recurrence,
      scheduledAt: payday, semanticEffectType: "income-recognition", economicTargetId: incomeId });
    const stream = { id: incomeId, ownerId: person, depositAccountId: bank, baseMonthlyAmount: gross,
      start, end, recurrence: { kind: "utc_monthly", anchor: payday, invalidDayPolicy: "skip" } as const,
      growthBaseAt: payday, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
      primitiveIds: { recurrence, growth: domainId("primitive-instance", id(7)) } };
    const traceRefs = [calculationTraceRef(calculationTraceId(`payroll:${transactionId}:gross:${incomeId}`))];
    const draft = { id: transactionId, date: payday, type: "payroll_income", traceRefs };
    const cash = (amount: typeof gross) => createAccountingLeg({ type: "cash", posting: "debit", amount, accountId: bank, cashFlowClass: "operating" });
    const income = createAccountingLeg({ type: "income", posting: "credit", amount: gross });
    const transaction = createAccountingTransaction({ ...draft, legs: [
      createAccountingLeg({ type: "expense", posting: "debit", amount: employeePremium, entityId: expenseId }),
      cash(money("800")), income,
    ] });
    const legalBases = raw.bases.map(base => ({ ...base, before: gross, after: money("800"),
      ...(base.jurisdiction === rule.jurisdiction ? { ruleId: rule.id, ruleVersion: rule.version } : {}) }));
    const health: HouseholdPayrollHealthOriginal = { revisionId: "1", status: "active", expenseId, transaction, legalBases,
      premiumRequest: scenario([plan]).request,
      event: { runId: context.runId, eventId: transactionId, eventAt: payday, asOf: cutoff, dataCutoff: cutoff },
      payroll: { ...raw.facts, bankOwnerId: household, source: { ...raw.facts.source, incomeId, transactionId, occurrenceId },
        election: { ...raw.facts.election, incomeId }, contributions: [], withholding: [],
        requiredBases: legalBases.map(({ jurisdiction, regime, ruleId, ruleVersion }) => ({ jurisdiction, regime, ruleId, ruleVersion })),
        transaction: createAccountingTransaction({ ...draft, legs: [cash(gross), income] }) },
    };
    const healthSource = { version: "household-payroll-health-source/v1", publisherId: "348-tax-health", sourceId: health.payroll.source.sourceId } as const;
    const publication = { revisionId: "1", status: "active" as const, publishedAt: cutoff, knownAt: cutoff, effectiveFrom: start, effectiveUntil: end };
    const wage: HouseholdWageOriginal = { ...publication, health: healthSource, stream, gross, transaction, occurrenceId, incomeId,
      sourceId: "wage", bankAccountId: bank, householdId: household, personId: person,
      employerId: plan.sponsorId, period: { start, end } };
    let healthAvailable = true;
    registerHouseholdPayrollHealthProvider({ publisherId: healthSource.publisherId, readActiveOriginal: query =>
      healthAvailable && query.sourceId === healthSource.sourceId
        ? { context: query.context, completeThrough: cutoff, original: health } : undefined });
    const wagePublisher = "348-tax-wage", bankPublisher = "348-tax-bank";
    registerHouseholdWageOriginalProvider({ publisherId: wagePublisher, readOriginals: query =>
      query.sourceId === wage.sourceId ? { version: "household-wage-inventory/v1", publisherId: wagePublisher,
        sourceId: wage.sourceId, context: query.context, checkedAt: cutoff, completeThrough: cutoff,
        completeness: "complete", originals: [wage] } : undefined });
    registerHouseholdBankOriginalProvider({ publisherId: bankPublisher, readOriginals: query => query.sourceId === "paycheck"
      ? { version: "household-bank-original-inventory/v1", publisherId: bankPublisher, query, checkedAt: cutoff,
        completeThrough: cutoff, completeness: "complete", originals: [
          { ...publication, kind: "account", sourceId: "deed", bankAccountId: bank, accountKind: "checking", owner: { kind: "household", id: household } },
          { ...publication, kind: "household", sourceId: "roster", householdId: household },
          { ...publication, kind: "membership", sourceId: "member", householdId: household, personId: person },
          { ...publication, kind: "permission", sourceId: "credit", householdId: household, personId: person, bankAccountId: bank, direction: "credit" },
        ] } : undefined });

    const tax = createHouseholdTaxParticipant({ catalog: [rule], filingStatus: "single", simulationStart: start, ownerId: household,
      incomes: [{ id: incomeId, ownerId: person, employerId: plan.sponsorId, incomeType: "salary", taxCharacter: "ordinary",
        grossOrNet: "gross", start: "2024-01-01", eligibility: [],
        residence: [{ state_jurisdiction: "TEST:RESIDENCE", effective_date: "2024-01-01" }],
        work: [{ state_jurisdiction: "TEST:SERVICE", effective_date: "2024-01-01", allocation: "1" }] }],
      eligibility: [], diagnostics: [], payments: [], settlements: [], refundAccountId: bank,
      fundingPolicy: createFundingPolicy({ id: fundingPolicyId("348-tax-health"), orderedSources: [{ kind: "cash_account", accountId: bank }],
        allowPartial: false, insufficientFundsBehavior: "unfunded" }),
    });
    const { liabilityId, creditPositionId } = taxBalanceIds(rule.jurisdiction, "2024");
    const kernel = compileHouseholdKernel({ executionMonths: 1, scenarioIdentity: context.scenarioId, scenarioBindings: {},
      reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), participants: [tax], nonInvestmentPositionIds: [creditPositionId],
      reconciledOpeningState: createAuthoritativeState({ accounts: { [bank]: { id: bank, kind: "checking", ownerId: household, cash: money("100") } },
        liabilities: { [payable]: { id: payable, balance: money("0") } } }),
      cashFlowInput: { householdId: household, ownerId: person, cashAccountId: bank, expensePayableLiabilityId: payable, baseCurrency: USD,
        expenses: [], events: [], incomes: [{ ...stream, householdWageSource: { version: "household-wage-source/v1", health: healthSource,
          bank: { publisherId: bankPublisher, sourceId: "paycheck" }, original: { version: "household-economic-original/v1",
            family: "wage", publisherId: wagePublisher, sourceId: wage.sourceId, revisionId: wage.revisionId, digest: householdWageOriginalDigest(wage) } } }] },
    }, start);
    const forecast = runHouseholdForecastSummary({ kernel, runContext: context });
    expect(forecast.periods, JSON.stringify(forecast.diagnostics)).toHaveLength(1);
    expect(forecast.state.accounts[bank]!.cash).toEqual(money("900"));
    expect(forecast.state.d2PostedTransactions?.[transactionId]?.transaction).toEqual(transaction);
    expect(forecast.state.liabilities[liabilityId]?.balance).toEqual(money("160"));
    healthAvailable = false;
    expect(() => observeHouseholdForecastSources(forecast)).toThrow();
  });
});
