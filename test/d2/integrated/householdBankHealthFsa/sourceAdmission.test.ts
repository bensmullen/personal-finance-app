import { beforeAll, describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../src/lineage/index.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { compileHouseholdKernel, replayHouseholdForecastWindow, runCompiledHouseholdProjection, runHouseholdForecastSummary } from "../../../../src/simulation/householdExecution.js";
import { runCompiledHouseholdProjection as runReference } from "../../../../src/simulation/r3/referenceHouseholdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { registerHouseholdBankOriginalProvider } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { registerHouseholdPayrollHealthProvider, type HouseholdPayrollHealthOriginal } from "../../../../src/simulation/d2/health/premiums/payrollBinding/index.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal } from "../../../../src/simulation/d2/integration/householdWages/index.js";
import { payrollContributionCandidate, type PayrollContributionAllocation } from "../../../../src/simulation/payrollContributions.js";
import { contributionCharacters, type D1CapacityKind } from "../../../../src/rules/contribution2026.js";
import { stableContributionRuleId } from "../../../../src/application/compiler/contributionAuthoring.js";
import { taxBalanceIds, type PayrollWithholdingElection } from "../../../../src/simulation/tax/contracts.js";
import { attachFsaCash, registerFsaCashSourceProvider, type FsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/index.js";
import { depositOperationId, originalOperationId } from "../../../../src/simulation/d2/integration/fsaCash/source.js";
import { admitS4OpeningSources, createAuthoritativeState, householdPayrollHealthPostingEvidence, type HouseholdBankEventContext } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { Money, money, Quantity, Rate, rateConvention, SHARE, Unit, USD } from "../../../../src/values/index.js";
import { coverage, payroll, scenario, household, person, bank } from "../../health/premiums/payrollBinding/fixtures.js";
import { fixture as fsaFixture, ids as fsaIds, input as fsaInput, source as fsaSource } from "../fsaCash/scenario.js";

const expenseId = domainId("expense", "27900000-0000-4000-8000-000000000001");
const primitive = domainId("primitive-instance", "27900000-0000-4000-8000-000000000002");
const growth = domainId("primitive-instance", "27900000-0000-4000-8000-000000000006");
const payable = domainId("liability", "27900000-0000-4000-8000-000000000007");
const payday = instant("2026-01-15T17:00:00.000Z");
const healthRef = { version: "household-payroll-health-source/v1", publisherId: "health-archive", sourceId: `original:A:${payday}` } as const;
const bankRef = { publisherId: "s4-bank", sourceId: "bank-control" } as const;
const healthPeriod = { start: instant("2026-01-01T00:00:00.000Z"), end: instant("2026-02-01T00:00:00.000Z") };
const cutoff = instant("2025-12-31T00:00:00.000Z");
const context = createRunContext({
  asOf: cutoff, dataCutoff: cutoff, runId: runId("27900000-0000-4000-8000-000000000003"),
  scenarioId: scenarioId("27900000-0000-4000-8000-000000000004"),
  simulationStart: healthPeriod.start, simulationEnd: healthPeriod.end, baseCurrency: USD,
});
const amended = instant("2026-01-20T00:00:00.000Z");
let health: HouseholdPayrollHealthOriginal | undefined;
let wage: HouseholdWageOriginal | undefined;
let fsa: FsaCashSource | undefined;
let healthReads = 0;
let withdrawOnRead = Number.POSITIVE_INFINITY;
let amendedHealth = false;

beforeAll(() => {
  registerHouseholdBankOriginalProvider({ publisherId: bankRef.publisherId, readOriginals: query => {
    const event = query.context;
    const base = { revisionId: "1", publishedAt: instant("2023-01-01T00:00:00.000Z"),
      knownAt: instant("2023-01-01T00:00:00.000Z"), effectiveFrom: instant("2023-01-01T00:00:00.000Z"),
      effectiveUntil: instant("2035-01-01T00:00:00.000Z"), status: "active" as const };
    if (query.sourceId !== bankRef.sourceId ||
        !((event.householdId === household && event.bankAccountId === bank && event.personId === person) ||
          (event.householdId === fsaIds.household && event.bankAccountId === fsaIds.bank && event.personId === fsaIds.person)))
      return undefined;
    return { version: "household-bank-original-inventory/v1", publisherId: bankRef.publisherId, query,
      checkedAt: event.asOf, completeThrough: event.dataCutoff, completeness: "complete", originals: [
        { ...base, kind: "account", sourceId: "deed", bankAccountId: event.bankAccountId,
          accountKind: "checking", owner: { kind: "household", id: event.householdId } },
        { ...base, kind: "household", sourceId: "household", householdId: event.householdId },
        { ...base, kind: "membership", sourceId: "membership", householdId: event.householdId, personId: event.personId },
        { ...base, kind: "permission", sourceId: "permission", householdId: event.householdId,
          personId: event.personId, bankAccountId: event.bankAccountId, direction: event.direction },
      ] };
  } });
  registerHouseholdWageOriginalProvider({ publisherId: "s4-wages", readOriginals: query => {
    if (!wage || query.sourceId !== wage.sourceId) return undefined;
    return { version: "household-wage-inventory/v1", publisherId: "s4-wages", sourceId: query.sourceId,
      context: query.context, checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff,
      completeness: "complete", originals: [wage] };
  } });
  registerHouseholdPayrollHealthProvider({ publisherId: healthRef.publisherId, readActiveOriginal: query => {
    if (!health || query.sourceId !== health.payroll.source.sourceId || ++healthReads >= withdrawOnRead) return undefined;
    return { context: query.context, completeThrough: query.context.dataCutoff,
      original: amendedHealth && query.context.dataCutoff >= amended ? { ...health, revisionId: "2" } : health };
  } });
  registerFsaCashSourceProvider({ lookup: id => fsa?.sourceId === id ? fsa : undefined }, "s4-fsa");
});

function contribution(priority: number, character: "traditional_401k" | "employee_hsa", amount: string,
  limits: readonly D1CapacityKind[]): PayrollContributionAllocation {
  const id = (n: number) => `27900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { id: id(priority), priority, accountId: domainId("account", id(priority + 100)),
    positionId: domainId("position", id(priority + 200)), vestedFraction: "1",
    calculation: { kind: "fixed", amount: money(amount) }, policy: {
      personId: person, householdId: household, character, excessPolicy: "reject",
      facts: { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: money("100000"),
        hsaFullYearEligible: true, hsaCoverage: "self" },
      limits: limits.map(kind => ({ kind, ruleId: stableContributionRuleId(person, kind, 2026),
        target: { targetType: "person", targetId: person },
        bucketKey: kind === "401k_additions" ? "401k_additions:employer-A" : kind,
        includedCharacters: contributionCharacters(kind) })),
    } };
}

function paycheck(zeroNet = false, elected = false) {
  healthReads = 0;
  withdrawOnRead = Number.POSITIVE_INFINITY;
  amendedHealth = false;
  const plan = coverage("A", "2026-01-01", "2026-02-01", "2026-01-15");
  const raw = payroll(plan, payday);
  const s = raw.facts.source;
  const gross = zeroNet ? money("200") : money("1000");
  const incomeId = domainId("income", "27900000-0000-4000-8000-000000000005");
  const election: PayrollWithholdingElection = { ...raw.facts.withholding[0]!.election, incomeId };
  const withholding = elected ? [election] : [];
  const allocations = elected ? [contribution(10, "traditional_401k", "50", ["401k_additions", "401k_elective"]),
    contribution(11, "employee_hsa", "20", ["hsa_individual"])] : [];
  const stream = { id: incomeId, ownerId: person, payrollWithholding: withholding, payrollContributions: allocations,
    depositAccountId: bank, baseMonthlyAmount: gross, start: healthPeriod.start,
    recurrence: { kind: "utc_monthly", anchor: s.dueAt, invalidDayPolicy: "skip" } as const,
    growthBaseAt: s.dueAt, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
    primitiveIds: { recurrence: primitive, growth } };
  const transactionId = accountingTransactionId(`tx:recognition:income:${stream.id}:${s.dueAt}`);
  const occurrenceId = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: primitive,
    scheduledAt: s.dueAt, semanticEffectType: "income-recognition", economicTargetId: stream.id });
  const binding = { ...s, incomeId: stream.id, transactionId, occurrenceId };
  const traceRefs = [calculationTraceRef(calculationTraceId(`payroll:${transactionId}:gross:${stream.id}`),
    allocations.flatMap(item => item.policy.limits.map(limit => domainId("tax-rule", limit.ruleId)))),
    ...withholding.map(row => calculationTraceRef(calculationTraceId(
      `payroll:withholding:${row.id}:income:${incomeId}:owner:${person}:employer:${row.employerId}:occurrence:${occurrenceId}:year:2026:jurisdiction:${row.jurisdiction}:provenance:${row.provenance}`,
    )))];
  const income = createAccountingLeg({ type: "income", posting: "credit", amount: gross });
  const cash = (amount: Money) => createAccountingLeg({ type: "cash", posting: "debit", amount, accountId: bank, cashFlowClass: "operating" });
  const draft = { id: transactionId, date: s.dueAt, type: "payroll_income", traceRefs };
  const creditLegs = withholding.map(row => createAccountingLeg({ type: "asset", posting: "debit",
    entityId: taxBalanceIds(row.jurisdiction, "2026").creditPositionId,
    amount: money("100"), quantity: Quantity.parse("100", Unit.of("usd_tax_credit")) }));
  const signedContributions = allocations.map(item => {
    if (item.calculation.kind !== "fixed") throw new Error("Expected fixed employee contribution");
    return { id: `${transactionId}:${item.id}`, character: item.policy.character, amount: item.calculation.amount };
  });
  const contributionLegs = allocations.map((item, index) => createAccountingLeg({ type: "asset", posting: "debit",
    entityId: item.positionId, amount: signedContributions[index]!.amount, quantity: Quantity.parse(index === 0 ? "0.5" : "0.2", SHARE) }));
  const signedCashBeforeHealth = gross.minus(elected ? money("170") : money("0"));
  const transaction = createAccountingTransaction({ ...draft, legs: [
    ...contributionLegs, ...creditLegs,
    createAccountingLeg({ type: "expense", posting: "debit", amount: money("200"), entityId: expenseId }),
    ...(zeroNet ? [] : [cash(signedCashBeforeHealth.minus(money("200")))]), income,
  ] });
  const legalBases = raw.bases.map(row => ({ ...row, before: gross, after: gross.minus(row.exclusion) }));
  health = { revisionId: "1", status: "active", expenseId, transaction, legalBases, premiumRequest: scenario([plan]).request,
    event: { runId: context.runId, eventId: transactionId, eventAt: s.dueAt, asOf: cutoff, dataCutoff: cutoff },
    payroll: { ...raw.facts, source: binding, bankOwnerId: household, gross, contributions: signedContributions,
      withholding: withholding.map(row => ({ election: row, amount: money("100") })),
      election: { ...raw.facts.election, incomeId: stream.id },
      transaction: createAccountingTransaction({ ...draft, legs: [...contributionLegs, ...creditLegs, cash(signedCashBeforeHealth), income] }) } };
  wage = { health: healthRef, stream, gross, incomeId: stream.id, householdId: household, personId: person,
    bankAccountId: bank, employerId: s.employerId, period: healthPeriod, occurrenceId,
    transaction, sourceId: "employer", revisionId: "1", status: "active", publishedAt: s.publishedAt,
    knownAt: s.knownAt, effectiveFrom: healthPeriod.start, effectiveUntil: healthPeriod.end };
  const event: HouseholdBankEventContext = { runId: context.runId, asOf: context.asOf, dataCutoff: context.dataCutoff,
    eventId: transactionId, eventAt: s.dueAt, personId: person, householdId: household, bankAccountId: bank, direction: "credit" };
  const opening = createAuthoritativeState({ accounts: { [bank]: { id: bank, kind: "checking", ownerId: household, cash: money("100") },
    ...Object.fromEntries(allocations.map(item => [item.accountId, { id: item.accountId, kind: "retirement" as const, ownerId: person, cash: money("0") }])) },
    positions: Object.fromEntries(allocations.map(item => [item.positionId, { id: item.positionId, accountId: item.accountId,
      price: money("100"), quantity: Quantity.parse("0", SHARE), carryingValue: money("0") }])),
    liabilities: { [payable]: { id: payable, balance: money("0") } } });
  const source = { version: "household-wage-source/v1", health: healthRef, bank: bankRef,
    original: { version: "household-economic-original/v1", family: "wage", publisherId: "s4-wages",
      sourceId: "employer", revisionId: "1", digest: householdWageOriginalDigest(wage) } } as const;
  const run = () => payrollContributionCandidate(opening, { runContext: context, id: transactionId, incomeId: stream.id,
    at: s.dueAt, gross, householdId: household, ownerId: person, occurrenceId, depositAccountId: bank,
    allocations, withholding, householdWage: { stream, period: healthPeriod, context: event, source } });
  const cashFlowInput = { householdId: household, ownerId: person, cashAccountId: bank, expensePayableLiabilityId: payable,
    baseCurrency: USD, incomes: [{ ...stream, householdWageSource: source }], expenses: [], events: [] };
  return { opening, run, transaction, cashFlowInput };
}

const emptyRun = (state: ReturnType<typeof createAuthoritativeState>, runContext = context) => ({
  runContext, compiled: { scenarioIdentity: runContext.scenarioId, executionMonths: 1,
    reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), scenarioBindings: {} },
});

describe("S4 authoritative BANK source admission", () => {
  it.each([false, true])("posts one two-family exact paycheck with zero net = %s", zeroNet => {
    const { run, transaction } = paycheck(zeroNet);
    const result = run();
    expect(result.transactions).toEqual([transaction]);
    expect(result.state.accounts[bank]!.cash.equals(money(zeroNet ? "100" : "900"))).toBe(true);
    const proof = result.state.d2PostedTransactions![transaction.id]!;
    expect(proof.registration.kind).toBe("household_domain");
    expect(householdPayrollHealthPostingEvidence(proof, context)?.deduction).toEqual(result.withholdingEvidence?.healthDeduction);
    expect(runCompiledHouseholdProjection(emptyRun(result.state)).state.accounts[bank]!.cash)
      .toEqual(runReference(emptyRun(result.state)).state.accounts[bank]!.cash);
  });

  it("preflights both household runners without streams or participants", () => {
    const result = paycheck().run();
    const before = canonicalSerialize(result.state);
    const newer = createRunContext({ ...context, asOf: amended, dataCutoff: amended });
    const older = instant("2023-11-30T00:00:00.000Z");
    expect(() => admitS4OpeningSources(result.state, newer)).not.toThrow();
    amendedHealth = true;
    for (const runner of [runCompiledHouseholdProjection, runReference]) {
      expect(() => runner(emptyRun(result.state, newer))).toThrow();
      expect(() => runner(emptyRun(result.state, createRunContext({ ...context, asOf: older, dataCutoff: older })))).toThrow();
    }
    amendedHealth = false;
    health = undefined;
    for (const runner of [runCompiledHouseholdProjection, runReference])
      expect(() => runner(emptyRun(result.state))).toThrow();
    const kernel = compileHouseholdKernel(emptyRun(result.state).compiled, context.simulationStart);
    expect(() => runHouseholdForecastSummary({ kernel, runContext: context })).toThrow();
    expect(canonicalSerialize(result.state)).toBe(before);
  });

  it.each([false, true])("reconciles independently scheduled common-domain paychecks with elections = %s", elected => {
    const { opening, cashFlowInput, transaction } = paycheck(false, elected);
    const base = emptyRun(opening);
    const request = { ...base, compiled: { ...base.compiled, cashFlowInput } };
    const optimized = runCompiledHouseholdProjection(request);
    const reference = runReference(request);
    expect(optimized.status).toBe("completed");
    expect(reference.status).toBe("completed");
    expect(canonicalSerialize(optimized.state)).toEqual(canonicalSerialize(reference.state));
    expect(optimized.state.d2PostedTransactions?.[transaction.id]?.transaction).toEqual(transaction);
    expect(optimized.periods.map(row => row.cash)).toEqual(reference.periods.map(row => row.cash));
    health = undefined;
    for (const runner of [runCompiledHouseholdProjection, runReference]) {
      const rejected = runner(request);
      expect(rejected.status).toBe("incomplete");
      expect(rejected.state.accounts[bank]!.cash).toEqual(opening.accounts[bank]!.cash);
    }
    // Optional tax, after-tax premium and FSA participants are not measured by the frozen reference.
  });

  it.each([8, 20, 120, 360, 649])("retains bounded proof references across %i structural occurrences", count => {
    const { run, transaction } = paycheck();
    const proof = run().state.d2PostedTransactions![transaction.id]!;
    const encoded = canonicalSerialize(Array.from({ length: count }, (_, index) => ({ ...proof, occurrence: index })));
    expect(encoded.length).toBeLessThan(4500 * count);
    expect(encoded).not.toContain("premiumRequest");
    expect(encoded).not.toContain("legalBases");
  });

  it("rejects missing legal facts and a publisher that withdraws on the confirmation read", () => {
    const first = paycheck();
    health = { ...health!, legalBases: [] };
    expect(first.run).toThrow();
    const next = paycheck();
    withdrawOnRead = 2;
    const before = canonicalSerialize(next.opening);
    expect(next.run).toThrow();
    expect(canonicalSerialize(next.opening)).toBe(before);
  });

  it("posts the independently paid debit and subsequent settled credit, then rechecks native replay", () => {
    const fixture = fsaFixture(2, createAuthoritativeState({ accounts: { [fsaIds.bank]: {
      id: fsaIds.bank, kind: "checking", ownerId: fsaIds.household, cash: money("1500"),
    } } }));
    const raw = fsaSource();
    const event = (eventId: string, eventAt: HouseholdBankEventContext["eventAt"], direction: "debit" | "credit"): HouseholdBankEventContext => ({
      runId: fixture.context.runId, asOf: fixture.context.asOf, dataCutoff: fixture.context.dataCutoff,
      eventId, eventAt, direction, householdId: fsaIds.household, bankAccountId: fsaIds.bank, personId: fsaIds.person,
    });
    fsa = { ...raw, request: { ...raw.request, receipts: raw.request.receipts.map(r => ({
      ...r, destination: { ...r.destination!, ownerId: fsaIds.household, householdBank: true },
    })) }, deposit: { ...raw.deposit, ownerId: fsaIds.household }, householdBank: {
      bankPublisherId: bankRef.publisherId, bankSourceId: bankRef.sourceId,
      originalContext: event(originalOperationId(raw), raw.original.paidAt, "debit"),
      settlementContext: event(depositOperationId(raw), raw.deposit.settledAt, "credit"),
    } };
    const paidAndSettled = fsa;
    fsa = { ...paidAndSettled, deposit: { ...paidAndSettled.deposit, status: "pending" } };
    const pending = runHouseholdForecastSummary({ kernel: attachFsaCash(fixture.kernel, fsaInput(fsa)), runContext: fixture.context });
    expect(pending.status).toBe("completed");
    expect(pending.periods.map(row => row.cash.amount.toString())).toEqual(["500", "500"]);
    fsa = paidAndSettled;
    const kernel = attachFsaCash(fixture.kernel, fsaInput(fsa));
    const forecast = runHouseholdForecastSummary({ kernel, runContext: fixture.context });
    expect(forecast.status).toBe("completed");
    expect(forecast.periods.map(row => row.cash.amount.toString())).toEqual(["500", "1500"]);
    const artifact = createPortableHouseholdReplayArtifact(forecast, true);
    const transported = JSON.parse(JSON.stringify(artifact));
    const window = forecast.periods[1]!.period;
    expect(replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(transported), window).status).toBe("completed");
    expect(replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(artifact), window).status).toBe("completed");
    const tooEarly = instant("2026-02-01T00:00:00.000Z");
    expect(() => admitS4OpeningSources(forecast.state, { asOf: tooEarly, dataCutoff: tooEarly })).toThrow();
    fsa = undefined;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
  });
});
